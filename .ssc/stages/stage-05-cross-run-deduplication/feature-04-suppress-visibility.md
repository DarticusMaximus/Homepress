# Feature 04: Suppress visibility

## Intent

Let the operator trust cross-run topic suppression by seeing on each run’s summary how many candidates were dropped, which titles were suppressed, and which prior issue each matched — without waiting for Stage 06’s full inspect UI.

## Spec

Surface feature 03’s persisted `suppressSummary` on the **Runs** list (table + cards) — the existing run-summary surface. Parse on the server (same pattern as `failedFeeds`), pass typed summaries into list components, and render a compact cell that always exposes **count**, **suppressed titles**, and **matched prior issue** for each item.

This feature owns **read + display only**. It does **not** change suppress algorithm, threshold env, lookback load, schema attributes (beyond consuming feature 03’s field), or Stage 06 inspect routes.

### Data contract (from feature 03 — do not redefine)

`Run.suppressSummary` is a JSON string (empty `""` when none). Parsed shape:

```ts
{
  count: number; // must equal items.length
  items: Array<{
    title: string;        // suppressed candidate title
    link: string;
    matchedRunId: string; // prior completed run id
    matchedTitle: string; // lookback topic title that matched
    similarity: number;
  }>;
}
```

Use `parseSuppressSummary` from `shared/src/runs/suppress-summary.ts` (feature 03). Ensure it is re-exported from `@newsletter/shared` (runs barrel / package index) if not already — so the Runs page can import it like `parseRunFailedFeeds`.

### Behavior contract

| Case | Behavior |
|------|----------|
| Missing / `""` / invalid `suppressSummary` | Treat as `{ count: 0, items: [] }`; UI shows em-dash (same empty affordance as failed feeds). |
| `count === 0` | Em-dash in table + cards. |
| `count >= 1` | Show suppression **count** as the compact label; expose each item’s suppressed **title** and **matched prior issue** via accessible detail (see Display). |
| Failed runs that still have a summary (e.g. empty-after-suppress) | Still show suppressions when present — do not gate display on `status === "completed"`. |
| Prior run not on the current page | Still identify the prior issue via `matchedTitle` + `matchedRunId` (see Prior-issue label). |

### Display (table + cards, same fields)

Mirror `RunFailedFeedsValue` / Failed feeds column:

1. **Create** `web/components/runs/run-suppress-summary.tsx` with:
   - `RunSuppressSummaryValue` — shared by table + card.
   - Optional pure helpers in the same file (or tiny sibling) for labels used by tests:
     - `formatSuppressCountLabel(count: number): string` — e.g. `1 suppressed` / `N suppressed`.
     - `formatPriorIssueLabel(item, runLookup): string` — see below.
     - `formatSuppressItemLine(item, runLookup): string` — one line for tooltip / title / card detail.

2. **Compact cell (table):**
   - Empty → muted em-dash `—`.
   - Non-empty → truncated count label (`N suppressed`); the compact control **must** expose **every** item line (suppressed title + matched prior) via `title` attribute and/or a visually hidden list — not count-only. Same fields as cards (responsive-list pin).
   - Single-item optional nicety: show truncated suppressed `title` instead of `1 suppressed` (acceptable; count must still be findable via `title`/aria or `data-testid`).

3. **Card row:** Label `Suppressed:` + `RunSuppressSummaryValue`. When `count > 0`, cards **must** list each `formatSuppressItemLine` in visible text (not tooltip-only). Table stays compact; cards use the vertical space.

4. **Item line content (required fields):**
   - Suppressed candidate **title** (`item.title`).
   - Matched prior issue: **`matchedTitle`** plus prior-run identity (below).
   - Similarity is **optional secondary** in the tooltip/line (e.g. `sim 0.91`) — helpful for trust, not a stage AC by itself.

5. **Prior-issue label:**
   - Build `runLookup: Record<string, { endedAt: string | null; startedAt: string }>` on the server from **`allRuns`** (full filtered list before page slice), keyed by `$id`.
   - If `matchedRunId` is in the lookup → format with existing `formatRunDateTime(endedAt ?? startedAt)` (same helper as run Started/Ended).
   - Else → short id fallback: last 6 characters of `matchedRunId` prefixed with `run …` (e.g. `run …ab12cd`).
   - Always include `matchedTitle` in the line so the operator sees *which topic* from that prior issue matched, even when the date resolves.

   Example line: `"New GPU leak" matched prior "GPU rumor roundup" (Jul 10, 2:30 PM)` or `"New GPU leak" matched prior "GPU rumor roundup" (run …ab12cd)`.

6. **Table column:** Add **Suppressed** header after **Failed feeds** (or immediately before Failed feeds — either is fine; prefer **after Failed feeds** to keep failure diagnostics grouped). Update `RunsTable` + `RunListCard` + prop plumbing through `RunsView`.

7. **Server page** (`web/app/(protected)/runs/page.tsx`):
   - After loading `allRuns`, parse each page row’s `suppressSummary` into `suppressSummaryByRun: Record<string, SuppressSummary>`.
   - Build `runLookup` from `allRuns`.
   - Pass both into `RunsView` → `RunsTable` / cards.
   - Keep parse on the server so the shared runtime import stays off the client bundle (same rationale as failed feeds). Client components receive already-parsed plain objects.

### Out of scope

- Changing suppress / lookback / threshold behavior or writing `suppressSummary`.
- New `/runs/[id]` detail route or Stage 06 pipeline inspect UI.
- Showing similarity as a first-class column.
- Linking to the prior run (plain text identity is enough).
- GUI for threshold (feature 05).

## Dependencies

- Builds on: **feature-03-pre-mmr-semantic-suppress** (`suppressSummary` attribute, `Run.suppressSummary`, `parseSuppressSummary` / `SuppressSummary` / `SuppressItem` types).
- Builds on: Stage 04 Runs list UI (`runs/page.tsx`, `RunsView`, `RunsTable`, `RunListCard`, `RunFailedFeedsValue` pattern, responsive list convention).
- Soft: feature 05 is independent (env docs).

## Constraints

- **Display-only** — no pipeline, repository write, or schema attribute changes in this feature (consume feature 03’s field).
- **Do not** invent a second parse path — reuse `parseSuppressSummary`.
- **Responsive domain lists:** same fields on table and cards (AGENTS.md / Plan.md pin).
- **Server parse, client render** — mirror failed-feeds boundary.
- **Secrets:** never log API keys or full env dumps.
- **Do not** add Stage 06 inspect surfaces.

## Acceptance criteria

- [ ] A run with non-empty `suppressSummary` shows the suppression **count** on both table and card presentations.
- [ ] Each suppressed item’s **title** is visible on **both** table (via `title`/visually hidden list on the compact control) **and** cards (visible list text) — not one surface only.
- [ ] Each item shows **which prior issue it matched** on **both** table and cards via `matchedTitle` plus a prior-run label (resolved datetime when that run is in the loaded runs list; short run-id fallback otherwise).
- [ ] Empty / missing / invalid `suppressSummary` shows an em-dash (no false positives).
- [ ] Suppressions display for any status when the field is present (including failed empty-after-suppress runs).
- [ ] No suppress algorithm / threshold / lookback / schema-write changes in this feature.
- [ ] `pnpm --filter web test` (or project web vitest path), `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` pass.
- [ ] **PM manual gate:** after a run with suppressions (or a fixture), open `/runs` and confirm count + titles + matched prior issue on desktop table and narrow card layout.

## Files

- Create: `web/components/runs/run-suppress-summary.tsx`
- Create: `web/src/__tests__/runs-suppress-summary.test.tsx`
- Modify: `web/app/(protected)/runs/page.tsx` (parse + `runLookup` + props)
- Modify: `web/components/runs/runs-view.tsx` (thread props)
- Modify: `web/components/runs/runs-table.tsx` (Suppressed column)
- Modify: `web/components/runs/run-list-card.tsx` (Suppressed row)
- Modify: `web/src/__tests__/runs-failed-feeds.test.tsx` / `runs-responsive-list.test.tsx` (and any `makeRun` helpers) — add `suppressSummary: ""` and new required props so existing fixtures typecheck after feature 03’s `Run` field
- Modify: `shared/src/runs/index.ts` (and package root export if needed) — only if `parseSuppressSummary` / types are not already exported for web
- Modify: `product_spec.md` (one-line Implemented features entry at handoff)

## Testing approach

**Test-first for UI components** (vitest + Testing Library), same spirit as `runs-failed-feeds.test.tsx`. Not pipeline test-first — this feature is presentation. Verifier confirms Intent via component tests + build/typecheck + PM gate.

### `runs-suppress-summary.test.tsx`

Render `RunsTable` (covers table + cards via `ResponsiveList`) with fixtures:

1. **Empty:** `suppressSummary` empty / `count: 0` → em-dash in table + cards (`data-testid` or text `—` in Suppressed cell/row).
2. **Count:** summary with 2 items → visible `2 suppressed` (or equivalent) in table and cards.
3. **Titles (both surfaces):** both suppressed titles appear in the **table** compact control (`title` attribute and/or visually hidden list) **and** in **card** visible list text — assert both slots (`domain-list-table` and `domain-list-cards`).
4. **Matched prior (resolved):** `matchedRunId` present in a `runLookup` built from a second fixture run → on **both** table and cards, the item line includes `matchedTitle` **and** `formatRunDateTime(prior.endedAt ?? prior.startedAt)` imported from `@/components/runs/run-display` (do **not** hard-code a locale-specific date string like `Jul 10, 2:30 PM`).
5. **Matched prior (fallback):** unknown `matchedRunId` → on **both** surfaces, line includes short id fallback **and** `matchedTitle`.
6. **Failed status:** `status: "failed"` with non-empty summary still shows count/titles (not gated on completed).

Update existing runs list tests’ `makeRun` / props so they pass empty suppress maps and typecheck.

### Not required

- Playwright E2E against a live worker.
- Live Appwrite / OpenRouter.

### PM manual gate

1. With feature 03 producing a real `suppressSummary` (or temporarily seeded JSON on a run doc), open `/runs`.
2. Desktop: Suppressed column shows count; hover/inspect reveals titles + matched prior.
3. Narrow viewport: card shows the same information.
4. A run with no suppressions still shows `—`.

## Tasks

### Task 1: Failing UI tests for suppress visibility

- **Action:** Create `web/src/__tests__/runs-suppress-summary.test.tsx` covering Testing approach cases 1–6. Import `RunSuppressSummaryValue` / extend `RunsTable` props that do not exist yet so tests fail on missing UI. Update existing runs `makeRun` fixtures only as needed for compile against feature 03’s `Run.suppressSummary` (empty string).
- **Expected result:** `pnpm --filter web exec vitest run src/__tests__/runs-suppress-summary` (or the repo’s equivalent web test command) exits non-zero on missing component/props/assertions.
- **Verify:** Failures cite missing exports, missing Suppressed column, or unmet text/`title` assertions — not harness misconfig.
- **Depends on:** none (assumes feature 03 types/exports exist or are stub-imported from the feature 03 contract; execute after feature 03 in `ssc-execute` order).

### Task 2: Implement suppress display component + wire Runs list

- **Action:** Implement `web/components/runs/run-suppress-summary.tsx` (`RunSuppressSummaryValue` + format helpers). Wire `page.tsx` to `parseSuppressSummary` + `runLookup` from `allRuns`; thread `suppressSummaryByRun` and `runLookup` through `RunsView` → `RunsTable` / `RunListCard`. Add Suppressed column/row. Export `parseSuppressSummary` from shared if missing. Make Task 1 tests green; fix fallout in other runs list tests.
- **Expected result:** Suppress visibility tests green; table + cards show count / titles / matched prior per Spec; empty → em-dash.
- **Verify:** Targeted web vitest for suppress + failed-feeds + responsive-list green; `pnpm --filter web build` + `pnpm typecheck` zero errors.
- **Depends on:** Task 1; **feature-03 implemented** (`suppressSummary` on `Run` + `parseSuppressSummary`).

### Task 3: Regression + product_spec note

- **Action:** Run full `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`; fix fallout. Update `product_spec.md` Implemented features with one line for Stage 05 feature 04 suppress visibility. Diff-check: no pipeline/threshold/lookback/schema-write changes.
- **Expected result:** Full suite green; product_spec updated; display-only diff.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero.
- **Depends on:** Task 2.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter web exec vitest run src/__tests__/runs-suppress-summary src/__tests__/runs-failed-feeds src/__tests__/runs-responsive-list && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: Suppress UI tests pass (count, titles, matched prior resolved + fallback, empty dash, failed-status still shows). Full suite green. No suppress algorithm changes.

### Stage B — PM manual gate

- On `/runs`, confirm count + suppressed titles + matched prior issue on table and cards as in Testing approach.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `web/components/runs/`, `web/app/(protected)/runs/`, web tests, optional shared export, and `product_spec.md`.
- Confirmation of test/build/typecheck/lint commands and results.
- Confirmation that empty summary → em-dash; non-empty shows count, titles, and matched prior (`matchedTitle` + date or short id).
- Confirmation that parse runs on the server via `parseSuppressSummary`.
- Confirmation that no pipeline / threshold / lookback / schema-write code changed.
- **Research note:** Codegraph on Runs page `parseRunFailedFeeds` + `RunFailedFeedsValue` + `RunsTable`/`RunListCard`; feature 03 locked `suppressSummary` JSON `{ count, items: [{ title, link, matchedRunId, matchedTitle, similarity }] }` with empty `""`. Stage acceptance: “suppression count, each suppressed title, and which prior issue it matched.” No dedicated run detail route today — list row/card *is* the run summary until Stage 06.

## Locked decisions (auto mode 2026-07-13)

1. **Surface:** `/runs` list table + cards (existing run summary) — no new detail page.
2. **Parse:** server-side `parseSuppressSummary`; pass typed maps to client list components.
3. **Empty:** em-dash (match failed feeds).
4. **Compact label:** `N suppressed` (single-item title nicety allowed).
5. **Detail:** every item exposes suppressed `title` + `matchedTitle` + prior-run label on **both** table and cards.
6. **Prior-run label:** `formatRunDateTime` when `matchedRunId` ∈ `runLookup` from `allRuns`; else short id `run …{last6}`. Tests assert via the helper, never hard-coded locale strings.
7. **Status gate:** none — show whenever summary non-empty.
8. **Similarity:** optional in tooltip/line only; not its own column.
9. **Column placement:** Suppressed after Failed feeds.
10. **Display-only** — feature 03 owns persistence.
11. **Grizzled Senior 2026-07-13:** titles + matched-prior required on both surfaces; resolved-date tests use `formatRunDateTime`.
