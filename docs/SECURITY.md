# Public source and secret handling

This repository is public. Its source and synthetic examples may be published; operational reports, credentials, personal delivery addresses, private repository context and provider account inventories may not.

## Checks that run now

`npm run security:secrets` calls the pinned Dust Wave Platform scanner. The consumer adapter adds reachable Git-history scanning using the same credential patterns, refuses shallow/incomplete history, and rejects tracked private configuration, report, output and key files. It reports file/object identity and finding type, never matched values. `npm run check` also runs regression cases for deleted historical credentials, force-added private configuration, and incomplete history.

The common patterns cover recognizable provider credentials and private key markers. The shared audit additionally compares known token/key/secret values from ignored local `.dev.vars` or `.env` when present. CI does not receive production secrets, so its exact-value comparison is unavailable; it still performs pattern, path and full reachable-history checks.

CI initializes the exact public Platform submodule pin, checks out full history and runs these commands on pushes and pull requests. GitHub secret scanning and push protection provide an additional provider-aware check. Avoid putting production secrets into CI solely to improve scanning.

Pattern scanners cannot prove that a document contains no sensitive information. Review publication diffs for personal addresses, private repository names/URLs, raw logs, report contents and account inventories. Generic unprefixed secrets may evade patterns when their known values are unavailable. An oversized Git object or missing history causes an incomplete audit, not a clean result.

## Storage boundaries

- Commit `.env.example` with empty placeholders; keep actual settings in ignored `.dev.vars`, `.env`, or the deployment secret store.
- Store generated reports in private R2, with local previews under ignored `reports/` or `outputs/`.
- Store explicit private repository policy in the single private policy bundle described in [repository selection](REPOSITORY_SELECTION.md); do not add private names to public GitHub config.
- Keep private bundle source under ignored `.private/`. The runtime must not log its contents, recipient addresses, raw API bodies or signed download URLs.
- A public Actions watchdog may disclose only the radar's own aggregate freshness/delivery state, never private findings or repository inventories.

If a credential is exposed, revoke or rotate it first, then remove it from source and relevant history and investigate access. A later clean commit does not remove an earlier exposure. Public-source preparation must review the actual history being published, not only the working tree.
