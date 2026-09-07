# Configuration

The scanner uses Cloudflare Email Sending. It requires no Resend credential.

## Local development

Use Node 24 or newer, initialize the pinned submodule, and run `npm ci`. `npm run dev` starts a local Worker with scheduling and sending disabled. `npm run check` validates settings, secrets/history, types, tests, dependency audit and a dry Worker build. Tests use synthetic data and require no credentials.

Ignored `.dev.vars` contains local settings. The local operator tools also read `.private/runtime-secrets.json`, generated during App setup. Never commit either file or show their values in CI. `.env.example` documents names only. App registration uses `node scripts/register-app.mjs`; GitHub names the App **Dust Wave Repo Scan** because App names cannot begin with GitHub. The product/repository remains `github-repo-scan`.

## Runtime secrets

| Name | Purpose |
| --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Dedicated App identity; PKCS8 PEM for Web Crypto. Installation tokens are minted in memory and refreshed before expiry. |
| `ADMIN_TOKEN` | Distinct random bearer token for operator endpoints. |
| `DIGEST_FROM_EMAIL`, `DIGEST_TO_EMAIL`, `DIGEST_FROM_NAME` | Existing Opportunity Radar addresses and scanner display name. |
| `EMAIL_EVENT_ACCOUNT_ID`, `EMAIL_EVENT_SUBSCRIPTION_ID`, `EMAIL_EVENT_DOMAIN` | Validate the Cloudflare delivery-event source against this deployment. |

The App has read-only Actions, Checks, Contents, Commit statuses, Deployments, Issues, Metadata and Pull requests permissions. Its installation covers current and future owner repositories. It cannot merge, write source, change issues or dispatch workflows. Other owners require separately authorized installation access; editing policy alone cannot grant it.

## Deployment configuration

Public `wrangler.jsonc` is a safe local/dry-build configuration. Actual resource IDs, restricted email bindings and deployment settings are in ignored `.private/deployment.json`. `scripts/deploy.ts` creates a temporary mode-0600 derived Wrangler configuration, removes it afterward, and retains provider output privately. The GitHub deployment uses the same script and an encrypted deployment configuration secret. Runtime App secrets are not required in public CI.

Reviewed runtime controls:

- `CONTROL_REPOSITORY`: fixed policy repository; currently this project.
- `POLICY_SOURCE`: `github` reads `config/scan.json`, `config/repos.json`, `config/dispositions.json` at one exact default-branch commit; `r2` reads one complete private versioned bundle. No overlay or fallback.
- `SCHEDULE_ENABLED`, `SEND_ENABLED`: explicit independent switches.
- `FIRST_WEEKLY_SLOT`: first permitted weekly ID. Earlier due slots are reported as awaiting first schedule.

Local operator commands need `WORKER_URL` and `ADMIN_TOKEN`. GitHub deployment credentials belong in its protected `production` environment. Deployment requires account-scoped Workers Scripts/D1 access and any queue-binding permissions required by Wrangler; it does not need permission to change DNS or Opportunity Radar's inbound routes.

See [repository selection](REPOSITORY_SELECTION.md) for user-editable scope, [email](EMAIL.md) for delivery semantics, and [operations](OPERATIONS.md) for validation and recovery.
