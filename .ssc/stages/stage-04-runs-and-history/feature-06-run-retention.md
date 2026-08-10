# Feature 06: Run retention

## Intent

Let the operator keep run history bounded by a configurable retention window (default 30 days) while always preserving each newsletter’s latest three completed runs — so Storage and the `runs` collection stay manageable without starving Stage 05’s cross-run lookback.

## Spec

Add a global retention setting, a cascade-deleting `deleteRun`, a pure eligibility selector that never removes active runs or a newsletter’s three newest completed runs, a purge job the worker runs periodically, and a small retention control on the existing `/runs` page (including “Clean up now”). No new Settings nav item. No per-newsletter retention. No change to Stage 05 lookback config (that stage owns lookback; this feature only guarantees a floor of three completed runs per newsletter).

### Constants (locked)

Export from `shared/src/schema/declarations.ts` (or `shared/src/runs/retention.ts` if preferred — declarations for schema-adjacent IDs/defaults; retention module may re-export):

```ts
export const APP_SETTINGS_COLLECTION_ID = "app_settings" as const;
export const APP_SETTINGS_DOCUMENT_ID = "default" as const;

export const DEFAULT_RUN_RETENTION_DAYS = 30 as const;
export const MIN_RUN_RETENTION_DAYS = 1 as const;
export const MAX_RUN_RETENTION_DAYS = 365 as const;
export const PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER = 3 as const;
```

### Schema: `app_settings` collection

Add to `COLLECTIONS` in `shared/src/schema/declarations.ts` (create-if-absent; no collection recreate):

| Attribute | Type | Size / notes | Required | Default | Array |
|-----------|------|--------------|----------|---------|-------|
| `runRetentionDays` | number | integer | true | — | no |
| `updatedAt` | datetime | — | true | — | no |

- Display name: `"App Settings"`.
- Permissions: server-only (`read: [], write: []`), matching feeds/newsletters/runs.
- **Singleton:** document `$id` is always `APP_SETTINGS_DOCUMENT_ID` (`"default"`). Never create a second settings document.
- Appwrite forbids defaults on required attributes — always write `runRetentionDays` and `updatedAt` explicitly on create/update.
- Existing projects with no document yet: `getOrCreateAppSettings` creates it with `DEFAULT_RUN_RETENTION_DAYS`.

Do **not** add retention fields to `runs` or `newsletters`.

### Settings repository (`shared/src/settings/` or under `shared/src/runs/`)

| Function | Behavior |
|----------|----------|
| `getOrCreateAppSettings(client)` | `getDocument` for `default`. On 404 → `createDocument` with `$id: "default"`, `runRetentionDays: 30`, `updatedAt: now`. Map to `{ runRetentionDays: number; updatedAt: string }`. Clamp/coerce invalid stored numbers to default on read (defensive) and optionally rewrite — prefer clamp-on-read for V1. |
| `updateRunRetentionDays(client, days)` | Validate integer in `[MIN, MAX]` → else `RunRepositoryError` / `SettingsRepositoryError` with code `validation` and message like `"Retention must be between 1 and 365 days"`. Upsert: get-or-create then `updateDocument` with new days + `updatedAt: now`. Return updated settings. |

Error helper: mirror feeds/runs (`wrapAppwriteError`, sanitize for logs). Prefer a small `SettingsRepositoryError` with codes `validation` \| `appwrite` (or reuse a shared pattern — do not invent a third style).

### Repository: `deleteRun` + listing for purge

Add to `shared/src/runs/repository.ts`:

| Function | Behavior |
|----------|----------|
| `deleteRun(client, runId)` | `getRun` (404 → `not_found`). For each non-empty checkpoint id among the six `checkpoint*Id` fields: best-effort `storage.deleteFile({ bucketId: RUN_CHECKPOINTS_BUCKET_ID, fileId })` — catch, log sanitized, continue. Then `databases.deleteDocument` for the run. Rethrow only if the document delete fails (`appwrite`). Missing Storage files are success (already gone). |
| `listAllRuns(client, opts?: { pageSize?: number })` | Page through the `runs` collection until exhausted. Default `pageSize` 100. Use `Query.limit(pageSize)` + `Query.cursorAfter(lastId)` (or equivalent node-appwrite 26 cursor) when more results exist; if cursor APIs fail in the environment, fall back to repeated limit fetches with documented handoff note — but prefer cursor. Map via `documentToRun`. Return the full array. **Do not** use this for the `/runs` UI (Feature 03 stays at limit 100). |

Export both from the runs barrel.

### Pure eligibility: `selectRunsForDeletion`

Add `shared/src/runs/retention.ts` (test-first):

```ts
selectRunsForDeletion(
  runs: Run[],
  retentionDays: number,
  now?: Date, // default new Date(); injectable for tests
): Run[]
```

**Algorithm:**

1. Clamp `retentionDays` to `[MIN, MAX]` defensively (caller should already validate).
2. `cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000`.
3. Group runs by `newsletterId`.
4. For each group, build **protected completed** ids:
   - Filter `status === "completed"`.
   - Sort by `endedAt` descending (ISO string compare); if `endedAt` is null/empty, fall back to `startedAt`; tie-break `$id` descending.
   - Take the first `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` (3) ids.
5. A run is **eligible for deletion** iff all of:
   - `status` is **not** `pending` and **not** `running` (active runs are never deleted).
   - `$id` is **not** in that newsletter’s protected-completed set.
   - `Date.parse(startedAt) < cutoffMs` (age clock is always `startedAt`, which Feature 01 always sets).
6. Return eligible runs (stable order: `startedAt` ascending, then `$id` — oldest first for predictable purge logs).

**Locked edge cases:**

| Case | Outcome |
|------|---------|
| Completed, older than cutoff, in top-3 completed for newsletter | **Keep** |
| Completed, older than cutoff, 4th+ completed | **Delete** |
| Failed, older than cutoff | **Delete** (failed runs are not protected) |
| Pending / running, any age | **Keep** |
| Completed, newer than cutoff, outside top-3 | **Keep** (still inside window) |
| Fewer than 3 completed total | Protect all completed; may still delete old failed |
| Newsletter with only failed/old runs | May delete all of them once past cutoff |
| Empty `runs` | `[]` |

Also export a thin wrapper used by purge:

```ts
purgeExpiredRuns(client, opts?: { retentionDays?: number; now?: Date }): Promise<{
  deleted: number;
  errors: number;
  retentionDays: number;
}>
```

Behavior:

1. Resolve `retentionDays` from `opts.retentionDays` or `getOrCreateAppSettings(client).runRetentionDays`.
2. `listAllRuns(client)`.
3. `eligible = selectRunsForDeletion(runs, retentionDays, opts.now)`.
4. For each eligible id:
   - **Re-check before delete:** `getRun(client, id)`. If the document is gone → count as already cleaned (do not increment `errors`; do not call `deleteRun`). If `status` is `pending` or `running` → **skip** (do not call `deleteRun`, do not count as `deleted` or `errors`) — Feature 04 may have retried the same document since the snapshot, keeping the original `startedAt`.
   - Otherwise: `try { await deleteRun(...) ; deleted++ } catch { errors++; log sanitized; continue }`.
5. Return `{ deleted, errors, retentionDays }`. Never throw for per-run failures; throw only if settings/list setup fails fatally.

`deleteRun` stays a dumb cascade (no status guard). The active-run safety check lives on the purge path only.

### Worker: periodic purge

In `worker/src/index.ts` (and/or `worker/src/retention-poller.ts`):

- Register job name `purge-expired-runs` via `registerJob` whose handler calls `purgeExpiredRuns(getServerAppwrite())` and logs `{ deleted, errors, retentionDays }` (no secrets).
- On worker boot: fire-and-forget one purge after schema provision settles (same async IIFE pattern as provision, or chained after it) — best-effort; failures log, do not exit process.
- Interval: `WORKER_RETENTION_POLL_MS`, default `86400000` (24h). On tick, invoke the registered job. Skip overlapping ticks with an in-flight flag (same pattern as run poller’s single-flight).
- Purge may run while a newsletter run is executing — safe because eligibility excludes active runs **and** `purgeExpiredRuns` re-checks status before each delete (Feature 04 same-document retry race).
- Clear the interval on `SIGTERM`/`SIGINT` alongside the run-poll and heartbeat intervals.

Do **not** require Feature 02’s run poller to exist to verify retention unit tests; if the poller file layout differs, place retention interval next to whatever Feature 02 shipped.

### GUI — `/runs` retention controls

On `web/app/(protected)/runs/page.tsx` (Feature 03 page), add a compact **Retention** control near the page heading (not a card-heavy settings dashboard):

- Load current days via `getOrCreateAppSettings(getServerAppwrite())`.
- Show label **Keep run history for** + number input (min 1, max 365) + unit **days** + **Save** button.
- Client: `useTransition` → `updateRunRetentionSetting(days)` server action → toast success/error → `revalidatePath("/runs")`.
- Secondary control: **Clean up now** button → `purgeRunsNow()` server action → toast with deleted count (e.g. `Removed N old runs`) or error; revalidate `/runs`.
- Short helper text (one line): older runs are removed automatically; each newsletter’s latest three completed runs are always kept.
- Do **not** add a sidebar Settings item. Do **not** put retention on the dashboard.

Server actions in `web/app/(protected)/runs/actions.ts` (extend Feature 03/04 file):

- `updateRunRetentionSetting(days: number): Promise<{ ok: true; days: number } | { ok: false; error: string }>`
- `purgeRunsNow(): Promise<{ ok: true; deleted: number } | { ok: false; error: string }>`

Validate days on the server (same bounds). Sanitize Appwrite errors for the client.

### Out of scope

- Per-newsletter retention or configurable protected-count (floor stays 3).
- Soft-delete / trash / undo.
- Deleting runs from the history row UI (no per-row Delete).
- Appwrite TTL attributes or bucket lifecycle rules.
- Stage 05 semantic dedup / lookback UI.
- Provisioning indexes (cursor + in-memory eligibility is enough for V1).
- Changing Feature 03’s list limit of 100 for the history page.

## Dependencies

- Builds on: **feature-01-run-checkpoints** — `Run` shape, checkpoint ids, `RUN_CHECKPOINTS_BUCKET_ID`, Storage `deleteFile` already used on persist-failure. **Execute Feature 01 before this feature.**
- Builds on: **feature-03-run-history** — `/runs` page to host the retention control. Prefer Feature 03 before the GUI task; shared purge/delete can be built and unit-tested first.
- Builds on: Stage 02 schema provisioner + worker boot; Stage 00 worker `registerJob` / heartbeat process.
- Soft dependency: Feature 02 worker process stays alive for the interval — if Feature 02 poller is missing, still add the retention interval to `worker/src/index.ts`.

## Constraints

- **Never delete** `pending` or `running` runs.
- **Never delete** a newsletter’s three latest `completed` runs (by `endedAt`/`startedAt` rules above), even when older than the retention window.
- **Cascade Storage:** `deleteRun` must attempt to remove all checkpoint files before deleting the document.
- **Schema-as-code only** for `app_settings`; create-if-absent; drift → warn + skip.
- **Do not remove or rename** existing run attributes or collections.
- **Server-only** Appwrite access; sanitize errors; never log secrets.
- **Do not add** a Settings nav item in this feature.
- Protected count is a **fixed floor of 3** for Stage 05; do not make it operator-configurable here.

## Acceptance criteria

- [ ] `app_settings` is declared and provisioned; singleton `default` document get-or-create yields `runRetentionDays: 30` when absent.
- [ ] Operator can set retention days in `[1, 365]` from `/runs`; invalid values are rejected with a clear error.
- [ ] `selectRunsForDeletion` never returns active runs or a newsletter’s three newest completed runs; deletes old failed and non-protected completed past the cutoff.
- [ ] `deleteRun` removes checkpoint Storage files (best-effort) then the run document.
- [ ] `purgeExpiredRuns` deletes only eligible runs, re-checks that each target is still non-active before `deleteRun`, and continues after per-run errors; return shape is `{ deleted, errors, retentionDays }`.
- [ ] Worker runs purge on boot (best-effort) and on `WORKER_RETENTION_POLL_MS` (default 24h).
- [ ] `/runs` exposes Save + Clean up now; Clean up now reports how many runs were removed.
- [ ] Automated tests cover eligibility matrix, deleteRun cascade, settings bounds, and purge counting; `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/schema/declarations.ts` — `app_settings` collection + retention/settings constants
- Modify: `shared/src/schema/__tests__/declarations.test.ts` — assert new collection / constants
- Create: `shared/src/settings/types.ts` (or equivalent)
- Create: `shared/src/settings/repository.ts` — `getOrCreateAppSettings`, `updateRunRetentionDays`
- Create: `shared/src/settings/__tests__/repository.test.ts`
- Create: `shared/src/settings/index.ts` (+ export from `shared/src/index.ts`)
- Create: `shared/src/runs/retention.ts` — `selectRunsForDeletion`, `purgeExpiredRuns`
- Create: `shared/src/runs/__tests__/retention.test.ts` — eligibility matrix + purge mocks
- Modify: `shared/src/runs/repository.ts` — `deleteRun`, `listAllRuns`
- Modify: `shared/src/runs/__tests__/repository.test.ts` — delete cascade + listAllRuns paging
- Modify: `shared/src/runs/index.ts` — exports
- Create or modify: `worker/src/retention-poller.ts` — interval + single-flight
- Modify: `worker/src/index.ts` — register job, boot purge, interval, shutdown clear
- Modify: `web/app/(protected)/runs/page.tsx` — retention controls
- Modify: `web/app/(protected)/runs/actions.ts` — `updateRunRetentionSetting`, `purgeRunsNow`
- Create or modify: `web/src/__tests__/…` — retention action validation / page wiring as patterns allow
- Modify: `product_spec.md` — one-line Implemented features note at handoff

## Testing approach

Test-first for shared retention logic; UI verified with action/page tests where the repo already tests Runs.

1. **declarations:** `app_settings` attributes; constants `DEFAULT=30`, `PROTECTED=3`, `MIN=1`, `MAX=365`.
2. **getOrCreateAppSettings:** 404 → create with 30; existing doc maps correctly; invalid stored day clamps on read.
3. **updateRunRetentionDays:** rejects `0`, `366`, non-integers; accepts `1` and `365`; persists.
4. **selectRunsForDeletion — protect top-3:** four completed older than cutoff → only the oldest (4th) eligible; three newest kept.
5. **selectRunsForDeletion — failed:** old failed eligible; recent failed kept.
6. **selectRunsForDeletion — active:** pending/running never eligible even if `startedAt` ancient.
7. **selectRunsForDeletion — inside window:** completed outside top-3 but newer than cutoff → not eligible.
8. **deleteRun:** deletes all present checkpoint file ids then document; missing file does not fail; document delete failure throws; get 404 → `not_found`.
9. **listAllRuns:** two pages of fixtures → concatenated length correct (mock cursor/limit).
10. **purgeExpiredRuns:** mocks list + delete; asserts only eligible ids deleted; one delete failure increments `errors` and continues; when a re-check `getRun` returns `pending`/`running`, that id is skipped (no `deleteRun` call); return object has exactly `deleted`, `errors`, `retentionDays`.
11. **Worker (optional unit):** retention poller single-flight / env default documented; skip if worker tests are thin — then verify by reading `index.ts` registration in feature verification.
12. **Web:** update action rejects out-of-range; purge action returns deleted count shape (mock shared purge).

## Tasks

### Task 1: Schema + settings repository (test-first)

- **Action:** Add `app_settings` + constants to `shared/src/schema/declarations.ts` and declaration tests. Implement `getOrCreateAppSettings` / `updateRunRetentionDays` with mocks. Export settings barrel from shared package index.
- **Expected result:** Provisioner will create the collection on next boot; settings singleton defaults to 30 days.
- **Verify:** `pnpm --filter @newsletter/shared test` — declarations + settings repository tests green.
- **Depends on:** none.

### Task 2: `deleteRun` + `listAllRuns` (test-first)

- **Action:** Add failing tests then implement cascade `deleteRun` and paged `listAllRuns` in `shared/src/runs/repository.ts`. Extend runs mock client if needed for cursor paging / deleteDocument.
- **Expected result:** Runs and their checkpoint files can be fully removed; purge can scan beyond the UI’s 100-row cap.
- **Verify:** repository tests for cascade + paging pass; shared suite green for these files.
- **Depends on:** Feature 01 repository present (escalate if missing).

### Task 3: Eligibility + `purgeExpiredRuns` (test-first)

- **Action:** Write the eligibility matrix tests in `shared/src/runs/__tests__/retention.test.ts`. Implement `selectRunsForDeletion` and `purgeExpiredRuns` in `shared/src/runs/retention.ts` (including pre-delete status re-check). Export from runs barrel.
- **Expected result:** Pure, verifiable retention policy matching stage acceptance; purge wires settings + list + delete and cannot cascade-delete a run that became active after the snapshot.
- **Verify:** retention tests cover protect-3 / failed / active / in-window cases; purge mock tests cover delete counting, per-run error continue, and skip-when-recheck-active; return shape locked.
- **Depends on:** Tasks 1 and 2.

### Task 4: Worker retention poller

- **Action:** Add `purge-expired-runs` job registration, boot best-effort purge, and `WORKER_RETENTION_POLL_MS` interval (default 24h) with single-flight + shutdown clear in `worker/src/index.ts` / `retention-poller.ts`.
- **Expected result:** Retention runs without operator action on the self-hosted box.
- **Verify:** worker typecheck/build; spot-check registration and default interval in source; shared tests still green.
- **Depends on:** Task 3.

### Task 5: `/runs` retention UI + actions

- **Action:** Add retention days Save + Clean up now to the Runs page; implement server actions; toasts + revalidate. Keep responsive list unchanged. Update `product_spec.md` with a one-line Implemented features note.
- **Expected result:** Operator can configure retention and trigger an immediate purge from history.
- **Verify:** `pnpm --filter web test` (relevant), `pnpm --filter web build`, `pnpm typecheck`, `pnpm test` green.
- **Depends on:** Tasks 1 and 3; Feature 03 `/runs` page must exist (escalate if missing).

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green; eligibility tests prove top-3 completed protection; deleteRun cascade covered; settings default 30; worker source registers purge job + 24h default; `/runs` exposes Save and Clean up now.

## Handoff

Builder reports: files changed; confirm default 30 / protect 3 / bounds 1–365; confirm active runs never deleted; confirm Storage cascade order (files then document); note cursor vs fallback for `listAllRuns`; confirm `product_spec.md` updated; list any deviations and why.

**Research note:** Stage file + Plan pin (30-day default, preserve latest three completed for Stage 05). Feature 01 defers delete/retention and cascade Storage cleanup to this feature; Feature 03 hosts `/runs` and caps UI list at 100. Context7 `/websites/appwrite_io`: `databases.deleteDocument`, `storage.deleteFile` (node-appwrite object params). Codebase: runs repository already best-effort `deleteFile` on checkpoint persist failure; worker heartbeat + Feature 02 poll interval pattern; no Settings nav today — retention UI lives on `/runs`. Auto decisions: singleton `app_settings`; age clock = `startedAt`; failed runs not protected; worker boot + 24h purge; no per-row delete; protected count fixed at 3. Grizzled Senior: pre-delete status re-check (Feature 04 same-doc retry race); locked purge return `{ deleted, errors, retentionDays }`.
