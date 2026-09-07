# Operations

## Everyday commands

```sh
npm run radar -- repos list --all --private
npm run radar -- repos add owner/repository --private
npm run radar -- repos remove owner/repository --private
npm run radar -- repos archived on --repo owner/archive --private
npm run radar -- policy publish --private
npm run radar -- scan --preview --private
npm run radar -- run
npm run radar -- runs
npm run radar -- download RUN_ID
```

The current deployment uses one complete private R2 policy bundle because some context describes private projects. Edit ignored `.private/policy.json`; `--private` makes the same validated CLI operate on it. Publish explicitly after reviewing scope. Public `config/scan.json` remains the safe example. If the deployment uses GitHub policy instead, omit `--private` and merge configuration changes to its default branch; the next scan reads the new commit without redeployment.

`scan --preview` writes ignored local reports and never sends. `run` starts a hosted preview; `run --send` sends a fresh authorized report to the fixed existing recipient. It cannot change recipients. `download` uses the authenticated operator endpoint and saves privately. Open its Markdown in Codex to investigate under the owner's current authorization. Do not upload report bundles as public GitHub artifacts.

## Provisioning and deployment

1. Register the read-only App with `node scripts/register-app.mjs`, complete GitHub's required verification and install it on all intended owner repositories. Store its PEM privately in PKCS8 format. Run `npm run radar -- onboard` to compare owner and App inventories.
2. Provision the scanner's own D1, private R2, Workflow and delivery-event queues. Apply ordered migrations; upload the owner baseline to `onboarding/owner-inventory.json` and the active private policy when used.
3. Install runtime secrets directly with Wrangler, configure restricted email binding addresses privately, and deploy with scheduling/sending off. Actual IDs are in `.private/deployment.json`; public config contains safe development placeholders.
4. Run checks and a hosted preview. Verify all intended private targets and compare issue/PR inventory with independent `gh` reads.
5. Enable sending, run the authorized real report, confirm a Cloudflare delivery event and inspect the downloaded Markdown. Enable the Sunday schedule and validate the independent watchdog.

`npm run deploy` uses local Wrangler authentication; the GitHub deployment workflow uses an account-scoped deployment token and private derived configuration. Neither path needs scanned-repository write permission. Routine deployment must not alter Opportunity Radar's inbound routes or credentials.

## Health and recovery

`/health` exposes only service freshness, due slot, coverage state and delivery state. It excludes repository names, report contents, recipients and provider IDs. GitHub checks it Sunday at 18:00 UTC, after the Denver delivery window in either season. The watchdog must fail on missing/partial coverage or missing delivery confirmation. Before the first scheduled date it reports that scheduled acceptance is pending. GitHub's public-repository schedule can be disabled after 60 days of inactivity; verify the watchdog remains enabled and re-enable it if needed. The owner's GitHub Actions notification setting was verified on September 7: email for failed workflows only. The watchdog uses GitHub's existing notification route; the digest uses the existing Opportunity Radar recipient.

`POST /admin/runs/RUN_ID/recover` resumes the same run or delivery. A prepared delivery may send once; an attempted/accepted/ambiguous delivery will never be automatically resent. Inspect the outbox and Cloudflare activity/events first. Recovery preserves the original collection deadline and frozen policy; it cannot turn an expired incomplete scan into a fresh one. A fresh scan gets a new ID and current policy/evidence. Do not treat a new run as a safe email retry when the previous delivery is unresolved.

Collector errors are bounded codes. Source metadata remains in private checkpoints/reports. Private 404 means access-or-removal ambiguity, not deletion. Missing artifacts mean unknown acceptance, not a passing gate. A newer failure invalidates an old incident-specific deferral.

The delivery Queue verifies source/account/subscription/domain and fixed identity. Failed consumption retries through its dead-letter queue. Inspect that queue if provider delivery is visible but D1 remains unconfirmed. Never apply another consumer's delivery event to this scanner.

## Retention and rollback

Retain report bundles for 90 days. Never delete a bundle with unresolved delivery. Keep minimal history for one year and preserve active findings. Cleanup affects only this scanner's data, not repository releases, branches or other projects' builds. Keep current local dependencies, fixtures, preview commands and a compatible deployment rollback.

To stop the service, set `SCHEDULE_ENABLED=false` and `SEND_ENABLED=false` in private deployment configuration and deploy. Preserve D1/R2 for reconciliation. Restore the previous Worker version if needed; migrations remain additive. Changing the Platform pin affects this consumer only. App/key rotation, uncertain-email recovery and report deletion are separate operations.

## Acceptance record

The September 7 setup verified the App against 41 owner repositories, including all 7 private repositories. Default exclusions produced 33 selected repositories, including 2 private targets. A live local preview and a hosted preview both completed with zero collection gaps. These are dated acceptance observations, not fixed scope counts or a claim that all projects are healthy.

The shared presentation passed source characterization in Platform and Opportunity Radar. Opportunity Radar's migration was merged and [deployed through its protected workflow](https://github.com/aindaco1/dust-wave-opportunity-radar/actions/runs/34150762728).

The scanner's [initial implementation CI](https://github.com/aindaco1/github-repo-scan/actions/runs/34152377562) passed. Its real hosted scan on September 7 read 33 repositories, including 2 private targets, 2,767 workflow runs, 1 open PR and 6 open issues with zero coverage gaps. Cloudflare confirmed delivery at **18:42:45 UTC**. The privately downloaded HTML, text and Markdown matched the frozen manifest, and the digest layout was inspected. Run, message and provider event identifiers are retained privately.

The [protected GitHub deployment](https://github.com/aindaco1/github-repo-scan/actions/runs/34153091362) succeeded using a dedicated account-scoped Workers Scripts/D1/Queues token. Scheduling and sending are enabled. First delivery is **Sunday September 13 at 08:00 America/Denver**; the next cycle is September 20. Two real Sunday deliveries remain pending operational acceptance. Manual scans, the successful test email and timezone tests do not satisfy that gate.

Four public incident decisions reference current Podcast/ZEMA canonical documentation and exact finding signatures. They distinguish a repaired historical callback and completed import repair from pending scheduled/benchmark evidence, and preserve the owner's media acceptance deferral. New incident evidence, a changed document hash or the October 7 review date invalidates the matching decision. The real test email preceded these final context refinements; subsequent scans use the published reviewed policy.

Change detection compares against the most recently delivered report. Local and hosted previews cannot consume changes before the recipient sees them.
