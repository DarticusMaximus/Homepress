# Feature 06: Admin factory nav

## Intent

Make the factory operable from the chrome already on screen: when the operator is in Admin, the existing sidebar (desktop) and sandwich sheet (mobile) list factory destinations — so jumping Feeds → Runs does not mean bouncing back to a dump of links at the bottom of the hub.

## Spec

Chrome-only. Reader nav stays **Home / Newsletters / Admin**. When the path is Admin or an Admin factory page, the same `AppSidebar` (desktop sidebar and mobile sandwich — one component, already both) grows a **Factory** group of eight destinations. The Admin hub keeps Needs attention / Recent runs / Health and **drops** the Feature 01 Factory link list. No second hamburger, no header tab row, no `admin/layout.tsx`.

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| When | `isAdminPath(pathname)`: `pathname === "/admin"` **or** `pathname.startsWith("/admin/")`. `/administration` is false. Reader `/`, `/newsletters`, `/newsletters/[id]`, `/issues/[runId]` are false. |
| Where | Existing `AppSidebar` only. Sandwich already is this sidebar on phone (`SidebarTrigger`). |
| Shape | Always-open **Factory** group under the three reader items. Not nested/collapsible under Admin. Not a flat mix of eleven siblings (two **Newsletters** labels would collide). |
| Destinations (order) | Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, Settings. Hrefs are query-less roots: `/admin/feeds`, `/admin/newsletters`, `/admin/issues`, `/admin/runs`, `/admin/schedules`, `/admin/prompts`, `/admin/delivery`, `/admin/settings`. Do not call pagination builders. |
| Labels | Same domain words as Feature 01. Factory **Newsletters** stays **Newsletters** (stage out-of-scope: renaming). Distinguisher is the Factory group, not a rename. |
| Active | Reuse `isNavItemActive`. Admin stays active on every `/admin/*`. Factory child active on its root and nested (`/admin/newsletters/x`, `/admin/runs/x/inspect`, `/admin/issues/x`). Hub `/admin` activates Admin only — none of the eight. Reader Newsletters stays inactive on `/admin/newsletters`. |
| Icons | Lucide, `tooltip={title}` like reader items: `Rss`, `PenLine`, `BookOpen`, `History`, `CalendarClock`, `MessageSquareText`, `Send`, `SlidersHorizontal`. Admin keeps `Settings`. |
| Group chrome | `SidebarGroup` `role="group"` `aria-label="Factory"` + `SidebarGroupLabel` **Factory**. Always expanded — do not install/use Collapsible for this group. |
| Hub | Remove the Factory `<section>` and `FACTORY_DIRECTORY` from `DashboardView`. Section order: Needs attention → Recent runs → Health strip. |
| Source of truth | `navItems` remains exactly the three reader items. `factoryNavItems` is a second export from `web/lib/nav-items.ts`. |

`web/lib/nav-active.ts` gains `isAdminPath`. `AppSidebar` maps `navItems` always; maps `factoryNavItems` only when `isAdminPath(pathname)`. Factory links use the same `closeMobileNav` as reader links.

## Dependencies

- Builds on: Feature 01 (three-item `AppSidebar`, `/admin/*` factory URLs, hub widgets, sticky sandwich). Feature 04 (`/admin/issues/[runId]` is an Admin path — Factory group must show there too).
- Unlocks: Stage 16 can hide `factoryNavItems` by account without changing reader nav.

**Execute Features 01–05 before this feature.**

## Constraints

- Do not add factory destinations to `navItems`. `feeds-nav.test.ts`, `reader-admin-shell.test.tsx` navItems cases, and `inspect-entry.test.tsx` stay three-item.
- Do not show the Factory group on reader paths (including `/issues/[runId]`).
- Do not add a second `SidebarTrigger`, a factory tab bar in `layout.tsx`, or `admin/layout.tsx`.
- Do not nested-always-visible under Admin on Home / reader Newsletters (stage out of scope; Stage 16).
- Do not restyle factory list pages (Stage 03 table/card stands).
- Do not change factory URLs, page titles, health widgets, or issue ops/listen.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] On `/admin` and `/admin/*`, the existing sidebar/sandwich lists Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, Settings under a Factory group, with the current factory page marked active.
- [ ] On Home, reader Newsletters (index and channel), and reader `/issues/[runId]`, those factory destinations are not in the nav.
- [ ] The Admin hub has no bottom Factory link list; Needs attention / Recent runs / Health remain.
- [ ] Jumping from one factory page to another does not require returning to `/admin`.
- [ ] No second hamburger and no second header row of factory tabs.
- [ ] Reader nav is still Home, Newsletters, Admin — factory items are not extra top-level `navItems`.

## Files

- Modify: `web/lib/nav-active.ts` — add `isAdminPath`
- Modify: `web/lib/nav-items.ts` — add `factoryNavItems` (do not change `navItems`)
- Modify: `web/components/app-sidebar.tsx` — Factory `SidebarGroup` when `isAdminPath`
- Modify: `web/components/dashboard/dashboard-view.tsx` — drop Factory section / `FACTORY_DIRECTORY`
- Modify: `web/src/__tests__/reader-admin-shell.test.tsx` — hub composition: no Factory region; keep three-item `navItems`
- Modify: `web/src/__tests__/dashboard-page.test.tsx` — section order without Factory
- Modify: `web/src/__tests__/dashboard-home-load.test.tsx` — drop Factory region assertion
- Modify: `web/src/__tests__/shell-polish.test.tsx` — mock `SidebarGroup` / `SidebarGroupLabel` (passthrough + spread props) so `AppSidebar` still renders
- Create: `web/src/__tests__/admin-factory-nav.test.tsx` — sidebar show/hide, hrefs, active, mobile close
- Create: `web/src/__tests__/admin-path.test.ts` — `isAdminPath` + `factoryNavItems` order/hrefs
- Do not modify: factory page files, issue reader, listen, `layout.tsx` header (except tests may source-read it)

## Testing approach

Test-first. jsdom + source-read. Do not screenshot. `usePathname` in `admin-factory-nav.test.tsx` must be **mutable per test** (a `pathnameState.value` closed over by `vi.mock("next/navigation")` — do not copy `shell-polish.test.tsx`’s hardcoded `() => "/"`). Sidebar mock must export `SidebarGroup` (spread DOM props so `role` / `aria-label` reach the document) and `SidebarGroupLabel`.

### `isAdminPath` / `factoryNavItems` (`admin-path.test.ts`)

1. **True** for `/admin`, `/admin/feeds`, `/admin/newsletters/nl-1`, `/admin/runs/r/inspect`, `/admin/issues/run-1`.
2. **False** for `/`, `/newsletters`, `/newsletters/nl-1`, `/issues/run-1`, `/administration`, `/admin-extra`.
3. **`navItems` still length 3** (Home, Newsletters, Admin). **`factoryNavItems`** titles and hrefs match the eight roots in the order pinned above. `navItems` has no Feeds/Issues/Runs/Schedules/Prompts/Delivery/Settings.

### AppSidebar (`admin-factory-nav.test.tsx`)

4. **Hidden on reader paths** — pathname `/`, `/newsletters`, `/newsletters/nl-1`, `/issues/run-1`: no `getByRole("group", { name: "Factory" })`; no link with href `/admin/feeds`.
5. **Shown on Admin paths** — `/admin` and `/admin/feeds`: Factory group present; `within(group)` has the eight links, hrefs exact, order as pinned.
6. **Two Newsletters on Admin** — pathname `/admin/newsletters`: `getAllByRole("link", { name: "Newsletters" })` length 2; reader one href `/newsletters`; factory one (inside Factory group) href `/admin/newsletters`.
7. **Active child** — `/admin/runs/r/inspect`: Factory **Runs** `data-active="true"` (or `isActive` on that `SidebarMenuButton`); Factory Feeds not. `/admin`: none of the eight factory buttons `data-active="true"`; Admin reader item is active.
8. **Mobile close** — pathname `/admin`; click Factory **Feeds**; `setOpenMobile(false)` (same contract as `shell-polish`).
9. **Layout source-read** — `web/app/(protected)/layout.tsx` contains exactly one `SidebarTrigger` and does not contain a factory `<nav>` in the `<header>`. No `web/app/(protected)/admin/layout.tsx` (`existsSync` false). `app-sidebar.tsx` does not import Collapsible.

### Hub (existing files, rewritten)

10. **No dump** — `DashboardView` section order is Needs attention → Recent runs → Health strip. `queryByRole("region"|"group", { name: "Factory" })` is null **in the hub view** (the sidebar group is not part of `DashboardView`). No `FACTORY_DIRECTORY`. Heading Admin remains. Isolation/error cases in `dashboard-page.test.tsx` / `dashboard-home-load.test.tsx` / `reader-admin-shell.test.tsx` must not require a Factory region on the hub.

## Tasks

### Task 1: Failing nav + hub tests

- **Action**: Add **stubs** so tests import: `isAdminPath` in `web/lib/nav-active.ts` always returns `false`; `factoryNavItems` in `web/lib/nav-items.ts` is `[]` (`navItems` unchanged). Add `admin-path.test.ts` (cases 1–3) and `admin-factory-nav.test.tsx` (cases 4–9, with mutable pathname + sidebar mock that includes Group/Label). Rewrite hub assertions in `reader-admin-shell.test.tsx`, `dashboard-page.test.tsx`, and `dashboard-home-load.test.tsx` for case 10 (no Factory region; three-section order). Do not render a Factory group in `AppSidebar` yet. Do not break `shell-polish.test.tsx` yet (AppSidebar still does not import `SidebarGroup`).
- **Expected result**: Cases 1–3 fail on `expect` (stub `isAdminPath` is never true; stub list is empty) — **not** Vitest import/resolve crashes. Cases 5–8 fail (no Factory group / no eight links / no active child / no factory click target). **Case 4 may already pass** (reader-hide is vacuously true with no group). Case 9 may already pass (layout source-read). Case 10 / hub tests fail because the dump still exists. Red signal is Admin-show/active/mobile + export assertions + hub dump, not case 4.
- **Verify**: `pnpm exec vitest run web/src/__tests__/admin-path.test.ts web/src/__tests__/admin-factory-nav.test.tsx web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/dashboard-page.test.tsx web/src/__tests__/dashboard-home-load.test.tsx` fails on cases 1–3, 5–8, and 10. The run must load the files (no `Failed to resolve import`).
- **Depends on**: none.

### Task 2: Factory group in AppSidebar

- **Action**: Replace the Task 1 stubs: real `isAdminPath` predicate; `factoryNavItems` the eight pinned items. Render the Factory `SidebarGroup` in `web/components/app-sidebar.tsx` when `isAdminPath(pathname)`. Extend `shell-polish.test.tsx`’s `ui/sidebar` mock with `SidebarGroup` (spread props) and `SidebarGroupLabel`. Factory links call `closeMobileNav`.
- **Expected result**: Cases 1–9 pass. Case 10 still fails (hub dump remains).
- **Verify**: `pnpm exec vitest run web/src/__tests__/admin-path.test.ts web/src/__tests__/admin-factory-nav.test.tsx web/src/__tests__/shell-polish.test.tsx web/src/__tests__/feeds-nav.test.ts` passes. `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: Drop the hub dump

- **Action**: Remove the Factory section and `FACTORY_DIRECTORY` from `web/components/dashboard/dashboard-view.tsx`. Hub tests (case 10) should now pass.
- **Expected result**: Cases 1–10 pass. Hub is health/runs/attention only.
- **Verify**: `pnpm exec vitest run web/src/__tests__/dashboard-page.test.tsx web/src/__tests__/dashboard-home-load.test.tsx web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/admin-factory-nav.test.tsx` passes.
- **Depends on**: Task 2.

### Task 4: Gates

- **Action**: Full suite + typecheck + lint. Confirm no leftover Factory directory in `dashboard-view.tsx`, `navItems` still length 3, no `admin/layout.tsx`, no Collapsible on the Factory group.
- **Expected result**: Gates green. Factory menu lives in `AppSidebar` on Admin paths only.
- **Verify**: `pnpm test`, `pnpm typecheck`, `pnpm lint` (ignore benign `pages/` eslint-config-next warning). `git grep -n FACTORY_DIRECTORY web/` is empty.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm test`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Full vitest suite green. Admin paths show a Factory group of eight in the existing sidebar/sandwich with active state; reader paths do not; hub has no bottom link dump; no second hamburger; `navItems` remains three; typecheck clean; lint clean (ignore known `pages/` warning).

## Handoff

Builder reports: files changed; confirmation `navItems` is still three and factory destinations live in `factoryNavItems`; confirmation Factory group is Admin-path-only in `AppSidebar`; confirmation hub dump is gone; confirmation no `admin/layout.tsx` / no extra `SidebarTrigger` / no Collapsible; `pnpm test` + typecheck + lint results; any deviation and why.

## Research note

- **Codebase:** Feature 01 left `FACTORY_DIRECTORY` as a vertical `QuietNavLink` list at the bottom of `DashboardView` (`aria-label="Factory"`). `AppSidebar` maps `navItems` only. `isNavItemActive` already marks Admin on `/admin/*` and keeps reader Newsletters off `/admin/newsletters`. `shell-polish.test.tsx` mocks `@/components/ui/sidebar` **without** `SidebarGroup` — Task 2 must extend that mock.
- **shadcn (Context7 `/shadcn-ui/ui` SidebarGroup):** local `web/components/ui/sidebar.tsx` already exports `SidebarGroup` / `SidebarGroupLabel`. Docs-sidebar pattern is a labeled group of `SidebarMenuButton`s, not a Collapsible nested under a parent item. Collapsible-under-Admin would show factory children on reader paths or hide them behind a chevron — both miss the pin.
- **OpenViking (2026-08-18 plan):** Admin-context items in existing sidebar/sandwich; drop hub dump; reader stays three-item; no second hamburger. Open question was flat vs grouped — auto-picked grouped so two **Newsletters** links are not unlabeled siblings.
- **Prefix trap:** `startsWith("/admin")` alone matches `/administration`. Spec requires `=== "/admin" || startsWith("/admin/")`.
