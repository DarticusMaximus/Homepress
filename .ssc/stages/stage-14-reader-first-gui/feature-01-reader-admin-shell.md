# Feature 01: Reader / Admin shell

## Intent

Make Homepress open as a reading app: three-item reader nav, factory under Admin, a phone header that does not scroll away — so the daily verb is catch up, not operate the press.

## Spec

Invert the GUI shell. Reader nav is **Home**, **Newsletters**, **Admin** on every signed-in page. Factory pages move under `/admin/*`. No compatibility redirects from old URLs (alpha; broken bookmarks are accepted). `/issues/[runId]` stays the reader issue URL (Feature 04 owns ops-bar pathing). Home cards (Feature 02) and newsletter channels (Feature 03) are out of this feature; this feature ships stubs so the nav is not a factory leak.

### Grill-pinned decisions

| Topic | Pin |
|---|---|
| Factory URLs | Prefix `/admin/*`. Old `/feeds`, `/runs`, `/newsletters` (config), `/issues` (list), `/schedules`, `/prompts`, `/delivery`, `/settings` 404. |
| `/` | Home stub. PWA `start_url` and login `router.replace("/")` stay `/` (now Home). |
| `/admin` | Hub: today’s Dashboard minus Recent issues, plus a factory directory. Heading **Admin**. Factory tagline removed. |
| `/newsletters` | Reader stub: newsletter **names only** (no Create/Edit/Generate; names are not links). Config is `/admin/newsletters`. |
| `/issues` list | `/admin/issues`. Issue detail stays `/issues/[runId]`. |
| Nav chrome | Three items everywhere. Factory is not extra nav items. **Admin** is active on `/admin` and every `/admin/*`. |
| Phone | Sticky header: route-map **title** + sandwich (`SidebarTrigger`). Sandwich still opens the existing sheet (app name, theme, 3 links, email, log out). |
| Desktop | Left sidebar, same 3 items. Header may also be sticky+titled (simpler than a fork). |
| Issue back link | **Back to Home** → `/`. Inspect **Back to Runs** → `/admin/runs`. |

### URL map

| Today | After |
|---|---|
| `/` Dashboard | `/` Home stub |
| — | `/admin` hub |
| `/feeds` | `/admin/feeds` |
| `/newsletters` (+ `[id]` edit) | `/admin/newsletters` (+ `[id]`) |
| `/runs` (+ `[runId]/inspect`) | `/admin/runs` (+ inspect) |
| `/schedules` | `/admin/schedules` |
| `/prompts` | `/admin/prompts` |
| `/delivery` | `/admin/delivery` |
| `/settings` | `/admin/settings` |
| `/issues` (list) | `/admin/issues` |
| `/issues/[runId]` | **unchanged** |
| — | `/newsletters` reader stub |

No extra `admin/layout.tsx` is required. Nested App Router folders under `(protected)` inherit `web/app/(protected)/layout.tsx`.

### Nav + active state

`web/lib/nav-items.ts` is exactly:

- Home → `/`
- Newsletters → `/newsletters`
- Admin → `/admin`

`isNavItemActive` keeps today’s rules (exact match; `/` is exact-only; nested = `href + "/"`). That already makes Admin active on `/admin/feeds` and keeps reader Newsletters inactive on `/admin/newsletters`.

### URL helpers (single source of truth)

Prefix these builders; do not leave hardcoded factory roots beside them:

- `buildFeedsHref` → `/admin/feeds`
- `buildRunsHref` → `/admin/runs`
- `inspectRunHref` → `/admin/runs/${runId}/inspect`
- `buildDeliveryHref` → `/admin/delivery`
- `buildIssuesHref` → `/admin/issues`
- `buildNewslettersHref` in `web/components/newsletters/newsletters-pagination.tsx` → `/admin/newsletters` (config list pagination, not the reader stub)
- `buildAttentionItems` unhealthy-feeds href → `/admin/feeds?health=unhealthy` (runs/delivery already go through builders)

`revalidatePath` in moved server actions must use the new paths (`/admin/newsletters`, `/admin/newsletters/${id}`, `/admin/schedules`, `/admin/prompts`, …). `revalidateHealthCheck` in `web/components/health-card/actions.ts` must `revalidatePath("/admin")` (the hub), not `"/"`. Reader issue actions in `web/app/(protected)/issues/actions.ts` stay next to `/issues/[runId]` (Send/Publish still live on that page until Feature 04).

Factory newsletter links (Edit, Cancel, create `router.push`, schedule-row edit) use `/admin/newsletters` and `/admin/newsletters/${id}` — never the reader `/newsletters` stub.

### Admin hub

Reuse/adapt `DashboardView` (do not rebuild health/runs widgets):

1. Heading **Admin**. Remove `DASHBOARD_TAGLINE`.
2. Drop **Recent issues** (section, data fetch, `selectRecentIssues` usage on this page).
3. Keep Needs attention, Recent runs, DB + feeds health. Deep links use the prefixed helpers.
4. Add a **Factory** directory (`aria-label="Factory"`) of links, this order: Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, Settings — hrefs `/admin/feeds`, `/admin/newsletters`, `/admin/issues`, `/admin/runs`, `/admin/schedules`, `/admin/prompts`, `/admin/delivery`, `/admin/settings`.

Section order: Needs attention → Recent runs → Health strip → Factory.

Move dashboard data loading from `web/app/(protected)/page.tsx` to `web/app/(protected)/admin/page.tsx`.

### Reader stubs

- **Home** (`web/app/(protected)/page.tsx`): `<h1>Home</h1>` and copy **Issues will show up here.** No Issues table, no dashboard widgets, no redirect to Admin.
- **Newsletters** (`web/app/(protected)/newsletters/page.tsx` after the config page moves): `<h1>Newsletters</h1>`, `listNewsletters`, names as text (not links). Empty: **No newsletters yet.** Load error: existing safe pattern (Alert). No `NewslettersView` / create / edit / generate.

### Sticky header + titles

In `web/app/(protected)/layout.tsx`, the **`<header>` element itself** is `sticky top-0 z-10 bg-background` (or equivalent opaque background — content must not show through). Keep those classes on `<header>` in `layout.tsx`; a client child may render the title only. Contains `SidebarTrigger` and the page title from `pageTitleForPath(pathname)` in `web/lib/page-title.ts`. Longest-prefix map:

| Prefix | Title |
|---|---|
| `/admin/feeds` | Feeds |
| `/admin/newsletters` | Newsletters |
| `/admin/issues` | Issues |
| `/admin/runs` | Runs |
| `/admin/schedules` | Schedules |
| `/admin/prompts` | Prompts |
| `/admin/delivery` | Delivery |
| `/admin/settings` | Settings |
| `/admin` | Admin |
| `/newsletters` | Newsletters |
| `/issues` | Issue |
| `/` | Home |

Unknown paths: `Homepress` (`APP_NAME`). Match `/admin/newsletters` before `/admin` so edit URLs title **Newsletters**, not **Admin**.

## Dependencies

- Builds on: Stage 02 shell (`AppSidebar`, `nav-items`, protected layout), Stage 10 dashboard widgets, Stage 13 standalone shell (`start_url: "/"`).
- Unlocks: Feature 02 (Home cards replace the stub), Feature 03 (channels replace the names list), Feature 04 (ops bar on Admin-opened issues).

## Constraints

- Do not prefix `/issues/[runId]`. Do not add `/admin/issues/[runId]` (Feature 04).
- Do not add redirects from old factory URLs.
- Do not build Home cards, deks, or newsletter channel pages.
- Do not hide or rebuild issue ops chrome / listen (Features 04–05).
- Do not add accounts or roles (Stage 16).
- Do not add an `admin/layout.tsx` unless a test proves the protected layout does not wrap `/admin/*`.
- Factory/Admin list pages keep the Stage 03 table/card convention; do not restyle them in this feature.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] Reader nav shows only Home, Newsletters, and Admin — not Feeds, Runs, Schedules, Prompts, Delivery, Settings, Issues, or Dashboard as top-level items.
- [ ] Opening the app at `/` shows the Home stub (not the factory Dashboard).
- [ ] `/admin` shows factory health (database / feeds), recent runs, needs-attention, and reaches Feeds, newsletter config, Issues archive, Runs, Schedules, Prompts, Delivery, and Settings.
- [ ] Factory pages render at the `/admin/*` paths in the URL map; old unprefixed factory paths have no `page.tsx`.
- [ ] `/issues/[runId]` still renders the issue reader.
- [ ] On a phone-width view, after scrolling, the nav control and a page title remain visible.
- [ ] Existing factory bookmarks to unprefixed paths are not required to work (no redirects).

## Files

- Create: `web/lib/page-title.ts`
- Create: `web/app/(protected)/admin/page.tsx` (hub)
- Create: `web/src/__tests__/reader-admin-shell.test.tsx`
- Create: `web/src/__tests__/page-title.test.ts`
- Modify: `web/lib/nav-items.ts`, `web/lib/nav-active.ts` (comments only if behavior already matches)
- Modify: URL helpers: `web/components/feeds/feeds-url.ts`, `web/lib/runs-url.ts`, `web/components/runs/inspect-url.ts`, `web/components/delivery/delivery-url.ts`, `web/components/issues/issues-url.ts`, `web/components/newsletters/newsletters-pagination.tsx` (`buildNewslettersHref`), `web/lib/dashboard-data.ts`
- Modify: `web/app/(protected)/layout.tsx` — sticky opaque header + title (classes on `<header>`, not only a child)
- Modify: `web/components/app-sidebar.tsx` — still maps `navItems` (no factory extras)
- Modify: `web/components/dashboard/dashboard-view.tsx` — Admin hub composition
- Modify: `web/components/dashboard/recent-runs.tsx`, `web/components/feeds-health-card/feeds-health-card.tsx` — prefixed hrefs
- Modify: `web/components/health-card/actions.ts` — `revalidatePath("/admin")`
- Modify: `web/components/issues/issue-reader.tsx` — Back to Home → `/`
- Modify: `web/components/runs/inspect-shell.tsx` — Back to Runs → `/admin/runs`
- Modify: factory newsletter/schedule links — `web/components/newsletters/newsletters-table.tsx`, `newsletter-list-card.tsx`, `newsletter-edit-form.tsx`, `newsletter-form-dialog.tsx`, `web/components/schedules/schedules-table.tsx`, `schedule-list-card.tsx` (and `schedule-edit-dialog.tsx` if it links to edit)
- Move: factory `page.tsx` / `actions.ts` from `web/app/(protected)/{feeds,newsletters,runs,schedules,prompts,delivery,settings}/` and `issues/page.tsx` → `web/app/(protected)/admin/...`. Keep `web/app/(protected)/issues/[runId]/page.tsx` and `web/app/(protected)/issues/actions.ts`.
- Replace: `web/app/(protected)/page.tsx` with Home stub; new reader `web/app/(protected)/newsletters/page.tsx` after the config move (Task 5).
- Sweep: remaining hardcoded factory hrefs and action import paths in `web/components/**` and `web/src/__tests__/**` (including `revalidatePath` assertions).
- Tests to update: `nav-active.test.ts`, `shell-polish.test.tsx`, `dashboard-page.test.tsx`, `dashboard-widgets.test.tsx`, `dashboard-data.test.ts`, `dashboard-home-load.test.tsx`, `feeds-health-pagination.test.tsx`, `delivery-page.test.tsx`, `issue-reader.test.tsx`, `inspect-entry.test.tsx`, `newsletters-actions.test.ts`, `newsletters-edit-deeplink.test.tsx`, `newsletters-edit-redirect.test.ts`, `newsletter-edit-structure.test.tsx`, `newsletter-edit-app-public-url.test.tsx`, `schedules-responsive-list.test.tsx`, plus any other test that imports old action/page paths. Full suite is the gate (`pnpm test`).

## Testing approach

Test-first for nav, URL helpers, page titles, hub composition, and stubs. Route-file moves are verified with `existsSync` (same pattern as `shell-polish` design-system check) against the **full URL map**, not a sample. Sticky header: source-read `layout.tsx` for `sticky`, opaque `bg-background` (or equivalent), and title mount on the `<header>` element; `pageTitleForPath` is unit-tested.

Do not `import` `web/app/(protected)/layout.tsx` in vitest (Stage 12 pin: layout/globals). Source-read it.

### Test cases (`reader-admin-shell.test.tsx` + `page-title.test.ts` + existing files)

1. **`navItems`** — length 3; titles Home / Newsletters / Admin; hrefs `/`, `/newsletters`, `/admin`. No Feeds/Runs/Dashboard/Issues in the array.
2. **Admin active** — `isNavItemActive("/admin/feeds", "/admin")` true; `isNavItemActive("/admin", "/admin")` true; `isNavItemActive("/newsletters", "/admin")` false.
3. **Reader Newsletters not active on config** — `isNavItemActive("/admin/newsletters", "/newsletters")` false; `isNavItemActive("/newsletters", "/newsletters")` true.
4. **Home exact-only** — `isNavItemActive("/admin", "/")` false.
5. **Helpers** — `buildFeedsHref({}) === "/admin/feeds"`; inspect, runs, delivery, issues list, `buildNewslettersHref(1) === "/admin/newsletters"`, attention unhealthy-feeds all `/admin/...`.
6. **URL-map `existsSync`** — after Task 3, **false** at the old roots and **true** at the admin counterparts for every factory row: `feeds/page.tsx`, `newsletters/page.tsx`, `newsletters/[id]/page.tsx`, `runs/page.tsx`, `runs/[runId]/inspect/page.tsx`, `schedules/page.tsx`, `prompts/page.tsx`, `delivery/page.tsx`, `settings/page.tsx`, `issues/page.tsx` (list). **True** throughout: `issues/[runId]/page.tsx`. After Task 5, reader `newsletters/page.tsx` is **true** again (stub); `newsletters/[id]/page.tsx` remains only under `admin/`.
7. **Hub composition** — Dashboard/Admin view: Needs attention → Recent runs → Health strip → Factory; no Recent issues heading; heading Admin; factory links href `/admin/feeds` etc.
8. **Home stub** — render Home page component (or a `HomeStub` extract): heading Home; text “Issues will show up here.”; no “Needs attention” / health cards.
9. **Newsletters stub** — names render as text, not links; no Create/Generate; empty copy when list is empty.
10. **`pageTitleForPath`** — table above; `/admin/newsletters/nl-1` → Newsletters; `/issues/run-1` → Issue; unknown → Homepress.
11. **Layout source-read** — `web/app/(protected)/layout.tsx` `<header>` class string includes `sticky` **and** `bg-background` (or another opaque background class). Renders `SidebarTrigger` and a title (page-title helper or equivalent). Sticky/opaque classes are on `<header>`, not only a child.
12. **Back links** — issue reader “Back to Home” href `/`; inspect “Back to Runs” href `/admin/runs`.
13. **Sidebar still closes on mobile nav** — `shell-polish` Home click (not Dashboard); three items not nine.
14. **Health revalidate** — source-read `web/components/health-card/actions.ts`: `revalidatePath("/admin")` present; `revalidatePath("/")` absent.

**Not required:** pixel screenshots, real phone scroll in CI, HTTP 404 integration against a running server.

## Tasks

### Task 1: Failing tests for nav, helpers, and titles

- **Action**: Add cases 1–5 and 10 in `web/src/__tests__/reader-admin-shell.test.tsx` and `web/src/__tests__/page-title.test.ts`. Update `nav-active.test.ts` Dashboard `/` describe to Home; nested `/newsletters/nl-1` must not be required to activate reader Newsletters (config lives under `/admin/newsletters`). Point helper tests (`feeds-health-pagination`, `dashboard-data`, `delivery-page`) at `/admin/...` expectations so they fail on current builders. Assert `buildNewslettersHref(1) === "/admin/newsletters"` (export the helper from `newsletters-pagination.tsx` if needed). Do not move pages yet.
- **Expected result**: New tests fail because nav still has 9 items and helpers still emit `/feeds` etc. Failures are assertion mismatches, not harness errors.
- **Verify**: `pnpm exec vitest run web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/page-title.test.ts web/src/__tests__/nav-active.test.ts` fails on nav length / hrefs / missing `pageTitleForPath`.
- **Depends on**: none.

### Task 2: Nav items, titles helper, and URL builders

- **Action**: Implement `web/lib/nav-items.ts` (3 items), `web/lib/page-title.ts`, and prefix the URL helpers listed in Spec (including `buildNewslettersHref`). Update `shell-polish.test.tsx` nav length and Dashboard → Home click. Leave routes where they are so Task 3 can move them.
- **Expected result**: Cases 1–5 and 10 pass. App still serves old paths until Task 3 (acceptable mid-feature).
- **Verify**: `pnpm exec vitest run web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/page-title.test.ts web/src/__tests__/nav-active.test.ts web/src/__tests__/shell-polish.test.tsx web/src/__tests__/dashboard-data.test.ts web/src/__tests__/feeds-health-pagination.test.tsx` — nav/title/helper cases green. `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: Move factory App Router modules under `/admin`

- **Action**: Move factory `page.tsx` / `actions.ts` per Files (including `newsletters/[id]/page.tsx` and `runs/[runId]/inspect/page.tsx`). Keep issue reader + `issues/actions.ts`. Leave the Admin hub page for Task 5 (domain pages only here). Update every `@/app/(protected)/…/actions` import and `revalidatePath` to the new locations. Update in-page redirects in the moved newsletters page (`?edit=` and pagination clamp) to `/admin/newsletters/...`. Add case 6 (`existsSync` full URL map; `newsletters/page.tsx` is false until Task 5) to `reader-admin-shell.test.tsx`.
- **Expected result**: Factory UI loads at `/admin/feeds` etc. Old factory `page.tsx` files are gone (including config `newsletters/page.tsx` and `[id]`). Issue reader path unchanged. Action and deeplink tests import the new paths and assert `/admin/newsletters`.
- **Verify**: Case 6 passes for the factory map. `pnpm exec vitest run web/src/__tests__/newsletters-actions.test.ts web/src/__tests__/newsletters-edit-deeplink.test.tsx web/src/__tests__/newsletters-edit-redirect.test.ts web/src/__tests__/newsletter-edit-app-public-url.test.tsx web/src/__tests__/settings-actions.test.ts web/src/__tests__/prompts-actions.test.ts web/src/__tests__/schedules-actions.test.ts` pass. `pnpm typecheck` passes.
- **Depends on**: Task 2.

### Task 4: Href sweep + back links

- **Action**: Replace remaining hardcoded factory hrefs. Named files: `feeds-health-card.tsx`, `recent-runs.tsx`, `newsletters-table.tsx`, `newsletter-list-card.tsx`, `newsletter-edit-form.tsx` (Cancel → `/admin/newsletters`), `newsletter-form-dialog.tsx` (`router.push` → `/admin/newsletters/${id}`), `schedules-table.tsx`, `schedule-list-card.tsx`, inspect back, issue back, pagination tests. Issue reader: label **Back to Home**, href `/`. Inspect: **Back to Runs** → `/admin/runs`. Update `issue-reader.test.tsx`, `inspect-entry.test.tsx`, `newsletter-edit-structure.test.tsx`, `schedules-responsive-list.test.tsx`, `shell-polish` hit-target names.
- **Expected result**: Factory links use `/admin/...`. Reader `/newsletters` is not used as a config/edit URL. Reader issue URL `/issues/${id}` is unchanged.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-reader.test.tsx web/src/__tests__/inspect-entry.test.tsx web/src/__tests__/dashboard-widgets.test.tsx web/src/__tests__/feeds-nav.test.ts web/src/__tests__/newsletter-edit-structure.test.tsx web/src/__tests__/schedules-responsive-list.test.tsx` pass. Grep of `web/components` for `href="/feeds"`, `href="/runs"`, `href="/settings"`, `href="/delivery"`, `href="/schedules"`, `href="/prompts"`, `href="/issues"` (exact list, not `/issues/`), and `` `/newsletters/${ `` returns none. `href="/newsletters"` may remain only as the reader nav item in `nav-items.ts` / `app-sidebar.tsx`.
- **Depends on**: Task 3.

### Task 5: Admin hub + reader stubs

- **Action**: Implement Admin hub in `admin/page.tsx` + `dashboard-view.tsx` per Spec (drop Recent issues, add Factory directory, heading Admin). Replace `(protected)/page.tsx` with the Home stub. Add reader Newsletters stub page (`newsletters/page.tsx` exists again; `[id]` stays under admin only). Change `web/components/health-card/actions.ts` to `revalidatePath("/admin")`. Update `dashboard-page.test.tsx` / `dashboard-home-load.test.tsx` to the new composition and load target. Cases 7–9 and 14 in `reader-admin-shell.test.tsx`. Case 6: reader stub `newsletters/page.tsx` is now true.
- **Expected result**: `/` is Home stub; `/newsletters` is names-only; `/admin` is the factory hub; health Re-run refreshes `/admin`.
- **Verify**: `pnpm exec vitest run web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/dashboard-page.test.tsx web/src/__tests__/dashboard-home-load.test.tsx web/src/__tests__/dashboard-widgets.test.tsx` pass. Case 14 source-read of `health-card/actions.ts` shows `/admin` not `/`.
- **Depends on**: Task 4.

### Task 6: Sticky phone header

- **Action**: Sticky opaque header + title in `web/app/(protected)/layout.tsx`. Put `sticky top-0 z-10 bg-background` on the `<header>` element. Client child may render the title only. Case 11 source-read. Do not change listen or issue ops chrome.
- **Expected result**: Header stays on screen while page content scrolls and does not show page content through it; title matches `pageTitleForPath`.
- **Verify**: Case 11 passes (`sticky` and opaque background on `<header>`). `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 5.

## Feature verification

- Run: `pnpm test`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Full vitest suite green (not a cherry-picked file list). Nav is Home / Newsletters / Admin; factory lives under `/admin/*` (case 6 full map); `/` is the Home stub; `/newsletters` is names-only; `/admin` is the hub without Recent issues; `/issues/[runId]` still exists; helpers and back links use prefixed factory URLs; `revalidateHealthCheck` targets `/admin`; header is sticky and opaque with a route title; typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning).

## Handoff

Builder reports: files moved/created; confirmation old factory `page.tsx` paths are gone (full URL map) and reader `newsletters/page.tsx` stub exists; confirmation `/issues/[runId]` and `issues/actions.ts` stayed; confirmation no redirects were added; nav is three items; hub composition; stub copy; sticky opaque header; `revalidateHealthCheck` → `/admin`; `pnpm test` + typecheck + lint results; any deviation and why.

## Research note

- **Codebase (codegraph `AppSidebar` / `nav-items` / protected `layout.tsx`):** nine-item sidebar; header is non-sticky `h-14` + `SidebarTrigger` only; `/` is `DashboardView`. `revalidateHealthCheck` currently `revalidatePath("/")`. `buildNewslettersHref` is a local function in `newsletters-pagination.tsx` emitting `/newsletters`.
- **Next.js App Router (Context7 `/vercel/next.js` nested routes):** folders define URL segments; a parent `layout.tsx` is optional — `(protected)/layout.tsx` already wraps `/admin/*`.
- **PM grill (2026-08-14):** prefix `/admin/*` (break old links); 3-item nav; phone sticky title + sandwich; desktop sidebar; Admin hub = dashboard minus Recent issues + directory; Home/Newsletters stubs; Back to Home.
- **Grizzled Senior (2026-08-14):** full URL-map `existsSync`; factory newsletter hrefs first-class; health revalidate `/admin`; `pnpm test` as gate; opaque header on `<header>`.
