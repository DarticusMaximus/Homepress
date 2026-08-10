# Feature 07: Harden stage-07 against review findings (2026-07-14)

## Intent

Harden stage-07-prompt-and-model-management against findings from `review-stage-07-prompt-and-model-management-2026-07-14`: close a model-ID validation gap for invisible Unicode characters, remove a duplicated scorer value-prep fork, and add the two missing prompts-repository test paths (create-race recovery + the secret-redaction guard) — all low-effort hardening on already-verified features.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. It does not reopen features 01–06 — those stay `verified`. It addresses four PM-accepted Medium findings from the review by changing a small amount of production code (C1, M1) and adding targeted tests (T1, T2). No schema changes, no new collections, no GUI changes, no pipeline behavior change for valid inputs.

### Finding C1 — invisible-char validation gap (Correctness)

The shared model-ID validator in `shared/src/settings/model-defaults.ts` (`hasWhitespaceOrControl`) rejects only C0 controls (≤0x1F), DEL (0x7F), and JS `\s`. It lets C1 control characters (U+0080–U+009F) and zero-width/format characters (U+200B, U+200C, U+200D) through — a deviation from Feature 05 Validation rule 5 ("Reject values containing whitespace or control characters after trim"). Because both Feature 04 (global defaults) and Feature 05 (newsletter overrides) share `normalizeModelIdFields` → `isOpenRouterStyleId`, a single fix closes both surfaces.

### Finding M1 — scorer value-prep duplication (Maintainability)

`shared/src/pipeline/scorer.ts` forks the value-preparation logic (join topics with `", "`, empty `dislikedTopics` → `"None"`, empty `tags` → `"None"`) into two sites: the exported `SCORER_PROMPT_TEMPLATE` callable (~lines 42–44) and the internal `ArticleScorer.formatPrompt` custom-template branch (~lines 282–284). Tagger and drafter avoid this fork (single render path / prep-before-branch). Feature 06 makes the custom-template branch production-reachable, so a future edit to one fork silently diverges DB-loaded custom prompts from shipped-default output. Consolidate into one location.

### Findings T1 + T2 — prompts-repository test gaps (Testing)

- **T1:** `getOrCreatePromptTemplate` implements the spec-pinned "On create race, re-get" branch (`isConflict(err2)` → re-`getDocument`) at `shared/src/prompts/repository.ts:95-107`, but no test injects a 409 on `createDocument`. The mock harness supports `createDocumentError` injection; it is simply never used.
- **T2:** `wrapAppwriteError` (`shared/src/prompts/repository.ts:32-36`) is the sole enforcement of the pinned "no raw Appwrite dumps/secrets in thrown messages" constraint and is called at four sites, but no test injects a non-404/non-409 Appwrite error (e.g. 500) to exercise the wrapping path.

## Dependencies

- Builds on: **features 01–06 of this stage** (already `verified`) — specifically the shared model-defaults validator (F04/F05), the scorer phase (F01/F06), and the prompts repository (F01).
- Anchor: `.ssc/reviews/review-stage-07-prompt-and-model-management-2026-07-14.md`.

## Constraints

- **No behavior change for valid inputs.** Existing valid `author/slug` and `author/slug:free` IDs must still pass; existing scorer output for shipped defaults must be byte-identical; existing prompts-repository tests must stay green.
- **No schema/collection changes.** No GUI changes. No new dependencies.
- **Server-only Appwrite** conventions and operator-safe error messages unchanged.
- **Secrets:** never log API keys, session secrets, or full env dumps; the T2 tests assert sanitization, not raw dumps.
- Do **not** alter the placeholder contract, precedence cascade, or claim-time freeze.

## Acceptance criteria

- [ ] A per-role model override (create or update) containing any C1 control character (U+0080–U+009F) or zero-width character (U+200B, U+200C, U+200D) is rejected with a validation error naming the role; no partial Appwrite write occurs; the same rejection holds for Feature 04 global-default updates (shared helper). Existing valid IDs still pass. (C1)
- [ ] The scorer value-preparation logic exists in exactly one location; a parity test verifies that `ArticleScorer.formatPrompt` with `promptTemplate = SHIPPED_SCORER_PROMPT` produces byte-identical output to `SCORER_PROMPT_TEMPLATE` for the same inputs. (M1)
- [ ] A test injects a 409 on `createDocument` and asserts `getOrCreatePromptTemplate` recovers via re-get without throwing; a 409-then-404-on-re-get wraps to `PromptRepositoryError` code `appwrite`. (T1)
- [ ] At least one test injects a non-404/non-409 Appwrite error (e.g. 500) and asserts the thrown `PromptRepositoryError` has code `appwrite` and a generic operator-safe message (not raw Appwrite text); the `wrapAppwriteError` path is exercised. (T2)
- [ ] `pnpm typecheck` and `pnpm lint` pass; `pnpm --filter @newsletter/shared test` passes.

## Files

- Modify: `shared/src/settings/model-defaults.ts` (`hasWhitespaceOrControl` — broaden charset) (C1)
- Modify: `shared/src/settings/__tests__/model-defaults.test.ts` (C1 rejection cases)
- Modify: `shared/src/newsletters/__tests__/validation.test.ts` (C1 rejection cases for create + update) (C1)
- Modify: `shared/src/pipeline/scorer.ts` (extract shared value-prep helper) (M1)
- Modify: `shared/src/pipeline/__tests__/scorer.test.ts` (parity test) (M1)
- Modify: `shared/src/prompts/__tests__/repository.test.ts` (409 re-get + wrapAppwriteError tests) (T1, T2)

## Tasks

### Task 1: Broaden model-ID control/whitespace rejection (C1)

- **Action**: In `shared/src/settings/model-defaults.ts`, broaden `hasWhitespaceOrControl` so it rejects any non-printable character. Recommended form: reject code points `<= 0x1f`, the range `0x7f–0x9f` (DEL + C1 controls), JS `\s`, and the zero-width/format characters U+200B, U+200C, U+200D (optionally U+FEFF BOM). Alternatively reject any char whose Unicode general category is Cc or Cf. Add rejection tests in `shared/src/settings/__tests__/model-defaults.test.ts` and in `shared/src/newsletters/__tests__/validation.test.ts` (the rejection table near line 350) covering NEL (U+0085), PAD (U+0080), ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D) — each must throw with a role-naming validation error for BOTH `resolveCreateFields` and `resolveUpdateFields`. Confirm existing valid `author/slug` and `author/slug:free` cases still pass.
- **Expected result**: Invisible characters no longer validate/persist; valid IDs unaffected; both newsletter and global-default surfaces covered by the shared fix.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/settings src/newsletters/__tests__/validation.test.ts` then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: none.

### Task 2: Consolidate scorer value-preparation (M1)

- **Action**: In `shared/src/pipeline/scorer.ts`, extract the join-topics / `"None"`-fallback value-preparation into a single module-level helper (e.g. `prepareScorerValues(topics, dislikedTopics, tags, title): Record<string, string>`) and use it in both `SCORER_PROMPT_TEMPLATE` and `ArticleScorer.formatPrompt`'s custom-template branch (so the shipped-default and DB-loaded-custom paths share one implementation). Keep `SCORER_PROMPT_TEMPLATE` a callable with the existing argument shape. Add a parity test in `shared/src/pipeline/__tests__/scorer.test.ts`: construct an `ArticleScorer` with `promptTemplate = SHIPPED_SCORER_PROMPT`, call `scoreArticles` with known inputs, and assert the prompt sent to the LLM client is byte-identical to `SCORER_PROMPT_TEMPLATE(same inputs)`.
- **Expected result**: Value-prep lives in one location; parity test guards against silent custom-vs-default divergence; existing scorer tests remain green.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/pipeline/__tests__/scorer.test.ts` then `pnpm typecheck`.
- **Depends on**: none (independent of Task 1).

### Task 3: Add prompts-repository coverage for race recovery + redaction guard (T1, T2)

- **Action**: In `shared/src/prompts/__tests__/repository.test.ts`, add: (a) a 409-on-create case — set `getDocumentError` = 404 AND `createDocumentError` = appwrite exception (`conflict`, 409); call `getOrCreatePromptTemplate`; assert it re-gets (`getDocumentCalls` length 2), `createDocumentCalls` length 1, and the returned body comes from the re-get path; also test 409-then-404-on-re-get wrapping to `PromptRepositoryError` code `appwrite`. (b) An error-injection case — set `getDocumentError`/`updateDocumentError` to a 500 appwrite exception; call `getOrCreatePromptTemplate` / `updatePromptTemplate`; assert the thrown `PromptRepositoryError` has code `appwrite` and a generic operator-safe `.message` (not the raw Appwrite text), exercising `wrapAppwriteError`. Optionally spy `console.error` and assert a sanitized message shape.
- **Expected result**: The `isConflict` re-get branch and the `wrapAppwriteError` path are both exercised; a regression in either would fail a test.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/repository.test.ts` then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: none (independent of Tasks 1–2).

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm typecheck && pnpm lint`
- Expected: all shared tests green (including new C1 rejection cases, scorer parity test, and the two repository coverage paths); typecheck and lint clean (ignore benign missing `pages/` eslint noise). Confirm valid model IDs and shipped-default scorer output are unchanged.

## Handoff

Builder reports: files modified; confirmation that invisible-character model IDs are now rejected on both newsletter and global surfaces (shared helper); confirmation that the scorer value-prep is consolidated and the parity test passes; confirmation that the 409 re-get and `wrapAppwriteError` paths are now covered; confirmation that no valid-input behavior changed. Reference report: `.ssc/reviews/review-stage-07-prompt-and-model-management-2026-07-14.md`.
