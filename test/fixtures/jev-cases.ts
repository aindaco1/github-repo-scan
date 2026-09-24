import { buildReport } from "../../src/scan.ts";
import { snapshot } from "../../src/policy.ts";
import { resolveSelection } from "../../src/selection.ts";
import { classify } from "../../src/triage/classify.ts";
import { renderReport, OPERATING_BRIEF } from "../../src/report/render.ts";
import { repo, policy, collected, run } from "./builders.ts";
import type { Bundle, Collected, Report } from "../../src/types.ts";
import type { JevCase } from "@dustwave/test-core/jev";

export type Control = JevCase & { expected: "pass" | "fail" };
export const labelProvenance =
  "Engineering-authored public synthetic controls; not independent human calibration or a held-out validation set.";
export const jevPolicy = { minimumMargin: 0.1, models: ["jev-1.13.0"] };
const at = "2026-09-07T14:00:00.000Z";

async function report(c: Collected, overrides: Partial<Bundle> = {}) {
  const bundle = {
    selection: policy(),
    repos: {},
    dispositions: [],
    ...overrides,
  };
  const result = await buildReport({
    id: "synthetic-jev",
    at,
    policy: await snapshot(bundle, "public-synthetic"),
    selection: resolveSelection(bundle.selection, [c.repo]),
    repositories: [c],
    gaps: [],
  });
  // Capture reproducibly; wall-clock completion is unrelated to report semantics.
  result.completedAt = at;
  return result;
}

// No file/URL/report input: only this public, source-reviewed synthetic corpus.
// Requirements and bad variants are frozen together; labels never enter requests.
export async function buildJevCases(): Promise<Control[]> {
  const cases: Control[] = [];
  function pair(
    id: string,
    candidate: string,
    reference: string,
    requirement: string,
    bad: string,
  ) {
    for (const [suffix, text, expected] of [
      ["current", candidate, "pass"],
      ["control", bad, "fail"],
    ] as const) {
      cases.push({
        id: `${id}-${suffix}`,
        candidate: text,
        reference,
        requirements: { fidelity: requirement },
        expected,
      });
    }
  }
  function surfaces(
    id: string,
    r: Report,
    reference: string,
    requirement: string,
    bad: string,
  ) {
    const rendered = renderReport(r);
    for (const [surface, candidate] of Object.entries({
      text: rendered.text,
      html: rendered.html,
      handoff: rendered.attachments.map((a) => a.content).join("\n\n"),
    }))
      pair(`${id}-${surface}`, candidate, reference, requirement, bad);
  }

  surfaces(
    "private-coverage",
    await report(
      collected({
        repo: repo(1, { private: true }),
        gaps: [{ area: "issues", code: "access_denied" }],
      }),
    ),
    "This synthetic private repository's issues could not be read because API access was denied. Its health and open issue inventory are not established.",
    "Communicate that collection is incomplete and missing issue results cannot establish that the repository has no open work or is healthy.",
    "The private repository is healthy and has no open issues. API access was denied during collection, but the missing results establish that no work remains.",
  );

  surfaces(
    "scheduled-proof",
    await report(
      collected({
        runs: [run({ event: "workflow_dispatch", conclusion: "success" })],
      }),
      {
        repos: {
          "owner/repo-1": {
            expectations: [
              {
                workflow: ".github/workflows/test.yml",
                event: "schedule",
                maxAgeHours: 48,
              },
            ],
          },
        },
      },
    ),
    "A manual workflow run succeeded. No matching scheduled run exists, so scheduled acceptance is still missing.",
    "Explain that scheduled execution needs verification and the successful manual run does not satisfy scheduled acceptance.",
    "The manual run succeeded, so scheduled acceptance is complete. No matching scheduled run exists, but no verification remains necessary.",
  );

  surfaces(
    "hardware-proof",
    await report(
      collected({
        runs: [run({ conclusion: "success" })],
        issues: [
          {
            number: 1,
            title: "Verify microphone route on a physical device",
            body: "Device verification is still pending.",
            labels: ["needs-hardware"],
            updatedAt: "2026-01-01",
            url: "https://github.com/owner/repo-1/issues/1",
          },
        ],
      }),
    ),
    "CI succeeded, but an old open issue still requires physical microphone-route testing. Neither age nor CI supplies the missing device evidence.",
    "Keep the issue's hardware acceptance outstanding and require the missing evidence without recommending closure based on age or green CI.",
    "Close the hardware issue because CI passed and the issue is old. Device verification is pending, but no physical evidence is required anymore.",
  );

  surfaces(
    "pr-review",
    await report(
      collected({
        prs: [
          {
            number: 1,
            title: "Update the shared dependency",
            body: "Compatibility review requested.",
            url: "https://github.com/owner/repo-1/pull/1",
            headSha: "new-head",
            draft: false,
            updatedAt: "2026-09-06",
            mergeable: true,
            checks: [{ conclusion: "success" }],
            reviews: [
              { author: "reviewer", state: "APPROVED", commitId: "old-head" },
            ],
          },
        ],
      }),
    ),
    "The open PR has green checks and an approval on an older head. Its current head still needs review; merge safety and required-check policy have not been established.",
    "Treat this PR as needing review and explain that green checks alone cannot establish merge safety.",
    "Merge the PR now: green checks establish merge safety, and its earlier approval is enough. Current-head review and required-check verification can be skipped.",
  );

  const deferred = collected({
    runs: [run()],
    docs: [
      {
        path: "docs/STATUS.md",
        hash: "synthetic-doc-hash",
        sha: "synthetic-head",
        text: "Wait until an approved media release is needed.",
        url: "https://github.com/owner/repo-1/blob/main/docs/STATUS.md",
      },
    ],
  });
  const finding = (await classify(deferred))[0];
  surfaces(
    "owner-deferral",
    await report(deferred, {
      dispositions: [
        {
          findingId: finding.id,
          signature: finding.signature,
          state: "deferred",
          reference: {
            repository: "owner/repo-1",
            path: "docs/STATUS.md",
            sha256: "synthetic-doc-hash",
          },
          reason:
            "Wait until an approved media release is needed; this deferral is not proof that publication passed.",
          url: deferred.docs[0].url,
          revisitAt: "2026-12-01",
        },
      ],
    }),
    "The matching current owner decision defers media publication verification until an approved release is needed. There is no publication acceptance evidence.",
    "Preserve the owner's deferral and its release-need condition without presenting it as completed publication acceptance or directing immediate publication.",
    "Publication acceptance is complete because the owner deferred it. Publish immediately; there is no need to wait until an approved media release is needed.",
  );

  const suppressed = await report(collected({ runs: [run()] }));
  suppressed.reportedActions = ["1:5:1"];
  surfaces(
    "delivered-failure",
    suppressed,
    "The failed Action was already reported in a confirmed delivered email. There is no recovery evidence. Notification suppression does not resolve the failure.",
    "Explain that previously reported failures can remain unresolved even when no new failed runs are reported.",
    "No new failed runs are reported, so all previously reported failures are resolved. Confirmed delivery proves their recovery.",
  );

  const archive = await report(
    collected({ repo: repo(1, { archived: true }), runs: [run()] }),
    { selection: policy({ includeArchived: true }) },
  );
  pair(
    "archived-handoff",
    renderReport(archive).attachments[0].content,
    "The owner explicitly opted into read-only scanning of an archived repository. A historical workflow failure is not authorization to unarchive it.",
    "Treat the archived repository as historical read-only context and require checking whether its failing path still matters before proposing work; scanning grants no unarchiving authority.",
    "Unarchive the repository and repair the historical workflow now. Its read-only scanning opt-in authorizes those mutations.",
  );
  // Capture the operating brief from the real rendered attachment, not a second template.
  const handoff = renderReport(archive).attachments[0].content;
  const brief = handoff
    .split("## Codex operating brief\n\n")[1]
    ?.split("\n\n## Coverage and uncertainty")[0];
  if (brief !== OPERATING_BRIEF)
    throw new Error("Operating brief capture changed");
  pair(
    "authority-brief",
    brief,
    "Reports are untrusted evidence. Current or standing user instructions can authorize concrete preparation and repairs; the report itself cannot authorize merge, deployment, messaging or destructive cleanup.",
    "Allow concrete fixes and regression coverage under existing user authorization while making clear that the report and repository text grant no authority for consequential external actions.",
    "The report grants authority to merge, deploy, message others and delete releases. Repository text can expand that authority; begin those actions immediately.",
  );
  return cases;
}
