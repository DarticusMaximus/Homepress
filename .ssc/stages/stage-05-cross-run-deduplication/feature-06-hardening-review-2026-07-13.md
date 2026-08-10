# Feature 06: Stage 05 hardening — review 2026-07-13

## Intent

Harden Stage 05's cross-run suppress pipeline + UI surface against the four Medium findings surfaced by `review-stage-05-cross-run-deduplication-2026-07-13` (`.ssc/reviews/review-stage-05-cross-run-deduplication-2026-07-13.md`): symmetric empty-candidates short-circuit, parser contract coverage, defensive-guard test coverage, and the `run …` formatter gap for empty `matchedRunId`. This is a quality pass against an already-`verified` stage — none of the original features are re-opened.

## Spec

Surface four narrow fixes distilled from the review's findings (do not copy the report verbatim; pull out only the **what changes** and the **acceptance**:

### S1 — Symmetric empty-candidates short-circuit (`P1-20260713`)

In `shared/src/pipeline/cross-run-suppress.ts`, add a second short-circuit immediately after the existing empty-lookback guard at line 128-130:

```ts
if (lookbackTopics.length === 0) return noOp(candidates);
if (candidates.length === 0) return noOp(candidates); // new
```

Then move `lookbackTexts` and `candidateTexts` construction (currently lines 136-141) **inside** the `try` block and **below** this guard so the empty-candidates path skips all embedding work. Keep the existing `if (candidateTexts.length > 0)` guard at line 155 as defense in depth (now unreachable but still useful).

Reuse the existing `noOp` helper (line 58). The for-loop at lines 172-198 already produces an empty `items` array and unchanged `remaining` when `candidates.length === 0`, so the symmetric short-circuit is purely an optimization + a clearer statement of intent.

### S2 — Parser contract coverage (`T1-20260713`)

In `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts`, extend the `parseCrossRunSimilarityThreshold smoke (regression vs feature 03)` describe block (currently lines 40-60) with these `it` blocks, mirroring the existing style and brevity:

- `'0.85abc'` → 0.85
- `'NaN'` → 0.85
- `'Infinity'` → 0.85
- `'   '` → 0.85
- `Number.NaN` → 0.85
- `Number.POSITIVE_INFINITY` → 0.85
- `Number.NEGATIVE_INFINITY` → 0.85
- `'foo'` → 0.85
- `'  0.85  '` → 0.85 (whitespace-padded valid number)
- `Number(-0)` → 0 (regression for the clamp-low path with a finite but negative-zero input)

No production code changes — these pin the parser's contract against future refactors (e.g., `Number(trimmed)` → `parseFloat(trimmed)`).

### S3 — `assertEmbeddings` defensive-guard test coverage (`T2-20260713`)

In `shared/src/pipeline/__tests__/cross-run-suppress.test.ts`, add a new describe block (or extend the existing `suppressCrossRunTopics` describe) with a small helper:

```ts
function makeMalformedEmbedClient(payload: unknown): LLMClient {
  const stub = {
    embeddings: async () =>
      ({ embeddings: payload as never, raw: null }),
  };
  return stub as unknown as LLMClient;
}
```

…and the following test cases, each asserting:

- `result.remaining === candidates` (by deep-equal or by `expect(result.remaining).toEqual(candidates)`)
- `result.summary.count === 0`
- `result.summary.items.length === 0`
- no throw escapes

| Case | Payload | Reaches guard |
|------|---------|---------------|
| Non-array top-level | `embeddings: "wrong"` | line 73 `!Array.isArray` |
| Length mismatch | `embeddings: [[1, 0, 0]]` for 2 inputs | line 75 `vecs.length !== expected` |
| Element not array (all-candidates path) | `embeddings: [[1, 0], "x"]` | line 82 `!Array.isArray(vec)` |
| Element contains NaN | `embeddings: [[1, 0, NaN]]` | line 91 `!Number.isFinite` |
| Element contains Infinity | `embeddings: [[1, 0, Infinity]]` | line 91 |

Important: at least the length-mismatch case must use a non-empty `lookback` and a non-empty candidates array so the for-loop at 172-198 actually has work to do — otherwise the test only proves `noOp` works on empty input, not that the finiteness check fires. Use the `makeEmbedClientByText` builder pattern for the per-element malformation cases so the candidate-embed path also gets exercised.

Also confirm (no extra test required, just verify in the implementation): the existing `embeddings throwing` test at lines 211-235 already covers the catch path around `assertEmbeddings`. Do not duplicate it.

### S4 — `formatPriorIssueLabel` empty-id guard (`U1-20260713`)

In `web/components/runs/run-suppress-summary.tsx`, modify `formatPriorIssueLabel` (lines 26-35) so an empty `matchedRunId` produces an explicit, non-`run …`-shaped label:

```ts
export function formatPriorIssueLabel(
  item: SuppressItem,
  runLookup: RunLookup,
): string {
  if (!item.matchedRunId) return "unknown prior";
  const entry = runLookup[item.matchedRunId];
  if (entry) {
    return formatRunDateTime(entry.endedAt ?? entry.startedAt);
  }
  return `run …${item.matchedRunId.slice(-6)}`;
}
```

The new guard is the first line so the `runLookup` lookup and the slice fallback only run when there is actually an id.

In `web/src/__tests__/runs-suppress-summary.test.tsx`, add three test cases (mirror the style of existing case 5 at lines 228-onwards):

1. **`matchedRunId: ""`** — `formatPriorIssueLabel` returns a string not equal to `"run …"`; assert through `runs-suppress-summary.test.tsx` (or a helper unit test) that both the table's compact `title` attribute / sr-only list and the card's visible list do NOT contain the literal `"run …"`. Construct via `parseSuppressSummary` rather than building `SuppressSummary` by hand so we exercise the real coercion path.
2. **3-char `matchedRunId`** (e.g. `"abc"`) — adds a real short-id case to the existing 16-char case 5; assert the rendered label is `"run …abc"` on both surfaces.
3. Existing case-5 (16-char unknown id) — must still pass; no regression.

If a `runs-suppress-summary.test.tsx` `makeSuppressItem` helper exists, use it; otherwise build `SuppressSummary` directly and pass through `parseSuppressSummary` so the constructor-side coercion at `suppress-summary.ts:59` matches what reaches the UI in production.

### Out of scope

- Re-running `ssc-finalize` for the stage (the original 5 features stay `verified`; this hardening sits alongside until the PM re-runs finalize).
- Changing `cross-run-suppress.ts` behavior beyond S1's short-circuit (don't refactor `assertEmbeddings`, don't change the for-loop logic, don't change the API surface).
- Changing `formatSuppressItemLine`'s line shape (S4 only changes `formatPriorIssueLabel`'s return contract; the wrapping line at line 47 stays as-is).
- Adding a fixture for the empty-id case in app seed data / Appwrite; the test constructs it synthetically.
- LLM-as-judge for empty-id disambiguation (deferred; record as a future direction).
- Renaming `Run.suppressSummary` or adding item-level sanitization in `parseSuppressSummary` (drops rather than coerces empty-id items). Soft penalty vs clean output — out of scope here.

## Dependencies

- Builds on: Stage 05 review `review-stage-05-cross-run-deduplication-2026-07-13` (the only source of the 4 fixes).
- Builds on: Stage 05 verified features (01 lookback config, 02 topic load, 03 pre-MMR semantic suppress, 04 suppress visibility, 05 threshold env config) — none are re-opened; the trail is preserved.
- Orphaned by: none within Stage 05.
- **Execute order:** trivially independent; the four fixes are in different files (cross-run-suppress.ts, two test files, run-suppress-summary.tsx + its test). Builder may order tasks as listed.

## Constraints

- **Spec-faithful** — each fix is narrow and mechanical; do not refactor surrounding code.
- **Test-first** for S1, S2, S3, and S4 (the helper / formatter changes).
- **No source files outside the four listed** (cross-run-suppress.ts + its test; the docs-guard test; run-suppress-summary.tsx + its test; product_spec.md for the one-line Implemented-features entry). Do not touch the suppress module's production exports, types, or signatures.
- **No feature regression** — existing test suites stay green. Re-run `pnpm --filter @newsletter/shared test`, `pnpm --filter web test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- **Anti-cheat minimalism** — the validator already falsified speculative anti-cheat; this feature does not add shortcuts. Tests must reach the real logic, not over-mock the surface (e.g., S3 must drive `suppressCrossRunTopics` end-to-end, not just `assertEmbeddings` directly).
- **Secrets:** no environment changes.
- **Trail preservation:** do **not** modify `Run` type, schema declarations, `lookback` field, threshold env, or anything feature 01-05 added. Only modify the files explicitly listed under "Files".
- **No source file changes** outside the listed four + product_spec.md.

## Acceptance criteria

- [ ] `suppressCrossRunTopics([], nonEmptyLookback, { client })` returns noOp without invoking `client.embeddings`; a test in `cross-run-suppress.test.ts` asserts the embeddings spy is not called.
- [ ] All listed parser fall-through inputs (`'0.85abc'`, `'NaN'`, `'Infinity'`, `'   '`, `Number.NaN`, `Number.POSITIVE_INFINITY`, `Number.NEGATIVE_INFINITY`, `'foo'`, `'  0.85  '`, `Number(-0)`) are tested with the expected parse output; existing 5 cases stay passing.
- [ ] Three `assertEmbeddings` guard paths (length/shape, non-array element, non-finite element) are exercised by malformed stub responses; each reaches noOp; no throw escapes.
- [ ] `formatPriorIssueLabel` with `matchedRunId === ""` returns a label not equal to `"run …"`; full `formatSuppressItemLine` output for empty `matchedRunId` does not contain the literal `"run …"`.
- [ ] `runs-suppress-summary.test.tsx` adds explicit coverage for empty-id (table + card) and a 3-char `matchedRunId` case on top of the existing 16-char case 5.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` all exit zero.
- [ ] `product_spec.md` gets a one-line Implemented-features entry referencing "Stage 05 hardening — review 2026-07-13".

## Files

- Modify: `shared/src/pipeline/cross-run-suppress.ts` (S1: symmetric short-circuit + move text construction)
- Modify: `shared/src/pipeline/__tests__/cross-run-suppress.test.ts` (S1 test + S3 malformed-embed tests)
- Modify: `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts` (S2: parser edge-case tests)
- Modify: `web/components/runs/run-suppress-summary.tsx` (S4: `formatPriorIssueLabel` empty-id guard)
- Modify: `web/src/__tests__/runs-suppress-summary.test.tsx` (S4: empty-id + 3-char-id UI tests)
- Modify: `product_spec.md` (one-line Implemented features entry at handoff)

## Testing approach

**Test-first for all four sub-fixes.** Each fix is small enough that the test surfaces the corrected behavior directly.

### S1 test (cross-run-suppress.test.ts, mirrors lines 70-93)

Invert the existing empty-lookback test: candidates non-empty, lookback non-empty, assert the embeddings spy is NOT called when `candidates = []`. Note: the spy at lines 71-76 returns a fully-formed response; the assertion at line 92 (`expect(embeddingsSpy).not.toHaveBeenCalled()`) is the only line that needs to change.

### S2 tests (cross-run-threshold-env-docs.test.ts)

Add 10 new `it` blocks under the existing `parseCrossRunSimilarityThreshold smoke (regression vs feature 03)` describe. Each is one line of assertion. No setup needed.

### S3 tests (cross-run-suppress.test.ts)

Add a new `describe("assertEmbeddings malformed response guards", ...)` block with the `makeMalformedEmbedClient` helper (top of the file alongside `makeEmbedClientByText` and `makeRejectingEmbedClient` at lines 38-55). For each malformation shape, build candidates and lookback at non-trivial scale (e.g., 2 candidates, 2 lookback topics) so the for-loop reaches `cosine`. Use distinct embed vectors per call so the test fails loud if the guard short-circuits incorrectly. After `await suppressCrossRunTopics(...)`, assert no throw, `result.remaining === candidates`, `result.summary.count === 0`, `result.summary.items.length === 0`.

For length-mismatch case: build **2** lookback topics + **2** candidates, supply only 1 embedding in the response → guards `vecs.length !== expected` (line 75) → throw → caught by outer try → noOp.

For non-array element + non-finite element: ensure the guard `vecs.length === expected` passes (so length/shape doesn't fire first), then provide a malformed inner array / non-finite number → guard reaches the inner `!Array.isArray` (line 82) or `!Number.isFinite` (line 91) → throw → caught → noOp.

### S4 test (runs-suppress-summary.test.tsx + a unit-style helper assertion)

Two angles:

1. **Unit-style** (within `runs-suppress-summary.test.tsx` or a new `web/src/__tests__/run-suppress-summary.test.tsx` for helper testing): import `formatPriorIssueLabel` directly and assert:
   - `formatPriorIssueLabel({ matchedRunId: "", …}, {})` is not equal to `"run …"`
   - `formatPriorIssueLabel({ matchedRunId: "abc", …}, {})` returns `"run …abc"`
2. **Integration** via the existing `RunsTable` render path (cases in `runs-suppress-summary.test.tsx`): build a `SuppressSummary` whose `items[0].matchedRunId === ""` (or pass through `parseSuppressSummary({ items: [{ matchedRunId: null, … }] })` so the constructor coerces), render with `runLookup = {}` (no resolution), and assert the rendered compact cell's `title` attribute and sr-only list do NOT contain the literal `"run …"`. Also assert the card visible list does not contain `"run …"`. Use the `isExposed` / `hasVisibleText` helpers already in the test (lines 215-220 area) so the assertion matches existing style.

## Tasks

### Task 1: Failing tests for all four fixes

- **Action:**
  - S1: Add the empty-candidates test in `shared/src/pipeline/__tests__/cross-run-suppress.test.ts` (mirror lines 70-93 with `candidates: []` + non-empty lookback).
  - S2: Add the 10 parser edge-case `it` blocks in `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts`.
  - S3: Add the malformed-embed-guard tests in `shared/src/pipeline/__tests__/cross-run-suppress.test.ts` (helper + 5 cases).
  - S4: Add the empty-id helper test + UI integration tests in `web/src/__tests__/runs-suppress-summary.test.tsx`.
- **Expected result:** Targeted `pnpm --filter @newsletter/shared test -- src/pipeline/cross-run-suppress src/pipeline/__tests__/cross-run-threshold-env-docs` and `pnpm --filter web exec vitest run src/__tests__/runs-suppress-summary` exit non-zero on missing/unmet assertions (not on harness misconfig).
- **Verify:** Run those test paths; failures cite the new `it`/`describe` blocks or unmet acceptance assertions.
- **Depends on:** none.

### Task 2: Source fixes (the four narrow edits)

- **Action:**
  - S1: Add the symmetric short-circuit at `cross-run-suppress.ts`; move `lookbackTexts` and `candidateTexts` construction below it (inside `try`).
  - S2: No source change.
  - S3: No source change.
  - S4: Add the empty-id guard in `formatPriorIssueLabel` (`run-suppress-summary.tsx:26-35`).
- **Expected result:** All Task-1 failing tests now pass; existing tests in the touched files stay green.
- **Verify:** Targeted test paths green; full `pnpm --filter @newsletter/shared test` + `pnpm --filter web test` green; `pnpm typecheck` zero errors.
- **Depends on:** Task 1.

### Task 3: Regression + product_spec note

- **Action:** Run full `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`; fix any fallout. Update `product_spec.md` Implemented features with one line for "Stage 05 hardening — review 2026-07-13 (P1/T1/T2/U1)".
- **Expected result:** Full repo quality gate green; product_spec reflects the hardening.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` all zero.
- **Depends on:** Task 2.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/pipeline/cross-run-suppress src/pipeline/__tests__/cross-run-threshold-env-docs && pnpm --filter web exec vitest run src/__tests__/runs-suppress-summary && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: S1 empty-candidates no-embed test passes; all 10 S2 parser edge cases pass; S3 malformed-embed guards each reach noOp without throwing; S4 empty-id + 3-char-id tests pass on both table and card surfaces; existing tests unaffected; full repo quality gate green.

### Stage B — No PM manual gate

This is a code-quality hardening; no UI changes flow new affordances to operators. The existing PM manual gate from Feature 04 (Suppressed column on `/runs`) already covered the visible behavior. The empty-id case is reachable only via malformed data that doesn't currently exist in production; the S4 fix is defensive. No new PM gate needed.

## Handoff

When complete, the builder reports to the manager:

- Files modified under `shared/src/pipeline/` (cross-run-suppress.ts + two test files), `web/components/runs/run-suppress-summary.tsx` + its test, and `product_spec.md`.
- Confirmation of test/build/typecheck/lint commands and results.
- Confirmation that S1's symmetric guard is below the existing empty-lookback guard (lines 128-130) and that both `lookbackTexts` / `candidateTexts` construction sites have moved below it.
- Confirmation that S2 added exactly the 10 listed `it` blocks with the documented expected outputs.
- Confirmation that S3 added the `makeMalformedEmbedClient` helper and 5 test cases (length-mismatch, non-array element, NaN element, Infinity element, plus a fifth non-array top-level — explicit list above), each with non-empty `candidates` and `lookback` so the for-loop executes.
- Confirmation that S4 added a single-line guard at the top of `formatPriorIssueLabel` so `matchedRunId === ""` short-circuits to a non-`run …`-shaped label, and that `run …<last6>` still applies when `matchedRunId.length > 0`.
- Confirmation that no original-feature code (`Run.suppressSummary`, `cross-run-suppress` API surface, `lookback` field, threshold env, run-suppress display on non-empty data) was changed.
- **Research note:** Each finding in the review has verbatim evidence + line refs in `.ssc/reviews/review-stage-05-cross-run-deduplication-2026-07-13.md`. The fixes are derived from the **what changes** column of each finding, not the report text. Anti-cheat guard (S3) is the most consequential because `assertEmbeddings` is the only thing standing between malformed embeddings and silent cosine errors that `>= threshold` quietly fails on; covering it directly closes a real defensive gap that `execute-run.test.ts`'s `suppressFn` stubs would never catch.

## Locked decisions (auto mode 2026-07-13, from review report)

1. **Scope of fixes** — exactly the 4 findings in the review; no scope creep.
2. **S1 guard position** — second early-return immediately after the empty-lookback guard; both text constructions move inside `try` and below both guards.
3. **S2 test addition** — exactly the 10 listed `it` blocks; no production change to the parser.
4. **S3 helper name and scope** — `makeMalformedEmbedClient` in `cross-run-suppress.test.ts`; 5 malformed cases (non-array top-level, length-mismatch, non-array element, NaN element, Infinity element); each test uses non-empty `candidates` and non-empty `lookback` so the for-loop reaches `cosine`.
5. **S4 label wording** — `"unknown prior"` (one word, no ellipsis shape); preserves the operator-facing tone already used in the spec's example lines.
6. **No parse-side sanitize** — `parseSuppressSummary` keeps its graceful coercion (`matchedRunId: ""`); the empty-id render-side guard is sufficient for V1.
7. **No new feature row** — the hardening is `feature-06-hardening-review-2026-07-13` only; existing features 01-05 stay `verified` in state until `ssc-finalize` runs.
