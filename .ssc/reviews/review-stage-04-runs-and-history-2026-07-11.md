# SSC Code Review Report

**Date:** 2026-07-11
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-04-runs-and-history (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-04-runs-and-history.md` + 6 feature specs in `.ssc/stages/stage-04-runs-and-history/`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 15 | Low 5 | Nit 0
- **Overall rationale:** No Blockers or Highs. The stage delivers its Intent across all 6 features — runs, checkpoints, retry, feed health, and retention all work as specified. The 15 Medium findings cluster into three themes: (1) error-handling gaps in the execution/resume path that can orphan runs or mask transient failures as permanent data loss; (2) observability blind spots in the worker executor and web pages; (3) UX gaps on the feeds page when arriving from the dashboard health link. The 5 Low findings are anti-cheat and security items surfaced per the always-on policy. All findings are addressable without architectural changes.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** stage-04-runs-and-history (6 verified features: run-checkpoints, on-demand-runs, run-history, failed-run-retry, feed-health, run-retention)
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 56 source + test files across shared, worker, and web packages
  - **shared/src/runs/** — `types.ts`, `repository.ts`, `index.ts`, `start.ts`, `execute-run.ts`, `phases.ts`, `retry.ts`, `failed-feeds.ts`, `retention.ts` + 8 test files
  - **shared/src/feeds/** — `health.ts`, `types.ts`, `repository.ts`, `index.ts` + 2 test files
  - **shared/src/settings/** — `types.ts`, `repository.ts`, `index.ts` + 1 test file
  - **shared/src/schema/** — `declarations.ts`, `provisioner.ts` + 3 test files
  - **worker/src/** — `index.ts`, `run-poller.ts`, `registry.ts`, `parity-run.ts` + 1 test file
  - **web/app/(protected)/** — `runs/page.tsx`, `runs/actions.ts`, `newsletters/actions.ts`, `feeds/page.tsx`, `page.tsx`
  - **web/components/** — `runs/` (7 components), `feeds/` (5 components), `newsletters/` (3 components), `feeds-health-card/` (1 component)
  - **web/src/__tests__/** — 4 web test files
- **Files skipped:** 0 — all in-scope files were reviewed
- **Assumptions and unknowns:**
  - Reviewers could not spawn one B2 sub-agent successfully in a single call (returned empty twice); B2 was split into B2a (source) and B2b (worker+tests) — all files covered.
  - The codebase uses Vitest for shared/worker tests and a mix of component and route tests for web. No Playwright/e2e tests exist for Stage 04 features.
  - **Below-floor findings not detailed:** 27 additional Low/Nit findings (maintainability, testing, performance) were identified and validated but are below the Medium severity floor. They are summarized in Quality Signals. Full detail available on request.

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Stage Intent:** Make newsletter generation observable and safely recoverable, so the operator can diagnose failures, retry without repeating completed network or LLM work, and notice feeds that have become unreliable.
- **Intent served?** Yes
- **Notes:** All 6 features deliver their Intent. Checkpoints are durable and resume-input-only; the executor persists each phase; retry resumes from the failed phase skipping completed work; feed health tracks operational failures separately from qualification; retention protects the latest 3 completed runs per newsletter. The Medium findings are quality gaps within the delivered features, not Intent violations. No spec drift detected (anti-cheat spec-drift checks passed).

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker -> Nit) then category. Track completion only via these checkboxes.

---

### [ ] C1-20260711: Worker poller in-flight guard race allows double-execution

| Field | Value |
|---|---|
| **ID** | `C1-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `worker/src/run-poller.ts:58-96` |
| **Description** | The `tick()` method checks `this.inFlight` at line 58 but only sets it at line 92 — after two awaited network calls (`listPendingRuns` at line 62 and `listActiveRunsForNewsletter` at line 79). Between the check and the set, `setInterval` can fire again, starting a second overlapping tick that also sees `inFlight === false`. Both ticks discover the same pending run, both pass `shouldClaim`, and both call `executeJob`, violating the spec's "single in-flight run globally for V1" guarantee. |
| **Risk / Impact** | Double-execution of the full pipeline for the same run — double-spending LLM API calls (cost), concurrent checkpoint file writes (data corruption risk), and conflicting DB updates. Probability scales inversely with poll interval and directly with DB latency. |
| **Evidence** | Line 58: `if (this.inFlight) return;`. Lines 62-88: two `await` calls before line 92: `this.inFlight = true;`. Line 110: `void this.tick()` — timer fires independently of tick duration. |
| **Recommendation** | Set a separate `ticking = false` flag immediately after the early-return check, before any `await`. Reset it in a `finally` block. Or set `this.inFlight = true` at the top of `tick()` and reset on early-return paths. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Call `tick()` without awaiting, then call `tick()` again before the first resolves. Assert only one `executeJob` invocation. Use delayed mock resolves. |
| **Acceptance Criteria** | Two overlapping tick invocations never both reach `executeJob`; only one job runs at a time regardless of DB latency. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Race window verified: check at line 58, set at line 92, two awaits between. Window is narrow (requires 2 Appwrite round-trips exceeding pollMs) but structurally real. |

---

### [ ] C2-20260711: loadPhaseCheckpoint unguarded JSON.parse/revive on corrupted file

| Field | Value |
|---|---|
| **ID** | `C2-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/repository.ts:721-723` |
| **Description** | `loadPhaseCheckpoint` calls `JSON.parse(text)` and `reviveCheckpoint(phase, parsed)` outside any error-handling block. If a checkpoint file is corrupted, truncated, or has an unexpected JSON shape, `JSON.parse` throws a raw `SyntaxError` and `reviveCheckpoint` throws a raw `TypeError`. These propagate as unhandled native errors, not `RunRepositoryError`, violating the repository's contract that all failures surface with a defined code. |
| **Risk / Impact** | Feature 04 (run resume) calls `loadPhaseCheckpoint` to restart from a checkpoint. A corrupted Storage file crashes the resume path with an opaque error rather than a catchable `RunRepositoryError` with code `checkpoint_missing`. |
| **Evidence** | The try/catch at lines 705-719 only wraps `getFileDownload`. Lines 721-723 (`JSON.parse` + `reviveCheckpoint`) are unguarded. `reviveCheckpoint` does bare casts like `(parsed as { articles: ArticleJson[] }).articles.map(...)`. |
| **Recommendation** | Wrap lines 721-723 in a try/catch. On `SyntaxError` or shape-mismatch, throw `RunRepositoryError("checkpoint_missing", "Checkpoint file for phase ${phase} is corrupted or unreadable")`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Seed Storage with invalid JSON; assert `checkpoint_missing`. Seed valid JSON with wrong shape; assert same code. |
| **Acceptance Criteria** | `loadPhaseCheckpoint` never throws a raw `SyntaxError` or `TypeError`; all parse/revive failures surface as `RunRepositoryError` with code `checkpoint_missing` or `appwrite`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: `JSON.parse` and `reviveCheckpoint` are outside the `getFileDownload` try/catch. No surrounding guard. |

---

### [ ] C3-20260711: retry.ts steps 6-7 unguarded — function rejects instead of returning RetryResult

| Field | Value |
|---|---|
| **ID** | `C3-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/retry.ts:81-101` |
| **Description** | Steps 1-5 of `requestFailedRunRetry` meticulously catch errors and return `{ ok: false, error }`. Steps 6-7 (`requeueFailedRun` at line 81, `listActiveRunsForNewsletter` at line 84, the `markFailed` race-cleanup loop at lines 86-94) have no try/catch. If any throws, the function rejects instead of returning its typed `RetryResult`, breaking the web action contract. |
| **Risk / Impact** | A concurrent status change or transient DB error during requeue causes an unhandled rejection. The operator sees a generic crash instead of a specific toast. After a successful requeue but failed race cleanup, zombie active runs may persist. |
| **Evidence** | Lines 32-42: `getRun` wrapped in try/catch. Lines 68-78: `loadPhaseCheckpoint` wrapped. Lines 81-101: no try/catch around `requeueFailedRun`, `listActiveRunsForNewsletter`, or the `markFailed` loop. |
| **Recommendation** | Wrap steps 6-7 in the same error-handling pattern as steps 1-4: catch `RunRepositoryError` → `{ ok: false, error: err.message }`; catch unknown → `{ ok: false, error: GENERIC_ERROR }`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock `requeueFailedRun` to throw; assert `{ ok: false, error }` returned, not rejection. Mock `markFailed` to throw mid-loop; assert graceful return. |
| **Acceptance Criteria** | `requestFailedRunRetry` never rejects for any `RunRepositoryError`; always returns a `RetryResult`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: steps 1-5 each have try/catch; steps 6-7 have none. A throw propagates as unhandled rejection. |

---

### [ ] C4-20260711: markFailed failure in executor catch orphans run as 'running' — permanently blocks newsletter

| Field | Value |
|---|---|
| **ID** | `C4-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/execute-run.ts:323-330` |
| **Description** | The outer catch in `executeRun` calls `markFailed` inside a bare `catch {}` that swallows the error silently. If `markFailed` fails (transient Appwrite error), the run stays `running` — the last `markRunning` set it. The active-run guard (`findActiveRunsForNewsletter`) treats `running` as active, permanently blocking all future Generate and Retry for that newsletter. No stale-run detection or sweep exists. |
| **Risk / Impact** | A transient network blip at the exact moment of recording failure permanently bricks a newsletter — no new runs can be started or retried. Requires manual DB intervention. Likelihood is non-trivial: the pipeline runs for minutes, and the window overlaps with any brief network issue. |
| **Evidence** | Lines 328-330: `try { await markFailed(...) } catch { /* Best-effort */ }` — no logging, no retry. The worker only claims `pending` runs, so the orphan is never reclaimed. |
| **Recommendation** | At minimum, log the markFailed failure so operators can diagnose the orphan. Ideally add 1-2 retry attempts for markFailed. Consider a stale-run sweep in the worker poller (runs in `running` longer than N minutes → mark failed). |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Mock `markFailed` to throw in the catch block; assert the original error is re-thrown AND the markFailed failure is logged. |
| **Acceptance Criteria** | markFailed failures in the catch block are logged with structured context (runId, phase, error). At least one retry attempt for markFailed on transient failure. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: bare `catch {}` at line 328 swallows markFailed failure. Run stays `running`. `listActiveRunsForNewsletter` queries `['pending','running']`, so the stuck run blocks future starts. No stale-run sweep in worker. |

---

### [ ] C5-20260711: markCompleted failure after draft checkpoint makes run permanently non-resumable

| Field | Value |
|---|---|
| **ID** | `C5-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/execute-run.ts:291-332` |
| **Description** | After the draft phase succeeds and `savePhaseCheckpoint("draft", ...)` sets `completedPhase: "draft"`, if the subsequent `markCompleted` throws (transient DB error), the outer catch calls `markFailed` with `failedPhase: "draft"`. On retry, `resumeStartPhase("draft")` returns `null` (draft is the last phase), so `requestFailedRunRetry` returns "This run cannot be resumed." All pipeline work — fetch, scrape, tag, score, selection, draft — is permanently lost despite every checkpoint being saved. |
| **Risk / Impact** | A transient DB error at the exact moment of completion marking permanently destroys a fully-completed run. The operator must start from scratch, re-spending the entire pipeline's LLM and network budget. The draft markdown exists in the checkpoint file but is unreachable. |
| **Evidence** | Line 306: `savePhaseCheckpoint("draft")` sets `completedPhase: "draft"`. Lines 314-319: `markCompleted` — if this throws, line 324 calls `markFailed` with `currentPhase: "draft"`. `phases.ts:21`: `resumeStartPhase("draft")` → `nextPhase("draft")` → `null`. `retry.ts:60-65`: null startPhase → "cannot be resumed." |
| **Recommendation** | Handle `markCompleted` failure separately: retry `markCompleted` (1-2 attempts) before falling back to `markFailed`. Or do NOT advance `completedPhase` to "draft" until `markCompleted` succeeds — keep it at "selection" so the run can retry from draft. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Mock `markCompleted` to throw after draft checkpoint saved; assert the run remains resumable (can retry from draft). |
| **Acceptance Criteria** | A transient `markCompleted` failure does not permanently lose a fully-executed run. The run is retryable and resumes from the draft phase. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Traced: draft checkpoint saves completedPhase="draft", markCompleted failure → markFailed(failedPhase="draft"), resumeStartPhase("draft") returns null, retry returns "cannot be resumed". Draft markdown is in checkpoint but inaccessible. |

---

### [ ] C6-20260711: Non-atomic feed health counter increment (read-modify-write race)

| Field | Value |
|---|---|
| **ID** | `C6-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/feeds/health.ts:42,57-102` |
| **Description** | `applyFeedFetchOutcomes` reads all feed counters via a single `listFeeds` snapshot (line 42), then writes back incremented values in a sequential loop. The counter increment `(feed.consecutiveFetchFailures ?? 0) + 1` is computed from the stale snapshot, not from the current DB value. When two runs execute concurrently and both fetch the same failing feed, both read the same counter, both compute the same incremented value, and the second write overwrites the first — one increment is silently lost. |
| **Risk / Impact** | A chronically failing feed shared across newsletters may take longer to reach the unhealthy threshold (3) if concurrent runs overwrite each other's increments. In the worst case, the feed never reaches unhealthy, defeating Feature 05's core purpose. |
| **Evidence** | Line 42: `const feeds = await listFeeds(client)` — single snapshot. Line 67: `(feed.consecutiveFetchFailures ?? 0) + 1` — reads from snapshot. Line 88: `updateDocument` — blind overwrite, no version check. |
| **Recommendation** | Document the single-worker assumption in a code comment. For a fix: use Appwrite optimistic concurrency ($updatedAt comparison in a read-check-write loop with retry on mismatch), or acknowledge V1 single-worker mitigates this and add a comment. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Simulate two concurrent `applyFeedFetchOutcomes` calls on same feed with counter=0; document that the final counter should ideally be 2 but is 1 under current code. |
| **Acceptance Criteria** | Code documents the non-atomic increment tradeoff and single-worker assumption, OR an optimistic concurrency mechanism is added. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: snapshot read at line 42, blind overwrite at line 88, no optimistic concurrency guard. Single-worker V1 mitigates but doesn't eliminate the race. |

---

### [ ] C7-20260711: Feeds empty state shows "No feeds yet" when filtered to unhealthy with zero results

| Field | Value |
|---|---|
| **ID** | `C7-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/components/feeds/feeds-view.tsx:18` |
| **Description** | When the dashboard links to `/feeds?health=unhealthy` and the filtered set is empty (feeds self-healed between loads), the FeedsView component shows "No feeds yet. Add your first RSS source to get started." — factually wrong. There ARE feeds; none are unhealthy. The page doesn't pass the `health` filter to FeedsView, so the component cannot produce a filter-aware empty state. |
| **Risk / Impact** | Operator arriving from the dashboard "3 unhealthy" link sees "No feeds yet" if feeds recovered — misleading them to believe no feeds exist. May add duplicate feeds. |
| **Evidence** | `feeds/page.tsx:79`: `<FeedsView feeds={feeds} total={total} />` — no `health` prop. FeedsView line 18: `if (total === 0)` unconditionally shows the greenfield message. |
| **Recommendation** | Pass the `health` filter to FeedsView. When `isFiltered && total === 0`, show "No unhealthy feeds" instead of the greenfield message. Add a "View all feeds" link to clear the filter. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Render FeedsView with total=0 and health filter active; assert text does NOT contain "No feeds yet" and DOES contain "unhealthy". |
| **Acceptance Criteria** | Empty state with health=unhealthy shows filter-aware copy, not the greenfield message. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: FeedsView receives only {feeds, total}. No health prop. total===0 triggers greenfield message regardless of filter state. |

---

### [ ] C8-20260711: purgeRunsNow action discards errors count from purge result

| Field | Value |
|---|---|
| **ID** | `C8-20260711` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/app/(protected)/runs/actions.ts:44` |
| **Description** | `purgeRunsNow` calls `purgeExpiredRuns` which returns `{ deleted, errors, retentionDays }`, but the action maps only to `{ ok: true, deleted: result.deleted }`, silently discarding `errors`. The toast shows the deleted count with no indication that some runs failed to delete. |
| **Risk / Impact** | Operator believes cleanup fully succeeded when partial failures occurred. Consistent failures (e.g., orphaned Storage files) accumulate silently. |
| **Evidence** | Action line 46: `return { ok: true, deleted: result.deleted }` — `errors` dropped. retention-controls.tsx:84-88: toast reads only `result.deleted`. |
| **Recommendation** | Include `errors` in the return type. When `errors > 0`, show a warning toast: `Removed ${deleted} runs (${errors} failed)`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock purgeExpiredRuns to return { deleted: 5, errors: 2 }; assert toast includes both counts. |
| **Acceptance Criteria** | purgeRunsNow return includes errors count. When errors > 0, UI surfaces a warning. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: action returns only `deleted`. retention.ts returns `{deleted, errors, retentionDays}`. Toast path reads only `deleted`. |

---

### [ ] S1-20260711: Raw error messages persisted to failureMessage without secret redaction

| Field | Value |
|---|---|
| **ID** | `S1-20260711` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/runs/execute-run.ts:321-327` |
| **Description** | The outer catch stores raw `err.message` from pipeline phase functions (fetchFeeds, scrapeAll, tagArticles, scoreArticles, selectDiverse, NewsletterDrafter.draft) directly into `failureMessage` via `markFailed`, without applying any secret-redaction. The codebase has `redactSecrets` (log-redact.ts) which redacts `sk-*` API keys, `Bearer` tokens, and long alphanumeric runs — but it is only invoked through `sanitizeAppwriteMessageForLog` for console.error logging, never for DB persistence. OpenRouter API keys or authenticated feed URLs in thrown error messages will be persisted verbatim and displayed on `/runs`. |
| **Risk / Impact** | API keys, bearer tokens, or authenticated feed URLs leaked into the Appwrite `runs` document, visible to any operator with `/runs` access. Secrets persist in the DB until retention purge. |
| **Evidence** | Line 321-327: `const message = err instanceof Error ? err.message : '...'` → `markFailed(client, runId, { failedPhase: currentPhase, failureMessage: message.slice(0, FAILURE_MESSAGE_MAX) })`. `markFailed` (repository.ts:377) only does `.slice(0, FAILURE_MESSAGE_MAX)` — no redaction. `redactSecrets` (log-redact.ts:7-12) exists but is used only in console.error paths. |
| **Recommendation** | Apply `redactSecrets` (or a `redactMessageForStorage` helper) to `message` before passing to `markFailed`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Throw an error containing `sk-or-v1-abc123...` from a mocked phase function; assert the stored `failureMessage` does NOT contain the key substring. |
| **Acceptance Criteria** | No error message persisted to `failureMessage` contains patterns matching `sk[-_]...`, `Bearer ...`, or 24+ char alphanumeric runs. Full error detail still available in server-side logs. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: `redactSecrets` exists at log-redact.ts:7-12 but is used only in `sanitizeAppwriteMessageForLog` for console.error (repository.ts:52, execute-run.ts:187). DB persistence path bypasses it. |

---

### [ ] N1-20260711: Checkpoint catch blocks swallow all errors without logging — masks transient failures as permanent data loss

| Field | Value |
|---|---|
| **ID** | `N1-20260711` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `shared/src/runs/execute-run.ts:160-167`; `shared/src/runs/retry.ts:69-77,41` |
| **Description** | The checkpoint-hydration catch in `executeRun` (lines 160-167) uses a bare `catch {}` with no error binding — completely discarding the original error. The retry preflight catch (retry.ts:69-77) has the same pattern. Both uniformly report "Cannot retry: checkpoint data is missing" regardless of actual cause. This broad catch masks: (a) transient Appwrite outages reported as permanent data loss, (b) code bugs in hydration mapping reported as missing data, (c) any non-`checkpoint_missing` error. An operator seeing "data is missing" during a DB outage may abandon the run and start fresh, repeating all LLM/network work — the exact cost the retry feature exists to prevent. |
| **Risk / Impact** | Operators discard recoverable runs during transient failures. Developers cannot distinguish genuine data loss from transient outages or code bugs. No diagnostic log trail for the most critical failure path in the retry feature. |
| **Evidence** | execute-run.ts line 160: `} catch {` — no error binding, no logging. retry.ts line 71: same `} catch {` pattern. Both catch `RunRepositoryError("checkpoint_missing")` and `RunRepositoryError("appwrite")` identically despite the distinction existing in the repository layer. |
| **Recommendation** | (1) Bind the error and log it with structured context before `markFailed`. (2) Distinguish `checkpoint_missing` (show "start new run" message) from `appwrite` errors (show "database temporarily unavailable, try again"). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock `loadPhaseCheckpoint` to throw `RunRepositoryError("appwrite")`; verify it is logged and the message differs from genuine `checkpoint_missing`. |
| **Acceptance Criteria** | All caught errors are logged with structured context. Operator message distinguishes permanent data loss from transient DB errors. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: both catch blocks use bare `catch {}` with no binding. `RunRepositoryError` codes `checkpoint_missing` and `appwrite` exist but are not distinguished. |

---

### [ ] O1-20260711: executeRun has minimal structured logging across entire phase loop

| Field | Value |
|---|---|
| **ID** | `O1-20260711` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `shared/src/runs/execute-run.ts:170-319` |
| **Description** | The 150-line phase loop has exactly one `console.error` call (lines 185-188, feed-health catch). No logging at phase transitions (`markRunning`), checkpoint saves, fatal outcomes, resume hydration, or completion. For an autonomous worker process running unattended, there is no execution trace: if a run fails, the only diagnostic is the truncated `failureMessage` in the DB. |
| **Risk / Impact** | Debugging failed runs in production requires guessing from `failureMessage` alone. Cannot correlate worker logs to specific runs/phases. Resume behavior (which phases skipped, what hydrated) is unverifiable. |
| **Evidence** | Lines 170-319: six phase blocks, each with markRunning → phase function → fatal check → savePhaseCheckpoint. None emit any log. Lines 142-168: checkpoint hydration — no log. |
| **Recommendation** | Add structured `console.log` at: phase start (`{ phase, runId, action: 'phase-start' }`), checkpoint saved (`{ phase, runId, articleCount }`), fatal outcome (`{ phase, runId, reason }`), resume hydrate (`{ completedPhase, startPhase }`), completion (`{ runId, selectedCount }`). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Assert console.log called with phase-start context at each phase. Assert resume-hydrate log includes completedPhase and startPhase. |
| **Acceptance Criteria** | Every phase transition emits a structured log with runId and phase. Fatal outcomes and resume hydration are logged. Logs contain no secrets. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: only one console.error in 150 lines. No console.log at any phase transition, checkpoint, fatal outcome, or hydration point. |

---

### [ ] O2-20260711: Runs page silently swallows secondary data failures — no UI indicator

| Field | Value |
|---|---|
| **ID** | `O2-20260711` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `web/app/(protected)/runs/page.tsx:67-93` |
| **Description** | Failures from `listNewsletters` (line 71), `listFeeds` (line 81), and `getOrCreateAppSettings` (line 92) are caught with only `console.error` and silent fallback to empty/default values. The operator sees a page with an empty newsletter dropdown, no feed-name resolution (raw URLs), and default 30-day retention — with zero UI indication that data is missing. Only the primary `listRuns` failure renders a destructive Alert. |
| **Risk / Impact** | Partial Appwrite degradation produces a seemingly functional page with missing data. Operator assumes no newsletters exist or the system is working correctly when it isn't. Only diagnostic is server-side console.error the operator never sees. |
| **Evidence** | Lines 67-72: `listNewsletters` catch → `console.error`, `newsletters = []`. Lines 77-82: `listFeeds` catch → same. Lines 87-93: `getOrCreateAppSettings` catch → same. Compare: primary `listRuns` failure (line 59-65) sets `loadError` → renders destructive Alert. |
| **Recommendation** | Add a non-blocking warning banner for partial degradation: "Some data could not be loaded — filter options may be incomplete." |
| **Effort** | M |
| **Confidence** | Medium |
| **Suggested Tests** | Mock `listNewsletters` to reject; assert a visible degradation indicator appears. |
| **Acceptance Criteria** | When a secondary data source fails, the operator sees a non-blocking visual indicator. Primary data failure still shows the destructive Alert. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: three secondary queries catch with only console.error and silent fallback. No UI indicator renders on partial failure. |

---

### [ ] T1-20260711: RetentionControls has no test coverage

| Field | Value |
|---|---|
| **ID** | `T1-20260711` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `web/components/runs/retention-controls.tsx` |
| **Description** | RetentionControls has non-trivial client-side logic (numeric validation, integer check, bounds 1-365, two independent `useTransition` actions, toast branches for success/error/zero-deleted) but no test coverage. Feature 06 spec (Testing approach section 12) explicitly calls for web tests: "update action rejects out-of-range; purge action returns deleted count shape." |
| **Risk / Impact** | Client-side validation regressions are undetectable. Toast messaging changes are unverified. A future refactor could break the Save/Clean up now wiring with no test signal. |
| **Evidence** | No test file references RetentionControls, updateRunRetentionSetting, or purgeRunsNow across `web/src/__tests__/`. |
| **Recommendation** | Add `web/src/__tests__/retention-controls.test.tsx` covering: input rejects non-integer/out-of-range; Save calls action with parsed value; Clean up now shows correct toast for deleted > 0, === 0, and error cases. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Input 'abc' or '0' or '366' → toast.error. Input '14' → Save → toast.success. Clean up now → mock {ok:true, deleted:3} → toast.success 'Removed 3 old runs'. |
| **Acceptance Criteria** | RetentionControls validation, Save, and Clean up now paths are covered by automated tests. All toast branches asserted. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: grep for RetentionControls/purgeRunsNow/updateRunRetentionSetting across test files returned zero matches. |

---

### [ ] U1-20260711: Action buttons lack aria-label with entity name — WCAG 4.1.2

| Field | Value |
|---|---|
| **ID** | `U1-20260711` |
| **Severity** | Medium |
| **Category** | UX / Accessibility |
| **Location** | `web/components/runs/retry-run-button.tsx:16`; `web/components/newsletters/generate-newsletter-button.tsx:26` |
| **Description** | Retry and Generate buttons render with text "Retry"/"Generate" but no `aria-label` connecting them to the specific run or newsletter. In list contexts with multiple rows, a screen reader navigating by button list hears "Retry, Retry, Retry" or "Generate, Generate, Generate" with no way to distinguish which entity each targets. |
| **Risk / Impact** | Screen reader users cannot determine which run or newsletter a button acts on without navigating to surrounding context. Violates WCAG 2.1 Success Criterion 4.1.2 (Name, Role, Value). |
| **Evidence** | retry-run-button.tsx:16-33: `<Button ...>Retry</Button>` — no aria-label. generate-newsletter-button.tsx:26-43: same pattern. Edit and Delete buttons across list pages have the same issue. |
| **Recommendation** | Add `aria-label` incorporating the entity name: `<Button aria-label={`Retry ${run.newsletterName}`}>`. Accept an `ariaLabel` prop from parent for all action buttons. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Render with two failed runs; assert each Retry button has a unique accessible name (e.g., `getByRole('button', { name: /Retry Weekly Tech/ })`). |
| **Acceptance Criteria** | Each action button in a multi-row table/card has a unique accessible name including the row's entity name. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: neither button has aria-label. Multiple identical-text buttons in list contexts. |

---

### [ ] U2-20260711: Feeds page has no visible health filter indicator or clear-filter link

| Field | Value |
|---|---|
| **ID** | `U2-20260711` |
| **Severity** | Medium |
| **Category** | UX / Accessibility |
| **Location** | `web/components/feeds/feeds-view.tsx:15` |
| **Description** | When the dashboard links to `/feeds?health=unhealthy`, the Feeds page applies the filter server-side but FeedsView has no visible filter indicator, no filter control, and no "Show all feeds" link. The operator arrives at a filtered list with no UI explaining why they see a subset or how to return to the full list. The only way to clear the filter is to manually edit the URL. The Runs page, by contrast, has visible Select dropdowns for its filters. |
| **Risk / Impact** | Operator confusion: landing from the dashboard on a filtered Feeds page with no explanation. If they don't notice the URL, they may think missing feeds were deleted. Cannot toggle the filter from the Feeds page itself. |
| **Evidence** | feeds-view.tsx:15-86: no filter Select, no active-filter badge, no clear-filter link. feeds/page.tsx:79 passes only `{feeds, total}` — no health state. |
| **Recommendation** | Pass the active `health` filter to FeedsView. When set, show a Badge "Showing: unhealthy only" with a clear link to `/feeds`. Optionally add a filter Select mirroring the Runs page pattern. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Render FeedsView with health=unhealthy active; assert a visible filter indicator and clear-filter link. |
| **Acceptance Criteria** | When health=unhealthy is active, the Feeds page shows a visible filter indicator. Operator can clear the filter from the Feeds page UI. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: FeedsView receives {feeds, total} only. No filter indicator, no clear link. Compounds with C7 (same missing health prop causes both issues). |

---

### [ ] N2-20260711: Shutdown test doesn't assert failedPhase — masks hardcoded "fetch" deviation

| Field | Value |
|---|---|
| **ID** | `N2-20260711` |
| **Severity** | Low |
| **Category** | Anti-cheat |
| **Location** | `worker/src/__tests__/run-poller.test.ts:265-271` |
| **Description** | The shutdown `markFailed` assertion uses `expect.objectContaining({ failureMessage: "Worker shut down during run" })` without asserting `failedPhase`. The poller hardcodes `failedPhase: "fetch"` regardless of actual phase — the test masks this by not checking the field. |
| **Risk / Impact** | The hardcoded `failedPhase` deviation is invisible to the test suite. A future fix or regression to phase tracking would not be caught. |
| **Evidence** | Lines 265-271: asserts `failureMessage` but not `failedPhase`. run-poller.ts:125-128: hardcodes `failedPhase: "fetch"`. |
| **Recommendation** | Add `failedPhase` to the assertion. When the hardcoded phase is fixed, add a test variant verifying the correct phase. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Assert `failedPhase` explicitly in the shutdown markFailed test. |
| **Acceptance Criteria** | Shutdown test asserts both `failedPhase` and `failureMessage` explicitly. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: `objectContaining` checks only `failureMessage`. `failedPhase` absent from assertion. |

---

### [ ] N3-20260711: execute-run test default mock returns {} for loadPhaseCheckpoint — could mask bugs

| Field | Value |
|---|---|
| **ID** | `N3-20260711` |
| **Severity** | Low |
| **Category** | Anti-cheat |
| **Location** | `shared/src/runs/__tests__/execute-run.test.ts:186-196` |
| **Description** | The `beforeEach` default mock for `loadPhaseCheckpoint` returns `{}` (line 193). No fresh-start test asserts `loadPhaseCheckpoint` was NOT called. An erroneous checkpoint load on fresh start would return `{}`, type-cast to the wrong shape, and proceed with corrupted data — silently. |
| **Risk / Impact** | A bug introducing an erroneous checkpoint load on fresh start would not be caught by tests. |
| **Evidence** | Line 193: `mocks.loadPhaseCheckpoint.mockResolvedValue({})`. Happy-path test (line 199) uses `makeRun()` with `completedPhase: ''` but does not assert `loadPhaseCheckpoint` was not called. |
| **Recommendation** | Add `expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled()` to the happy-path test. Consider making the default mock throw instead of returning `{}`. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Assert `loadPhaseCheckpoint` not called on fresh start. Assert malformed return shape causes a clear failure. |
| **Acceptance Criteria** | Happy-path test asserts `loadPhaseCheckpoint` is not called. Default mock does not silently mask unexpected calls. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: default mock returns `{}`. Happy-path test does not assert non-invocation. |

---

### [ ] N4-20260711: Hardcoded threshold value 3 in health tests instead of importing FEED_UNHEALTHY_THRESHOLD

| Field | Value |
|---|---|
| **ID** | `N4-20260711` |
| **Severity** | Low |
| **Category** | Anti-cheat |
| **Location** | `shared/src/feeds/__tests__/health.test.ts:98-137`; `shared/src/feeds/__tests__/repository.test.ts:746-768` |
| **Description** | Tests hardcode 3 (threshold) and 2 (threshold-1) as magic numbers instead of importing `FEED_UNHEALTHY_THRESHOLD` from production code. If the threshold changes, the "just below threshold" test (counter 1->2, expects healthy) would still pass for the wrong reason. |
| **Risk / Impact** | A threshold change could leave tests passing without actually testing the new boundary, creating false confidence. |
| **Evidence** | health.test.ts does not import `FEED_UNHEALTHY_THRESHOLD`. Line 101: `consecutiveFetchFailures: 2` (hardcoded). Line 116: `consecutiveFetchFailures: 3` (hardcoded). |
| **Recommendation** | Import `FEED_UNHEALTHY_THRESHOLD` and derive boundary values: `threshold - 1` (expect healthy) and `threshold` (expect unhealthy). |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Replace hardcoded 3 with `FEED_UNHEALTHY_THRESHOLD` and 2 with `FEED_UNHEALTHY_THRESHOLD - 1`. |
| **Acceptance Criteria** | No hardcoded threshold value 3 in threshold-adjacent test assertions. Tests import and derive from the constant. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: `FEED_UNHEALTHY_THRESHOLD` not imported in either test file. Hardcoded 3 and 2 confirmed. |

---

### [ ] N5-20260711: Hardcoded protected count (3) and retention window (30) in retention tests

| Field | Value |
|---|---|
| **ID** | `N5-20260711` |
| **Severity** | Low |
| **Category** | Anti-cheat |
| **Location** | `shared/src/runs/__tests__/retention.test.ts:59,69-139` |
| **Description** | Retention tests hardcode the protected count (3) and retention window (30 days) as implicit magic numbers in fixture construction, without importing `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` or `DEFAULT_RUN_RETENTION_DAYS`. If the protected count changes, tests pass for the wrong reasons. |
| **Risk / Impact** | A protected-count constant change would leave tests passing without testing the new boundary. |
| **Evidence** | Line 59: `const RETENTION_DAYS = 30` (hardcoded). Tests create 4 completed runs expecting 3 protected — the number 3 appears only in test names, not as an imported constant. |
| **Recommendation** | Import `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` and `DEFAULT_RUN_RETENTION_DAYS`. Construct fixtures with `PROTECTED + 1` completed runs. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | After refactor: create `PROTECTED + 1` completed runs, assert exactly 1 eligible. |
| **Acceptance Criteria** | Retention tests derive protected count and retention window from production constants, not hardcoded magic numbers. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: constants not imported. RETENTION_DAYS = 30 hardcoded. Protected count 3 hardcoded in fixture construction. |

---

### [ ] S2-20260711: Dashboard passes raw err.message to client DOM

| Field | Value |
|---|---|
| **ID** | `S2-20260711` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `web/app/(protected)/page.tsx:42` |
| **Description** | The dashboard catch block passes raw `err.message` (or `String(err)`) directly to the client component without filtering by error type or providing a generic fallback. Unlike the Runs page (`err instanceof RunRepositoryError ? err.message : "Something went wrong..."`) and Feeds page pattern, the dashboard takes all error messages as-is. If `getServerAppwrite()` throws (e.g., missing `APPWRITE_API_KEY` env var), the raw error message containing infrastructure details is rendered in the DOM via `<p>{error}</p>` in `feeds-health-card.tsx:43`. |
| **Risk / Impact** | Infrastructure details (env var names, endpoint URLs) leaked to the browser. Risk is limited since this is an authenticated operator-only tool and the leaked information is implementation details, not credentials. |
| **Evidence** | Dashboard line 42: `feedsError = err instanceof Error ? err.message : String(err)` — no type filtering, no generic fallback. Runs page for contrast: type-filtered + generic fallback. `getServerAppwrite()` throws `new Error("Missing required environment variable: APPWRITE_API_KEY")`. |
| **Recommendation** | Mirror the Runs/Feeds pattern: `feedsError = err instanceof FeedRepositoryError ? err.message : "Unable to load feed health"`. Apply to both catch blocks on the dashboard. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock `listFeeds` to throw a plain Error with sensitive content; assert the dashboard renders the generic message, not the raw error. |
| **Acceptance Criteria** | Dashboard only surfaces `FeedRepositoryError` messages or a hardcoded generic string. Raw `Error.message` from non-repository errors never reaches the DOM. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified: no type guard on catch. `getServerAppwrite` throws raw env var names. Pattern diverges from Runs/Feeds pages. Downgraded to Low: authenticated tool, leaked info is implementation details not credentials. |

---

## Dependencies and Licensing

- **Vulnerabilities:** none identified in this review (dependency audit not performed — outside scope)
- **Outdated critical packages:** not assessed
- **License concerns:** none identified

---

## Quality Signals

- **Lint/config signals:** No lint or typecheck was run as part of this review (all features previously passed verification). The code follows established patterns from prior stages.
- **Test/coverage signals:** Shared package tests are comprehensive for happy paths and major failure modes. Gaps identified: worker poller lifecycle (start/stop), tick concurrency, retry error paths (steps 6-7), and RetentionControls web component. Anti-cheat pattern of hardcoded constants in tests is present in health and retention test suites.
- **Complexity/churn signals:** `execute-run.ts` is the most complex file (333 lines, branching for 6 phases + resume + fatal mapping + error handling). The phase loop's lack of logging makes it opaque in production. `repository.ts` (820 lines) is large but well-structured.
- **Below-floor findings (27 additional Low/Nit):** Maintainability items include duplicated error utilities across 3 repos, duplicated display constants across table/card pairs, `FAILURE_MESSAGE_MAX` defined in two files, `clampRetentionDays` misnamed, `requireOkFeeds:false` config bypass, pagination hardcoded 20, RetentionControls hardcoded bounds, Runs redirect duplicating `buildRunsHref`. Testing items include missing tests for start/stop, tick concurrency, retry error paths, purge out-of-range, buildRunsHref, settings cross-module mock coupling. Performance: Runs page 4 sequential queries. Correctness: bucket maxFileSize drift (30MB vs 32MiB spec), bucket no drift detection, shutdown hardcoded phase, shutdown not idempotent, no retry backoff in poller, purgeExpiredRuns unclamped return. All confirmed by the validator but below the Medium floor.

---

## Risk Assessment

- **Overall risk:** Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Dependencies/supply chain audit, Playwright/e2e tests, live Appwrite integration testing, performance benchmarking
- **Key risk areas:** The execution/resume path (C1-C5, N1) carries the most operational risk — orphaned runs, data loss on markCompleted failure, and swallowed errors could cause silent failures in production. The worker poller race (C1) is the most likely to trigger under load. The security finding (S1) is low-probability but high-impact if LLM error messages contain credentials.

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| C1-20260711 | Medium | _Pending_ | Poller in-flight race |
| C2-20260711 | Medium | _Pending_ | loadPhaseCheckpoint unguarded parse |
| C3-20260711 | Medium | _Pending_ | retry.ts steps 6-7 unguarded |
| C4-20260711 | Medium | _Pending_ | Orphaned 'running' run |
| C5-20260711 | Medium | _Pending_ | markCompleted failure non-resumable |
| C6-20260711 | Medium | _Pending_ | Non-atomic feed health counter |
| C7-20260711 | Medium | _Pending_ | Feeds empty state misleading |
| C8-20260711 | Medium | _Pending_ | purgeRunsNow discards errors |
| S1-20260711 | Medium | _Pending_ | Secret redaction in failureMessage |
| N1-20260711 | Medium | _Pending_ | Checkpoint catch swallows errors |
| O1-20260711 | Medium | _Pending_ | executeRun no logging |
| O2-20260711 | Medium | _Pending_ | Runs page swallows secondary failures |
| T1-20260711 | Medium | _Pending_ | RetentionControls no tests |
| U1-20260711 | Medium | _Pending_ | aria-label missing |
| U2-20260711 | Medium | _Pending_ | Feeds no filter indicator |
| N2-N5-20260711 | Low | _Pending_ | Anti-cheat test improvements |
| S2-20260711 | Low | _Pending_ | Dashboard raw error leak |

PM Decisions: `Address now` -> included in hardening feature. `Defer` -> recorded for a future stage. `Dismiss` -> no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
