# Feature 06: Selection & suppress audit

## Intent

Let the operator see on Inspect what was selected, what selection dropped (threshold / MMR / embed), and what cross-run suppress removed (with prior-issue match context) — so pipeline curation decisions are auditable for tuning without opening Storage files.

## Spec

Append **three read-only audit sections** below Feature 05’s Scored section on `/runs/[runId]/inspect`. No draft-beside-selected (Feature 07). No editing, pin/drop, or delivery.

### Scope boundary

| In | Out |
|----|-----|
| Persist `SelectionResult.failures` on the selection checkpoint (wire + save path) | Draft markdown / draft-beside-selected (Feature 07) |
| Inspect sections: Selected, Selection drops, Suppressed | Editing, pin/drop, delivery |
| Load selection checkpoint via FromRun (no re-`getRun`); parse `run.suppressSummary` | Changing suppress / MMR algorithms or thresholds |
| Prior-issue labels for suppress items when matched runs resolve | Top-level Inspect nav; Issues-list Inspect |
| ResponsiveList for each section’s rows | Full article `content` columns |

Keep Feature 04/05 chrome unchanged. Do **not** remove or reorder Fetched → Scored.

### Why checkpoint must change (locked)

Today `SelectionCheckpoint` stores only `selectedArticles`. `SelectionResult.failures` (`below-threshold` | `embedding-failed` | `not-selected`) is computed in-memory and discarded — Inspect cannot show “what MMR dropped” from Storage.

This feature **extends the selection checkpoint wire format** (Storage JSON only — **no** new Appwrite collection/attribute):

```ts
// SelectionCheckpoint / SelectionCheckpointInput (after this feature)
{
  selectedArticles: SelectedArticleJson[]; // unchanged; never persist embedding
  failures: SelectionFailureJson[];        // NEW — optional on read for back-compat
}

type SelectionFailureJson = {
  articleTitle: string;
  articleLink: string;
  reason: "below-threshold" | "embedding-failed" | "not-selected";
  error?: string;
};
```

**Write path (locked):**

1. Update `SelectionCheckpointInput` / `SelectionCheckpoint` in `shared/src/runs/types.ts`.
2. Update `serializeCheckpoint` / `reviveCheckpoint` for `"selection"` to include `failures`.
   - **Serialize always emits the `failures` key**, including when the array is empty (`"failures": []`). Never omit the key for “no drops” — omission is reserved for **legacy** pre-feature files so Inspect can tell “weren’t saved” from “none dropped.”
   - **Revive:** key missing → legacy (see Legacy detection below); key present (including `[]`) → failures recorded.
3. Update `execute-run.ts` so every successful `selector(...)` call that reaches the save point persists:

   ```ts
   await savePhaseCheckpoint(client, runId, "selection", {
     selectedArticles: selectionResult.selectedArticles.map(toScoredArticleJson),
     failures: selectionResult.failures, // plain SelectionFailure objects; always pass the array (may be [])
   });
   ```

4. **Empty selection with a `SelectionResult`:** when `selectedArticles.length === 0` after `selector(...)`, still save the selection checkpoint (`selectedArticles: []`, `failures: selectionResult.failures`) **before** `markFailed` — so Inspect can explain empty selection. Do **not** invent a checkpoint on the empty-after-suppress early return (no `SelectionResult` yet; suppress summary alone is enough).

   **Retry / `completedPhase` (locked):** `savePhaseCheckpoint` advances `completedPhase` to `"selection"`. That would make Retry skip suppress/selection and resume at draft with an empty selection. After the empty-selection checkpoint save, call `markFailed` with **`completedPhase: "score"`** (last successful candidate phase) so Retry still re-enters selection. Inspect loads via `checkpointSelectionId` and does **not** depend on `completedPhase`. Example shape:

   ```ts
   await savePhaseCheckpoint(client, runId, "selection", {
     selectedArticles: [],
     failures: selectionResult.failures,
   });
   await markFailed(client, runId, {
     failedPhase: "selection",
     failureMessage: "No articles selected",
     completedPhase: "score",
   });
   ```

5. Resume path that loads an existing selection checkpoint must tolerate missing `failures` (legacy → treat drops as unrecorded / empty list for resume hydration — resume only needs `selectedArticles`).

Do **not** change Appwrite schema declarations for this.

### Checkpoint / suppress loading (locked)

Feature 05 introduces `loadPhaseCheckpointFromRun` for fetch/scrape/tag/score. **Extend** it to accept `"selection"` (same missing / corrupt → `checkpoint_missing` contract; no `getRun`).

On Inspect success path (run already loaded):

1. Load selection via `loadPhaseCheckpointFromRun(client, run, "selection")` mapped to the same `PhaseLoadResult<SelectionCheckpoint>` pattern as Feature 05.
2. Parse suppress with existing `parseSuppressSummary(run.suppressSummary)` — **no** Storage download. Always available as a typed `SuppressSummary` (`count === 0` / empty items when blank/invalid).

Do **not** load draft in this feature.

### Sections (locked order & labels)

Append below **Scored**, top-to-bottom:

1. **Selected**
2. **Selection drops**
3. **Suppressed**

Heading counts when data is loaded:

| Section | Count source |
|---------|--------------|
| **Selected (N)** | `selectedArticles.length` when selection checkpoint `loaded` |
| **Selection drops (N)** | `failures.length` when selection checkpoint `loaded` |
| **Suppressed (N)** | `summary.count` from parsed suppress (always “loaded” from the run doc) |

Omit the count suffix when Selected / Selection drops are missing or error (same as Feature 05). Suppressed always has a count (including `0`).

### Per-section fields (locked)

Do **not** show full article `content`.

| Section | Rows when | List columns / card fields | Notes |
|---------|-----------|----------------------------|--------|
| **Selected** | selection `loaded` | Title, Score, Source, Tags, Published, Link | Sort score descending (stable). Same field treatment as Scored in Feature 05. |
| **Selection drops** | selection `loaded` | Title, Reason, Detail, Link | **Reason** locked display map: `below-threshold` → `Below score threshold`; `not-selected` → `Not selected by MMR`; `embedding-failed` → `Embedding failed`. **Detail:** `error` string when present, else em-dash. Prefer `articleLink` as key. |
| **Suppressed** | always (from run) | Title, Matched prior, Prior issue, Similarity, Link | From `SuppressItem`: `title`, `matchedTitle`, prior-issue label, `similarity` (display as stored number, e.g. `String(similarity)` or up to 2–3 decimal places — pick one and keep consistent), `link`. |

**Published / Link / Title / Tags / Score:** same conventions as Feature 05 (locale short date; external link `target="_blank"` + `rel="noopener noreferrer"`; truncate + `title` attribute in tables).

### Prior-issue label (locked)

Reuse Stage 05 display helpers where practical (`formatPriorIssueLabel` / `formatRunDateTime` from `web/components/runs/run-suppress-summary.tsx` / `run-display`).

On the Inspect page (server):

1. Collect unique non-empty `matchedRunId` values from suppress items.
2. Best-effort resolve each via `getRun` (or a small parallel helper). Build `RunLookup` keyed by `$id` with `{ endedAt, startedAt }`.
3. Failures to resolve a prior run → short-id fallback already defined by Stage 05 (`run …` + last 6 chars). Do **not** fail the Inspect page if a prior `getRun` 404s.
4. Optional nicety (allowed, not required): make Prior issue a `Link` to `inspectRunHref(matchedRunId)` when the id is non-empty — plain text is enough for AC.

### Empty / missing / error (locked copy)

**Selected** (selection checkpoint):

| Condition | UI |
|-----------|-----|
| `missing` (`checkpoint_missing` / empty id) | **`No checkpoint for this phase yet.`** |
| `loaded` && `selectedArticles.length === 0` | **`No articles in this checkpoint.`** |
| `error` | Destructive Alert **`Couldn’t load this phase.`** (siblings still render; never surface `.message`) |

**Selection drops** (same selection load result):

| Condition | UI |
|-----------|-----|
| selection `missing` | **`No checkpoint for this phase yet.`** (same load — do not double-download) |
| selection `loaded` && `failures` key was **absent** in JSON (legacy) **and** `failures` revived as empty **and** `selectedArticles.length > 0` | **`Selection drop details weren’t saved for this run.`** |
| selection `loaded` && failures array present (including explicitly `[]`) && `failures.length === 0` | **`No articles dropped by selection.`** |
| selection `loaded` && `failures.length > 0` | Render the ResponsiveList |
| selection `error` | Same Alert as Selected (**`Couldn’t load this phase.`**) — one Alert shared for the selection load is OK; do not spam two identical Alerts. Prefer one Alert above both Selected + Selection drops when status is `error`. |

**Legacy detection (locked):** revive must distinguish “key missing” vs “key present as `[]`”. Prefer `failures: SelectionFailure[]` plus `failuresRecorded: boolean` on the checkpoint type, **or** `failures?: …` where `undefined` means legacy and `[]` means none. Serialize **always** writes the key (pin above) so new empty-drop runs never look legacy. Tests must cover both legacy (no key) and explicit empty.

**Suppressed:**

| Condition | UI |
|-----------|-----|
| `count === 0` | **`No cross-run suppressions.`** |
| `count > 0` | ResponsiveList of items |

Suppress never uses the Feature 05 “No checkpoint…” copy — it is not a Storage phase.

### Layout / responsive

- Each section’s row list uses **`ResponsiveList`** (table `md+` / cards phone) — Stage 03 Feature 06 / AGENTS.md.
- Sections stack vertically under Scored; readable on phone.
- No pagination in V1.

### Suggested file layout

- Modify: `shared/src/runs/types.ts` — selection checkpoint + failures
- Modify: `shared/src/runs/repository.ts` — serialize/revive selection; extend `loadPhaseCheckpointFromRun` phase union to `"selection"`
- Modify: `shared/src/runs/execute-run.ts` — persist failures (always emit key); empty-selection save then `markFailed` with `completedPhase: "score"`
- Test: `shared/src/runs/__tests__/repository.test.ts` (and/or execute-run tests) — failures round-trip; always-emit `failures`; legacy revive; empty-selection save + Retry completedPhase
- Modify: `web/app/(protected)/runs/[runId]/inspect/page.tsx` and/or `web/components/runs/inspect-shell.tsx` — load selection + parse suppress; render three sections
- Create/extend: `web/components/runs/inspect-selection-section.tsx` (and/or reuse `inspect-phase-section` patterns)
- Test: `web/src/__tests__/inspect-selection-suppress.test.tsx`
- Do **not** modify `web/lib/nav-items.ts`

## Dependencies

- Builds on: **feature-05-phase-article-lists** — Inspect sections chrome, `loadPhaseCheckpointFromRun` / `PhaseLoadResult`, ResponsiveList phase patterns, Scored as the insert-after anchor.
- Builds on: **feature-04-inspect-entry** — Inspect route + shell.
- Builds on: Stage 04 selection checkpoint save/load; Stage 01 `SelectionFailure` / `SelectionResult`.
- Builds on: Stage 05 `suppressSummary` + `parseSuppressSummary` + `SuppressItem` / `SuppressSummary` + Runs suppress display helpers.
- Consumed later by: **feature-07-draft-inspect** (draft beside selected — uses selected list, not this audit).

## Constraints

- **Read-only** Inspect UI — no edit of selection, suppress, or draft.
- **No draft** UI in this feature.
- **No top-level Inspect nav.**
- **No Appwrite schema attribute changes** — Storage JSON wire extension only.
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- **Backward compatible** revive of pre-feature selection checkpoints (no `failures` key).
- **Serialize always emits `failures`** (including `[]`) — never omit on write.
- **Empty-selection fatal path:** `markFailed` with `completedPhase: "score"` so Retry does not skip to draft.
- Labels / empty / error copy locked as Spec.
- Do **not** call `getRun` once per phase when the run is already loaded (selection FromRun). Prior-run lookups for suppress labels are separate best-effort `getRun`s by matched id.

## Acceptance criteria

- [ ] Selection checkpoint wire includes `failures`; new runs persist `SelectionResult.failures` with the key **always** present on serialize (including `[]`); legacy checkpoints without `failures` still load.
- [ ] Empty `SelectionResult` (0 selected) still writes a selection checkpoint with failures before markFailed (when selector ran), and `markFailed` passes `completedPhase: "score"` so Retry re-enters selection.
- [ ] Inspect shows **Selected**, **Selection drops**, and **Suppressed** below Scored, with locked fields and ResponsiveList.
- [ ] Selection drops show Reason via the locked display map; Detail shows `error` when present.
- [ ] Suppressed shows titles + matched prior + prior-issue context (resolved datetime or short-id fallback) + similarity; empty suppress shows locked “No cross-run suppressions.”
- [ ] Missing selection checkpoint shows locked missing copy for Selected / Selection drops; suppress still renders from the run document.
- [ ] Legacy selection checkpoint (selected present, failures never recorded) shows locked “Selection drop details weren’t saved for this run.”
- [ ] Draft audit content is **not** present; no nav item for Inspect.
- [ ] Automated tests cover persistence + UI states per Testing approach; `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/runs/types.ts`
- Modify: `shared/src/runs/repository.ts` (serialize/revive + FromRun `"selection"`)
- Modify: `shared/src/runs/execute-run.ts`
- Modify: `shared/src/runs/__tests__/repository.test.ts` and/or `execute-run.test.ts`
- Modify: `web/app/(protected)/runs/[runId]/inspect/page.tsx` and/or `web/components/runs/inspect-shell.tsx`
- Create: `web/components/runs/inspect-selection-section.tsx` (name flexible if folded into existing inspect components)
- Create: `web/src/__tests__/inspect-selection-suppress.test.tsx`
- Do **not** modify: `web/lib/nav-items.ts`; Appwrite `declarations.ts` schema attributes

## Testing approach

Not fully test-first for live Appwrite. **Required** unit/component tests with fixtures (no live Appwrite). Build/typecheck gate.

1. **Selection serialize/revive (required):** save/load (or serialize/revive unit) includes `failures`; serialize of a payload with empty failures still emits `"failures": []` (key present); revived articles still have `Date` published and no `embedding`.
2. **Legacy revive (required):** JSON with only `selectedArticles` (no `failures` key) loads; UI/flag treats drops as “weren’t saved” when selected non-empty.
3. **Empty selection persist (required):** execute-run path (mocked) when selector returns `selectedArticles: []` with non-empty failures calls `savePhaseCheckpoint` for `"selection"` with those failures **before** `markFailed`, and `markFailed` is invoked with `completedPhase: "score"` (completed phase must not remain `"selection"` after this fatal path).
4. **Selected section (required):** loaded fixture with selected rows renders titles/scores; empty selected array shows locked **`No articles in this checkpoint.`**
5. **Selection drops reasons (required):** fixture failures for all three reasons render the locked Reason labels; Detail shows error text when present.
6. **Legacy drops copy (required):** legacy fixture shows **`Selection drop details weren’t saved for this run.`**
7. **Explicit empty drops (required):** `failures: []` with selected articles shows **`No articles dropped by selection.`**
8. **Suppressed list (required):** non-empty `SuppressSummary` renders title, matchedTitle, prior label (fixture lookup), similarity; `count === 0` shows **`No cross-run suppressions.`**
9. **Missing selection + present suppress (required):** selection `missing` shows missing copy; suppress section still lists items from parsed summary (empty-after-suppress style).
10. **ResponsiveList (required):** Selected / Selection drops / Suppressed lists mount both `data-slot="domain-list-table"` and `data-slot="domain-list-cards"` when they have rows.
11. **No draft creep (required):** success-path body with these sections does not render draft markdown / Feature 07 chrome.

## Tasks

### Task 1: Selection checkpoint wire + persist failures

- **Action:** Extend `SelectionCheckpoint` / `SelectionCheckpointInput` with `failures` (and legacy-detection approach). Update `serializeCheckpoint` to **always emit** `"failures"` (including `[]`); update `reviveCheckpoint` for missing-key legacy. Update `execute-run.ts` to persist `failures` on every selection save; on zero selected, save the checkpoint then `markFailed` with `completedPhase: "score"`. Cover Testing approach items 1–3.
- **Expected result:** New runs store selection drops with a trustworthy empty-vs-legacy distinction; old checkpoints still load; empty-selection failures are auditable without breaking Retry.
- **Verify:** Shared tests for round-trip, always-emit empty `failures`, legacy revive, empty-selection save-before-markFailed, and `markFailed` `completedPhase: "score"` pass; `pnpm typecheck` green for shared.
- **Depends on:** none (Stage 04/05 types already exist).

### Task 2: Extend FromRun for selection + Inspect UI sections + tests

- **Action:** Extend `loadPhaseCheckpointFromRun` to `"selection"`. Build Selected / Selection drops / Suppressed section components (ResponsiveList, locked fields/copy, reason map, prior-issue labels). Cover Testing approach items 4–11 with fixtures.
- **Expected result:** Sections are unit-testable without live Appwrite; table and cards share fields.
- **Verify:** `inspect-selection-suppress.test.tsx` (or equivalent) passes items 4–11; `pnpm --filter web build` and typecheck green.
- **Depends on:** Task 1 for types; Feature 05 FromRun/patterns must exist when wiring (execute Features 05 then 06 in stage order).

### Task 3: Wire Inspect page — load selection + suppress, append sections

- **Action:** On Inspect success path, after Feature 05 phases, load selection via FromRun; `parseSuppressSummary(run.suppressSummary)`; best-effort prior-run lookup for suppress labels; render the three sections below Scored. Do not load draft.
- **Expected result:** Completed runs show selected + drops + suppress; empty-after-suppress failed runs show suppress with missing selection copy; legacy runs show legacy drops copy.
- **Verify:** Integration via component tests + existing Inspect shell/phase tests still pass (update fixtures as needed); build/typecheck green.
- **Depends on:** Tasks 1–2; Feature 05 sections present.

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no draft/nav/schema creep; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: open Inspect on a completed run with suppressions and confirm Selected + Selection drops (with reasons) + Suppressed (matched prior); open an empty-after-suppress failed run and confirm suppress list with missing selection checkpoint copy; confirm no draft section yet.

## Handoff

Builder reports: files created/modified; confirmation that selection wire always emits `failures` (including `[]`); empty-selection saves before markFailed with `completedPhase: "score"`; three sections below Scored only; legacy vs explicit-empty drops copy; suppress from `parseSuppressSummary`; FromRun used for selection (no per-phase `getRun`); any deviations and why.

**Research note:** Codegraph — `SelectionCheckpoint` only had `selectedArticles` (`shared/src/runs/types.ts`); `execute-run.ts` discarded `selectionResult.failures` on save; `SelectionFailure.reason` already includes `not-selected` (Plan.md carry-forward pin); Stage 05 `parseSuppressSummary` + `RunSuppressSummaryValue` / `formatPriorIssueLabel` for prior-issue UX; Feature 05 pins FromRun + ResponsiveList + missing/empty/error copy. Auto decisions (2026-07-14): extend selection Storage JSON (no Appwrite schema change); section title **Selection drops** (threshold + MMR + embed — not “MMR-only”); persist empty selection before markFailed; legacy “weren’t saved” vs explicit empty copy; suppress always from run doc; prior-run best-effort lookup with Stage 05 short-id fallback. Grizzled Senior pins accepted (2026-07-14): serialize always emits `failures`; empty-selection `markFailed` uses `completedPhase: "score"` so Retry does not skip to draft.
