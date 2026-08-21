# Feature 05: Harden stage-15 against review findings (2026-08-20)

## Intent

Harden `stage-15-issue-metadata-and-redraft` against findings from `review-stage-15-issue-metadata-and-redraft-2026-08-20`: prompt/model writes must reject a missing session, regenerate success tests must fail if title/dek overlay is skipped, and regenerate abort must log a sanitized reason — without reopening features 01–04.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–04 stay `verified`. Distilled work — not a copy of the report.

**PM triage (2026-08-21):** Address now on S1, N1, and O1.

### S1 (Medium) — prompts actions gate on `getAuthenticatedUser`

`web/app/(protected)/admin/prompts/actions.ts` `updatePromptTemplateAction`, `resetPromptTemplateAction`, and `updateGlobalModelDefaultsAction` write via `getServerAppwrite()` (API key) with no session check. Newsletter mutators already reject `getAuthenticatedUser() === null` before any write. Next 15.3 layouts are not a Server Action security boundary; middleware only checks that an `a_session_*` cookie **exists**. Stage 15 extended this write with `titleDekModel`. Feeds/settings/retry/regenerate keep the pre-existing gap — **out of this feature** (Stage 16-shaped). This feature only gates the three prompt actions.

**Fix (required):**

1. In `web/app/(protected)/admin/prompts/actions.ts`, `import { getAuthenticatedUser } from "@/lib/auth/session"`.
2. Add `const GENERIC_ERROR = "Something went wrong. Please try again.";` (byte-identical to `newsletters/actions.ts`).
3. At the **top** of all three actions, before `getServerAppwrite` / repositories / `revalidatePath`:
   ```ts
   const user = await getAuthenticatedUser();
   if (!user) {
     return { ok: false, error: GENERIC_ERROR };
   }
   ```
4. Do not change validation-error mapping, success payloads, or `titleDekModel` persistence on the authenticated path.
5. Do not add session gates to feeds, settings, or `runs/actions.ts` in this feature.

### N1 (Medium) — regenerator success asserts overlay

`happyPathOptions()` spreads `stubIssueMetadataGenerators()` (`generateIssueTitle` / `generateIssueDek` → `null`). Feature 04 case 9 asserts draft-only redo, preserved `endedAt`, and skipped autoDeliver — not overlay. Feature 02 cases 11–16 overlay on **first-time** runs only. `if (!isRegenerate) skip overlay` would keep both suites green. Production overlay after a non-empty draft is already unconditional (`execute-run.ts` ~766–801) — this is a **test** fix, not a second overlay path.

**Fix (required):**

1. Extend case **9** in `shared/src/runs/__tests__/execute-run.test.ts` (do not add a duplicate success test that leaves 9 overlay-blind).
2. After `const options = happyPathOptions()`, override:
   - `generateIssueTitle: vi.fn().mockResolvedValue("Generated Title")`
   - `generateIssueDek: vi.fn().mockResolvedValue("Generated dek sentence.")`
3. Keep existing case 9 assertions (no fetch/tag/score/select; one draft; `endedAt: REGENERATE_ENDED_AT`; autoDeliver not called; `markFailed` not called).
4. Add: both generators called **once**; `markCompleted` payload `objectContaining({ issueTitle: "Generated Title", issueDek: "Generated dek sentence.", endedAt: REGENERATE_ENDED_AT })`.
5. Do **not** change `happyPathOptions()` default stubs (Feature 01/02 hermetic tests and abort cases 10–17 still want `null`). Override only on case 9.
6. Do **not** duplicate `generateIssueTitle` / `generateIssueDek` inside `execute-run.ts`. Overlay stays the existing post-draft path.

### O1 (Medium) — regenerate abort logs a sanitized reason

`abortRegenerate` on successful restore logs `{ phase: "regenerate-draft-abort", runId }` only. `failRun` ignores `MarkFailedInput.failureMessage`. Outer catch binds `message` then aborts unused. Silent on missing OpenRouter key, config-build fail, and drafter/save/unexpected throws. Restore-on-abort and do-not-`markFailed` stay.

**Fix (required):**

1. Add a required `reason: string` argument to `abortRegenerate`.
2. On **successful** `restoreCompleted`, log:
   ```ts
   console.error({
     phase: "regenerate-draft-abort",
     runId,
     message: sanitizeAppwriteMessageForLog(reason),
   });
   ```
   (Switch the success path from `console.log` to `console.error`. Restore-throw path already logs the restore error — keep it; do not require the original abort reason on that path.)
3. Call sites:
   - `failRun` → `abortRegenerate(..., input.failureMessage)`
   - markCompleted double-fail after new checkpoint → pass the retry error string already bound (`reMsg`)
   - outer catch → pass the bound `message`
4. Do not log raw draft or completion text. Do not `markFailed` this run id. Do not change `restoreCompleted` payload.

## Dependencies

- Builds on: **features 01–04 of this stage** (already `verified`).
- Anchor: `.ssc/reviews/review-stage-15-issue-metadata-and-redraft-2026-08-20.md`.
- S1: `web/app/(protected)/admin/prompts/actions.ts`, `web/src/__tests__/prompts-actions.test.ts`; pattern: `newsletters/actions.ts` + `newsletters-actions.test.ts` “session gates (S1)”.
- N1: `shared/src/runs/__tests__/execute-run.test.ts` case 9; production overlay already in `execute-run.ts`.
- O1: `shared/src/runs/execute-run.ts` `abortRegenerate` / `failRun` / outer catch / markCompleted double-fail.

## Constraints

- **Do not reopen** features 01–04 status; this is additive hardening.
- **Keep** Feature 02: overlay cannot fail the run; independent title then dek; 512 clamps; no 160-ellipsis on LLM dek.
- **Keep** Feature 04: restoreCompleted on abort; never `markFailed` this regenerate run id; skip auto-deliver; preserve `endedAt`; draft-only (no fetch/tag/score/select); factory-only GUI.
- **Do not** session-gate every admin action (Stage 16).
- **Do not** invent a second title/dek generator path for regenerate.
- **Do not** log `{draft}` or model completion text.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] All three prompt actions return `{ ok: false, error: "Something went wrong. Please try again." }` and perform no Appwrite writes / no `revalidatePath` when `getAuthenticatedUser()` is null (S1).
- [ ] Authenticated happy path still persists prompt bodies and `titleDekModel` (S1).
- [ ] Regenerator success case 9 fails if Feature 02 overlay is skipped or duplicated when `isDraftRegenerateRun` is true, while still asserting preserved `endedAt` and no autoDeliver (N1).
- [ ] Every successful `abortRegenerate` logs `runId` plus a sanitized causal `message` at phase `regenerate-draft-abort`; `restoreCompleted` still runs; `markFailed` is still not called for this run id (O1).
- [ ] `pnpm typecheck` and `pnpm lint` pass; touched suites green.

## Files

- Modify: `web/app/(protected)/admin/prompts/actions.ts` — session gate on all three actions (S1)
- Modify: `web/src/__tests__/prompts-actions.test.ts` — unauthenticated suite + authenticated `getAuthenticatedUser` mock (S1)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — case 9 overlay asserts; O1 abort-log asserts (N1, O1)
- Modify: `shared/src/runs/execute-run.ts` — `abortRegenerate(reason)` + call sites (O1)

## Testing approach

Test-first. Unit tests only; no live Appwrite/OpenRouter.

1. **S1** — Mirror `newsletters-actions.test.ts` “session gates (S1)”:
   - `vi.mock("@/lib/auth/session", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }))`.
   - `beforeEach`: `getAuthenticatedUser.mockResolvedValue(user)` (authenticated default so existing happy paths stay green).
   - Unauthenticated: mock `null`; call each of the three actions; expect `{ ok: false, error: GENERIC_ERROR }`; `getServerAppwrite`, repos (`updatePromptTemplate` / `resetPromptTemplate` / `updateGlobalModelDefaults`), and `revalidatePath` **not** called.
   - Authenticated: existing `titleDekModel` happy path still calls `updateGlobalModelDefaults` with the five-field payload.
2. **N1** — Case 9 with non-null overlay stubs as pinned. A source-read that only greps `generateIssueTitle` in `execute-run.ts` is **not** enough — the regenerator success test must fail if overlay is wrapped in `if (!isRegenerate)`.
3. **O1** — Spy `console.error`. Regenerator + drafter throw (existing case 16): after run, some `console.error` call’s first arg `objectContaining({ phase: "regenerate-draft-abort", runId: "run-1" })` and `message` matching `/drafter exploded/` (or whatever throw string the case already uses). Regenerator + OpenRouter key source none (add if missing): `message` matches `/OpenRouter API key is not set/`; `restoreCompleted` called; `markFailed` not called. Restore behavior unchanged.

Anti-cheat: do not `.skip` these gates; do not “fix” S1 by checking a cookie name instead of `getAuthenticatedUser`; do not “fix” N1 by asserting generators were constructed but not called; do not “fix” O1 by logging only on restore-throw.

## Tasks

### Task 1: S1 prompts session gate (red → green)

- **Action**: Add the failing unauthenticated tests in `web/src/__tests__/prompts-actions.test.ts`. Gate all three actions in `web/app/(protected)/admin/prompts/actions.ts` as pinned. Mock `getAuthenticatedUser` to a user in `beforeEach` so existing happy paths compile and pass.
- **Expected result:** S1 Acceptance Criteria met.
- **Verify:** `pnpm --filter web exec vitest run src/__tests__/prompts-actions.test.ts`
- **Depends on:** none.

### Task 2: N1 regenerator overlay assert (red → green)

- **Action**: Extend case 9 in `shared/src/runs/__tests__/execute-run.test.ts` with non-null overlay stubs and `markCompleted` title/dek asserts as pinned. Do not edit production overlay unless a test proves it is gated on `!isRegenerate` (it is not).
- **Expected result:** N1 Acceptance Criteria met. Cases 10–17 still green with default `null` stubs.
- **Verify:** `pnpm exec vitest run shared/src/runs/__tests__/execute-run.test.ts`
- **Depends on:** none.

### Task 3: O1 abort causal log (red → green)

- **Action**: Add failing abort-log asserts (drafter throw + missing OpenRouter key). Thread `reason` through `abortRegenerate` and the three call sites in `shared/src/runs/execute-run.ts`. Sanitize with `sanitizeAppwriteMessageForLog`.
- **Expected result:** O1 Acceptance Criteria met. Restore / do-not-`markFailed` unchanged.
- **Verify:** `pnpm exec vitest run shared/src/runs/__tests__/execute-run.test.ts`
- **Depends on:** none (can land with Task 2 in the same file; do not fight case 9).

### Task 4: Feature gate

- **Action**: Re-read this spec vs implementation; run typecheck/lint and the touched suites; fix gaps only as needed for this feature. Do not change features 01–04 status. Tick Detailed Findings checkboxes in the review report when AC are met.
- **Expected result:** All Acceptance criteria checked; hardening complete.
- **Verify:**
  ```bash
  pnpm typecheck && pnpm lint && \
  pnpm --filter web exec vitest run src/__tests__/prompts-actions.test.ts && \
  pnpm exec vitest run shared/src/runs/__tests__/execute-run.test.ts
  ```
- **Depends on:** Tasks 1–3.

## Feature verification

- Run: the Task 4 verify matrix.
- Expected: All green. Unauthenticated prompt actions write nothing. Regenerator success fails if overlay is skipped. Abort logs a sanitized reason. Features 01–04 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; confirmation session gate uses `getAuthenticatedUser` (not cookie-name presence); confirmation case 9 would fail `if (!isRegenerate) skip overlay`; confirmation abort logs `message` and still `restoreCompleted` without `markFailed`; any deviation and why. Reference report: `.ssc/reviews/review-stage-15-issue-metadata-and-redraft-2026-08-20.md`.

## Research notes

- Review + validator (2026-08-20): S1/N1/O1 Medium Confirmed. S1 reviewer High → validator Medium (cookie-presence middleware, single-operator, pre-existing pattern). PM Address now all three (2026-08-21).
- `getAuthenticatedUser` (`web/lib/auth/session.ts`) calls `account.get()` on a session client — authoritative, unlike middleware cookie presence.
- Newsletters session-gate string: `"Something went wrong. Please try again."`
- `abortRegenerate` call sites (3): `failRun` (line 215), markCompleted double-fail (842), outer catch (880).
- Overlay after non-empty draft is unconditional; N1 is a verifier hole for Feature 04’s “then run Feature 01 extract + Feature 02 overlay” pin.
