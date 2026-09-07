import { it, expect, vi } from "vitest";
import { GitHubClient, GitHubError, appJwt } from "../src/github/client.ts";
import { generateKeyPairSync, createVerify } from "node:crypto";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const installation = {
  id: 1,
  account: { login: "owner" },
  repository_selection: "all" as const,
  permissions: { contents: "read" },
  suspended_at: null,
};
function api(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
  options: any = {},
) {
  const fetcher = vi.fn(async (input: any, init: any) => {
    const url = new URL(input);
    if (url.pathname === "/app/installations/1/access_tokens")
      return Response.json({
        token: "synthetic",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    return handler(url, init);
  });
  const client = new GitHubClient("123", pem, {
    fetcher: fetcher as typeof fetch,
    ...options,
  });
  client.setInstallations([installation]);
  return { client, fetcher };
}
it("signs short-lived App JWT with clock skew allowance", async () => {
  const token = await appJwt("123", pem, 1_000_000);
  const [header, payload, sig] = token.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(data).toEqual({ iat: 940, exp: 1540, iss: "123" });
  expect(
    createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(sig, "base64url")),
  ).toBe(true);
});
it("paginates beyond 100 and deduplicates changing pages", async () => {
  const { client } = api((url) =>
    url.searchParams.has("page")
      ? Response.json([{ id: 100 }, { id: 101 }])
      : Response.json(
          Array.from({ length: 100 }, (_, id) => ({ id: id + 1 })),
          {
            headers: {
              link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next"',
            },
          },
        ),
  );
  expect(
    await client.pages("owner/repo", "/repos/owner/repo/issues"),
  ).toHaveLength(101);
});
it("never forwards GitHub credentials onto a malicious pagination link", async () => {
  const { client, fetcher } = api(() =>
    Response.json([], {
      headers: { link: '<https://evil.invalid/x>; rel="next"' },
    }),
  );
  await expect(
    client.pages("owner/repo", "/repos/owner/repo/issues"),
  ).rejects.toThrow("pagination_origin");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("refreshes an expired installation token once on 401", async () => {
  let first = true;
  const { client, fetcher } = api(() => {
    if (first) {
      first = false;
      return new Response("", { status: 401 });
    }
    return Response.json({ ok: true });
  });
  expect(await client.get("owner/repo", "/repos/owner/repo")).toEqual({
    ok: true,
  });
  expect(
    fetcher.mock.calls.filter(([u]) => String(u).includes("/access_tokens")),
  ).toHaveLength(2);
});
it("handles temporary 503 with bounded retries and Retry-After", async () => {
  const sleep = vi.fn(async () => {});
  let attempts = 0;
  const { client } = api(
    () =>
      ++attempts < 3
        ? new Response("", { status: 503, headers: { "retry-after": "2" } })
        : Response.json({ ok: true }),
    { sleep },
  );
  await client.get("owner/repo", "/repos/owner/repo");
  expect(sleep.mock.calls.map((c: any) => c[0])).toEqual([2000, 2000]);
});
it("rate limit beyond deadline yields an explicit gap instead of hammering", async () => {
  const { client, fetcher } = api(
    () => new Response("", { status: 429, headers: { "retry-after": "500" } }),
  );
  await expect(client.get("owner/repo", "/repos/owner/repo")).rejects.toThrow(
    "github_retry_after_deadline",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("subdivides a saturated run window and stops at one-second saturation", async () => {
  const { client } = api((url) => {
    const range = url.searchParams.get("created")!;
    const [a, b] = range.split("..");
    const wide = Date.parse(b) - Date.parse(a) > 1000;
    return Response.json({
      total_count: wide ? 1000 : 1,
      workflow_runs: [{ id: Date.parse(a), run_attempt: 1 }],
    });
  });
  const values = await client.windowRuns(
    "owner/repo",
    new Date(0),
    new Date(3000),
  );
  expect(values).toHaveLength(2);
  const saturated = api(() =>
    Response.json({ total_count: 1000, workflow_runs: [] }),
  );
  await expect(
    saturated.client.windowRuns("owner/repo", new Date(0), new Date(0)),
  ).rejects.toThrow("run_window_saturated");
});
it("private 404 is not converted to a deleted/empty repository", async () => {
  const { client } = api(() => new Response("", { status: 404 }));
  await expect(client.repo("owner/private")).rejects.toBeInstanceOf(
    GitHubError,
  );
});
it("follows GitHub numeric canonical pagination only for the verified repository ID", async () => {
  const { client } = api((url) =>
    url.pathname.startsWith("/repositories/")
      ? Response.json([{ id: 2 }])
      : Response.json([{ id: 1 }], {
          headers: {
            link: '<https://api.github.com/repositories/42/actions/runs?created=2026-01-01&page=2>; rel="next"',
          },
        }),
  );
  client.setRepositories([{ id: 42, full_name: "owner/repo" } as any]);
  expect(
    await client.pages(
      "owner/repo",
      "/repos/owner/repo/actions/runs?created=2026-01-01",
    ),
  ).toHaveLength(2);
  const bad = api(() =>
    Response.json([], {
      headers: {
        link: '<https://api.github.com/repositories/99/actions/runs?page=2>; rel="next"',
      },
    }),
  );
  bad.client.setRepositories([{ id: 42, full_name: "owner/repo" } as any]);
  await expect(
    bad.client.pages("owner/repo", "/repos/owner/repo/actions/runs"),
  ).rejects.toThrow("pagination_origin");
});
