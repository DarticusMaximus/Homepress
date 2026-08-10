# Feature 05: Scorer

## Intent
The second LLM-calling phase of the pipeline: for every tagged article, call the scorer LLM (legacy default: nemotron) to produce a 0–10 relevance score against the newsletter's topics and disliked topics, parse + clamp the numeric response, with the same retry/backoff and consecutive-error-halt contract as the tagger — so the MMR phase (feature 06) and drafter (feature 07) receive a clean set of numerically-scored, relevance-ranked articles. Reuses the shared `LLMClient` and `withRetry` built in feature 04 unchanged; adds no new LLM infrastructure.

## Spec

### Scorer — `shared/src/pipeline/scorer.ts`
Exports `ArticleScorer`, the standalone `scoreArticles` helper, the verbatim `SCORER_PROMPT_TEMPLATE` function, and `CONSECUTIVE_ERROR_THRESHOLD` (`3`). The scorer prompt is **ported verbatim** from legacy `scorer.py:84-95` (see Files / Testing approach) — parity depends on it.

- `ArticleScorer` — `new ArticleScorer({ client?, maxContentLength? }?)`. `client` defaults to `new LLMClient()` (inject a mock in tests). `maxContentLength` defaults to `DEFAULT_MAX_CONTENT_LENGTH` (70000). Carries an internal `consecutiveErrors = 0` counter (per-instance, reset on every success — matches legacy and the tagger).
- `scorer.scoreArticles(articles: TaggedArticle[], topics: string[], dislikedTopics: string[]): ScoreResult` — processes articles **sequentially** (order matters: the consecutive-error counter is order-dependent, matching legacy and the tagger). For each article:
  1. `const score = await this.calculateScore(article.title, article.content, article.tags, topics, dislikedTopics)`, wrapped so a failure (all retries exhausted, OR a parse failure — see below) is caught.
  2. On success: push `ScoredArticle` (`{ ...article, score }`), reset `consecutiveErrors = 0`.
  3. On failure: record a `ScoreFailure` (`{ articleTitle, articleLink, error, reason, attempts }`), increment `consecutiveErrors`. The failed article is **NOT** added to `scoredArticles` (it cannot participate in MMR without a numeric score). If `consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD` (3), **halt**: set `halted = true`, `haltReason`, stop processing remaining articles, return the partial `ScoreResult`.
- `scorer.calculateScore(title, content, tags, topics, dislikedTopics): Promise<number>` — formats `SCORER_PROMPT_TEMPLATE({ title, truncatedContent, tags, topics, dislikedTopics })` (content truncated to `maxContentLength`), calls `withRetry(() => client.chatCompletion({ model: getModelName('scorer'), messages: [{ role:'user', content: prompt }], timeoutMs: DEFAULT_TIMEOUT_MS }))`, then parses the returned `content`: `const n = Number(content.trim())`; if `Number.isNaN(n)` → throw a `ScoreParseError` carrying `{ raw }` (this is caught by `scoreArticles`'s failure path and recorded as a per-article failure with `reason: 'parse'`). Otherwise return `Math.max(0, Math.min(10, n))` (clamp to `[0, 10]` — exact legacy clamp `max(0.0, min(10.0, score))`).
- `CONSECUTIVE_ERROR_THRESHOLD = 3` (module constant, mirrors legacy `scorer.py:18`).
- Standalone `scoreArticles(articles, topics, dislikedTopics, options?)` helper wraps `new ArticleScorer(options).scoreArticles(...)`.

### Prompt construction — byte-identical port of legacy `scorer.py:84-95`
The legacy builds the prompt as:
```
Positive Topics: {topics_str}

Negative Topics: {disliked_str}

Newsletter focus: {topics_str}

---
Article Tags: {tags_str}
Article Title: {title}

Analyze alignment with preferences. Score 0-10 (10 = best alignment).
Return ONLY the number.
```
where `topics_str = ", ".join(topics)`, `disliked_str = ", ".join(disliked_topics) if disliked_topics else "None"`, `tags_str = ", ".join(tags) if tags else "None"`. The TS `SCORER_PROMPT_TEMPLATE` is a function producing this exact string (modulo the content-truncation addition, which the legacy applied upstream — here truncation is applied to `content` before formatting, but the prompt body above is byte-identical). **Note:** the legacy prompt does not embed the article content body at all — only title, tags, topics, disliked topics. The TS port preserves this exactly; `content`/`maxContentLength` are accepted by `calculateScore` for signature symmetry with the tagger and future use, but the prompt body itself omits content (matching legacy). The `maxContentLength` truncation is therefore a no-op in this feature but keeps the signature forward-compatible.

### `ScoreResult` + `ScoreFailure` shape (amend `types.ts`)
Following feature 03/04's amendment pattern — pin the exact fields the scorer needs without altering existing types:
```ts
interface ScoreFailure {
  articleTitle: string;
  articleLink: string;
  error: string;        // error message (exception or parse-failure diagnostic)
  reason: 'exception' | 'parse';  // exception = retry-exhausted LLM error; parse = non-numeric response
  attempts: number;     // withRetry attempts (exception) or 1 (parse — no retry on parse)
}
interface ScoreResult {
  scoredArticles: ScoredArticle[];  // only successfully-scored articles (clean numeric scores for MMR)
  failures: ScoreFailure[];         // per-article errors (exception and parse)
  halted: boolean;                  // consecutive-error threshold reached
  haltReason: string | null;
  consecutiveErrors: number;        // final count
  totalArticles: number;            // input length
}
```
**Deliberate divergences from legacy (documented):**
1. The legacy scorer *raised* `ScoringError` on halt, losing the partial result. This TS port returns a structured `ScoreResult` with `halted: true` instead of throwing — same "fail loudly, not silently" contract (the orchestrator treats `halted === true` as a fatal phase failure), but the partial state is preserved and testable, and it feeds stage 03's resume-from-last-phase. Mirrors the tagger's divergence.
2. The legacy scorer **skipped** failed articles entirely (they never reached MMR). This port preserves that skip semantics (failed articles are in `failures`, NOT in `scoredArticles`) — MMR needs numeric scores and cannot consume a sentinel. Unlike the tagger (which retained failed articles with `tags: []` because empty tags are harmless downstream), a non-numeric score has no clean sentinel, so failed articles are excluded from `scoredArticles` by design.
3. **Parse failures count toward `consecutiveErrors`.** The legacy treated a non-numeric response as benign (`_calculate_score` returned `None`, no exception, `consecutive_errors` untouched, article kept with `score: None`). This is arguably the latent silent-degradation bug the consecutive-error halt was built to catch — a scorer returning garbage IS the failure mode the halt exists to surface. This port treats a non-numeric response as a per-article failure (`reason: 'parse'`) that increments `consecutiveErrors`. This strengthens the loud-failure contract; the parity check (feature 07) will surface whether nemotron's parse-failure rate is high enough to matter in practice.

## Dependencies
- Builds on: feature-01 `@newsletter/shared` pipeline types (`TaggedArticle`, `ScoredArticle`, `PhaseName`) and config helpers (`getModelName`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_CONTENT_LENGTH`).
- Builds on: feature-04 shared LLM infrastructure (`LLMClient`, `withRetry`, `LLMConfigError`/`LLMHttpError`/`LLMTimeoutError`/`LLMNetworkError` from `./llm-client`). The scorer imports these unchanged — feature 04 built the seam, this feature consumes it.
- Feature 05 amends `shared/src/pipeline/types.ts` to add `ScoreFailure` and pin `ScoreResult`'s fields (feature 03/04 established the amendment pattern; existing types must not change).

## Constraints
- TypeScript `strict: true` — no `any` in exported signatures.
- **No new runtime npm dependencies.** Reuses `LLMClient` + `withRetry` from feature 04 (native fetch, no `openai` SDK, no retry library).
- The scorer prompt body (`SCORER_PROMPT_TEMPLATE`) is **byte-identical** to legacy `scorer.py:84-95` — parity depends on it. (Content-truncation is a no-op here since the prompt omits the body, but the signature accepts `maxContentLength` for forward compatibility.)
- `CONSECUTIVE_ERROR_THRESHOLD = 3` is fixed (not env-overridable here — stage 06 may surface it).
- The scorer MUST process articles sequentially (the consecutive-error counter is order-dependent). Do not parallelize.
- Score clamping is `Math.max(0, Math.min(10, n))` — exact legacy `max(0.0, min(10.0, score))`.
- A parse failure (non-numeric response) does NOT retry — it is caught once and recorded as `reason: 'parse'` with `attempts: 1`. Only LLM-call exceptions (HTTP/network/timeout) go through `withRetry`. (Mirrors legacy: tenacity retried exceptions, not the `ValueError` that was internally caught.)
- No persistence, no Appwrite, no run records — pure compute returning a `ScoreResult`.
- `OPENROUTER_API_KEY` is required at runtime (read by `LLMClient`) and is present in the project-root `.env`. Unit tests inject a mock client so they need no real key.
- No real LLM calls in the unit-test suite — `LLMClient` is mocked at the client boundary (`globalThis.fetch` is exercised only by feature 04's llm-client tests, not here).

## Acceptance criteria
- [ ] `shared/src/pipeline/scorer.ts` exports `ArticleScorer`, `scoreArticles`, `SCORER_PROMPT_TEMPLATE`, `CONSECUTIVE_ERROR_THRESHOLD`.
- [ ] `SCORER_PROMPT_TEMPLATE(...)` produces a string byte-identical to the legacy `scorer.py:84-95` output for the same inputs (asserted by a test comparing against the literal legacy string for a sample input).
- [ ] Given a mock client returning `"8.5"`, `scoreArticles` produces a `ScoredArticle` with `score: 8.5`; the prompt sent to the client contains the article title, the joined tags, the joined topics, and the joined disliked topics.
- [ ] Score parsing mirrors legacy: `Number(content.trim())` then clamp `[0, 10]`; `"15.0"` → 10, `"-5.0"` → 0, `"8.5"` → 8.5.
- [ ] A non-numeric response (`"Not a number"`) is recorded as a `ScoreFailure` with `reason: 'parse'`, `attempts: 1`; the article is NOT in `scoredArticles`; the mock client was called exactly once for that article (no retry on parse).
- [ ] A successful score resets `consecutiveErrors` to 0 (an article failing after a success does not inherit a stale count).
- [ ] 3 consecutive article failures (exception OR parse) set `ScoreResult.halted === true`, populate `haltReason`, and **stop processing** — a 4th article in the input is not scored (not present in `scoredArticles`, recorded nowhere as a success).
- [ ] On a per-article exception failure (retries exhausted), the article appears in `failures` with `reason: 'exception'` and `attempts` reflecting `withRetry`'s attempts — NOT in `scoredArticles`.
- [ ] `ScoreResult.totalArticles` equals the input length; `scoredArticles.length + failures.length` equals the number of articles processed before any halt.
- [ ] `pnpm --filter @newsletter/shared test` passes — all scorer unit tests green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker`.
- [ ] No new dependency entry appears in `shared/package.json` (scorer reuses feature-04 infrastructure).

## Files
- Create: `shared/src/pipeline/scorer.ts`
- Create: `shared/src/pipeline/__tests__/scorer.test.ts`
- Modify: `shared/src/pipeline/types.ts` (add `ScoreFailure`; pin `ScoreResult` fields above if not already present; do not change existing types)
- Modify: `shared/src/pipeline/index.ts` (re-export `./scorer`)
- Modify: `worker/src/index.ts` (add a referenced import of `ArticleScorer` from `@newsletter/shared` — compile-time only, do not instantiate)

## Testing approach
Test-first. Scorer tests inject a mock `LLMClient` (no real network/LLM). Every behavioral assertion is a failing test before implementation.

`shared/src/pipeline/__tests__/scorer.test.ts`:
- **Prompt parity:** for a sample input (`topics=["AI","Cloud"]`, `dislikedTopics=["Crypto"]`, `tags=["Kubernetes"]`, `title="K8s 1.30 released"`), assert the prompt string sent to the mock client equals the exact legacy `scorer.py:84-95` output (reproduced in the test as a multiline string). Assert the joined-topics/`None`-when-empty rules: `dislikedTopics=[]` → `"None"`, `tags=[]` → `"None"`.
- **Happy scoring:** mock client returns `"8.5"`; assert `ScoredArticle.score === 8.5` and the article retains its `tags`/`title`/`link`.
- **Clamping:** mock returns `"15.0"` → score `10`; mock returns `"-5.0"` → score `0`; mock returns `"7"` → score `7` (integer string parses).
- **Parse failure:** mock returns `"Not a number"`; assert a `ScoreFailure` with `reason: 'parse'`, `attempts: 1`; assert the article is NOT in `scoredArticles`; assert the mock client was called exactly once for that article (parse does not retry).
- **Consecutive reset:** sequence mock returns [fail (exception), success, fail (parse)] → after the success, `consecutiveErrors` resets; `halted === false`; `failures.length === 2`; `scoredArticles.length === 1`.
- **Halt at 3 (exceptions):** mock client always throws (simulating retry exhaustion — the mock rejects on every call so `withRetry` exhausts); with 5 input articles, `scoreArticles` processes exactly 3 (3 consecutive failures), sets `halted === true`, a non-empty `haltReason`, stops — the 4th and 5th articles are NOT processed (not in `scoredArticles`, not in `failures`). The 3 failed articles each appear in `failures` with `reason: 'exception'`.
- **Halt at 3 (mixed):** mock returns `["garbage", "garbage", "garbage"]` (three parse failures) → halts at 3 with `failures` all `reason: 'parse'`; the 4th+ articles unprocessed.
- **Per-article retry exhaustion counts once:** mock client throws; assert one failed article = one `ScoreFailure` with `attempts` reflecting `withRetry`'s `DEFAULT_MAX_RETRIES` (3 total calls to the mock client for that article).
- **totalArticles / shape:** `ScoreResult.totalArticles === input.length`; when not halted, `scoredArticles.length + failures.length === input.length`; when halted, the sum equals the processed count.
- **Empty input:** `scoreArticles([], ["AI"], [])` → `{ scoredArticles: [], failures: [], halted: false, haltReason: null, consecutiveErrors: 0, totalArticles: 0 }`.

Edge cases covered: parse-failure no-retry, parse-failure-counts-toward-halt, exception-retry-exhaustion, consecutive-error reset on success, halt-at-3 with remaining articles unprocessed (exceptions and mixed), clamping at both bounds, integer-string parse, empty topics/dislikedTopics/tags → `"None"`, empty input, score-not-propagated-to-failed-articles.

## Tasks

### Task 1: Amend types; write failing scorer tests
- **Action:** Amend `shared/src/pipeline/types.ts`: add `ScoreFailure` and pin `ScoreResult` to the fields in the Spec (do not alter existing types — feature 01 introduced `ScoreResult` abstractly, this pins its fields, following feature 03/04's amendment pattern). Create `shared/src/pipeline/__tests__/scorer.test.ts` injecting a mock `LLMClient` with every case in the Testing approach. Create an empty placeholder `shared/src/pipeline/scorer.ts` exporting nothing so imports resolve at module level but every assertion fails.
- **Expected result:** A test suite that runs and fails on every behavioral assertion; `ScoreFailure`/`ScoreResult` are typed and exported.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — exits non-zero with assertion failures (not module-resolution errors). Confirm `ScoreFailure` + pinned `ScoreResult` are exported from `types.ts` and existing types are unchanged.
- **Depends on:** feature-01 (types + config helpers) and feature-04 (`LLMClient` + `withRetry` exist).

### Task 2: Implement the scorer
- **Action:** Implement `shared/src/pipeline/scorer.ts`: export `SCORER_PROMPT_TEMPLATE` (the byte-identical legacy prompt-builder function), `CONSECUTIVE_ERROR_THRESHOLD` (3), `ArticleScorer` (constructor `{ client?, maxContentLength? }`, default `client = new LLMClient()`; sequential `scoreArticles` returning `ScoreResult` with consecutive-error reset/halt logic; `calculateScore` formatting the prompt, calling `withRetry(() => client.chatCompletion(...))`, parsing `Number(content.trim())` with NaN → `ScoreParseError`, clamping `[0,10]`), and standalone `scoreArticles(articles, topics, dislikedTopics, options?)`. Import `LLMClient`, `withRetry` from `./llm-client`; `getModelName`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_CONTENT_LENGTH` from `./config`.
- **Expected result:** All scorer tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- __tests__/scorer.test.ts` — all green (prompt parity, happy scoring, clamping, parse failure no-retry, consecutive reset, halt-at-3 exceptions, halt-at-3 mixed, retry-exhaustion-counts-once, shape, empty input). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Wire exports and cross-package smoke
- **Action:** Modify `shared/src/pipeline/index.ts` to re-export `./scorer`. Add a referenced import of `ArticleScorer` in `worker/src/index.ts` (compile-time only; do not instantiate — no network/key needed for a typecheck).
- **Expected result:** The scorer is reachable as `@newsletter/shared`, and `worker` consumes it.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — still all green. Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports from `@newsletter/shared` and compiles.
- **Depends on:** Task 2.

## Feature verification
- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves cleanly (no new deps); the Vitest suite passes — the scorer ports the verbatim prompt, parses + clamps scores (`Number(trim)` → `[0,10]`), records non-numeric responses as `reason: 'parse'` failures without retry, records retry-exhausted LLM exceptions as `reason: 'exception'` failures, resets `consecutiveErrors` on success, halts at 3 consecutive failures (remaining articles unprocessed), skips failed articles from `scoredArticles` (clean numeric scores for MMR); `tsc --noEmit` passes with zero errors across `shared` and `worker`; `worker/src/index.ts` imports `ArticleScorer`. No new dependency appears in `shared/package.json` (reuses feature-04 `LLMClient`/`withRetry`).

## Handoff
When complete, the builder reports to the manager:
- The list of files created/modified (`scorer.ts`, test file, `types.ts` amendment, `index.ts`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass.
- The exact exported symbol names from `scorer.ts` (`ArticleScorer`, `scoreArticles`, `SCORER_PROMPT_TEMPLATE`, `CONSECUTIVE_ERROR_THRESHOLD`) so feature 06 (MMR) and feature 07 (orchestrator) import them consistently.
- The exact `ScoreResult` shape (`scoredArticles`, `failures`, `halted`, `haltReason`, `consecutiveErrors`, `totalArticles`) and `ScoreFailure` shape (`articleTitle`, `articleLink`, `error`, `reason: 'exception'|'parse'`, `attempts`) so feature 06 (MMR consumes `scoredArticles`), feature 07 (orchestrator treats `halted === true` as fatal), and stage 03 (run records persist both) consume them without renegotiating.
- The documented divergences from legacy: (1) returns `ScoreResult.halted` instead of raising `ScoringError`; (2) failed articles skipped from `scoredArticles` (no clean numeric sentinel) but retained in `failures`; (3) **parse failures increment `consecutiveErrors`** (legacy treated them as benign) — flag whether nemotron's parse-failure rate in the feature-07 parity run is high enough to cause nuisance halts; if so, stage 06 can surface a "parse failures don't count" toggle.
- Confirmation that `SCORER_PROMPT_TEMPLATE` is byte-identical to legacy `scorer.py:84-95`.
- **Flag:** `OPENROUTER_API_KEY` is present in `.env`; required for any real LLM call (feature 07 parity run). Unit tests pass without reading it (mock client injected).
- Any deviation from this spec and the reason (e.g. an OpenRouter response-shape quirk, or a `Number()` parse edge case like `"8.5\n"` from a chatty model needing explicit `.trim()`).
