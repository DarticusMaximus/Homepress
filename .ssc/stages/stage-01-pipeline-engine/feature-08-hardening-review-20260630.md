# Feature 08: Harden stage-01-pipeline-engine against code review findings

## Intent
Harden stage-01-pipeline-engine against findings from `review-stage-01-pipeline-engine-2026-06-30`: close the two silent-degradation holes in the scorer and MMR selection (C1, C2), add scheme/redirect and body-size guards at the two untrusted-input ingress surfaces and the LLM client (S1-S4, P1), fix the retry classifier to fail fast on permanent 4xx (C3), make the vector math NaN-safe (C4), restore cross-feed dedup (C5), add the `not-selected` failure category so the SelectionResult invariant holds universally (C7), de-duplicate the tagger/scorer call paths (C6), tighten observability on haltReason and the drafter retry (O1, O2), and clean up the dead/misleading type contracts and scorer fields (M1-M3) — without altering any feature's user-visible behavior except where a finding explicitly requires a stricter input rejection or a corrected parse.

## Spec
Twenty-two accepted findings (0 Blocker, 2 High, 20 Medium), grouped into ten tasks. Each task names the file(s) it owns, the finding IDs it closes, and the exact fix. No task owns more than four findings. Where two tasks touch the same file, the later task depends on the earlier one (noted per task) so the builder works from a stable base.

### Cross-cutting decisions (PM-confirmed, apply throughout)
- **S1 baseUrl:** require `https:` by default. Add a configurable opt-in for `http:` (env var `ALLOW_HTTP_LLM_BASE_URL=1` or a constructor flag) that, when set, logs a visible `[llm-client] WARNING: http baseUrl is unsafe — credentials transit in cleartext` warning on first use. No host allowlist — operators may use any provider, including self-hosted. The guard is: `new URL()` parses + scheme is `https:` (or `http:` when opted in).
- **S2 / S3 SSRF:** validate the URL parses and the scheme is `http:`/`https:`. Disable redirect-following across schemes (`redirect: 'error'`, or `redirect: 'follow'` with per-hop scheme re-validation). Do **not** block private/loopback/link-local IPs — the operator owns feed and article URLs, self-hosted feeds legitimately use internal IPs, and this is the same risk class RSS readers accept. The guard is scheme + parse + no cross-scheme redirect.
- **N1 cleanContent:** it does not need to be byte-faithful to the legacy Python — it needs to work. Amend the feature-03 spec language from "faithful port" to "modified port (preserves markdown-link URLs)" and document the actual behavior in the handoff. Keep the markdown-link preservation. Add a sentinel-leak guard.
- **N2 MIN_EXTRACTED_TEXT_LENGTH:** keep the length floor as a real feature (drops ad/trash snippets), make it env-configurable (`SCRAPER_MIN_EXTRACTED_LENGTH`, default `200`), and document it in the feature-03 spec.
- **C5 dedup:** dedup by stable key — `Article.link`, falling back to `title` when `link` is empty — right after concatenation, before returning `FetchResult`.

## Dependencies
- Builds on: all seven `verified` features of stage 01 (feature-01 types & config through feature-07 drafter/orchestrator/harness). The code being hardened is theirs; this feature does not reopen any of them.
- Feature spec under review: `.ssc/reviews/review-stage-01-pipeline-engine-2026-06-30.md` (full evidence and rationale per finding).

## Constraints
- **Do not change user-visible pipeline behavior except where a finding requires a stricter rejection or a corrected parse.** The parity run must still produce a comparable newsletter on valid inputs. The allowed behavior changes are: (a) empty/whitespace/hex LLM score responses are now parse failures (C1); (b) non-http(s) / cross-scheme-redirecting feed and article URLs are now rejected with a failure/fallback (S2, S3); (c) oversize response bodies are rejected (P1); (d) a config `name` with path separators is sanitized (S4). Everything else is internal hardening with identical observable behavior.
- **Do not introduce a host/IP allowlist or blocklist** for LLM `baseUrl`, feeds, or article URLs (PM decision: operators own their URLs; self-hosting must work).
- **Do not regress** any stage-01 Acceptance criterion or any individual feature's Acceptance criteria. In particular: per-feed error isolation still holds (one dead feed does not sink the run); the consecutive-error-halt contract still fires at 3; MMR still returns exactly the configured item count (or fewer when the pool is smaller); the parity harness still runs end-to-end.
- TypeScript `strict: true` continues to pass; no package may relax it.
- The public API exported from `shared/src/pipeline/index.ts` must stay backward-compatible — stage 02+ depends on it. The only allowed addition is the new `SelectionFailure.reason: 'not-selected'` variant (C7) and the optional `DraftResult.retryError` field (O2); both are additive.

## Acceptance criteria
- [ ] **C1:** an empty, whitespace-only, or hex (`0x10`) LLM score response is recorded as a `ScoreFailure` with `reason: 'parse'`, the article is NOT in `scoredArticles`, and 3 consecutive such responses set `ScoreResult.halted === true`.
- [ ] **C2:** when `client.embeddings` returns any vector containing `NaN`, `Infinity`, or a non-number element, `selectDiverse` records every candidate as `reason: 'embedding-failed'` and returns `selectedArticles: []`; the finiteness check runs before any cosine computation.
- [ ] **C3:** `withRetry` does not retry `LLMHttpError` with status 400/401/403/404; those re-throw immediately (1 attempt, no sleep). 429 and 5xx and timeout/network errors still retry per the backoff schedule.
- [ ] **C4:** no function in `vectors.ts` (`dot`, `norm`, `cosine`, `argMax`) returns `NaN`/`Infinity` for any input; non-finite inputs raise a typed error.
- [ ] **C5:** two feeds sharing an article `link` produce that article exactly once in `FetchResult.articles`; two feeds with the same title but different links both survive.
- [ ] **C6:** `tagger.ts` and `scorer.ts` each have a single implementation of the format-prompt + withRetry + (call) sequence; the halt-loop entry points delegate to it.
- [ ] **C7:** when `config.newsItems < candidateCount`, `selectedArticles.length + failures.length === totalArticles` (the unselected-above-threshold articles appear in `failures` with `reason: 'not-selected'`); the orchestrator no longer silently drops them.
- [ ] **N1:** no `@@MDLINKURL\d+@@` sentinel can appear in returned content; the feature-03 spec is amended from "faithful port" to "modified port"; the handoff documents the actual cleanContent behavior.
- [ ] **N2:** `SCRAPER_MIN_EXTRACTED_LENGTH` is env-configurable (default `200`) and respected; a response whose extracted text is below the floor returns `source: 'fallback'` with a documented reason.
- [ ] **N3:** scorer tests cover the actual `Number()`/`parseFloat()` failure boundary (empty, whitespace, `0x10`, `Infinity`); tagger tests cover an empty LLM response → `tags: []`.
- [ ] **N4:** an MMR test covers `target < candidateCount` with a non-empty selection, asserting the invariant holds (after C7) — not just the trivial `target >= candidateCount` case.
- [ ] **O1:** `haltReason` never contains unbounded raw LLM output — the embedded error is truncated (≤ 200 chars) and stripped of newlines; the full raw response remains on `ScoreParseError.raw`.
- [ ] **O2:** when the drafter's one-shot retry throws, the error message is recoverable from `DraftResult.retryError` (or a `[drafter]` log line); an empty-after-retry caused by a network error is distinguishable from one caused by the model returning empty twice.
- [ ] **P1:** a response whose body exceeds the configured max content length is not fully buffered; the fetcher records a `FeedFailure` and the scraper returns a fallback `ScrapeResult`, without OOM.
- [ ] **S1:** `LLMClient` rejects a non-`https` `baseUrl` unless `ALLOW_HTTP_LLM_BASE_URL=1` (or constructor flag) is set, in which case it logs the cleartext warning; a non-parseable URL is rejected with `LLMConfigError`.
- [ ] **S2 / S3:** a feed/article URL whose scheme is not `http`/`https`, or which redirects to a different scheme, is rejected (fetcher: `FeedFailure`; scraper: fallback `ScrapeResult`); loopback/private IPs are NOT blocked.
- [ ] **S4:** `createNewsletterConfig` sanitizes `name` so a value containing `/`, `\`, `..`, or null bytes cannot escape the output directory.
- [ ] **M1:** exactly one phase-name type (`PipelinePhase`, 6 phases including `scrape`) is exported from `types.ts`; the divergent 5-phase `PhaseName` is removed or aliased.
- [ ] **M2:** `PhaseResult<TSuccess,TFailure>` and `ItemFailure<TItem>` are removed from `types.ts` (no concrete result implements them); `tsc --noEmit` passes.
- [ ] **M3:** `scorer.ts` has no dead `content`/`truncatedContent`/`maxContentLength` computation, or the dead path carries an inline `// intentionally unused — legacy scorer prompt omits content` comment.
- [ ] **T1:** the `SCRAPER_TIMEOUT_MS` test fails if the scraper ignores the env var and uses the default; it passes only when the configured value reaches the fetch timeout.
- [ ] `pnpm install && pnpm typecheck && pnpm build && pnpm lint && pnpm test` all pass from a clean state.
- [ ] No stage-01 Acceptance criterion regresses; the parity harness (`worker/src/parity-run.ts`) still runs end-to-end against a real newsletter definition.

## Files
- Create: `shared/src/pipeline/fetch-safety.ts` — shared `assertSafeFetchUrl(url, { allowHttp })` + `fetchWithSizeLimit(url, { signal, maxBytes })` helpers (owned by Task 2, reused by Task 3).
- Modify: `shared/src/pipeline/llm-client.ts` (Task 1: S1, C3).
- Modify: `shared/src/pipeline/rss-fetcher.ts` (Task 2: S2, C5, P1).
- Modify: `shared/src/pipeline/scraper.ts` (Task 3: S3, P1, N1, N2; Task 4: T1 test only).
- Modify: `shared/src/pipeline/__tests__/scraper.test.ts` (Task 4: T1).
- Modify: `shared/src/pipeline/vectors.ts` (Task 5: C4).
- Modify: `shared/src/pipeline/mmr-selection.ts` (Task 5: C2; Task 7: C7).
- Modify: `shared/src/pipeline/__tests__/mmr-selection.test.ts` (Task 5: C2 test; Task 7: N4).
- Modify: `shared/src/pipeline/__tests__/vectors.test.ts` (Task 5: C4 test).
- Modify: `shared/src/pipeline/types.ts` (Task 6: M1, M2, S4; Task 7: C7 enum).
- Modify: `shared/src/pipeline/orchestrator.ts` (Task 7: C7 handling).
- Modify: `shared/src/pipeline/scorer.ts` (Task 8: C1, M3; Task 9: C6; Task 10: O1).
- Modify: `shared/src/pipeline/tagger.ts` (Task 9: C6; Task 10: O1).
- Modify: `shared/src/pipeline/drafter.ts` (Task 10: O2).
- Modify: `shared/src/pipeline/__tests__/scorer.test.ts` (Task 8: N3).
- Modify: `shared/src/pipeline/__tests__/tagger.test.ts` (Task 8: N3).
- Modify: `.ssc/stages/stage-01-pipeline-engine/feature-03-article-scraper.md` (Task 3: N1, N2 spec amendments).

## Testing approach
- **Test-first (pure logic / parse / math):** C1 (scorer parse), C4 (vector guards), C2 (embedding finiteness), C5 (dedup key), N3 (parse-boundary tests), N4 (invariant test), T1 (timeout AC), S4 (name sanitization), M1/M2 (type removal verified by `tsc`). Write the failing test, then implement.
- **Test-after (integration-shaped):** S1/S2/S3 (URL rejection — assert the guard throws/returns-failure for bad scheme + cross-scheme redirect), P1 (oversize body), C3 (retry classification), O1/O2 (truncation / error capture), C7 (invariant under target<candidateCount via the orchestrator or mmr-selection directly).
- **Not test-first (refactor / spec edit):** C6 (dedup refactor — verified by existing suites staying green + a prompt-parity test), N1/N2 (spec edits + sentinel guard + configurability).
- Every task must leave `pnpm typecheck && pnpm lint && pnpm test` green before the verifier signs off.

## Tasks

### Task 1: LLM client — baseUrl scheme validation + retry error classification
**Findings:** S1-20260630, C3-20260630. **Files:** `shared/src/pipeline/llm-client.ts`, `shared/src/pipeline/__tests__/llm-client.test.ts`.
- **Action (S1):** In the `LLMClient` constructor, validate `baseUrl` before assigning it: `new URL(options?.baseUrl ?? DEFAULT_BASE_URL)` must parse; `protocol` must be `https:` by default. Add a constructor option `allowHttpBaseUrl?: boolean` (and read env `ALLOW_HTTP_LLM_BASE_URL=1` as the same opt-in). When `allowHttpBaseUrl` is true and the protocol is `http:`, log exactly once: `console.warn("[llm-client] WARNING: http baseUrl is unsafe — credentials transit in cleartext")`. Any other scheme (`file:`, `ftp:`, etc.) or a non-parseable string throws `LLMConfigError`. No host allowlist.
- **Action (C3):** In `withRetry`, classify errors before retrying. Add an internal `isRetryable(error)`: returns `true` for `LLMTimeoutError`, `LLMNetworkError`, and `LLMHttpError` with `statusCode === 429 || statusCode >= 500`; returns `false` for `LLMHttpError` with 4xx (except 429), `LLMConfigError`, and anything else. In the `withRetry` catch, if `!isRetryable(error)`, re-throw immediately (do not consume an attempt, do not sleep). Keep the existing backoff schedule for retryable errors.
- **Expected result:** The Bearer token can only transit https (or http with an explicit, warned opt-in); permanent 4xx errors fail fast on attempt 1.
- **Verify:** Tests — `new LLMClient({ apiKey:'k', baseUrl:'file:///etc/passwd' })` → `LLMConfigError`; `baseUrl:'http://x'` without opt-in → `LLMConfigError`; `baseUrl:'http://x'` with `allowHttpBaseUrl:true` → succeeds + warning logged (use a `console.warn` spy); `baseUrl:'https://openrouter.ai/api/v1'` → succeeds, no warning. `withRetry(fn)` where fn throws `LLMHttpError(401)` → fn called once, re-thrown, no sleep (assert `sleep`/delay not called); `LLMHttpError(429)` → retried up to `maxAttempts`; `LLMHttpError(500)` → retried; `LLMTimeoutError` → retried. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** none.

### Task 2: RSS fetcher — scheme/redirect guard + cross-feed dedup + body size cap (creates shared helper)
**Findings:** S2-20260630, C5-20260630, P1-20260630. **Files:** create `shared/src/pipeline/fetch-safety.ts`; modify `shared/src/pipeline/rss-fetcher.ts`, `shared/src/pipeline/__tests__/rss-fetcher.test.ts`.
- **Action (S2 + P1 shared helper):** Create `shared/src/pipeline/fetch-safety.ts` exporting: (1) `assertSafeFetchUrl(rawUrl: string, opts?: { allowHttp?: boolean }): URL` — parses with `new URL()`, requires `protocol` `http:` or `https:` (no private-IP blocking), throws a typed `UnsafeUrlError` otherwise; (2) `fetchWithSizeLimit(rawUrl: string, opts: { signal: AbortSignal; maxBytes: number }): Promise<{ response: Response; text: string }>` — calls `fetch(rawUrl, { signal, redirect: 'error' })` (disable cross-scheme redirect), checks `Content-Length` header and rejects if it exceeds `maxBytes`, and for chunked/streaming bodies reads with a capped reader that aborts once `maxBytes` is exceeded. Use `DEFAULT_MAX_CONTENT_LENGTH` from `config.ts` as the default `maxBytes` (import it; do not duplicate the constant). Wire `rss-fetcher.ts` to use both: validate each `feedUrl` and fetch through `fetchWithSizeLimit`. A rejected URL/body becomes a `FeedFailure` (new `errorType` for SSRF/oversize); the run continues (per-feed isolation intact).
- **Action (C5):** After concatenating articles from all settled feeds and before returning `FetchResult`, deduplicate by stable key: build a `Map<string, Article>` keyed by `article.link` (use `article.title` as the key when `link` is empty/whitespace); keep the first occurrence. Return the deduplicated array.
- **Expected result:** Non-http(s) feeds and cross-scheme redirects are rejected per-feed; oversize bodies are capped; duplicate articles across feeds are collapsed.
- **Verify:** Tests — `fetch([...])` with a feed URL `file:///etc/passwd` → `FeedFailure` (not fetched); `http://169.254.169.254/...` → fetched (NOT blocked — operator-owned); a feed returning 302 to `file://` → `FeedFailure`. A feed serving `Content-Length: 500000000` → `FeedFailure` (oversize), not OOM. Two feeds both containing the same `<link>` → that article appears exactly once; same title + different links → both present. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** none. **Exports used by Task 3** (`assertSafeFetchUrl`, `fetchWithSizeLimit`).

### Task 3: Scraper — scheme/redirect guard + body cap + cleanContent sentinel guard + configurable min-length
**Findings:** S3-20260630, P1-20260630 (shared), N1-20260630, N2-20260630. **Files:** `shared/src/pipeline/scraper.ts`; amend `.ssc/stages/stage-01-pipeline-engine/feature-03-article-scraper.md`.
- **Action (S3 + P1):** Replace the scraper's direct `fetch(url, { signal })` + `await response.text()` with the shared `fetchWithSizeLimit` from `fetch-safety.ts` (created in Task 2), passing the scraper's timeout signal and `DEFAULT_MAX_CONTENT_LENGTH`. Pre-validate with `assertSafeFetchUrl(url)`. A rejected URL/body yields the existing never-throws fallback `ScrapeResult` with `source: 'fallback'` and an SSRF/oversize-class `error` string.
- **Action (N1):** Keep the markdown-link-preservation logic (it works; the legacy code was not perfect). Add a sentinel-leak guard: after the restore step, run `text = text.replace(/@@MDLINKURL\d+@@/g, '')` to strip any sentinel that failed to restore. Amend `feature-03-article-scraper.md`: change "faithful port" / "byte-for-behavior port" language to "modified port — preserves markdown-link URLs that the legacy `_clean_content` destroyed (legacy parity is on end-result quality, not byte-identical cleaning)". Add a note to the Spec/Constraints documenting the `@@MDLINKURL` placeholder technique.
- **Action (N2):** Make `MIN_EXTRACTED_TEXT_LENGTH` configurable: read `process.env.SCRAPER_MIN_EXTRACTED_LENGTH` (parse as integer, fall back to `200`), store on the scraper instance like `SCRAPER_TIMEOUT_MS`. Keep the length-floor fallback (drops ad/trash snippets — this is a feature). Amend `feature-03-article-scraper.md`: add the length-floor condition to the Spec's fallback list and the Acceptance criteria, and document `SCRAPER_MIN_EXTRACTED_LENGTH` as an env override.
- **Expected result:** Article URLs are scheme/redirect/size-guarded; cleanContent cannot leak sentinels and its behavior is documented; the min-length floor is configurable.
- **Verify:** Tests — `scrape('file:///etc/passwd', fb)` → `source:'fallback'`, error set; a 302 to `file://` → fallback; `Content-Length` > cap → fallback `'oversize'`. `cleanContent` on malformed link input with no matching restore → no `@@MDLINKURL` token in output. `vi.stubEnv('SCRAPER_MIN_EXTRACTED_LENGTH','50')`, scrape a 70-char extracted article → `source:'extracted'`; at default 200 → `source:'fallback'`. `feature-03-article-scraper.md` shows the amended language. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** Task 2 (for `fetch-safety.ts` exports).

### Task 4: Scraper test — verify the SCRAPER_TIMEOUT_MS env-configurability AC
**Findings:** T1-20260630. **Files:** `shared/src/pipeline/__tests__/scraper.test.ts`.
- **Action:** Replace the weak assertion (signal forwarded + `!aborted`) with one that actually distinguishes the configured timeout from the default. Preferred approach: stub `AbortSignal.timeout` with a `vi.fn` that records its ms argument, then assert the scraper called it with `12345` (not the default `30000`). Alternative (if stubbing `AbortSignal.timeout` is brittle): use `vi.useFakeTimers()` — stub `fetch` to never resolve, stub `SCRAPER_TIMEOUT_MS='12345'`, advance fake timers to `12301ms` and assert the fetch rejected with an abort error; then run a second call with env unset and assert it does NOT abort before `30001ms`.
- **Expected result:** The test fails if the scraper ignores `SCRAPER_TIMEOUT_MS` and hardcodes the default; it passes only when the configured value reaches the fetch timeout.
- **Verify:** Temporarily revert the scraper to use the default constant — the new test must fail. Restore the fix — it must pass. `pnpm test` green.
- **Depends on:** Task 3 (scraper must be in its final configurable state).

### Task 5: Vector math — NaN/Infinity input guards + embedding finiteness validation
**Findings:** C4-20260630, C2-20260630. **Files:** `shared/src/pipeline/vectors.ts`, `shared/src/pipeline/mmr-selection.ts`; tests `shared/src/pipeline/__tests__/vectors.test.ts`, `shared/src/pipeline/__tests__/mmr-selection.test.ts`.
- **Action (C4):** In `vectors.ts`, validate inputs in `dot`, `norm`, and `cosine`: throw a typed error (e.g. `InvalidVectorError`) if any element is `typeof v !== 'number'` or `!Number.isFinite(v)`. In `cosine`, additionally ensure the returned similarity is finite (return `0` or throw if the division yields NaN/Infinity). In `argMax`, throw on a NaN input (or document and assert the chosen behavior). Keep the existing zero-norm guard.
- **Action (C2):** In `mmr-selection.ts`, after the existing shape check (`Array.isArray` + length match) on the embeddings response, add an element-wise finiteness validation: for each vector, reject if it contains any non-number or non-finite element. On failure, throw so the existing batch-embed catch path records every candidate as `reason: 'embedding-failed'` (atomic failure, preserving the invariant). This runs before any `cosine` call.
- **Expected result:** No NaN/Infinity can reach the MMR scoring loop; a malformed embedding batch fails atomically with full telemetry.
- **Verify:** Tests — `cosine([NaN,0],[1,0])` throws (or returns 0, pin the choice) and `Number.isNaN(result)===false`; `norm([NaN])` throws; `argMax([NaN,1,2])` throws. Mock `embeddings` returns `{ embeddings: [[1,0],[NaN,0],[0,1]] }` for 3 candidates → `selectedArticles === []` and all 3 in `failures` with `reason:'embedding-failed'`; same for `Infinity` and `null`. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** none.

### Task 6: Types contract — consolidate PipelinePhase + remove dead generics + sanitize config name
**Findings:** M1-20260630, M2-20260630, S4-20260630. **Files:** `shared/src/pipeline/types.ts` (+ grep across `shared/`,`worker/` for consumers).
- **Action (M1):** Collapse to a single canonical phase type. Keep `PipelinePhase = "fetch" | "scrape" | "tag" | "score" | "selection" | "draft"` (6 phases). Remove the divergent 5-phase `PhaseName`. If any consumer imported `PhaseName`, re-point it to `PipelinePhase`. If the consecutive-error-halt logic genuinely needs a tag/score subset, introduce a distinctly-named `HaltPhase = "tag" | "score"` — but first grep to confirm whether anything actually consumes such a subset; if nothing does, do not add it.
- **Action (M2):** Remove the exported `PhaseResult<TSuccess, TFailure>` and `ItemFailure<TItem>` interfaces (no concrete result implements them). Grep to confirm zero non-test references; if a test references them, update or remove the test.
- **Action (S4):** In `createNewsletterConfig`, sanitize `name` before storing: strip or reject path separators (`/`, `\`), traversal sequences (`..`), and null bytes. Preferred: reject with a clear `ValidationError` if `name` contains any of `/\` or `..` or `\0`; this protects every downstream consumer (parity-run filename, future Appwrite persistence). Confirm `worker/src/parity-run.ts`'s filename construction is then safe by construction.
- **Expected result:** One phase type; no dead generics; config names cannot escape the output directory.
- **Verify:** `grep -rn "PhaseName" shared/ worker/` → nothing (or only an alias if you chose that route). `grep -rn "PhaseResult\|ItemFailure" shared/ worker/` → nothing. `createNewsletterConfig({ name:'../../evil', ... })` → `ValidationError` (or sanitized to a safe basename — pin the choice). `pnpm typecheck && pnpm lint && pnpm test` green (no consumer broke).
- **Depends on:** none. **Note:** Task 7 also edits `types.ts` (adds the `not-selected` enum variant) — sequence Task 6 before Task 7, or coordinate the single edit.

### Task 7: SelectionResult invariant — add `not-selected` failure category + orchestrator handling + test
**Findings:** C7-20260630, N4-20260630. **Files:** `shared/src/pipeline/types.ts` (enum), `shared/src/pipeline/mmr-selection.ts`, `shared/src/pipeline/orchestrator.ts`; test `shared/src/pipeline/__tests__/mmr-selection.test.ts`.
- **Action (C7):** Add `'not-selected'` as a third `SelectionFailure.reason` variant in `types.ts`. In `mmr-selection.ts`, after MMR selection, record every candidate that passed the score threshold but was not selected into `failures` with `reason: 'not-selected'` and a short `error` (e.g. `"not selected by MMR (target=N, candidates=M)"`). This makes `selectedArticles.length + failures.length === totalArticles` hold universally. Verify the orchestrator (`orchestrator.ts`) records `selectionResult` as-is — it now accounts for every scored article; add a defensive warning log if the invariant ever does not hold.
- **Action (N4):** Add an MMR test that constructs `target < candidateCount` with a non-empty selection (e.g., 4 candidates above threshold, `target:2`) and asserts `selectedArticles.length === 2`, `failures` contains the 2 `not-selected`, and `selectedArticles.length + failures.length === 4`. Keep the existing trivial-case test but mark it as the `target >= candidateCount` case.
- **Expected result:** The stage PIN's requirement that feature-07 "handle this" is satisfied by code; stage-03 run records will account for every article.
- **Verify:** The new test passes. The existing trivial-case test still passes. An orchestrator-level test (or direct assertion) confirms `totals.selected + phases.selection.failures.length === totals.scored` when `target < candidateCount`. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** Task 6 (both edit `types.ts`; sequence Task 6 first).

### Task 8: Scorer — strict Number parse + remove dead content fields + parse-boundary tests
**Findings:** C1-20260630, M3-20260630, N3-20260630 (scorer + tagger). **Files:** `shared/src/pipeline/scorer.ts`; tests `shared/src/pipeline/__tests__/scorer.test.ts`, `shared/src/pipeline/__tests__/tagger.test.ts`.
- **Action (C1):** At both parse sites (`tryCalculateScore` ~:239 and `calculateScore` ~:321), replace `Number(result.content.trim())` with a strict parse: `const trimmed = result.content.trim(); if (trimmed === "") throw new ScoreParseError(result.content); const n = parseFloat(trimmed); if (Number.isNaN(n) || !Number.isFinite(n)) throw new ScoreParseError(result.content);` then clamp to `[0,10]` as today. This makes empty/whitespace/hex responses parse failures that increment `consecutiveErrors` and can trip the halt.
- **Action (M3):** Remove the dead `truncatedContent`/`content`/`maxContentLength` path from the scorer (the prompt body omits content by design — legacy parity). Remove `truncatedContent` from `ScorerPromptArgs`, the `content.slice(0, maxContentLength)` computation in `formatPrompt`, and the `maxContentLength` constructor option — OR, if removal risks breaking a consumer signature, keep the params but add an inline `// intentionally unused — legacy scorer prompt omits content` at the slice site and stop computing it. Prefer full removal for stage 01.
- **Action (N3):** Add parse-boundary tests to `scorer.test.ts`: `okContent("")` → `failures.length===1`, `reason:'parse'`, `scoredArticles.length===0`, client called once; `okContent("   ")` → same; `okContent("0x10")` → same; `okContent("Infinity")` → same (confirm `parseFloat` rejects it). Add a test: 3 consecutive empty-response articles → `ScoreResult.halted === true`. Add to `tagger.test.ts`: `okContent("")` → `taggedArticles[0].tags === []` and the article is NOT in failures (confirming the intentional empty-fallback).
- **Expected result:** Blank/garbage score responses are caught; the scorer carries no dead content computation; the parse boundary is tested.
- **Verify:** The new scorer parse tests fail against the old `Number()` implementation and pass against the new `parseFloat`+guard. `grep -n "content.slice\|truncatedContent\|maxContentLength" shared/src/pipeline/scorer.ts` → nothing (or only the documented no-op). `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** none (scorer correctness is foundational; later tasks 9 & 10 build on it).

### Task 9: Tagger/scorer — extract shared callLLM helper (de-duplicate format + withRetry)
**Findings:** C6-20260630. **Files:** `shared/src/pipeline/tagger.ts`, `shared/src/pipeline/scorer.ts`.
- **Action:** In each file, extract a private `callLLM(title, content): Promise<string>` (tagger) / `callLLM(article, tags): Promise<string>` (scorer) that does the format-prompt + `withRetry(client.chatCompletion)` + return-raw-content sequence. Have the halt-loop entry points (`tryGenerateTags`, `tryCalculateScore`) delegate to it, wrapping the result with attempts-tracking and try/catch; have the single-article entry points (`generateTags`, `calculateScore`) delegate to it, wrapping with `parseTags`/parse-clamp. The goal: one copy of the format+call sequence per file. Do NOT change observable behavior — this is a refactor; existing tests must stay green.
- **Expected result:** Each file has a single format+withRetry+call implementation; the halt-loop and single-article paths share it via delegation.
- **Verify:** All existing tagger and scorer tests pass unchanged. Add (or confirm existence of) a prompt-parity test asserting both entry points produce byte-identical prompts for the same input. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** Task 8 (scorer's parse logic must be in its final state before the dedup refactor incorporates it).

### Task 10: Observability — haltReason truncation + drafter retry error capture
**Findings:** O1-20260630, O2-20260630. **Files:** `shared/src/pipeline/tagger.ts`, `shared/src/pipeline/scorer.ts`, `shared/src/pipeline/drafter.ts`.
- **Action (O1):** In both tagger and scorer, stop interpolating `attempt.error` verbatim into `haltReason`. Add a small `truncateForHaltReason(msg: string, max=200): string` that trims to `max` chars and strips newlines. Use it at the halt-reason construction sites (`tagger.ts:~130`, `scorer.ts:~187`). Keep the full raw response on `ScoreParseError.raw` (already there) for debugging — only the human-facing `haltReason` is bounded.
- **Action (O2):** In `drafter.ts`, capture the swallowed one-shot retry error: change `} catch { /* empty */ }` to `} catch (e) { retryError = e; }` (declare `let retryError: unknown;` before the try). Add an optional `retryError?: string` field to `DraftResult` in `types.ts` (additive — backward compatible). On the empty-after-retry path, populate `DraftResult.retryError` with `retryError instanceof Error ? retryError.message : String(retryError)` (or, if you prefer not to amend the type, log it: `console.error('[drafter] one-shot retry threw:', retryError)`). The spec allows the swallow; it does not require the error to be erased.
- **Expected result:** `haltReason` is bounded and newline-free; the drafter retry error is recoverable.
- **Verify:** Tests — mock the tagger/scorer client to throw an error whose `.message` is 500 chars with newlines; assert `haltReason` length ≤ 200 and contains no `\n`; assert `ScoreParseError.raw` retains the full content. Mock drafter: empty first, throws `new Error('timeout 60s')` second → assert `DraftResult.retryError` contains `'timeout 60s'` (or the log spy captured it) and `failureReason === 'empty-after-retry'`. `pnpm typecheck && pnpm lint && pnpm test` green.
- **Depends on:** Task 8 and Task 9 (both also edit `scorer.ts`; sequence this last for that file).

## Feature verification
- Run: `rm -rf node_modules && pnpm install && pnpm typecheck && pnpm build && pnpm lint && pnpm test`.
- Run the parity harness: `pnpm --filter worker parity-run` (or the project's documented parity command) against a real newsletter definition — confirm it still produces a non-empty markdown draft end-to-end with no regression in phase behavior.
- Expected: All build/test/lint/typecheck gates green. Every task's acceptance bullet above holds. No stage-01 Acceptance criterion regresses (per-feed isolation intact; consecutive-error-halt fires at 3; MMR returns the configured count or fewer; parity run completes). The two High bugs (C1, C2) are demonstrably fixed: a blank LLM score response no longer silently scores 0, and a NaN embedding no longer silently corrupts selection.

## Handoff
When complete, the builder reports to the manager:
- Files created (`shared/src/pipeline/fetch-safety.ts`) and modified (all files listed in the Files section).
- Confirmation of each finding's acceptance bullet (C1-C7, N1-N4, O1-O2, P1, S1-S4, M1-M3, T1) with a one-line evidence note (test name / grep result / line ref).
- Confirmation that `pnpm typecheck && pnpm build && pnpm lint && pnpm test` are green from a clean install.
- Confirmation that the parity harness still runs end-to-end and produces a comparable draft.
- The spec amendments made to `feature-03-article-scraper.md` (N1 "modified port", N2 `SCRAPER_MIN_EXTRACTED_LENGTH`).
- Any deviation from this spec and the reason (e.g., if `PhaseName` had a live consumer requiring a `HaltPhase` alias, or if the drafter type amendment was done via log instead of a new field).
- Reference: full evidence and rationale in `.ssc/reviews/review-stage-01-pipeline-engine-2026-06-30.md`.

## Post-verification correction — P1 body-cap category error (2026-07-01)

**Discovered by:** the PM, cross-checking OpenRouter token usage logs against the first parity run, which showed suspiciously low input tokens.

**Root cause:** Task 2 (P1) and Task 3 (P1) wired `fetchWithSizeLimit` with `maxBytes: DEFAULT_MAX_CONTENT_LENGTH` (70000), following the P1 finding's instruction literally. That constant is a **prompt-truncation** cap — it bounds how much *extracted/cleaned article text* is fed into an LLM prompt. It was never intended as a **raw HTTP response body** cap. Real article HTML pages run 350KB–924KB before Readability extracts the ~2–10KB of actual content. So the fetch layer was throwing `OversizeBodyError` on ~90% of article fetches, the scraper silently fell back to the short RSS summary, and the tagger/scorer/drafter read only those summaries — explaining the low input tokens.

**Evidence from the parity run** (`worker/sample-newsletter.json`, before → after the fix):

| Metric | Before fix | After fix |
| --- | --- | --- |
| `scrape: extracted` | 4 | 56 |
| `scrape: fallback` | 42 | 4 |
| extraction rate | 9% | 93% |

**Fix:** Introduced a distinct constant `DEFAULT_MAX_FETCH_BYTES = 5_000_000` (5MB) in `config.ts` for the raw HTTP body cap (a DoS guard against hostile multi-gigabyte bodies, generous enough for any legitimate article page). The fetcher (`rss-fetcher.ts`) and scraper (`scraper.ts`) now pass `DEFAULT_MAX_FETCH_BYTES` to `fetchWithSizeLimit`; `DEFAULT_MAX_CONTENT_LENGTH` (70000) retains its original role as the post-extraction prompt-truncation cap used by the tagger/scorer. Two layers, two caps: 5MB bounds the raw fetch; 70KB bounds the prompt input.

**Lesson for the spec layer:** the P1 finding conflated two unrelated caps by name. `DEFAULT_MAX_CONTENT_LENGTH` should never have been reused as a fetch-body limit — its units (chars of cleaned text) and purpose (prompt budget) differ from a raw-bytes HTTP guard. Future specs referencing constants by name should state the constant's *purpose and units*, not just its identifier, so a builder following the instruction literally cannot make this category error.

**Files changed by the correction:** `shared/src/pipeline/config.ts` (new constant), `shared/src/pipeline/rss-fetcher.ts`, `shared/src/pipeline/scraper.ts`, `shared/src/pipeline/fetch-safety.ts` (re-export), `shared/src/pipeline/__tests__/config.test.ts`, `shared/src/pipeline/__tests__/rss-fetcher.test.ts`, `shared/src/pipeline/__tests__/scraper.test.ts` (oversize fixtures raised above the new 5MB cap). All gates green (309 tests); the corrected parity run extracts 93% of articles and produces a comparable draft.
