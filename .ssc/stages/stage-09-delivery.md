# Stage 09: Delivery

## Intent

Get finished issues to the people and places that consume them — family inboxes via email, RSS readers via a public feed, and the operator via on-demand download — so a generated draft is not trapped in the app. Auto-delivery (per newsletter, per channel) closes the loop once a newsletter is tuned; manual actions cover the tuning period. This is the last mile of the north star: configure, schedule, generate, and **deliver**.

## Goal

From a completed issue, the operator can email recipients (HTML + plain text), publish to that newsletter’s public RSS feed (last 10 issues), and download markdown or HTML. Per-newsletter toggles enable auto-email and/or auto-RSS after a successful run. Delivery outcomes and failures are visible in the GUI.

## Features

1. **Newsletter delivery config** — Per-newsletter: operator-managed recipient email list; independent **auto-email** and **auto-RSS** toggles (default off while tuning).
2. **Email delivery** — SMTP credentials from `.env` (operator’s own mail server); send multipart (HTML + plain text) derived from the completed draft; manual Send from the Issues UI.
3. **RSS publication** — One public feed URL per newsletter (no auth); publish appends the issue; feed retains the last **10** issues; manual Publish uses the same path as auto-RSS.
4. **Download export** — From a completed issue: download **markdown** and **HTML** (HTML matches the email HTML body). On-demand only — no auto-export or remote archive.
5. **Auto-deliver after success** — When a run completes with a draft, honor that newsletter’s auto-email and/or auto-RSS toggles without a manual click.
6. **Delivery visibility** — Fill `/delivery` as the primary hub (Runs-like list of issues with ≥1 email/RSS attempt, status + failure reasons); compact badges on Issues list/detail. No delivery chrome on Runs/Inspect.

## Acceptance criteria

- [ ] Newsletter config stores a recipient list and independent auto-email / auto-RSS toggles (default off).
- [ ] Manual Send emails the issue as multipart HTML + plain text via SMTP configured in `.env`.
- [ ] Manual Publish updates that newsletter’s public RSS feed; the feed includes at most the latest 10 published issues and is readable without auth.
- [ ] From a completed issue, the operator can download markdown and HTML; the HTML matches the email HTML body.
- [ ] When auto-email is on and a run completes with a draft, recipients are emailed without a manual Send; when auto-RSS is on, the issue is published without a manual Publish; each toggle is independent.
- [ ] Delivery page (`/delivery`) is the primary hub for email/RSS status and failure reasons (lists issues with ≥1 email/RSS attempt, success or failure); Issues list/detail show compact email/RSS badges; Runs/Inspect do not.
- [ ] No auto-export, public signup, or unsubscribe flow is introduced in this stage.

## Dependencies

- Stage 06: Preview And Inspection must be complete (completed-draft Issues surface).
- Stage 04 run completion path is the trigger point for auto-deliver (already complete).

## Out of scope

- Auto-export / archive-to-elsewhere (backup destination spirals).
- Public subscriber signup, double opt-in, or unsubscribe tokens.
- Bounce / complaint handling beyond surfacing send failures.
- Managed ESP SaaS (Resend, Mailchimp, etc.) — SMTP via `.env` only.
- Draft editing or approval gate before send (manual Send during tuning; auto when toggles on).
- Changing Stage 06 reader/inspect semantics.

## Open questions

- None — channel set, auto toggles (email + RSS only), multipart email, public last-10 RSS, on-demand MD/HTML download, per-newsletter recipients, and `.env` SMTP were confirmed with the PM.
