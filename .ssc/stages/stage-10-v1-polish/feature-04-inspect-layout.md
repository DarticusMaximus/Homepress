# Feature 04: Inspect layout

## Intent

Make Inspect scannable: pipeline phase/section bodies collapse by default, and draft output stacks under selected inputs — so operators can jump to what they care about without a wall of always-open lists or a cramped side-by-side draft.

## Spec

Layout-only polish on the Stage 06 Runs Inspect page (`/runs/[runId]/inspect`). Checkpoint loading, article list columns, suppress audit rules, and shell section **order** stay unchanged. Two changes: (1) phase/section bodies become independent collapsibles, default closed; (2) Draft panes stack vertically instead of side-by-side at `lg`.

### Phase/section collapsibles (pinned)

Every Inspect phase/section that uses `PhaseSectionChrome` becomes an independent collapsible:

| Section | Source today |
|---------|----------------|
| Fetched, Scraped, Tagged, Scored | `web/components/runs/inspect-phase-section.tsx` |
| Selected, Selection drops, Suppressed | `web/components/runs/inspect-selection-section.tsx` (local duplicate chrome) |

**Behavior:**

- **Default: closed.** Opening one does **not** close others (independent sections — prefer shadcn `Collapsible` over single-open `Accordion`).
- **Trigger shows:** label + count when known (`Fetched (12)`), plus a chevron/indicator. Missing/error phases still show the label; count omitted when unknown (`null`) — same heading rules as today.
- **Expanded content:** optional subline (failed feeds under Fetched, scrape summary under Scraped) + body (lists / empty / missing / error copy).
- **Consolidate chrome:** one shared client `PhaseSectionChrome` (export from `inspect-phase-section.tsx`, or a dedicated `inspect-phase-chrome.tsx` if cleaner). Selection-section **must import the shared chrome** — delete its local duplicate `PhaseSectionChrome` / `PhaseHeading`.
- **Install:** `pnpm dlx shadcn@latest add @shadcn/collapsible` into `web/components/ui/collapsible.tsx`. Native `<details>` / `<summary>` is an acceptable fallback only if Collapsible install is blocked — document in handoff.
- **Client boundary:** Collapsible chrome is `"use client"`. Server page / `InspectShell` may keep rendering client chrome as children (Next pattern). Do not force the whole Inspect page to be a client component.

**Not collapsible in this feature:**

- Page chrome: Back to Runs, Inspect heading, run meta, phase hint.
- Outer **Draft** section (`aria-label="Draft"`) — heading + draft meta stay always visible so Draft remains easy to reach after collapsing phases.
- **Selected inputs** and **Draft output** panes inside Draft — always visible within the Draft section (not nested collapsibles).

### Draft stack (pinned)

In `web/components/runs/inspect-draft-section.tsx`, replace the current two-column layout:

```tsx
<div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
```

with a single-column stack, e.g. `flex flex-col gap-6` or `space-y-6` (no `lg:grid-cols-2`):

1. Selected inputs (`data-slot="inspect-draft-selected"`) first  
2. Draft output (`data-slot="inspect-draft-output"`) second  

Preserve existing empty / missing / error copy, markdown rendering, meta line (`Articles fed · Attempts`), and `data-slot` names. Do not change props or checkpoint load wiring in `InspectShell` / page.

### Shell order (unchanged)

`InspectShell` order remains: Back → heading → meta → phase hint → Fetched → Scraped → Tagged → Scored → Selected → Selection drops → Suppressed → Draft. Shared selection-error Alert placement above Selected + drops stays as Stage 06 Feature 06.

### Out of scope

- Hit-target / Back-link sizing, sidebar close-on-nav, nav active highlight for nested routes, `/design-system` removal, status label title-case (Feature 05).
- Checkpoint load semantics, article list field sets, suppress audit rules, draft empty-reason copy.
- Widening `max-w-3xl` on Inspect shell.
- Making Selected inputs / Draft output (or the outer Draft section) collapsible.

### Research notes (shaped decisions)

- codegraph: `InspectDraftSection` uses `lg:grid-cols-2`; `PhaseSectionChrome` is always-open `<section>` in both phase + selection files (duplicate).
- Stage 10 Feature 01 already prefers shadcn `Collapsible` (native `<details>` fallback) — reuse that pattern; no form-submit / collapsed-input pin applies here (Inspect is read-only).
- shadcn MCP: `@shadcn/collapsible` and `@shadcn/accordion` available; neither installed yet. Independent open → Collapsible (or Accordion `type="multiple"`); prefer Collapsible for parity with Feature 01 wording.
- Existing tests (`inspect-phase-lists`, `inspect-selection-suppress`, `inspect-draft-section`) assert list content on first render — must expand before list assertions after this feature.

## Dependencies

- Builds on: Stage 06 Inspect (phase lists, selection/suppress audit, draft section) — `InspectShell`, `PhaseSectionChrome`, `InspectDraftSection`.
- No Stage 10 feature prerequisite (Features 01–03 are unrelated).

## Constraints

- Do **not** change Appwrite schema, run/checkpoint repositories, or checkpoint JSON shapes.
- Preserve locked copy strings (`PHASE_*_COPY`, draft empty reasons, selection drops / suppress empty copy) and existing `data-slot` names (`inspect-draft-selected`, `inspect-draft-output`, domain-list slots).
- Do **not** reorder phases or move the shared selection-error Alert.
- Do **not** change Feature 05 surfaces in this feature.
- Collapsed-by-default must be the initial paint — no “remember last open” persistence required.

## Acceptance criteria

- [ ] Fetched, Scraped, Tagged, Scored, Selected, Selection drops, and Suppressed start **collapsed**; expanding a section reveals its body (and subline when present).
- [ ] Multiple sections can be open at once (independent collapsibles).
- [ ] Collapsed trigger shows label and count when the phase is loaded with a known count.
- [ ] Outer Draft section stays expanded (heading + meta always visible).
- [ ] Draft output sits **below** selected inputs at all breakpoints; no `lg:grid-cols-2` side-by-side.
- [ ] Selection-section uses the shared chrome (no duplicate `PhaseSectionChrome`).
- [ ] Phase / selection / draft content behavior unchanged aside from collapse + stack.
- [ ] Updated + new inspect layout tests pass; `pnpm typecheck` and `pnpm lint` pass.

## Files

- Create: `web/components/ui/collapsible.tsx` (shadcn add) — or document `<details>` fallback in handoff
- Modify: `web/components/runs/inspect-phase-section.tsx` — export shared collapsible `PhaseSectionChrome` (or extract `inspect-phase-chrome.tsx`)
- Modify: `web/components/runs/inspect-selection-section.tsx` — import shared chrome; remove local duplicate
- Modify: `web/components/runs/inspect-draft-section.tsx` — single-column stack
- Modify: `web/src/__tests__/inspect-phase-lists.test.tsx` — expand before list assertions; add default-collapsed / expand cases
- Modify: `web/src/__tests__/inspect-selection-suppress.test.tsx` — same expand pattern
- Modify: `web/src/__tests__/inspect-draft-section.test.tsx` — stack order; rename/replace “alongside” case; assert no two-column grid class
- Optional create: `web/src/__tests__/inspect-layout.test.tsx` if keeping accordion-default tests separate from phase-list content tests is clearer

## Testing approach

Test-first by default. Behavior under test is Intent (collapsed phases + stacked draft), not Collapsible internals.

**New / updated cases:**

1. **Default collapsed (phase)** — render `InspectFetchedSection` with loaded articles → trigger shows `Fetched (N)`; article list **not** visible (`toBeVisible` / query within expanded region) until the trigger is activated.
2. **Expand reveals body** — `userEvent.click` (or equivalent) on the Fetched trigger → titles / domain-list slots appear; missing/empty/error copy still works after expand.
3. **Independent open** — open Fetched and Scored; both bodies remain visible.
4. **Selection sections** — Selected / Selection drops / Suppressed default collapsed; expand shows prior content rules (including shared error Alert still above Selected when selection errors — Alert itself is not inside a collapsible).
5. **Draft stack** — `inspect-draft-selected` appears **before** `inspect-draft-output` in DOM order; container must **not** use `lg:grid-cols-2`. Keep existing empty/missing/error and markdown cases.
6. **Regression** — update `inspect-phase-lists.test.tsx` and `inspect-selection-suppress.test.tsx` so any assertion on list rows / drop rows expands the relevant section first (shared test helper encouraged, e.g. `expandInspectSection(container, "Fetched")`).

**Not required:** visual screenshot tests; persistence of open state across navigation.

## Tasks

### Task 1: Failing tests for collapse default + draft stack

- **Action**: Add (or extend) tests that fail on current code: (a) Fetched with articles starts collapsed — list not visible, trigger shows count; (b) after expand, list visible; (c) Draft selected pane precedes draft output and layout has no `lg:grid-cols-2`. Prefer extending `inspect-phase-lists.test.tsx` + `inspect-draft-section.test.tsx`, or a focused `inspect-layout.test.tsx`.
- **Expected result**: New assertions fail against always-open chrome and `lg:grid-cols-2` draft grid.
- **Verify**: `pnpm exec vitest run web/src/__tests__/inspect-phase-lists.test.tsx web/src/__tests__/inspect-draft-section.test.tsx` (and layout file if added) — new cases fail; note failures.
- **Depends on**: none.

### Task 2: Install Collapsible + shared PhaseSectionChrome

- **Action**: Add shadcn Collapsible under `web/components/ui/`. Implement shared client `PhaseSectionChrome` (label, count, optional subline, children) as a collapsible defaulting to closed; export for selection sections. Keep heading text rules identical (`Label` vs `Label (n)`).
- **Expected result**: Shared chrome exists; Collapsible (or documented `<details>` fallback) is available; phase sections can adopt it in Task 3.
- **Verify**: File(s) exist; `pnpm typecheck` clean for new chrome module (may not wire all sections yet). Spot-check: chrome renders a closed trigger with label/count.
- **Depends on**: Task 1.

### Task 3: Wire chrome on all seven sections; remove selection duplicate

- **Action**: Point Fetched / Scraped / Tagged / Scored / Selected / Selection drops / Suppressed at the shared collapsible chrome. Delete local `PhaseSectionChrome` / `PhaseHeading` from `inspect-selection-section.tsx`. Update phase + selection tests to expand before asserting list/drop content; cover independent multi-open if not already in Task 1.
- **Expected result**: All seven sections default collapsed; expand works; no duplicate chrome; prior phase/selection tests pass with expand helper.
- **Verify**: `pnpm exec vitest run web/src/__tests__/inspect-phase-lists.test.tsx web/src/__tests__/inspect-selection-suppress.test.tsx` (+ layout file if any) — all pass.
- **Depends on**: Task 2.

### Task 4: Stack Draft panes + update draft tests

- **Action**: Change `InspectDraftSection` to a single-column stack (selected inputs above draft output). Update `inspect-draft-section.test.tsx`: replace “alongside” wording/assertions with stack/order + no `lg:grid-cols-2`; keep content cases.
- **Expected result**: Draft panes stacked at all breakpoints; draft tests pass including Task 1 stack assertions.
- **Verify**: `pnpm exec vitest run web/src/__tests__/inspect-draft-section.test.tsx` — all pass.
- **Depends on**: Task 1 (can run parallel with Task 3 after Task 2).

### Task 5: Feature gate

- **Action**: Run full verify commands for touched workspaces; fix any fallout from client-boundary or test helper imports.
- **Expected result**: Inspect layout Intent satisfied; no regressions in entry/shell tests that render phase sections without expanding (adjust those too if they assert list visibility).
- **Verify**: `pnpm exec vitest run web/src/__tests__/inspect-*.test.tsx` (and any `runs-inspect-*.test.tsx` that mount phase bodies); `pnpm typecheck`; `pnpm lint`.
- **Depends on**: Tasks 3 and 4.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/inspect-phase-lists.test.tsx web/src/__tests__/inspect-selection-suppress.test.tsx web/src/__tests__/inspect-draft-section.test.tsx web/src/__tests__/inspect-entry.test.tsx` (plus `inspect-layout.test.tsx` if created); then `pnpm typecheck`; `pnpm lint`
- Expected: All pass. Behavior covered: seven sections start collapsed and expand independently; Draft stays open with selected inputs above draft output and no side-by-side grid; prior missing/empty/error/list content still correct after expand.

## Handoff

Builder reports: files created/modified; whether Collapsible or `<details>` was used; where shared `PhaseSectionChrome` lives; test helper name for expand-if-any; list of test files updated; any Inspect shell/entry tests that needed expand adjustments; deviations from this spec and why.
