# Cloudflare email integration

The user selected **Cloudflare Email Sending** on September 7, 2026. The scanner reuses Opportunity Radar's existing sender, recipient, domain and digest conventions. Real addresses stay in private runtime/deployment settings; the display name and subject identify **GitHub Repo Scan**.

## Summary presentation

The scanner owns a single-column summary: headings, bullet points, source links and short recommendations on a plain background. It reuses Platform `@dustwave/digest-core` 0.1.0 (`4992520`) for escaping and compact display text. Opportunity Radar retains its card layout; its renderer, identity and transport are unchanged.

HTML, plain text and the Codex Markdown derive from one report and the same notification selection. Every open issue and PR remains visible, with no top-eight truncation. The Markdown contains readable UTF-8 headings, evidence, recommendations, quoted issue/PR bodies and a repository-selection appendix. Each attachment is at most 512 KiB; larger reports partition by repository and repeat the operating brief and selection. Exceeding the total message budget fails visibly rather than dropping content.

## Failed Actions appear once

A failed run is identified by stable repository ID, run ID and attempt. Once a report containing it is confirmed delivered, later emails and Markdown attachments omit that same failed run, even if repository names, source, recommendations or triage states change. A new failed run or failed retry is new evidence. This is notification suppression, not resolution: the complete private report JSON retains all findings.

Open issues and PRs continue in every email until they close. Other acceptance/freshness follow-ups and collection gaps remain visible. No newly reported failures does not mean previously reported failures are fixed.

D1 retains minimal `reported_actions` receipts independently of report retention and the last-report comparison baseline. The delivery-event handler indexes only emitted action keys from the frozen email. Existing delivered reports are backfilled once from their full attachments. Previews, rejected sends and ambiguous outcomes do not create receipts. Indexing is idempotent and must finish before deleting old report bytes. Missing delivery history fails visibly rather than silently re-reporting old failures. Local offline previews have no production receipt history and show all findings eligible for a first report; hosted previews use production receipts without changing them.

## Identity and transport

The scanner has its own `EMAIL` binding restricted to the agreed sender and recipient. External GitHub content cannot choose addresses, CC/BCC, headers or reply-to. The reviewed automation header is `X-Dustwave-Automation: github-repo-scan`. Attachments pass UTF-8 bytes as a `Uint8Array` to the Workers binding, with a run-specific filename and `text/markdown; charset=utf-8` MIME type. Do not pre-encode the Markdown as Base64: the September 7 received attachment proved that the binding transmitted that string as literal file content. Binary attachment input avoids that ambiguity. [Cloudflare send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

The owner authorized the weekly reports and requested corrected-format test deliveries. The scanner does not inherit Opportunity Radar's inbound HEY/Zoho credentials, newsletter ingestion or Notion publishing. Its shared renderer adoption preserves Opportunity Radar's existing output.

## Delivery state and duplicates

Before sending, freeze the report bytes and manifest in private R2 and create the D1 outbox row. An atomic `prepared → attempting` claim permits one provider call. Repeated scheduled ticks use the same Workflow and run ID. Repeated send steps or recovery calls cannot reclaim an attempted send.

Cloudflare's reviewed `send()` API does not expose a Resend-style idempotency key. Known rejection records failure. Timeout, crash or missing response leaves an ambiguous/attempting delivery; it is never blindly resent. A dedicated domain event subscription and Queue reconcile by provider message ID, or by the unique frozen subject plus fixed sender/recipient when the response was lost. Validate account, subscription, domain, event type and identity before applying an event. Other consumers' messages are ignored. Deduplicate event IDs; late acceptance cannot overwrite delivered/bounced/failed state. [Cloudflare delivery events](https://developers.cloudflare.com/email-service/platform/event-subscriptions/).

`accepted` means the provider accepted the request. `delivered` means the destination mail server accepted it; neither proves the user read it. An unresolved delivery makes the watchdog fail after the delivery window. If no event can establish an ambiguous outcome, reconcile in Cloudflare's activity logs before authorizing a new delivery. The service exposes no unauthenticated public report URL. [Cloudflare email logs](https://developers.cloudflare.com/email-service/observability/logs/).
