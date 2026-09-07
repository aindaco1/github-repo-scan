import type { Report, RuntimeEnv } from "../types.ts";
import { hash } from "../util.ts";
import { renderBundle } from "../report/render.ts";
export async function freezeReport(env: RuntimeEnv, report: Report) {
  const existing = await env.DB.prepare(
    "SELECT bundle_hash FROM runs WHERE id=?",
  )
    .bind(report.id)
    .first<{ bundle_hash: string }>();
  if (existing?.bundle_hash) return;
  const files = await renderBundle(report);
  for (const [name, body] of Object.entries(files)) {
    const key = `reports/${report.id}/${name}`;
    const old = await env.REPORTS.get(key);
    if (old) {
      if ((await old.text()) !== body)
        throw new Error("frozen_report_conflict");
    } else
      await env.REPORTS.put(key, body, {
        httpMetadata: {
          contentType: name.endsWith(".json")
            ? "application/json"
            : name.endsWith(".html")
              ? "text/html"
              : "text/plain; charset=utf-8",
        },
      });
  }
  const statements = report.findings.map((f) =>
    env.DB.prepare(
      "INSERT INTO findings (id,repository_id,state,first_seen,last_seen,run_id,data) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,last_seen=excluded.last_seen,run_id=excluded.run_id,data=excluded.data",
    ).bind(
      f.id,
      f.repositoryId,
      f.state,
      f.firstSeen ?? f.observedAt,
      f.observedAt,
      report.id,
      JSON.stringify(f),
    ),
  );
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
  await env.DB.prepare(
    "UPDATE runs SET completed_at=?,state=?,policy_version=?,coverage_status=?,selected=?,scanned=?,private_scanned=?,bundle_hash=? WHERE id=?",
  )
    .bind(
      report.completedAt,
      "frozen",
      report.policy.version,
      report.coverage.status,
      report.coverage.selected,
      report.coverage.scanned,
      report.coverage.privateScanned,
      await hash(files["manifest.json"]),
      report.id,
    )
    .run();
}
export async function previousReport(
  env: RuntimeEnv,
  currentId: string,
): Promise<Report | undefined> {
  const row = await env.DB.prepare(
    "SELECT r.id FROM runs r JOIN deliveries d ON d.run_id=r.id WHERE r.id!=? AND r.bundle_hash IS NOT NULL AND d.state='delivered' ORDER BY r.completed_at DESC LIMIT 1",
  )
    .bind(currentId)
    .first<{ id: string }>();
  if (!row) return;
  const file = await env.REPORTS.get(`reports/${row.id}/report.json`);
  return file ? file.json<Report>() : undefined;
}
export async function cleanup(env: RuntimeEnv, now = new Date()) {
  const before = new Date(now.getTime() - 90 * 86400_000).toISOString();
  const old = await env.DB.prepare(
    "SELECT r.id FROM runs r LEFT JOIN deliveries d ON d.run_id=r.id WHERE r.completed_at<? AND r.bundle_hash IS NOT NULL AND (r.send_requested=0 OR d.state='delivered') LIMIT 20",
  )
    .bind(before)
    .all<{ id: string }>();
  for (const row of old.results) {
    for (const prefix of [`reports/${row.id}/`, `checkpoints/${row.id}/`]) {
      let cursor: string | undefined;
      do {
        const list = await env.REPORTS.list({ prefix, cursor });
        if (list.objects.length)
          await env.REPORTS.delete(list.objects.map((o) => o.key));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
    await env.DB.prepare("UPDATE runs SET bundle_hash=NULL WHERE id=?")
      .bind(row.id)
      .run();
  }
  const year = new Date(now.getTime() - 365 * 86400_000).toISOString();
  await env.DB.prepare(
    "DELETE FROM findings WHERE state='resolved' AND last_seen<?",
  )
    .bind(year)
    .run();
  await env.DB.prepare(
    "DELETE FROM email_events WHERE occurred_at<? AND run_id IN (SELECT run_id FROM deliveries WHERE state=?)",
  )
    .bind(year, "delivered")
    .run();
  await env.DB.prepare(
    "DELETE FROM deliveries WHERE state='delivered' AND updated_at<?",
  )
    .bind(year)
    .run();
  await env.DB.prepare(
    "DELETE FROM runs WHERE completed_at<? AND state='frozen' AND bundle_hash IS NULL AND id NOT IN (SELECT run_id FROM deliveries)",
  )
    .bind(year)
    .run();
}
