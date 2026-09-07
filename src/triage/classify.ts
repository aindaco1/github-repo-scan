import type { Collected, Context, Finding, Disposition } from "../types.ts";
import { hash } from "../util.ts";
const failures = new Set([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
]);
export async function classify(
  c: Collected,
  context: Context = {},
  previous: Finding[] = [],
  dispositions: Disposition[] = [],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const prior = new Map(previous.map((f) => [f.id, f]));
  const add = async (
    part: Partial<Finding> &
      Pick<
        Finding,
        | "id"
        | "kind"
        | "scope"
        | "state"
        | "priority"
        | "title"
        | "evidence"
        | "recommendation"
      >,
  ) => {
    const f: Finding = {
      repositoryId: c.repo.id,
      repository: c.repo.full_name,
      confidence: "observed",
      observedAt: c.observedAt,
      headSha: c.headSha,
      validationGap: null,
      dispositionRef: null,
      signature: "",
      changed: true,
      ...part,
    };
    f.signature = await hash(
      JSON.stringify({
        state: f.state,
        title: f.title,
        evidence: f.evidence,
        headSha: f.headSha,
        validationGap: f.validationGap,
      }),
    );
    const p = prior.get(f.id);
    f.changed = !p || p.signature !== f.signature;
    f.firstSeen = p?.firstSeen ?? p?.observedAt ?? f.observedAt;
    const d = dispositions.find((d) => d.findingId === f.id);
    if (d) {
      const doc = c.docs.find(
        (doc) =>
          doc.path === d.reference.path &&
          c.repo.full_name.toLowerCase() ===
            d.reference.repository.toLowerCase(),
      );
      if (
        d.signature === f.signature &&
        doc?.hash === d.reference.sha256 &&
        Date.parse(d.revisitAt) > Date.parse(c.observedAt)
      ) {
        f.state = d.state;
        f.priority = "watch";
        f.dispositionRef = d.url;
        f.recommendation = d.reason;
        f.changed = !p || p.state !== f.state || p.signature !== f.signature;
      } else
        f.validationGap =
          "The reviewed disposition is expired or its source/evidence changed; revalidate the decision.";
    }
    findings.push(f);
  };
  const groups = new Map<string, any[]>();
  for (const r of c.runs) {
    const key = `${r.workflowId}:${r.event}:${r.branch}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [scope, runs] of groups) {
    runs.sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.attempt - a.attempt,
    );
    const meaningful = runs.filter(
      (r) =>
        r.status === "completed" &&
        !["cancelled", "skipped", "neutral"].includes(r.conclusion),
    );
    const latest = meaningful[0];
    if (!latest) continue;
    const workflow = c.workflows.find((w) => w.id === latest.workflowId);
    const retired =
      !c.gaps.some((g) => g.area === "workflows") &&
      (!workflow || workflow.state !== "active");
    const closedPr =
      latest.event === "pull_request" &&
      !c.gaps.some((g) => g.area === "pulls" || g.area.startsWith("pr_")) &&
      !c.prs.some((p) => latest.pullNumbers.includes(p.number));
    const failing = failures.has(latest.conclusion),
      lastFailure = meaningful.find((r) => failures.has(r.conclusion));
    if (!failing && !lastFailure && !prior.has(`${c.repo.id}:actions:${scope}`))
      continue;
    if (!failing && latest.conclusion !== "success") continue;
    const historical =
      c.repo.archived ||
      retired ||
      closedPr ||
      (!c.gaps.some((g) => g.area === "branches") &&
        c.branches &&
        !c.branches.includes(latest.branch) &&
        latest.branch !== c.repo.default_branch);
    const jobs = c.jobs[String(latest.id)] ?? [];
    const failed = jobs.filter((j) => failures.has(j.conclusion));
    const step = failed
      .flatMap((j) =>
        (j.steps ?? [])
          .filter((s: any) => failures.has(s.conclusion))
          .map((s: any) => `${j.name} / ${s.name}`),
      )
      .slice(0, 5)
      .join("; ");
    await add({
      id: `${c.repo.id}:actions:${scope}`,
      kind: "actions",
      scope,
      state: failing
        ? historical
          ? "review_candidate"
          : "active_failure"
        : "resolved",
      priority:
        !failing || historical
          ? "watch"
          : latest.branch === c.repo.default_branch
            ? "act"
            : "review",
      title: `${workflow?.name ?? latest.name}: ${failing ? latest.conclusion : "recovered"}${historical ? " (historical scope)" : ""}`,
      headSha: latest.sha,
      evidence: [
        {
          url: latest.url,
          label: `${latest.event} · ${latest.branch} · attempt ${latest.attempt}`,
          sha: latest.sha,
          at: latest.createdAt,
        },
        ...(lastFailure && !failing
          ? [
              {
                url: lastFailure.url,
                label: "Prior failure",
                sha: lastFailure.sha,
                at: lastFailure.createdAt,
              },
            ]
          : []),
      ],
      recommendation: failing
        ? `${historical ? "Confirm whether this archived, retired, removed-branch, or closed-PR path still matters before proposing work. " : ""}Inspect ${step || "the failed run and job annotations"}, reproduce through that workflow entry point, and add a regression check before repairing. Recheck current source and deployment separately.`
        : "A newer successful run in the same workflow/event/branch supersedes the failure. Check any separate deployment or acceptance gate before declaring the project ready.",
    });
  }
  for (const pr of c.prs) {
    const checkFailures = (pr.checks ?? []).filter((c: any) =>
        failures.has(c.conclusion),
      ),
      latestStatus = new Map();
    for (const s of pr.statuses ?? [])
      if (!latestStatus.has(s.context)) latestStatus.set(s.context, s);
    const badStatuses = [...latestStatus.values()].filter((s: any) =>
      ["failure", "error"].includes(s.state),
    );
    const reviews = new Map();
    for (const review of pr.reviews ?? [])
      if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
        reviews.set(review.author, review);
    const requests = [...reviews.values()].filter(
      (r: any) => r.state === "CHANGES_REQUESTED",
    );
    const approvals = [...reviews.values()].filter(
      (r: any) => r.state === "APPROVED" && r.commitId === pr.headSha,
    ).length;
    const stale =
      !c.repo.archived &&
      Date.parse(c.observedAt) - Date.parse(pr.updatedAt) > 30 * 86400_000;
    await add({
      id: `${c.repo.id}:pr:${pr.number}`,
      kind: "pull_request",
      scope: `pr:${pr.number}`,
      state: pr.unavailable ? "unknown" : "review_candidate",
      priority: "review",
      title: `PR #${pr.number}: ${pr.title}`,
      headSha: pr.headSha,
      evidence: [
        {
          url: pr.url,
          label: "Open pull request",
          sha: pr.headSha,
          at: pr.updatedAt,
        },
      ],
      validationGap:
        "Required-check policy and deployment/provider/installed-device acceptance must be verified before merge.",
      recommendation: pr.unavailable
        ? "Restore PR detail access before evaluating this change."
        : `${pr.draft ? "Draft: confirm the author considers it ready. " : ""}${stale ? "Inactive for 30+ days: compare its purpose with current source before updating or closing. " : ""}${checkFailures.length + badStatuses.length ? `${checkFailures.length + badStatuses.length} failing checks/statuses: inspect and repair on this exact head. ` : ""}${requests.length ? "Changes requested remain: resolve reviewer concerns. " : ""}${pr.mergeable === false ? "Merge conflicts need resolution. " : pr.mergeable === null ? "GitHub mergeability is still unknown. " : ""}${approvals} approval(s) match the current head. Review the diff, shared dependency compatibility and repository instructions; green checks alone do not establish merge safety.`,
    });
  }
  for (const issue of c.issues) {
    const acceptance = issue.labels.some((l: string) =>
      /needs-hardware|acceptance|blocked|provider|manual-test/i.test(l),
    );
    const stale =
      !c.repo.archived &&
      Date.parse(c.observedAt) - Date.parse(issue.updatedAt) > 90 * 86400_000;
    await add({
      id: `${c.repo.id}:issue:${issue.number}`,
      kind: "issue",
      scope: `issue:${issue.number}`,
      state: acceptance ? "acceptance_gap" : "review_candidate",
      priority: "review",
      title: `Issue #${issue.number}: ${issue.title}`,
      evidence: [{ url: issue.url, label: "Open issue", at: issue.updatedAt }],
      validationGap: acceptance
        ? "The issue labels identify an outstanding acceptance or external dependency."
        : null,
      recommendation: `${stale ? "Inactive for 90+ days: review against current documentation and releases. " : ""}${acceptance ? "Identify and obtain the named hardware, provider or acceptance evidence; separate a code fix from the missing proof." : "Compare the issue checklist with current source, PRs and release evidence; update its status or implement a justified fix."} Age alone is not a reason to close it.`,
    });
  }
  for (const e of context.expectations ?? []) {
    if (c.repo.archived) continue;
    const run = c.runs.find(
      (r) =>
        r.path.split("@")[0] === e.workflow &&
        r.event === e.event &&
        r.branch === (e.branch ?? c.repo.default_branch),
    );
    if (
      !run ||
      Date.parse(c.observedAt) - Date.parse(run.createdAt) >
        e.maxAgeHours * 3600_000
    )
      await add({
        id: `${c.repo.id}:freshness:${e.workflow}:${e.event}`,
        kind: "schedule",
        scope: e.workflow,
        state: "acceptance_gap",
        priority: "act",
        title: `Missing expected execution: ${e.workflow}`,
        evidence: [
          {
            url: run?.url ?? `${c.repo.html_url}/actions`,
            label: run ? "Last matching run" : "Actions",
          },
        ],
        recommendation: `Verify the ${e.event} trigger, GitHub workflow enablement and its ${e.maxAgeHours}-hour expectation. A manual success cannot replace scheduled acceptance.`,
      });
  }
  for (const a of c.artifacts) {
    const r = a.result,
      missing =
        a.adapter === "podcast"
          ? !r.platformReady || !r.launchReady
          : r.status !== "healthy" || r.scheduledAcceptance !== "complete";
    if (missing)
      await add({
        id: `${c.repo.id}:acceptance:${a.workflow}`,
        kind: "readiness",
        scope: a.workflow,
        state: "acceptance_gap",
        priority:
          r.platformReady === false || r.status === "failed" ? "act" : "review",
        title:
          a.adapter === "podcast"
            ? `Readiness: platform ${r.platformReady ? "ready" : "blocked"}, launch ${r.launchReady ? "ready" : "blocked"}`
            : "Scheduled acceptance remains incomplete",
        headSha: a.sha,
        evidence: [
          {
            url: a.url,
            label: `Validated ${a.adapter} JSON artifact`,
            sha: a.sha,
            at: a.at,
          },
        ],
        validationGap:
          a.adapter === "podcast"
            ? r.nodes
                .filter((n: any) => n.status !== "PASS")
                .map((n: any) => `${n.id}: ${n.status} — ${n.detail}`)
                .join("\n")
            : r.errors.join("\n"),
        recommendation:
          "Use the existing project gate and canonical runbook to obtain the missing evidence. PASS, BLOCK, WAIT and DEFER remain distinct; a green monitoring job does not imply readiness.",
      });
  }
  for (const gap of c.gaps)
    await add({
      id: `${c.repo.id}:unknown:${gap.area}`,
      kind: "coverage",
      scope: gap.area,
      state: "unknown",
      priority: "review",
      title: `Incomplete ${gap.area}: ${gap.code}`,
      evidence: [{ url: c.repo.html_url, label: "Repository" }],
      recommendation:
        "Restore API access or inspect the collection error and repeat a read-only scan. Do not infer resolution from missing results.",
    });
  return findings;
}
