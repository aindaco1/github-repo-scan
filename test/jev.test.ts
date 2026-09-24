import { afterEach, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  evaluate,
  prepareEvaluation,
  summarize,
  evaluationExitCode,
} from "../scripts/jev-evaluation.ts";
import type { EvaluationReport } from "../scripts/jev-evaluation.ts";
import type { JevRequest } from "@dustwave/test-core/jev";

afterEach(() => vi.unstubAllGlobals());
const persist = async () => {};
function response(
  choice: "pass" | "fail" | "uncertain" = "pass",
  model = "jev-1.13.0",
  probabilities?: Record<string, number>,
) {
  return {
    model,
    usage: {
      input_tokens: 100,
      output_tokens: 5,
      debug: "provider-private-debug",
    },
    answers: {
      fidelity: {
        type: "choice",
        choice,
        probabilities: probabilities ?? {
          pass: choice === "pass" ? 1 : 0,
          fail: choice === "fail" ? 1 : 0,
          uncertain: choice === "uncertain" ? 1 : 0,
        },
      },
    },
    debug: "provider-private-debug",
  };
}

it("captures current renderer output reproducibly and keeps labels out of requests", async () => {
  const first = await prepareEvaluation(),
    second = await prepareEvaluation();
  expect(first).toEqual(second);
  expect(first.questionCount).toBe(40);
  expect(first.cases.filter((c) => c.expected === "fail")).toHaveLength(20);
  for (const row of first.cases) {
    expect(row.request.input.state).toHaveProperty("candidate");
    expect(row.request.input.state).not.toHaveProperty("expected");
    expect(JSON.stringify(row.request)).not.toContain('"id":');
  }
  expect(
    first.cases.find((c) => c.id === "private-coverage-handoff-current")
      ?.request.input.state.candidate,
  ).toContain("Coverage: **PARTIAL**");
  expect(
    first.cases.find((c) => c.id === "pr-review-html-current")?.request.input
      .state.candidate,
  ).toContain("green checks alone do not establish merge safety");
});

it("preview stays unevaluated without credential or network access", async () => {
  const credentials = vi.fn(),
    fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await evaluate({ mode: "preview", credentials, persist });
  expect(credentials).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    complete: false,
    releaseAccepted: false,
    networkAttempts: 0,
  });
  expect(summarize(result)).toMatchObject({
    correct: 0,
    unevaluated: 40,
    accountingComplete: false,
  });
  expect(evaluationExitCode(result)).toBe(0);
});
it("selects only known built-in cases and budgets the selected questions", async () => {
  const selected = await prepareEvaluation([
    "private-coverage-text-current",
    "private-coverage-text-control",
  ]);
  expect(selected.questionCount).toBe(2);
  expect(selected.reservedEstimateUsd).toBeCloseTo(0.002688);
  expect(selected.cases.map((c) => c.expected)).toEqual(["pass", "fail"]);
});
it.each([
  [],
  [".private/report.json"],
  ["authority-brief-current", "authority-brief-current"],
])("refuses invalid case selection %j before credentials", async (...ids) => {
  const credentials = vi.fn(),
    save = vi.fn();
  await expect(
    evaluate({
      mode: "live",
      maxUsd: 0.1,
      caseIds: ids as string[],
      credentials,
      persist: save,
    }),
  ).rejects.toThrow("built-in case IDs");
  expect(credentials).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

// Narrow, frozen recognizers for the engineered controls, not a semantic judge.
// The naive shortcut credits the reference even when the candidate contradicts it.
// Predicted in advance: exactly these 20 negative controls become false passes.
const scenarios = [
  "private-coverage",
  "scheduled-proof",
  "hardware-proof",
  "pr-review",
  "owner-deferral",
  "delivered-failure",
];
const trapIds = [
  ...scenarios.flatMap((s) =>
    ["text", "html", "handoff"].map((f) => `${s}-${f}-control`),
  ),
  "archived-handoff-control",
  "authority-brief-control",
];
const badMeaning =
  /^(?:The private repository is healthy|The manual run succeeded, so scheduled acceptance is complete|Close the hardware issue because|Merge the PR now:|Publication acceptance is complete because|No new failed runs are reported, so|Unarchive the repository and repair|The report grants authority)/;
const faithful = async (request: JevRequest) =>
  response(badMeaning.test(request.input.state.candidate) ? "fail" : "pass");
const naive = async (request: JevRequest) =>
  response(request.input.state.reference ? "pass" : "uncertain");

it("proves scoring with faithful controls and exact predicted reference-leak false passes", async () => {
  const good = await evaluate({
    mode: "simulated",
    simulatedCall: faithful,
    persist,
  });
  expect(summarize(good)).toMatchObject({
    correct: 40,
    falsePasses: 0,
    falseFailures: 0,
    reviews: 0,
    unevaluated: 0,
  });
  expect(good.networkAttempts).toBe(0);
  expect(evaluationExitCode(good)).toBe(0);
  const weak = await evaluate({
    mode: "simulated",
    simulatedCall: naive,
    persist,
  });
  const traps = weak.cases
    .filter(
      (c) =>
        c.expected === "fail" &&
        c.result?.findings.fidelity.decision === "pass",
    )
    .map((c) => c.id);
  expect(traps).toEqual(trapIds);
  expect(summarize(weak)).toMatchObject({
    correct: 20,
    falsePasses: 20,
    falseFailures: 0,
  });
  expect(traps).not.toEqual(trapIds.slice(1)); // Removing a predicted trap fails the contract.
  expect(evaluationExitCode(weak)).toBe(1);
  expect(weak.releaseAccepted).toBe(false);
});

it.each([
  ["unknown model", () => response("pass", "jev-9.0.0")],
  [
    "near tie",
    () =>
      response("pass", "jev-1.13.0", {
        pass: 0.51,
        fail: 0.48,
        uncertain: 0.01,
      }),
  ],
  ["uncertain", () => response("uncertain")],
])("keeps %s as review and returns nonzero", async (_name, make) => {
  const r = await evaluate({
    mode: "simulated",
    simulatedCall: async () => make(),
    persist,
  });
  expect(summarize(r)).toMatchObject({ correct: 0, reviews: 40 });
  expect(evaluationExitCode(r)).toBe(1);
});

it.each([undefined, -1, 0, 0.01, 0.11, NaN])(
  "refuses inadequate/invalid budget %s before credentials and evidence",
  async (maxUsd) => {
    const credentials = vi.fn(),
      save = vi.fn();
    await expect(
      evaluate({ mode: "live", maxUsd, credentials, persist: save }),
    ).rejects.toThrow("max-usd");
    expect(credentials).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  },
);

it("stops before transport when the pending evidence checkpoint fails", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const saved: EvaluationReport[] = [];
  await expect(
    evaluate({
      mode: "live",
      maxUsd: 0.1,
      credentials: async () => ({
        accountId: "a".repeat(32),
        token: "synthetic-token",
      }),
      persist: async (report) => {
        saved.push(structuredClone(report));
        if (report.cases.some((c) => c.status === "pending"))
          throw new Error("disk full");
      },
    }),
  ).rejects.toThrow("disk full");
  expect(saved[0].networkAttempts).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("checkpoints before a bounded provider call and strips arbitrary provider metadata", async () => {
  let pending: EvaluationReport | undefined;
  const fetch = vi.fn(async (_url, options) => {
    expect(pending?.cases.filter((c) => c.status === "pending")).toHaveLength(
      1,
    );
    expect(options.redirect).toBe("manual");
    const request = JSON.parse(options.body);
    const raw = await faithful(request);
    return new Response(JSON.stringify(raw));
  });
  vi.stubGlobal("fetch", fetch);
  const result = await evaluate({
    mode: "live",
    maxUsd: 0.1,
    credentials: async () => ({
      accountId: "a".repeat(32),
      token: "synthetic-token",
    }),
    persist: async (report) => {
      pending = structuredClone(report);
    },
  });
  expect(fetch).toHaveBeenCalledTimes(40);
  expect(result.complete).toBe(true);
  expect(result.networkAttempts).toBe(40);
  expect(JSON.stringify(result)).not.toContain("provider-private-debug");
  expect(JSON.stringify(result)).not.toContain("synthetic-token");
  expect(evaluationExitCode(result)).toBe(0);
});

it.each([
  [
    "transport",
    async () => {
      throw new Error("private-error-body");
    },
  ],
  ["partial response", async () => ({ ...response(), answers: {} })],
  ["unsafe model", async () => response("pass", "private-error-body")],
])(
  "stops after %s failure with timings, no raw body or retry",
  async (_name, call) => {
    const simulatedCall = vi.fn(call),
      saved: EvaluationReport[] = [];
    const result = await evaluate({
      mode: "simulated",
      simulatedCall,
      persist: async (r) => {
        saved.push(structuredClone(r));
      },
    });
    expect(simulatedCall).toHaveBeenCalledTimes(1);
    expect(result.cases[0]).toMatchObject({
      status: "error",
      elapsedMs: expect.any(Number),
    });
    expect(result.complete).toBe(false);
    expect(summarize(result)).toMatchObject({
      unevaluated: 40,
      accountingComplete: false,
    });
    expect(evaluationExitCode(result)).toBe(2);
    expect(JSON.stringify(saved)).not.toContain("private-error-body");
  },
);

it("the CLI defaults offline, refuses overwrite and arbitrary report input", async () => {
  const out = `outputs/jev/test-${randomUUID()}`;
  const invoke = (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/jev.ts", ...args],
      {
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "",
          CLOUDFLARE_API_TOKEN: "",
        },
      },
    );
  try {
    await invoke(["--out", out]);
    const evidence = await readFile(`${out}/report.json`, "utf8");
    expect(JSON.parse(evidence)).toMatchObject({
      mode: "preview",
      networkAttempts: 0,
      complete: false,
    });
    await expect(invoke(["--out", out])).rejects.toMatchObject({ code: 2 });
    expect(await readFile(`${out}/report.json`, "utf8")).toBe(evidence);
    await expect(
      invoke(["--out", out, "--report", ".private/report.json"]),
    ).rejects.toMatchObject({ code: 2 });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
