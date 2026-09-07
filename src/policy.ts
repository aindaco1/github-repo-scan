import { parseBundle, resolveSelection } from "./selection.ts";
import { hash, encodeRepo, parseStrict } from "./util.ts";
import type {
  Bundle,
  PolicySnapshot,
  RuntimeEnv,
  Repo,
  Selection,
  Inventory,
  Gap,
} from "./types.ts";
import type { GitHubClient } from "./github/client.ts";
export async function snapshot(
  bundle: Bundle,
  version: string,
): Promise<PolicySnapshot> {
  const validated = parseBundle(bundle);
  return {
    version,
    hash: await hash(JSON.stringify(validated)),
    bundle: validated,
  };
}
export async function loadPolicy(
  env: RuntimeEnv,
  client: GitHubClient,
): Promise<PolicySnapshot> {
  if (env.POLICY_SOURCE === "r2") {
    const pointer = await env.REPORTS.get("policy/current.json");
    if (!pointer) throw new Error("private_policy_missing");
    const active = await pointer.json<{ version: string }>();
    if (!/^[a-f0-9]{64}$/.test(active.version))
      throw new Error("private_policy_version");
    const object = await env.REPORTS.get(`policy/${active.version}.json`);
    if (!object) throw new Error("private_policy_missing");
    const result = await snapshot(
      parseBundle(await object.text()),
      `r2:${active.version}`,
    );
    if (result.hash !== active.version) throw new Error("private_policy_hash");
    return result;
  }
  if (env.POLICY_SOURCE !== "github") throw new Error("invalid_policy_source");
  const name = env.CONTROL_REPOSITORY;
  const repo = await client.repo(name);
  const head = await client.get(
    name,
    `/repos/${encodeRepo(name)}/commits/${encodeURIComponent(repo.default_branch)}`,
    "policy_head",
  );
  const read = async (path: string) => {
    const value = await client.file(name, path, head.sha);
    if (!value) throw new Error("policy_file_missing");
    return parseStrict(value.text) as any;
  };
  return snapshot(
    {
      selection: await read("config/scan.json"),
      repos: await read("config/repos.json"),
      dispositions: await read("config/dispositions.json"),
    },
    `github:${head.sha}`,
  );
}
export function selectInventory(
  policy: PolicySnapshot,
  inventory: Inventory,
  expected: Repo[],
  previous: Selection[] = [],
): { selection: Selection[]; gaps: Gap[] } {
  const p = policy.bundle.selection;
  const accessible = new Map(inventory.repos.map((r) => [r.id, r]));
  const known = new Map(expected.map((r) => [r.id, r]));
  for (const old of previous) if (old.repo) known.set(old.repo.id, old.repo);
  for (const r of inventory.repos) known.set(r.id, r);
  const selection = resolveSelection(p, [...known.values()], previous);
  const gaps: Gap[] = [...inventory.gaps];
  for (const owner of p.mode === "discover" ? p.owners : []) {
    const installation = inventory.installations.find(
      (i) => i.account.login.toLowerCase() === owner,
    );
    if (!installation || installation.suspended_at)
      gaps.push({ area: "inventory", code: "configured_owner_inaccessible" });
    else if (installation.repository_selection !== "all")
      gaps.push({
        area: "inventory",
        code: "discovery_installation_restricted",
      });
  }
  for (const r of selection) {
    if (r.selected && !accessible.has(r.repositoryId!)) {
      r.selected = false;
      r.reason = "not_accessible";
      delete r.repo;
    }
    if (r.reason === "not_accessible")
      gaps.push({
        repository: r.repository,
        area: r.private ? "private_access" : "selection",
        code: r.private ? "expected_private_repo_missing" : "not_accessible",
      });
  }
  return { selection, gaps };
}
