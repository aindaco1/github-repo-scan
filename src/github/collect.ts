import { GitHubClient } from "./client.ts";
import { code, encodeRepo, hash, textBound, githubUrl } from "../util.ts";
import type { Collected, Context, Repo } from "../types.ts";
import { collectArtifacts } from "./artifacts.ts";
export async function collectRepository(
  client: GitHubClient,
  repo: Repo,
  context: Context,
  at = new Date().toISOString(),
): Promise<Collected> {
  client.setRepositories([repo]);
  const start = client.requests,
    base = `/repos/${encodeRepo(repo.full_name)}`,
    name = repo.full_name;
  const result: Collected = {
    repo,
    headSha: null,
    observedAt: at,
    branches: [],
    workflows: [],
    runs: [],
    jobs: {},
    prs: [],
    issues: [],
    docs: [],
    artifacts: [],
    gaps: [],
    requests: 0,
  };
  async function attempt(area: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (e) {
      result.gaps.push({ repository: name, area, code: code(e) });
    }
  }
  await attempt("head", async () => {
    if (repo.size === 0) return;
    result.headSha = (
      await client.get(
        name,
        `${base}/commits/${encodeURIComponent(repo.default_branch)}`,
        "head",
      )
    ).sha;
  });
  await attempt("branches", async () => {
    result.branches = (await client.pages(name, `${base}/branches`)).map(
      (b) => b.name,
    );
  });
  await attempt("issues", async () => {
    if (!repo.has_issues) return;
    result.issues = (
      await client.pages(
        name,
        `${base}/issues?state=open&sort=created&direction=asc`,
      )
    )
      .filter((i) => !i.pull_request)
      .map((i) => ({
        id: i.id,
        number: i.number,
        title: textBound(i.title, 500),
        body: textBound(i.body),
        url: githubUrl(i.html_url),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        labels: i.labels.map((l: any) => (typeof l === "string" ? l : l.name)),
        assignees: i.assignees.map((a: any) => a.login),
      }));
  });
  await attempt("pulls", async () => {
    const list = await client.pages(
      name,
      `${base}/pulls?state=open&sort=created&direction=asc`,
    );
    for (const item of list) {
      await attempt(`pr_${item.number}`, async () => {
        const pr = await client.get(
          name,
          `${base}/pulls/${item.number}`,
          "pull",
        );
        const head = pr.head.sha;
        const normalized: any = {
          id: pr.id,
          number: pr.number,
          title: textBound(pr.title, 500),
          url: githubUrl(pr.html_url),
          body: textBound(pr.body),
          draft: pr.draft,
          headSha: head,
          baseSha: pr.base.sha,
          headRef: pr.head.ref,
          updatedAt: pr.updated_at,
          createdAt: pr.created_at,
          mergeable: pr.mergeable,
          mergeableState: pr.mergeable_state,
          requestedReviews: pr.requested_reviewers.map((r: any) => r.login),
          checks: [],
          statuses: [],
          reviews: [],
          requiredCheckPolicy: "unknown",
        };
        result.prs.push(normalized);
        await attempt(`pr_${pr.number}_checks`, async () => {
          normalized.checks = (
            await client.pages(
              name,
              `${base}/commits/${head}/check-runs?filter=latest`,
              "check_runs",
            )
          ).map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            headSha: c.head_sha,
            url: githubUrl(c.html_url),
          }));
          normalized.statuses = (
            await client.pages(name, `${base}/commits/${head}/statuses`)
          ).map((s) => ({
            id: s.id,
            context: s.context,
            state: s.state,
            url: githubUrl(s.target_url),
          }));
        });
        await attempt(`pr_${pr.number}_reviews`, async () => {
          normalized.reviews = (
            await client.pages(name, `${base}/pulls/${pr.number}/reviews`)
          ).map((r) => ({
            id: r.id,
            author: r.user?.login,
            state: r.state,
            commitId: r.commit_id,
            submittedAt: r.submitted_at,
          }));
        });
        const current = await client.get(
          name,
          `${base}/pulls/${item.number}`,
          "pull_head_recheck",
        );
        if (current.head.sha !== head)
          result.gaps.push({
            repository: name,
            area: `pr_${pr.number}`,
            code: "head_changed_during_scan",
          });
      });
      if (!result.prs.some((p) => p.number === item.number))
        result.prs.push({
          id: item.id,
          number: item.number,
          title: textBound(item.title, 500),
          url: githubUrl(item.html_url),
          headSha: item.head.sha,
          unavailable: true,
        });
    }
  });
  await attempt("workflows", async () => {
    result.workflows = (
      await client.pages(name, `${base}/actions/workflows`, "workflows")
    ).map((w) => ({
      id: w.id,
      path: w.path,
      name: w.name,
      state: w.state,
      url: githubUrl(w.html_url),
    }));
  });
  await attempt("run_history", async () => {
    const now = new Date(at);
    result.runs = await client.windowRuns(
      name,
      new Date(now.getTime() - 30 * 86400_000),
      now,
    );
  });
  for (const workflow of result.workflows) {
    await attempt(`workflow_${workflow.id}`, async () => {
      for (const suffix of [
        "",
        "&status=completed",
        `&status=completed&branch=${encodeURIComponent(repo.default_branch)}`,
      ]) {
        const latest = await client.get(
          name,
          `${base}/actions/workflows/${workflow.id}/runs?per_page=1${suffix}`,
          "latest_run",
        );
        result.runs.push(...latest.workflow_runs);
      }
    });
  }
  result.runs = [...new Map(result.runs.map((r) => [r.id, r])).values()]
    .map((r) => ({
      id: r.id,
      attempt: r.run_attempt,
      workflowId: r.workflow_id,
      path: r.path,
      name: r.name,
      event: r.event,
      branch: r.head_branch,
      sha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      url: githubUrl(r.html_url),
      pullNumbers: (r.pull_requests ?? []).map((p: any) => p.number),
    }))
    .sort((a, b) => b.id - a.id || b.attempt - a.attempt);
  // Jobs are needed for each failing scope's latest incident; successful history stays metadata-only.
  const scopes = new Set<string>();
  for (const run of result.runs) {
    const scope = `${run.workflowId}:${run.event}:${run.branch}`;
    if (
      scopes.has(scope) ||
      run.status !== "completed" ||
      ["skipped", "cancelled"].includes(run.conclusion)
    )
      continue;
    scopes.add(scope);
    if (
      ![
        "failure",
        "timed_out",
        "action_required",
        "startup_failure",
        "stale",
      ].includes(run.conclusion)
    )
      continue;
    await attempt(`run_${run.id}_jobs`, async () => {
      result.jobs[String(run.id)] = (
        await client.pages(
          name,
          `${base}/actions/runs/${run.id}/attempts/${run.attempt}/jobs`,
          "jobs",
        )
      ).map((j) => ({
        id: j.id,
        name: j.name,
        conclusion: j.conclusion,
        url: githubUrl(j.html_url),
        steps: j.steps?.map((s: any) => ({
          name: s.name,
          number: s.number,
          conclusion: s.conclusion,
          status: s.status,
        })),
      }));
    });
  }
  if (result.headSha)
    for (const path of [
      ...new Set(["AGENTS.md", "README.md", ...(context.docs ?? [])]),
    ]) {
      await attempt("docs", async () => {
        const file = await client.file(name, path, result.headSha!);
        if (!file) {
          if (context.docs?.includes(path))
            throw new Error("configured_doc_missing");
          return;
        }
        result.docs.push({
          path,
          sha: file.sha,
          hash: await hash(file.text),
          url: `https://github.com/${encodeRepo(name)}/blob/${result.headSha}/${path}`,
          text: file.text,
        });
      });
    }
  for (const adapter of context.artifacts ?? [])
    await attempt("artifact", async () => {
      result.artifacts.push(await collectArtifacts(client, result, adapter));
    });
  result.requests = client.requests - start;
  return result;
}
