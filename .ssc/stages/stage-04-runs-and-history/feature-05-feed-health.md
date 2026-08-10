# Feature 05: Feed health

## Intent

Detect RSS feeds that keep failing during real newsletter runs and surface that clearly on Feeds, Runs, and the dashboard — so a dead or flaky source cannot silently starve digests for weeks the way it did in the legacy CLI.

## Spec

Track **operational** feed health from production fetch outcomes (separate from Stage 03 qualification `status`). After each run’s fetch phase, update per-feed consecutive-failure counters; mark a feed unhealthy at three consecutive failures; clear back to healthy on the next successful fetch of that feed. Show unhealthy feeds on the Feeds page, call out failed feeds on affected run rows, and add a dashboard Feeds indicator (green when all healthy; red with count linking to `/feeds`).

### Qualification vs operational health (locked)

| Concern | Field(s) | Owner |
|---------|----------|-------|
| Pre-attach qualification | `status`: `untested` \| `ok` \| `failed` | Stage 03 (Test feed) |
| Ongoing run-time health | `operationalHealth` + `consecutiveFetchFailures` (+ last fetch error/time) | **This feature** |

- **Do not** flip qualification `status` when a feed becomes unhealthy (or healthy again). Attach-only-if-ok and Feature 02’s ok-feed gate stay qualification-only.
- **Do not** auto-detach unhealthy feeds.
- Manual **Test feed** (`recordFeedTestResult`) does **not** update operational-health fields — only production run fetch outcomes do.
- Unhealthy `ok` feeds may still be included in runs; the operator is alerted, not silently blocked.

### Schema additions (`feeds` collection)

Add to `COLLECTIONS` → feeds attributes in `shared/src/schema/declarations.ts` (create-if-absent via existing provisioner; no collection recreate):

| Attribute | Type | Size / notes | Required | Default | Array |
|-----------|------|--------------|----------|---------|-------|
| `operationalHealth` | string | 32 | true | — | no |
| `consecutiveFetchFailures` | number | integer | false | `0` | no |
| `lastFetchError` | string | 1000 | false | — | no |
| `lastFetchAt` | datetime | — | false | — | no |

Export:

```ts
export const FEED_OPERATIONAL_HEALTH = ["healthy", "unhealthy"] as const;
export type FeedOperationalHealth = (typeof FEED_OPERATIONAL_HEALTH)[number];
export const FEED_UNHEALTHY_THRESHOLD = 3 as const;
```

**New / URL-changed feeds:** `createFeed` and `updateFeed` (when URL changes) must write `operationalHealth: "healthy"`, `consecutiveFetchFailures: 0`, `lastFetchError: ""`, and clear `lastFetchAt` (omit/null — map to `null` in `documentToFeed`). URL change already resets qualification to `untested`; reset operational counters the same way (new URL = new source).

**Existing documents** created before this feature: `documentToFeed` must treat missing `operationalHealth` as `"healthy"`, missing/null `consecutiveFetchFailures` as `0`, missing `lastFetchError` as `""`, missing `lastFetchAt` as `null`. After first `applyFeedFetchOutcomes` write, fields are populated. Provisioner adds attributes; Appwrite may leave old docs without values until updated — mapping defaults are mandatory.

**Required `operationalHealth` on create:** Appwrite forbids defaults on required attributes (same pattern as `status`). Always set explicitly on create/URL-reset/outcome writes.

### Domain types

Extend `Feed` in `shared/src/feeds/types.ts`:

```ts
operationalHealth: FeedOperationalHealth;
consecutiveFetchFailures: number;
lastFetchError: string;
lastFetchAt: string | null;
```

Helper (shared, pure):

```ts
export function isFeedUnhealthy(feed: Pick<Feed, "operationalHealth" | "consecutiveFetchFailures">): boolean {
  return feed.operationalHealth === "unhealthy" || feed.consecutiveFetchFailures >= FEED_UNHEALTHY_THRESHOLD;
}
```

Prefer trusting `operationalHealth` as the persisted flag; the counter check is a defensive consistency aid for tests/mapping.

### Core API: `applyFeedFetchOutcomes`

Add `shared/src/feeds/health.ts` (or equivalent next to repository):

```ts
applyFeedFetchOutcomes(
  client: Client,
  input: {
    /** Exact feed URLs included in this run’s fetch (ok attachments used). */
    attemptedFeedUrls: string[];
    /** From FetchResult / run `failedFeeds` JSON. */
    failedFeeds: FeedFailure[];
  },
): Promise<void>
```

**Algorithm (per URL in `attemptedFeedUrls`, exact string match on `Feed.url`):**

1. Resolve feed document by URL: `listFeeds` + find, or a narrow `getFeedByUrl` helper if added (V1: filter `listFeeds` / `Query.equal("url", url)` + limit 1). Skip silently if no feed document matches (orphan URL — log once at debug/info, do not throw).
2. If URL appears in `failedFeeds` (match `FeedFailure.feedUrl`):
   - `consecutiveFetchFailures = (current ?? 0) + 1`
   - `lastFetchError` = truncate `errorMessage` to 1000
   - `lastFetchAt` = now
   - `operationalHealth` = `consecutiveFetchFailures >= FEED_UNHEALTHY_THRESHOLD ? "unhealthy" : "healthy"`
   - `updatedAt` = now
   - **Do not** change `status` / `lastTestedAt` / `lastTestError`
3. Else (attempted and not in `failedFeeds` — successful fetch, including zero articles in date range):
   - `consecutiveFetchFailures = 0`
   - `operationalHealth = "healthy"`
   - `lastFetchError = ""` (always write empty string — Appwrite omit leaves stale error)
   - `lastFetchAt` = now
   - `updatedAt` = now
4. URLs only in `failedFeeds` but **not** in `attemptedFeedUrls`: ignore (defensive).
5. Failures updating one feed must not abort siblings: catch per-feed, log sanitized error, continue. Function resolves successfully unless the client/list setup itself fails fatally (then throw `FeedRepositoryError`).

**What counts as a failure:** only structured `FeedFailure` entries from the fetch phase (`HttpError`, `NetworkError`, `TimeoutError`, `ParseError`, `BlockedError`). Empty article lists after a successful HTTP+parse are **success** (reset counter). Scrape/tag/score failures do **not** affect feed health.

### Hook into run execution

In `shared/src/runs/execute-run.ts` (Feature 02), call health updates from the **fetch-phase branch only**, whenever fetch produced a `FetchResult` — **independent of whether the fetch checkpoint was saved**.

Feature 02 fatals zero-article fetches with `markFailed` and **no** fetch checkpoint. That is exactly the all-feeds-dead case this feature exists to catch. Gating health on checkpoint success would leave Feeds/dashboard green while digests starve.

**Locked order inside the fetch phase:**

1. Run `fetchFeeds` → obtain `FetchResult` (`articles`, `failedFeeds`, …).
2. If a `FetchResult` exists: best-effort `applyFeedFetchOutcomes(client, { attemptedFeedUrls: /* same URL list passed to fetchFeeds */, failedFeeds: result.failedFeeds })` — try/catch, log sanitized errors, **never** fail the run for health-update errors.
3. Then either:
   - zero articles → `markFailed` (Feature 02) and return (health already applied), or
   - non-zero articles → `savePhaseCheckpoint(..., { failedFeeds })` and continue.
4. If fetch throws **before** a `FetchResult` exists: no health update.
5. Invoke **only** inside the fetch-phase branch. Scrape/tag/score/selection/draft paths must not call it. When Feature 04 resume skips fetch (`startPhase !== "fetch"`), the fetch branch never runs → no double-counting. Do **not** require Feature 04 code to exist to verify this — structural placement is enough (see Testing approach).

Also export a small `countUnhealthyFeeds(feeds: Feed[]): number` helper for the dashboard (`operationalHealth === "unhealthy"`).

### Parse helper for runs UI

Add `parseRunFailedFeeds(failedFeedsJson: string): FeedFailure[]` in `shared/src/runs/` (or feeds/health): empty/`""` → `[]`; invalid JSON → `[]` + log; valid array → typed list (best-effort field reads). Used by Runs page; unit-tested.

### GUI — Feeds page

On `/feeds` table + cards (same fields both presentations — responsive convention):

- Keep existing qualification **Status** Badge (`untested` / `ok` / `failed`).
- Add **Health** Badge: `healthy` → `default` (or `outline`); `unhealthy` → `destructive`. Label text: `healthy` / `unhealthy`.
- When `consecutiveFetchFailures > 0` or unhealthy: show muted subtext or column **Fetch failures** as `N` (and when `lastFetchError` non-empty, truncate with `title` tooltip) — table column + card line. When `0` and healthy: show “—” for the error/reason fetch line.
- Optional filter: `?health=unhealthy` on `/feeds` — when set, page filters to `operationalHealth === "unhealthy"` before pagination (dashboard link uses this). Preserve `page` clamp behavior on the filtered set.
- **Query preservation:** when `health=unhealthy` is present, page-clamp redirects **and** `FeedsPagination` Prev/Next links must keep `health=unhealthy` (e.g. `/feeds?health=unhealthy&page=2`). Dropping the param on the first “Next” click breaks the dashboard deep-link path.

Do **not** rename the qualification Status column to “Health”.

### GUI — Runs page

On `/runs` list (Feature 03), when `parseRunFailedFeeds(run.failedFeeds)` is non-empty:

- Show a **Failed feeds** field (table column + card line): comma-separated feed URLs truncated, or count + first URL (e.g. `2 feeds failed` with `title` listing all). Prefer resolving names via a `url → name` map built from `listFeeds` on the page load when cheap (≤100 feeds); fall back to URL.
- If any failed URL maps to a feed with `operationalHealth === "unhealthy"`, append a destructive Badge **Unhealthy** on that row (once per row is enough).

When `failedFeeds` is empty: show “—” / omit Badge.

### GUI — Dashboard

On `web/app/(protected)/page.tsx`, beside the existing Database health card:

- New **Feeds health** card/indicator (`FeedsHealthCard` or equivalent under `web/components/`):
  - Load `listFeeds(getServerAppwrite())`; `unhealthyCount = countUnhealthyFeeds(feeds)`.
  - If `unhealthyCount === 0`: green/healthy presentation — Badge `default` / “Healthy”, short copy that all feeds are operationally healthy. Link still goes to `/feeds`.
  - If `unhealthyCount > 0`: red/unhealthy — Badge `destructive`, text includes the count (e.g. `3 unhealthy`), primary control is a **Link** to `/feeds?health=unhealthy`.
- Load errors: show destructive state with safe message; do not break the Database health card.
- Visual language: reuse Card/Badge/Alert patterns from `HealthCard`; do not invent a new design system. Green vs red must be obvious (icon + Badge), matching stage acceptance.

### Out of scope

- Changing attach-only-if-ok or excluding unhealthy feeds from Generate.
- Auto-demoting qualification `status` to `failed`.
- Email/push alerts; only in-app surfaces.
- Per-feed health history time series.
- Run retention (Feature 06).
- Indexes (in-memory filter/count on `listFeeds` V1 cap).

## Dependencies

- Builds on: **feature-01-run-checkpoints** — `failedFeeds` on run docs; fetch checkpoint opts.
- Builds on: **feature-02-on-demand-runs** — `executeRun` fetch phase + `config.feeds` / attempted URL list. **Execute Feature 02 before wiring the hook**; schema/repository/UI can be built and unit-tested with mocks first.
- Builds on: **feature-03-run-history** — `/runs` list to extend with Failed feeds column. Prefer Feature 03 before Runs UI task.
- Builds on: Stage 03 feeds schema, `listFeeds` / `createFeed` / `updateFeed` / `recordFeedTestResult`, Feeds responsive list, dashboard `HealthCard` pattern.
- Builds on: Stage 01 `FeedFailure` / `fetchFeeds` failure semantics.

## Constraints

- **Do not** change qualification `status` vocabulary or Test-feed behavior except leaving operational fields untouched.
- **Do not** auto-detach or block Generate solely for `operationalHealth === "unhealthy"`.
- **Do not** remove or rename existing feed attributes; only add the four listed.
- **Schema-as-code** only; create-if-absent attributes; drift → warn + skip (existing provisioner rules).
- **Server-only** Appwrite access; sanitize Appwrite errors; never log secrets.
- **Responsive domain lists:** Feeds/Runs changes must keep table + cards in sync.
- Health updates are **best-effort** telemetry and must not mark the run failed (including on the zero-article fatal path).

## Acceptance criteria

- [ ] Feeds schema declares `operationalHealth`, `consecutiveFetchFailures`, `lastFetchError`, `lastFetchAt`; `FEED_UNHEALTHY_THRESHOLD === 3`; create/URL-reset initialize healthy + zero failures.
- [ ] After three consecutive failed fetches for the same feed URL across runs, `operationalHealth` is `unhealthy`; a later successful fetch sets `healthy` and resets the counter to 0 (and clears `lastFetchError` to `""`).
- [ ] Qualification `status` is unchanged by `applyFeedFetchOutcomes`; `recordFeedTestResult` does not change operational-health fields.
- [ ] `executeRun` calls `applyFeedFetchOutcomes` whenever fetch produced a `FetchResult` (including zero-article fatal **before** `markFailed`); scrape/later phases and resume-without-fetch do not call it.
- [ ] Feeds page shows Health Badge (and failure hint); `/feeds?health=unhealthy` filters to unhealthy feeds; pagination/redirect URLs preserve `health` when set.
- [ ] Runs with non-empty `failedFeeds` show failed-feed info; rows involving currently unhealthy feeds show an Unhealthy indicator.
- [ ] Dashboard Feeds indicator is green when unhealthy count is 0, otherwise red with count linking to `/feeds?health=unhealthy`.
- [ ] Automated tests cover counter/threshold/reset, qualification isolation, parse helper, and executeRun hook (FetchResult path including zero-article fatal; not called from non-fetch phases); `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/schema/declarations.ts` — feed attributes + `FEED_OPERATIONAL_HEALTH` / `FEED_UNHEALTHY_THRESHOLD`
- Modify: `shared/src/schema/__tests__/declarations.test.ts` — assert new attributes / exports
- Modify: `shared/src/feeds/types.ts` — extend `Feed`
- Modify: `shared/src/feeds/repository.ts` — `documentToFeed`, `createFeed`, `updateFeed` (URL reset)
- Modify: `shared/src/feeds/__tests__/repository.test.ts` — create/URL-reset/mapping defaults
- Create: `shared/src/feeds/health.ts` — `applyFeedFetchOutcomes`, `countUnhealthyFeeds`, `isFeedUnhealthy`
- Create: `shared/src/feeds/__tests__/health.test.ts` — counter / threshold / reset / isolation / missing URL
- Modify: `shared/src/feeds/index.ts` (and package index) — exports
- Modify: `shared/src/runs/execute-run.ts` — fetch-phase health hook (Feature 02 file)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — asserts hook on FetchResult (incl. zero-article fatal) / not from later phases
- Create or modify: `shared/src/runs/failed-feeds.ts` (or under feeds) — `parseRunFailedFeeds` + tests
- Modify: `web/components/feeds/feeds-table.tsx`, `feed-list-card.tsx` — Health column/line
- Modify: `web/app/(protected)/feeds/page.tsx` — `health=unhealthy` filter
- Modify: `web/components/feeds/feeds-pagination.tsx` — preserve `health` (and `page`) in Prev/Next + clamp redirects
- Modify: `web/app/(protected)/runs/page.tsx` + runs list components — Failed feeds / Unhealthy
- Create: `web/components/feeds-health-card/feeds-health-card.tsx` (or similar)
- Modify: `web/app/(protected)/page.tsx` — render Feeds health card
- Modify: `web/src/__tests__/…` — Feeds health UI / dashboard link as needed
- Modify: `product_spec.md` — one-line Implemented features note at handoff

## Testing approach

Test-first for shared logic; UI verified with component/page tests where the repo already tests Feeds/Runs.

1. **declarations:** new attributes present; `FEED_UNHEALTHY_THRESHOLD === 3`; `FEED_OPERATIONAL_HEALTH` tuple.
2. **documentToFeed / createFeed:** missing fields map to healthy/0/`""`/null; create writes healthy + 0 + `""`.
3. **updateFeed URL change:** resets operational fields to healthy/0/`""`/null alongside qualification reset.
4. **applyFeedFetchOutcomes — increment:** one failure → counter 1, still healthy; three failures (three calls) → unhealthy.
5. **applyFeedFetchOutcomes — reset:** unhealthy feed + success → healthy, counter 0, `lastFetchError === ""`.
6. **Isolation:** does not write `status` / `lastTestError`; `recordFeedTestResult` mock path unchanged for operational fields when tested separately.
7. **Unknown URL:** no throw; no update.
8. **Per-feed error isolation:** one update failure does not prevent updating another feed (mock).
9. **parseRunFailedFeeds:** `""` / invalid / valid JSON cases.
10. **executeRun:** when fetch returns a `FetchResult`, `applyFeedFetchOutcomes` is invoked with attempted URLs + failures — including the zero-article fatal path (before/without requiring a saved fetch checkpoint). Not invoked from scrape/tag/score/selection/draft paths. If Feature 04 resume exists in-tree, also assert skip when `startPhase !== "fetch"`; otherwise the non-fetch-phase assertion is sufficient.
11. **countUnhealthyFeeds:** counts only `operationalHealth === "unhealthy"`.
12. **UI (web tests):** Feeds row shows unhealthy Badge when fixture unhealthy; dashboard link href includes `health=unhealthy` when count > 0; Feeds pagination link with filter preserves `health`; runs row shows failed-feed content when JSON present.

## Tasks

### Task 1: Schema + Feed type mapping

- **Action:** Add feed attributes and exports in `shared/src/schema/declarations.ts`. Extend `Feed` + `documentToFeed` / `createFeed` / URL-reset branch in `shared/src/feeds/repository.ts` and types. Update declarations + repository tests (including missing-field defaults).
- **Expected result:** Provisioner will create the four attributes on next boot; Feed type always exposes operational fields with safe defaults.
- **Verify:** `pnpm --filter @newsletter/shared test` — declarations + feeds repository tests green for new cases.
- **Depends on:** none.

### Task 2: `applyFeedFetchOutcomes` + helpers (test-first)

- **Action:** Write failing tests in `shared/src/feeds/__tests__/health.test.ts` for increment, threshold→unhealthy, success reset + empty `lastFetchError`, qualification field isolation, unknown URL, per-feed error isolation, `countUnhealthyFeeds`. Implement `shared/src/feeds/health.ts` (+ `getFeedByUrl` if needed). Export from feeds barrel. Add `parseRunFailedFeeds` + tests.
- **Expected result:** Pure shared health API ready for the executor and UI.
- **Verify:** health + parse tests pass; full shared suite green for these files.
- **Depends on:** Task 1.

### Task 3: Wire `executeRun` fetch-phase health hook

- **Action:** In `shared/src/runs/execute-run.ts`, inside the fetch-phase branch only: after `FetchResult` exists and **before** zero-article `markFailed` (and also on the happy path before/alongside checkpoint), best-effort `applyFeedFetchOutcomes`. Do not call from later phases. Extend `execute-run.test.ts`: assert call on happy-path fetch and on zero-article fatal; assert not called when execution is in scrape (or later) only. If Feature 04 resume is present, also assert skip when `startPhase !== "fetch"`; otherwise skip that case.
- **Expected result:** Every real fetch outcome updates feed health, including all-feeds-dead runs; resume/skip-fetch cannot double-count.
- **Verify:** execute-run tests cover FetchResult + zero-article call and non-fetch non-call; shared tests green.
- **Depends on:** Task 2; Feature 02 `execute-run.ts` must exist (escalate if missing).

### Task 4: Feeds page Health UI + filter

- **Action:** Add Health Badge + fetch-failure hint to `feeds-table.tsx` and `feed-list-card.tsx`. Support `?health=unhealthy` filter in `feeds/page.tsx` (filter before pagination). Update `feeds-pagination.tsx` (and page clamp redirects) so `health` is preserved in URLs when set. Keep qualification Status column unchanged. Add/adjust web tests for unhealthy Badge, filter, and pagination query preservation if patterns exist.
- **Expected result:** Operator can see and filter unhealthy feeds on `/feeds`; dashboard deep-link survives pagination.
- **Verify:** `pnpm --filter web test` (relevant) + `pnpm --filter web build`; visual fields match in table and cards; a pagination href with `health=unhealthy` still contains `health=unhealthy`.
- **Depends on:** Task 1.

### Task 5: Runs page failed-feed indicators

- **Action:** Extend Runs list UI to show Failed feeds from `parseRunFailedFeeds`; resolve names via `listFeeds` map when available; show Unhealthy Badge when any failed URL is currently unhealthy. Table + cards stay in sync.
- **Expected result:** Affected run rows identify fetch failures and current unhealthiness.
- **Verify:** web test or component test with fixture run JSON; `pnpm --filter web build`.
- **Depends on:** Task 2; Feature 03 Runs page must exist (escalate if missing).

### Task 6: Dashboard Feeds health card

- **Action:** Add Feeds health card on the dashboard page; green when count 0, red with count + link to `/feeds?health=unhealthy` when > 0; isolate load errors from DB health card. Update `product_spec.md` with a one-line Implemented features note.
- **Expected result:** Stage acceptance dashboard indicator is live.
- **Verify:** web test for href/count when possible; `pnpm typecheck`, `pnpm test`, `pnpm --filter web build` green.
- **Depends on:** Tasks 2 and 4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green; manually (or via tests) confirm: three mocked fetch failures → unhealthy on Feeds; success → healthy; dashboard red count links to filtered Feeds; a run with `failedFeeds` JSON shows Failed feeds on `/runs`; qualification Status unchanged after health updates.

## Handoff

Builder reports: files changed; confirm threshold 3; confirm qualification isolation; confirm executeRun hook on FetchResult including zero-article fatal + non-fetch non-call; note any Appwrite attribute-default quirks; confirm `product_spec.md` updated; list any deviations (e.g. `getFeedByUrl` vs list-filter) and why.

**Research note:** Stage file + Plan pin (“Qualification test ≠ ongoing health”); Feature 01 `failedFeeds` / Feature 02 executeRun (zero-article = no checkpoint) / Feature 03 Runs deferrals; codebase — `FeedFailure` in `shared/src/pipeline/types.ts`, feeds repository + dashboard `HealthCard`, no operational-health fields yet. Context7/Appwrite: required attributes need explicit values on create (same as `status`). Auto decisions: separate `operationalHealth` (do not overload `status`); threshold 3; success includes empty-but-fetched feeds; Test feed does not reset counters; unhealthy does not block Generate; health on any `FetchResult` (not gated on checkpoint); `/feeds?health=unhealthy` with pagination query preservation.
