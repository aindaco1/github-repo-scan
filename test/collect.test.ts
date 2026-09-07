import { it, expect } from "vitest";
import { collectRepository } from "../src/github/collect.ts";
import { classify } from "../src/triage/classify.ts";
import { repo } from "./helpers.ts";
const pr = {
  id: 2,
  number: 2,
  title: "Review me",
  body: "Evidence",
  draft: false,
  html_url: "https://github.com/owner/repo-1/pull/2",
  head: { sha: "head-1", ref: "topic" },
  base: { sha: "base" },
  requested_reviewers: [],
  updated_at: "2026-09-07",
  created_at: "2026-09-01",
  mergeable: true,
};
function client(failures: string[] = []) {
  let detailReads = 0;
  const calls: string[] = [];
  const api: any = {
    requests: 0,
    setRepositories: () => {},
    get: async (_: string, path: string) => {
      calls.push(path);
      api.requests++;
      if (path.includes("/commits/main")) return { sha: "source-sha" };
      if (path.endsWith("/pulls/2"))
        return {
          ...pr,
          head: { ...pr.head, sha: ++detailReads === 1 ? "head-1" : "head-2" },
        };
      throw Error("unexpected_endpoint");
    },
    pages: async (_: string, path: string) => {
      calls.push(path);
      api.requests++;
      if (failures.some((f) => path.includes(f))) throw Error("http_403");
      if (path.endsWith("/branches"))
        return [{ name: "main" }, { name: "topic" }];
      if (path.includes("/issues?"))
        return [
          { ...pr, labels: [], assignees: [] },
          { ...pr, id: 3, number: 3, pull_request: {} },
        ];
      if (path.includes("/pulls?")) return [pr];
      if (path.includes("check-runs"))
        return [
          {
            id: 1,
            name: "CI",
            status: "completed",
            conclusion: "success",
            head_sha: "head-1",
            html_url: "https://github.com/owner/repo-1/actions/runs/1",
          },
        ];
      if (path.endsWith("/statuses")) return [];
      if (path.endsWith("/reviews"))
        return [
          {
            id: 9,
            user: { login: "reviewer" },
            state: "APPROVED",
            commit_id: "head-1",
          },
        ];
      if (path.endsWith("/actions/workflows")) return [];
      throw Error("unexpected_endpoint");
    },
    windowRuns: async () => [],
    file: async (_: string, path: string, sha: string) => {
      expect(sha).toBe("source-sha");
      return path === "README.md"
        ? { sha: "blob", text: "Canonical context" }
        : null;
    },
  };
  return { api, calls };
}
it("collects complete issue/PR inventory, pins checks/docs and marks a moving PR head", async () => {
  const { api, calls } = client();
  const result = await collectRepository(
    api,
    repo(),
    {},
    "2026-09-07T14:00:00Z",
  );
  expect(result.issues.map((i) => i.number)).toEqual([2]);
  expect(result.prs).toHaveLength(1);
  expect(result.gaps).toEqual([
    {
      repository: "owner/repo-1",
      area: "pr_2",
      code: "head_changed_during_scan",
    },
  ]);
  expect(calls.some((p) => p.includes("commits/head-1/check-runs"))).toBe(true);
  expect(result.docs[0].url).toContain("/source-sha/README.md");
});
it("denied endpoints preserve independent data and explicit coverage gaps", async () => {
  const { api } = client(["/issues?", "/pulls?"]);
  const result = await collectRepository(api, repo(), {
    docs: ["docs/missing.md"],
  });
  expect(result.docs).toHaveLength(1);
  expect(result.branches).toEqual(["main", "topic"]);
  expect(result.gaps.map((g) => g.area)).toEqual(["issues", "pulls", "docs"]);
  result.runs = [
    {
      id: 1,
      workflowId: 1,
      event: "pull_request",
      branch: "topic",
      status: "completed",
      conclusion: "failure",
      createdAt: "2026-09-07",
      name: "CI",
      pullNumbers: [2],
      url: "https://github.com/owner/repo-1/actions/runs/1",
    },
  ];
  result.gaps.push({ area: "workflows", code: "http_403" });
  expect((await classify(result))[0].state).toBe("active_failure");
});
