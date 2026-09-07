import { it, expect } from "vitest";
import { classify } from "../src/triage/classify.ts";
import { collected, run, repo } from "./helpers.ts";
it("only equivalent scope success resolves a failure", async () => {
  const c = collected({
    runs: [
      run(),
      run({
        id: 6,
        event: "workflow_dispatch",
        conclusion: "success",
        createdAt: "2026-09-07T00:00:00Z",
      }),
    ],
  });
  expect(
    (await classify(c)).find((f) => f.scope.includes(":push:"))?.state,
  ).toBe("active_failure");
  c.runs.push(
    run({ id: 7, conclusion: "success", createdAt: "2026-09-07T01:00:00Z" }),
  );
  expect(
    (await classify(c)).find((f) => f.scope.includes(":push:"))?.state,
  ).toBe("resolved");
});
it("a cancellation or skip does not erase the last failure", async () =>
  expect(
    (
      await classify(
        collected({
          runs: [
            run({
              id: 8,
              conclusion: "cancelled",
              createdAt: "2026-09-07T01:00:00Z",
            }),
            run(),
          ],
        }),
      )
    )[0].state,
  ).toBe("active_failure"));
it("retired/archived and closed-PR workflows are historical context", async () => {
  expect(
    (
      await classify(
        collected({ repo: repo(1, { archived: true }), runs: [run()] }),
      )
    )[0].priority,
  ).toBe("watch");
  expect(
    (
      await classify(
        collected({ runs: [run({ event: "pull_request", pullNumbers: [1] })] }),
      )
    )[0].priority,
  ).toBe("watch");
});
it("green monitoring job leaves launch acceptance independent", async () => {
  const result = await classify(
    collected({
      runs: [run({ conclusion: "success" })],
      artifacts: [
        {
          adapter: "podcast",
          workflow: ".github/workflows/readiness.yml",
          sha: "abc",
          url: run().url,
          at: run().createdAt,
          result: {
            platformReady: true,
            launchReady: false,
            nodes: [
              {
                id: "content",
                status: "DEFER",
                detail: "Needs approved media",
              },
            ],
          },
        },
      ],
    }),
  );
  expect(result[0].state).toBe("acceptance_gap");
  expect(result[0].validationGap).toContain("DEFER");
});
it("scheduled expectations do not accept manual runs and are suppressed for archives", async () => {
  const c = collected({
    runs: [run({ event: "workflow_dispatch", conclusion: "success" })],
  });
  const context = {
    expectations: [
      {
        workflow: ".github/workflows/test.yml",
        event: "schedule",
        maxAgeHours: 48,
      },
    ],
  };
  expect((await classify(c, context))[0].kind).toBe("schedule");
  c.repo.archived = true;
  expect(await classify(c, context)).toEqual([]);
});
it("open hardware issue remains an acceptance gap regardless of green CI", async () => {
  const result = await classify(
    collected({
      issues: [
        {
          number: 1,
          title: "Verify device",
          url: "https://github.com/owner/repo-1/issues/1",
          updatedAt: "2026-09-01",
          labels: ["needs-hardware"],
        },
      ],
    }),
  );
  expect(result[0].state).toBe("acceptance_gap");
  expect(result[0].recommendation).toContain("Age alone");
});
it("PR approvals only count on exact head and green is only a review candidate", async () => {
  const result = await classify(
    collected({
      prs: [
        {
          number: 1,
          title: "Change",
          url: "https://github.com/owner/repo-1/pull/1",
          headSha: "new",
          draft: false,
          updatedAt: "2026-09-06",
          mergeable: true,
          reviews: [{ author: "reviewer", state: "APPROVED", commitId: "old" }],
          checks: [{ conclusion: "success" }],
        },
      ],
    }),
  );
  expect(result[0].state).toBe("review_candidate");
  expect(result[0].recommendation).toContain("0 approval(s)");
  expect(result[0].validationGap).toContain("Required-check policy");
});
it("new evidence reopens a previously reviewed deferral", async () => {
  const c = collected({
    runs: [run()],
    docs: [
      {
        path: "docs/STATUS.md",
        hash: "doc",
        text: "",
        sha: "s",
        url: "https://github.com/owner/repo-1",
      },
    ],
  });
  const base = (await classify(c))[0];
  const disposition: any = {
    findingId: base.id,
    signature: base.signature,
    state: "deferred",
    reference: {
      repository: "owner/repo-1",
      path: "docs/STATUS.md",
      sha256: "doc",
    },
    reason: "Wait for provider",
    url: "https://github.com/owner/repo-1/blob/main/docs/STATUS.md",
    revisitAt: "2026-12-01",
  };
  expect((await classify(c, {}, [], [disposition]))[0].state).toBe("deferred");
  c.runs = [
    run({ id: 8, url: "https://github.com/owner/repo-1/actions/runs/8" }),
  ];
  expect((await classify(c, {}, [], [disposition]))[0].state).toBe(
    "active_failure",
  );
});
it("failures on removed development branches remain historical instead of active fleet breakages", async () => {
  const result = await classify(
    collected({
      branches: ["main"],
      runs: [run({ event: "push", branch: "old-feature" })],
    }),
  );
  expect(result[0].state).toBe("review_candidate");
  expect(result[0].priority).toBe("watch");
});
