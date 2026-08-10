# Feature 07: Draft inspect

## Intent

Let the operator view the produced draft on Inspect beside the selected items that fed it — so they can audit whether the written issue matches the curated inputs without leaving the pipeline drill-down or opening Storage files.

## Spec

Append one read-only **Draft** section below Feature 06’s Suppressed section on `/runs/[runId]/inspect`. Show the draft markdown **alongside** the selected articles that produced it. No editing, pin/drop, delivery, or Issues-list changes.

### Scope boundary

| In | Out |
|----|-----|
| Load draft checkpoint via FromRun (`"draft"`) | Changing execute-run empty-draft behavior (today empty drafts are not saved) |
| Two-pane Draft section: Selected inputs \| Draft output | Editing draft / selection; delivery; pin/drop |
| Reuse Feature 02 markdown renderer + Feature 06 selected-row fields | New Appwrite attributes / collections |
| Missing / empty / error states for each pane | Top-level Inspect nav; Issues-list Inspect |
| Responsive: side-by-side on wide, stacked on phone | Raw-markdown toggle; TOC |

Keep Features 04–06 chrome and sections unchanged (Fetched → Suppressed stay as-is). Do **not** remove Feature 06’s **Selected** audit section — the Draft section’s left pane is a second presentation for side-by-side reading.

### Checkpoint loading (locked)

Feature 05/06 introduce `loadPhaseCheckpointFromRun` for fetch→selection. **Extend** the phase union to include `"draft"`:

```ts
loadPhaseCheckpointFromRun(
  client: Client,
  run: Run,
  phase: "fetch" | "scrape" | "tag" | "score" | "selection" | "draft",
): Promise</* existing unions */ | DraftCheckpointPayload>
```

Same missing / corrupt → `checkpoint_missing` contract; no `getRun`. Map outcomes to Feature 05’s `PhaseLoadResult<DraftCheckpointPayload>`.

**Selection for the left pane:** reuse the selection `PhaseLoadResult` already loaded for Feature 06 on the Inspect success path. Do **not** download the selection file a second time. If the page structure makes sharing awkward, extract a single selection load and thread it into both Feature 06 sections and Feature 07’s left pane.

Do **not** change `DraftCheckpointPayload` wire shape (`markdown`, `empty`, `reason`, `articleCount`, `attempts`). `raw` / `retryError` remain non-persisted (already true).

**Ops note (locked, no code change required):** `execute-run` currently `markFailed`s on `draftResult.empty` **without** saving a draft checkpoint. Failed empty-draft runs therefore show draft pane **`missing`** (not the empty-reason copy). Empty-reason UI still must be implemented for loaded payloads with `empty: true` (fixtures / future persist / corrupt-but-parseable files).

### Section placement & labels (locked)

Append below **Suppressed**, top-to-bottom order on the page:

1. … Feature 06 **Suppressed**
2. **Draft** ← this feature

Heading:

| Condition | Heading |
|-----------|---------|
| draft `loaded` | **Draft** plus quiet meta line under the heading: **`Articles fed: {articleCount} · Attempts: {attempts}`** from the payload |
| draft `missing` or `error` | **Draft** only (omit meta line) |

Left pane subheading (locked): **Selected inputs**  
Right pane subheading (locked): **Draft output**

When selection is `loaded`, Selected inputs may include a count suffix: **Selected inputs (N)** with `N = selectedArticles.length`. Omit the count when selection is missing/error.

### Layout — “alongside” (locked)

| Viewport | Layout |
|----------|--------|
| `lg` and up | Two columns in one Draft section: **Selected inputs** (left) \| **Draft output** (right). Equal-ish columns; both start at the top of the section. |
| below `lg` | Stack vertically: **Selected inputs** first, then **Draft output** (inputs → output). |

Use CSS grid/flex — no card chrome required beyond existing section spacing. Readable on phone; no horizontal-only critical info.

### Selected inputs pane (locked)

Same row fields and conventions as Feature 06 **Selected** (and Feature 05 Scored treatment):

| Fields | Title, Score, Source, Tags, Published, Link |
|--------|-----------------------------------------------|
| Sort | Score descending (stable) |
| List | `ResponsiveList` (table `md+` / cards phone) |
| Content | Do **not** show full article `content` |

Prefer reusing the Feature 06 selected-list component (extract shared if needed) rather than forking column definitions.

| Condition | UI in Selected inputs pane |
|-----------|----------------------------|
| selection `missing` | **`No checkpoint for this phase yet.`** |
| selection `loaded` && `selectedArticles.length === 0` | **`No articles in this checkpoint.`** |
| selection `error` | Destructive Alert **`Couldn’t load this phase.`** (never surface `.message`) |
| selection `loaded` && rows present | ResponsiveList |

### Draft output pane (locked)

**Renderer:** reuse Feature 02’s issue markdown component (`IssueMarkdown` / `web/components/issues/issue-markdown.tsx` — exact name from Feature 02). Same GFM + `prose dark:prose-invert` rules; links `target="_blank"` + `rel="noopener noreferrer"`. Do **not** invent a second markdown stack.

Inside the Draft output column, constrain prose to the column width (`w-full` / `max-w-none` on the prose wrapper as needed so Typography’s default `65ch` does not force awkward overflow in a half-width pane). Phone stacked layout may keep default prose measure.

| Condition | UI in Draft output pane |
|-----------|-------------------------|
| draft `missing` | **`No checkpoint for this phase yet.`** |
| draft `error` | Destructive Alert **`Couldn’t load this phase.`** (never surface `.message`) |
| draft `loaded` && `empty === true` && `reason === "no-articles"` | **`Draft is empty — no articles were provided.`** |
| draft `loaded` && `empty === true` && `reason === "empty-after-retry"` | **`Draft is empty — the model returned no content after retry.`** |
| draft `loaded` && `empty === true` && `reason` is null/other | **`Draft is empty.`** |
| draft `loaded` && `empty === false` | Render `markdown` via IssueMarkdown (even if string is unexpectedly blank — still mount renderer; do not invent alternate copy) |

Do **not** show a raw-markdown toggle. Do **not** add edit controls.

### Independence of panes (locked)

Each pane renders from its own load result. Examples:

- Selection present, draft missing (failed empty draft / mid-pipeline): left lists selected; right shows missing copy.
- Draft present, selection missing (corrupt/legacy edge): right renders markdown; left shows missing copy.
- Either pane `error`: that pane’s Alert only; the other pane still renders.

### Out of scope

- Persisting empty draft checkpoints on fatal empty-draft path.
- “Open in Issues” link from Inspect (nice-to-have; not required).
- Draft editing, pin/drop, reorder, delivery.
- Changing Issues reader or display-title behavior.
- Top-level Inspect nav.
- Appwrite schema changes.

### Suggested file layout

- Modify: `shared/src/runs/repository.ts` — extend `loadPhaseCheckpointFromRun` phase union to `"draft"`
- Test: `shared/src/runs/__tests__/repository.test.ts` — FromRun draft success + missing id
- Modify: `web/app/(protected)/runs/[runId]/inspect/page.tsx` and/or `web/components/runs/inspect-shell.tsx` — load draft; pass selection + draft into Draft section
- Create: `web/components/runs/inspect-draft-section.tsx` — two-pane Draft section
- Reuse: Feature 02 `issue-markdown` component; Feature 06 selected-list fields/component
- Test: `web/src/__tests__/inspect-draft-section.test.tsx`
- Do **not** modify `web/lib/nav-items.ts`

## Dependencies

- Builds on: **feature-06-selection-and-suppress-audit** — selection checkpoint load / Selected row fields; Suppressed as the insert-after anchor.
- Builds on: **feature-05-phase-article-lists** — `loadPhaseCheckpointFromRun` / `PhaseLoadResult` pattern.
- Builds on: **feature-04-inspect-entry** — Inspect route + shell.
- Builds on: **feature-02-issue-reader** — shared GFM markdown renderer (`IssueMarkdown`).
- Builds on: Stage 04 draft checkpoint save/load (`DraftCheckpointPayload`).

## Constraints

- **Read-only** — no draft or selection editing.
- **No top-level Inspect nav.**
- **No Appwrite schema changes.**
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- **Reuse** Feature 02 markdown renderer; do not add a parallel markdown dependency set.
- **Reuse** selection load already performed for Feature 06 — no second selection download.
- **Do not** change execute-run empty-draft fatal path in this feature.
- Labels / empty / error / empty-reason copy locked as Spec.
- Feature 06 **Selected** audit section remains; do not delete or reorder Fetched → Suppressed.

## Acceptance criteria

- [ ] Inspect shows a **Draft** section below Suppressed with Selected inputs \| Draft output panes (side-by-side on `lg+`, stacked below).
- [ ] Draft loads via `loadPhaseCheckpointFromRun(..., "draft")` mapped to `PhaseLoadResult`; selection for the left pane reuses Feature 06’s load (no double-download).
- [ ] Non-empty loaded draft renders with Feature 02’s IssueMarkdown (GFM + prose); links open in a new tab.
- [ ] Selected inputs list shows the same fields/sort as Feature 06 Selected via ResponsiveList; full `content` is not shown.
- [ ] Missing / error / empty-selection / empty-draft-reason copy matches locked strings; panes fail independently.
- [ ] Loaded draft shows meta **Articles fed: N · Attempts: M**.
- [ ] No draft editing controls; no Inspect nav item; Features 04–06 sections unchanged in order.
- [ ] Automated tests cover loading + UI states per Testing approach; `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/runs/repository.ts` (FromRun `"draft"`)
- Modify: `shared/src/runs/__tests__/repository.test.ts` (or dedicated)
- Modify: `web/app/(protected)/runs/[runId]/inspect/page.tsx` and/or `web/components/runs/inspect-shell.tsx`
- Create: `web/components/runs/inspect-draft-section.tsx`
- Create: `web/src/__tests__/inspect-draft-section.test.tsx`
- Reuse/modify as needed: Feature 02 markdown component; Feature 06 selected-list extract
- Do **not** modify: `web/lib/nav-items.ts`; Appwrite `declarations.ts`; `execute-run.ts` empty-draft path

## Testing approach

Not fully test-first for live Appwrite. **Required** unit/component tests with fixtures (no live Appwrite). Build/typecheck gate.

1. **FromRun draft (required):** empty `checkpointDraftId` → `checkpoint_missing`; fixture Run + mocked download of valid draft JSON → `DraftCheckpointPayload` with markdown; does not call `getRun`.
2. **Happy path panes (required):** selection loaded with rows + draft loaded non-empty → Selected inputs titles visible + rendered markdown content (e.g. heading text from fixture) present.
3. **Alongside layout (required):** Draft section mounts both pane regions (e.g. `data-slot="inspect-draft-selected"` and `data-slot="inspect-draft-output"` — lock these slots in the component).
4. **Draft missing + selection present (required):** left shows selected rows; right shows **`No checkpoint for this phase yet.`**
5. **Selection missing + draft present (required):** left shows missing copy; right renders markdown.
6. **Empty draft reasons (required):** fixtures with `empty: true` + `no-articles` / `empty-after-retry` show the locked reason strings (not the markdown renderer body).
7. **Draft load error (required):** draft `error` shows **`Couldn’t load this phase.`**; selection pane still renders when loaded.
8. **Meta line (required):** loaded non-missing draft shows **Articles fed:** and **Attempts:** with fixture numbers.
9. **ResponsiveList (required):** Selected inputs with rows mounts both `data-slot="domain-list-table"` and `data-slot="domain-list-cards"`.
10. **No edit creep (required):** Draft section has no contenteditable / save / edit controls; success-path body still includes Feature 06 section labels when those props are present (regression smoke if practical).

## Tasks

### Task 1: Extend FromRun for draft + shared tests

- **Action:** Extend `loadPhaseCheckpointFromRun` to accept `"draft"` and return `DraftCheckpointPayload` via existing revive. Cover Testing approach item 1.
- **Expected result:** Inspect can load draft from an in-memory `Run` without a second `getRun`.
- **Verify:** Shared FromRun draft tests pass; `pnpm typecheck` green for shared.
- **Depends on:** none (Stage 04 draft revive already exists; Feature 05 FromRun must exist when wiring).

### Task 2: Draft section UI + tests

- **Action:** Build `inspect-draft-section.tsx` with locked headings, meta line, two panes (`data-slot`s), ResponsiveList selected inputs, IssueMarkdown output, and all empty/missing/error/reason states. Cover Testing approach items 2–10 with fixtures (no Appwrite).
- **Expected result:** Section is unit-testable without the page; layout slots and copy are locked.
- **Verify:** `inspect-draft-section.test.tsx` passes items 2–10; `pnpm --filter web build` and typecheck green.
- **Depends on:** Feature 02 markdown component and Feature 06 selected-list patterns available (execute Features 02 then 06 before/with this UI).

### Task 3: Wire Inspect page — load draft, append section, share selection

- **Action:** On Inspect success path, after Feature 06 loads, load draft via FromRun; pass the existing selection `PhaseLoadResult` + draft result into `InspectDraftSection` below Suppressed. Ensure selection is not downloaded twice.
- **Expected result:** Completed runs show draft beside selected inputs; failed-before-draft runs show selected + draft missing; mid-pipeline runs show missing as appropriate.
- **Verify:** Component/page tests updated; prior Inspect tests still pass; build/typecheck green.
- **Depends on:** Tasks 1–2; Features 05–06 sections present.

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no edit/nav/schema/execute-run creep; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: open Inspect on a completed run and confirm Draft below Suppressed with selected titles beside rendered markdown; open a failed empty-draft run and confirm selected inputs with draft missing copy; confirm no edit controls.

## Handoff

Builder reports: files created/modified; confirmation that FromRun supports `"draft"`; selection load shared (no double-download); two-pane layout + locked copy/meta; IssueMarkdown reused; Feature 06 Selected audit retained; any deviations and why.

**Research note:** Codegraph — `DraftCheckpointPayload` in `shared/src/runs/types.ts`; `execute-run.ts` saves draft only on non-empty success and `markFailed`s empty drafts without a checkpoint; Feature 02 pins `react-markdown` + `remark-gfm` + `@tailwindcss/typography` IssueMarkdown; Feature 05/06 pin FromRun + ResponsiveList + missing/error copy; Feature 06 Selected fields + “draft beside selected — uses selected list, not this audit.” Auto decisions (2026-07-14): append Draft below Suppressed; keep F06 Selected audit; two-pane alongside (`lg+` columns / phone stack inputs→output); reuse IssueMarkdown; empty-reason copy for loaded `empty: true` even though execute-run currently omits empty checkpoints; no execute-run change; `data-slot` hooks for panes.
