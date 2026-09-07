import { unzipSync } from "fflate";
import type { GitHubClient } from "./client.ts";
import type { Collected, Context } from "../types.ts";
import { encodeRepo, parseStrict, safePath, hash, textBound } from "../util.ts";
export function readArtifactZip(bytes: Uint8Array, entry: string): unknown {
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error("artifact_compressed_size");
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (
        ++count > 32 ||
        !safePath(file.name) ||
        (total += file.originalSize) > 2 * 1024 * 1024
      )
        throw new Error("artifact_zip_limits");
      return file.name === entry;
    },
  });
  if (!files[entry] || files[entry].length > 1024 * 1024)
    throw new Error("artifact_entry_missing_or_large");
  return parseStrict(new TextDecoder().decode(files[entry]));
}
export function interpretArtifact(
  adapter: "podcast" | "scheduled-health",
  value: any,
) {
  if (adapter === "podcast") {
    if (
      value?.schemaVersion !== 1 ||
      !value.summary ||
      typeof value.summary.platformReady !== "boolean" ||
      typeof value.summary.launchReady !== "boolean" ||
      !Array.isArray(value.nodes)
    )
      throw new Error("artifact_schema");
    const nodes = value.nodes.map((n: any) => {
      if (
        !n.id ||
        !["PASS", "FAIL", "BLOCK", "WAIT", "DEFER"].includes(n.status)
      )
        throw new Error("artifact_node_schema");
      return {
        id: textBound(n.id, 100),
        status: n.status,
        title: textBound(n.title ?? n.label ?? n.id, 300),
        detail: textBound(n.detail, 1200),
      };
    });
    if (
      value.summary.platformReady &&
      nodes.some((n: any) => ["FAIL", "BLOCK", "WAIT"].includes(n.status))
    )
      throw new Error("artifact_inconsistent_summary");
    return {
      platformReady: value.summary.platformReady,
      launchReady: value.summary.launchReady,
      nodes,
    };
  }
  if (
    !value ||
    !["healthy", "failed"].includes(value.status) ||
    !Array.isArray(value.errors) ||
    !Array.isArray(value.cycles) ||
    !Number.isFinite(Date.parse(value.observed_at)) ||
    !/^[a-f0-9]{40,64}$/.test(value.commit ?? "") ||
    !Number.isInteger(value.verified_cycles) ||
    value.verified_cycles < 0 ||
    !Number.isInteger(value.required_cycles) ||
    value.required_cycles < 1 ||
    !["complete", "pending"].includes(value.scheduled_acceptance) ||
    value.cycles.some(
      (c: any) =>
        !["passed", "failed", "pending"].includes(c.status) ||
        !Array.isArray(c.errors),
    )
  )
    throw new Error("artifact_schema");
  let consecutive = 0;
  for (const cycle of value.cycles) {
    if (cycle.status !== "passed" || cycle.errors.length) break;
    consecutive++;
  }
  if (
    value.verified_cycles !== consecutive ||
    (value.status === "healthy" && value.errors.length) ||
    (value.scheduled_acceptance === "complete" &&
      (consecutive < value.required_cycles || value.status !== "healthy"))
  )
    throw new Error("artifact_inconsistent_summary");
  return {
    status: value.status,
    observedAt: value.observed_at,
    commit: value.commit,
    errors: value.errors.map((e: any) => textBound(e, 1000)),
    cycles: value.cycles.map((c: any) => ({
      status: c.status,
      errors: (c.errors ?? []).map((e: any) => textBound(e, 1000)),
    })),
    consecutivePassed: value.verified_cycles,
    requiredCycles: value.required_cycles,
    scheduledAcceptance: value.scheduled_acceptance,
  };
}
export async function collectArtifacts(
  client: GitHubClient,
  collected: Collected,
  config: NonNullable<Context["artifacts"]>[number],
) {
  const run = collected.runs.find(
    (r) =>
      r.path.split("@")[0] === config.workflow &&
      r.status === "completed" &&
      r.branch === collected.repo.default_branch,
  );
  if (!run) throw new Error("artifact_source_run_missing");
  if (
    Date.parse(collected.observedAt) - Date.parse(run.createdAt) >
    config.maxAgeHours * 3600_000
  )
    throw new Error("artifact_stale");
  const name = collected.repo.full_name,
    base = `/repos/${encodeRepo(name)}`;
  const artifacts = await client.pages(
    name,
    `${base}/actions/runs/${run.id}/artifacts`,
    "artifacts",
  );
  const expectedName =
    config.adapter === "podcast"
      ? `${config.namePrefix}${run.id}-${run.attempt}`
      : config.namePrefix;
  const matches = artifacts.filter(
    (a) => a.name === expectedName && !a.expired,
  );
  if (matches.length !== 1) throw new Error("artifact_missing_or_ambiguous");
  const artifact = matches[0];
  if (
    artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run?.head_sha !== run.sha ||
    artifact.size_in_bytes > 2 * 1024 * 1024
  )
    throw new Error("artifact_provenance_or_size");
  const redirect = await client.raw(
    name,
    `${base}/actions/artifacts/${artifact.id}/zip`,
    "artifact_download",
  );
  const location = redirect.headers.get("location");
  if (redirect.status !== 302 || !location)
    throw new Error("artifact_redirect_missing");
  const url = new URL(location);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ![".blob.core.windows.net", ".actions.githubusercontent.com"].some((s) =>
      url.hostname.endsWith(s),
    )
  )
    throw new Error("artifact_redirect_origin");
  // Signed download only: never forward GitHub authorization to storage.
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 2 * 1024 * 1024
  )
    throw new Error("artifact_download_failed");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("artifact_empty_body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("artifact_download_size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value = readArtifactZip(bytes, config.entry ?? "report.json");
  return {
    adapter: config.adapter,
    workflow: config.workflow,
    runId: run.id,
    attempt: run.attempt,
    sha: run.sha,
    url: run.url,
    at: run.createdAt,
    artifactId: artifact.id,
    digest: await hash(bytes),
    result: interpretArtifact(config.adapter, value),
  };
}
