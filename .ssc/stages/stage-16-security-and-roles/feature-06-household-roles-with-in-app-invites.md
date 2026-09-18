# Feature 06: Household roles with in-app invites

## Intent

Close audit S5 by giving Homepress a real operator-vs-reader trust boundary — readers keep Home, newsletter channels, and listen; every factory surface and the issue export require the operator role — and let the operator create and manage household reader accounts in-app, with no open sign-up path anywhere.

## Spec

Decisions confirmed with the PM (2026-09-17 grill session; see Research note for the Appwrite mechanics that shaped them):

1. **Role source of truth: Appwrite user labels.** An `operator` label on the Appwrite user marks the operator. Role check is `isOperator(user)` = `user.labels?.includes("operator")` (defensive: labels may be undefined). Rationale: `account.get()` — already called by every gate via `getAuthenticatedUser()` — returns `labels`, so role checks cost no extra API call; labels are server-SDK-only (`users.updateLabels`), so a reader can never self-promote. Teams were rejected (extra per-request API call, invite/accept machinery we don't want).
2. **`requireOperator()` guard.** New `web/lib/auth/require-operator.ts`: exports `ForbiddenError` (Error subclass), `isOperator(user)`, and `requireOperator(): Promise<Models.User<Models.Preferences>>` that calls Feature 01's `requireUser()` (no session → `UnauthorizedError`), then throws `ForbiddenError` when the user lacks the label, else returns the user. All existing factory server actions migrate to it (they are all factory actions — readers invoke none of them today).
3. **Arch test extension (Feature 01's `server-actions-auth.test.ts`).** Static check accepts `requireUser()` or `requireOperator()` as a valid first-statement guard (requireOperator contains requireUser transitively). New runtime scenario: with `@/lib/auth/session` mocked to a logged-in user whose `labels` do not include `operator`, every function export of every discovered non-allowlisted module must reject with `ForbiddenError` and call no seams. The unauthenticated scenario and seam-untouched assertions are unchanged; the test's detection capability is preserved, not weakened.
4. **Factory page gate.** New `web/app/(protected)/admin/layout.tsx`: `getAuthenticatedUser()` → if null or not operator → `redirect("/")` (silent redirect Home; unauthenticated is normally caught by the parent protected layout first). Applies to every existing and future `/admin/**` page.
5. **Export route role gate.** `web/app/api/issues/[runId]/export/route.ts`: 401 anonymous (unchanged), **403 for a logged-in reader**, 200 operator.
6. **Reader nav is two-item.** `(protected)/layout.tsx` computes `isOperator(user)` and passes it to `AppSidebar`; readers see only Home + Newsletters (Admin item and the Factory group hidden). Amends the Stage 14 three-item pin — AGENTS.md GUI conventions updated accordingly. Reader issue page already renders `showOps={false}` (`web/app/(protected)/issues/[runId]/page.tsx`); download links render only under ops chrome — no change needed there.
7. **Account management at `/admin/accounts`** (new factory page in `factoryNavItems`, uses the `domain-list/ResponsiveList` table/cards convention): columns name/email, role badge (operator/reader), status (active/blocked), registered date, actions. Operations:
   - **Create reader** — form: name (optional), email, password (operator sets it; ≥8 chars per Appwrite). Creates via `users.create` with no labels. The form can only create readers — no role picker; promoting to operator stays an Appwrite-console action.
   - **Block / unblock** — `users.updateStatus`; Appwrite rejects blocked users mid-session, so the reader is logged out by the existing gate with no extra work.
   - **Reset password** — operator sets a new password (≥8 chars) for a reader.
   - **Delete account** — `users.delete`, behind the existing confirm-dialog convention.
   - **Self-protection** — block/reset/delete refuse any target carrying the `operator` label (enforced in the lib layer, not just hidden buttons); the operator's own row hides manage buttons.
8. **Blocked login message.** `mapLoginError` maps Appwrite `user_blocked` to "This account has been deactivated" so a blocked household member isn't told their password is wrong.
9. **Operator bootstrap script.** `pnpm run bootstrap:operator` (root script → `shared/scripts/bootstrap-operator.mjs`, reading repo `.env` via Node's `--env-file`): requires `HOMEPRESS_OPERATOR_EMAIL`; if a user with that email exists, ensures the `operator` label (preserving other labels — `updateLabels` replaces the whole set); if none exists, creates the user with a generated 16-char password printed once, then labels it. Exit non-zero with instructions on missing config. Run once after deploy — without it, nobody can reach the factory.
10. **Deploy docs.** `DEPLOY.md` gains an operator/household section: bootstrap steps, `HOMEPRESS_OPERATOR_EMAIL`, in-app reader creation, and the fact that Appwrite's per-project users limit does not apply to operator-created accounts (it only blocks client-side sign-up, which Homepress has none of; default is unlimited) — superseding the stage file's "limit must be raised manually" assumption.
11. **Audit bookkeeping.** Tick S5 in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings when the feature verifies.

Considered and declined: creating additional operators in-app (single-operator household; console remains the promotion path); an access-denied page for readers on factory URLs (silent redirect — readers never see factory links); self-service password change for readers (household scale; operator reset covers it).

## Dependencies

- Builds on: feature-01-fail-closed-admin-actions — provides `requireUser()` (`web/lib/auth/require-user.ts`) and the architectural test (`web/src/__tests__/server-actions-auth.test.ts`) that this feature extends. Features 02–05 are independent; no other build-order coupling.

## Constraints

- Feature 01's arch test must keep its detection capability: the unauthenticated scenario, seam-untouched assertions, and discovery self-check (module count ≥7; accounts module makes it 8) stay intact. The static check is extended, not replaced.
- `web/app/login/actions.ts` remains the only allowlisted action module and stays anonymous-reachable; `logoutAction` unchanged.
- Reader surfaces keep working for readers with no new gates beyond session: Home (`/`), channels (`/newsletters`, `/newsletters/[id]`), issue reader (`/issues/[runId]`), listen (client-side TTS). Do not add role checks to these pages.
- `/rss/*`, `/health`, `/build-id` routes unchanged. No worker changes. No new Appwrite collections — accounts live in Appwrite's users service, so the provisioner is untouched.
- Server-action signatures and authenticated (operator-path) return shapes unchanged; client components calling factory actions keep working.
- No open sign-up path: nothing may call client-side `account.create`; account creation exists only behind `requireOperator()`.
- Labels are never mutated by the app except by the bootstrap script (no promote/demote UI).

## Acceptance criteria

- [ ] With a valid reader session (no `operator` label), direct invocation of every exported server action across all action modules rejects with `ForbiddenError` before any side effect — asserted by the extended architectural test running in the default `pnpm test`. (S5)
- [ ] A reader loading any `/admin/**` page is redirected to `/`; a reader hitting `/api/issues/<runId>/export` gets 403; the reader's sidebar shows only Home and Newsletters.
- [ ] An operator can create a reader account in-app (name/email/password, ≥8-char password), and that account can log in and read Home/channels/issues/listen but cannot reach any factory surface.
- [ ] The operator can block (reader's access ends immediately), unblock, reset the password of, and delete reader accounts from `/admin/accounts`; block/reset/delete refuse operator-labeled targets.
- [ ] No anonymous or open sign-up path exists: the only account-creating code paths are the operator-gated actions and the bootstrap script.
- [ ] `pnpm run bootstrap:operator` labels an existing user; creates+labels a missing one; exits non-zero with clear instructions when `HOMEPRESS_OPERATOR_EMAIL` is unset.
- [ ] Blocked-account login shows "This account has been deactivated".
- [ ] DEPLOY.md documents operator bootstrap + household reader setup; `.env.example` gains `HOMEPRESS_OPERATOR_EMAIL`.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.

## Files

- Create: `web/lib/auth/require-operator.ts`
- Create: `web/src/__tests__/require-operator.test.ts`
- Create: `web/src/__tests__/admin-layout-role.test.ts`
- Create: `web/src/__tests__/app-sidebar-role.test.tsx`
- Create: `web/lib/accounts/account-admin.ts`
- Create: `web/src/__tests__/account-admin.test.ts`
- Create: `web/src/__tests__/accounts-actions.test.ts`
- Create: `web/app/(protected)/admin/layout.tsx`
- Create: `web/app/(protected)/admin/accounts/actions.ts`
- Create: `web/app/(protected)/admin/accounts/page.tsx`
- Create: `web/components/accounts/accounts-view.tsx`
- Create: `web/components/accounts/create-account-dialog.tsx`
- Create: `web/components/accounts/reset-password-dialog.tsx`
- Create: `web/components/accounts/delete-account-dialog.tsx`
- Create: `shared/scripts/bootstrap-operator.mjs`
- Modify: `web/src/__tests__/server-actions-auth.test.ts` (static check + reader scenario)
- Modify: `web/app/(protected)/admin/{runs,feeds,settings,schedules,newsletters,prompts}/actions.ts`, `web/app/(protected)/issues/actions.ts` (requireUser → requireOperator, 27 exports)
- Modify: `web/src/__tests__/{send-issue-email-action,publish-issue-to-rss-action,prompts-actions,newsletters-actions,settings-actions,settings-diagnostics-actions,schedules-actions}.test.ts` (guard mock → require-operator)
- Modify: `web/app/(protected)/layout.tsx`, `web/components/app-sidebar.tsx`, `web/lib/nav-items.ts` (role-conditional nav)
- Modify: `web/src/__tests__/admin-factory-nav.test.tsx` (isOperator prop)
- Modify: `web/app/api/issues/[runId]/export/route.ts`, `web/src/__tests__/issue-export-route.test.ts` (403 reader)
- Modify: `web/lib/auth/login-errors.ts`, `web/src/__tests__/login-errors.test.ts` (user_blocked)
- Modify: `package.json` (bootstrap:operator script), `shared/package.json` (if script wiring needs it)
- Modify: `.env.example`, `docs/DEPLOY.md`
- Modify: `AGENTS.md` (GUI conventions: role-conditional reader nav)
- Modify: `.ssc/Plan.md` (amend the Stage 14 reader-nav carry-forward pin)
- Modify: `.ssc/reviews/review-app-public-exposure-2026-09-17.md` (tick S5)

## Testing approach

Test-first. The reader-scenario arch test (Task 2) is written before any production change and must demonstrably fail (Task 2's red run proves it catches S5 — re-insert an unguarded or requireUser-only action to re-probe).

- `require-operator.test.ts`: no session → `UnauthorizedError`; session without label → `ForbiddenError`; with label → resolves the user; `isOperator` treats missing labels as reader.
- `server-actions-auth.test.ts` extension: (a) static check accepts both guards; (b) reader scenario — logged-in no-label user → every factory export rejects `ForbiddenError`, zero seam calls; (c) existing unauth scenario unchanged; (d) discovery self-check now expects ≥8 non-allowlisted modules (accounts module included).
- `admin-layout-role.test.ts`: mocked session → reader/null redirect to `/`; operator renders children.
- `app-sidebar-role.test.tsx`: `isOperator=false` → no Admin link, no Factory group; `isOperator=true` → Admin link present, Factory group on admin paths.
- `issue-export-route.test.ts`: anon 401 (existing), reader 403 (new), operator 200 (existing authenticated case relabeled).
- `account-admin.test.ts` (mocked Users service): create validates email shape + password ≥8 and passes no labels; block/unblock/reset/delete fetch the target and throw `forbidden_target` on an operator-labeled one; list maps `status:false` → blocked; errors map to fixed safe strings.
- `accounts-actions.test.ts`: every action rejects `ForbiddenError` for a no-label user (also covered mechanically by the arch test); happy paths call the lib and revalidate; validation errors return the envelope.
- `login-errors.test.ts`: `user_blocked` → "This account has been deactivated"; credentials/generic cases unchanged.
- Not test-first: the bootstrap script (manual/PM-verified — Task 11 Verify covers it), nav and accounts page visual layout (typecheck + component tests cover structure).

## Tasks

### Task 1: `requireOperator()` guard with unit tests

- **Action**: Create `web/lib/auth/require-operator.ts` exporting `ForbiddenError`, `isOperator(user)`, `requireOperator()` per Spec §2 (wraps `requireUser` from `@/lib/auth/require-user`). Create `web/src/__tests__/require-operator.test.ts` using the existing `vi.hoisted`/`vi.mock("@/lib/auth/require-user", ...)` pattern.
- **Expected result**: Guard module + green unit tests; nothing imports it yet.
- **Verify**: `pnpm vitest run web/src/__tests__/require-operator.test.ts` passes; `pnpm typecheck` passes.
- **Depends on**: none (assumes Feature 01 executed).

### Task 2: arch test extension — red run proving S5 detection

- **Action**: Extend `web/src/__tests__/server-actions-auth.test.ts`: static check accepts `requireUser()` or `requireOperator()` (imported from the respective modules) as valid guards; add the reader runtime scenario (session mock → `{ $id, email, labels: [] }` user; every non-allowlisted export invoked zero-args rejects `ForbiddenError`, no seam called); bump the discovery self-check to ≥8.
- **Expected result**: Test runs in the default suite and FAILS — the reader scenario fails for all 27 exports (they gate only with `requireUser`, so the no-label user passes through to the mocked seams). Static + unauth scenarios stay green.
- **Verify**: `pnpm vitest run web/src/__tests__/server-actions-auth.test.ts` exits non-zero; the reader-scenario failure set lists all 27 exports. Record the set in the handoff — anti-cheat proof for S5.
- **Depends on**: Task 1.

### Task 3: migrate all factory actions to `requireOperator()`

- **Action**: In the 7 action modules (`admin/{runs,feeds,settings,schedules,newsletters,prompts}/actions.ts`, `issues/actions.ts`), replace `await requireUser();` with `await requireOperator();` (imports from `@/lib/auth/require-operator`) in all 27 exports — first statement, outside try/catch. Update the 7 suites that mock the guard (`send-issue-email-action`, `publish-issue-to-rss-action`, `prompts-actions`, `newsletters-actions`, `settings-actions`, `settings-diagnostics-actions`, `schedules-actions` .test.ts): mock `@/lib/auth/require-operator` with a resolving operator-labeled fixture instead of `@/lib/auth/require-user`; leave authenticated-path assertions unchanged.
- **Expected result**: Every factory action rejects readers with `ForbiddenError`; operator behavior unchanged; all suites green.
- **Verify**: `pnpm vitest run web/src/__tests__/server-actions-auth.test.ts` passes (27 exports × both scenarios); `pnpm vitest run web/src/__tests__/` passes; `pnpm typecheck` passes.
- **Depends on**: Task 2.

### Task 4: admin layout gate

- **Action**: Create `web/app/(protected)/admin/layout.tsx` (Spec §4) — `force-dynamic`, `getAuthenticatedUser()`, redirect `/` when not operator. Create `web/src/__tests__/admin-layout-role.test.ts` (mock `@/lib/auth/session` + `next/navigation` redirect).
- **Expected result**: Any `/admin/**` page load by a reader redirects Home; operator sees the page.
- **Verify**: `pnpm vitest run web/src/__tests__/admin-layout-role.test.ts` passes (3 cases); `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 5: role-conditional reader nav

- **Action**: In `web/app/(protected)/layout.tsx`, compute `isOperator(user)` and pass to `AppSidebar`. Update `web/components/app-sidebar.tsx` (prop `isOperator: boolean`; hide the Admin nav item and the Factory group for readers) and `web/lib/nav-items.ts` (export the reader subset or filter at the call site). Update `web/src/__tests__/admin-factory-nav.test.tsx` for the prop; create `web/src/__tests__/app-sidebar-role.test.tsx`.
- **Expected result**: Reader sidebar = Home + Newsletters at all widths; operator sidebar unchanged.
- **Verify**: `pnpm vitest run web/src/__tests__/app-sidebar-role.test.tsx web/src/__tests__/admin-factory-nav.test.tsx` passes; `pnpm typecheck` + `pnpm lint` pass.
- **Depends on**: Task 1.

### Task 6: export route role gate

- **Action**: In `web/app/api/issues/[runId]/export/route.ts`, after the existing 401 check add `if (!isOperator(user)) return plainError(403, "Forbidden");`. Extend `web/src/__tests__/issue-export-route.test.ts`: reader (no label) → 403; relabel the existing authenticated case as operator → 200.
- **Expected result**: 401 anon / 403 reader / 200 operator.
- **Verify**: `pnpm vitest run web/src/__tests__/issue-export-route.test.ts` passes (all three auth cases + existing format/error cases).
- **Depends on**: Task 1.

### Task 7: account-admin lib with tests

- **Action**: Create `web/lib/accounts/account-admin.ts` (Spec §7): `AccountAdminError` (`validation` | `not_found` | `forbidden_target`), `AccountRecord` type, and functions `listAccounts`, `createReaderAccount`, `setAccountBlocked`, `resetAccountPassword`, `deleteAccount` — each taking a `node-appwrite` `Users` instance; block/reset/delete fetch the target first and throw `forbidden_target` on an operator label; `createReaderAccount` validates email shape + ≥8-char password and creates with `ID.unique()` and no labels. Create `web/src/__tests__/account-admin.test.ts` with a stubbed `Users`.
- **Expected result**: All account operations exist behind one tested seam; operator targets are untouchable by construction.
- **Verify**: `pnpm vitest run web/src/__tests__/account-admin.test.ts` passes; `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 8: accounts page — list + create reader

- **Action**: Create `web/app/(protected)/admin/accounts/actions.ts` with exactly one exported action, `createReaderAccountAction` (each action starts with `await requireOperator();`, `{ok}|{ok,error}` envelopes, `revalidatePath("/admin/accounts")`; the block/reset/delete actions arrive in Task 9). Create `web/app/(protected)/admin/accounts/page.tsx` (server; loads accounts via the lib; passes `currentOperatorId`). Create `web/components/accounts/accounts-view.tsx` (client; `domain-list/responsive-list` table/cards: name/email, role badge, status, registered, actions) and `create-account-dialog.tsx` (name/email/password form, ≥8-char client validation, follows `feed-form-dialog.tsx` conventions). Create `web/src/__tests__/accounts-actions.test.ts` (create action: reader rejected `ForbiddenError`; operator happy path; validation error envelope). Add Accounts to `factoryNavItems` in `web/lib/nav-items.ts`.
- **Expected result**: Operator can list accounts and create a reader in-app; the new actions module is auto-discovered by the arch test (module count 8).
- **Verify**: `pnpm vitest run web/src/__tests__/accounts-actions.test.ts web/src/__tests__/server-actions-auth.test.ts` passes (arch test now asserts 28 exports across 8 modules — 27 existing + `createReaderAccountAction` — under both scenarios); `pnpm typecheck` + `pnpm lint` pass.
- **Depends on**: Tasks 3, 7.

### Task 9: accounts management — block/unblock/reset/delete

- **Action**: Add `setAccountBlockedAction`, `resetReaderPasswordAction`, `deleteReaderAccountAction` to the accounts actions module; create `reset-password-dialog.tsx` and `delete-account-dialog.tsx` (confirm-dialog conventions per `delete-feed-dialog.tsx`); in `accounts-view.tsx`, hide manage controls on the operator's own row (`currentOperatorId`) and on any operator-labeled row; block/unblock is an inline toggle with confirmation. Extend `accounts-actions.test.ts` for the three actions (reader rejected; operator happy path; `forbidden_target` mapped to a fixed message).
- **Expected result**: Full household account lifecycle manageable in-app with self-protection.
- **Verify**: `pnpm vitest run web/src/__tests__/accounts-actions.test.ts web/src/__tests__/server-actions-auth.test.ts` passes (arch test closes at 31 exports across 8 modules); `pnpm typecheck` + `pnpm lint` pass.
- **Depends on**: Task 8.

### Task 10: blocked login message

- **Action**: In `web/lib/auth/login-errors.ts`, map `user_blocked` (type or message fragment, per the existing `user_invalid_credentials` pattern) to "This account has been deactivated". Extend `web/src/__tests__/login-errors.test.ts`.
- **Expected result**: Blocked readers see the distinct message; wrong-password behavior unchanged.
- **Verify**: `pnpm vitest run web/src/__tests__/login-errors.test.ts` passes.
- **Depends on**: none (independent of Tasks 1–9).

### Task 11: bootstrap script + deploy docs

- **Action**: Create `shared/scripts/bootstrap-operator.mjs` (Spec §9 — plain Node, `node-appwrite` from shared's deps, env via `--env-file`; label-or-create logic; generated password printed once; `updateLabels` preserves existing labels). Wire root `package.json` script `bootstrap:operator` (`pnpm --filter shared node --env-file=../../.env scripts/bootstrap-operator.mjs` — adjust the env-file path mechanism if Node's relative resolution requires it; missing `.env` must not crash the script, it should print setup instructions). Add `HOMEPRESS_OPERATOR_EMAIL` to `.env.example`. Add the operator/household section to `docs/DEPLOY.md` (Spec §10).
- **Expected result**: One command bootstraps the operator on the PM's deployment and on a fresh self-host.
- **Verify**: `node --check shared/scripts/bootstrap-operator.mjs` passes; `pnpm typecheck` + `pnpm lint` pass; PM smoke-runs `pnpm run bootstrap:operator` against the live deployment and confirms the existing account is labeled (script prints already-operator on a second run).
- **Depends on**: none (independent).

### Task 12: full gates + bookkeeping

- **Action**: Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all must pass). Update `AGENTS.md` → Project GUI conventions: reader nav is role-conditional (reader: Home + Newsletters; operator: three-item + Factory on Admin paths); factory surfaces and issue export are operator-only; note the `requireOperator` convention extends Feature 01's arch test. Amend the Stage 14 carry-forward pin in `.ssc/Plan.md` (2026-08-14 "Reader vs Admin" entry): reader nav is role-conditional as of Stage 16 Feature 06 — the three-item nav applies to operators only; readers get Home + Newsletters. Tick S5 in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings.
- **Expected result**: Gates green; conventions documented in both authority files; audit finding recorded as remediated.
- **Verify**: Three commands exit zero; `rg -n "role-conditional" AGENTS.md .ssc/Plan.md` shows both updated entries; the report shows `[x]` for S5.
- **Depends on**: Tasks 1–11.

## Feature verification

- Run: `pnpm test && pnpm typecheck && pnpm lint`
- Expected: All pass. Within the run, the extended `server-actions-auth.test.ts` asserts 31 exports across 8 non-allowlisted modules under both the unauthenticated (`UnauthorizedError`) and reader (`ForbiddenError`) scenarios with zero seam calls. Supporting probes: `rg -l "requireOperator" "web/app/(protected)" -g actions.ts` lists 8 modules; `rg -L "requireOperator" "web/app/(protected)" -g actions.ts` returns nothing.

## Handoff

Report to the manager: files created/modified; the Task-2 red run's 27-export failure set (proof the reader scenario catches S5); confirmation that operator-path behavior and action signatures are unchanged; the module/export counts the arch test asserts (8/31); PM smoke-run result of `pnpm run bootstrap:operator`; any deviations from this spec and why (e.g., Node `--env-file` path mechanics in Task 11, dialog-component naming) — behavioral assertions must not weaken.

## Research note

Appwrite facts verified 2026-09-17 via appwrite-docs MCP (docs + Appwrite 1.7.x/1.9.x source, delegated explore agent): `account.get()` returns the full User model including `labels` (docs/references/account/get) — labels are the zero-cost role source; labels are replaceable only via server-SDK `users.updateLabels` (docs/products/auth/labels); `users.create({userId, email, password, name})` accepts a plaintext password (≥8 chars, Argon2-hashed server-side) and the user can sign in immediately (docs/references/users/create-user); `users.updateStatus(false)` blocks a user and shared middleware rejects their existing sessions instantly (verified in source; docs don't state it) — so blocking needs no session cleanup; the per-project users limit (console Auth → Security) only blocks client-side sign-up endpoints — server-SDK user creation bypasses it and the default is unlimited (no `_APP_USERS_LIMIT` env var exists) — correcting the stage file's open question. Codebase facts via codegraph: all 27 existing action exports are factory actions; reader issue page hardcodes `showOps={false}` and download links render only under ops chrome (`issue-reader.tsx:83,150`); shared list pattern is `web/components/domain-list/ResponsiveList`; dialog conventions from `feeds/`. PM decisions from the 2026-09-17 grill session are recorded in Spec §1–§10.
