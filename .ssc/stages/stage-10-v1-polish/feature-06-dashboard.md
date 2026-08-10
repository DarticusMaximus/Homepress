# Feature 06: Dashboard

## Intent

Make `/` a useful daily landing page — recent issues, a compact recent-runs snapshot, attention badges with deep links, and a minimized DB/feeds health strip — so the operator opens the app and immediately sees what to read and what needs fixing, not only infrastructure health.

## Spec

Replace the thin Stage 02 home (heading + DB health card + feeds health card only) with an operator landing page. No new Appwrite collections, no pipeline/delivery semantics changes — composition of existing list APIs + UI.

### Page structure (top → bottom, pinned)

1. Keep existing product heading (`APP_NAME`) and short tagline.
2. **Needs attention** — render only when at least one attention count is > 0 (omit the whole section when everything is fine).
3. **Recent issues** — always present (list or empty state).
4. **Recent runs** — always present (list or empty state).
5. **Health strip** — always present; compact when healthy, expanded detail when unhealthy/error.

### Constants (pinned)

| Constant | Value |
|----------|-------|
| Recent issues limit | **5** (newest first) |
| Recent runs window | Rolling **7 days** from “now” (not calendar week) |
| Recent runs cap | **10** rows after window filter |
| Failed-run attention | `status === "failed"` and `startedAt` within the same 7-day window |
| Failed-delivery attention | Eligible issues with email or RSS delivery status `"failed"` and `(endedAt ?? startedAt)` within the same 7-day window |
| Unhealthy feeds | Current `operationalHealth === "unhealthy"` count (no time window) |

### Needs attention (pinned)

Show badges/rows only for counts > 0 (no “0 failed” noise). Each item is a deep link:

| Signal | Link |
|--------|------|
| Unhealthy feeds (`N`) | `/feeds?health=unhealthy` |
| Failed runs (`N`) | `/runs?status=failed` via `buildRunsHref({ status: "failed" })` |
| Failed delivery (`N`) | `/delivery?outcome=any_failure` via `buildDeliveryHref({ outcome: "any_failure" })` |

Label copy should be human-readable (e.g. `3 unhealthy feeds`, `1 failed run`, `2 delivery failures`) — exact phrasing flexible; counts and hrefs are locked.

### Recent issues (pinned)

- Source: `listIssues` (completed + non-empty draft checkpoint), already sorted newest first; take first **5**.
- Display: title via `resolveIssueDisplayTitlesForRuns` (fallback `formatIssueFallbackTitle`), newsletter name, date (`endedAt ?? startedAt`).
- Row link: `/issues/[runId]`.
- Empty: short copy **No issues yet** (or equivalent) + link to `/newsletters`.
- Section header should include a quiet “View all” / link to `/issues`.

### Recent runs (pinned)

- Source: `listRuns` with a generous fetch limit (e.g. 100 — same pattern as other pages), then keep runs whose `startedAt` is within the last 7 days; sort newest first; cap at **10**.
- Display: newsletter name, **humanized** status label (`Pending` / `Running` / `Completed` / `Failed` — reuse Feature 05 `formatRunStatusLabel` if present, else a tiny local helper matching that table), started (and ended when present) via existing `formatRunDateTime` or equivalent.
- Row link:
  - `completed` or `failed` → `inspectRunHref(runId)` (`/runs/[runId]/inspect`)
  - `pending` or `running` → `/runs` (list; no inspect deep-link required)
- Empty: **No runs in the last 7 days** (or equivalent) + link to `/runs`.
- Section header quiet link to `/runs`.

### Health strip (pinned)

Keep both DB health (`runHealthCheck` + `HealthCard` behavior) and feeds health (`listFeeds` + `countUnhealthyFeeds` / `FeedsHealthCard` behavior). Change presentation:

- **DB healthy (status ok, no page-level error):** compact footprint — badge + Re-run still present; **do not** render the per-step create/read/delete list (that list is the bulk that must shrink when green).
- **DB unhealthy/error:** keep today’s detail (failed step message / alert) + Re-run — same information as now when bad, not a silent badge-only failure.
- **Feeds healthy (count 0, no error):** compact density (small badge/label + View feeds link) — must not dominate the page.
- **Feeds unhealthy/error:** keep count/message and deep link (`/feeds?health=unhealthy` when unhealthy) as today.
- Prefer refactoring existing `HealthCard` / `FeedsHealthCard` (e.g. `compact` / density prop or a thin wrapper) over duplicating health logic.
- **Required tests:** create `web/src/__tests__/health-card.test.tsx` for the DB healthy/unhealthy contracts above; update `web/src/__tests__/feeds-health-card.test.tsx` for feeds compact healthy density.

### Error isolation (pinned)

Each data group loads independently on the server page (same spirit as today’s try/catch around health vs feeds). If recent issues fail, show a section-level safe alert and still render runs / attention / health when those succeed. Do not blank the whole dashboard on one repository failure. Do not surface raw Appwrite internals.

### Out of scope

- “Next scheduled” widget, newsletter counts, stats strips, charts.
- Changing feed-health thresholds, run retention, delivery recording, or Issues eligibility rules.
- New Settings page or nav changes.
- Feature 07 Runs Advanced retention UI.
- List-page DRY refactors across Issues/Runs/Delivery.

### Research notes (shaped decisions)

- codegraph: `web/app/(protected)/page.tsx` today renders only `HealthCard` + `FeedsHealthCard`; Stage 04 already deep-links `/feeds?health=unhealthy` from the feeds health card.
- Existing APIs: `listIssues`, `listRuns`, `listFeeds` / `countUnhealthyFeeds`, `listDeliveryIssues({ outcome: "any_failure" })`, `resolveIssueDisplayTitlesForRuns`, `buildRunsHref`, `buildDeliveryHref`, `inspectRunHref`.
- Grill (2026-07-21): package + minimize healthy health; recent issues = 5; runs = rolling 7d cap 10; attention only when > 0; section order attention → issues → runs → health; row fields and deep links as above.

## Dependencies

- Builds on: Stage 02 dashboard shell + health cards; Stage 03 feed operational health; Stage 04 runs list/`listRuns`/`buildRunsHref`; Stage 06 `listIssues` + display titles; Stage 09 delivery list/`listDeliveryIssues`/`buildDeliveryHref`.
- Soft: Feature 05 status-label helper — reuse when present; do not block on Feature 05 being verified.

## Constraints

- Do **not** change Appwrite schema, repositories’ write paths, pipeline, or delivery side effects.
- Do **not** remove DB or feeds health entirely — only shrink their healthy footprint.
- Preserve auth-gated `(protected)` home at `/`.
- Attention deep-link query values stay lowercase enums (`failed`, `any_failure`, `unhealthy`).
- Keep internal-tool quality (no marketing hero redesign).

## Acceptance criteria

- [ ] Dashboard shows recent issues (up to 5) with title, newsletter, date, and links into the issue reader (or the pinned empty state + Newsletters link).
- [ ] Dashboard shows a compact recent-runs snapshot for the rolling last 7 days (max 10), with humanized status and links to Inspect (completed/failed) or Runs (pending/running), or the pinned empty state.
- [ ] Needs-attention signals for unhealthy feeds, failed runs (7d), and failed delivery (7d) appear only when count > 0, with the pinned deep links.
- [ ] DB and feeds health remain on the page but occupy a small footprint when healthy; unhealthy/error states still expose detail and actions.
- [ ] A failure loading one section does not blank the other sections.
- [ ] `pnpm typecheck` and `pnpm lint` pass; targeted dashboard/health tests pass.

## Files

- Create: `web/lib/dashboard-data.ts` (or `web/components/dashboard/dashboard-data.ts`) — pure helpers for window filter, caps, attention counts
- Create: `web/components/dashboard/needs-attention.tsx` (or equivalent)
- Create: `web/components/dashboard/recent-issues.tsx` (or equivalent)
- Create: `web/components/dashboard/recent-runs.tsx` (or equivalent)
- Create: `web/components/dashboard/health-strip.tsx` (wrapper) — optional if density lives on existing cards
- Create: `web/src/__tests__/dashboard-data.test.ts`
- Create: `web/src/__tests__/dashboard-widgets.test.tsx`
- Create: `web/src/__tests__/dashboard-page.test.tsx` — composition order + error isolation (fixture props / extracted presentational shell; no live Appwrite)
- Create: `web/src/__tests__/health-card.test.tsx` — DB healthy compact (no step list) + unhealthy/error still shows detail + Re-run
- Modify: `web/app/(protected)/page.tsx` — compose sections, isolated loads
- Modify: `web/components/health-card/health-card.tsx` — compact healthy density (hide step list when ok)
- Modify: `web/components/feeds-health-card/feeds-health-card.tsx` — compact healthy density
- Modify: `web/src/__tests__/feeds-health-card.test.tsx`
- Optional: tiny `formatRunStatusLabel` local helper if Feature 05 helper not yet available
- Optional: extract a presentational `DashboardView` (or equivalent) from `page.tsx` so composition order is unit-testable without Appwrite

## Testing approach

**Test-first** for pure data helpers and widget rendering. Page-level Appwrite integration is not required in vitest — mock props / feed helpers with fixtures.

**Test cases:**

1. **Window + cap:** given runs with `startedAt` inside/outside 7 days, helper returns only in-window runs, sorted newest first, length ≤ 10.
2. **Recent issues slice:** given >5 eligible issues, helper/page selection yields 5 newest.
3. **Attention counts:** unhealthy feeds count; failed runs only in-window; delivery failures only in-window with email/rss `"failed"`; zero counts produce no attention items.
4. **Needs attention UI:** renders links with pinned hrefs only for positive counts; renders nothing (or empty fragment) when all zero.
5. **Recent issues UI:** row links to `/issues/{id}`; empty state copy + `/newsletters` link.
6. **Recent runs UI:** humanized status text; completed/failed → inspect href; pending/running → `/runs`; empty state + `/runs` link.
7. **Health compact — Feeds:** healthy feeds card uses compact density (badge/label + link); unhealthy/error still show count/message and correct hrefs. Update prior healthy-state assertions that assumed a large card body if they break.
8. **Health compact — DB (`health-card.test.tsx`, required):** when `result.status === "ok"` and no error, assert the per-step list is **absent** (no `health-step-*` rows) while Healthy badge and Re-run remain. When unhealthy/error, assert failure detail (alert and/or failed step message) and Re-run remain. Feeds-only green tests are **not** sufficient for AC #4.
9. **Composition / section order (`dashboard-page.test.tsx`):** render the dashboard presentational shell (or page composition helper) with fixture props; assert Needs attention → Recent issues → Recent runs → Health strip appear in that DOM order (via `aria-label` / headings / `data-testid`). When an issues error is set, issues shows an alert and runs/attention/health still render.

**Not test-first / verifier:** exact pixel height of the health strip — verifier checks compact-vs-expanded contracts above + `pnpm typecheck` / `pnpm lint` / targeted vitest.

## Tasks

### Task 1: Dashboard data helpers + failing tests

- **Action:** Add `web/lib/dashboard-data.ts` (or agreed path) with pure functions for: filter runs to rolling 7-day window + cap 10; slice recent issues to 5; compute attention counts (unhealthy feeds, failed runs in window, failed delivery in window). Add `web/src/__tests__/dashboard-data.test.ts` covering cases 1–3 (tests may fail until helpers are complete — prefer write tests then implement in this task or split red→green within the task).
- **Expected result:** Helpers + passing unit tests for window/cap/attention math; no page wiring yet required.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/dashboard-data.test.ts`
- **Depends on:** none.

### Task 2: Widget components + failing UI tests

- **Action:** Add Needs attention / Recent issues / Recent runs components under `web/components/dashboard/`. Add `web/src/__tests__/dashboard-widgets.test.tsx` for cases 4–6. Status labels humanized per Spec. (Section-order + issues-error isolation are case 9 / Task 4.)
- **Expected result:** Widgets render from props; UI tests pass; page not yet fully composed (or composed behind incomplete health strip — acceptable).
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/dashboard-widgets.test.tsx`
- **Depends on:** Task 1.

### Task 3: Compact health strip

- **Action:** Refactor `HealthCard` and `FeedsHealthCard` (and/or add `health-strip.tsx`) so healthy state is compact per Spec (DB: hide per-step list when ok; Feeds: compact density when count 0). Create `web/src/__tests__/health-card.test.tsx` for case 8; update `feeds-health-card.test.tsx` for case 7.
- **Expected result:** Healthy DB/feeds UI has small footprint; unhealthy/error still shows detail + actions; both health test files pass.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/health-card.test.tsx src/__tests__/feeds-health-card.test.tsx`
- **Depends on:** none (can parallelize with Tasks 1–2 in spirit; serial after widgets preferred for less thrash).

### Task 4: Compose `/` page + composition test

- **Action:** Rewrite `web/app/(protected)/page.tsx` to load data with per-section try/catch, apply helpers, resolve issue titles for the recent-issues slice only, and render sections in pinned order: attention → recent issues → recent runs → health strip. Keep `APP_NAME` + tagline. Extract a presentational shell if needed so `web/src/__tests__/dashboard-page.test.tsx` can assert case 9 (order + issues-error isolation) without Appwrite.
- **Expected result:** Dashboard matches Spec end-to-end; composition test proves section order and error isolation; no single failure blanks the page.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/dashboard-page.test.tsx` && `pnpm typecheck` && `pnpm lint`
- **Depends on:** Tasks 1–3.

### Task 5: Feature verification

- **Action:** Run full targeted suite for this feature and fix any regressions in health/dashboard tests. Confirm acceptance criteria checklist.
- **Expected result:** All feature tests green; typecheck/lint clean.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/dashboard-data.test.ts src/__tests__/dashboard-widgets.test.tsx src/__tests__/dashboard-page.test.tsx src/__tests__/health-card.test.tsx src/__tests__/feeds-health-card.test.tsx` && `pnpm typecheck` && `pnpm lint`
- **Depends on:** Task 4.

## Feature verification

- Run: `pnpm --filter @newsletter/web exec vitest run src/__tests__/dashboard-data.test.ts src/__tests__/dashboard-widgets.test.tsx src/__tests__/dashboard-page.test.tsx src/__tests__/health-card.test.tsx src/__tests__/feeds-health-card.test.tsx` && `pnpm typecheck` && `pnpm lint`
- Expected: all listed tests pass; typecheck and lint pass (benign missing-`pages/` eslint warning ignored per AGENTS.md).

## Handoff

Builder reports: files created/modified; how healthy vs unhealthy health density was implemented; whether Feature 05 `formatRunStatusLabel` was reused or a local helper added; any deviation from caps/links/order and why; confirmation that attention section omits when all counts are zero.
