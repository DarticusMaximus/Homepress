# Feature 02: Feed library page

## Intent

Give the operator a dedicated Feeds page to create, edit, list, and delete first-class RSS feed entities (name, URL, optional notes) with visible qualification status — so sources can be managed and shared across newsletters without YAML, before any newsletter attaches them.

## Spec

Replace the Stage 02 “coming soon” gap with a real **Feeds** domain surface: a top-level `/feeds` route in the sidebar, a shared feed document repository (server-side Appwrite CRUD via the API key client), and a GUI that lists feeds and supports create / edit / delete. Status is **displayed** here (`untested` | `ok` | `failed` from feature 01’s vocabulary) but **not tested** — the “Test feed” action is feature 03.

### Data access

Collections are server-only (`read: [], write: []`). All document I/O uses `getServerAppwrite()` + `Databases` with the object-parameter SDK style already used by `runHealthCheck` (`node-appwrite@26`: `createDocument({ databaseId, collectionId, documentId, data })`, etc.). Do **not** use the browser Appwrite SDK or the end-user session client for DB writes (Stage 00 review finding M1; login comment in `web/app/login/actions.ts`).

Put reusable CRUD in `shared/src/feeds/` (same pattern as `shared/src/health/`): pure functions that take a `Client`, talk to `DATABASE_ID` + `FEEDS_COLLECTION_ID`, and return typed results **or throw** (see Error contract). The web layer calls those helpers from server components / server actions; it does not reimplement Appwrite calls inline.

### Document shape (write path)

On **create**:

| Field | Value |
|-------|--------|
| `name` | trimmed non-empty string, max 255 |
| `url` | trimmed non-empty absolute `http:` or `https:` URL, max 2048 |
| `notes` | trimmed string, max 2000; empty → store `""` |
| `status` | `"untested"` |
| `lastTestedAt` | omit / null (unset) |
| `lastTestError` | omit / null (unset) |
| `createdAt` | ISO datetime now |
| `updatedAt` | ISO datetime now |

On **update** (name / url / notes only):

- Always bump `updatedAt`.
- If `url` **changes** (after **trim-only** compare — no slash/host canonicalization), reset `status` to `"untested"` and clear `lastTestedAt` / `lastTestError`. Name/notes-only edits leave status and test fields alone.
- Never invent a new status value; never set `ok`/`failed` in this feature.

### Validation & uniqueness

- Reject empty `name` or `url` with a stable, user-facing error string (no Appwrite host/key leakage).
- Reject `url` that is not a parseable absolute URL with protocol `http:` or `https:` (use `URL` constructor after trim; reject other schemes). Persist and compare the **trimmed** string the operator entered — do **not** rewrite via `URL.href` for storage or equality.
- Enforce **URL uniqueness** in the write path (no DB unique index in this feature): before create, `listDocuments` with `Query.equal("url", trimmedUrl)` and `Query.limit(1)`; if any hit → `FeedRepositoryError` with code `duplicate_url` and message `"A feed with this URL already exists"`. On update, same check excluding the current document `$id`.
- Do **not** provision indexes in this feature. Sorting is done in TypeScript after fetch (see List / sort / pagination). Indexes can be added in a later feature if the library grows past in-memory comfort.

### Error contract

One pipeline — do not mix “sometimes throw, sometimes return”:

1. **`shared/src/feeds/repository.ts` (and validation)** throws `FeedRepositoryError` with:
   - `code`: `"validation" | "duplicate_url" | "attached" | "not_found" | "appwrite"`
   - `message`: safe, user-facing string (no secrets, no raw Appwrite host/key dumps)
2. **`web/app/(protected)/feeds/actions.ts`** catches `FeedRepositoryError` (and unexpected errors → generic message), returns `{ ok: true } | { ok: false, error: string }` to the UI, and on success calls `revalidatePath("/feeds")`.

Log Appwrite failures server-side as `{ phase, code, message }` without secrets (mirror health/provisioner).

### Delete-while-attached

Before `deleteDocument` on a feed, query `newsletter_feeds` with `Query.equal("feedId", feedId)` and `Query.limit(1)`. If any attachment exists → throw `FeedRepositoryError` with code `attached` and message `"Detach this feed from all newsletters before deleting"`. Do not cascade-detach. (Resolves Stage 03 open question in favor of “block until detached.” Feature 05 creates attachments; until then the check still belongs in the repository so the contract is real.)

### List / sort / pagination

- `listFeeds` fetches with `Query.limit(100)` (hard cap for V1; operator scale is well under this). **Do not** use `Query.orderDesc` on custom attributes — feature 01 has no indexes, and Appwrite requires an index to order on those fields.
- Sort **in TypeScript** after fetch: by `updatedAt` descending (ISO string compare is fine); tie-break `$id` ascending for stability.
- **UI pagination:** show **20 feeds per page** on the Feeds page (client or server query-param `?page=` — pick one; default page 1). Prev/Next (or page numbers) when total > 20. Empty state only when total is zero, not when a high page is empty (clamp to last page or redirect to page 1).

### GUI

**Nav (Stage 02 pin amendment):** Stage 02 locked six routes and forbade new top-level sections without a re-plan. Stage 03’s plan explicitly requires a dedicated Feeds page. This feature **amends** the nav contract: insert **Feeds** (`/feeds`, Lucide `Rss`) **between Dashboard and Newsletters**. New order: Dashboard `/`, Feeds `/feeds`, Newsletters `/newsletters`, Runs `/runs`, Schedules `/schedules`, Prompts `/prompts`, Delivery `/delivery`. Active state: exact `pathname === href` (same as other items). No nested `/feeds/[id]` routes in this feature.

**Page** `web/app/(protected)/feeds/page.tsx` (server component):

- Heading “Feeds” + one short supporting line (feeds are shared sources you qualify before attaching to newsletters).
- Primary **Add feed** button opening a create Dialog.
- Table (shadcn `Table`) of the **current page** of feeds: columns **Name**, **URL** (truncate safely), **Status** (Badge — see map below), **Notes** (truncate or “—”), **Updated** (locale-friendly short datetime), **Actions** (Edit, Delete).
- **Badge map (existing variants only):** `untested` → `secondary`; `ok` → `default`; `failed` → `destructive`. Do not invent a “success” variant.
- Empty state when zero feeds: short message + Add feed CTA. No fake rows.
- Status is read-only on the form. No “Test feed” control (feature 03).
- Create / edit: shadcn `Dialog` with Name, URL, Notes (`Textarea`). Plain `<form action={...}>` + server actions — **no** `react-hook-form` / `zod` in this feature.
- Delete: confirm Dialog then server action; on `attached` / other errors, `toast.error` with the returned message.
- Success: `toast.success` via `web/lib/toast.ts` + `revalidatePath("/feeds")`.

### Out of scope for this feature

- Feed qualification / “Test feed” (feature 03).
- Newsletter list/form and attach UI (features 04–05).
- Schema/provisioner/index changes (feature 01 owns schema; indexes deferred).
- Browser SDK, YAML import, Appwrite `Query.orderDesc` on feed attributes.

## Dependencies

- Builds on: **feature-01-feeds-and-newsletters-schema** — `FEEDS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, `FeedStatus` / `FEED_STATUSES`, attribute keys, provisioned collections. **Execute feature 01 before this feature**; if schema constants are missing, stop and escalate.
- Builds on: stage-02 GUI shell + shared components (sidebar, Table, Dialog, Badge, Input, Textarea, Button, Label, toast) and auth gate.
- Builds on: stage-00/02 Appwrite server client (`getServerAppwrite`) and document object-param style (`runHealthCheck`).

## Constraints

- **Server-only DB access** via API key client; no browser Appwrite SDK; no session-client document writes.
- **Do not change** `DATABASE_ID`, provisioner create-if-absent semantics, or `health_check`.
- **Do not implement** Test-feed or set status to `ok`/`failed` except the create/reset-to-`untested` rules above.
- **Do not cascade-delete** attachments; block delete when attached.
- **Do not add schema indexes** in this feature; sort in memory after `Query.limit(100)`.
- **Reuse** Stage 02 shadcn primitives and `web/lib/toast.ts` only for toasts.
- **Nav amendment is intentional** and limited to adding Feeds in the specified slot; do not rename or reorder the other six routes.
- **Secrets:** never log API keys, session secrets, or full env dumps.
- **Feature 01 must be present** in code before verification that hits Appwrite; unit tests use mocks and do not require a live project.

## Acceptance criteria

- [ ] Sidebar includes Feeds at `/feeds` between Dashboard and Newsletters; route is behind the existing auth gate.
- [ ] Operator can create a feed (name, URL, optional notes); new document has `status: "untested"` and unset test fields; it appears in the list after save/reload.
- [ ] Operator can edit name, URL, and notes; URL change (trim-only compare) resets status to `untested` and clears test fields; name/notes-only edit preserves status.
- [ ] Duplicate URL on create/update is rejected with a clear message; document is not created/updated.
- [ ] Invalid / empty name or non-http(s) URL is rejected without writing.
- [ ] Operator can delete an unattached feed; it disappears from the list after reload.
- [ ] Delete of a feed that has a `newsletter_feeds` row is blocked with a clear message; feed document remains.
- [ ] List shows status via Badge: `untested` → secondary, `ok` → default, `failed` → destructive (seeded `ok`/`failed` acceptable in PM gate; create path only produces `untested`).
- [ ] List is sorted newest-`updatedAt`-first in application code; UI paginates at 20 per page; fetch cap is 100.
- [ ] No “Test feed” control in this feature’s UI.
- [ ] `pnpm --filter @newsletter/shared test` (feeds module), `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- [ ] **PM manual gate:** create / edit / delete / duplicate-URL / empty-list / pagination (if >20 feeds or with fixtures) confirmed after feature 01 provisioned.

## Files

- Create: `shared/src/feeds/types.ts` (Feed record type + input types + `FeedRepositoryError`)
- Create: `shared/src/feeds/validation.ts` (name/url/notes validators; trim-only)
- Create: `shared/src/feeds/repository.ts` (`listFeeds`, `createFeed`, `updateFeed`, `deleteFeed` taking `Client`; throws `FeedRepositoryError`)
- Create: `shared/src/feeds/index.ts` (barrel)
- Create: `shared/src/feeds/__tests__/validation.test.ts`
- Create: `shared/src/feeds/__tests__/repository.test.ts`
- Create: `shared/src/feeds/__tests__/mock-client.ts` (or reuse/extend health mock patterns — document choice in handoff)
- Modify: `shared/src/index.ts` (export feeds module; do **not** put feeds into `shared/src/client.ts`)
- Create: `web/app/(protected)/feeds/page.tsx`
- Create: `web/app/(protected)/feeds/actions.ts` (server actions: create / update / delete → `{ ok, error? }`)
- Create: `web/components/feeds/feeds-table.tsx` (and/or `feed-form-dialog.tsx`, `delete-feed-dialog.tsx`, small pagination controls — split as needed)
- Create: `web/src/__tests__/feeds-nav.test.ts` (assert sidebar `navItems` order includes Feeds between Dashboard and Newsletters — export `navItems` from `app-sidebar.tsx` or test a shared `nav-items.ts` constant)
- Modify: `web/components/app-sidebar.tsx` (insert Feeds; prefer extracting `navItems` to a testable module if that keeps the client component clean)
- Modify: `product_spec.md` (Feeds library page under Implemented features at handoff)

## Testing approach

**Test-first for the shared repository and validators.** GUI is verified by build/typecheck/lint, a thin nav unit test, plus a PM manual gate.

### `validation.test.ts`

- Accepts valid http(s) URLs and non-empty names within size limits.
- Rejects empty/whitespace name; empty URL; `ftp:` / relative / garbage URLs.
- Trims name/url/notes; enforces max lengths (255 / 2048 / 2000).
- Trim-only: `"  https://example.com/feed  "` validates as that URL trimmed; trailing-slash variants are **different** URLs if the operator typed them differently.

### `repository.test.ts` (mock `Databases`)

- **create:** writes required fields including `notes: ""` when empty, `status: "untested"`, timestamps; uses `FEEDS_COLLECTION_ID` + `DATABASE_ID`; `ID.unique()`.
- **create duplicate URL:** mock list returns a hit → throws `FeedRepositoryError` with `code: "duplicate_url"`; no create call.
- **list:** `Query.limit(100)` used; results sorted in memory by `updatedAt` desc; returns mapped Feed records (include `$id`).
- **update name only:** does not reset status; bumps `updatedAt`.
- **update URL:** trim-only change detection; resets status to `untested`, clears test fields.
- **update duplicate URL:** blocked when another doc owns the trimmed URL.
- **delete unattached:** junction list empty → `deleteDocument` called.
- **delete attached:** junction non-empty → no `deleteDocument`; throws `code: "attached"`.
- **appwrite errors:** wrapped as `code: "appwrite"` with safe message (no secrets).

### Web automated

- `web/src/__tests__/feeds-nav.test.ts`: nav order is Dashboard → Feeds → Newsletters → …
- Build, typecheck, lint, full `pnpm test` green.
- No Playwright in this feature.

### PM manual gate

1. Worker has provisioned schema (feature 01).
2. Open `/feeds` from sidebar.
3. Create a feed → appears as `untested`.
4. Edit notes → status unchanged; edit URL → status `untested`.
5. Attempt duplicate URL → error toast/message.
6. Delete → gone after reload.
7. If more than 20 feeds (or seeded), pagination shows 20 per page and can move pages.
8. (Optional if feature 05 data exists) attached feed delete blocked.

## Tasks

### Task 1: Failing validation + repository tests

- **Action:** Add `shared/src/feeds/__tests__/validation.test.ts` and `repository.test.ts` (plus mock client) covering Testing approach. Do **not** implement production repository yet — tests must fail on missing module/exports.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/feeds` exits non-zero on missing implementation (or failing assertions), not on harness misconfig.
- **Verify:** Run that command; failures cite missing exports / unimplemented behavior.
- **Depends on:** none for writing tests; **feature-01 must be verified before Task 2** (constants must exist).

### Task 2: Implement validation + repository

- **Action:** Implement `shared/src/feeds/{types,validation,repository,index}.ts` including `FeedRepositoryError`. Wire `listFeeds` (limit 100, in-memory sort), `createFeed`, `updateFeed`, `deleteFeed`. Use object-param `Databases` APIs and `Query.equal` / `Query.limit` only (no `orderDesc` on custom attrs). Export from `shared/src/index.ts`.
- **Expected result:** Feeds unit tests green.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/feeds` — all green. `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1; **feature-01 verified**.

### Task 3: Feeds route shell + sidebar nav

- **Action:** Insert Feeds into the sidebar (`Rss` icon, order per Spec). Prefer a small exported `navItems` (or `web/lib/nav-items.ts`) so `web/src/__tests__/feeds-nav.test.ts` can assert order without mounting the full sidebar. Create `web/app/(protected)/feeds/page.tsx` as a shell: heading, supporting line, empty-state copy, and visible **Add feed** control (dialogs may land in Task 4). Minimum: authenticated `/feeds` renders without error and nav link works.
- **Expected result:** `/feeds` resolves behind auth; sidebar shows seven items in the pinned order; nav unit test passes.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. `pnpm test -- web/src/__tests__/feeds-nav.test.ts` passes.
- **Depends on:** none strictly (can parallelize with Task 1–2 after feature 01), but list data wiring waits on Task 2.

### Task 4: Server actions + table / dialogs / pagination

- **Action:** Add `web/app/(protected)/feeds/actions.ts` that calls repository helpers with `getServerAppwrite()`, catches `FeedRepositoryError`, returns `{ ok: true } | { ok: false, error: string }`, `revalidatePath("/feeds")` on success. Build table, create/edit/delete dialogs, toasts, and 20-per-page pagination on the Feeds page using Stage 02 primitives. Wire real list data from `listFeeds`.
- **Expected result:** Create / edit / delete / duplicate-URL / attached-delete-block work end-to-end when Appwrite is provisioned; pagination works when total > 20.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Confirm actions import from `@newsletter/shared` feeds API and do not call `Databases` directly. Confirm no “Test feed” control in the feeds UI.
- **Depends on:** Task 2, Task 3.

### Task 5: Regression + product_spec note

- **Action:** Run full `pnpm test`, fix fallout. Update `product_spec.md` Implemented features with a one-line Feeds library entry. Confirm no Test-feed UI and no schema/provisioner/index edits.
- **Expected result:** Full suite green; product_spec reflects the page.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero. Diff review: no feature-03 test action; no `Query.orderDesc` on feed attributes.
- **Depends on:** Task 4.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/feeds && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: Feeds validation/repository tests pass (create defaults, trim-only URL uniqueness, URL-change status reset, delete-while-attached, in-memory sort, limit 100). Nav test asserts Feeds between Dashboard and Newsletters. Full suite green. Web build emits `/feeds`. No Test-feed action in feeds UI code.

### Stage B — PM manual gate

- With worker provisioned (feature 01), log in → Feeds → create / edit / duplicate-URL reject / delete / pagination as in Testing approach. Confirm status Badge for a new feed is `untested`. Confirm no Test button yet.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `shared/src/feeds/` and `web/app/(protected)/feeds/` + sidebar/nav.
- Confirmation of test/build/typecheck/lint commands and results.
- Exact public exports from the feeds module (`FeedRepositoryError` codes included).
- Confirmation of locked decisions below as implemented (or deviations + why).
- Confirmation that feature 01 constants were used (no hardcoded `"feeds"` collection id strings outside declarations import).
- **Research note:** `node-appwrite@26.2.0` document APIs use object params; `Query.equal` / `Query.limit` used. Custom-attribute `orderDesc` avoided because Appwrite requires indexes for those order queries and feature 01 ships none — sort in TS instead. Error pattern: repository throws, server actions return `{ ok, error }` (login/health are different shapes for different jobs; this is the preferred domain CRUD pattern going forward). Forms: FormData + server actions; no RHF/zod yet.

## Locked decisions (PM confirmed 2026-07-09)

1. **Nav:** Feeds between Dashboard and Newsletters.
2. **Delete-while-attached:** Block until detached; no cascade.
3. **URL uniqueness:** Write-path `Query.equal`; no schema unique index in this feature.
4. **URL compare:** Trim only (no canonicalization).
5. **URL change:** Resets status to `untested` and clears test metadata; name/notes-only does not.
6. **List:** Fetch cap 100; sort in TypeScript by `updatedAt` desc; **UI paginate 20 per page**.
7. **Indexes:** Not in this feature (optional later if library grows).
8. **Errors:** Repository throws `FeedRepositoryError`; actions return `{ ok, error }`.
9. **Badges:** `untested` → `secondary`, `ok` → `default`, `failed` → `destructive`.
10. **No Test button** (feature 03).
11. **Forms:** FormData + server actions + Dialog; no RHF/zod.
12. **Single list page** with dialogs — no `/feeds/[id]`.
13. **Repository in `shared/src/feeds/`** injected with `Client`.
