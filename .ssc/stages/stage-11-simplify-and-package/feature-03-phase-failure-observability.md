# Feature 03: Phase failure observability

## Intent

When a run dies mid-pipeline (tag/score halt, or empty selection / full suppress), the operator can diagnose *why* from stdout, the run’s `failureMessage`, and Inspect — using detail the pipeline already computed — instead of one-liners like "Tagging halted".

## Spec

Enrich three operator-facing surfaces for the in-scope fatal outcomes below. No Logs product, no live tail, no new Runs-list badges. Reuse the existing selection-drops pattern on Inspect (summary + responsive table/cards list).

### In scope (PM-approved)

1. **Tag halt** (`TagResult.halted === true`)
2. **Score halt** (`ScoreResult.halted === true`)
3. **Empty selection after MMR** (`selectedArticles.length === 0`) — enrich terse `failureMessage` / stdout; checkpoint drops already exist
4. **Full suppress** (`remaining.length === 0 && suppressSummary.count > 0`) — enrich terse `failureMessage` / stdout; `suppressSummary` already persisted

### Out of scope (PM-approved)

- `No articles fetched` (already attaches `failedFeeds`)
- Empty draft
- Unexpected thrown errors (already redacted into `failureMessage`)
- New Logs page / live log stream / Runs-list badge chrome

### Truncation policy (PM-approved)

| Surface | Bound |
|---------|--------|
| Checkpoint failure sample | First **10** per-article failures |
| `failureMessage` / stdout sample | First **~3** snippets |
| `failureMessage` total length | Existing **2000** char cap (`FAILURE_MESSAGE_MAX` / `markFailed`) |
| Per-error strings | Redact via `redactMessageForStorage` (same idea as selection-failure `error`) |

### Tag / score halt behavior

Today halt logs/stores only `"Tagging halted"` / `"Scoring halted"` and **does not** save a tag/score checkpoint, so Inspect has nothing for that phase.

On halt the builder must:

1. **Save a diagnostic checkpoint** for the failed phase containing:
   - **Successes only** for the article list:
     - Tag: articles from `TagResult.taggedArticles` with `tags.length > 0` (do not persist empty-tag failure stubs in the article list — failures live in `phaseFailure`)
     - Score: `ScoreResult.scoredArticles` as returned (already successes-only)
   - **`phaseFailure`** summary object (see wire shape below)
2. **Log stdout** with structured detail (not only the one-liner `reason`)
3. **`markFailed`** with an enriched `failureMessage` and **`completedPhase` forced to the prior phase** so Retry re-enters the failed phase:
   - Tag halt → `completedPhase: "scrape"` (Retry starts at `tag`)
   - Score halt → `completedPhase: "tag"` (Retry starts at `score`)
4. Use the **same local retry** pattern as empty-selection `markFailed` (primary + one recovery call, both carrying the enriched payload + `completedPhase` override) so a transient status-update failure cannot leave `completedPhase` advanced by the checkpoint save.

If checkpoint save throws, still attempt `markFailed` with the enriched halt message + `completedPhase` override (best-effort diagnostics), then return — do not silently fall through as success.

### Wire shape — `phaseFailure` on tag/score checkpoints

Add optional `phaseFailure` to tag/score checkpoint input/output types in `shared/src/runs/types.ts`.

Legacy / successful writes: **omit** the key (Inspect shows no failure block).

Halt writes: **always emit** `phaseFailure` with:

```ts
type PhaseArticleFailureJson = {
  articleTitle: string;
  articleLink: string;
  error: string; // redacted + bounded
  attempts: number;
  /** Score failures only; omit for tag. */
  reason?: "exception" | "parse";
};

type PhaseFailureSummaryJson = {
  halted: true;
  haltReason: string | null; // already ≤200 / newline-stripped from pipeline
  consecutiveErrors: number;
  totalArticles: number;
  failureCount: number; // full count from TagResult/ScoreResult.failures.length
  failures: PhaseArticleFailureJson[]; // first 10 only
};
```

`serializeCheckpoint` / `reviveCheckpoint` in `shared/src/runs/repository.ts` must round-trip `phaseFailure` when present and leave it absent for legacy/success payloads.

### Enriched `failureMessage` / stdout (pinned content)

**Tag / score halt** — must include (order flexible, content required):

- Phase label (`Tagging halted` / `Scoring halted` or equivalent)
- `haltReason` (when non-null)
- `consecutiveErrors`
- `failureCount` (and optionally `totalArticles`)
- Up to 3 sample snippets: article title + short error

Example shape (illustrative, not byte-locked):

`Tagging halted: <haltReason>. Consecutive errors: 3. Failures: 5/40. Sample: "Title A": <err>; "Title B": <err>`

Stdout `fatal-outcome` object must carry the same structured fields (`haltReason`, `consecutiveErrors`, `failureCount`, `sample` or equivalent) — not only `reason: "Tagging halted"`.

**Empty selection (MMR)** — replace bare `"No articles selected"` with a summary that includes drop count and up to 3 samples (`title` + `reason`). Keep `completedPhase: "score"` and existing selection checkpoint write. Stdout `fatal-outcome` must carry the same richer summary (or structured count/sample fields) — not only `reason: "No articles selected"`.

**Full suppress** — replace bare `"No articles selected"` with a summary that includes suppress `count` and up to 3 suppressed titles from `suppressSummary.items`. Keep existing `saveSuppressSummary` behavior; no selection checkpoint required on this path (unchanged). Stdout `fatal-outcome` must likewise carry the richer suppress summary (count + sample titles), not only the bare one-liner.

### Inspect UI

- **Runs list / run detail:** unchanged chrome — only richer `failureMessage` text.
- **Inspect Tagged / Scored sections** (`web/components/runs/inspect-phase-section.tsx` and/or a small sibling component):
  - When `phaseFailure` is present: **always** show a summary line (halt reason, consecutive errors, failure count) **and** a responsive failure list (table wide / cards narrow via existing `ResponsiveList`) with Title, Error, Attempts, Link (and Reason for score when present) — same idea as `InspectSelectionDropsSection`. This must win over the empty-article-list short-circuit: a total halt (zero successes + `phaseFailure`) still renders the failure block; do **not** replace the section with only “No articles in this checkpoint.” Optionally still show the empty successes list / empty copy *in addition* to the failure block, but the failure UI is mandatory whenever `phaseFailure` is present.
  - When `phaseFailure` is absent: behavior identical to today (article list only; empty list → existing empty copy).
- Empty-selection / suppress Inspect surfaces already exist — no new sections required for those paths beyond message/stdout enrichment.

### Shared formatter

Create a focused helper module (suggested: `shared/src/runs/phase-failure-summary.ts`) exporting:

- Build `PhaseFailureSummaryJson` from `TagResult` / `ScoreResult` (cap 10, redact errors)
- Build enriched halt `failureMessage` string (cap via existing 2000 + redact)
- Build empty-selection / full-suppress `failureMessage` strings

Keep execute-run thin: call helpers, save checkpoint, markFailed.

## Dependencies

- Builds on: Stage 04 run execution + checkpoints (`execute-run`, `savePhaseCheckpoint`, `markFailed`); Stage 06 Inspect phase sections + selection-drops UI pattern; Stage 01 `TagResult` / `ScoreResult` structured failures.
- Stage 11 Features 01–02 verified (cleanup complete); this feature does not depend on Features 04–06.

## Constraints

- Do **not** invent a Logs product, live tail, or append-only log stream.
- Do **not** change pipeline halt thresholds, tagger/scorer semantics, or resume phase order — only richer capture/display and the resume-safe `completedPhase` override on halt.
- Do **not** advance Retry past a failed tag/score phase (must override `completedPhase` after diagnostic checkpoint save).
- Preserve legacy tag/score checkpoints without `phaseFailure` (key absent → no failure UI).
- Redact provider/secret-bearing error text before persist/log (`redactMessageForStorage` / `sanitizeAppwriteMessageForLog` as appropriate).
- No Appwrite schema/collection changes — checkpoint JSON + existing `failureMessage` string only.
- Do not change Features 04–06 packaging/docs scope.

## Acceptance criteria

- [ ] On tag halt: stdout and `failureMessage` include halt reason, consecutive errors, failure count, and a short sample — not only `"Tagging halted"`.
- [ ] On score halt: same enrichment (not only `"Scoring halted"`).
- [ ] On tag/score halt: a diagnostic checkpoint is saved with successes + `phaseFailure` (≤10 failures); Inspect shows summary + failure list on that phase.
- [ ] After tag/score halt, Retry re-enters the failed phase (`completedPhase` override works; covered by test).
- [ ] Empty selection / full suppress: `failureMessage` **and** stdout are richer than bare `"No articles selected"` (count + sample signal on both surfaces).
- [ ] Inspect with `phaseFailure` and zero successes still shows the failure summary + list (empty-list copy must not hide it).
- [ ] Legacy successful tag/score checkpoints without `phaseFailure` still load and render as today.
- [ ] `pnpm typecheck`, `pnpm lint`, and relevant tests pass.

## Files

- Create: `shared/src/runs/phase-failure-summary.ts`
- Create: `shared/src/runs/__tests__/phase-failure-summary.test.ts`
- Create: `web/components/runs/inspect-phase-failure.tsx` (or equivalent colocated helper used by Tagged/Scored sections)
- Create: `web/src/__tests__/inspect-phase-failure.test.tsx` (or extend `inspect-phase-lists.test.tsx`)
- Modify: `shared/src/runs/types.ts` (checkpoint + `PhaseFailureSummaryJson` types)
- Modify: `shared/src/runs/repository.ts` (`serializeCheckpoint` / `reviveCheckpoint`)
- Modify: `shared/src/runs/execute-run.ts` (halt + empty-selection/suppress wiring)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` (update halt / empty-selection expectations)
- Modify: `web/components/runs/inspect-phase-section.tsx` (render failure block when present)
- Modify: `shared/src/runs/index.ts` only if new types/helpers need package export for web (prefer exporting types via existing `export * from "./types"`)
- Test: repository serialize/revive coverage if an existing repository test file already covers checkpoints; otherwise add focused cases in `phase-failure-summary` + execute-run tests

## Testing approach

Test-first. Tests verify operator-visible diagnosis behavior, not incidental formatting cosmetics.

1. **Formatter unit tests** (`phase-failure-summary.test.ts`):
   - Caps failures at 10 in `phaseFailure`; `failureCount` still reflects full length
   - Message includes haltReason / consecutiveErrors / failureCount / ≤3 samples; length ≤ 2000
   - Redacts/bounds error strings
   - Empty-selection and full-suppress message builders include counts + samples
2. **execute-run tests** (update existing halt cases + add):
   - Tag halt: `savePhaseCheckpoint("tag", …)` called with successes + `phaseFailure`; `markFailed` gets enriched message + `completedPhase: "scrape"`; stdout log not bare one-liner (spy/`console.log` assertions if already used elsewhere, or assert markFailed payload + checkpoint payload as primary)
   - Score halt: analogous with `completedPhase: "tag"`
   - `resumeStartPhase(completedPhase)` after halt equals `"tag"` / `"score"` respectively
   - markFailed local retry still carries override (mirror empty-selection C1 pattern)
   - Empty selection / full suppress: `failureMessage` no longer exactly `"No articles selected"` and includes count/sample signal; stdout `fatal-outcome` likewise enriched (not bare `reason: "No articles selected"` alone)
3. **Serialize/revive**: round-trip with `phaseFailure`; omit key when absent
4. **Inspect tests**: with `phaseFailure` → summary + failure rows visible; with `phaseFailure` + **empty** success list → failure UI still visible (must not be replaced by empty-checkpoint copy alone); without `phaseFailure` → no failure block; responsive list still used

## Tasks

### Task 1: Checkpoint types + serialize/revive + failing tests

- **Action**: Add `PhaseArticleFailureJson` / `PhaseFailureSummaryJson` and optional `phaseFailure` on tag/score checkpoint input/output types in `shared/src/runs/types.ts`. Update `serializeCheckpoint` / `reviveCheckpoint` in `shared/src/runs/repository.ts`. Write failing tests for round-trip + legacy omit (in `phase-failure-summary.test.ts` and/or repository tests).
- **Expected result**: Types and ser/de compile; tests fail until helpers/wiring land (or pass ser/de once implemented in this task — prefer implementing ser/de here with green ser/de tests, leave execute-run red).
- **Verify**: `pnpm --filter @newsletter/shared test -- phase-failure` (or the chosen test file path) + `pnpm typecheck` for touched packages.
- **Depends on**: none.

### Task 2: Summary formatter (test-first)

- **Action**: Create `shared/src/runs/phase-failure-summary.ts` with builders for halt `phaseFailure`, halt `failureMessage`, empty-selection message, and full-suppress message. Write `shared/src/runs/__tests__/phase-failure-summary.test.ts` covering caps, required fields, and redact/bounds.
- **Expected result**: Helper module green under unit tests; not yet wired into execute-run.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/runs/__tests__/phase-failure-summary.test.ts` (adjust to repo’s usual vitest invocation if different).
- **Depends on**: Task 1.

### Task 3: Wire tag/score halt in execute-run

- **Action**: In `shared/src/runs/execute-run.ts`, on tag/score halt: build summary via helpers; save diagnostic checkpoint; log enriched stdout; `markFailed` with enriched message + prior-phase `completedPhase` + local retry. Update `shared/src/runs/__tests__/execute-run.test.ts` halt cases (they currently expect bare `"Tagging halted"` / `"Scoring halted"` and no tag/score checkpoint).
- **Expected result**: Halt paths diagnosable and resume-safe.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/runs/__tests__/execute-run.test.ts` (or full shared test suite if that’s the project norm for this file).
- **Depends on**: Task 2.

### Task 4: Wire empty selection / full suppress message enrichment

- **Action**: Replace bare `"No articles selected"` on both empty-selection and full-suppress fatal paths with helper-built messages **and** enriched stdout `fatal-outcome` (structured count/sample or the same richer string — not a bare one-liner `reason` alone). Keep checkpoint / suppress-summary / `completedPhase: "score"` behavior for MMR-empty unchanged. Update execute-run tests accordingly.
- **Expected result**: Those fatals are diagnosable from message **and** stdout without new Inspect sections.
- **Verify**: Same execute-run test command as Task 3; assert `failureMessage` and stdout are richer than the bare string (count/sample present on both).
- **Depends on**: Task 2 (can parallelize with Task 3 after Task 2, but land after or with Task 3 to avoid conflict in `execute-run.ts`).

### Task 5: Inspect UI for phaseFailure

- **Action**: Add Inspect failure summary + responsive list for Tagged/Scored when `phaseFailure` is present (`inspect-phase-section.tsx` + new small component). Follow selection-drops / Stage 03 responsive list conventions. **Pin:** when `phaseFailure` is present and the success article list is empty, still render the failure summary + list — do not short-circuit the whole section to empty-checkpoint copy alone. Add/extend web tests including that zero-success + `phaseFailure` case.
- **Expected result**: Failed halt runs show why on Inspect (including total-halt / zero-success); successful/legacy checkpoints unchanged.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run` on the Inspect test file(s) touched; `pnpm typecheck`; `pnpm lint`.
- **Depends on**: Task 1 (types available to web via shared).

### Task 6: Feature verification

- **Action**: Run the full feature gate; fix any fallout from type exports or stale expectations.
- **Expected result**: All acceptance criteria met.
- **Verify**: See Feature verification below.
- **Depends on**: Tasks 1–5.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test`
- Expected: all green. Spot-check: tag-halt execute-run test asserts enriched `failureMessage`, tag checkpoint with `phaseFailure`, and `completedPhase: "scrape"`; empty-selection/suppress tests assert enriched stdout as well as `failureMessage`; Inspect test asserts failure list renders when `phaseFailure` present (including zero-success + `phaseFailure`) and not when absent.

## Handoff

Builder reports: files changed; confirmation of truncation constants (10 / ~3 / 2000); resume-safe `completedPhase` overrides; any deviation (e.g. component filename) and why. Research note: current halt paths in `shared/src/runs/execute-run.ts` (~372–413) drop all `TagResult`/`ScoreResult` detail; empty-selection already demonstrates checkpoint-then-`completedPhase` override (~453–485).
