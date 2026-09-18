# Feature 01: Fail-closed admin actions

## Intent

Any HTTP request that invokes a Homepress server action without a valid session gets nothing — no data, no mutation — enforced by default for every current and future action, so the S1 blocker (unauthenticated full admin takeover via 16 ungated actions) can never recur invisibly.

## Spec

Close audit findings S1 (Blocker), N1 (anti-cheat), and S2 (Medium) from `review-app-public-exposure-2026-09-17`:

1. **Shared guard.** Create `requireUser()` in `web/lib/auth/require-user.ts`. It wraps the existing authoritative `getAuthenticatedUser()` (`web/lib/auth/session.ts`): returns the Appwrite user when the session is valid; throws a dedicated `UnauthorizedError` (exported from the same module) when `getAuthenticatedUser()` returns null. It returns the user object (not void) because Feature 06 roles will build on it.
2. **Convention.** Every exported async server action in every `web/app/**/actions.ts` module calls `await requireUser();` as its first statement, outside any try/catch, so an unauthenticated invocation always rejects with `UnauthorizedError` before any side effect. All 27 existing exports migrate to this convention: the 16 ungated (runs: `retryFailedRun`, `regenerateDraft`, `updateRunRetentionSetting`, `purgeRunsNow`; feeds: `createFeedAction`, `updateFeedAction`, `deleteFeedAction`, `testFeed`; settings: `saveConnectionsSettingsAction`, `savePipelineKnobsSettingsAction`, `clearOpenRouterOverrideAction`, `clearSmtpOverrideAction`, `testOpenRouterConnectionAction`, `testSmtpConnectionAction`, `checkPublicUrlAction`; schedules: `updateNewsletterScheduleAction`) gain the guard; the 11 already-gated with the legacy null-envelope pattern (issues ×2, newsletters ×6, prompts ×3) migrate from `const user = await getAuthenticatedUser(); if (!user) return {ok:false, ...}` to `await requireUser();` for uniformity.
3. **Architectural test.** `web/src/__tests__/server-actions-auth.test.ts`, running in the default `pnpm test`, enforces the convention mechanically:
   - **Discovery:** recursively scan `web/app` for files named `actions.ts` at test time (fs, not a hardcoded list), so future action modules are covered automatically. Normalize paths relative to `web/`. Self-check: the discovered set (minus the allowlist) must contain at least 7 modules, else the test fails (guards against discovery silently returning nothing).
   - **Allowlist:** `web/app/login/actions.ts` is intentionally public (`loginAction` must be anonymous-reachable; `logoutAction` is best-effort/idempotent). It is the only allowlisted module; adding another requires a conscious edit to the allowlist with a comment explaining why.
   - **Runtime check (authoritative):** with `@/lib/auth/session` mocked to `getAuthenticatedUser → null`, every function export of every discovered (non-allowlisted) module, invoked with no arguments, must reject with `UnauthorizedError`. All side-effect seams are mocked to throwing recording spies so no real I/O can happen and seam-touching is detectable: `next/cache`'s `revalidatePath`, and every non-class function export of `@newsletter/shared` (classes like `SettingsRepositoryError` stay real so `instanceof` paths behave; built via `importOriginal` + key mapping, not a hand-written list). Additionally assert no seam spy was called during any invocation.
   - **Static check (covers the runtime's blind spot):** the source of each `export async function` (extracted by brace-matching from the file text — the codebase is prettier-formatted, so this is reliable) must contain a `requireUser()` call, and the module must import it from `@/lib/auth/require-user`. This catches a future ungated action that would reject dummy arguments on input validation before touching a seam.
   - **Zero-args rationale:** valid because the guard is the first statement — a correctly guarded action never touches its arguments when unauthenticated. An ungated action reaches argument parsing (TypeError) or a seam (spy error) — either way the rejection is not `UnauthorizedError` and the test fails.
4. **Middleware documented as UX-only (S2).** Add a doc comment to `web/middleware.ts` stating it is a login-page redirect convenience only — cookie-presence check, not session validation, not a security boundary — and that per-action `requireUser()` / per-route `getAuthenticatedUser()` is the enforced standard. No behavior change. Add a matching "Server-action auth boundary" section to project `AGENTS.md` so future agent sessions know the convention and the arch test.
5. **Audit bookkeeping.** Tick the S1, N1, and S2 checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings (per Plan.md carry-forward pin: tick as the feature verifies).

Considered and declined: gating `/build-id` behind auth (audit's optional suggestion). The PWA update path depends on it, the stage file does not ask for it, and action-ID discovery becomes harmless once every action rejects unauthenticated callers. Recorded here for the PM.

## Dependencies

- None — first feature in the stage. (Stage 15 is complete; the audit reviewed the codebase including Stage 15 surfaces.)

## Constraints

- Server-action function signatures and their authenticated-path return values must not change — client components that call these actions are untouched.
- `web/app/login/actions.ts` stays anonymous-reachable. Do not add an auth guard to it.
- Route handlers are out of scope: `/api/issues/[runId]/export` keeps its existing `getAuthenticatedUser()` → 401 check (Feature 06 revisits it for roles); `/rss/*`, `/health`, `/build-id` unchanged.
- `web/middleware.ts` behavior must not change — comment only. The `(protected)/layout.tsx` authoritative page check stays as is.
- `@newsletter/shared` and the worker are not modified (beyond test-file mocks inside `web/src/__tests__/`).
- The four action test files that assert the unauthenticated path (`send-issue-email-action`, `publish-issue-to-rss-action`, `prompts-actions`, `newsletters-actions` .test.ts) keep their authenticated-path cases unchanged; only unauthenticated-path assertions are rewritten to expect rejection. Three further suites cover currently-ungated actions without any session mock (`settings-actions`, `settings-diagnostics-actions`, `schedules-actions` .test.ts) — they gain a resolving `requireUser` mock in Task 3 with all existing assertions unchanged.

## Acceptance criteria

- [ ] Direct invocation of every exported server action without a valid session rejects with `UnauthorizedError` before any side effect — asserted by an architectural test that discovers every `web/app/**/actions.ts` module and runs in the default `pnpm test` command. (S1, N1)
- [ ] The architectural test demonstrably fails on non-conforming code: its first run against the current tree is red, listing exactly the 27 exports not yet on the `requireUser()` convention (16 ungated + 11 legacy-envelope). (N1)
- [ ] `web/middleware.ts` carries a comment stating it is a UX redirect convenience, not a security boundary; `AGENTS.md` documents the requireUser convention and the arch test. (S2)
- [ ] S1, N1, S2 checkboxes ticked in the audit report's Detailed Findings.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.

## Files

- Create: `web/lib/auth/require-user.ts`
- Create: `web/src/__tests__/require-user.test.ts`
- Create: `web/src/__tests__/server-actions-auth.test.ts`
- Modify: `web/app/(protected)/admin/runs/actions.ts`
- Modify: `web/app/(protected)/admin/feeds/actions.ts`
- Modify: `web/app/(protected)/admin/settings/actions.ts`
- Modify: `web/app/(protected)/admin/schedules/actions.ts`
- Modify: `web/app/(protected)/admin/newsletters/actions.ts`
- Modify: `web/app/(protected)/admin/prompts/actions.ts`
- Modify: `web/app/(protected)/issues/actions.ts`
- Modify: `web/src/__tests__/send-issue-email-action.test.ts`
- Modify: `web/src/__tests__/publish-issue-to-rss-action.test.ts`
- Modify: `web/src/__tests__/prompts-actions.test.ts`
- Modify: `web/src/__tests__/newsletters-actions.test.ts`
- Modify: `web/src/__tests__/settings-actions.test.ts`
- Modify: `web/src/__tests__/settings-diagnostics-actions.test.ts`
- Modify: `web/src/__tests__/schedules-actions.test.ts`
- Modify: `web/middleware.ts` (comment only)
- Modify: `AGENTS.md` (new auth-boundary section)
- Modify: `.ssc/reviews/review-app-public-exposure-2026-09-17.md` (tick S1, N1, S2)

## Testing approach

Test-first. The architectural test is written before any production change and must demonstrably fail (Task 2's red run is the proof that the test catches S1 — a verifier can re-insert an ungated export to re-probe).

- `require-user.test.ts`: `getAuthenticatedUser` mocked null → `requireUser()` rejects with `UnauthorizedError`; mocked to a user → resolves to the same user object; `UnauthorizedError` is an `Error` subclass named `UnauthorizedError`.
- `server-actions-auth.test.ts` (the cases that matter):
  - Every function export of every discovered non-allowlisted module rejects with `UnauthorizedError` when unauthenticated (zero-args invocation).
  - No side-effect seam (`getServerAppwrite`, any shared repository/delivery function, `revalidatePath`) is called during those invocations.
  - Static: every `export async function` body contains a `requireUser()` call; the module imports it from `@/lib/auth/require-user`.
  - Discovery finds ≥ 7 non-allowlisted modules (the current count is 7).
  - Allowlist: login module is skipped, and a comment explains why.
  - Regression probe (verifier-executed, not a permanent case): temporarily comment out a guard → arch test fails on that export; restore.
- Updated action tests (`send-issue-email-action`, `publish-issue-to-rss-action`, `prompts-actions`, `newsletters-actions`): unauthenticated cases now assert rejection with `UnauthorizedError` and that seams were not called; all authenticated-path cases unchanged and green.
- Edge cases covered by design: settings diagnostic actions return `ConnectionDiagnosticResult` (not an ok-envelope) — the throw convention sidesteps per-action shape mapping; internal try/catch blocks (e.g. `testFeed`, `updateRunRetentionSetting`) cannot swallow the guard because the guard sits outside them.

## Tasks

### Task 1: `requireUser()` guard with unit tests

- **Action**: Create `web/lib/auth/require-user.ts` exporting `UnauthorizedError` (Error subclass) and `requireUser(): Promise<Models.User<Models.Preferences>>` that calls `getAuthenticatedUser()` from `@/lib/auth/session` and throws `UnauthorizedError` when it returns null. Create `web/src/__tests__/require-user.test.ts` following the existing `vi.hoisted`/`vi.mock("@/lib/auth/session", ...)` pattern (see `web/src/__tests__/send-issue-email-action.test.ts`).
- **Expected result**: The guard module exists with its unit tests; nothing imports it yet.
- **Verify**: `pnpm vitest run web/src/__tests__/require-user.test.ts` passes (3 cases) and `pnpm typecheck` passes.
- **Depends on**: none.

### Task 2: architectural test — red run proving detection

- **Action**: Create `web/src/__tests__/server-actions-auth.test.ts` implementing the four checks in Spec §3 (discovery + allowlist, runtime rejection, seam-untouched, static convention). Follow existing mock conventions: `vi.mock("next/cache")`, `vi.mock("@/lib/auth/session")`, and an `importOriginal`-based full mock of `@newsletter/shared` (every non-class function export becomes a throwing recording spy).
- **Expected result**: The test runs in the default suite and FAILS, reporting failures for exactly 27 exports: 16 across `admin/runs`, `admin/feeds`, `admin/settings`, `admin/schedules` (ungated) and 11 across `issues`, `admin/newsletters`, `admin/prompts` (legacy envelope pattern — static check fails them; runtime rejects-assertion also fails since they return envelopes).
- **Verify**: `pnpm vitest run web/src/__tests__/server-actions-auth.test.ts` exits non-zero and the non-conforming set it reports lists exactly 27 exports (some exports fail both the runtime and static checks — judge by the listed export set, not the raw assertion count); discovery self-check reports 7 non-allowlisted modules. Record the listed export set in the handoff — this is the anti-cheat proof for N1.
- **Depends on**: Task 1 (the test asserts rejections against `UnauthorizedError` from the guard module).

### Task 3: gate the four ungated action modules

- **Action**: In `web/app/(protected)/admin/{runs,feeds,settings,schedules}/actions.ts`, import `requireUser` from `@/lib/auth/require-user` and make `await requireUser();` the first statement (outside any try/catch) of all 16 exported actions listed in Spec §2. Then update the three suites that exercise these actions with no session mock — `web/src/__tests__/settings-actions.test.ts`, `settings-diagnostics-actions.test.ts`, `schedules-actions.test.ts`: add `vi.mock("@/lib/auth/require-user", ...)` resolving to a user fixture, leaving every existing assertion unchanged (the guard becomes transparent to them).
- **Expected result**: All 16 S1 actions reject when unauthenticated; signatures and authenticated behavior unchanged; the three suites stay green despite the new guard.
- **Verify**: `pnpm vitest run web/src/__tests__/server-actions-auth.test.ts` still fails, but the non-conforming set it reports covers only the 11 legacy-pattern exports in `issues`/`admin/newsletters`/`admin/prompts`; `pnpm vitest run web/src/__tests__/settings-actions.test.ts web/src/__tests__/settings-diagnostics-actions.test.ts web/src/__tests__/schedules-actions.test.ts` passes; `pnpm typecheck` passes.
- **Depends on**: Task 2.

### Task 4: migrate the three legacy-gated modules and their tests

- **Action**: In `web/app/(protected)/issues/actions.ts`, `admin/newsletters/actions.ts`, `admin/prompts/actions.ts`, replace each `const user = await getAuthenticatedUser(); if (!user) return { ok: false, error: GENERIC_ERROR };` block with `await requireUser();` (11 exports). Update the four test files (`send-issue-email-action`, `publish-issue-to-rss-action`, `prompts-actions`, `newsletters-actions` .test.ts): mock `@/lib/auth/require-user` instead of `@/lib/auth/session`, and rewrite the unauthenticated cases to assert rejection with `UnauthorizedError` plus seams-not-called; leave all authenticated-path cases untouched. Do not touch `issue-export-route.test.ts` (route handler, unchanged).
- **Expected result**: Every exported action across all 7 modules follows the single requireUser convention; all existing suites green.
- **Verify**: `pnpm vitest run web/src/__tests__/server-actions-auth.test.ts` passes with 27 exports asserted; `pnpm vitest run web/src/__tests__/` passes; `pnpm typecheck` passes.
- **Depends on**: Task 3.

### Task 5: document the boundary (middleware + AGENTS.md)

- **Action**: Add the UX-only doc comment to `web/middleware.ts` (Spec §4 — behavior unchanged). Add a concise "Server-action auth boundary" section to project `AGENTS.md` stating the requireUser convention, the enforcing test, the login allowlist rule, and that middleware is not an auth boundary.
- **Expected result**: A future agent reading either file knows the convention and where it is enforced.
- **Verify**: Both files contain the statements (`rg -n "not a security boundary|requireUser" web/middleware.ts AGENTS.md`); `pnpm lint` passes.
- **Depends on**: Task 4.

### Task 6: full gates + audit checkbox tick

- **Action**: Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all must pass). Then tick the S1-20260917, N1-20260917, and S2-20260917 checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings.
- **Expected result**: All quality gates green; audit report reflects the three findings as remediated.
- **Verify**: The three commands exit zero; the report shows `[x]` for S1, N1, S2.
- **Depends on**: Task 5.

## Feature verification

- Run: `pnpm test && pnpm typecheck && pnpm lint`
- Expected: All pass. Within the run, `server-actions-auth.test.ts` reports 7 discovered action modules (plus the allowlisted login module) and asserts all 27 exported actions reject unauthenticated invocation with zero seam calls. Supporting probe: `rg -L "requireUser" "web/app/(protected)" -g actions.ts` returns no files (login excluded by design).

## Handoff

Report to the manager: files created/modified; the Task-2 red run's reported non-conforming export set (expected: exactly 27 exports) as proof the arch test catches S1/N1; confirmation that signatures and authenticated-path behavior are unchanged; the verifier's regression probe (guard temporarily removed → test red → restored); any deviations from this spec and why (e.g., mock-mechanics adjustments in the arch test discovered during implementation — the behavioral assertions must not weaken).

## Research note

Codebase facts verified via codegraph exploration and file reads (2026-09-17): the 16/11 export inventory matches audit S1/N1 counts; gated pattern is `getAuthenticatedUser()` + generic error envelope (`issues/actions.ts:27-30`); `RetryResult` is `{ok:true}|{ok:false;error}` so all return shapes tolerate the throw convention; `web/app/login/actions.ts` must stay anonymous-reachable; root `vitest.config.ts` includes `web/**/*.test.ts` with `@` → `web/` alias, jsdom; existing action tests mock `@/lib/auth/session` and assert the envelope — the four files needing unauth-case rewrites were enumerated by grep, plus three suites covering currently-ungated actions with no session mock (`settings-actions`, `settings-diagnostics-actions`, `schedules-actions` .test.ts — surfaced by the spec review pass and verified on disk). No external library APIs were relied upon beyond vitest/Next idioms already in the repo.
