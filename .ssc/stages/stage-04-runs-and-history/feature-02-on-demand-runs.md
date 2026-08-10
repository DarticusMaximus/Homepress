# Feature 02: On-demand runs

## Intent

Let the operator start a newsletter generation from the GUI and get a durable run record immediately, while the worker executes the pipeline with per-phase checkpoints — and while the system refuses a second active run for the same newsletter — so on-demand generation is operable without blocking the web process or double-spending network/LLM work.

## Spec

Wire Feature 01’s run/checkpoint API to a real start path: GUI → create `pending` run → worker claims and executes phase-by-phase with checkpoints. No history page (Feature 03), no resume-from-failed (Feature 04), no feed-health counters (Feature 05), no retention (Feature 06).

### Architecture (locked)

1. **Web never runs the pipeline.** Server action validates, enforces the one-active-run guard, creates a `pending` run via `createRun`, returns `{ ok, runId }`. Request ends; Next.js does not await LLM work.
2. **Worker owns execution.** Poll Appwrite for `status === "pending"` runs, claim one at a time, run a checkpointed phase executor in `@newsletter/shared`, then loop. Uses the existing `registerJob` seam for the handler name; the poll loop is what invokes it.
3. **Do not call monolithic `runPipeline` for production runs.** It has no mid-phase checkpoint hooks. The executor calls the same phase functions (`fetchFeeds`, `scrapeAll`, `tagArticles`, `scoreArticles`, `selectDiverse`, `NewsletterDrafter.draft`) in order and persists each successful phase via `savePhaseCheckpoint` before advancing — the same contract Feature 04 will resume from.
4. **Job transport is the `runs` collection** (pending documents). No Redis, no HTTP worker port, no Appwrite Functions. Stage 08 can create `pending` runs the same way.

### Active-run definition

A newsletter has an **active run** when any run document for that `newsletterId` has `status` in `pending` | `running`.

### Repository additions (`shared/src/runs/repository.ts`)

Feature 01 deferred listing. This feature adds narrow queries (not full history pagination — Feature 03):

| Function | Behavior |
|----------|----------|
| `listActiveRunsForNewsletter(client, newsletterId)` | `Query.equal("newsletterId", id)` + `Query.equal("status", ["pending", "running"])` + `Query.limit(5)`. Map all matches. Sort oldest-first by `startedAt` ascending, then `$id` ascending (in memory if Appwrite order is unavailable). Return the array (may be empty). This is the source of truth for race cleanup. |
| `findActiveRunForNewsletter(client, newsletterId)` | Convenience: `listActiveRunsForNewsletter` then return the first element, or `null`. Used by the GUI active map and the simple pre-create guard. |
| `listPendingRuns(client, { limit?: number })` | `Query.equal("status", "pending")` + `Query.orderAsc("startedAt")` + `Query.limit(limit ?? 10)`. Return mapped runs oldest-first (FIFO claim order). |

If Appwrite rejects `orderAsc` without an index, fall back to `Query.limit` + in-memory sort by `startedAt` ascending (same pattern as newsletter list sort) and document the fallback in the handoff.

### Runnable validation + config assembly (`shared/src/runs/start.ts` or equivalent)

`assertNewsletterRunnable` / `buildPipelineConfigForNewsletter(client, newsletterId)`:

1. `getNewsletter` — missing → validation error `"Newsletter not found"`.
2. Topics: after trim, must be non-empty → `"Add at least one topic before generating"`.
3. `listAttachmentsForNewsletter` — keep only attachments where `feedStatus === "ok"` (or resolved feed `status === "ok"`). Non-ok attachments are **excluded**, not fatal, if ≥1 ok remains.
4. Zero ok feed URLs → `"Attach at least one healthy (ok) feed before generating"`.
5. Return `{ newsletter, feedUrls, config }` where `config = createNewsletterConfig({ name, topics, dislikedTopics, audience, newsItems, dateRange, feeds: feedUrls })`.

Do **not** change Stage 03 DB write rules (empty topics/feeds still allowed on save).

### Start path (web server action)

`startNewsletterRun(newsletterId: string): Promise<StartRunResult>`

`StartRunResult = { ok: true; runId: string } | { ok: false; error: string }`

1. Build/validate runnable config (above). On failure → `{ ok: false, error }`.
2. `findActiveRunForNewsletter` — if non-null → `{ ok: false, error: "A run is already in progress for this newsletter" }`.
3. `createRun(client, { newsletterId, newsletterName: newsletter.name })`.
4. **Race re-check:** `listActiveRunsForNewsletter` (already oldest-first). If the list has more than one run: `markFailed` every run after the first with `failedPhase: "fetch"` and message `"Superseded by a concurrent start"`. If the just-created `runId` is **not** the first (oldest) entry, return `{ ok: false, error: "A run is already in progress for this newsletter" }`. Operator-facing success only when the created run is the sole or oldest active run.
5. `revalidatePath("/newsletters")`. Return `{ ok: true, runId }`.

Do **not** invoke the executor or wait for completion.

### Checkpointed executor (`shared/src/runs/execute-run.ts`)

`executeRun(client, runId, options?: PipelineOptions): Promise<void>`

Fresh-start only (Feature 04 owns resume):

1. `getRun` — must exist; `status` must be `pending` (if already `running`/`completed`/`failed`, no-op or throw `RunRepositoryError` with a clear code — prefer throw `validation` so the worker logs and moves on).
2. Load newsletter + build config via the same helper as start (re-read at claim time so edits after enqueue are honored). If no longer runnable → `markFailed` with `failedPhase: "fetch"` and the validation message; return.
3. For each phase in order `fetch → scrape → tag → score → selection → draft`:
   - `markRunning(runId, phase)`.
   - Run the phase function (injectable via `PipelineOptions`, same defaults as `runPipeline`).
   - Map fatal outcomes to `markFailed` + return (mirror `runPipeline` fatal conditions: zero articles after fetch; tag/score `halted`; zero selected; draft `empty`). Use a short operator-facing `failureMessage` (e.g. `"No articles fetched"`, `"Tagging halted"`, draft `reason`).
   - On success: `savePhaseCheckpoint` with the Feature 01 payload shape (`failedFeeds` on fetch; strip embeddings on score/selection; draft omits `raw`/`retryError`).
4. After draft checkpoint: `markCompleted` with `topicSummary` = selected articles mapped to `{ title, tags }` (from selection checkpoint / in-memory selected list).
5. Unexpected thrown errors (not already handled as phase failure): `markFailed` with `failedPhase` = current phase (or `"fetch"` if none) and truncated message; rethrow or swallow per worker (worker should catch and log, not crash the process).

**Scrape** never fails the run by itself (same as `runPipeline`); always checkpoint scrape summary + merged articles.

### Worker poll loop

In `worker/src/index.ts` (and/or `worker/src/run-poller.ts`):

- Register job name `execute-run` via `registerJob` whose handler accepts `{ runId: string }` and calls `executeRun`.
- Extract claim/poll helpers into `worker/src/run-poller.ts` so they are unit-testable (in-flight flag, claim decision, shutdown fail hook).
- Start an interval (`WORKER_RUN_POLL_MS`, default `3000`) that:
  1. Skips if a run is already executing in this process (single in-flight run globally for V1 — Stage 08 owns richer concurrency).
  2. `listPendingRuns(client, { limit: 1 })`.
  3. For the candidate: call `listActiveRunsForNewsletter`. **Skip** (leave pending, do not invoke execute) if any *other* active run for that newsletter is `running`, or if any *other* active run is an older `pending` (earlier `startedAt`, then `$id`). Otherwise claim and proceed.
  4. Invoke `getJob("execute-run")!({ runId })` (await). Errors logged; process stays alive.
- On `SIGTERM`/`SIGINT`: if a run is in-flight, best-effort `markFailed` with message `"Worker shut down during run"` and `failedPhase` = current phase if known, then exit (so Feature 04 can retry). Do not wait for the full pipeline to finish beyond a short grace (document ~few seconds best-effort).

### GUI

On `/newsletters` list (table + cards — responsive convention):

- Add a **Generate** button (label locked) per newsletter in row/card actions beside Edit/Delete.
- Server page loads an `activeRunByNewsletterId: Record<string, { runId: string; status: "pending" | "running" }>` for newsletters on the current page (call `findActiveRunForNewsletter` per id, or one batched list query if implemented — N≤20 is fine).
- If active: button disabled, text **Generating…**; optional muted status is enough (no history link required — Feature 03).
- If idle: enabled **Generate**; `useTransition` + `startNewsletterRun(id)`; `toast.success("Run started")` / `toast.error(error)`; on success the disabled state appears after revalidate.
- Empty topics / no ok feeds: button may stay enabled; server returns the validation error via toast (source of truth on server).

No new route. No run detail page.

### Out of scope

- Run history page, filters, retry button (Features 03–04).
- Cancelling an in-progress run.
- Scheduled starts (Stage 08).
- Cross-newsletter parallel execution policy beyond “one in-flight in the worker process”.
- Modifying `runPipeline` itself (leave parity CLI on the monolithic path).
- Feed-health consecutive counters (Feature 05).
- Indexes in the provisioner (optional in-memory sort fallback is allowed).

## Dependencies

- Builds on: **feature-01-run-checkpoints** — `createRun`, `getRun`, `markRunning`, `markFailed`, `markCompleted`, `savePhaseCheckpoint`, status/phase vocabulary, Storage bucket. **Execute Feature 01 before this feature**; if `shared/src/runs/` is missing, stop and escalate.
- Builds on: stage-01 pipeline phase functions + `createNewsletterConfig` / `PipelineOptions`.
- Builds on: stage-03 newsletter + attachment repositories (`getNewsletter`, `listAttachmentsForNewsletter`, ok-only attach semantics).
- Builds on: stage-00 worker registry + heartbeat process; stage-02/03 web server-action + toast patterns.

## Constraints

- **Web must not execute** fetch/scrape/LLM phases in the server action or in a Next.js `after()` callback.
- **Worker must not import** from `web`; shared + worker only.
- **Do not alter** Feature 01 checkpoint payload shapes or strip rules.
- **Do not add** `listRuns` history API / Runs nav item (Feature 03).
- **Do not implement** resume-from-`failed` (Feature 04) — executor is fresh-start (`pending` only).
- **Secrets:** never log `OPENROUTER_API_KEY` or Appwrite keys; use existing sanitize helpers on Appwrite errors.
- **Server-only** Appwrite access via `getServerAppwrite()`.

## Acceptance criteria

- [ ] Operator can click **Generate** on a runnable newsletter; a `pending` then `running`/`completed`/`failed` run document appears in Appwrite; the web request returns without waiting for the pipeline.
- [ ] A second Generate while `pending` or `running` for that newsletter is rejected with a clear error; at most one active run per newsletter remains after race handling.
- [ ] Worker picks up pending runs and executes all six phases, writing Feature 01 checkpoints after each success and `topicSummary` on completion.
- [ ] Non-runnable newsletters (empty topics, zero ok feeds) are rejected at start (and at claim if they became invalid) without calling OpenRouter.
- [ ] Attached non-ok feeds are excluded from the run; ok feeds still run.
- [ ] Generate button shows **Generating…** / disabled while an active run exists for that row after refresh/revalidate.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm --filter worker` typecheck/build as applicable, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.
- [ ] **PM manual gate (optional):** with worker running, Generate a newsletter with ok feeds; observe run complete or fail in Appwrite; confirm double-click / second Generate is blocked while active.

## Files

- Create: `shared/src/runs/start.ts` (runnable check + config assembly + optional `startNewsletterRun` shared helper used by the web action)
- Create: `shared/src/runs/execute-run.ts` (checkpointed fresh-start executor)
- Create: `shared/src/runs/__tests__/start.test.ts`
- Create: `shared/src/runs/__tests__/execute-run.test.ts`
- Modify: `shared/src/runs/repository.ts` — add `listActiveRunsForNewsletter`, `findActiveRunForNewsletter`, `listPendingRuns`
- Modify: `shared/src/runs/__tests__/repository.test.ts` — query tests for the three new functions (list actives returns all matches sorted; find = first-or-null)
- Modify: `shared/src/runs/index.ts` (+ `shared/src/index.ts` if needed) — export new APIs
- Create: `worker/src/run-poller.ts` (poll interval + in-flight guard + claim decision + shutdown fail hook)
- Create: `worker/src/__tests__/run-poller.test.ts` (required — see Testing approach §7)
- Modify: `worker/src/index.ts` — register `execute-run`, start poller, wire SIGTERM to poller shutdown
- Modify: `web/app/(protected)/newsletters/actions.ts` — `startNewsletterRun`
- Modify: `web/app/(protected)/newsletters/page.tsx` — load active-run map
- Modify: `web/components/newsletters/newsletters-table.tsx` — Generate action
- Modify: `web/components/newsletters/newsletter-list-card.tsx` — Generate action (parity with table)
- Test: shared tests above; no Playwright required

## Testing approach

Test-first for shared logic. GUI verified via build + action wiring; optional PM manual gate for live worker.

1. **listActiveRunsForNewsletter / findActiveRunForNewsletter / listPendingRuns:** mock Appwrite queries; empty → `[]` / null; list returns all pending+running matches oldest-first; find returns first or null; pending claim list oldest-first (or in-memory sort equivalent).
2. **Runnable / config assembly:** empty topics → error; no attachments → error; only failed/untested attachments → error; mix of ok+failed → config.feeds is ok URLs only; happy path matches `createNewsletterConfig` fields.
3. **Start race:** when `listActiveRunsForNewsletter` returns two actives after create, newer is marked failed / start returns error if created run is not oldest; sole create succeeds with `runId`.
4. **executeRun happy path:** mocked phases; assert `markRunning` per phase, `savePhaseCheckpoint` six times with correct shapes, `markCompleted` with `topicSummary` length = selected count; embeddings absent from score/selection payloads passed to save.
5. **executeRun failures:** fetch zero articles → failed at fetch, no later checkpoints; tag halted → failed at tag with scrape+fetch checkpoints present; throw mid-phase → markFailed.
6. **Claim-time invalid config:** pending run whose newsletter lost all ok feeds → markFailed, no LLM calls.
7. **Worker poller (required):** `worker/src/__tests__/run-poller.test.ts` must cover: (a) skip tick when in-flight is set; (b) with mocked `listPendingRuns` returning one run and claim allowed → invokes `execute-run` / `executeRun` with that `runId`; (c) claim skipped when another active is `running` or an older `pending`; (d) simulated shutdown with in-flight set → best-effort `markFailed`. Full process lifecycle not required beyond typecheck/build.

## Tasks

### Task 1: Active/pending run queries + tests

- **Action:** Add failing tests then implement `listActiveRunsForNewsletter`, `findActiveRunForNewsletter` (first-or-null over the list), and `listPendingRuns` in `shared/src/runs/repository.ts`. Export from the runs barrel.
- **Expected result:** Feature 02 can list all actives (race cleanup), detect a single active (GUI/guard), and FIFO-claim pendings without a full history API.
- **Verify:** New repository tests pass under `pnpm --filter @newsletter/shared test` — including multi-active list sort and find = first-or-null.
- **Depends on:** Feature 01 code present.

### Task 2: Runnable validation + start helper + tests

- **Action:** Implement `shared/src/runs/start.ts` with runnable checks, ok-feed filtering, `createNewsletterConfig` assembly, and a `enqueueNewsletterRun(client, newsletterId)` (or similarly named) helper that performs active-guard → `createRun` → race re-check. Tests with mocked newsletter/attachment/run repos or injected deps.
- **Expected result:** One shared function the web action can call; validation messages stable.
- **Verify:** `start.test.ts` covers runnable failures, ok-feed filter, active guard, and race re-check.
- **Depends on:** Task 1.

### Task 3: Checkpointed `executeRun` + tests

- **Action:** Implement `shared/src/runs/execute-run.ts` per Spec (fresh-start only, `PipelineOptions` injection, checkpoint after each success, `markCompleted` topicSummary). Tests with mocked phase functions and mocked run repository/checkpoint saves.
- **Expected result:** A pending run can be driven to completed/failed with durable checkpoints; Feature 04 can later add a resume entrypoint beside this.
- **Verify:** `execute-run.test.ts` covers happy path + fetch/tag/draft failure paths + claim-time invalid config; shared test suite green for these files.
- **Depends on:** Task 1 (and Feature 01 checkpoint API).

### Task 4: Worker poller

- **Action:** Add `worker/src/run-poller.ts` with testable claim/in-flight/shutdown helpers; add required `worker/src/__tests__/run-poller.test.ts` covering Testing approach §7; register `execute-run` in `worker/src/index.ts`; start poll on `WORKER_RUN_POLL_MS` (default 3000); single in-flight guard; SIGTERM best-effort `markFailed` for in-flight run. Keep heartbeat. Remove or retain compile-only pipeline smoke refs as needed for build cleanliness (prefer keep build green without requiring OpenRouter at boot).
- **Expected result:** Worker claims pending runs and executes them without web involvement; poller behavior is proven by unit tests, not only by typecheck.
- **Verify:** Poller unit tests pass; `pnpm --filter worker` typecheck/build succeeds; optional short manual: create a pending run via a test script or UI and observe worker logs + status transition (PM gate).
- **Depends on:** Task 3.

### Task 5: Web action + Generate UI

- **Action:** Add `startNewsletterRun` in `web/app/(protected)/newsletters/actions.ts` calling the shared enqueue helper + `revalidatePath`. Thread `activeRunByNewsletterId` from `page.tsx` into table/card. Add **Generate** / **Generating…** buttons with `useTransition` + toasts. Match responsive list actions on card and table.
- **Expected result:** Operator can start a run from the newsletters list; active runs disable the button after refresh.
- **Verify:** `pnpm --filter web build` and `pnpm typecheck` pass; spot-check that the action does not import phase executors beyond the enqueue helper.
- **Depends on:** Task 2.

### Task 6: Feature verification pass

- **Action:** Re-read Spec vs implementation; ensure exports complete; run full test/typecheck/build gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm typecheck && pnpm test && pnpm --filter web build` (and worker build) exit 0.
- **Depends on:** Tasks 4–5.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker build && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: worker up + Generate on a newsletter with ok feeds → run reaches `completed` or `failed` with checkpoints; second Generate while active is blocked.

## Handoff

Builder reports: files created/modified; confirmation that web only enqueues; worker executes with six checkpoints on success; active-run guard + race behavior; any Appwrite `orderAsc` fallback; deviations and why.

**Research note:** Codebase — empty `registerJob` registry (`worker/src/registry.ts`), monolithic `runPipeline` without hooks (`shared/src/pipeline/orchestrator.ts`), no `shared/src/runs/` until Feature 01, newsletter list dialogs (no detail route), Stage 03 deferred runnable validation to Stage 04. Appwrite docs (Context7 `/websites/appwrite_io`): `Query.equal('status', ['pending', 'running'])` multi-value equality. Auto decisions: pending-run poll as job queue; checkpointed executor instead of `runPipeline`; one in-flight run in worker; Generate on list row/card; exclude non-ok attached feeds at run time. PM-accepted review: `listActiveRunsForNewsletter` for race cleanup; required poller unit tests; Task 3 left unsplit.
