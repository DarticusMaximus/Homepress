# Feature 01: Run checkpoints

## Intent

Give every newsletter run a durable, resumable memory — a lean run record plus per-phase Storage checkpoints of only what the next pipeline phase needs — so later Stage 04 features can start, observe, and retry runs without repeating completed website or LLM work, and so Stage 05 can look back at what each completed issue covered.

## Spec

Schema + repository only. No GUI, no “Start run” action, no orchestrator wiring, no history page. Features 02–04 consume this API; Feature 06 owns retention/deletion of old runs and their Storage files.

### Storage model

1. **`runs` collection** — operational metadata for history, retry, feed-health, and Stage 05 lookback.
2. **Appwrite Storage bucket `run_checkpoints`** — one JSON file per successfully persisted phase. File IDs are stored on the run document. This avoids stuffing large article bodies into Appwrite documents (S3-style object storage already in the Appwrite stack).

### `runs` collection (`RUNS_COLLECTION_ID = "runs"`)

Server-only permissions (`read: [], write: []`), matching feeds/newsletters. Display name: `"Runs"`.

| Attribute | Type | Size / notes | Required | Default | Array |
|-----------|------|--------------|----------|---------|-------|
| `newsletterId` | string | 64 | true | — | no |
| `newsletterName` | string | 255 | true | — | no |
| `status` | string | 32 | true | — | no |
| `currentPhase` | string | 32 | false | — | no |
| `completedPhase` | string | 32 | false | — | no |
| `failedPhase` | string | 32 | false | — | no |
| `failureMessage` | string | 2000 | false | — | no |
| `startedAt` | datetime | — | true | — | no |
| `endedAt` | datetime | — | false | — | no |
| `topicSummary` | string | 100000 (JSON text) | false | — | no |
| `failedFeeds` | string | 20000 (JSON text) | false | — | no |
| `checkpointFetchId` | string | 64 | false | — | no |
| `checkpointScrapeId` | string | 64 | false | — | no |
| `checkpointTagId` | string | 64 | false | — | no |
| `checkpointScoreId` | string | 64 | false | — | no |
| `checkpointSelectionId` | string | 64 | false | — | no |
| `checkpointDraftId` | string | 64 | false | — | no |

**Status vocabulary** (`RUN_STATUSES` / `RunStatus`): `pending` | `running` | `completed` | `failed`.

**Phase vocabulary** (`RUN_PHASES` / `RunPhase`): `fetch` | `scrape` | `tag` | `score` | `selection` | `draft` — duplicate the six literals in `declarations.ts` (same anti-cycle pattern as `NewsletterDateRange`; do not import from `pipeline/types`).

**Field semantics:**

- `newsletterName` — snapshot at `createRun` time (history stays readable if the newsletter is renamed).
- `currentPhase` — phase in progress / last attempted; empty/null until `markRunning`.
- `completedPhase` — last phase whose checkpoint file was successfully saved; empty/null until first successful `savePhaseCheckpoint`.
- `failedPhase` / `failureMessage` — set when `status === "failed"`; clear/empty otherwise.
- `endedAt` — set on `completed` or `failed`; null while `pending`/`running`.
- `topicSummary` — JSON array of `{ title: string; tags: string[] }` for **selected** articles; written only by `markCompleted`. Empty string/`[]` otherwise. Enables Stage 05 lookback without opening Storage files.
- `failedFeeds` — JSON array aligned with pipeline `FeedFailure` shape (`feedUrl`, `errorType`, `errorMessage`, optional `statusCode`). Written when the fetch checkpoint is saved (may be `[]`). Feature 05 reads this; Feature 01 only persists it.
- Checkpoint id attributes — Appwrite Storage file `$id` for that phase; empty/null until saved.

### Bucket (`RUN_CHECKPOINTS_BUCKET_ID = "run_checkpoints"`)

Declare a bucket constant (and a small `BUCKETS` / `SchemaBucket` list parallel to `COLLECTIONS`) in `declarations.ts`. Provision on worker boot via an extended `provisionDatabase` (or a clearly named helper it calls).

| Setting | Value |
|---------|-------|
| id | `run_checkpoints` |
| name | `Run Checkpoints` |
| permissions | `[]` (server API key only) |
| fileSecurity | `false` |
| enabled | `true` |
| maximumFileSize | `33554432` (32 MiB) |
| allowedFileExtensions | `["json"]` |

Create-if-absent only (list/`getBucket` then `createBucket`; 409 → skipped). No drop/update of existing bucket settings on drift — warn + skip, matching collection attribute drift. Extend `ProvisionResult` with `buckets: { created, skipped, failed }` (and optional warnings).

### Phase checkpoint payloads (resume inputs only)

Each file is UTF-8 JSON. Define the wire types in `shared/src/runs/types.ts` (builders may `import type` from `shared/src/pipeline/types` — the declarations↔pipeline anti-cycle rule does **not** apply here).

**Article wire types** (ISO `published` on disk; revive to `Date` on load for article-bearing payloads so Feature 04 can feed the pipeline without a second conversion layer):

```ts
/** On-disk / Storage JSON shape. `published` is ISO-8601. */
type ArticleJson = {
  title: string;
  link: string;
  published: string; // ISO-8601
  content: string;
  source: string;
};

type TaggedArticleJson = ArticleJson & { tags: string[] };

/** Score checkpoint: never persist `embedding`. */
type ScoredArticleJson = TaggedArticleJson & { score: number };

/** Selection checkpoint: same fields as scored; never persist `embedding`. */
type SelectedArticleJson = ScoredArticleJson;

type ScrapeSummaryJson = {
  total: number;
  extracted: number;
  fallback: number;
};

type DraftCheckpointPayload = {
  markdown: string;
  empty: boolean;
  reason: "no-articles" | "empty-after-retry" | null;
  articleCount: number;
  attempts: number;
};
```

`savePhaseCheckpoint` **must strip** `embedding` when writing `score` and `selection` payloads (even if the caller passes pipeline `ScoredArticle` / `SelectedArticle` objects that still carry vectors). `loadPhaseCheckpoint` for fetch/scrape/tag/score/selection returns in-memory objects with `published: Date` (parse ISO → `Date`); draft returns `DraftCheckpointPayload` as-is.

| Completed phase | Payload (what the *next* phase consumes) | Run doc side effects |
|-----------------|------------------------------------------|----------------------|
| `fetch` | `{ articles: ArticleJson[] }` | Set `failedFeeds` JSON from caller-supplied list (may be `[]`); set `checkpointFetchId`, `completedPhase: "fetch"` |
| `scrape` | `{ articles: ArticleJson[]; summary: ScrapeSummaryJson }` | Set `checkpointScrapeId`, `completedPhase: "scrape"` |
| `tag` | `{ taggedArticles: TaggedArticleJson[] }` | Set `checkpointTagId`, `completedPhase: "tag"` |
| `score` | `{ scoredArticles: ScoredArticleJson[] }` (**strip `embedding`**) | Set `checkpointScoreId`, `completedPhase: "score"` |
| `selection` | `{ selectedArticles: SelectedArticleJson[] }` (**strip `embedding`**) | Set `checkpointSelectionId`, `completedPhase: "selection"` |
| `draft` | `DraftCheckpointPayload` (no `raw`, no `retryError`) | Set `checkpointDraftId`, `completedPhase: "draft"` |

Do **not** store full `TagResult`/`ScoreResult`/`SelectionResult` failure arrays or OpenRouter `raw` dumps — only next-phase inputs (plus scrape summary counts and draft flags above).

**File naming:** use `ID.unique()` for the Storage file id; filename hint `{runId}-{phase}.json` via `InputFile.fromPlainText` / `fromBuffer` (`import { InputFile } from "node-appwrite/file"` — package export path for node-appwrite 26.x).

### Repository API (`shared/src/runs/`)

Mirror feeds/newsletters patterns: `types.ts`, `repository.ts`, `__tests__/`, `RunRepositoryError` with codes `validation` | `not_found` | `appwrite` | `checkpoint_missing`, `wrapAppwriteError` + `sanitizeAppwriteMessageForLog`, safe user-facing Appwrite message.

| Function | Behavior |
|----------|----------|
| `createRun(client, { newsletterId, newsletterName })` | Creates doc: `status: "pending"`, `startedAt: now`, empty optional fields (`""` / omit / null per Appwrite optional rules — map consistently in `documentToRun`), no checkpoint ids. Does **not** validate that the newsletter exists (Feature 02 owns runnable checks). |
| `getRun(client, runId)` | Load + map; 404 → `not_found`. |
| `markRunning(client, runId, currentPhase)` | `status: "running"`, set `currentPhase`; clear `failedPhase`/`failureMessage`/`endedAt` if re-entering from a clean start path (Feature 02/04 decide when to call). |
| `markFailed(client, runId, { failedPhase, failureMessage })` | `status: "failed"`, set `failedPhase`, truncate `failureMessage` to 2000, set `endedAt: now`. |
| `markCompleted(client, runId, { topicSummary })` | `status: "completed"`, set `topicSummary` JSON (validate array of `{ title, tags[] }`), `endedAt: now`, clear failure fields. |
| `savePhaseCheckpoint(client, runId, phase, payload, opts?)` | Upload JSON file; update the matching `checkpoint*Id` + `completedPhase`. For `phase === "fetch"`, `opts.failedFeeds` (default `[]`) is written to `failedFeeds`. On **any** Storage or document-update failure after the phase was notionally done: best-effort `deleteFile` if upload succeeded but doc update failed; then `markFailed` with `failedPhase: phase` and message like `Failed to save {phase} checkpoint`; rethrow `RunRepositoryError`. A phase is **not** considered completed unless both file and doc update succeed. |
| `loadPhaseCheckpoint(client, runId, phase)` | Read file id from run; download/view file bytes; parse JSON; revive Dates. Missing id or missing file → `checkpoint_missing`. |

No `listRuns` in this feature (Feature 03). No delete/retention (Feature 06). No concurrent-run guard (Feature 02).

### What this feature does **not** do

- Wire `runPipeline` / orchestrator to call these helpers.
- GUI, server actions, or nav for runs.
- Indexes (provisioner still does not create indexes; Feature 03 may query with in-memory sort / existing Query helpers).
- Cascade-delete Storage files when a run is removed.
- Feed-health consecutive-failure counters (Feature 05).
- Enforce one-active-run-per-newsletter (Feature 02).

## Dependencies

- Builds on: stage-02 schema provisioner + worker boot `provisionDatabase` call; stage-03 feeds/newsletters repository patterns (`wrapAppwriteError`, mock clients, Vitest); stage-01 pipeline article/phase shapes (conceptual — checkpoint JSON mirrors next-phase inputs, not full `PipelineResult`).
- Orphaned by: none — first feature in stage 04.

## Constraints

- **Schema-as-code only** for the `runs` collection and the `run_checkpoints` bucket declaration; no console-clicked schema.
- **Create-if-absent only** for collection, attributes, and bucket. Drift → warn + skip.
- **Server-only** collection permissions and empty bucket permissions (API key access).
- **Do not remove or alter** existing collections (`health_check`, `feeds`, `newsletters`, `newsletter_feeds`).
- **Do not change** `DATABASE_ID`.
- **Do not wire the pipeline or GUI** in this feature.
- **Secrets:** never log API keys; use `sanitizeAppwriteMessageForLog` on Appwrite error messages.
- **Checkpoint completeness:** a phase is complete only after durable file + run-doc update; persist failure marks the run `failed`.

## Acceptance criteria

- [ ] `COLLECTIONS` includes `runs` with the attributes in Spec; exports `RUNS_COLLECTION_ID`, `RUN_STATUSES` / `RunStatus`, `RUN_PHASES` / `RunPhase`.
- [ ] Bucket constant `RUN_CHECKPOINTS_BUCKET_ID` (+ declaration list) exists; provisioner creates the bucket idempotently and reports bucket counts on `ProvisionResult`.
- [ ] Repository implements `createRun`, `getRun`, `markRunning`, `markFailed`, `markCompleted`, `savePhaseCheckpoint`, `loadPhaseCheckpoint` with behaviors above.
- [ ] Fetch checkpoint persists `failedFeeds` on the run; `markCompleted` persists `topicSummary`.
- [ ] Selection/score checkpoints strip embeddings; draft omits `raw` / `retryError`.
- [ ] Checkpoint save failure marks the run `failed` for that phase and does not leave `completedPhase` advanced for the failed save.
- [ ] `pnpm --filter @newsletter/shared test` passes (updated declaration/provisioner tests + new runs repository tests).
- [ ] Shared package exports the new runs API from `shared/src/index.ts` (via `shared/src/runs` barrel).

## Files

- Create: `shared/src/runs/types.ts`
- Create: `shared/src/runs/repository.ts`
- Create: `shared/src/runs/index.ts`
- Create: `shared/src/runs/__tests__/repository.test.ts`
- Create: `shared/src/runs/__tests__/mock-client.ts` (or extend schema mock if cleaner — prefer runs-local mock mirroring feeds)
- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/provisioner.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/schema/__tests__/provisioner.test.ts`
- Modify: `shared/src/schema/__tests__/mock-client.ts` (Storage bucket create/get stubs as needed)
- Modify: `shared/src/index.ts` (export `./runs`)

## Testing approach

Test-first. Behavior under test is durable run metadata + resumable phase payloads — not UI.

1. **Declarations:** `runs` attribute keys/types/sizes/required; status/phase const arrays; bucket id constant; `COLLECTIONS` length/order includes `runs` after existing four.
2. **Provisioner:** first run creates bucket; second run skips (409 or already-found); conflict race counts as skipped; existing DB collection provisioning still green; secrets not in logs/results.
3. **createRun / getRun / markRunning / markFailed / markCompleted:** document field mapping; `topicSummary` JSON round-trip; `failureMessage` truncation; 404 → `not_found`.
4. **savePhaseCheckpoint / loadPhaseCheckpoint (happy path):** uploads JSON; sets correct `checkpoint*Id` + `completedPhase`; fetch writes `failedFeeds`; load revives `published` ISO → `Date`; **both score and selection** persisted payloads have no `embedding`; draft has no `raw`/`retryError`; missing checkpoint → `checkpoint_missing`.
5. **Persist failure:** mocked Storage/doc failure after “phase done” → run ends `failed` with `failedPhase` equal to the phase being saved; `completedPhase` unchanged from prior successful phase (if any); orphan file best-effort deleted when upload succeeded but doc update failed.

## Tasks

### Task 1: Declarations for runs + bucket

- **Action:** Extend `shared/src/schema/declarations.ts` with `RUNS_COLLECTION_ID`, `RUN_STATUSES` / `RunStatus`, `RUN_PHASES` / `RunPhase`, `RUN_CHECKPOINTS_BUCKET_ID`, a `SchemaBucket` type + `BUCKETS` array (or equivalent), and the `runs` collection attributes from Spec. Update `shared/src/schema/__tests__/declarations.test.ts` (collection count becomes 5; assert runs + bucket constants). Write failing tests first where practical.
- **Expected result:** Declarations and declaration tests describe the full data contract; provisioner not yet creating the bucket.
- **Verify:** `pnpm --filter @newsletter/shared test` — declaration tests pass; provisioner tests still pass (ignore unknown bucket until Task 2).
- **Depends on:** none.

### Task 2: Provision run_checkpoints bucket

- **Action:** Extend `shared/src/schema/provisioner.ts` to create-if-absent buckets from `BUCKETS` using `Storage` + `createBucket`/`getBucket` (or list), 409 → skipped, drift warn+skip. Extend `ProvisionResult` with `buckets`. Update mock client + `provisioner.test.ts` for bucket create/skip/conflict. Worker already calls `provisionDatabase` — no worker change unless the return type forces a log-line update (optional one-line log of bucket counts).
- **Expected result:** Boot provisioning creates the checkpoints bucket idempotently alongside DB schema.
- **Verify:** New/updated provisioner tests pass; full shared test suite still green for schema.
- **Depends on:** Task 1.

### Task 3: Run repository lifecycle (no Storage)

- **Action:** Add `shared/src/runs/types.ts` (including the pinned `ArticleJson` / `TaggedArticleJson` / `ScoredArticleJson` / `SelectedArticleJson` / `ScrapeSummaryJson` / `DraftCheckpointPayload` types from Spec) + `repository.ts` with `createRun`, `getRun`, `markRunning`, `markFailed`, `markCompleted`, `documentToRun`, error helpers. Tests with mocked `Databases` only. Export barrel `shared/src/runs/index.ts` and `export * from "./runs"` in `shared/src/index.ts`.
- **Expected result:** Run documents can be created and transitioned through pending → running → completed/failed with `topicSummary` on complete; wire types are exported for Features 02–04.
- **Verify:** `shared/src/runs/__tests__/repository.test.ts` covers lifecycle + truncation + not_found; `pnpm --filter @newsletter/shared test` passes for these cases.
- **Depends on:** Task 1.

### Task 4: Checkpoint happy path (save / load)

- **Action:** Implement `savePhaseCheckpoint` / `loadPhaseCheckpoint` Storage upload/download in `repository.ts` per Spec payload table and pinned `*Json` types (Date serialize/revive, fetch `failedFeeds`, **strip `embedding` on both score and selection writes**, draft omits `raw`/`retryError`). Extend mocks for `Storage.createFile` / get contents. Tests: at least fetch + scrape/tag round-trip Date revive, score strip, selection strip, draft shape, `checkpoint_missing`. Do **not** implement the persist-failure path in this task.
- **Expected result:** Phase payloads are durable in the bucket and addressable from the run document; score/selection files never contain `embedding`.
- **Verify:** Happy-path checkpoint tests pass, including explicit assertions that saved score **and** selection JSON have no `embedding` key; `pnpm --filter @newsletter/shared test` green for these cases.
- **Depends on:** Task 2, Task 3.

### Task 5: Checkpoint persist-failure path

- **Action:** On Storage or document-update failure during `savePhaseCheckpoint`: best-effort `deleteFile` if upload succeeded but doc update failed; `markFailed` with `failedPhase: phase` and message like `Failed to save {phase} checkpoint`; rethrow `RunRepositoryError`; do **not** advance `completedPhase` for the failed save. Add focused tests with mocked upload-ok/doc-fail and upload-fail cases.
- **Expected result:** Persist failures are operator-visible run failures; prior successful `completedPhase` is preserved; orphan files are best-effort cleaned.
- **Verify:** Persist-failure tests assert `status === "failed"`, `failedPhase` equals the phase being saved, `completedPhase` unchanged from the prior successful phase (seed one), and rethrow occurs; `pnpm --filter @newsletter/shared test` green.
- **Depends on:** Task 4.

### Task 6: Feature verification pass

- **Action:** Re-read Spec vs implementation; ensure exports are complete; fix any declaration/provisioner/repository gaps; run the full shared test command.
- **Expected result:** Acceptance criteria satisfied; no GUI/pipeline files touched.
- **Verify:** `pnpm --filter @newsletter/shared test` exits 0; spot-check that `web/` and `shared/src/pipeline/` were not modified for this feature (except read-only conceptual alignment).
- **Depends on:** Task 5.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test`
- Expected: all shared tests pass, including new runs + updated schema tests. Manual Appwrite console check (optional PM gate): after worker restart, `runs` collection and `run_checkpoints` bucket exist.

## Handoff

Builder reports: files created/modified; confirmation that repository API matches Spec table; any deviation (e.g. Appwrite null vs `""` for optional strings) and why; note that Features 02–04 must call these helpers — pipeline is intentionally unwired.

**Research note:** Appwrite Storage `createBucket` / `createFile` via node-appwrite 26.x (`InputFile` from `node-appwrite/file`); Context7 `/websites/appwrite_io` storage docs. Codebase: `shared/src/schema/declarations.ts`, feeds repository error/log patterns, `PipelinePhase` / article types in `shared/src/pipeline/types.ts`. Grill decisions: schema+repo only; lean runs + Storage payloads; resume-input payloads + `topicSummary` on complete; persist-failure → mark failed; bucket provisioned on boot.
