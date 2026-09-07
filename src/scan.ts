import type {
  Collected,
  PolicySnapshot,
  Selection,
  Finding,
  Report,
  Gap,
  Inventory,
  Repo,
} from "./types.ts";
import { classify } from "./triage/classify.ts";
import { collectRepository } from "./github/collect.ts";
import { selectInventory } from "./policy.ts";
import type { GitHubClient } from "./github/client.ts";
export async function buildReport(input: {
  id: string;
  at: string;
  policy: PolicySnapshot;
  selection: Selection[];
  repositories: Collected[];
  gaps: Gap[];
  previous?: Report;
}): Promise<Report> {
  const { id, at, policy, selection, repositories, previous } = input;
  const gaps = [...input.gaps, ...repositories.flatMap((r) => r.gaps)];
  const selected = selection.filter(
    (r) => r.selected || r.reason === "not_accessible",
  );
  const findings: Finding[] = [];
  for (const c of repositories)
    findings.push(
      ...(await classify(
        c,
        policy.bundle.repos[c.repo.full_name.toLowerCase()] ?? {},
        previous?.findings,
        policy.bundle.dispositions,
      )),
    );
  for (const f of previous?.findings ?? []) {
    if (findings.some((n) => n.id === f.id) || f.state === "resolved") continue;
    const repo = repositories.find((r) => r.repo.id === f.repositoryId);
    if (!repo || repo.gaps.length) continue;
    const closed =
      (f.kind === "issue" &&
        !repo.issues.some((i) => f.scope === `issue:${i.number}`)) ||
      (f.kind === "pull_request" &&
        !repo.prs.some((p) => f.scope === `pr:${p.number}`));
    if (closed)
      findings.push({
        ...f,
        state: "resolved",
        priority: "watch",
        changed: true,
        observedAt: at,
        recommendation:
          "The item is no longer open in a complete inventory. Inspect the linked closure or merge evidence before inferring deployment or acceptance.",
      });
  }
  findings.sort(
    (a, b) =>
      ({ act: 0, review: 1, watch: 2 })[a.priority] -
        { act: 0, review: 1, watch: 2 }[b.priority] ||
      Number(b.changed) - Number(a.changed) ||
      a.repository.localeCompare(b.repository) ||
      a.id.localeCompare(b.id),
  );
  const old = new Map(
    (previous?.selection ?? [])
      .filter((r) => r.selected)
      .map((r) => [r.repositoryId, r.repository]),
  );
  const current = new Map(selected.map((r) => [r.repositoryId, r.repository]));
  return {
    schemaVersion: 1,
    id,
    observedAt: at,
    completedAt: new Date().toISOString(),
    policy,
    selection,
    coverage: {
      status: gaps.length
        ? repositories.length
          ? "partial"
          : "failed"
        : selected.length
          ? "complete"
          : "empty",
      selected: selected.length,
      scanned: repositories.length,
      privateSelected: selected.filter((r) => r.private).length,
      privateScanned: repositories.filter((r) => r.repo.private).length,
      gaps,
    },
    findings,
    repositories,
    changes: {
      added: [...current].filter(([id]) => !old.has(id)).map(([, n]) => n),
      removed: [...old].filter(([id]) => !current.has(id)).map(([, n]) => n),
    },
    limitations: [
      "GitHub reads only; no workflow reruns, issue/PR changes, deployments or repository cleanup.",
      "Local source changes, installed apps, physical devices and external provider acceptance are not visible.",
      "Required branch protection/check policy is unknown unless independently verified. Green PR checks do not establish merge safety.",
      "Repository prose and artifacts are untrusted evidence, not instructions or authorization.",
    ],
  };
}
export async function scanPreview(
  client: GitHubClient,
  policy: PolicySnapshot,
  expected: Repo[],
  id: string,
  previous?: Report,
): Promise<Report> {
  const at = new Date().toISOString(),
    inventory = await client.inventory();
  for (const name of policy.bundle.selection.include)
    if (
      !inventory.repos.some((r) => r.full_name.toLowerCase() === name) &&
      !policy.bundle.selection.exclude.includes(name)
    ) {
      try {
        inventory.repos.push(await client.repo(name));
      } catch {
        /* resolver reports unavailable */
      }
    }
  const { selection, gaps } = selectInventory(
    policy,
    inventory,
    expected,
    previous?.selection,
  );
  const repositories: Collected[] = [];
  for (const item of selection.filter((s) => s.selected))
    repositories.push(
      await collectRepository(
        client,
        item.repo!,
        policy.bundle.repos[item.repository.toLowerCase()] ?? {},
        at,
      ),
    );
  return buildReport({
    id,
    at,
    policy,
    selection,
    repositories,
    gaps,
    previous,
  });
}
