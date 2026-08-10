# Stage 09: Delivery — Summary

## What this stage delivered

Finished issues can now leave the app. From a completed issue you can email the newsletter’s recipient list (HTML plus plain text through your own SMTP server), publish to that newsletter’s public RSS feed (last 10 issues, no login required for readers), and download markdown or HTML on demand. The HTML you download is the same body that goes out in email.

Each newsletter has its own recipient list and two independent switches — auto-email and auto-RSS — both off by default while you tune. When either switch is on, a successful generate delivers on that channel without a click; one channel’s failure never blocks the other. Download stays manual only — nothing auto-archives elsewhere.

A Delivery page (`/delivery`) is the hub for email and RSS outcomes: issues that have been attempted (success or failure), with failure reasons when something went wrong. Issues list and detail show compact email/RSS badges; Runs and Inspect stay free of delivery chrome. Send, Publish, and Download still live on the issue reader where you already preview drafts.

## How it maps to the plan

- **Stage Intent:** Get finished issues to the people and places that consume them — family inboxes via email, RSS readers via a public feed, and the operator via on-demand download — so a generated draft is not trapped in the app. Auto-delivery (per newsletter, per channel) closes the loop once a newsletter is tuned; manual actions cover the tuning period. This is the last mile of the north star: configure, schedule, generate, and **deliver**.
- **Acceptance criteria met:**
  - [x] Newsletter config stores a recipient list and independent auto-email / auto-RSS toggles (default off).
  - [x] Manual Send emails the issue as multipart HTML + plain text via SMTP configured in `.env`.
  - [x] Manual Publish updates that newsletter’s public RSS feed; the feed includes at most the latest 10 published issues and is readable without auth.
  - [x] From a completed issue, the operator can download markdown and HTML; the HTML matches the email HTML body.
  - [x] When auto-email is on and a run completes with a draft, recipients are emailed without a manual Send; when auto-RSS is on, the issue is published without a manual Publish; each toggle is independent.
  - [x] Delivery page (`/delivery`) is the primary hub for email/RSS status and failure reasons (lists issues with ≥1 email/RSS attempt, success or failure); Issues list/detail show compact email/RSS badges; Runs/Inspect do not.
  - [x] No auto-export, public signup, or unsubscribe flow is introduced in this stage.
- **North star link:** This stage closes the last mile of PRODUCT goal 6 and the success criterion that a generated issue can be previewed, then delivered via email, RSS, and export from the UI — completing configure → schedule → generate → deliver for V1.

## What was built

- **Feature 01 — Newsletter delivery config:** Per-newsletter recipient list (validated, capped) plus independent auto-email and auto-RSS toggles (default off), editable on the newsletter form’s Delivery section; definition saves do not overwrite delivery fields.
- **Feature 02 — Email delivery:** Manual Send from the issue reader; multipart HTML + plain text via `.env` SMTP; recipients in BCC; shared draft→HTML converter reused by RSS and export.
- **Feature 03 — RSS publication:** Manual Publish snapshots the issue; public `/rss/{newsletterId}.xml` serves the latest 10 without auth; same publish path used by auto-RSS.
- **Feature 04 — Download export:** On-demand Markdown and HTML download from the issue reader; HTML body matches email HTML; authenticated export route (not public).
- **Feature 05 — Auto-deliver after success:** After a run is marked completed, honors auto-email and/or auto-RSS via the same send/publish entry points; never fails the run if delivery fails; no auto-export.
- **Feature 06 — Delivery visibility:** `/delivery` hub (Runs-like list of attempted deliveries with status and failure reasons); compact badges on Issues; no delivery chrome on Runs/Inspect; last-write-wins status on the run.
- **Feature 07 — Hardening (2026-07-17 review):** Email-safe HTML sanitization shared across email/RSS/export; CDATA-safe RSS bodies; session gates on send/publish/export/newsletter update; Delivery list limit after membership filter; schedule rollback if delivery write fails; accurate auto-delivery copy; Runs/Inspect no-badge regression test.

## Decisions and deviations

- **`/delivery` as primary hub:** Stage 02 reserved the nav slot; Features 01–05 kept Send/Publish/Download on Issues; Feature 06 filled `/delivery` as the status hub (not Issues/run-only). Documented in Plan.md 2026-07-17.
- **Code review before finalize:** `review-stage-09-delivery-2026-07-17` recommended Block (0 Blockers, 6 High, 4 Medium). PM accepted all ten findings into Feature 07; hardening verified before this finalize. No open Blocker findings at close.
- **Middleware auth pattern unchanged project-wide:** Hardening added in-handler Appwrite session checks on Stage 09 privileged entry points only (export, send, publish, newsletter update); public RSS stayed public by design.

## Deferred and out of scope

- Auto-export / archive-to-elsewhere.
- Public subscriber signup, double opt-in, or unsubscribe tokens.
- Bounce / complaint handling beyond surfacing send failures.
- Managed ESP SaaS (Resend, Mailchimp, etc.) — SMTP via `.env` only.
- Draft editing or approval gate before send.
- Changing Stage 06 reader/inspect semantics.

## Open questions for the next stage

- None from Stage 09 itself. V1 delivery is closed; future work (if any) is outside this stage’s out-of-scope list — e.g. manual curation or interest signals already deferred in PRODUCT.md, or a new stage via `ssc-plan`.
