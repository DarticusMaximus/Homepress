# Feature 04: Inspect entry

## Intent

Let the operator open a read-only Inspect surface for a run from the Runs page (and optionally from an open issue), so pipeline audit is reachable without making Inspect a top-level nav destination.

## Spec

Ship the Inspect **entry points** and a **shell page**. No phase article lists (Feature 05), no selection/suppress audit (Feature 06), no draft-beside-selected (Feature 07). No draft editing.

### Route (locked)

```
/runs/[runId]/inspect
```

Nested under Runs so it stays an ops drill-down. **Do not** add Inspect (or any Inspect href) to `web/lib/nav-items.ts`.

Suggested pure helper (web, unit-testable):

```ts
inspectRunHref(runId: string): string
// → `/runs/${runId}/inspect`
```

Home: `web/components/runs/inspect-url.ts` (or beside other runs URL helpers).

### Eligibility: which runs open Inspect

**Any run that exists** may be inspected — `pending`, `running`, `completed`, or `failed`.

Rationale: Inspect is for ops diagnosis; failed mid-pipeline runs are a primary case. Features 05–07 show whatever checkpoints exist and empty/missing sections when they do not. This feature does **not** require a completed draft or any checkpoint id.

If `getRun` throws `RunRepositoryError` with `code === "not_found"` → not-available UI (below). Do **not** download phase checkpoints in this feature.

### Entry A — Runs list

Modify `web/components/runs/runs-table.tsx` and `web/components/runs/run-list-card.tsx`:

- Every row/card exposes an **Inspect** control (label locked) as a `Link` to `inspectRunHref(run.$id)`.
- Place in the existing Actions column (table) and card footer alongside **Retry** when present.
- **Inspect** appears for **all** statuses; **Retry** remains failed-only (unchanged).
- Same fields/actions in table and cards (Stage 03 Feature 06 / AGENTS.md GUI convention).

Do **not** add Inspect to the Issues list (Feature 01). Issues stays a reading surface; ops entry is Runs + optional reader link.

### Entry B — Issue reader

On `/issues/[runId]` (Feature 02/03 reader chrome), add a secondary link:

- Label locked: **Inspect pipeline**
- `href`: `inspectRunHref(runId)` (same run as the open issue)
- Placement: quiet secondary link in the reader chrome (e.g. near **Back to Issues** or under the meta line) — not a heavy action bar; not required on the Issues list.
- Only render on the **eligible-issue success path** (run loaded and readable). Omit on not-an-issue and draft load-error paths (or omit whenever run id is not safely known — prefer only success chrome).

### Inspect shell page

Create `web/app/(protected)/runs/[runId]/inspect/page.tsx` (server component).

**Load:** `getRun(getServerAppwrite(), runId)` only. No `loadPhaseCheckpoint`.

**Chrome (locked), when run exists:**

1. **Back to Runs** — `Link` to `/runs` (label locked).
2. Page heading: **Inspect**
3. Quiet meta line: **`{newsletterName} · {status} · {date}`** where date is locale short date from `startedAt` (`dateStyle: "short"`). Status is the run’s `status` string as stored.
4. Optional secondary meta (recommended): phase hint using the existing Runs display helper `phaseFor(run)` (same string the Runs list shows) — keeps the shell useful before Features 05–07.
5. Body placeholder (locked copy):

   `Pipeline phase details coming in later features.`

Do **not** render draft markdown, article tables, or selection/suppress content here.

**Not-available (locked):**

| Condition | UI |
|-----------|-----|
| `RunRepositoryError` with `code === "not_found"` | Locked message **`This run isn’t available.`** plus **Back to Runs** link to `/runs`. Do not show partial ops fields. Do not use the error’s `.message` as the user-facing copy. |
| `getRun` Appwrite / other `RunRepositoryError` (or unexpected throw) | Destructive `Alert` with safe message (mirror Runs page); log server-side without secrets. Still offer **Back to Runs**. |

### Out of scope

- Phase article lists (Feature 05).
- Selection / MMR / suppress audit (Feature 06).
- Draft beside selected items (Feature 07).
- Draft editing, pin/drop, delivery.
- Top-level Inspect nav item.
- Inspect link on the Issues list.
- Checkpoint downloads or new Appwrite collections/attributes.
- Changing Issues eligibility or Runs filters/pagination.

### Suggested file layout

- `web/components/runs/inspect-url.ts` — `inspectRunHref`
- `web/app/(protected)/runs/[runId]/inspect/page.tsx` — shell
- `web/components/runs/inspect-shell.tsx` — chrome + placeholder/error wiring (optional extract)
- Modify: `web/components/runs/runs-table.tsx` — Inspect link
- Modify: `web/components/runs/run-list-card.tsx` — Inspect link
- Modify: `web/app/(protected)/issues/[runId]/page.tsx` and/or `web/components/issues/issue-reader.tsx` — Inspect pipeline link
- Test: `web/src/__tests__/inspect-entry.test.tsx` — required coverage per Testing approach (href, Runs links, not-available, success shell; reader link in Task 3)

## Dependencies

- Builds on: Stage 04 **feature-03-run-history** — Runs list UI (`runs-table`, `run-list-card`), `getRun`, `RunRepositoryError` (`code === "not_found"`), `Run` shape, `phaseFor` display helper.
- Builds on: **feature-02-issue-reader** (and **feature-03-display-title** chrome) — reader success path to attach **Inspect pipeline**.
- Consumed later by: **feature-05-phase-article-lists**, **feature-06-selection-and-suppress-audit**, **feature-07-draft-inspect** (replace shell body with real sections).

## Constraints

- **No top-level Inspect nav** — do not modify `navItems` to add Inspect.
- **No checkpoint loads** in this feature.
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- **Responsive:** Inspect link present in both table and card presentations; shell readable on phone.
- Route stays under `/runs/.../inspect` — do not invent `/inspect` as a nav root.
- Labels locked: Runs **Inspect**; reader **Inspect pipeline**; back **Back to Runs**; placeholder and not-available copy as Spec.

## Acceptance criteria

- [ ] Operator can open Inspect for any existing run from the Runs list (table and cards) via an **Inspect** link to `/runs/[runId]/inspect`.
- [ ] Inspect is **not** a top-level nav item; `navItems` unchanged regarding Inspect.
- [ ] Eligible issue reader shows **Inspect pipeline** linking to the same Inspect route for that run.
- [ ] Inspect shell loads run meta via `getRun` only; shows Back to Runs, Inspect heading, meta, and locked placeholder body — no phase/selection/draft audit content.
- [ ] Missing run shows locked not-available copy + Back to Runs; load errors use safe Alert + logging without secrets.
- [ ] Failed runs still show Inspect (Retry behavior unchanged); pending/running/completed also get Inspect.
- [ ] Automated tests **must** cover: `inspectRunHref`; Inspect `href` on table **and** card fixtures for every status (Retry still failed-only); not-available locked copy + Back to Runs; success-path shell (heading **Inspect**, locked placeholder body, Back to Runs) with a fixture `Run`. Issue-reader **Inspect pipeline** link covered when Feature 02 chrome exists (Task 3). `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Create: `web/components/runs/inspect-url.ts`
- Create: `web/app/(protected)/runs/[runId]/inspect/page.tsx`
- Create: `web/components/runs/inspect-shell.tsx` (optional)
- Modify: `web/components/runs/runs-table.tsx`
- Modify: `web/components/runs/run-list-card.tsx`
- Modify: `web/app/(protected)/issues/[runId]/page.tsx` and/or `web/components/issues/issue-reader.tsx`
- Test: `web/src/__tests__/inspect-entry.test.tsx` (and/or extend existing runs/issues tests)
- Do **not** modify: `web/lib/nav-items.ts` for Inspect (Issues nav from Feature 01 is unrelated and must remain)

## Testing approach

Not fully test-first for live Appwrite; **required** unit/component tests for href, Runs entry links, not-available path, and success-path shell (fixture `Run` — no live Appwrite needed). Build/typecheck gate. Optional PM: open Inspect from a failed and a completed run; confirm no Inspect in sidebar.

1. **inspectRunHref (required):** given a run id → `/runs/{id}/inspect`.
2. **Runs entry (required):** table **and** card fixtures render an Inspect `Link` (or `<a>`) whose `href` matches `inspectRunHref` for fixtures covering **every** status (`pending` / `running` / `completed` / `failed`); Retry still only when `status === "failed"`.
3. **Nav (required):** assert `navItems` has no title/href for Inspect (extend `feeds-nav.test.ts` or a focused assert — do not require Issues if Feature 01 not yet executed in the same branch; if Issues already in nav, leave that expectation intact).
4. **Inspect shell not-available (required):** when the page/shell is exercised with `RunRepositoryError` `code === "not_found"` (mock or direct render of the error branch), locked copy **This run isn’t available.** and Back to Runs appear; error `.message` is not shown as the body.
5. **Inspect shell success (required):** when rendered with a fixture `Run`, assert heading **Inspect**, locked placeholder **Pipeline phase details coming in later features.**, and Back to Runs. No Appwrite call required if the shell accepts a `Run` prop / the page’s happy branch is unit-tested via extract.
6. **Issue reader link (required in Task 3):** success chrome includes **Inspect pipeline** with correct href; not-an-issue path does not.

## Tasks

### Task 1: `inspectRunHref` + Inspect shell page

- **Action:** Add `web/components/runs/inspect-url.ts` with `inspectRunHref`. Create `web/app/(protected)/runs/[runId]/inspect/page.tsx` (+ optional `inspect-shell.tsx`) that `getRun`s, maps `RunRepositoryError` `code === "not_found"` to not-available UI, renders chrome/placeholder per Spec, and implements other load-error states. Add **required** tests: href; not-available locked copy + Back to Runs; success-path shell (heading **Inspect**, locked placeholder, Back to Runs) with a fixture `Run`.
- **Expected result:** Visiting `/runs/{id}/inspect` for a real run shows the shell; bad ids fail safely; no checkpoints downloaded.
- **Verify:** Required tests in Testing approach items 1, 4, and 5 pass; `pnpm --filter web build` and `pnpm typecheck` succeed.
- **Depends on:** none (requires Stage 04 `getRun` / `RunRepositoryError` / Run types).

### Task 2: Runs list — Inspect links (table + cards)

- **Action:** Add **Inspect** `Link` to every row in `runs-table.tsx` and every `run-list-card.tsx`, using `inspectRunHref`. Keep Retry failed-only. Ensure Actions layout stays usable on phone (footer wrap already present).
- **Expected result:** Operator can enter Inspect from Runs for any status.
- **Verify:** Required test (Testing approach item 2): Inspect href on table **and** cards for every status; Retry failed-only; build/typecheck green.
- **Depends on:** Task 1 (href helper).

### Task 3: Issue reader — Inspect pipeline link

- **Action:** On the eligible-issue success chrome of `/issues/[runId]` (page or `issue-reader.tsx`), add **Inspect pipeline** linking to `inspectRunHref(runId)`. Omit on not-an-issue / when run is unavailable. Do not add to Issues list.
- **Expected result:** Reading an issue can jump to Inspect for that run without using top-level nav.
- **Verify:** Required test (Testing approach item 6): success chrome has **Inspect pipeline** with correct href; not-an-issue path does not; build/typecheck green.
- **Depends on:** Task 1; Feature 02/03 reader must exist when this task runs (execute Features 01–03 before 04 in stage order).

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no nav item, no checkpoint loads, no phase UI creep; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 1–3.

## Feature verification

- Run: `pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: from Runs, Inspect opens the shell for a completed and a failed run; sidebar has no Inspect; from an open issue, **Inspect pipeline** lands on the same shell; placeholder copy visible until Features 05–07.

## Handoff

Builder reports: files created/modified; confirmation that route is `/runs/[runId]/inspect`; Inspect on all Runs rows/cards; **Inspect pipeline** on issue reader only; no nav item; no checkpoint downloads; shell placeholder only; any deviations and why.

**Research note:** Codegraph — Runs list has Retry-only actions today (`runs-table.tsx` / `run-list-card.tsx`); no run detail route yet; `getRun` / `Run` checkpoint id fields; Feature 01–03 specs defer Inspect to this feature; stage pins Inspect as non-nav drill-down from Runs + issue reader. Auto decisions (PM-approved 2026-07-14): route `/runs/[runId]/inspect`; any existing run inspectable; labels **Inspect** / **Inspect pipeline**; shell placeholder for Features 05–07; no Issues-list Inspect link. Grizzled Senior pass (2026-07-14): required automated asserts for href / Runs links / not-available / success shell; pin not-found to `RunRepositoryError.code === "not_found"`.
