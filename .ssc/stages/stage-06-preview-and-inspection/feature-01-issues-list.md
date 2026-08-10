# Feature 01: Issues list

## Intent

Give the operator a top-level Issues destination that lists only completed drafts (display title, newsletter, date), filterable by newsletter, so everyday reading has a dedicated surface separate from operational Runs history.

## Spec

Ship `/issues` as the Stage 06 reading entry point. No separate Issues Appwrite collection — completed-run drafts remain the source of truth. No markdown reader (Feature 02), no heading-based display title (Feature 03), no Inspect (Features 04–07).

### Eligibility: “completed draft”

A run qualifies as an issue when **both** are true:

1. `status === "completed"`
2. `checkpointDraftId` is a non-empty string

Rationale (codebase): `executeRun` only calls `markCompleted` after a non-empty draft checkpoint is saved; empty drafts are `markFailed` and never complete. Filtering on both fields stays correct if a completed row ever lacks a draft id.

Do **not** download draft Storage files in this feature (N+1). Display title uses the Feature 01 fallback only (Feature 03 upgrades it).

### Repository: `listIssues`

Add to `shared/src/runs/` (prefer `shared/src/runs/issues.ts`, or extend `repository.ts` if that keeps exports cleaner — pick one home and export from the runs barrel):

```ts
listIssues(
  client: Client,
  opts?: {
    newsletterId?: string;
    limit?: number; // default 100
  },
): Promise<Run[]>
```

Behavior:

1. Call existing `listRuns(client, { status: "completed", newsletterId: opts?.newsletterId, limit: opts?.limit ?? 100 })`.
2. Keep only runs where `checkpointDraftId.trim() !== ""`.
3. Sort **in memory** newest-first by `(endedAt ?? startedAt)` descending (ISO string compare), then `$id` descending for stability — same lookback/retention “issue age” preference (`endedAt` when present).
4. Do **not** add Appwrite indexes or a new collection.

Export `listIssues` from the runs barrel / shared package index as needed.

Also export a pure display helper (same module or `shared/src/runs/issue-display.ts`) used by the GUI and unit-tested:

```ts
formatIssueFallbackTitle(newsletterName: string, dateIso: string): string
// → `${newsletterName} — ${locale date from dateIso}`
// date portion: `new Date(dateIso).toLocaleDateString(undefined, { dateStyle: "short" })`
```

Feature 03 will introduce heading extraction and may replace list callers; keep this helper available as the fallback.

### Nav

Modify `web/lib/nav-items.ts`:

- Insert **Issues** after **Newsletters** and before **Runs**.
- `href: "/issues"`.
- Icon: `BookOpen` from `lucide-react` (reading surface).

Update `web/src/__tests__/feeds-nav.test.ts` (or rename/extend to a general nav order test) so the pinned title order becomes:

`Dashboard`, `Feeds`, `Newsletters`, `Issues`, `Runs`, `Schedules`, `Prompts`, `Delivery`

and assert Issues → `/issues`.

### GUI — `/issues`

Create `web/app/(protected)/issues/page.tsx` (server component). Mirror Runs/Feeds page chrome patterns.

**Page chrome:**

- Heading **Issues**
- Supporting line (locked): `Completed drafts ready to read — filter by newsletter.`
- Load issues via `listIssues(getServerAppwrite(), { newsletterId })` from search params.
- Load newsletters via `listNewsletters` for the filter dropdown (names + ids).
- **Pagination:** 20 per page (`?page=`), same clamp/redirect-to-last-page pattern as Runs/Feeds/Newsletters. Empty state only when total is zero after filters, not when a high page is empty.
- **Filter** (query param; preserve across pagination):

| Param | Behavior |
|-------|----------|
| `newsletterId` | Restrict to that newsletter. UI: Select with “All newsletters” (clears param) plus one option per newsletter (`name` label, `$id` value). |

No status filter on Issues (eligibility is always completed draft).

**List** — use shared `ResponsiveList` (table on `md+`, stacked cards below `md`). Same fields and actions in both presentations (Stage 03 Feature 06 / AGENTS.md GUI convention). Empty state is **not** wrapped in `ResponsiveList`.

| Column / field | Content |
|----------------|---------|
| Title | `formatIssueFallbackTitle(newsletterName, endedAt ?? startedAt)` — truncate on table with full text in `title` attribute; wrap OK on cards |
| Newsletter | `newsletterName` |
| Date | Locale short **date** from `endedAt ?? startedAt` (`dateStyle: "short"` only — not full datetime) |
| Actions | **Open** control (label locked) linking to `/issues/[runId]` |

**Open / navigation:**

- Each row and card exposes **Open** as a `Link` to `/issues/${run.$id}` (Feature 02 owns the reader).
- Title text may also be the same `Link` (optional; if both Title and Open link, same href).
- Feature 01 ships a **minimal placeholder** at `web/app/(protected)/issues/[runId]/page.tsx` so the link does not 404 before Feature 02: heading from fallback title rules above (load run by id; if missing or not eligible, show a safe not-found / not-an-issue message), body copy locked: `Issue reader coming in a later feature.` Do **not** load or render draft markdown here.

**Empty state** (locked copy when total after filters is 0):

`No issues yet. Generate a newsletter from Newsletters — completed drafts appear here.`

When a newsletter filter yields zero but other issues may exist, the same empty block is fine (operator clears the filter). Do not invent separate copy for “no matches.”

**Load errors:** destructive `Alert` with safe message (mirror Runs), log server-side without secrets.

**No auto-poll / live refresh.** No create/edit/delete of runs from this page. No Inspect links in this feature.

### Suggested web file layout

- `web/app/(protected)/issues/page.tsx` — server page
- `web/app/(protected)/issues/[runId]/page.tsx` — Feature 01 placeholder only
- `web/components/issues/issues-view.tsx` — heading, filter, empty/error wiring
- `web/components/issues/issues-table.tsx` — `ResponsiveList` table + cards (or split card file)
- `web/components/issues/issue-list-card.tsx` — phone card (optional extract)
- `web/components/issues/issues-pagination.tsx` — Prev/Next preserving `newsletterId`
- `web/components/issues/issues-url.ts` (or inline) — `buildIssuesHref({ page?, newsletterId? })`

### Out of scope

- Markdown rendering / real reader (Feature 02).
- First-heading display title (Feature 03) — use fallback only.
- Inspect entry or pipeline audit (Features 04–07).
- Draft editing, pin/drop, delivery actions.
- New Appwrite collection or schema attributes for Issues.
- Downloading draft checkpoints for the list.
- Changing Runs page behavior or nav items other than inserting Issues.

## Dependencies

- Builds on: Stage 04 **feature-01-run-checkpoints** / **feature-03-run-history** — `Run` shape, `listRuns`, `checkpointDraftId`, completed status.
- Builds on: Stage 03 **feature-06-responsive-list-layout** — `ResponsiveList` + list page conventions.
- Builds on: Stage 02 GUI shell — `navItems`, protected layout, shadcn Select/Table/Card/Alert/Button.
- Consumed later by: **feature-02-issue-reader** (replaces `[runId]` placeholder), **feature-03-display-title** (replaces fallback title in list).

## Constraints

- **No new Issues collection** — filter completed runs with draft checkpoints only.
- **Do not** load draft Storage files for the list (no N+1).
- **Do not** implement markdown rendering or heading extraction in this feature.
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- **Responsive domain lists:** table on desktop/tablet, cards on phone — shared `ResponsiveList`.
- **Fetch cap:** reuse `listRuns` default limit 100 (V1); no new indexes.
- Nav order pin: Issues immediately after Newsletters, before Runs.

## Acceptance criteria

- [ ] **Issues** appears in top-level nav (after Newsletters, before Runs) linking to `/issues`.
- [ ] `/issues` lists only runs with `status === "completed"` and non-empty `checkpointDraftId`.
- [ ] Each row/card shows fallback display title, newsletter name, and date; Open links to `/issues/[runId]`.
- [ ] Operator can filter by newsletter; pagination is 20/page and preserves the filter.
- [ ] List uses `ResponsiveList` (table `md+` / cards below `md`) with the same fields and Open action in both presentations.
- [ ] Empty and load-error states match Spec copy/patterns; pending/failed/running runs never appear.
- [ ] `listIssues` + `formatIssueFallbackTitle` are covered by automated tests; nav order test updated.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Create: `shared/src/runs/issues.ts` (or equivalent) — `listIssues` + `formatIssueFallbackTitle`
- Create: `shared/src/runs/__tests__/issues.test.ts`
- Modify: `shared/src/runs/index.ts` (and `shared/src/index.ts` if needed) — export new helpers
- Modify: `web/lib/nav-items.ts` — insert Issues
- Modify: `web/src/__tests__/feeds-nav.test.ts` — expect Issues in order + href
- Create: `web/app/(protected)/issues/page.tsx`
- Create: `web/app/(protected)/issues/[runId]/page.tsx` — placeholder only
- Create: `web/components/issues/issues-view.tsx`
- Create: `web/components/issues/issues-table.tsx` (and optional `issue-list-card.tsx`)
- Create: `web/components/issues/issues-pagination.tsx`
- Create: `web/components/issues/issues-url.ts` (optional if href builder is non-trivial)
- Test: `web/src/__tests__/issues-responsive-list.test.tsx` (optional but preferred — assert `data-slot` table/cards like Runs/Feeds)

## Testing approach

Test-first for `listIssues` and `formatIssueFallbackTitle`. GUI verified via build + nav/list tests; optional PM manual gate with live completed runs.

1. **listIssues filters eligibility:** completed + non-empty `checkpointDraftId` included; completed with empty draft id excluded; `pending` / `running` / `failed` excluded even if a draft id were somehow set.
2. **listIssues newsletterId:** passes through to `listRuns` / results only for that newsletter.
3. **listIssues sort:** newest `(endedAt ?? startedAt)` first; `$id` desc tie-break.
4. **listIssues limit:** default 100; custom `limit` honored via `listRuns`.
5. **formatIssueFallbackTitle:** returns `{name} — {shortDate}` for a fixed ISO input (assert prefix `name — ` and non-empty date segment; avoid brittle exact locale strings if CI locales differ — prefer checking structure or mocking locale if the suite already does).
6. **Nav:** title order includes Issues between Newsletters and Runs; href `/issues`.
7. **GUI (build / optional responsive test):** `/issues` builds; Open hrefs are `/issues/{id}`; both `domain-list-table` and `domain-list-cards` present when list non-empty.

## Tasks

### Task 1: `listIssues` + fallback title helper + tests

- **Action:** Add failing tests in `shared/src/runs/__tests__/issues.test.ts`, then implement `listIssues` and `formatIssueFallbackTitle` per Spec. Export from the runs barrel / shared index.
- **Expected result:** Callers can list eligible completed-draft runs newest-first without Storage downloads.
- **Verify:** New tests pass under `pnpm --filter @newsletter/shared test`.
- **Depends on:** none (requires existing `listRuns` / `Run` types from Stage 04).

### Task 2: Nav item + `/issues` page shell (filters, pagination, empty/error)

- **Action:** Insert Issues into `web/lib/nav-items.ts`; update nav order test. Create `web/app/(protected)/issues/page.tsx` + `issues-view.tsx` + `issues-pagination.tsx` (+ href helper) that load `listIssues` / `listNewsletters`, parse `page` / `newsletterId`, clamp pagination, show empty/error Alert. List body may be stubbed until Task 3.
- **Expected result:** Operator can open Issues from the sidebar, filter, and page; empty copy matches Spec.
- **Verify:** Updated nav test passes; `pnpm --filter web build` and `pnpm typecheck` succeed.
- **Depends on:** Task 1.

### Task 3: Responsive issues list + Open links + reader placeholder

- **Action:** Implement `issues-table.tsx` / card presentation with `ResponsiveList` and columns per Spec. Wire Open (and optional title Link) to `/issues/[runId]`. Add minimal `web/app/(protected)/issues/[runId]/page.tsx` placeholder (load run; eligible → fallback title + locked “coming later” copy; missing/ineligible → safe message). Optional responsive-list test.
- **Expected result:** Desktop table and phone cards show the same fields; Open does not 404; no draft markdown rendered.
- **Verify:** Build/typecheck green; optional `web/src/__tests__/issues-responsive-list.test.tsx` asserts both `data-slot` branches; spot-check Open href shape.
- **Depends on:** Task 2.

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; ensure exports complete; confirm pending/failed runs cannot appear; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 1–3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: with a completed run that has a draft checkpoint, Issues lists it with fallback title; filter by newsletter works; Open hits the placeholder; a failed or in-progress run never appears.

## Handoff

Builder reports: files created/modified; confirmation that Issues uses `listIssues` (completed + draft id) not a new collection; nav order; fallback title only; Open → placeholder `[runId]` route; ResponsiveList parity; any deviations and why.

**Research note:** Codegraph — `navItems` (`web/lib/nav-items.ts`); `ResponsiveList`; Runs page/`listRuns`/`RunsPagination`; `Run.checkpointDraftId`; `executeRun` fails empty drafts before `markCompleted` (so completed ⇒ non-empty draft under normal ops). Stage 06 stage file open questions pinned here: empty-state copy; display title deferred to Feature 03 with explicit fallback; no draft download on list. Auto decisions: `/issues` route; nav after Newsletters; `BookOpen` icon; date from `endedAt ?? startedAt`; 20/page + limit 100; placeholder detail page for Feature 02 handoff.
