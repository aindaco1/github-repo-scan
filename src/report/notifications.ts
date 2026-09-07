import type { Finding, Report } from "../types.ts";
import { failureConclusions as failures } from "../util.ts";

// GitHub run identity and attempt are stable across renames, doc changes and
// triage decisions. A new failed run or a failed retry is new evidence.
export function actionKeys(report: Report, finding: Finding): string[] {
  if (finding.kind !== "actions") return [];
  const repository = report.repositories.find(
    (r) => r.repo.id === finding.repositoryId,
  );
  return (repository?.runs ?? [])
    .filter(
      (run) =>
        failures.has(run.conclusion) &&
        finding.evidence.some((e) => e.url === run.url),
    )
    .map((run) => `${finding.repositoryId}:${run.id}:${run.attempt ?? 1}`);
}

export function visibleFindings(report: Report): Finding[] {
  const reported = new Set(report.reportedActions ?? []);
  return report.findings.filter((f) => {
    if (f.kind === "issue" || f.kind === "pull_request") {
      const repository = report.repositories.find(
        (r) => r.repo.id === f.repositoryId,
      );
      const items = f.kind === "issue" ? repository?.issues : repository?.prs;
      const scope = f.kind === "issue" ? "issue" : "pr";
      return (
        items?.some((item) => f.scope === `${scope}:${item.number}`) ?? false
      );
    }
    if (f.kind !== "actions") return f.state !== "resolved";
    const keys = actionKeys(report, f);
    return (
      f.state !== "resolved" &&
      (!keys.length || keys.some((key) => !reported.has(key)))
    );
  });
}
