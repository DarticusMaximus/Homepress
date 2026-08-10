# Feature 03: RSS publication

## Intent

Let the operator publish a completed issue to that newsletter’s public RSS feed (last 10 issues, no auth) from the Issues UI, and let RSS readers subscribe via a stable public URL — so finished digests reach subscribers without trapping them in the app.

## Spec

Implement **manual RSS publish** plus the **public feed endpoint**. Publish snapshots issue title + HTML into an Appwrite `rss_publications` collection (survives run/checkpoint retention); the public route builds RSS 2.0 XML from those snapshots on each request. Manual **Publish** and future auto-RSS (Feature 05) share one orchestration entry point. This feature does **not** auto-publish after runs (Feature 05), persist delivery-status badges (Feature 06), send email (Feature 02), or export downloads (Feature 04).

### Public URL & config (locked)

| Item | Contract |
|------|----------|
| Path | `/rss/[newsletterId].xml` |
| Auth | Unauthenticated. Middleware already excludes `*.xml` from the matcher; add a Next.js rewrite `/rss/:newsletterId.xml` → `/rss/:newsletterId` so an App Router route handler can serve it. Also treat pathnames starting with `/rss/` as public in `isPublicRoute` (belt-and-suspenders if anyone hits the rewrite target without `.xml`). |
| Empty feed | **404** when the newsletter is unknown **or** has zero publication snapshots. No empty `<channel>` with zero items. |
| Absolute URLs | Require `APP_PUBLIC_URL` (no trailing slash), e.g. `https://news.example.com`. Feed URLs = `${APP_PUBLIC_URL}/rss/${newsletterId}.xml`. Document in `.env.example` (comment may cite a generic example host — do not hard-code it in app logic). |
| Missing `APP_PUBLIC_URL` | Resolving absolute feed URL / building XML absolute `link`s fails with a clear operator-facing config error (never invent `localhost`). Delivery UI shows muted guidance to set the env var instead of a broken link. |

### Snapshot collection (locked)

New collection `rss_publications` (create-if-absent via schema-as-code):

| Attribute | Type | Notes |
|-----------|------|-------|
| `newsletterId` | string size 64 | Required |
| `runId` | string size 64 | Required; stable `guid` |
| `title` | string size 512 | Snapshot of Issues display title at publish time (future title generator can refresh via republish) |
| `htmlBody` | string size **200000** | Full HTML from `draftMarkdownToEmailHtml` |
| `pubDate` | datetime | Run **`endedAt`** only (ISO) |
| `updatedAt` | datetime | Last upsert time |

- Document `$id` = `runId` (one publication doc per run; upsert is `get`/`create`/`update` by that id).
- Permissions: empty read/write arrays (server API-key only) — same pattern as other collections. Public clients never talk to Appwrite.
- Constants: `RSS_PUBLICATIONS_COLLECTION_ID`, `RSS_FEED_MAX_ITEMS = 10`, `RSS_HTML_BODY_ATTR_SIZE = 200000`, `RSS_TITLE_ATTR_SIZE = 512`.

**Retention independence:** Feed reads **only** snapshots. Do not rebuild from draft checkpoints on GET (Stage 04 retention can purge runs/checkpoints).

### Item & channel XML (locked)

RSS 2.0 with `content:encoded` (Dublin Core / content namespace as needed for that element).

**Channel**

| Element | Value |
|---------|-------|
| `title` | Newsletter `name` |
| `link` | Absolute feed URL |
| `description` | Short stable blurb, e.g. `{name} — published issues` |
| `lastBuildDate` | Newest item `pubDate` (RFC 822) |

**Item** (newest `pubDate` first; max 10)

| Element | Value |
|---------|-------|
| `title` | Snapshot `title` |
| `link` | Absolute feed URL (no public issue page in V1) |
| `guid` | `runId` (`isPermaLink="false"`) |
| `pubDate` | Snapshot `pubDate` as RFC 822 |
| `description` | **Same HTML as `content:encoded`** (snapshot `htmlBody`, CDATA-safe) — not plain-text, not empty, not a truncated excerpt |
| `content:encoded` | Snapshot `htmlBody` (CDATA-safe) |

Escape XML text nodes; put HTML in CDATA for both `description` and `content:encoded`.

### Publish orchestration (locked)

Shared entry point (name may vary slightly; keep intent):

```ts
publishIssueToRss(client, runId): Promise<PublishIssueToRssResult>
```

Order:

1. `loadIssueDraft(client, runId)` — on failure / empty markdown → do not write. Operator-facing:
   - `IssueLoadError` → `Couldn’t load this issue for publishing`
   - Empty/whitespace markdown → `Issue draft is empty`
2. Require `run.endedAt` non-empty — else `Issue is missing an end time` (no write). `pubDate` is **only** `endedAt` (no `startedAt` fallback).
3. `getNewsletter(client, run.newsletterId)` — on failure → `Couldn’t load newsletter for publishing`.
4. Resolve title via `resolveIssueDisplayTitle({ markdown, newsletterName, dateIso: run.endedAt })`.
5. `htmlBody = draftMarkdownToEmailHtml(markdown)` (Feature 02 helper).
6. Upsert snapshot (`$id = runId`): create or update `newsletterId`, `runId`, `title`, `htmlBody`, `pubDate: run.endedAt`, `updatedAt`.
7. **Trim:** List publications for that `newsletterId` ordered by `pubDate` desc; if count > 10, delete oldest beyond 10.
8. Return success (e.g. `{ ok: true, newsletterId, runId }`).

**Republish (locked):** Same run id → update snapshot in place (refresh title/HTML/`pubDate` from current draft/`endedAt`). Success — not an error, not a duplicate item. Enables future issue-title stage to refresh feed titles via Publish.

**Appwrite failure (locked operator-facing):** `Failed to publish to RSS` (sanitize logs; no secrets).

### Manual Publish UI (locked)

- Surface: issue detail success path only (same eligibility as Send).
- Control: **Publish** button (label locked: `Publish`) in the chrome row with Back / Inspect / Send.
- Server action (e.g. `publishIssueToRssAction(runId)`): calls shared `publishIssueToRss` with `getServerAppwrite()`.
- Feedback: `toast.success` e.g. `Published to RSS`; `toast.error` with operator-facing message; disable while pending; no confirmation dialog.
- No lasting “published” badge / run schema fields (Feature 06).

### Feed URL in Delivery UI (locked)

In newsletter edit **Delivery** section (Feature 01): show a read-only copyable absolute feed URL whenever `APP_PUBLIC_URL` is set — **even before first publish** (URL is stable; route 404s until first snapshot). If env unset, muted copy: tell the operator to set `APP_PUBLIC_URL`. Do not invent a host.

### Out of scope

- Auto-RSS after successful run (Feature 05).
- Delivery status / failure persistence on runs (Feature 06).
- Public Issues HTML pages / deep links into digests.
- Email send / MD-HTML download.
- Subscriber signup, Atom-only feeds, CDN-hosted static XML files.

## Dependencies

- **Hard execute prerequisite:** **feature-02-email-delivery** must be `verified` before this feature is executed (needs `draftMarkdownToEmailHtml`, Issues Send UI patterns, shared `delivery/` module layout). Feature 01 must already be verified as Feature 02’s prerequisite (`getNewsletter`, Delivery section).
- Builds on: Stage 06 `loadIssueDraft` / `resolveIssueDisplayTitle` / issue detail success path.
- Soft consumers: Feature 05 (call `publishIssueToRss`), Feature 06 (record outcomes later).

## Constraints

- Do not start `ssc-execute` for this feature until Feature 02 is verified.
- Schema-as-code only; create-if-absent; no drop/rename/retype/migrate.
- Server-only Appwrite access for publish and feed generation (API key). Public route must not expose API keys or session cookies as a requirement.
- Snapshots only for feed body — never depend on live checkpoints at GET time.
- `pubDate` = `endedAt` only.
- Max **10** items per newsletter feed after every publish.
- No delivery-status schema on runs in this feature.
- `pnpm typecheck` and `pnpm lint` must pass.
- Secrets / env dumps must not appear in logs or toasts.

## Acceptance criteria

- [ ] `rss_publications` is declared with the locked attributes/constants; declarations tests assert them.
- [ ] `publishIssueToRss` loads draft + newsletter, upserts a snapshot keyed by `runId`, trims to 10 oldest-dropped, requires `endedAt`, uses Feature 02 HTML helper; republish updates in place.
- [ ] Unit tests cover XML shape (channel/item/guid/`content:encoded` **and** `description` with the same HTML), trim, republish upsert, missing `endedAt` / empty draft / load failures (no Appwrite write), and `APP_PUBLIC_URL` resolution.
- [ ] `GET /rss/[newsletterId].xml` returns `application/rss+xml` (or `application/xml` + correct RSS root) with up to 10 items when publications exist; **404** when newsletter unknown or zero publications; no auth required; **rewrite** `/rss/:id.xml` → `/rss/:id` is asserted in tests.
- [ ] Issue detail success UI shows **Publish**; action + toasts + in-flight disable work; re-publish allowed.
- [ ] Newsletter edit Delivery shows copyable feed URL when `APP_PUBLIC_URL` is set (including pre-first-publish).
- [ ] `.env.example` documents `APP_PUBLIC_URL`.
- [ ] No auto-RSS, delivery-status persistence, or public Issues pages.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Create: `shared/src/delivery/rss-publications.ts` (types + repository helpers) — or `shared/src/rss/` if cleaner; prefer under `delivery/` next to email
- Create: `shared/src/delivery/rss-xml.ts` (pure builder)
- Create: `shared/src/delivery/app-public-url.ts` (env → base URL)
- Create: `shared/src/delivery/publish-issue-to-rss.ts` (orchestration)
- Modify: `shared/src/delivery/index.ts` (re-exports)
- Create: `shared/src/delivery/__tests__/rss-xml.test.ts`
- Create: `shared/src/delivery/__tests__/app-public-url.test.ts`
- Create: `shared/src/delivery/__tests__/publish-issue-to-rss.test.ts`
- Create: `shared/src/delivery/__tests__/rss-publications.test.ts` (repo trim/upsert)
- Modify: `web/next.config.mjs` (rewrite `.xml` → route)
- Create: `web/app/rss/[newsletterId]/route.ts` (GET handler)
- Modify: `web/lib/auth/routes.ts` (`/rss/` public prefix)
- Modify: `web/src/__tests__/routes.test.ts`
- Create: `web/src/__tests__/rss-feed-route.test.ts`
- Create: `web/src/__tests__/next-config-rss-rewrite.test.ts` (case 17b — assert rewrite in `next.config.mjs`)
- Create: `web/components/issues/publish-issue-button.tsx`
- Modify: `web/components/issues/issue-reader.tsx` (wire Publish beside Send — may land after Feature 02 Send exists)
- Modify: `web/app/(protected)/issues/actions.ts` (or create; add publish action)
- Create: `web/src/__tests__/publish-issue-button.test.tsx`
- Create: `web/src/__tests__/publish-issue-to-rss-action.test.ts`
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx` (feed URL in Delivery)
- Modify: `web/src/__tests__/newsletter-form-delivery.test.tsx` (feed URL cases)
- Modify: `.env.example`

## Testing approach

Test-first. No live Appwrite/network for unit tests (mock Databases).

### `rss-xml.test.ts`

1. **Channel** — name + absolute feed link + description present.
2. **Item fields** — title, guid=`runId`, link=feed URL, `content:encoded` contains HTML, **`description` contains the same HTML as `content:encoded`**, `pubDate` RFC 822 derived from ISO `endedAt`.
3. **Order / max** — builder given >10 inputs still emits ≤10 when caller passes trimmed list (builder itself may assume pre-trimmed).
4. **Escape** — titles with `<` / `&` do not break XML.

### `app-public-url.test.ts`

5. **Happy** — env set without trailing slash → returned; trailing slash stripped.
6. **Missing** — unset/blank → config error with stable message.

### `rss-publications.test.ts`

7. **Upsert create** — no existing doc → create with `$id=runId`.
8. **Upsert update** — existing → update title/htmlBody/pubDate (republish).
9. **Trim** — 11 docs for one newsletter → after publish/trim helper, 10 remain (oldest `pubDate` removed).

### `publish-issue-to-rss.test.ts`

10. **Success** — mock draft + newsletter + endedAt → upsert called; trim invoked.
11. **Republish** — second call same runId → update path; still success.
12. **Missing endedAt** — no write; error `Issue is missing an end time`.
13. **Empty draft / load failure / newsletter failure** — no write; locked messages.
14. **Appwrite failure** — `Failed to publish to RSS`.

### Web

15. **Route 200** — mocked publications → 200 + RSS body + rss content-type (handler at `/rss/[newsletterId]`).
16. **Route 404** — zero publications or missing newsletter → 404.
17. **isPublicRoute** — `/rss/some-id` (and trailing slash) public; arbitrary paths still private.
17b. **Rewrite config** — `web/next.config.mjs` exports a rewrite from `/rss/:newsletterId.xml` → `/rss/:newsletterId` (assert in a dedicated unit test that imports/reads the config — do **not** rely only on hitting the non-`.xml` handler).
18. **Publish button** — shown on success path; pending disables; success/error toasts.
19. **Delivery feed URL** — with env mocked, edit Delivery shows absolute `/rss/{id}.xml` URL; without env, guidance copy (no fake host).

## Tasks

### Task 1: Failing tests for URL config, XML builder, publications repo expectations

- **Action**: Add `app-public-url.test.ts` (cases 5–6), `rss-xml.test.ts` (cases 1–4, including `description` === `content:encoded` HTML), and `rss-publications.test.ts` (cases 7–9) failing red for missing modules. Declarations assertions for the new collection may be added here or Task 2.
- **Expected result**: New tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new RSS tests failing (not infra errors).
- **Depends on**: none.

### Task 2: Schema `rss_publications` + constants

- **Action**: Append collection + export constants in `shared/src/schema/declarations.ts`; make declarations tests green for the new collection/attributes/constants.
- **Expected result**: Schema-as-code includes `rss_publications` with locked fields.
- **Verify**: `pnpm --filter @newsletter/shared test` — declarations assertions green.
- **Depends on**: Task 1.

### Task 3: `APP_PUBLIC_URL` helper + RSS XML builder + publications repository

- **Action**: Implement `app-public-url.ts`, `rss-xml.ts`, and `rss-publications.ts` (upsert by `runId`, list-by-newsletter ordered by `pubDate` desc, trim-to-10 delete). Make cases 1–9 green. Export from `delivery/index.ts`.
- **Expected result**: Pure XML + persistence helpers ready for orchestration and the public route; item `description` and `content:encoded` carry the same HTML.
- **Verify**: `pnpm --filter @newsletter/shared test` — URL/XML/publications tests green.
- **Depends on**: Task 2.

### Task 4: Failing orchestration tests + implement `publishIssueToRss`

- **Action**: Add `publish-issue-to-rss.test.ts` (cases 10–14) red, then implement `publishIssueToRss` per Spec (draft → endedAt → newsletter → title → HTML → upsert → trim). Make green.
- **Expected result**: Shared publish entry point ready for Feature 05; republish upserts; no status schema writes.
- **Verify**: `pnpm --filter @newsletter/shared test` — all delivery RSS orchestration tests green.
- **Depends on**: Task 3.

### Task 5: Public feed route + rewrite + public-route allowlist

- **Action**: Add rewrite in `web/next.config.mjs` (`/rss/:newsletterId.xml` → `/rss/:newsletterId`); implement `web/app/rss/[newsletterId]/route.ts` (load newsletter + publications; 404 if missing/empty; else XML with `Content-Type: application/rss+xml`); extend `isPublicRoute` for `/rss/` prefix; tests 15–17 **and 17b** (rewrite config assert required).
- **Expected result**: Unauthenticated `GET /rss/{id}.xml` works via rewrite; empty → 404; rewrite is covered by an automated assert.
- **Verify**: `pnpm --filter @newsletter/web test` — rss route + routes + rewrite-config tests green.
- **Depends on**: Task 4.

### Task 6: Publish button + server action

- **Action**: Add `publish-issue-button.tsx` + `publishIssueToRssAction` (mirror Send); wire into issue success chrome beside Send; tests case 18.
- **Expected result**: Operator can Publish from `/issues/[runId]` success path; toast + in-flight disable; re-publish allowed.
- **Verify**: `pnpm --filter @newsletter/web test` — publish button/action tests green.
- **Depends on**: Task 4, Task 5.

### Task 7: Delivery feed URL + `.env.example` + monorepo gates

- **Action**: Show copyable absolute feed URL in newsletter edit **Delivery** (case 19); document `APP_PUBLIC_URL` in `.env.example`; run full monorepo gates and fix fallout.
- **Expected result**: Operator can copy the stable `/rss/{id}.xml` URL from edit Delivery when env is set; template documents the key; typecheck + lint clean.
- **Verify**: `pnpm --filter @newsletter/web test` — delivery feed URL cases green; `pnpm typecheck && pnpm lint` pass; shared + web RSS-related tests still green.
- **Depends on**: Task 6.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint`
- Expected: All tests pass including RSS XML/repo/orchestration (`description` === `content:encoded`), public route 200/404, **rewrite config assert**, Publish UI/action, Delivery feed URL, and `/rss/` public-route cases; typecheck and lint clean. Optional smoke: with `APP_PUBLIC_URL` set and a published issue, `curl` the `.xml` URL without cookies and see ≤10 items — not required for verifier automation.

## Handoff

Builder reports: files changed; confirmation Feature 02 was verified before execute; sample operator-facing errors (missing endedAt, empty draft, load failures, publish failure, missing `APP_PUBLIC_URL`); confirmation snapshots are used at GET time (not live checkpoints); confirmation republish upserts by `runId`; confirmation empty feed → 404; confirmation rewrite test covers `.xml` → handler; confirmation item `description` matches `content:encoded`; any deviation (file layout under `delivery/` vs `rss/`, content-type variant) and why. Note for Feature 05: call `publishIssueToRss` when `autoRss`; Feature 06: record outcomes separately; future title stage: republish refreshes snapshot `title`.

## Research notes

- **Grill (2026-07-17)** — Snapshot collection + on-request XML; item title/HTML/guid=runId; **pubDate=`endedAt` only**; republish upsert for future titles; `/rss/[id].xml` + 404 if empty; `<link>`=feed URL (no public Issues in V1); `APP_PUBLIC_URL`; copyable URL in Delivery; Publish mirrors Send; RSS 2.0 + `content:encoded`; Feature 02 hard prerequisite.
- **Grizzled Senior (2026-07-17)** — Applied: rewrite config assert (case 17b); pin `description` === `content:encoded` HTML; split Task 6 → Publish UI vs Delivery URL + `.env`/gates (Task 7).
- **codegraph_explore** — `PUBLIC_ROUTES` / middleware matcher already skips `*.xml`; `IssueReader` chrome; `loadIssueDraft` / `resolveIssueDisplayTitle`; Feature 01/02 delivery patterns; no existing RSS publisher in the TS app.
- **Appwrite docs (context7)** — string attributes support large `size` (project already uses up to 100000); `htmlBody` size **200000**.
- **next.config** — no rewrites yet; Feature 03 adds `/rss/:newsletterId.xml` → `/rss/:newsletterId`.
