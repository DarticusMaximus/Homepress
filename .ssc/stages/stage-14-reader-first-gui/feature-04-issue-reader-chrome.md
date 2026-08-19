# Feature 04: Issue reader chrome

## Intent

Let the operator read an issue as a digest, not a CMS preview: factory actions stay off the Home/channel path and on the Admin path, with a wider body column than Stage 13’s narrow measure.

## Spec

One issue reader, not a rebuild. Same `IssueReader` + markdown + listen. Chrome is **path-conditional**: `/issues/[runId]` is reader (ops off); `/admin/issues/[runId]` is factory (ops on). No query flag, no referrer sniff, no redirect between the two. Column widens from Stage 10/13 `max-w-prose` (65ch) to **`max-w-3xl`** (same token Inspect already uses). Listen controls stay Stage 13 until Feature 05; only the listen bar’s inner max-width matches the column.

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| Ops-on URL | `/admin/issues/[runId]` — Feature 01 deferred this. Stage 16 can hide `/admin/*`. |
| Ops-off URL | `/issues/[runId]` unchanged (Home/channel cards already point here). |
| Signal | Path only. Not `?ops=`, not `document.referrer`. |
| Redirects | None between the two URLs. |
| Column | Shared `ISSUE_READER_COLUMN_CLASS = "mx-auto w-full max-w-3xl"`. `max-w-prose` gone from reader + listen inner wrap. |
| `showOps` | Default **`false`**. Factory page passes `true`. |
| Ops bar | Inspect pipeline, Markdown, HTML, Send, Publish, Email/RSS badges — success path only, and only when `showOps`. |
| Back | Reader: **Back to Home** → `/`. Factory: **Back to Issues** → `/admin/issues`. |
| Factory Open | Admin Issues + Delivery (table + cards) → `buildAdminIssueHref`. Home/channel stay reader hrefs. |
| Runs | Unchanged (Inspect only). Do not add a View-issue button on Runs/Inspect. |
| Listen | Still mounts on success on **both** paths. Do not compact controls (Feature 05). |

### `IssueReader` contract

```ts
type IssueReaderProps = {
  run: IssueRunChrome;
  runId: string;
  markdown?: string;
  loadError?: boolean;
  showOps?: boolean; // default false
};
```

`IssueReaderNotAvailable` and `IssueReaderLoadErrorBare` take the same optional `showOps` (default false) so back-link mode matches the route.

When `showOps` is false: no Inspect, no `IssueDownloadLinks`, no Send, no Publish, no Email/RSS labels or `DeliveryStatusBadge`. Title, newsletter · date, body, and listen remain.

When `showOps` is true: today’s success-path ops bar (Inspect href still `inspectRunHref`). Load-error / not-available still omit Send / Publish / downloads / Inspect (same as today) — only the back link switches.

### Dual route (same loader)

Extract the current `issues/[runId]/page.tsx` load + branch into `web/components/issues/issue-detail-view.tsx` (server component). Both routes await `params.runId` and render `<IssueDetailView runId={runId} showOps={…} />`.

| File | `showOps` |
|---|---|
| `web/app/(protected)/issues/[runId]/page.tsx` | `false` |
| `web/app/(protected)/admin/issues/[runId]/page.tsx` | `true` |

Do not duplicate `loadIssueDraft` / eligibility branching. Do not add `searchParams`. Keep `web/app/(protected)/issues/actions.ts` where Feature 01 left it (Send/Publish still import that path).

### URL helpers

Add to `web/components/issues/issue-url.ts` (new; do not overload `buildIssuesHref`, which is the Admin **list**):

```ts
buildIssueHref(runId: string): string        // `/issues/${runId}`
buildAdminIssueHref(runId: string): string   // `/admin/issues/${runId}`
```

Factory Open sites must call `buildAdminIssueHref`: `issues-table.tsx`, `issue-list-card.tsx`, `delivery-table.tsx`, `delivery-list-card.tsx`. Do not change `HomeIssueCard` / channel cards.

### Column + listen inner wrap

Export `ISSUE_READER_COLUMN_CLASS` from `web/lib/issue-reader-layout.ts`. `IssueReader` / not-available / load-error-bare use it as the outer column. `IssueListenBar` inner container keeps `mx-auto flex min-h-28 w-full … px-4 py-2` and uses `max-w-3xl` (same token; import the constant or the `max-w-3xl` class — do not leave `max-w-prose` beside a 3xl body).

## Dependencies

- Builds on: Feature 01 (`/issues/[runId]` stays; factory list at `/admin/issues`; Back to Home; `inspectRunHref` under `/admin/runs/…`; no `/admin/issues/[runId]` until this feature). Feature 02/03 (Home/channel cards → `/issues/${id}`).
- Reuses: `IssueReader`, `loadIssueDraft`, `IssueDownloadLinks`, Send/Publish, listen bar.
- Unlocks: Feature 05 (compact listen on this chrome). Stage 16 (hide `/admin/*`).

**Execute Features 01–03 before this feature.**

## Constraints

- Do not rebuild the markdown renderer or invent a second issue page component.
- Do not use a query flag or referrer to choose chrome.
- Do not add redirects between reader and factory issue URLs.
- Do not compact or restyle listen controls (Play/Pause/Stop/rates stay Stage 13).
- Do not add View-issue on Runs or Inspect.
- Do not change Home/channel card hrefs.
- Do not persist new Appwrite fields or call an LLM.
- Do not restyle Admin Issues as a blog inbox (still ResponsiveList).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] Opening an issue from Home or a newsletter channel (`/issues/{runId}`) does not show Inspect pipeline, Markdown, HTML, Send, Publish, or email/RSS status.
- [ ] Opening an issue from Admin Issues or Delivery (`/admin/issues/{runId}`) does show those factory actions on the success path.
- [ ] `/issues/[runId]/page.tsx` still exists; `/admin/issues/[runId]/page.tsx` exists; both render the same `IssueDetailView`.
- [ ] On tablet/desktop, the issue body column uses `max-w-3xl` (not `max-w-prose`).
- [ ] Reader back is **Back to Home** (`/`). Factory back is **Back to Issues** (`/admin/issues`).
- [ ] Listen still appears on the success path when ops are off.
- [ ] Existing factory list bookmarks to `/admin/issues` still list issues; Open goes to the factory issue URL.

## Files

- Create: `web/lib/issue-reader-layout.ts`
- Create: `web/components/issues/issue-url.ts`
- Create: `web/components/issues/issue-detail-view.tsx`
- Create: `web/app/(protected)/admin/issues/[runId]/page.tsx`
- Create: `web/src/__tests__/issue-url.test.ts`
- Create: `web/src/__tests__/issue-reader-chrome.test.tsx`
- Modify: `web/components/issues/issue-reader.tsx` — `showOps`, column class
- Modify: `web/components/issues/issue-listen-bar.tsx` — inner max-width
- Modify: `web/app/(protected)/issues/[runId]/page.tsx` — thin wrapper, `showOps={false}`
- Modify: `web/components/issues/issues-table.tsx`, `issue-list-card.tsx`, `web/components/delivery/delivery-table.tsx`, `delivery-list-card.tsx` — `buildAdminIssueHref`
- Modify: tests listed under Testing approach (ops default, back labels, column, factory hrefs)
- Test: no new Appwrite schema files

## Testing approach

Test-first. Component-test `showOps` (Intent: reader vs factory chrome). Unit-test href helpers. Source-read App Router pages (`readFile`, do not `import` — Stage 12 pin). `existsSync` for the new admin detail route. Do not screenshot. Do not require a running Appwrite.

Existing tests that render `<IssueReader>` and assert Inspect / Send / Publish / Markdown / HTML / Email must pass `showOps`. Default-false tests live in `issue-reader-chrome.test.tsx` (and updated `issue-reader.test.tsx` back-link copy after Feature 01: **Back to Home**).

### Test cases

**`issue-url.test.ts`**

1. `buildIssueHref("run-1")` → `/issues/run-1`.
2. `buildAdminIssueHref("run-1")` → `/admin/issues/run-1`.

**`issue-reader-chrome.test.tsx` + `issue-reader.test.tsx`**

3. Default / `showOps={false}` success: heading + newsletter · date + body; **no** Inspect pipeline, Download Markdown, Download HTML, Send, Publish, or text “Email” / “RSS”. Back **Back to Home** href `/`. Column class matches `/max-w-3xl/` and does **not** match `/max-w-prose/`.
4. `showOps` success: Inspect pipeline (`inspectRunHref`), Download Markdown, Download HTML, Send, Publish, Email + RSS badges present. Back **Back to Issues** href `/admin/issues`.
5. `showOps` load-error: no Send / Publish / downloads / Inspect; Back to Issues.
6. `IssueReaderNotAvailable` default: no ops links; Back to Home. With `showOps`: Back to Issues; still no ops.
7. Listen: success + `showOps={false}` still has the Listen region (Play). Load-error / not-available still omit listen (existing Stage 13 rule).

**Pages (source-read + `existsSync` in `issue-reader-chrome.test.tsx`)**

8. `web/app/(protected)/issues/[runId]/page.tsx` exists; source contains `IssueDetailView` and `showOps={false}` (or `showOps={ false }`); does not contain `showOps={true}` or boolean-true shorthand `showOps` (a bare `showOps` with no `={false}`).
9. `web/app/(protected)/admin/issues/[runId]/page.tsx` exists; source contains `IssueDetailView` and `showOps={true}` (allow `showOps={ true }` or boolean shorthand `showOps`); does **not** contain `showOps={false}`.
10. `issue-detail-view.tsx` source contains `loadIssueDraft`, `IssueReader`, `showOps` passed through to `IssueReader` / not-available / load-error-bare. Does not contain `searchParams`.

**Factory Open hrefs**

11. Admin Issues table/card Open (or title link) href is `/admin/issues/{id}` (`issues-responsive-list.test.tsx` / `issues-delivery-badges.test.tsx`).
12. Delivery Open href is `/admin/issues/{id}` (`delivery-page.test.tsx`).

**Listen inner wrap**

13. Source-read `issue-listen-bar.tsx`: inner wrap has `max-w-3xl`; `max-w-prose` absent.

**Call-site updates (existing files)**

14. `issue-reader.test.tsx`, `inspect-entry.test.tsx`, `send-issue-button.test.tsx`, `publish-issue-button.test.tsx`, `issue-download-links.test.tsx`, `issues-delivery-badges.test.tsx`, `shell-polish.test.tsx`: IssueReader cases that assert factory chrome (Inspect / Send / Publish / Download Markdown / Download HTML / Email / RSS) pass `showOps`. Default (no `showOps`) success render must **not** assert those ops links. Hit-target tests: reader back **Back to Home**; factory back **Back to Issues** when `showOps`.

## Tasks

### Task 1: Failing chrome + URL tests

- **Action**: Add `web/src/__tests__/issue-url.test.ts` (cases 1–2) and `web/src/__tests__/issue-reader-chrome.test.tsx` (cases 3–7; skip 8–10 until Task 3). Update `issue-reader.test.tsx`: column `max-w-3xl` / forbid `max-w-prose`; default back **Back to Home** `/` (Feature 01); move Download Markdown/HTML assertions off the default success render (pass `showOps`, or drop them in favor of cases 3–4). Do not implement `showOps` or helpers yet.
- **Expected result**: New tests fail on missing `buildAdminIssueHref` / `showOps` / still-`max-w-prose`. Failures are assertion or import errors, not harness crashes.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-url.test.ts web/src/__tests__/issue-reader-chrome.test.tsx web/src/__tests__/issue-reader.test.tsx` fails on the new cases.
- **Depends on**: none.

### Task 2: `showOps` + column

- **Action**: Add `web/lib/issue-reader-layout.ts`. Implement `showOps` (default false) and `ISSUE_READER_COLUMN_CLASS` on `IssueReader` / not-available / load-error-bare. Update call-site tests (case 14, including `issue-reader.test.tsx`) so factory-chrome assertions pass `showOps` and the default success render does not still expect downloads. Do not add the admin route yet. Do not change listen controls; column on the reader wrapper is enough for cases 3–6.
- **Expected result**: Cases 3–7 and updated `issue-reader.test.tsx` pass. Listen still mounts on reader success (case 7).
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-reader-chrome.test.tsx web/src/__tests__/issue-reader.test.tsx web/src/__tests__/inspect-entry.test.tsx web/src/__tests__/send-issue-button.test.tsx web/src/__tests__/publish-issue-button.test.tsx web/src/__tests__/issue-download-links.test.tsx web/src/__tests__/issues-delivery-badges.test.tsx web/src/__tests__/shell-polish.test.tsx web/src/__tests__/issue-listen-bar.test.tsx` passes. `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: Failing dual-route + factory href tests

- **Action**: Add cases 8–12 (page source-read / `existsSync` / factory Open hrefs). Point `issues-responsive-list` and `delivery-page` expectations at `/admin/issues/{id}`. Do not add `admin/issues/[runId]/page.tsx` yet.
- **Expected result**: Tests fail because the admin detail route is missing and factory Open still points at `/issues/{id}`.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-reader-chrome.test.tsx web/src/__tests__/issues-responsive-list.test.tsx web/src/__tests__/delivery-page.test.tsx` fails on missing admin `[runId]` / href mismatch.
- **Depends on**: Task 2.

### Task 4: Dual route, href sweep, listen inner width

- **Action**: Add `issue-url.ts`, `issue-detail-view.tsx`, thin reader `page.tsx`, `admin/issues/[runId]/page.tsx`. Sweep factory Open to `buildAdminIssueHref`. Align listen inner max-width (case 13). Do not add searchParams or redirects.
- **Expected result**: Cases 1–2 and 8–13 pass. Home/channel tests still use `/issues/{id}`.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-url.test.ts web/src/__tests__/issue-reader-chrome.test.tsx web/src/__tests__/issues-responsive-list.test.tsx web/src/__tests__/delivery-page.test.tsx web/src/__tests__/home-inbox.test.tsx web/src/__tests__/channel-page.test.tsx web/src/__tests__/issue-listen-bar.test.tsx` passes. `pnpm typecheck` passes.
- **Depends on**: Task 3.

### Task 5: Gates

- **Action**: Full suite + typecheck + lint. Fix any leftover Back to Issues on the reader default, `max-w-prose` on the issue column, or factory Open still `/issues/{id}`.
- **Expected result**: Gates green. Listen behavior unchanged aside from inner max-width.
- **Verify**: `pnpm test`, `pnpm typecheck`, `pnpm lint` (ignore benign `pages/` eslint-config-next warning).
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm test`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Full vitest suite green. `/issues/{id}` has no ops bar; `/admin/issues/{id}` has ops on success; column is `max-w-3xl`; listen still on reader success; Home/channel still link the reader URL; Admin Issues/Delivery Open the factory URL; typecheck clean; lint clean (ignore known `pages/` warning).

## Handoff

Builder reports: files created/modified; confirmation both routes share `IssueDetailView`; confirmation no query/referrer/redirect; confirmation listen controls were not compacted; confirmation Home/channel hrefs unchanged; `pnpm test` + typecheck + lint results; any deviation and why.

## Research note

- **Codebase (codegraph `IssueReader` / `IssueDetailPage` / Inspect `shellColumnClassName`):** ops live in `IssueChrome`; column is `max-w-prose` with a Stage 10 “do not widen” comment. Inspect is already `max-w-3xl`. Factory Open hrefs are hardcoded `/issues/${id}` in Issues + Delivery tables/cards. Runs/Inspect have no Open-issue link (Inspect only). Listen inner wrap is also `max-w-prose`.
- **Feature 01:** `/issues/[runId]` stays; “Do not add `/admin/issues/[runId]` (Feature 04).” Grill map: Feature 04 adds the Admin ops path. Alpha: no compatibility redirects.
- **Plan.md:** “Issue ops chrome is path-conditional, not a second page and not roles.” Darticus originally floated a query switch (OpenViking `homepress_stage_14_defined`, 2026-08-14); auto-picked the Admin URL because Stage 16 hides `/admin/*` and a `?ops=` bookmark leaks factory chrome onto the daily reader URL.
- **Next.js App Router (Context7 `/vercel/next.js` `page.mdx`):** two `page.tsx` files importing one shared component is the nested-route pattern; no need for `searchParams`.
- **Open questions closed (auto, 2026-08-14):** column = `max-w-3xl` (match Inspect, noticeable vs 65ch); ops-on = Admin-prefixed URL, not query flag.
- **Grizzled Senior (2026-08-14):** case 9 must require `showOps={true}` (or shorthand `showOps`) and forbid `showOps={false}` so both wrappers cannot silently pass false; `issue-reader.test.tsx` download assertions belong in case 14 / Task 2, not on the default reader render.
