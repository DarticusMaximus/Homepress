# SSC Code Review Report

**Date:** 2026-07-01
**Reviewer:** ssc-code-review
**Scope:** stage-02-app-foundation (stage)
**Profile:** full
**Feature spec anchor:** `.ssc/stages/stage-02-app-foundation/feature-{01,02,03,04}-*.md`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 1 | Medium 4 | Low 3 | Nit 0
- **Overall rationale:** The stage coherently delivers its Intent (schema-as-code provisioner, GUI shell, shared component baseline, and a proving DB health card). No security blockers and no functional breakage of the stage Intent. One High — `pnpm lint` fails on three lines in the stage-02 provisioner, breaking the lint AC that the stage and three of its features require — should be fixed before `ssc-finalize`. The PM has accepted all 8 findings (including 4 items promoted from the original out-of-scope/observations list because they have lingered across stages) into a single hardening feature: `feature-05-hardening-review-20260701`.

---

## Scope and Coverage

- **Target reviewed:** `stage-02-app-foundation` — all four verified features (schema-provisioner, gui-shell, shared-component-baseline, dashboard-db-health-card).
- **Base reference:** n/a (SSC-native scope; not a git repo).
- **Files reviewed (primary, non-test, non-generated):**
  - `shared/src/schema/declarations.ts`, `shared/src/schema/provisioner.ts`, `shared/src/schema/index.ts`
  - `shared/src/health/check.ts`, `shared/src/health/index.ts`
  - `worker/src/index.ts` (boot/provisioning wiring)
  - `web/app/(protected)/page.tsx`, `web/app/(protected)/layout.tsx`, `web/app/layout.tsx`
  - `web/app/login/page.tsx`
  - `web/components/app-sidebar.tsx`, `web/components/theme-toggle.tsx`, `web/components/toast-provider.tsx`, `web/components/LogoutButton.tsx`
  - `web/components/health-card/health-card.tsx`, `web/components/health-card/re-run-button.tsx`, `web/components/health-card/actions.ts`
  - `web/lib/toast.ts`
  - `web/app/(protected)/design-system/page.tsx`
  - Test doubles: `shared/src/schema/__tests__/mock-client.ts`, `shared/src/schema/__tests__/provisioner.test.ts`, `shared/src/schema/__tests__/declarations.test.ts`, `shared/src/health/__tests__/mock-client.ts`, `shared/src/health/__tests__/check.test.ts`
- **Files skipped:** shadcn-generated UI primitives under `web/components/ui/*` (sidebar, sheet, button, card, input, label, alert, textarea, select, dialog, table, badge, sonner, tooltip, separator, skeleton) — these are vendored CLI output, not authored stage-02 logic; reviewed only for consumption correctness. `web/app/globals.css`, `web/components.json`, `web/postcss.config.mjs` — config only. Placeholder pages (`newsletters`, `runs`, `schedules`, `prompts`, `delivery`) — static stubs. Auth code (`middleware.ts`, `lib/auth/*`, `login/actions.ts`) — explicitly out-of-scope per feature specs; confirmed unchanged.
- **Execution mode:** small (estimated ~76k scope tokens, under the 100k threshold). Single reviewer pass + one sequential validator sub-agent (completed; all four findings Confirmed).
- **Assumptions:** `pnpm typecheck` reported clean (verified). `pnpm lint` verified failing (3 errors). `pnpm test`/`build` not re-run by the reviewer; the state file records them green at last verification (336 tests).
- **Unknowns:** live Appwrite round-trip not exercised by this review (covered by feature-04's PM manual gate). Worker esbuild+jsdom bundling caveat noted in feature-04 state notes is out of scope for this code-quality pass (it is a tooling issue flagged for a hardening pass).

---

## SSC Intent Check

- **Stage Intent line:** "Lay the two foundations every later stage builds on but none had explicitly accounted for: an Appwrite database provisioned from schema-as-code in the repo, and a GUI shell with a real layout, navigation, shared component baseline, and visual language ... a dashboard page that round-trips a trivial collection through the provisioned DB confirms the full stack works end-to-end before any domain feature is built on top."
- **Intent served?** Yes — with one localized drift (does not undermine the stage Intent).
- **Notes:** All four features deliver their declared Intent. The single spec-drift finding (N1) is localized to the sidebar header brand label and does not affect the stage's end-to-end proving artifact (the dashboard health card composes provisioner → worker → Appwrite client → GUI correctly). No anti-cheat patterns that fabricate behavior were found: the provisioner and health-check mock clients are legitimate test doubles that record real call sequences, error injection is per-method and mirrors the SDK shape, the no-secrets tests use a planted sentinel and assert it never appears in output, and assertions are specific (call ordering, counts, ids, collectionId constants — not just "no error thrown").

---

## Detailed Findings

### [ ] X1-20260701: `pnpm lint` fails — three `no-useless-assignment` errors in the stage-02 provisioner

| Field | Value |
|---|---|
| **ID** | `X1-20260701` |
| **Severity** | High |
| **Category** | Config / Infra / CI |
| **Location** | `shared/src/schema/provisioner.ts:109,140,156` |
| **Description** | `pnpm lint` exits non-zero with exactly three `no-useless-assignment` errors. Line 109 `let collectionExists = false;` is immediately reassigned in the following `try` block before any read; line 140 `collectionExists = true;` (inside the 409-conflict catch) is never read afterward — the attributes section below does not consult `collectionExists`; line 156 `let liveAttributes: ... = []` is immediately reassigned in its `try` block. These three lines are in `shared/src/schema/provisioner.ts`, which is feature-01-schema-provisioner code — i.e. **stage-02 scope**, not pre-existing scaffolding from an earlier stage. The state-file notes that label these "pre-existing ... out of scope" are inaccurate: the file was created in stage-02 feature-01 (Task 3). |
| **Risk / Impact** | The stage acceptance criterion "pnpm lint exits zero" is not met. Three of four features in this stage (02, 03, 04) carry an explicit `pnpm lint exits zero` AC, and each feature's verify steps re-assert it. Feature-03 and feature-04 were verified only "with caveat" because of these errors. `ssc-finalize` checks stage ACs end-to-end and will see lint failing. This also sets a bad precedent: later stages inherit the provisioner and will see the same failures. |
| **Evidence** | `pnpm lint` output: `shared/src/schema/provisioner.ts` / `109:9 error This assigned value is not used in subsequent statements no-useless-assignment` (and identically at 140:11 and 156:9); `✖ 3 problems (3 errors, 0 warnings)`; exit code 1. |
| **Recommendation** | Line 109: initialize without the useless `= false` (declare `let collectionExists: boolean;` then assign in the `try`, or restructure to a single `const collectionExists = await ...list...then(...)`). Line 140: remove the `collectionExists = true;` after the 409-skip — it is dead (the value is not read past the preceding `if (collectionExists)` check). Line 156: declare `let liveAttributes: {...}[];` without `= []`, or better, fold the list call into a `const liveAttributes = await ...` with the error path handled by early `continue`. Re-run `pnpm lint` to confirm zero errors. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | No new tests needed. CI gate: assert `pnpm lint` exits zero in the hardening feature's verification. |
| **Acceptance Criteria** | `pnpm lint` exits zero with no errors across `shared`, `web`, `worker`. The three formerly-flagged lines pass `no-useless-assignment`. `pnpm typecheck` and `pnpm test` remain green (no behavioral regression — these are pure dead-store removals). |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator re-ran `pnpm lint` and observed exactly the three errors at the cited lines; confirmed the file is feature-01 stage-02 code and that features 02/03/04 carry the `pnpm lint exits zero` AC, so the stage cannot verify clean while this fails. |

---

### [ ] N1-20260701: Spec drift — sidebar hardcodes `APP_NAME` instead of importing from `@newsletter/shared`

| Field | Value |
|---|---|
| **ID** | `N1-20260701` |
| **Severity** | Medium |
| **Category** | Anti-cheat (Spec drift) |
| **Location** | `web/components/app-sidebar.tsx:13` (usage at `:42`) |
| **Description** | Feature-02's spec explicitly requires the sidebar header brand to use the shared constant: "SidebarHeader — `APP_NAME` (import from `@newsletter/shared`) as the brand" (feature-02 spec, Task 2 Action). The implementation instead declares a local module-level literal: `const APP_NAME = "Newsletter Generator";` (line 13) and renders that in the header (line 42). The file has no import from `@newsletter/shared`. `APP_NAME` is already exported from the shared package (`shared/src/index.ts`) and is consumed correctly by `worker/src/index.ts` and `web/app/(protected)/page.tsx` — so the single-source-of-truth contract exists and was bypassed only here. |
| **Risk / Impact** | No functional bug today (the literal matches the shared value). But the spec's single-source-of-truth intent for the app name is violated: if the shared `APP_NAME` is ever changed, the sidebar brand will silently diverge while the dashboard heading and worker logs follow the constant. This is exactly the class of drift the anti-cheat category hunts — a localized shortcut that happens to match the expected value. |
| **Evidence** | `web/components/app-sidebar.tsx:13` — `const APP_NAME = "Newsletter Generator";`; no `import { APP_NAME }` from `@newsletter/shared` in the file. Compare `web/app/(protected)/page.tsx:2` — `import { APP_NAME, ... } from "@newsletter/shared";`. |
| **Recommendation** | Delete line 13 and add `APP_NAME` to the imports from `@newsletter/shared` (the shared package is already a dependency of `web`). The value renders identically; the contract is restored. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | No unit test required (visual feature). Grep assertion: `web/components/app-sidebar.tsx` contains `import { ... APP_NAME ... } from "@newsletter/shared"` and no local `APP_NAME = "..."` declaration. |
| **Acceptance Criteria** | `web/components/app-sidebar.tsx` imports `APP_NAME` from `@newsletter/shared` and contains no local string-literal `APP_NAME` declaration. `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` all exit zero. The sidebar header still renders "Newsletter Generator" (PM manual confirm or build-only). |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed the local literal at line 13, the absence of the shared import, that the feature-02 spec requires the import in two places, and that `APP_NAME` is genuinely exported from `shared/src/index.ts` and consumed elsewhere. |

---

### [ ] C1-20260701: `attributeMatches` silently skips size drift when either size is undefined

| Field | Value |
|---|---|
| **ID** | `C1-20260701` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/schema/provisioner.ts:47-58` |
| **Description** | For string attributes, drift is detected only when **both** `declared.size` and `live.size` are numbers. If either is `undefined`/non-number, the `if (typeof ... === "number" && typeof ... === "number")` guard fails and control falls through to `return true` — the attribute is treated as matching and drift is not recorded. The feature-01 spec requires size comparison for strings (Spec: "compares the declared type/size against the live one"; AC: "drift detection compares both type and size"). `SchemaAttribute.size` is declared optional (`size?: number` in `declarations.ts:12`), so a later stage adding a string attribute without `size` would silently bypass drift detection. |
| **Risk / Impact** | Latent today: the only collection (`health_check`) declares `status` with `size: 255`, and Appwrite returns sizes for string attributes, so both sides are numbers in practice and drift is correctly caught. The provisioner is a **binding contract for stages 03, 04, 07, 08, 09** (per feature-01 Constraints), each of which will add collections with optional `size`. A future string attribute declared without `size`, compared against a live attribute whose size also happens to be missing/undefined, would be treated as matching even if the types differ in width — defeating a core provisioner guarantee. |
| **Evidence** | `provisioner.ts:52-57` — `if (declared.type === "string") { if (typeof declared.size === "number" && typeof live.size === "number") { return declared.size === live.size; } } return true;` |
| **Recommendation** | Treat missing size on a string as drift, not as a match. Either (a) require `size` for string attributes at declaration time (throw or log a clear error if a string is declared without `size`), or (b) when exactly one of `declared.size` / `live.size` is undefined for a string, record drift with a message naming the missing size, rather than returning `true`. Option (a) is cleaner: make `size` required for string attributes in the type system (`Extract<SchemaAttribute, { type: "string" }> & { size: number }`). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Extend `shared/src/schema/__tests__/provisioner.test.ts`: a case where `declared` is a string with `size` and `live` is a string with `size: undefined` (or vice versa) → assert `result.attributes.drift === 1` and a warning is logged; currently this would pass as match. |
| **Acceptance Criteria** | A string attribute whose declared or live size is missing/undefined is reported as drift (not silently matched), with a warning naming the collection, attribute, and the missing-size reason. New unit test covers the missing-size case. `pnpm --filter @newsletter/shared test` and `pnpm typecheck` exit zero. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator re-read `attributeMatches`, confirmed the fall-through-to-true path when either size is non-number, confirmed `SchemaAttribute.size` is optional, and confirmed the feature-01 spec requires size drift detection. Latent today but real against the type contract. |

---

### [ ] M1-20260701: Health-card comment misrepresents `runHealthCheck`; `wasAttempted` filter is dead code

| Field | Value |
|---|---|
| **ID** | `M1-20260701` |
| **Severity** | Low |
| **Category** | Maintainability (anti-cheat-adjacent: misleading representation) |
| **Location** | `web/components/health-card/health-card.tsx:15-31` (comment 15-24; `wasAttempted` 22-24; filter 31) |
| **Description** | The comment block (lines 15-24) states that `runHealthCheck` uses a sentinel — a step with `status: "failed"` and no `errorMessage` — to "keep the array length stable", and that the card filters those stubs out via `wasAttempted`. This misrepresents the function. `shared/src/health/check.ts` only ever pushes steps that were **actually attempted**: on create failure it returns a 1-element array; on read failure a 2-element array; on delete failure a 3-element array with the failed delete carrying an `errorMessage`. It never pushes unattempted sentinel steps. Consequently `wasAttempted(step)` (`step.status === "ok" || step.errorMessage !== undefined`) always returns `true` for every element actually present in `result.steps`, and `.filter(wasAttempted)` at line 31 is dead defensive code. The page's synthetic failure result (`web/app/(protected)/page.tsx:19-27`) produces a single `create` step **with** an `errorMessage`, which `wasAttempted` also passes — so the filter is a no-op there too. |
| **Risk / Impact** | No functional bug. The risk is that a misleading comment masks a future defect: if someone later changes `runHealthCheck` to push real sentinel stubs, the `wasAttempted` heuristic (status ok OR errorMessage present) would correctly handle them — but the current comment claims that is already the case, so a reviewer reading the card would trust a contract that does not exist. Dead defensive code also adds cognitive load. |
| **Evidence** | `health-card.tsx:18-20` — "A step that was NOT attempted ... has `status: "failed"` but no `errorMessage` — `runHealthCheck` uses that as a sentinel to keep the array length stable". Compare `check.ts`: every pushed step corresponds to an attempted SDK call; failed steps always carry `errorMessage`/`errorCode` from `describeError`. |
| **Recommendation** | Either (a) remove the comment and the `wasAttempted` filter (render `result.steps` directly — it already contains only attempted steps), or (b) if the intent is to defend against a future sentinel, correct the comment to say "if a future change pushes unattempted stubs, this filter drops them" and keep `wasAttempted`. Option (a) is simpler and matches the actual contract. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | No new test needed. Existing `check.test.ts` already asserts step-array lengths (1/2/3) per failure path, which proves no sentinels are pushed. |
| **Acceptance Criteria** | The comment in `health-card.tsx` accurately describes what `runHealthCheck` produces, OR the comment + `wasAttempted` filter are removed and `result.steps` is rendered directly. `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` exit zero. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Validator confirmed `check.ts` never pushes sentinel/unattempted steps (returns 1/2/3-element arrays on create/read/delete failure, each failed step carrying errorMessage), that the health-card comment claims a length-stable sentinel exists, and that `wasAttempted` is therefore a no-op filter for all current producers including the page's synthetic failure. |

---

### [ ] X2-20260701: Worker esbuild bundles jsdom — 8MB output, broken `require.resolve` at runtime

| Field | Value |
|---|---|
| **ID** | `X2-20260701` |
| **Severity** | Medium |
| **Category** | Config / Infra / CI |
| **Location** | `worker/package.json:8` (build script); bundle output `worker/dist/index.js` |
| **Description** | The worker build (`esbuild src/index.ts --bundle --platform=node --format=cjs`) bundles the entire `@newsletter/shared` dependency tree, including `jsdom` (imported by `shared/src/pipeline/scraper.ts:21`). jsdom is a real runtime dep of the scraper, but bundling it into the worker produces an 8 MB `dist/index.js` and emits a warning that `./xhr-sync-worker.js` "should be marked as external for use with `require.resolve`". At runtime, jsdom's `require.resolve("./xhr-sync-worker.js")` does not resolve inside the bundled CJS, so any code path through the scraper (e.g. `parity-run`, the pipeline) is broken when run from `dist/`. Feature-04's state notes flagged this explicitly: "pre-existing esbuild+jsdom bundling issue — workaround: `pnpm --filter @newsletter/worker exec tsx src/index.ts`; should be fixed in a hardening pass before stage-02 finalize." |
| **Risk / Impact** | The documented `pnpm --filter @newsletter/worker start` path (`node dist/index.js`) is fragile — boot/provisioning/heartbeat work (no jsdom), but the bundled scraper path is broken, and the 8 MB bundle is wasteful. This has lingered since stage 01 and was promised a fix before stage-02 finalize. |
| **Evidence** | `pnpm --filter @newsletter/worker build` → `▲ [WARNING] "./xhr-sync-worker.js" should be marked as external for use with "require.resolve"` at `jsdom@25.0.1/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:31`; output `dist/index.js 8.0mb ⚠️`. |
| **Recommendation** | Add `--packages=external` to the esbuild build script (externalizes all `node_modules`, which node resolves at runtime where `require.resolve` works). For a `--platform=node` worker this is the standard correct setting and shrinks the bundle to a few KB of application code. Verify `pnpm --filter @newsletter/worker build && pnpm --filter @newsletter/worker start` boots cleanly and the bundle is small. (If a fully-self-contained bundle is ever required for a container image, address that separately via `--external:jsdom` plus a node_modules install step.) |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Add a boot-smoke assertion: after `pnpm --filter @newsletter/worker build`, `node dist/index.js` starts and logs the heartbeat/provisioning line without crashing (can be a manual or scripted check in the hardening feature's verification). Assert `dist/index.js` is under, e.g., 200 KB. |
| **Acceptance Criteria** | `pnpm --filter @newsletter/worker build` exits zero with no warnings. `dist/index.js` is well under 1 MB. `node dist/index.js` boots, runs provisioning, and logs the heartbeat line without error. `tsx src/index.ts` still works unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Reviewer ran the build and observed the 8 MB output and the xhr-sync-worker warning at the cited jsdom path; feature-04 state notes document the runtime breakage and the tsx workaround. |

---

### [ ] C2-20260701: Health-check round-trip abandons created documents on read failure

| Field | Value |
|---|---|
| **ID** | `C2-20260701` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/health/check.ts:106-118` (read-failure path returns without cleanup), `:135-146` (delete-failure path) |
| **Description** | When `createDocument` succeeds but `getDocument` (read) subsequently fails, `runHealthCheck` returns immediately without attempting to delete the document it just created (`check.ts:117` returns after pushing the read failure, while `documentId` is set). The created document is orphaned in the `health_check` collection. (On delete failure the doc is also orphaned, but that is unavoidable — the delete itself failed.) Feature-04's Constraints explicitly accepted orphans for V1 and deferred cleanup to "a future stage"; the PM has now accepted this finding to address it. |
| **Risk / Impact** | Each failed dashboard round-trip (e.g. transient read 404/500, or an operator repeatedly clicking Re-run while the read path is flaky) leaves a permanent orphan row. Individually trivial (2 fields), but accumulates without bound and clutters the proving collection. The class of orphan that is cheaply preventable is the read-failure one (the doc is known and deletable). |
| **Evidence** | `check.ts:106-118`: on read error, `return { status: overallStatus, steps, documentId, checkedAt };` — no delete attempted despite `documentId` being set from the successful create at `:71`. |
| **Recommendation** | After a successful create, guarantee a best-effort delete in a `finally` (or an explicit cleanup attempt on the read-failure return path). The cleanup delete should be swallowed silently (not recorded as a visible stepper step — the stepper shows the real read/delete outcomes the operator cares about), but it must run so the round-trip cleans up after itself except when the delete itself fails. Keep the delete-failure case documented as the remaining (rare, unavoidable) orphan source. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Extend `shared/src/health/__tests__/check.test.ts`: in the "read fails" case, assert `docs.deleteDocumentCalls` has length 1 (best-effort cleanup ran) and that the cleanup delete used the captured `documentId`. Add a case where the cleanup delete itself fails (deleteDocumentError set, read also fails) → assert the function still returns the read-failure result and does not throw. |
| **Acceptance Criteria** | On the read-failure path, `runHealthCheck` attempts to delete the created document before returning (mock records one `deleteDocument` call using the captured `documentId`). The visible stepper still shows only the real attempted steps (create ok, read failed). A failed cleanup delete is swallowed and does not change the returned status. Existing happy-path and delete-failure tests still pass. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Reviewer read `check.ts`; the read-failure return at line 117 occurs after `documentId` is set (line 71) and before any delete attempt. Feature-04 Constraints document the V1 acceptance and the deferral. |

---

### [ ] A1-20260701: `toast.ts` exposes two overlapping toast APIs

| Field | Value |
|---|---|
| **ID** | `A1-20260701` |
| **Severity** | Low |
| **Category** | API & Contracts (Maintainability) |
| **Location** | `web/lib/toast.ts:5-15` (named exports); consumers `web/app/(protected)/design-system/_components/toasts-demo.tsx:4`, `web/src/__tests__/toast-provider.test.tsx:6` |
| **Description** | `web/lib/toast.ts` both re-exports `toast` from sonner (which already carries `.success/.error/.info/.warning` methods) **and** defines duplicate named helpers `success`/`error`/`info`/`warning` that just forward to those same methods. Feature-03's spec pinned the toast API as `toast.success`/`toast.error`/etc. (imported from `web/lib/toast`). The extra named exports are unrequested surface that gives later stages two inconsistent ways to fire a toast. |
| **Risk / Impact** | API inconsistency: later stages could import either `toast.success(...)` (the pinned contract) or `success(...)` (the redundant helper), splitting usage across the codebase and making the wrapper module's intent unclear. |
| **Evidence** | `web/lib/toast.ts:5-15`; grep shows both consumers currently use the named imports: `import { success, error, info, warning } from "@/lib/toast"` (toasts-demo) and `import { success } from "@/lib/toast"` (toast-provider.test). |
| **Recommendation** | Remove the named exports (`success`/`error`/`info`/`warning`) from `web/lib/toast.ts`, keeping only `export { toast }`. Update the two consumers to use `toast.success`/`toast.error`/`toast.info`/`toast.warning` (and `toast.success` in the test). This collapses to the single pinned API. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | The existing `toast-provider.test.tsx` continues to pass after switching to `toast.success`. Add a lint/grep check that no file imports a bare `success`/`error`/`info`/`warning` from `@/lib/toast`. |
| **Acceptance Criteria** | `web/lib/toast.ts` exports only `toast`. Both consumers use `toast.<variant>`. `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` exit zero. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Reviewer read `toast.ts` and grepped consumers; both the duplication and the two named-import call sites are present. Feature-03 spec pins `toast.success`-style usage. |

---

### [ ] U1-20260701: Login form native `required` preempts the documented "Email and password are required" Alert

| Field | Value |
|---|---|
| **ID** | `U1-20260701` |
| **Severity** | Low |
| **Category** | UX / i18n / Accessibility (API contract) |
| **Location** | `web/app/login/page.tsx:44,56` (`required` on the two inputs); `web/app/login/actions.ts:28-30` (the empty-field guard returning "Email and password are required") |
| **Description** | The login inputs carry the native `required` attribute (and email uses `type="email"`), so the browser blocks empty/invalid submission before the form ever reaches `loginAction`. As a result, the server action's empty-field guard (`if (!email || !password) return { error: "Email and password are required" }`) and its styled destructive `Alert` rendering are unreachable through the normal UI. Feature-02's PM manual gate item 8 explicitly requires: "Submitting with empty fields shows the 'Email and password are required' error in the Alert." The delivered behavior instead shows the browser's native validation tooltip, not the Alert — a contract mismatch that has lingered since stage 00. The server-side guard is correct and should stay (defense in depth). |
| **Risk / Impact** | The documented, styled error path is dead in the UI. The error-display UX is inconsistent (native tooltip for empty fields vs. styled Alert for wrong credentials). Not a security issue — the server validates regardless. |
| **Evidence** | `web/app/login/page.tsx:44` `<Input ... required disabled={isPending} />` and `:56` same on password; `web/app/login/actions.ts:28-30` the unreachable-on-the-UI-path guard. Feature-02 Feature verification Stage B item 8. |
| **Recommendation** | Add `noValidate` to the login `<form>` (`<form action={formAction} noValidate className=...>`). This disables the browser's native validation UI so submission reaches the server action, which returns "Email and password are required" into the styled `Alert` — matching the documented AC and giving consistent error display. Keep the server-side guard (it remains the source of truth and protects against non-browser clients). Leave `required` on the inputs for accessibility/autofill metadata; `noValidate` suppresses only the native blocking behavior. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Add a small jsdom test (or extend the existing web test setup): render the login page, submit the form with empty fields, and assert the destructive `Alert` with "Email and password are required" appears (the server action runs in the test via the action wiring). If a full server-action test is heavy, a PM manual-gate re-check (Feature-02 Stage B item 8) suffices. |
| **Acceptance Criteria** | Submitting the login form with empty fields renders the "Email and password are required" message in the styled destructive `Alert` (not a native browser tooltip). Wrong-credential behavior is unchanged. `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` exit zero. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Reviewer read the login page (`required` on both inputs) and the action's empty-field guard; with native validation blocking submission, the guard's mapped message cannot reach the Alert through the UI. Feature-02 manual gate item 8 documents the expected Alert behavior. |

---

## Dependencies and Licensing

- Vulnerabilities: not separately scanned (no `pnpm audit` run in this pass; out of scope for a code-quality review unless security-sensitive findings surface). No vulnerable packages observed in the stage's new direct deps.
- Outdated critical packages: none flagged. shadcn/Radix/sonner/next-themes/lucide-react/Tailwind v4 are current as installed.
- License concerns: none. All stage-02 dependencies are permissive-licensed (MIT/Apache-2.0/ISC).

---

## Quality Signals

- **Lint/config signals:** `pnpm lint` FAILS (3 errors, all in `shared/src/schema/provisioner.ts` — see X1). `pnpm typecheck` is clean across `shared`, `web`, `worker`. One intentional inline `eslint-disable-next-line react-hooks/set-state-in-effect` in `web/components/theme-toggle.tsx:16` — legitimate (the documented next-themes mounted-guard pattern); correctly justified in a comment.
- **Test/coverage signals:** Strong for the logic-bearing modules. `provisioner.test.ts` (9 cases) and `check.test.ts` (10 cases) cover the full state machine, error injection, ordering, permissions, no-secrets (sentinel-based), and the `HEALTH_CHECK_COLLECTION_ID` constant usage. `declarations.test.ts` includes a compile-time assignability check. Mock doubles (`MockDatabases`, `MockDocuments`) record real call params and mirror node-appwrite v26 object-parameter shapes — no over-mocking; assertions are specific. Feature-02 (GUI shell) and feature-03 (component baseline) are intentionally not test-first (visual features); their verification is build/typecheck/lint + PM manual gate, per spec. Test count at last verification: 336.
- **Complexity/churn signals:** Low. `provisioner.ts` (245 lines) is the largest new logic file and is well-structured (database → collections → attributes sections). `health/check.ts` (150 lines) is a clean three-phase state machine. No N+1 or hot-path concerns. The worker retains pre-existing compile-time smoke references (stage-00/01) — not stage-02 code, noted but out of scope.

---

## Risk Assessment

- **Overall risk:** Low-to-Medium. No security findings. No data-loss or auth-bypass paths. The highest-impact issue (X1) is a CI-gate failure, not a runtime defect.
- **Merge decision:** Approve with changes. Address X1 before `ssc-finalize` (it blocks the stage lint AC). N1 and C1 are recommended for the same hardening pass; M1 is cosmetic.
- **Out-of-scope areas (not findings):**
  - **`runHealthCheck` runs on every dashboard render / revalidation**: by design (feature-04 Spec). PM decision: **Dismiss** — this self-resolves as the app builds out; the health card will not remain on the dashboard permanently. No action.
  - **Delete-failure orphans** (the residual class after C2's read-failure cleanup): the delete itself failed, so cleanup is impossible on that path. Remains accepted as documented (rare, trivial storage).

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| X1-20260701 | High | Address now | Lint gate failing — blocks stage lint AC; fix before finalize. |
| X2-20260701 | Medium | Address now | Worker bundling broken since stage 01; feature-04 promised a fix before finalize. |
| N1-20260701 | Medium | Address now | Spec drift on APP_NAME single-source-of-truth. |
| C1-20260701 | Medium | Address now | Latent drift-detection gap in the binding provisioner contract. |
| C2-20260701 | Medium | Address now | Orphan cleanup — has lingered; cheap preventable class. |
| A1-20260701 | Low | Address now | Collapse to single pinned toast API before later stages split usage. |
| U1-20260701 | Low | Address now | Documented Alert error path is dead in the UI; lingering since stage 00. |
| M1-20260701 | Low | Address now | Misleading comment + dead filter; bundle with the rest. |
| _(runHealthCheck on every render)_ | — | Dismiss | Self-resolves as the app builds out; health card is temporary. |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
