# Feature 05: Attach feeds to newsletter

## Intent

Let the operator attach and detach library feeds on a newsletter — with **attach-only-if-ok** enforced in both the UI and the server write path — so the same qualified source can be shared across newsletters without YAML, and unqualified feeds never become part of a definition.

## Spec

Extend feature 04’s Newsletters surface with many-to-many feed attachment via the `newsletter_feeds` junction collection. Definition CRUD stays as feature 04 specified; this feature owns **list / attach / detach** for attachments, the attach-only-if-ok gate, duplicate prevention, and the Feeds column / edit-dialog attach UI.

### Data access

Collections remain server-only. All junction I/O uses `getServerAppwrite()` + `Databases` object-parameter style (`node-appwrite@26`). Do **not** use the browser Appwrite SDK or session-client document writes.

Put attachment helpers in `shared/src/newsletters/attachments.ts` (same package as feature 04’s newsletter repository — feature 04 already cascades junction rows on newsletter delete). Export them from `shared/src/newsletters/index.ts`. Reuse `getFeed` / `listFeeds` from `shared/src/feeds/` for status checks and display names — do **not** reimplement feed document reads inline in the web layer.

Import `NEWSLETTER_FEEDS_COLLECTION_ID`, `NEWSLETTERS_COLLECTION_ID`, `FEEDS_COLLECTION_ID`, `DATABASE_ID`, and `FeedStatus` from feature 01 declarations (or schema barrel). Do **not** hardcode those collection id strings outside that import.

### Attachment document shape

On **attach** (create junction row):

| Field | Value |
|-------|--------|
| `newsletterId` | target newsletter `$id` |
| `feedId` | target feed `$id` |
| `createdAt` | ISO datetime now |

No other fields. Detach = `deleteDocument` on the junction row only — **never** delete the feed library document.

### Attach write path (`attachFeed`)

`attachFeed(client, newsletterId, feedId)`:

1. Load newsletter by `$id` — missing → `NewsletterRepositoryError` `code: "not_found"`, message `"Newsletter not found"`.
2. Load feed by `$id` (reuse feeds `getFeed`) — missing → `not_found`, message `"Feed not found"`.
3. If `feed.status !== "ok"` → throw `NewsletterRepositoryError` with `code: "not_ok"` and message `"Only feeds with status ok can be attached"` — **no write**.
4. Duplicate check: `listDocuments` on `newsletter_feeds` with `Query.equal("newsletterId", newsletterId)`, `Query.equal("feedId", feedId)`, `Query.limit(1)`. If any hit → `code: "duplicate_attachment"`, message `"This feed is already attached to this newsletter"` — **no write**.
5. `createDocument` with `ID.unique()` and `{ newsletterId, feedId, createdAt }`.
6. Return a typed attachment record including at least `$id`, `newsletterId`, `feedId`, `createdAt`.

**Server is the source of truth for the gate.** UI filtering is a convenience; a crafted server-action call with a non-`ok` feedId must still be rejected.

### Detach write path (`detachFeed`)

Locked signature: `detachFeed(client, newsletterId, feedId)` — the UI does not thread junction `$id`s.

1. Find the junction row with both ids (`Query.equal` ×2, `Query.limit(1)`). Missing → `not_found`, message `"Attachment not found"`.
2. `deleteDocument` that junction `$id`.
3. Do **not** delete or mutate the feed document. Do **not** mutate the newsletter definition document.

### List attachments (`listAttachmentsForNewsletter`)

`listAttachmentsForNewsletter(client, newsletterId)`:

1. `listDocuments` on `newsletter_feeds` with `Query.equal("newsletterId", newsletterId)` and `Query.limit(100)`.
2. For each junction row, resolve the feed (batch via `listFeeds` map-by-id, or per-id `getFeed` — V1 scale is tiny; prefer one `listFeeds` + in-memory map to avoid N+1).
3. Return records sorted by `createdAt` ascending (stable attach order), each including:
   - `attachmentId` (junction `$id`)
   - `feedId`, `feedName`, `feedUrl`, `feedStatus` (`FeedStatus`)
   - `createdAt`
4. If a junction points at a missing feed document (orphan), **omit** it from the returned list and log `{ phase: "list-attachments", code, message }` without secrets — do not throw the whole list. (Should be rare; feature 02 blocks feed delete while attached.)

Also add `listAttachedFeedIds(client, newsletterId): Promise<string[]>` if useful for the list-column count / form — or derive ids from `listAttachmentsForNewsletter`. Document choice in handoff.

**Optional batch helper for the list page:** `listAttachmentCountsByNewsletter(client, newsletterIds: string[])` or list all junctions with `Query.limit(100)` once and group in TS — so the Newsletters table can show a Feeds count without N queries. Cap is V1-tiny; pick one approach and document it.

### Error contract

Extend feature 04’s `NewsletterRepositoryError` codes to:

`"validation" | "not_found" | "not_ok" | "duplicate_attachment" | "appwrite"`

(Keep existing feature 04 codes; add `not_ok` and `duplicate_attachment`.)

Web actions catch `NewsletterRepositoryError` (and unexpected → generic message), return `{ ok: true } | { ok: false, error: string }`, and on success call `revalidatePath("/newsletters")`.

Log Appwrite failures as `{ phase, code, message }` without secrets.

### Demotion / stale attachments (do not “fix”)

Per stage pin (feature 03): re-testing a feed to `failed` **does not** detach. This feature must:

- Still **list** attached feeds whose status is no longer `ok` (show status Badge in the attached list).
- Still allow **detach** of non-`ok` attached feeds.
- **Never** offer non-`ok` feeds in the attach picker.
- **Never** auto-detach on list/load.

Stage 04 owns run-time “attached but not ok” invalid-config handling — out of scope here.

### Sharing

The same `ok` feed **may** attach to multiple newsletters (separate junction rows). Duplicate prevention is **per (newsletterId, feedId) pair only**, not global per feed.

### Empty attachments

A newsletter with **zero** attached feeds is valid in Stage 03 (same posture as empty topics). Stage 04 run path owns “runnable” non-empty feeds validation. Do not block save of definition fields when attachments are empty.

### GUI

**Where:** Attach/detach lives on the **edit** newsletter Dialog only (newsletter `$id` required). Create dialog stays definition-only (feature 04). Operator flow: create newsletter → Edit → attach feeds. Do **not** add `/newsletters/[id]` routes.

**Data loading for the edit dialog (locked):** Feature 04’s dialog is definition FormData only — this feature must wire real feed data into the edit path. On the Newsletters page (server component), for each newsletter that can be edited (or once per open-edit if the dialog is opened with that newsletter’s `$id`):

1. Load **attached** rows via `listAttachmentsForNewsletter(client, newsletterId)`.
2. Load the feed library via `listFeeds(client)` (feature 02).
3. Derive **eligible attach candidates** in the page (or a thin helper colocated with the page/section): `status === "ok"` **and** `feedId` not already in the attached set.
4. Pass both into the edit dialog / `newsletter-feeds-section` as props (e.g. `attachedFeeds` + `eligibleFeeds`). Do **not** leave the Select or Attached list as empty stubs that only “work” after a future change.

After attach/detach, `revalidatePath("/newsletters")` (already required on the actions) refreshes the page so props update. Do not invent a separate client-only fetch that bypasses the shared helpers.

**Edit dialog — new “Feeds” section** (below definition fields, or a clear second block with heading “Feeds”):

1. **Attached list:** bound to the `attachedFeeds` prop — each row shows feed name, truncated URL optional, status Badge (same map as Feeds page: `untested` → `secondary`, `ok` → `default`, `failed` → `destructive`), and a **Detach** control that calls `detachFeedFromNewsletter(newsletterId, feedId)`. Empty: short “No feeds attached yet.”
2. **Attach control:** shadcn `Select` options bound to the `eligibleFeeds` prop; primary **Attach** button calls `attachFeedToNewsletter(newsletterId, selectedFeedId)`. If `eligibleFeeds` is empty: helper text pointing operator to Feeds page / Test feed (e.g. “No ok feeds available to attach. Qualify a feed on the Feeds page first.”).
3. Non-`ok` feeds never appear in `eligibleFeeds` (even if visible elsewhere on the Feeds page).
4. After attach/detach: `toast.success` / `toast.error`; list refreshes via revalidation. Definition Save remains separate — attaching does **not** require clicking the definition Save button.

**List table:** add a **Feeds** column (after Name or before Updated — pick one; default after Topics/Items area is fine) showing the **attachment count** as a number (`0` when none). Do not dump full feed names in the table (detail is in Edit). Loading counts must not break the page if junctions fail — surface empty/0 and log server-side.

**Actions:** no separate “Manage feeds” row action required if Edit opens the dialog with the Feeds section visible; optional deep-link/scroll is nice-to-have, not required.

### Server actions

In `web/app/(protected)/newsletters/actions.ts`, add:

- `attachFeedToNewsletter(newsletterId, feedId)` → attach path above → `{ ok, error? }` + `revalidatePath("/newsletters")`
- `detachFeedFromNewsletter(newsletterId, feedId)` → detach path → same return shape

Do not call `Databases` directly from actions — go through `shared/src/newsletters/attachments.ts` (and feeds helpers as needed).

### Out of scope

- Changing feed qualification / Test feed (feature 03).
- Schema/provisioner/index changes (feature 01).
- Auto-detach on demotion; run-time invalid-config (Stage 04).
- Requiring ≥1 feed to save a newsletter.
- Browser SDK, YAML import, Playwright e2e.
- Changing feature 04 definition field validation or chip FormData contract.

## Dependencies

- Builds on: **feature-01-feeds-and-newsletters-schema** — `newsletter_feeds` collection, id constants, `FeedStatus`.
- Builds on: **feature-02-feed-library-page** — `shared/src/feeds/` (`getFeed` / `listFeeds`, `FeedRepositoryError` patterns), Feeds library documents.
- Builds on: **feature-03-feed-qualification-test** — real `ok` / `failed` status from Test feed (PM gate). Unit tests may set `status` on mocks without feature 03 code.
- Builds on: **feature-04-newsletter-list-and-definition-form** — Newsletters page, edit Dialog, `NewsletterRepositoryError`, server actions, list table. **Execute feature 04 before this feature**; if the newsletters module or edit dialog is missing, stop and escalate.
- Soft: feature 02 delete-while-attached becomes exercisable once this feature creates junctions.

## Constraints

- **Server-only** DB access via API key client.
- **Attach-only-if-ok** on the write path — UI filter is not sufficient.
- **Detach never deletes** feed library documents.
- **Demotion does not detach** — do not add cleanup that removes junctions when status ≠ `ok`.
- **Do not change** `DATABASE_ID`, provisioner semantics, or `health_check`.
- **Do not add schema indexes** in this feature; use `Query.equal` + `Query.limit` only (no `orderDesc` on custom attrs).
- **Reuse** Stage 02 shadcn primitives + `web/lib/toast.ts`; prefer existing `Select` over installing new components unless a Checkbox is clearly better — default is Select + Attach.
- **Secrets:** never log API keys, session secrets, or full env dumps.
- **Do not call** `createNewsletterConfig` from this feature.

## Acceptance criteria

- [ ] On an existing newsletter, the operator can attach an `ok` feed from the edit Dialog; after reload, the feed still appears in the attached list and the list-column count increments.
- [ ] Attaching a feed with status `untested` or `failed` is rejected by the server with a clear message and no junction row is created; the UI does not offer those feeds in the attach picker.
- [ ] Attaching the same feed twice to the same newsletter is rejected (`duplicate_attachment`); one junction row remains.
- [ ] The same `ok` feed can be attached to two different newsletters at the same time (two junction rows).
- [ ] Detach removes the junction row only; the feed remains in the Feeds library; count decrements after reload.
- [ ] An attached feed that later becomes `failed` (demotion) still appears in the attached list with failed Badge and can still be detached; it is not auto-removed.
- [ ] Create-newsletter Dialog has no attach UI; attach is edit-only.
- [ ] `pnpm --filter @newsletter/shared test` (newsletters attachments + existing newsletters tests), `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- [ ] **PM manual gate:** attach ok / reject non-ok / share across two newsletters / detach / demoted-still-attached confirmed after features 01–04 provisioned and at least one feed tested `ok`.

## Files

- Create: `shared/src/newsletters/attachments.ts` (`attachFeed`, `detachFeed`, `listAttachmentsForNewsletter`, optional count/id helpers)
- Modify: `shared/src/newsletters/types.ts` (attachment record types; extend `NewsletterRepositoryError` codes)
- Modify: `shared/src/newsletters/index.ts` (export attachment API)
- Create: `shared/src/newsletters/__tests__/attachments.test.ts`
- Modify: `shared/src/newsletters/__tests__/mock-client.ts` (or shared mock) so junction + feed documents can be seeded for attach/detach/list tests
- Modify: `web/app/(protected)/newsletters/actions.ts` (`attachFeedToNewsletter`, `detachFeedFromNewsletter`)
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx` (Feeds section on edit only)
- Create: `web/components/newsletters/newsletter-feeds-section.tsx` (attached list + Select/Attach + Detach — or colocate in the form dialog; document in handoff)
- Modify: `web/components/newsletters/newsletters-table.tsx` (Feeds count column; wire counts from page)
- Modify: `web/app/(protected)/newsletters/page.tsx` (load attachment counts / pass into table)
- Modify: `product_spec.md` (attach feeds under Implemented features at handoff)

## Testing approach

**Test-first for attachment repository helpers.** GUI verified by build/typecheck/lint plus PM manual gate.

### `attachments.test.ts` (mock `Databases` + feed docs)

- **attach ok:** creates junction with `newsletterId`, `feedId`, `createdAt`; uses `NEWSLETTER_FEEDS_COLLECTION_ID` + `DATABASE_ID`.
- **attach not_ok:** feed `untested` / `failed` → throws `not_ok`; no `createDocument` on junction.
- **attach missing newsletter / missing feed:** `not_found`.
- **attach duplicate:** existing junction for pair → `duplicate_attachment`; no second create.
- **attach share:** same feedId on two newsletterIds → both creates succeed.
- **detach:** deletes junction only; feed document untouched.
- **detach missing:** `not_found`.
- **list:** returns attached feeds with name/status; sort `createdAt` asc; includes `failed` attached feeds (demotion case); omits orphan junction if feed missing (optional assert + log).
- **appwrite errors:** wrapped as `code: "appwrite"` with safe message (no secrets).

### Web automated

- Build, typecheck, lint, full `pnpm test` green.
- No Playwright in this feature.

### PM manual gate

1. Features 01–04 done; worker provisioned; at least one feed Test → `ok`; one `untested` or `failed` feed exists.
2. Create newsletter (no attach on create) → Edit → attach the `ok` feed → reload → still attached; Feeds column shows `1`.
3. Confirm non-`ok` feed is not in the attach Select; attempting attach via any exposed path fails with a clear toast if forced.
4. Attach same `ok` feed to a second newsletter → both show it.
5. Detach from one → that newsletter count drops; feed still on Feeds page and still on the other newsletter.
6. (If feature 03 available) re-test an attached feed to force `failed` → still listed on newsletter with failed Badge; Detach still works; not offered in Attach Select.

## Tasks

### Task 1: Failing attachment tests

- **Action:** Add `shared/src/newsletters/__tests__/attachments.test.ts` covering Testing approach (ok attach, not_ok reject, duplicate, share across two newsletters, detach, list including failed status, not_found). Extend mock client as needed. Do **not** implement production `attachments.ts` yet — tests must fail on missing exports / unimplemented behavior.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/newsletters` exits non-zero on missing attachment API (or failing assertions), not on harness misconfig.
- **Verify:** Run that command; failures cite missing `attachFeed` / `detachFeed` / `listAttachmentsForNewsletter` (or equivalent).
- **Depends on:** none for writing tests; **features 01 and 04 must be verified before Task 2**.

### Task 2: Implement attachment repository helpers

- **Action:** Implement `shared/src/newsletters/attachments.ts` and extend `types.ts` / `NewsletterRepositoryError` codes (`not_ok`, `duplicate_attachment`). Wire `attachFeed`, `detachFeed`, `listAttachmentsForNewsletter` (+ optional count helper). Reuse feeds `getFeed` / `listFeeds`. Export from newsletters barrel / `shared/src/index.ts` as needed.
- **Expected result:** Attachment unit tests green; existing newsletters tests still green.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/newsletters` — all green. `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1; **feature-01 and feature-04 verified**; feature-02 feeds module present for `getFeed`/`listFeeds`.

### Task 3: Server actions + edit-dialog Feeds section

- **Action:** Add `attachFeedToNewsletter` / `detachFeedFromNewsletter` to `web/app/(protected)/newsletters/actions.ts`. In `web/app/(protected)/newsletters/page.tsx`, load per-newsletter attached rows (`listAttachmentsForNewsletter`) and library feeds (`listFeeds`), derive `eligibleFeeds` (`ok` + not attached), and pass `attachedFeeds` + `eligibleFeeds` into the edit dialog. Build `newsletter-feeds-section.tsx` (or colocate) and wire it into the **edit** path of `newsletter-form-dialog.tsx` only — Attached list bound to props + Detach → `detachFeedFromNewsletter`; Select options bound to `eligibleFeeds` + Attach → `attachFeedToNewsletter`. Toasts on success/error; `revalidatePath("/newsletters")`. Create path receives no Feeds section / no feed props.
- **Expected result:** Edit dialog can attach/detach when Appwrite is provisioned; create dialog has no Feeds section; Select is not an empty stub — options come from loaded `eligibleFeeds`; non-`ok` feeds absent from Select.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Diff / code review checklist (all must hold — an empty Select that never reads `listFeeds` / `listAttachmentsForNewsletter` fails this task):
  1. Edit path renders a Feeds section.
  2. Page (or equivalent server loader) calls `listAttachmentsForNewsletter` and `listFeeds` and passes `attachedFeeds` + `eligibleFeeds` into the edit dialog / Feeds section.
  3. Select options are derived from `status === "ok"` and not-already-attached (not a hardcoded empty array).
  4. Attached list Detach control calls `detachFeedFromNewsletter(newsletterId, feedId)`.
  5. Attach control calls `attachFeedToNewsletter(newsletterId, feedId)`.
  6. Create path has no Feeds section / no attach controls.
  7. Actions do not call `Databases` directly.
- **Depends on:** Task 2.

### Task 4: List Feeds column + regression + product_spec

- **Action:** Add Feeds count column to `newsletters-table.tsx`; load counts in `page.tsx` via the shared helper. Run full `pnpm test`. Update `product_spec.md` Implemented features with a one-line attach-feeds entry. Confirm no schema/provisioner changes and no auto-detach-on-demotion logic.
- **Expected result:** Full suite green; list shows counts; product_spec updated.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero. Diff review: attach-only-if-ok on server; detach does not delete feeds; demotion does not remove junctions.
- **Depends on:** Task 3.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/newsletters && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: Attachment tests pass (ok / not_ok / duplicate / share / detach / list-with-failed). Full suite green. Web build includes edit-dialog Feeds section and list Feeds column. Diff review confirms the Task 3 checklist: page loads attachments + library feeds into edit props; Select/Detach/Attach are wired to those props and the server actions; create path has no attach UI. No schema declaration changes required for this feature.

### Stage B — PM manual gate

- With features 01–04 live and at least one `ok` feed, perform Testing approach PM steps: attach, reject non-ok, share across two newsletters, detach, demoted-still-attached.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `shared/src/newsletters/` and `web/components/newsletters/` / newsletters actions/page.
- Confirmation of test/build/typecheck/lint commands and results.
- Exact attachment API exports and `NewsletterRepositoryError` codes added.
- Confirmation of locked decisions below (or deviations + why).
- Whether counts use a batch helper vs per-newsletter list.
- Whether Feeds section is a separate component file or colocated.
- **Research note:** Mirrors features 02–04 repository/actions/`{ ok, error }` pattern. Junction is plain string ids (feature 01). Appwrite supports multiple `Query.equal` predicates on one `listDocuments` call (node-appwrite Query API). Empty attachments allowed in Stage 03; Stage 04 owns runnable feed checks. Demotion-without-detach is an explicit stage pin carried into Stage 04.

## Locked decisions (auto-mode — PM may override in review)

1. **Attach UI on edit only** — create dialog stays definition-only; operator attaches after the newsletter exists.
2. **Select + Attach** (not a multi-checkbox grid); no new shadcn component required by default.
3. **List column shows attachment count**, not feed names.
4. **Error codes:** extend `NewsletterRepositoryError` with `not_ok` and `duplicate_attachment`.
5. **Helpers live in** `shared/src/newsletters/attachments.ts` (not a separate package).
6. **Detach signature:** `(client, newsletterId, feedId)` only — no junction-`$id` overload.
7. **Empty attachments allowed** at Stage 03.
8. **No auto-detach** when an attached feed’s status leaves `ok`.
9. **Orphan junctions** (missing feed doc): omit from list + log; do not fail the whole list.
10. **Duplicate rule:** per (newsletterId, feedId) only; cross-newsletter sharing allowed.
11. **Edit dialog data path:** page loads `listAttachmentsForNewsletter` + `listFeeds`, derives `eligibleFeeds`, passes `attachedFeeds` + `eligibleFeeds` as props — no empty-stub Select.
