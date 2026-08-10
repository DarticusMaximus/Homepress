# Feature 03: Run history

## Intent

Give the operator a Runs history page that shows every generation’s newsletter, timing, status, phase, and failure detail — with a Retry control on failed runs — so on-demand generation is observable and recoverable from the GUI.

## Spec

Fill the existing `/runs` placeholder with operational run history. No new nav item (Stage 02 already ships Runs at `/runs`). No run detail / inspection (Stage 06). No resume-from-failed behavior (Feature 04). No retention/deletion (Feature 06).

### Repository: `listRuns`

Add to `shared/src/runs/repository.ts` (Feature 01 deferred listing; Feature 02 added only active/pending queries):

```ts
listRuns(
  client: Client,
  opts?: {
    newsletterId?: string;
    status?: RunStatus | RunStatus[];
    limit?: number; // default 100
  },
): Promise<Run[]>
```

Behavior:

1. Build Appwrite queries: `Query.limit(opts?.limit ?? 100)`.
2. If `newsletterId` is set → `Query.equal("newsletterId", newsletterId)`.
3. If `status` is set → `Query.equal("status", status)` (pass an array when filtering multiple statuses).
4. Map documents with the existing `documentToRun` helper.
5. Sort **in memory**: `startedAt` descending (ISO string compare), then `$id` descending for stability.
6. **Do not** rely on `Query.orderDesc("startedAt")` without an index (same anti-index pattern as Feeds/Newsletters). If Appwrite rejects a filter query, fall back to a broader `Query.limit` fetch + in-memory filter and document the fallback in the handoff.

Export `listRuns` from the runs barrel / shared package index as needed.

### GUI — `/runs`

Replace `web/app/(protected)/runs/page.tsx` (current “under construction” placeholder).

**Page** (server component):

- Heading **Runs** + one short supporting line: outcomes of newsletter generation — diagnose failures and retry from here.
- Load runs via `listRuns(getServerAppwrite(), { newsletterId, status })` from search params.
- Load newsletters via `listNewsletters` for the filter dropdown (names + ids).
- **Pagination:** 20 runs per page (`?page=`), same clamp/redirect-to-last-page pattern as Feeds/Newsletters. Empty state only when total is zero after filters, not when a high page is empty.
- **Filters** (query params; preserve across pagination links):

| Param | Behavior |
|-------|----------|
| `newsletterId` | Restrict to that newsletter. UI: Select with “All newsletters” (clears param) plus one option per newsletter (`name` label, `$id` value). |
| `status` | Optional single status: `pending` \| `running` \| `completed` \| `failed`. UI: Select with “All statuses” (clears param). |

**List** — use shared `ResponsiveList` (table on `md+`, stacked cards below `md`). Same fields and actions in both presentations (Stage 03 Feature 06 / AGENTS.md GUI convention).

| Column / field | Content |
|----------------|---------|
| Newsletter | `newsletterName` |
| Started | Locale-friendly short datetime from `startedAt` |
| Ended | Locale-friendly short datetime from `endedAt`, or “—” when null |
| Status | Badge (map below) |
| Phase | See phase display rules |
| Failure | When `status === "failed"`: `failureMessage` (truncate + full text in `title`); otherwise “—” |
| Actions | **Retry** button only when `status === "failed"`; otherwise empty / no button |

**Phase display rules** (one column named **Phase**):

| `status` | Show |
|----------|------|
| `pending` | “—” |
| `running` | `currentPhase` (or “—” if empty/null) |
| `completed` | `completedPhase` (or “—” if empty/null) |
| `failed` | `failedPhase` (or “—” if empty/null) |

**Status Badge map** (existing Badge variants only — do not invent new ones):

| Status | Variant |
|--------|---------|
| `pending` | `secondary` |
| `running` | `outline` |
| `completed` | `default` |
| `failed` | `destructive` |

**Empty state:** when zero runs after filters — short message that runs appear after Generate on Newsletters; no fake rows.

**Load errors:** destructive `Alert` with safe message (mirror Feeds/Newsletters), log server-side without secrets.

**No auto-poll / live refresh** in this feature — operator refreshes or re-navigates. No create/edit/delete of run documents from this page. No nested `/runs/[id]` route.

### Retry action (presentation + contract shell)

Stage feature list includes a retry action on history; Feature 04 owns resume-from-failed-phase behavior.

1. Show a **Retry** button (label locked) on failed rows and cards only.
2. Client: `useTransition` → call `retryFailedRun(runId)` → `toast.success` / `toast.error` → on success path Feature 04 will revalidate; for this feature’s shell, always expect an error toast until Feature 04 lands (except validation errors below).
3. Implement the contract shell in shared (preferred: `shared/src/runs/retry.ts` exporting e.g. `requestFailedRunRetry(client, runId)`) and a thin web wrapper `retryFailedRun` in `web/app/(protected)/runs/actions.ts` that calls it and returns `{ ok: true } | { ok: false; error: string }`.

   Locked outcomes (Feature 03 — must be covered by automated tests):

   1. `getRun(client, runId)` — missing → `{ ok: false, error: "Run not found" }`.
   2. If `status !== "failed"` → `{ ok: false, error: "Only failed runs can be retried" }`.
   3. `findActiveRunForNewsletter(client, run.newsletterId)` — if non-null → `{ ok: false, error: "A run is already in progress for this newsletter" }` (same wording as Feature 02 Generate guard).
   4. Otherwise → `{ ok: false, error: "Retry is not available yet" }`.

   **Feature 04 replaces step 4** with resume-from-`failedPhase` enqueue (and may return `{ ok: true }` + `revalidatePath("/runs")`). Feature 03 must call `revalidatePath("/runs")` only if it ever returns `ok: true` (it will not, until Feature 04). Do **not** change the three guard messages in Feature 04 without an explicit PM decision.

4. Do **not** reset run status, load checkpoints, or invoke the executor in this feature.

### Out of scope

- Resume / checkpoint replay / marking a failed run pending again (Feature 04).
- Feed-health indicators on this page (Feature 05).
- Retention, purge, or delete of old runs (Feature 06).
- Per-run article / model-decision inspection (Stage 06).
- Cancelling an in-progress run.
- Changing the Newsletters Generate UI (no required “View runs” link from Feature 02).
- Provisioning Appwrite indexes.

## Dependencies

- Builds on: **feature-01-run-checkpoints** — `Run` document shape, `RUN_STATUSES` / `RUN_PHASES`, `getRun`, `documentToRun`. **Execute Feature 01 before this feature**; if `shared/src/runs/` is missing, stop and escalate.
- Builds on: **feature-02-on-demand-runs** — runs exist in history after Generate; `findActiveRunForNewsletter` for the Retry active-run guard. Prefer executing Feature 02 first so the page has real data; repository `listRuns` can still be built/tested with mocks if 02 is not yet live.
- Builds on: Stage 03 `ResponsiveList` + Feeds/Newsletters list/pagination/toast patterns; Stage 02 `/runs` route and sidebar nav item (already present — do not add a duplicate).

## Constraints

- **Do not add or reorder** sidebar nav items; fill the existing `/runs` page only.
- **Do not implement** Feature 04 resume logic or change Feature 01 checkpoint payload shapes.
- **Do not provision indexes**; in-memory sort/filter with a V1 fetch cap of 100 is required.
- **Server-only** Appwrite access via `getServerAppwrite()`.
- **Secrets:** never log API keys; use existing sanitize helpers on Appwrite error messages.
- **Responsive domain lists:** table on desktop/tablet, cards on phone — shared `ResponsiveList`, not page-local one-off CSS.

## Acceptance criteria

- [ ] `listRuns` returns mapped runs newest-`startedAt`-first; optional `newsletterId` and `status` filters work; default limit 100.
- [ ] `/runs` replaces the placeholder and lists newsletter name, started, ended, status, phase, and failure message in both table and card presentations.
- [ ] Completed and failed runs are visually distinguishable (status Badge); failed runs show failed phase and failure message.
- [ ] **Retry** appears only on failed runs; invokes `retryFailedRun`; non-failed and active-run guards return the specified errors; unimplemented resume path returns `"Retry is not available yet"`.
- [ ] Automated tests cover all four Retry shell outcomes with the locked error strings (Testing approach §6) — a stub that always returns `"Retry is not available yet"` must not pass.
- [ ] Pagination is 20 per page; filter params are preserved in Prev/Next links; empty and load-error states match established Feeds/Newsletters patterns.
- [ ] `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/runs/repository.ts` — add `listRuns`
- Modify: `shared/src/runs/__tests__/repository.test.ts` — `listRuns` cases
- Modify: `shared/src/runs/index.ts` (and `shared/src/index.ts` if needed) — export `listRuns`
- Modify: `web/app/(protected)/runs/page.tsx` — real history page
- Create: `shared/src/runs/retry.ts` (or equivalent) — `requestFailedRunRetry` / contract shell logic (preferred so Task 4 tests run in shared)
- Create: `shared/src/runs/__tests__/retry.test.ts` — four locked shell outcomes (required)
- Create: `web/app/(protected)/runs/actions.ts` — thin `retryFailedRun` wrapper around the shared shell
- Create: `web/components/runs/runs-view.tsx` — heading, filters, empty state wiring
- Create: `web/components/runs/runs-table.tsx` — table + `ResponsiveList` cards composition (or split table/cards as Feeds does)
- Create: `web/components/runs/run-list-card.tsx` — phone card with same fields/actions
- Create: `web/components/runs/runs-pagination.tsx` — Prev/Next preserving filters
- Create: `web/components/runs/retry-run-button.tsx` — Retry + transition + toast (optional extract; may live inline if small)
- Test: `shared/src/runs/__tests__/repository.test.ts`; `shared/src/runs/__tests__/retry.test.ts` (required); optional `web/src/__tests__/runs-responsive-list.test.tsx` mirroring Feeds responsive-list coverage

## Testing approach

Test-first for `listRuns`. GUI verified via build + action wiring; optional PM manual gate with live Appwrite runs.

1. **listRuns empty / sort:** mock returns `[]` → `[]`; unsorted docs → newest `startedAt` first, `$id` desc tie-break.
2. **listRuns filters:** `newsletterId` and `status` (single and array) produce the expected Query args (or documented in-memory fallback) and filtered results.
3. **listRuns limit:** default 100; custom `limit` passed through.
4. **Appwrite error:** repository throws `RunRepositoryError` with safe message (no secrets in logs).
5. **GUI (build / spot-check):** `/runs` builds; Retry only rendered for `failed`; filter Selects update query params; pagination hidden when total ≤ 20.
6. **retryFailedRun shell (required):** automated test covering all four contract outcomes with the locked strings — (a) run not found → `"Run not found"` (or the exact safe message chosen in Spec step 1, asserted consistently); (b) `status !== "failed"` → `"Only failed runs can be retried"`; (c) active run for newsletter → `"A run is already in progress for this newsletter"`; (d) failed + idle → `"Retry is not available yet"`. Mock `getRun` / `findActiveRunForNewsletter` (or extract a shared `requestFailedRunRetry` helper under `shared/src/runs/` and test that). Do **not** defer these branches to Feature 04 — they are the only Retry behavior this feature owns.

## Tasks

### Task 1: `listRuns` + tests

- **Action:** Add failing tests in `shared/src/runs/__tests__/repository.test.ts`, then implement `listRuns` in `shared/src/runs/repository.ts` per Spec. Export from the runs barrel.
- **Expected result:** History consumers can list/filter runs newest-first without indexes.
- **Verify:** New repository tests pass under `pnpm --filter @newsletter/shared test`.
- **Depends on:** Feature 01 code present (`documentToRun`, `Run` type, collection id).

### Task 2: Runs page shell (load, filters, pagination)

- **Action:** Replace `web/app/(protected)/runs/page.tsx` with a server page that parses `page` / `newsletterId` / `status`, calls `listRuns` + `listNewsletters`, clamps pagination, shows load `Alert`, and renders a `RunsView` shell with filter Selects and `RunsPagination` (filter-preserving hrefs). Empty state when total is 0.
- **Expected result:** Operator can open `/runs`, filter, and page through results (list body may still be stubbed until Task 3).
- **Verify:** `pnpm --filter web build` and `pnpm typecheck` succeed for the new page wiring.
- **Depends on:** Task 1.

### Task 3: Responsive run list (table + cards)

- **Action:** Implement `runs-table.tsx` / `run-list-card.tsx` (and wire from `runs-view.tsx`) using `ResponsiveList`. Columns/fields and Badge/phase/failure rules per Spec. No Retry yet (Task 4).
- **Expected result:** Desktop table and phone cards show the same operational fields.
- **Verify:** Build/typecheck green; optional `web/src/__tests__/runs-responsive-list.test.tsx` asserts `data-slot="domain-list-table"` / `domain-list-cards` presence like Feeds.
- **Depends on:** Task 2.

### Task 4: Retry button + contract shell action

- **Action:** Add `retry-run-button.tsx` (or inline) on failed rows/cards only. Implement the four-step contract shell (prefer a shared helper e.g. `shared/src/runs/retry.ts` / `requestFailedRunRetry` so it is unit-testable without Next.js, with `web/app/(protected)/runs/actions.ts` as a thin wrapper that calls it + returns `{ ok, error }`). Wire toasts via `web/lib/toast.ts`. Add required tests for all four locked outcomes (Testing approach §6).
- **Expected result:** Failed runs expose Retry; guards and “not available yet” are proven by tests; Feature 04 can replace the final “not available yet” step without redesigning the list or changing the three guard messages.
- **Verify:** The four shell-outcome tests pass under `pnpm --filter @newsletter/shared test` (or the chosen test location); `pnpm --filter web build` and `pnpm typecheck` green; spot-check that non-failed rows have no Retry control; action/helper does not import executor/checkpoint resume helpers.
- **Depends on:** Task 3 (and Feature 02’s `findActiveRunForNewsletter` for the active-run guard — if missing, stop and escalate).

### Task 5: Feature verification pass

- **Action:** Re-read Spec vs implementation; ensure exports complete; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 1–4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: with Feature 02 live, Generate a newsletter → row appears on `/runs`; mark or produce a failed run → phase + failure message + Retry toast `"Retry is not available yet"` (or active-run / non-failed guard messages as applicable).

## Handoff

Builder reports: files created/modified; confirmation that `/runs` uses `ResponsiveList` and listRuns newest-first; filter query-param contract; Retry shell messages locked for Feature 04; any Appwrite filter fallback; deviations and why.

**Research note:** Codebase — `/runs` placeholder (`web/app/(protected)/runs/page.tsx`); nav already includes Runs (`web/lib/nav-items.ts`); Feeds/Newsletters pagination + `ResponsiveList`; Feature 01 run fields (`newsletterName`, `startedAt`, `endedAt`, status/phase/failure); Feature 02 deferred history/`listRuns`/Retry to Features 03–04 and added `findActiveRunForNewsletter`. Appwrite docs (Context7 `/websites/appwrite_io`): `Query.equal`, `Query.limit`, offset pagination; order on custom attributes needs indexes — avoided via in-memory sort. Auto decisions: newsletter + status filters; Retry UI + validation shell with Feature 04 owning resume; fetch cap 100; no live auto-refresh; no run detail route. PM-accepted review: required automated tests for all four Retry shell outcomes (shared helper preferred).
