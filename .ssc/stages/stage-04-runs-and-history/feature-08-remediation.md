# Feature 08: Remediation

## Intent

Fix stage-04 Acceptance criterion #6 — "Feed management and affected run records identify unhealthy feeds" — by persisting `failedFeeds` on the `Run` document whenever a `FetchResult` exists, so the most-affected runs (zero-article fatal) can still name the dead feeds on `/runs`.

## Spec

### Failing behavior

A zero-article `FetchResult` (the "all feeds failed" case this stage exists to catch) currently produces a `Run` document with `failedFeeds: ""` and no way for `/runs` to identify which feeds failed.

### Evidence

Cluster B verifier (2026-07-13, stage-04 finalization regression pass) on AC #6:

> AC #6 — failed. Feed management, filtering, pagination, and dashboard indicators work, but zero-article fatal runs discard `FetchResult.failedFeeds`, leaving the affected `Run.failedFeeds` empty.

Specific sites:

- `shared/src/runs/execute-run.ts:214-225` — zero-article branch calls `markFailed(...)` and returns. `failedFeeds` from the `FetchResult` is never persisted on the run.
- `shared/src/runs/repository.ts:629-635` — `savePhaseCheckpoint` is the only path that persists `failedFeeds` on the run doc (the fetch-checkpoint happy path with non-zero articles).
- `shared/src/runs/repository.ts:370-386` — `markFailed` signature accepts `{ failedPhase, failureMessage }` only; cannot carry `failedFeeds`.
- `shared/src/runs/types.ts:134-138` — `markFailed` argument type lacks `failedFeeds`.

The per-feature verifier passes because:
- Feature 02's `markFailed` is correct on its own contract.
- Feature 05's `applyFeedFetchOutcomes` is correct on its own.
- Feature 05's `Run.failedFeeds` reader (Feature 03's `/runs` page) handles empty gracefully (renders em-dash).

The cross-feature gap: the zero-article fatal path never persists `failedFeeds`, so `/runs` cannot identify the dead feeds on the very run that died because of them. The Feeds page and dashboard are fine (they read from the feeds collection, updated by `applyFeedFetchOutcomes`); only the run record is broken.

### What correct behavior looks like

After this feature, the zero-article fatal branch in `execute-run.ts` persists `fetchResult.failedFeeds` on the run document before returning. Concretely:

1. `Run.failedFeeds` is non-empty JSON whenever the fetch produced a `FetchResult` with at least one `FeedFailure` entry, **regardless of whether the run went on to checkpoint or fatal-zero-article**.
2. `/runs` therefore shows Failed feeds (with names from the feed list) and an Unhealthy Badge on runs that died because all feeds failed — the most-affected run gets the most-affected view.
3. The Feeds page and dashboard continue to work as before (no change there).

### Scope decision

The skill says "minimum work segments to fix the regression." This fix is small enough to leave the checkpoint-save-failure path out of scope:

- Zero-article fatal: the dead case the AC names. Must be fixed.
- Fetch checkpoint save failure: would also lose `failedFeeds` from the run doc, but the run would still be marked `failed` at fetch phase, and `applyFeedFetchOutcomes` already updated the feeds collection. The operator's primary signal (which feeds are unhealthy) is already preserved by `applyFeedFetchOutcomes`; the run-doc `failedFeeds` is a secondary signal that improves triage but isn't required to satisfy AC #6 in the most-affected case (the zero-article fatal where all feeds failed).

If checkpoint-save-failure becomes an issue during PM manual gate, file a follow-up hardening spec rather than widening this remediation.

## Dependencies

- Builds on: Feature 01 — `Run` document shape, `failedFeeds` JSON column on `runs` collection.
- Builds on: Feature 02 — `execute-run.ts` zero-article fatal branch, `markFailed` repository method, `markFailed` callers.
- Builds on: Feature 05 — `applyFeedFetchOutcomes` (unchanged), `parseRunFailedFeeds` (unchanged, already handles non-empty JSON).
- Builds on: Feature 03 — `/runs` Failed feeds column already reads `Run.failedFeeds` (no UI change needed).

## Constraints

- **Do not alter** Feature 01 checkpoint payload shapes or embedding-strip rules.
- **Do not change** Feature 03's three Retry guard error strings.
- **Do not introduce** a new `Run` field or change the `failedFeeds` field's wire type. The field is already JSON-stringified `FeedFailure[]`.
- **Do not change** `applyFeedFetchOutcomes` semantics (feeds collection, not runs collection).
- **Do not widen scope** to checkpoint-save-failure path (deferred, see Spec § Scope decision).
- **Schema-as-code only** — no console-clicked schema.
- **Server-only** Appwrite access; sanitize Appwrite errors; never log secrets.
- **No GUI changes** — `/runs` already handles non-empty `failedFeeds`.

## Acceptance criteria

- [ ] `markFailed` accepts an optional `failedFeeds?: FeedFailure[]` argument; when provided, persists `JSON.stringify(failedFeeds)` on the run doc and clears it (`""` or omit) when not provided.
- [ ] `execute-run.ts` zero-article fatal branch passes `fetchResult.failedFeeds` to `markFailed`.
- [ ] After a zero-article fatal with two `FeedFailure` entries, the run document has a non-empty `failedFeeds` JSON string parseable to `FeedFailure[]` of length 2.
- [ ] Existing `markFailed` callers (no `failedFeeds` arg) still pass all current tests; `failureMessage` truncation, `endedAt`, `failedPhase`, `RunRepositoryError` behavior unchanged.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm --filter worker build`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.
- [ ] AC #6 end-to-end: a simulated zero-article fetch with two failed feeds produces a `Run` doc whose `/runs` row shows Failed feeds + Unhealthy Badge.

## Files

- Modify: `shared/src/runs/types.ts` — add `failedFeeds?: FeedFailure[]` to `MarkFailedArgs` (or equivalent arg type)
- Modify: `shared/src/runs/repository.ts` — extend `markFailed` impl to write `failedFeeds` JSON when provided
- Modify: `shared/src/runs/__tests__/repository.test.ts` — tests for new arg (persisted when provided, omitted when not, survives `failureMessage` truncation)
- Modify: `shared/src/runs/execute-run.ts` — pass `fetchResult.failedFeeds` to `markFailed` in zero-article branch
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — assert `markFailed` was called with `failedFeeds` carrying the FetchResult's failures; assert the persisted run doc has non-empty `failedFeeds` after zero-article fatal

## Testing approach

Test-first for repository changes; executor change verified by extension of existing zero-article fatal test.

1. **`markFailed` happy-path (no `failedFeeds`):** existing tests still pass; `failedFeeds` column is not in update payload (or is `""` if explicitly set).
2. **`markFailed` with `failedFeeds`:** call with two `FeedFailure` entries; assert update payload includes `failedFeeds: JSON.stringify([...])`; map back via `documentToRun` → typed `FeedFailure[]` of length 2.
3. **`markFailed` truncation interaction:** when both `failureMessage` (long) and `failedFeeds` (large) are passed, both are persisted correctly (truncation is for `failureMessage` only).
4. **Zero-article fatal executor:** seed `fetchFeeds` mock to return `{ articles: [], failedFeeds: [...] }`; assert `markFailed` was called with the `failedFeeds` array; assert `Run.failedFeeds` JSON is non-empty after the call.
5. **Regression:** zero-article fatal without any `FeedFailure` (e.g., empty feed list) — `markFailed` called with `failedFeeds: []` or omitted; behavior unchanged.
6. **Cross-check with AC #6 end-to-end:** unit test simulates the full flow that `/runs` reads from — the run document's `failedFeeds` JSON is parseable and matches the failed feeds.

## Tasks

### Task 1: Extend `markFailed` to persist `failedFeeds`

- **Action:** In `shared/src/runs/repository.ts`, extend `markFailed`'s argument type (`MarkFailedArgs`) in `shared/src/runs/types.ts` to include `failedFeeds?: FeedFailure[]`. In the impl, when `failedFeeds` is provided, include `failedFeeds: JSON.stringify(failedFeeds)` in the update payload; when not provided, leave the field as it currently is (omitted, or `""` — match the existing optional-field mapping convention used by `markCompleted`). Extend `shared/src/runs/__tests__/repository.test.ts`: failing tests first (persisted when provided, omitted when not), then implementation.
- **Expected result:** `markFailed` can carry `failedFeeds` from any caller; existing callers unchanged.
- **Verify:** `pnpm --filter @newsletter/shared test` — repository tests pass for new arg + regression cases; no other test breaks.
- **Depends on:** none.

### Task 2: Zero-article fatal passes `failedFeeds`

- **Action:** In `shared/src/runs/execute-run.ts`, in the zero-article branch (around lines 214-225), change `markFailed(client, runId, { failedPhase: "fetch", failureMessage: ... })` to `markFailed(client, runId, { failedPhase: "fetch", failureMessage: ..., failedFeeds: fetchResult.failedFeeds })`. Add a focused test in `shared/src/runs/__tests__/execute-run.test.ts` that mocks `fetchFeeds` to return `{ articles: [], failedFeeds: [<two FeedFailure entries>] }` and asserts `markFailed` was called with the `failedFeeds` array.
- **Expected result:** Zero-article fatal runs now carry the failed-feed list on the `Run` document.
- **Verify:** `execute-run.test.ts` zero-article fatal tests pass with the new assertion; full shared suite green.
- **Depends on:** Task 1.

### Task 3: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no other `markFailed` callers were broken; run full gates; verify AC #6 end-to-end via unit test simulating the zero-article fatal case.
- **Expected result:** AC #6 satisfied; no regressions to other ACs.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0; the zero-article fatal test asserts `Run.failedFeeds` is non-empty and parseable.
- **Depends on:** Tasks 1–2.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green; the zero-article fatal test asserts `Run.failedFeeds` JSON is non-empty after a FetchResult with failed feeds; existing tests still pass.
- Optional PM manual gate (re-runs AC #6 end-to-end after this remediation verifies): create a newsletter whose only attached feed 404s, Generate → observe `Run` doc has non-empty `failedFeeds`; `/runs` row shows Failed feeds + Unhealthy Badge.

## Handoff

Builder reports: files modified; confirmation that the zero-article fatal path now persists `failedFeeds`; confirmation that `markFailed` is backwards-compatible (no breakage to other callers); confirmation that AC #6 is now satisfied end-to-end. Note that the checkpoint-save-failure path was deliberately left out of scope per the Spec § Scope decision; if the operator hits that case in practice, file a follow-up hardening spec.