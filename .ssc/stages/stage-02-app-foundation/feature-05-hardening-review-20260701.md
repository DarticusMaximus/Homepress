# Feature 05: Hardening — review-stage-02-app-foundation-2026-07-01

## Intent

Harden stage-02-app-foundation against the 8 accepted findings from `review-stage-02-app-foundation-2026-07-01`: make `pnpm lint` pass, fix the worker bundle, restore the `APP_NAME` single-source-of-truth, close a latent drift-detection gap, clean up health-check orphans, collapse to one toast API, make the login empty-field error path reachable in the UI, and remove a misleading comment/dead filter.

## Dependencies

- Builds on / hardens code from:
  - `feature-01-schema-provisioner` (`shared/src/schema/provisioner.ts` — X1, C1)
  - `feature-02-gui-shell` (`web/components/app-sidebar.tsx` — N1; `web/app/login/page.tsx` — U1)
  - `feature-03-shared-component-baseline` (`web/lib/toast.ts` + consumers — A1)
  - `feature-04-dashboard-db-health-card` (`shared/src/health/check.ts` — C2; `web/components/health-card/health-card.tsx` — M1)
  - stage-01 carry-over: `worker/package.json` build script (X2 — jsdom bundling)

## Constraints

- **Do not alter user-visible behavior** of any hardened feature unless a finding explicitly requires it:
  - X1 (lint): pure dead-store removal — no behavior change.
  - X2 (worker bundle): build-only change — runtime behavior identical (and improved: the bundled path no longer breaks on scraper/jsdom code paths).
  - N1 (APP_NAME): the rendered brand text stays "Newsletter Generator".
  - C1 (drift detection): no change to current provisioning of `health_check` (both sizes are numbers today); only the missing-size branch changes from "silent match" to "drift".
  - C2 (orphans): the visible stepper output is unchanged; only an internal best-effort cleanup delete is added on the read-failure path.
  - A1 (toast): callers move from named imports to `toast.<variant>`; identical toast behavior.
  - U1 (login): empty-field submission now shows the styled Alert instead of a native tooltip; wrong-credential behavior unchanged.
  - M1 (health card): comment correctness / dead-filter removal; rendered output identical.
- **Do not modify** the auth gate proper (`web/middleware.ts`, `web/lib/auth/session.ts`, `web/lib/auth/routes.ts`, `web/lib/auth/login-errors.ts`, `web/app/login/actions.ts` logic). U1 touches only the login form markup (`noValidate`) — the server action and `mapLoginError` stay byte-for-byte identical.
- **Do not modify** the schema declarations shape (`COLLECTIONS`, the `health_check` attributes, `read: []/write: []` perms) or the provisioner's create-if-absent/409-swallow/drift-skip semantics. C1 only tightens the `attributeMatches` missing-size branch; C2 only adds a cleanup delete in `check.ts`.
- **No new collections, no new dependencies, no new routes, no new nav items.** A1 removes surface; it does not add any.
- Preserve the no-secrets rule everywhere (C2's cleanup delete must not log the document body or any secret).
- All stage-02 Acceptance criteria must still hold after hardening (re-verified in Feature verification).

## Spec

Eight findings, grouped by file/concern into coherent tasks:

### X1 — `pnpm lint` fails on three `no-useless-assignment` errors
`shared/src/schema/provisioner.ts:109` (`let collectionExists = false;` — useless init, reassigned in the following try), `:140` (`collectionExists = true;` after the 409-skip — never read again; the attributes section does not consult it), `:156` (`let liveAttributes = []` — useless init, reassigned in the try). Remove the dead stores without changing provisioning behavior.

### C1 — `attributeMatches` silent match on missing string size
`shared/src/schema/provisioner.ts:47-58`: when `declared.type === "string"` and either `declared.size` or `live.size` is non-number, the function falls through to `return true` (treated as match — drift undetected). Tighten so a missing size on a string is treated as drift, not a match.

### X2 — Worker esbuild bundles jsdom (8MB, broken `require.resolve`)
`worker/package.json:8` build script bundles all of `@newsletter/shared` including jsdom. Add `--packages=external` so node resolves deps at runtime; shrink the bundle and unbreak the bundled scraper/jsdom path.

### N1 — Sidebar hardcodes `APP_NAME` instead of importing it
`web/components/app-sidebar.tsx:13` declares a local `const APP_NAME = "Newsletter Generator";`. Replace with an import from `@newsletter/shared` (already a dependency; already exported).

### C2 — Health-check read failure abandons the created document
`shared/src/health/check.ts:106-118` returns on read failure without deleting the document created at `:65-71`. Add a best-effort cleanup delete (swallowed, not rendered as a stepper step) so the round-trip cleans up after itself except when the delete itself fails.

### A1 — `toast.ts` exposes overlapping APIs
`web/lib/toast.ts:5-15` defines redundant named `success`/`error`/`info`/`warning` exports alongside the re-exported `toast`. Remove the named exports; keep only `export { toast }`. Update consumers `web/app/(protected)/design-system/_components/toasts-demo.tsx:4` and `web/src/__tests__/toast-provider.test.tsx:6` to use `toast.<variant>`.

### U1 — Login native `required` preempts the documented Alert
`web/app/login/page.tsx:44,56` inputs carry `required`, so the browser blocks empty submission and the server action's "Email and password are required" Alert path is unreachable. Add `noValidate` to the `<form>` so the styled Alert becomes the actual empty-field UX. Keep `required` (accessibility/autofill) and the server-side guard (defense in depth).

### M1 — Health-card comment misrepresents `runHealthCheck`; dead `wasAttempted` filter
`web/components/health-card/health-card.tsx:15-31`: the comment claims `runHealthCheck` pushes length-stable sentinels; it does not. Either correct the comment and remove the dead `wasAttempted` filter (render `result.steps` directly), or correct the comment to describe the filter as future-defense. Prefer removal (matches the actual contract).

## Tasks

### Task 1: Fix provisioner lint errors + tighten string-size drift detection (X1 + C1)

- **Action:** In `shared/src/schema/provisioner.ts`:
  - X1: Remove the three useless assignments. Line 109: declare `let collectionExists: boolean;` (no `= false`) and rely on the try-block assignment, or restructure so the value is computed once. Line 140: drop the `collectionExists = true;` after the 409-skip (dead). Line 156: declare `let liveAttributes: { key: string; type: string; size?: number }[];` (no `= []`) or fold to a `const` with early-`continue` on the error path.
  - C1: In `attributeMatches`, change the string branch so that when `declared.type === "string"` and either size is not a number, the function returns `false` (drift) instead of falling through to `return true`. Keep the existing exact-match behavior when both are numbers.
  - Verify the drift-warning message in `provisionDatabase` still reads sensibly for a missing-size case (it already interpolates `size ?? "?"`).
- **Expected result:** `pnpm lint` reports zero errors in `shared/src/schema/provisioner.ts`; a missing-size string attribute is now reported as drift.
- **Verify:** `pnpm lint` exits zero (or at least provisioner.ts is clean). `pnpm --filter @newsletter/shared test` passes — add/extend a provisioner test for the missing-size drift case (declared string size 255, live string with `size: undefined` → `result.attributes.drift === 1` and a warning logged). `pnpm typecheck` zero errors.
- **Depends on:** none.

### Task 2: Fix the worker esbuild bundle (X2)

- **Action:** In `worker/package.json`, change the `build` script to add `--packages=external`, e.g. `esbuild src/index.ts --bundle --platform=node --format=cjs --packages=external --target=es2022 --outfile=dist/index.js`. Confirm `worker/dist/` is gitignored (it already has a `dist` entry). Confirm `tsx src/index.ts` still works (it does — unaffected).
- **Expected result:** `pnpm --filter @newsletter/worker build` exits zero with no warnings; `dist/index.js` is small (KB range, not MB); `node dist/index.js` boots, provisions, and heartbeats without crashing.
- **Verify:** Run `pnpm --filter @newsletter/worker build` — zero warnings, `dist/index.js` under 200 KB. Run `node worker/dist/index.js` briefly (with env present) — confirm the boot/provisioning/heartbeat log lines and no crash; kill it. `pnpm typecheck` zero errors. `pnpm --filter @newsletter/worker exec tsx src/index.ts` still boots (regression check).
- **Depends on:** none.

### Task 3: Restore APP_NAME single-source-of-truth (N1)

- **Action:** In `web/components/app-sidebar.tsx`: delete line 13 (`const APP_NAME = "Newsletter Generator";`) and add `APP_NAME` to an import from `@newsletter/shared`. If no existing import from `@newsletter/shared` is present in the file, add `import { APP_NAME } from "@newsletter/shared";`. The header render at line 42 is unchanged.
- **Expected result:** The sidebar brand uses the shared constant; a future change to the shared `APP_NAME` propagates to the sidebar.
- **Verify:** Grep `web/components/app-sidebar.tsx` — contains `import { ... APP_NAME ... } from "@newsletter/shared"` and no local `APP_NAME = "..."` literal. `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Sidebar header still renders "Newsletter Generator".
- **Depends on:** none.

### Task 4: Add health-check read-failure cleanup + remove dead health-card filter (C2 + M1)

- **Action:** In `shared/src/health/check.ts`:
  - C2: After a successful create, ensure a best-effort delete runs on the read-failure return path (and generally whenever `documentId` is set and the round-trip is about to return without having run the "real" delete step). The cleanup delete must: use the captured `documentId`; swallow its own errors silently (log nothing sensitive — at most `console.error({ phase: "cleanup-delete", code, message })`); not push a visible stepper step (the stepper still shows create ok / read failed). Keep the existing delete step (the real, visible one on the happy/read-ok path) unchanged.
  - Concretely: wrap the read-step block so that on read failure, before returning, attempt `databases.deleteDocument(...)` in its own try/catch (swallowed). Do not change the happy path or the delete-failure path.
  - In `web/components/health-card/health-card.tsx` (M1): remove the misleading comment block (lines 15-24) and the `wasAttempted` helper; render `result.steps` directly in the `<ul>` (rename `attemptedSteps` → just iterate `result.steps`). The `firstFailed` lookup and the rest of the card are unchanged.
- **Expected result:** Read-failure orphans are cleaned up best-effort; the health-card comment is accurate and the dead filter is gone.
- **Verify:** `pnpm --filter @newsletter/shared test` — extend `check.test.ts` "read fails" case to assert `docs.deleteDocumentCalls` has length 1 (cleanup ran, using the captured `documentId`). Add a case: read fails AND cleanup delete also fails (`deleteDocumentError` set, `getDocumentError` set) → result still returns the read-failure shape, no throw. Happy-path and delete-failure tests still green. `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero.
- **Depends on:** none.

### Task 5: Collapse toast API to a single export (A1)

- **Action:** In `web/lib/toast.ts`: remove the named `success`/`error`/`info`/`warning` exports; keep only `export { toast };` (and the type re-export if needed). Update `web/app/(protected)/design-system/_components/toasts-demo.tsx` to `import { toast } from "@/lib/toast"` and call `toast.success/toast.error/toast.info/toast.warning`. Update `web/src/__tests__/toast-provider.test.tsx` to `import { toast } from "@/lib/toast"` and call `toast.success("Newsletter saved")`.
- **Expected result:** One toast API; all call sites use `toast.<variant>`.
- **Verify:** Grep — no file imports a bare `success`/`error`/`info`/`warning` from `@/lib/toast`. `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` exit zero (the toast-provider test still passes with `toast.success`).
- **Depends on:** none.

### Task 6: Make the login empty-field Alert reachable (U1)

- **Action:** In `web/app/login/page.tsx`, add `noValidate` to the login form element: `<form action={formAction} noValidate className="flex flex-col gap-4">`. Leave the `required` attributes on the inputs (accessibility/autofill metadata) and leave `web/app/login/actions.ts` and `web/lib/auth/login-errors.ts` untouched.
- **Expected result:** Submitting with empty fields reaches `loginAction`, which returns "Email and password are required" into the styled destructive `Alert`.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` exit zero. PM manual re-check (Feature-02 Stage B item 8): submit empty → styled Alert shows "Email and password are required"; submit wrong credentials → unchanged mapped error; submit valid → logs in and redirects.
- **Depends on:** none.

### Task 7: Full regression

- **Action:** Run the full verification chain. Inspect the diff to ensure no files outside the task scopes were changed and no new nav items/routes/deps/collections were introduced.
- **Expected result:** All 8 findings addressed; all stage-02 ACs still hold.
- **Verify:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build && pnpm --filter @newsletter/worker build` — all exit zero. Confirm `worker/dist/index.js` is small and `node worker/dist/index.js` boots. Re-confirm stage-02 Acceptance criteria (provisioner idempotent, schema is sole source, shell + six routes, health card round-trip, shared components + theme, add-a-collection pattern).
- **Depends on:** Tasks 1–6.

## Feature verification

- Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build && pnpm --filter @newsletter/worker build`
- Expected: every command exits zero. `pnpm lint` is the key gate that was previously failing (X1). `pnpm test` includes the new/extended cases (provisioner missing-size drift; health-check read-failure cleanup + cleanup-failure swallow) and all prior 336 tests. `worker/dist/index.js` is small and boots. The toast test passes with `toast.success`. No behavior regressions: provisioner still idempotent; health card still round-trips; sidebar brand unchanged; login wrong-credential path unchanged; six nav routes unchanged; auth gate untouched.
- Stage-02 Acceptance criteria re-checked: the hardening must not regress any of them. Notably the "pnpm lint exits zero" AC — previously failed — now passes.

## Handoff

- Review report with full evidence for every finding: `.ssc/reviews/review-stage-02-app-foundation-2026-07-01.md`.
- Files expected to change:
  - `shared/src/schema/provisioner.ts` (X1, C1)
  - `shared/src/schema/__tests__/provisioner.test.ts` (new missing-size drift case)
  - `shared/src/health/check.ts` (C2)
  - `shared/src/health/__tests__/check.test.ts` (extended read-failure + cleanup-failure cases)
  - `worker/package.json` (X2 — build script only)
  - `web/components/app-sidebar.tsx` (N1)
  - `web/components/health-card/health-card.tsx` (M1)
  - `web/lib/toast.ts` (A1)
  - `web/app/(protected)/design-system/_components/toasts-demo.tsx` (A1)
  - `web/src/__tests__/toast-provider.test.tsx` (A1)
  - `web/app/login/page.tsx` (U1 — `noValidate` only)
- Confirmation that `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter web build`, `pnpm --filter @newsletter/worker build` all pass.
- Confirmation that no auth code, no schema declarations, no provisioner create-if-absent semantics, and no user-visible behavior were changed except where a finding explicitly required it (U1's empty-field UX).
- The PM manual re-check for U1 (login empty-field Alert) and for X2 (bundled worker boot) is surfaced to the manager before marking verified.
