# Stage 08: Scheduling

## Intent

Make newsletter generation reliable and automatic on the self-hosted box, so the operator no longer depends on external cron or a shell. Per-newsletter schedules fire into the same run path Stage 04 already proved, with failures visible in run history — closing the operability gap called out in the north star (configure, schedule, generate, deliver).

## Goal

The operator can enable a timezone-aware schedule per newsletter, see upcoming and past scheduled activity in the GUI, and trust that due schedules create normal runs (same pipeline and history as on-demand) without OS cron inside containers. Concurrent due work is handled safely; missed fires after downtime do not pile up.

## Features

1. **Per-newsletter schedule** — Enable or disable a schedule per newsletter with a cron expression and IANA timezone; show the next scheduled fire time when enabled.
2. **Schedules page** — A top-level Schedules list (responsive table on wide viewports, stacked cards on narrow) of all newsletters' schedules with status and next run, linking into the newsletter for edits.
3. **Newsletter edit: schedule and scroll** — Schedule fields live on the newsletter edit surface alongside existing config; the edit page scrolls so every section is reachable (fixes the current overflow that hides lower content).
4. **Due trigger** — A worker-side due check (not OS cron) finds enabled schedules that are due and creates a Stage 04 `pending` run executed through the same run path as manual starts, so prompt/model resolution and checkpoints behave identically.
5. **Concurrency policy** — If a newsletter already has an active run, skip that due fire for it; when multiple newsletters are due, run them serially (one at a time on the box).
6. **Missed fires and history** — After downtime or missed ticks, skip catch-up (do not enqueue a backlog of past fires); scheduled runs and failures appear in run history and are distinguishable from manual runs.

## Acceptance criteria

- [ ] An enabled schedule stores cron + IANA timezone and exposes a correct next-fire time for that timezone; a disabled schedule does not create runs.
- [ ] The Schedules page lists every newsletter schedule with enable state and next fire, using the shared responsive list pattern, and links to newsletter edit.
- [ ] Newsletter edit includes schedule controls and the full edit page is scrollable so all sections (including schedule) are reachable on typical viewport heights.
- [ ] When a schedule becomes due, the system creates a normal pending run and executes it via the same Stage 04 run path as an on-demand start (checkpoints, history, prompt/model freeze at claim).
- [ ] A due fire for a newsletter that already has an active run is skipped; at most one newsletter run executes at a time across the box when multiple are due.
- [ ] After process downtime spanning one or more fire times, only the current due window is considered — past missed fires are not enqueued as catch-up runs.
- [ ] Scheduled runs appear in run history with status and failure detail when they fail, and are visually or field-distinguishable from manual runs.

## Dependencies

- Stage 04: Runs And History must be complete (run records, pending queue, execute path, same-newsletter exclusion).

## Out of scope

- Delivery of finished issues (email, RSS, export) — Stage 09.
- OS `cron` or host crontab inside containers.
- Catch-up / backlog execution of every missed fire after downtime.
- Cancelling an in-progress run.
- Parallel concurrent pipeline execution across newsletters.
- Changing Stage 04 phase semantics, retention, or feed-health rules.

## Open questions

- None — schedule shape (cron + IANA TZ), both edit surfaces, serial concurrency, skip-if-active, and skip-missed-fires were confirmed with the PM.
