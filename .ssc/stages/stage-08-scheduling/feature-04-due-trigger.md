# Feature 04: Due trigger

## Intent

Give the worker a container-friendly due check that finds enabled per-newsletter schedules whose fire time has arrived and enqueues a normal Stage 04 `pending` run through the same path as manual Generate — so scheduled generation is automatic without OS cron, and prompt/model resolution plus checkpoints behave identically to on-demand.

## Spec

Add worker-side schedule due detection and enqueue. This feature owns **`scheduleLastFiredAt` persistence**, **previous-fire / due helpers**, **`enqueueNewsletterRun` on due**, and a **60s schedule poller**. It does **not** add scheduled-vs-manual run labeling (Feature 06), concurrency-policy polish beyond what `enqueueNewsletterRun` + the existing run poller already do (Feature 05), or any Schedules/edit GUI (Features 02–03).

### Due semantics (pinned — PM grill)

| Rule | Behavior |
|------|----------|
| Reference clock | Worker tick’s `now = new Date()` (one instant per tick, shared across newsletters). |
| Candidate | `scheduleEnabled === true` and non-empty validated cron + timezone (Feature 01 fields). |
| Previous fire | `computePreviousFireAt(cron, timezone, now)` — the latest cron occurrence **≤ now** (inclusive). Implement via `CronExpressionParser.parse(cron, { currentDate: new Date(now.getTime() + 1), tz: timezone }).prev()` then `.toDate()` — the `+1ms` makes a fire exactly at `now` count as previous. Re-parse each call; **never** `reset()` (Feature 01 tz-drop pin). |
| Due? | `previousFire !== null` **and** (`scheduleLastFiredAt === null` **or** `previousFire.getTime() > new Date(scheduleLastFiredAt).getTime()`). |
| Not due | Disabled; empty/invalid cron at tick (skip + log, do not throw the whole tick); previous fire already stamped (`<= lastFiredAt`). |
| Enqueue | Call existing `enqueueNewsletterRun(client, newsletterId)` — same runnable validation, same-newsletter active guard, race cleanup, and `createRun` → `pending` as manual Generate. |
| Stamp | **Only** when enqueue returns `{ ok: true }`: persist `scheduleLastFiredAt = previousFire.toISOString()`. Stamp the **previous-fire instant**, not wall-clock `now`. |
| Failed enqueue | Leave `scheduleLastFiredAt` unchanged so a later tick can retry (already-in-progress, no healthy feeds, Appwrite error, etc.). |
| Multi due | On one tick, evaluate **all** enabled newsletters; enqueue each that is due independently. Serial **execution** stays the existing `RunPoller` single-flight (V1). Parallel runs across newsletters are post-V1. |
| Catch-up | Evaluating only the latest previous occurrence (not every missed slot) means downtime does not enqueue a backlog — Feature 06 owns operator-facing missed-fire copy; this feature must not loop `prev()` to enqueue multiples. |
| Trigger field | **Do not** add `trigger` / scheduled-vs-manual on `Run` — Feature 06. |

### Field contract — `scheduleLastFiredAt` (pinned)

| Persisted attribute | Type | Default on create / missing read | Notes |
|---------------------|------|----------------------------------|-------|
| `scheduleLastFiredAt` | datetime (nullable) | `null` | ISO-8601 UTC instant of the last **successfully enqueued** schedule fire (the previous-fire stamp). Not a next-fire cache. |

**Writers:**

1. **`createNewsletter`** — persist `scheduleLastFiredAt: null`.
2. **`updateNewsletter`** — **omit** `scheduleLastFiredAt` (and all Feature 01 schedule keys) so definition saves preserve the stamp.
3. **`updateNewsletterSchedule`** (Feature 01) — on every successful schedule write, set **`scheduleLastFiredAt: null`** (clear on cron/TZ/enable change — PM pin).
4. **`setScheduleLastFiredAt(client, id, iso: string)`** — new repository helper; due-check’s only stamp path. Validates non-empty ISO-ish string; `updateDocument` with `scheduleLastFiredAt` + `updatedAt`. `not_found` / Appwrite mapping matches existing newsletter helpers. Clearing uses `null` via schedule update, not this helper (or allow `null` explicitly — prefer stamp-only helper + clear inside `updateNewsletterSchedule`).

### Pure helpers (extend Feature 01 `shared/src/newsletters/schedule.ts`)

| Helper | Behavior |
|--------|----------|
| `computePreviousFireAt(cron, timezone, now?): Date \| null` | Inclusive previous occurrence ≤ `now` (default `new Date()`). On parse failure → `null` (caller skips). |
| `isScheduleDue(newsletter, now?): boolean` | Uses `scheduleEnabled`, `scheduleCron`, `scheduleTimezone`, `scheduleLastFiredAt` + `computePreviousFireAt`. Returns `false` when disabled, empty cron, parse failure, or already stamped for that previous fire. |

Also export a small orchestration helper used by the worker (may live in `shared/src/newsletters/due-check.ts` or `shared/src/runs/schedule-due.ts`):

```ts
export type DueCheckResult = {
  considered: number;
  due: number;
  enqueued: number;
  skipped: number;
  errors: number;
};

export async function processDueSchedules(
  client: Client,
  opts?: { now?: Date; listNewsletters?: typeof listNewsletters; enqueue?: typeof enqueueNewsletterRun; setLastFired?: typeof setScheduleLastFiredAt },
): Promise<DueCheckResult>;
```

Behavior of `processDueSchedules`:

1. `listNewsletters(client)` (existing V1 fetch-all).
2. For each newsletter where `isScheduleDue(...)`: compute `previousFire`; call `enqueueNewsletterRun`; on `ok` call `setScheduleLastFiredAt(…, previousFire.toISOString())` and count `enqueued`; on `!ok` count `skipped` and log a safe message (no secrets); on throw count `errors`, log, continue other newsletters.
3. Disabled / not-due increment `considered` only (or track `considered` = all listed; `due` = due candidates) — tests assert enqueue/stamp counts, not log wording.

### Worker poller (pinned)

Mirror retention / run-poller patterns in `worker/src/index.ts` (and extract `worker/src/schedule-poller.ts` if it keeps tick/single-flight testable):

- Env: `WORKER_SCHEDULE_POLL_MS`, default **`60000`** (60s). Parse like `WORKER_RUN_POLL_MS` / retention.
- Interval + **single-flight** (`inFlight` / `ticking` — skip overlapping ticks).
- On tick: invoke `processDueSchedules(client)` (or a registered job `check-due-schedules` that does the same).
- Clear interval on `SIGTERM`/`SIGINT` alongside run + retention pollers.
- Boot: optional immediate first tick is **not** required; first interval fire is enough.
- Log start: `schedule poller started: pollMs=…`.

### Out of scope

- Schedules page / newsletter-edit GUI (Features 02–03).
- Feature 05 concurrency policy beyond existing `enqueueNewsletterRun` active guard + `RunPoller` single execution.
- Feature 06 run `trigger` field, history badges, missed-fire operator copy.
- OS cron / host crontab.
- Enqueueing multiple past fires after downtime.
- Parallel pipeline execution across newsletters (post-V1).
- Changing Stage 04 execute path / checkpoints / prompt freeze.

## Dependencies

- Builds on: **feature-01-per-newsletter-schedule** — `scheduleEnabled` / `scheduleCron` / `scheduleTimezone`, `updateNewsletterSchedule`, `cron-parser`, `toNewsletterScheduleView` / next-fire helpers.
- Builds on: Stage 04 — `enqueueNewsletterRun`, `createRun`, worker `RunPoller` / `execute-run`.
- Soft: Features 02–03 (GUI) not required to verify due-check.
- Soft consumer: Feature 05 (stricter concurrency), Feature 06 (trigger labeling / missed-fire narrative).
- Orphaned by: none within stage once Feature 01 exists — **Execute Feature 01 before this feature.** Features 02–03 may run before or after; this feature does not depend on them.

## Constraints

- **Schema-as-code only.** Append `scheduleLastFiredAt` in `declarations.ts`; create-if-absent; no drop / rename / retype / migrate.
- **Do not** store `nextFireAt` (still derived).
- **Do not** add run `trigger` / source field.
- **Do not** bypass `enqueueNewsletterRun` (no direct `createRun` from the due path).
- **Do not** use OS cron.
- **Server-only** Appwrite via existing shared clients.
- **Secrets:** never log API keys or session secrets.
- Match existing `NewsletterRepositoryError` / poller single-flight patterns.

## Acceptance criteria

- [ ] `newsletters` declares `scheduleLastFiredAt` (datetime, required false); missing/null reads as `null`; create writes `null`.
- [ ] `updateNewsletter` omits `scheduleLastFiredAt`; `updateNewsletterSchedule` clears it to `null` on every successful schedule write.
- [ ] `computePreviousFireAt` / `isScheduleDue` match the pinned due table (disabled → false; stamped for current previous → false; unstamped previous ≤ now → true), including a timezone/weekday fixture.
- [ ] `processDueSchedules` (or equivalent) for each due newsletter calls `enqueueNewsletterRun` and on success stamps `scheduleLastFiredAt` to that previous-fire ISO; on `{ ok: false }` does not stamp that newsletter; when two are due and both succeed, both are enqueued and stamped (test case 8).
- [ ] Worker schedule poller runs on `WORKER_SCHEDULE_POLL_MS` (default 60000) with single-flight and is cleared on shutdown.
- [ ] No OS cron; no run `trigger` field; no Feature 05/06 GUI or history labeling in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts` — append `scheduleLastFiredAt`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/newsletters/types.ts` — `scheduleLastFiredAt: string | null` on `Newsletter`
- Modify: `shared/src/newsletters/schedule.ts` — `computePreviousFireAt`, `isScheduleDue` (Feature 01 file; create only if somehow missing after F01)
- Create: `shared/src/newsletters/due-check.ts` (or `shared/src/runs/schedule-due.ts`) — `processDueSchedules`
- Modify: `shared/src/newsletters/repository.ts` — coerce, create null, update omit, schedule-update clear, `setScheduleLastFiredAt`
- Modify: `shared/src/newsletters/index.ts` — re-exports
- Create: `shared/src/newsletters/__tests__/due-check.test.ts` (or extend `schedule.test.ts` + dedicated due-check tests)
- Modify: `shared/src/newsletters/__tests__/schedule.test.ts` — previous-fire / isScheduleDue cases
- Modify: `shared/src/newsletters/__tests__/repository.test.ts` — stamp clear / set / create null / update omit
- Create: `worker/src/schedule-poller.ts` (recommended extract) + `worker/src/__tests__/schedule-poller.test.ts`
- Modify: `worker/src/index.ts` — register interval, shutdown clear, env default

## Testing approach

Test-first for due helpers and `processDueSchedules`; repository tests for stamp writers; worker unit tests for single-flight / env default.

### Schedule / due helpers

1. **Disabled → not due** — `isScheduleDue({ scheduleEnabled: false, … }) === false`.
2. **Enabled, never fired, previous exists → due** — fixed `now` after a weekday cron fire in `America/New_York`; `scheduleLastFiredAt: null` → true.
3. **Already stamped for that previous → not due** — `scheduleLastFiredAt` equals that previous ISO → false.
4. **Stamped for an older fire, new previous after downtime → due once** — last stamp before downtime; `now` after several missed slots → due for **latest** previous only (single true), not N times.
5. **`computePreviousFireAt` inclusive** — `now` exactly on a fire instant (or `now` = fire + 0ms via `+1ms` parse trick) yields that fire, not the one before.
6. **Invalid cron → not due / null previous** — does not throw.

### `processDueSchedules`

7. **Success path** — mock list with one due newsletter; mock enqueue `{ ok: true, runId }`; assert enqueue called; assert `setScheduleLastFiredAt` called with previous-fire ISO.
8. **Multi-due success** — mock list with **two** due newsletters; both enqueue `{ ok: true }`; assert `enqueue` called **twice** (once per id) and `setScheduleLastFiredAt` called for **both** previous-fire ISOs. Locks the “enqueue each that is due independently” pin — a “stop after first success” implementation must fail this case.
9. **Enqueue failure** — `{ ok: false, error: "…" }`; assert stamp **not** called for that newsletter; other due newsletters still processed.
10. **Not due skipped** — disabled or already stamped; enqueue not called.

### Repository

11. **create** includes `scheduleLastFiredAt: null`.
12. **updateNewsletter** payload omits `scheduleLastFiredAt`.
13. **updateNewsletterSchedule** success payload sets `scheduleLastFiredAt: null`.
14. **setScheduleLastFiredAt** writes ISO + `updatedAt`; 404 → `not_found`.
15. **Read coerce** — missing/null → `null`.

### Worker

16. **Single-flight** — overlapping tick does not double-invoke `processDueSchedules`.
17. **Default poll ms** — 60000 when env unset (assert constant or parse helper).

## Tasks

### Task 1: Failing tests for due helpers, processDueSchedules, repository stamp, poller

- **Action**: Add/extend tests covering cases 1–17 above (helpers + due-check orchestration with mocks — including multi-due success case 8 — + repository stamp/clear/omit + worker single-flight). Imports may fail red until later tasks.
- **Expected result**: New tests exist and fail for the right reasons (missing exports / missing attribute / missing poller).
- **Verify**: `pnpm --filter @newsletter/shared test` and `pnpm --filter worker test` (or worker’s vitest path) show new assertions failing, not infra crashes.
- **Depends on**: none.

### Task 2: Schema + Newsletter field + previous-fire / isScheduleDue helpers

- **Action**: Append `{ key: "scheduleLastFiredAt", type: "datetime", required: false }` to newsletters in `declarations.ts`. Extend `Newsletter` + `documentToNewsletter` coerce. Implement `computePreviousFireAt` and `isScheduleDue` in `shared/src/newsletters/schedule.ts` per pinned semantics (`+1ms` then `prev()`, no `reset()`). Make helper + declaration tests green.
- **Expected result**: Schema + due pure helpers pass tests 1–6 and 15 (coerce may land in Task 3 if cleaner — prefer coerce here with the type).
- **Verify**: `pnpm --filter @newsletter/shared test` — schedule/due helper + declarations assertions green.
- **Depends on**: Task 1.

### Task 3: Repository writers — create null, update omit, schedule clear, setScheduleLastFiredAt

- **Action**: Wire create/`updateNewsletter`/`updateNewsletterSchedule`/`setScheduleLastFiredAt` per Spec. Make repository tests 11–14 green. Fix any `Newsletter` fixture compile breaks with `scheduleLastFiredAt: null`.
- **Expected result**: Stamp persistence contract holds.
- **Verify**: `pnpm --filter @newsletter/shared test` — repository schedule/stamp cases green; `pnpm typecheck` clean for shared.
- **Depends on**: Task 2.

### Task 4: processDueSchedules + worker schedule poller

- **Action**: Implement `processDueSchedules` in shared; export from package index as needed. Add `worker/src/schedule-poller.ts` (or inline with extractable tick) using `WORKER_SCHEDULE_POLL_MS` default 60000, single-flight, call `processDueSchedules`. Wire start + shutdown clear in `worker/src/index.ts`. Make tests 7–10 and 16–17 green.
- **Expected result**: Worker periodically enqueues due schedules through `enqueueNewsletterRun` and stamps only on success; multi-due tick enqueues and stamps every due newsletter.
- **Verify**: `pnpm --filter @newsletter/shared test` and worker tests green (including multi-due case 8); `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker test && pnpm typecheck && pnpm lint`
- Expected: All shared + worker tests pass (including due-check / schedule poller); typecheck and lint clean. With an enabled schedule whose previous fire is after `scheduleLastFiredAt` (or null stamp), one due-check tick enqueues a `pending` run via `enqueueNewsletterRun` and persists the previous-fire ISO; a second tick without a new cron boundary does not enqueue again.

## Handoff

Builder reports: files changed; confirmation that due path calls `enqueueNewsletterRun` only; stamp-on-success + clear-on-schedule-edit confirmed; `WORKER_SCHEDULE_POLL_MS` default; any deviation (e.g. due-check file under `runs/` vs `newsletters/`) and why. Notes for Feature 05: multi-due already enqueues all; serial execution is still RunPoller. Notes for Feature 06: runs are still unlabeled — add `trigger` there. Post-V1: parallel execution across different newsletters.

## Research notes

- **codegraph_explore** — `enqueueNewsletterRun` (`shared/src/runs/start.ts`), `RunPoller` (`worker/src/run-poller.ts`), retention poller interval pattern (`worker/src/index.ts`), nullable datetime coerce (`lastFetchAt` / `endedAt`).
- **Feature 01 spec** — cron-parser v5 `CronExpressionParser.parse` + `tz`; no `reset()`; 5-field cron; schedule field names.
- **npm / WebSearch** — cron-parser `prev()` for previous occurrence; poll interval matched to minute-granularity cron (60s).
- **PM grill (2026-07-16)** — `scheduleLastFiredAt`; stamp only on successful enqueue with previous-fire instant; clear stamp on schedule edit; 60s poll; enqueue all due per tick; defer run `trigger` to Feature 06; parallel cross-newsletter runs post-V1.
