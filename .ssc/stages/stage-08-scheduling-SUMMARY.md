# Stage 08: Scheduling — Summary

## What this stage delivered

You can now put each newsletter on a real schedule — cron expression plus timezone — and leave the box to generate issues on its own. No host crontab, no shell one-liners: the worker watches for due schedules and starts the same kind of run you already use from the Generate button.

There is a top-level Schedules page that shows every newsletter’s enable state and next fire time (table on desktop, cards on phone), with edit from that list or from the newsletter edit dialog. The edit dialog scrolls again, so schedule settings and feeds are reachable on normal screen heights.

When a schedule fires, the system creates a normal pending run — checkpoints, history, and prompt/model freeze behave like an on-demand start. If that newsletter is already running, the fire is skipped (not piled up). If several newsletters are due, they queue and run one at a time. After downtime, only the latest due window counts — missed past slots are not replayed as a backlog. In Runs history (and Inspect), each run is labeled Manual or Scheduled, and failures still show status and failure detail.

## How it maps to the plan

- **Stage Intent:** Make newsletter generation reliable and automatic on the self-hosted box, so the operator no longer depends on external cron or a shell. Per-newsletter schedules fire into the same run path Stage 04 already proved, with failures visible in run history — closing the operability gap called out in the north star (configure, schedule, generate, deliver).
- **Acceptance criteria met:**
  - [x] An enabled schedule stores cron + IANA timezone and exposes a correct next-fire time for that timezone; a disabled schedule does not create runs.
  - [x] The Schedules page lists every newsletter schedule with enable state and next fire, using the shared responsive list pattern, and links to newsletter edit.
  - [x] Newsletter edit includes schedule controls and the full edit page is scrollable so all sections (including schedule) are reachable on typical viewport heights.
  - [x] When a schedule becomes due, the system creates a normal pending run and executes it via the same Stage 04 run path as an on-demand start (checkpoints, history, prompt/model freeze at claim).
  - [x] A due fire for a newsletter that already has an active run is skipped; at most one newsletter run executes at a time across the box when multiple are due.
  - [x] After process downtime spanning one or more fire times, only the current due window is considered — past missed fires are not enqueued as catch-up runs.
  - [x] Scheduled runs appear in run history with status and failure detail when they fail, and are visually or field-distinguishable from manual runs.
- **North star link:** This stage closes the “schedule” part of configure → schedule → generate → deliver. Generation can now happen reliably on the self-hosted box without babysitting cron, which directly supports the PRODUCT success criterion that scheduled newsletters generate at their configured times with failures visible in run history.

## What was built

- **Feature 01 — Per-newsletter schedule:** Persist enable/cron/timezone on each newsletter; compute next fire in that timezone when enabled; shared validation helpers for later UI and worker.
- **Feature 02 — Schedules page:** Top-level Schedules list (responsive) with status, next fire, edit-schedule dialog, and link into newsletter edit.
- **Feature 03 — Newsletter edit schedule and scroll:** Schedule fields on the newsletter edit dialog (edit mode); dialog scrolls so schedule and feeds are reachable.
- **Feature 04 — Due trigger:** Worker poller (~60s) finds due schedules and enqueues Stage 04 pending runs through the same path as Generate; stamps last successful fire so slots are not re-fired endlessly.
- **Feature 05 — Concurrency policy:** Skip (and consume) a due fire when that newsletter is already active; other newsletters still enqueue and wait; only one pipeline executes at a time on the box.
- **Feature 06 — Missed fires and history:** No catch-up backlog after downtime; runs carry Manual vs Scheduled; labels on Runs list and Inspect; Schedules page notes the no-backlog policy.
- **Feature 07 — Hardening (2026-07-16 review):** Durable fire consumption after stamp failures; Schedules→edit deep-link works off-page; due-check walks every newsletter; safer schedule+definition save; poller logs/clamp; accessible Schedules actions.

## Decisions and deviations

- **“Edit page” is the newsletter edit dialog**, not a separate route — scroll fix and schedule fields live on `NewsletterFormDialog`.
- **Hardening stamp-first (C1):** After the stage review, fire consumption stamps before enqueue (with compare/retry) so a stamp failure cannot double-fire a slot. That is stricter than Feature 05’s earlier “only stamp on success / busy-skip” wording for non-busy failures: a validation-style enqueue refusal can now also consume that fire window. Stage acceptance criteria still hold; skipped/busy fires still create no run row by design.
- **Code review:** `review-stage-08-scheduling-2026-07-16` found 0 Blockers, 2 High, 6 Medium; accepted findings shipped as Feature 07 and verified before finalize.

## Deferred and out of scope

- Delivery of finished issues (email, RSS, export) — Stage 09.
- OS cron / host crontab inside containers.
- Catch-up / backlog of every missed fire after downtime.
- Cancelling an in-progress run.
- Parallel concurrent pipeline execution across newsletters.
- Changing Stage 04 phase semantics, retention, or feed-health rules.
- Trigger filter on the Runs page; Issues badges for Manual/Scheduled (V1).

## Open questions for the next stage

- None from Stage 08 itself. Stage 09 (delivery) is next: email, RSS publication, and downloadable export from the UI, on top of preview/inspection already in place.
