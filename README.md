# github-repo-scan

Weekly GitHub repository health reports with links, recommendations, and a Markdown handoff for Codex. Planned stack: Cloudflare, GitHub, and Resend.

**Status: planning scaffold with a working secret-check command and CI.** The public repository contains the implementation plan and default scan policy. The scanner, convenience CLI, scheduled workflow, Cloudflare resources, and email delivery have not been implemented or enabled.

## Project guides

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): architecture, reuse, delivery, credentials, acceptance tests, and the path toward bounded automation.
- [Repository selection](docs/REPOSITORY_SELECTION.md): add/remove repositories, archived opt-ins, selection precedence, and the planned CLI.
- [Example Codex handoff](docs/EXAMPLE_CODEX_HANDOFF.md): portable weekly attachment format, using clearly dated historical cases.
- [Contributor instructions](AGENTS.md): project boundaries and document ownership.

## Scan settings

Edit [config/scan.json](config/scan.json) locally or with GitHub's file editor for public-safe settings. This is the default active policy; one complete private R2 policy bundle can replace it when private configuration is needed. The [schema](config/scan.schema.json) defines its structure; the selection guide defines its behavior.

Defaults discover accessible `aindaco1` repositories, include private repositories and forks, and exclude archived repositories plus `aindaco1/burque-presente`. You can choose specific repositories instead, keep persistent exclusions, and enable archived scanning globally or for individual repositories.

Once implemented, the scanner will read the latest validated policy from this repository's default branch at the start of each run, so changing scan coverage will not require a Worker deployment. For now, edits update the checked-in plan/configuration only.

The agreed report delivery target is Sunday at 08:00 America/Denver, with an attached Markdown file. Sender and recipient are private deployment configuration. v1 will collect and recommend; maintenance actions are performed separately through Codex under the owner's authorization.

## Secret checks

After cloning, initialize the pinned public Platform submodule and run:

```sh
git submodule update --init --recursive
npm run security:secrets
```

This reuses Dust Wave Platform's scanner for tracked files and known local secrets, and checks reachable Git history for the same credential patterns. CI runs it on pushes and pull requests without production credentials. See [public-source and secret handling](docs/SECURITY.md) for its scope and limits.

Private report contents, private repository-specific policy, personal email addresses, and provider account inventories are not public source. Use the selection guide's private-policy source when configuration itself needs to name private repositories.
