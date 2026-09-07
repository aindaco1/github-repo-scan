import type { Report, RuntimeEnv } from "../types.ts";
import { actionKeys } from "../report/notifications.ts";

export async function indexDeliveredActions(env: RuntimeEnv, id?: string) {
  const rows = await env.DB.prepare(
    "SELECT run_id,delivered_at FROM deliveries WHERE state='delivered' AND actions_indexed=0" +
      (id ? " AND run_id=?" : ""),
  )
    .bind(...(id ? [id] : []))
    .all<{ run_id: string; delivered_at: string }>();
  for (const row of rows.results) {
    const file = await env.REPORTS.get(`reports/${row.run_id}/email.json`);
    if (!file) throw new Error("delivered_notification_history_missing");
    const email = await file.json<{ actionKeys?: string[] }>();
    let keys = email.actionKeys;
    if (!keys) {
      // Before receipts existed, every finding was included in the attachment.
      const old = await env.REPORTS.get(`reports/${row.run_id}/report.json`);
      if (!old) throw new Error("delivered_notification_history_missing");
      const report = await old.json<Report>();
      keys = report.findings.flatMap((f) => actionKeys(report, f));
    }
    const statements = [...new Set(keys)].map((key) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO reported_actions(action_key,delivered_at) VALUES (?,?)",
      ).bind(key, row.delivered_at),
    );
    for (let i = 0; i < statements.length; i += 50)
      await env.DB.batch(statements.slice(i, i + 50));
    await env.DB.prepare(
      "UPDATE deliveries SET actions_indexed=1 WHERE run_id=?",
    )
      .bind(row.run_id)
      .run();
  }
}

export async function reportedActionKeys(env: RuntimeEnv): Promise<string[]> {
  await indexDeliveredActions(env);
  const rows = await env.DB.prepare(
    "SELECT action_key FROM reported_actions",
  ).all<{ action_key: string }>();
  return rows.results.map((row) => row.action_key);
}
