# SSC Code Review Report

**Date:** 2026-06-30
**Reviewer:** ssc-code-review
**Scope:** stage-01-pipeline-engine (stage)
**Profile:** full
**Feature spec anchor:** .ssc/stages/stage-01-pipeline-engine.md + 7 feature specs in .ssc/stages/stage-01-pipeline-engine/

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 2 | Medium 20 | Low 0 | Nit 0
- **Overall rationale:** No Blockers and no security breaches in the operator-controlled headless parity scope, but two High correctness bugs silently defeat the stage's primary safety mechanisms: the scorer's `Number()` parse accepts empty/whitespace as score 0 (C1), and the MMR phase has no finiteness guard on embedding vectors, so a single NaN collapses selection to index 0 (C2). Both undermine the stage's defining parity claim — that the engine surfaces degradation rather than hiding it. The remaining 20 Medium findings span SSRF/path-traversal defense-in-depth (S1-S4), retry/error-classification (C3), observability hygiene (O1-O2), spec drift/anti-cheat (N1-N4), and maintainability (M1-M3). Most are low-blast-radius today because stage 01 runs headless against operator-configured feeds, but several widen materially at stage 02 (user-configurable feeds/names) and should be hardened before the GUI lands.

---

## Scope and Coverage

- **Target reviewed:** stage-01-pipeline-engine — all 7 verified features (pipeline types & config, RSS fetcher, article scraper, tagger, scorer, MMR selection, drafter/orchestrator/harness)
- **Base reference:** n/a (SSC-native scope; not a git repo — reviewed current disk state, no diff)
- **Files reviewed (source):**
  - shared/src/pipeline/types.ts, config.ts, llm-client.ts, vectors.ts (B1)
  - shared/src/pipeline/rss-fetcher.ts, scraper.ts (B2)
  - shared/src/pipeline/tagger.ts, scorer.ts (B3)
  - shared/src/pipeline/mmr-selection.ts, drafter.ts, orchestrator.ts, index.ts, worker/src/index.ts, worker/src/parity-run.ts (B4)
- **Files spot-checked (anti-cheat only):** shared/src/pipeline/__tests__/llm-client.test.ts, vectors.test.ts, rss-fetcher.test.ts, scraper.test.ts, tagger.test.ts, scorer.test.ts, mmr-selection.test.ts, drafter.test.ts, orchestrator.test.ts
- **Files skipped:** web/ (stage 00, out of scope), shared/src/appwrite/ (stage 00), node_modules, .env itself (secrets checked via source-file handling, not by reading .env), the legacy `AI-Newsletter-Pipeline-main - OLD - DO NOT USE` reference directory
- **Execution mode:** Large scope (~250k tokens estimated) → mandatory coordinator + 4 sequential batch-review sub-agents + 1 sequential validator sub-agent. All sub-agents ran one at a time, never in parallel.
- **Assumptions and unknowns:**
  - Not a git repo — no blame/diff; findings reflect current disk state only.
  - Severity floor Medium per confirmed profile; Low/Nit suppressed.
  - The legacy Python reference (`AI-Newsletter-Pipeline-main - OLD - DO NOT USE`) was NOT cross-read line-by-line; spec-drift claims (N1, N2, C5) are anchored on the feature specs' quoted legacy behavior, not a fresh diff against the Python source. Validator confirmed the specs themselves cite the legacy behavior.
  - Stage 02+ exposure (user-configurable feeds, UI-editable names, persistence) is inferred from the stage file's Out-of-scope section, not from written stage-02 specs.

---

## SSC Intent Check

- **Stage Intent line:** "Prove the riskiest assumption in the whole project: that a TypeScript pipeline can match the legacy Python pipeline's filtering quality end-to-end. Every later stage is wasted scaffolding around an engine that doesn't work — so the engine is proven headless, via a test harness, before any UI is built. If this stage fails, the project pivots; if it succeeds, the core value is real."
- **Intent served?** Partially — drift detected
- **Notes:** The engine runs end-to-end and the harness exists, but two correctness bugs (C1, C2) can silently produce a degenerate newsletter with no error signal — the opposite of "surfaces whether the engine works." Three spec-drift findings (N1 cleanContent markdown-link preservation, N2 MIN_EXTRACTED_TEXT_LENGTH=200, C5 missing cross-feed dedup) describe code that diverges from the feature specs' stated "faithful port" / "deduplicated" contracts while the specs still claim fidelity. The parity check may still pass on typical inputs, but the drift means a parity judgment is being made against behavior the specs do not document. No finding rises to "the feature doesn't deliver its Intent" (Blocker), hence Partially rather than No.

---

## Detailed Findings

Findings sorted by severity (High → Medium), then by category (Security → Correctness → Anti-cheat → Performance → Maintainability → Observability → Testing).

### [ ] C1-20260630: Scorer `Number()` parse accepts empty/whitespace as score 0, defeating the consecutive-error halt

| Field | Value |
|---|---|
| **ID** | `C1-20260630` |
| **Severity** | High |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/scorer.ts:239-249` and `:321-325` |
| **Description** | The scorer parses the LLM response with `Number(result.content.trim())` and treats `Number.isNaN(n)` as the only parse-failure signal. JS `Number()` is more permissive than the legacy Python `float()`: it accepts empty/whitespace strings as `0`, and hex (`"0x10"`→16). An empty or whitespace-only LLM response (a real failure mode — rate-limited echo, guardrail blanking, downstream trim) parses to `score = 0` and is pushed to `scoredArticles` as a valid numeric score for MMR, instead of being recorded as a `ScoreFailure` with `reason: 'parse'` and incrementing `consecutiveErrors`. This defeats the parse-failure-counts-toward-halt contract that feature-05 deliberately strengthens over legacy. Validator note: two of the four originally-cited examples (`"Infinity"`, `"1e1"`) do NOT diverge — Python `float()` accepts those too — but the empty/whitespace→0 and hex→16 cases are real divergences and the core bug stands. |
| **Risk / Impact** | A blank LLM body is silently scored 0 and enters MMR instead of tripping the 3-consecutive-error halt — the exact silent-degradation the halt was built to catch. The stage acceptance criterion "every tagged article receives a numeric score in [0,10]" is technically satisfied but the score is fabricated. Breaks parity: the legacy `float()` guard existed to reject non-decimal-number strings. |
| **Evidence** | `scorer.ts:239-241`: `const n = Number(result.content.trim()); if (Number.isNaN(n)) { throw new ScoreParseError(result.content); }` — `Number("")===0` (isNaN=false), `Number("   ")===0`, `Number("0x10")===16`. No empty-string or non-finite guard. Same pattern at `:321-325` (`calculateScore`). |
| **Recommendation** | Replace with a stricter parse matching legacy `float()`: `const trimmed = result.content.trim(); if (trimmed === "") throw new ScoreParseError(result.content); const n = parseFloat(trimmed); if (Number.isNaN(n) || !Number.isFinite(n)) throw new ScoreParseError(result.content);` Apply at both call sites (tryCalculateScore:239 and calculateScore:321). Consider a full strict-decimal regex `/^-?[0-9]+(\.[0-9]+)?$/` if exact `float()` parity is required. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `okContent("")` → ScoreFailure reason 'parse', article NOT in scoredArticles, client called once; `okContent("   ")` → same; `okContent("0x10")` → same; 3 consecutive empty-response articles → `ScoreResult.halted === true`. |
| **Acceptance Criteria** | An empty or whitespace-only LLM response is recorded as a ScoreFailure with reason 'parse', attempts 1, and the article is NOT in scoredArticles. 3 consecutive blank/whitespace responses set `ScoreResult.halted === true`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator verified `Number("")===0` at runtime; the parse-failure branch is bypassed for empty/whitespace/hex. The core bug is confirmed; two of four cited examples (Infinity, 1e1) were overstated but do not invalidate the finding. |

```ts
// Current (buggy):
const n = Number(result.content.trim());
if (Number.isNaN(n)) { throw new ScoreParseError(result.content); }

// Suggested fix:
const trimmed = result.content.trim();
if (trimmed === "") throw new ScoreParseError(result.content);
const n = parseFloat(trimmed);
if (Number.isNaN(n) || !Number.isFinite(n)) throw new ScoreParseError(result.content);
```

---

### [ ] C2-20260630: MMR selection has no finiteness guard on embedding vectors — NaN collapses selection to index 0

| Field | Value |
|---|---|
| **ID** | `C2-20260630` |
| **Severity** | High |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/mmr-selection.ts:121-130, 171-181`; `shared/src/pipeline/vectors.ts:26-33` |
| **Description** | The batch-embed validation only checks `Array.isArray(result.embeddings)` and `result.embeddings.length === candidates.length` — it does NOT verify that each embedding vector contains finite numbers. If the OpenRouter embeddings API returns a vector containing NaN, Infinity, or a null element (malformed float, truncated payload, model hiccup), `cosine()` in vectors.ts returns NaN (the zero-norm guard only catches exact 0, and NaN !== 0). In the MMR loop, `sim = NaN` makes `sim > maxSim` always false, so `maxSim` stays at its initial `-Infinity`, producing `mmr = (1-λ)·score − λ·(−∞) = +Infinity`. Then `argMax` compares with `>`; `NaN > NaN` and `+Infinity > NaN` are both false, so `bestIdx` stays at index 0 of the remaining pool regardless of actual relevance. The selection is silently corrupted — no error thrown, no `embedding-failed` recorded, `selectedArticles` non-empty but wrong. |
| **Risk / Impact** | Silently incorrect article selection with no telemetry signal. A single malformed embedding vector collapses the entire MMR selection to always pick index 0, defeating diversity. The operator parity run could produce a degenerate newsletter with no error indication, undermining the stage's defining correctness criterion. |
| **Evidence** | `mmr-selection.ts:121-130`: shape check only, no element finiteness check. `vectors.ts:26-33`: `return dot(a, b) / (na * nb);` — NaN propagates, only zero-norm guarded. `mmr-selection.ts:173-180`: `const sim = cosine(...); if (sim > maxSim) { maxSim = sim; }` — NaN comparison is false, maxSim stays -Infinity. |
| **Recommendation** | After the shape check at `mmr-selection.ts:121-130`, validate each embedding: `for (const vec of result.embeddings) if (!Array.isArray(vec) || vec.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('embedding contains non-finite values')`. This makes the batch fail atomically (the already-handled catch path records every candidate as `embedding-failed`), preserving the invariant and surfacing the problem. Complement with the vectors.ts guard from C4. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock `embeddings` returns `{ embeddings: [[1,0],[NaN,0],[0,1]] }` for 3 candidates → `selectedArticles === []` and every candidate in `failures` with `reason: 'embedding-failed'`; same for a vector containing `Infinity`; same for a vector containing `null`. |
| **Acceptance Criteria** | When `client.embeddings` returns any embedding vector containing NaN, Infinity, or a non-number element, `selectDiverse` records every candidate as `reason: 'embedding-failed'` with populated `error` and returns `selectedArticles: []`. The finiteness check runs before any cosine computation. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator traced the NaN-through-cosine-into-argMax path at runtime: `cosine` returns NaN, `NaN > -Infinity` is false, `argMax` returns index 0. The only current caller is MMR, so C2 and C4 share a root cause but are independently fixable. |

---

### [ ] S1-20260630: `LLMClient.baseUrl` accepts arbitrary host — Bearer token exfiltration footgun

| Field | Value |
|---|---|
| **ID** | `S1-20260630` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/pipeline/llm-client.ts:104-115, 134, 208` |
| **Description** | `LLMClient` accepts an arbitrary `baseUrl` override with no scheme/host validation. The bearer token (`Authorization: Bearer <apiKey>`) is sent to whatever host `baseUrl` points at. In stage 01 `baseUrl` is code-set, not user input, so exploitability is limited now, but the API surface is an unguarded footgun for later stages that may wire config/env to `baseUrl`. |
| **Risk / Impact** | Credential exfiltration / SSRF: if a future caller passes a user-influenced or non-OpenRouter URL, every chat/embedding call leaks the OpenRouter key to that host. Severity rises to High once a config UI surfaces `baseUrl`. |
| **Evidence** | `this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;` (line 114); `const url = \`${this.baseUrl}/chat/completions\`;` (134) and `\`${this.baseUrl}/embeddings\`` (208) — no validation of scheme or host. |
| **Recommendation** | Validate `baseUrl` at construction: require `https:` scheme and either pin to `https://openrouter.ai/api/v1` or allowlist a small set of hosts (incl. a test/local override). Reject anything else with `LLMConfigError`. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | `new LLMClient({ apiKey: 'k', baseUrl: 'http://attacker.example' })` → `LLMConfigError`; `baseUrl: 'https://openrouter.ai/api/v1'` → succeeds; `baseUrl: 'file:///etc/passwd'` → rejected. |
| **Acceptance Criteria** | `baseUrl` is rejected unless it is an `https:` URL on an allowlisted host. No non-https or non-allowlisted host can receive the Bearer token. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed lines 114, 134, 208 send the bearer token to the unvalidated baseUrl. Medium is correct for stage-01's operator-configured scope; would be High with a config UI. |

---

### [ ] S2-20260630: RSS fetcher has no SSRF guard — feed URLs can reach internal/metadata endpoints

| Field | Value |
|---|---|
| **ID** | `S2-20260630` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/pipeline/rss-fetcher.ts:111-113` |
| **Description** | The fetcher calls `fetch(feedUrl, { signal: AbortSignal.timeout(...) })` with no validation of URL scheme or target host, and native fetch follows redirects by default. Feed URLs are an attacker-controllable ingress surface once stage-02 exposes feed configuration via GUI. A configured feed URL may use a non-http(s) scheme or target internal/loopback/link-local addresses (e.g. `http://169.254.169.254/` cloud metadata). |
| **Risk / Impact** | SSRF: an attacker who can influence the feed list can make the pipeline fetch internal cloud-metadata endpoints or private services, exfiltrating responses into the parsed article stream. Becomes High at stage-02 when feeds are user-configurable. |
| **Evidence** | `response = await fetch(feedUrl, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });` — no scheme allowlist, no host/IP blocklist, `redirect: 'error'` not set. |
| **Recommendation** | Before fetching, validate the URL: (1) `new URL(feedUrl)` succeeds; (2) `protocol` is `http:` or `https:`; (3) the resolved hostname is not loopback, link-local, RFC1918 private, or cloud-metadata addresses unless explicitly opted in; (4) pass `redirect: 'error'` (or `follow` with per-redirect re-validation). Extract into a shared `assertSafeFetchUrl()` helper reused by the scraper (S3). |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | `'file:///etc/passwd'` → FeedFailure (rejected); `'http://169.254.169.254/latest/meta-data/'` → FeedFailure; `'http://127.0.0.1:6379/'` → FeedFailure; a feed returning 302 to `'http://169.254.169.254/'` → FeedFailure. |
| **Acceptance Criteria** | No feed URL whose effective (post-redirect) target resolves to a non-http(s) scheme, loopback, link-local, or RFC1918 address is fetched; such URLs produce a FeedFailure with an SSRF-class errorType and the run continues. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed no scheme/host guard and default redirect-following. Medium is correct for operator-configured stage-01; guard warranted before delivery. |

---

### [ ] S3-20260630: Scraper has no SSRF guard — article URLs (attacker-controllable via RSS) reach internal endpoints

| Field | Value |
|---|---|
| **ID** | `S3-20260630` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/pipeline/scraper.ts:139-141` |
| **Description** | The scraper calls `fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })` with no URL scheme/host validation. Article URLs come from RSS `item.link` / Atom `entry.links[0].href` — attacker-controllable via the feed. Same SSRF class as S2; redirects followed by default. The SSRF surface here is wider than S2 because article links are content published by the feed, not just the feed URL itself. |
| **Risk / Impact** | SSRF via article links: a malicious feed can set an article link to an internal URL; the scraper fetches it and Readability extracts its body into article content, which flows to the LLM drafter — a data-exfiltration / internal-service-probing vector. Severity rises to High at stage-02. |
| **Evidence** | `response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });` — no scheme/host guard; `redirect` left at default `follow`. |
| **Recommendation** | Apply the same `assertSafeFetchUrl()` guard as S2 before fetching article URLs. A blocked URL yields the existing never-throws fallback `ScrapeResult` with `source: 'fallback'` and an SSRF-class `error` string. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | `scrape('http://169.254.169.254/', fb)` → `source: 'fallback'`, error set, no internal fetch; `scrape('file:///etc/passwd', fb)` → fallback; a 302 to an internal host → fallback. |
| **Acceptance Criteria** | No article URL whose effective target resolves to a non-http(s) scheme, loopback, link-local, or RFC1918 address is fetched; it returns a fallback ScrapeResult and never throws. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the unvalidated fetch and that article links originate from RSS content (wider surface than S2). Medium is correct. |

---

### [ ] S4-20260630: Parity-run output filename built from `config.name` unsanitized — path traversal

| Field | Value |
|---|---|
| **ID** | `S4-20260630` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `worker/src/parity-run.ts:81-85`; `shared/src/pipeline/types.ts:363-383` |
| **Description** | The parity-run harness builds the output filename from `config.name` without sanitization: `const outFile = join(outDir, \`${config.name}-${today}.md\`);`. `createNewsletterConfig` validates only `topics` and `feeds` are non-empty — it does NOT validate or sanitize `name` for path separators or traversal sequences. A config with `"name": "../../etc/cron.d/evil"` would cause `writeFileSync` to write outside `./output/`. |
| **Risk / Impact** | Path traversal via a malicious or mistyped newsletter config file. In stage 01 the operator controls the config, so blast radius is self-inflicted. Stage 02+ persists newsletter definitions to Appwrite and stage 06 allows UI editing of `name` — at that point an attacker-controlled `name` becomes an arbitrary-file-write primitive from the worker. |
| **Evidence** | `parity-run.ts:84`: `const outFile = join(outDir, \`${config.name}-${today}.md\`);` — raw user input. `types.ts:374`: `name: input.name,` — no sanitization in the factory. |
| **Recommendation** | Sanitize `config.name` in `createNewsletterConfig` (root cause, protects every consumer): reject names containing `/`, `\\`, `..`, or null bytes, OR strip non-`[a-zA-Z0-9-_]` characters. Keep the validation in the factory so stage 03/06 inherit it. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `name: '../../evil'` → output written inside `./output/` with sanitized basename; `createNewsletterConfig` test for `name` containing `/` or `..` (pin chosen behavior). |
| **Acceptance Criteria** | A newsletter config with path separators or `..` in `name` cannot cause a file write outside `./output/`. `createNewsletterConfig` sanitizes `name` so it is a safe filename component. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed `path.join(outDir, '../../x.md')` resolves above outDir and `writeFileSync` does not confine. Medium is correct — parity-run is a dev harness, but the unsanitized name flows through the shared config factory. |

---

### [ ] C3-20260630: `withRetry` retries non-retryable 4xx errors (400/401/403) — wasted latency + rate-limit risk

| Field | Value |
|---|---|
| **ID** | `C3-20260630` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/llm-client.ts:286-307` |
| **Description** | `withRetry` retries on EVERY thrown error uniformly, including non-retryable HTTP statuses (400 bad request, 401 unauthorized, 403 forbidden, 404 not found). There is no classification of retryable (429, 5xx, network) vs permanent errors. A 401/403 (bad/missing key) or 400 (malformed prompt) is retried 3× with 1s+2s backoff per article, wasting time and needlessly hitting the OpenRouter API; some providers rate-limit or flag repeated auth failures. |
| **Risk / Impact** | On an auth or input-shape failure the tag/score phases burn ~3s per article (3s × N articles = minutes) before failing, instead of failing fast. Repeated 401s can trip provider-side rate limiting/lockout. |
| **Evidence** | `for (let attempt = 0; attempt < maxAttempts; attempt++) { try { return await fn(); } catch (error) { lastError = error; ... await sleep(delay); } }` — the catch has no inspection of `error`; every thrown error (including `LLMHttpError` with statusCode 400/401/403) triggers another attempt. |
| **Recommendation** | Add a `retryOn?: (error: unknown) => boolean` option (default: retry on `LLMTimeoutError`, `LLMNetworkError`, and `LLMHttpError` with statusCode 429 or >= 500). Non-retryable `LLMHttpError` (4xx except 429) and `LLMConfigError` should re-throw immediately without consuming remaining attempts. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | `withRetry(fn)` where fn throws `LLMHttpError(401)` → fn called once, re-thrown immediately, no sleep; `LLMHttpError(429)` → retried; `LLMHttpError(500)` → retried; `LLMTimeoutError` → retried. |
| **Acceptance Criteria** | 4xx (except 429) and config errors are not retried. 429, 5xx, timeout, and network errors are retried per the backoff schedule. Total attempt count for a permanent error is 1. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the catch inspects no error property; every thrown error triggers another attempt. Medium is correct — no happy-path correctness impact, but real wasted latency and rate-limit risk. |

---

### [ ] C4-20260630: `vectors.ts` has no NaN/Infinity input guard — zero-guard bypassed by NaN

| Field | Value |
|---|---|
| **ID** | `C4-20260630` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/vectors.ts:7-33` |
| **Description** | The vector math guards zero-division (zero vector → cosine returns 0) but does NOT guard against NaN/Infinity in input vectors. `norm` of a vector containing NaN returns NaN; `cosine` then computes `dot(a,b)/(NaN*nb)` = NaN, and since `NaN === 0` is false the zero-guard is bypassed. NaN then propagates into MMR scoring (see C2). This finding scopes the guard to the `vectors` module itself, which is independently unsafe for any caller. |
| **Risk / Impact** | Silent data corruption in any consumer of `vectors.ts`. The only current caller is MMR (covered by C2), but `vectors` is an exported general helper. Any non-JSON vector source (manual construction, future normalization that divides by zero) triggers it. |
| **Evidence** | `function norm(a) { ... sum += a[i] * a[i]; return Math.sqrt(sum); }` — no `Number.isFinite` check. `cosine`: `if (na === 0 || nb === 0) return 0; return dot(a,b)/(na*nb);` — NaN norms are not 0, so the guard does not fire. |
| **Recommendation** | Validate inputs in `dot`, `norm`, and `cosine`: throw if any element is not finite (`!Number.isFinite(x)`). In `cosine`, return 0 (or throw) if the computed similarity is not finite. Optionally have `argMax` throw on NaN inputs. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | `cosine([NaN, 0], [1, 0])` throws or returns 0, and `Number.isNaN(result) === false`; `cosine([1, 0], [Infinity, 0])` does not return NaN; `norm([NaN])` does not return NaN silently; `argMax([NaN, 1, 2])` throws or documents behavior. |
| **Acceptance Criteria** | No function in vectors.ts returns NaN/Infinity for any finite or non-finite input. Bad inputs raise a typed error rather than silently corrupting MMR selection. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator traced the zero-guard bypass: NaN !== 0, so the guard does not fire. Medium is correct — only current caller is MMR (C2), but vectors is a general exported helper. |

---

### [ ] C5-20260630: RSS fetcher missing cross-feed deduplication despite Intent line promising "deduplicated"

| Field | Value |
|---|---|
| **ID** | `C5-20260630` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/rss-fetcher.ts:66-99` |
| **Description** | Feature-02's Intent line states the fetcher turns a feed list into a "deduplicated set of in-date-range Article records." The implementation concatenates articles from every feed (`articles.push(...result.value.articles)`) with no cross-feed deduplication. Two feeds carrying the same article link (common in syndicated/planet-style aggregators) yield duplicate Article records, which flow downstream to scrape/tag/score — wasting LLM calls and producing duplicate newsletter items. No acceptance criterion tests dedup, and the Spec paragraph omits it. |
| **Risk / Impact** | Duplicate articles inflate LLM token spend (scrape+tag+score+embed each duplicate), and can surface as duplicate newsletter items if the orchestrator does not dedup later. The Intent-line contract is not met; downstream phases and stage-03 run-record counts over-report. |
| **Evidence** | `for (const result of settled) { if (result.status === "fulfilled") { if ("failure" in result.value) { failedFeeds.push(result.value.failure); } else { articles.push(...result.value.articles); } } }` — no `Set`/`Map` keyed on link anywhere in `fetch()`. |
| **Recommendation** | Either (a) deduplicate by a stable key (recommended: `Article.link`, falling back to `title` when link is empty) after concatenation and before returning `FetchResult`, or (b) if dedup is deliberately the orchestrator's job, update the feature-02 Intent line and add a note so the handoff does not claim dedup is performed here. Confirm with the PM which layer owns dedup. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Two feeds both containing the same `<link>` → result.articles contains the article exactly once; two feeds with the same title but different links → both retained (dedup keyed on link); FetchResult shape test still partitions correctly after dedup. |
| **Acceptance Criteria** | Given two feeds sharing an article link, the returned articles contain that article exactly once; the Intent line's "deduplicated" claim holds, or the Intent is amended to record that dedup is deferred. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed no dedup logic exists and the feature-02 Intent line explicitly promises "deduplicated." Meaningful divergence (affects cost/parity), not stylistic. Medium is correct. |

---

### [ ] C6-20260630: Tagger/scorer duplicate the format-prompt + withRetry + parse sequence in two code paths each

| Field | Value |
|---|---|
| **ID** | `C6-20260630` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/tagger.ts:150-180, 199-215`; `shared/src/pipeline/scorer.ts:208-268, 297-326` |
| **Description** | The tagger has two separate code paths that format the prompt and call withRetry: the private `tryGenerateTags` (used by the halt-aware `tagArticles` loop) and the public `generateTags`. They duplicate the full prompt-format + withRetry + parse sequence, including `getModelName('tagger')`, `DEFAULT_TIMEOUT_MS`, and the `TAGGER_PROMPT_TEMPLATE.replace(...)` substitution. `tryGenerateTags` does NOT delegate to `generateTags` — it reimplements the same logic inline. The spec (feature-04:23) describes `tagArticles` as wrapping `generateTags`; the implementation inverts that. The scorer has the identical duplication pattern (`tryCalculateScore` vs `calculateScore`). |
| **Risk / Impact** | Two copies of the prompt-format + withRetry + parse logic per file. Future edits (adding `temperature`, tightening parse per C1) must be made in two places — easy to update one and forget the other, producing silent behavioral divergence between batch and single-article entry points. Today the two are functionally equivalent, but the structural duplication is a latent drift bug. |
| **Evidence** | `tagger.ts:186-192` (formatPrompt, used by tryGenerateTags) and `tagger.ts:200-204` (inline format in generateTags) are two copies of the same `.replace(/\{title\}/g, title).replace(/\{truncated_content\}/g, truncatedContent)` logic. `tagger.ts:156-165` and `:206-212` are two copies of the same chatCompletion invocation. Same pattern in scorer.ts. |
| **Recommendation** | Extract a private `callLLM(title, content): Promise<string>` that does format+withRetry+return-raw-content; have both `tryGenerateTags` (wrapping with attempts-tracking) and `generateTags` (wrapping with parseTags) call it. Apply the same de-duplication to scorer.ts. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Add a test that both paths produce byte-identical prompts for the same input (would fail if one path drifts); re-run the full tagger + scorer suites after refactor. |
| **Acceptance Criteria** | tagger.ts has a single implementation of the format-prompt + withRetry + parse sequence; `tryGenerateTags` and `generateTags` share it via delegation. scorer.ts same. All existing tests remain green. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed two pairs of duplicated logic (tagger and scorer). Medium is correct — no current behavioral divergence, but latent drift risk. |

---

### [ ] C7-20260630: Orchestrator does not handle the `SelectionResult.failures` invariant pin (target < candidateCount)

| Field | Value |
|---|---|
| **ID** | `C7-20260630` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/orchestrator.ts:243-271`; `shared/src/pipeline/mmr-selection.ts:188-202` |
| **Description** | The stage's carried-forward PIN (stage-01-pipeline-engine.md:51) explicitly states the invariant `selectedArticles.length + failures.length === totalArticles` only holds when `target ≥ candidateCount`, and that feature-07's orchestrator "must handle this: either assert target ≥ candidateCount at the selectDiverse call site, or treat the non-selected-above-threshold articles explicitly." The orchestrator does NEITHER. When `config.newsItems < candidateCount` (e.g. newsItems=3 but 8 articles pass threshold), the 5 passed-threshold-but-not-selected articles are silently dropped — they appear in neither `selectedArticles` nor `failures`. The orchestrator records `selectionResult` as-is and proceeds to draft. The pin says this "is acceptable for the parity run since production target = 16 ≥ typical candidateCount," so it is not a stage-gate blocker, but the orchestrator has zero defense against the invariant violation. |
| **Risk / Impact** | Stage 03 run-record accounting will be incorrect whenever target < candidateCount: `totals.selected + phases.selection.failures.length ≠ totals.scored`. The operator cannot tell from the PipelineResult how many above-threshold articles were considered but not selected. No functional impact on the parity run (target=16 dominates), but the latent invariant violation is unhandled at the integration seam. |
| **Evidence** | `orchestrator.ts:243-246`: `const selectionResult = await selector(scoreResult.scoredArticles, config.newsItems);` — no target/candidateCount assertion. `:248`: `if (selectionResult.selectedArticles.length === 0)` — only fatality check. `mmr-selection.ts:188-202` returns selected + failures without a `not-selected` category. |
| **Recommendation** | Add a third `SelectionFailure.reason` category `'not-selected'` and have mmr-selection.ts record every passed-threshold-but-unselected candidate in `failures` with that reason, so the invariant holds universally. If deferred to stage 03, add a defensive assertion or comment at `orchestrator.ts:243` documenting the unhandled case and log a warning when `selectionResult.selectedArticles.length + selectionResult.failures.length !== selectionResult.totalArticles`. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Mock selector returns `{ selectedArticles: [a1,a2,a3], failures: [], totalArticles: 8, candidateCount: 8, targetCount: 3 }` (target < candidateCount) → PipelineResult surfaces the 5 unaccounted articles; assert `totals.selected + phases.selection.failures.length === totals.scored` on a happy path where target < candidateCount. |
| **Acceptance Criteria** | When `config.newsItems < selectionResult.candidateCount`, the PipelineResult accounts for every scored article: `totals.selected + phases.selection.failures.length === totals.scored`, OR the orchestrator explicitly documents/asserts the invariant gap. The stage PIN's requirement that feature-07 "handle this" is satisfied by code, not just by the parity-run convenience argument. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed feature-06 AC requires the invariant, mmr-selection returns only selected + below-threshold/embedding-failed failures, and orchestrator neither asserts nor surfaces the gap. Medium is correct — only manifests when target < candidateCount. |

---

### [ ] N1-20260630: `cleanContent` spec drift — markdown-link preservation contradicts "faithful port" claim

| Field | Value |
|---|---|
| **ID** | `N1-20260630` |
| **Severity** | Medium |
| **Category** | Anti-cheat (SSC-native) |
| **Location** | `shared/src/pipeline/scraper.ts:65-98` |
| **Description** | The feature-03 Intent, Spec, Constraints, and Acceptance criteria all state `cleanContent` is a faithful, byte-for-behavior port of the legacy `scraper.py:_clean_content`, including the exact regexes and order. The implementation deviates: before the bare-URL strip it extracts markdown-link URLs (`](https://...)`), replaces them with `@@MDLINKURL{i}@@` placeholders, strips bare URLs, then restores the link URLs. The legacy Python strips ALL URLs including those inside markdown-link syntax. This is a deliberate, documented reconciliation of an internally-inconsistent spec (the testing approach requires links to survive), but it means the "byte-faithful parity surface" claim in the handoff is false. The placeholder sentinel could also leak into output if the restore regex fails to match. |
| **Risk / Impact** | The stage's defining parity check compares TS pipeline output against the legacy Python. If the parity check assumes cleanContent is byte-faithful (as the spec claims), a content-level diff will diverge on every article containing markdown links — not because the extraction engine changed, but because cleaning changed. The drift is documented in code but not surfaced in the handoff/parity-check basis, risking a misleading parity judgment. |
| **Evidence** | `text = text.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (_m, url) => { ... return `](@@MDLINKURL${i}@@)`; });` then `text = text.replace(URL_PATTERN, "");` then `text = text.replace(/@@MDLINKURL(\d+)@@/g, (_m, i) => linkUrls[Number(i)] ?? "");`. Comment at lines 65-74 acknowledges the deviation. |
| **Recommendation** | Resolve the spec contradiction at the spec level: have the PM decide whether (a) cleanContent is truly byte-faithful (drop markdown-link preservation, accept that extracted links become `[text](`, update the scraper test to not assert link survival), or (b) cleanContent intentionally diverges (amend feature-03 Intent/Constraints/handoff to state cleanContent is a *modified* port). Whichever is chosen, guard sentinel leakage: after the restore step, strip any surviving `@@MDLINKURL\d+@@` tokens. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `cleanContent` on `See [related](https://x.com/y) and bare https://x.com` → assert the legacy-exact OR modified output matching the PM decision; `cleanContent` on a malformed link with no matching restore → no `@@MDLINKURL` sentinel in output; document the chosen parity surface in the handoff. |
| **Acceptance Criteria** | The cleanContent transformations reported in the handoff match the actual code; the Intent/Constraints "faithful port" wording is either made true or amended to "modified port"; no sentinel placeholder can leak into returned content. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the sentinel logic and that feature-03 spec declares cleanContent a "faithful port" and "the parity surface." Real contradiction, not stylistic. Medium is correct. |

---

### [ ] N2-20260630: `MIN_EXTRACTED_TEXT_LENGTH=200` — un-specified fallback condition, fixture-calibrated magic number

| Field | Value |
|---|---|
| **ID** | `N2-20260630` |
| **Severity** | Medium |
| **Category** | Anti-cheat (SSC-native) |
| **Location** | `shared/src/pipeline/scraper.ts:116, 200-206` |
| **Description** | The feature-03 Spec and Acceptance criteria define exactly when `scrape` returns `source: 'fallback'`: non-2xx, network/timeout error, empty body, `Readability.parse() === null`, or empty `article.content`. The implementation adds a sixth, un-specified condition: `article?.textContent?.trim().length < MIN_EXTRACTED_TEXT_LENGTH` (constant `200`). This threshold is not in the spec, not configurable, and its comment explicitly calibrates it against the test fixture ("The smallest legitimate fixture article is ~497 chars, so 200 leaves a wide margin"). A real article whose Readability-extracted text is between 1 and 199 chars is silently sent to fallback — behavior the spec does not describe and no test asserts. |
| **Risk / Impact** | (1) Spec drift — the fallback contract in the AC is narrower than the code; a short-but-valid article gets 'fallback' when the spec says 'extracted'. (2) Fixture-calibrated magic number — 200 was chosen relative to the 497-char fixture, so the value is tuned to keep current tests green rather than derived from a real quality threshold. The handoff does not mention this threshold. |
| **Evidence** | `const MIN_EXTRACTED_TEXT_LENGTH = 200;` ... `if (article === null || !article.content || textLength < MIN_EXTRACTED_TEXT_LENGTH) { return { ... source: "fallback", error: "not-readerable" }; }`. Comment: "The smallest legitimate fixture article is ~497 chars, so 200 leaves a wide margin." |
| **Recommendation** | Either (a) remove the threshold and rely solely on the spec's conditions, or (b) if a min-length guard is genuinely needed, add it to the feature-03 spec (Spec + AC + handoff), make it env-configurable like `SCRAPER_TIMEOUT_MS`, and choose the value from a real corpus threshold rather than the fixture size. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `scrape` a 100-char extracted article → assert 'extracted' (if threshold removed) or 'fallback' with a spec-documented reason (if kept); `MIN_EXTRACTED_TEXT_LENGTH` override via env → respected (if kept); handoff lists the length-floor fallback condition. |
| **Acceptance Criteria** | The set of conditions under which scrape returns 'fallback' matches the feature-03 spec exactly, or the spec is amended to include the length floor and the value is not fixture-derived; the handoff reports the condition. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the 200 constant, the un-specified condition, and the fixture-calibrated comment. Real spec drift. Medium is correct — biases toward fallback rather than false positive. |

---

### [ ] N3-20260630: Scorer/tagger parse-failure tests miss the actual `Number()` failure boundary (empty, Infinity, hex)

| Field | Value |
|---|---|
| **ID** | `N3-20260630` |
| **Severity** | Medium |
| **Category** | Anti-cheat (SSC-native) |
| **Location** | `shared/src/pipeline/__tests__/scorer.test.ts:251-278`; `shared/src/pipeline/__tests__/tagger.test.ts:159-189` |
| **Description** | The parse-path tests assert only against clearly non-numeric inputs ("Not a number", "  , spaced , ,empty, ") that are unambiguously far from the parser's failure boundary. The actual failure boundary of the scorer's `Number()` parse is empty-string/whitespace/hex — none of which are tested (see C1). The tests pass green while a whole class of realistic failure modes (blank LLM body) silently scores 0 and enters MMR. This is the test-suite-shaped-hole anti-cheat pattern: the tests exercise only the cases the implementation handles, not the cases where it diverges from the spec'd legacy-faithful parse. |
| **Risk / Impact** | A verifier reading the green test suite would conclude the parse-failure path is exercised and correct. It is not — the boundary case that actually diverges from legacy (empty response) is absent, so the silent-degradation bug in C1 survives verification. |
| **Evidence** | `scorer.test.ts:252-277` — the only parse-failure test uses `okContent("Not a number")`. No test for `okContent("")`, `okContent("   ")`, `okContent("0x10")`. `tagger.test.ts:159-189` — parse edge cases test "  , spaced , ,empty, " and a 15-tag overflow; no empty-response case. |
| **Recommendation** | Add the parse-boundary test cases listed in C1's suggested_tests. For the tagger, add a test: `okContent("")` → `tags: []` and the article is in `taggedArticles` with `tags: []` (confirming the no-throw empty-fallback path is intentional). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `okContent("")` → `failures.length===1`, reason 'parse', `scoredArticles.length===0`; `okContent("   ")` → same; `okContent("0x10")` → same; tagger `okContent("")` → `taggedArticles[0].tags === []` and not in failures. |
| **Acceptance Criteria** | Scorer parse-failure tests cover the actual `Number()` failure boundary (empty, whitespace, hex), not just obviously-non-numeric strings. Tagger has an explicit test that an empty LLM response yields `tags: []` without throwing. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the parse-failure tests use only "Not a number"/"garbage" — both yield NaN and trigger the parse-failure path correctly, but the C1 boundary (empty, hex) is never tested. Medium is correct — directly enables C1 to hide. |

---

### [ ] N4-20260630: MMR test over-asserts the `selectedArticles + failures === totalArticles` invariant as universal

| Field | Value |
|---|---|
| **ID** | `N4-20260630` |
| **Severity** | Medium |
| **Category** | Anti-cheat (SSC-native) |
| **Location** | `shared/src/pipeline/__tests__/mmr-selection.test.ts:405-438`; `shared/src/pipeline/mmr-selection.ts:188-202` |
| **Description** | The shape-invariants test asserts `result.selectedArticles.length + result.failures.length === articles.length`, but the fixture is constructed so `target=2` and `candidateCount=2` (only 2 articles pass the `minScore:7` threshold out of 4 input), so `target >= candidateCount` and the invariant trivially holds. There is NO test covering `target < candidateCount` where the invariant is known to break (per the stage PIN). The test suite thus over-asserts the invariant by only exercising the condition where it is true, masking the known violation (C7). |
| **Risk / Impact** | The invariant is asserted as a universal property in the test, but it only holds under a condition the test always satisfies. A future refactor or a stage-03 consumer reading the test as proof of the invariant will be misled. The known gap (target < candidateCount) has zero test coverage. |
| **Evidence** | Fixture: 4 articles with scores [9,8,6,5], `minScore:7` → candidateCount=2 (scores 9,8), `target:2` → target===candidateCount, invariant holds trivially. Line 429-431 asserts the invariant. No test sets `target < candidateCount` with a non-empty selection. |
| **Recommendation** | Add a test that constructs `target < candidateCount` with a non-empty selection (e.g., 4 candidates passing threshold, `target:2` → 2 selected, 2 silently dropped) and assert the ACTUAL current behavior: `selectedArticles.length + failures.length !== totalArticles` (documenting the gap), OR assert the invariant holds after fixing C7 by adding the `not-selected` failure category. The test must not pretend the invariant is universal when the spec says it is not. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | 4 candidates pass threshold, `target:2` → assert `selectedArticles.length === 2` AND `failures.length === 2` (the 2 below-threshold) AND `selectedArticles.length + failures.length === 4` only if the `not-selected` category is added; otherwise assert the documented gap. |
| **Acceptance Criteria** | A test exists covering `target < candidateCount` with a non-empty selection, asserting the actual behavior (invariant holds after fix, or documented gap before fix) — not just the trivial case where it always holds. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the fixture has target===candidateCount (trivial invariant) and no target<candidateCount test. Over-asserts a universal invariant from a trivial case. Medium is correct — masks C7. |

---

### [ ] P1-20260630: RSS fetcher and scraper buffer entire response body with no size cap — OOM/DoS

| Field | Value |
|---|---|
| **ID** | `P1-20260630` |
| **Severity** | Medium |
| **Category** | Performance |
| **Location** | `shared/src/pipeline/rss-fetcher.ts:131`; `shared/src/pipeline/scraper.ts:170` |
| **Description** | Both ingress surfaces buffer the entire response body into memory via `await response.text()` with no size cap. Node's native fetch (undici) imposes no default body-size limit. `config.ts` already defines `DEFAULT_MAX_CONTENT_LENGTH = 70000` but neither module references it. A malicious feed or article URL serving a multi-gigabyte body is fully read into a JS string before parsing/extraction, risking OOM/DoS on the worker. Because fetches run concurrently (Promise.allSettled), amplification is N×bodySize. |
| **Risk / Impact** | Memory-exhaustion DoS: a single hostile feed/article URL (or several concurrent ones) can allocate gigabytes of string memory and crash the worker. The existing `DEFAULT_MAX_CONTENT_LENGTH` constant shows the legacy pipeline intended a cap; its absence here is a parity gap as well as a DoS vector. |
| **Evidence** | `rss-fetcher.ts:131` `body = await response.text();` and `scraper.ts:170` `body = await response.text();` — neither checks `Content-Length` nor truncates the stream. `config.ts:21` defines `DEFAULT_MAX_CONTENT_LENGTH = 70000`, unused by either file. |
| **Recommendation** | Before reading the body, check `response.headers.get('content-length')` and reject (fetcher: FeedFailure; scraper: fallback) if it exceeds a configurable max. For chunked/no-header responses, read the stream with a capped reader (abort once the cap is exceeded). Apply the same cap in both files. |
| **Effort** | M |
| **Confidence** | Medium |
| **Suggested Tests** | Feed returning `Content-Length: 500000000` → FeedFailure; feed returning chunked body > cap → FeedFailure (read aborted at cap); scrape returning `Content-Length > cap` → `source: 'fallback'`, error 'oversized'. |
| **Acceptance Criteria** | A response whose body exceeds the configured max content length is not fully buffered; the fetcher records a FeedFailure and the scraper returns a fallback ScrapeResult, without OOM. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed both `response.text()` calls and that `DEFAULT_MAX_CONTENT_LENGTH` is imported only by tagger/scorer for prompt truncation, never by the fetchers. Medium is correct. |

---

### [ ] M1-20260630: Divergent phase-name types — `PhaseName` (5 phases) vs `PipelinePhase` (6 phases, includes scrape)

| Field | Value |
|---|---|
| **ID** | `M1-20260630` |
| **Severity** | Medium |
| **Category** | Maintainability |
| **Location** | `shared/src/pipeline/types.ts:74-79, 234-240` |
| **Description** | Two overlapping phase-name types exist: `PhaseName` = `fetch|tag|score|selection|draft` (5 phases, omits `scrape`) and `PipelinePhase` = `fetch|scrape|tag|score|selection|draft` (6 phases, includes `scrape`). The pipeline actually has 6 phases (see `PipelineResult.phases` which carries `scrape: ScrapeSummary`), so `PhaseName` is an incomplete/incorrect contract. Any switch exhaustiveness check against `PhaseName` silently misses the scrape phase. |
| **Risk / Impact** | Consumers using `PhaseName` will miss the scrape phase in switches/mapping, producing silent gaps in telemetry/run records (stage 03). The duplicated, divergent enum is a maintainability trap. |
| **Evidence** | `export type PhaseName = "fetch" | "tag" | "score" | "selection" | "draft";` (74-79) vs `export type PipelinePhase = "fetch" | "scrape" | "tag" | "score" | "selection" | "draft";` (234-240). `PipelineResult.phases` includes `scrape: ScrapeSummary`. |
| **Recommendation** | Collapse to a single `PipelinePhase` (6 phases including `scrape`). Either make `PhaseName` an alias of `PipelinePhase` or remove it; if a 5-phase subset is genuinely needed for the consecutive-error-halt phases (tag/score), name it distinctly (e.g. `HaltPhase`). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Type-level: a switch on every `PipelinePhase` member must be exhaustive (no `default` reaching); grep: only one phase-enum type is exported from `types.ts`. |
| **Acceptance Criteria** | Exactly one canonical phase-name type covering all 6 phases; no divergent duplicate. All phase exhaustiveness checks include `scrape`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the two divergent types and that PipelineResult.phases includes scrape. Medium is correct — no current runtime bug, but latent exhaustiveness trap. |

---

### [ ] M2-20260630: Exported `PhaseResult`/`ItemFailure` generics are dead — no concrete result implements them

| Field | Value |
|---|---|
| **ID** | `M2-20260630` |
| **Severity** | Medium |
| **Category** | Maintainability |
| **Location** | `shared/src/pipeline/types.ts:106-116` |
| **Description** | The generic `PhaseResult<TSuccess, TFailure>` and `ItemFailure<TItem = Article>` are exported as the documented "common shape" for phase results, but none of the concrete phase results (`FetchResult`, `TagResult`, `ScoreResult`, `SelectionResult`, `DraftResult`) implement or extend them. The concrete results carry richer, phase-specific fields (`halted`, `haltReason`, `consecutiveErrors`, `candidateCount`, `lambda`, `attempts`, etc.) that the generic shape doesn't model. feature-02 spec explicitly directed removing the `FetchResult=PhaseResult<...>` alias, orphaning `PhaseResult`. |
| **Risk / Impact** | Misleading API: the exported generic implies a uniform phase-result shape that the real results do not conform to. Future features importing `PhaseResult` will build against a phantom contract and have to reconcile with the concrete types. |
| **Evidence** | `export interface PhaseResult<TSuccess, TFailure> { successes: TSuccess[]; failures: TFailure[]; }` (113-116) and `ItemFailure<TItem>` (107-110) — neither is referenced by `FetchResult` (292-296), `TagResult`, `ScoreResult`, `SelectionResult`, or `DraftResult`. |
| **Recommendation** | Either (a) remove `PhaseResult` and `ItemFailure` if no concrete result uses them, or (b) have the concrete results extend a refined generic. Prefer (a) for stage 01 to keep the contract surface honest; reintroduce a generic only when ≥2 phase results actually share a shape. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Grep `PhaseResult` and `ItemFailure` usages across `shared/` and `worker/` — expect zero non-test references if removed; `tsc --noEmit` passes after removal. |
| **Acceptance Criteria** | No exported type is unused by all concrete implementations. If a generic phase-result type is kept, ≥2 concrete results extend it. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed no concrete result implements either generic. Dead exported types that mislead callers. Medium is correct — public API surface. |

---

### [ ] M3-20260630: Scorer carries dead content-truncation computation + misleading `content` API fields

| Field | Value |
|---|---|
| **ID** | `M3-20260630` |
| **Severity** | Medium |
| **Category** | Maintainability |
| **Location** | `shared/src/pipeline/scorer.ts:33-43, 52-72, 274-289` |
| **Description** | `SCORER_PROMPT_TEMPLATE` accepts a `ScorerPromptArgs` interface with `truncatedContent?` and `content?` fields that the prompt body explicitly omits and the implementation never reads. `formatPrompt` computes `truncatedContent = content.slice(0, this.maxContentLength)` and passes it into the template, which ignores it — dead computation. The `maxContentLength` constructor option and the `content` parameter likewise have no behavioral effect. |
| **Risk / Impact** | Future maintainers may believe the scorer considers article content (it does not — legacy parity), or may 'fix' the unused content by adding it to the prompt, breaking parity. The dead slicing wastes a small amount of memory on large articles. Low runtime impact; medium comprehension cost. |
| **Evidence** | `scorer.ts:39-42` comment: "Accepted for signature symmetry; the prompt body omits content." `scorer.ts:281`: `const truncatedContent = content.slice(0, this.maxContentLength);` then passed at :287 into `SCORER_PROMPT_TEMPLATE` which never reads it. |
| **Recommendation** | Either (a) remove `truncatedContent`/`content`/`maxContentLength` from the scorer and document that content is intentionally not used (cleanest), or (b) keep them but add an inline `// intentionally unused — legacy scorer prompt omits content` at the slicing site. Prefer (a) for stage 01; re-add in stage 06 if prompt editing makes content relevant. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | If option (a): a test asserting `calculateScore` does not read `article.content` — two articles identical except content produce identical prompts. |
| **Acceptance Criteria** | The scorer has no dead content-truncation computation, OR the dead path is explicitly marked with an inline comment naming the legacy-parity reason. A maintainer reading scorer.ts can determine within one read whether content is used. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the interface fields, doc comments, and formatPrompt slicing all confirm the content path is accepted-but-unused. Medium is correct — not a Nit because the unused fields invite a future caller to believe content reaches the prompt. |

---

### [ ] O1-20260630: `haltReason` interpolates raw LLM output verbatim — unbounded PII/prompt-injection echoes into run records

| Field | Value |
|---|---|
| **ID** | `O1-20260630` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `shared/src/pipeline/tagger.ts:130`; `shared/src/pipeline/scorer.ts:94, 187` |
| **Description** | The halt reason strings interpolate the raw LLM error message verbatim: `haltReason: \`... (last error: ${attempt.error})\``. `ScoreParseError.message` is `Scorer returned a non-numeric response: ${raw}` where `raw` is the FULL raw LLM response content. So a chatty/garbage LLM response (which could contain anything the model emitted — prompt-injection echoes, PII from the article content fed to the model) is interpolated directly into `haltReason`, which stage-03 will persist to Appwrite run records. |
| **Risk / Impact** | `haltReason` is a string destined for run-record persistence and potentially operator-visible logs. If the LLM returns a non-numeric response containing user article content, PII, or prompt-injection echoes, that text is preserved verbatim in `haltReason`. Lower severity because the content was already in the prompt, but it surfaces article content in an operator-facing error string in an unstructured, un-redacted form. |
| **Evidence** | `scorer.ts:94`: `super(message ?? \`Scorer returned a non-numeric response: ${raw}\`);` — raw is the full LLM content. `scorer.ts:257`: `error: error.message` for parse path. `scorer.ts:187`: `haltReason: \`... (last error: ${attempt.error})\``. Same pattern in `tagger.ts:130`. |
| **Recommendation** | Truncate `attempt.error` when interpolating into `haltReason` (e.g. first 200 chars) and strip newlines. For parse failures, store `raw` separately on `ScoreParseError` (already there) but put only a truncated diagnostic in the human-readable `haltReason`. Add a redaction note in the stage-03 handoff that `haltReason` may contain LLM-emitted text and should be treated as untrusted content in any UI/log rendering (escape on display). |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Mock client throws an error whose `.message` contains a newline and 500 chars of garbage; assert `haltReason` is truncated (≤ N chars) and contains no raw newlines. Mock returns `okContent` with a 1000-char garbage string; assert `haltReason` does not contain the full garbage (truncated) and `ScoreParseError.raw` retains the full text. |
| **Acceptance Criteria** | `haltReason` never contains unbounded raw LLM output — it is truncated to a bounded length and stripped of newlines. The full raw response remains available on `ScoreParseError.raw` / `ScoreFailure` for debugging, separate from the operator-facing `haltReason`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed `ScoreParseError.message` embeds `raw` and `haltReason` interpolates `attempt.error` verbatim. Medium is correct — no correctness impact, but real hygiene risk for persisted records. |

---

### [ ] O2-20260630: Drafter one-shot retry catch block is empty — retry error erased, failure modes indistinguishable

| Field | Value |
|---|---|
| **ID** | `O2-20260630` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `shared/src/pipeline/drafter.ts:185-190` |
| **Description** | The one-shot empty-content retry's catch block is completely empty: `} catch { // Best-effort: treat as empty. }`. The spec sanctions swallowing the error, so the swallow itself is not anti-cheat — but the error is discarded with zero trace. The resulting `DraftResult` for the empty-after-retry path sets `raw: (second ?? first).raw` — when the second call threw, `second` is `undefined`, so `raw` falls back to `first.raw`, and the thrown error message is lost entirely. There is no field on `DraftResult` for the retry error, no log, no metric. A transient network outage on the retry is indistinguishable from 'the model returned empty content twice'. |
| **Risk / Impact** | When the drafter fails after retry in production, the operator sees `empty-after-retry` with no root cause. Stage 03 run records will not capture why the retry failed, making incident diagnosis impossible. A silent drafter failure mode is exactly the kind of degradation the stage is meant to surface, not hide. |
| **Evidence** | `drafter.ts:185-190`: `try { second = await this.client.chatCompletion(chatArgs); content = normalizeContent(second.content); } catch { /* Best-effort: treat as empty. */ }` — no error capture. `drafter.ts:201`: `raw: (second ?? first).raw` — when second threw, raw is first.raw, error lost. |
| **Recommendation** | Capture the swallowed error into `let retryError: Error | undefined;` and include it in the empty-after-retry `DraftResult` as a new optional field `retryError?: string` (amend the `DraftResult` type), or at minimum log it to `console.error` with a `[drafter]` prefix. The spec allows the swallow; it does not require the error to be erased. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock returns empty first, throws `new Error('timeout 60s')` second → assert the resulting `DraftResult` surfaces the error message (in a `retryError` field or via a spy on `console.error`); mock returns empty first, throws a non-Error second → assert the String-coerced error is captured. |
| **Acceptance Criteria** | When the one-shot retry throws, the error message is recoverable from the `DraftResult` or a log line — not erased. An empty-after-retry caused by a network error is distinguishable from one caused by the model returning empty twice. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the empty catch block and that `second` is undefined when it throws, so `raw` falls back to `first.raw` and the retry error is gone. Medium is correct — degrades postmortem diagnosability. |

---

### [ ] T1-20260630: `SCRAPER_TIMEOUT_MS` test does not verify the env-configurability AC

| Field | Value |
|---|---|
| **ID** | `T1-20260630` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `shared/src/pipeline/__tests__/scraper.test.ts:268-292` |
| **Description** | The `SCRAPER_TIMEOUT_MS` test stubs `SCRAPER_TIMEOUT_MS=12345`, then asserts only that *a* signal was forwarded and that `signal.aborted === false`. It explicitly comments "We cannot read the ms back from a live signal, so we assert a signal was forwarded at all." This assertion passes identically whether the scraper used 12345 (configured) or 30000 (default) — the default path also forwards a non-aborted AbortSignal. The AC "uses the configured timeout, not a hardcoded value" is not actually tested; a regression that hardcodes the default would go green. |
| **Risk / Impact** | The env-configurability contract is unverified. If a future change drops the `process.env.SCRAPER_TIMEOUT_MS` read or always uses `DEFAULT_TIMEOUT_MS`, the suite stays green and the regression ships. |
| **Evidence** | `vi.stubEnv("SCRAPER_TIMEOUT_MS", "12345");` ... `expect(signal).toBeInstanceOf(AbortSignal);` ... `expect(signal?.aborted).toBe(false);` — no assertion distinguishes the 12345 signal from a 30000 signal. |
| **Recommendation** | Make the timeout observable: stub `AbortSignal.timeout` (or a thin wrapper the scraper uses) to capture the ms argument and assert it equals 12345, not 30000. Alternatively, use `vi.useFakeTimers()`: stub fetch to never resolve, stub `SCRAPER_TIMEOUT_MS='12345'`, advance fake timers past 12345ms and assert the fetch rejects/aborts, then confirm it does NOT abort at 30000ms. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Stub `AbortSignal.timeout` to record its ms arg; assert scraper called it with 12345 (not 30000); with fake timers: fetch never resolves, env=12345; advance to 12301ms → fetch rejected with AbortError; advance from a second call with env unset → rejection only at 30001ms. |
| **Acceptance Criteria** | The test fails if the scraper ignores `SCRAPER_TIMEOUT_MS` and uses the default 30000; it passes only when the configured value reaches the fetch timeout. The AC "uses the configured timeout, not a hardcoded value" is genuinely verified. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the test only asserts signal forwarded + not aborted, and the comment admits the gap. Medium is correct — a green test giving false confidence in an un-verified AC. |

---

## Dependencies and Licensing

- Vulnerabilities: not audited (no `pnpm audit` run in this review; recommend running it as a follow-up — the dependency surface is small: feedsmith, jsdom, readability, turndown, node-appwrite).
- Outdated critical packages: not audited.
- License concerns: none surfaced. jsdom, readability, turndown, feedsmith are all permissive (MIT/Apache); node-appwrite is MIT. No copyleft risk identified from package names.

---

## Quality Signals

- **Lint/config signals:** ESLint config present at root (`eslint.config.mjs`); Prettier configured. No lint run performed in this review (read-only pass).
- **Test/coverage signals:** Vitest configured. Test files exist for every pipeline module. Coverage appears broad for happy paths but has documented boundary gaps (N3 scorer parse boundary, N4 MMR invariant, T1 scraper timeout AC). No coverage threshold enforced in config.
- **Complexity/churn signals:** Not a git repo — no churn data. Largest files: types.ts (14.9k), scorer.ts (11.0k), llm-client.ts (10.2k), scraper.ts (9.8k), rss-fetcher.ts (9.4k) — all reasonable. The tagger/scorer duplication (C6) is the main complexity smell.

---

## Risk Assessment

- **Overall risk:** Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** web/ (stage 00), shared/src/appwrite/ (stage 00), node_modules, .env, the legacy `AI-Newsletter-Pipeline-main - OLD - DO NOT USE` reference directory, stage 02+ behavior (inferred exposure only).
- **Notes:** The two High findings (C1, C2) both silently defeat the stage's primary safety mechanisms and can produce a degenerate parity run with no error signal. They are cheap to fix (Effort S each) and I recommend addressing them before the operator parity judgment — a parity run that silently scores blank LLM responses as 0 or silently collapses MMR to index 0 could produce a misleading "comparable quality" judgment. The four SSRF/path-traversal findings (S1-S4) are defense-in-depth for stage 01's operator-controlled scope but widen materially at stage 02; hardening them now (shared `assertSafeFetchUrl` helper + `name` sanitization in the config factory) is cheaper than retrofitting later.

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| C1-20260630 | High | Address now | Silent degradation defeats the halt; cheap fix; gates parity credibility |
| C2-20260630 | High | Address now | Silent MMR corruption; cheap fix; gates parity credibility |
| S1-20260630 | Medium | Address now | https-only default + http opt-in with warning (no allowlist — operators choose their provider) |
| S2-20260630, S3-20260630 | Medium | Address now | Scheme + parse + no cross-scheme redirect; no IP blocklist (self-hosted feeds, RSS-reader risk accepted) |
| S4-20260630 | Medium | Address now | Sanitize name in createNewsletterConfig |
| C3-20260630 | Medium | Address now | Fail fast on permanent 4xx |
| C4-20260630 | Medium | Address now | NaN guards in vectors.ts |
| C5-20260630 | Medium | Address now | Option a — dedup by link (fallback title) |
| C6-20260630 | Medium | Address now | Extract shared callLLM helper in tagger + scorer |
| C7-20260630 | Medium | Address now | Add 'not-selected' category; satisfy the stage PIN |
| N1-20260630 | Medium | Address now | Keep modified behavior; amend spec "faithful" → "modified port"; sentinel-leak guard |
| N2-20260630 | Medium | Address now | Keep length floor (drops ads/trash); make env-configurable; document |
| N3-20260630, N4-20260630 | Medium | Address now | Add parse-boundary tests; add target<candidateCount invariant test |
| P1-20260630 | Medium | Address now | Shared body-size cap using DEFAULT_MAX_CONTENT_LENGTH |
| M1-20260630, M2-20260630, M3-20260630 | Medium | Address now | Consolidate PipelinePhase; remove dead generics; drop unused scorer content path |
| O1-20260630, O2-20260630 | Medium | Address now | Truncate haltReason; capture drafter retry error |
| T1-20260630 | Medium | Address now | Fix test to verify the timeout AC |

**All 22 findings Address now** → hardening feature `feature-08-hardening-review-20260630` written. No findings deferred or dismissed.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._