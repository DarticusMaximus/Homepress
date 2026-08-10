# Feature 04: Dashboard DB health card

## Intent

Prove end-to-end that the stage-02 stack composes by adding a dashboard widget that round-trips a document through the provisioned `health_check` collection — and surfaces the result as a three-step stepper so the operator can see, in one glance, that schema provisioning, the Appwrite server client, the worker boot path, and the GUI shell are all working together.

## Spec

A health card rendered inside the empty `<section>` container that feature 02 left on the dashboard home (`web/app/(protected)/page.tsx`). The card runs the round-trip on every dashboard load AND offers a "Re-run" button the operator can click to re-prove the connection. The result is shown as a three-step stepper — **Create**, **Read**, **Delete** — each step rendering a checkmark (green) or a cross (red) plus a one-line label ("Create: ok (12 ms)", "Read: failed (404 not_found)"). On any phase failure, a shadcn destructive `Alert` below the stepper shows the Appwrite error message and `code` (e.g. "404 not_found — the health_check collection may not exist. Start the worker to provision it."). A `Badge` in the card header shows the verdict: "Healthy" (default shadcn `default` variant) or "Unhealthy" (`destructive`). The Re-run button is a plain `<form action={revalidateHealthCheck}>` with no `useActionState` — a button-only form doesn't need state, and `useActionState` would just add wiring without behavior.

The round-trip is a pure function `runHealthCheck(client)` living in `shared/src/health/check.ts`, taking a `node-appwrite` `Client` and returning a typed `HealthCheckResult`. The function runs the three steps in sequence against `DATABASE_ID` and `HEALTH_CHECK_COLLECTION_ID` (a new constant added to the schema module — see Files), captures the document id + each phase's duration + each phase's status (`ok` | `failed`) + any error message, and aggregates into the result. The dashboard page is a server component that calls `runHealthCheck(getServerAppwrite())` on every request, then renders the card with the result. The "Re-run" button is a small client component wrapping a server action whose only job is `revalidatePath("/")` — the page re-renders and the round-trip runs once, fresh, from the page. There is no client-side state, no loading spinner between clicks — `revalidatePath` returns a new RSC payload to the client which re-renders the card with fresh timings.

The card is the first consumer of a new shared constant `HEALTH_CHECK_COLLECTION_ID` (re-exported from the schema module so it lives next to the declaration it references). It also consumes the `cn` helper from `@/lib/utils` and the shadcn primitives established in features 02 and 03 — `Card` (header, title, content, footer), `Badge` (default + destructive), `Alert`/`AlertDescription` (destructive variant), and a shadcn `Button` (variant `outline`, size `sm`) for the Re-run button. No new component library, no new design tokens, no second styling approach. The stepper is built from the existing primitives — three inline rows (icon + label + duration) — not a third-party component.

The function is the only thing tested in this feature. The dashboard wiring is verified by the PM manual gate (build, typecheck, lint, and a browser check). The unit tests cover the full state machine of the round-trip: success on all three steps, partial failure on each step (create fails, read fails, delete fails), the "collection missing" path (a 404 on the first `createDocument` because the worker hasn't provisioned), and timing capture (each step's duration is recorded).

## Dependencies

- Builds on: feature-01 `schema-provisioner` (the `health_check` collection and `DATABASE_ID` constant; this feature assumes a real or mock Appwrite that has been provisioned).
- Builds on: feature-02 `gui-shell` (the empty `<section>` container in the dashboard page, the shadcn theme, the auth gate, the `getServerAppwrite` import path via `@newsletter/shared`).
- Builds on: feature-03 `shared-component-baseline` (the shadcn primitives used to render the card; this feature is the first real consumer of `Card`, `Badge`, `Alert`, `Button` in domain code — it does not introduce new components).
- Orphaned by: none — fourth and last feature in stage 02.

## Constraints

- **No new components, no new tokens, no new styling approaches.** Feature 04 consumes only what features 02 and 03 already shipped. If a primitive is missing (e.g. a stepper, an inline list), it is built from existing `Card`/`Badge`/`Alert`/`Button` plus Tailwind utility classes — not by adding a new shadcn primitive.
- **Round-trip logic is a pure async function in `shared/`.** The function takes a `Client` and returns a typed result. No React, no Next.js, no cookies. The dashboard page is the only place React touches the function. This is what makes the function unit-testable against the existing `MockDatabases` pattern from feature 01.
- **Pre-`runHealthCheck` errors are caught at the page boundary, not the function boundary.** If `getServerAppwrite()` throws (missing env config) or the SDK call fails before any step runs (e.g. a network timeout on the first `createDocument` after the client is constructed but before the response), the dashboard page wraps the call in try/catch and renders a synthetic `HealthCheckResult` with `status: "failed"`, a single failed step labeled "create" with `errorMessage` / `errorCode` from the error, and a top-level `error` field. The user sees the Unhealthy card with the destructive Alert — never a 500 page. The PM manual gate's failure-mode check depends on this. (The `runHealthCheck` function itself only catches per-step errors; the page adds the outer guard.)
- **Server actions only on the Re-run path.** The dashboard's auto-on-load check is an RSC calling the function directly. The Re-run button is a small client component wrapping a server action. No API routes. No client-side state machines. No SWR / React Query.
- **No secrets logged.** The function's result and any console output never include the API key or session secret — same rule as the provisioner (feature 01).
- **No new database calls outside `health_check`.** This feature is the proving artifact for the schema module; it does not introduce new collections, does not touch any other table, and does not change the schema declarations.
- **No `react-hook-form` / `zod`.** Out of scope per feature 03's pin. The Re-run button is a plain `Button` inside a `<form action={...}>`.
- **No changes to `worker/`.** The provisioner runs on worker boot. The health card does not trigger provisioning; if the collection is missing the card shows the failure honestly and the operator runs the worker.
- **V1 does NOT clean up orphaned `health_check` documents.** If a create-then-read-then-delete round-trip fails mid-pipeline (e.g. read fails after create succeeded), the created document is left in the collection. The next round-trip creates a new document. Over time the collection accumulates orphans. This is acceptable for V1 because (a) the `health_check` collection is a proving artifact, not a domain data store, (b) the document is a single 2-field record (status + createdAt) — trivial storage cost, (c) re-runs are operator-initiated and rare, and (d) adding TTL-based cleanup is meaningful new scope that belongs to a later hardening pass, not V1. The unit test for the "delete fails" case acknowledges this explicitly (it does not assert cleanup). A future stage may add a TTL attribute or a periodic purge job.
- **No changes to `shared/src/schema/` declarations or provisioner.** This feature only consumes them.
- **No changes to auth code, the six pinned nav routes, or the login page.** This feature is entirely within `web/app/(protected)/page.tsx`, the new `web/components/health-card/`, and a small new module in `shared/src/health/`.

## Acceptance criteria

- [ ] `shared/src/health/check.ts` exports `runHealthCheck(client: Client): Promise<HealthCheckResult>` and the `HealthCheckResult` / `HealthStepResult` / `HealthStepStatus` types.
- [ ] `runHealthCheck` runs `createDocument` → `getDocument` → `deleteDocument` against `health_check` (using `DATABASE_ID` and a new `HEALTH_CHECK_COLLECTION_ID` constant re-exported from the schema module), in that order, and never proceeds to the next step if the previous one failed.
- [ ] `runHealthCheck` records, for each step: `step` ("create" | "read" | "delete"), `status` ("ok" | "failed"), `durationMs` (number), and on failure `errorMessage` + `errorCode` (from the Appwrite exception, when available).
- [ ] `runHealthCheck` does NOT log the API key or any session secret, and the returned `HealthCheckResult` does NOT contain them either.
- [ ] `shared/src/health/__tests__/check.test.ts` exists and passes — all cases in the Testing approach are green.
- [ ] `web/components/health-card/health-card.tsx` is a server component that renders the card: `Card` with `CardHeader` (title "Database health", a `Badge` showing "Healthy" or "Unhealthy"), `CardContent` (the three-step stepper as three inline rows, and a destructive `Alert` when any step failed), and `CardFooter` (the Re-run button).
- [ ] The stepper renders three rows, in order, with these exact labels: "Create", "Read", "Delete". Each row shows a green `Check` icon (from `lucide-react`) on `ok`, a red `X` icon on `failed`, the step label, and a duration in milliseconds. Read and Delete rows are not rendered when their preceding step failed (they were not attempted).
- [ ] The destructive `Alert` is rendered only when at least one step failed. It contains the title "One or more steps failed", the first failed step's `errorMessage` + `errorCode`, and the operator-actionable hint "If this is a 404, the worker has not provisioned the database yet — start the worker to fix it."
- [ ] `web/components/health-card/re-run-button.tsx` is a small client component that wraps a server action in a `<form action={revalidateHealthCheck}>`; the action does only `revalidatePath("/")` — it does NOT call `runHealthCheck` itself. The page re-renders, the page's `runHealthCheck` call runs once more, and the card updates with fresh timings.
- [ ] The Re-run action's "one round-trip per click" invariant is verified: a single click results in exactly one additional `createDocument` + one `getDocument` + one `deleteDocument` (no doubled calls). This is checked by an integration-style assertion in the dashboard rendering path or by a small dedicated test if one is added; the PM manual gate (Stage B) confirms it by clicking the button and observing the stepper timings refresh once.
- [ ] `web/app/(protected)/page.tsx` calls `await runHealthCheck(getServerAppwrite())` on every render, wraps the result in `<HealthCard result={result} />`, and renders it inside the existing empty `<section aria-label="Dashboard widgets">` container.
- [ ] The card uses only the shared primitives (`Card`, `Badge`, `Alert`, `Button`) and Tailwind utility classes — no inline styles, no new color tokens, no new CSS.
- [ ] `pnpm --filter @newsletter/shared test` exits zero (the new test plus all existing shared tests).
- [ ] `pnpm --filter web build` exits zero.
- [ ] `pnpm typecheck` exits zero across `shared`, `web`, `worker`.
- [ ] `pnpm lint` exits zero.
- [ ] `pnpm test` exits zero (the new shared test plus all existing `web/src/__tests__/*` tests).
- [ ] **PM manual gate (see Feature verification):** the PM starts the app, loads the dashboard, sees the green stepper and "Healthy" badge, clicks Re-run, and sees it succeed again. The PM then simulates a failure (e.g. temporarily breaking the collection or stopping the worker) and confirms the card shows red steps + the destructive Alert + "Unhealthy" badge.

## Files

- Create: `shared/src/health/check.ts` (the `runHealthCheck` function, `HealthCheckResult` types, `HEALTH_CHECK_COLLECTION_ID` re-export)
- Create: `shared/src/health/index.ts` (re-export `./check`)
- Create: `shared/src/health/__tests__/check.test.ts` (unit tests)
- Modify: `shared/src/index.ts` (re-export `./health`)
- Create: `web/components/health-card/health-card.tsx` (the server-component card)
- Create: `web/components/health-card/re-run-button.tsx` (the client-component re-run button)
- Create: `web/components/health-card/actions.ts` (the server action that re-runs the check and revalidates the path)
- Modify: `web/app/(protected)/page.tsx` (call `runHealthCheck`, render `<HealthCard>` inside the existing `<section>` container)
- Modify: `shared/src/schema/declarations.ts` (add and export `HEALTH_CHECK_COLLECTION_ID = "health_check" as const` as a sibling of `DATABASE_ID` and `DATABASE_NAME` — NOT derived from `COLLECTIONS[0].id`; later stages may follow the same pattern for their own collection ids)

## Testing approach

**Test-first for the logic, PM manual gate for the wiring.** The round-trip is the only thing with non-trivial behavior; the page is a thin render. Automated tests cover the full state machine. The page render is verified by build, typecheck, lint, and the PM running it in a browser.

`shared/src/health/__tests__/check.test.ts` — the test extends the existing `MockDatabases` and `appwriteException` helpers from `shared/src/schema/__tests__/mock-client.ts` (adds document CRUD methods to a sibling mock, or factors the document methods into a small `MockDocuments` class — builder's call). Cases:

- **Happy path**: all three SDK calls succeed → result has `status: "ok"`, all three steps `ok`, durations all > 0, `documentId` captured from the create step, no `errorMessage` on any step. Asserts the SDK was called in order (`createDocument` → `getDocument` → `deleteDocument`) with the correct `databaseId`, `collectionId`, and `documentId` (read/delete use the id from create).
- **Create fails (404 not_found)**: `createDocument` rejects with a 404 `AppwriteException` → result `status: "failed"`, create step `failed` with `errorCode: 404` and the message, read and delete steps NOT attempted (mock asserts their methods are never called). No documentId captured.
- **Create fails (generic error)**: same as above but with a 500 → same shape, `errorCode: 500`, mock not called for read/delete.
- **Read fails**: create succeeds, `getDocument` rejects with a 404 → result `status: "failed"`, create `ok`, read `failed` with `errorCode: 404`, delete NOT attempted.
- **Delete fails**: create + read succeed, `deleteDocument` rejects with a 500 → result `status: "failed"`, create + read `ok`, delete `failed` with `errorCode: 500`. The document is left in the collection (the test acknowledges this; cleanup is out of scope for the unit test).
- **Timing capture**: each step's `durationMs` is a number ≥ 0; ordering is preserved (create's duration is recorded before read starts). (A test using a tiny artificial delay via the mock proves ordering; a less strict test only checks `>= 0`.)
- **No secrets in result**: the mock records every console call; the result's JSON-stringified form does not contain the API key (asserted by passing a known key into the mock's env, running the function, and grepping the result + any captured `console.*` output).
- **Returns the captured document id on success**: `result.documentId === mock.lastCreatedDocumentId`.
- **Top-level `error` field on pre-step failure**: when the SDK call itself throws (not the per-step call — e.g. a mocked `getDocument` that throws synchronously on a misconfigured client), `runHealthCheck` propagates the error. The page's try/catch catches it and produces a synthetic result with `error: <message>`. The unit test for `runHealthCheck` does not assert on this — the page boundary is a separate concern. The PM manual gate (Stage B item 4) verifies the user-visible behavior.

Edge cases covered: the first-step failure (which means the rest never run), mid-pipeline failure (partial completion), the 404 specifically (the "worker hasn't provisioned yet" case the operator will see in practice), and the no-secrets rule.

The dashboard page itself is verified by the feature-level checks: `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and the PM manual gate (build, typecheck, lint catch static wiring issues; the PM confirms the visual + interactive result in a browser). The PM's manual gate is the proof that the round-trip works against a real Appwrite project; the unit tests prove the state machine and the no-secrets contract.

## Tasks

### Task 1: Round-trip function + unit tests

- **Action:** Add `HEALTH_CHECK_COLLECTION_ID` to `shared/src/schema/declarations.ts` (`export const HEALTH_CHECK_COLLECTION_ID = "health_check" as const;`) and re-export it from `shared/src/schema/index.ts`. Create `shared/src/health/check.ts` exporting:
  - `HealthStepStatus = "ok" | "failed"`
  - `HealthStepResult = { step: "create" | "read" | "delete"; status: HealthStepStatus; durationMs: number; errorMessage?: string; errorCode?: number; }`
  - `HealthCheckResult = { status: HealthStepStatus; steps: HealthStepResult[]; documentId?: string; checkedAt: string; }`
  - `runHealthCheck(client: Client): Promise<HealthCheckResult>`
  
  Implementation: instantiate `new Databases(client)`. Track `documentId: string | undefined`. Run the three steps in a single function body (not a generic loop — the SDK has separate typed methods for create vs read vs delete and the test mocks assert each individually):
  1. **Create**: `performance.now()` start; `await databases.createDocument({ databaseId: DATABASE_ID, collectionId: HEALTH_CHECK_COLLECTION_ID, documentId: ID.unique(), data: { status: "ok", createdAt: new Date().toISOString() } })`; capture `documentId`; record step `ok`; on error, record `failed` with `errorMessage`/`errorCode` (from `err.code` if present, else undefined) and return immediately.
  2. **Read**: only if create succeeded. `performance.now()` start; `await databases.getDocument({ databaseId: DATABASE_ID, collectionId: HEALTH_CHECK_COLLECTION_ID, documentId });` record step; on error record `failed` and return immediately.
  3. **Delete**: only if read succeeded. `performance.now()` start; `await databases.deleteDocument({ databaseId: DATABASE_ID, collectionId: HEALTH_CHECK_COLLECTION_ID, documentId });` record step; on error record `failed` (do not return — the other two phases already proved connectivity; the failure is shown to the operator but the result is still "failed" overall).
  
  Wrap each step in try/catch that detects `AppwriteException` via `err.code` and `err.message`. Never log `err` raw if it could carry the key — instead log `{ phase, code, message }` (mirroring the provisioner). Build `HEALTH_CHECK_COLLECTION_ID` in via a sibling mock: extend `shared/src/schema/__tests__/mock-client.ts` (or create a new `shared/src/health/__tests__/mock-client.ts`) with a `MockDocuments` class (or extend `MockDatabases` with `createDocument`/`getDocument`/`deleteDocument` methods — builder's call; cleanest is a separate `MockDocuments` injected the same way the existing test injects a `MockDatabases`). The mock records call params in arrays and supports per-method error injection via `createDocumentError`/`getDocumentError`/`deleteDocumentError` fields mirroring the existing pattern. Write `shared/src/health/__tests__/check.test.ts` with the cases in Testing approach. Use `vi.useFakeTimers()` or a small `await new Promise(r => setTimeout(r, 1))` to make timing assertions meaningful.
  
  Create `shared/src/health/index.ts` re-exporting `./check`; modify `shared/src/index.ts` to re-export `./health`.

- **Expected result:** The function exists, the test suite passes, the no-secrets rule is verified, the `HEALTH_CHECK_COLLECTION_ID` constant is the single source of truth for the collection id.

- **Verify:** Run `pnpm --filter @newsletter/shared test -- src/health` — all cases green. Run `pnpm typecheck` — zero errors across `shared`, `web`, `worker`. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors. Confirm `HEALTH_CHECK_COLLECTION_ID` is imported by `check.ts` from `./check` (or wherever the re-export lives) and not hardcoded.

- **Depends on:** none.

### Task 2: Health card component + dashboard wiring + Re-run server action

- **Action:** Create `web/components/health-card/actions.ts` with `"use server"` at the top of the file (Next.js convention, matching `web/app/login/actions.ts:13`). Export a single `revalidateHealthCheck` server action that does ONLY `revalidatePath("/")` — it does NOT call `runHealthCheck`. The page re-renders, the page's own `await runHealthCheck(getServerAppwrite())` call runs once more, and the card updates with fresh timings. (No `redirect` — `revalidatePath` alone is sufficient for an in-app button.) Create `web/components/health-card/re-run-button.tsx` — a `"use client"` component returning a shadcn `Button` (variant `outline`, size `sm`, with a `RotateCw` icon from `lucide-react`) wrapped in `<form action={revalidateHealthCheck}><Button type="submit">Re-run</Button></form>`. No `useActionState` — a button-only form has no input state to manage. Create `web/components/health-card/health-card.tsx` — a server component (no `"use client"`) that takes `result: HealthCheckResult` as a prop and renders:
  - `Card` (from `@/components/ui/card`):
    - `CardHeader` with a flex row: `CardTitle` "Database health" on the left; `Badge` on the right — variant `default` if `result.status === "ok"`, `destructive` if `"failed"`. Label: "Healthy" or "Unhealthy".
    - `CardContent`:
      - Three stepper rows in this order: "Create", "Read", "Delete". Each row is a flex row with: a small icon (`Check` from `lucide-react` for `ok`, `X` from `lucide-react` for `failed`), the step label, the duration in ms, and the error code + message if failed. Use `text-green-600` / `text-red-600` for the icons (the existing Tailwind palette — no new tokens). Apply `cn` for the conditional class. The Read row is only rendered if the Create step succeeded; the Delete row is only rendered if the Read step succeeded. (The function records all three steps; a step that was not attempted has `status: "failed"` with no `errorMessage` from a real call — the page filters these out of the rendered stepper. This is the cleanest place to handle the "not attempted" case.)
      - Below the stepper, if any step in `result.steps` has `status: "failed"` (or if `result.error` is set), render `Alert variant="destructive"` with `AlertTitle` "One or more steps failed" and `AlertDescription` showing the first failed step's `errorMessage` and `errorCode`. The Alert also adds one operator-actionable line: "If this is a 404, the worker has not provisioned the database yet — start the worker to fix it."
    - `CardFooter`: `<ReRunButton />`.
  
  Modify `web/app/(protected)/page.tsx`: import `runHealthCheck` from `@newsletter/shared`, `getServerAppwrite` from `@newsletter/shared`, `HealthCard` from `@/components/health-card/health-card`. Wrap the page's call to `runHealthCheck` in a try/catch (the page-boundary guard from the Constraints). The structure: `let result: HealthCheckResult; try { result = await runHealthCheck(getServerAppwrite()); } catch (err) { result = { status: "failed", steps: [{ step: "create", status: "failed", durationMs: 0, errorMessage: ..., errorCode: ... }], checkedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }; }`. Render the existing `APP_NAME` heading, the intro sentence, and the empty `<section>` container, but the section now contains `<HealthCard result={result} />`. The page remains a server component (no `"use client"`).

- **Expected result:** The dashboard renders a working health card. The card auto-runs on every dashboard load. The Re-run button re-runs the check and revalidates the page.

- **Verify:** Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors across `shared`, `web`, `worker`. Run `pnpm lint` — zero errors. Run `pnpm test` — all tests green (new shared test + existing tests). Confirm `web/app/(protected)/page.tsx` calls `runHealthCheck` inside a try/catch and renders `HealthCard`; `web/components/health-card/` contains the three new files; `actions.ts` has `"use server"` at the top of the file and `revalidateHealthCheck` does NOT call `runHealthCheck` (grep the file: only `revalidatePath`); the card uses only shadcn primitives and Tailwind classes (no new tokens, no inline styles, no second component library); the stepper only renders rows for steps that were actually attempted.

- **Depends on:** Task 1.

### Task 3: PM manual gate + final regression

- **Action:** After Task 2's automated checks pass, the `ssc-execute` manager does NOT mark the feature verified. Instead it surfaces the PM manual gate checklist (Feature verification Stage B) to the PM. The PM starts the app (`pnpm --filter web dev` with the worker also running so the `health_check` collection is provisioned), opens `http://localhost:3000/`, and confirms each of the manual-gate checks. After the PM confirms all checks, the manager records the confirmations and marks the feature `verified`. The final automated regression (`pnpm install && pnpm --filter web build && pnpm typecheck && pnpm lint && pnpm test`) is re-run as part of this task and must still pass.

- **Expected result:** The feature is verified end-to-end — automated checks + PM manual gate both clean.

- **Verify:** The full automated regression command exits zero. The PM's confirmations are recorded in the manager's run log.

- **Depends on:** Task 2.

## Feature verification

This feature uses a **two-stage gate**: automated verification first, then a PM manual gate.

### Stage A — Automated verifier

- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm lint && pnpm test`
- Expected: All commands exit zero. The new `shared/src/health/__tests__/check.test.ts` passes (happy path, create fails 404, create fails 500, read fails, delete fails, timing capture, no-secrets, documentId propagation). All existing shared tests (declarations, provisioner, smoke) and web tests (login-errors, routes) still pass. `pnpm --filter web build` emits the dashboard route with the new HealthCard. `pnpm typecheck` is clean across `shared`, `web`, `worker`. The dashboard page imports `runHealthCheck`, wraps the call in a try/catch (grep confirms), and renders `HealthCard`. The card uses only `@/components/ui/*` primitives. The Re-run action does NOT call `runHealthCheck` (grep confirms — only `revalidatePath`). The card renders the three stepper rows in the specified order with the specified icons, the destructive Alert when any step failed, and the operator-actionable hint.

### Stage B — PM manual gate (manager-driven)

After Stage A passes, the `ssc-execute` manager asks the PM to start the full stack (worker + web) and confirm by hand. The feature is marked `verified` only after the PM confirms all of these:

1. **Initial render is green:** visit `http://localhost:3000/` after logging in. The "Database health" card is visible on the dashboard with the "Healthy" badge in the header. The three stepper rows show green check icons next to "Create", "Read", "Delete", each with a duration in milliseconds. No alert is shown.
2. **Step timing is plausible:** each step's duration is a small positive number (single-digit to low-double-digit ms on localhost).
3. **Re-run button works:** click "Re-run" in the card footer. The page reloads; the stepper still shows all three steps green with fresh durations; no console errors.
4. **Failure case — collection missing:** stop the worker. From the Appwrite console (or by deleting the `health_check` collection manually), remove the collection. Reload the dashboard. The card now shows: "Unhealthy" badge (destructive variant), the Create step in red with "404 not_found" and the message, the Read and Delete steps NOT rendered (they were not attempted), and the destructive Alert with the worker-actionable hint ("If this is a 404, the worker has not provisioned the database yet — start the worker to fix it."). The page does NOT show a Next.js 500 error page.
4a. **Failure case — pre-`runHealthCheck` error:** break the Appwrite config (e.g. temporarily unset `APPWRITE_API_KEY` and restart the web app). Reload the dashboard. The card shows: "Unhealthy" badge, the Create step in red with a config-error message, the destructive Alert, and a top-level "Database is unreachable" hint. The page does NOT show a Next.js 500 error page. Restore the config when done.
5. **Recovery:** restart the worker (which re-runs the provisioner and creates the collection). Click Re-run on the dashboard. The card returns to all-green. No page refresh beyond what the form action triggers.
6. **No console pollution:** open the browser devtools console. No API key, no session secret, no internal stack trace is logged. Appwrite calls appear in the network tab as expected; the page's own console output is clean.
7. **Auth gate unchanged:** log out and attempt to visit `/`. Redirects to `/login` (inherited behavior, not re-implemented).
8. **Six pinned nav routes unchanged:** the sidebar still has Dashboard / Newsletters / Runs / Schedules / Prompts / Delivery in the same order; no nav item was added.

The manager records the PM's confirmations; on all-yes, it marks the feature `verified` and writes `last_verified`. On any "no," it records the failure reason and either retries the relevant task or escalates.

## Handoff

When complete, the builder reports to the manager:
- The list of files created and modified:
  - `shared/src/schema/declarations.ts` (added `HEALTH_CHECK_COLLECTION_ID`)
  - `shared/src/health/check.ts`, `shared/src/health/index.ts`
  - `shared/src/health/__tests__/check.test.ts`
  - `shared/src/index.ts` (re-exports `./health`)
  - `web/components/health-card/{health-card.tsx,re-run-button.tsx,actions.ts}`
  - `web/app/(protected)/page.tsx` (now renders `<HealthCard>`)
- Confirmation that `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.
- The exact `runHealthCheck` signature and `HealthCheckResult` shape so a later stage (e.g. stage 04's run records) can import it for a richer health check that includes last-run status, etc.
- The exact `HEALTH_CHECK_COLLECTION_ID` constant and the new import path (`@newsletter/shared` re-exports it from `./health`) so later stages don't hardcode the string.
- Confirmation that the card uses only the shadcn primitives established in features 02 and 03 — no new components, no new tokens, no second styling approach.
- Confirmation that the dashboard's existing `APP_NAME` heading and intro sentence were preserved; only the empty `<section>` container was filled.
- Confirmation that the page's `runHealthCheck` call is wrapped in a try/catch that produces a synthetic failed result on pre-step errors, so an unreachable Appwrite surfaces as an Unhealthy card rather than a 500 page.
- Confirmation that the Re-run action contains ONLY a `revalidatePath("/")` call — no `runHealthCheck`, no `redirect`. The page re-renders and the round-trip runs once, from the page.
- Confirmation that the `health_check` collection is allowed to accumulate orphan documents on partial-pipeline failures; this is V1-acceptable and documented in Constraints.
- Confirmation that no files outside `web/app/(protected)/page.tsx`, `web/components/health-card/`, and the new `shared/src/health/` module were modified, and that the six pinned nav routes, the auth code, and the provisioner were not touched.
- The PM manual gate checklist (from Feature verification Stage B) surfaced to the manager so it knows to run it before marking verified.
- Any deviation from this spec and the reason (e.g. a node-appwrite v26 method signature that differs from the spec's pseudocode, a `Card`/`Alert` shadcn variant name change, a `revalidatePath` vs `redirect` choice).
