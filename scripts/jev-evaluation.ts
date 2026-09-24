import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  createJevRequest,
  judgeJevResponse,
  callCloudflareJev,
} from "@dustwave/test-core/jev";
import type { JevRequest, JevResult } from "@dustwave/test-core/jev";
import {
  buildJevCases,
  jevPolicy,
  labelProvenance,
} from "../test/fixtures/jev-cases.ts";

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// Dated public TypeSafe list rate, not account billing or an enforced provider cap.
export const inputUsdPerMillion = 0.042;
export const maximumQuestions = 64;
export type Prepared = Awaited<ReturnType<typeof prepareEvaluation>>;
export async function prepareEvaluation(caseIds?: string[]) {
  let controls = await buildJevCases();
  if (caseIds !== undefined) {
    if (
      !caseIds.length ||
      new Set(caseIds).size !== caseIds.length ||
      caseIds.some((id) => !controls.some((c) => c.id === id))
    ) {
      throw new Error("Select distinct built-in case IDs");
    }
    controls = controls.filter((c) => caseIds.includes(c.id));
  }
  const cases = controls.map(
    ({ id, candidate, reference, requirements, expected }) => ({
      id,
      expected,
      request: createJevRequest(candidate, requirements, { reference }),
    }),
  );
  if (new Set(cases.map((c) => c.id)).size !== cases.length)
    throw new Error("Duplicate case ID");
  const questionCount = cases.reduce(
    (n, c) => n + Object.keys(c.request.input.questions).length,
    0,
  );
  if (!questionCount || questionCount > maximumQuestions)
    throw new Error("Question budget exceeded");
  return {
    classification: "public-synthetic" as const,
    labelProvenance,
    policy: structuredClone(jevPolicy),
    questionCount,
    // Reserve the full 32k context separately for every question, conservatively.
    reservedEstimateUsd:
      (questionCount * 32_000 * inputUsdPerMillion) / 1_000_000,
    corpusSha256: sha256(JSON.stringify(cases)),
    policySha256: sha256(JSON.stringify(jevPolicy)),
    cases,
  };
}

type Row = Prepared["cases"][number] & {
  status: "unevaluated" | "pending" | "evaluated" | "error";
  requestSha256: string;
  result?: JevResult;
  elapsedMs?: number;
};
export type EvaluationReport = Omit<Prepared, "cases"> & {
  schemaVersion: 1;
  advisory: true;
  releaseAccepted: false;
  complete: boolean;
  mode: "preview" | "live" | "simulated";
  networkAttempts: number;
  maximumEstimateUsd: number | null;
  error?: string;
  cases: Row[];
};

export function summarize(report: EvaluationReport) {
  const summary = {
    correct: 0,
    falsePasses: 0,
    falseFailures: 0,
    reviews: 0,
    unevaluated: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedUsageUsd: 0,
    accountingComplete: report.complete,
  };
  for (const row of report.cases) {
    if (!row.result) {
      summary.unevaluated += Object.keys(row.request.input.questions).length;
      continue;
    }
    summary.inputTokens += row.result.usage.input_tokens;
    summary.outputTokens += row.result.usage.output_tokens;
    for (const finding of Object.values(row.result.findings)) {
      if (finding.decision === "review") summary.reviews++;
      else if (finding.decision === row.expected) summary.correct++;
      else if (finding.decision === "pass") summary.falsePasses++;
      else summary.falseFailures++;
    }
  }
  summary.estimatedUsageUsd =
    (summary.inputTokens * inputUsdPerMillion) / 1_000_000;
  return summary;
}

export function evaluationExitCode(report: EvaluationReport) {
  if (report.mode === "preview" && !report.error) return 0;
  if (!report.complete || report.error) return 2;
  const s = summarize(report);
  return s.falsePasses || s.falseFailures || s.reviews || s.unevaluated ? 1 : 0;
}

// Consumer-only orchestration: Platform owns request construction, transport and
// parsing. Keep the pending write before transport and persist only validated
// projections; the generic batch helper does not offer those storage semantics.
export async function evaluate(options: {
  mode: EvaluationReport["mode"];
  maxUsd?: number;
  caseIds?: string[];
  credentials?: () => Promise<{ accountId: string; token: string }>;
  persist: (report: EvaluationReport) => Promise<void>;
  simulatedCall?: (request: JevRequest) => Promise<unknown>;
}): Promise<EvaluationReport> {
  const prepared = await prepareEvaluation(options.caseIds);
  if (
    options.mode === "live" &&
    (!Number.isFinite(options.maxUsd) ||
      options.maxUsd! <= 0 ||
      options.maxUsd! > 0.1 ||
      prepared.reservedEstimateUsd > options.maxUsd!)
  ) {
    throw new Error(
      "Live evaluation needs --max-usd within 0.10 and enough for the complete batch",
    );
  }
  if (options.simulatedCall && options.mode !== "simulated")
    throw new Error("Simulation must be labeled");
  const report: EvaluationReport = {
    ...prepared,
    schemaVersion: 1,
    advisory: true,
    releaseAccepted: false,
    complete: false,
    mode: options.mode,
    networkAttempts: 0,
    maximumEstimateUsd: options.mode === "live" ? options.maxUsd! : null,
    cases: prepared.cases.map((c) => ({
      ...c,
      status: "unevaluated",
      requestSha256: sha256(JSON.stringify(c.request)),
    })),
  };
  await options.persist(report);
  if (options.mode === "preview") return report;
  let call: (request: JevRequest) => Promise<unknown>;
  if (options.mode === "simulated") {
    if (!options.simulatedCall) throw new Error("Simulation adapter required");
    call = options.simulatedCall;
  } else {
    // Complete preflight and an evidence write precede all credential access.
    const auth = await options.credentials?.();
    if (
      !auth ||
      !/^[a-fA-F0-9]{32}$/.test(auth.accountId) ||
      !auth.token.trim()
    ) {
      throw new Error("Cloudflare credentials unavailable");
    }
    call = (request) =>
      callCloudflareJev(request, { ...auth, timeoutMs: 15_000 });
  }
  for (const row of report.cases) {
    row.status = "pending";
    if (options.mode === "live") report.networkAttempts++;
    // A persisted pending attempt might be billed after interruption. Never replay.
    await options.persist(report);
    const started = performance.now();
    try {
      const result = judgeJevResponse(
        await call(row.request),
        row.request.input.questions,
        report.policy,
      );
      // Model identifiers are provider-controlled too. Never persist arbitrary prose.
      if (
        !/^jev-\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(result.model) ||
        result.model.length > 128
      ) {
        throw new Error("Invalid model identifier");
      }
      row.result = {
        model: result.model,
        findings: result.findings,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        },
      };
      row.status = "evaluated";
    } catch {
      row.status = "error";
      report.error =
        "Evaluation stopped: request failed or response invalid; no retry performed.";
    }
    row.elapsedMs = Math.round(performance.now() - started);
    await options.persist(report);
    if (report.error) return report;
  }
  report.complete = true;
  await options.persist(report);
  return report;
}
