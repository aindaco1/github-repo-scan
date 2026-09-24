import { mkdir, readFile, writeFile, rename, realpath } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { parseArgs } from "node:util";
import { checkPlatform, platformPin, root } from "./check-platform.mjs";
import {
  evaluate,
  summarize,
  evaluationExitCode,
  sha256,
  inputUsdPerMillion,
} from "./jev-evaluation.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean", default: false },
      out: { type: "string" },
      "max-usd": { type: "string" },
      case: { type: "string", multiple: true },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "npm run jev -- --out outputs/jev/NEW_NAME [--live --max-usd 0.10] [--case BUILT_IN_ID ...]\nPreview is offline. Live uses only CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the process environment. Synthetic fixtures only; no private report inputs. Exit 0: preview/matching controls; 1: mismatch/review; 2: unavailable/incomplete. Never release acceptance.",
    );
    return;
  }
  if (!values.out || (!values.live && values["max-usd"] !== undefined))
    throw new Error("Invalid options");
  checkPlatform();
  const parent = resolve(root, "outputs/jev");
  const out = resolve(root, values.out);
  if (
    dirname(out) !== parent ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(basename(out))
  )
    throw new Error(
      "Output must be a new directory directly under outputs/jev",
    );
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await realpath(parent)) !== parent)
    throw new Error("Output parent must not be a symlink");
  await mkdir(out, { mode: 0o700 }); // EEXIST refuses files, directories and symlinks.
  const sourceFiles = [
    "test/fixtures/jev-cases.ts",
    "test/fixtures/builders.ts",
    "scripts/jev-evaluation.ts",
    "scripts/jev.ts",
    "scripts/platform-pin.json",
    "package-lock.json",
    "src/scan.ts",
    "src/selection.ts",
    "src/policy.ts",
    "src/triage/classify.ts",
    "src/report/render.ts",
    "src/report/notifications.ts",
    "src/util.ts",
    "shared/dust-wave-platform/packages/test-core/src/jev.js",
    "shared/dust-wave-platform/packages/worker-core/src/response-body.js",
    "shared/dust-wave-platform/packages/worker-core/src/bounded-stream.js",
  ];
  const sources = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [
        path,
        sha256(await readFile(resolve(root, path), "utf8")),
      ]),
    ),
  );
  const report = await evaluate({
    mode: values.live ? "live" : "preview",
    maxUsd: Number(values["max-usd"]),
    caseIds: values.case,
    credentials: async () => ({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      token: process.env.CLOUDFLARE_API_TOKEN ?? "",
    }),
    persist: async (current) => {
      const evidence = {
        ...current,
        platformPin,
        sources,
        pricing: {
          asOf: "2026-09-24",
          inputUsdPerMillion,
          source: "https://docs.typesafe.ai/models",
          note: "Estimate only; excludes account-specific fees. Not provider billing or a hard spending cap.",
        },
        summary: summarize(current),
      };
      const temporary = resolve(out, "report.tmp");
      await writeFile(temporary, JSON.stringify(evidence, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, resolve(out, "report.json"));
    },
  });
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        complete: report.complete,
        releaseAccepted: false,
        networkAttempts: report.networkAttempts,
        reservedEstimateUsd: report.reservedEstimateUsd,
        summary: summarize(report),
        evidence: `${values.out}/report.json`,
      },
      null,
      2,
    ),
  );
  process.exitCode = evaluationExitCode(report);
}

main().catch(() => {
  // Never echo paths, provider errors or credential values from caught exceptions.
  console.error(
    "Jev evaluation incomplete. Check --help, the Platform pin, a new output directory, budget and process credentials. Existing evidence is retained; no automatic retry.",
  );
  process.exitCode = 2;
});
