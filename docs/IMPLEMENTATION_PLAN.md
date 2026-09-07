# Implementation and acceptance plan

Updated September 7, 2026. The user authorized implementation, deployment and activation using Cloudflare Email Sending. This plan records the product boundaries and acceptance sequence; the implementation details live in the architecture, configuration, selection, email and operations guides.

## Outcome

Send a useful Sunday 08:00 America/Denver report with failed Actions, every open issue/PR, evidence links and deterministic recommendations, plus a self-contained Markdown attachment for Codex. Private repository scanning is mandatory. Default scope includes accessible owner repositories and forks, excluding archives and `burque-presente`, with easy editable selection and explicit archive opt-ins.

The initial release observes and recommends. It never mutates scanned repositories, reruns Actions, closes issues, merges, deploys other projects or deletes branches/builds. The owner separately authorizes Codex maintenance. There is no LLM dependency, dashboard, duplicate knowledge base or general agent framework.

## Delivery architecture

Use one Cloudflare Worker/Workflow, D1, private R2 and Cloudflare Email Sending. A small delivery-event Queue and dead-letter queue provide authoritative mail-server acceptance evidence. GitHub owns source, CI, protected deployment and the independent watchdog. A quarter-hour UTC cron gates on Denver local time, starts Sunday preparation at 07:45 and targets 08:00 delivery; missed starts catch up through 09:00 with the same weekly ID. DST never depends on a fixed offset.

The implementation shares a collector, resolver and report model between CLI and Worker. Reviewed public GitHub policy or one complete private R2 policy bundle is snapshotted once per run. The read-only GitHub App inventory is compared with authenticated owner inventory, including all intended private identities. Missing access and partial pagination are explicit gaps. Per-repository checkpoints survive retries, and immutable rendered bytes prevent changing a report during delivery recovery.

[Architecture](ARCHITECTURE.md), [configuration](CONFIGURATION.md), [email](EMAIL.md), and [repository selection](REPOSITORY_SELECTION.md) own their respective contracts.

## Acceptance gates

1. **Foundation:** public source with shared secret/history audit; strict selection configuration; synthetic previews; types, meaningful regression tests and dry Worker build.
2. **Private collection:** owner/App inventory comparison; live private metadata, Actions/jobs, issues, PRs, docs and configured artifact reads; same depth as public targets. Simulated lost access must differ from an empty private repository. Complete pagination and canonical GitHub repository-ID links must work without leaking credentials across redirects.
3. **Evidence:** preserve workflow/event/branch scope; historical removed/archived branches; exact PR head checks/reviews; semantic readiness artifacts; required check policy and provider/hardware acceptance remain explicit unknowns. Owner deferrals require matching current signatures, canonical source and revisit conditions.
4. **Hosted preview:** D1 migration, private owner baseline and policy, restricted bindings and App secrets; sending/scheduling initially disabled. Confirm complete private/public collection and privately inspect rendered output.
5. **Mail and activation:** one authorized real email with Markdown, independent provider delivery event, authenticated attachment download, duplicate-send regression coverage and rollback controls. Then enable the Sunday schedule and GitHub watchdog.
6. **Operational observation:** verify two consecutive real Sunday reports. A manual run or simulated clock test cannot prove scheduled delivery; the watchdog continues checking this after initial deployment. Keep this acceptance distinction visible in operations records.

The initial target is Sunday September 13, 2026 at 08:00 Denver. If activation occurs later, use the next Sunday. A useful partial report is preferable to silently dropping a repository, but partial coverage must never satisfy launch/health acceptance.

## Path toward self-driving repositories

The [Detail article](https://blog.detail.dev/posts/towards-self-driving-codebases/) motivates a gradual feedback loop: useful evidence first, reliable verification environments next, then bounded automation that earns wider authority.

| Stage | Change | Evidence before progressing |
| --- | --- | --- |
| Radar | Read-only reports and portable Codex handoff | Complete private coverage, trustworthy classification and reliable delivery |
| Better verification | Improve existing repository tests, fixtures and runbooks where failures recur | Regression reproduces the failed entry point; deployment/provider/installed evidence recorded separately |
| Bounded repair drafts | Separately authorized isolated fixes in allowlisted repositories/task types | Small reviewed diffs, current-head checks, budgets, rollback and observed success |
| Selective merge/deploy | Explicit per-repository opt-in through existing protected workflows | Required checks, deployment smoke, proven rollback and a stop switch |

Prioritize recurring missing verification capabilities rather than adding more agents. Track coverage/delivery, recommendation usefulness, time to verified resolution, reopened findings and manual interventions. Detailed decisions stay in each project's canonical docs/issues; reviewed dispositions are only references, not another wiki. Product decisions, provider consent, publication rights and physical-device acceptance retain their actual human boundaries.
