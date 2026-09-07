# Repository selection

This is the implementation contract for changing scan coverage. The default [policy](../config/scan.json) and its [JSON Schema](../config/scan.schema.json) are checked in. The same implemented resolver and commands serve local previews and the Worker.

## One editable policy

`config/scan.json` is the default active repository-selection source, for public-safe settings. Edit it in your checkout or open the file in GitHub and use **Edit**. A validated change merged into the default branch takes effect on the next scan without deploying the Worker. GitHub settings CI checks the same schema and resolver used locally and at runtime.

| Field | Meaning |
| --- | --- |
| `mode` | `discover`: discover configured owners and add explicit inclusions. `selected`: use only `include`. |
| `owners` | Accounts to discover in `discover` mode; defaults to `aindaco1`. Retained but inactive in `selected` mode. |
| `include` | Exact `owner/repo` names to add, or the complete candidate list in `selected` mode. |
| `exclude` | Exact names to keep out of the scan, including future rediscovery. Exclusion wins over inclusion. |
| `includeArchived` | Global archived-repository setting; defaults to `false`. |
| `includeForks` | Global fork setting; defaults to `true`, matching the original scans. |
| `overrides` | Optional per-repository `includeArchived` and/or `includeForks` booleans. They override those global settings, but never an explicit exclusion. |

The current defaults scan accessible private and public repositories of `aindaco1`, including forks, with archived repositories and `aindaco1/burque-presente` excluded. They also discover this project itself once the GitHub App can access it. Defaults are preferences the owner can change.

## Required private-repository access

Private-repository scanning is required in the first release, including discovery, Actions, issues, PRs, configured documentation and relevant artifacts. It uses authorized GitHub App installation tokens; the visibility of this source repository has no bearing on which target repositories those credentials can read.

At setup, compare the App's discovered repository IDs to an authenticated owner inventory and retain the expected private target IDs only in private runtime state. Default discovery must reach every intended non-excluded private repository, not just one demonstration target. A selected-repositories App installation is acceptable only when its scope matches the user's selected policy; otherwise flag coverage as restricted/incomplete. Changes to the configured selection may require separately updating App access.

Prove access with a real private-repository preview and positive/negative API coverage, including private repository metadata, Actions/jobs, issues, PRs and configured content/artifacts. Fixtures alone and a passing public-repository scan are insufficient. At every run, distinguish removed authorization, suspended installation, expired tokens and private 404 ambiguity from a repository with zero open work. Never use unauthenticated or public-only collection as a success fallback.

Production evidence remains in private D1/R2 and the owner's email attachment. Public CI runs synthetic public/private fixtures with no production credential; live preview output, private names, IDs and links must never become public build artifacts or logs.

## Private repository settings

Automatic discovery can scan accessible private repositories without publishing their names: discovery results and reports remain private. Never put private repository names, private documentation URLs, or sensitive dispositions in the public policy.

If explicit private configuration is required, use `POLICY_SOURCE=r2` and store **one complete versioned policy bundle** in the private R2 bucket. That bundle owns the selection, context and disposition files; it replaces the public GitHub policy as the active source. There is no public/private overlay and no duplicate live settings. Keep its editable local source in ignored `.private/`, and use the operator CLI to validate, preview and atomically publish a new bundle. Public `config/scan.json` then serves as the safe example only.

The schema, selection resolver and add/remove/archive commands are shared across both sources. With the private source selected, commands operate on the ignored local policy and report that a private bundle publication is required. The runtime snapshots one immutable bundle version just as it snapshots a Git commit. Switching sources is an explicit operator configuration change with preview; a missing bundle fails visibly instead of falling back to public defaults.

## Common changes

- **Add a repository:** add its full name to `include` and remove it from `exclude` if present. Explicit inclusion still obeys archive/fork settings and GitHub access permissions.
- **Remove a repository:** add its full name to `exclude`; remove any matching `include` entry and override. Merely deleting it from `include` would not remove it from owner discovery.
- **Scan all accessible archived repositories in scope:** set `includeArchived` to `true`. This does not remove explicit exclusions or per-repo overrides that remain `false`.
- **Include one archived repository:** ensure it is a candidate, remove any exclusion, and set `overrides["owner/repo"].includeArchived` to `true`.
- **Scan only a chosen list:** set `mode` to `selected` and list names under `include`. Archive/fork settings and exclusions still apply.

For example, to scan an archived repository named `aindaco1/example-archive`, add it to `include` and add this override while leaving the global archived setting false:

```json
{
  "aindaco1/example-archive": {
    "includeArchived": true
  }
}
```

This is an illustrative `overrides` object, not a real repository or a complete replacement configuration.

## Easy CLI operations

The CLI uses the same policy parser, validator and selection resolver as the Worker. Mutating commands edit the local active policy (`config/scan.json` for GitHub, ignored `.private/` for R2), print a local diff, and do not commit, push, scan or send mail. Private diffs are never uploaded to CI or public logs. Publishing that settings change follows the repository's normal GitHub workflow.

```text
npm run radar -- repos list --all
npm run radar -- repos add aindaco1/example
npm run radar -- repos remove aindaco1/example
npm run radar -- repos add aindaco1/example-archive --include-archived
npm run radar -- repos archived on
npm run radar -- repos archived off
npm run radar -- repos archived on --repo aindaco1/example-archive
npm run radar -- repos mode selected
npm run radar -- repos mode discover
```

`add` inserts into `include` and clears the exact exclusion. `remove` inserts into `exclude`, removes the exact inclusion and removes its override. `--include-archived` is an explicit per-repo opt-in. `archived on/off` changes the global flag; with `--repo` it changes that repository's override and requires an existing candidate. It does not clear exclusions. These commands normalize case, deduplicate, validate before writing and make the edit atomically.

`repos list --all` is read-only. It previews selected, excluded, unavailable and invalid entries with a reason such as `owner_discovery`, `explicit_include`, `explicit_exclude`, `archived_default`, `archived_override`, `fork_filter`, or `not_accessible`. It displays the policy commit/hash and archive/fork status. It performs only the metadata reads needed to resolve coverage, not full Actions/issues/PR collection. Live selection preview requires App credentials. Use synthetic fixture previews for offline testing; they make no live-access claim.

Avoid a separate settings dashboard or configuration-editing bot in v1: GitHub's file editor and the local CLI cover the simple use cases without another application or credential with repository-write access.

## Selection order and edge cases

1. Load one policy snapshot from the configured source: the fixed control repository `aindaco1/github-repo-scan` and its default branch, or one immutable private R2 bundle. Record its exact commit/version and content hash. Fetch policy and optional context/disposition files from that same snapshot. Validate schema, reject duplicate JSON keys, normalize identities case-insensitively, and reject invalid/unsupported semantics before scanning. An invalid or unavailable policy fails visibly; never replace it silently with broader defaults or old policy.
2. In `discover` mode, enumerate the configured owners' accessible repositories through their authorized App installations, then union with `include`. In `selected` mode, use only `include`. `owners` never adds candidates in selected mode, and `overrides` never creates candidates by itself. An override for a nonexistent/unselected candidate is a configuration error; an inaccessible intended candidate is a coverage error.
3. Apply explicit exclusions before detail collection. Where already-known identity is sufficient, make no repository detail request for excluded candidates. Discovery metadata may include excluded repositories because it is needed to evaluate the set.
4. Resolve required metadata and access for remaining candidates. Apply effective archive and fork settings: the per-repo boolean, when supplied, otherwise the global boolean. Both filters must permit the repository. Being explicitly included does not bypass either filter.
5. Deduplicate by stable GitHub repository ID, then collect Actions, issues and PRs only for the selected set. Output selected/excluded/unavailable names, IDs when available, reasons, and policy provenance.

An empty `selected` list is a valid intentionally empty scope; report **NO REPOSITORIES SELECTED**, not a fleet all-clear. An inaccessible explicit inclusion or configured discovery owner makes coverage partial/failed, with a concrete access/setup recommendation. Adding another owner's repository never creates access automatically; its App installation must authorize it.

Use previous inventory IDs to recognize renames. A known exclusion follows the same repository ID until the user explicitly changes it; report the rename and propose updating the configured name. Do not accidentally re-include a renamed excluded repository, and do not follow a transfer to a new owner implicitly. If identity cannot be verified, flag that selection ambiguity and stop scanning the affected candidate. Resolve names once per run; never hide an ambiguous typo or permission failure as a healthy empty list.

The schema checks JSON structure; the shared resolver checks access, candidates, identity and precedence. Each private report/attachment embeds its effective selection policy and config commit/bundle version. In-flight scans keep the snapshot they started with; a merged edit affects the next run. Removing or newly excluding a repository marks previous findings **out of scope**, preserving their history rather than claiming the underlying problems were fixed.

## Archived repositories

Archived opt-ins allow reads only. The scanner never unarchives a repository, dispatches a workflow, opens an issue, or makes a fix. Show the archive state and historical dates prominently. Suppress ordinary missed-schedule/stale-PR alarms caused solely by the archive being inactive; retain explicit unresolved issues and useful historical failures as context. A configured, still-relevant acceptance requirement may remain visible, with the reason spelled out.

Codex receiving the attachment must honor that distinction and revalidate the current scope. If maintenance would require unarchiving, it presents that as a separate action requiring authorization rather than interpreting a scan opt-in as permission.

## Acceptance coverage

Behavior tests must cover discovery versus selected mode; add/remove persistence; include/exclude conflicts; global/per-repo archive and fork precedence; empty scope; real private-target onboarding plus synthetic lost-access/empty-private-target distinctions; private access failures; unknown overrides; case/rename/transfer handling; invalid JSON or schema; policy changes during a run; archived historical reporting; and the same selection results through CLI and Worker. Settings checks must validate the committed default policy, and a live preview must show the selected set and reasons before schedule activation.
