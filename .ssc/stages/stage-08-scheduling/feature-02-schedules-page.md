# Feature 02: Schedules page

## Intent

Give the operator a top-level Schedules destination that lists every newsletter’s schedule (enable state and next fire) on the shared responsive list pattern, and lets them edit the schedule from that list — so schedule operability is visible and adjustable without digging through definition dialogs alone.

## Spec

Replace the `/schedules` placeholder with a real Schedules list page. This feature owns the **Schedules GUI**, a **schedule edit dialog** on that page (one of the two Stage 08 edit surfaces), and a **deep-link into newsletter edit**. It does **not** add schedule fields to the newsletter definition form or fix newsletter-edit scroll (Feature 03), and it does **not** implement the worker due-check (Feature 04).

### Data contract (from Feature 01 — do not re-litigate)

| Source | Use |
|--------|-----|
| `listNewsletters(client)` | Load all newsletters (same V1 fetch-all + in-memory page pattern as Newsletters/Runs). |
| `toNewsletterScheduleView(newsletter, now?)` | Derive `enabled`, `cron`, `timezone`, `nextFireAt` for display. |
| `updateNewsletterSchedule(client, id, input)` | Persist schedule changes from the Schedules edit dialog. |

Assume Feature 01 is verified: `Newsletter` exposes `scheduleEnabled` / `scheduleCron` / `scheduleTimezone`, and the helpers above are exported from `@newsletter/shared`.

### Nav

`web/lib/nav-items.ts` already includes **Schedules** → `/schedules` with `CalendarClock`. **Do not** reorder nav. Extend `web/src/__tests__/feeds-nav.test.ts` to assert Schedules → `/schedules` (title order already pinned).

### GUI — `/schedules`

Replace `web/app/(protected)/schedules/page.tsx` (server component). Mirror Issues/Runs/Newsletters chrome.

**Page chrome (locked):**

- Heading: **Schedules**
- Supporting line: `Per-newsletter cron schedules — enable state and next fire.`

**Load:**

- `listNewsletters(getServerAppwrite())`.
- Map each newsletter through `toNewsletterScheduleView` on the server (pass a single `now = new Date()` for the request so next-fire is consistent across the page).
- **Sort (in memory):** `name` ascending via `localeCompare`, then `$id` ascending for stability.
- **Pagination:** 20 per page (`?page=`), same clamp / redirect-to-last-page pattern as Newsletters. Empty state only when total is zero, not when a high page is empty.
- **No status filter** in this feature (list every newsletter; disabled rows still appear with next fire `—`).

**List** — use shared `ResponsiveList` (table `md+`, stacked cards below `md`). Same fields and actions in both presentations. Empty state is **not** wrapped in `ResponsiveList`.

| Column / field | Content |
|----------------|---------|
| Newsletter | `newsletter.name` (primary title) |
| Status | Badge: **Enabled** when `schedule.enabled`; **Disabled** otherwise |
| Cron | `schedule.cron` when non-empty; else **—**. Monospace / `font-mono` when showing a cron string. |
| Timezone | `schedule.timezone` (always show; Feature 01 defaults missing to `UTC`) |
| Next fire | Locale short **datetime** from `schedule.nextFireAt` when non-null; else **—** (disabled or no next). Use `dateStyle: "short"` + `timeStyle: "short"`. |
| Actions | **Edit schedule** (opens dialog) + **Edit newsletter** (link) — labels locked |

**Status Badge map** (existing Badge variants only):

| State | Badge label | Variant |
|-------|-------------|---------|
| Enabled | `Enabled` | `default` |
| Disabled | `Disabled` | `secondary` |

**Empty state** (locked, when total newsletters === 0):

`No newsletters yet. Create a newsletter first, then set its schedule here.`

**Load errors:** destructive `Alert` with safe message (mirror Newsletters), log server-side without secrets.

**No auto-poll / live refresh.** No create/delete newsletter from this page. No run trigger. No worker / due-check UI.

### Edit schedule (Schedules edit surface)

Each row/card exposes **Edit schedule** opening a dialog owned by this feature.

**Pre-fill (required):** When the dialog opens for a newsletter, seed the three fields from that row’s current schedule — `scheduleEnabled`, `scheduleCron`, and `scheduleTimezone` from the underlying `Newsletter` (or the equivalent fields on `toNewsletterScheduleView`: `enabled` / `cron` / `timezone`). Re-seed whenever a different row opens the dialog (do not leave stale values from a previous edit). A blank dialog for an already-configured schedule is a bug.

**Dialog fields:**

| Field | Control | Notes |
|-------|---------|-------|
| Enable schedule | Checkbox (or Switch if already used elsewhere for booleans — prefer Checkbox to match existing form density) | Maps to `scheduleEnabled` |
| Cron expression | Text input, monospace | 5-field crontab; placeholder e.g. `0 9 * * 1-5` |
| Timezone | Text input | IANA id; placeholder `America/New_York` or `UTC` |

**Save path:**

- Server action (e.g. `updateNewsletterScheduleAction`) in `web/app/(protected)/schedules/actions.ts` (or co-located under newsletters actions if cleaner — prefer `schedules/actions.ts` so Feature 03 can add its own newsletter-side action later without merge noise).
- Call `updateNewsletterSchedule(getServerAppwrite(), id, { scheduleEnabled, scheduleCron, scheduleTimezone })`.
- On `NewsletterRepositoryError` `validation` / `not_found` / `appwrite`: return safe `ok: false` + `error` message (do not leak secrets).
- On success: toast **Schedule updated**; close dialog; `revalidatePath("/schedules")` (and `/newsletters` if the deep-link surface might show stale data — optional; at minimum revalidate `/schedules`).

**Validation UX:** Prefer server-side Feature 01 validation as the source of truth. Show the returned error via toast (and optionally inline under the dialog). Do **not** reimplement cron-parser rules in the web package.

**Help copy under cron** (locked, muted): `Five fields: minute hour day-of-month month day-of-week. Example: 0 9 * * 1-5`

### Link to newsletter edit (deep-link)

Stage AC requires linking into newsletter edit. Today edit is a dialog on `/newsletters` (no `/newsletters/[id]`).

**Pin:**

1. **Edit newsletter** on each Schedules row/card is a `Link` to `/newsletters?edit=<newsletterId>` (label locked: **Edit newsletter**).
2. Extend the Newsletters page lightly so the deep-link works:
   - Parse `edit` from `searchParams` in `web/app/(protected)/newsletters/page.tsx`.
   - Pass `initialEditId` into `NewslettersView` → **`NewslettersTable`** (where `editTarget` / `NewsletterFormDialog` live today — do not only wire `NewslettersView` chrome without reaching the table’s edit state).
   - When that id matches a newsletter **on the current page**, open the existing `NewsletterFormDialog` in edit mode on mount (same dialog Feature 03 will extend).
   - If the id is missing from the current page (wrong page / unknown id): do **not** error loudly — leave dialog closed; optional no-op is fine for V1 (operator can change page). Do **not** invent a new `/newsletters/[id]` route in this feature.

Feature 03 will add schedule fields + scroll fix inside that same edit dialog; this feature only ensures the link opens it.

### Display helper (optional but preferred)

If locale formatting is shared across table/cards, add a tiny pure helper (web or shared):

```ts
formatScheduleNextFireAt(iso: string | null): string
// null / empty → "—"
// else toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
```

Unit-test the null → `—` branch; avoid brittle exact locale strings for non-null (structure check or mock locale if the suite already does).

### Suggested web file layout

- `web/app/(protected)/schedules/page.tsx` — server page (replace stub)
- `web/app/(protected)/schedules/actions.ts` — `updateNewsletterScheduleAction`
- `web/components/schedules/schedules-view.tsx` — chrome, empty/error wiring
- `web/components/schedules/schedules-table.tsx` — `ResponsiveList` table + cards
- `web/components/schedules/schedule-list-card.tsx` — optional card extract
- `web/components/schedules/schedule-edit-dialog.tsx` — enable / cron / timezone dialog
- `web/components/schedules/schedules-pagination.tsx` — Prev/Next for `?page=`
- Modify: `web/app/(protected)/newsletters/page.tsx` + `newsletters-view.tsx` + **`newsletters-table.tsx`** — `edit` deep-link open (`initialEditId` must reach the table’s edit state)
- Modify: `web/src/__tests__/feeds-nav.test.ts` — Schedules href assert
- Test: `web/src/__tests__/schedules-responsive-list.test.tsx`
- Test: `web/src/__tests__/schedules-actions.test.ts`
- Test: `web/src/__tests__/newsletters-edit-deeplink.test.tsx` (required)

### Out of scope

- Schedule fields on the newsletter definition form / dialog body (Feature 03).
- Newsletter edit scroll / overflow fix (Feature 03).
- Worker due-check, run enqueue, concurrency, missed-fire policy (Features 04–06).
- Distinguishing scheduled vs manual runs in history (Feature 06).
- OS cron / host crontab.
- Creating newsletters from Schedules.
- Storing `nextFireAt` on the document (Feature 01 pin — always compute).
- New Appwrite collections or schema attributes (Feature 01 owns schema).

## Dependencies

- Builds on: **feature-01-per-newsletter-schedule** — schema fields, `toNewsletterScheduleView`, `updateNewsletterSchedule`, validation.
- Builds on: Stage 03 **feature-06-responsive-list-layout** — `ResponsiveList` + list conventions.
- Builds on: Stage 02 GUI shell — nav item already present; shadcn Table/Card/Badge/Dialog/Alert/Button.
- Soft: Stage 03 newsletter edit dialog — deep-link opens existing `NewsletterFormDialog`.
- Consumed later by: **feature-03-newsletter-edit-schedule-and-scroll** (second edit surface + scroll); Features 04–06 (due path; list remains the operator overview).

## Constraints

- **Do not** implement due-check or run creation.
- **Do not** add schedule fields to `NewsletterFormDialog` / definition FormData in this feature (Feature 03).
- **Do not** reorder or remove existing nav items; Schedules entry already exists.
- **Server-only** Appwrite via `getServerAppwrite()` + shared repository helpers.
- **Secrets:** never log API keys; sanitize Appwrite errors like other pages.
- **Responsive domain lists:** shared `ResponsiveList`, both `data-slot` branches mounted when list non-empty.
- **Fetch cap:** reuse `listNewsletters` V1 list (≤100); no new indexes.
- Schedule writes go **only** through `updateNewsletterSchedule` — never through `updateNewsletter`.

## Acceptance criteria

- [ ] `/schedules` lists every newsletter with enable Badge, cron, timezone, and next fire (or `—` when disabled), using `toNewsletterScheduleView`.
- [ ] List uses `ResponsiveList` (table `md+` / cards below `md`) with the same fields and actions in both presentations.
- [ ] **Edit schedule** opens a dialog **pre-filled** from the row’s current schedule and persists via `updateNewsletterSchedule`; invalid cron/TZ surfaces a safe validation error; success toasts and refreshes the list.
- [ ] **Edit newsletter** links to `/newsletters?edit=<id>` and opens the existing newsletter edit dialog when that newsletter is on the current Newsletters page.
- [ ] Empty and load-error states match Spec copy/patterns; pagination is 20/page.
- [ ] Nav still includes Schedules → `/schedules`; automated tests cover ResponsiveList slots, schedule action outcomes, nav href, and the `?edit=` deep-link.
- [ ] No worker due-check, no newsletter-form schedule section, no schema changes in this feature.
- [ ] `pnpm typecheck`, `pnpm lint`, and relevant `pnpm test` / web build gates pass.

## Files

- Modify: `web/app/(protected)/schedules/page.tsx` — replace stub
- Create: `web/app/(protected)/schedules/actions.ts`
- Create: `web/components/schedules/schedules-view.tsx`
- Create: `web/components/schedules/schedules-table.tsx`
- Create: `web/components/schedules/schedule-list-card.tsx` (optional)
- Create: `web/components/schedules/schedule-edit-dialog.tsx`
- Create: `web/components/schedules/schedules-pagination.tsx`
- Modify: `web/app/(protected)/newsletters/page.tsx` — parse `edit` search param
- Modify: `web/components/newsletters/newsletters-view.tsx` — pass `initialEditId` through
- Modify: `web/components/newsletters/newsletters-table.tsx` — open edit dialog from `initialEditId` (required wiring site)
- Modify: `web/src/__tests__/feeds-nav.test.ts` — assert Schedules href
- Test: `web/src/__tests__/schedules-responsive-list.test.tsx`
- Test: `web/src/__tests__/schedules-actions.test.ts`
- Test: `web/src/__tests__/newsletters-edit-deeplink.test.tsx` (required)

## Testing approach

Test-first for the schedule server action and display helper; GUI verified via ResponsiveList dual-presentation tests + build. No Appwrite live integration required in CI.

1. **updateNewsletterScheduleAction — success:** valid enabled cron+TZ calls `updateNewsletterSchedule` with coerced fields; returns `ok: true`.
2. **updateNewsletterScheduleAction — validation:** mocked `NewsletterRepositoryError` `validation` → `ok: false` with message; does not claim success.
3. **updateNewsletterScheduleAction — not_found:** mocked `not_found` → safe error.
4. **formatScheduleNextFireAt (if extracted):** `null` → `—`; non-null returns a non-empty string (avoid brittle locale equality).
5. **ResponsiveList:** non-empty schedules list mounts both `data-slot="domain-list-table"` and `data-slot="domain-list-cards"`; each branch shows Newsletter name, Status, Cron, Timezone, Next fire, **Edit schedule**, **Edit newsletter**; **Edit newsletter** `href` is `/newsletters?edit={id}`.
6. **Disabled row display:** fixture with `enabled: false` / `nextFireAt: null` shows Status **Disabled** and Next fire **—** in both presentations.
7. **Nav:** Schedules href is `/schedules`.
8. **Deep-link (required):** `web/src/__tests__/newsletters-edit-deeplink.test.tsx` — rendering with `initialEditId` matching a listed newsletter opens `NewsletterFormDialog` in edit mode (assert dialog title / form presence via the table’s edit state); unknown id leaves it closed.

## Tasks

### Task 1: Failing tests for action + ResponsiveList fixtures

- **Action:** Add `web/src/__tests__/schedules-actions.test.ts` covering cases 1–3 (mock `@newsletter/shared` `updateNewsletterSchedule`). Add `web/src/__tests__/schedules-responsive-list.test.tsx` with fixture rows (enabled + disabled) asserting cases 5–6 against components that may not exist yet (fail red). Extend nav test for Schedules href (case 7). Add failing `web/src/__tests__/newsletters-edit-deeplink.test.tsx` for case 8 (required — not optional).
- **Expected result:** New tests exist and fail for the right reasons (missing modules / missing assertions).
- **Verify:** `pnpm --filter web test` (or repo `pnpm test` scoped) shows the new schedule + deep-link tests failing, not infra errors.
- **Depends on:** none (requires Feature 01 types/helpers available in the workspace — if Feature 01 is not yet merged, this feature’s execute session must follow Feature 01 verification).

### Task 2: Schedules page shell (list, pagination, empty/error)

- **Action:** Implement `schedules/page.tsx`, `schedules-view.tsx`, `schedules-table.tsx` (+ optional card), `schedules-pagination.tsx`. Load `listNewsletters`, map `toNewsletterScheduleView`, sort by name, paginate 20, empty/error copy per Spec. Wire **Edit newsletter** links. **Edit schedule** may be a no-op button until Task 3 if needed, but prefer stubbing the dialog shell.
- **Expected result:** `/schedules` shows the responsive list; placeholder copy gone.
- **Verify:** ResponsiveList tests for display/href green (or mostly green); `pnpm --filter web build` and `pnpm typecheck` succeed.
- **Depends on:** Task 1.

### Task 3: Schedule edit dialog + server action

- **Action:** Implement `schedule-edit-dialog.tsx` and `schedules/actions.ts` per Spec. Wire **Edit schedule** from table and cards to one shared dialog state. **Pre-fill** enable/cron/timezone from the selected newsletter on open (and when switching rows). Make action tests 1–3 green. Toast + revalidate on success.
- **Expected result:** Operator can enable a cron+TZ from Schedules and see next fire update after refresh/revalidate; reopening Edit schedule shows the saved values, not blanks.
- **Verify:** Action tests green; build/typecheck green; spot-check pre-fill in the responsive-list fixture or a small dialog unit assertion if practical.
- **Depends on:** Task 2.

### Task 4: Newsletter `?edit=` deep-link + feature verification

- **Action:** Parse `edit` on newsletters page; pass `initialEditId` through `NewslettersView` into **`NewslettersTable`** so `NewsletterFormDialog` opens when id matches a newsletter on the page. Make deep-link test (case 8) green. Re-read Spec vs implementation; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope; Feature 03 can extend the opened dialog with schedule fields later.
- **Verify:** Deep-link test green; `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm --filter web build`) exit 0.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build`
- Expected: All green. Optional PM: with ≥1 newsletter, Schedules lists it as Disabled with `—` next fire; Edit schedule with `0 9 * * 1-5` + a valid IANA TZ enables it and shows a future next fire; Edit newsletter opens the definition dialog via `?edit=`.

## Handoff

Builder reports: files created/modified; confirmation that schedule writes use only `updateNewsletterSchedule`; ResponsiveList parity; deep-link contract (`/newsletters?edit=<id>`); any deviation (e.g. Switch vs Checkbox, actions file location) and why. Note for Feature 03: newsletter edit dialog is the second schedule surface + scroll fix; do not remove Schedules-page edit.

## Research notes

- **codegraph_explore** — `/schedules` stub; `navItems` already has Schedules; `ResponsiveList`; Newsletters list/dialog (no `/newsletters/[id]`); Feature 01 contract (`toNewsletterScheduleView`, `updateNewsletterSchedule`).
- **Stage / Plan** — Feature 02 list + link AC; decision log “editable from both Schedules list and newsletter edit”; Plan pin that Feature 03 owns newsletter-edit scroll.
- **Auto decisions (2026-07-16):** Schedules page owns schedule edit dialog; newsletter link via `?edit=` deep-link (no new route); sort by name; no enabled-filter; 20/page; Badge Enabled/`default` vs Disabled/`secondary`; next fire locale short datetime or `—`.
- **PM-accepted review (2026-07-16):** Dialog must pre-fill from row schedule; deep-link test required; `initialEditId` wires into `NewslettersTable` (not view-only).
