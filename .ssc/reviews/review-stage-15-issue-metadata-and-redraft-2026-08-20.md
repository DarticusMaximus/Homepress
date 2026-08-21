# SSC Code Review Report

**Date:** 2026-08-20
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-15-issue-metadata-and-redraft (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-15-issue-metadata-and-redraft/feature-0{1–4}-*.md`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 3 | Low 0 | Nit 0
- **Overall rationale:** Stage 15 Intent is delivered: stored title/dek after draft, cheap-pass overlay that cannot fail the run, surfaces prefer stored fields with extract fallback, factory-only regenerate that restores completed on abort and skips auto-deliver. Three Confirmed Mediums remain: prompts actions still write with the API-key client and no session check (Stage 15 extended that path with `titleDekModel`); regenerate abort logs omit the causal error on the highest-likelihood redo failures; Feature 04 tests stub overlay to null, so a later `if (!isRegenerate) skip overlay` would stay green. Validator downgraded the auth finding from High to Medium (cookie-presence middleware, single-operator, pre-existing pattern). No Blockers.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** stage-15-issue-metadata-and-redraft (all four verified features)
- **Base reference:** n/a (SSC-native scope; working tree as of 2026-08-20)
- **Profile / floor:** full / Medium. Reviewers and validator: Grok 4.6 high.
- **Batches:** B1 (Feature 01 persist + F03 helpers / F04 repo writes in the same files — no findings), B2 (Features 02 + 04 execute/regenerate backend), B3 (Feature 02 prompts/models/GUI), B4 (Features 03 + 04 surfaces/GUI — no findings); then one validator pass
- **Files reviewed:** 69 paths

  Persist / schema / helpers (B1):
  - `shared/src/schema/declarations.ts`, `shared/src/schema/__tests__/declarations.test.ts`
  - `shared/src/runs/types.ts`, `shared/src/runs/repository.ts`, `shared/src/runs/__tests__/repository.test.ts`, `shared/src/runs/__tests__/mock-client.ts`
  - `shared/src/runs/issues.ts`, `shared/src/runs/__tests__/issues.test.ts`

  Cheap pass + regenerate backend (B2):
  - `shared/src/pipeline/issue-metadata.ts`, `shared/src/pipeline/__tests__/issue-metadata.test.ts`, `shared/src/pipeline/index.ts`
  - `shared/src/runs/execute-run.ts`, `shared/src/runs/__tests__/execute-run.test.ts`
  - `shared/src/runs/regenerate-draft.ts`, `shared/src/runs/__tests__/regenerate-draft.test.ts`
  - `shared/src/runs/resolve-run-llm.ts`, `shared/src/runs/__tests__/resolve-run-llm.test.ts`, `shared/src/runs/index.ts`

  Prompts / models / cascade (B3):
  - `shared/src/prompts/{types,defaults}.ts`, `shared/src/prompts/__tests__/{contract,repository}.test.ts`
  - `shared/src/pipeline/config.ts`, `shared/src/pipeline/resolve-model.ts`, matching tests
  - `shared/src/settings/{types,model-defaults,repository}.ts` + settings tests
  - `shared/src/newsletters/{types,validation,repository}.ts` + newsletter tests
  - `web/components/prompts/{prompts-editor,reset-prompt-dialog,global-model-defaults}.tsx`
  - `web/app/(protected)/admin/prompts/{page.tsx,actions.ts}` + prompts tests
  - `web/components/newsletters/newsletter-model-override-fields.tsx`
  - `web/app/(protected)/admin/newsletters/actions.ts` + newsletter form/action tests
  - `.env.example`

  Surfaces + regenerate GUI (B4):
  - `shared/src/delivery/send-issue-email.ts`, `publish-issue-to-rss.ts` + delivery tests
  - `web/components/issues/issue-reader.tsx` + issue-reader / chrome / listen tests
  - Home/channel/admin list source-read tests
  - `web/components/runs/{regenerate-draft-button,regenerate-draft-dialog,runs-table,run-list-card}.tsx`
  - `web/app/(protected)/admin/runs/actions.ts`, `web/src/__tests__/regenerate-draft-button.test.tsx`, `runs-responsive-list.test.tsx`

  Validator also opened: `web/app/(protected)/admin/runs/actions.ts` (retry/regenerate auth comparison), middleware/cookie gate, Next 15.3 layout-vs-action behavior

- **Files skipped:**
  - ~20 fixture-only diffs (`issueTitle: ""` / `titleDekModel: ""` on `makeRun`) — dashboard, lookback, retention, retry, start, due-check, worker poller, most delivery stubs — typecheck defaults, no new logic
  - `.ssc/` specs (anchors, not implementation)
  - Live Appwrite provisioner run / OpenRouter
  - Provisioner source unless a declaration test required it (create-if-absent; no finding)
- **Assumptions and unknowns:**
  - Single signed-in operator until Stage 16; path-based Admin vs reader chrome is the spec, not an AuthZ hole
  - Next 15.3: layouts are not a Server Action security boundary; middleware runs on action POSTs but only checks `a_session_*` cookie presence, not `account.get()`
  - Feature 02 overlay in production is unconditional after a non-empty draft (validator); N1 is a test hole, not a live skip
  - Low/Nit dropped except anti-cheat (N1 reported at Medium)

---

## SSC Intent Check

- **Stage Intent:** Give each issue a real title and dek from a cheap post-draft pass, and a factory action to regenerate the draft on a completed run — so the digest you actually have time to read is labeled honestly, and a short “success” is recoverable without re-running the whole pipeline.
- **Feature Intent lines:**
  1. Store title and dek on the completed run (extract at complete time); older/empty still fall back to first-heading / first-paragraph / newsletter-and-date
  2. Cheap-model pass writes honest title/dek onto those fields without failing the run if the pass hiccups
  3. Home, channels, factory lists, issue chrome, email subject, and RSS item title use stored fields when present
  4. Redo only the prose on a completed run without re-fetching or re-selecting; already-sent email / already-published RSS stay put until Send/Publish again
- **Intent served?** Yes — persist, overlay-without-fail, stored-field surfaces, factory-only regenerate with restore-on-abort and skipped auto-deliver all landed in production.
- **Notes:** N1 is a Feature 04 verifier hole (regenerate tests would not catch a later overlay skip), not live drift. Production overlay has no `isRegenerate` gate. S1 is auth hygiene on a write surface Stage 15 extended; it does not stop title/dek generation or regenerate from working for the signed-in operator.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [x] S1-20260820: Prompts actions write with API key and no session check

| Field | Value |
|---|---|
| **ID** | `S1-20260820` |
| **Severity** | Medium (reviewer High; validator downgrade) |
| **Category** | Security |
| **Location** | `web/app/(protected)/admin/prompts/actions.ts:47-118` |
| **Description** | `updatePromptTemplateAction`, `resetPromptTemplateAction`, and `updateGlobalModelDefaultsAction` call `getServerAppwrite()` (Appwrite API key) and persist prompt bodies / `titleDekModel` without `getAuthenticatedUser()`. Newsletter mutators in the same stage reject unauthenticated callers before any write. The `(protected)` layout session check is not a Server Action security boundary on Next 15.3. |
| **Risk / Impact** | A request that presents an `a_session_*` cookie shape (middleware only checks presence) plus matching Origin can rewrite global Title/Dek/Drafter templates and the shared `titleDekModel`. That poisons future digest labels. Cookieless POST is redirected. Homepress is still a single-operator household app; feeds/settings/retry/regenerate share the same missing action-level check. Stage 15 still extended this write with `titleDekModel`. |
| **Evidence** | `prompts/actions.ts` has no `getAuthenticatedUser` import or session branch. `newsletters/actions.ts` gates every mutator. `prompts-actions.test.ts` never mocks session; newsletters tests have a “session gates” suite. Validator: middleware checks cookie name presence, not `account.get()`. |
| **Recommendation** | Mirror newsletter actions: `await getAuthenticatedUser()` at the top of all three prompt actions; if null, return `ok: false` with the generic operator-safe error and do not call `getServerAppwrite` or the repositories. Add the same unauthenticated tests already used for newsletters. Broader action-level session gating is Stage 16-shaped; this finding is the Stage 15 write surface. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | In `prompts-actions.test.ts`, mock `getAuthenticatedUser` to null and assert the three actions return `ok: false`, do not call `getServerAppwrite` / the repos, and do not revalidate. Authenticated happy path still persists `titleDekModel`. |
| **Acceptance Criteria** | All three actions in `prompts/actions.ts` return a failure result and perform no Appwrite writes when `getAuthenticatedUser()` is null. Tests cover unauthenticated rejection for template save, reset, and global model save including `titleDekModel`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Session gap and API-key writes match current code, including `titleDekModel`. Cookieless unauthenticated POST is blocked by middleware, so High was overstated. Residual issue is real: forged cookie-shaped request + API-key write. Newsletters in the same batch show the intended gate. |

---

### [x] N1-20260820: Regenerator tests stub overlay; a skip-on-regenerate would still pass

| Field | Value |
|---|---|
| **ID** | `N1-20260820` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `shared/src/runs/__tests__/execute-run.test.ts:294-301,393-458,3217-3420` |
| **Description** | Feature 04 `executeRun` tests always spread `happyPathOptions()`, which stubs `generateIssueTitle` / `generateIssueDek` to `null`, and never assert those overlays ran. Skipping Feature 02 overlay when `isRegenerate` is true would still pass cases 9–17. |
| **Risk / Impact** | Feature 04 pin requires extract + overlay on regenerate success (same complete path, do not duplicate generators). A regenerate-only skip would leave Home labeling the old extract/lead-story title after a prose redo. Production currently runs overlay unconditionally after a non-empty draft; the regenerate suite would not catch a later gate. |
| **Evidence** | `stubIssueMetadataGenerators` returns `vi.fn().mockResolvedValue(null)` for both generators; `happyPathOptions` spreads that into every regenerate test. Case 9 asserts `endedAt`, skipped autoDeliver, no fetch/tag/score/select, and one draft checkpoint — not generator calls or post-overlay `issueTitle` / `issueDek`. Feature 02 cases 11–16 cover overlay only on a first-time happyPath run. Validator: `execute-run.ts:766-801` has no `isRegenerate` gate. |
| **Recommendation** | On at least the regenerator success case, pass non-null overlay stubs (or omit stubs like Feature 02 test 16) and assert `generateIssueTitle` / `Dek` were called once with claim-time `titleDek` model + draft markdown, and `markCompleted` received the overlay strings plus preserved `endedAt`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Regenerator fixture with `generateIssueTitle` → `"Generated Title"`, `generateIssueDek` → `"Generated dek sentence."`: `markCompleted` `issueTitle`/`issueDek` are those strings and `endedAt` is `REGENERATE_ENDED_AT`; autoDeliver not called. Control: if overlay were wrapped in `if (!isRegenerate)`, this test must fail. |
| **Acceptance Criteria** | At least one regenerate success test fails if Feature 02 overlay is skipped or duplicated when `isDraftRegenerateRun` is true, while still asserting preserved `endedAt` and no autoDeliver. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Production overlay is unconditional; the hole is the Feature 04 suite. Hermetic LLM stubs are legitimate; `if (!isRegenerate) skip overlay` would keep Feature 02 and Feature 04 tests green. Recommendation to add a test is the right fix, not a production change. |

---

### [x] O1-20260820: Regenerate abort logs omit the causal error

| Field | Value |
|---|---|
| **ID** | `O1-20260820` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `shared/src/runs/execute-run.ts:90-105,213-218,876-881` |
| **Description** | Regenerate abort drops the reason the redo failed. `failRun` ignores `MarkFailedInput.failureMessage` and only calls `abortRegenerate`; the outer catch computes `message` from the thrown error and never logs it; `abortRegenerate` on a successful restore logs only `{ phase: "regenerate-draft-abort", runId }`. |
| **Risk / Impact** | A truncated-draft redo that dies on a missing OpenRouter key, config build error, or drafter throw snaps the issue back to the old completed draft with no causal log. Operators see “Draft regeneration started” then the same prose, with no way to tell a silent abort from a successful rewrite besides correlating timestamps. |
| **Evidence** | `failRun` returns after `abortRegenerate` without logging `input.failureMessage`. Outer catch binds `message` then returns after abort on `isRegenerate`; that string is unused. `abortRegenerate` success path is `console.log({ phase, runId })` only. Validator path split — logs a cause first: LLM-resolution, resume-hydrate, empty-draft `fatal-outcome`, `markCompleted` double-fail. Silent: config-build fail, OpenRouter key source none, drafter/savePhaseCheckpoint/unexpected throws via outer catch. |
| **Recommendation** | Log a sanitized reason on every regenerate abort (`failureMessage` or `err.message`) alongside phase `regenerate-draft-abort` and `runId`, including the `failRun` and outer-catch paths. Keep `restoreCompleted` / do-not-`markFailed` behavior unchanged. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Regenerator fixture + drafter throw: assert console.error/log includes phase `regenerate-draft-abort`, `runId`, and a sanitized slice of `"drafter exploded"`. Same for OpenRouter key source none: message includes `"OpenRouter API key is not set"`. Assert `markFailed` still not called. |
| **Acceptance Criteria** | Every `abortRegenerate` path logs `runId` plus a sanitized causal message; `restoreCompleted` still runs; `markFailed` is still not called for this run id. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Spec pin does not require a causal message on abort; impact is still real on the highest-likelihood redo failures (missing key, drafter throw). Empty-draft and LLM-resolution pre-logs do not cover most abort paths. Matches Medium, not High: abort is visible via the phase log plus restored completed status. |

---

## Dependencies and Licensing

- Vulnerabilities: none identified in this pass (no new packages in Stage 15)
- Outdated critical packages: none reviewed
- License concerns: none

---

## Quality Signals

- Lint/config signals: not re-run this pass; Features 01–04 gated on `pnpm typecheck` / `pnpm lint` / `pnpm test` at verify
- Test/coverage signals: persist, overlay (first-time), display helpers, email/RSS passthrough, regenerate request guards, abort/restore, factory-only GUI, and `showOps` are covered. Holes: regenerate success overlay (N1); prompts action session (S1); abort causal log (O1)
- Complexity/churn signals: `execute-run.ts` and `execute-run.test.ts` absorbed Features 01, 02, and 04; regenerate abort matrix is the sharp edge. B1 persist contract and B4 surfaces/GUI came back empty
- Validator kept all three draft findings; downgraded S1 High → Medium

---

## Risk Assessment

- **Overall risk:** Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Stage 16 household roles / action-level auth across all admin mutators; live OpenRouter/Appwrite; fixture-only `makeRun` defaults; historical RSS/email rewrite (explicitly out of stage)

No Blocker or High. The stage works. N1 is the only finding that would let a future overlay skip land on regenerate without a red test. O1 is operator-debug. S1 is real but bounded (cookie-presence middleware, single operator, pre-existing pattern that Stage 15 extended).

---

## PM Triage

Filled 2026-08-21. PM accepted all three Confirmed Mediums. Hardening spec: `.ssc/stages/stage-15-issue-metadata-and-redraft/feature-05-hardening-review-2026-08-20.md`.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1-20260820 | Medium | Address now | Session gate on the Stage 15 prompt/model write surface |
| N1-20260820 | Medium | Address now | Regenerator overlay verifier hole |
| O1-20260820 | Medium | Address now | Abort must log why the redo snapped back |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
