# Feature 03: Article scraper (Mozilla Readability, pure TypeScript)

## Intent
Extract article main content as cleaned markdown from a URL — falling back to the RSS summary when extraction fails — so downstream phases (tagger, scorer, drafter) work on the article's actual body, not just the truncated RSS summary. Uses Mozilla Readability + jsdom + turndown as a **pure-TypeScript, in-process extractor** — no Python sidecar, no second container, no native binaries. This is a deliberate, explicit trade against the legacy pipeline's trafilatura-based scraper: the extraction engine differs, so the claim is **comparable-purpose extraction**, not byte-identical parity with trafilatura. The stage's defining parity check (feature 07, operator-judged "comparable") is the safety net that catches any quality regression from the engine swap.

## Spec
A single TS module `shared/src/pipeline/scraper.ts` exporting `cleanContent`, an `ArticleScraper` class, a standalone `scrapeArticle` helper, and a batch `scrapeAll` helper.

**`scrape(url, fallbackContent): Promise<ScrapeResult>`** runs entirely in-process:
1. Pre-validate the URL scheme via the shared `assertSafeFetchUrl(url)` helper (http/https only; non-http(s) or unparseable URL → fallback with an `unsafe-url:` diagnostic). Private/loopback IPs are intentionally NOT blocked — operators own their URLs (feature-08 cross-cutting decision S2/S3).
2. `fetchWithSizeLimit(url, { signal, maxBytes, allowHttp })` (shared helper from feature-08) — native fetch with `redirect: 'error'` (no cross-scheme redirects possible) and a hard `maxBytes` cap (`DEFAULT_MAX_CONTENT_LENGTH`, default `70000`); a `Content-Length` larger than the cap or a streaming body that exceeds it throws `OversizeBodyError` → fallback with `error: 'oversize'`. Timeout signal is `AbortSignal.timeout(SCRAPER_TIMEOUT_MS)`, env-configurable, default `30000`.
3. Non-2xx response → fallback. Network error / `AbortError` (timeout) → fallback with `error` set.
4. Read the capped body text (returned by the shared helper); if empty body → fallback.
5. Wrap HTML in `new JSDOM(html, { url })` (passing `url` so Readability can resolve relative links). Run `new Readability(doc.window.document).parse()`. If `parse()` returns `null` (not readerable / no main content) or `article.content` is empty → fallback.
6. If the extracted `textContent` length is below `SCRAPER_MIN_EXTRACTED_LENGTH` (env-configurable, default `200`) → fallback with `error: 'not-readerable'`. This length floor is a **real feature** — it drops ad/trash snippets that Readability would otherwise emit as tiny fragments (feature-08 cross-cutting decision N2-20260630).
7. Convert `article.content` (HTML) to markdown via `new TurndownService().turndown(article.content)`.
8. Prepend `# {title}\n\n` when `article.title` is present and non-empty.
9. Run `cleanContent(...)` on the result; return `{ url, content, source: 'extracted' }`.

On any failure path (unsafe URL, non-2xx, network/timeout error, oversize body, redirect rejection, empty body, `parse() === null`, empty content, extracted length below the configurable floor, exception) the method **MUST NOT throw** — it returns `{ url, content: cleanContent(fallbackContent), source: 'fallback', error? }` where `error` is a short diagnostic (`'timeout'` for `AbortError`, `'oversize'` for an oversize body, an `unsafe-url:` prefix for a rejected scheme, the status code / error name otherwise). This is a deliberate design choice preserved from the prior spec: every failure path yields a usable `ScrapeResult`, so the orchestrator never has to handle a thrown scrape failure. (Note: the legacy Python scraper *did* raise `ScraperError` on exception; this TS rewrite intentionally diverges to "never throws" so `scrapeAll` isolation is trivially guaranteed.)

**`scrapeArticle(url, fallbackContent)`** — thin standalone wrapper over `new ArticleScraper().scrape(...)`.

**`scrapeAll(items: { url: string; fallbackContent: string }[]): Promise<ScrapeResult[]>`** — runs all scrapes concurrently via `Promise.allSettled` with per-article isolation (one failure cannot sink the batch), returning one `ScrapeResult` per input item in input order. `Promise.allSettled` never rejects, but each per-item promise is also internally catch-wrapped so a thrown implementation bug still maps to a fallback `ScrapeResult` rather than a rejected settled entry.

**`cleanContent(content: string): string`** — pure function, a **modified TypeScript port** of the legacy `src/scraper.py:_clean_content` — preserves markdown-link URLs that the legacy `_clean_content` destroyed (legacy parity is on end-result quality, not byte-identical cleaning). Order of operations:
1. If empty → return `""`.
2. Split by `\n`; for each line, `.strip()`; keep the line only if `length > 3`; rejoin with `\n`.
3. **Modified step (markdown-link preservation):** temporarily lift markdown-link URLs (`[text](https://...)`) into `@@MDLINKURL<n>@@` placeholders so the bare-URL strip below does not destroy them. The placeholder technique: each `](https://...)` is replaced with `](@@MDLINKURL<n>@@)`, the URL stored at index `<n>`.
4. Remove bare URLs: replace `https?://\S+` with `""`.
5. Restore the preserved markdown-link URLs from their placeholders (`@@MDLINKURL<n>@@` → original URL).
6. **Sentinel-leak guard:** strip any remaining `@@MDLINKURL\d+@@` token (defense-in-depth — guarantees no placeholder ever reaches downstream even if the restore failed).
7. Collapse whitespace: replace `\s+` with a single space.
8. Remove emoji using the legacy Unicode ranges (emoticons, misc symbols/pictographs, transport/map, flags, dingbats, enclosed chars, supplemental symbols, chess, symbols extended, misc symbols — the full set from `scraper.py:18-32`).
9. Return `.strip()`.

The order of operations matches the legacy cleaning intent (line-drop → URL strip → whitespace collapse → emoji strip → final strip); the markdown-link preservation and sentinel-leak guard are intentional, documented divergences from the legacy byte behavior (feature-08 cross-cutting decision N1-20260630).

## Dependencies
- Builds on: feature-01 `@newsletter/shared` pipeline types (`Article`, `PhaseName`) and config helpers. The `ScrapeResult` type is added to `types.ts` (amending feature 01) and re-exported; feature 01's existing types must not change.
- New runtime deps in `shared/package.json`: `@mozilla/readability`, `jsdom`, `turndown`. New devDep: `@types/turndown` (`@mozilla/readability` and `jsdom` ship their own types).

## Constraints
- TypeScript `strict: true` — no `any` in exported signatures.
- **No Python anywhere.** This feature is the rejection of the prior sidecar design — no `services/` directory, no FastAPI, no Dockerfile for a scraper, no second container. Extraction is in-process TypeScript.
- **No native binaries.** All three deps (`@mozilla/readability`, `jsdom`, `turndown`) are pure JS — no `node-gyp`, no prebuilt-binary platform matrix, no Podman image complications. (The Rust `trafilatura` npm port was considered and rejected: `0.2.0`, single maintainer, published a month prior, ships native binaries, uncertain feature parity for markdown output.)
- `cleanContent` is a **modified port** of the legacy `scraper.py:_clean_content` — legacy parity is on end-result quality, not byte-identical cleaning. The order of operations and the exact regexes/ranges match the legacy; the markdown-link URL preservation (`@@MDLINKURL<n>@@` placeholder technique) and the sentinel-leak guard are intentional, documented divergences (feature-08 N1-20260630).
- The scraper MUST NEVER throw on an extraction/fetch failure — it always returns a `ScrapeResult` with fallback content. This is the contract `scrapeAll` and the orchestrator rely on.
- Use native `fetch` (Node 22) + `AbortSignal.timeout(ms)`. No `axios`, `node-fetch`, or `undici` direct dependency.
- Per-request timeout is configurable via `SCRAPER_TIMEOUT_MS` env var (default `30000`); no hardcoded magic numbers in the scraper.
- Minimum extracted text length is configurable via `SCRAPER_MIN_EXTRACTED_LENGTH` env var (default `200`, parsed as a non-negative integer; falls back to `200` on invalid input). The length floor is a **real feature** — it drops ad/trash snippets Readability would otherwise emit as tiny fragments (feature-08 N2-20260630).
- Article URL ingress is scheme/redirect/size-guarded via the shared `fetch-safety.ts` helper (feature-08): `http:`/`https:` only, `redirect: 'error'` (no cross-scheme redirects), and a `Content-Length` / streaming body cap of `DEFAULT_MAX_CONTENT_LENGTH` (default `70000`). Private/loopback IPs are intentionally NOT blocked (operators own their URLs).
- Concurrency via `Promise.allSettled` — per-article isolation (one failure does not abort sibling scrapes).
- Pass the page URL into the `JSDOM` constructor (`{ url }`) so Readability resolves relative links/images to absolute — required for usable downstream markdown.
- Run Readability on a DOM clone where mutation matters; for this feature the parsed jsdom document is single-use per scrape, so direct construction is acceptable.
- `jsdom` must NOT execute scripts or fetch remote resources (default off — keep it that way for security; untrusted article HTML must never run JS).
- No persistence, no Appwrite, no LLM calls — pure fetch + extract + clean.
- The `ScrapeResult` type is added to `shared/src/pipeline/types.ts` (amending feature 01) and re-exported. Feature 01's existing types must not change.

## Acceptance criteria
- [ ] `shared/src/pipeline/scraper.ts` exports `ArticleScraper`, `scrapeArticle`, `scrapeAll`, `cleanContent`.
- [ ] `ArticleScraper.scrape(url, fallbackContent)` returns a `ScrapeResult` with `source: 'extracted'` and non-empty cleaned markdown content when fed (via mocked fetch) a realistic article HTML fixture; prepends `# {title}\n\n` when Readability returns a title.
- [ ] `ArticleScraper.scrape(url, fallbackContent)` returns a `ScrapeResult` with `source: 'fallback'` and the cleaned fallback content when: the URL scheme is not http(s) (`unsafe-url:` error), the HTTP response is non-2xx, the fetch rejects (network error), the fetch aborts (timeout), the response body exceeds the size cap (`error: 'oversize'`), a redirect is attempted (blocked by `redirect: 'error'`), the body is empty, `Readability.parse()` returns `null`, `article.content` is empty, or the extracted `textContent` is shorter than `SCRAPER_MIN_EXTRACTED_LENGTH` (default `200`).
- [ ] A scrape failure NEVER throws — every failure path returns a fallback `ScrapeResult` (with `error: 'timeout'` for `AbortError`, `error: 'oversize'` for an oversize body, an `unsafe-url:` prefix for a rejected scheme, a diagnostic string otherwise).
- [ ] `scrapeArticle(url, fallbackContent)` wraps `new ArticleScraper().scrape(...)`.
- [ ] `scrapeAll(items)` runs concurrently and returns exactly one `ScrapeResult` per input item, in input order, regardless of per-item failures.
- [ ] `cleanContent` is a modified port of the legacy `_clean_content`: `cleanContent("")` → `""`; strips bare URLs (`https?://\S+` removed); collapses whitespace (`\s+` → single space); removes emoji (legacy Unicode ranges); drops lines with `length <= 3` after strip; preserves markdown-link URLs (`[text](https://...)` survives); never leaks a `@@MDLINKURL*@@` sentinel token (sentinel-leak guard).
- [ ] The HTML→markdown path works: an `<h2>`/`<p>`/`<a>` in the extracted HTML appears as `## `/paragraph/`[text](url)` in the cleaned markdown (turndown default rules).
- [ ] `SCRAPER_TIMEOUT_MS` env var is respected — the scraper uses the configured timeout, not a hardcoded value.
- [ ] `SCRAPER_MIN_EXTRACTED_LENGTH` env var is respected — the scraper uses the configured length floor (default `200`); an extracted article shorter than the floor falls back, one at or above it extracts.
- [ ] `pnpm --filter @newsletter/shared test` passes — all scraper unit tests green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker`.
- [ ] No file under `services/` is created by this feature; no Python, FastAPI, Dockerfile, or Podman image exists for scraping.

## Files
- Create: `shared/src/pipeline/scraper.ts`
- Create: `shared/src/pipeline/__tests__/scraper.test.ts`
- Create: `shared/src/pipeline/__tests__/fixtures/article-sample.html` (a realistic article HTML page: `<title>`, a nav block, an `<article>` with headings, paragraphs, a link, an image — so Readability extracts the article body and ignores nav)
- Create: `shared/src/pipeline/__tests__/fixtures/non-article.html` (a page with no readable main content — e.g. a bare `<html><body><div>login</div></body></html>` — so `Readability.parse()` returns `null`)
- Modify: `shared/src/pipeline/types.ts` (add `ScrapeResult` type)
- Modify: `shared/src/pipeline/index.ts` (re-export `./scraper`)
- Modify: `shared/package.json` (add `@mozilla/readability`, `jsdom`, `turndown` deps + `@types/turndown` devDep)
- Modify: `worker/src/index.ts` (add a smoke import of `ArticleScraper` / `scrapeArticle` from `@newsletter/shared`)

## Testing approach
Test-first. Unit tests mock `globalThis.fetch` (via `vi.spyOn(globalThis, 'fetch')`) and feed HTML fixture strings through the **real** Readability + jsdom + turndown pipeline — so the extraction path is exercised end-to-end in-process, not mocked at the extractor boundary. `cleanContent` is a pure function with no I/O, fully unit-testable.

`shared/src/pipeline/__tests__/scraper.test.ts`:
- **cleanContent — empty:** `cleanContent("")` → `""`.
- **cleanContent — strips URLs:** input with `https://example.com/foo bar` → URL removed, `bar` remains.
- **cleanContent — collapses whitespace:** input with multiple spaces / tabs / newlines → single spaces (after the line-drop + join step).
- **cleanContent — removes emoji:** input containing emoji from each legacy Unicode range → emoji stripped, surrounding text preserved.
- **cleanContent — drops short lines:** input with a 2-char line and a 10-char line separated by `\n` → only the 10-char line remains (after the join, whitespace-collapse still leaves it intact because the 10-char line survives the `> 3` check).
- **scrape — extracted success:** mock fetch to return `200` with the `article-sample.html` fixture body; assert `ScrapeResult.source === 'extracted'`, content is cleaned markdown, the article title is prepended as `# {title}`, and nav text from the fixture is NOT present (proves Readability isolated the main body).
- **scrape — HTML→markdown conversion:** in the extracted-success result, assert an `<h2>` from the fixture became `## ...` and a link became `[text](url)` in the markdown (turndown applied, not raw HTML).
- **scrape — extracted with no title:** mock fetch to return a variant fixture whose `<title>` and Readability title are empty; assert no `# ...` prefix, content is cleaned body.
- **scrape — non-2xx fallback:** mock fetch returns `500`; assert `source === 'fallback'`, `error` is set, content is `cleanContent(fallbackContent)`. Does NOT throw.
- **scrape — network error fallback:** mock fetch rejects with `TypeError: fetch failed`; assert `source === 'fallback'`, `error` set, content is cleaned fallback. Does NOT throw.
- **scrape — timeout fallback:** mock fetch rejects with an `AbortError` (DOMException name `'TimeoutError'` or `'AbortError'`); assert `source === 'fallback'`, `error === 'timeout'`, content is cleaned fallback. Does NOT throw.
- **scrape — empty body fallback:** mock fetch returns `200` with empty string body; assert `source === 'fallback'`, content is cleaned fallback.
- **scrape — not readerable fallback:** mock fetch returns `200` with `non-article.html`; assert `source === 'fallback'` (`Readability.parse()` returned `null`), content is cleaned fallback.
- **scrape — respects SCRAPER_TIMEOUT_MS:** stub env to a non-default timeout; assert the mocked fetch was called with an `AbortSignal.timeout(<configured ms>)` (inspect the call's `init.signal`), not `30000`.
- **scrapeAll — concurrent, order-preserving, isolation:** three items — first's fetch resolves with `article-sample.html`, second's rejects (network error), third's resolves with `non-article.html`; assert three `ScrapeResult`s returned in input order: `[extracted, fallback, fallback]`; the second failure did not affect the first or third.
- **scrapeAll — empty input:** `scrapeAll([])` → `[]`.

Edge cases covered: non-2xx, network error, timeout, empty body, not-readerable (Readability returns null), title present vs absent, HTML→markdown conversion correctness, concurrent failure isolation, env-var timeout routing, empty batch, fallback content is itself empty.

## Tasks

### Task 1: Add deps, fixtures, and failing scraper tests; add ScrapeResult type
- **Action:** Add `@mozilla/readability`, `jsdom`, `turndown` to `shared/package.json` `dependencies` and `@types/turndown` to `devDependencies`; run `pnpm install`. Add `ScrapeResult` to `shared/src/pipeline/types.ts` (`{ url: string; content: string; source: 'extracted' | 'fallback'; error?: string }`) and re-export it without changing existing types. Create the two HTML fixtures: `article-sample.html` (realistic article page with title, nav, an `<article>` containing `<h1>`/`<h2>`, multiple `<p>`s, an `<a href>`, an `<img>` — enough structure for Readability to isolate the body) and `non-article.html` (no readable main content so `parse()` returns `null`). Create `shared/src/pipeline/__tests__/scraper.test.ts` with every case listed in the Testing approach, mocking `globalThis.fetch` and (for the timeout test) `vi.stubEnv('SCRAPER_TIMEOUT_MS', ...)`, reading the fixture files with `fs.readFileSync`/`import.meta` so the real extractor runs on real HTML. Import `ArticleScraper`, `scrapeArticle`, `scrapeAll`, `cleanContent` from `../scraper` (which does not exist yet — create an empty placeholder `shared/src/pipeline/scraper.ts` exporting nothing so imports resolve at module level but assertions fail).
- **Expected result:** A test suite that runs and fails on every behavioral assertion, proving the scraper contract is captured before implementation. `ScrapeResult` is defined and exported; the three runtime deps and one devDep resolve in `pnpm install`.
- **Verify:** Run `pnpm install` — resolves cleanly. Run `pnpm --filter @newsletter/shared test` — exits non-zero with assertion failures (not module-resolution errors). Confirm `ScrapeResult` is exported from `shared/src/pipeline/types.ts` and existing types are unchanged. Confirm `@mozilla/readability`, `jsdom`, `turndown` appear in `shared/package.json` dependencies and `@types/turndown` in devDependencies.
- **Depends on:** feature-01 (types module exists).

### Task 2: Implement `cleanContent` and the TS scraper client
- **Action:** Implement `shared/src/pipeline/scraper.ts`:
  - Export `cleanContent(content: string): string` — port the legacy `scraper.py:_clean_content` exactly: empty → `""`; split `\n`; per line `.strip()` + keep if `length > 3`; join `\n`; `URL_PATTERN = /https?://\S+/` → `""`; `WHITESPACE_PATTERN = /\s+/` → single space; `EMOJI_PATTERN` (the legacy Unicode ranges, one combined regex) → `""`; final `.strip()`.
  - Export `ArticleScraper` class: constructor reads `SCRAPER_TIMEOUT_MS` from env (default `30000`). `scrape(url, fallbackContent): Promise<ScrapeResult>`: `fetch(url, { signal: AbortSignal.timeout(timeoutMs) })`; on non-2xx → fallback; on rejection, distinguish `AbortError`/`TimeoutError` (`error: 'timeout'`) from other errors; on 2xx, read body text; if empty → fallback; build `new JSDOM(body, { url })`; `const article = new Readability(dom.window.document).parse()`; if `article === null` or empty `article.content` → fallback; else `new TurndownService().turndown(article.content)`; prepend `# {title}\n\n` when title present; return `{ url, content: cleanContent(md), source: 'extracted' }`. Wrap the whole body in try/catch so no code path throws — exceptions map to fallback with `error` set to the error name/message.
  - Export `scrapeArticle(url, fallbackContent)` standalone helper wrapping `new ArticleScraper().scrape(...)`.
  - Export `scrapeAll(items)` using `Promise.allSettled`; map each settled result (fulfilled `ScrapeResult` passes through; a rejected promise — should not happen given the never-throws contract, but defensive — maps to a fallback `ScrapeResult` with `error: 'unexpected'`); return in input order.
  - **Do not** enable jsdom script execution or resource fetching (defaults are off — leave them).
- **Expected result:** All scraper and cleanContent tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — all tests green (cleanContent cases; scrape extracted/non-2xx/network/timeout/empty-body/not-readerable; HTML→markdown conversion; env-var timeout routing; scrapeAll concurrent isolation; empty batch). Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Wire exports and cross-package smoke
- **Action:** Modify `shared/src/pipeline/index.ts` to re-export `./scraper`. Add a referenced import of `ArticleScraper` (or `scrapeArticle`) in `worker/src/index.ts` so the export is exercised at compile time (do not invoke it — no network in a typecheck).
- **Expected result:** The scraper is reachable as `@newsletter/shared`, and `worker` consumes the export.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — still all green. Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports from `@newsletter/shared` and compiles.
- **Depends on:** Task 2.

## Feature verification
- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves `@mozilla/readability`, `jsdom`, `turndown`, `@types/turndown` cleanly; the Vitest suite passes — `cleanContent` strips URLs/whitespace/emoji/short-lines (**modified port** of the legacy `_clean_content` — preserves markdown-link URLs the legacy destroyed; feature-08 N1-20260630); the scraper feeds mocked-fetched HTML through the **real** Readability + jsdom + turndown pipeline and returns `ScrapeResult` with `source: 'extracted'` on a realistic article (title prepended, nav excluded, HTML converted to markdown) and `source: 'fallback'` on non-2xx/network/timeout/empty-body/not-readerable (never throwing); `scrapeAll` is concurrent and order-preserving with per-item isolation; `SCRAPER_TIMEOUT_MS` is respected; `tsc --noEmit` passes with zero errors across `shared` and `worker`. No file under `services/` exists; no Python, FastAPI, Dockerfile, or Podman image is introduced.

## Handoff
When complete, the builder reports to the manager:
- The list of files created/modified (`shared/src/pipeline/scraper.ts`, tests, two HTML fixtures, `types.ts` amendment, `index.ts`, `shared/package.json`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass.
- The exact `ScrapeResult` shape (`{ url, content, source: 'extracted'|'fallback', error? }`) so feature 07 (orchestrator) and stage-03 (inspectable state) can consume it.
- The exact `cleanContent` transformations applied (line-drop `> 3` → markdown-link URL lift → bare-URL strip → markdown-link URL restore → sentinel-leak guard → whitespace collapse → emoji strip → final strip) — a **modified port** preserving markdown-link URLs the legacy destroyed (feature-08 N1-20260630) — so the drafter knows what the content looks like and the parity check can compare cleaning behavior.
- The extractor change vs the legacy: this feature uses Mozilla Readability + turndown (pure TS, in-process), NOT the legacy Python trafilatura. The cleaning step is a modified port (markdown-link preservation + sentinel guard); the **extraction** step is a different engine, so downstream content quality depends on the stage-01 operator-judged parity check (feature 07) — flag any observed quality gap there.
- The `SCRAPER_TIMEOUT_MS` env var name and default (`30000`) so the orchestrator and any future config UI can wire it.
- The `SCRAPER_MIN_EXTRACTED_LENGTH` env var name and default (`200`) — the configurable length floor that drops ad/trash snippets (feature-08 N2-20260630).
- The fetch ingress contract: scheme-guarded (http/https only, `unsafe-url:` error otherwise), redirect-blocked (`redirect: 'error'`, no cross-scheme redirects), size-capped (`DEFAULT_MAX_CONTENT_LENGTH` = `70000`, `error: 'oversize'` otherwise) via the shared `fetch-safety.ts` helper (feature-08 S2/S3).
- The exact pinned versions installed for `@mozilla/readability`, `jsdom`, `turndown`, `@types/turndown`.
- Any deviation from this spec and the reason (e.g. a Readability quirk where a specific site's markup needed `isProbablyReaderable` pre-filtering, or a turndown rule override for a tag default rules mishandle).
