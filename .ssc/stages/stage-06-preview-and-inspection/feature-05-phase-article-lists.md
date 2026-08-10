# Feature 05: Phase article lists

## Intent

Let the operator audit fetched → scraped → tagged → scored candidates on Inspect — the fields useful for tuning — so pipeline decisions are visible without opening Storage files or leaving the app.

## Spec

Replace Feature 04’s Inspect body placeholder with **four read-only phase sections**. No selection / MMR / suppress (Feature 06). No draft-beside-selected (Feature 07). No draft editing.

### Scope boundary

| In | Out |
|----|-----|
| Fetched, Scraped, Tagged, Scored sections on `/runs/[runId]/inspect` | Selection / MMR drops / suppress audit (Feature 06) |
| Load fetch/scrape/tag/score Storage checkpoints when present | Draft markdown (Feature 07) |
| Responsive table + cards per section | Editing, pin/drop, delivery |
| Per-section missing / empty / load-error states | Top-level Inspect nav; Issues-list Inspect |

Keep Feature 04 chrome unchanged: **Back to Runs**, heading **Inspect**, meta line, optional phase hint. **Remove** the locked placeholder `Pipeline phase details coming in later features.` once these sections render.

### Checkpoint loading (locked)

Inspect already has a `Run` from Feature 04’s `getRun`. Do **not** call `loadPhaseCheckpoint` four times in a way that re-fetches the run document four times.

Add a shared helper (prefer `shared/src/runs/repository.ts` or a small sibling module exported from the runs barrel):

```ts
loadPhaseCheckpointFromRun(
  client: Client,
  run: Run,
  phase: "fetch" | "scrape" | "tag" | "score",
): Promise<FetchCheckpoint | ScrapeCheckpoint | TagCheckpoint | ScoreCheckpoint>
```

Behavior:

1. Resolve file id from `run` via the same `CHECKPOINT_FIELD` map as `loadPhaseCheckpoint` (`checkpointFetchId` / `checkpointScrapeId` / `checkpointTagId` / `checkpointScoreId`).
2. Empty / missing id → throw `RunRepositoryError("checkpoint_missing", …)` (same contract as `loadPhaseCheckpoint`).
3. Download + parse + revive via the existing Storage path / `reviveCheckpoint` (reuse internals; do not fork JSON shapes).
4. Does **not** call `getRun`.

Optional thin wrapper for the page (web or shared) that loads all four in parallel with `Promise.allSettled` (or equivalent) and maps each outcome to a typed result the UI can render without failing the whole page:

```ts
type PhaseLoadResult<T> =
  | { status: "loaded"; data: T }
  | { status: "missing" }           // no checkpoint id, or RunRepositoryError code === "checkpoint_missing"
                                    // (includes Storage 404 and corrupt/unreadable JSON — same as loadPhaseCheckpoint today)
  | { status: "error" };            // code === "appwrite" / unexpected — safe UI only
```

Map outcomes to match existing repository codes — **do not invent a separate “parse” UI path.** Corrupt/unreadable JSON already surfaces as `checkpoint_missing` from `loadPhaseCheckpoint`; `loadPhaseCheckpointFromRun` must keep that contract.

Only attempt download when the corresponding checkpoint id is a non-empty string; otherwise treat as `missing` without hitting Storage.

Do **not** load `selection` or `draft` in this feature.

### Sections (locked order & labels)

Render four sections top-to-bottom:

1. **Fetched**
2. **Scraped**
3. **Tagged**
4. **Scored**

Each section heading includes the article count when loaded: e.g. **`Fetched (42)`**. When missing or error, omit the count (heading is just the phase label). Count and empty checks use the **phase array property** below — not a uniform `.articles` on every payload.

### Per-phase fields (locked — pins stage open question)

Do **not** show full article `content` in these lists (bodies are large; tuning at this stage uses title / source / tags / score / link).

| Section | Array property (count / empty / rows) | List columns / card fields | Extra |
|---------|---------------------------------------|----------------------------|--------|
| **Fetched** | `articles` | Title, Source, Published, Link | Optional **Failed feeds** sub-line when `parseRunFailedFeeds(run.failedFeeds)` is non-empty — reuse existing Runs display helper / format (names via feed lookup only if already cheap on this page; otherwise URLs). Not required to load `listFeeds` solely for this. |
| **Scraped** | `articles` | Title, Source, Published, Link | Quiet summary line under heading when loaded: **`Extracted {extracted} · Fallback {fallback} · Total {total}`** from `ScrapeCheckpoint.summary`. |
| **Tagged** | `taggedArticles` | Title, Source, Tags, Published, Link | Tags: comma-joined; truncate in table with full text in `title` attribute. |
| **Scored** | `scoredArticles` | Title, Score, Source, Tags, Published, Link | Sort **score descending** (stable: equal scores keep relative order). Display score as stored number (no forced decimals beyond what JS stringification of the number already is; prefer `String(score)` or locale-neutral fixed display — do not invent letter grades). |

**Published:** locale short date from `article.published` (`dateStyle: "short"`). Checkpoint revive yields `Date` — format on the server or in the component.

**Link:** external anchor, `target="_blank"` + `rel="noopener noreferrer"`. Visible label may be truncated URL or locked **Open**; full URL in `title` / `href`.

**Title:** truncate in table with full text in `title` attribute; wrap OK on cards.

Row identity: prefer `link` as React key; if duplicates, `link + published ISO + index`.

### Empty / missing / error (locked copy)

| Condition | UI inside that section |
|-----------|------------------------|
| Checkpoint id empty, **or** `RunRepositoryError` with `code === "checkpoint_missing"` (includes Storage not-found **and** corrupt/unreadable JSON — same as today’s `loadPhaseCheckpoint`) | Locked: **`No checkpoint for this phase yet.`** |
| Checkpoint loaded, phase array length 0 (`articles` / `taggedArticles` / `scoredArticles` per table above) | Locked: **`No articles in this checkpoint.`** (still show scrape summary if scrape + summary present) |
| `RunRepositoryError` with `code === "appwrite"`, or unexpected throw | Destructive `Alert` with locked **`Couldn’t load this phase.`** Log server-side without secrets (sanitize like Runs). Do **not** use the error’s `.message` as user-facing copy. Other sections still render. Do **not** treat parse/corrupt as this Alert path — those are `checkpoint_missing` → missing copy. |

Shell-level not-found / run load errors remain Feature 04’s responsibility — this feature only replaces the success-path body.

### Layout / responsive

- Each section’s article list uses **`ResponsiveList`**: table on `md+`, stacked cards on phone — same fields/actions (here: no row actions beyond the external Link). Follow Stage 03 Feature 06 / AGENTS.md GUI convention.
- Sections stack vertically with clear headings; readable on phone (no horizontal-only critical info).
- No pagination inside a phase list in V1 — show all articles in the checkpoint.

### Suggested file layout

- Modify: `shared/src/runs/repository.ts` (or sibling) — `loadPhaseCheckpointFromRun`
- Test: `shared/src/runs/__tests__/repository.test.ts` (or dedicated) — FromRun missing id / success path with mocked Storage
- Modify: `web/app/(protected)/runs/[runId]/inspect/page.tsx` and/or `web/components/runs/inspect-shell.tsx` — load phases; replace placeholder
- Create: `web/components/runs/inspect-phase-section.tsx` (and/or `inspect-article-list.tsx`) — section chrome + ResponsiveList
- Test: `web/src/__tests__/inspect-phase-lists.test.tsx` — required coverage per Testing approach
- Do **not** modify `web/lib/nav-items.ts` for Inspect

## Dependencies

- Builds on: **feature-04-inspect-entry** — Inspect route, shell chrome, `getRun`, not-available / load-error shell behavior, placeholder to replace.
- Builds on: Stage 04 **feature-01-run-checkpoints** — `loadPhaseCheckpoint` / Storage shapes (`FetchCheckpoint`, `ScrapeCheckpoint`, `TagCheckpoint`, `ScoreCheckpoint`), checkpoint id fields on `Run`.
- Builds on: Stage 03 **feature-06** / `ResponsiveList` — table/cards convention.
- Consumed later by: **feature-06-selection-and-suppress-audit**, **feature-07-draft-inspect** (append sections below / beside these).

## Constraints

- **Read-only** — no edit of articles, scores, tags, or draft.
- **No selection / suppress / draft** UI in this feature.
- **No top-level Inspect nav.**
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- **Reuse** existing checkpoint wire types — do not invent a parallel article DTO for Inspect.
- Do **not** call `getRun` once per phase when the run is already loaded.
- Labels / empty / error copy locked as Spec.

## Acceptance criteria

- [ ] Inspect success path shows four sections in order: Fetched, Scraped, Tagged, Scored (no Feature 04 placeholder body).
- [ ] Each section loads from the run’s checkpoint id when present via a helper that does not re-`getRun` per phase; missing phases show locked “No checkpoint…” copy.
- [ ] Fetched / Scraped / Tagged / Scored lists show the locked fields; Scraped shows summary line; Scored is sorted by score descending; full `content` is not listed.
- [ ] Empty checkpoint arrays show locked “No articles…” copy; per-phase load errors show locked Alert without failing sibling sections.
- [ ] Each list uses ResponsiveList (table + cards) with the same fields.
- [ ] Selection, suppress, and draft audit content are **not** present.
- [ ] Automated tests cover helpers + section states per Testing approach; `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Create: `web/components/runs/inspect-phase-section.tsx` (and optional `inspect-article-list.tsx`)
- Create: `web/src/__tests__/inspect-phase-lists.test.tsx`
- Modify: `shared/src/runs/repository.ts` (or sibling + barrel export) — `loadPhaseCheckpointFromRun`
- Modify: `shared/src/runs/__tests__/repository.test.ts` (or new shared test)
- Modify: `web/app/(protected)/runs/[runId]/inspect/page.tsx` and/or `web/components/runs/inspect-shell.tsx`
- Do **not** modify: `web/lib/nav-items.ts` for Inspect

## Testing approach

Not fully test-first for live Appwrite Storage. **Required** unit/component tests with fixtures (no live Appwrite). Build/typecheck gate.

1. **`loadPhaseCheckpointFromRun` (required):** empty checkpoint id → `checkpoint_missing`; with a fixture `Run` + mocked download returning valid fetch JSON → revived `FetchCheckpoint` (published as `Date`); does not call `getRun` (spy/assert if practical).
2. **Missing section (required):** section with `status: "missing"` renders locked **`No checkpoint for this phase yet.`**
3. **Empty arrays (required):** loaded scrape/fetch with `articles: []` **and** at least one of tagged with `taggedArticles: []` or scored with `scoredArticles: []` each render locked **`No articles in this checkpoint.`** (proves the per-phase array property pin, not a uniform `.articles`).
4. **Scrape summary (required):** loaded scrape with summary shows **`Extracted … · Fallback … · Total …`** with the fixture numbers.
5. **Scored sort (required):** scored fixtures out of order render in score-descending order in table and cards.
6. **Fields present (required):** fixture tagged/scored rows expose title, source, tags (and score for scored); no full `content` string rendered as a column/card field.
7. **Phase error (required):** `status: "error"` shows locked **`Couldn’t load this phase.`**; sibling section with loaded data still visible when both rendered together.
8. **Placeholder gone (required):** success-path Inspect body with phase props does **not** include `Pipeline phase details coming in later features.`
9. **ResponsiveList (required):** each article list mounts both `data-slot="domain-list-table"` and `data-slot="domain-list-cards"` (same pattern as other domain lists).

## Tasks

### Task 1: `loadPhaseCheckpointFromRun` + tests

- **Action:** Add `loadPhaseCheckpointFromRun` in `shared/src/runs/` (repository or sibling), export from the runs barrel. Reuse download/parse/revive used by `loadPhaseCheckpoint`. Add required shared tests (Testing approach item 1). Optionally keep `loadPhaseCheckpoint` as `getRun` + `loadPhaseCheckpointFromRun` to avoid duplicated download logic.
- **Expected result:** Callers with an in-memory `Run` can load fetch/scrape/tag/score without a second document fetch.
- **Verify:** Shared tests for missing id + successful fetch revive pass; `pnpm typecheck` green for shared.
- **Depends on:** none (Stage 04 repository already exists).

### Task 2: Phase section UI components + tests

- **Action:** Build read-only section + article list components under `web/components/runs/` using `ResponsiveList`, locked headings/fields/copy, scrape summary, scored sort, external links. Cover Testing approach items 2–7 and 9 with fixture props (no Appwrite).
- **Expected result:** Sections are unit-testable without the page; table and cards show the same fields.
- **Verify:** `inspect-phase-lists.test.tsx` (or equivalent) passes items 2–7 and 9; `pnpm --filter web build` and typecheck green.
- **Depends on:** none (can parallelize with Task 1; wire in Task 3).

### Task 3: Wire Inspect page — load four phases, replace placeholder

- **Action:** On Inspect success path, load the four candidate phases in parallel from the already-fetched `Run` via `loadPhaseCheckpointFromRun` (mapping missing/error per Spec). Pass results into the section components. Remove Feature 04 placeholder body. Do not load selection/draft.
- **Expected result:** Visiting Inspect for a run with checkpoints shows populated sections; mid-pipeline / failed runs show missing copy for unfinished phases.
- **Verify:** Testing approach item 8 (placeholder gone); build/typecheck green; existing Feature 04 shell tests still pass (update any that asserted the placeholder — replace with phase-section expectations).
- **Depends on:** Tasks 1–2.

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no selection/suppress/draft creep, no nav item, no full content columns, no per-phase `getRun`; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: open Inspect on a completed run and confirm four phase lists with expected fields/summary/score order; open a failed mid-pipeline run and confirm later phases show “No checkpoint…”; confirm no selection/draft sections yet.

## Handoff

Builder reports: files created/modified; confirmation that placeholder is gone; four sections only (fetch→score); `loadPhaseCheckpointFromRun` avoids per-phase `getRun`; field/summary/sort/empty/error copy matches Spec; any deviations and why.

**Research note:** Codegraph — checkpoint types and `loadPhaseCheckpoint` in `shared/src/runs/types.ts` / `repository.ts` (fetch/scrape/tag/score payloads; embeddings stripped on score); Feature 04 shell placeholder + route; `ResponsiveList` at `web/components/domain-list/responsive-list.tsx`; Feature 02 loads draft via `loadPhaseCheckpoint` (re-getRun OK for single phase — Inspect loads four, so FromRun is required). Stage open question “Exact per-phase fields” pinned in Spec table. Auto decisions (2026-07-14): no full content column; scored sort desc; scrape summary line; failed-feeds optional under Fetched; per-section missing/empty/error copy; parallel load without selection/draft. Grizzled Senior (2026-07-14, PM accepted): pin array props `articles` / `taggedArticles` / `scoredArticles`; map corrupt/parse to `checkpoint_missing` → missing copy (match `loadPhaseCheckpoint`), not the Alert path.
