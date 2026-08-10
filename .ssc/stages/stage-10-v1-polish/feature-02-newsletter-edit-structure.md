# Feature 02: Newsletter edit structure

## Intent

Replace the overloaded newsletter edit dialog with a dedicated edit page organized into clear tabs (Basics, Advanced, Schedule, Delivery, Feeds), and slim create to a Basics-only dialog that lands on that page — so operators can reach every config area without endless scroll or accidental outside-click dismiss.

## Spec

### Surfaces (pinned)

| Surface | Behavior |
|---------|----------|
| **Create** | Stay a **Dialog** on `/newsletters`. **Basics only** (name, topics, disliked topics, audience, item count, date range, lookback). No tabs. No model overrides, schedule, delivery, or feeds. |
| **Edit** | Full page at **`/newsletters/[id]`** (not a dialog). Five tabs. No outside-click dismiss. Browser Back / **Back to Newsletters** / **Cancel** return to the list. |

### Edit tabs (pinned order)

1. **Basics** — name, topics, disliked topics, audience, item count, date range, lookback  
2. **Advanced** — per-newsletter **Model overrides** only (tagger / scorer / drafter / embedder free-text; blank = global). Internal heading: **Model overrides**. Feature 03 will add a **Drafter prompt** block under the same Advanced tab — do **not** implement that UI here; leave room conceptually (no stub required).  
3. **Schedule** — shared `ScheduleFields` (+ next-fire line as Feature 01 defines). Edit-only.  
4. **Delivery** — recipients, auto-email, auto-RSS, RSS URL copy (same fields as today). Edit-only.  
5. **Feeds** — existing `NewsletterFeedsSection` (attach/detach). Edit-only.

**Default tab:** Basics on every open (create redirect and list Edit). Do not remember last tab.

**Create tab set:** N/A — flat Basics form.

### Save / Feeds / Cancel (pinned)

- One form for Basics + Advanced + Schedule + Delivery with a **Cancel / Save changes** footer visible while on any of those tabs (and while on Feeds for Cancel consistency — Save may be hidden or disabled on Feeds-only if Feeds sits outside the `<form>`; prefer: footer always visible; Save submits the definition form; Feeds actions remain separate buttons).
- **Cancel (pinned):** navigates to `/newsletters` **without saving** (same destination as Back / “Back to Newsletters”). No unsaved-changes guard / confirm dialog required.
- Switching tabs does **not** auto-save.
- **Critical FormData pin:** inactive tab panels must stay **mounted** in the DOM (Radix `TabsContent` `forceMount` + hide inactive, or equivalent) so fields on non-active tabs still submit. Same class of bug as Feature 01’s collapsed-Advanced cron pin.
- **Feeds** attach/detach stay **immediate** via existing actions (not part of Save) — same semantics as today.
- Validation failures → toast error as today. Jumping to the tab that owns the bad field is **optional**, not required.

### Edit page scroll / reachability (pinned)

- The edit page must remain **fully reachable** inside the app shell: the active tab’s content and the Cancel/Save footer must be reachable by scrolling the page (or a dedicated scroll region) — do **not** reintroduce the Stage 08 / Plan.md carry-forward overflow bug where lower content is trapped off-screen with no scroll.
- Prefer normal document/main scroll over a nested max-height trap unless the shell already requires an inner scroller; if an inner scroller is used, it must include both tab content and the footer.

### Create → edit redirect (pinned)

1. `createNewsletter` already returns `Newsletter` with `$id`. Change `createNewsletterAction` so success is `{ ok: true; newsletterId: string }` (extend `NewsletterActionResult` accordingly; failure unchanged).
2. Create dialog on success: toast, close dialog, `router.push(`/newsletters/${newsletterId}`)`.
3. Create UI must **not** collect or submit model override fields (repository defaults remain empty strings).

### Routing & deep links (pinned)

- **Edit route:** `web/app/(protected)/newsletters/[id]/page.tsx` — load newsletter by id + feed context + `appPublicUrl`; `notFound()` (or clear not-found UI) when missing.
- **List Edit** (table + cards): navigate to `/newsletters/[id]` (Link or `router.push`) — **remove** edit dialog from the list.
- **Schedules** links currently `href={`/newsletters?edit=${id}`}` (`schedules-table.tsx`, `schedule-list-card.tsx`) → change to `/newsletters/${id}`.
- **Compat:** `/newsletters?edit=<id>` on the list page should **`redirect(`/newsletters/${id}`)`** when `edit` is present (keeps old bookmarks / tests migratable). Remove dialog-open-on-`initialEditId` behavior and the `resolveNewsletterEditTarget` dialog path once redirect is in place (helper may be deleted or reduced to unused — prefer delete + update tests).
- Revalidate `/newsletters/[id]` (and keep `/newsletters`, `/schedules`) on update / attach / detach success.
- **Nav highlight:** Newsletters sidebar item stays active on `/newsletters/[id]` (fix shell `pathname` matching if it only exact-matches `/newsletters`). Active match must treat `/newsletters` and any path under `/newsletters/` as active — e.g. `pathname === "/newsletters" || pathname.startsWith("/newsletters/")` (or shared helper). Cover with a unit/assert on that helper or on the nav component’s active class for a `/newsletters/<id>` pathname.

### Out of scope

- Per-newsletter drafter prompt override UI / `{audience}` wiring (Feature 03).
- Schedule builder internals (Feature 01) — consume `ScheduleFields` as it exists when this feature runs.
- Changing schedule / delivery / definition write order or validation rules.
- Schema / Appwrite collection changes.
- Moving Schedules’ own `ScheduleEditDialog` to a page.

### Research notes (shaped decisions)

- Current edit is `NewsletterFormDialog` with one scroll + sections; Feeds already outside the form with immediate attach/detach (`newsletter-feeds-section.tsx`).
- Stage open question “tabs vs accordion” → **tabs**; PM confirmed phone fit with five short labels; scrollable `TabsList` as safety net (`overflow-x-auto`).
- Existing deep-link `?edit=` + `newsletters-edit-deeplink.test.tsx` must migrate to the page route.
- Feature 01 still mentions `NewsletterFormDialog` for schedule — this feature moves Schedule onto the edit **page**; update that consumer accordingly when both land (order-independent: whichever runs second adapts).

## Dependencies

- Builds on: Stage 03 newsletter form + feeds attach UI; Stage 07 model overrides; Stage 08 `ScheduleFields` / schedule on newsletter edit; Stage 09 delivery fields on newsletter edit; Stage 10 Feature 01 schedule builder (shared `ScheduleFields` — may land before or after; consume current API).
- Or: None that block starting — Feature 01 is not a hard prerequisite.

## Constraints

- Do **not** change Appwrite schema or repository field semantics.
- Do **not** change attach-only-if-ok / feed detach rules.
- Keep FormData field **names** used by `updateNewsletterAction` / `createNewsletterAction` (`name`, `topicsJson`, `dislikedTopicsJson`, `audience`, `newsItems`, `dateRange`, `lookback`, model keys, schedule + delivery names).
- Create remains dialog; edit must not remain a dialog.
- No sixth tab in this feature; Advanced holds models only until Feature 03.
- Responsive: tab strip must remain usable at phone width (fit or horizontal scroll — do not wrap into unusable multi-row chips).
- Edit page content + Cancel/Save footer must remain scroll-reachable (see scroll pin above) — clears the Plan.md newsletter-edit overflow carry-forward for this surface.

## Acceptance criteria

- [ ] Edit opens at `/newsletters/[id]` with tabs Basics · Advanced · Schedule · Delivery · Feeds; default Basics.
- [ ] Create dialog is Basics-only; success navigates to the new newsletter’s edit page.
- [ ] Save from a non-Basics tab still persists fields from other tabs (mounted FormData pin).
- [ ] Cancel on the edit page navigates to `/newsletters` without saving (no unsaved guard).
- [ ] Edit page tab content and footer are scroll-reachable (no trapped overflow).
- [ ] Feeds attach/detach still work immediately and are not gated on Save.
- [ ] List Edit and Schedules “newsletter” links go to `/newsletters/[id]`; `?edit=` redirects to that route.
- [ ] Newsletters nav stays highlighted on `/newsletters/[id]` (asserted via active-match helper or nav test).
- [ ] No edit dialog remains on the list for editing (create dialog only).
- [ ] Existing schedule / delivery / model override persistence behavior unchanged aside from surface move + create no longer sending models.

## Files

- Create: `web/app/(protected)/newsletters/[id]/page.tsx`
- Create: `web/components/newsletters/newsletter-edit-form.tsx` (client: tabs + form; name may vary — document in handoff)
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx` — create-only Basics dialog (or split create component; delete edit mode)
- Modify: `web/app/(protected)/newsletters/actions.ts` — create returns `newsletterId`; revalidate edit path
- Modify: `web/components/newsletters/newsletters-table.tsx` — Edit → Link to `/newsletters/[id]`; remove edit dialog
- Modify: `web/components/newsletters/newsletter-list-card.tsx` — Edit → navigate/link
- Modify: `web/components/newsletters/newsletters-view.tsx` — drop `initialEditId` / edit-dialog props
- Modify: `web/app/(protected)/newsletters/page.tsx` — `?edit=` → `redirect`; drop dialog deep-link resolve
- Modify: `web/components/schedules/schedules-table.tsx` — href `/newsletters/${id}`
- Modify: `web/components/schedules/schedule-list-card.tsx` — href `/newsletters/${id}`
- Modify: shell nav active matching (e.g. `web/components/...` sidebar / app-shell — locate via codegraph) so `/newsletters/[id]` highlights Newsletters
- Delete or gut: `web/lib/newsletters/resolve-edit-target.ts` if unused after redirect
- Modify tests:
  - `web/src/__tests__/newsletters-edit-deeplink.test.tsx` → page route / redirect
  - `web/src/__tests__/newsletter-form-schedule.test.tsx`
  - `web/src/__tests__/newsletter-form-delivery.test.tsx`
  - `web/src/__tests__/newsletter-form-model-overrides.test.tsx`
  - `web/src/__tests__/schedules-responsive-list.test.tsx` (href)
  - Create: `web/src/__tests__/newsletter-edit-structure.test.tsx` (tabs + create redirect + cross-tab save)
- Optional: extract shared Basics field group used by create dialog + Basics tab

## Testing approach

Test-first for structure and redirect; update existing form tests to the new surfaces.

**`newsletter-edit-structure.test.tsx` (web):**

1. Edit form renders five tab triggers with labels Basics, Advanced, Schedule, Delivery, Feeds; default selected is Basics.
2. Switching to Advanced / Schedule / Delivery / Feeds shows that panel’s landmark content (e.g. “Model overrides”, schedule enable, recipients, Feeds section).
3. Cross-tab Save: with Basics name changed and Schedule tab active, submit includes both `name` and schedule fields (assert FormData or action mock args) — proves mounted inactive tabs.
4. Create dialog: no model override inputs; no Schedule/Delivery/Feeds; on successful action with `newsletterId`, `router.push` called with `/newsletters/<id>`.
5. List Edit control is a link (or navigates) to `/newsletters/<id>` — no `NewsletterFormDialog` in edit mode.
6. Cancel on edit form navigates to `/newsletters` (assert `Link` href or `router.push`).
7. Nav active-match: helper or nav component marks Newsletters active for pathname `/newsletters/nl-1` (and still for `/newsletters`).

**Update existing:**

- Schedule / delivery / model override tests target the edit-page form component instead of edit-mode dialog.
- Deeplink tests: `?edit=` redirect behavior and/or direct render of edit page; remove “opens dialog” assertions.
- Schedules list href assertions → `/newsletters/${id}`.

**Not test-first for:** exact pixel scroll of tab strip or overflow layout — verifier checks (1) `overflow-x-auto` (or equivalent) on `TabsList`, (2) edit page layout does not use a non-scrolling max-height trap that hides the footer (inspect classes / structure in review). Phone-width smoke optional; note in handoff if skipped.

## Tasks

### Task 1: Failing tests for edit structure + create redirect

- **Action:** Add `web/src/__tests__/newsletter-edit-structure.test.tsx` covering the Testing approach cases (tabs, cross-tab FormData, create Basics-only + redirect, Cancel → `/newsletters`, nav active-match for `/newsletters/[id]`). Update deeplink / schedules href tests to expect `/newsletters/[id]` and redirect-from-`?edit=` (they may fail until later tasks).
- **Expected result:** New/updated tests exist and fail against current dialog-only UI.
- **Verify:** `pnpm --filter web exec vitest run src/__tests__/newsletter-edit-structure.test.tsx` (and deeplink test) — failures show missing page/tabs/redirect/nav match.
- **Depends on:** none.

### Task 2: Edit route + tab shell + forceMount + footer

- **Action:** Add `web/app/(protected)/newsletters/[id]/page.tsx` loading newsletter + feeds + `appPublicUrl` (`notFound()` when missing). Implement client `newsletter-edit-form.tsx` with shadcn Tabs (Basics · Advanced · Schedule · Delivery · Feeds), default Basics, Back link to `/newsletters`, **force-mounted** tab panels (landmark placeholders / empty panels OK), phone-friendly tab list (`overflow-x-auto` / `w-full`), and footer **Cancel** (navigate to `/newsletters`, no save) + **Save** wired to `updateNewsletterAction`. Ensure page scroll reachability per the scroll pin (no trapped overflow). Do **not** fully migrate all field groups yet — shell + mount + footer only.
- **Expected result:** Visiting `/newsletters/<valid-id>` shows five tabs, force-mounted panels, Cancel/Save footer; invalid id → not found; page scrolls so footer stays reachable.
- **Verify:** Tab-label / default-Basics / Cancel tests from Task 1 pass or partially pass; `pnpm typecheck` clean for new files; verifier confirms forceMount and scroll pin in structure.
- **Depends on:** Task 1.

### Task 3: Move field groups into tabs + cross-tab Save

- **Action:** Move real field groups from the current edit dialog into the tab panels: Basics fields; Advanced = model overrides with **Model overrides** heading; Schedule = `ScheduleFields`; Delivery = recipients / auto toggles / RSS URL; Feeds tab = `NewsletterFeedsSection`. Prove cross-tab Save (inactive tabs still submit). Keep create dialog untouched in this task if still shared — prefer extracting shared Basics fields without breaking list create yet.
- **Expected result:** Edit page has full field content per tab; cross-tab FormData Save test passes.
- **Verify:** `pnpm --filter web exec vitest run src/__tests__/newsletter-edit-structure.test.tsx` — cross-tab Save and tab landmark content cases pass; schedule/delivery/model-override tests updated to edit form or still failing until Task 5 wiring — prefer updating them here if they target the edit form.
- **Depends on:** Task 2.

### Task 4: Slim create dialog + action returns id

- **Action:** Make `NewsletterFormDialog` create-only (or replace with `newsletter-create-dialog.tsx`): Basics fields only. Extend `NewsletterActionResult` / `createNewsletterAction` to return `{ ok: true; newsletterId }` from `createNewsletter(...).$id`. On success: toast, close, `router.push(`/newsletters/${id}`)`. Stop reading model fields on create.
- **Expected result:** Add newsletter → Basics dialog → lands on edit page.
- **Verify:** Create cases in `newsletter-edit-structure.test.tsx` pass; `web/src/__tests__/newsletters-actions.test.ts` updated for new success shape.
- **Depends on:** Task 3.

### Task 5: List, Schedules, deeplink, nav, revalidate

- **Action:** Wire list Edit (table + card) to `/newsletters/[id]`; remove edit dialog usage. Change Schedules hrefs. On `/newsletters` page, if `searchParams.edit` present → `redirect(`/newsletters/${edit}`)`. Delete unused `resolve-edit-target` / `initialEditId` plumbing. Revalidate edit path from update/attach/detach. Fix Newsletters nav active state for nested edit route (pathname prefix match) and ensure the Task 1 nav active-match assert passes. Update remaining tests (schedule/delivery/model-overrides/deeplink/schedules-responsive-list).
- **Expected result:** No edit dialog; all entry points hit the page; old `?edit=` bookmarks redirect; nav highlight works on edit.
- **Verify:** Updated deeplink + schedules href + nav active-match tests pass; grep shows no `/newsletters?edit=` in `web/` source (except redirect handler).
- **Depends on:** Task 4.

### Task 6: Feature gate

- **Action:** Run full verification commands; fix fallout. Confirm Feature 01 consumer notes if `NewsletterFormDialog` edit mode is gone (Schedule lives on edit page). Spot-check scroll reachability and Cancel behavior against pins.
- **Expected result:** All gates green; handoff lists files and any deviation.
- **Verify:** `pnpm test && pnpm typecheck && pnpm lint` — all zero (ignore benign `pages/` eslint warning).
- **Depends on:** Task 5.

## Feature verification

- Run: `pnpm --filter web exec vitest run src/__tests__/newsletter-edit-structure.test.tsx src/__tests__/newsletters-edit-deeplink.test.tsx src/__tests__/newsletter-form-schedule.test.tsx src/__tests__/newsletter-form-delivery.test.tsx src/__tests__/newsletter-form-model-overrides.test.tsx src/__tests__/schedules-responsive-list.test.tsx && pnpm test && pnpm typecheck && pnpm lint`
- Expected: All listed tests pass; typecheck/lint clean; create → edit page → five tabs reachable; Save from Schedule persists Basics changes; Cancel returns to list without save; Feeds attach without Save; Newsletters nav active on `/newsletters/[id]`; edit page footer remains scroll-reachable.

## Handoff

Builder reports: files created/modified/deleted; create success result shape; how forceMount was implemented; how scroll reachability was ensured; Cancel behavior; whether nav matching needed a fix (and the assert used); confirmation Feature 03 can add Drafter prompt under Advanced without a new tab; any deviation from this spec and why.
