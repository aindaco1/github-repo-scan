import { it, expect } from "vitest";
import { buildReport } from "../src/scan.ts";
import { snapshot } from "../src/policy.ts";
import { resolveSelection } from "../src/selection.ts";
import { renderReport } from "../src/report/render.ts";
import { visibleFindings } from "../src/report/notifications.ts";
import { reportedActionKeys } from "../src/storage/notifications.ts";
import { freezeReport, cleanup } from "../src/storage/database.ts";
import { deliver, recordDeliveryEvent } from "../src/email.ts";
import { repo, policy, collected, run, testEnv, event } from "./helpers.ts";

async function report(runs = [run()]) {
  const r = repo();
  return buildReport({
    id: "manual-1",
    at: "2026-09-07T14:00:00Z",
    policy: await snapshot(
      { selection: policy(), repos: {}, dispositions: [] },
      "fixture",
    ),
    selection: resolveSelection(policy(), [r]),
    gaps: [],
    repositories: [
      collected({
        runs,
        issues: Array.from({ length: 12 }, (_, i) => ({
          number: i + 1,
          title: `Tracked issue ${i + 1}`,
          body: "Quoted issue data",
          url: `${r.html_url}/issues/${i + 1}`,
          labels: [],
          updatedAt: "2026-09-07",
        })),
        prs: [
          {
            number: 1,
            title: "Open PR stays visible",
            body: "PR context",
            url: `${r.html_url}/pull/1`,
            headSha: "current",
            reviews: [],
            checks: [],
            statuses: [],
            labels: [],
            updatedAt: "2026-09-07",
          },
        ],
      }),
    ],
  });
}

it("suppresses a delivered failed run in HTML, text and Markdown while keeping every open issue/PR", async () => {
  const r = await report();
  r.reportedActions = ["1:5:1"];
  r.findings.forEach((f) => {
    f.changed = false;
    // A reviewed resolution cannot hide an item that is still open on GitHub.
    if (f.kind === "issue") f.state = "resolved";
  });
  const output = renderReport(r);
  for (const body of [
    output.html,
    output.text,
    output.attachments[0].content,
  ]) {
    expect(body).not.toContain("/actions/runs/5");
    expect(body).toContain("Tracked issue 12");
    expect(body).toContain("Open PR stays visible");
  }
  expect(output.actionKeys).toEqual([]);
  expect(output.html).toContain("<h2");
  expect(output.html).toContain("<ul");
  expect(output.html).not.toMatch(
    /radar-card|radar-column|<table|border-radius/,
  );
  expect(output.attachments[0].content).toContain("2026-09-07T14:00:00Z");
  expect(output.attachments[0].content).toContain("## owner/repo-1");
  expect(output.attachments[0].content).not.toContain("repo\\-1");
  expect(r.findings.some((f) => f.kind === "actions")).toBe(true);
});

it("a new failed run or attempt is reportable; a changed recommendation or repo name is not", async () => {
  for (const current of [
    run({ id: 6, url: "https://github.com/owner/repo-1/actions/runs/6" }),
    run({ attempt: 2 }),
  ]) {
    const r = await report([current]);
    r.reportedActions = ["1:5:1"];
    expect(renderReport(r).actionKeys).toHaveLength(1);
  }
  const r = await report();
  r.reportedActions = ["1:5:1"];
  r.findings[0].recommendation = "Revised context";
  r.repositories[0].repo.full_name = "owner/renamed";
  expect(visibleFindings(r).filter((f) => f.kind === "actions")).toHaveLength(
    0,
  );
});

it("records receipts only after confirmed delivery and preserves them through retention and missing scans", async () => {
  const { env, sqlite, objects } = testEnv();
  const r = await report();
  await env.DB.prepare(
    "INSERT INTO runs(id,scheduled_at,started_at,send_requested) VALUES (?,?,?,1)",
  )
    .bind(r.id, r.observedAt, r.observedAt)
    .run();
  await freezeReport(env, r);
  expect(await reportedActionKeys(env)).toEqual([]); // Frozen preview is not receipt.
  await deliver(env, r.id);
  expect(await reportedActionKeys(env)).toEqual([]); // Provider acceptance is not receipt.
  const sent = JSON.parse(objects.get(`reports/${r.id}/email.json`)!);
  const delivered = event({
    payload: { ...event().payload, subject: sent.subject },
  });
  await recordDeliveryEvent(env, delivered);
  await recordDeliveryEvent(env, delivered);
  expect(await reportedActionKeys(env)).toEqual(["1:5:1"]);
  sqlite.exec(
    "UPDATE runs SET completed_at='2024-01-01'; UPDATE deliveries SET updated_at='2024-01-01'",
  );
  await cleanup(env, new Date("2026-09-07"));
  expect(objects.has(`reports/${r.id}/report.json`)).toBe(false);
  expect(
    sqlite.prepare("SELECT count(*) AS n FROM deliveries").get(),
  ).toMatchObject({ n: 0 });
  const next = await report();
  next.reportedActions = await reportedActionKeys(env);
  next.coverage.gaps.push({ area: "inventory", code: "partial_previous_scan" });
  expect(renderReport(next).actionKeys).toEqual([]);
});

it("backfills existing delivered attachments once without counting failed, ambiguous or preview reports", async () => {
  const { env, objects } = testEnv();
  const r = await report();
  for (const state of ["delivered", "failed", "ambiguous"] as const) {
    const id = state;
    await env.DB.prepare(
      "INSERT INTO runs(id,scheduled_at,started_at) VALUES (?,?,?)",
    )
      .bind(id, r.observedAt, r.observedAt)
      .run();
    const legacy = { ...renderReport(r) } as any;
    delete legacy.actionKeys;
    objects.set(`reports/${id}/email.json`, JSON.stringify(legacy));
    const unique =
      state === "delivered"
        ? r
        : await report([
            run({
              id: 7,
              url: "https://github.com/owner/repo-1/actions/runs/7",
            }),
          ]);
    objects.set(`reports/${id}/report.json`, JSON.stringify(unique));
    await env.DB.prepare(
      "INSERT INTO deliveries(run_id,subject,recipient_hash,payload_hash,state,updated_at,delivered_at) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(id, id, "recipient", "hash", state, r.observedAt, r.observedAt)
      .run();
  }
  expect(await reportedActionKeys(env)).toEqual(["1:5:1"]);
  objects.clear(); // Indexed receipts no longer depend on R2.
  expect(await reportedActionKeys(env)).toEqual(["1:5:1"]);
});
