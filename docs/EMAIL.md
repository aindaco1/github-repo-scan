# Cloudflare email integration

The user selected **Cloudflare Email Sending** on September 7, 2026. The scanner reuses Opportunity Radar's existing sender, recipient, domain and digest conventions. Real addresses stay in private runtime/deployment settings; the display name and subject identify **GitHub Repo Scan**.

## Shared presentation

Platform `@dustwave/digest-core` 0.1.0, pinned at `4992520`, owns the responsive dark background, cream cards, orange rules, HTML escaping and compact display summaries. It was extracted from Opportunity Radar with byte-for-byte characterization coverage there and scanner-specific injection/escaping tests. Consumers retain their grouping, report content, complete text/Markdown, state, schedule, credentials and transport. No sibling checkout or production mail relay is imported.

HTML, plain text and the Codex Markdown derive from one report. The scanner sends a weekly all-clear, partial or failed-coverage report as appropriate; Opportunity Radar's suppression of empty opportunity digests does not apply. Each Markdown attachment is at most 512 KiB; larger reports partition by repository with the operating brief and selection repeated. Exceeding the total message budget fails visibly rather than dropping findings.

## Identity and transport

The scanner has its own `EMAIL` binding restricted to the agreed sender and recipient. External GitHub content cannot choose addresses, CC/BCC, headers or reply-to. The reviewed automation header is `X-Dustwave-Automation: github-repo-scan`. Attachments use native base64 content, a dated filename and `text/markdown` MIME type. [Cloudflare send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

The owner authorized one end-to-end test and weekly reports. The scanner does not inherit Opportunity Radar's inbound HEY/Zoho credentials, newsletter ingestion or Notion publishing. Its shared renderer adoption preserves Opportunity Radar's existing output.

## Delivery state and duplicates

Before sending, freeze the report bytes and manifest in private R2 and create the D1 outbox row. An atomic `prepared → attempting` claim permits one provider call. Repeated scheduled ticks use the same Workflow and run ID. Repeated send steps or recovery calls cannot reclaim an attempted send.

Cloudflare's reviewed `send()` API does not expose a Resend-style idempotency key. Known rejection records failure. Timeout, crash or missing response leaves an ambiguous/attempting delivery; it is never blindly resent. A dedicated domain event subscription and Queue reconcile by provider message ID, or by the unique frozen subject plus fixed sender/recipient when the response was lost. Validate account, subscription, domain, event type and identity before applying an event. Other consumers' messages are ignored. Deduplicate event IDs; late acceptance cannot overwrite delivered/bounced/failed state. [Cloudflare delivery events](https://developers.cloudflare.com/email-service/platform/event-subscriptions/).

`accepted` means the provider accepted the request. `delivered` means the destination mail server accepted it; neither proves the user read it. An unresolved delivery makes the watchdog fail after the delivery window. If no event can establish an ambiguous outcome, reconcile in Cloudflare's activity logs before authorizing a new delivery. The service exposes no unauthenticated public report URL. [Cloudflare email logs](https://developers.cloudflare.com/email-service/observability/logs/).
