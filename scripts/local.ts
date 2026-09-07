import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { parseEnv } from "node:util";
import { GitHubClient } from "../src/github/client.ts";
export async function localSecrets(): Promise<Record<string, string>> {
  let env: Record<string, string> = {};
  try {
    env = parseEnv(await readFile(".dev.vars", "utf8")) as Record<
      string,
      string
    >;
  } catch {}
  try {
    env = {
      ...env,
      ...JSON.parse(await readFile(".private/runtime-secrets.json", "utf8")),
    };
  } catch {}
  return {
    ...env,
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (v): v is [string, string] => v[1] !== undefined,
      ),
    ),
  };
}
export async function localClient() {
  const env = await localSecrets();
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY)
    throw new Error("app_credentials_missing");
  return new GitHubClient(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, {
    deadline: Date.now() + 30 * 60_000,
  });
}
export async function privateWrite(path: string, text: string) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), {
    recursive: true,
    mode: 0o700,
  });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, path);
}
