import { it, expect, vi } from "vitest";
import worker from "../src/index.ts";
import { testEnv } from "./helpers.ts";
const ctx = {} as ExecutionContext;
it("public health never exposes private reports, identifiers or recipients", async () => {
  const { env } = testEnv();
  env.FIRST_WEEKLY_SLOT = "weekly-2099-01-01-America-Denver";
  const response = await worker.fetch(
    new Request("https://scanner.invalid/health"),
    env as Env,
  );
  const text = await response.text();
  expect(text).not.toContain(env.DIGEST_TO_EMAIL);
  expect(text).not.toContain("repository");
  expect(text).not.toContain("message_id");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("all operator paths require the dedicated secret and private HTML downloads are inert attachments", async () => {
  const { env, objects } = testEnv();
  env.ADMIN_TOKEN = "synthetic-admin";
  objects.set("reports/manual-1/report.html", "<script>untrusted</script>");
  const url = "https://scanner.invalid/admin/reports/manual-1/report.html";
  expect((await worker.fetch(new Request(url), env as Env)).status).toBe(401);
  const response = await worker.fetch(
    new Request(url, { headers: { Authorization: "Bearer synthetic-admin" } }),
    env as Env,
  );
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("content-disposition")).toContain("attachment");
});
it("manual run defaults to preview and rejects injected recipients", async () => {
  const { env } = testEnv();
  env.ADMIN_TOKEN = "synthetic-admin";
  const create = vi.fn(async (_params: any) => ({}));
  env.SCAN = { create } as any;
  const request = (body: any) =>
    new Request("https://scanner.invalid/admin/runs", {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  expect((await worker.fetch(request({}), env as Env)).status).toBe(202);
  expect(create.mock.calls[0][0].params.send).toBe(false);
  expect(
    (
      await worker.fetch(
        request({ to: "attacker@example.invalid" }),
        env as Env,
      )
    ).status,
  ).toBe(400);
});
it("private policy publication is validated and has one atomic pointer", async () => {
  const { env, objects } = testEnv();
  env.ADMIN_TOKEN = "synthetic-admin";
  env.POLICY_SOURCE = "r2";
  const bad = new Request("https://scanner.invalid/admin/policy", {
    method: "PUT",
    headers: { Authorization: "Bearer synthetic-admin" },
    body: '{"selection":{"mode":"discover","mode":"selected"}}',
  });
  expect((await worker.fetch(bad, env as Env)).status).toBe(500);
  expect(objects.has("policy/current.json")).toBe(false);
});
