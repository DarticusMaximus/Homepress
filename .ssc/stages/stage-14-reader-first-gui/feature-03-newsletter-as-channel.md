# Feature 03: Newsletter as channel

## Intent

Make reader Newsletters a channel directory: pick a newsletter, see its recent issues as cards — so daily catch-up can follow one digest without opening factory config.

## Spec

Replace Feature 01’s names-only stub at `/newsletters` with a linked channel list. Add a channel page at `/newsletters/[id]` that lists that newsletter’s eligible issues with the same cards as Home. Create / Edit / Generate and other config stay at `/admin/newsletters` (list) and `/admin/newsletters/[id]` (edit). Feature 04 still owns issue ops chrome; this feature does not hide or show Inspect / Send / Publish.

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| Channel URL | `/newsletters/[id]` (Appwrite document id, not a slug). |
| Config URL | Unchanged from Feature 01: `/admin/newsletters` + `/admin/newsletters/[id]`. |
| Channel index | Names as full-row links — **not** a second issue-card inbox, **not** `ResponsiveList`. |
| Index sort | A–Z by `name` (`localeCompare`), then `$id`. Page-level only; do not change `listNewsletters` (Admin stays `updatedAt`). |
| Channel page | Same Home cards via `HomeIssueCard`. `listIssues(client, { newsletterId })`. |
| Page size | **20**, `?page=`, same clamp/redirect as Home. |
| Empty copy | Index: **No newsletters yet.** Channel: **No issues yet.** No Generate / Admin CTA. |
| Missing channel | Unsafe id or `getNewsletter` `not_found` → `notFound()`. |
| Sticky title | Still **Newsletters** (`pageTitleForPath` prefix `/newsletters`). Page `h1` on a channel is the newsletter **name**. |
| Nav | Existing `isNavItemActive`: `/newsletters/nl-1` activates Newsletters; `/admin/newsletters/nl-1` does not. |

### Channel index (`web/app/(protected)/newsletters/page.tsx`)

Replace the Feature 01 stub. **`ChannelList` is the only heading, empty copy, and error Alert.** The page loads and paginates; it does not render a second `<h1>Newsletters</h1>` or a second Alert.

1. `listNewsletters(getServerAppwrite())`.
2. Sort A–Z as pinned, then paginate in memory, `PAGE_SIZE = 20`. `parsePageParam` + clamp-`redirect` via `buildReaderNewslettersHref` (do **not** use `buildNewslettersHref` — that is Admin).
3. Pass the page slice and `loadError` into `ChannelList`. Always render `DomainListPagination` below it (`noun="newsletters"`, `ariaLabel="Newsletters pagination"`, `buildPageHref` → `buildReaderNewslettersHref`).

Load error: `NewsletterRepositoryError.message` else `Something went wrong while loading newsletters. Please try again.`

`ChannelList` (`web/components/newsletters/channel-list.tsx`):

- Heading **Newsletters**.
- `loadError` set → destructive Alert with that message; no empty copy; no links.
- Else `newsletters.length === 0` → dashed empty section, copy **No newsletters yet.**
- Else `ul` / `li` with `aria-label="Newsletters"`. Each item is one Next.js `Link` to `/newsletters/${newsletter.$id}` whose visible text is `newsletter.name`. Whole row is the hit target (`className` block + hover + `focus-visible` ring). No nested buttons.
- No Create, Edit, Generate, Delete, topics, feed counts, schedules, or `NewslettersView` / `NewslettersTable` / `GenerateNewsletterButton`.

### Channel page (`web/app/(protected)/newsletters/[id]/page.tsx`)

New reader route. Factory edit remains only at `web/app/(protected)/admin/newsletters/[id]/page.tsx`.

1. `id` from `params`. If `!isSafeNewsletterId(id)` → `notFound()` (do not call Appwrite).
2. `getNewsletter(client, id)`. `NewsletterRepositoryError` with `code === "not_found"` → `notFound()`. Other errors throw (same as Admin edit).
3. `listIssues(client, { newsletterId: id })` in try/catch. On failure: `RunRepositoryError.message` else `Something went wrong while loading issues. Please try again.`
4. Paginate `PAGE_SIZE = 20`, clamp-`redirect` via `buildChannelHref`. `resolveIssueCardMetaForRuns` on the page slice only.
5. Render a **Back to Newsletters** `Link` (`href="/newsletters"`) then a **single** `<HomeInbox heading={newsletter.name} … />` then `DomainListPagination` (`ariaLabel="Issues pagination"`, `noun="issues"`, `buildPageHref` → `buildChannelHref(id, { page })`).

Do not call `listNewsletters`. Do not render `NewsletterEditForm`.

### `HomeInbox` heading

Feature 02’s `HomeInbox` heading is Home. Add optional `heading?: string` defaulting to `"Home"`. Home page omits the prop. Channel page passes the newsletter name. Do not add Home-only coupling to `HomeIssueCard`. Empty/error behavior unchanged (**No issues yet.** / passed `loadError`).

### URL helpers (`web/lib/channel-url.ts`)

```ts
buildReaderNewslettersHref({ page?: number }): string
// page omitted or 1 → "/newsletters"; page > 1 → "/newsletters?page=N"

buildChannelHref(id: string, { page?: number }): string
// page omitted or 1 → `/newsletters/${id}`; page > 1 → `/newsletters/${id}?page=N`
```

No other query params. Do not change `buildNewslettersHref` (Admin).

### `pageTitleForPath`

No map change required: prefix `/newsletters` already titles list and channel **Newsletters**. Add an explicit test: `/newsletters/nl-1` → Newsletters (and still `/admin/newsletters/nl-1` → Newsletters).

## Dependencies

- Builds on: Feature 01 (`/newsletters` stub; config at `/admin/newsletters` + `[id]`; `isNavItemActive` nested rule; `pageTitleForPath`). Feature 02 (`HomeInbox`, `HomeIssueCard`, `resolveIssueCardMetaForRuns`, dek/cards contract).
- Reuses: `listNewsletters`, `getNewsletter`, `listIssues({ newsletterId })`, `isSafeNewsletterId`, `DomainListPagination`, `parsePageParam` pattern.
- Unlocks: Feature 04 (ops bar off when the issue was opened from Home or a channel).

**Execute Features 01 and 02 before this feature.** This spec assumes those URL maps, the stub, and Home cards exist.

## Constraints

- Do not move or restyle `/admin/newsletters` or `/admin/newsletters/[id]`.
- Do not put Create / Edit / Generate / Delete on reader `/newsletters` or `/newsletters/[id]`.
- Do not add a slug, a new Appwrite attribute, or an LLM call.
- Do not filter Home by newsletter (Feature 02).
- Do not change issue-reader ops chrome or listen (Features 04–05).
- Do not use `ResponsiveList` / `NewslettersView` / `NewslettersTable` on reader Newsletters.
- Do not reuse `buildNewslettersHref` for reader pagination.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] `/newsletters` lists newsletter names as links to `/newsletters/{id}` (not config actions).
- [ ] `/newsletters/{id}` shows that newsletter’s recent issues as Home-style cards (title, newsletter, date, dek) linking to `/issues/{runId}`.
- [ ] `/admin/newsletters/{id}` is still the config/edit form (Create/Edit/Generate stay in Admin).
- [ ] Empty index shows **No newsletters yet.** Empty channel shows **No issues yet.**
- [ ] Unknown or unsafe channel id renders Next.js `notFound()`.
- [ ] Reader Newsletters nav is active on `/newsletters/{id}` and not on `/admin/newsletters/{id}`.
- [ ] Channel cards are cards at desktop width (no domain-list table).

## Files

- Create: `web/lib/channel-url.ts`
- Create: `web/components/newsletters/channel-list.tsx`
- Create: `web/app/(protected)/newsletters/[id]/page.tsx` (reader channel — factory edit stays under `admin/`)
- Create: `web/src/__tests__/channel-url.test.ts`
- Create: `web/src/__tests__/channel-list.test.tsx`
- Create: `web/src/__tests__/channel-page.test.tsx`
- Modify: `web/app/(protected)/newsletters/page.tsx` — replace stub with channel index
- Modify: `web/components/home/home-inbox.tsx` — optional `heading` (default `"Home"`)
- Modify: `web/src/__tests__/home-inbox.test.tsx` — heading default + override
- Modify: `web/src/__tests__/reader-admin-shell.test.tsx` — rewrite stub case 9; `existsSync` reader `[id]` true
- Modify: `web/src/__tests__/page-title.test.ts` — `/newsletters/nl-1` → Newsletters
- Modify: `web/src/__tests__/nav-active.test.ts` — `/newsletters/nl-1` activates `/newsletters`; `/admin/newsletters/nl-1` does not
- Test: no new Appwrite schema files

## Testing approach

Test-first. Component-test the channel list (links, no factory actions, empty/error). Unit-test URL helpers. Source-read App Router pages (`readFile`, do not `import` — Stage 12 pin). `existsSync` for the reader vs Admin `[id]` split. Do not screenshot. Do not require a running Appwrite.

`HomeInbox` on the channel page is covered by heading-prop tests plus page source-read (same pattern as Feature 02 Home).

### Test cases

**`channel-url.test.ts`**

1. `buildReaderNewslettersHref({})` and `{ page: 1 }` → `/newsletters`; `{ page: 2 }` → `/newsletters?page=2`.
2. `buildChannelHref("nl-1", {})` and `{ page: 1 }` → `/newsletters/nl-1`; `{ page: 2 }` → `/newsletters/nl-1?page=2`.

**`nav-active.test.ts` / `page-title.test.ts`**

3. `isNavItemActive("/newsletters/nl-1", "/newsletters")` true; `isNavItemActive("/admin/newsletters/nl-1", "/newsletters")` false.
4. `pageTitleForPath("/newsletters/nl-1")` is `Newsletters`; `pageTitleForPath("/admin/newsletters/nl-1")` is `Newsletters`.

**`channel-list.test.tsx`**

5. Heading Newsletters; each fixture name is a `Link` with `href="/newsletters/{id}"`.
6. No “Create”, “Edit”, “Generate”, “Delete” text. Source of `channel-list.tsx` does not import `NewslettersView`, `NewslettersTable`, `GenerateNewsletterButton`, or `ResponsiveList`.
7. Empty: **No newsletters yet.** No links.
8. Load error: alert with the passed message; no empty copy; heading Newsletters still present.
9. Feature 01 stub behavior (names as non-links) is gone: names are links.

**`home-inbox.test.tsx`**

10. Default heading remains **Home**. `heading="Tech Digest"` renders that `h1` (not Home).

**`channel-page.test.tsx` (source-read + `existsSync`; do not import the page)**

11. `web/app/(protected)/newsletters/[id]/page.tsx` exists. Source contains `isSafeNewsletterId`, `notFound`, `getNewsletter`, `listIssues`, `newsletterId`, `resolveIssueCardMetaForRuns`, `HomeInbox`, `heading=`, `PAGE_SIZE = 20`, `parsePageParam`, `redirect`, `DomainListPagination`, `buildChannelHref`, `Back to Newsletters`. Does **not** contain `NewsletterEditForm`, `GenerateNewsletterButton`, or `listNewsletters`.
12. `web/app/(protected)/admin/newsletters/[id]/page.tsx` still exists and still contains `NewsletterEditForm`.
13. `web/app/(protected)/newsletters/page.tsx` source contains `ChannelList`, `listNewsletters`, `buildReaderNewslettersHref`, `PAGE_SIZE = 20`, `localeCompare`, `parsePageParam`, `redirect`, `DomainListPagination`. Does **not** contain `NewslettersView` or `GenerateNewsletterButton`. Stub-only names-as-text (no `Link`) is gone.

**`reader-admin-shell.test.tsx`**

14. Rewrite Feature 01 case 9 so it no longer requires names-as-text. Case 6: reader `newsletters/[id]/page.tsx` is **true**; admin counterpart remains **true**.

## Tasks

### Task 1: Failing URL, nav, and list tests

- **Action**: Add `web/src/__tests__/channel-url.test.ts` (cases 1–2). Extend `nav-active.test.ts` and `page-title.test.ts` (cases 3–4). Add `web/src/__tests__/channel-list.test.tsx` (cases 5–9). Add heading case 10 in `home-inbox.test.tsx`. Rewrite Feature 01 stub case 9 in `reader-admin-shell.test.tsx` so names-as-text is no longer required (case 14 partial). Do not implement helpers or `ChannelList` yet.
- **Expected result**: New tests fail on missing `buildReaderNewslettersHref` / `buildChannelHref` / `ChannelList` / heading prop. Failures are assertion or import errors, not harness crashes.
- **Verify**: `pnpm exec vitest run web/src/__tests__/channel-url.test.ts web/src/__tests__/channel-list.test.tsx web/src/__tests__/nav-active.test.ts web/src/__tests__/page-title.test.ts web/src/__tests__/home-inbox.test.tsx web/src/__tests__/reader-admin-shell.test.tsx` fails on the new cases.
- **Depends on**: none.

### Task 2: URL helpers + channel index

- **Action**: Add `web/lib/channel-url.ts` and `web/components/newsletters/channel-list.tsx`. Replace `web/app/(protected)/newsletters/page.tsx` with list + sort + paginate + `ChannelList` + `DomainListPagination` per Spec (no extra heading/Alert in the page; no `NewslettersView`). Add optional `heading` to `HomeInbox` (default `"Home"`).
- **Expected result**: `/newsletters` is the linked channel list. Cases 1–10 pass. Feature 01 names-as-text stub is gone.
- **Verify**: `pnpm exec vitest run web/src/__tests__/channel-url.test.ts web/src/__tests__/channel-list.test.tsx web/src/__tests__/nav-active.test.ts web/src/__tests__/page-title.test.ts web/src/__tests__/home-inbox.test.tsx` passes. `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: Failing channel-page tests

- **Action**: Add `web/src/__tests__/channel-page.test.tsx` (cases 11–13). Finish case 14 in `reader-admin-shell.test.tsx` (`existsSync` reader `[id]` true). Do not add the channel `page.tsx` yet.
- **Expected result**: Tests fail because reader `newsletters/[id]/page.tsx` is missing (Feature 01 left `[id]` under Admin only).
- **Verify**: `pnpm exec vitest run web/src/__tests__/channel-page.test.tsx web/src/__tests__/reader-admin-shell.test.tsx` fails on missing reader `[id]` / source-read.
- **Depends on**: Task 2.

### Task 4: Channel page

- **Action**: Add `web/app/(protected)/newsletters/[id]/page.tsx` per Spec (safe-id `notFound`, `getNewsletter`, filtered `listIssues`, card meta, Back link, `HomeInbox heading={newsletter.name}`, pagination). Do not touch `admin/newsletters/[id]/page.tsx` except if a test import path is wrong — the edit form stays there.
- **Expected result**: Channel URL renders issue cards for that newsletter. Cases 11–14 pass. Admin edit still has `NewsletterEditForm`.
- **Verify**: `pnpm exec vitest run web/src/__tests__/channel-page.test.tsx web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/home-inbox.test.tsx web/src/__tests__/newsletter-edit-structure.test.tsx` passes. `pnpm typecheck` passes.
- **Depends on**: Task 3.

### Task 5: Gates

- **Action**: Full suite + typecheck + lint. Fix any Feature 01 stub assertions that still require names-as-text or “reader `[id]` absent.”
- **Expected result**: Gates green. Admin newsletter list/edit unchanged.
- **Verify**: `pnpm test`, `pnpm typecheck`, `pnpm lint` (ignore benign `pages/` eslint-config-next warning).
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm test`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Full vitest suite green. `/newsletters` is linked channel names; `/newsletters/{id}` is Home-style issue cards for that newsletter; `/admin/newsletters/{id}` is still edit; unsafe/missing id → `notFound`; no factory actions on reader Newsletters; typecheck clean; lint clean (ignore known `pages/` warning).

## Handoff

Builder reports: files created/modified; confirmation Admin edit path was not replaced; confirmation reader `[id]` does not import `NewsletterEditForm`; confirmation no LLM / no schema change; `pnpm test` + typecheck + lint results; any deviation and why.

## Research note

- **Codebase (codegraph `listIssues` / `getNewsletter` / current `newsletters/page.tsx`):** `listIssues` already accepts `newsletterId`. `getNewsletter` throws `NewsletterRepositoryError("not_found")`. Feature 01/02 are not executed yet in this working tree; this spec assumes they have landed (stub at `/newsletters`, edit at `/admin/newsletters/[id]`, `HomeInbox` + `HomeIssueCard`). `isNavItemActive` already treats `/newsletters/nl-1` as nested under `/newsletters` and will not activate that item for `/admin/newsletters/nl-1`.
- **Feature 01:** stub names are not links; `[id]` stays under Admin until this feature. Feature 01 grep that forbids `` `/newsletters/${ `` in `web/components` applied to factory hrefs — reader `channel-list.tsx` is allowed to link `/newsletters/${id}`.
- **Feature 02:** “Feature 03 may reuse `HomeIssueCard`”; Home has no newsletter filter. Channel page is that filter.
- **`isSafeNewsletterId`:** existing `/^[a-zA-Z0-9_-]+$/` helper (`web/lib/newsletter-id.ts`); call it before `getNewsletter`.
- **Open question closed (auto, 2026-08-14):** channel index is names-as-links (not a card inbox); “recent” = same 20-issue page as Home, not a separate last-N.
- **Grizzled Senior (2026-08-14):** cases 11 and 13 source-read the load path (`PAGE_SIZE`, `parsePageParam`, `redirect`, `DomainListPagination`, channel `heading=`, index `localeCompare`) so pagination/sort/heading cannot be skipped.
