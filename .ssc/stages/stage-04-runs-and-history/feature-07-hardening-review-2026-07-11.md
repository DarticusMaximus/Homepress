# Feature 07: Hardening review 2026-07-11

## Intent

Harden stage-04-runs-and-history against findings from review-stage-04-runs-and-history-2026-07-11: fix execution-path error-handling gaps that can orphan runs or lose completed work, add secret redaction and execution logging, improve feeds filter UX, add missing tests and accessibility labels, and tighten anti-cheat test hygiene — so the runs/history stage is production-safe and debuggable.

## Spec

All 20 confirmed findings from the review are addressed. No architectural changes — each fix is localized to existing files. The original features stay `verified`; this spec layers on top.

### Worker poller robustness (C1)

The poller's `tick()` checks `inFlight` before any `await` but sets it only after two network calls — a race window where `setInterval` fires a second overlapping tick. Fix: introduce a `ticking` flag set immediately after the early-return guard (before any `await`), reset in `finally`. Additionally:

- Add `.catch()` on the interval's `void this.tick()` invocation so an unexpected throw (e.g., null `startedAt` in `shouldClaim`) logs instead of crashing the process via unhandled rejection.
- Add a `shuttingDown` guard in `worker/src/index.ts` `shutdown()` so double-signal delivery (SIGTERM + SIGINT) is idempotent.
- Reset `inFlight = false; currentRunId = null` in `poller.shutdown()` after the markFailed attempt, in a `finally` block.

### Checkpoint load error handling (C2)

`loadPhaseCheckpoint` leaves `JSON.parse` and `reviveCheckpoint` outside the try/catch. Wrap them: on `SyntaxError` or `TypeError`, throw `RunRepositoryError("checkpoint_missing", ...)` so callers always get a typed error.

### Retry path + race cleanup error isolation (C3)

`requestFailedRunRetry` steps 6-7 (`requeueFailedRun`, `listActiveRunsForNewsletter`, `markFailed` loop) have no try/catch while steps 1-5 do. Wrap steps 6-7 in the same pattern: catch `RunRepositoryError` → `{ ok: false, error: err.message }`; catch unknown → `{ ok: false, error: GENERIC_ERROR }`.

Additionally, in both `start.ts` and `retry.ts`, isolate each `markFailed` call in the race-cleanup loop with its own try/catch so one failure doesn't abort remaining cleanup. Log failures and continue.

### Executor data loss prevention (C4, C5, N1)

Three fixes in `execute-run.ts` and `retry.ts`:

1. **Orphan prevention (C4):** The outer catch's `markFailed` is in a bare `catch {}`. Bind the error and log it (`console.error` with sanitized message, runId, phase) so orphaned `running` runs are diagnosable. Add a comment documenting the orphan risk and that a stale-run sweep is a future improvement.

2. **markCompleted resumability (C5):** After the draft checkpoint saves `completedPhase: "draft"`, a `markCompleted` failure makes the run non-resumable (`resumeStartPhase("draft")` → `null`). Fix: retry `markCompleted` once on failure. If the retry also fails, do NOT call `markFailed` with `failedPhase: "draft"` — instead keep the run as `failed` at `failedPhase: "selection"` (the last phase before draft whose checkpoint exists) so the run remains resumable from draft.

3. **Checkpoint catch blocks (N1):** In both `execute-run.ts:160-167` and `retry.ts:69-77`, bind the caught error and log it with structured context (phase, runId, sanitized message). Distinguish `RunRepositoryError("checkpoint_missing")` (genuine — show the locked "start new run" message) from other errors (transient — show "Could not load checkpoint due to a database error. Try again.").

### Secret redaction in failureMessage (S1)

The outer catch in `execute-run.ts` stores raw `err.message` into `failureMessage`. Apply `redactSecrets` from `log-redact.ts` to the message before passing to `markFailed`. Export `redactSecrets` (or add a `redactMessageForStorage(raw, maxLen)` helper) if not already exported.

### executeRun structured logging (O1)

Add `console.log` at: each phase start (`{ action: 'phase-start', runId, phase }`), checkpoint saved (`{ action: 'checkpoint-saved', runId, phase, articleCount }`), fatal outcome (`{ action: 'fatal-outcome', runId, phase, reason }`), resume hydration (`{ action: 'resume-hydrate', runId, completedPhase, startPhase }`), and completion (`{ action: 'run-completed', runId, selectedCount }`). No secrets in logs.

### Feeds page filter UX (C7, U2)

Pass the active `health` filter from `feeds/page.tsx` to `FeedsView`. When `health` is set and `total === 0`, show "No unhealthy feeds" (filter-aware copy) instead of the greenfield "No feeds yet" message. When `health` is set (regardless of total), show a visible filter indicator (Badge "Showing: unhealthy only") with a clear link to `/feeds` (no health param). This fixes both the misleading empty state and the missing filter affordance.

### Web observability: purge errors + Runs page degradation (C8, O2)

1. **purgeRunsNow (C8):** Include `errors` in the return type `{ ok: true; deleted: number; errors: number }`. In `retention-controls.tsx`, when `errors > 0`, show a warning toast: `Removed ${deleted} runs (${errors} failed)`.

2. **Runs page degradation (O2):** When `listNewsletters`, `listFeeds`, or `getOrCreateAppSettings` fail, show a non-blocking warning notice (e.g., a muted Alert) indicating some data could not be loaded. Primary `listRuns` failure keeps the existing destructive Alert.

### RetentionControls tests (T1)

Add `web/src/__tests__/retention-controls.test.tsx` covering: input rejects non-integer/out-of-range with correct toast; Save calls action with parsed value; Clean up now shows correct toast for deleted > 0, === 0, and error cases; button disabled states during transitions.

### Accessibility — aria-labels (U1)

Add `aria-label` to action buttons in list contexts incorporating the entity name: Retry (`aria-label={\`Retry ${run.newsletterName}\`}`), Generate (`aria-label={\`Generate ${newsletter.name}\`}`). Accept an `ariaLabel` prop from parent if cleaner. Apply to Edit/Delete buttons across list pages for parity.

### Anti-cheat test hygiene + dashboard leak + counter doc (N2-N5, S2, C6)

1. **Health tests (N4):** Import `FEED_UNHEALTHY_THRESHOLD` and derive boundary values instead of hardcoding 3 and 2.
2. **Retention tests (N5):** Import `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` and `DEFAULT_RUN_RETENTION_DAYS` instead of hardcoding 3 and 30.
3. **Shutdown test (N2):** Add `failedPhase` to the `expect.objectContaining` assertion.
4. **execute-run happy-path test (N3):** Add `expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled()`. Make the default mock throw instead of returning `{}`.
5. **Dashboard error leak (S2):** Type-filter both dashboard catch blocks: `err instanceof FeedRepositoryError ? err.message : "Unable to load feed health"` (and equivalent for the DB health check).
6. **Feed health counter doc (C6):** Add a code comment in `applyFeedFetchOutcomes` documenting the non-atomic read-modify-write and the V1 single-worker assumption.

## Dependencies

- Builds on: all 6 verified features of stage-04-runs-and-history (feature-01 through feature-06). No feature code may be missing — escalate if so.
- Review report: `.ssc/reviews/review-stage-04-runs-and-history-2026-07-11.md`

## Constraints

- **Do not change feature status** of features 01-06 in `ssc-state.json` — they stay `verified`.
- **Do not alter** Feature 01 checkpoint payload shapes or embedding-strip rules.
- **Do not change** the three Feature 03 Retry guard messages.
- **Do not introduce** new collections, buckets, or schema attributes.
- **Secrets:** never log API keys; use existing sanitize/redact helpers.
- **Server-only** Appwrite access via `getServerAppwrite()`.
- **Responsive domain lists:** any UI changes must keep table + cards in sync.

## Acceptance criteria

- [ ] Worker poller `tick()` sets its guard before any `await`; overlapping ticks never double-execute. Interval invocation has `.catch()`. `shutdown()` is idempotent.
- [ ] `loadPhaseCheckpoint` wraps `JSON.parse` + `reviveCheckpoint` in try/catch; corrupted files throw `RunRepositoryError("checkpoint_missing")`.
- [ ] `requestFailedRunRetry` never rejects — all errors in steps 6-7 return `{ ok: false, error }`. Race cleanup `markFailed` calls are individually isolated.
- [ ] `executeRun` outer catch logs `markFailed` failures. `markCompleted` failure preserves run resumability. Checkpoint catch blocks bind+log+ distinguish error types.
- [ ] `failureMessage` is redacted via `redactSecrets` before persistence — no API keys/tokens in stored messages.
- [ ] `executeRun` emits structured logs at phase transitions, checkpoints, fatal outcomes, hydration, and completion.
- [ ] Feeds page passes `health` filter to `FeedsView`; filter-aware empty state; filter indicator badge with clear link.
- [ ] `purgeRunsNow` returns `errors` count; partial-failure toast shows both counts. Runs page shows degradation notice on secondary data failures.
- [ ] `RetentionControls` has automated test coverage (validation, Save, Clean up now toast branches).
- [ ] Action buttons in list contexts have `aria-label` with entity name.
- [ ] Health tests import `FEED_UNHEALTHY_THRESHOLD`; retention tests import `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` and `DEFAULT_RUN_RETENTION_DAYS`. Shutdown test asserts `failedPhase`. Happy-path execute-run test asserts `loadPhaseCheckpoint` not called.
- [ ] Dashboard catch blocks type-filter with generic fallback — no raw error messages in DOM.
- [ ] `applyFeedFetchOutcomes` documents the non-atomic counter assumption.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm --filter worker` build, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `worker/src/run-poller.ts` — ticking flag, .catch on interval, shutdown reset
- Modify: `worker/src/index.ts` — shutdown idempotency guard
- Modify: `worker/src/__tests__/run-poller.test.ts` — concurrent tick test, failedPhase assertion, start/stop tests
- Modify: `shared/src/runs/repository.ts` — loadPhaseCheckpoint try/catch wrapper
- Modify: `shared/src/runs/execute-run.ts` — markFailed logging, markCompleted resumability, checkpoint catch binding/logging, secret redaction, structured logging
- Modify: `shared/src/runs/retry.ts` — steps 6-7 try/catch, checkpoint catch binding/logging
- Modify: `shared/src/runs/start.ts` — race cleanup markFailed isolation
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — loadPhaseCheckpoint not-called assertion, default mock throw, redaction tests
- Modify: `shared/src/runs/__tests__/retry.test.ts` — steps 6-7 error path tests
- Modify: `shared/src/feeds/health.ts` — non-atomic counter comment
- Modify: `shared/src/feeds/__tests__/health.test.ts` — import FEED_UNHEALTHY_THRESHOLD
- Modify: `shared/src/feeds/__tests__/repository.test.ts` — import FEED_UNHEALTHY_THRESHOLD
- Modify: `shared/src/runs/__tests__/retention.test.ts` — import constants, purge out-of-range test
- Modify: `web/app/(protected)/page.tsx` — type-filter dashboard catch blocks
- Modify: `web/app/(protected)/feeds/page.tsx` — pass health filter to FeedsView
- Modify: `web/app/(protected)/runs/page.tsx` — degradation notice on secondary failures
- Modify: `web/app/(protected)/runs/actions.ts` — include errors in purgeRunsNow return
- Modify: `web/components/feeds/feeds-view.tsx` — filter-aware empty state, filter indicator, clear link
- Modify: `web/components/runs/retention-controls.tsx` — partial-failure toast
- Modify: `web/components/runs/retry-run-button.tsx` — aria-label
- Modify: `web/components/newsletters/generate-newsletter-button.tsx` — aria-label
- Modify: `web/components/newsletters/newsletters-table.tsx` — aria-label on Edit/Delete
- Modify: `web/components/newsletters/newsletter-list-card.tsx` — aria-label on Edit/Delete
- Create: `web/src/__tests__/retention-controls.test.tsx` — RetentionControls coverage

## Testing approach

Test-first where practical. Most fixes are small and localized; tests focus on the new error paths and assertions.

1. **Poller race:** call `tick()` without awaiting, call again before resolve; assert single `executeJob`. Assert `shutdown()` is idempotent (double-call → single markFailed). Assert `.catch()` prevents unhandled rejection on `shouldClaim` throw.
2. **Checkpoint load:** seed corrupted JSON → `checkpoint_missing`; seed wrong shape → same code.
3. **Retry error paths:** mock `requeueFailedRun` to throw → `{ ok: false }`; mock `markFailed` to throw mid-loop → graceful return, all calls attempted.
4. **Executor:** mock `markCompleted` to throw after draft checkpoint → run remains resumable (retry from draft). Assert `failureMessage` is redacted when phase function throws error containing `sk-or-v1-...`. Assert structured log calls at phase transitions.
5. **Feeds UX:** render FeedsView with health=unhealthy and total=0 → assert no "No feeds yet" text. Render with filter active → assert filter indicator and clear link.
6. **Purge errors:** mock purgeExpiredRuns returning {deleted:5, errors:2} → assert toast includes both.
7. **RetentionControls:** validation, Save, Clean up now toast branches.
8. **Anti-cheat:** existing tests pass after constant imports; shutdown test asserts failedPhase; happy-path asserts loadPhaseCheckpoint not called.

## Tasks

### Task 1: Worker poller race + lifecycle hardening

- **Action:** In `worker/src/run-poller.ts`, introduce a `private ticking = false` flag set immediately after the `inFlight` early-return check in `tick()` (before any `await`), reset in a `finally` block. Add `.catch((err) => this.log(...))` on the interval's `void this.tick()` call. Add `shuttingDown` guard in `worker/src/index.ts` `shutdown()`. Reset `inFlight`/`currentRunId` in `poller.shutdown()` in a `finally`. Update `run-poller.test.ts`: add concurrent-tick test, start/stop tests, assert `failedPhase` in shutdown test.
- **Expected result:** Overlapping ticks never double-execute; unexpected throws don't crash the process; shutdown is idempotent.
- **Verify:** `pnpm --filter worker` build; `worker/src/__tests__/run-poller.test.ts` covers concurrent tick, start/stop, failedPhase assertion.
- **Depends on:** none.

### Task 2: Checkpoint load + executor error handling + data loss prevention

- **Action:** (1) Wrap `JSON.parse` + `reviveCheckpoint` in `loadPhaseCheckpoint` (`repository.ts`) with try/catch → `checkpoint_missing`. (2) In `execute-run.ts`: bind+log error in outer `markFailed` catch (C4); retry `markCompleted` once on failure, on second failure mark `failedPhase: "selection"` not `"draft"` to preserve resumability (C5); bind+log+distinguish in checkpoint hydration catch (N1). (3) In `retry.ts`: bind+log+distinguish in checkpoint preflight catch (N1).
- **Expected result:** Corrupted checkpoints yield typed errors; orphaned runs are diagnosable; markCompleted failure doesn't lose completed work; checkpoint errors distinguish missing from transient.
- **Verify:** `pnpm --filter @newsletter/shared test` — corrupted-checkpoint test, markCompleted-failure resumability test, checkpoint-catch logging test, error-type-distinguishing test.
- **Depends on:** none.

### Task 3: Retry path + race cleanup error isolation

- **Action:** In `retry.ts`, wrap steps 6-7 (`requeueFailedRun`, `listActiveRunsForNewsletter`, `markFailed` loop) in try/catch returning `{ ok: false, error }`. Isolate each `markFailed` in the race-cleanup loop (both `retry.ts` and `start.ts`) with individual try/catch — log and continue. Update `retry.test.ts` with steps 6-7 error path tests.
- **Expected result:** `requestFailedRunRetry` never rejects; race cleanup attempts all markFailed calls regardless of individual failures.
- **Verify:** `pnpm --filter @newsletter/shared test` — requeueFailedRun-throws test, markFailed-throws-mid-loop test.
- **Depends on:** none.

### Task 4: Secret redaction in failureMessage

- **Action:** Export `redactSecrets` from `log-redact.ts` (or add `redactMessageForStorage`). Apply it to the error message in `execute-run.ts` outer catch before passing to `markFailed`. Add test: phase function throws error containing `sk-or-v1-abc123`; assert stored `failureMessage` does not contain the key.
- **Expected result:** No API keys, bearer tokens, or long alphanumeric runs in persisted `failureMessage`.
- **Verify:** `pnpm --filter @newsletter/shared test` — redaction test passes; existing fatal-outcome messages unaffected.
- **Depends on:** none.

### Task 5: executeRun structured logging

- **Action:** Add `console.log` calls at phase start, checkpoint saved, fatal outcome, resume hydration, and completion in `execute-run.ts`. Use structured objects with `runId`, `phase`, `action`. No secrets.
- **Expected result:** Production execution trace is visible in worker logs.
- **Verify:** `pnpm --filter @newsletter/shared test` — assert console.log called at phase-start and resume-hydrate; `pnpm --filter worker` build.
- **Depends on:** none.

### Task 6: Feeds page filter UX

- **Action:** Pass `health` prop from `feeds/page.tsx` to `FeedsView`. In `feeds-view.tsx`: when `health` is set and `total === 0`, show filter-aware empty state ("No unhealthy feeds"). When `health` is set, show a Badge filter indicator with clear link to `/feeds`.
- **Expected result:** Operator arriving from dashboard sees filter context and can clear it; empty state is not misleading.
- **Verify:** `pnpm --filter web build`; visual check or component test: filter active + total 0 → no "No feeds yet"; filter active → indicator + clear link present.
- **Depends on:** none.

### Task 7: Web observability — purge errors + Runs page degradation

- **Action:** (1) Include `errors` in `purgeRunsNow` return; show warning toast when `errors > 0` in `retention-controls.tsx`. (2) Add non-blocking degradation notice on Runs page when `listNewsletters`, `listFeeds`, or `getOrCreateAppSettings` fail.
- **Expected result:** Partial purge failures visible; secondary data load failures visible to operator.
- **Verify:** `pnpm --filter web build`; `pnpm typecheck`; `pnpm test`.
- **Depends on:** none.

### Task 8: RetentionControls tests

- **Action:** Create `web/src/__tests__/retention-controls.test.tsx` covering input validation (non-integer, out-of-range), Save action, Clean up now toast branches (deleted > 0, === 0, error), button disabled states.
- **Expected result:** RetentionControls has automated coverage.
- **Verify:** `pnpm test` — retention-controls tests pass.
- **Depends on:** Task 7 (for the errors-in-return change).

### Task 9: Accessibility — aria-labels

- **Action:** Add `aria-label` with entity name to Retry, Generate, Edit, and Delete buttons across `retry-run-button.tsx`, `generate-newsletter-button.tsx`, `newsletters-table.tsx`, `newsletter-list-card.tsx`. Accept an `ariaLabel` prop from parent if cleaner.
- **Expected result:** Screen reader users can distinguish action buttons by entity name.
- **Verify:** `pnpm --filter web build`; `pnpm typecheck`.
- **Depends on:** none.

### Task 10: Anti-cheat test hygiene + dashboard leak + counter doc

- **Action:** (1) Import `FEED_UNHEALTHY_THRESHOLD` in `health.test.ts` and `repository.test.ts`; replace hardcoded 3/2 with derived values (N4). (2) Import `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` and `DEFAULT_RUN_RETENTION_DAYS` in `retention.test.ts` (N5). (3) Assert `loadPhaseCheckpoint` not called in execute-run happy-path test; change default mock to throw (N3). (4) Type-filter dashboard catch blocks in `page.tsx` with generic fallback (S2). (5) Add non-atomic counter comment in `health.ts` (C6).
- **Expected result:** Tests derive from production constants; dashboard doesn't leak raw errors; counter assumption documented.
- **Verify:** `pnpm --filter @newsletter/shared test`; `pnpm --filter web build`; `pnpm typecheck`.
- **Depends on:** none.

### Task 11: Feature verification pass

- **Action:** Re-read all changes vs the review findings; ensure all acceptance criteria are met; run full gates.
- **Expected result:** All 20 review findings addressed; all tests/typecheck/build green.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 1-10.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Spot-check that no review finding's acceptance criteria is unmet.

## Handoff

Builder reports: files modified; confirmation that each review finding's acceptance criteria is met; any deviation and why. The review report at `.ssc/reviews/review-stage-04-runs-and-history-2026-07-11.md` is the reference — mark findings as resolved in its checkboxes as work completes.

**Research note:** Review report `review-stage-04-runs-and-history-2026-07-11.md` (20 findings: 15 Medium, 5 Low). All confirmed by validator sub-agents. Priorities: execution-path error handling (C1-C5, N1, S1, O1) is the highest-impact cluster; feeds filter UX (C7, U2) is the most user-visible; anti-cheat test improvements (N2-N5) are cheap hygiene. PM decision: address all 20 now.
