# SSC Code Review Report

**Date:** 2026-07-14
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-07-prompt-and-model-management (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-07-prompt-and-model-management/` (features 01–06)

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 4 | Low 0 | Nit 0
- **Overall rationale:** Stage 07 is well-implemented: the model-resolution cascade, claim-time freeze, server-only Appwrite access, secret-redaction in logs, and operator-safe error messages were all verified correct across the security-sensitive F04/F06 surface (B2 returned zero findings). No Blockers or Highs and no spec drift was detected. The four Medium findings are narrow: a shared model-ID validation rule that misses invisible Unicode characters (C1, a real deviation from a pinned rule), one duplicated value-prep fork in the scorer (M1), and two repository test-coverage gaps on a concurrency-recovery path and a pinned secret-redaction guard (T1, T2). None break the feature today; all are regression-risk and correctness-hardening items suitable for a single hardening feature.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-07-prompt-and-model-management` (6 verified features: prompt store, prompts editor, reset-to-default, global model defaults, per-newsletter model overrides, run-time resolution)
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 46 (production + tests across `shared/` and `web/`)
  - **Batch B1 — Prompt store + render refactor (F01, F03 shared):** `shared/src/prompts/{types,contract,defaults,repository,index}.ts`, `shared/src/prompts/__tests__/{contract,repository}.test.ts`, `shared/src/schema/declarations.ts`, `shared/src/schema/__tests__/declarations.test.ts`, `shared/src/pipeline/{tagger,scorer,drafter}.ts`, `shared/src/pipeline/__tests__/{tagger,scorer,drafter}.test.ts`
  - **Batch B2 — Model resolution + run-time wiring (F04, F06):** `shared/src/settings/{repository,types,model-defaults,index}.ts`, `shared/src/settings/__tests__/{repository,model-defaults}.test.ts`, `shared/src/pipeline/{resolve-model,config,mmr-selection,cross-run-suppress}.ts`, `shared/src/pipeline/__tests__/{resolve-model,config,mmr-selection,cross-run-suppress}.test.ts`, `shared/src/runs/{execute-run,resolve-run-llm}.ts`, `shared/src/runs/__tests__/{execute-run,resolve-run-llm}.test.ts`
  - **Batch B3 — Web UI + newsletter overrides (F02, F03, F05):** `web/app/(protected)/prompts/{actions,page}.tsx`, `web/components/prompts/{prompts-editor,reset-prompt-dialog,global-model-defaults}.tsx`, `web/components/ui/tabs.tsx`, `web/src/__tests__/{prompts-editor,prompts-actions,global-model-defaults}.test.{tsx,ts}`, `shared/src/newsletters/{types,validation,repository}.ts`, `shared/src/newsletters/__tests__/{validation,repository}.test.ts`, `web/components/newsletters/newsletter-form-dialog.tsx`, `web/app/(protected)/newsletters/actions.ts`, `web/src/__tests__/{newsletter-form-model-overrides,newsletters-actions}.test.{tsx,ts}`
- **Files skipped:**
  - `worker/**` — not modified by any stage-07 feature (all changes land in `shared/` and `web/`); out of scope.
  - Non-stage-07 files in `shared/src/pipeline/` (e.g. `llm-client.ts`, `scraper.ts`, `rss-fetcher.ts`, `orchestrator.ts`) — only sampled for cross-reference; no stage-07 changes reported against them.
  - `package.json` / lockfiles / CI config — not security-relevant to stage 07; not reviewed line-by-line.
- **Assumptions and unknowns:**
  - Reviewers relied on the spec Files sections cross-checked against disk; all spec'd files were present.
  - No live Appwrite / OpenRouter integration tests were run; correctness of Appwrite round-trips and OpenRouter ID semantics judged from unit tests + spec contract only.
  - Anti-cheat pass applied to all batches regardless of profile; none of the four findings is anti-cheat (no hardcoded test-matching values, swallowed failures, disabled tests, or over-mocking detected).

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Feature Intent lines:** (all six)
  - F01 — Persist the three reusable LLM prompt templates under a fixed named-placeholder contract, seeded from shipped code defaults, editable later without redeploy.
  - F02 — View/edit the three templates on the Prompts page, seeing allowed placeholders; takes effect next run.
  - F03 — Restore any template to the built-in shipped default from the editor; bad edits recoverable without code change.
  - F04 — Set free-text OpenRouter model IDs per role in the GUI; env as bootstrap/fallback only; next-run effect.
  - F05 — Optional per-role model overrides on a newsletter; blank keeps shared defaults.
  - F06 — At run start, load templates + resolve each role's model (newsletter → global → env → built-in); in-flight phases keep claim-time values.
- **Intent served?** Yes
- **Notes:** No spec drift detected. Validator confirmed: scorer/drafter remain callables with pinned arg shapes (F01); placeholder contract reject-missing/warn-unknown enforced; reset delegates to `updatePromptTemplate` (F03); `getModelName` stays env→built-in only while the run path uses the injected `resolveModelId` cascade (F06); claim-time freeze asserted exactly-once across a multi-phase claim; explicit phase mocks still override; load failure marks the run failed rather than silently falling back; global defaults not seeded from env on virgin create; newsletter overrides persist `""` when cleared. The findings below are coverage/validation hardening, not intent failures.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [ ] C1-20260714: Model-ID validation lets invisible Unicode (C1 controls + zero-width chars) through

| Field | Value |
|---|---|
| **ID** | `C1-20260714` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/settings/model-defaults.ts:30-44` (`hasWhitespaceOrControl` / `normalizeModelIdFields`); consumed by `shared/src/newsletters/validation.ts:194-202`; test gap at `shared/src/newsletters/__tests__/validation.test.ts:350-363` |
| **Description** | `hasWhitespaceOrControl` rejects only C0 controls (≤0x1F), DEL (0x7F), and JS `\s`. It does NOT reject C1 control characters (U+0080–U+009F, e.g. NEL/PAD) or zero-width/format characters (U+200B ZERO WIDTH SPACE, U+200C ZWNJ, U+200D ZWJ). Feature 05 Validation rule 5 explicitly pins: "Reject values containing whitespace or control characters after trim." These invisible characters pass `normalizeModelIdFields` → `isOpenRouterStyleId`, validate, and persist — for both newsletter overrides (F05) and global defaults (F04), since they share the helper. |
| **Risk / Impact** | An operator who pastes a model ID containing a stray zero-width space (common when copying from web pages, which insert U+200B for line breaking) gets a value that looks identical to the intended ID, passes validation, is stored to Appwrite, then fails at run start with an opaque OpenRouter "model not found" that is very hard to debug because the ID renders as correct. C1/zero-width chars are also a known identifier-confusion vector. One fix closes both the F04 and F05 surfaces. |
| **Evidence** | `if (code <= 0x1f \|\| code === 0x7f \|\| /\s/.test(value[i]!)) return true;` — JS `\s` matches only Space_Separator (Zs: 0x2000–0x200A, 0xA0, …) + C0/line terminators, so U+0080–U+009F (Cc), U+200B/C/D (Cf) each fail all three guards and return false. `.trim()` removes none of them; `isOpenRouterStyleId` has no charset guard. Validator per-character verification confirmed e.g. `openai/gpt-4o-mini\u200B` validates and persists. The rejection table in `validation.test.ts:350-363` covers only no-slash / too-long / internal-ASCII-space / null-byte. |
| **Recommendation** | Broaden `hasWhitespaceOrControl` in `shared/src/settings/model-defaults.ts` to reject any non-printable character. Simplest robust form: `if (code <= 0x1f \|\| (code >= 0x7f && code <= 0x9f) \|\| /\s/.test(value[i]!)) return true;` plus an explicit check for U+200B–U+200D (or reject any char whose Unicode category is Cc/Cf). Consumed automatically by `validation.ts` for both create and update resolvers. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Extend the rejection table with: `provider/mod\u0085el` (NEL), `provider/mod\u200Bel` (ZWSP), `provider/mod\u200Del` (ZWJ), `provider/mod\u0080el` (PAD) — each must throw `NewsletterRepositoryError(validation)` naming the role, for BOTH `resolveCreateFields` and `resolveUpdateFields`. Add a parallel assertion in the F04 `shared/src/settings/__tests__/model-defaults.test.ts`. |
| **Acceptance Criteria** | A per-role model override (create or update) containing any C1 control (U+0080–U+009F) or zero-width char (U+200B/C/D) is rejected with a validation error naming the role; no partial Appwrite write occurs (existing `createDocumentCalls`/`updateDocumentCalls` length===0 assertions hold); existing valid `author/slug` and `author/slug:free` IDs still pass; the new rejection cases pass for both newsletter and global-default validation. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Reading `model-defaults.ts:30-36` and reasoning per code point: JS `\s` matches only Space_Separator + C0/line terminators, so U+0080–U+009F (Cc) and U+200B/C/D (Cf) each fail all three guards and pass `hasWhitespaceOrControl`; `.trim()` removes none; `isOpenRouterStyleId` has no charset guard. The reviewer's per-character claims all hold. |

---

### [ ] M1-20260714: Scorer value-preparation logic duplicated across two reachable code paths

| Field | Value |
|---|---|
| **ID** | `M1-20260714` |
| **Severity** | Medium |
| **Category** | Maintainability |
| **Location** | `shared/src/pipeline/scorer.ts:42-44` (`SCORER_PROMPT_TEMPLATE`) and `scorer.ts:282-284` (`ArticleScorer.formatPrompt` custom-template branch) |
| **Description** | The scorer value-preparation logic (join topics with `", "`, empty `dislikedTopics`→`"None"`, empty `tags`→`"None"`) is duplicated verbatim between the exported `SCORER_PROMPT_TEMPLATE` callable and the internal `ArticleScorer.formatPrompt` custom-template branch. The tagger avoids this via a single render path (`this.promptTemplate ?? TAGGER_PROMPT_TEMPLATE`); the drafter prepares values before branching. The scorer forks the same join/None logic into two separate code sites, both reachable in production once Feature 06 injects DB-loaded templates via `promptTemplate`. |
| **Risk / Impact** | When Feature 06 loads custom templates from Appwrite and passes them via the `promptTemplate` option, both code paths run in production. If the join/None logic is edited in one site but not the other (separator change, "None" fallback change), the DB-loaded custom template would produce silently different prompt output than the shipped default for identical inputs — a parity violation extremely hard to detect since prompts are long free-text strings. |
| **Evidence** | Lines 42–44 and 282–284 hold byte-identical `join(", ")` / `length>0 ? join : "None"` logic. `tagger.ts:175` uses a single `this.promptTemplate ?? TAGGER_PROMPT_TEMPLATE` path; `drafter.ts:119` prepares `topicsStr` before the branch — only the scorer forks. |
| **Recommendation** | Extract a module-level helper (e.g. `prepareScorerValues(topics, dislikedTopics, tags, title): Record<string, string>`) and use it in both `SCORER_PROMPT_TEMPLATE` and `formatPrompt`'s custom branch. Alternatively, refactor `formatPrompt` to use `this.promptTemplate ?? SHIPPED_SCORER_PROMPT` with a single render call (matching the tagger pattern), keeping `SCORER_PROMPT_TEMPLATE` as a thin backward-compatible wrapper. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Add a parity test: construct an `ArticleScorer` with `promptTemplate = SHIPPED_SCORER_PROMPT`; call `scoreArticles` with known inputs; assert the prompt sent to the LLM client is byte-identical to `SCORER_PROMPT_TEMPLATE(same inputs)`. This test would fail today if the two implementations diverge. |
| **Acceptance Criteria** | The join/None value-preparation logic exists in exactly one location. A parity test verifies that `formatPrompt` with `promptTemplate = SHIPPED_SCORER_PROMPT` produces byte-identical output to `SCORER_PROMPT_TEMPLATE` for the same inputs; existing scorer tests remain green. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | `scorer.ts:42-44` and `282-284` hold byte-identical value-prep; `tagger.ts:175` and `drafter.ts:119` genuinely avoid the fork. Feature 06 wires DB-loaded templates into `promptTemplate`, making the custom branch live — so editing one fork silently diverges custom vs shipped-default output. |

---

### [ ] T1-20260714: Create-race (409 conflict) re-get path in getOrCreatePromptTemplate is untested

| Field | Value |
|---|---|
| **ID** | `T1-20260714` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `shared/src/prompts/repository.ts:95-107`; test gap across `shared/src/prompts/__tests__/repository.test.ts` (entire file) |
| **Description** | `getOrCreatePromptTemplate` implements the spec-pinned "On create race, re-get" branch (`isConflict(err2)` → re-`getDocument`), but no repository test injects a 409 conflict on `createDocument`. Every test either gets a successful `getDocument` or a 404-then-successful-create. The mock harness supports `createDocumentError` injection but it is never used. |
| **Risk / Impact** | Two workers booting simultaneously on a fresh DB (or two operator save/reset calls racing) would both 404, both attempt `createDocument`, and the loser gets a 409. If the `isConflict` branch regressed (removed or re-get skipped), concurrent first-time template seeding would surface an unhandled/raw Appwrite error instead of recovering — a reliability regression that only manifests under concurrency and is hard to catch manually. |
| **Evidence** | `repository.ts:95` `if (isConflict(err2))` — no test sets `createDocumentError`. The shared mock client checks `createDocumentError` in `createDocument`, so the gap is a missing test, not a harness limitation. |
| **Recommendation** | Add a test: `getDocumentError` = 404 AND `createDocumentError` = appwrite exception (`conflict`, 409); call `getOrCreatePromptTemplate`; assert it re-gets (`getDocumentCalls` has 2 entries), `createDocumentCalls` has 1, and the returned template body comes from the re-get path. Also test a 409-then-404-on-re-get wrapping to a safe Appwrite error. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | 1) 404 → create → 409 → re-get succeeds (returns template from re-get). 2) 404 → create → 409 → re-get also 404 (wraps to `PromptRepositoryError` code `appwrite`). |
| **Acceptance Criteria** | A test injects a 409 on `createDocument` and asserts `getOrCreatePromptTemplate` recovers via re-get without throwing; the conflict branch (lines 95–107) is exercised. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | `repository.ts:95-107` implements the branch; `repository.test.ts` (all 321 lines) never sets `createDocumentError` — only `getDocumentError=404`. The harness supports injection, so this is a genuine coverage gap on a concurrency path with a runtime workaround (retry). |

---

### [ ] T2-20260714: wrapAppwriteError (pinned secret-redaction guard) is never exercised by tests

| Field | Value |
|---|---|
| **ID** | `T2-20260714` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `shared/src/prompts/repository.ts:32-36` (`wrapAppwriteError`); call sites at `repository.ts:105,108,111,161`; test gap across `shared/src/prompts/__tests__/repository.test.ts` |
| **Description** | `wrapAppwriteError` is the sole enforcement of the pinned constraint "no raw Appwrite dumps/secrets in thrown messages." It is called at four sites (get-after-race, create-failure, get-failure, update-failure), but no test injects a non-404/non-409 Appwrite error (e.g. 500) to verify the error is wrapped to the operator-safe message with code `appwrite` and that the logged message is redacted. If it regressed to throw `err.message` directly, no test would catch the leak. |
| **Risk / Impact** | Appwrite error messages can contain internal paths, connection details, or echoed request data. The pinned constraint is a security gate. An untested wrapping function means a one-line regression could silently leak operator-facing Appwrite internals with no test failure. The code is correct today, so this is regression-risk coverage rather than an active leak. |
| **Evidence** | No test sets `createDocumentError`, `updateDocumentError`, or a non-404 `getDocumentError`; every path resolves successfully or via a validation error before reaching any `wrapAppwriteError` call site. The parallel `SettingsRepositoryError` pattern exists for comparison. |
| **Recommendation** | Add tests: (1) `getOrCreatePromptTemplate` with `getDocumentError` = 500 → throws `PromptRepositoryError` code `appwrite` with the safe message; (2) `updatePromptTemplate` with `updateDocumentError` = 500 → same; (3) optionally assert `console.error` was called with a redacted/sanitized message. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | 1) `getDocument` throws 500 → `PromptRepositoryError('appwrite', safe message)`. 2) `updateDocument` throws 500 → same. 3) Verify thrown `.message` === the safe constant (not raw Appwrite text). 4) Verify `console.error` called with phase + code + redacted message. |
| **Acceptance Criteria** | At least one test injects a non-404 Appwrite error and asserts the thrown `PromptRepositoryError` has code `appwrite` and a generic operator-safe message (not raw Appwrite text); the `wrapAppwriteError` path is exercised. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | `wrapAppwriteError` is the sole enforcement of the pinned no-raw-dumps constraint, called at 4 sites, but no test injects a non-404/non-409 error. The harness fully supports injection, so the security-relevant wrapping path is genuinely unexercised. The code is correct today → Medium fits (regression-risk coverage). |

---

## Dependencies and Licensing

- Vulnerabilities: none reviewed (no new runtime dependencies introduced by stage 07; OpenRouter ID validation is regex-only, no catalog/SDK calls).
- Outdated critical packages: not assessed (out of scope — no dependency changes in stage-07 specs).
- License concerns: none (no new dependencies).

---

## Quality Signals

- **Lint/config signals:** Not re-run during review (the project gates `pnpm typecheck` / `pnpm lint` / `pnpm test` already passed for feature verification). No stage-07-specific config drift observed.
- **Test/coverage signals:** Strong on the F04/F06 core (B2 returned zero findings; the cascade, freeze, injection, and failure paths are well-tested). Two genuine coverage gaps in the prompts repository (T1 concurrency path, T2 secret-redaction guard) and one validation charset gap (C1). Web tests assert repository-call wiring (not over-mocked stubs).
- **Complexity/churn signals:** Stage 07 touches the security-critical run path (`executeRun` model/prompt injection) cleanly — claim-time freeze is asserted exactly-once. The one maintainability smell (M1) is a localized duplication in the scorer.

---

## Risk Assessment

- **Overall risk:** Low–Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** `worker/**` (unmodified by stage 07); non-stage-07 pipeline modules; package/lock files; CI config.

The stage delivers its Intent with no drift and no Blockers/Highs. The four Medium findings are hardening items — one real validation gap (C1) worth addressing before stage close, plus three regression-risk coverage/duplication items (M1, T1, T2) that can land in a single hardening feature or be deferred without blocking finalize.

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| C1-20260714 | Medium | _pending PM_ | Invisible-char validation gap (deviates from pinned F05 rule 5); affects F04 + F05 |
| M1-20260714 | Medium | _pending PM_ | Scorer value-prep duplication; parity risk once F06 injects custom templates |
| T1-20260714 | Medium | _pending PM_ | Untested 409 create-race re-get path |
| T2-20260714 | Medium | _pending PM_ | Untested secret-redaction guard (wrapAppwriteError) |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
