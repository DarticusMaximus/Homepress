# Feature 06: MMR diversity selection

## Intent
The final selection phase of the pipeline: embed the title+content snippet of every score-passing article via the embedding model (legacy default: `gemini-embedding-001` through OpenRouter), then select the top-N using Maximal Marginal Relevance (λ=0.5) so the final set handed to the drafter (feature 07) is both relevant AND topically diverse — not just the N highest-scored. Adds one batched embeddings capability to the shared `LLMClient` (feature 04) and a tiny hand-rolled `vectors.ts` helper; introduces no new npm dependency.

## Spec

### Embeddings capability — additive method on `shared/src/pipeline/llm-client.ts`
Feature 04's `LLMClient` is the one shared OpenRouter client. This feature adds a second endpoint to it, **additively** (feature 04's `chatCompletion` and its tests remain unchanged):

- `client.embeddings({ model, input, timeoutMs? }): Promise<EmbeddingsResult>` — a **single** attempt (no retry at this layer, matching `chatCompletion`). `input` is `string | string[]` (OpenRouter/OpenAI `/embeddings` accepts both). Uses native `fetch` (Node 22) with `AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)` to POST to `${baseUrl}/embeddings` with header `Authorization: Bearer <apiKey>` and a JSON body `{ model, input }`. On non-2xx HTTP, throws `LLMHttpError` (`{ statusCode, body }`); on `AbortError`/`TimeoutError`, throws `LLMTimeoutError`; other rejection → `LLMNetworkError` (the same three error classes feature 04 already exports — no new error types). Reads `response.data[i].embedding` for each element and returns `{ embeddings: number[][], raw }` where `embeddings` is in input order. No `openai` SDK — raw fetch, matching `chatCompletion`.
- New exported types `EmbeddingsOptions` (`{ model: string; input: string | string[]; timeoutMs?: number }`) and `EmbeddingsResult` (`{ embeddings: number[][]; raw: unknown }`).
- **No in-memory cache.** Each candidate is unique per run and embedded exactly once; caching is dead weight until cross-run persistence exists (stage 04). Avoids the legacy's cache-index bookkeeping bug (`embed_store.py:129`) entirely.

### Vector math — `shared/src/pipeline/vectors.ts`
A ~15-line pure-function helper, no dependencies:
- `dot(a: number[], b: number[]): number` — Σ aᵢ·bᵢ. Throws if lengths differ.
- `norm(a: number[]): number` — √Σ aᵢ².
- `cosine(a: number[], b: number[]): number` — `dot(a,b) / (norm(a) * norm(b))`. Returns `0` when either norm is `0` (zero vector → no similarity, never NaN).
- `argMax(values: number[]): number` — index of the maximum; ties resolve to the **lowest** index (deterministic, matches `np.argmax` on first occurrence). Throws on empty input.

### MMR selector — `shared/src/pipeline/mmr-selection.ts`
Exports `MMRSelector`, the standalone `selectDiverse` helper, `buildEmbedText`, `DEFAULT_LAMBDA`, `EMBED_SNIPPET_LENGTH`, and `EMBED_MAX_CONTENT_LENGTH`.

- `MMRSelector` — `new MMRSelector({ client?, lambda?, minScore? }?)`. `client` defaults to `new LLMClient()` (inject a mock in tests). `lambda` defaults to `DEFAULT_LAMBDA` (`0.5`, mirrors legacy `select_diverse(lambda_param=0.5)`). `minScore` defaults to `DEFAULT_SCORE_THRESHOLD` (`7.0`, from feature-01 config).
- `selector.selectDiverse(articles: ScoredArticle[], target: number): Promise<SelectionResult>` — the full phase:
  1. **Threshold filter:** `candidates = articles.filter(a => a.score >= minScore)`, sorted by `score` descending (stable). Articles below threshold are recorded as `SelectionFailure` with `reason: 'below-threshold'`.
  2. **Batch embed:** build `buildEmbedText(a)` for each candidate, call `client.embeddings({ model: getModelName('embedder'), input: texts })` **once** for all candidates. If `candidates` is empty, skip the call. On success, zip embeddings back onto candidates. On a thrown error (HTTP/network/timeout, or a shape mismatch like `embeddings.length !== candidates.length`), **every** candidate in the batch is recorded as `reason: 'embedding-failed'` (batch fails atomically — matches the legacy's all-or-none batch failure) and the phase returns `selectedArticles: []`.
  3. **MMR greedy selection** (port legacy `select_diverse:216-254`, with cosine instead of raw dot product):
     - First pick = `candidates[0]` (highest score after the sort). Move to `selected`.
     - While `selected.length < target && candidates.length > 0`: for each remaining candidate compute `maxSim = max(cosine(candidate.embedding, s.embedding) for s in selected)`, then `mmr = (1 - lambda) * candidate.score - lambda * maxSim` (the exact legacy formula). Pick `argMax(mmr)`, move it to `selected`.
  4. Selected articles are returned as `SelectedArticle[]` (a `ScoredArticle` chosen by MMR; `embedding` is filled).
- `buildEmbedText(article: ScoredArticle): string` — returns `${article.title} ${article.content.slice(0, EMBED_SNIPPET_LENGTH)}` then `.slice(0, EMBED_MAX_CONTENT_LENGTH)`. Verbatim port of legacy `select_diverse:186` (`f"{candidate.title} {candidate.content[:1000]}"`) plus the legacy's `EMBED_MAX_CONTENT_LENGTH = 8000` truncation (`embed_store.py:17,48`). The 1000-char snippet + 8000-char cap compose (snippet ≤ 1000 chars ≪ 8000 cap, so the cap is effectively a safety bound — matches legacy).
- `DEFAULT_LAMBDA = 0.5`; `EMBED_SNIPPET_LENGTH = 1000`; `EMBED_MAX_CONTENT_LENGTH = 8000` (module constants).
- Standalone `selectDiverse(articles, target, options?)` helper wraps `new MMRSelector(options).selectDiverse(articles, target)`.

### `SelectionResult` + `SelectionFailure` shape (amend `types.ts`)
Following feature 03/04/05's amendment pattern — pin the exact fields without altering existing types:
```ts
interface SelectionFailure {
  articleTitle: string;
  articleLink: string;
  reason: 'below-threshold' | 'embedding-failed';
  error?: string;        // present when reason === 'embedding-failed' (the LLM/embedding error message)
}
interface SelectionResult {
  selectedArticles: SelectedArticle[];   // chosen by MMR; embedding filled
  failures: SelectionFailure[];          // below-threshold + embedding-failed
  totalArticles: number;                 // scored articles input length
  candidateCount: number;                // passed the threshold filter
  targetCount: number;                   // requested N
  lambda: number;
  minScore: number;
}
```
**Deliberate divergences from legacy (documented in Handoff):**
1. **Cosine instead of raw dot product in the MMR loop.** Legacy `select_diverse:233` used `candidate_matrix @ selected_matrix.T` (raw dot product), silently assuming gemini returns unit-normalized embeddings. This port uses proper `cosine` similarity — textbook-correct MMR that does not depend on the embedding model's normalization. The MMR *algorithm* (λ=0.5, score-desc pre-sort, greedy argmax, the `(1-λ)·score − λ·maxSim` formula) is otherwise ported verbatim. Justified improvement, flagged for the feature-07 parity check.
2. **No in-memory embedding cache.** Legacy cached text→embedding on the `EmbedStore` instance. Each candidate is unique per run and embedded once, so the cache was dead weight (and its index bookkeeping had a bug at `embed_store.py:129`). Dropped; cross-run reuse belongs to stage 04.
3. **Structured `SelectionResult` instead of a bare list.** Legacy `select_diverse` returned `list[ScoredArticle]`, losing the threshold/embedding-failure telemetry. This port returns the structured result so stage 03 run records can report why articles were dropped. Mirrors the tagger/scorer divergence (return structured state, don't raise/lose it).
4. **No halt semantics.** Unlike the tagger/scorer, MMR has no consecutive-error counter — a failed batch fails the phase atomically (every candidate `embedding-failed`), and threshold filtering is not an error. `SelectionResult` has no `halted` field.

## Dependencies
- Builds on: feature-01 `@newsletter/shared` pipeline types (`ScoredArticle`, `SelectedArticle`, `PhaseName`) and config helpers (`getModelName`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_SCORE_THRESHOLD`).
- Builds on: feature-04 `LLMClient` (this feature adds an `embeddings` method to it) and the exported error classes (`LLMHttpError`/`LLMTimeoutError`/`LLMNetworkError`/`LLMConfigError`). `withRetry` is NOT used here — the batch embedding call is a single attempt; a failed batch fails the phase atomically (no per-article retry, matching legacy batch semantics).
- Feature 06 amends `shared/src/pipeline/llm-client.ts` (add `embeddings` + `EmbeddingsOptions`/`EmbeddingsResult`) and `shared/src/pipeline/types.ts` (add `SelectionFailure`, pin `SelectionResult`). Feature 04's `chatCompletion` and its tests must remain green — the amendment is strictly additive.

## Constraints
- TypeScript `strict: true` — no `any` in exported signatures; `raw` fields are typed `unknown`.
- **No new runtime npm dependencies.** Vector math is the hand-rolled `vectors.ts`. Embeddings reuse `LLMClient`'s native fetch. No `openai` SDK, no `mathjs`/`ml-matrix`/`vecto` — the parity check must isolate logic, not library behavior.
- The `embeddings` method is **additive** to `llm-client.ts` — feature 04's `chatCompletion`, the four error classes, `withRetry`, and all existing llm-client tests must remain unchanged and green.
- The MMR formula `(1-λ)·score − λ·maxSim` and the greedy selection order (highest-score first, then argmax MMR) are ported verbatim from legacy `select_diverse:216-254`. Only the similarity function changes (cosine vs raw dot — documented divergence #1).
- `buildEmbedText` is byte-identical to legacy `f"{title} {content[:1000]}"` plus the 8000-char cap.
- λ default `0.5` and `minScore` default `DEFAULT_SCORE_THRESHOLD` (`7.0`) are fixed (not env-overridable here — stage 06 may surface them).
- Batch embedding is one API call for all candidates; a thrown error fails the whole batch atomically (every candidate → `reason: 'embedding-failed'`). No per-article retry, no partial-batch recovery (the legacy behaved identically — one batch, all-or-none).
- No persistence, no Appwrite, no run records — pure compute returning a `SelectionResult`.
- `OPENROUTER_API_KEY` is required at runtime (read by `LLMClient`) and present in the project-root `.env`. Unit tests inject a mock client so they need no real key.
- No real embedding calls in the unit-test suite — `LLMClient.embeddings` is mocked at the client boundary.

## Acceptance criteria
- [ ] `shared/src/pipeline/llm-client.ts` exports `embeddings`, `EmbeddingsOptions`, `EmbeddingsResult` in addition to all feature-04 symbols; feature-04's `chatCompletion` is unchanged and feature-04's llm-client tests still pass.
- [ ] `client.embeddings({ model, input: "text" })` and `client.embeddings({ model, input: ["a","b"] })` both POST to `${baseUrl}/embeddings` with `Authorization: Bearer <key>` and return `{ embeddings: number[][], raw }` in input order, reading `response.data[i].embedding`.
- [ ] `client.embeddings` classifies non-2xx → `LLMHttpError`, `AbortError`/`TimeoutError` → `LLMTimeoutError`, other rejection → `LLMNetworkError` (same as `chatCompletion`).
- [ ] `shared/src/pipeline/vectors.ts` exports `dot`, `norm`, `cosine`, `argMax`; `cosine([1,0],[1,0]) === 1`, `cosine([1,0],[0,1]) === 0`, `cosine` of a zero vector returns `0` (never `NaN`); `argMax([1,3,2]) === 1` and ties resolve to the lowest index.
- [ ] `shared/src/pipeline/mmr-selection.ts` exports `MMRSelector`, `selectDiverse`, `buildEmbedText`, `DEFAULT_LAMBDA`, `EMBED_SNIPPET_LENGTH`, `EMBED_MAX_CONTENT_LENGTH`.
- [ ] `buildEmbedText({ title: "T", content: "x".repeat(5000) })` equals `"T " + "x".repeat(1000)` (snippet then cap; cap is non-operative at this size).
- [ ] Threshold filter: with `minScore: 7`, articles scoring `< 7` are excluded from selection and appear in `failures` with `reason: 'below-threshold'`.
- [ ] First selected article is the highest-scored candidate (after threshold + sort).
- [ ] Selection count: `target: 3` with a pool of 5 embeddable candidates selects exactly 3; `target: 5` with a pool of 3 selects exactly 3 (never more than the pool).
- [ ] Diversity (deterministic fixture): given 4 candidates where the top-3 by score have near-identical embeddings and a 4th has a distinct embedding, MMR with `λ: 0.5` selects a set that is observably more diverse than naive top-N-by-score — asserted as lower average pairwise cosine among the selected set, OR a different member chosen, on the same inputs.
- [ ] `λ: 0` collapses to pure relevance: the MMR selection equals the top-N-by-score selection (same set, same order).
- [ ] Batch embedding failure: when the mock `embeddings` throws (or returns a malformed payload like wrong count), every candidate is recorded in `failures` with `reason: 'embedding-failed'` and `selectedArticles` is empty.
- [ ] Empty input: `selectDiverse([], 3)` returns `{ selectedArticles: [], failures: [], totalArticles: 0, candidateCount: 0, targetCount: 3, lambda, minScore }` and does NOT call `client.embeddings`.
- [ ] All-below-threshold input: `selectDiverse` returns `selectedArticles: []`, all articles in `failures` with `reason: 'below-threshold'`, and does NOT call `client.embeddings`.
- [ ] `SelectionResult.totalArticles === input.length`; `selectedArticles.length + failures.length === totalArticles`.
- [ ] `pnpm --filter @newsletter/shared test` passes — all vectors, llm-client (amended), and mmr-selection tests green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker`.
- [ ] No new dependency entry appears in `shared/package.json`.

## Files
- Create: `shared/src/pipeline/vectors.ts`
- Create: `shared/src/pipeline/mmr-selection.ts`
- Create: `shared/src/pipeline/__tests__/vectors.test.ts`
- Create: `shared/src/pipeline/__tests__/mmr-selection.test.ts`
- Modify: `shared/src/pipeline/llm-client.ts` (add `embeddings` method + `EmbeddingsOptions`/`EmbeddingsResult`; do not change `chatCompletion`, `withRetry`, or the error classes)
- Modify: `shared/src/pipeline/types.ts` (add `SelectionFailure`; pin `SelectionResult` fields above if not already present; do not change existing types)
- Modify: `shared/src/pipeline/index.ts` (re-export `./vectors` and `./mmr-selection`)
- Modify: `worker/src/index.ts` (add a referenced import of `MMRSelector` from `@newsletter/shared` — compile-time only, do not instantiate)

## Testing approach
Test-first. MMR/vector tests inject a mock `LLMClient` (no real network/embedding). The amended `embeddings` method gets its own llm-client tests (mocking `globalThis.fetch`). Every behavioral assertion is a failing test before implementation.

`shared/src/pipeline/__tests__/vectors.test.ts`:
- **dot:** `dot([1,2,3],[4,5,6]) === 32`; throws on length mismatch.
- **norm:** `norm([3,4]) === 5`; `norm([0,0]) === 0`.
- **cosine:** `cosine([1,0],[1,0]) === 1`; `cosine([1,0],[0,1]) === 0` (orthogonal); `cosine([1,0],[-1,0]) === -1`; `cosine([0,0],[1,0]) === 0` (zero-vector guard, never NaN).
- **argMax:** `argMax([1,3,2]) === 1`; `argMax([5,5,3]) === 0` (lowest-index tie); throws on empty.

`shared/src/pipeline/__tests__/mmr-selection.test.ts` (mock client exposes `embeddings`):
- **buildEmbedText parity:** content longer than `EMBED_SNIPPET_LENGTH` is sliced to 1000 chars; title + space + snippet; total capped at `EMBED_MAX_CONTENT_LENGTH`.
- **Threshold filter:** 5 articles, scores `[8, 7.5, 6, 9, 5]`, `minScore: 7` → candidates `[9, 8, 7.5]` (sorted desc); the two below-threshold appear in `failures` with `reason: 'below-threshold'`.
- **First-pick = highest score:** the first `selectedArticles[0]` is the candidate with the max score.
- **Count ≤ target and ≤ pool:** `target: 3`, pool 5 → 3 selected; `target: 5`, pool 3 → 3 selected.
- **λ=0 is pure relevance:** with `lambda: 0`, the selected set equals the top-N-by-score set (assert same titles in score order).
- **λ=0.5 is diverse (deterministic):** fixture of 4 candidates — top-3 by score share near-identical embeddings (cosine ≈ 1 pairwise), 4th (lower score) has an orthogonal embedding. `target: 3, lambda: 0.5` selects a set with lower average pairwise cosine than the naive top-3-by-score (assert the diverse member is included OR the avg pairwise cosine is strictly lower). Use controlled mock embeddings (e.g. unit vectors along axes) so the assertion is exact.
- **Batch embedding called once:** with N candidates, `mock.embeddings` is called exactly once with `input` an array of length N (assert the texts equal `buildEmbedText(candidate)` for each, in candidate order).
- **Batch embedding failure (throw):** mock `embeddings` rejects → every candidate is in `failures` with `reason: 'embedding-failed'` and a populated `error`; `selectedArticles: []`.
- **Batch embedding failure (shape):** mock returns `embeddings` of wrong length → same atomic-failure behavior.
- **No embeddings call when empty/all-filtered:** `selectDiverse([], 3)` → mock not called; all-below-threshold input → mock not called.
- **Shape invariants:** `totalArticles === input.length`; `selectedArticles.length + failures.length === totalArticles`; `candidateCount === (articles with score ≥ minScore).length`; `targetCount === target`; `lambda`/`minScore` echoed.

Edge cases covered: zero-vector cosine, length-mismatch dot, empty input, all-below-threshold, pool-smaller-than-target, batch atomic failure (throw and shape), λ extremes (0 = pure relevance), deterministic diversity at λ=0.5, single-candidate pool (first-pick only, no MMR loop iteration), threshold boundary (`score === minScore` is included — `>=`).

## Tasks

### Task 1: Amend llm-client + types; write failing vectors and mmr tests
- **Action:** Amend `shared/src/pipeline/llm-client.ts`: add the `EmbeddingsOptions`/`EmbeddingsResult` types and a stub `embeddings` method that throws `'not implemented'` (so the module compiles and existing feature-04 tests stay green). Amend `shared/src/pipeline/types.ts`: add `SelectionFailure` and pin `SelectionResult` to the Spec fields (do not alter existing types). Create `shared/src/pipeline/__tests__/vectors.test.ts` and `shared/src/pipeline/__tests__/mmr-selection.test.ts` with every case in the Testing approach, injecting a mock `LLMClient` exposing `embeddings`. Create empty placeholder `shared/src/pipeline/vectors.ts` and `shared/src/pipeline/mmr-selection.ts` exporting nothing so imports resolve at module level but every assertion fails.
- **Expected result:** A test suite that runs and fails on every behavioral assertion; `embeddings` exists on `LLMClient` (stubbed); `SelectionFailure`/`SelectionResult` are typed and exported; feature-04's llm-client tests still pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — vectors + mmr tests exit non-zero with assertion failures (not module-resolution errors); the existing feature-04 llm-client tests still pass. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors. Confirm `SelectionFailure` + pinned `SelectionResult` are exported from `types.ts` and existing types are unchanged.
- **Depends on:** feature-01 (types + config helpers) and feature-04 (`LLMClient` + error classes exist).

### Task 2: Implement `vectors.ts`
- **Action:** Implement `shared/src/pipeline/vectors.ts`: `dot` (Σ aᵢ·bᵢ, length-mismatch throws), `norm` (√Σ aᵢ²), `cosine` (dot / (norm·a · norm·b), zero-guarded to return `0`), `argMax` (lowest-index tie, throws on empty).
- **Expected result:** All vectors tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- __tests__/vectors.test.ts` — all green (dot, norm, cosine identity/orthogonal/opposite/zero-vector, argMax incl. tie). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Implement the `embeddings` method and `mmr-selection.ts`
- **Action:** Implement the `embeddings` method on `LLMClient` (native-fetch POST to `${baseUrl}/embeddings`, bearer auth, `AbortSignal.timeout`, `input: string | string[]`, read `response.data[i].embedding` → `{ embeddings: number[][], raw }`, same HTTP/timeout/network error classification as `chatCompletion`). Implement `shared/src/pipeline/mmr-selection.ts`: `buildEmbedText`, `DEFAULT_LAMBDA` (0.5), `EMBED_SNIPPET_LENGTH` (1000), `EMBED_MAX_CONTENT_LENGTH` (8000), `MMRSelector` (constructor `{ client?, lambda?, minScore? }`; `selectDiverse` doing threshold filter → stable sort desc → single batched `embeddings` call → drop/record failures → greedy MMR with cosine → return `SelectionResult`), and standalone `selectDiverse(articles, target, options?)`. Use `cosine`/`argMax` from `./vectors`.
- **Expected result:** All mmr-selection tests pass, and the amended llm-client embeddings tests pass (if added as part of this task or task 1).
- **Verify:** Run `pnpm --filter @newsletter/shared test` — vectors, llm-client (incl. embeddings), and mmr-selection all green (threshold filter, first-pick, count ≤ target/pool, λ=0 pure relevance, λ=0.5 diversity, batch-once, batch atomic failure throw + shape, no-call-when-empty/all-filtered, shape invariants). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 2.

### Task 4: Wire exports and cross-package smoke
- **Action:** Modify `shared/src/pipeline/index.ts` to re-export `./vectors` and `./mmr-selection`. Add a referenced import of `MMRSelector` in `worker/src/index.ts` (compile-time only; do not instantiate — no network/key needed for a typecheck).
- **Expected result:** Both modules are reachable as `@newsletter/shared`, and `worker` consumes `MMRSelector`.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — still all green. Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports from `@newsletter/shared` and compiles.
- **Depends on:** Task 3.

## Feature verification
- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves cleanly (no new deps); the Vitest suite passes — `LLMClient.embeddings` issues a correctly-shaped bearer-auth POST to `/embeddings` and classifies HTTP/timeout/network errors (feature-04 `chatCompletion` behavior unchanged and its tests green); `vectors.ts` (dot/norm/cosine/argMax) is correct including zero-vector and tie handling; the MMR selector filters by threshold, batch-embeds all candidates in one call, drops/recording failures atomically on batch error, and selects via greedy MMR using **cosine** similarity with the verbatim `(1-λ)·score − λ·maxSim` formula and λ=0.5 default — observably more diverse than naive top-N at λ=0.5 and identical to top-N at λ=0; `tsc --noEmit` passes with zero errors across `shared` and `worker`; `worker/src/index.ts` imports `MMRSelector`. No new dependency appears in `shared/package.json` (reuses feature-04 `LLMClient`; hand-rolled `vectors.ts`).

## Handoff
When complete, the builder reports to the manager:
- The list of files created/modified (`vectors.ts`, `mmr-selection.ts`, two test files, `llm-client.ts` additive amendment, `types.ts` amendment, `index.ts`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass, AND that feature-04's pre-existing llm-client tests still pass (the `embeddings` amendment was strictly additive).
- The exact exported symbol names from `mmr-selection.ts` (`MMRSelector`, `selectDiverse`, `buildEmbedText`, `DEFAULT_LAMBDA`, `EMBED_SNIPPET_LENGTH`, `EMBED_MAX_CONTENT_LENGTH`) and from `vectors.ts` (`dot`, `norm`, `cosine`, `argMax`) so feature 07 (orchestrator) imports them consistently.
- The exact `SelectionResult` shape (`selectedArticles`, `failures`, `totalArticles`, `candidateCount`, `targetCount`, `lambda`, `minScore`) and `SelectionFailure` shape (`articleTitle`, `articleLink`, `reason: 'below-threshold' | 'embedding-failed'`, `error?`) so feature 07 (orchestrator treats a zero-selection result as a fatal phase condition) and stage 03 (run records persist failures) consume them without renegotiating.
- The exact `LLMClient.embeddings` signature (`{ model, input: string | string[], timeoutMs? }` → `{ embeddings: number[][], raw }`) so feature 07 and stage 04 (cross-run embedding reuse) import it consistently.
- The documented divergences from legacy: (1) **cosine instead of raw dot product** in the MMR loop — justified, textbook-correct MMR independent of embedding normalization; flag for the feature-07 parity check (selection sets may differ slightly from the legacy Python run, which is expected and acceptable since the parity check is operator-judged on relevance/diversity/readability, not identical selection). (2) **No in-memory cache** — dead weight without cross-run persistence; stage 04 should add a persistent embedding store if reuse becomes valuable. (3) **Structured `SelectionResult`** instead of a bare list. (4) **No halt semantics** (batch failure is atomic).
- Confirmation that `buildEmbedText` is byte-identical to legacy `f"{title} {content[:1000]}"` + the 8000-char cap.
- **Flag:** `OPENROUTER_API_KEY` is present in `.env`; required for any real embedding call (feature 07 parity run, against `EMBED_MODEL`/`google/gemini-embedding-001`). Unit tests pass without reading it (mock client injected).
- **Flag:** the feature-07 parity run will exercise a real gemini-embedding-001 batch — confirm OpenRouter returns embeddings for an array input and that the dimensionality is consistent across the batch; if OpenRouter rejects batched input, fall back to per-article calls (document the deviation).
- Any deviation from this spec and the reason (e.g. an OpenRouter `/embeddings` response-shape quirk where `data` is unordered and must be sorted by `index`, or a gemini dimensionality that differs from the legacy run).
