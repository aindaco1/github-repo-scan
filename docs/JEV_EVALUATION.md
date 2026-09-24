# Jev development evaluation

Jev checks whether the scanner's report wording preserves its evidence. It is
developer tooling: the production CLI, Worker, schedule and email delivery remain
deterministic and have no Jev request or credential dependency. Normal CI is offline.

## Shared implementation

The consumer pins Platform `60d439b887f1244f82ff232c849d74152b28c776` and
`@dustwave/test-core` **0.3.0**. Its `jev` export owns request construction,
response validation, review decisions and bounded Cloudflare transport. This
repository owns the synthetic cases, report capture, requirements, budgets,
credential acquisition, evidence and interpretation. There is no copied API client.

Like CutNotes, exact tests and semantic evaluation answer different questions.
Selection, identifiers, pagination, receipt persistence, retries, hashes and
delivery state remain deterministic test responsibilities. Jev cannot establish
live deployment, email receipt or scheduled-cycle acceptance.

## Run it

From an initialized checkout using Node 24 or newer:

```sh
npm ci
npm run check
npm run jev -- --out outputs/jev/preview-001
```

The preview captures real `buildReport` and `renderReport` output and prepares
40 questions without reading credentials or making network calls. It deliberately
records `complete: false`, 40 unevaluated questions and `releaseAccepted: false`.
An existing output directory is refused; choose a new name for each invocation.
To recheck a bounded subset, repeat `--case BUILT_IN_ID` using IDs from the preview.
Unknown or duplicate IDs are rejected before credentials; there is no custom
case-file input. Budgets apply to the selected questions. Include the corresponding
negative controls, and account for all batches within an authorized trial.

An explicitly chosen live run uses process-only `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, with Workers AI access. Obtain them through an approved
credential source without putting values in commands, committed files or logs.
The evaluator does not discover another project's secrets, read production radar
configuration, refresh authentication or purchase credits.

```sh
npm run check
npm run jev -- --live --max-usd 0.10 --out outputs/jev/live-001
```

The entire batch is checked before credential access: at most 64 questions,
32,000 UTF-8 bytes per request and a conservative reservation of 32,000 input
tokens per question. The current 40-question reservation is **$0.05376** at the
September 24, 2026 [TypeSafe input list rate](https://docs.typesafe.ai/models).
`--max-usd` must cover the reservation and cannot exceed $0.10. This is an estimate,
not a provider billing cap; account-specific prices and fees must be checked in
the [Cloudflare dashboard](https://developers.cloudflare.com/ai/models/typesafe/jev/).
The shared transport has a 15-second deadline per request, bounded response
streaming, rejected redirects and no retries or fallback. Execution is sequential.

No user-supplied report, fixture path, repository URL or private content input is
accepted. Live payloads contain only source-reviewed public synthetic controls.
Adding a fixture requires reviewing its content, not merely labeling it synthetic.

## What the corpus covers

The [case builder](../test/fixtures/jev-cases.ts) uses the existing test factories,
selection resolver, classifier and renderer. It captures plain-text email, HTML
email and the Markdown handoff for six scenarios, plus two handoff-only checks:

| Scenario | Regression to catch |
| --- | --- |
| Private collection failure | Missing access presented as no open work or healthy coverage |
| Manual success | Scheduled acceptance presented as complete without a scheduled run |
| Hardware issue | Green CI or age used to close missing physical acceptance |
| Green PR | Passing checks used as sufficient evidence of merge safety |
| Owner deferral | Conditional waiting turned into completed acceptance or immediate publication |
| Delivered failure notification | Suppression mistaken for recovery |
| Archived handoff | Read-only scan opt-in treated as permission to unarchive |
| Operating brief | Report text grants external-action authority or ignores existing user authorization |

Each capture has a deliberately flawed variant. Expected labels stay outside
model inputs. The source reference cannot earn credit for information omitted
from the candidate. The exact corpus, requests, policy and relevant source files
are hashed in each evidence record. A stable synthetic completion timestamp keeps
repeated captures comparable.

These 20 pairs are engineering controls, not independent human calibration or
a held-out validation set. The test suite runs a narrow faithful simulator and a
deliberately naive reference-crediting simulator through the same scoring path.
It requires the predeclared **20 false passes** and exact trap IDs from the naive
simulator. Simulated results prove the harness can detect that shortcut; they do
not measure Jev's accuracy.

## Read the evidence

Each new `outputs/jev/NAME/report.json` contains requests, expected labels,
validated answer distributions, returned model, token counts, latency, provenance
and aggregate false passes, false failures, reviews and unevaluated questions.
It excludes credentials and arbitrary provider envelopes/debug metadata. This
directory is ignored and must not become a public CI artifact.

Before every provider request, an atomic checkpoint records pending intent.
Persistence failure stops transport. A failed request stops the batch; an interrupted
pending attempt may have been billed and must not be replayed automatically.
Unknown or failed evaluations are never passes. Incomplete token accounting is
explicit. Reported-token estimates are separate from the preflight reservation;
neither is a billing receipt.

The provisional policy recognizes `jev-1.13.0` and routes ties, uncertainty and
margins below 0.10 to review. It is **uncalibrated for this project**. The Cloudflare
route is an alias, so the returned version is checked on every answer. Keep
requirements and labels frozen during comparisons; do not lower the margin to
make failures green. Inspect disagreements and collect fresh, independently
labeled holdouts before making reliability claims or adding a live CI gate.

Exit codes: **0** for an offline preview or a completed run matching all labels;
**1** for a completed run with disagreement/review; **2** for incomplete evaluation
or setup, transport, validation or persistence failure. A matching negative control
is a successful test of the judge. `complete` means the evaluation finished;
`releaseAccepted` always remains false.

## Migration and verification

The prior Platform pin was `0f3d9fe` (Worker Core 0.12.1, Digest Core 0.1.0).
This pin adds Test Core 0.3.0 and advances Worker Core to 0.15.0; Digest Core is
unchanged. Existing runtime imports retain their implementation, apart from an
additive crypto export. The secret scanner's stateless GitHub-token detection is
preserved. `npm run platform:check` uses Platform's consumer-pin helper to verify
the initialized checkout, staged gitlink, exact package versions and lockfile.
When intentionally updating a pin, stage that gitlink before running the check.

Rollback restores this consumer's previous gitlink, manifest/lockfile and testing
adapter together. No data migration or other consumer change is needed. Production
acceptance remains in [Operations](OPERATIONS.md).

## September 24, 2026 local trial

The owner selected explicit developer runs with offline normal CI and authorized
a public synthetic trial within a $0.10 estimate. Both batches returned Jev 1.13.0.

| Batch | Questions | Label matches | Bad controls accepted | Reviews / unevaluated |
| --- | ---: | ---: | ---: | ---: |
| Initial complete corpus | 40 | 39 | 0 of 20 | 0 / 0 |
| Private-coverage recheck after the renderer fix | 6 | 6 | 0 of 3 | 0 / 0 |

The initial `private-coverage-text-current` answer was fail 0.79, pass 0.21.
Inspection confirmed a real omission: HTML qualified empty inventory results when
coverage was incomplete, while plain text omitted that warning. A new deterministic
test reproduced the failure. Both formats now share one empty-result message.
The original expected-pass label described intended behavior; its recorded
`falseFailures: 1` counts the disagreement, not a demonstrated judge error. The
original evidence and label remain unchanged.

A new full offline capture proved that only this one candidate changed. All
questions, references and policy stayed identical. The six-question live recheck
covered the private-coverage positive/negative pair in all three formats; it was
not a second full-corpus run or independent holdout. This useful detection does
not calibrate the provisional policy or establish general accuracy.

The 46 requests reported 34,227 input tokens: estimated inference **$0.001437534**,
with conservative preflight reservations totaling **$0.061824**. These figures
exclude account-specific fees and are not billing receipts. There were no retries,
fallbacks or purchases, and no private reports were transmitted.

Evidence remains in ignored local directories:

- `outputs/jev/live-20260924-001/report.json`: initial corpus hash
  `aa2345a4e8f14222bd6b70b68424637b1f3bf97fb4e3e39616095bfa68d98e16`.
- `outputs/jev/fixed-preview-001/report.json`: full updated offline capture.
- `outputs/jev/live-20260924-fix-001/report.json`: selected recheck corpus hash
  `1a92823fd413a5c93b0d344d23a3c5717f863c4ed848f943516b0715f57f9cf9`.
- Both live runs use policy hash
  `9241177b9ea1e992a97aade04e61ebd8de34d0f91f33aa032353017dbeafd260`.

Local `npm run check` passed: 85 application tests, three history/security tests,
types, configuration/documentation, full reachable-history audit, dependency audit
and a dry Worker build. Platform passed 347 tests and both recipe integrations
from an isolated checkout; in the nested checkout its declaration test picks up
the consumer's parent TypeScript configuration. Two malformed local iCloud-style
duplicate Git refs were preserved as `recovered-main-icloud-2` and
`recovered-origin-main-icloud-2`, restoring complete history audit coverage.
This record describes local integration and its live synthetic trial. Publication,
deployment and the independently verified scheduled-delivery state are recorded
separately in [Operations](OPERATIONS.md).
