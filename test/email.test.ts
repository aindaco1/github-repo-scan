import { it, expect, vi } from "vitest";
import {
  deliver,
  recordDeliveryEvent,
  deliveryTransition,
  parseDeliveryEvent,
} from "../src/email.ts";
import { hash } from "../src/util.ts";
import { testEnv, event } from "./helpers.ts";
async function prepared() {
  const state = testEnv();
  const { env, objects } = state;
  await env.DB.prepare(
    "INSERT INTO runs(id,scheduled_at,started_at) VALUES (?,?,?)",
  )
    .bind("manual-1", "2026-09-07", "2026-09-07")
    .run();
  const email = JSON.stringify({
    subject: "Subject",
    html: "<p>Report</p>",
    text: "Report",
    attachments: [
      { filename: "report.md", content: "# Report\nPrivate fixture" },
    ],
  });
  objects.set("reports/manual-1/email.json", email);
  objects.set(
    "reports/manual-1/manifest.json",
    JSON.stringify({ files: { "email.json": { sha256: await hash(email) } } }),
  );
  return state;
}
it("sends actual Markdown attachment and fixed identity exactly once on concurrent retries", async () => {
  const { env, sqlite } = await prepared();
  const send = vi.fn(async (_message: any) => ({ messageId: "email-1" }));
  env.EMAIL = { send } as any;
  await Promise.all([deliver(env, "manual-1"), deliver(env, "manual-1")]);
  expect(send).toHaveBeenCalledTimes(1);
  const message = send.mock.calls[0][0] as any;
  expect(Buffer.from(message.attachments[0].content, "base64").toString()).toBe(
    "# Report\nPrivate fixture",
  );
  expect(message.to).toBe(env.DIGEST_TO_EMAIL);
  expect(message.headers).toEqual({
    "X-Dustwave-Automation": "github-repo-scan",
  });
  expect(sqlite.prepare("SELECT state FROM deliveries").get()).toMatchObject({
    state: "accepted",
  });
});
it("ambiguous provider failure never sends again on recovery", async () => {
  const { env, sqlite } = await prepared();
  const send = vi.fn(async () => {
    throw new Error("timeout");
  });
  env.EMAIL = { send } as any;
  await deliver(env, "manual-1");
  await deliver(env, "manual-1");
  expect(send).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT state FROM deliveries").get()).toMatchObject({
    state: "ambiguous",
  });
});
it("an interrupted send claim is not automatically reclaimed", async () => {
  const { env, sqlite } = await prepared();
  env.EMAIL = {
    send: vi.fn(async () => {
      throw new Error("timeout");
    }),
  } as any;
  await deliver(env, "manual-1");
  sqlite.exec("UPDATE deliveries SET state='attempting'");
  await deliver(env, "manual-1");
  expect(env.EMAIL.send).toHaveBeenCalledTimes(1);
});
it("provider event before send response preserves delivered state", async () => {
  const { env, sqlite } = await prepared();
  env.EMAIL = {
    send: vi.fn(async () => {
      await recordDeliveryEvent(env, event());
      return { messageId: "email-1" };
    }),
  } as any;
  await deliver(env, "manual-1");
  expect(sqlite.prepare("SELECT state FROM deliveries").get()).toMatchObject({
    state: "delivered",
  });
});
it("reconciles ambiguous outcome by frozen subject and records events once", async () => {
  const { env, sqlite } = await prepared();
  env.EMAIL = {
    send: vi.fn(async () => {
      throw new Error("timeout");
    }),
  } as any;
  await deliver(env, "manual-1");
  await recordDeliveryEvent(env, event());
  await recordDeliveryEvent(env, event());
  expect(
    sqlite.prepare("SELECT state,message_id FROM deliveries").get(),
  ).toMatchObject({ state: "delivered", message_id: "email-1" });
  expect(
    sqlite.prepare("SELECT count(*) AS n FROM email_events").get(),
  ).toMatchObject({ n: 1 });
});
it("fails before sending if frozen bytes or recipient changes", async () => {
  const { env, objects } = await prepared();
  env.EMAIL = { send: vi.fn() } as any;
  objects.set("reports/manual-1/email.json", "{}");
  await expect(deliver(env, "manual-1")).rejects.toThrow("email_hash_mismatch");
  expect(env.EMAIL.send).not.toHaveBeenCalled();
});
it("does not apply another consumers events or untrusted source events", async () => {
  const { env } = await prepared();
  expect(
    parseDeliveryEvent(event({ metadata: { accountId: "other" } }), env),
  ).toBeNull();
  expect(
    parseDeliveryEvent(
      event({
        payload: { ...event().payload, recipient: "other@example.invalid" },
      }),
      env,
    ),
  ).toBeNull();
  expect(parseDeliveryEvent(event(), env)?.state).toBe("delivered");
});
it("failure is not overwritten by out-of-order sent/delivered events", () => {
  expect(deliveryTransition("bounced", "delivered")).toBe("bounced");
  expect(deliveryTransition("delivered", "accepted")).toBe("delivered");
  expect(deliveryTransition("accepted", "deferred")).toBe("deferred");
});
it("disabled sending never creates an outbox or provider call", async () => {
  const { env, sqlite } = await prepared();
  env.SEND_ENABLED = "false";
  await expect(deliver(env, "manual-1")).rejects.toThrow("sending_disabled");
  expect(
    sqlite.prepare("SELECT count(*) AS n FROM deliveries").get(),
  ).toMatchObject({ n: 0 });
});
