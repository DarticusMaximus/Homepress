# Feature 04: Newsletter list + definition form

## Intent

Give the operator a Newsletters page to list, create, edit, and delete newsletter definitions (name, topics, disliked topics, audience, item count, date-range lookback) entirely through the GUI — so definitions persist without YAML and are ready for feed attachment (feature 05) and later runs.

## Spec

Replace the Stage 02 “coming soon” `/newsletters` placeholder with a real newsletter definition surface: a shared newsletter document repository (server-side Appwrite CRUD via the API key client), and a GUI that lists newsletters and supports create / edit / delete for definition fields only. **Feed attach/detach is feature 05** — this feature must not add attach UI or write `newsletter_feeds` rows (except cascade-cleanup on newsletter delete — see Delete).

### Data access

Collections are server-only (`read: [], write: []`). All document I/O uses `getServerAppwrite()` + `Databases` with the object-parameter SDK style already used by feeds/health (`node-appwrite@26`: `createDocument({ databaseId, collectionId, documentId, data })`, etc.). Do **not** use the browser Appwrite SDK or the end-user session client for DB writes.

Put reusable CRUD in `shared/src/newsletters/` (mirror `shared/src/feeds/`): pure functions that take a `Client`, talk to `DATABASE_ID` + `NEWSLETTERS_COLLECTION_ID`, and return typed results **or throw** (see Error contract). The web layer calls those helpers from server components / server actions; it does not reimplement Appwrite calls inline.

Import `NEWSLETTERS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, and `NewsletterDateRange` / date-range vocabulary from feature 01’s `declarations` (or schema barrel). Do **not** hardcode `"newsletters"` / `"newsletter_feeds"` collection id strings outside that import.

### Document shape (write path)

On **create**:

| Field | Value |
|-------|--------|
| `name` | trimmed non-empty string, max 255; reject path separators `/`, `\`, traversal `..`, and null bytes (same safety rule as `createNewsletterConfig`) |
| `topics` | string array; each element trimmed, non-empty, max **128** chars; empty array allowed |
| `dislikedTopics` | same rules as `topics`; empty array allowed |
| `audience` | trimmed string, max **2000**; empty → store `""` |
| `newsItems` | integer; default **16** when omitted / blank on create; must be in **1..100** inclusive |
| `dateRange` | one of `NewsletterDateRange`: `"yesterday" \| "last_3_days" \| "last_week" \| "all"`; default **`"yesterday"`** when omitted on create |
| `createdAt` | ISO datetime now |
| `updatedAt` | ISO datetime now |

On **update** (all definition fields above except timestamps):

- Always bump `updatedAt`.
- Always write the full field set the form submitted (including empty `topics` / `dislikedTopics` arrays and `audience: ""`) — do **not** omit array fields on update (Appwrite omit leaves prior values in place).
- Never write feed URLs or attachment rows from this feature’s create/update path.

**Defaults (resolves Stage 03 open question):** keep feature 01 / pipeline parity — `newsItems: 16`, `dateRange: "yesterday"`. Form create UI pre-fills these; blank/omitted create input also applies them in the repository.

### Chip-list rules (`topics` / `dislikedTopics`)

- Operator adds chips via a text input + Enter (and/or an Add control); removes via chip dismiss.
- Persist **trimmed** strings; reject empty/whitespace-only chips.
- **Dedupe within each list** after trim (case-sensitive: `"AI"` and `"ai"` are distinct). Order = insertion order.
- Overlap between `topics` and `dislikedTopics` is allowed (no cross-list uniqueness) — Stage 04/run validation can tighten later if needed.
- Max **50** chips per list in the write path (V1 guardrail; schema has no count limit). Over limit → `validation` error.

### Validation

- Reject empty `name` with a stable user-facing message.
- Reject unsafe `name` chars (`/`, `\`, `..`, `\0`) with a clear message (no path-escape risk for later filename/document use).
- Reject `newsItems` that is not an integer in 1..100.
- Reject `dateRange` not in the four-literal vocabulary.
- Reject any topic/disliked topic over 128 chars or over the 50-chip cap.
- Reject `audience` over 2000 chars.
- Reject malformed chip FormData payloads per **Chip FormData parse contract** (invalid JSON / non-array / non-string elements) with `code: "validation"` — no write.
- **Name uniqueness is not required** in this feature (no `Query.equal` on name).

### Error contract

Same pipeline as feeds:

1. **`shared/src/newsletters/repository.ts` (and validation)** throws `NewsletterRepositoryError` with:
   - `code`: `"validation" | "not_found" | "appwrite"`
   - `message`: safe, user-facing string (no secrets, no raw Appwrite host/key dumps)
2. **`web/app/(protected)/newsletters/actions.ts`** catches `NewsletterRepositoryError` (and unexpected errors → generic message), returns `{ ok: true } | { ok: false, error: string }` to the UI, and on success calls `revalidatePath("/newsletters")`.

Log Appwrite failures server-side as `{ phase, code, message }` without secrets.

### Delete

Before deleting a newsletter document:

1. `listDocuments` on `newsletter_feeds` with `Query.equal("newsletterId", id)` and a reasonable page size (e.g. `Query.limit(100)`); delete each junction document found (loop pages if needed until empty — V1 scale is tiny).
2. Then `deleteDocument` on the newsletter.

Do **not** delete feed library documents. Cascade is **junction rows for this newsletter only**. (Inverse of feature 02’s “block feed delete while attached” — deleting the newsletter cleans its attachments so feeds are not stranded as attached-to-nothing from the operator’s POV.)

If the newsletter `$id` is missing → `not_found`. Do not partially leave orphan junction rows if newsletter delete fails after junction cleanup started — prefer: delete junctions first, then newsletter; if newsletter delete fails after junctions were removed, surface `appwrite` error (attachments already gone is acceptable; operator can retry delete or the newsletter remains without attachments). Document this order in the handoff.

### List / sort / pagination

- `listNewsletters` fetches with `Query.limit(100)` (hard cap for V1). **Do not** use `Query.orderDesc` on custom attributes — feature 01 has no indexes.
- Sort **in TypeScript** after fetch: `updatedAt` descending; tie-break `$id` ascending.
- **UI pagination (match feature 02):** show **20** newsletters per page. Use either client paging or server query-param `?page=` — **pick one** and document in handoff; default **page 1**. Prev/Next (or page numbers) when total > 20. Empty state only when total is zero, not when a high page is empty (**clamp to last page or redirect to page 1**).

### GUI

**Nav:** Newsletters already exists at `/newsletters` (Stage 02). Feature 02 inserts Feeds before it. This feature does **not** change nav order — only replaces the placeholder page body. If Feeds is not yet in the sidebar when this feature executes alone, do not re-litigate nav here; depend on feature 02 for the Feeds slot.

**Page** `web/app/(protected)/newsletters/page.tsx` (server component):

- Heading “Newsletters” + one short supporting line (definitions for what to generate — feeds attach next).
- Primary **Add newsletter** button opening a create Dialog.
- Table (shadcn `Table`) of the current page: columns **Name**, **Topics** (comma-joined truncate or chip preview), **Items** (`newsItems`), **Date range** (human label), **Updated**, **Actions** (Edit, Delete). Do **not** show a Feeds/attachment column yet (feature 05).
- Empty state when zero newsletters: short message + Add newsletter CTA.
- Create / edit: shadcn `Dialog` (scrollable body if needed) with:
  - Name (`Input`)
  - Topics (chip input)
  - Disliked topics (chip input)
  - Audience (`Textarea`) — helper text: short free-text for voice / reader needs (not a subscriber list; no presets)
  - Item count (`Input` `type="number"`, prefilled 16 on create)
  - Date range (shadcn `Select` already in the design system) with labels:
    - `yesterday` → “Yesterday”
    - `last_3_days` → “Last 3 days”
    - `last_week` → “Last week”
    - `all` → “All”
  - Plain controlled client form + server actions — **no** `react-hook-form` / `zod` in this feature (same as Feeds). Chip state is client-side; submit sends arrays via FormData as **JSON string fields** `topicsJson` / `dislikedTopicsJson` (locked — not repeated keys).
- **Chip FormData parse contract:** Server actions (or a shared parse helper they call before the repository) must parse `topicsJson` / `dislikedTopicsJson` as JSON arrays of strings. On **invalid JSON**, **non-array JSON**, or **any non-string element** → throw / return `NewsletterRepositoryError` with `code: "validation"` and a stable message (e.g. `"Invalid topics payload"` / `"Invalid disliked topics payload"`); **do not write**. After a successful parse, run the normal chip validation (trim, empty reject, max 128, dedupe, max 50). Missing fields on create may be treated as `"[]"`; on update, missing fields are still a validation error (form always submits both keys).
- Delete: confirm Dialog then server action; errors via `toast.error`.
- Success: `toast.success` via `web/lib/toast.ts` + `revalidatePath("/newsletters")`.
- Single list page with dialogs — **no** `/newsletters/[id]` route in this feature.

### Out of scope for this feature

- Attach / detach feeds; attach-only-if-ok (feature 05).
- Run trigger, schedules, models/prompts, delivery.
- Schema/provisioner/index changes (feature 01).
- Enforcing non-empty `topics` for “runnable” config (pipeline/`createNewsletterConfig` rule) — Stage 03 allows empty arrays at the DB layer; Stage 04 run path owns runnable validation.
- Browser SDK, YAML import, name uniqueness index.

## Dependencies

- Builds on: **feature-01-feeds-and-newsletters-schema** — `NEWSLETTERS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, `NewsletterDateRange` (or equivalent four-literal vocabulary), attribute keys/defaults. **Execute feature 01 before this feature**; if schema constants are missing, stop and escalate.
- Builds on: stage-02 GUI shell + shared components (sidebar, Table, Dialog, Select, Input, Textarea, Button, Label, Badge if useful, toast) and auth gate.
- Builds on: stage-00/02 Appwrite server client (`getServerAppwrite`) and document object-param style.
- Soft dependency: **feature-02** nav amendment (Feeds slot) — not required for newsletter CRUD correctness; page route already exists.
- Does **not** require feature 03 for verification.

## Constraints

- **Server-only DB access** via API key client; no browser Appwrite SDK; no session-client document writes.
- **Do not change** `DATABASE_ID`, provisioner create-if-absent semantics, or `health_check`.
- **Do not implement** feed attach UI or create `newsletter_feeds` rows except deleting them on newsletter delete.
- **Do not add schema indexes** in this feature; sort in memory after `Query.limit(100)`.
- **Reuse** Stage 02 shadcn primitives and `web/lib/toast.ts` only for toasts.
- **Do not call** `createNewsletterConfig` from the write path — that factory requires non-empty `feeds`/`topics` and is a pipeline concern; this feature persists the Appwrite document shape only.
- **Secrets:** never log API keys, session secrets, or full env dumps.
- **Feature 01 must be present** in code before verification that hits Appwrite; unit tests use mocks.

## Acceptance criteria

- [ ] Operator can create a newsletter with name, topics, disliked topics, audience, item count, and date-range lookback; defaults for new forms are `newsItems: 16` and `dateRange: "yesterday"`; document appears in the list after save/reload.
- [ ] Operator can edit all definition fields; after full page reload, values match what was saved (including empty topics/dislikedTopics/audience).
- [ ] Invalid name (empty or unsafe chars), out-of-range `newsItems`, invalid `dateRange`, or malformed `topicsJson` / `dislikedTopicsJson` is rejected without writing.
- [ ] Operator can delete a newsletter; it disappears after reload; any `newsletter_feeds` rows for that newsletter id are removed; feed library documents remain.
- [ ] List is sorted newest-`updatedAt`-first in application code; UI paginates at 20 per page with default page 1 and clamp/redirect on empty high pages; fetch cap is 100.
- [ ] No attach-feeds UI and no create of attachment rows in this feature’s create/update path.
- [ ] `pnpm --filter @newsletter/shared test` (newsletters module), `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- [ ] **PM manual gate:** create / edit / reload / delete / empty-list / validation errors / pagination (if >20 or fixtures) confirmed after feature 01 provisioned.

## Files

- Create: `shared/src/newsletters/types.ts` (Newsletter record + input types + `NewsletterRepositoryError`)
- Create: `shared/src/newsletters/validation.ts` (name / topics / dislikedTopics / audience / newsItems / dateRange validators; plus `parseTopicsJson` / `parseDislikedTopicsJson` or one `parseChipJsonField(field, raw)` helper for FormData JSON)
- Create: `shared/src/newsletters/repository.ts` (`listNewsletters`, `getNewsletter`, `createNewsletter`, `updateNewsletter`, `deleteNewsletter` taking `Client`; throws `NewsletterRepositoryError`)
- Create: `shared/src/newsletters/index.ts` (barrel)
- Create: `shared/src/newsletters/__tests__/validation.test.ts`
- Create: `shared/src/newsletters/__tests__/repository.test.ts`
- Create: `shared/src/newsletters/__tests__/mock-client.ts` (or reuse/extend feeds/health mock patterns — document choice in handoff)
- Modify: `shared/src/index.ts` (export newsletters module; do **not** put newsletters into `shared/src/client.ts`)
- Modify: `web/app/(protected)/newsletters/page.tsx` (replace placeholder)
- Create: `web/app/(protected)/newsletters/actions.ts` (server actions: create / update / delete → `{ ok, error? }`; parse `topicsJson` / `dislikedTopicsJson` before repository)
- Create: `web/components/newsletters/newsletters-table.tsx` (list table + pagination controls)
- Create: `web/components/newsletters/newsletter-form-dialog.tsx` (create/edit Dialog with chip inputs + date-range Select)
- Create: `web/components/newsletters/delete-newsletter-dialog.tsx` (confirm delete)
- Create: `web/components/newsletters/chip-input.tsx` (reusable chip add/remove control — or colocate under form dialog if preferred; document in handoff)
- Modify: `product_spec.md` (Newsletters list + definition form under Implemented features at handoff)

## Testing approach

**Test-first for the shared repository and validators.** GUI is verified by build/typecheck/lint plus a PM manual gate.

### `validation.test.ts`

- Accepts valid name, topics/dislikedTopics arrays, audience, newsItems 1..100, all four dateRange values.
- Applies create defaults: omitted newsItems → 16; omitted dateRange → `"yesterday"`.
- Rejects empty/whitespace name; names containing `/`, `\`, `..`, or `\0`.
- Trims name/audience/topic strings; enforces max lengths (255 / 2000 / 128).
- Dedupes within a list (case-sensitive); allows empty arrays; rejects >50 chips.
- Rejects non-integer / out-of-range newsItems; rejects unknown dateRange.
- **Chip JSON parse helper:** accepts `"[]"`, `"[\"AI\"]"`; rejects invalid JSON (`"{"`), non-array (`"{}"`, `"\"x\""`), and non-string elements (`"[1]"`, `"[null]"`) with `NewsletterRepositoryError` `code: "validation"` (or equivalent thrown validation error the actions map to `{ ok: false }`).

### `repository.test.ts` (mock `Databases`)

- **create:** writes fields including empty arrays as `[]`, `audience: ""` when empty, defaults for newsItems/dateRange when omitted, timestamps; uses `NEWSLETTERS_COLLECTION_ID` + `DATABASE_ID`; `ID.unique()`.
- **list:** `Query.limit(100)`; in-memory sort by `updatedAt` desc; mapped records include `$id`.
- **get:** returns one newsletter; missing → `not_found`.
- **update:** writes full field set including empty arrays; bumps `updatedAt`.
- **delete:** lists junction by `newsletterId`, deletes junction docs, then deletes newsletter; feed collection never deleted.
- **delete not_found:** newsletter missing → `not_found` (and no spurious feed deletes).
- **appwrite errors:** wrapped as `code: "appwrite"` with safe message (no secrets).

### Web automated

- Build, typecheck, lint, full `pnpm test` green.
- No Playwright in this feature. No new nav-order test required (route already present).

### PM manual gate

1. Worker has provisioned schema (feature 01).
2. Open `/newsletters` from sidebar.
3. Create a newsletter with topics chips + audience + defaults visible → appears in list.
4. Edit fields → reload → values persist.
5. Clear topics / audience → save → reload still empty.
6. Invalid name / newsItems → error toast; no write.
7. Delete → gone after reload.
8. If more than 20 newsletters (or seeded), pagination shows 20 per page, default page 1, and a too-high page clamps/redirects rather than showing a false empty state.
9. (Optional if feature 05 data exists) delete newsletter removes its attachment rows only.

## Tasks

### Task 1: Failing validation + repository tests

- **Action:** Add `shared/src/newsletters/__tests__/validation.test.ts` and `repository.test.ts` (plus mock client) covering Testing approach, including chip JSON parse reject cases. Do **not** implement production repository yet — tests must fail on missing module/exports.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/newsletters` exits non-zero on missing implementation (or failing assertions), not on harness misconfig.
- **Verify:** Run that command; failures cite missing exports / unimplemented behavior.
- **Depends on:** none for writing tests; **feature-01 must be verified before Task 2**.

### Task 2: Implement validation + repository

- **Action:** Implement `shared/src/newsletters/{types,validation,repository,index}.ts` including `NewsletterRepositoryError` and the chip JSON parse helper. Wire `listNewsletters` (limit 100, in-memory sort), `getNewsletter`, `createNewsletter`, `updateNewsletter`, `deleteNewsletter` (junction cascade then newsletter delete). Use object-param `Databases` APIs and `Query.equal` / `Query.limit` only (no `orderDesc` on custom attrs). Export from `shared/src/index.ts`.
- **Expected result:** Newsletters unit tests green (including malformed JSON → `validation`).
- **Verify:** `pnpm --filter @newsletter/shared test -- src/newsletters` — all green. `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1; **feature-01 verified**.

### Task 3: Page shell + server actions + list / pagination

- **Action:** Replace `web/app/(protected)/newsletters/page.tsx` placeholder with heading, supporting line, empty-state copy, visible **Add newsletter** control (dialog may be a stub until Task 4), and a table wired to `listNewsletters`. Add `web/app/(protected)/newsletters/actions.ts` with create / update / delete that: parse `topicsJson` / `dislikedTopicsJson` via the shared helper; call repository with `getServerAppwrite()`; catch `NewsletterRepositoryError`; return `{ ok: true } | { ok: false, error: string }`; `revalidatePath("/newsletters")` on success. Implement **20-per-page** pagination (pick `?page=` or client paging; default page 1; clamp/redirect empty high pages). Delete confirm dialog may land here or in Task 4 — minimum: list + pagination + actions module exist and build.
- **Expected result:** Authenticated `/newsletters` renders the real shell (not “under construction”); list/empty state/pagination work when Appwrite has data; actions import from `@newsletter/shared` and do not call `Databases` directly; malformed chip JSON returns `{ ok: false }` without writing.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Confirm no attach-feeds controls. Confirm pagination default page 1 and clamp/redirect behavior is implemented (code review / unit if any).
- **Depends on:** Task 2.

### Task 4: Create / edit form dialogs + chip inputs

- **Action:** Build `newsletter-form-dialog.tsx` (+ `chip-input.tsx` as needed) and wire create/edit to the server actions. Fields: name, topics chips, disliked topics chips, audience textarea, newsItems number (prefill **16** on create), date-range shadcn Select (prefill **yesterday** on create). Submit FormData with `topicsJson` / `dislikedTopicsJson`. Wire Edit from the table; toasts on success/error. Finish delete confirm dialog if not done in Task 3.
- **Expected result:** Create / edit / delete / validation errors work end-to-end when Appwrite is provisioned; chip add/remove round-trips through JSON FormData; no attach UI.
- **Verify:** `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Confirm create defaults show 16 / Yesterday. Confirm form always submits both JSON keys on update.
- **Depends on:** Task 3.

### Task 5: Regression + product_spec note

- **Action:** Run full `pnpm test`, fix fallout. Update `product_spec.md` Implemented features with a one-line Newsletters list + definition form entry. Confirm no attach UI and no schema/provisioner/index edits.
- **Expected result:** Full suite green; product_spec reflects the page.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero. Diff review: no feature-05 attach UI; no `Query.orderDesc` on newsletter attributes; no `createNewsletterConfig` in the write path; chip JSON parse rejects malformed payloads.
- **Depends on:** Task 4.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/newsletters && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: Newsletters validation/repository tests pass (defaults, chip rules, unsafe name reject, malformed `topicsJson`/`dislikedTopicsJson` → `validation`, update writes empty arrays, delete cascades junction only). Full suite green. Web build emits `/newsletters` with real page (not “under construction”). No attach-feeds action in newsletters UI code.

### Stage B — PM manual gate

- With worker provisioned (feature 01), log in → Newsletters → create / edit / reload persistence / validation reject / delete / pagination (if >20 or fixtures) as in Testing approach. Confirm create defaults show 16 / Yesterday. Confirm no Attach feeds UI yet.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `shared/src/newsletters/` and `web/app/(protected)/newsletters/` (+ components).
- Confirmation of test/build/typecheck/lint commands and results.
- Exact public exports from the newsletters module (`NewsletterRepositoryError` codes + chip JSON parse helper included).
- Confirmation of locked decisions below as implemented (or deviations + why).
- Confirmation that feature 01 constants were used (no hardcoded collection id strings outside declarations import).
- Confirmation FormData uses `topicsJson` / `dislikedTopicsJson` and malformed payloads return `{ ok: false }` with no write.
- Which pagination mechanism was chosen (`?page=` vs client) and that clamp/redirect is implemented.
- **Research note:** Mirrors feature 02 repository/actions/`{ ok, error }` pattern. Appwrite string-array attributes accept JS arrays on create/update (Appwrite docs / community threads). Empty arrays and `audience: ""` must be written explicitly on update so prior values clear. `createNewsletterConfig` is intentionally not used here (requires feeds + non-empty topics). Defaults `16` / `"yesterday"` confirm Stage 03 open question toward pipeline parity. Select component already present in `web/components/ui/select.tsx`.

## Locked decisions (PM confirmed 2026-07-09)

1. **Defaults:** `newsItems: 16`, `dateRange: "yesterday"` (pipeline / feature 01 parity).
2. **Empty topics allowed** at save time (runnable non-empty check deferred to Stage 04).
3. **Delete newsletter:** cascade-delete that newsletter’s `newsletter_feeds` rows only; never delete feeds.
4. **No name uniqueness** enforcement in V1.
5. **Chip rules:** trim; case-sensitive dedupe within list; max 50 per list; overlap across topics/disliked allowed.
6. **newsItems bounds:** integer 1..100.
7. **UI:** list + Dialogs (no `/newsletters/[id]`); FormData + server actions; no RHF/zod; shadcn Select for date range.
8. **List:** fetch cap 100; sort in TS; paginate 20; default page 1; clamp/redirect empty high pages (feature 02 parity).
9. **Chip FormData:** locked to `topicsJson` / `dislikedTopicsJson`; invalid JSON / non-array / non-string elements → `validation`, no write.
10. **No attach UI** (feature 05).
11. **Repository in `shared/src/newsletters/`** injected with `Client`.
12. **Task split:** shell/list/actions/pagination (Task 3) then form dialogs + chips (Task 4).
