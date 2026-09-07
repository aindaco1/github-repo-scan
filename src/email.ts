import type { RuntimeEnv } from "./types.ts";
import { hash } from "./util.ts";
import type { renderReport } from "./report/render.ts";
import { indexDeliveredActions } from "./storage/notifications.ts";
type Rendered = ReturnType<typeof renderReport>;
export type DeliveryState =
  | "prepared"
  | "attempting"
  | "accepted"
  | "deferred"
  | "delivered"
  | "failed"
  | "bounced"
  | "rejected"
  | "ambiguous";
const terminalFailures = new Set(["failed", "bounced", "rejected"]);
export function deliveryTransition(current: string, incoming: string): string {
  if (terminalFailures.has(current)) return current;
  if (terminalFailures.has(incoming)) return incoming;
  if (current === "delivered") return current;
  if (incoming === "delivered") return incoming;
  if (incoming === "deferred") return incoming;
  if (current === "deferred") return current;
  return incoming;
}
export async function deliver(env: RuntimeEnv, id: string) {
  if (env.SEND_ENABLED !== "true") throw new Error("sending_disabled");
  const file = await env.REPORTS.get(`reports/${id}/email.json`);
  if (!file) throw new Error("frozen_email_missing");
  const bytes = await file.text(),
    rendered = JSON.parse(bytes) as Rendered;
  const manifest = await env.REPORTS.get(`reports/${id}/manifest.json`);
  if (!manifest) throw new Error("manifest_missing");
  const expected = await manifest.json<any>();
  const payloadHash = await hash(bytes);
  if (expected.files["email.json"].sha256 !== payloadHash)
    throw new Error("email_hash_mismatch");
  const recipientHash = await hash(env.DIGEST_TO_EMAIL.trim().toLowerCase());
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO deliveries (run_id,subject,recipient_hash,payload_hash,state,updated_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(id, rendered.subject, recipientHash, payloadHash, "prepared", now)
    .run();
  const row = await env.DB.prepare("SELECT * FROM deliveries WHERE run_id=?")
    .bind(id)
    .first<any>();
  if (row.payload_hash !== payloadHash || row.recipient_hash !== recipientHash)
    throw new Error("frozen_delivery_conflict");
  const claim = await env.DB.prepare(
    "UPDATE deliveries SET state='attempting',attempted_at=?,updated_at=? WHERE run_id=? AND state='prepared' RETURNING run_id",
  )
    .bind(now, now, id)
    .first();
  if (!claim) return { state: row.state, messageId: row.message_id };
  let messageId: string;
  try {
    const response = await env.EMAIL.send({
      to: env.DIGEST_TO_EMAIL,
      from: { email: env.DIGEST_FROM_EMAIL, name: env.DIGEST_FROM_NAME },
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: { "X-Dustwave-Automation": "github-repo-scan" },
      attachments: rendered.attachments.map((a) => ({
        filename: a.filename,
        // Binary content avoids the binding treating Base64 text as file bytes.
        content: new TextEncoder().encode(a.content),
        type: "text/markdown; charset=utf-8",
        disposition: "attachment" as const,
      })),
    });
    messageId = response.messageId;
    if (!messageId) throw new Error("provider_id_missing");
  } catch (error) {
    const reason = String((error as any)?.code ?? "");
    const known = [
      "E_VALIDATION_ERROR",
      "E_RECIPIENT_NOT_ALLOWED",
      "E_RECIPIENT_SUPPRESSED",
      "E_RATE_LIMIT_EXCEEDED",
    ].includes(reason);
    await env.DB.prepare(
      "UPDATE deliveries SET state=?,error_code=?,updated_at=? WHERE run_id=? AND state='attempting'",
    )
      .bind(
        known ? "failed" : "ambiguous",
        known ? reason : "provider_outcome_unknown",
        new Date().toISOString(),
        id,
      )
      .run();
    return { state: known ? "failed" : "ambiguous" };
  }
  // If a delivery event arrived first, preserve its terminal state and provider ID.
  await env.DB.prepare(
    "UPDATE deliveries SET message_id=COALESCE(message_id,?),state=CASE WHEN state='attempting' THEN 'accepted' ELSE state END,updated_at=? WHERE run_id=?",
  )
    .bind(messageId, new Date().toISOString(), id)
    .run();
  return { state: "accepted", messageId };
}
export function parseDeliveryEvent(
  body: any,
  env: Pick<
    RuntimeEnv,
    | "EMAIL_EVENT_ACCOUNT_ID"
    | "EMAIL_EVENT_SUBSCRIPTION_ID"
    | "EMAIL_EVENT_DOMAIN"
    | "DIGEST_TO_EMAIL"
    | "DIGEST_FROM_EMAIL"
  >,
) {
  if (
    !body ||
    body.source?.type !== "email.sending" ||
    body.source.domain !== env.EMAIL_EVENT_DOMAIN ||
    body.metadata?.accountId !== env.EMAIL_EVENT_ACCOUNT_ID ||
    body.metadata?.eventSubscriptionId !== env.EMAIL_EVENT_SUBSCRIPTION_ID
  )
    return null;
  const state = String(body.type ?? "").replace(
    "cf.email.sending.message.",
    "",
  );
  if (
    !["delivered", "deferred", "bounced", "failed", "rejected"].includes(state)
  )
    return null;
  const p = body.payload;
  if (
    !p ||
    p.sender !== env.DIGEST_FROM_EMAIL ||
    p.recipient !== env.DIGEST_TO_EMAIL ||
    typeof p.eventId !== "string" ||
    typeof p.messageId !== "string" ||
    typeof p.subject !== "string" ||
    !Number.isFinite(Date.parse(body.metadata.eventTimestamp))
  )
    return null;
  if (
    p.eventId.length > 200 ||
    p.messageId.length > 500 ||
    p.subject.length > 1000
  )
    throw new Error("event_size");
  return {
    id: p.eventId,
    messageId: p.messageId,
    subject: p.subject,
    state,
    at: body.metadata.eventTimestamp,
  };
}
export async function recordDeliveryEvent(env: RuntimeEnv, body: unknown) {
  const event = parseDeliveryEvent(body, env);
  if (!event) return;
  const delivery = await env.DB.prepare(
    "SELECT * FROM deliveries WHERE (message_id=? OR subject=?) AND attempted_at IS NOT NULL",
  )
    .bind(event.messageId, event.subject)
    .first<any>();
  if (!delivery) return; // Other consumers on the same sending domain are outside this scanner.
  if (delivery.message_id && delivery.message_id !== event.messageId)
    throw new Error("delivery_message_conflict");
  if (
    delivery.recipient_hash !==
    (await hash(env.DIGEST_TO_EMAIL.trim().toLowerCase()))
  )
    throw new Error("delivery_recipient_conflict");
  const state = deliveryTransition(delivery.state, event.state);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO email_events (id,message_id,type,occurred_at,run_id) VALUES (?,?,?,?,?)",
    ).bind(event.id, event.messageId, event.state, event.at, delivery.run_id),
    env.DB.prepare(
      "UPDATE deliveries SET message_id=COALESCE(message_id,?),state=CASE WHEN state IN ('failed','bounced','rejected') THEN state WHEN ? IN ('failed','bounced','rejected') THEN ? WHEN state='delivered' THEN state ELSE ? END,delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,?) ELSE delivered_at END,updated_at=? WHERE run_id=?",
    ).bind(
      event.messageId,
      event.state,
      event.state,
      state,
      event.state,
      event.at,
      event.at,
      delivery.run_id,
    ),
  ]);
  await indexDeliveredActions(env, delivery.run_id);
}
