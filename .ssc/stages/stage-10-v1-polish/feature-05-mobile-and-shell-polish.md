# Feature 05: Mobile and shell polish

## Intent

Make phone-width operator chrome trustworthy: the sidebar closes after a nav tap, nested routes keep the right nav item highlighted, Back/Inspect controls are easy to hit, unused design-system scaffolding is gone, routes show a light loading/error fallback, and status filters/labels read as title case — so daily use on a phone feels intentional rather than half-finished.

## Spec

Shell and presentation polish only. No schema, repository, pipeline, or delivery-semantics changes. Six concrete deliverables:

### 1. Mobile sidebar closes on nav choose (pinned)

Today `AppSidebar` (`web/components/app-sidebar.tsx`) renders nav `Link`s inside the mobile `Sheet` but never calls `setOpenMobile(false)`, so the sheet stays open after navigation.

**Behavior:** On each sidebar nav item click (including Dashboard `/`), when the sidebar is in mobile mode, close the sheet via `useSidebar().setOpenMobile(false)`. Desktop sidebar behavior unchanged (calling `setOpenMobile(false)` when not mobile is a no-op / safe).

**Implementation pin:** Keep closing logic in `AppSidebar` (or a tiny `SidebarNavLink` helper used only there). Do not fork `web/components/ui/sidebar.tsx` for this — that file is shadcn baseline.

### 2. Nested-route active highlight (pinned)

Today: `isActive={pathname === item.href}` — exact match only. `/runs/[runId]/inspect` and `/issues/[runId]` leave **Runs** / **Issues** unhighlighted.

Add a pure helper (prefer `web/lib/nav-active.ts`, co-located with `nav-items.ts`):

```ts
isNavItemActive(pathname: string, href: string): boolean
```

| `href` | Active when |
|--------|-------------|
| `/` (Dashboard) | `pathname === "/"` only — **not** every path |
| Any other nav href (e.g. `/runs`, `/issues`, `/newsletters`) | `pathname === href` **or** `pathname.startsWith(href + "/")` |

Wire `AppSidebar` to use this helper. Flat eight-item `navItems` list stays unchanged (Plan decision: no regrouping).

### 3. Larger Back / Inspect hit targets (pinned)

Targets (labels/copy locked — do not rename):

| Control | Location |
|---------|----------|
| **Back to Issues** | `web/components/issues/issue-reader.tsx` (`BackToIssuesLink`, all usages including not-available / load-error bare) |
| **Inspect pipeline** | Same file (`INSPECT_PIPELINE_LABEL` link on success chrome) |
| **Back to Runs** | `web/components/runs/inspect-shell.tsx` (`BackToRunsLink`, all usages) |

**Sizing pin:** Each of these three controls must have a **minimum tap height of 44px** (`min-h-11` / `min-h-44px`) and comfortable horizontal padding (at least `px-3`). Prefer shared class or small shared link component so Issue and Inspect stay consistent. Visual style may stay quiet (muted text / ghost) — do **not** require primary filled buttons.

**Out of hit-target scope:** Download Markdown/HTML, Send, Publish, list-row Inspect buttons (already `Button size="sm"`).

### 4. Remove `/design-system` (pinned)

Delete the entire route tree:

- `web/app/(protected)/design-system/page.tsx`
- `web/app/(protected)/design-system/_components/*` (demos)

It is already absent from `navItems`. After removal, `/design-system` must 404 (or Next not-found). Update or remove any tests that assert the page exists. Do not add a redirect.

### 5. Light route `loading` / `error` UI (pinned — “cheap”)

No `loading.tsx` / `error.tsx` exist under `web/app` today. Add **one pair** under the protected layout segment:

| File | Role |
|------|------|
| `web/app/(protected)/loading.tsx` | Loading fallback with **operator-visible** content: muted **Loading…** text and/or a short pulse skeleton tagged `data-testid="protected-loading"` (empty shell fails verification) |
| `web/app/(protected)/error.tsx` | Client error boundary: short safe message + **Try again** calling `reset`/`retry` per Next App Router convention |

**Pins:**

- Cover all protected operator pages with this single pair — do **not** invent per-route skeleton designs.
- `error.tsx` must be a Client Component (`"use client"`).
- Do not surface raw stack traces or Appwrite internals to the operator.
- Loading and error UIs are verified by `web/src/__tests__/protected-loading-error.test.tsx` (visible content + Try again → reset) — not by “default export exists” alone.
- Login / public routes outside `(protected)` are out of scope.

### 6. Humanize status labels (pinned)

Operator-visible status **text** uses title case; stored/query values stay lowercase kebab/snake as today.

| Domain | Values → labels | Wire into |
|--------|-----------------|-----------|
| Run status | `pending`→`Pending`, `running`→`Running`, `completed`→`Completed`, `failed`→`Failed` | Runs filter `SelectItem`s (`runs-view.tsx`); run list badges (`runs-table.tsx`, `run-list-card.tsx`); Inspect meta line (`inspect-shell.tsx` — currently raw `{run.status}`) |
| Feed qualification status | `untested`→`Untested`, `ok`→`Ok`, `failed`→`Failed` | Feeds table/cards/form badge; newsletter attached-feed badge (`newsletter-feeds-section.tsx`) |
| Feed operational health | `healthy`→`Healthy`, `unhealthy`→`Unhealthy` | `FeedHealthBadge` |

Prefer small pure helpers (e.g. `formatRunStatusLabel`, `formatFeedStatusLabel`, `formatFeedHealthLabel`) in an existing display module (`run-display.ts` / new `web/lib/status-labels.ts` or feeds display file) so filters and badges cannot drift.

**Already humanized — leave alone:** Delivery status badges (`Sent` / `Failed` / `Published`), delivery outcome filter labels (`Any failure`, etc.), run trigger labels (`Manual` / `Scheduled`).

**URL/query params:** Filter `value={status}` stays `"pending"` etc. Only the visible child text changes.

### Out of scope

- Feature 04 Inspect collapsibles / draft stack.
- Feature 06 Dashboard content.
- Feature 07 Runs Advanced retention placement.
- Nav regrouping / hiding items / adding Design System back.
- Per-page custom loading skeletons beyond the shared `(protected)` pair.
- Changing ResponsiveList breakpoints or list-page DRY refactors.

### Research notes (shaped decisions)

- codegraph: `AppSidebar` exact-match `isActive`; mobile `Sidebar` uses `Sheet` + `openMobile` / `setOpenMobile`; `BackToIssuesLink` / `BackToRunsLink` / Inspect pipeline use `text-sm` quiet links; design-system exists but is not in `navItems`; run/feed badges render raw enum strings; no `loading.tsx`/`error.tsx` under `web/app`.
- Context7 Next.js App Router: `loading.tsx` wraps the segment’s `page`; `error.tsx` must be a Client Component with reset/retry.
- Stage acceptance criterion + Plan decision log (2026-07-17): flat eight-item nav kept; `/design-system` removed in Stage 10.

## Dependencies

- Builds on: Stage 02 app shell (`AppSidebar`, `(protected)` layout, shadcn Sidebar/Sheet); Stage 06 Issues reader + Inspect shell; Stage 04 Runs list filters/badges; Stage 03 Feeds badges.
- No Stage 10 feature prerequisite (Features 01–04 do not block shell polish). Feature 04 may touch Inspect chrome — coordinate hit-target classes on `BackToRunsLink` if both land close together; do not re-litigate Feature 04 layout.

## Constraints

- Do **not** change Appwrite schema, run/feed repositories, or URL query param values for filters.
- Do **not** alter `navItems` order, titles, or hrefs (except removing design-system, which was never listed).
- Preserve locked copy: `INSPECT_PIPELINE_LABEL`, `ISSUE_*_COPY`, `INSPECT_*_COPY`, delivery badge labels.
- Do **not** widen Issue reader `max-w-prose` or Inspect `max-w-3xl`.
- Prefer minimal diffs to `web/components/ui/sidebar.tsx`.

## Acceptance criteria

- [ ] On a phone-width viewport with the mobile sidebar open, choosing any sidebar nav item closes the sheet after the tap.
- [ ] On `/runs/[runId]/inspect`, **Runs** is highlighted; on `/issues/[runId]`, **Issues** is highlighted; Dashboard stays active only on `/`.
- [ ] **Back to Issues**, **Inspect pipeline**, and **Back to Runs** each meet ≥44px minimum tap height.
- [ ] `/design-system` route and its demo components are gone from the repo.
- [ ] Protected navigations show a light loading fallback; uncaught render errors in a protected page show a safe error UI with Try again.
- [ ] Run status filter options and run/feed/health status badges (and Inspect run-status meta) show title-case labels; filter query values remain lowercase enums.

## Files

- Create: `web/lib/nav-active.ts` (or equivalent pure helper path)
- Create: `web/lib/status-labels.ts` and/or extend `web/components/runs/run-display.ts` + feeds display helpers
- Create: `web/app/(protected)/loading.tsx`
- Create: `web/app/(protected)/error.tsx`
- Create: `web/src/__tests__/nav-active.test.ts`
- Create: `web/src/__tests__/status-labels.test.ts` (and/or extend existing display tests)
- Create: `web/src/__tests__/shell-polish.test.tsx` (sidebar close + hit-target classes + design-system absence as needed)
- Create: `web/src/__tests__/protected-loading-error.test.tsx` (loading/error route fallback smoke)
- Create or extend: feeds / newsletter badge UI tests (e.g. `web/src/__tests__/feed-status-labels.test.tsx` or existing feeds list tests) covering qualification + health + attached-feed badges
- Modify: `web/components/app-sidebar.tsx`
- Modify: `web/components/issues/issue-reader.tsx`
- Modify: `web/components/runs/inspect-shell.tsx`
- Modify: `web/components/runs/runs-view.tsx`
- Modify: `web/components/runs/runs-table.tsx`
- Modify: `web/components/runs/run-list-card.tsx`
- Modify: Feeds badge surfaces (`feeds-table.tsx`, `feed-list-card.tsx` / `feed-form-dialog.tsx`, `feed-health.tsx`)
- Modify: `web/components/newsletters/newsletter-feeds-section.tsx`
- Delete: `web/app/(protected)/design-system/**`
- Test: update `web/src/__tests__/feeds-nav.test.ts` / `inspect-entry.test.tsx` if assertions break on label/nav changes

## Testing approach

Mostly **test-first unit/component** — full mobile Sheet interaction is awkward in jsdom; close-on-nav is verified by asserting `setOpenMobile(false)` is invoked on nav click when `isMobile` is mocked true.

**Test cases:**

1. **`isNavItemActive`:** `/` only exact; `/runs` active for `/runs` and `/runs/x/inspect`; `/issues` active for `/issues/x`; `/feeds` not active for `/feedback`-style false positives (prefix requires `href + "/"`).
2. **Status labels (helpers):** each run/feed/health enum maps to the pinned title-case string; helpers only accept typed enums.
3. **Runs filter / badges (UI):** rendered filter option text and badge text are title case; `SelectItem` `value` remains lowercase.
4. **Feed / health badges (UI):** Feeds qualification badges render `Untested` / `Ok` / `Failed`; `FeedHealthBadge` renders `Healthy` / `Unhealthy`; newsletter attached-feed status badge uses the same qualification title-case labels. Helpers-only tests are **not** sufficient for this case.
5. **Hit targets:** Back to Issues, Inspect pipeline, Back to Runs elements include `min-h-11` (or documented shared class that resolves to ≥44px).
6. **Sidebar close:** with mocked `useSidebar({ isMobile: true, setOpenMobile })`, clicking a nav link calls `setOpenMobile(false)`.
7. **Design-system removal:** no `design-system/page.tsx` (or route module) remains; optional smoke that `navItems` still has exactly eight operator items.
8. **loading/error fallbacks (UI):** `protected-loading-error.test.tsx` renders `loading.tsx` and asserts operator-visible fallback content (pinned copy **Loading…** or a stable `data-testid="protected-loading"` on the skeleton). Renders `error.tsx` with a mock `reset`/`retry`, asserts a safe message (no stack/Appwrite internals) and a **Try again** control that invokes reset. An empty default-export-only `loading.tsx` must fail this test.

**Not test-first / verifier visual:** actual Sheet animation and physical finger tap — verifier confirms via class/behavior contracts above + `pnpm typecheck` / `pnpm lint` / targeted vitest.

## Tasks

### Task 1: Helpers + failing tests (nav active, status labels)

- **Action:** Add `isNavItemActive` and status-label helpers with vitest coverage for the tables in Spec §§2 and 6. Assert current AppSidebar / badge call sites still fail until wired (or write component tests that fail on raw `pending` text).
- **Expected result:** New helper modules + failing/red tests that encode pinned label and active-route rules.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/nav-active.test.ts src/__tests__/status-labels.test.ts` (adjust paths to match) — helpers pass; any “wired UI” assertions still red if deferred to Task 2.
- **Depends on:** none.

### Task 2: Wire sidebar active + close-on-nav + status labels

- **Action:** Update `app-sidebar.tsx` to use `isNavItemActive` and close mobile sheet on nav click. Replace raw status text in Runs filter/badges, Inspect meta, Feeds badges, FeedHealthBadge, and newsletter attached-feed badges with the helpers. Add/extend UI tests so Feeds qualification, FeedHealthBadge, and newsletter attached-feed badges assert the pinned title-case strings (Testing approach §4) — not helpers alone.
- **Expected result:** Nested routes highlight correctly; mobile nav closes on choose (mocked test green); Runs **and** feed/health/attached-feed UIs show title case; query values unchanged.
- **Verify:** Vitest for sidebar + Runs status UI + feed/health/attached-feed badge UI; `pnpm typecheck`; `pnpm lint`.
- **Depends on:** Task 1.

### Task 3: Enlarge Back / Inspect hit targets

- **Action:** Apply the ≥44px tap target styling to Back to Issues, Inspect pipeline, and Back to Runs in `issue-reader.tsx` and `inspect-shell.tsx` (shared class/component preferred). Add assertions in `shell-polish` / existing issue-reader / inspect-entry tests.
- **Expected result:** All three controls meet the sizing pin; locked labels unchanged.
- **Verify:** Vitest asserts `min-h-11` (or equivalent); typecheck + lint.
- **Depends on:** none (can parallelize with Task 2 after Task 1 helpers if desired; default order after Task 2).

### Task 4: Remove design-system; add protected loading + error

- **Action:** Delete `web/app/(protected)/design-system/**`. Add `loading.tsx` and client `error.tsx` under `(protected)` per Spec §5 — loading must include operator-visible **Loading…** text or `data-testid="protected-loading"`. Add `web/src/__tests__/protected-loading-error.test.tsx` per Testing approach §8. Fix any broken imports/tests.
- **Expected result:** Design-system tree gone; protected loading/error render real fallback UI (not empty shells); typecheck/lint clean.
- **Verify:** `pnpm --filter @newsletter/web exec vitest run src/__tests__/protected-loading-error.test.tsx`; design-system file absence; `pnpm typecheck`; `pnpm lint`.
- **Depends on:** none (independent of Tasks 2–3; run after or beside them).

### Task 5: Feature verification gate

- **Action:** Run the full Feature verification commands; fix any residual failures from Tasks 1–4.
- **Expected result:** All acceptance criteria covered by tests or explicit verifier checks; gates green.
- **Verify:** See Feature verification.
- **Depends on:** Tasks 1–4.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm --filter @newsletter/web exec vitest run src/__tests__/nav-active.test.ts src/__tests__/status-labels.test.ts src/__tests__/shell-polish.test.tsx src/__tests__/protected-loading-error.test.tsx src/__tests__/feed-status-labels.test.tsx src/__tests__/feeds-nav.test.ts src/__tests__/inspect-entry.test.tsx src/__tests__/issue-reader.test.tsx`
  (If feed badge coverage lives in an existing feeds test file instead of `feed-status-labels.test.tsx`, substitute that path — but Feature verification **must** include a file that asserts Feeds / FeedHealthBadge / newsletter attached-feed title-case UI, plus `protected-loading-error.test.tsx`.)
- Expected: all pass; no `design-system` page module remains; loading/error show visible fallbacks; run **and** feed/health badge UIs are title case; acceptance criteria above satisfied.

## Handoff

Builder reports: files created/modified/deleted; how mobile close and nested active matching were implemented; shared hit-target class name; status-label helper locations; confirmation design-system removed; loading/error placement; any deviations (e.g. helper file path) and why.
