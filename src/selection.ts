import validate from "./generated/selection.js";
import type { Policy, Repo, Selection, Bundle } from "./types.ts";
import { lower, parseStrict, safePath } from "./util.ts";
export function parsePolicy(input: unknown): Policy {
  const value = typeof input === "string" ? parseStrict(input) : input;
  if (!validate(value)) throw new Error("invalid_selection_schema");
  const p = structuredClone(value) as Policy;
  p.owners = p.owners.map(lower);
  p.include = p.include.map(lower);
  p.exclude = p.exclude.map(lower);
  for (const list of [p.owners, p.include, p.exclude])
    if (new Set(list).size !== list.length)
      throw new Error("duplicate_selection_identity");
  const overrides: Policy["overrides"] = {};
  for (const [key, value] of Object.entries(p.overrides)) {
    if (overrides[lower(key)]) throw new Error("duplicate_override_identity");
    overrides[lower(key)] = value;
  }
  p.overrides = overrides;
  return p;
}
export function parseBundle(value: unknown): Bundle {
  const b = (typeof value === "string" ? parseStrict(value) : value) as Bundle;
  if (
    !b ||
    Object.keys(b).some(
      (k) => !["selection", "repos", "dispositions"].includes(k),
    ) ||
    !b.repos ||
    Array.isArray(b.repos) ||
    !Array.isArray(b.dispositions)
  )
    throw new Error("invalid_policy_bundle");
  b.selection = parsePolicy(b.selection);
  for (const [name, c] of Object.entries(b.repos)) {
    if (
      !/^[\w-]+\/[\w.-]+$/.test(name) ||
      name !== lower(name) ||
      !c ||
      Object.keys(c).some(
        (k) => !["docs", "expectations", "artifacts"].includes(k),
      )
    )
      throw new Error("invalid_repo_context");
    if (
      c.docs &&
      (!Array.isArray(c.docs) ||
        c.docs.some((p) => typeof p !== "string" || !safePath(p)))
    )
      throw new Error("invalid_context_path");
    for (const e of c.expectations ?? [])
      if (
        !safePath(e.workflow) ||
        !e.event ||
        !(e.maxAgeHours > 0) ||
        e.maxAgeHours > 8760
      )
        throw new Error("invalid_expectation");
    for (const a of c.artifacts ?? [])
      if (
        !["podcast", "scheduled-health"].includes(a.adapter) ||
        !safePath(a.workflow) ||
        !a.namePrefix ||
        !(a.maxAgeHours > 0) ||
        a.maxAgeHours > 8760 ||
        (a.entry && !safePath(a.entry))
      )
        throw new Error("invalid_artifact_policy");
  }
  for (const d of b.dispositions)
    if (
      !["resolved", "deferred"].includes(d.state) ||
      !d.findingId ||
      !d.signature ||
      !d.reference ||
      !safePath(d.reference.path) ||
      !/^https:\/\/github.com\//.test(d.url) ||
      !Number.isFinite(Date.parse(d.revisitAt))
    )
      throw new Error("invalid_disposition");
  return b;
}
export function resolveSelection(
  policy: Policy,
  repos: Repo[],
  previous: Selection[] = [],
): Selection[] {
  const byName = new Map(repos.map((r) => [lower(r.full_name), r]));
  const candidates = new Set(policy.include);
  if (policy.mode === "discover")
    for (const r of repos)
      if (policy.owners.includes(lower(r.owner.login)))
        candidates.add(lower(r.full_name));
  const excludedIds = new Set(
    previous
      .filter((r) => policy.exclude.includes(lower(r.repository)))
      .map((r) => r.repositoryId),
  );
  const result: Selection[] = [];
  for (const name of candidates) {
    const repo = byName.get(name);
    let reason = "";
    if (policy.exclude.includes(name) || (repo && excludedIds.has(repo.id)))
      reason = "explicit_exclude";
    else if (!repo) reason = "not_accessible";
    else if (
      repo.archived &&
      !(policy.overrides[name]?.includeArchived ?? policy.includeArchived)
    )
      reason =
        policy.overrides[name]?.includeArchived === false
          ? "archived_override"
          : "archived_default";
    else if (
      repo.fork &&
      !(policy.overrides[name]?.includeForks ?? policy.includeForks)
    )
      reason = "fork_filter";
    const selected = !reason;
    result.push({
      repository: repo?.full_name ?? name,
      repositoryId: repo?.id,
      selected,
      reason:
        reason ||
        (policy.include.includes(name)
          ? "explicit_include"
          : "owner_discovery"),
      private: repo?.private,
      archived: repo?.archived,
      fork: repo?.fork,
      ...(repo ? { repo } : {}),
    });
  }
  for (const name of Object.keys(policy.overrides))
    if (!candidates.has(name)) throw new Error("override_not_candidate");
  const seen = new Set<number>();
  return result
    .sort((a, b) => a.repository.localeCompare(b.repository))
    .filter((r) => {
      if (r.repositoryId === undefined) return true;
      if (seen.has(r.repositoryId)) return false;
      seen.add(r.repositoryId);
      return true;
    });
}
export function editPolicy(
  original: Policy,
  action: string,
  value: string,
  repo?: string,
  archived = false,
): Policy {
  const p = structuredClone(original),
    name = lower(repo ?? value);
  if (action === "add") {
    p.include = [...new Set([...p.include, name])];
    p.exclude = p.exclude.filter((r) => r !== name);
    if (archived)
      p.overrides[name] = { ...p.overrides[name], includeArchived: true };
  } else if (action === "remove") {
    p.exclude = [...new Set([...p.exclude, name])];
    p.include = p.include.filter((r) => r !== name);
    delete p.overrides[name];
  } else if (action === "archived") {
    if (!["on", "off"].includes(value)) throw new Error("expected_on_or_off");
    if (repo)
      p.overrides[name] = {
        ...p.overrides[name],
        includeArchived: value === "on",
      };
    else p.includeArchived = value === "on";
  } else if (action === "mode") {
    p.mode = value as Policy["mode"];
  } else throw new Error("unknown_policy_action");
  return parsePolicy(p);
}
