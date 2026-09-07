# Email integration with Opportunity Radar

The scanner must reuse Dust Wave Opportunity Radar's established email identity, presentation and operational conventions. Its own report contents, schedule, attachment and delivery state remain consumer-owned. This is an implementation contract, not evidence of a deployed sender.

## Verified source and provider decision

The inspected Opportunity Radar source at [299aefa3](https://github.com/aindaco1/dust-wave-opportunity-radar/tree/299aefa3b103abae6f263f7e85855f0dd5ac1d27) uses an `EMAIL` Cloudflare Email Sending binding. Its [digest renderer/sender](https://github.com/aindaco1/dust-wave-opportunity-radar/blob/299aefa3b103abae6f263f7e85855f0dd5ac1d27/src/email/digest.ts) produces HTML and plain text, and returns the provider message ID. Its [configuration guide](https://github.com/aindaco1/dust-wave-opportunity-radar/blob/299aefa3b103abae6f263f7e85855f0dd5ac1d27/docs/CONFIGURATION.md) owns the currently configured addresses and binding restrictions.

**Provider decision is pending:** the original brief explicitly requested Resend; the latest instruction requests Opportunity Radar's email setup. Confirm either the same Cloudflare Email Sending service or Resend with the same conventions before implementing or provisioning the transport. Implement only the selected provider, with no automatic fallback that could duplicate mail. Resend-specific details in the main plan remain conditional on retaining that choice.

## What to reuse

| Existing convention | Scanner requirement |
| --- | --- |
| Configured sender and recipient | Use Opportunity Radar's existing addresses, captured privately during setup. Do not invent a new sender. Keep the scanner's display name and subject identifiable as `GitHub Repo Scan`. |
| `DIGEST_FROM_EMAIL`, `DIGEST_TO_EMAIL`, `DIGEST_FROM_NAME` | Retain these names so deployment/configuration tooling stays familiar. Addresses remain ignored local/private deployment configuration in this public repository. |
| HTML plus plain text | Generate both alongside the Codex Markdown from the same normalized report. |
| Digest presentation | Reuse the dark background, cream cards, orange section rules, readable links, responsive layout, and shared escaping/formatting behavior. Preserve the scanner's evidence hierarchy and adapt labels to repository maintenance. |
| Local-time dates | Use `America/Denver` consistently in subject, report and schedule; the scanner retains its agreed Sunday 08:00 target. |
| Recipient and sender restrictions | Restrict the scanner to the agreed addresses. External issue or PR content cannot choose recipients, CC/BCC, reply-to or arbitrary headers. |
| Automation header convention | Retain `X-Dustwave-Automation`, with the scanner-specific value `github-repo-scan`; do not misidentify these messages as opportunity digests. |
| Scheduled runs and send bookkeeping | Retain durable slot identity, frozen rendered payloads, provider message ID and authoritative delivery state. Handle uncertain provider outcomes explicitly. |
| Secret handling and deployment | Use the existing account/domain setup and safe secret-transfer procedures, with a consumer-owned Worker binding or provider key. Runtime reuse does not require reading or copying unrelated source credentials. |

The source suppresses empty opportunity digests. This scanner intentionally retains its weekly all-clear/partial report so the owner can distinguish successful collection from a missing scan. It adds the actual Markdown attachment and separate acceptance-versus-delivery evidence; these are explicit scanner requirements.

## DRY implementation boundary

The existing renderer is application code, not a published shared email component. Do not import a sibling checkout, copy the entire renderer into a second application, or call Opportunity Radar's production Worker as a mail relay.

Characterize the existing opportunity digest and the scanner preview, then extract only genuinely shared presentation/formatting mechanics into a narrow versioned Platform entry. Inject product title, introduction, section/card data and footer. Consumers retain grouping policy, content, storage, addresses, send authority and schedule. Preserve Opportunity Radar's output/behavior through its characterization tests, and record each consumer's independent pin/migration/rollback evidence. Build no general email framework.

Transport adapters remain thin. Reuse existing Platform outbox/failure helpers where they fit the selected service; Resend-specific signing and errors must not be applied to Cloudflare events or failures.

## Transport acceptance

If Cloudflare Email Sending is selected, add a separate `EMAIL` binding for this scanner using the existing onboarded domain and restricted addresses. Keep real binding addresses out of public Wrangler source by deriving a private deployment configuration, following the project's existing safe temporary-config pattern. Cloudflare documents sender/recipient restrictions and native attachments; attach the Markdown with an explicit filename, MIME type and attachment disposition. [Send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

The reviewed Cloudflare `send()` contract does not document Resend-style idempotency keys. Do not transfer the Resend 24-hour deduplication assumption to that binding. Persist the attempt before sending, distinguish a known rejection from an ambiguous timeout/crash, and reconcile ambiguous outcomes against provider evidence instead of blindly retrying. Specify and test provider delivery-event/log reconciliation before claiming automated delivery confirmation.

If Resend is retained, verify Opportunity Radar's exact sender domain in Resend first; Cloudflare verification is not evidence of Resend onboarding. Use a dedicated restricted sending key and the existing planned Resend idempotency/webhook contract. Preserve the same identity, visual style, recipient restrictions and private-data boundary.

Before enabling the weekly schedule, validate the selected provider's current limits, attachment payload and failure behavior; send one authorized end-to-end test to the existing recipient; open the attached Markdown in Codex; and confirm provider delivery separately from API acceptance. Record two scheduled successes afterward. Keep live email addresses, private repo findings and raw message bodies out of public CI and source.

## Scope of reuse

Opportunity Radar's inbound HEY forwarding, Zoho synchronization, newsletter parsing, historical-mail credentials and Notion publishing serve opportunity ingestion. They are not dependencies of a GitHub scan. Preserve those systems while reusing the outbound email conventions the scanner needs.
