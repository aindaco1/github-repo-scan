import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type {
  Repo,
  Policy,
  Collected,
  RuntimeEnv,
  Report,
} from "../src/types.ts";
export const repo = (id = 1, changes: Partial<Repo> = {}): Repo => ({
  id,
  full_name: `owner/repo-${id}`,
  private: false,
  archived: false,
  fork: false,
  default_branch: "main",
  owner: { login: "owner" },
  html_url: `https://github.com/owner/repo-${id}`,
  has_issues: true,
  size: 1,
  ...changes,
});
export const policy = (changes: Partial<Policy> = {}): Policy => ({
  schemaVersion: 1,
  mode: "discover",
  owners: ["owner"],
  include: [],
  exclude: [],
  includeArchived: false,
  includeForks: true,
  overrides: {},
  ...changes,
});
export const collected = (changes: Partial<Collected> = {}): Collected => ({
  repo: repo(),
  headSha: "current",
  observedAt: "2026-09-07T14:00:00Z",
  branches: ["main"],
  workflows: [
    {
      id: 1,
      path: ".github/workflows/test.yml",
      name: "Test",
      state: "active",
    },
  ],
  runs: [],
  jobs: {},
  prs: [],
  issues: [],
  docs: [],
  artifacts: [],
  gaps: [],
  requests: 0,
  ...changes,
});
export const run = (changes: any = {}) => ({
  id: 5,
  attempt: 1,
  workflowId: 1,
  path: ".github/workflows/test.yml",
  name: "Test",
  event: "push",
  branch: "main",
  sha: "abc",
  status: "completed",
  conclusion: "failure",
  createdAt: "2026-09-06T12:00:00Z",
  url: "https://github.com/owner/repo-1/actions/runs/5",
  pullNumbers: [],
  ...changes,
});
export function testEnv() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  const objects = new Map<string, string>();
  const make = (sql: string, args: any[] = []) => ({
    bind: (...args: any[]) => make(sql, args),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
  });
  const env: any = {
    DB: {
      prepare: (sql: string) => make(sql),
      batch: async (statements: any[]) => {
        sqlite.exec("BEGIN");
        try {
          const result = [];
          for (const s of statements) result.push(await s.run());
          sqlite.exec("COMMIT");
          return result;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      },
    },
    REPORTS: {
      get: async (key: string) =>
        objects.has(key)
          ? {
              text: async () => objects.get(key)!,
              json: async () => JSON.parse(objects.get(key)!),
            }
          : null,
      head: async (key: string) => (objects.has(key) ? {} : null),
      put: async (key: string, value: string) => {
        objects.set(key, value);
      },
      list: async ({ prefix }: { prefix: string }) => ({
        objects: [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false,
      }),
      delete: async (keys: string[]) => keys.forEach((k) => objects.delete(k)),
    },
    EMAIL: { send: async () => ({ messageId: "email-1" }) },
    SEND_ENABLED: "true",
    DIGEST_TO_EMAIL: "recipient@example.invalid",
    DIGEST_FROM_EMAIL: "sender@example.invalid",
    DIGEST_FROM_NAME: "GitHub Repo Scan",
    EMAIL_EVENT_ACCOUNT_ID: "account-1",
    EMAIL_EVENT_SUBSCRIPTION_ID: "subscription-1",
    EMAIL_EVENT_DOMAIN: "example.invalid",
  };
  return { env: env as RuntimeEnv, sqlite, objects };
}
export const event = (changes: any = {}) => ({
  type: "cf.email.sending.message.delivered",
  source: { type: "email.sending", domain: "example.invalid" },
  metadata: {
    accountId: "account-1",
    eventSubscriptionId: "subscription-1",
    eventTimestamp: "2026-09-07T14:05:00Z",
  },
  payload: {
    eventId: "event-1",
    messageId: "email-1",
    subject: "Subject",
    sender: "sender@example.invalid",
    recipient: "recipient@example.invalid",
  },
  ...changes,
});
