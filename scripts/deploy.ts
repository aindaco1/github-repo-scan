import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";
import { localSecrets } from "./local.ts";
const dry = process.argv.includes("--dry-run");
const base = parse(await readFile("wrangler.jsonc", "utf8"));
let config = base;
if (!dry) {
  const raw =
    process.env.DEPLOY_CONFIG ??
    (await readFile(".private/deployment.json", "utf8"));
  const deployment = JSON.parse(raw);
  config = {
    ...base,
    ...deployment,
    vars: { ...base.vars, ...deployment.vars },
  };
  const secrets = await localSecrets();
  if (secrets.DIGEST_FROM_EMAIL && secrets.DIGEST_TO_EMAIL)
    config.send_email = [
      {
        name: "EMAIL",
        allowed_destination_addresses: [secrets.DIGEST_TO_EMAIL],
        allowed_sender_addresses: [secrets.DIGEST_FROM_EMAIL],
      },
    ];
  else if (
    !deployment.send_email?.[0]?.allowed_destination_addresses?.length ||
    !deployment.send_email?.[0]?.allowed_sender_addresses?.length
  )
    throw new Error("email_identity_missing");
  if (
    config.name !== "github-repo-scan" ||
    !config.d1_databases?.[0]?.database_id ||
    config.d1_databases[0].database_id.startsWith("00000000")
  )
    throw new Error("deployment_configuration_invalid");
}
const path = `.deploy-${crypto.randomUUID()}.json`;
await mkdir(".private", { recursive: true, mode: 0o700 });
await writeFile(path, JSON.stringify(config), { mode: 0o600 });
try {
  const result = spawnSync(
    "node_modules/.bin/wrangler",
    [
      "deploy",
      "--config",
      path,
      ...(dry ? ["--dry-run", "--outdir", "dist"] : []),
    ],
    { encoding: "utf8", env: process.env, maxBuffer: 10 * 1024 * 1024 },
  );
  await writeFile(
    dry ? ".private/last-dry-build.log" : ".private/last-deploy.log",
    (result.stdout ?? "") + (result.stderr ?? ""),
    { mode: 0o600 },
  );
  if (result.status !== 0) {
    console.error(
      "Deployment failed; inspect ignored .private/last-deploy.log locally.",
    );
    process.exitCode = 1;
  } else
    console.log(
      dry
        ? "Worker dry build passed."
        : "Worker deployment succeeded. Private deployment details retained locally.",
    );
} finally {
  await rm(path, { force: true });
}
