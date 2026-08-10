# Feature 04: Tagger (+ shared LLM client)

## Intent
The first LLM-calling phase of the pipeline: for every scraped article, call the tagger LLM (legacy default: nemotron) to produce up to 10 broad SEO-style tags, with retry + exponential backoff and a consecutive-error halt (legacy threshold: 3) that fails the phase loudly rather than silently degrading. This feature also establishes the **shared OpenRouter client** (`llm-client.ts`) plus a reusable `withRetry` helper that the scorer (feature 05) and drafter (feature 07) import unchanged — they share the exact same retry/backoff and consecutive-error-halt contract, so it is built once here.

## Spec

### Shared LLM client — `shared/src/pipeline/llm-client.ts`
Exports `LLMClient`, `withRetry`, and the `ChatMessage` / `ChatCompletionOptions` / `ChatCompletionResult` types.

- `LLMClient` — constructed with `new LLMClient({ apiKey?, baseUrl? }?)`. `apiKey` defaults to `process.env.OPENROUTER_API_KEY`; `baseUrl` defaults to `https://openrouter.ai/api/v1`. If `apiKey` is absent/empty, construction throws a typed `LLMConfigError` carrying `{ envVar: 'OPENROUTER_API_KEY' }` (mirrors the legacy `APIError` guard in `tagger.py:25-31`).
- `client.chatCompletion({ model, messages, timeoutMs?, temperature?, extraBody? }): Promise<ChatCompletionResult>` — a **single** attempt (no retry at this layer). Uses native `fetch` (Node 22) with `AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)` to POST to `${baseUrl}/chat/completions` with header `Authorization: Bearer <apiKey>` and a JSON body of `{ model, messages, temperature?, ...extraBody }`. On non-2xx HTTP, throws an `LLMHttpError` carrying `{ statusCode, body }`. On network/`AbortError`, throws `LLMTimeoutError` (`error.name === 'AbortError'`/`'TimeoutError'`) or `LLMNetworkError` otherwise. Reads `response.choices[0].message.content` (defaulting to `""` when null) and returns `{ content, raw }`. No `openai` SDK dependency — OpenRouter is OpenAI-compatible REST; native fetch keeps the dependency surface flat, matching features 02/03.
- `withRetry<T>(fn: () => Promise<T>, opts?: { maxAttempts?: number; maxWaitMs?: number }): Promise<T>` — calls `fn` up to `maxAttempts ?? DEFAULT_MAX_RETRIES` attempts **total** (mirrors tenacity `stop_after_attempt(DEFAULT_MAX_RETRIES)` — 3 attempts total, not 3 retries-on-top). Between attempts, waits `min(1000 * 2 ** k, maxWaitMs ?? 60000)` ms where `k` is the zero-indexed retry number (so 1s, 2s, 4s … capped at 60s — mirrors tenacity `wait_exponential(multiplier=1, max=60)`). If all attempts throw, re-throws the last error. Exported so the tagger, scorer, and drafter share one retry seam.

### Tagger — `shared/src/pipeline/tagger.ts`
Exports `ArticleTagger`, the standalone `tagArticles` helper, the verbatim `TAGGER_PROMPT_TEMPLATE` constant, and `DEFAULT_MAX_TAGS` (`10`). The tag prompt is **ported verbatim** from legacy `tagger.py:66-77` (see Files / Testing approach) — parity depends on it.

- `ArticleTagger` — `new ArticleTagger({ client?, maxTags?, maxContentLength? }?)`. `client` defaults to `new LLMClient()` (inject a mock in tests). `maxTags` defaults to `DEFAULT_MAX_TAGS` (10). `maxContentLength` defaults to `DEFAULT_MAX_CONTENT_LENGTH` (70000). Carries an internal `consecutiveErrors = 0` counter (per-instance, reset on every success — matches legacy).
- `tagger.tagArticles(articles: Article[]): TagResult` — processes articles **sequentially** (order matters: the consecutive-error counter is order-dependent, matching legacy). For each article:
  1. `const tags = await this.generateTags(article.title, article.content)`, wrapped so a failure (all retries exhausted) is caught.
  2. On success: push `TaggedArticle` (`{ ...article, tags }`), reset `consecutiveErrors = 0`.
  3. On failure: push `TaggedArticle` (`{ ...article, tags: [] }`), record a `TagFailure` (`{ articleTitle, articleLink, error, attempts }`), increment `consecutiveErrors`. If `consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD` (3), **halt**: set `halted = true`, `haltReason`, stop processing remaining articles, return the partial `TagResult`.
- `tagger.generateTags(title, content): Promise<string[]>` — truncates `content` to `maxContentLength`, formats `TAGGER_PROMPT_TEMPLATE` with `{ title }` and `{ truncatedContent }`, calls `withRetry(() => client.chatCompletion({ model: getModelName('tagger'), messages: [{ role:'user', content: prompt }], timeoutMs: DEFAULT_TIMEOUT_MS }))`, parses the returned `content` by splitting on `,`, `.trim()`-ing each, dropping empties, and `.slice(0, maxTags)`. This is the exact legacy parse (`tagger.py:84-86`).
- `CONSECUTIVE_ERROR_THRESHOLD = 3` (module constant, mirrors legacy `tagger.py:19`).
- Standalone `tagArticles(articles, options?)` helper wraps `new ArticleTagger(options).tagArticles(articles)`.

### `TagResult` shape (amend `types.ts` if feature 01 did not already pin these fields)
Feature 01 introduced `TagResult` abstractly ("carrying successes and structured per-item failures"). Feature 04 pins the exact fields it needs, following feature 03's amendment pattern:
```ts
interface TagFailure { articleTitle: string; articleLink: string; error: string; attempts: number; }
interface TagResult {
  taggedArticles: TaggedArticle[];   // includes failed articles (tags: [])
  failures: TagFailure[];            // per-article errors
  halted: boolean;                   // consecutive-error threshold reached
  haltReason: string | null;
  consecutiveErrors: number;         // final count
  totalArticles: number;             // input length
}
```
**Deliberate divergence from legacy (documented):** the legacy tagger *raised* `TaggingError` on halt, losing the partial result. This TS port returns a structured `TagResult` with `halted: true` instead of throwing — same "fail loudly, not silently" contract (the orchestrator treats `halted === true` as a fatal phase failure), but the partial state is preserved and testable, and it feeds stage 03's resume-from-last-phase. No silent degradation: a halted phase never continues to the scorer.

## Dependencies
- Builds on: feature-01 `@newsletter/shared` pipeline types (`Article`, `TaggedArticle`, `TagResult`, `PhaseName`) and config helpers (`getModelName`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES`, `DEFAULT_MAX_CONTENT_LENGTH`).
- Feature 04 amends `shared/src/pipeline/types.ts` to add `TagFailure` and pin `TagResult`'s fields (feature 03 established the amendment pattern; existing types must not change).
- Features 05 (scorer) and 07 (drafter) will import `LLMClient` and `withRetry` from `./llm-client` — this feature defines the shared seam.

## Constraints
- TypeScript `strict: true` — no `any` in exported signatures; type all LLM errors as a small discriminated union (`LLMConfigError`, `LLMHttpError`, `LLMTimeoutError`, `LLMNetworkError`).
- **No `openai` SDK dependency.** Use native `fetch` (Node 22) + `AbortSignal.timeout`. OpenRouter is OpenAI-compatible REST; a raw fetch is ~20 lines and matches the native-fetch philosophy of features 02/03.
- **No new runtime npm dependencies.** Retry/backoff is a hand-rolled `withRetry` (no `tenacity`/`p-retry`/`async-retry` dep).
- The tag prompt (`TAGGER_PROMPT_TEMPLATE`) is **byte-identical** to legacy `tagger.py:66-77` — parity depends on it.
- `CONSECUTIVE_ERROR_THRESHOLD = 3` is fixed (not env-overridable here — stage 06 may surface it).
- `withRetry` `maxAttempts` defaults to `DEFAULT_MAX_RETRIES` (3) used as **total attempts** (mirrors tenacity `stop_after_attempt`), not 3-retries-on-top-of-1. Documented to avoid off-by-one.
- The tagger MUST process articles sequentially (the consecutive-error counter is order-dependent). Do not parallelize.
- No persistence, no Appwrite, no run records — pure compute returning a `TagResult`.
- `OPENROUTER_API_KEY` is required at runtime (read by `LLMClient`) and is present in the project-root `.env`. Unit tests inject a mock client so they need no real key.
- No real LLM calls in the unit-test suite — `LLMClient` is mocked at the client boundary (tagger tests) and `globalThis.fetch` is mocked (llm-client tests).

## Acceptance criteria
- [ ] `shared/src/pipeline/llm-client.ts` exports `LLMClient`, `withRetry`, `ChatMessage`, `ChatCompletionOptions`, `ChatCompletionResult`, and the `LLMConfigError`/`LLMHttpError`/`LLMTimeoutError`/`LLMNetworkError` error classes.
- [ ] `new LLMClient()` throws `LLMConfigError` when `OPENROUTER_API_KEY` is unset/empty; accepts an explicit `{ apiKey }` override.
- [ ] `client.chatCompletion(...)` POSTs to `${baseUrl}/chat/completions` with `Authorization: Bearer <key>`, the given `model`/`messages`/`temperature`/`extraBody`, an `AbortSignal.timeout(timeoutMs)`, and returns `{ content, raw }` reading `choices[0].message.content`.
- [ ] `withRetry` retries a failing `fn` up to `maxAttempts` (default 3 total), with exponential backoff `min(1000*2^k, 60000)` ms, and re-throws the last error after the final attempt; resolves immediately on success.
- [ ] `shared/src/pipeline/tagger.ts` exports `ArticleTagger`, `tagArticles`, `TAGGER_PROMPT_TEMPLATE`, `DEFAULT_MAX_TAGS`, `CONSECUTIVE_ERROR_THRESHOLD`.
- [ ] `TAGGER_PROMPT_TEMPLATE` is byte-identical to legacy `tagger.py:66-77` (asserted by a test that compares against the literal string).
- [ ] Given a mock client returning `"AI, Cloud, Security"`, `tagArticles` produces a `TaggedArticle` with `tags: ["AI","Cloud","Security"]`; the prompt sent to the client contains the article title and truncated content.
- [ ] Tag parsing mirrors legacy: split on `,`, trim, drop empties, `slice(0, maxTags)`; content longer than `maxContentLength` is truncated before prompt formatting.
- [ ] A successful tag resets `consecutiveErrors` to 0 (an article failing after a success does not inherit a stale count).
- [ ] 3 consecutive article failures set `TagResult.halted === true`, populate `haltReason`, and **stop processing** — a 4th article in the input is not tagged (not present in `taggedArticles` beyond what was processed, and recorded nowhere as a success).
- [ ] On a per-article failure (retries exhausted), the article still appears in `taggedArticles` with `tags: []` AND in `failures` with the error message — no article is silently dropped.
- [ ] `TagResult.totalArticles` equals the input length; `failures.length` equals the number of errored articles processed before any halt.
- [ ] `pnpm --filter @newsletter/shared test` passes — all llm-client and tagger unit tests green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker`.
- [ ] No `openai` (or similar SDK) entry appears in `shared/package.json` dependencies; no retry-library dep added.

## Files
- Create: `shared/src/pipeline/llm-client.ts`
- Create: `shared/src/pipeline/tagger.ts`
- Create: `shared/src/pipeline/__tests__/llm-client.test.ts`
- Create: `shared/src/pipeline/__tests__/tagger.test.ts`
- Modify: `shared/src/pipeline/types.ts` (add `TagFailure`; pin `TagResult` fields above if not already present; do not change existing types)
- Modify: `shared/src/pipeline/index.ts` (re-export `./llm-client` and `./tagger`)
- Modify: `worker/src/index.ts` (add a referenced import of `ArticleTagger` and `LLMClient` from `@newsletter/shared` — compile-time only, do not instantiate)

## Testing approach
Test-first. Tagger tests inject a mock `LLMClient` (no real network/LLM). LLM-client tests mock `globalThis.fetch` and use `vi.useFakeTimers` for backoff timing. Every behavioral assertion is a failing test before implementation.

`shared/src/pipeline/__tests__/llm-client.test.ts`:
- **Missing key:** `delete process.env.OPENROUTER_API_KEY` → `new LLMClient()` throws `LLMConfigError`; `{ apiKey: 'x' }` override does not throw.
- **Happy path:** mock fetch → 200 with `{ choices: [{ message: { content: "hello" } }] }`; assert `result.content === "hello"`; assert the request used `Authorization: Bearer <key>`, the passed `model` and `messages`, `AbortSignal.timeout(timeoutMs)`, and merged `extraBody`.
- **HTTP error:** mock fetch → 500; `chatCompletion` throws `LLMHttpError` with `statusCode: 500`.
- **Timeout:** mock fetch rejects with `AbortError`; `chatCompletion` throws `LLMTimeoutError`.
- **Network error:** mock fetch rejects with `TypeError: fetch failed`; `chatCompletion` throws `LLMNetworkError`.
- **withRetry resolves on first success:** a `fn` that resolves immediately returns without waiting.
- **withRetry retries then succeeds:** `fn` rejects twice then resolves; assert exactly 3 attempts and that backoff delays occurred between them (1s then 2s, via fake timers).
- **withRetry exhausts:** `fn` always rejects; assert `maxAttempts` (3) calls and that the last error is re-thrown; backoff is capped at 60s (a 6th hypothetical retry would not exceed 60s — assert the cap formula on a computed delay list, not a real 60s sleep).

`shared/src/pipeline/__tests__/tagger.test.ts`:
- **Prompt parity:** assert `TAGGER_PROMPT_TEMPLATE` equals the exact legacy string literal from `tagger.py:66-77` (reproduced in the test as a multiline string); assert the formatted prompt passed to the mock client contains the title and truncated content.
- **Happy tagging:** mock client returns `"AI, Cloud, Kubernetes"`; assert `TaggedArticle.tags === ["AI","Cloud","Kubernetes"]`.
- **Parse edge cases:** mock client returns `"  , spaced , ,empty, "` → tags `["spaced","empty"]` (trim + drop-empty); mock returns more than `maxTags` comma items → sliced to `maxTags`.
- **Content truncation:** an article whose content exceeds `maxContentLength` results in a prompt whose content body is exactly `maxContentLength` chars (capture the prompt sent to the mock client).
- **Consecutive reset:** sequence mock returns [fail, success, fail] → after the success, `consecutiveErrors` resets; `halted === false`; `failures.length === 2`.
- **Halt at 3:** mock client always fails → with 5 input articles, `tagArticles` processes exactly 3 (3 consecutive failures), sets `halted === true`, a non-empty `haltReason`, stops — the 4th and 5th articles are NOT in `taggedArticles`. The 3 failed articles each appear in `taggedArticles` with `tags: []` and in `failures`.
- **Per-article retry exhaustion counts once:** mock client fails; assert that one failed article = one `TagFailure` with `attempts` reflecting `withRetry`'s attempts (the mock client is called `maxAttempts` times for that article before the failure is recorded).
- **totalArticles / shape:** `TagResult.totalArticles === input.length`; `taggedArticles.length + (input.length - processedCount)` is consistent; when not halted, all input articles are processed.
- **Empty input:** `tagArticles([])` → `{ taggedArticles: [], failures: [], halted: false, haltReason: null, consecutiveErrors: 0, totalArticles: 0 }`.

Edge cases covered: missing API key, HTTP/network/timeout error classification, exponential-backoff timing + 60s cap, retry-exhaustion-then-success, retry full exhaustion, consecutive-error reset on success, halt-at-3 with remaining articles unprocessed, per-failure empty-tags-but-not-dropped, content truncation, tag parse trimming/empty-drop/slicing, empty input.

## Tasks

### Task 1: Amend types; write failing llm-client + tagger tests
- **Action:** Amend `shared/src/pipeline/types.ts`: add `TagFailure` and pin `TagResult` to the fields in the Spec (do not alter existing types). Create `shared/src/pipeline/__tests__/llm-client.test.ts` (mocking `globalThis.fetch` + `vi.useFakeTimers`) and `shared/src/pipeline/__tests__/tagger.test.ts` (injecting a mock `LLMClient`) with every case in the Testing approach. Create empty placeholder `shared/src/pipeline/llm-client.ts` and `shared/src/pipeline/tagger.ts` exporting nothing so imports resolve at module level but every assertion fails.
- **Expected result:** A test suite that runs and fails on every behavioral assertion; `TagFailure`/`TagResult` are typed and exported.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — exits non-zero with assertion failures (not module-resolution errors). Confirm `TagFailure` + pinned `TagResult` are exported from `types.ts` and existing types are unchanged.
- **Depends on:** feature-01 (types + config helpers exist).

### Task 2: Implement the shared LLM client
- **Action:** Implement `shared/src/pipeline/llm-client.ts`: the four error classes; `LLMClient` (reads `OPENROUTER_API_KEY`/`baseUrl`, throws `LLMConfigError` when key missing; `chatCompletion` does one native-fetch POST to `${baseUrl}/chat/completions` with bearer auth + `AbortSignal.timeout` + `extraBody` merge, classifying non-2xx → `LLMHttpError`, `AbortError`/`TimeoutError` → `LLMTimeoutError`, other rejection → `LLMNetworkError`, returning `{ content, raw }`); and `withRetry` (up to `DEFAULT_MAX_RETRIES` total attempts, backoff `min(1000*2^k, 60000)` ms, re-throw last error).
- **Expected result:** All llm-client tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- __tests__/llm-client.test.ts` — all green. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Implement the tagger
- **Action:** Implement `shared/src/pipeline/tagger.ts`: export `TAGGER_PROMPT_TEMPLATE` (byte-identical to legacy `tagger.py:66-77`), `DEFAULT_MAX_TAGS` (10), `CONSECUTIVE_ERROR_THRESHOLD` (3), `ArticleTagger` (constructor `{ client?, maxTags?, maxContentLength? }`, default `client = new LLMClient()`; sequential `tagArticles` returning `TagResult` with consecutive-error reset/halt logic; `generateTags` truncating content, formatting the prompt, calling `withRetry(() => client.chatCompletion(...))`, parsing comma-split/trim/drop-empty/slice), and standalone `tagArticles(articles, options?)`.
- **Expected result:** All tagger tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- __tests__/tagger.test.ts` — all green (prompt parity, happy tagging, parse edges, truncation, consecutive reset, halt-at-3, retry-exhaustion-counts-once, shape, empty input). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 2.

### Task 4: Wire exports and cross-package smoke
- **Action:** Modify `shared/src/pipeline/index.ts` to re-export `./llm-client` and `./tagger`. Add a referenced import of `ArticleTagger` and `LLMClient` in `worker/src/index.ts` (compile-time only; do not instantiate — no network/key needed for a typecheck).
- **Expected result:** Both modules are reachable as `@newsletter/shared`, and `worker` consumes them.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — still all green. Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports from `@newsletter/shared` and compiles.
- **Depends on:** Task 3.

## Feature verification
- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves cleanly (no new deps); the Vitest suite passes — `LLMClient` throws `LLMConfigError` on missing key, classifies HTTP/timeout/network errors, and `chatCompletion` issues a correctly-shaped bearer-auth POST; `withRetry` retries with exponential backoff capped at 60s and re-throws after exhaustion; the tagger ports the verbatim prompt, parses tags (split/trim/drop-empty/slice-to-10), truncates content, resets `consecutiveErrors` on success, and halts at 3 consecutive failures (remaining articles unprocessed, failed articles retained with `tags: []` and recorded in `failures`); `tsc --noEmit` passes with zero errors across `shared` and `worker`; `worker/src/index.ts` imports `ArticleTagger` and `LLMClient`. No `openai` SDK or retry-library dependency appears in `shared/package.json`.

## Handoff
When complete, the builder reports to the manager:
- The list of files created/modified (`llm-client.ts`, `tagger.ts`, two test files, `types.ts` amendment, `index.ts`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass.
- The exact exported symbol names from `llm-client.ts` (`LLMClient`, `withRetry`, the four error classes, the `Chat*` types) so features 05 (scorer) and 07 (drafter) import them consistently.
- The `withRetry` semantics pinned: `maxAttempts` = total attempts (default `DEFAULT_MAX_RETRIES` = 3), backoff `min(1000*2^k, 60000)` ms — so scorer/drafter reuse it without renegotiating the contract.
- The exact `TagResult` shape (`taggedArticles`, `failures`, `halted`, `haltReason`, `consecutiveErrors`, `totalArticles`) so feature 07 (orchestrator) and stage 03 (run records) consume it without renegotiating.
- The documented divergence: the TS tagger returns `TagResult.halted` instead of raising `TaggingError` (legacy raised) — same loud-fail contract, but partial state is preserved for stage 03 resume. The orchestrator must treat `halted === true` as a fatal phase failure.
- Confirmation that `TAGGER_PROMPT_TEMPLATE` is byte-identical to legacy `tagger.py:66-77`.
- **Flag:** `OPENROUTER_API_KEY` is present in `.env`; it is required for any real LLM call (feature 07 parity run). Unit tests pass without reading it (mock client injected).
- Any deviation from this spec and the reason (e.g. an OpenRouter response-shape quirk where `choices[0].message.content` needed a null fallback, or a backoff-timer interaction with Vitest fake timers).
