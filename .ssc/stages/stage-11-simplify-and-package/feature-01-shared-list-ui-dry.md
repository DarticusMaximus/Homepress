# Feature 01: Shared list/UI DRY

## Intent

Collapse duplicated table/card list chrome across the six operator domain lists into one shared card shell so Stage 03’s responsive convention stays one pattern to maintain, without changing operator-visible behavior — a ship-prep simplification for Stage 11.

## Spec

Introduce a small shared **card shell** under `web/components/domain-list/` and migrate the six top-level domain list cards onto it. Domain tables stay domain-owned (Option A). No visual redesign; no new product capabilities.

### In scope (pages)

| Domain | Table (owns columns) | Card to migrate |
|--------|----------------------|-----------------|
| Feeds | `web/components/feeds/feeds-table.tsx` | `web/components/feeds/feed-list-card.tsx` |
| Newsletters | `web/components/newsletters/newsletters-table.tsx` | `web/components/newsletters/newsletter-list-card.tsx` |
| Runs | `web/components/runs/runs-table.tsx` | `web/components/runs/run-list-card.tsx` |
| Schedules | `web/components/schedules/schedules-table.tsx` | `web/components/schedules/schedule-list-card.tsx` |
| Issues | `web/components/issues/issues-table.tsx` | `web/components/issues/issue-list-card.tsx` |
| Delivery | `web/components/delivery/delivery-table.tsx` | `web/components/delivery/delivery-list-card.tsx` |

All six already wrap table+cards in `ResponsiveList` (`md` = table, narrower = cards). Keep that breakpoint and dual presentation.

### Out of scope

- **Inspect** phase lists (`inspect-article-list.tsx`, `inspect-selection-section.tsx`) — leave alone.
- Column-driven / generic data-grid abstraction (Option B) — rejected for this codebase.
- Repo-wide dead-code, renames, or consistency sweep — **Feature 02**.
- Changing fields, labels, actions, empty states, dialogs, or page chrome.
- Visual redesign (spacing, typography, colors) beyond what the shared shell must match from today’s cards.

### Shared components (pinned API)

Create and export from `web/components/domain-list/` (re-export via `index.ts` alongside existing `ResponsiveList`):

**`DomainListCard`** — shared phone-card chrome matching today’s cards:

| Prop | Type | Role |
|------|------|------|
| `title` | `ReactNode` | Primary header title (plain text or link, as today). |
| `badges` | `ReactNode` (optional) | Right-side header badges (status, health, etc.). |
| `description` | `ReactNode` (optional) | Secondary header line (e.g. feed URL). |
| `children` | `ReactNode` | Body — typically `DomainListField` rows. |
| `actions` | `ReactNode` (optional) | Footer action buttons. |
| `className` | `string` (optional) | Passthrough on the outer `Card` if needed. |

Structure must preserve today’s layout intent: `Card` → `CardHeader` (title + optional badges; optional description) → `CardContent` (children) → `CardFooter` (actions, only when `actions` is provided). Shared utility classes (pinned): `CardHeader` `gap-3`, `CardTitle` `text-base`, `CardContent` `flex flex-col gap-2 text-sm`, `CardFooter` `flex flex-wrap gap-2`.

**Header markup (pinned — no visual drift):**

- When `badges` is provided: wrap title + badges in `<div className="flex items-start justify-between gap-3">`. Title is `CardTitle`; badges sit in an inner `<div className="flex items-center gap-2">`. Do **not** use shadcn `CardAction` / header grid alternatives.
- When `badges` is absent: render `CardTitle` alone in the header (no extra flex wrapper for title alignment).
- When `description` is provided: render it after the title/badges block as `<p className="text-sm break-all text-muted-foreground">{description}</p>` (matches Feeds’ URL line). Domains pass plain text or ReactNode content; the shell owns that wrapper.

**`DomainListField`** — one labeled body row:

| Prop | Type | Role |
|------|------|------|
| `label` | `string` | Label text **without** trailing colon or space (component owns the suffix). |
| `children` | `ReactNode` | Value (text, badges, truncated spans, etc.). |
| `className` | `string` (optional) | Optional row wrapper class (e.g. `flex flex-wrap items-center gap-2` when the value is badge chips). |

**Label suffix (pinned):** the muted label span must render exactly `{label}: ` — colon **and** trailing space — matching today’s spans (`Notes: `, `Updated: `, etc.). Then the value `children`. Empty/missing values stay the domain’s responsibility (e.g. `—` with `text-muted-foreground`), not a special case inside `DomainListField`.

### Migration rules

1. Each `*-list-card.tsx` keeps its domain props and action wiring; it becomes a thin composition of `DomainListCard` + `DomainListField` + domain-specific values/actions.
2. Tables remain domain-owned; do **not** rewrite tables onto a column API.
3. **Local helper consolidation (required where duplicated today):** When the same helper exists in both a domain’s table and card files touched by this feature, consolidate to **one** definition used by both. Known pairs to eliminate:
   - Feeds + Newsletters: identical local `formatUpdatedAt` in `*-table.tsx` and `*-list-card.tsx` → one shared helper (under `web/components/domain-list/format-list-datetime.ts` or an existing matching `web/lib/` formatter).
   - Feeds: `STATUS_BADGE` map duplicated across `feeds-table.tsx` and `feed-list-card.tsx` → one shared constant (e.g. colocated in a small feeds display module both import, or exported from one of the two files and imported by the other — single definition).
   Do not invent a broad formatting framework. Do not sweep unrelated helpers (Feature 02).
4. Operator-visible parity: same fields, labels, actions, aria-labels, and `ResponsiveList` `md` breakpoint. Existing responsive parity tests are the behavior gate for domains that have them; the all-six compose check gates Newsletters/Delivery migration.

### Research note

Codebase inventory (codegraph + file scan, 2026-07-23): `ResponsiveList` already shared; six domain `*-table` / `*-list-card` pairs duplicate Card chrome; Inspect also uses `ResponsiveList` but is out of scope per PM. Existing parity tests: Feeds, Runs, Schedules, Issues; Newsletters/Delivery are gated by the all-six compose check + shared-card unit tests (no dedicated parity suites required).

## Dependencies

- Builds on: Stage 03 Feature 06 responsive domain-list convention (`ResponsiveList` + table/cards); Stage 10 deferral of list DRY into Stage 11.
- Or: None within Stage 11 — first feature in the stage.

## Constraints

- Must not change operator-visible list behavior (fields, labels, actions, breakpoint).
- Must not touch Inspect lists.
- Must not introduce a generic column-driven list framework.
- Must not expand into Feature 02’s dead-code / consistency sweep.
- Stage 03 GUI convention remains: table on wide, cards on narrow, same fields and actions in both.

## Acceptance criteria

- [ ] `DomainListCard` and `DomainListField` exist under `web/components/domain-list/` and are exported from `index.ts`.
- [ ] All six domain list cards import and compose `DomainListCard` from `@/components/domain-list` (or `web/components/domain-list`); none re-implement the full Card header/content/footer chrome locally.
- [ ] Feeds, Newsletters, Runs, Schedules, Issues, and Delivery lists still show table at `md+` and cards below, with field and action parity unchanged.
- [ ] Inspect list components are unmodified by this feature.
- [ ] Feeds/Newsletters `formatUpdatedAt` and Feeds `STATUS_BADGE` each have a single definition shared by that domain’s table + card (no second local copy in the pair).
- [ ] Existing responsive-list / domain parity tests pass; new shared-card unit tests pass; `pnpm typecheck` and `pnpm lint` pass.

## Files

- Create: `web/components/domain-list/domain-list-card.tsx`
- Create: `web/components/domain-list/domain-list-field.tsx`
- Create: `web/src/__tests__/domain-list-card.test.tsx`
- Modify: `web/components/domain-list/index.ts`
- Modify: `web/components/feeds/feed-list-card.tsx`
- Modify: `web/components/newsletters/newsletter-list-card.tsx`
- Modify: `web/components/schedules/schedule-list-card.tsx`
- Modify: `web/components/runs/run-list-card.tsx`
- Modify: `web/components/issues/issue-list-card.tsx`
- Modify: `web/components/delivery/delivery-list-card.tsx`
- Modify (helper consolidation only as needed): `web/components/feeds/feeds-table.tsx`, `web/components/newsletters/newsletters-table.tsx`
- Optional create (if consolidating date helper outside domain files): `web/components/domain-list/format-list-datetime.ts` (or reuse an existing `web/lib/` formatter if one already matches)
- Test (must stay green): `web/src/__tests__/responsive-list.test.tsx`, `web/src/__tests__/feeds-responsive-list.test.tsx`, `web/src/__tests__/runs-responsive-list.test.tsx`, `web/src/__tests__/schedules-responsive-list.test.tsx`, `web/src/__tests__/issues-responsive-list.test.tsx`

## Testing approach

**Test-first** for the shared shell. Tests verify Intent (one maintainable card pattern, behavior preserved), not private implementation details of domain pages.

### New: `domain-list-card.test.tsx`

1. Renders `title` and optional `badges` / `description` in the header region (description uses the pinned `text-sm break-all text-muted-foreground` paragraph).
2. Renders `DomainListField` rows whose label text appears as `{label}: ` (colon + space) with muted style, plus provided values.
3. Renders `actions` in the footer when provided; omits footer chrome when `actions` is absent.
4. Accepts ReactNode title (e.g. a link) without wrapping it in an extra interactive element.

### Existing behavior gates (must remain green)

- `responsive-list.test.tsx` — `md` visibility classes unchanged.
- `feeds-responsive-list.test.tsx`, `runs-responsive-list.test.tsx`, `schedules-responsive-list.test.tsx`, `issues-responsive-list.test.tsx` — table/card field and action parity after card migration.

Do **not** require new full parity suites for Newsletters/Delivery in this feature; shared-card unit tests + the all-six compose check + typecheck/lint + existing page tests are enough. If a migration breaks a Newsletters/Delivery test that already exists, fix the regression.

### All-six compose check (required — closes Newsletters/Delivery gap)

Every file below must import `DomainListCard` from `@/components/domain-list` (or a relative path under `web/components/domain-list/`):

- `web/components/feeds/feed-list-card.tsx`
- `web/components/newsletters/newsletter-list-card.tsx`
- `web/components/schedules/schedule-list-card.tsx`
- `web/components/runs/run-list-card.tsx`
- `web/components/issues/issue-list-card.tsx`
- `web/components/delivery/delivery-list-card.tsx`

Runnable verify (from repo root):

```bash
for f in \
  web/components/feeds/feed-list-card.tsx \
  web/components/newsletters/newsletter-list-card.tsx \
  web/components/schedules/schedule-list-card.tsx \
  web/components/runs/run-list-card.tsx \
  web/components/issues/issue-list-card.tsx \
  web/components/delivery/delivery-list-card.tsx
do
  rg -q "DomainListCard" "$f" || { echo "missing DomainListCard import/usage: $f"; exit 1; }
done
```

### Edge cases

- Card with badges but no description (Schedules/Runs-style).
- Card with description and badges (Feeds-style).
- Card with link title (Issues/Delivery-style).
- Field whose value is badges / custom components (not plain text).

## Tasks

### Task 1: Failing tests for DomainListCard / DomainListField

- **Action**: Add `web/src/__tests__/domain-list-card.test.tsx` covering the cases in Testing approach (header slots, fields, optional actions, ReactNode title). Import from `@/components/domain-list` (or the new module paths). Tests must fail until Task 2 lands.
- **Expected result**: New test file exists; `pnpm test` fails on missing exports / missing components.
- **Verify**: `pnpm exec vitest run web/src/__tests__/domain-list-card.test.tsx` fails for the right reason (module/component missing or assertions unmet), not for harness misconfiguration.
- **Depends on**: none.

### Task 2: Implement shared shell and export

- **Action**: Create `domain-list-card.tsx` and `domain-list-field.tsx` with the pinned API; re-export from `web/components/domain-list/index.ts`. Match existing card utility classes. If extracting a shared list datetime helper for later migration, add it here or under `web/lib/` only if Task 3 will use it immediately.
- **Expected result**: Task 1 tests pass; `ResponsiveList` export unchanged.
- **Verify**: `pnpm exec vitest run web/src/__tests__/domain-list-card.test.tsx` passes; `pnpm exec vitest run web/src/__tests__/responsive-list.test.tsx` still passes.
- **Depends on**: Task 1.

### Task 3: Migrate Feeds, Newsletters, Schedules cards

- **Action**: Rewrite `feed-list-card.tsx`, `newsletter-list-card.tsx`, and `schedule-list-card.tsx` to compose `DomainListCard` / `DomainListField`. Consolidate Feeds/Newsletters `formatUpdatedAt` to one shared helper used by each domain’s table + card; consolidate Feeds `STATUS_BADGE` to one definition shared by `feeds-table.tsx` + `feed-list-card.tsx`. Do not change displayed strings. Leave table column markup otherwise intact.
- **Expected result**: Three cards use the shared shell; helper pairs above have a single definition each; Feeds/Schedules responsive parity tests still describe the same UI.
- **Verify**:
  1. `pnpm exec vitest run web/src/__tests__/feeds-responsive-list.test.tsx web/src/__tests__/schedules-responsive-list.test.tsx web/src/__tests__/domain-list-card.test.tsx` passes.
  2. Compose check (each file must match — do not use multi-file `rg -q`, which is OR):  
     `for f in web/components/feeds/feed-list-card.tsx web/components/newsletters/newsletter-list-card.tsx web/components/schedules/schedule-list-card.tsx; do rg -q "DomainListCard" "$f" || exit 1; done`
  3. Helper consolidation: `rg -c "function formatUpdatedAt" web/components/feeds/feed-list-card.tsx web/components/feeds/feeds-table.tsx` totals **0** local copies (both import the shared helper); same for Newsletters table+card; `rg -c "const STATUS_BADGE" web/components/feeds/feed-list-card.tsx web/components/feeds/feeds-table.tsx` (or equivalent definition pattern) shows the map **defined** in **exactly one** of those files (or neither, if moved to a third shared feeds module both import) — not defined in both.
- **Depends on**: Task 2.

### Task 4: Migrate Runs, Issues, Delivery cards

- **Action**: Rewrite `run-list-card.tsx`, `issue-list-card.tsx`, and `delivery-list-card.tsx` the same way. Preserve link titles, delivery badges, suppress/failed-feeds value components, and action buttons/aria-labels exactly.
- **Expected result**: All six domain list cards use the shared shell; Inspect files untouched.
- **Verify**:
  1. `pnpm exec vitest run web/src/__tests__/runs-responsive-list.test.tsx web/src/__tests__/issues-responsive-list.test.tsx web/src/__tests__/domain-list-card.test.tsx` passes.
  2. Full all-six compose check (shell loop in Testing approach) exits 0.
  3. `git diff --name-only` (or equivalent) shows no changes under `web/components/runs/inspect-*.tsx`.
- **Depends on**: Task 3.

### Task 5: Feature verification gate

- **Action**: Run the full feature verification commands below; fix any type/lint/test fallout from the migrations only (no drive-by cleanups).
- **Expected result**: All listed tests green; compose + helper checks green; typecheck and lint green.
- **Verify**: Commands in Feature verification succeed with the expected outcomes.
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/domain-list-card.test.tsx web/src/__tests__/responsive-list.test.tsx web/src/__tests__/feeds-responsive-list.test.tsx web/src/__tests__/runs-responsive-list.test.tsx web/src/__tests__/schedules-responsive-list.test.tsx web/src/__tests__/issues-responsive-list.test.tsx`
- Expected: all pass.
- Run: the all-six compose check shell loop from Testing approach.
- Expected: exit 0 (every listed `*-list-card.tsx` references `DomainListCard`).
- Run: helper consolidation spot-check — `rg -n "function formatUpdatedAt" web/components/feeds web/components/newsletters` and `rg -n "STATUS_BADGE" web/components/feeds` — expect no duplicate local `formatUpdatedAt` definitions across a domain’s table+card pair, and Feeds `STATUS_BADGE` defined once for the pair.
- Expected: single shared definitions as in Acceptance criteria.
- Run: `pnpm typecheck`
- Expected: exit 0.
- Run: `pnpm lint`
- Expected: exit 0 (ignore benign missing `pages/` eslint-config-next warning per AGENTS.md).
- Confirm: Inspect list files (`web/components/runs/inspect-article-list.tsx`, `web/components/runs/inspect-selection-section.tsx`) unchanged by this feature.

## Handoff

Builder reports: files created/modified; confirmation all six cards compose `DomainListCard`; any helper extraction paths chosen; deviations (and why). Note research: inventory via codegraph/`ResponsiveList` usage scan confirmed six domain pairs + Inspect out of scope.
