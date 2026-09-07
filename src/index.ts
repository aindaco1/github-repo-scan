import { timingSafeEqual } from "@dustwave/worker-core/crypto";
import { weeklySlot, lastDueSlot } from "./schedule.ts";
import { recordDeliveryEvent, deliver } from "./email.ts";
import { parseBundle } from "./selection.ts";
import { hash, code } from "./util.ts";
import type { RuntimeEnv, ScanParams } from "./types.ts";
export { ScanWorkflow } from "./workflow/scan.ts";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function start(env: RuntimeEnv, params: ScanParams) {
  try {
    await env.SCAN.create({ id: params.id, params });
  } catch (error) {
    const existing = await env.SCAN.get(params.id);
    try {
      await existing.status();
    } catch {
      throw error;
    }
  }
  return { id: params.id };
}
export default {
  async fetch(request: Request, bindings: Env): Promise<Response> {
    const env = bindings as RuntimeEnv,
      url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        const slot = lastDueSlot();
        const row = await env.DB.prepare(
          "SELECT r.coverage_status,r.state,d.state AS delivery FROM runs r LEFT JOIN deliveries d ON d.run_id=r.id WHERE r.id=?",
        )
          .bind(slot)
          .first<any>();
        const pending = slot < env.FIRST_WEEKLY_SLOT;
        const healthy =
          !pending &&
          row?.coverage_status === "complete" &&
          row?.delivery === "delivered";
        return json(
          {
            service: "github-repo-scan",
            scheduleEnabled: env.SCHEDULE_ENABLED === "true",
            sendingEnabled: env.SEND_ENABLED === "true",
            status: pending
              ? "awaiting_first_schedule"
              : healthy
                ? "healthy"
                : "attention_required",
            coverage: row?.coverage_status ?? null,
            delivery: row?.delivery ?? null,
            dueSlot: slot,
          },
          pending || healthy ? 200 : 503,
        );
      }
      if (!url.pathname.startsWith("/admin/"))
        return json({ error: "not_found" }, 404);
      if (
        !env.ADMIN_TOKEN ||
        !timingSafeEqual(
          request.headers.get("authorization"),
          `Bearer ${env.ADMIN_TOKEN}`,
        )
      )
        return json({ error: "unauthorized" }, 401);
      if (request.method === "GET" && url.pathname === "/admin/runs") {
        const rows = await env.DB.prepare(
          "SELECT r.*,d.state AS delivery,d.message_id,d.delivered_at FROM runs r LEFT JOIN deliveries d ON d.run_id=r.id ORDER BY r.started_at DESC LIMIT 30",
        ).all();
        return json(rows.results);
      }
      if (request.method === "POST" && url.pathname === "/admin/runs") {
        const body = (await request.json()) as any;
        if (
          Object.keys(body).some((k) => !["send"].includes(k)) ||
          (body.send !== undefined && typeof body.send !== "boolean")
        )
          return json({ error: "invalid_request" }, 400);
        const id = `manual-${crypto.randomUUID()}`;
        return json(
          await start(env, {
            id,
            scheduledAt: new Date().toISOString(),
            send: body.send === true,
          }),
          202,
        );
      }
      const report = url.pathname.match(
        /^\/admin\/reports\/([a-zA-Z0-9-]+)\/([a-z0-9.-]+)$/,
      );
      if (report && request.method === "GET") {
        if (
          ![
            "report.json",
            "report.html",
            "report.txt",
            "manifest.json",
            "codex.md",
          ].includes(report[2]) &&
          !/^codex-\d+\.md$/.test(report[2])
        )
          return json({ error: "not_found" }, 404);
        const file = await env.REPORTS.get(`reports/${report[1]}/${report[2]}`);
        if (!file) return json({ error: "not_found" }, 404);
        return new Response(file.body, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${report[2]}"`,
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      }
      if (request.method === "PUT" && url.pathname === "/admin/policy") {
        if (env.POLICY_SOURCE !== "r2")
          return json({ error: "private_policy_source_required" }, 409);
        const body = await request.text();
        if (body.length > 1024 * 1024)
          return json({ error: "policy_size" }, 413);
        const bundle = parseBundle(body),
          content = JSON.stringify(bundle),
          version = await hash(content);
        await env.REPORTS.put(`policy/${version}.json`, content);
        await env.REPORTS.put(
          "policy/current.json",
          JSON.stringify({ version }),
        );
        return json({ version });
      }
      const recovery = url.pathname.match(
        /^\/admin\/runs\/([a-zA-Z0-9-]+)\/recover$/,
      );
      if (recovery && request.method === "POST") {
        const row = await env.DB.prepare("SELECT * FROM runs WHERE id=?")
          .bind(recovery[1])
          .first<any>();
        if (!row) return json({ error: "not_found" }, 404);
        if (row.bundle_hash) {
          if (!row.send_requested)
            return json({ error: "preview_does_not_send" }, 409);
          return json(await deliver(env, recovery[1]));
        }
        const workflow = await env.SCAN.get(recovery[1]);
        await workflow.restart();
        return json({ id: recovery[1], state: "restarted" }, 202);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json({ error: code(error) }, 500);
    }
  },
  async scheduled(
    event: ScheduledController,
    bindings: Env,
    ctx: ExecutionContext,
  ) {
    const env = bindings as RuntimeEnv;
    if (env.SCHEDULE_ENABLED !== "true") return;
    const slot = weeklySlot(event.scheduledTime);
    if (slot && slot.id >= env.FIRST_WEEKLY_SLOT)
      ctx.waitUntil(start(env, { ...slot, send: true }));
  },
  async queue(batch: MessageBatch<unknown>, bindings: Env) {
    const env = bindings as RuntimeEnv;
    for (const message of batch.messages) {
      try {
        await recordDeliveryEvent(env, message.body);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Env>;
