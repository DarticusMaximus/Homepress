# Feature 05: Concurrency policy

## Intent

Make scheduled generation safe on a single box: skip (and consume) a due fire when that newsletter is already active so runs are not queued back-to-back with no content gap, while still allowing other newsletters to enqueue and wait serially behind an in-flight pipeline — protecting OpenRouter cost and matching the stage’s “one at a time” operability goal.

## Spec

Lock in Stage 08 concurrency for the schedule due path and prove serial execution across newsletters. Feature 04 already enqueues every due newsletter through `enqueueNewsletterRun` and relies on `RunPoller.inFlight` for one-at-a-time execution. This feature **revises** Feature 04’s stamp rule for the same-newsletter busy case and adds a stable failure code plus due-check accounting so the policy is explicit and testable.

### Policy (pinned — PM grill 2026-07-16)

| Situation | Enqueue? | Stamp `scheduleLastFiredAt`? |
|-----------|----------|------------------------------|
| Newsletter **B** due while **A** has an active run (`pending` or `running`) | **Yes** — B enqueues successfully and waits in the pending queue | **Yes** — on successful enqueue (unchanged from Feature 04) |
| Newsletter **A** due while **A** already has an active run | **No** — skip | **Yes** — stamp the previous-fire instant anyway (consume the fire; **no** back-to-back retry after A finishes) |
| Newsletter due but enqueue fails for any **other** reason (no healthy feeds, validation, Appwrite, etc.) | **No** | **No** — leave stamp unchanged so a later tick can retry (Feature 04 rule kept) |

**Rationale (same-newsletter stamp-on-skip):** Runs take ~20–30 minutes. Re-firing the same newsletter immediately after an overlapping active run would pull largely the same data and waste time/money. Consuming the fire when already active is correct.

**Cross-newsletter:** Multiple due newsletters on one tick still enqueue independently (Feature 04). Serial **execution** remains `RunPoller` single-flight (`inFlight`) — at most one `executeJob` on the box. Pending runs for other newsletters wait FIFO; they must not spawn parallel pipelines.

**No double-enqueue for B:** Successful enqueue stamps `scheduleLastFiredAt`, so later ticks in the same fire window are not due (`isScheduleDue` false). B is enqueued once, not once per 60s poll during A’s long run.

### `StartRunResult` failure code (pinned)

Extend the failure branch of `enqueueNewsletterRun` (and the exported `StartRunResult` type in `shared/src/runs/start.ts`):

```ts
export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; error: string; code?: "already_in_progress" };
```

- When the pre-create guard finds an active run, **or** race cleanup determines the created run is not the oldest active: return `{ ok: false, error: "A run is already in progress for this newsletter", code: "already_in_progress" }`.
- Operator-facing `error` string stays exactly that message (GUI Generate / Retry unchanged in wording).
- Other failures omit `code` (or leave it undefined) — due-check must not treat them as stamp-on-skip.
- Prefer comparing `code === "already_in_progress"` in due-check; do **not** match error text.

Export a shared constant if useful (e.g. `ALREADY_IN_PROGRESS_CODE = "already_in_progress"`) alongside the existing message constant.

### `processDueSchedules` stamp + counters (revises Feature 04)

Feature 04’s `DueCheckResult` gains an explicit busy-skip counter. Final shape:

```ts
export type DueCheckResult = {
  considered: number;
  due: number;
  enqueued: number;
  skipped: number;       // !ok enqueue that is NOT already_in_progress (and not throw)
  skippedActive: number; // !ok with code === "already_in_progress" (stamped)
  errors: number;        // thrown failures
};
```

Per due newsletter after `enqueue(...)`:

1. **`ok: true`** — `setScheduleLastFiredAt(…, previousFire.toISOString())`; `enqueued++`.
2. **`ok: false` and `code === "already_in_progress"`** — `setScheduleLastFiredAt(…, previousFire.toISOString())`; `skippedActive++`; log a safe message including newsletter id (no secrets).
3. **`ok: false` otherwise** — do **not** stamp; `skipped++`; log safe message.
4. **throw** — do **not** stamp; `errors++`; log; continue other newsletters.

`skipped` + `skippedActive` together cover all non-throw `!ok` outcomes. Feature 04 tests that asserted “any `!ok` → no stamp” must be updated for the `already_in_progress` case (this feature owns that revision).

Injected `enqueue` mock in tests may return the new shape; production path uses real `enqueueNewsletterRun`.

### Serial execution lock-in

No new poller architecture. Prove (tests) that:

- While `RunPoller.inFlight` is true, a subsequent `tick` does not call `executeJob` again.
- With two pending runs for **different** newsletters, only one `executeJob` runs per claim cycle; the second waits until `inFlight` clears (existing single-flight + `listPendingRuns` limit 1).

Do **not** add a global “any newsletter busy → refuse enqueue for others” gate — that would contradict the B-while-A policy above.

### Out of scope

- Schedules / newsletter-edit GUI (Features 02–03).
- Run `trigger` / scheduled-vs-manual history labeling (Feature 06).
- Changing cron / timezone / due detection helpers (Feature 04 / 01).
- Catch-up backlog of missed fires (Feature 06 narrative; Feature 04 already evaluates latest previous only).
- Parallel pipeline execution across newsletters (post-V1).
- Cancelling an in-progress run.
- OS cron.

## Dependencies

- Builds on: **feature-04-due-trigger** — `processDueSchedules`, `scheduleLastFiredAt` stamp helpers, schedule poller, due semantics. **Execute Feature 04 before this feature** (or land F04 + F05 in order in the same stage).
- Builds on: Stage 04 — `enqueueNewsletterRun`, `findActiveRunForNewsletter` / active = `pending`|`running`, `RunPoller` single-flight.
- Soft: Features 01–03 (schedule fields / GUI) not required beyond what Feature 04 needs.
- Orphaned by: none once Feature 04 exists.

## Constraints

- **Revises Feature 04 stamp rule only for `already_in_progress`.** Other `!ok` paths remain unstamped.
- **Do not** block enqueue of newsletter B because A is active.
- **Do not** add run `trigger` / source field.
- **Do not** use OS cron or change Stage 04 execute / checkpoint / prompt-freeze path.
- **Do not** match busy-skip by error string alone — use `code`.
- **Schema:** no new Appwrite attributes in this feature.
- **Secrets:** never log API keys or session secrets.
- Web Generate button may ignore `code` (message-only UX is fine).

## Acceptance criteria

- [ ] `enqueueNewsletterRun` returns `code: "already_in_progress"` on both pre-create active guard and race-cleanup “not oldest” failure; operator `error` string unchanged.
- [ ] When a due newsletter’s enqueue returns `already_in_progress`, `processDueSchedules` stamps `scheduleLastFiredAt` to that previous-fire ISO and increments `skippedActive` (not `enqueued`).
- [ ] When enqueue fails without that code, stamp is unchanged and `skipped` increments.
- [ ] When newsletter B is due while A is active, B still enqueues successfully once and is stamped; subsequent ticks in the same fire window do not enqueue B again.
- [ ] On a single `processDueSchedules` tick with **both** A and B due: A returning `already_in_progress` is stamped + counted in `skippedActive`, B returning `ok` is enqueued + stamped + counted in `enqueued`, and both newsletters are processed (no early exit / global busy stop after A).
- [ ] `RunPoller` still executes at most one run at a time on the box when multiple newsletters have pending runs (tests prove single-flight / no parallel `executeJob`).
- [ ] No GUI / `trigger` field / OS cron changes in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/runs/start.ts` — `StartRunResult` + `code: "already_in_progress"` on both busy paths
- Modify: `shared/src/runs/__tests__/start.test.ts` — assert `code` on busy failures
- Modify: `shared/src/newsletters/due-check.ts` (or `shared/src/runs/schedule-due.ts` — wherever Feature 04 placed `processDueSchedules`) — stamp-on-`already_in_progress`; extend `DueCheckResult`
- Modify: `shared/src/newsletters/__tests__/due-check.test.ts` (or Feature 04’s due-check test file) — revise stamp/`!ok` cases; add `skippedActive` cases
- Modify: `shared/src/newsletters/index.ts` and/or `shared/src/index.ts` — re-export type/constant if needed
- Modify: `worker/src/__tests__/run-poller.test.ts` — strengthen serial / multi-newsletter pending coverage if gaps remain
- Optionally modify: `worker/src/run-poller.ts` — only if a tiny testability hook is required; prefer proving existing `inFlight` behavior without production changes

## Testing approach

Test-first. Behavior verifies Intent (no back-to-back same-newsletter scheduled runs; cross-newsletter enqueue + serial execute).

### `enqueueNewsletterRun` / `StartRunResult`

1. **Pre-create busy** — active run exists → `{ ok: false, error: "A run is already in progress for this newsletter", code: "already_in_progress" }`.
2. **Race cleanup busy** — created run is not oldest active → same `code` and message.
3. **Non-busy failure** — e.g. no topics / no healthy feeds → `ok: false` **without** `code: "already_in_progress"` (code absent/undefined).

### `processDueSchedules`

4. **Stamp on already_in_progress** — due newsletter; mock enqueue `{ ok: false, error: "…", code: "already_in_progress" }`; assert `setScheduleLastFiredAt` called with previous-fire ISO; `skippedActive === 1`; `enqueued === 0`; `skipped === 0`.
5. **No stamp on other !ok** — mock enqueue `{ ok: false, error: "Attach at least one healthy…" }` (no code); assert stamp **not** called; `skipped === 1`; `skippedActive === 0`.
6. **Mixed same-tick (A busy + B ok)** — mock list with **two** due newsletters A and B; enqueue mock returns `{ ok: false, error: "…", code: "already_in_progress" }` for A and `{ ok: true, runId }` for B. Assert: A stamped + `skippedActive === 1`; B enqueued + stamped + `enqueued === 1`; enqueue invoked for **both** ids (no `break`/`return` after busy-skip; no global “anything active → stop”). This is the required B-while-A proof — do not treat a B-only success case as sufficient.
7. **Success path unchanged** — single due newsletter, `ok: true` still stamps and increments `enqueued`.

### `RunPoller` serial

8. **Single-flight** — with `inFlight` true, `tick` does not call `executeJob` (existing test may already cover — keep or extend).
9. **Two pending different newsletters** — first tick claims/executes one; while `inFlight`/execute in progress, second tick does not start a second `executeJob`; after execute completes, a later tick can claim the remaining pending. Assert at most one concurrent `executeJob` invocation.

## Tasks

### Task 1: Failing tests for code, stamp-on-skip, and serial poller

- **Action**: Add/extend tests covering cases 1–9 in `shared/src/runs/__tests__/start.test.ts`, the Feature 04 due-check test file, and `worker/src/__tests__/run-poller.test.ts`. Update any Feature 04 assertion that assumed “all `!ok` → never stamp” so the new `already_in_progress` case is expressed as failing until Task 3. Imports may fail red until later tasks.
- **Expected result**: New tests exist and fail for the right reasons (missing `code`, missing stamp-on-skip, missing `skippedActive`, or missing multi-pending serial assertion).
- **Verify**: `pnpm --filter @newsletter/shared test` and `pnpm --filter worker test` show new assertions failing, not infra crashes.
- **Depends on**: none (assumes Feature 04 code/tests exist in-tree; if Feature 04 not yet executed, stop and escalate — do not invent a parallel due-check).

### Task 2: `StartRunResult` `already_in_progress` code

- **Action**: In `shared/src/runs/start.ts`, extend `StartRunResult` and set `code: "already_in_progress"` on both busy return paths. Keep the operator message string identical. Make start tests 1–3 green. Fix any TypeScript exhaustiveness breaks at call sites that narrow on `ok` only (web actions can ignore `code`).
- **Expected result**: Busy failures are machine-distinguishable without string matching.
- **Verify**: `pnpm --filter @newsletter/shared test` — start.test busy cases green; `pnpm typecheck` clean for shared/web callers.
- **Depends on**: Task 1.

### Task 3: `processDueSchedules` stamp-on-skip + `skippedActive`

- **Action**: Extend `DueCheckResult` with `skippedActive`. In `processDueSchedules`, on `!ok && code === "already_in_progress"`, stamp previous-fire ISO and increment `skippedActive`; other `!ok` remain unstamped under `skipped`. Continue processing remaining due newsletters after a busy-skip (no early exit). Make due-check tests 4–7 green (including mixed same-tick case 6). Update Feature 04 docs comments in-code if they say “stamp only on success” without the busy exception.
- **Expected result**: Same-newsletter busy due fires consume the schedule slot; other failures still retry; on one tick A can be busy-skipped+stamped while B still enqueues+stamps.
- **Verify**: `pnpm --filter @newsletter/shared test` — due-check concurrency cases green.
- **Depends on**: Task 2.

### Task 4: RunPoller serial lock-in + feature gate

- **Action**: Ensure worker tests 8–9 pass (add if missing). No production change unless a test reveals a real gap — if a gap appears, fix the minimal poller bug and document in handoff. Run full shared + worker tests, `pnpm typecheck`, `pnpm lint`.
- **Expected result**: Stage acceptance “at most one newsletter run executes at a time” is proven; feature complete.
- **Verify**: `pnpm --filter @newsletter/shared test && pnpm --filter worker test && pnpm typecheck && pnpm lint` all green.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker test && pnpm typecheck && pnpm lint`
- Expected: All green. Due-check stamps on `already_in_progress` and counts `skippedActive`; other enqueue failures do not stamp; mixed same-tick proves A busy-skip + B enqueue together; RunPoller never runs two `executeJob`s concurrently.

## Handoff

Builder reports: files changed; confirmation that `code: "already_in_progress"` is set on both busy paths; confirmation stamp-on-skip only for that code; `DueCheckResult.skippedActive` added; Feature 04 “stamp only on success” superseded for busy-skip; RunPoller serial tests added or confirmed sufficient; any deviation (e.g. due-check file path) and why. Notes for Feature 06: still no `trigger` field — skipped-active fires leave no run row (by design). Post-V1: parallel cross-newsletter execution.

## Research notes

- **codegraph_explore** — `enqueueNewsletterRun` (`shared/src/runs/start.ts`), `findActiveRunForNewsletter` / `listActiveRunsForNewsletter`, `RunPoller` + `shouldClaim` + `inFlight` (`worker/src/run-poller.ts`).
- **Feature 04 spec** — multi-due enqueue-all; stamp only on success (revised here for busy); serial execution deferred to RunPoller / this feature.
- **PM grill (2026-07-16)** — Option 1 (prove + classify) with stamp-on-skip for same-newsletter already-active; B-while-A still enqueues once; structured `already_in_progress` code; logs + counters only (no GUI).
- **Grizzled Senior (2026-07-16)** — Added mixed same-tick A-busy + B-ok due-check case so continue-after-busy / no-global-gate cannot be gamed.
