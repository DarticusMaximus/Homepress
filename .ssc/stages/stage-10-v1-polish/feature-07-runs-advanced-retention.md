# Feature 07: Runs Advanced retention

## Intent

Tuck run-retention controls (days + Clean up now) into a collapsed-by-default **Advanced** pocket at the bottom of the Runs page — so daily run scanning stays uncluttered while purge settings remain reachable without inventing a Settings page.

## Spec

UI placement polish only. Retention semantics, settings persistence, worker purge, protected-completed-runs floor, and server actions stay exactly as Stage 04 Feature 06. This feature moves the existing controls into a collapsible Advanced section and repositions them below the primary Runs list chrome.

### Current state (research)

- `RetentionControls` (`web/components/runs/retention-controls.tsx`) renders an always-visible card: days input (1–365), **Save**, **Clean up now**, helper copy about auto-removal + latest three completed runs kept.
- Wired at the **top** of `web/app/(protected)/runs/page.tsx` (above `RunsView`), with `retentionDays` from `getOrCreateAppSettings`.
- Actions unchanged: `updateRunRetentionSetting`, `purgeRunsNow` in `web/app/(protected)/runs/actions.ts`.
- Existing tests: `web/src/__tests__/retention-controls.test.tsx` (validation, save, clean-up toasts).

### Placement (pinned)

On `/runs`, page order becomes:

1. Load / secondary-degraded alerts (unchanged)
2. `RunsView` (heading, filters, list / empty)
3. `RunsPagination` (unchanged)
4. **Advanced** retention section (new position — **below** list + pagination)

Do **not** leave retention above the heading/filters. Plan decision: cheapest de-emphasis without a Settings page.

### Advanced collapsible (pinned)

| Pin | Value |
|-----|--------|
| Trigger label | **Advanced** (exact) |
| Default | **Collapsed** on first paint — no “remember open” persistence |
| Content when expanded | Existing retention UI: days input + Save + Clean up now + helper paragraph (same copy/behavior as today) |
| Collapsed chrome | Trigger only (chevron/indicator OK). Do **not** surface the current day count on the closed trigger — keep the pocket quiet |
| Component | Prefer shadcn `Collapsible` (`web/components/ui/collapsible.tsx`). If missing (Features 01/04 not yet executed), install via `pnpm dlx shadcn@latest add @shadcn/collapsible` from `web/`, or use native `<details>`/`<summary>` and note in handoff |
| Client boundary | Collapsible wrapper is `"use client"`. Keep `runs/page.tsx` a Server Component; pass `retentionDays` into the client Advanced/retention component as today |

**Implementation preference:** Keep `RetentionControls` as the controls body (so Save / Clean up / validation logic stays in one place). Add a thin client wrapper (e.g. `RunsAdvancedRetention` in `web/components/runs/runs-advanced-retention.tsx`, or fold the collapsible into `retention-controls.tsx` with a clear Advanced trigger). Page imports the Advanced-wrapped entry point, not a bare always-open card at the top.

**No collapsed-submit pin:** Save and Clean up are button-driven after expand — unlike Feature 01 schedule cron, there is no form field that must submit while Advanced is closed.

### Behavior unchanged (pinned)

Do **not** change:

- Validation (integer 1–365), toast copy, action return shapes
- `updateRunRetentionDays` / `getOrCreateAppSettings` / worker retention poller / `selectRunsForDeletion` / `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER`
- Default 30 days, min/max constants
- Helper text meaning (auto-removal; latest three completed runs per newsletter always kept) — exact wording may stay as today

When settings load fails, page still defaults `retentionDays` to `DEFAULT_RUN_RETENTION_DAYS` and may show the secondary-degraded alert — unchanged.

### Out of scope

- Settings page or new nav item
- Per-newsletter retention
- Changing purge eligibility, checkpoint cascade delete, or worker poll interval
- Dashboard / Inspect / schedule builder work (Features 01–06)
- Redesigning the retention control layout beyond wrapping + repositioning (no new fields)

### Research notes (shaped decisions)

- codegraph: `RunsPage` → top-of-page `RetentionControls` → `updateRunRetentionSetting` / `purgeRunsNow`; Plan.md 2026-07-17: retention stays on Runs as collapsible Advanced; Settings deferred.
- Stage acceptance: “Run retention (days + clean up now) lives under a collapsed-by-default Advanced section on Runs; behavior of retention itself is unchanged.”
- Features 01/04 already pin shadcn Collapsible (+ `<details>` fallback) — reuse that pattern; no form forceMount needed here.

## Dependencies

- Builds on: Stage 04 Feature 06 run retention (`RetentionControls`, settings singleton, purge actions, protected three completed runs).
- Soft: Stage 10 Features 01/04 may already have installed `collapsible.tsx` — reuse if present; do not block on those features being verified.
- No hard Stage 10 feature prerequisite.

## Constraints

- Do **not** change Appwrite schema, settings repository write semantics, retention eligibility algorithm, or worker purge behavior.
- Do **not** add a Settings route or nav entry.
- Preserve auth-gated `/runs` and existing filter/pagination query params.
- Collapsed-by-default must be the initial paint.
- Keep internal-tool quality — quiet Advanced trigger, not a marketing disclosure.

## Acceptance criteria

- [ ] On `/runs`, retention days + Save + Clean up now are not visible until the operator expands **Advanced**.
- [ ] Advanced is collapsed by default on first paint.
- [ ] Advanced (and its retention controls) sit below the runs list and pagination — not above the Runs heading/filters.
- [ ] Expanding Advanced reveals the same retention controls and helper copy; Save and Clean up now still call the existing actions with unchanged validation/toasts.
- [ ] Retention behavior (settings update, purge-now, protected completed runs, worker auto-purge) is unchanged.
- [ ] `pnpm typecheck` and `pnpm lint` pass; targeted retention / Advanced UI tests pass.

## Files

- Create (preferred): `web/components/runs/runs-advanced-retention.tsx` — client Advanced collapsible wrapping `RetentionControls`
- Create: `web/src/__tests__/runs-advanced-retention.test.tsx` — collapsed default, expand reveals controls, placement contract if tested via wrapper
- Modify: `web/app/(protected)/runs/page.tsx` — remove top `RetentionControls`; render Advanced wrapper after `RunsPagination`
- Modify (optional): `web/components/runs/retention-controls.tsx` — only if folding collapsible into this file instead of a wrapper; keep control IDs/labels stable (`run-retention-days`, “Keep run history for”, “Clean up now”)
- Modify: `web/src/__tests__/retention-controls.test.tsx` — only if `RetentionControls` itself gains the collapsible (then expand-before-assert); if wrapper owns Advanced, leave this file’s control-behavior tests as-is
- Optional install: `web/components/ui/collapsible.tsx` (if not already present)

## Testing approach

**Test-first** for Advanced chrome. Retention action behavior remains covered by existing `retention-controls.test.tsx` (keep green).

**Test cases** (`runs-advanced-retention.test.tsx`):

1. **Collapsed by default:** render Advanced wrapper with `retentionDays={30}`; assert trigger **Advanced** is present; assert days input (`#run-retention-days` / label “Keep run history for”) and **Clean up now** are **not** visible (or not in the document / `hidden` per chosen Collapsible behavior — prefer not visible to the user).
2. **Expand reveals controls:** click/open Advanced; assert days input + Save + Clean up now + helper text about latest three completed runs are visible.
3. **Controls still work when open:** after expand, change days and Save — still calls `updateRunRetentionSetting` (mock) as today; optional thin re-assert so the wrapper does not break wiring. Full validation matrix may stay in `retention-controls.test.tsx`.

**Page placement:** Prefer asserting in the Advanced test that the wrapper is the placement unit, plus a small `runs/page` composition check if a presentational extract exists — otherwise verifier confirms via reading `page.tsx` that Advanced is after `RunsPagination` and no retention component remains above `RunsView`. Do not require Playwright for V1.

**Not test-first:** exact chevron SVG / animation. Verifier checks collapsed default + expand + page order + typecheck/lint.

## Tasks

### Task 1: Failing Advanced UI tests

- **Action:** Add `web/src/__tests__/runs-advanced-retention.test.tsx` covering cases 1–2 (and case 3 if easy). Mock `@/app/(protected)/runs/actions` and `@/lib/toast` the same way `retention-controls.test.tsx` does. Tests may fail until the wrapper exists.
- **Expected result:** Failing (or scaffolded) tests that encode collapsed-default + expand-reveals behavior.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/runs-advanced-retention.test.tsx` (expect fail until Task 2, or pass if implemented in same session — verifier accepts either order within the feature as long as final green).
- **Depends on:** none.

### Task 2: Advanced wrapper + Collapsible

- **Action:** Ensure shadcn Collapsible exists under `web/components/ui/` (install if missing; `<details>` fallback OK). Implement `RunsAdvancedRetention` (or equivalent) with trigger **Advanced**, `defaultOpen={false}` / equivalent, wrapping existing `RetentionControls`. Do not change action/validation logic.
- **Expected result:** Component exists; Advanced UI tests pass; `retention-controls.test.tsx` still passes if controls remain independently renderable.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/runs-advanced-retention.test.tsx src/__tests__/retention-controls.test.tsx`
- **Depends on:** Task 1.

### Task 3: Reposition on `/runs` page

- **Action:** In `web/app/(protected)/runs/page.tsx`, remove the top-of-page retention render. After `RunsPagination`, render the Advanced wrapper with `retentionDays`. Keep settings load / secondary-degraded alert behavior unchanged.
- **Expected result:** Page order matches Spec; no always-open retention card above the list.
- **Verify:** Read `page.tsx` — Advanced/retention after pagination; `pnpm typecheck` && `pnpm lint`
- **Depends on:** Task 2.

### Task 4: Feature verification

- **Action:** Run targeted retention + Advanced tests; fix any regressions. Confirm acceptance criteria.
- **Expected result:** All listed tests green; typecheck/lint clean.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/runs-advanced-retention.test.tsx src/__tests__/retention-controls.test.tsx` && `pnpm typecheck` && `pnpm lint`
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/web exec vitest run src/__tests__/runs-advanced-retention.test.tsx src/__tests__/retention-controls.test.tsx` && `pnpm typecheck` && `pnpm lint`
- Expected: all listed tests pass; typecheck and lint pass (benign missing-`pages/` eslint warning ignored per AGENTS.md). Spot-check: `/runs` shows Advanced collapsed below the list; expand shows days + Clean up now.

## Handoff

Builder reports: files created/modified; whether Collapsible or `<details>` was used; whether a wrapper vs inlined collapsible in `retention-controls.tsx`; confirmation page order (alerts → RunsView → pagination → Advanced); confirmation no settings/schema/purge logic changes; any deviation and why.
