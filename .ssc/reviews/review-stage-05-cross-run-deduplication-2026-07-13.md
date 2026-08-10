# SSC Code Review Report

**Date:** 2026-07-13
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** `stage-05-cross-run-deduplication` (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-05-cross-run-deduplication.md` (plus 5 feature specs in the stage subfolder)

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 4 | Low 0 | Nit 0
- **Overall rationale:** Four Medium findings: one performance waste on a degenerate branch (empty-candidates still embeds lookback), two test-coverage gaps on the threshold parser and the `assertEmbeddings` finiteness safety net, one UX formatter gap on the empty-`matchedRunId` defensive path. No Blockers, no High security/correctness findings; spec compliance verified end-to-end. Implementation cleanly honors every locked decision in features 01–05 (lookback 0..10 / default 3, suppress input is full scored set, `>= 0.85` threshold, MMR still title+body, empty summary → `""`, em-dash on empty, count === items.length invariant, server-side parse). Treat the four Mediums as a single hardening cluster during PM triage.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-05-cross-run-deduplication` — all 5 verified features in the stage.
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 21
  - `shared/src/pipeline/cross-run-suppress.ts` (full read)
  - `shared/src/pipeline/config.ts` (threshold portion — `DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD`, `CROSS_RUN_SIMILARITY_THRESHOLD_ENV`, `parseCrossRunSimilarityThreshold`, `getCrossRunSimilarityThreshold`)
  - `shared/src/pipeline/__tests__/cross-run-suppress.test.ts` (full read)
  - `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts` (full read)
  - `shared/src/runs/lookback-topics.ts` (full read)
  - `shared/src/runs/suppress-summary.ts` (full read)
  - `shared/src/runs/execute-run.ts` (selection phase 348-405 + imports/wiring 1-50)
  - `shared/src/runs/repository.ts` (`documentToRun` 66-88, `saveSuppressSummary` 479-503)
  - `shared/src/runs/types.ts` (Run interface)
  - `shared/src/schema/declarations.ts` (`suppressSummary` attr 183, `lookback` attr 141)
  - `shared/src/newsletters/repository.ts` (`documentToNewsletter` coerce + lookback writes)
  - `shared/src/newsletters/validation.ts` (`validateLookback`, create/update resolve)
  - `shared/src/newsletters/types.ts` (lookback fields)
  - `web/components/runs/run-suppress-summary.tsx` (full read)
  - `web/components/runs/runs-table.tsx`, `runs-view.tsx`, `run-list-card.tsx` (full read)
  - `web/app/(protected)/runs/page.tsx` (full read)
  - `web/components/newsletters/newsletter-form-dialog.tsx` (lookback section)
  - `web/app/(protected)/newsletters/actions.ts` (create + update branches)
  - `.env.example`, `README.md`, `compose.yaml` (threshold-only sections)
- **Files skipped:** 6 (test files cross-checked indirectly via validator, not fully read)
  - `shared/src/runs/__tests__/execute-run.test.ts` — partial read (lines 1-100 + validator confirm of stub-style on `suppressFn`); not exhaustively audited beyond the suppress wiring cases because the validator confirmed `vi.fn().mockResolvedValue(...)` stubs bypass the real `suppressCrossRunTopics`. Indirect scope, no production risk in batch B2.
  - `shared/src/runs/__tests__/lookback-topics.test.ts`, `shared/src/runs/__tests__/suppress-summary.test.ts`, `shared/src/newsletters/__tests__/validation.test.ts`, `shared/src/newsletters/__tests__/repository.test.ts`, `shared/src/schema/__tests__/declarations.test.ts` — referenced indirectly; not independently read because the corresponding production code was fully reviewed and the feature 01 spec acceptance criteria were traced to source.
  - `web/src/__tests__/runs-suppress-summary.test.tsx` — grepped only (matched-run / `slice(-6)` patterns + 60 lines around existing case 5); full pass not attempted because the formatter is the line under U1 and the existing case-5 layout is well-understood.
- **Assumptions and unknowns:**
  - Assumed the build/lint/typecheck/test commands referenced in feature specs (`pnpm --filter @newsletter/shared test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`) are green as of `last_verified` for each feature; no build-time evidence collected during this review.
  - Assumed Appwrite returns `$id` as a non-empty string for all run documents persisted by `createRun` (repository.ts:117-129 uses `ID.unique()`); the U1 finding depends on this being true in production (no data observed where `$id` is `""`, only on malformed JSON edges).
  - Assumed `gemini-embedding-001` returns unit-norm vectors in the range expected by `cosine` in `shared/src/pipeline/vectors.ts` (out of scope to verify model provider internals); covered by the `>= threshold` spec contract and `count === items.length` invariant.

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Feature Intent line (stage 05):** "Stop the same topic recurring across consecutive issues by suppressing lookback-similar candidates before within-run diversity selection — so each issue feels fresh even when the day's firehose keeps repeating the same story. This serves the product's temporal-diversity goal and makes retained run history actively useful, not just an audit trail."
- **Intent served?** Yes
- **Notes:** End-to-end verified against the spec:
  - lookback default 3 / 0..10 bounds / read-coerce on read (newsletters/repository.ts:66-73) ✓
  - `lookback <= 0` short-circuit returns empty without Appwrite call (lookback-topics.ts:71-73) ✓
  - suppress input is full `scoredArticles` (no `minScore` pre-filter at execute-run.ts:356) ✓
  - suppress embedding text is title+tags both sides (cross-run-suppress.ts:25-30); MMR still title+body (unchanged) ✓
  - threshold `>= 0.85` default, finite-clamped [0,1] (config.ts:240-268) ✓
  - `summary.count === summary.items.length` invariant (cross-run-suppress.ts:200-203 + suppress-summary.ts:65) ✓
  - empty pool after suppress → `markFailed`; short-survivor completes (execute-run.ts:360-392) ✓
  - empty summary serializes to `""`; parse recomputes count (suppress-summary.ts:9-14, 28-66) ✓
  - server-side `parseSuppressSummary` + `runLookup` from `allRuns` (page.tsx:131-142) ✓
  - both surfaces (table compact + card visible) expose titles + matched prior + count (run-suppress-summary.tsx:71-128) ✓
  - `.env.example` + README both document the env key / default / ≥ semantics / restart requirement; worker boots via `process.loadEnvFile` (worker/src/index.ts:78); compose uses `env_file` (compose.yaml:30-32) ✓
  - locked decision `update uses lookback ?? -1` not `?? 0` present at actions.ts:121 ✓
  - Grizzled Senior pins (full scored set; `count === items.length`; short-survivor completes) all honored ✓
  - No Blockers, no High findings. Drift: none. The 4 Medium findings are quality observations, not intent drift.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [ ] P1-20260713: Empty-candidates path still issues the lookback embeddings call

| Field | Value |
|---|---|
| **ID** | `P1-20260713` |
| **Severity** | Medium |
| **Category** | Performance |
| **Location** | `shared/src/pipeline/cross-run-suppress.ts:128-152` |
| **Description** | The `suppressCrossRunTopics` function short-circuits on empty lookback (line 128) but has no symmetric short-circuit for empty candidates. With `candidates.length === 0` and a non-empty lookback, the function still issues a `client.embeddings` call for the lookback texts (line 144) and computes nothing useful — the for-loop at 172-198 never runs because there are no candidates, so the embedding roundtrip is pure waste. |
| **Risk / Impact** | Wasted LLM cost and one extra round-trip latency on a degenerate branch. Typical scale: lookback 3 issues × ~5 topics ≈ 15 lookup texts → ~6 lookback runs per such selection. Not a correctness issue (output is identical to noOp), but symmetric with the empty-lookback guard the spec explicitly requires. |
| **Evidence** | Lines 127-130 short-circuit `lookbackTopics.length === 0`; line 144 unconditionally calls `client.embeddings({ input: lookbackTexts })`; line 155 correctly guards `candidateTexts.length > 0` (the asymmetric pattern). With `candidates.length === 0` the for-loop at 172-198 has no iterations, so the lookback embeddings are consumed and discarded. |
| **Recommendation** | Add a second short-circuit immediately after the empty-lookback guard, mirroring its pattern: `if (candidates.length === 0) return noOp(candidates);`. Then move `lookbackTexts`/`candidateTexts` construction below it so the empty-candidates path skips all embedding work. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Add a test in `cross-run-suppress.test.ts` that calls `suppressCrossRunTopics` with empty candidates and non-empty lookback; assert the embeddings spy is NOT called and the result is noOp (mirror the existing empty-lookback test at lines 70-93 but invert the empty side). |
| **Acceptance Criteria** | `suppressCrossRunTopics([], nonEmptyLookback, { client })` returns `{ remaining: [], summary: { count: 0, items: [] } }` without invoking `client.embeddings`. A test in `cross-run-suppress.test.ts` asserts the embeddings spy is not invoked. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Re-read cross-run-suppress.ts:127-165. Line 128 only short-circuits on `lookbackTopics.length === 0`. Lines 144-152 always issue the lookback embed call regardless of candidates. The candidate embed is correctly guarded (line 155). With candidates.length===0 the for-loop at 172-198 never runs, so the function returns the same shape as noOp — observable output is identical, only the wasted embeddings call differs. |

### [ ] T1-20260713: `parseCrossRunSimilarityThreshold` missing edge-case test coverage

| Field | Value |
|---|---|
| **ID** | `T1-20260713` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts:40-60` |
| **Description** | The threshold parser smoke describe block has exactly 5 `it` cases (`undefined`, `""`, `"0.9"`, `1.5`, `-0.1`). The spec lists "empty / NaN / non-finite / invalid → default 0.85" as a contract; the implementation at `config.ts:240-268` correctly handles a wider family of inputs through the `Number(trimmed)` + `Number.isFinite` guards, but no tests pin those paths. |
| **Risk / Impact** | A future refactor of `Number(trimmed)` to `parseFloat(trimmed)` (which silently parses `"0.85abc"` as `0.85` rather than NaN) would change behavior without any test failure. Same risk for replacing `Number.isFinite` with truthy checks, or for hand-rolling a different clamp path. The parser gates a feature-flag-style threshold with no UI override; regressions only surface in production. |
| **Evidence** | Test file at lines 40-60 enumerates only 5 inputs. Implementation at `config.ts:251-260` routes `'0.85abc'`, `'NaN'`, `'Infinity'`, `Number.NaN`, `Number.POSITIVE_INFINITY`, `'foo'`, `'   '` to `!Number.isFinite` then to default. None are explicitly asserted; whitespace-padded valid numbers (`'  0.85  '`) and `Number('-0')` are also untested. |
| **Recommendation** | Extend the `parseCrossRunSimilarityThreshold smoke (regression vs feature 03)` describe block with explicit `it` blocks for: `'0.85abc'` → 0.85, `'NaN'` → 0.85, `'Infinity'` → 0.85, `'   '` → 0.85, `Number.NaN` → 0.85, `Number.POSITIVE_INFINITY` → 0.85, `'foo'` → 0.85, `'  0.85  '` → 0.85, `Number(-0)` → 0. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mirror the existing style at `cross-run-threshold-env-docs.test.ts:41-59`. Each input above is its own `it` block asserting the expected parse output. |
| **Acceptance Criteria** | All spec-listed fall-through inputs (empty / NaN / non-finite / non-numeric / trailing-characters) are asserted to return the 0.85 default; whitespace-padded valid numbers parse to the trimmed numeric value; `Number(-0)` parses to 0. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Counted exactly 5 `it` blocks under the parseCrossRunSimilarityThreshold describe. Implementation at config.ts:240-268 correctly handles the listed edge cases today (`Number('0.85abc')=NaN`, `Number('NaN')=NaN`, `Number('Infinity')=Infinity`, trim of `'   '`='', NaN/POSITIVE_INFINITY not finite → all return DEFAULT). However, no test pins these paths; a refactor of `Number(trimmed)` to `parseFloat(trimmed)` would silently change `'0.85abc'` from DEFAULT to 0.85 (parseFloat stops at first non-numeric char). |

### [ ] T2-20260713: `assertEmbeddings` guard paths not directly tested

| Field | Value |
|---|---|
| **ID** | `T2-20260713` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `shared/src/pipeline/__tests__/cross-run-suppress.test.ts` |
| **Description** | `assertEmbeddings` (`cross-run-suppress.ts:68-107`) is the spec-mandated safety net that converts three distinct kinds of malformed embedding responses into throws (length/shape mismatch, non-array element, non-finite element). The existing `embeddings throwing` test (lines 211-235) only exercises the throw-then-catch path. The three guard paths inside `assertEmbeddings` are not independently covered, and `execute-run.test.ts` suppress cases use `vi.fn().mockResolvedValue(...)` stubs that bypass the real `suppressCrossRunTopics`. |
| **Risk / Impact** | A bug in `assertEmbeddings` (e.g., a typo flipping the `!Array.isArray` check, or a missing element-wise loop) would allow malformed embeddings to reach `cosine`, causing downstream InvalidVectorError or — worse — silently incorrect suppress scores (because `cosine` over wrong-length vectors can return `NaN`, which `>= threshold` quietly fails on, so the candidate survives). The spec lists atomic finiteness as required. |
| **Evidence** | `assertEmbeddings` body at `cross-run-suppress.ts:73-105` has three guard paths. `cross-run-suppress.test.ts:211-235` exercises only one (the throw, via `makeRejectingEmbedClient`). `execute-run.test.ts` cases (per validator: 1428-1647) all stub `suppressFn` with a fully-formed `SuppressResult`; the real `suppressCrossRunTopics` is never invoked end-to-end from these tests. |
| **Recommendation** | Add a small helper `makeMalformedEmbedClient(payload)` and test: (a) `embeddings: "wrong"` (non-array top-level), (b) length-mismatch (1 embedding for 2 inputs), (c) element not array `[[1], "x"]`, (d) element contains NaN, (e) element contains Infinity. Each result must be noOp (remaining === candidates, summary.count === 0) and no throw must escape. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | One test per malformation shape, mirroring the existing `embeddings throwing` test style. Each case asserts `result.remaining` equals the input candidates and `result.summary.count === 0`. |
| **Acceptance Criteria** | All three `assertEmbeddings` guard paths (length/shape mismatch, non-array element, non-finite element) are explicitly exercised via malformed stub responses; no throw escapes `suppressCrossRunTopics`; `summary.count === 0` in every case. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Re-read cross-run-suppress.ts:68-107 (3 distinct guard paths: shape/length 73-79, non-array element 82-88, non-finite element 89-103) and cross-run-suppress.test.ts:211-235 (only the throw path is tested). Checked execute-run.test.ts:1428-1647 — the four cross-run suppression cases all stub `suppressFn` with `vi.fn().mockResolvedValue(...)` returning a fully-formed SuppressResult; they never invoke the real `suppressCrossRunTopics`, so assertEmbeddings guards are not exercised indirectly. |

### [ ] U1-20260713: `formatPriorIssueLabel` produces literal `"run …"` for empty `matchedRunId`

| Field | Value |
|---|---|
| **ID** | `U1-20260713` |
| **Severity** | Medium |
| **Category** | UX/i18n/Accessibility |
| **Location** | `web/components/runs/run-suppress-summary.tsx:34` |
| **Description** | The spec-mandated short-id fallback for an unknown `matchedRunId` is `run …<last6>`. When `matchedRunId === ""` (which `parseSuppressSummary` actively produces — line 59 coerces non-string `matchedRunId` to `""`), `[item.matchedRunId].slice(-6)` returns `""`, so the literal output is exactly `run …`. This looks like a truncated tooltip rather than an explicit "unknown prior" marker. Reaches both the table's compact cell (via `title` attribute and sr-only list) and the card's visible list (via `formatSuppressItemLine`). |
| **Risk / Impact** | Undermines Feature 04 Intent: the operator should trust the suppression display. A literal `run …` is uninformative; an operator reading the runs list cannot tell whether the suffix is truncated display or genuinely missing data. Currently unreachable in production (Appwrite `$id` is non-empty) but the helper is permissive and the spec contract says "<6 chars or missing should not look the same as the renderable short-id". |
| **Evidence** | `parseSuppressSummary` line 59: `matchedRunId: typeof e.matchedRunId === "string" ? e.matchedRunId : ""`. `run-suppress-summary.tsx` line 34: `return \`run …${item.matchedRunId.slice(-6)}\`;`. Per ECMAScript, `''.slice(-6) === ''`, so the literal is `run …`. `formatSuppressItemLine` at line 47 wraps that as `"<title>" matched prior "<matchedTitle>" (run …)`. No upstream sanitize step filters empty-`matchedRunId` items (page.tsx:131-133, repository.ts:66-88, lookback-topics.ts:83-101). |
| **Recommendation** | Guard `formatPriorIssueLabel` against empty `matchedRunId` and emit an explicit, non-`run …`-shaped label. Example: `if (!item.matchedRunId) return "unknown prior";` before the slice. Keep the `run …<last6>` fallback only when `matchedRunId.length > 0`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | 1. Unit test on `formatPriorIssueLabel` with `matchedRunId === ""` — assert the result is not `"run …"`. 2. UI test in `runs-suppress-summary.test.tsx` that builds a `SuppressSummary` with `matchedRunId: ""` (or null-coerced to "") and asserts both table (`title` / sr-only) and card visible list contain an explicit "unknown prior" marker. 3. Add a 3-char `matchedRunId` case to confirm the spec `run …<short>` shape still renders (existing case 5 only covers 16-char ids). |
| **Acceptance Criteria** | 1. `formatPriorIssueLabel` with `matchedRunId === ""` returns a label not equal to `"run …"`. 2. Full `formatSuppressItemLine` output for empty `matchedRunId` reads `"<title>" matched prior "<matchedTitle>" (<non-empty label>)` with the suffix not starting with `run …`. 3. `runs-suppress-summary.test.tsx` has a case asserting this behavior on both surfaces. 4. Existing case-5 (16-char unknown id) still passes. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Re-read suppress-summary.ts:59 (coerces non-string matchedRunId to '') and run-suppress-summary.tsx:34 (`run …${item.matchedRunId.slice(-6)}`). `''.slice(-6) === ''` confirmed, so an item with empty matchedRunId renders exactly the literal 'run …'. parseSuppressSummary does NOT filter out items with empty matchedRunId (line 59 only type-checks). Confirmed no upstream sanitize step: web/app/(protected)/runs/page.tsx:131-133 just threads parseSuppressSummary output through with no item filter; documentToRun (repository.ts:66-88) and loadLookbackTopics (lookback-topics.ts:83-101) never reject empty runIds defensively. In practice Appwrite $id is non-empty, but the helper is permissive and the spec fallback literal is visibly malformed when triggered. |

---

## Dependencies and Licensing

- Vulnerabilities: none observed in the dependencies touched by this stage (no new dependencies added by features 01–05).
- Outdated critical packages: none observed (no `package.json` modifications in scope).
- License concerns: none. Stage 05 added no new packages.

---

## Quality Signals

- **Lint/config signals:** No `.eslint`, `.prettier`, or `tsconfig` modifications observed inside the stage. The pre-existing flat config (eslint.config.mjs) covers all touched files.
- **Test/coverage signals:** Strong coverage of the happy path (embed-throw, empty-lookback no-op, similarity ≥/below threshold, tie-break, parse round-trip, run-prior lookup with date and short-id, failed-status display). Gaps concentrated in defensive paths — see T1 (parser), T2 (assertEmbeddings), U1 (formatter empty-id guard). Coverage signal: maybe 85% of the suppress module on canonical paths, materially lower on the three defensive guards and parser edges.
- **Complexity/churn signals:** `cross-run-suppress.ts` (~213 LOC), `lookback-topics.ts` (~104 LOC), `suppress-summary.ts` (~66 LOC) are all single-purpose modules with clear contracts. `run-suppress-summary.tsx` (~128 LOC) carries two rendering variants (compact + expanded) cleanly. `runLookup` plumbing across `page.tsx` → `RunsView` → `RunsTable` / `RunListCard` is well-named and consistently typed. No cyclomatic hot spots.

---

## Risk Assessment

- **Overall risk:** Low
- **Merge decision:** Approve with changes
- **Out-of-scope areas:**
  - Stage 06 (preview/inspection) — not yet built; suppress summary display on `/runs` is the V1 surface per feature 04 spec.
  - Stage 07 prompt/model management — cross-run threshold is its own env knob, lives outside model component config by design.
  - MMR / scorer / drafter code paths — feature 03 explicitly keeps `buildEmbedText`, lambda, minScore, and retention unchanged.
  - Cross-newsletter suppression — deferred per stage out-of-scope (same-newsletter only).
  - LLM-as-judge / soft-penalty modes — deferred per stage out-of-scope.
- **Caveats:** The 4 Medium findings are quality observations rather than functional defects. If all 4 are addressed before finalizing the stage, the resulting code will be the strongest in the project so far.

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| P1-20260713 | Medium | TBD | TBD |
| T1-20260713 | Medium | TBD | TBD |
| T2-20260713 | Medium | TBD | TBD |
| U1-20260713 | Medium | TBD | TBD |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
