# Feature 04: Failed-run retry

## Intent

Let the operator retry a failed newsletter run from its failed phase, reusing durable checkpoints for every completed phase, so transient outages and flaky LLM calls are recoverable without repeating website fetches or already-paid LLM work.

## Spec

Replace Feature 03’s Retry shell step 4 (`"Retry is not available yet"`) with a real resume path: re-enqueue the **same** failed run as `pending`, then extend the Feature 02 checkpointed executor so the worker resumes at the first incomplete phase and skips every phase that already has a durable checkpoint.

No new history row. No run detail page. No feed-health counters (Feature 05). No retention (Feature 06).

### Locked decisions

1. **Same run document.** Retry does not call `createRun`. The failed row on `/runs` flips `failed` → `pending` → `running` → `completed`/`failed`. Keep original `startedAt`; clear `endedAt` / failure fields on requeue.
2. **Resume cursor = next phase after `completedPhase`.** If `completedPhase` is empty/null, start at `fetch`. Otherwise start at the phase immediately after `completedPhase` in `fetch → scrape → tag → score → selection → draft`. This matches `failedPhase` when Feature 01/02 invariants hold (a phase is complete only after its checkpoint is saved).
3. **Pre-flight checkpoint check before requeue.** If the resume start phase is not `fetch`, `loadPhaseCheckpoint(client, runId, completedPhase)` must succeed during the Retry action. On `checkpoint_missing` (or load failure) → do **not** change status; return a clear error (see messages below).
4. **Worker transport unchanged.** Requeued runs are ordinary `pending` documents; Feature 02’s poller claims them. No new job name.
5. **Web still never runs the pipeline.** Retry only validates + requeues; the worker executes.

### Phase helpers (shared)

Add small pure helpers (e.g. in `shared/src/runs/phases.ts` or beside the executor) and export for tests:

| Helper | Behavior |
|--------|----------|
| `PHASE_ORDER` | `["fetch","scrape","tag","score","selection","draft"]` as const (must match `RUN_PHASES`) |
| `nextPhase(phase: RunPhase): RunPhase \| null` | Next in order, or `null` after `draft` |
| `resumeStartPhase(completedPhase: RunPhase \| null \| ""): RunPhase \| null` | Empty/null → `"fetch"`; else `nextPhase(completedPhase)`. Returns `null` when there is no next phase (`completedPhase === "draft"`). Callers treat `null` as non-resumable. |

### Repository: `requeueFailedRun`

Add to `shared/src/runs/repository.ts`:

```ts
requeueFailedRun(client, runId): Promise<Run>
```

Behavior:

1. `getRun` — missing → `not_found`.
2. If `status !== "failed"` → throw `RunRepositoryError` `validation` with message suitable for logs (the Retry helper maps operator-facing strings; see below).
3. Update document: `status: "pending"`, clear `failedPhase`, `failureMessage`, `endedAt`, `currentPhase` (empty/null per Feature 01 optional-field mapping). **Preserve** `completedPhase`, all `checkpoint*Id` fields, `newsletterId`, `newsletterName`, `startedAt`, `failedFeeds`, `topicSummary` (leave topicSummary as-is until `markCompleted` overwrites on success).
4. Return the mapped run.

Do **not** delete or rewrite existing checkpoint files on requeue.

### Retry helper: replace Feature 03 step 4

Update `shared/src/runs/retry.ts` (`requestFailedRunRetry`):

Keep Feature 03’s first three outcomes **verbatim** (do not change strings):

1. Missing run → `{ ok: false, error: "Run not found" }`
2. `status !== "failed"` → `{ ok: false, error: "Only failed runs can be retried" }`
3. `findActiveRunForNewsletter` non-null → `{ ok: false, error: "A run is already in progress for this newsletter" }`

Then **replace** the old step 4 with:

4. Compute `startPhase = resumeStartPhase(run.completedPhase)`. If `startPhase === null` → `{ ok: false, error: "This run cannot be resumed; start a new run instead" }`.
5. If `startPhase !== "fetch"`: `loadPhaseCheckpoint(client, runId, run.completedPhase)`. On `checkpoint_missing` or other load failure → `{ ok: false, error: "Cannot retry: checkpoint data is missing. Start a new run instead." }` (do not requeue).
6. `requeueFailedRun(client, runId)`.
7. **Race re-check** (full Feature 02 mirror): `listActiveRunsForNewsletter(client, run.newsletterId)` (already oldest-first). If the list has more than one run: `markFailed` **every** run after the first (oldest) with message `"Superseded by a concurrent start"`. For the superseded run’s `failedPhase`: use `startPhase` when the superseded `$id` is this retried run; use `"fetch"` for any other superseded run (concurrent fresh Generate). If this `runId` is **not** the first (oldest) entry, return `{ ok: false, error: "A run is already in progress for this newsletter" }`.
8. Return `{ ok: true }` only when this `runId` is the sole or oldest active run.

Web `retryFailedRun` in `web/app/(protected)/runs/actions.ts`: on `ok: true`, `revalidatePath("/runs")` and return success (toast already wired in Feature 03). No GUI redesign — Retry button stays as Feature 03 built it.

### Executor resume (`shared/src/runs/execute-run.ts`)

Extend Feature 02’s `executeRun` (same entrypoint the worker already calls). Fresh-start (`completedPhase` empty) behavior stays identical.

**Resume path** when `completedPhase` is set on a `pending` run:

1. `getRun` — must be `pending` (same as Feature 02).
2. `startPhase = resumeStartPhase(completedPhase)`. If `startPhase === null` → `markFailed` with `failedPhase: "draft"` and message `"This run cannot be resumed; start a new run instead"`; return (defensive — should not be enqueued).
3. Load newsletter config via the **same** Feature 02 helper, extended with an options flag:
   - Signature shape: `buildPipelineConfigForNewsletter(client, newsletterId, opts?: { requireOkFeeds?: boolean })` where `requireOkFeeds` defaults to `true` (Feature 02 Generate / fresh-start unchanged).
   - If `startPhase === "fetch"`: call with default (`requireOkFeeds: true`) — topics + ≥1 ok feed. On failure → `markFailed` with `failedPhase: "fetch"` and the validation message; return.
   - If `startPhase !== "fetch"`: call with `{ requireOkFeeds: false }`. Still requires newsletter exists and topics non-empty after trim; skips the ok-feed gate (checkpointed articles are the inputs). On newsletter missing → `markFailed` with `failedPhase: startPhase` and `"Newsletter not found"`; return. On empty topics → `markFailed` with `failedPhase: startPhase` and `"Add at least one topic before generating"`; return.
4. **Hydrate prior-phase outputs** by loading `loadPhaseCheckpoint(client, runId, completedPhase)` and mapping into the in-memory inputs the next phase expects (Feature 01 payload table). If load fails here (race/corruption after enqueue) → `markFailed` with `failedPhase: startPhase` and `"Cannot retry: checkpoint data is missing. Start a new run instead."`; return.
5. For each phase from `startPhase` through `draft` (inclusive), same loop as Feature 02:
   - `markRunning(runId, phase)`
   - Run phase function with hydrated inputs
   - Fatal outcomes → `markFailed` + return
   - Success → `savePhaseCheckpoint` (may overwrite a partial/failed attempt’s file id for this phase)
6. After draft checkpoint → `markCompleted` with `topicSummary` from selected articles (from selection checkpoint or in-memory selection result).

**Skip rule (the money requirement):** phases strictly before `startPhase` must **not** invoke `fetchFeeds`, `scrapeAll`, `tagArticles`, `scoreArticles`, `selectDiverse`, or `NewsletterDrafter.draft`. Tests prove this with mocks (call counts === 0 for skipped phases).

**Input mapping for resume** (load `completedPhase` checkpoint → feed `startPhase`):

| `completedPhase` | `startPhase` | In-memory input to start phase |
|------------------|--------------|--------------------------------|
| _(none)_ | `fetch` | newsletter feed URLs from config |
| `fetch` | `scrape` | `articles` from fetch payload |
| `scrape` | `tag` | `articles` from scrape payload |
| `tag` | `score` | `taggedArticles` from tag payload |
| `score` | `selection` | `scoredArticles` from score payload (embeddings absent — `selectDiverse` re-embeds; that embedding call is part of selection, not a repeated score LLM pass) |
| `selection` | `draft` | `selectedArticles` from selection payload |
| `draft` | — | not resumable via Retry (invalid; see enqueue guard) |

Note: re-running **selection** after a selection failure will call the embedder again. That is correct and required — Feature 01 deliberately does not persist embeddings. Score/tag/fetch/scrape LLM and network work must not repeat when those phases are already completed.

### Out of scope

- Creating a brand-new run from Retry (use Generate for a fresh start).
- Cancelling an in-progress run.
- Editing checkpoint payloads or Feature 01 strip rules.
- Feed-health consecutive counters (Feature 05).
- Retention/deletion (Feature 06).
- Per-article inspection UI (Stage 06).
- Changing Feature 03 list/filter/Retry button presentation (beyond success toast after real retry).
- Changing the three Feature 03 guard error strings.

## Dependencies

- Builds on: **feature-01-run-checkpoints** — `getRun`, `markRunning`, `markFailed`, `markCompleted`, `savePhaseCheckpoint`, `loadPhaseCheckpoint`, phase/status vocabulary, checkpoint payload shapes. **Execute Feature 01 before this feature**; if missing, stop and escalate.
- Builds on: **feature-02-on-demand-runs** — `executeRun`, `listActiveRunsForNewsletter`, `findActiveRunForNewsletter`, `buildPipelineConfigForNewsletter` / runnable helpers, worker pending poller. **Execute Feature 02 before this feature.**
- Builds on: **feature-03-run-history** — `/runs` Retry UI + `requestFailedRunRetry` / `retryFailedRun` contract shell. **Execute Feature 03 before this feature** (or land the shell first); this feature only replaces step 4 and wires resume execution.

## Constraints

- **Do not change** the three Feature 03 Retry guard messages without an explicit PM decision.
- **Do not create** a second run document on Retry.
- **Do not repeat** completed phases’ website fetches or tag/score/draft LLM calls when their checkpoints exist.
- **Do not alter** Feature 01 checkpoint JSON shapes or embedding-strip rules.
- **Web must not** execute pipeline phases in the Retry server action.
- **Secrets:** never log API keys; use existing sanitize helpers on Appwrite errors.
- **Server-only** Appwrite access via `getServerAppwrite()`.

## Acceptance criteria

- [ ] Retry on a failed run with a valid prior checkpoint requeues the same `runId` as `pending` and returns `{ ok: true }`; `/runs` revalidates.
- [ ] Feature 03’s three guard outcomes still return the locked error strings; automated tests still cover them.
- [ ] Missing prior checkpoint (when resume is past `fetch`) refuses retry without flipping status, with the locked missing-checkpoint message.
- [ ] Worker execution of a requeued run starts at `resumeStartPhase(completedPhase)` and does not call phase functions for earlier phases.
- [ ] A run that failed at `fetch` with no `completedPhase` retries from `fetch` (full runnable check).
- [ ] Successful resume still writes checkpoints for remaining phases and `markCompleted` with `topicSummary`.
- [ ] Concurrent active-run / race behavior matches Feature 02 wording (`"A run is already in progress for this newsletter"`).
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm --filter worker` typecheck/build as applicable, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Create: `shared/src/runs/phases.ts` (or equivalent) — `PHASE_ORDER`, `nextPhase`, `resumeStartPhase`
- Create: `shared/src/runs/__tests__/phases.test.ts`
- Modify: `shared/src/runs/repository.ts` — add `requeueFailedRun`
- Modify: `shared/src/runs/__tests__/repository.test.ts` — requeue cases
- Modify: `shared/src/runs/retry.ts` — replace step 4 with checkpoint check + requeue + race
- Modify: `shared/src/runs/__tests__/retry.test.ts` — success path, missing checkpoint, invalid completedPhase; keep three guard tests
- Modify: `shared/src/runs/start.ts` — add `requireOkFeeds?: boolean` (default `true`) to config builder
- Modify: `shared/src/runs/__tests__/start.test.ts` — `requireOkFeeds: false` path
- Modify: `shared/src/runs/execute-run.ts` — resume hydration + skip completed phases
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — resume cases (skipped phase call counts)
- Modify: `shared/src/runs/index.ts` — export new helpers / `requeueFailedRun` as needed
- Modify: `web/app/(protected)/runs/actions.ts` — `revalidatePath("/runs")` on success (if not already conditional)
- Test: shared tests above; no Playwright required

## Testing approach

Test-first for shared resume logic. GUI already exists from Feature 03; verify success path via action + shared helper tests.

1. **phases helpers:** empty completed → `"fetch"`; each completed phase maps to the correct next; `completedPhase === "draft"` → `null`.
2. **requeueFailedRun:** failed → pending; preserves checkpoint ids + completedPhase + startedAt; clears failure fields + endedAt; non-failed → validation error; missing → not_found.
3. **requestFailedRunRetry guards:** unchanged three strings (regression).
4. **requestFailedRunRetry success:** failed run with scrape completed + tag failed → load scrape checkpoint ok → requeue → `{ ok: true }`; status pending.
5. **requestFailedRunRetry missing checkpoint:** completedPhase set but load throws `checkpoint_missing` → error string locked; status remains `failed`.
6. **executeRun resume from tag:** seed run pending with `completedPhase: "scrape"` + mock scrape checkpoint; assert `fetchFeeds` and `scrapeAll` call counts are 0; `tagArticles` called once with scrape articles; later phases proceed; `markCompleted` called.
7. **executeRun resume from fetch:** no completedPhase → all six phases invoked (Feature 02 parity).
8. **executeRun resume checkpoint load failure:** pending with completedPhase but load fails → markFailed, no phase LLM calls.
9. **Race:** after requeue, when two actives exist: every run after the oldest is `markFailed` with `"Superseded by a concurrent start"`; if this run is not oldest → `{ ok: false }` with the locked in-progress string; if this run is oldest → `{ ok: true }` and the newer concurrent run is the one marked failed.

## Tasks

### Task 1: Phase helpers + tests

- **Action:** Add `shared/src/runs/phases.ts` with `PHASE_ORDER`, `nextPhase`, `resumeStartPhase` (`RunPhase | null`). Write `shared/src/runs/__tests__/phases.test.ts` covering the mapping table including draft → `null`. Export from the runs barrel.
- **Expected result:** Resume cursor logic is pure and unit-tested before repository/executor changes.
- **Verify:** `pnpm --filter @newsletter/shared test` — phases tests pass.
- **Depends on:** Feature 01 `RUN_PHASES` present (align literals; do not import from `pipeline/types`).

### Task 2: `requeueFailedRun` + tests

- **Action:** Add failing tests then implement `requeueFailedRun` in `shared/src/runs/repository.ts` per Spec. Export from barrel.
- **Expected result:** A failed run can be flipped back to `pending` while keeping checkpoints.
- **Verify:** New repository tests pass under `pnpm --filter @newsletter/shared test`.
- **Depends on:** Task 1 (optional for this task; Feature 01 repo required).

### Task 3: Retry helper — real enqueue path + tests

- **Action:** Update `shared/src/runs/retry.ts` to replace step 4 with checkpoint preflight, `requeueFailedRun`, and race re-check. Update `shared/src/runs/__tests__/retry.test.ts`: keep three guards; replace “not available yet” with success / missing-checkpoint / invalid-resume / race cases. Ensure `web/app/(protected)/runs/actions.ts` revalidates `/runs` on `{ ok: true }`.
- **Expected result:** Operator Retry can enqueue a failed run; missing checkpoints are refused safely.
- **Verify:** Retry tests pass; `pnpm --filter web build` and `pnpm typecheck` green for the action wiring.
- **Depends on:** Task 2 (and Feature 03 retry shell).

### Task 4: Executor resume path + tests

- **Action:** Extend `buildPipelineConfigForNewsletter` with `requireOkFeeds?: boolean` (default `true`) in `shared/src/runs/start.ts` (or wherever Feature 02 placed it); update its tests for the `false` path (topics still required, feeds not). Extend `shared/src/runs/execute-run.ts` to hydrate from `completedPhase` and run only from `resumeStartPhase` onward. Add `execute-run.test.ts` cases for resume-from-scrape/tag (skipped fetch/scrape), resume-from-selection (draft only), fresh-start still works, checkpoint load failure at claim, newsletter-missing mid-resume sets `failedPhase: startPhase`, mid-resume phase failure still `markFailed`.
- **Expected result:** Worker-claimed retries do not repeat completed website/LLM phases; mid-pipeline resume does not demand ok feeds.
- **Verify:** Resume tests assert zero calls to skipped phase mocks; start-helper tests cover `requireOkFeeds: false`; shared suite green for execute-run + start.
- **Depends on:** Task 1; Feature 02 `executeRun` + config builder present.

### Task 5: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm Feature 03 guard strings unchanged; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 3–4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: with Features 01–03 live and worker up, force a mid-pipeline failure (e.g. bad OpenRouter key after scrape) → Retry → observe run leave `failed`, skip early phases in worker logs, reach `completed` or fail again at the same phase without refetching.

## Handoff

Builder reports: files created/modified; confirmation that Retry reuses the same `runId`; which phase-skip cases are covered by tests; any deviation (e.g. Appwrite optional-field empty-string vs null) and why; note that selection-phase retries still call the embedder (by design — embeddings are not checkpointed).

**Research note:** Prior specs Feature 01–03 (checkpoint payloads, pending poller, Retry shell). Codebase — `selectDiverse` re-embeds from scored articles (`shared/src/pipeline/mmr-selection.ts`), so stripped score checkpoints are valid resume inputs; legacy Python resume (`AI-Newsletter-Pipeline-main - OLD - DO NOT USE/src/pipeline.py`) skipped fetch/scrape/tag from a coarser checkpoint — Stage 04 uses finer per-phase Storage files. Appwrite `updateDocument` partial updates (Context7 `/websites/appwrite_io`). Auto decisions: same-run requeue; resume cursor from `completedPhase` (`null` when non-resumable); preflight checkpoint load; full Feature 02 race cleanup on requeue; `requireOkFeeds` flag on config builder; extend `executeRun` rather than a second job type. Grizzled Senior review accepted: race mirror, `resumeStartPhase` null typing, named mid-pipeline config API + `failedPhase` on newsletter-missing.
