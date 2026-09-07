import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { GitHubClient } from "../github/client.ts";
import { collectRepository } from "../github/collect.ts";
import { loadPolicy, selectInventory } from "../policy.ts";
import { buildReport } from "../scan.ts";
import { freezeReport, previousReport, cleanup } from "../storage/database.ts";
import { deliver } from "../email.ts";
import { code } from "../util.ts";
import type {
  RuntimeEnv,
  ScanParams,
  Repo,
  Collected,
  Report,
} from "../types.ts";
export class ScanWorkflow extends WorkflowEntrypoint<RuntimeEnv, ScanParams> {
  async run(event: WorkflowEvent<ScanParams>, step: WorkflowStep) {
    const params = event.payload,
      id = event.instanceId;
    const client = () =>
      new GitHubClient(
        this.env.GITHUB_APP_ID,
        this.env.GITHUB_APP_PRIVATE_KEY,
        {
          deadline: Math.max(
            Date.parse(params.deliverAt ?? params.scheduledAt),
            Date.parse(params.scheduledAt) + 14 * 60_000,
          ),
        },
      );
    await step.do("register-run", async () => {
      await this.env.DB.prepare(
        "INSERT OR IGNORE INTO runs (id,scheduled_at,started_at,send_requested) VALUES (?,?,?,?)",
      )
        .bind(
          id,
          params.scheduledAt,
          new Date().toISOString(),
          params.send ? 1 : 0,
        )
        .run();
    });
    try {
      const setup = await step.do(
        "snapshot-policy-and-inventory",
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const existing = await this.env.REPORTS.get(
            `checkpoints/${id}/setup.json`,
          );
          if (existing) return existing.json<any>();
          const api = client(),
            inventory = await api.inventory(),
            policy = await loadPolicy(this.env, api);
          for (const name of policy.bundle.selection.include)
            if (
              !inventory.repos.some(
                (r) => r.full_name.toLowerCase() === name,
              ) &&
              !policy.bundle.selection.exclude.includes(name)
            ) {
              try {
                inventory.repos.push(await api.repo(name));
              } catch {}
            }
          const expectedObject = await this.env.REPORTS.get(
            "onboarding/owner-inventory.json",
          );
          if (!expectedObject)
            throw new Error("private_access_onboarding_missing");
          const expected = await expectedObject.json<Repo[]>();
          const previous = await previousReport(this.env, id);
          const resolved = selectInventory(
            policy,
            inventory,
            expected,
            previous?.selection,
          );
          const data = {
            policy,
            installations: inventory.installations,
            selection: resolved.selection,
            gaps: resolved.gaps,
            previousId: previous?.id ?? null,
          };
          await this.env.REPORTS.put(
            `checkpoints/${id}/setup.json`,
            JSON.stringify(data),
          );
          return data;
        },
      );
      for (const row of setup.selection.filter((r: any) => r.selected))
        await step.do(
          `collect-${row.repositoryId}`,
          { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" },
          async () => {
            const key = `checkpoints/${id}/repo-${row.repositoryId}.json`;
            if (await this.env.REPORTS.head(key)) return;
            const api = client();
            api.setInstallations(setup.installations);
            const result = await collectRepository(
              api,
              row.repo,
              setup.policy.bundle.repos[row.repository.toLowerCase()] ?? {},
              params.scheduledAt,
            );
            await this.env.REPORTS.put(key, JSON.stringify(result));
          },
        );
      await step.do(
        "freeze-report",
        { retries: { limit: 2, delay: "5 seconds" }, timeout: "5 minutes" },
        async () => {
          const key = `checkpoints/${id}/final.json`;
          let report: Report;
          const old = await this.env.REPORTS.get(key);
          if (old) report = await old.json<Report>();
          else {
            const repositories: Collected[] = [];
            for (const row of setup.selection.filter((r: any) => r.selected)) {
              const file = await this.env.REPORTS.get(
                `checkpoints/${id}/repo-${row.repositoryId}.json`,
              );
              if (file) repositories.push(await file.json<Collected>());
              else
                setup.gaps.push({
                  repository: row.repository,
                  area: "checkpoint",
                  code: "repository_checkpoint_missing",
                });
            }
            const previousObject = setup.previousId
              ? await this.env.REPORTS.get(
                  `reports/${setup.previousId}/report.json`,
                )
              : null;
            const previous = previousObject
              ? await previousObject.json<Report>()
              : undefined;
            report = await buildReport({
              id,
              at: params.scheduledAt,
              policy: setup.policy,
              selection: setup.selection,
              repositories,
              gaps: setup.gaps,
              previous,
            });
            await this.env.REPORTS.put(key, JSON.stringify(report));
          }
          await freezeReport(this.env, report);
          return { coverage: report.coverage.status };
        },
      );
      if (params.send) {
        if (params.deliverAt)
          await step.sleepUntil("delivery-target", new Date(params.deliverAt));
        await step.do(
          "send-frozen-report",
          { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" },
          () => deliver(this.env, id),
        );
      }
      await step.do("retain-needed-data", () => cleanup(this.env));
      return { id, state: "completed" };
    } catch (error) {
      await step.do("record-run-failure", async () => {
        await this.env.DB.prepare(
          "UPDATE runs SET state='failed',error_code=? WHERE id=?",
        )
          .bind(code(error), id)
          .run();
      });
      throw new Error(code(error));
    }
  }
}
