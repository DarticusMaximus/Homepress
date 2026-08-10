# Feature 07: Drafter + orchestrator + harness

## Intent

The capstone of stage 01: the final LLM phase (drafter) that turns the diverse article selection into a finished markdown newsletter, the orchestrator that wires all six phases (fetch→scrape→tag→score→select→draft) into one runnable `runPipeline(config)` returning a structured `PipelineResult`, and a CLI test harness (`pnpm parity-run <config.json>`) that runs the full real chain against live RSS + OpenRouter so the operator can judge parity with the legacy Python pipeline side-by-side. This is the feature the whole stage exists to validate — if it produces a comparable newsletter, the TS engine is proven and every later stage is operability on top of working compute.

## Spec

### Drafter — `shared/src/pipeline/drafter.ts`
Exports `NewsletterDrafter`, the standalone `draftNewsletter` helper, the verbatim `DRAFTER_PROMPT_TEMPLATE` function, `DRAFTER_MAX_COMPLETION_TOKENS` (`15000`), and `DRAFTER_REASONING_EFFORT` (`'high'`). The drafter prompt is **ported byte-identically** from legacy `drafter.py:51-86` — parity depends on it.

- `NewsletterDrafter` — `new NewsletterDrafter({ client? }?)`. `client` defaults to `new LLMClient()` (inject a mock in tests). No `consecutiveErrors` counter (the drafter is a single LLM call, not a per-article loop — there is no halt semantics here).
- `drafter.draft(articles: SelectedArticle[], newsletterName: string, topics: string[], count: number): Promise<DraftResult>` — the full phase:
  1. **Empty input → fail loudly.** If `articles.length === 0`, return `{ markdown: '', articleCount: 0, empty: true, reason: 'no-articles', attempts: 0, raw: undefined }` immediately (no LLM call). The orchestrator treats `empty === true` as a fatal draft-phase condition. (Divergence from legacy — see below.)
  2. `topicsStr = topics.length > 0 ? topics.join(', ') : 'technology news'` — **verbatim** legacy fallback (`drafter.py:47`), NOT `'None'` like the scorer.
  3. **Article payload — strip the embedding.** Map each `SelectedArticle` to `{ title, link, content, score, tags }` (the exact five keys the legacy orchestrator passed at `pipeline.py:464-473`; `embedding` is dropped so it never reaches the prompt JSON). `articlesJson = JSON.stringify(payload, null, 2)` (legacy `json.dumps(articles, indent=2)`).
  4. `prompt = DRAFTER_PROMPT_TEMPLATE({ newsletterName, topicsStr, articlesJson, count })` — byte-identical to the legacy f-string.
  5. **First call (retry-on-exception via `withRetry`):** `const first = await withRetry(() => client.chatCompletion({ model: getModelName('drafter'), messages: [{ role: 'user', content: prompt }], timeoutMs: DEFAULT_TIMEOUT_MS, extraBody: { max_completion_tokens: DRAFTER_MAX_COMPLETION_TOKENS, reasoning_effort: DRAFTER_REASONING_EFFORT } }))`. Let `content = normalizeContent(first.content)`.
  6. **Empty-content one-shot retry (port `drafter.py:100-118` verbatim).** If `content.length === 0`, make exactly ONE additional `chatCompletion` call with identical arguments (NOT wrapped in `withRetry` — legacy's second `create` is a single call inside the same tenacity attempt). The one-shot retry is best-effort: if it throws, swallow the error and treat the result as empty (so the empty-after-retry path is robust to a transient network blip on the retry). `content = normalizeContent(second.content)`; `attempts = 2`.
  7. **Empty after retry → fail loudly.** If `content.length === 0` after the one-shot retry, return `{ markdown: '', articleCount: articles.length, empty: true, reason: 'empty-after-retry', attempts, raw: second?.raw ?? first.raw }`. Orchestrator treats as fatal.
  8. **Success:** return `{ markdown: content, articleCount: articles.length, empty: false, reason: null, attempts, raw: first.raw }`.
- `normalizeContent(value: unknown): string` (module-private) — ports `drafter.py:96-98`: if `value` is an array (some models return a list), coerce via `String(value)`; otherwise `String(value ?? '')`. Always returns a string; never throws.
- `DRAFTER_PROMPT_TEMPLATE({ newsletterName, topicsStr, articlesJson, count }): string` — produces the exact legacy string (lines 51-86), substituting `{newsletterName}`, `{topicsStr}`, `{count}`, and `{articlesJson}` into the literal template. The surrounding literal text (headings, rules, format block, steps, `---` separators) is byte-identical.
- `DRAFTER_MAX_COMPLETION_TOKENS = 15000` (legacy `drafter.py:93`); `DRAFTER_REASONING_EFFORT = 'high' as const` (legacy `drafter.py:94`).
- Standalone `draftNewsletter(articles, newsletterName, topics, count, options?)` wraps `new NewsletterDrafter(options).draft(...)`.

### `DraftResult` + `PipelineResult` shape (amend `types.ts`)
Following the feature-03/04/05/06 amendment pattern — pin the exact fields without altering existing types:
```ts
interface DraftResult {
  markdown: string;                       // empty unless the draft succeeded
  articleCount: number;                   // articles sent to the drafter
  empty: boolean;                         // true when markdown is empty (fatal)
  reason: 'no-articles' | 'empty-after-retry' | null;
  attempts: number;                       // chatCompletion calls made (1 or 2)
  raw?: unknown;                          // last raw OpenRouter response
}

type PipelinePhase = 'fetch' | 'scrape' | 'tag' | 'score' | 'selection' | 'draft';
type PipelineStatus = 'ok' | 'failed';

interface ScrapeSummary { total: number; extracted: number; fallback: number; }

interface PipelineResult {
  status: PipelineStatus;
  markdown: string;                       // the finished newsletter; '' unless status === 'ok'
  failedPhase: PipelinePhase | null;      // set when status === 'failed'
  failureReason: string | null;           // human-readable, set when failed
  newsletter: { name: string; newsItems: number; dateRange: string };
  phases: {
    fetch: FetchResult;
    scrape: ScrapeSummary;
    tag: TagResult;
    score: ScoreResult;
    selection: SelectionResult;
    draft: DraftResult;
  };
  totals: { fetched: number; scraped: number; tagged: number; scored: number; selected: number };
}
```

### Orchestrator — `shared/src/pipeline/orchestrator.ts`
Exports `runPipeline`, `PipelineOrchestrator`, and the `PipelineOptions` type.

- `runPipeline(config: NewsletterConfig, options?: PipelineOptions): Promise<PipelineResult>` — the single entry point. `PipelineOptions` allows injecting each phase (`fetcher?`, `scraper?`, `tagger?`, `scorer?`, `selector?`, `drafter?`); each defaults to the real implementation (`fetchFeeds`, `scrapeAll`, `tagArticles`, `scoreArticles`, `selectDiverse`, `new NewsletterDrafter()`). Tests inject mocks. The orchestrator chains the phases **sequentially in dependency order**, mapping each phase's halt/empty condition to a fatal `failedPhase`. A `PipelineResult` is always returned — the orchestrator does not throw on a phase failure (only on an unexpected thrown exception, which propagates).
- **Phase order and fatal conditions:**
  1. **Fetch:** `const fetchResult = await options.fetcher(config.feeds, { dateRange: config.dateRange })`. Per-feed `failedFeeds` are recorded in `phases.fetch` but are **not** fatal (one dead feed doesn't sink the run — feature 02 contract). Fatal only if `fetchResult.articles.length === 0` → `{ status:'failed', failedPhase:'fetch', failureReason:'no-articles-fetched' }`.
  2. **Scrape:** `const scrapeResults = await options.scraper(fetchResult.articles.map(a => ({ url: a.link, fallbackContent: a.content })))`. Merge content back: `const scrapedArticles = fetchResult.articles.map((a, i) => ({ ...a, content: scrapeResults[i].content }))`. The scraper never throws (feature 03 contract). Build `phases.scrape = { total: scrapeResults.length, extracted: count(source==='extracted'), fallback: count(source==='fallback') }`. Never fatal.
  3. **Tag:** `const tagResult = await options.tagger(scrapedArticles)`. If `tagResult.halted === true` → fatal `{ failedPhase:'tag', failureReason:'tag-phase-halted' }` with the partial `tagResult` recorded. Otherwise continue with `tagResult.taggedArticles`.
  4. **Score:** `const scoreResult = await options.scorer(tagResult.taggedArticles, config.topics, config.dislikedTopics)`. If `scoreResult.halted === true` → fatal `{ failedPhase:'score', failureReason:'score-phase-halted' }`. Otherwise continue with `scoreResult.scoredArticles`.
  5. **Selection (MMR):** `const selectionResult = await options.selector(scoreResult.scoredArticles, config.newsItems)`. If `selectionResult.selectedArticles.length === 0` → fatal `{ failedPhase:'selection', failureReason:'no-articles-after-selection' }` (covers all-below-threshold and batch-embedding-failure). Otherwise continue with `selectionResult.selectedArticles`.
  6. **Draft:** `const draftResult = await options.drafter.draft(selectionResult.selectedArticles, config.name, config.topics, selectionResult.selectedArticles.length)`. Note `count = selectionResult.selectedArticles.length` (matches legacy `pipeline.py:498` — the drafter is told how many it actually received, not `config.newsItems`). If `draftResult.empty === true` → fatal `{ failedPhase:'draft', failureReason: draftResult.reason ?? 'empty-draft' }`. Otherwise success.
  7. **Success:** `{ status:'ok', markdown: draftResult.markdown, failedPhase: null, failureReason: null, ... }` with every phase result populated and `totals` computed (`fetched = fetchResult.articles.length`, `scraped = scrapedArticles.length`, `tagged = tagResult.taggedArticles.length`, `scored = scoreResult.scoredArticles.length`, `selected = selectionResult.selectedArticles.length`).
- On any fatal condition the orchestrator still populates `phases.*` for every phase that ran (phases that did not run get a zero/empty sentinel appropriate to their type — e.g. `phases.draft = { markdown:'', articleCount:0, empty:true, reason:'no-articles', attempts:0 }` when the draft never ran). This keeps `PipelineResult` shape-stable for stage 03 run records.
- `PipelineOrchestrator` — optional class wrapper (`new PipelineOrchestrator(options?).run(config)`); `runPipeline` is the primary API. Provided so stage 03 can hold a long-lived orchestrator if needed; here it just delegates.
- **No inter-phase delay.** (Divergence from legacy `pipeline.py:183-192` `inter_phase_delay_seconds` — dropped per stage decision; OpenRouter rate limits do not require it for the TS pipeline. `config.interPhaseDelaySeconds` is ignored. Documented in Handoff.)

### CLI test harness — `worker/src/parity-run.ts`
A standalone script (NOT a Vitest test — the parity check is operator-judged, not an automated assertion; matches the stage's open-question resolution). Invoked via a new `parity-run` npm script in `worker/package.json`: `tsx --env-file=.env src/parity-run.ts <config-path>` (Node 22 native `--env-file` loads `.env` with **zero new dependencies** — no `dotenv`).

- Reads the newsletter config JSON path from `process.argv[2]`; parses via `JSON.parse` and validates with `createNewsletterConfig` (feature 01 — rejects missing `feeds`/`topics` with a clear error). Exits non-zero with a usage message if the arg is missing or the file is unreadable.
- Calls `runPipeline(config)`; on completion prints a human-readable run summary to stderr: status, `failedPhase`+`failureReason` if failed, the `totals` (fetched/scraped/tagged/scored/selected) and per-phase failure counts (feeds failed, tag failures + halted, score failures + halted, selection candidate/target + failures, draft attempts/empty).
- On `status === 'ok'`: writes the markdown to `./output/<newsletter.name>-<YYYY-MM-DD>.md` (creates `./output/` if absent) and prints the file path to stdout. On `status === 'failed'`: writes nothing, exits non-zero, prints the summary to stderr.
- Includes a sample config at `worker/sample-newsletter.json` (a realistic `NewsletterConfig`: 3–5 real RSS feeds, 2–3 topics, 1 disliked topic, `newsItems: 8`, `dateRange: 'yesterday'`) so the operator can run `pnpm parity-run worker/sample-newsletter.json` immediately.
- The harness is the ONLY place `.env` is loaded; the library code (`shared/`) reads `process.env.OPENROUTER_API_KEY` etc. and is never coupled to dotenv.

## Dependencies

- Builds on: feature-01 types + config (`NewsletterConfig`, `createNewsletterConfig`, `getModelName`, `DEFAULT_TIMEOUT_MS`, `DateRange`).
- Builds on: feature-02 `fetchFeeds` / `FetchResult` / `FeedFailure` and the `RSSFetcher` `options` shape `{ limitPerFeed?, dateRange? }`.
- Builds on: feature-03 `scrapeAll` / `ScrapeResult` (`{ url, content, source: 'extracted'|'fallback', error? }`) and its never-throws contract.
- Builds on: feature-04 `LLMClient` (the `chatCompletion({ model, messages, timeoutMs?, temperature?, extraBody? })` signature — feature 07 uses `extraBody` for `max_completion_tokens`/`reasoning_effort`, NO llm-client amendment), `withRetry`, and the four error classes.
- Builds on: feature-05 `scoreArticles` / `ScoreResult` (`halted`, `scoredArticles`, `failures`).
- Builds on: feature-06 `selectDiverse` / `SelectionResult` (`selectedArticles`, `failures`, `candidateCount`, `targetCount`).
- Feature 07 amends `shared/src/pipeline/types.ts` (add `DraftResult`, `ScrapeSummary`, `PipelinePhase`, `PipelineStatus`, `PipelineResult`; do not change existing types) and `shared/src/pipeline/index.ts` (re-export `./drafter` and `./orchestrator`).

## Constraints

- TypeScript `strict: true` — no `any` in exported signatures; `raw` fields are typed `unknown`.
- **No new runtime npm dependencies.** The drafter reuses `LLMClient` + `withRetry` (feature 04). The harness loads `.env` via Node 22 native `--env-file` (no `dotenv` dep) and runs via the already-present `tsx` devDep in `worker`.
- The drafter prompt body (`DRAFTER_PROMPT_TEMPLATE`) is **byte-identical** to legacy `drafter.py:51-86` — parity depends on it. The `topics` fallback `"technology news"` (not `"None"`), the `{count}` substitution, and the `---`-delimited `articlesJson` block must all match exactly.
- The drafter MUST strip the `embedding` from each `SelectedArticle` before serializing to the prompt JSON (legacy sent only `title, link, content, score, tags`).
- `max_completion_tokens: 15000` and `reasoning_effort: "high"` are passed via `chatCompletion`'s `extraBody` (feature 04 already supports it) — no `llm-client.ts` change. They are fixed module constants here (not env-overridable — stage 06 may surface them).
- The one-shot empty-content retry is a **single** additional `chatCompletion` (NOT wrapped in `withRetry`); it best-effort-swallows a thrown error and treats it as empty. This matches legacy `drafter.py:109-118` semantics (one more call when the first returns empty).
- `withRetry` (feature 04) wraps the first `chatCompletion` call — 3 total attempts on HTTP/timeout/network exceptions, re-throwing the last error. If `withRetry` exhausts, the error propagates out of `draft()` (the orchestrator lets it propagate as an unexpected exception — it is NOT a structured phase failure, it is an infra outage).
- The orchestrator returns a structured `PipelineResult` for every phase-failure condition (halt, empty-pool, empty-draft, no-articles-fetched); it does NOT throw on those. It DOES let unexpected thrown exceptions (e.g. `withRetry` exhaustion in the drafter, or a thrown fetch — though fetch/scrape are isolated) propagate.
- No inter-phase delay (dropped per stage decision; `config.interPhaseDelaySeconds` is ignored).
- No persistence, no Appwrite writes, no run records — `runPipeline` is pure compute returning a `PipelineResult`. The harness writes one markdown file to `./output/` only.
- The harness is the only `.env`-loading surface; `shared/` never imports dotenv.
- `OPENROUTER_API_KEY` is required at runtime (read by `LLMClient`) and present in the project-root `.env`. Unit tests inject a mock client / mock phases so they need no real key and make no real network calls.
- No real LLM/RSS/scrape calls in the unit-test suite — the drafter test mocks `LLMClient`, the orchestrator test injects mock phases, and neither hits `globalThis.fetch`.

## Acceptance criteria

- [ ] `shared/src/pipeline/drafter.ts` exports `NewsletterDrafter`, `draftNewsletter`, `DRAFTER_PROMPT_TEMPLATE`, `DRAFTER_MAX_COMPLETION_TOKENS`, `DRAFTER_REASONING_EFFORT`.
- [ ] `DRAFTER_PROMPT_TEMPLATE(...)` produces a string byte-identical to legacy `drafter.py:51-86` for the same inputs (asserted by a test comparing against the literal legacy string for a sample input).
- [ ] `topics` fallback: `draft([], "Blog", [], 0)` is invoked with empty topics → the prompt (captured via mock) contains `Prioritize news related to: technology news` (the legacy fallback, not `None`).
- [ ] The `chatCompletion` call carries `extraBody: { max_completion_tokens: 15000, reasoning_effort: 'high' }`, `model: getModelName('drafter')`, a single `user` message, and `timeoutMs: DEFAULT_TIMEOUT_MS` (assert the mock received exactly this).
- [ ] Embedding stripped: the `articlesJson` embedded in the prompt contains exactly the keys `title, link, content, score, tags` per article and NEVER `embedding` (assert against the captured prompt for a `SelectedArticle` carrying an `embedding`).
- [ ] Happy draft: mock returns a non-empty markdown string → `DraftResult` has `empty: false`, `markdown` equal to the (normalized) returned content, `articleCount === articles.length`, `attempts === 1`, `reason: null`.
- [ ] Array-content coercion: mock returns `content: ["a","b"]` (list) → `markdown === "a,b"` (legacy `String(...)` coercion).
- [ ] Empty-input fail-loud: `draft([], ...)` returns `{ empty: true, reason: 'no-articles', attempts: 0, markdown: '' }` and does NOT call the client.
- [ ] One-shot empty retry: mock returns empty content first, non-empty second → `markdown` is the second content, `attempts === 2`. The client was called exactly twice.
- [ ] Empty-after-retry fail-loud: mock returns empty both times → `{ empty: true, reason: 'empty-after-retry', attempts: 2, markdown: '' }`.
- [ ] One-shot retry best-effort swallow: mock returns empty first, then throws on the second call → `draft()` returns `{ empty: true, reason: 'empty-after-retry' }` (does NOT propagate the second call's error).
- [ ] `withRetry` on exceptions: mock throws on every call → `draft()` re-throws the error (3 attempts via `withRetry`); no one-shot retry path is reached.
- [ ] `shared/src/pipeline/orchestrator.ts` exports `runPipeline`, `PipelineOrchestrator`, `PipelineOptions`.
- [ ] Happy path: injected mock phases returning non-empty results at each stage → `PipelineResult.status === 'ok'`, `markdown` equals the mock drafter's output, `totals` reflect the mock counts, every `phases.*` is populated, `failedPhase === null`.
- [ ] Scrape-merge: the articles passed to the mock tagger carry `content` from the corresponding mock `ScrapeResult` (not the original fetched content).
- [ ] Draft `count` arg: the mock drafter is called with `count === selectionResult.selectedArticles.length` (not `config.newsItems`).
- [ ] Fetch-zero fatal: mock fetcher returns `{ articles: [], failedFeeds: [...], totalFeeds: 3 }` → `status==='failed'`, `failedPhase==='fetch'`, `failureReason==='no-articles-fetched'`; tagger/score/selector/drafter mocks are NOT invoked.
- [ ] Tag-halt fatal: mock tagger returns `{ halted: true, ... }` → `failedPhase==='tag'`, `failureReason==='tag-phase-halted'`; scorer/selector/drafter NOT invoked.
- [ ] Score-halt fatal: mock scorer returns `{ halted: true, ... }` → `failedPhase==='score'`, `failureReason==='score-phase-halted'`; selector/drafter NOT invoked.
- [ ] Selection-empty fatal: mock selector returns `{ selectedArticles: [], ... }` → `failedPhase==='selection'`, `failureReason==='no-articles-after-selection'`; drafter NOT invoked.
- [ ] Draft-empty fatal: mock drafter returns `{ empty: true, reason: 'empty-after-retry' }` → `failedPhase==='draft'`, `failureReason==='empty-after-retry'`, `markdown === ''`.
- [ ] Per-feed fetch failures are NOT fatal: mock fetcher returns some `failedFeeds` AND a non-empty `articles` array → the run continues (not `failedPhase: 'fetch'`); the failures are recorded in `phases.fetch.failedFeeds`.
- [ ] Shape stability on failure: every `phases.*` key is present on a failed `PipelineResult` (phases that didn't run carry a zero/empty sentinel).
- [ ] No inter-phase delay: the orchestrator does not call `setTimeout`/`sleep` between phases (assert the happy-path run completes without timer waits, or assert no delay helper is imported).
- [ ] `worker/src/parity-run.ts` exists; `worker/package.json` has a `parity-run` script equal to `tsx --env-file=.env src/parity-run.ts`; `worker/sample-newsletter.json` exists and validates via `createNewsletterConfig`.
- [ ] Harness dry-run: with `OPENROUTER_API_KEY` unset and a mock/injected path, the harness loads the sample config and reports a clear config or env error (proves arg parsing + config validation + env loading work without a real network call).
- [ ] `pnpm --filter @newsletter/shared test` passes — all drafter and orchestrator unit tests green; pre-existing feature 01–06 tests still green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker`.
- [ ] No new dependency entry appears in `shared/package.json` or `worker/package.json` (reuses feature-04 `LLMClient`/`withRetry`; harness uses native `--env-file` + existing `tsx`).

## Files

- Create: `shared/src/pipeline/drafter.ts`
- Create: `shared/src/pipeline/orchestrator.ts`
- Create: `shared/src/pipeline/__tests__/drafter.test.ts`
- Create: `shared/src/pipeline/__tests__/orchestrator.test.ts`
- Modify: `shared/src/pipeline/types.ts` (add `DraftResult`, `ScrapeSummary`, `PipelinePhase`, `PipelineStatus`, `PipelineResult`; do not change existing types)
- Modify: `shared/src/pipeline/index.ts` (re-export `./drafter` and `./orchestrator`)
- Create: `worker/src/parity-run.ts`
- Create: `worker/sample-newsletter.json`
- Modify: `worker/package.json` (add `"parity-run": "tsx --env-file=.env src/parity-run.ts"` script)
- Modify: `worker/src/index.ts` (add a referenced import of `runPipeline` and `NewsletterDrafter` from `@newsletter/shared` — compile-time only, do not invoke)

## Testing approach

Test-first. Drafter tests inject a mock `LLMClient` (no real network/LLM). Orchestrator tests inject mock phases (no real network, no real LLM). Every behavioral assertion is a failing test before implementation.

`shared/src/pipeline/__tests__/drafter.test.ts` (mock client exposes `chatCompletion`):
- **Prompt parity:** for a sample input (`newsletterName="Tech Trench"`, `topics=["AI","Cloud"]`, `count=3`, two sample articles), assert the prompt string sent to the mock equals the exact legacy `drafter.py:51-86` output (reproduced in the test as a multiline string with the articles JSON inlined). Assert the `---` separators and the `Write the newsletter using all the provided articles.` closing line are present verbatim.
- **Topics fallback:** invoke `draft(articles, "Blog", [], 2)`; assert the captured prompt contains `Prioritize news related to technology news` and `Newsletter focus` line uses the same fallback (legacy reuses `topics_str` for both).
- **extraBody:** assert the mock `chatCompletion` was called with `extraBody: { max_completion_tokens: 15000, reasoning_effort: 'high' }`, `model` from `getModelName('drafter')`, a single user message, and `timeoutMs: DEFAULT_TIMEOUT_MS`.
- **Embedding stripped:** pass a `SelectedArticle` with a populated `embedding: number[]`; parse the `articlesJson` out of the captured prompt and assert each article object's keys are exactly `['title','link','content','score','tags']` (no `embedding`).
- **Happy draft:** mock returns `{ content: "# Featured\n\n..." }`; assert `DraftResult.markdown === "# Featured\n\n..."`, `empty === false`, `articleCount === 2`, `attempts === 1`, `reason === null`.
- **Array-content coercion:** mock returns `{ content: ["a","b"] }`; assert `markdown === "a,b"`.
- **Empty-input fail-loud:** `draft([], "Blog", ["AI"], 0)` → `{ markdown:'', articleCount:0, empty:true, reason:'no-articles', attempts:0 }`; assert the mock client was NOT called.
- **One-shot empty retry succeeds:** mock returns `{ content: '' }` first, `{ content: '# Draft' }` second; assert `markdown === '# Draft'`, `attempts === 2`, `empty === false`; assert the client was called exactly twice with identical args.
- **Empty-after-retry:** mock returns `{ content: '' }` both times → `{ empty:true, reason:'empty-after-retry', attempts:2, markdown:'' }`.
- **One-shot retry swallows throw:** mock returns `{ content:'' }` first, then rejects on the second call → `draft()` resolves with `{ empty:true, reason:'empty-after-retry' }` (does not reject).
- **withRetry exhaustion propagates:** mock rejects on every call → `draft()` rejects (the `withRetry` error propagates); assert the client was called `DEFAULT_MAX_RETRIES` (3) times; the one-shot retry path was NOT reached (since the first call never succeeded).

`shared/src/pipeline/__tests__/orchestrator.test.ts` (inject mock phases via `PipelineOptions`):
- **Happy path:** mocks return 3 fetched articles, 3 scraped (2 extracted/1 fallback), 3 tagged (not halted), 3 scored (not halted), 2 selected, 1 non-empty draft → `status==='ok'`, `markdown` is the mock drafter output, `totals === { fetched:3, scraped:3, tagged:3, scored:3, selected:2 }`, `phases.scrape === { total:3, extracted:2, fallback:1 }`, `failedPhase === null`.
- **Scrape-merge:** assert the articles handed to the mock tagger have `content` equal to the mock `ScrapeResult.content` (not the fetcher's original content).
- **Draft count arg:** assert the mock drafter's `draft` was called with `count === 2` (the selected count), not `config.newsItems`.
- **Fetch-zero fatal:** mock fetcher returns `{ articles:[], failedFeeds:[...], totalFeeds:2 }` → `failedPhase==='fetch'`, `failureReason==='no-articles-fetched'`; assert tagger/score/selector/drafter mocks were NOT called.
- **Tag-halt fatal:** mock tagger returns `{ halted:true, haltReason:'3 consecutive errors', taggedArticles:[...partial], failures:[...], consecutiveErrors:3, totalArticles:3 }` → `failedPhase==='tag'`, `failureReason==='tag-phase-halted'`; scorer/selector/drafter NOT called; `phases.tag.halted === true`.
- **Score-halt fatal:** analogous → `failedPhase==='score'`, `failureReason==='score-phase-halted'`; selector/drafter NOT called.
- **Selection-empty fatal:** mock selector returns `{ selectedArticles:[], failures:[...], candidateCount:0, targetCount:8, ... }` → `failedPhase==='selection'`, `failureReason==='no-articles-after-selection'`; drafter NOT called.
- **Draft-empty fatal:** mock drafter returns `{ empty:true, reason:'empty-after-retry', markdown:'' }` → `failedPhase==='draft'`, `failureReason==='empty-after-retry'`, `result.markdown === ''`.
- **Per-feed failures NOT fatal:** mock fetcher returns `failedFeeds:[{feedUrl:'x',errorType:'HttpError',statusCode:404}]` AND `articles:[a1,a2]` → `status==='ok'` (run continues); `phases.fetch.failedFeeds.length === 1`.
- **Shape stability:** on a tag-halt result, assert every `phases.*` key exists; `phases.draft` is the `no-articles` sentinel (`{ markdown:'', articleCount:0, empty:true, reason:'no-articles', attempts:0 }`).
- **No inter-phase delay:** assert the happy-path run does not import or call a sleep/delay helper (or use `vi.useFakeTimers` and assert no `setTimeout` was scheduled between phase calls).
- **PipelineResult.newsletter:** assert `result.newsletter === { name: config.name, newsItems: config.newsItems, dateRange: config.dateRange }`.

Edge cases covered: empty drafter input, empty-content one-shot retry (success and fail), one-shot-retry-throws-swallow, withRetry exhaustion propagation, array-content coercion, embedding stripping, topics fallback, fetch-zero, per-feed-failure-non-fatal, tag/score halt, selection-empty, draft-empty, shape stability on failure, draft count = selected length, no inter-phase delay, harness arg parsing + config validation.

## Tasks

### Task 1: Amend types; write failing drafter + orchestrator tests
- **Action:** Amend `shared/src/pipeline/types.ts`: add `DraftResult`, `ScrapeSummary`, `PipelinePhase`, `PipelineStatus`, and `PipelineResult` with the fields in the Spec (do not alter existing types — follow the feature-03/04/05/06 amendment pattern). Create `shared/src/pipeline/__tests__/drafter.test.ts` (injecting a mock `LLMClient` exposing `chatCompletion`) with every case in the Testing approach. Create `shared/src/pipeline/__tests__/orchestrator.test.ts` (injecting mock phases via `PipelineOptions` — each mock is a `vi.fn` returning the canned `FetchResult`/`ScrapeResult[]`/`TagResult`/`ScoreResult`/`SelectionResult`/`DraftResult`) with every case in the Testing approach. Create empty placeholder `shared/src/pipeline/drafter.ts` and `shared/src/pipeline/orchestrator.ts` exporting nothing so imports resolve at module level but every assertion fails.
- **Expected result:** A test suite that runs and fails on every behavioral assertion; `DraftResult`/`PipelineResult`/`PipelinePhase`/`PipelineStatus`/`ScrapeSummary` are typed and exported; existing types unchanged; feature 01–06 tests still pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — drafter + orchestrator tests exit non-zero with assertion failures (not module-resolution errors); the existing feature 01–06 tests still pass. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors. Confirm `DraftResult` + `PipelineResult` (and the `PipelinePhase`/`PipelineStatus`/`ScrapeSummary` helpers) are exported from `types.ts` and existing types are unchanged.
- **Depends on:** features 01–06 (types, `fetchFeeds`, `scrapeAll`, `tagArticles`, `scoreArticles`, `selectDiverse`, `LLMClient`, `withRetry` all exist).

### Task 2: Implement the drafter
- **Action:** Implement `shared/src/pipeline/drafter.ts`: export `DRAFTER_PROMPT_TEMPLATE` (byte-identical to legacy `drafter.py:51-86`), `DRAFTER_MAX_COMPLETION_TOKENS` (15000), `DRAFTER_REASONING_EFFORT` (`'high'`), the module-private `normalizeContent`, `NewsletterDrafter` (constructor `{ client? }`, default `client = new LLMClient()`; `draft(articles, newsletterName, topics, count)` doing empty-input fail-loud → topics fallback → embedding-stripped 5-key JSON payload → `DRAFTER_PROMPT_TEMPLATE` → first `withRetry(chatCompletion)` with `extraBody` → one-shot empty retry (best-effort swallow) → fail-loud `DraftResult` on empty-after-retry → success `DraftResult`), and standalone `draftNewsletter(articles, newsletterName, topics, count, options?)`. Import `LLMClient`, `withRetry` from `./llm-client`; `getModelName`, `DEFAULT_TIMEOUT_MS` from `./config`.
- **Expected result:** All drafter tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- drafter.test.ts` — all green (prompt parity incl. topics fallback, extraBody, embedding stripped, happy draft, array coercion, empty-input fail-loud, one-shot empty retry success/fail, one-shot-retry-swallow, withRetry exhaustion propagates). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Implement the orchestrator
- **Action:** Implement `shared/src/pipeline/orchestrator.ts`: export `PipelineOptions` (the injectable-phase options type), `runPipeline(config, options?)` (defaults each phase to the real `fetchFeeds`/`scrapeAll`/`tagArticles`/`scoreArticles`/`selectDiverse`/`new NewsletterDrafter()`; chains fetch→scrape(merge content)→tag→score→selection→draft sequentially; maps each fatal condition — fetch-zero, tag-halt, score-halt, selection-empty, draft-empty — to a `failedPhase` + `failureReason` and returns a shape-stable `PipelineResult` with every `phases.*` populated; success returns `status:'ok'` with `markdown` and `totals`; no inter-phase delay; the drafter is called with `count = selectedArticles.length`), and `PipelineOrchestrator` (class wrapper delegating to `runPipeline`). Import all phase functions and types from the sibling modules.
- **Expected result:** All orchestrator tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- orchestrator.test.ts` — all green (happy path incl. scrape-merge and draft-count-arg, fetch-zero, tag-halt, score-halt, selection-empty, draft-empty, per-feed-non-fatal, shape stability, no inter-phase delay, newsletter metadata). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 2.

### Task 4: Wire exports, build the CLI harness, cross-package smoke
- **Action:** Modify `shared/src/pipeline/index.ts` to re-export `./drafter` and `./orchestrator`. Modify `worker/src/index.ts` to add a referenced import of `runPipeline` and `NewsletterDrafter` from `@newsletter/shared` (compile-time only; do not invoke — no network/key needed for a typecheck). Create `worker/src/parity-run.ts`: read `process.argv[2]` as the config JSON path (usage message + non-zero exit if missing/unreadable); `JSON.parse` + validate via `createNewsletterConfig`; call `runPipeline(config)`; print a run summary (status, failedPhase/reason, totals, per-phase failure counts) to stderr; on `status:'ok'` write `./output/<name>-<YYYY-MM-DD>.md` and print the path to stdout, on `status:'failed'` exit non-zero. Create `worker/sample-newsletter.json` (a realistic `NewsletterConfig`: 3–5 real RSS feed URLs, 2–3 topics, 1 disliked topic, `newsItems: 8`, `dateRange: 'yesterday'`). Add `"parity-run": "tsx --env-file=.env src/parity-run.ts"` to `worker/package.json` scripts.
- **Expected result:** Drafter + orchestrator are reachable as `@newsletter/shared`; the harness script exists, loads `.env` natively, parses + validates a config, and runs `runPipeline`; a sample config is present.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — still all green (features 01–07). Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports `runPipeline` + `NewsletterDrafter` and compiles. Run `pnpm --filter worker exec tsx --env-file=.env src/parity-run.ts worker/sample-newsletter.json` with `OPENROUTER_API_KEY` **unset** (temporarily override, e.g. `env -u OPENROUTER_API_KEY`) — confirm the harness exits non-zero with a clear `LLMConfigError`/env message (proves arg parsing, config validation, and env loading work end-to-end without a real network call). Confirm `worker/package.json` has the `parity-run` script and `shared/package.json`/`worker/package.json` have no new dependency entries.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves cleanly (no new deps); the full Vitest suite passes (features 01–07) — the drafter ports the verbatim `drafter.py:51-86` prompt (topics fallback `"technology news"`, `---`-delimited articles JSON, embedding stripped to 5 keys), sends `chatCompletion` with `extraBody: { max_completion_tokens: 15000, reasoning_effort: 'high' }`, applies `withRetry` on exceptions + a best-effort one-shot empty-content retry, and returns a fail-loud `DraftResult` on empty input / empty-after-retry while propagating `withRetry` exhaustion; the orchestrator chains fetch→scrape(merge)→tag→score→selection→draft, maps each halt/empty condition to the right `failedPhase` + `failureReason`, returns a shape-stable `PipelineResult` with `totals` and `phases.*`, treats per-feed fetch failures as non-fatal, calls the drafter with `count = selectedArticles.length`, and applies no inter-phase delay; `tsc --noEmit` passes with zero errors across `shared` and `worker`; `worker/src/parity-run.ts` loads `.env` via native `--env-file`, parses + validates the JSON config, runs `runPipeline`, and writes `./output/<name>-<date>.md` on success; `worker/sample-newsletter.json` validates via `createNewsletterConfig`. No new dependency appears in `shared/package.json` or `worker/package.json`.
- Operator parity run (out-of-band, not an automated assertion): `pnpm --filter worker parity-run worker/sample-newsletter.json` against a real day's feeds + OpenRouter, compared side-by-side with the legacy Python pipeline's output for the same newsletter definition. The operator judges relevance, diversity, and readability as "comparable." This satisfies the stage's defining acceptance criterion.

## Handoff

When complete, the builder reports to the manager:
- The list of files created/modified (`drafter.ts`, `orchestrator.ts`, two test files, `types.ts` amendment, `index.ts`, `worker/src/parity-run.ts`, `worker/sample-newsletter.json`, `worker/package.json`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` (all features 01–07) and `pnpm typecheck` both pass, AND that features 01–06's pre-existing tests still pass (the `types.ts` amendment was strictly additive).
- The exact exported symbol names from `drafter.ts` (`NewsletterDrafter`, `draftNewsletter`, `DRAFTER_PROMPT_TEMPLATE`, `DRAFTER_MAX_COMPLETION_TOKENS`, `DRAFTER_REASONING_EFFORT`) and `orchestrator.ts` (`runPipeline`, `PipelineOrchestrator`, `PipelineOptions`) so stage 02+ and `ssc-finalize` consume them consistently.
- The exact `DraftResult` shape (`markdown`, `articleCount`, `empty`, `reason: 'no-articles'|'empty-after-retry'|null`, `attempts`, `raw?`) and `PipelineResult` shape (`status`, `markdown`, `failedPhase`, `failureReason`, `newsletter`, `phases.{fetch,scrape,tag,score,selection,draft}`, `totals`) so stage 03 (run records persist the full `PipelineResult`) and stage 05 (preview/inspection reads `phases.*`) consume them without renegotiating.
- Confirmation that `DRAFTER_PROMPT_TEMPLATE` is byte-identical to legacy `drafter.py:51-86` (including the `"technology news"` topics fallback and the `Write the newsletter using all the provided articles.` closing line).
- The documented divergences from legacy: (1) **fail-loudly on empty draft** — legacy silently returned `""`; this port returns `DraftResult.empty === true` and the orchestrator marks the run `failed` at the draft phase (no silent degradation). (2) **Structured `PipelineResult`** instead of a bare markdown string / thrown exception — the orchestrator returns phase-failure details; only unexpected infra exceptions (e.g. drafter `withRetry` exhaustion) propagate. (3) **No inter-phase delay** — dropped `inter_phase_delay_seconds` per stage decision (OpenRouter rate limits don't require it); `config.interPhaseDelaySeconds` is ignored. (4) **Embedding stripped from the drafter payload** — legacy implicitly sent only 5 keys via its dict construction; this port makes the strip explicit. (5) **One-shot empty retry is best-effort** — swallows a throw on the second call and treats it as empty (legacy's second `create` was inside a try and would have raised into tenacity; this port keeps it simple).
- **Flag:** `OPENROUTER_API_KEY` is present in `.env`; required for the parity run (real `gemini-3-flash-preview` draft + nemotron tag/score + `gemini-embedding-001` selection). Unit tests pass without reading it (mock client / mock phases injected).
- **Flag:** the operator parity run (`pnpm --filter worker parity-run worker/sample-newsletter.json`) is the stage's defining criterion and is a human judgment, not an automated test — schedule it as the final gate before `ssc-finalize`. If the drafter's `reasoning_effort: "high"`/`max_completion_tokens: 15000` produces truncated or empty drafts on OpenRouter for the sample config, surface it as a remediation item (stage 06 may tune these).
- **Flag:** confirm OpenRouter accepts `reasoning_effort` as a top-level body field for `google/gemini-3-flash-preview`; if it requires `reasoning: { effort: 'high' }` instead (OpenRouter's documented format), note the exact body shape used in the handoff so stage 06 can wire model-specific reasoning params.
- Any deviation from this spec and the reason (e.g. an OpenRouter quirk where `choices[0].message.content` is null on reasoning-only responses requiring the one-shot retry, or a `JSON.stringify` ordering difference vs Python `json.dumps` that changes the prompt bytes — if so, pin key order explicitly).
