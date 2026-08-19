# Feature 02: Home card inbox

## Intent

Make Home the daily catch-up surface: a blog-index of issue cards (title, newsletter, date, short dek) so the operator picks a digest to read instead of landing on a factory list or a full issue.

## Spec

Replace Feature 01’s Home stub at `/` with a card inbox of eligible issues. Same completed-draft source of truth as the Issues list (`listIssues`). Dek is extracted from the draft already downloaded for titles — no extra LLM, no new Appwrite attribute (Stage 15). Cards at **all** widths; not the Admin domain-list table/card split. Tap a card → `/issues/[runId]`. Feature 04 still owns reader ops chrome; this feature does not hide or show Inspect/Send/Publish.

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| Dek source | Existing draft markdown (same checkpoint load as titles). |
| Dek shape | Skip headings, take the first prose paragraph, clamp to **160** characters. |
| Cards | Blog-style `Card` stack at every viewport. No `ResponsiveList`. |
| Hit target | The whole card is one `Link` to `/issues/${runId}`. |
| Filter | None on Home. Newsletter-as-channel is Feature 03. |
| Page size | **20**, `?page=`, same clamp/redirect as `/admin/issues`. |
| Empty copy | **No issues yet.** (no Admin/Generate CTA — Stage 16 readers). |
| Admin Issues | Unchanged factory archive (table/cards + delivery badges). |

### Dek algorithm (`extractIssueDek`)

Export from `shared/src/runs/issues.ts` next to `extractFirstMarkdownHeading`. Constant `ISSUE_DEK_MAX_CHARS = 160`.

1. Normalize `\r\n` / `\r` → `\n`. Line-oriented scan; **skip fenced code** with the same fence rules as `extractFirstMarkdownHeading`.
2. Skip blank lines and **heading lines** (ATX `#`–`######`, and setext content+underline pairs). Do not use heading text as the dek (it is already the card title).
3. Collect the first **paragraph**: consecutive non-blank, non-heading, non-fence lines. Stop at a blank line, a heading, or a fence opener.
4. Join those lines with spaces. Strip common list/quote prefixes (`- `, `* `, `> `, ordered `1. `). Strip images `![alt](url)` to `alt` (or drop if alt empty). Then run the same inline cleanup as headings (`cleanInlineHeadingText`: links → label, bold/italic/code unwrap, collapse whitespace).
5. If the result is empty or punctuation-only → **`null`** (omit the dek node; title/newsletter/date still render). Use the existing private `isEmptyOrPunctuationOnly` in `shared/src/runs/issues.ts` (`!/[\p{L}\p{N}]/u.test`). Do not invent a second definition; keep the helper private.
6. If length ≤ 160, return as-is (no ellipsis).
7. If longer, truncate at the last whitespace at or before 160; if none, hard-cut at 160. Append `…` (U+2026).

Examples:

| Markdown | Dek |
|---|---|
| `# Who Vets AI’s Code?\n\nLabs are racing to ship agents.\n\n## Next` | `Labs are racing to ship agents.` |
| `# Title\n\n` + 400-char paragraph | First 160 chars, word-bounded, with `…` |
| `# Title` only | `null` |
| `Just a lede. No heading.` | `Just a lede. No heading.` (title still uses fallback) |
| `\`\`\`\ncode\n\`\`\`\n\n# H\n\nBody.` | `Body.` |

### Card meta load (`resolveIssueCardMetaForRuns`)

Same contract as `resolveIssueDisplayTitlesForRuns`, one draft download per row:

```ts
type IssueCardMeta = { title: string; dek: string | null };

resolveIssueCardMetaForRuns(client, runs: Run[]): Promise<Map<string, IssueCardMeta>>
```

- Caller passes **only the current page** (≤ 20). Helper does not paginate.
- Per-row checkpoint failure: `title` = `formatIssueFallbackTitle`, `dek` = `null`. Never throw for a single bad row. Log like the title helper (`phase: "resolve-issue-card-meta"`).
- Success: `title` via `resolveIssueDisplayTitle`, `dek` via `extractIssueDek` on the same markdown.
- Do **not** change `resolveIssueDisplayTitlesForRuns` (Admin Issues + Delivery stay title-only).
- Export both new symbols from the runs barrel (`shared/src/runs/index.ts` already re-exports `./issues`).

### Home page (`web/app/(protected)/page.tsx`)

Server component. Replace the Feature 01 stub. **`HomeInbox` is the only heading, empty copy, and error Alert.** The page loads data and paginates; it does not render a second `<h1>Home</h1>` or a second Alert beside `HomeInbox`.

Page copies from Issues **only**: try/catch around `listIssues`, `RunRepositoryError.message` else `Something went wrong while loading issues. Please try again.`, `PAGE_SIZE = 20`, in-memory slice, `parsePageParam`, clamp-`redirect` via `buildHomeHref`. Do **not** copy `listNewsletters`, `newsletterId`, or the newsletter-filter-failed Alert.

1. `listIssues(getServerAppwrite())` — no `newsletterId`, no `listNewsletters`.
2. Paginate in memory, `PAGE_SIZE = 20`. `parsePageParam` + clamp-redirect via `buildHomeHref`.
3. `resolveIssueCardMetaForRuns` on the page slice only.
4. Pass `issues`, card meta, and `loadError` (string or `null`) into `HomeInbox`. Always render `DomainListPagination` below it (`buildPageHref` → `buildHomeHref`; the component already no-ops when `totalPages` is 1).

`buildHomeHref({ page?: number })` in `web/lib/home-url.ts`: page 1 → `/`; page > 1 → `/?page=N`. No other query params.

`HomeInbox` (not the page):

- Heading **Home**.
- `loadError` set → destructive Alert with that message; no empty copy; no cards.
- Else `issues.length === 0` → dashed empty section, copy **No issues yet.**
- Else the card list.

### Card UI

New components (not `IssueListCard` / `DomainListCard`):

- `web/components/home/home-issue-card.tsx` — one issue.
- `web/components/home/home-inbox.tsx` — **sole** owner of heading, empty state, error Alert, and card list. Export a presentational `HomeInbox` that tests can render without Appwrite. Props include `issues`, title/dek meta, and `loadError: string | null`.

Each card (shadcn `Card`, already in `web/components/ui/card.tsx` — do not reinstall):

1. **Title** — `meta.title` (display heading or fallback). `CardTitle` / `h2`.
2. **Meta** — `{newsletterName} · {date}` with `formatOperatorDate(endedAt ?? startedAt)` (`dateStyle: "short"` only). `text-muted-foreground`, same date basis as Issues.
3. **Dek** — if `meta.dek` is a non-empty string: muted body, `line-clamp-2` as a CSS safety net. Omit the node when `dek` is `null`.

Wrap the card in a Next.js `Link` to `/issues/${run.$id}` (`className` block + hover + `focus-visible` ring). No nested buttons. No Email/RSS badges, no Open, no Inspect, no “View all” to `/admin/issues`.

List: `ul` / `li` (or equivalent) with `aria-label="Issues"`. Vertical stack, gap between cards, **same markup at all breakpoints** — no `md:` table, no `ResponsiveList`, no `data-slot="domain-list-table"`.

Feature 03 may reuse `HomeIssueCard`; keep props `{ issue, title, dek }` (or `meta`) with no Home-only coupling.

### Pagination

Reuse `DomainListPagination` (`ariaLabel="Issues pagination"`, `noun="issues"`, `buildPageHref={(p) => buildHomeHref({ page: p })}`). Do not point Home pagination at `buildIssuesHref` (`/admin/issues`).

## Dependencies

- Builds on: Feature 01 (`/` is the Home stub; factory Issues live at `/admin/issues`; `/issues/[runId]` unchanged; `pageTitleForPath("/")` is Home).
- Reuses: `listIssues`, `resolveIssueDisplayTitle`, `extractFirstMarkdownHeading` fence rules, Issues page pagination clamp, shadcn `Card`.
- Unlocks: Feature 03 (channel pages reuse cards), daily Goal-1 landing.

**Execute Feature 01 before this feature.** This spec assumes the Feature 01 URL map and Home stub exist.

## Constraints

- Do not persist title/dek on the run (Stage 15).
- Do not call an LLM.
- Do not add a newsletter filter or a top-level Issues nav item.
- Do not restyle `/admin/issues` or other factory lists.
- Do not change issue-reader ops chrome or listen (Features 04–05).
- Do not use `ResponsiveList` / `DomainListCard` on Home.
- Do not double-download drafts (title and dek from one checkpoint load).
- `page.tsx` does not render a second heading or Alert; it does not call `listNewsletters`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] Opening `/` shows issue cards with title, newsletter name, date, and a short dek (when the draft has body after the title heading).
- [ ] Tapping a card navigates to `/issues/{runId}`.
- [ ] Home cards render as cards at desktop width (no Issues-style table).
- [ ] Home has no Email/RSS badges, Open button, Inspect, Send, or Publish.
- [ ] Empty Home shows **No issues yet.** (not the Feature 01 stub “Issues will show up here.”).
- [ ] Dek is at most 160 characters (plus `…` when truncated) and does not repeat the title heading.
- [ ] Admin Issues at `/admin/issues` is unchanged (ResponsiveList + delivery badges).
- [ ] Draft checkpoint is loaded once per visible card for title+dek.

## Files

- Create: `web/lib/home-url.ts`
- Create: `web/components/home/home-issue-card.tsx`
- Create: `web/components/home/home-inbox.tsx`
- Create: `web/src/__tests__/home-inbox.test.tsx`
- Create: `web/src/__tests__/home-url.test.ts`
- Modify: `shared/src/runs/issues.ts` — `ISSUE_DEK_MAX_CHARS`, `extractIssueDek`, `resolveIssueCardMetaForRuns`
- Modify: `shared/src/runs/__tests__/issues.test.ts` — dek + card-meta cases
- Modify: `web/app/(protected)/page.tsx` — replace Home stub with inbox load + `HomeInbox`
- Modify: `web/src/__tests__/reader-admin-shell.test.tsx` — drop Home stub copy assertion (case 20); inbox + `page.tsx` source-read own `/`
- Test: no new Appwrite schema files

## Testing approach

Test-first. Unit-test dek extraction (Intent: first-lines preview, not a second title). Component-test cards, links, empty/error, and “not a domain list.” Pagination hrefs are unit-tested. Do not screenshot. Do not require a running Appwrite.

`resolveIssueCardMetaForRuns` tests mock `loadPhaseCheckpoint` the same way `resolveIssueDisplayTitlesForRuns` already does in `issues.test.ts`.

### Test cases

**`extractIssueDek` (`issues.test.ts`)**

1. Heading then paragraph → paragraph text (example table row 1).
2. Long paragraph → length ≤ 161 (`160` + `…`); ends with `…`; does not split a word when a space exists before 160.
3. Heading-only → `null`.
4. No heading, short paragraph → that paragraph (not `null`).
5. Fenced heading ignored; dek from later body.
6. Inline markdown in the paragraph stripped (`[x](url)` → `x`).
7. Empty / whitespace / punctuation-only paragraph → `null`. Punctuation-only fixture: `# Title\n\n***` (same rule as headings: `isEmptyOrPunctuationOnly`).
8. Setext title then body → body, not the setext line.

**`resolveIssueCardMetaForRuns`**

9. Success row: title from heading, dek from following paragraph, **one** checkpoint load per run.
10. Checkpoint throw: fallback title, `dek: null`, does not reject the Promise.
11. Empty `runs` → empty Map, no loads.

**`home-url.test.ts`**

12. `buildHomeHref({})` and `{ page: 1 }` → `/`; `{ page: 2 }` → `/?page=2`.

**`home-inbox.test.tsx`**

13. Renders heading Home; each fixture shows title, newsletter name, short date, dek; each card’s link `href` is `/issues/{id}`.
14. No `data-slot="domain-list-table"`; source of `home-inbox.tsx` / `home-issue-card.tsx` does not import `ResponsiveList` or `DomainListCard`.
15. No “Email”, “RSS”, “Open”, “Inspect pipeline”, “Send”, “Publish” text on the inbox.
16. Empty: **No issues yet.** No card links.
17. Load error: alert with the passed message; no empty copy; heading Home still present.
18. Feature 01 stub string **Issues will show up here.** is absent from `page.tsx` and `HomeInbox`.

**`page.tsx` source-read (`home-inbox.test.tsx` or `reader-admin-shell.test.tsx` — `readFile`, do not `import` the App Router page; Stage 12 pin)**

19. `web/app/(protected)/page.tsx` source contains `listIssues`, `resolveIssueCardMetaForRuns`, `HomeInbox`, `buildHomeHref`, `DomainListPagination`, `PAGE_SIZE = 20`, `parsePageParam`, and `redirect`. It does **not** contain `listNewsletters`, `newsletterId`, or `ResponsiveList`. Stub sentence absent (covered with case 18).

**`reader-admin-shell.test.tsx`**

20. Remove or rewrite Home stub case 8 so it does not require the stub copy (inbox + page source-read own `/`).

## Tasks

### Task 1: Failing dek + card-meta tests

- **Action**: Add cases 1–11 in `shared/src/runs/__tests__/issues.test.ts`. Export names may be missing — tests fail on import or assertion. Do not implement extractors yet. Mirror existing `loadPhaseCheckpoint` mocks from the title-resolver describe.
- **Expected result**: Tests fail because `extractIssueDek` / `resolveIssueCardMetaForRuns` / `ISSUE_DEK_MAX_CHARS` are not exported.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/issues.test.ts` fails on the new cases (not harness errors).
- **Depends on**: none.

### Task 2: Implement dek extract + card-meta resolver

- **Action**: Implement `ISSUE_DEK_MAX_CHARS`, `extractIssueDek`, and `resolveIssueCardMetaForRuns` in `shared/src/runs/issues.ts` per Spec. Reuse fence-skipping, `cleanInlineHeadingText`, and `isEmptyOrPunctuationOnly` (keep all three private). Do not alter `resolveIssueDisplayTitlesForRuns`.
- **Expected result**: Cases 1–11 pass. Title-only helper tests still pass.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/issues.test.ts` passes. `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: Failing Home UI tests

- **Action**: Add `web/src/__tests__/home-url.test.ts` (case 12) and `web/src/__tests__/home-inbox.test.tsx` (cases 13–18 and page source-read case 19). Update `reader-admin-shell.test.tsx` Home stub case (case 20). Render `HomeInbox` with fixture runs + meta maps; do not `import` the App Router `page.tsx` (Stage 12 pin). Case 19 is `readFile` of `page.tsx`.
- **Expected result**: New tests fail (missing modules / stub still present / page still Feature 01 stub).
- **Verify**: `pnpm exec vitest run web/src/__tests__/home-url.test.ts web/src/__tests__/home-inbox.test.tsx web/src/__tests__/reader-admin-shell.test.tsx` fails on missing `HomeInbox` / stub copy / `buildHomeHref` / page source-read.
- **Depends on**: Task 2.

### Task 4: Home inbox UI + page load

- **Action**: Add `web/lib/home-url.ts`, `web/components/home/home-issue-card.tsx`, `web/components/home/home-inbox.tsx`. Replace `web/app/(protected)/page.tsx` with list + paginate + `resolveIssueCardMetaForRuns` + a **single** `<HomeInbox … />` + `DomainListPagination` per Spec (no extra heading or Alert in the page). Do not call `listNewsletters`. Do not touch `web/app/(protected)/admin/issues/page.tsx`.
- **Expected result**: `/` is the card inbox. Stub copy gone. Cases 12–20 pass. `page.tsx` source-read (case 19) green.
- **Verify**: `pnpm exec vitest run web/src/__tests__/home-url.test.ts web/src/__tests__/home-inbox.test.tsx web/src/__tests__/reader-admin-shell.test.tsx web/src/__tests__/issues-responsive-list.test.tsx` — Home cases green; Admin Issues ResponsiveList test still green. `pnpm typecheck` passes.
- **Depends on**: Task 3.

### Task 5: Gates

- **Action**: Full suite + typecheck + lint. Fix any Feature 01 Home-stub assertions still expecting “Issues will show up here.”
- **Expected result**: Gates green. Admin Issues unchanged.
- **Verify**: `pnpm test`, `pnpm typecheck`, `pnpm lint` (ignore benign `pages/` eslint-config-next warning).
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm test`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Full vitest suite green. `/` renders Home cards (title, newsletter, date, dek) linking to `/issues/{id}`; no domain-list table on Home; dek helper covers skip-heading / clamp / null; one checkpoint load per card; `/admin/issues` still ResponsiveList; stub copy gone; typecheck clean; lint clean (ignore known `pages/` warning).

## Handoff

Builder reports: files created/modified; dek rules (160, skip headings); confirmation Admin Issues was not restyled; confirmation no LLM / no schema change; `pnpm test` + typecheck + lint results; any deviation and why.

## Research note

- **Codebase (codegraph `listIssues` / `resolveIssueDisplayTitlesForRuns` / `IssuesPage`):** eligible issues = completed + draft id; titles already N-download drafts **per page slice (≤ 20)**; `listIssues` itself does not download. Home must enrich the same way, not a second pass.
- **Stage 06 Issues list:** PAGE_SIZE 20, newest `(endedAt ?? startedAt)`, `formatOperatorDate`. Admin archive keeps that; Home reuses eligibility + sort, not the table.
- **Plan / Feature 01:** `/` is Home stub; cards explicitly out of Feature 01; “blog-style cards at all widths — not the domain-list split.”
- **shadcn MCP `card`:** already installed at `web/components/ui/card.tsx`; do not add another copy.
- **Open question closed (auto, 2026-08-14):** character budget 160 after first prose paragraph, not unbounded first paragraph (drafter ledes and truncated drafts would dump a wall onto the card).
- **Grizzled Senior (2026-08-14):** source-read `page.tsx` for the load path; `HomeInbox` sole heading/empty/error owner; `extractIssueDek` reuses private `isEmptyOrPunctuationOnly`.
