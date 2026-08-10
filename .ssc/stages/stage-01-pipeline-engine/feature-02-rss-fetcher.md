# Feature 02: RSS fetcher

## Intent
Turn a newsletter's feed list into a deduplicated set of in-date-range `Article` records — concurrently fetched, per-feed error-isolated (one dead feed doesn't sink the run), with structured per-feed failure reporting that stage 03's run records and feed-health monitoring will consume. The first real phase of the pipeline; proves the TS stack can ingest RSS/Atom at parity with the legacy Python `feedparser`-based fetcher.

## Spec
A `shared/src/pipeline/rss-fetcher.ts` module exporting an `RSSFetcher` class and a `fetchFeeds` function. Given a feed URL list, an optional per-feed limit, and a `DateRange` (default `'yesterday'`, resolved via feature 01's `getDateFilter`), it concurrently fetches every feed with native `fetch` + `AbortSignal.timeout(30000)`, parses each response body with `feedsmith`'s `parseFeed`, and maps items to `Article` records (title, link, published as `Date`, content, source). Content selection mirrors the legacy: RSS `item.content?.encoded ?? item.description`, Atom `entry.content ?? entry.summary`; `source` is the feed's title falling back to the feed URL. Articles with `published === null` are assigned epoch (`new Date(0)`) and left to the date-range filter to exclude (same net behavior as the legacy `datetime.min` fallback). The date-range filter drops anything outside `{ start, end }`. Per-feed errors (HTTP non-2xx, network/timeout, unparseable body) are caught per-feed via `Promise.allSettled` and recorded as `FeedFailure` records (`{ feedUrl, errorType, errorMessage, statusCode? }`); a failed feed never aborts the run or affects other feeds. The result is a `FetchResult` (`{ articles: Article[]; failedFeeds: FeedFailure[]; totalFeeds: number }`). A `sanitizeUrlForLog(url)` helper redacts the path/query of feed URLs in log output (mirroring the legacy `sanitize_url`).

## Dependencies
- Builds on: feature-01 `@newsletter/shared` pipeline types (`Article`, `createArticle`, `FeedFailure`, `FetchResult`, `PhaseName`) and config helpers (`getDateFilter`, `DateRange`).

## Constraints
- TypeScript `strict: true` — `feedsmith` ships native types; no `any` in exported signatures.
- Pin `feedsmith@^2.9` (v3 is in beta with a migration guide; revisit in stage 06). Record the pinned version in the handoff.
- Use native global `fetch` (Node 22) + `AbortSignal.timeout` for the 30s per-request timeout. No `axios`, `node-fetch`, or `undici` direct dependency — the runtime already provides fetch.
- Concurrency via `Promise.allSettled` — must NOT use `Promise.all` (which rejects-fast on first failure and breaks per-feed isolation).
- No persistence, no Appwrite writes, no run records — pure compute returning a `FetchResult`.
- No LLM calls — this phase is pure ingest.
- The `Article` shape produced must match feature 01's `Article` interface exactly (field names and types); do not extend or narrow it here.
- A feed returning HTTP 4xx/5xx is a `FeedFailure` with `statusCode` set; a network/timeout/parse error is a `FeedFailure` with `errorType` set and no `statusCode`.
- An empty feed (parsed successfully, zero items) is NOT a failure — it yields zero articles and no `FeedFailure`.
- `limitPerFeed`, when set, caps the number of articles taken from a single feed (first N in document order), mirroring the legacy `limit_per_feed`.

## Acceptance criteria
- [ ] `RSSFetcher` accepts `(feeds: string[], options?: { limitPerFeed?: number; dateRange?: DateRange })` and exposes `fetch(): Promise<FetchResult>`; a standalone `fetchFeeds(feeds, options?)` helper wraps it.
- [ ] Given a fixture RSS 2.0 feed string served by a mock `fetch`, the fetcher returns `Article[]` with correct `title`, `link`, `published` (as `Date`), `content` (from `content:encoded` when present, else `description`), and `source` (feed title).
- [ ] Given a fixture Atom 1.0 feed, items map correctly (`content` from `entry.content` else `entry.summary`).
- [ ] Articles outside the resolved date range are excluded; articles inside are included; the range comes from feature 01's `getDateFilter`.
- [ ] A feed that returns HTTP 404 produces a `FeedFailure` with `statusCode: 404` and does not abort the run; other feeds in the same call still return their articles.
- [ ] A feed that throws a network/timeout error produces a `FeedFailure` with `errorType` set and no `statusCode`; other feeds unaffected.
- [ ] A feed whose body is unparseable (not RSS/Atom/JSON-Feed) produces a `FeedFailure` with `errorType: 'ParseError'`.
- [ ] An empty feed (valid, zero items) produces no `FeedFailure` and zero articles.
- [ ] `limitPerFeed: 2` on a feed with 5 items returns exactly 2 articles from that feed.
- [ ] `FetchResult.totalFeeds` equals the input feed count; `failedFeeds.length` equals the number of feeds that errored.
- [ ] `published === null` items are assigned epoch and excluded by a `yesterday` range (included by an `all` range).
- [ ] `sanitizeUrlForLog('https://example.com/feed?secret=abc')` returns a redacted form with path/query stripped (scheme + host only).
- [ ] `pnpm --filter @newsletter/shared test` passes — all fetcher unit tests green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker`.

## Files
- Modify: `shared/src/pipeline/types.ts` (Task 1 — `Article.published: Date`, richer `FeedFailure`, concrete `FetchResult`, new `FeedErrorType` union)
- Modify: `shared/src/pipeline/__tests__/*.test.ts` (Task 1 — update any feature-01 tests asserting the old shapes)
- Create: `shared/src/pipeline/rss-fetcher.ts`
- Create: `shared/src/pipeline/__tests__/rss-fetcher.test.ts`
- Create: `shared/src/pipeline/__tests__/fixtures/rss-sample.xml` (a small RSS 2.0 fixture)
- Create: `shared/src/pipeline/__tests__/fixtures/atom-sample.xml` (a small Atom 1.0 fixture)
- Modify: `shared/src/pipeline/index.ts` (re-export `./rss-fetcher`)
- Modify: `shared/package.json` (add `feedsmith@^2.9` dependency)

## Testing approach
Test-first. Unit tests mock `globalThis.fetch` (via `vi.spyOn(globalThis, 'fetch')` or `vi.stubGlobal`) and feed fixture XML strings through the parser, so no real network calls happen in the suite. Every behavioral assertion is captured as a failing test before implementation.

`shared/src/pipeline/__tests__/rss-fetcher.test.ts`:
- **RSS parse:** mock fetch to return the RSS fixture; assert returned articles have correct title/link/published/content/source; assert `content` comes from `content:encoded` when present, and falls back to `description` when the `content:encoded` field is absent (use a second fixture variant or mutate the fixture).
- **Atom parse:** mock fetch to return the Atom fixture; assert `content` comes from `entry.content` else `entry.summary`; assert `source` is the feed title.
- **Date filtering — yesterday:** fixture items dated today, yesterday, and 3 days ago; with `dateRange: 'yesterday'` only the yesterday item is returned. Use `vi.useFakeTimers` to pin "now" so the test is deterministic.
- **Date filtering — all:** `dateRange: 'all'` returns all items regardless of date.
- **Null published → epoch → excluded by yesterday:** an item with no date field is excluded under `yesterday` and included under `all`.
- **HTTP 404 isolation:** two feeds — first mocks 404, second mocks a valid feed; assert `failedFeeds` has one entry with `statusCode: 404`, the second feed's articles are still returned, `totalFeeds === 2`.
- **Network error isolation:** first feed's fetch rejects (simulate `TypeError: fetch failed`); assert `failedFeeds` has one entry with `errorType` set and no `statusCode`; second feed unaffected.
- **Timeout:** first feed's fetch rejects with an `AbortError`/timeout signal; assert a `FeedFailure` with a timeout-indicating `errorType`.
- **Parse error:** mock fetch to return `<html>not a feed</html>`; assert `FeedFailure` with `errorType: 'ParseError'`.
- **Empty feed:** valid feed XML with zero items; assert no `FeedFailure` and zero articles.
- **limitPerFeed:** a feed fixture with 5 items, `limitPerFeed: 2`; assert exactly 2 articles returned, in document order.
- **sanitizeUrlForLog:** assert `https://example.com/feed?secret=abc` → `https://example.com/[redacted]` (or equivalent scheme+host-only form); assert a URL with no path also redacts cleanly.
- **FetchResult shape:** `totalFeeds` matches input length; `articles` and `failedFeeds` partition correctly (a feed is either in articles-contributing or failed, never both, never neither — except empty feeds which are neither with zero articles).

Edge cases covered: concurrent failure isolation (the defining contract), date-boundary inclusivity (yesterday spans 00:00:00–23:59:59), content-field fallback, source-name fallback to URL when feed has no title, null-date handling, empty-feed-is-not-failure, limit truncation order, log redaction.

## Tasks

### Task 1: Update feature-01 pipeline types to the fetcher contract
- **Action:** The fetcher is the first real consumer of the feature-01 types, and this feature's contract (below) requires richer shapes than feature-01 currently defines. Update `shared/src/pipeline/types.ts` (and any feature-01 unit tests that assert the old shapes) so that:
  - `Article.published` becomes `Date` (was `string`). Update `createArticle` / `ArticleInput` accordingly — `published: Date`. Published-date parsing (RSS date strings → `Date`) happens in the fetcher (Task 3), not here; the type just carries a `Date`.
  - `FeedFailure` becomes `{ feedUrl: string; errorType: string; errorMessage: string; statusCode?: number }` (was `{ feed: string; error: string }`). `errorType` is a short stable code (e.g. `'HttpError'`, `'NetworkError'`, `'TimeoutError'`, `'ParseError'`); `errorMessage` is the human-readable detail; `statusCode` present only for HTTP errors.
  - `FetchResult` becomes `{ articles: Article[]; failedFeeds: FeedFailure[]; totalFeeds: number }` (was `PhaseResult<Article, FeedFailure>` = `{ successes, failures }`). Remove the `FetchResult = PhaseResult<...>` alias and declare the concrete interface. Leave the other phase result aliases (`TagResult`, `ScoreResult`, `SelectionResult`, `DraftResult`) on `PhaseResult` unchanged.
  - Add a string-literal union `FeedErrorType = 'HttpError' | 'NetworkError' | 'TimeoutError' | 'ParseError'` and type `FeedFailure.errorType` as `FeedErrorType`. Export it.
  - Audit `shared/src/pipeline/__tests__/` for any test asserting the old `FeedFailure`/`FetchResult`/`Article.published` shapes and update them to the new contract. Keep all existing feature-01 behavioral assertions (factory validation, type guards) green.
- **Expected result:** `shared/src/pipeline/types.ts` exports the new shapes; `pnpm --filter @newsletter/shared test` is green; `pnpm typecheck` is green. Downstream features (this fetcher, stage-03 run records, feed-health) now have the contract the spec promises.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — all green. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors. Grep the repo for stale references to `successes`/`failures` on a fetch result, `.feed` / `.error` on a `FeedFailure`, or `published: string` and confirm none remain in `shared/` or `worker/`.
- **Depends on:** feature-01 (verified).

### Task 2: Add feedsmith dep, write fixtures, write failing fetcher tests
- **Action:** Add `feedsmith@^2.9` to `shared/package.json` dependencies and run `pnpm install`. Create `shared/src/pipeline/__tests__/fixtures/rss-sample.xml` (a small RSS 2.0 feed with 3–5 items, varied dates, one item with `content:encoded` and one with only `description`) and `atom-sample.xml` (a small Atom 1.0 feed with 3–5 items, varied dates). Create `shared/src/pipeline/__tests__/rss-fetcher.test.ts` with every case listed in the Testing approach, mocking `globalThis.fetch` to return the fixture strings. Import `RSSFetcher` / `fetchFeeds` from `../rss-fetcher` (which does not exist yet — create an empty placeholder `shared/src/pipeline/rss-fetcher.ts` exporting nothing so imports resolve at module level but assertions fail).
- **Expected result:** A test suite that runs and fails on every behavioral assertion, proving the fetcher contract is captured before implementation. `feedsmith` is installed and importable.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — exits non-zero with assertion failures (not module-resolution errors). Confirm `feedsmith` appears in `shared/package.json` dependencies and `pnpm install` resolved it. Confirm both fixture files exist and are valid XML (feedsmith can parse them in a one-line scratch check).
- **Depends on:** Task 1 (types must be the new contract).

### Task 3: Implement the fetcher
- **Action:** Implement `shared/src/pipeline/rss-fetcher.ts`: export `RSSFetcher` (constructor taking `feeds: string[]` and `options?: { limitPerFeed?: number; dateRange?: DateRange }`) with a `fetch()` method, and a standalone `fetchFeeds(feeds, options?)` helper. Use `Promise.allSettled` over per-feed fetch+parse calls; native `fetch` with `AbortSignal.timeout(30000)`; parse with feedsmith's `parseFeed`; map items to `Article` via `createArticle` (parsing each item's date string into a `Date` via `new Date(...)`; items with no date / invalid date become `new Date(0)`); apply `limitPerFeed` truncation in document order; filter by `getDateFilter(dateRange)` comparing `Article.published` against `{ start, end }`; collect `FeedFailure` records (using the `FeedErrorType` codes) for rejected/errored feeds; assemble and return `FetchResult` (`{ articles, failedFeeds, totalFeeds }`). Implement `sanitizeUrlForLog(url)`. Map HTTP non-2xx → `FeedFailure` with `errorType: 'HttpError'` and `statusCode`; network error → `errorType: 'NetworkError'`, no `statusCode`; `AbortError`/timeout → `errorType: 'TimeoutError'`, no `statusCode`; feedsmith parse throw → `errorType: 'ParseError'`, no `statusCode`.
- **Expected result:** All fetcher tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — all tests green (RSS parse, Atom parse, date filtering, HTTP/network/timeout/parse error isolation, empty feed, limitPerFeed, null-date, sanitizeUrlForLog, FetchResult shape). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 2.

### Task 4: Wire exports and cross-package smoke
- **Action:** Modify `shared/src/pipeline/index.ts` to re-export `./rss-fetcher`. Add a referenced import of `fetchFeeds` (or `RSSFetcher`) in `worker/src/index.ts` so the export is exercised at compile time (do not invoke it — no network in a typecheck).
- **Expected result:** The fetcher is reachable as `@newsletter/shared`, and `worker` consumes the export.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — still all green. Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports from `@newsletter/shared` and compiles.
- **Depends on:** Task 3.

## Feature verification
- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves `feedsmith@^2.9` cleanly; the full Vitest suite passes — RSS and Atom fixtures parse to correct `Article` shapes, date-range filtering excludes out-of-range items, per-feed HTTP/network/timeout/parse errors are isolated into `FeedFailure` records without aborting sibling feeds, empty feeds are not failures, `limitPerFeed` truncates in document order, null dates fall to epoch and are excluded by `yesterday`; `tsc --noEmit` passes with zero errors across `shared` and `worker`; `worker/src/index.ts` imports the fetcher export. No Appwrite, persistence, or LLM code exists in `rss-fetcher.ts`.

## Handoff
When complete, the builder reports to the manager:
- The list of files created/modified (`shared/src/pipeline/rss-fetcher.ts`, tests, fixtures, `shared/src/pipeline/index.ts`, `shared/package.json`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass.
- The exact pinned `feedsmith` version installed (e.g. `2.9.4`) and a note that v3 is in beta (deferred to stage 06).
- The exact `FeedFailure` field set the fetcher populates (`feedUrl`, `errorType`, `errorMessage`, `statusCode?`) so feature 03 (run records) and feed-health monitoring can consume them without renegotiating the shape.
- The content-field fallback logic implemented (`content:encoded ?? description` for RSS; `content ?? summary` for Atom) so feature 03 (inspectable state) and the parity check know what `Article.content` contains.
- The `sanitizeUrlForLog` redaction format chosen (scheme+host+`[redacted]`) so logging is consistent across later phases.
- Any deviation from this spec and the reason (e.g. a feedsmith parsing quirk where a namespace field needed explicit handling).