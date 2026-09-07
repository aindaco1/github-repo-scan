import { parse } from "jsonc-parser";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const base = parse(await readFile("wrangler.jsonc", "utf8"));
const deployment = JSON.parse(
  process.env.DEPLOY_CONFIG ??
    (await readFile(".private/deployment.json", "utf8")),
);
const path = `.deploy-${crypto.randomUUID()}.json`;
await mkdir(".private", { recursive: true, mode: 0o700 });
await writeFile(path, JSON.stringify({ ...base, ...deployment }), {
  mode: 0o600,
});
try {
  const result = spawnSync(
    "node_modules/.bin/wrangler",
    [
      "d1",
      "migrations",
      "apply",
      "github-repo-scan",
      "--remote",
      "--config",
      path,
    ],
    { encoding: "utf8", input: "y\n", env: process.env },
  );
  await writeFile(".private/migration.log", result.stdout + result.stderr, {
    mode: 0o600,
  });
  if (result.status !== 0)
    throw new Error("Migration failed; inspect private log");
  console.log("Remote migrations applied.");
} finally {
  await rm(path, { force: true });
}
