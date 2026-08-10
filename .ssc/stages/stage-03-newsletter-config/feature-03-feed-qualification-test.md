# Feature 03: Feed qualification test

## Intent

Give the operator a one-shot **Test feed** action that proves an RSS source is reachable and that at least one article body can be scraped (`extracted`) — then records `ok` or `failed` with a visible reason — so newsletters only attach sources that have already cleared the pre-use gate without digging through logs.

## Spec

Add operator-triggered feed qualification on top of feature 02’s Feeds library. Reuse Stage 01’s `fetchFeeds` and `scrapeArticle`; do **not** reimplement RSS parsing or Readability scraping. Persist results on the feed document (`status`, `lastTestedAt`, `lastTestError`, `updatedAt`). Demoting a feed to `failed` does **not** detach existing `newsletter_feeds` rows (Stage 04 pin owns run-time invalid-config handling).

### Pass / fail contract

**Pass (`ok`)** only when both are true:

1. The RSS feed is fetched and yields at least one article with a usable `http:` / `https:` link.
2. Scraping that article returns `ScrapeResult.source === "extracted"`.

**Fail (`failed`)** for every other outcome, including scraper `source: "fallback"` (RSS description alone is **not** a pass — that is exactly the “site blocked the article pull” case).

### Qualification algorithm (`qualifyFeed`)

Pure shared helper in `shared/src/feeds/qualify.ts` (or equivalent under `shared/src/feeds/`). Input: feed URL string. Returns a Promise of a structured result (does not touch Appwrite):

```ts
type QualifyFeedResult =
  | { ok: true }
  | { ok: false; reason: string };

async function qualifyFeed(
  url: string,
  deps?: {
    fetchFeeds?: typeof fetchFeeds;
    scrapeArticle?: typeof scrapeArticle;
  },
): Promise<QualifyFeedResult>;
```

Injectable deps default to the real Stage 01 exports so unit tests never hit the network. Dep return types must be the same Promises as the real functions.

Steps:

1. `await fetchFeeds([url], { dateRange: "all" })` — **no newsletter lookback**; do **not** pass `limitPerFeed: 1` (that slices raw items before `createArticle` and can miss a later valid item). Omit `limitPerFeed` entirely for this one-feed call.
2. If `failedFeeds.length > 0` → fail with operator reason **"Could not fetch the RSS feed"** (append a short safe detail when available: timeout → `" (timed out)"`; HTTP status → `" (HTTP 403)"`; otherwise leave the base string). Log full `FeedFailure` server-side with `sanitizeUrlForLog`.
3. If `articles.length === 0` → fail with **"Feed has no articles"**.
4. Walk `articles` in order; pick the **first** whose `link` is a usable absolute `http:` / `https:` URL. For each candidate: try `new URL(link)`; if the constructor **throws** (relative, malformed, empty after trim) **or** the protocol is not `http:`/`https:`, **skip that article and continue** — never throw out of `qualifyFeed` for a bad link. If none qualify → fail with **"Feed items have no article links"**.
5. `await scrapeArticle(article.link, article.content ?? "")`. If `source !== "extracted"` → fail with **"Could not retrieve article content"** (append short safe detail from `ScrapeResult.error` when present and short — e.g. `" (timeout)"`, `" (HTTP 403)"`, `" (not readable)"` for `not-readerable`; never dump HTML or stack traces). Log full scrape diagnostic server-side.
6. Otherwise → `{ ok: true }`.

### Persist test result (`recordFeedTestResult`)

Add to `shared/src/feeds/repository.ts` (feature 02 module):

- `getFeed(client, feedId)` — load one feed by `$id`; throw `FeedRepositoryError` `not_found` if missing.
- `recordFeedTestResult(client, feedId, result)` where `result` is `{ status: "ok" } | { status: "failed"; error: string }`:
  - Always set `lastTestedAt` and `updatedAt` to ISO now.
  - On `ok`: `status: "ok"`, **always write `lastTestError: ""`**. Do **not** omit or null the field — Appwrite `updateDocument` omit leaves a prior failed reason in place, which would show a stale error after a green re-test.
  - On `failed`: `status: "failed"`, `lastTestError` = trimmed reason truncated to **1000** chars (schema max).
  - Does **not** list, create, or delete `newsletter_feeds` rows (including on demotion from `ok` → `failed`).
  - Throws `FeedRepositoryError` (`not_found` | `appwrite`) with safe messages — same error contract as feature 02.

Also extend `FeedRepositoryError` codes only if needed; prefer reusing `not_found` / `appwrite`. Do **not** add a `test` code unless the action needs to distinguish qualify failures from persistence failures — qualify failures are expected business outcomes returned as `{ ok: false, error }`, not thrown.

### Server action

In `web/app/(protected)/feeds/actions.ts`, add `testFeed(feedId: string)`:

1. `getServerAppwrite()` → `getFeed` → read `url`.
2. Run `qualifyFeed(feed.url)`.
3. `recordFeedTestResult` with `ok` or `failed` + reason.
4. `revalidatePath("/feeds")`.
5. Return `{ ok: true } | { ok: false, error: string }` — on qualify failure, `error` is the same operator reason persisted to `lastTestError` (so the toast matches the table). On persistence/`not_found` failure, return the repository safe message.

Never log API keys, session secrets, or full env dumps. Log qualify diagnostics as `{ phase: "feed-qualify", feedId, code/message }` with sanitized URLs.

### GUI (Feeds page — extend feature 02)

- Each table row **Actions**: **Test** control alongside Edit / Delete (any status: `untested` | `ok` | `failed`).
- While that row’s test is in flight: disable **that** row’s Test button and show **"Testing…"** (no full-page blocker; other rows remain usable).
- On completion: `toast.success` (e.g. “Feed looks good”) or `toast.error(reason)`; list refreshes via revalidation / router refresh so Badge and reason update.
- **Reason column or subtext:** when `status === "failed"`, show `lastTestError` truncated in the table (title/tooltip or expand for full text). When `ok` or `untested`, show "—" / empty for the reason.
- Badge map unchanged: `untested` → `secondary`, `ok` → `default`, `failed` → `destructive`.

### Out of scope

- Auto-detach on demotion; run-time “attached but not ok” enforcement (Stage 04 — see stage pin).
- Multi-article scrape retry; worker job queue; Playwright e2e.
- Newsletter attach UI (feature 05); schema/provisioner changes (feature 01).
- Changing Stage 01 fetcher/scraper defaults or production date-range behavior.

## Dependencies

- Builds on: **feature-01-feeds-and-newsletters-schema** — `FEEDS_COLLECTION_ID`, `FeedStatus` / `FEED_STATUSES`, `lastTestedAt` / `lastTestError` attributes.
- Builds on: **feature-02-feed-library-page** — Feeds page, `shared/src/feeds/` repository + `FeedRepositoryError`, server actions pattern, table/dialogs/toasts. **Execute feature 02 before this feature**; if the feeds module or `/feeds` UI is missing, stop and escalate.
- Builds on: Stage 01 — `fetchFeeds` (`dateRange: "all"` supported), `scrapeArticle` / `ScrapeResult`, `sanitizeUrlForLog`.

## Constraints

- **Reuse** `fetchFeeds` and `scrapeArticle`; do not fork RSS/HTML extraction.
- **Pass requires `extracted`**, never `fallback`.
- **Server-only** Appwrite access via API key client (same as feature 02).
- **Do not detach** attachments when status becomes `failed`.
- **Do not** change schema/provisioner, nav order, or badge variant map.
- **Do not** add worker jobs or cron for qualification.
- **Secrets:** no keys/hosts dumps in UI errors or client logs.
- Truncate persisted `lastTestError` to 1000 characters.

## Acceptance criteria

- [ ] Feeds table shows a **Test** action on every row; it can be run for `untested`, `ok`, and `failed` feeds.
- [ ] Successful test (reachable feed + `extracted` scrape) sets `status: "ok"`, sets `lastTestedAt`, writes `lastTestError: ""` (clears any prior reason), and shows success feedback without log-diving.
- [ ] Failed RSS fetch / empty feed / no usable links / non-`extracted` scrape sets `status: "failed"`, sets `lastTestedAt`, and shows a short human-readable `lastTestError` in the UI (toast + table).
- [ ] Qualification uses `dateRange: "all"` (not newsletter lookback) and scrapes only the first article with a usable http(s) link (single scrape attempt).
- [ ] Re-testing an `ok` feed that then fails demotes it to `failed` with a new reason; attachments are left in place.
- [ ] Re-testing a `failed` feed that then passes promotes it to `ok` automatically (no extra confirmation).
- [ ] `qualifyFeed` unit tests cover pass/fail branches with mocked fetch/scrape (no live network required for automated gate).
- [ ] `pnpm --filter @newsletter/shared test` (feeds qualify + repository), `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` pass.
- [ ] **PM manual gate:** known-good feed → `ok`; bad URL or blocked/unscrapeable case → `failed` with visible reason.

## Files

- Create: `shared/src/feeds/qualify.ts` (`qualifyFeed` + result type + injectable deps)
- Create: `shared/src/feeds/__tests__/qualify.test.ts`
- Modify: `shared/src/feeds/repository.ts` (`getFeed`, `recordFeedTestResult`)
- Modify: `shared/src/feeds/types.ts` (types for test result input if needed)
- Modify: `shared/src/feeds/index.ts` (export qualify + new repository fns)
- Modify: `shared/src/feeds/__tests__/repository.test.ts` (record/get coverage)
- Modify: `web/app/(protected)/feeds/actions.ts` (`testFeed` server action)
- Modify: `web/components/feeds/feeds-table.tsx` (and related) — Test button, Testing… state, reason display
- Modify: `.ssc/stages/stage-03-newsletter-config.md` — pin + resolve open questions (done in this feature’s authoring pass; builder confirms still present)
- Modify: `product_spec.md` — note feed qualification under Implemented features at handoff

## Testing approach

**Test-first for `qualifyFeed` and `recordFeedTestResult`.** GUI verified by build/typecheck/lint + PM manual gate (no Playwright in this feature).

### `qualify.test.ts` (inject mocks)

- **Pass:** mock `fetchFeeds` returns one article with `https` link; mock `scrapeArticle` returns `{ source: "extracted", ... }` → `{ ok: true }`. Assert called with `dateRange: "all"`.
- **Feed fetch failure:** `failedFeeds` non-empty → `{ ok: false, reason }` starts with `"Could not fetch the RSS feed"`.
- **No articles:** empty `articles`, empty `failedFeeds` → `"Feed has no articles"`.
- **No usable links:** articles with empty/`ftp:`/relative/malformed links only → `"Feed items have no article links"`; scrape not called; `qualifyFeed` does not throw.
- **Skips bad link, uses next:** first article relative or bad scheme (would throw or fail `URL` / protocol check), second `https` → scrape called with second link; pass if extracted.
- **Fallback scrape:** `source: "fallback"` → fail `"Could not retrieve article content"` (not pass).
- **Does not use `limitPerFeed: 1`** in the options passed to `fetchFeeds` (assert options omit it or do not set `1`).
- **Async:** `qualifyFeed` returns a Promise (tests `await` it).

### `repository.test.ts` additions

- **getFeed:** returns mapped feed; missing → `not_found`.
- **recordFeedTestResult ok:** writes `status: "ok"`, sets `lastTestedAt`/`updatedAt`, writes `lastTestError: ""` (assert the empty string is present in the update payload — not omitted); **does not** list/create/delete `newsletter_feeds`.
- **recordFeedTestResult failed:** writes `status: "failed"`, stores truncated reason ≤ 1000 chars; **does not** list/create/delete `newsletter_feeds`.
- **Demotion:** prior `ok` document can be updated to `failed`; **does not** list/create/delete `newsletter_feeds` (no attachment queries).

### Web automated

- Build / typecheck / lint / full `pnpm test` green.
- No requirement for a dedicated nav test beyond feature 02’s.

### PM manual gate

1. Features 01–02 present; worker provisioned; at least one feed on `/feeds`.
2. Test a known-good public feed → Badge `ok`; reason cleared; toast success.
3. Test a nonsense URL or known-blocked case → Badge `failed`; reason visible in table without opening logs.
4. Re-test the failed feed after fixing URL (or use a good feed that was demoted) → returns to `ok` with no confirm dialog.
5. Confirm Test is available on an already-`ok` row.

## Tasks

### Task 1: Failing qualify + repository tests

- **Action:** Add `shared/src/feeds/__tests__/qualify.test.ts` covering Testing approach. Extend `repository.test.ts` for `getFeed` / `recordFeedTestResult`. Do **not** implement production qualify/record yet — tests must fail on missing exports or failing assertions.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/feeds` exits non-zero for the new cases (not harness misconfig).
- **Verify:** Run that command; failures cite missing `qualifyFeed` / `recordFeedTestResult` / `getFeed` or unmet assertions.
- **Depends on:** none for writing tests; **feature-02 must be verified before Task 2** (feeds module must exist).

### Task 2: Implement qualify helper + repository persistence

- **Action:** Implement `shared/src/feeds/qualify.ts` per Spec (`async` / `Promise<QualifyFeedResult>`; injectable `fetchFeeds` / `scrapeArticle`; `dateRange: "all"`; skip bad/relative links without throwing; `extracted`-only pass; operator reason strings). Add `getFeed` + `recordFeedTestResult` to `repository.ts` (on `ok` always write `lastTestError: ""`; never touch `newsletter_feeds`). Export from barrel / `shared/src/index.ts` as needed. Do not change Stage 01 pipeline modules except imports.
- **Expected result:** Feeds qualify + repository unit tests green.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/feeds` — all green. `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1; **feature-02 verified**.

### Task 3: Server action + Feeds UI Test control

- **Action:** Add `testFeed` to `web/app/(protected)/feeds/actions.ts` (get → qualify → record → revalidate → `{ ok, error? }`). Wire per-row Test / Testing… / toasts / failed-reason display on the Feeds table components from feature 02. Do not add Test inside create/edit dialogs only — row action is required.
- **Expected result:** Authenticated operator can run Test from `/feeds` and see status/reason update after refresh.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Confirm action imports shared qualify/repository APIs and does not call `Databases` for the qualify network path. Confirm no worker job registration for qualification.
- **Depends on:** Task 2.

### Task 4: Regression + product_spec note

- **Action:** Run full `pnpm test`, fix fallout. Update `product_spec.md` Implemented features with a one-line feed qualification entry. Confirm Stage 03 pin about demotion-without-detach / Stage 04 invalid-config remains in `.ssc/stages/stage-03-newsletter-config.md`. Confirm no schema/provisioner edits and no auto-detach logic.
- **Expected result:** Full suite green; product_spec reflects Test feed; stage pin present.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero. Diff review: demotion does not delete `newsletter_feeds`; qualify uses `extracted` gate.
- **Depends on:** Task 3.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/feeds && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: Qualify tests prove `dateRange: "all"`, `extracted`-only pass, fallback fails, reason strings, first usable link selection. Repository tests prove status/`lastTestedAt`/`lastTestError` updates without junction mutation. Full suite green. Web build includes Test action wiring.

### Stage B — PM manual gate

- Known-good feed → `ok`; bad/blocked case → `failed` with visible reason; re-test anytime; demotion does not require (or perform) detach.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `shared/src/feeds/` and Feeds UI/actions.
- Confirmation of test/build/typecheck/lint commands and results.
- Exact public exports (`qualifyFeed`, `getFeed`, `recordFeedTestResult`, result types).
- Confirmation of locked decisions below as implemented (or deviations + why).
- Confirmation that Stage 01 `fetchFeeds` / `scrapeArticle` were reused (no scraper fork).
- **Research note:** Stage 01 `ArticleScraper.scrape` never throws and treats blocked/unreadable pages as `source: "fallback"` — qualification must treat only `extracted` as success. `RSSFetcher` default `dateRange` is `"yesterday"` and `limitPerFeed: 1` slices **raw** items before validation — qualification must pass `dateRange: "all"` and must not use `limitPerFeed: 1`. Appwrite `updateDocument` omit does not clear prior attribute values — on `ok` always write `lastTestError: ""`. Feature 02 error pattern (repository throws / actions return `{ ok, error }`) extended for `testFeed`.

## Locked decisions (PM confirmed 2026-07-09)

1. **Pass** = RSS yields a usable article URL **and** scrape `source: "extracted"`; fallback-only = fail.
2. **Fetch window:** `dateRange: "all"`; first article with usable http(s) link; **one** scrape attempt; no multi-article retry in V1.
3. **Do not use `limitPerFeed: 1`** for qualification (raw-slice pitfall).
4. **Bad / relative / malformed links:** skip and continue the walk; never throw from `qualifyFeed` for a bad link.
5. **`qualifyFeed` is async** — returns `Promise<QualifyFeedResult>`.
6. **Re-test anytime** (including already-`ok`).
7. **Success → `ok` automatically**; **failure → `failed`** (including demoting prior `ok`); no extra confirm step.
8. **On `ok`, always write `lastTestError: ""`** (omit does not clear Appwrite).
9. **UI:** per-row Test; Testing… on that row; toast + refresh; `lastTestError` visible on `failed` rows.
10. **Execution:** Next.js server action + shared `qualifyFeed` (not a worker job). Slow sites failing the gate is acceptable.
11. **Demotion does not detach** attachments (no junction I/O on any test-result write); Stage 04 must treat attached-but-not-`ok` as invalid config at run time (stage pin).
12. **Reasons:** short operator-facing strings in UI/DB; detailed diagnostics in server logs only.
13. **Canonical reason bases:** `"Could not fetch the RSS feed"` | `"Feed has no articles"` | `"Feed items have no article links"` | `"Could not retrieve article content"` (optional short parenthetical detail).
