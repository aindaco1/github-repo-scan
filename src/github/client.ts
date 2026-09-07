import { fetchWithTimeout } from "@dustwave/worker-core/provider-fetch";
import { encodeRepo } from "../util.ts";
import type { Installation, Inventory, Repo } from "../types.ts";
const origin = "https://api.github.com";
export class GitHubError extends Error {
  constructor(
    public status: number,
    public area: string,
  ) {
    super(`github_${status}:${area}`);
  }
}
const b64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export async function appJwt(
  id: string,
  pem: string,
  now = Date.now(),
): Promise<string> {
  const data = pem.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const enc = (v: unknown) => b64(new TextEncoder().encode(JSON.stringify(v)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540, iss: id })}`;
  return `${unsigned}.${b64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))))}`;
}
export type ClientOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deadline?: number;
  maxRequests?: number;
};
export class GitHubClient {
  requests = 0;
  private tokens = new Map<number, { token: string; expires: number }>();
  private installations: Installation[] = [];
  private repositoryIds = new Map<string, number>();
  private fetcher: typeof fetch;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  readonly deadline: number;
  private maxRequests: number;
  constructor(
    private appId: string,
    private pem: string,
    options: ClientOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.deadline = options.deadline ?? this.now() + 14 * 60_000;
    this.maxRequests = options.maxRequests ?? 8000;
  }
  async request(
    path: string,
    token: string,
    area: string,
    method = "GET",
  ): Promise<Response> {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password)
      throw new Error("github_origin_rejected");
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.now() >= this.deadline) throw new Error("scan_deadline");
      if (++this.requests > this.maxRequests)
        throw new Error("github_request_budget");
      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            method,
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "github-repo-scan",
              Authorization: `Bearer ${token}`,
            },
            redirect: "manual",
          },
          Math.max(1, Math.min(20_000, this.deadline - this.now())),
          { fetchTarget: this.fetcher },
        );
      } catch {
        if (attempt === 3) throw new Error("github_network");
        await this.pause(1000 * 2 ** attempt);
        continue;
      }
      if (response.ok || response.status === 302) return response;
      const rate =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.has("retry-after") ||
            response.headers.get("x-ratelimit-remaining") === "0"));
      if (attempt === 3 || (!rate && response.status < 500))
        throw new GitHubError(response.status, area);
      const retry = response.headers.get("retry-after");
      const retryMs = retry
        ? /^[\d.]+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - this.now()
        : 0;
      const reset = rate
        ? Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000 -
          this.now()
        : 0;
      await response.body?.cancel();
      await this.pause(Math.max(1000 * 2 ** attempt, retryMs || 0, reset || 0));
    }
    throw new Error("github_retry_exhausted");
  }
  private async pause(ms: number) {
    if (ms > 60_000 || this.now() + ms >= this.deadline)
      throw new Error("github_retry_after_deadline");
    await this.sleep(ms);
  }
  private async app(path: string): Promise<any> {
    return (
      await this.request(
        path,
        await appJwt(this.appId, this.pem, this.now()),
        "app",
      )
    ).json();
  }
  async installationToken(id: number): Promise<string> {
    const existing = this.tokens.get(id);
    if (existing && existing.expires > this.now() + 60_000)
      return existing.token;
    const token = (await (
      await this.request(
        `/app/installations/${id}/access_tokens`,
        await appJwt(this.appId, this.pem, this.now()),
        "token",
        "POST",
      )
    ).json()) as any;
    if (!token.token || !Number.isFinite(Date.parse(token.expires_at)))
      throw new Error("invalid_installation_token");
    this.tokens.set(id, {
      token: token.token,
      expires: Date.parse(token.expires_at),
    });
    return token.token;
  }
  setRepositories(repos: Repo[]) {
    for (const repo of repos)
      this.repositoryIds.set(repo.full_name.toLowerCase(), repo.id);
  }
  setInstallations(items: Installation[]) {
    this.installations = items;
  }
  private installation(name: string) {
    const login = name.split("/")[0].toLowerCase();
    const found = this.installations.find(
      (i) => i.account.login.toLowerCase() === login && !i.suspended_at,
    );
    if (!found) throw new Error("installation_unavailable");
    return found.id;
  }
  async raw(name: string, path: string, area = "read"): Promise<Response> {
    const id = this.installation(name);
    try {
      return await this.request(path, await this.installationToken(id), area);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 401) {
        this.tokens.delete(id);
        return this.request(path, await this.installationToken(id), area);
      }
      throw e;
    }
  }
  async get(name: string, path: string, area = "read"): Promise<any> {
    return (await this.raw(name, path, area)).json();
  }
  async pages(name: string, path: string, key?: string): Promise<any[]> {
    const all: any[] = [];
    let next = new URL(path, origin);
    next.searchParams.set("per_page", "100");
    const visited = new Set();
    while (true) {
      if (visited.has(next.href)) throw new Error("pagination_cycle");
      visited.add(next.href);
      const response = await this.raw(name, next.href, "pagination");
      const data = (await response.json()) as any;
      const values = key ? data[key] : data;
      if (!Array.isArray(values)) throw new Error("invalid_github_page");
      all.push(...values);
      const link = response.headers
        .get("link")
        ?.match(/<([^>]+)>;\s*rel="next"/);
      if (!link) break;
      const candidate = new URL(link[1]);
      const original = new URL(path, origin);
      const id = this.repositoryIds.get(name.toLowerCase());
      const prefix = `/repos/${encodeRepo(name)}`;
      const canonical =
        id && original.pathname.startsWith(prefix + "/")
          ? `/repositories/${id}${original.pathname.slice(prefix.length)}`
          : original.pathname;
      if (
        candidate.origin !== origin ||
        ![original.pathname, canonical].includes(candidate.pathname)
      )
        throw new Error("pagination_origin");
      for (const [key, value] of original.searchParams)
        if (
          !["page", "per_page"].includes(key) &&
          candidate.searchParams.get(key) !== value
        )
          throw new Error("pagination_filter_changed");
      next = candidate;
    }
    return [...new Map(all.map((v, i) => [v.id ?? i, v])).values()];
  }
  async inventory(): Promise<Inventory> {
    const installations: Installation[] = [];
    for (let page = 1; page <= 100; page++) {
      const list = await this.app(
        `/app/installations?per_page=100&page=${page}`,
      );
      if (!Array.isArray(list)) throw new Error("invalid_installations");
      installations.push(...list);
      if (list.length < 100) break;
      if (page === 100) throw new Error("installation_pagination_budget");
    }
    this.installations = installations;
    const repos: Repo[] = [],
      gaps: Inventory["gaps"] = [];
    for (const installation of installations) {
      if (installation.suspended_at) {
        gaps.push({ area: "inventory", code: "installation_suspended" });
        continue;
      }
      if (Object.values(installation.permissions).some((v) => v === "write"))
        throw new Error("app_write_permissions_rejected");
      try {
        repos.push(
          ...(await this.pages(
            installation.account.login,
            "/installation/repositories",
            "repositories",
          )),
        );
      } catch {
        gaps.push({ area: "inventory", code: "installation_inventory_failed" });
      }
    }
    this.setRepositories(repos);
    return {
      repos: [...new Map(repos.map((r) => [r.id, r])).values()],
      installations,
      gaps,
    };
  }
  async repo(name: string): Promise<Repo> {
    const repo = await this.get(name, `/repos/${encodeRepo(name)}`, "metadata");
    this.setRepositories([repo]);
    return repo;
  }
  async file(
    name: string,
    path: string,
    ref: string,
  ): Promise<{ text: string; sha: string } | null> {
    try {
      const data = await this.get(
        name,
        `/repos/${encodeRepo(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
        "contents",
      );
      if (
        data.type !== "file" ||
        data.encoding !== "base64" ||
        data.size > 256 * 1024
      )
        throw new Error("unsupported_document");
      return {
        text: new TextDecoder().decode(
          Uint8Array.from(atob(data.content.replace(/\s/g, "")), (c) =>
            c.charCodeAt(0),
          ),
        ),
        sha: data.sha,
      };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }
  async windowRuns(name: string, from: Date, to: Date): Promise<any[]> {
    const start = Math.floor(from.getTime() / 1000),
      end = Math.floor(to.getTime() / 1000);
    const read = async (a: number, b: number): Promise<any[]> => {
      const iso = (n: number) =>
        new Date(n * 1000).toISOString().replace(".000", "");
      const path = `/repos/${encodeRepo(name)}/actions/runs?created=${encodeURIComponent(`${iso(a)}..${iso(b)}`)}`;
      const probe = await this.get(name, path + "&per_page=1", "runs");
      if (
        !Number.isInteger(probe.total_count) ||
        !Array.isArray(probe.workflow_runs)
      )
        throw new Error("invalid_run_count");
      if (probe.total_count >= 1000) {
        if (a >= b) throw new Error("run_window_saturated");
        const middle = Math.floor((a + b) / 2);
        return [...(await read(a, middle)), ...(await read(middle + 1, b))];
      }
      const values = await this.pages(name, path, "workflow_runs");
      if (values.length < probe.total_count)
        throw new Error("run_pagination_changed");
      return values;
    };
    return [
      ...new Map(
        (await read(start, end)).map((r) => [`${r.id}:${r.run_attempt}`, r]),
      ).values(),
    ];
  }
}
