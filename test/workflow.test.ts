import { afterEach, expect, it, vi } from "vitest";
import { ScanWorkflow } from "../src/workflow/scan.ts";
import { GitHubClient } from "../src/github/client.ts";
import { collectRepository } from "../src/github/collect.ts";
import { snapshot } from "../src/policy.ts";
import { hash } from "../src/util.ts";
import { collected, policy, repo, testEnv } from "./helpers.ts";

vi.mock("../src/github/collect.ts", () => ({ collectRepository: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const storageError = () =>
  new Error("put: We encountered an internal error. Please try again. (10001)");

// Exercise the real workflow with durable step retries, persisted R2/D1 state,
// and a clock that can advance beyond collection's deadline without real waits.
function steps() {
  const attempts = new Map<string, number>();
  const serializable = (value: any) => {
    if (value && typeof value === "object") {
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype
      )
        throw new Error("DataCloneError");
      Object.values(value).forEach(serializable);
    }
  };
  return {
    attempts,
    do: async (name: string, options: any, callback?: () => Promise<any>) => {
      const work = callback ?? options;
      const retries = callback ? (options.retries?.limit ?? 0) : 0;
      for (let attempt = 0; ; attempt++) {
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
        try {
          const value = await work();
          serializable(value);
          return structuredClone(value);
        } catch (error) {
          if (attempt >= retries) throw error;
          // Model slow failed storage calls as well as their retry delay.
          vi.setSystemTime(Date.now() + 5 * 60_000);
        }
      }
    },
    sleepUntil: vi.fn(async (_name: string, target: Date) => {
      if (target.getTime() < Date.now())
        throw new Error(
          "You can't sleep until a time in the past, time-traveler",
        );
      vi.setSystemTime(target);
    }),
  };
}

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T13:45:00Z"));
  const { env, sqlite, objects } = testEnv();
  env.POLICY_SOURCE = "r2";
  const target = repo(1, { private: true });
  const bundle = { selection: policy(), repos: {}, dispositions: [] };
  const version = (await snapshot(bundle, "fixture")).hash;
  objects.set("policy/current.json", JSON.stringify({ version }));
  objects.set(`policy/${version}.json`, JSON.stringify(bundle));
  objects.set("onboarding/owner-inventory.json", JSON.stringify([target]));
  const inventory = vi
    .spyOn(GitHubClient.prototype, "inventory")
    .mockResolvedValue({
      repos: [target],
      installations: [
        {
          id: 1,
          account: { login: "owner" },
          repository_selection: "all",
          permissions: {},
          suspended_at: null,
        },
      ],
      gaps: [],
    });
  const collect = vi
    .mocked(collectRepository)
    .mockReset()
    .mockResolvedValue(collected({ repo: target }));
  const send = vi.spyOn(env.EMAIL, "send");
  const id = "weekly-2026-09-27-America-Denver";
  const event = {
    instanceId: id,
    payload: {
      id,
      scheduledAt: new Date().toISOString(),
      deliverAt: "2026-09-27T14:00:00Z",
      send: true,
    },
  };
  const workflow = new ScanWorkflow({} as ExecutionContext, env);
  const execute = (step = steps()) => workflow.run(event as any, step as any);
  return { env, sqlite, objects, inventory, collect, send, id, execute };
}

it("survives three R2 failures after collection without rescanning or changing frozen bytes", async () => {
  const f = await fixture();
  const put = f.env.REPORTS.put.bind(f.env.REPORTS);
  let failures = 0;
  let frozen: string | undefined;
  f.env.REPORTS.put = (async (key: string, ...args: any[]) => {
    if (key === `reports/${f.id}/report.txt` && failures++ < 3) {
      frozen ??= f.objects.get(`checkpoints/${f.id}/final.json`);
      throw storageError();
    }
    return (put as any)(key, ...args);
  }) as any;
  const step = steps();
  await f.execute(step);
  expect(step.attempts.get("snapshot-policy-and-inventory")).toBe(1);
  expect(step.attempts.get("freeze-report")).toBe(4);
  expect(f.inventory).toHaveBeenCalledTimes(1);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.objects.get(`reports/${f.id}/report.json`)).toBe(frozen);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(
    f.sqlite.prepare("SELECT coverage_status,error_code FROM runs").get(),
  ).toMatchObject({ coverage_status: "complete", error_code: null });
  const files = new Map(f.objects);
  await f.execute();
  expect(f.objects).toEqual(files);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it("waits for a future delivery target and skips it when recovering a frozen report late", async () => {
  const f = await fixture();
  const first = steps();
  await f.execute(first);
  expect(first.sleepUntil).toHaveBeenCalledWith(
    "delivery-target",
    new Date("2026-09-27T14:00:00Z"),
  );
  expect(f.send).toHaveBeenCalledTimes(1);
  const files = new Map(f.objects);
  f.sqlite.exec("UPDATE runs SET state='failed',error_code='unexpected_error'");
  vi.setSystemTime(new Date("2026-09-28T04:00:00Z"));
  const recovery = steps();
  await f.execute(recovery);
  expect(recovery.sleepUntil).not.toHaveBeenCalled();
  expect(f.objects).toEqual(files);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(
    f.sqlite.prepare("SELECT state,error_code FROM runs").get(),
  ).toMatchObject({ state: "frozen", error_code: null });
});

it("bounds storage retries, records a safe failure, and recovers the same expired run without a duplicate send", async () => {
  const f = await fixture();
  const put = f.env.REPORTS.put.bind(f.env.REPORTS);
  f.env.REPORTS.put = (async (key: string, ...args: any[]) => {
    if (key === `reports/${f.id}/report.html`) throw storageError();
    return (put as any)(key, ...args);
  }) as any;
  const step = steps();
  await expect(f.execute(step)).rejects.toThrow("r2_internal_error");
  expect(step.attempts.get("freeze-report")).toBe(6);
  expect(f.send).not.toHaveBeenCalled();
  expect(
    f.sqlite.prepare("SELECT state,bundle_hash,error_code FROM runs").get(),
  ).toMatchObject({
    state: "failed",
    bundle_hash: null,
    error_code: "r2_internal_error",
  });
  expect(
    f.sqlite.prepare("SELECT count(*) AS n FROM deliveries").get(),
  ).toMatchObject({ n: 0 });
  const bytes = f.objects.get(`reports/${f.id}/report.json`);
  f.env.REPORTS.put = put;
  vi.setSystemTime(new Date("2026-09-28T04:00:00Z"));
  await f.execute();
  expect(f.inventory).toHaveBeenCalledTimes(1);
  expect(f.collect).toHaveBeenCalledTimes(1);
  expect(f.objects.get(`reports/${f.id}/report.json`)).toBe(bytes);
  const manifest = f.objects.get(`reports/${f.id}/manifest.json`)!;
  expect(
    f.sqlite.prepare("SELECT state,bundle_hash,error_code FROM runs").get(),
  ).toMatchObject({
    state: "frozen",
    bundle_hash: await hash(manifest),
    error_code: null,
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  await f.execute();
  expect(f.send).toHaveBeenCalledTimes(1);
});
