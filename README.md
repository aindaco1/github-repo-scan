# github-repo-scan

Weekly GitHub maintenance reports with evidence links, recommendations and a Markdown handoff for Codex. Runs on Cloudflare using a read-only GitHub App and Cloudflare Email Sending, with Opportunity Radar's existing email identity and shared formatting helpers.

Private-repository scanning is required and implemented. The public source contains no live scan data. Defaults discover owner repositories and forks, excluding archived repositories and `burque-presente`; all of these choices are editable. Sunday delivery is enabled for 08:00 America/Denver. The September 13 and 20, 2026 scheduled reports completed with full coverage and confirmed delivery, verified September 24.

## Use it

```sh
git submodule update --init --recursive
npm ci
npm run check
npm run radar -- preview --fixture test/fixtures/scan.json
npm run radar -- repos list --all --private
npm run radar -- scan --preview --private
```

The current deployment uses a complete private policy bundle in R2. Its ignored local source is `.private/policy.json`; add/remove/archive commands with `--private` edit that file, and `policy publish --private` applies it to the next run. Public-safe installations can instead read the checked-in policy from GitHub at one exact commit. Selection changes do not require a Worker deployment.

The scanner only collects and recommends. It never changes scanned repositories. Emails use headings, bullets and links. Failed Actions appear once after confirmed delivery; open issues and PRs remain in every report until closed. The readable Markdown attachment contains the full open issue/PR inventory, current evidence, scope, uncertainty and a Codex operating brief. Reports and credentials remain private.

Development uses offline regression tests plus an explicit Jev command for public synthetic report checks. Run `npm run jev -- --out outputs/jev/preview-001` for a zero-network preview; see the evaluation guide for bounded live runs. Jev is not part of the deployed scanner.

## Guides

- [Repository selection](docs/REPOSITORY_SELECTION.md): add/remove repositories, archived opt-ins and precedence.
- [Architecture](docs/ARCHITECTURE.md): collector, evidence rules, storage and shared boundaries.
- [Configuration](docs/CONFIGURATION.md): runtime secrets and private deployment settings.
- [Email](docs/EMAIL.md): Opportunity Radar reuse, attachments and delivery reconciliation.
- [Operations](docs/OPERATIONS.md): preview, deployment, health, recovery and rollback.
- [Implementation and acceptance plan](docs/IMPLEMENTATION_PLAN.md): remaining observations and the path toward bounded automation.
- [Security](docs/SECURITY.md): public-source and secret/history checks.
- [Jev evaluation](docs/JEV_EVALUATION.md): offline regression controls and opt-in semantic checks of synthetic report output.
- [Example Codex handoff](docs/EXAMPLE_CODEX_HANDOFF.md): historical illustrative format.
- [Contributor instructions](AGENTS.md).

Deployment, email delivery and scheduled-cycle acceptance are recorded separately in operations. A complete scan proves collection coverage; it does not mean every project is healthy.
