import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  parseBundle,
  parsePolicy,
  editPolicy,
  resolveSelection,
} from "../src/selection.ts";
import { snapshot, selectInventory } from "../src/policy.ts";
import { scanPreview, buildReport } from "../src/scan.ts";
import { renderBundle } from "../src/report/render.ts";
import { localClient, localSecrets, privateWrite } from "./local.ts";
import { code, hash, parseStrict } from "../src/util.ts";
import type { Bundle, Repo, Report } from "../src/types.ts";
const args = process.argv.slice(2),
  [command, action, value] = args;
const privatePolicy = args.includes("--private");
async function bundle(): Promise<Bundle> {
  return privatePolicy
    ? parseBundle(await readFile(".private/policy.json", "utf8"))
    : parseBundle({
        selection: parsePolicy(await readFile("config/scan.json", "utf8")),
        repos: parseStrict(await readFile("config/repos.json", "utf8")),
        dispositions: parseStrict(
          await readFile("config/dispositions.json", "utf8"),
        ),
      });
}
async function expected(): Promise<Repo[]> {
  try {
    return JSON.parse(await readFile(".private/owner-inventory.json", "utf8"));
  } catch {
    throw new Error("run_onboard_first");
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  const env = await localSecrets();
  if (!env.ADMIN_TOKEN || !env.WORKER_URL)
    throw new Error("operator_configuration_missing");
  const url = new URL(path, env.WORKER_URL);
  if (
    url.protocol !== "https:" ||
    url.origin !== new URL(env.WORKER_URL).origin
  )
    throw new Error("operator_origin");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`operator_http_${response.status}`);
  return response;
}
async function main() {
  if (command === "onboard") {
    const client = await localClient(),
      inventory = await client.inventory();
    const owner = JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          "--paginate",
          "--slurp",
          "/user/repos?affiliation=owner&per_page=100",
        ],
        { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
      ),
    ).flat() as Repo[];
    const ids = new Set(inventory.repos.map((r) => r.id));
    if (owner.some((r) => !ids.has(r.id)) || inventory.gaps.length)
      throw new Error("onboarding_inventory_mismatch");
    const minimal = owner.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      private: r.private,
      archived: r.archived,
      fork: r.fork,
      default_branch: r.default_branch,
      owner: { login: r.owner.login },
      html_url: r.html_url,
      has_issues: r.has_issues,
      size: r.size,
    }));
    await privateWrite(
      ".private/owner-inventory.json",
      JSON.stringify(minimal),
    );
    await privateWrite(
      ".private/app-inventory.json",
      JSON.stringify(inventory),
    );
    console.log(
      JSON.stringify({
        matched: owner.length,
        private: owner.filter((r) => r.private).length,
        missing: 0,
      }),
    );
    return;
  }
  if (command === "policy" && action === "init-private") {
    await privateWrite(
      ".private/policy.json",
      JSON.stringify(await bundle(), null, 2) + "\n",
    );
    console.log(
      "Private policy initialized. Use --private for subsequent edits.",
    );
    return;
  }
  if (command === "policy" && action === "publish") {
    if (!privatePolicy) throw new Error("private_flag_required");
    console.log(
      await (await api("/admin/policy", "PUT", await bundle())).json(),
    );
    return;
  }
  if (command === "repos") {
    const b = await bundle(),
      client = await localClient(),
      inventory = await client.inventory();
    if (action === "list") {
      const result = selectInventory(
        await snapshot(b, "local"),
        inventory,
        await expected(),
      );
      console.log(
        JSON.stringify(
          { policyHash: await hash(JSON.stringify(b)), ...result },
          null,
          2,
        ),
      );
      return;
    }
    const explicit = args.indexOf("--repo"),
      target = explicit >= 0 ? args[explicit + 1] : undefined;
    if (!value) throw new Error("policy_value_required");
    if (!privatePolicy && (action === "add" || target)) {
      const r = await client.repo(target ?? value);
      if (r.private)
        throw new Error("private_repository_requires_private_policy");
    }
    b.selection = editPolicy(
      b.selection,
      action,
      value,
      target,
      args.includes("--include-archived"),
    );
    resolveSelection(b.selection, inventory.repos);
    const path = privatePolicy ? ".private/policy.json" : "config/scan.json",
      before = await readFile(path, "utf8"),
      after = JSON.stringify(privatePolicy ? b : b.selection, null, 2) + "\n";
    console.log(`Policy ${path}:\n${before === after ? "No change." : after}`);
    await privateWrite(path, after);
    return;
  }
  if (command === "preview" && action === "--fixture") {
    const fixture = JSON.parse(await readFile(value, "utf8"));
    const report = await buildReport(fixture);
    await save(report);
    return;
  }
  if (command === "scan") {
    if (!args.includes("--preview"))
      throw new Error("local_scan_requires_preview");
    const client = await localClient(),
      b = await bundle();
    const report = await scanPreview(
      client,
      await snapshot(b, "local-reviewed-policy"),
      await expected(),
      `preview-${crypto.randomUUID()}`,
    );
    await save(report);
    return;
  }
  if (command === "run") {
    console.log(
      await (
        await api("/admin/runs", "POST", { send: args.includes("--send") })
      ).json(),
    );
    return;
  }
  if (command === "runs") {
    console.log(await (await api("/admin/runs")).json());
    return;
  }
  if (command === "recover" && action) {
    console.log(
      await (
        await api(`/admin/runs/${encodeURIComponent(action)}/recover`, "POST")
      ).json(),
    );
    return;
  }
  if (command === "download" && action) {
    const manifestBody = await (
      await api(`/admin/reports/${encodeURIComponent(action)}/manifest.json`)
    ).text();
    const manifest = parseStrict(manifestBody) as {
      runId: string;
      files: Record<string, { sha256: string }>;
    };
    if (manifest.runId !== action) throw new Error("manifest_run_mismatch");
    await privateWrite(`reports/${action}/manifest.json`, manifestBody);
    const names = Object.keys(manifest.files).filter((name) =>
      /^(report\.(json|html|txt)|codex(?:-\d+)?\.md)$/.test(name),
    );
    for (const name of names) {
      const body = await (
        await api(`/admin/reports/${encodeURIComponent(action)}/${name}`)
      ).text();
      if ((await hash(body)) !== manifest.files[name].sha256)
        throw new Error("download_hash_mismatch");
      await privateWrite(`reports/${action}/${name}`, body);
    }
    console.log(`Downloaded private report reports/${action}`);
    return;
  }
  console.log(
    "Commands: onboard | repos list/add/remove/archived/mode [--private] | policy init-private/publish | scan --preview [--private] | preview --fixture FILE | run [--send] | runs | download ID | recover ID",
  );
}
async function save(report: Report) {
  const files = await renderBundle(report);
  for (const [name, body] of Object.entries(files))
    await privateWrite(`reports/${report.id}/${name}`, body);
  console.log(
    JSON.stringify({
      id: report.id,
      coverage: report.coverage.status,
      selected: report.coverage.selected,
      scanned: report.coverage.scanned,
      privateScanned: report.coverage.privateScanned,
      gaps: report.coverage.gaps.length,
      findings: report.findings.length,
      output: `reports/${report.id}`,
    }),
  );
}
main().catch((error) => {
  console.error(code(error));
  process.exitCode = 1;
});
