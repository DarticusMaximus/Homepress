# Feature 06: Responsive list layout

## Intent

Make domain list pages usable on phone browsers by switching from a desktop table to stacked cards on narrow viewports, with the same fields and actions — establishing a shared table-desktop / cards-phone convention that Features 04–05 and later list surfaces reuse instead of inventing page-local layouts.

## Spec

Feature 02 shipped a Feeds list as a single wide `Table`. On phone widths that table forces horizontal scrolling and is hard to use. This feature does **not** invent a new domain or data path; it introduces a **shared responsive list shell** and applies it to the Feeds list as the proving surface.

### Shared pattern (required)

Create a reusable client-safe layout primitive:

**File:** `web/components/domain-list/responsive-list.tsx`

**API (exact contract):**

```tsx
type ResponsiveListProps = {
  table: React.ReactNode;
  cards: React.ReactNode;
  className?: string;
};

export function ResponsiveList({ table, cards, className }: ResponsiveListProps): JSX.Element
```

**Behavior:**

| Viewport | Presentation | Implementation |
|----------|--------------|----------------|
| **&lt; `md` (default Tailwind 768px)** | Stacked cards | Wrapper with `md:hidden` (visible only below `md`) |
| **`md` and up** | Table | Wrapper with `hidden md:block` (visible only at `md+`) |

- Use Tailwind’s default **`md`** breakpoint only. Do **not** introduce a custom breakpoint, container-query-only switch, or JS `matchMedia` for the layout toggle.
- **Both presentations are always mounted in the DOM** (CSS show/hide). Do not conditionally render only one branch with client-side media queries. This keeps SSR deterministic and makes automated tests able to assert both trees without mocking viewport size.
- Mark wrappers with stable test hooks: `data-slot="domain-list-table"` on the table branch and `data-slot="domain-list-cards"` on the cards branch.
- Cards branch: vertical stack with consistent gap (`space-y-3` or equivalent). Do **not** wrap the cards branch in the table’s `overflow-x-auto` container.
- Export from a barrel if useful (`web/components/domain-list/index.ts`) — optional; direct import of `responsive-list.tsx` is fine.
- **No domain knowledge** inside `ResponsiveList` — no feed types, no column config engine. Callers supply both presentations.

**Convention pin (binding on later features):** Any new operator domain list page (newsletters, runs, schedules, etc.) must use `ResponsiveList` (or a thin domain wrapper built on it) for the list body. Do not ship a desktop-only table without the narrow card branch. Feature 04’s newsletter list and feature 05’s list column additions must adopt this shell when those features are built/executed — this feature does **not** implement the Newsletters page.

### Breakpoint rationale

The app shell already treats **`md`** as the phone vs tablet/desktop boundary (sidebar `hidden md:block` / mobile sheet). Aligning list layout with that boundary keeps “phone = cards, tablet+desktop = table” consistent with the stage pin and Plan.md carry-forward.

### Feeds proving surface

Refactor the Feeds list so non-empty lists use `ResponsiveList`.

**Current code (feature 02):** `web/components/feeds/feeds-table.tsx` renders only a `Table` with columns Name, URL, Status, Notes, Updated, Actions (Edit, Delete). Dialogs for edit/delete live in the same component. `FeedsView` mounts `FeedsTable` when `total > 0`.

**Required after this feature:**

1. **Table branch** — Keep the existing desktop table presentation (same columns, Badge map, truncate rules, Edit/Delete). If feature 03 has already added **Test** and/or a failed-reason display, those remain on the table branch.
2. **Cards branch** — One card per feed using Stage 02 shadcn `Card` primitives (`Card`, `CardHeader`, `CardTitle`, `CardDescription` / `CardContent`, `CardFooter` as needed). Each card must expose the **same fields and actions** as the table row for that feed:
   - **Name** (primary title)
   - **URL** (full or safely wrapped; prefer wrap/break over truncation that hides the host — cards have vertical space)
   - **Status** Badge (`untested` → `secondary`, `ok` → `default`, `failed` → `destructive` — unchanged map)
   - **Notes** (or “—” when empty)
   - **Updated** (same `formatUpdatedAt` locale short datetime as the table)
   - **Actions:** Edit, Delete, and **Test if present** (see Feature 03 coordination below)
   - When `status === "failed"` and `lastTestError` is shown on the table (feature 03), show the same reason text on the card (truncated + full via `title`/tooltip acceptable)
3. **Shared interaction state** — Edit/Delete (and Test when present) dialogs and handlers must be **one shared state** driving both presentations. Do not mount two independent copies of dialogs that can diverge. Clicking Edit on a card must open the same `FeedFormDialog` path as Edit on the table row.
4. **Empty state** — When `total === 0`, keep the existing empty dashed section from `FeedsView`. Do **not** wrap empty state in `ResponsiveList`.
5. **Pagination** — `FeedsPagination` stays **outside** the list body (below the section). Same control on all viewports; do not duplicate pagination into each card.
6. **Page chrome** — Heading, supporting line, and “Add feed” remain as today; they may stack more tightly on narrow widths if needed (`flex-col sm:flex-row` is fine) but that is secondary to the list pattern.
7. **File layout (recommended):**
   - Keep or rename the list owner as `web/components/feeds/feeds-table.tsx` **or** `web/components/feeds/feeds-list.tsx` (if renaming, update all imports; do not leave a dead table-only module).
   - Optional: `web/components/feeds/feed-list-card.tsx` for a single feed card presentational component.
   - `FeedsView` continues to own empty vs non-empty branching and create dialog; it renders the responsive list component when feeds exist.

### Feature 03 coordination (Test action)

Feature 03 adds a per-row **Test** control and failed-reason display. Execution order relative to this feature may vary:

| Situation | Requirement |
|-----------|-------------|
| Feature 03 **already verified** when this feature runs | Table and cards both show Test (+ Testing… per-row disable) and failed-reason parity. |
| Feature 03 **not yet built** | Ship Edit/Delete parity only. Structure actions so Feature 03 can add Test to **both** branches without reinventing the layout (shared action row / shared handlers). |
| Feature 03 **built after** this feature | Feature 03’s Tasks must wire Test + reason into **both** table and card presentations (amend feature 03 implementation accordingly at execute time if needed). |

This feature’s automated tests assert Edit and Delete in both presentations. If Test buttons exist in the tree when tests run, assert Test appears in both as well (conditional assertion is fine).

### Out of scope

- Newsletter list implementation (feature 04) — only the shared shell + Feeds adoption.
- Changing feed CRUD, repository, schema, pagination size (20), or sort rules.
- Playwright / visual regression suite.
- JS-driven layout switching, virtualization, or data-table libraries.
- Redesigning the design-system demo page (optional one-line note in handoff if you add a tiny dual-list demo; not required).
- Mobile-native app patterns (bottom sheets for every action, etc.) — Dialogs from feature 02 remain acceptable on phone.

## Dependencies

- Builds on: **feature-02-feed-library-page** — `/feeds`, `FeedsView`, `FeedsTable` (or equivalent), edit/delete dialogs, Badge map, pagination. **Feature 02 must be verified** before this feature; if the Feeds list is missing, stop and escalate.
- Builds on: Stage 02 shared components — `Table`, `Card` (+ header/title/content/footer), `Button`, `Badge`.
- Optionally coexists with: **feature-03-feed-qualification-test** — Test action and `lastTestError` display; see coordination table above.
- Does **not** depend on features 04–05.

## Constraints

- **Shared shell, not page-local CSS only.** The breakpoint + dual-slot structure lives in `web/components/domain-list/responsive-list.tsx` (or under `domain-list/`). Feeds must import it; do not copy `hidden md:block` / `md:hidden` pairs only into feeds files without the shared component.
- **Breakpoint is Tailwind `md` only** — match the shell’s phone vs desktop split.
- **Both branches always mounted** (CSS visibility); no `matchMedia`-only single branch.
- **Same fields and actions** in both presentations for Feeds; no “mobile reduced mode” that drops status, notes, or actions.
- **Do not change** feed repository, server actions contracts, auth gate, nav order, Badge variant map, or empty-state copy semantics.
- **Do not change** schema/provisioner or Stage 01 pipeline code.
- **Reuse** Stage 02 Card/Table/Button/Badge; do not add a second component library.
- **Secrets:** none involved; no new env vars.
- **Feature 04 execute order:** Plan.md prefers executing this feature **before** feature 04 so the newsletter list adopts the pattern from the start. If feature 04 is executed first anyway, feature 04 must still be updated (or a follow-up) to use `ResponsiveList` — desktop-only newsletter tables are not acceptable after this pin.

## Acceptance criteria

- [ ] `ResponsiveList` exists under `web/components/domain-list/` with `table` + `cards` slots, `data-slot="domain-list-table"` / `data-slot="domain-list-cards"`, and Tailwind classes that hide the table below `md` and hide cards at `md+`.
- [ ] On a phone-width viewport, the Feeds list shows stacked cards (not a horizontally scrolling table); each card shows name, URL, status, notes, updated, and the same actions as the table row (Edit, Delete; Test if feature 03 is present).
- [ ] On a desktop/tablet-width viewport (`md+`), the Feeds list still uses the table layout (no regression to density or columns).
- [ ] Edit and Delete from a card open the same dialogs/handlers as from the table (shared state).
- [ ] Empty Feeds state is unchanged and does not use `ResponsiveList`.
- [ ] Pagination remains below the list and works on both presentations.
- [ ] Automated tests cover the shared shell classes/slots and Feeds dual presentation field/action parity (see Testing approach).
- [ ] `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` pass.
- [ ] **PM manual gate:** resize (or device toolbar) to ~375px width → cards usable without horizontal scroll; ~1280px → table; Edit/Delete work from a card.

## Files

- Create: `web/components/domain-list/responsive-list.tsx`
- Create (optional): `web/components/domain-list/index.ts` barrel
- Create: `web/src/__tests__/responsive-list.test.tsx`
- Create: `web/src/__tests__/feeds-responsive-list.test.tsx`
- Create (optional): `web/components/feeds/feed-list-card.tsx`
- Modify: `web/components/feeds/feeds-table.tsx` (or rename to `feeds-list.tsx` and update imports) — dual presentation via `ResponsiveList`
- Modify: `web/components/feeds/feeds-view.tsx` — only if import/name changes require it; empty-state path unchanged
- Modify (only if needed for Test parity when feature 03 already landed): feed Test wiring so both branches share the action
- Modify: `product_spec.md` — one-line note under Implemented features for responsive domain lists

## Testing approach

**Test-first for the shared shell and Feeds dual presentation.** Layout behavior is asserted via class names / `data-slot` and dual DOM content (both branches mounted). No Playwright. No real Appwrite.

### `web/src/__tests__/responsive-list.test.tsx`

Render `<ResponsiveList table={<div>TABLE</div>} cards={<div>CARDS</div>} />`.

1. Finds `data-slot="domain-list-table"` containing `TABLE`.
2. Finds `data-slot="domain-list-cards"` containing `CARDS`.
3. Table wrapper includes `hidden` and `md:block` (via `className` string or class list).
4. Cards wrapper includes `md:hidden`.
5. Both `TABLE` and `CARDS` text are in the document simultaneously (proves dual mount).

### `web/src/__tests__/feeds-responsive-list.test.tsx`

Render the Feeds list component (the one that maps feeds → table + cards) with **two fixture feeds** (no network). Mock or stub dialogs if they pull server actions in a way that breaks unit render — prefer rendering the list presentational tree with props.

Fixtures must include at least:

- One feed `status: "ok"`, **non-empty notes** with a distinctive string (e.g. `"Alpha notes"`), distinctive URL (e.g. `https://alpha.example.com/feed.xml`), and a fixed `updatedAt` ISO string
- One feed `status: "failed"` with `lastTestError` set (if the component already displays reason; otherwise still include the field on the fixture for forward-compat), distinctive URL/notes as needed

Assertions (scope queries within each `data-slot` where possible):

1. `data-slot="domain-list-table"` and `data-slot="domain-list-cards"` both present.
2. Each feed **name** appears in **both** branches.
3. Each feed **status** badge text appears in both branches.
4. Each feed **URL** (full string or unique substring) appears in both branches.
5. Non-empty **notes** text from fixtures appears in both branches; empty notes show the same empty marker as the table (`—` or equivalent) in both branches if a fixture uses empty notes.
6. **Updated** display text appears in both branches — use the same formatting the component uses (e.g. match `toLocaleString` short date+time for the fixture ISO, or assert a stable substring both branches share).
7. **Edit** and **Delete** controls exist in both branches (button names / roles; count ≥ 2 feeds × 2 presentations for each action, or scoped per slot).
8. If any **Test** button is present in the table branch, the cards branch has the same count of Test controls.
9. Does **not** require viewport resizing in jsdom.

**Anti-cheat:** A card that only shows name + badge + buttons must fail assertions 4–6. Field parity is part of the Intent, not optional polish.

### Manual / PM gate

1. Open `/feeds` with at least one feed.
2. DevTools device mode ~375×667: list is cards; no horizontal page scroll for the list; Edit opens dialog; Delete opens confirm.
3. ~1280px width: table with prior columns; actions work.
4. Empty library: empty state only (no empty card stack).

### Full suite

- `pnpm test` green (new tests + existing feeds-nav and shared tests).
- `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` green.

## Tasks

### Task 1: Failing tests for ResponsiveList + Feeds dual presentation

- **Action:** Add `web/src/__tests__/responsive-list.test.tsx` and `web/src/__tests__/feeds-responsive-list.test.tsx` per Testing approach (including **URL, notes, and Updated** dual-branch field parity — not only name/status/actions). Import the intended public symbols (`ResponsiveList`, and the Feeds list component export). Do **not** implement production dual layout yet — tests must fail (missing module / missing slots / single presentation only).
- **Expected result:** `pnpm test -- web/src/__tests__/responsive-list.test.tsx web/src/__tests__/feeds-responsive-list.test.tsx` fails for the right reasons (missing export or assertions), not harness misconfig.
- **Verify:** Run that command; failures cite missing `ResponsiveList` / `data-slot` / dual field or action parity.
- **Depends on:** none (feature 02 code exists for the Feeds component under test).

### Task 2: Implement `ResponsiveList` shell

- **Action:** Create `web/components/domain-list/responsive-list.tsx` with the Spec API, `data-slot` hooks, and Tailwind `hidden md:block` / `md:hidden` wrappers. Optional barrel. No domain types.
- **Expected result:** `responsive-list.test.tsx` green.
- **Verify:** `pnpm test -- web/src/__tests__/responsive-list.test.tsx` passes. `pnpm --filter web exec tsc --noEmit` clean for the new file.
- **Depends on:** Task 1.

### Task 3: Feeds list adopts ResponsiveList (table + cards)

- **Action:** Refactor `web/components/feeds/feeds-table.tsx` (or rename to `feeds-list.tsx` and fix imports) to render through `ResponsiveList`. Implement card presentation (optional `feed-list-card.tsx`) with field/action parity. Share edit/delete dialog state across both branches. Preserve empty-state path in `feeds-view.tsx`. If feature 03 Test UI already exists, wire it into both branches. Do not change repository or server actions unless a pure import path rename is required.
- **Expected result:** `feeds-responsive-list.test.tsx` green; desktop table behavior preserved; cards present for non-empty lists.
- **Verify:** `pnpm test -- web/src/__tests__/feeds-responsive-list.test.tsx` passes. `pnpm --filter web build` exits zero. Spot-check: both `data-slot`s exist in the client component tree; empty state path has no `domain-list-cards`.
- **Depends on:** Task 2.

### Task 4: Regression + product_spec note

- **Action:** Run full `pnpm test`, `pnpm typecheck`, `pnpm lint`. Add a one-line Implemented features note in `product_spec.md` for responsive domain lists (table `md+` / cards below `md`, shared `ResponsiveList`, Feeds as first consumer). Confirm no schema/worker changes.
- **Expected result:** Full suite green; product_spec updated; handoff ready.
- **Verify:** `pnpm test`, `pnpm typecheck`, `pnpm lint` all exit zero. `git diff` (or equivalent) shows no unintended `shared/` schema or pipeline edits.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm test -- web/src/__tests__/responsive-list.test.tsx web/src/__tests__/feeds-responsive-list.test.tsx && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected:
  - ResponsiveList tests: both slots mounted; correct `md` visibility classes.
  - Feeds tests: dual presentation; name/URL/status/notes/Updated/Edit/Delete parity; Test parity if Test exists.
  - Full suite, web build, typecheck, lint all green.
  - Manual: ~375px → cards without horizontal list scroll; ~1280px → table; Edit/Delete from a card works.

## Handoff

Builder reports to the manager:

- Files created/modified (especially final path of Feeds list component if renamed).
- Confirmation that `ResponsiveList` is domain-agnostic and Feeds is the only consumer in this feature.
- Whether feature 03 Test was present and wired into cards, or deferred for feature 03 execute.
- Any deviation (e.g. file rename, optional barrel) and why.
- Note for feature 04/05 execute: list bodies must import `ResponsiveList`; do not ship desktop-only tables.

## Research notes

- **Codebase:** `FeedsTable` is table-only (`web/components/feeds/feeds-table.tsx`); `FeedsView` empty vs list; shadcn `Card`/`Table` available; sidebar already uses `md` for desktop chrome.
- **Stage/Plan:** Stage 03 feature 06 + Plan.md carry-forward pin + `AGENTS.md` Project GUI conventions — table desktop/tablet, cards phone, shared pattern, execute before feature 04.
- **Feature 03:** Test is a row action; this feature requires action parity so Test cannot remain table-only once present.
- **Feature 04** specs still describe a table; Plan pin + this feature’s Constraints bind later execute to adopt `ResponsiveList`.
