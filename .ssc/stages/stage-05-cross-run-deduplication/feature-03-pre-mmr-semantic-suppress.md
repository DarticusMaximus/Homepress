# Feature 03: Pre-MMR semantic suppress

## Intent

Stop recurring topics from prior issues entering within-run diversity selection by hard-dropping lookback-similar candidates before MMR — so each new issue feels fresh, while short selections remain valid when the remaining pool is thin.

## Spec

Implement **cross-run semantic suppress** in the live run path (`executeRun` selection phase): load lookback topics (feature 02), embed them and current candidates as **title + tags** (apples-to-apples), hard-drop any candidate whose max cosine similarity to a lookback topic is **≥** the configured threshold, persist a `suppressSummary` on the run for feature 04, then run **existing** MMR (`selectDiverse`) on the survivors (MMR still embeds survivors as **title + body**).

This feature owns: threshold env read + default, suppress algorithm, run schema field + write, and `executeRun` wiring. It does **not** own run-summary UI (feature 04) or `.env` documentation polish (feature 05).

### Behavior contract

| Case | Behavior |
|------|----------|
| `lookback <= 0` | No-op: no lookback load needed beyond feature 02’s empty contract; no suppress; `suppressSummary` empty; MMR as today. |
| Lookback topics empty (no completed history / empty summaries) | No-op suppress; empty `suppressSummary`; MMR as today. |
| **Suppress input pool** | Suppress runs on the **full** `scoredArticles` array **before** `selectDiverse`’s internal `minScore` filter. Below-threshold scored articles may still be hard-dropped and appear in `suppressSummary` even though MMR would have excluded them. Do **not** pre-filter to score-passers before suppress. |
| Candidate max cosine vs any lookback topic **≥** threshold | Hard-drop that candidate; record in `suppressSummary.items` with best match provenance. `summary.count` **must equal** `summary.items.length`. |
| Survivors remain, count `< newsItems` | MMR fills what it can; run continues (short issue). Under-target is **not** a failure. |
| Survivors empty after suppress | Write `suppressSummary`, then **fail** selection (`markFailed` / “No articles selected”) — same terminal outcome as today’s empty selection. |
| Lookback-topic embedding call fails | Log; treat as no-op suppress (empty lookback); continue to MMR. If the embed endpoint is down, MMR’s own embed will likely fail next. |
| Candidate suppress-embed fails (title+tags batch) | Same spirit as MMR: do not silently half-apply. Fail the suppress batch → treat as no-op suppress + log **or** fail selection atomically — **prefer: log + no-op suppress + continue to MMR** (consistent with lookback-embed degrade; MMR remains the hard gate). |
| Threshold env unset / invalid | Use `DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD` (`0.85`). |

### Similarity & embed text

- **Metric:** cosine similarity via existing `cosine` in `shared/src/pipeline/vectors.ts`.
- **Threshold:** `CROSS_RUN_SIMILARITY_THRESHOLD` env; default **`0.85`**; compare with **`>=`**. Parse: finite number; clamp to **`[0, 1]`**; empty/NaN/non-finite → default.
- **Lookback embed text:** `` `${title} ${tags.join(" ")}` `` (trim; collapse only as needed for empty tags → title alone).
- **Candidate suppress embed text:** same shape from the candidate’s `title` + `tags` (available on `ScoredArticle` at selection time).
- **MMR embed text:** unchanged — `buildEmbedText` (`title` + content snippet) for survivors only.
- **Best match:** for each dropped candidate, the lookback topic with the **highest** cosine; ties → first in feature 02’s flattened `topics` order (most recent issue first).

### Threshold API (feature 05 will document)

In `shared/src/pipeline/config.ts` (alongside other env knobs):

```ts
export const DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD = 0.85;
export const CROSS_RUN_SIMILARITY_THRESHOLD_ENV = "CROSS_RUN_SIMILARITY_THRESHOLD";

export function parseCrossRunSimilarityThreshold(
  value: string | number | undefined | null,
): number; // finite → clamp [0,1]; else DEFAULT

export function getCrossRunSimilarityThreshold(): number; // reads process.env[ENV]
```

Feature 05 adds `.env` / operator docs; this feature must already read the env key so changing it affects the next run without a code change.

### Suppress module

Create `shared/src/pipeline/cross-run-suppress.ts` (pipeline-owned algorithm; reusable, injectable `LLMClient`):

```ts
export function buildTopicEmbedText(input: { title: string; tags: string[] }): string;

export type SuppressItem = {
  title: string;
  link: string;
  matchedRunId: string;
  matchedTitle: string;
  similarity: number;
};

export type SuppressSummary = {
  /** Always `items.length` — feature 04 displays this count. */
  count: number;
  items: SuppressItem[];
};

export type SuppressResult = {
  remaining: ScoredArticle[];
  summary: SuppressSummary;
};

/**
 * Hard-drop candidates whose max cosine to any lookback topic is >= threshold.
 * Empty lookbackTopics → no-op (remaining = candidates, empty summary).
 * Embed failures → no-op suppress (remaining = candidates, empty summary) + log.
 */
export async function suppressCrossRunTopics(
  candidates: ScoredArticle[],
  lookbackTopics: LookbackTopic[], // from feature 02
  options?: {
    client?: LLMClient;
    threshold?: number; // default getCrossRunSimilarityThreshold()
  },
): Promise<SuppressResult>;
```

Export from the pipeline barrel (`shared/src/pipeline/index.ts`) as needed by runs code.

**Embed batching:** one embeddings call for lookback texts, one for candidate title+tags texts (or a single combined batch if simpler — preserve index mapping). Reuse `getModelName("embedder")` and the same finiteness checks spirit as MMR (reject non-finite vectors → degrade to no-op suppress, do not throw into `executeRun` uncaught).

### `suppressSummary` persistence

Append to `runs` collection in `shared/src/schema/declarations.ts`:

```ts
{ key: "suppressSummary", type: "string", size: 100000, required: false }
```

Create-if-absent only (existing provisioner contract).

- `Run` type + `documentToRun`: include `suppressSummary: string` (default `""` when missing).
- Create helper module `shared/src/runs/suppress-summary.ts` (mirror `failed-feeds.ts`):

  - `serializeSuppressSummary(summary: SuppressSummary): string` — `count === 0` → `""` (or `"{\"count\":0,\"items\":[]}"` — **prefer `""` for empty** so UI treats blank like failedFeeds).
  - `parseSuppressSummary(raw: string): SuppressSummary` — empty/invalid → `{ count: 0, items: [] }`.

- Add `saveSuppressSummary(client, runId, summary)` (or update-document helper) that writes the JSON string to the run document.

**When to write:** at the end of the selection-phase suppress step in `executeRun`, **before** calling `selectDiverse`, and also when suppress emptied the pool (write, then `markFailed`). Resume into selection must re-run suppress (lookback is live history, not checkpointed). Do **not** require a new checkpoint file for suppress — the run document field is enough for feature 04.

### `executeRun` wiring

In `shared/src/runs/execute-run.ts`, selection phase (`startIdx <= 4`):

1. From `buildPipelineConfigForNewsletter` result, read `newsletter.lookback` (feature 01; coerce already on read).
2. `loadLookbackTopics(client, { newsletterId: run.newsletterId, lookback: newsletter.lookback })`.
3. `suppressCrossRunTopics(scoredArticles, lookback.topics, { threshold: getCrossRunSimilarityThreshold() })`.
4. `saveSuppressSummary(client, runId, result.summary)`.
5. If `result.remaining.length === 0` **and** `result.summary.count > 0`: `markFailed` selection (“No articles selected”) and return (suppress was the emptier). If remaining empty for other reasons, existing empty-selection handling after MMR still applies.
6. Else `selector(result.remaining, config.newsItems)` — existing MMR path unchanged.
7. Empty MMR result → existing fail path (suppressSummary already saved).

**Do not** change headless `runPipeline` / orchestrator unless tests require a pass-through — cross-run suppress is Appwrite-history-aware and lives on the run executor.

**Do not** add lookback to `NewsletterConfig` unless it simplifies typing; reading `newsletter.lookback` from the build result is enough.

### Out of scope

- Run-summary / GUI display of suppressions (feature 04).
- `.env.example` / README documentation of the threshold key (feature 05) — reading the env in code is in scope; polished docs are not.
- LLM-as-judge, soft penalty mode, cross-newsletter suppress.
- Changing MMR `buildEmbedText`, lambda, or score threshold behavior.
- Raising Stage 04 retention protected floor.
- Stage 06 full inspect UI.

## Dependencies

- Builds on: **feature-01-lookback-config** (`newsletter.lookback`, bounds, read coerce).
- Builds on: **feature-02-lookback-topic-load** (`loadLookbackTopics`, `LookbackTopic`).
- Builds on: Stage 01 MMR / embeddings (`selectDiverse`, `LLMClient.embeddings`, `cosine`, `getModelName("embedder")`).
- Builds on: Stage 04 `executeRun` selection phase + runs schema/provisioner.
- Soft: feature 04 consumes `suppressSummary`; feature 05 documents the env key.

## Constraints

- **Hard-drop only** before MMR — no score penalty mode.
- **Same-newsletter lookback only** (feature 02 contract).
- **Never fail solely because the selection is short** after suppress — only fail when the remaining pool is empty (or MMR/embed fails as today).
- **Do not** open Storage checkpoints to load prior topics — use feature 02’s run-document `topicSummary` path.
- **Schema-as-code only** for `suppressSummary`; create-if-absent; no drop/rename/migrate.
- **Secrets:** never log API keys or full env dumps; sanitize Appwrite errors like other runs code.
- **Test-first** for parse/threshold/suppress pure logic; `executeRun` wiring covered by unit tests with mocked loader/suppress/selector where practical.

## Acceptance criteria

- [ ] With lookback ≥ 1 and lookback topics present, a candidate whose title+tags embedding cosine to a lookback topic is **≥ 0.85** (default) is hard-dropped before MMR.
- [ ] With lookback `0` or empty lookback topics, selection behavior matches pre-feature MMR (no drops from suppress).
- [ ] After suppress, MMR still targets `newsItems` from remaining candidates; under-target short issue completes when at least one survivor exists (verified by execute-run test — not only by empty-pool failure).
- [ ] Suppress is applied to the full `scoredArticles` set before MMR’s `minScore` filter (no pre-filter to score-passers).
- [ ] Every non-empty `suppressSummary` satisfies `count === items.length`.
- [ ] Zero survivors after suppress → `suppressSummary` persisted, run fails selection (does not draft).
- [ ] Lookback (or suppress-candidate) embed failure → log + no-op suppress; run continues to MMR.
- [ ] `suppressSummary` on the run document records `count` and each item’s `title`, `link`, `matchedRunId`, `matchedTitle`, `similarity`.
- [ ] Threshold reads `CROSS_RUN_SIMILARITY_THRESHOLD` with default `0.85` and clamp `[0, 1]`.
- [ ] Suppress embed text is title+tags both sides; MMR survivors still use existing title+body embed.
- [ ] No run-summary UI changes; no `.env` doc file required in this feature.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass.

## Files

- Create: `shared/src/pipeline/cross-run-suppress.ts`
- Create: `shared/src/pipeline/__tests__/cross-run-suppress.test.ts`
- Create: `shared/src/runs/suppress-summary.ts`
- Create: `shared/src/runs/__tests__/suppress-summary.test.ts`
- Modify: `shared/src/pipeline/config.ts` (threshold default + parse + getter)
- Modify: `shared/src/pipeline/__tests__/config.test.ts`
- Modify: `shared/src/pipeline/index.ts` (exports)
- Modify: `shared/src/schema/declarations.ts` (`suppressSummary` attribute)
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/runs/types.ts` (`Run.suppressSummary`)
- Modify: `shared/src/runs/repository.ts` (`documentToRun` + save helper, or dedicated write)
- Modify: `shared/src/runs/execute-run.ts` (selection-phase wiring)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` (suppress wiring cases)
- Modify: `shared/src/runs/index.ts` (re-export parse helpers if needed by web later)
- Modify: `product_spec.md` (one-line Implemented features entry at handoff)

## Testing approach

**Test-first** for threshold parse, embed-text helper, suppress compare logic (mock embeddings), and suppressSummary serialize/parse. `executeRun` tests mock `loadLookbackTopics` / suppress / selector as needed.

### `config.test.ts`

- `parseCrossRunSimilarityThreshold`: `undefined` / `""` / `NaN` → `0.85`; `0.9` → `0.9`; `1.5` → `1`; `-0.1` → `0`; `"0.85"` → `0.85`.

### `cross-run-suppress.test.ts`

- `buildTopicEmbedText`: title + tags joined; empty tags → title (no trailing junk beyond a single space trim).
- Empty lookback → remaining unchanged, `count === 0`; **no** embeddings call.
- Similarity ≥ threshold → candidate dropped; item has matched run/title/similarity; assert `summary.count === summary.items.length`.
- Similarity just below threshold → kept.
- Tie on similarity → first flattened lookback topic wins.
- Embeddings throw → no-op suppress, remaining unchanged, `count === 0`.

### `suppress-summary.test.ts`

- Round-trip serialize/parse; empty → `""` → parse `{ count: 0, items: [] }`; invalid JSON → empty summary.
- After round-trip of a non-empty summary, `count === items.length`.

### `execute-run.test.ts`

- Lookback topics cause suppress before selector; selector receives remaining only (full scored set was the suppress input — not pre-filtered by `minScore`).
- Suppress empties pool → failed selection; `suppressSummary` written.
- **Short survivors:** suppress leaves `0 < remaining.length < newsItems` → selector is called with that remainder → selection **completes** (checkpoint saved; **not** `markFailed` solely for under-target).
- `lookback === 0` → selector sees full scored set (modulo existing behavior).

### Not required

- Playwright / PM GUI gate (no UI in this feature).
- Live OpenRouter calls in unit tests.

## Tasks

### Task 1: Failing tests for threshold, suppress, and suppressSummary

- **Action:** Add failing tests in `shared/src/pipeline/__tests__/config.test.ts`, create `shared/src/pipeline/__tests__/cross-run-suppress.test.ts` and `shared/src/runs/__tests__/suppress-summary.test.ts` covering Testing approach cases. Import symbols that do not exist yet so tests fail on missing exports/behavior.
- **Expected result:** Targeted `pnpm --filter @newsletter/shared test` for those files exits non-zero due to missing implementation (not harness misconfig).
- **Verify:** Run those test paths; failures cite missing modules/exports or unmet assertions.
- **Depends on:** none (assumes feature 01–02 APIs exist or are stub-imported from their specified modules — if feature 02 file is absent in the tree, implement against the feature 02 API contract and unblock via feature order in `ssc-execute`).

### Task 2: Threshold helpers + suppress module + suppressSummary helpers

- **Action:** Implement `parseCrossRunSimilarityThreshold` / `getCrossRunSimilarityThreshold` / `DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD` in `shared/src/pipeline/config.ts`. Implement `shared/src/pipeline/cross-run-suppress.ts` per Spec (injectable client, degrade-on-embed-failure). Implement `shared/src/runs/suppress-summary.ts` serialize/parse. Export from pipeline/runs barrels as appropriate.
- **Expected result:** Unit tests for config, cross-run-suppress, and suppress-summary green.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/pipeline/cross-run-suppress src/pipeline/__tests__/config src/runs/suppress-summary` green; `pnpm --filter @newsletter/shared exec tsc --noEmit` zero errors.
- **Depends on:** Task 1.

### Task 3: Schema attribute + Run type + save + executeRun wiring

- **Action:** Add `suppressSummary` to runs attributes + declaration tests. Extend `Run` / `documentToRun`. Add save helper on the run repository (or small runs helper using Databases update). Wire selection phase in `shared/src/runs/execute-run.ts`: load lookback → suppress on **full** `scoredArticles` (no minScore pre-filter) → save summary → MMR on remaining / fail if empty after suppress. Extend `execute-run.test.ts` for **all** wiring cases in Testing approach, including the **short-survivors completes** case.
- **Expected result:** execute-run tests green (including short-survivor completion); provisioner/declaration tests include the new attribute; selection path uses suppress.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/runs src/schema src/pipeline/cross-run-suppress` green; typecheck clean.
- **Depends on:** Task 2; **feature-01 and feature-02 implemented** (lookback field + `loadLookbackTopics`).

### Task 4: Regression + product_spec note

- **Action:** Run full `pnpm test`, `pnpm typecheck`, `pnpm lint`; fix fallout. Update `product_spec.md` Implemented features with one line for Stage 05 feature 03 pre-MMR semantic suppress. Diff-check: no run-summary UI; no MMR embed-text change; no retention floor change.
- **Expected result:** Full suite green; product_spec updated.
- **Verify:** `pnpm test && pnpm typecheck && pnpm lint` — all zero.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test -- src/pipeline/cross-run-suppress src/runs/suppress-summary src/runs/execute-run src/schema && pnpm test && pnpm typecheck && pnpm lint`
- Expected: Suppress drops ≥-threshold title+tags matches before MMR on the full scored set; short-survivor under-target completes; no-op on empty/0 lookback and embed degrade; `suppressSummary` persisted with `count === items.length`; empty-after-suppress fails selection; threshold env default 0.85. Full suite green. No feature 04 UI / feature 05 docs required.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `shared/src/pipeline/`, `shared/src/runs/`, `shared/src/schema/`, and `product_spec.md`.
- Confirmation of test/typecheck/lint commands and results.
- Confirmation of locked decisions below as implemented (or deviations + why).
- Confirmation that suppress uses title+tags both sides and MMR survivors still use title+body.
- Confirmation that empty-after-suppress fails the run after persisting `suppressSummary`.
- Confirmation that lookback/suppress embed failure degrades to no-op suppress.
- Confirmation that no run-summary UI was added.
- **Research note:** Codegraph on `selectDiverse` / `executeRun` selection / `buildEmbedText` / `cosine` / runs `topicSummary`+`failedFeeds` JSON pattern; feature 01–02 specs for lookback field + `loadLookbackTopics`. Stage decision log (2026-07-13): pre-MMR hard suppress, env threshold, embedding similarity. Grill locked title+tags apples-to-apples for suppress vs MMR title+body for survivors.

## Locked decisions (PM confirmed 2026-07-13, grill)

1. **Empty pool after suppress → fail the run** (terminate selection); short issue OK when some survivors remain.
2. **Default threshold `0.85`**, compare with **`>=`**.
3. **Env key `CROSS_RUN_SIMILARITY_THRESHOLD`** read in this feature (default 0.85, clamp `[0,1]`); feature 05 documents it.
4. **Lookback/suppress embed failure → log + no-op suppress**; continue to MMR.
5. **Feature 03 persists `suppressSummary`; feature 04 displays** — no UI in this feature.
6. **Suppress embed = title + tags both sides**; **MMR = existing title + body** for survivors.
7. **`suppressSummary` JSON** on the run: `{ count, items: [{ title, link, matchedRunId, matchedTitle, similarity }] }`; empty → `""`.
8. **Wire in `executeRun` only** (not headless orchestrator by default).
9. **Hard-drop before MMR**; fill from remainder; no soft-penalty mode.
10. **Suppress input = full `scoredArticles`** before MMR `minScore` filter (Grizzled Senior 2026-07-13).
11. **`summary.count === summary.items.length`** always (Grizzled Senior 2026-07-13).
12. **Short-survivor execute-run test required** — under-target after suppress must complete, not fail (Grizzled Senior 2026-07-13).
