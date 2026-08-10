# Feature 01: Feeds + newsletters schema

## Intent

Establish the Appwrite data contract for first-class feeds, newsletter definitions, and many-to-many attachments — provisioned idempotently via the existing schema-as-code module — so every later Stage 03 feature (and Stages 04+) can persist and query “which newsletter” and “which sources” without YAML or console-clicked schema.

## Spec

Extend `shared/src/schema/declarations.ts` with three domain collections alongside the existing `health_check` proving collection, and teach the provisioner to honor `SchemaAttribute.array` (declared in Stage 02 but never wired — called out in `stage-02-app-foundation-SUMMARY.md`). No GUI, no document CRUD, no feed-test logic: this feature only shapes the database and the declaration/provisioner contract. Worker boot already calls `provisionDatabase`; appending declarations is sufficient for live provisioning on the next restart.

### Collections

All three use server-only permissions (`read: [], write: []`), matching `health_check`. Export collection-id constants (same pattern as `HEALTH_CHECK_COLLECTION_ID`). Collection display `name` strings (Appwrite human-readable labels, distinct from ids):

| Collection id | Display `name` |
|---------------|----------------|
| `feeds` | `"Feeds"` |
| `newsletters` | `"Newsletters"` |
| `newsletter_feeds` | `"Newsletter Feeds"` |

#### 1. `feeds` (`FEEDS_COLLECTION_ID = "feeds"`)

First-class feed library entity. Status is driven by the qualification test (feature 03); this feature only declares the fields.

| Attribute | Type | Size / notes | Required | Default | Array |
|-----------|------|--------------|----------|---------|-------|
| `name` | string | 255 | true | — | no |
| `url` | string | 2048 | true | — | no |
| `notes` | string | 2000 | false | — | no |
| `status` | string | 32 | true | — | no |
| `lastTestedAt` | datetime | — | false | — | no |
| `lastTestError` | string | 1000 | false | — | no |
| `createdAt` | datetime | — | true | — | no |
| `updatedAt` | datetime | — | true | — | no |

**Status values (canonical):** `untested` | `ok` | `failed`. Export a TypeScript union `FeedStatus` and a const array `FEED_STATUSES` from `declarations.ts` so later features import the vocabulary rather than string-literal drift. New feeds are created as `untested` by feature 02’s write path (not by an Appwrite attribute default — Appwrite forbids defaults on required attributes).

#### 2. `newsletters` (`NEWSLETTERS_COLLECTION_ID = "newsletters"`)

Newsletter definition fields from the stage goal. Feeds are **not** embedded here — attachments live in the junction collection.

| Attribute | Type | Size / notes | Required | Default | Array |
|-----------|------|--------------|----------|---------|-------|
| `name` | string | 255 | true | — | no |
| `topics` | string | 128 per element | false | — | **yes** |
| `dislikedTopics` | string | 128 per element | false | — | **yes** |
| `audience` | string | 2000 | false | — | no |
| `newsItems` | number | (float in Appwrite) | false | `16` | no |
| `dateRange` | string | 32 | false | `"yesterday"` | no |
| `createdAt` | datetime | — | true | — | no |
| `updatedAt` | datetime | — | true | — | no |

**Field naming / defaults (auto-mode choices — PM may override):**

- `newsItems` matches `NewsletterConfig.newsItems` in `shared/src/pipeline/types.ts` (pipeline default `16` via `createNewsletterConfig`). Stage open question suggested “10”; this spec prefers pipeline parity so Stage 04 can map documents → `NewsletterConfig` without a rename layer. Override to `10` in review if preferred.
- `dateRange` stores the pipeline `DateRange` string enum from `shared/src/pipeline/config.ts`: `"yesterday" | "last_3_days" | "last_week" | "all"`. Default `"yesterday"` matches `createNewsletterConfig`. This is the **fetch** lookback, not Stage 05’s cross-run topic-dedup lookback.
- `audience` is free-text (voice / reader-needs brief). No presets. Empty string is valid at the DB layer.
- `topics` / `dislikedTopics` are Appwrite string-array attributes. Empty arrays are valid at the DB layer; non-empty validation for a runnable config belongs to later write/run paths.
- `interPhaseDelaySeconds` is **not** persisted in this stage (pipeline-only / future). Do not add it here.

Export a TypeScript union `NewsletterDateRange` (alias of the four literals above, or re-export/align with pipeline `DateRange` if a shared import is cleaner without creating a declarations→pipeline cycle — prefer duplicating the four-literal union in `declarations.ts` if importing from `pipeline/config` would couple schema to pipeline).

#### 3. `newsletter_feeds` (`NEWSLETTER_FEEDS_COLLECTION_ID = "newsletter_feeds"`)

Many-to-many junction. Same feed may attach to many newsletters; detaching does not delete the feed.

| Attribute | Type | Size / notes | Required | Default | Array |
|-----------|------|--------------|----------|---------|-------|
| `newsletterId` | string | 64 (Appwrite document `$id`) | true | — | no |
| `feedId` | string | 64 | true | — | no |
| `createdAt` | datetime | — | true | — | no |

No uniqueness index in this feature (the provisioner does not create indexes today). Duplicate-attachment prevention is enforced by feature 05’s write path. Do not use Appwrite relationship attributes — plain string IDs keep the provisioner surface unchanged and match the Stage 02 create-if-absent model.

### Provisioner: honor `array`

Stage 02 left `SchemaAttribute.array?` unwired. This feature patches `shared/src/schema/provisioner.ts` so every `create*Attribute` call passes `array: true` when `declared.array === true`, and omits / passes `false` otherwise.

**Rules:**

- When `declared.array === true`, do **not** pass `xdefault` / `default` (Appwrite rejects defaults on array attributes — confirmed via node-appwrite docs / historical SDK issue `attribute_default_unsupported`).
- Extend `attributeMatches` to treat `array` as part of the match: if live `array` (boolean, defaulting missing to `false`) differs from `!!declared.array`, that is drift (warn + skip, do not alter).
- Existing non-array attributes (`health_check`, and all scalar fields above) must keep working — regression covered by existing provisioner tests plus new array-specific cases.

### What this feature does **not** do

- No Feeds page, newsletter form, attach UI, or Test-feed action (features 02–05).
- No document create/read/update/delete helpers.
- No indexes, migrations, drops, or retypes.
- No attach-only-if-ok enforcement (feature 05 + server write path).
- No change to worker boot wiring beyond what already exists (declarations drive provisioning).

## Dependencies

- Builds on: stage-02 feature-01 (`shared/src/schema/declarations.ts`, `provisioner.ts`, worker boot `provisionDatabase` call, Vitest mock client under `shared/src/schema/__tests__/`).
- Builds on: stage-01 pipeline types/config for field-name and default alignment (`NewsletterConfig.newsItems`, `DateRange`) — conceptual alignment only; this feature does not call the pipeline.
- Orphaned by: none — first feature in stage 03.

## Constraints

- **Schema-as-code only.** Append to `COLLECTIONS` in `declarations.ts`; do not provision via the Appwrite console or one-off scripts.
- **Create-if-absent only.** No drop/rename/retype/migrate. Drift → warn + skip (existing provisioner contract).
- **Server-only permissions** on all new collections (`read: [], write: []`).
- **Do not remove or alter `health_check`** attributes or id; dashboard health card (stage 02) depends on it.
- **Do not change `DATABASE_ID`** (`newsletter_db`).
- **Array attributes must not declare `default`.**
- **No GUI / web / worker behavior changes** beyond provisioner + declarations (+ tests). Worker already provisions on boot.
- **Attach-only-if-ok is not enforced here** — status field exists so later features can enforce it; this feature does not write documents.
- **Feed URL uniqueness** is not a DB unique index in this feature; feature 02 may enforce in the write path.
- **Secrets:** provisioner must never log API keys or session secrets (existing constraint).

## Acceptance criteria

- [ ] `COLLECTIONS` includes exactly four collections: `health_check`, `feeds`, `newsletters`, `newsletter_feeds` (order: keep `health_check` first; domain collections after).
- [ ] Exported constants: `FEEDS_COLLECTION_ID`, `NEWSLETTERS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, plus `FeedStatus` / `FEED_STATUSES` and a `NewsletterDateRange` (or equivalent) union for the four date-range literals.
- [ ] `feeds`, `newsletters`, and `newsletter_feeds` attribute sets match the tables in Spec (keys, types, sizes, required, defaults, array flags).
- [ ] Provisioner passes `array: true` to the matching `create*Attribute` SDK call when `declared.array === true`, and does not pass a default for array attributes.
- [ ] `attributeMatches` reports drift when live vs declared `array` flags disagree.
- [ ] Existing provisioner behaviors still hold: idempotent re-run, 409 race skip, type/size drift warn+skip, transient failure isolation, server-only collection permissions, no secrets in logs/results.
- [ ] `pnpm --filter @newsletter/shared test` passes (updated declaration tests + new/extended provisioner tests).
- [ ] `pnpm typecheck` passes with zero errors.
- [ ] A later Stage 03 feature can import the collection-id constants and attribute field names without hardcoding string literals for collection ids.

## Files

- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/provisioner.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/schema/__tests__/provisioner.test.ts`
- Modify: `shared/src/schema/__tests__/mock-client.ts` (only if needed so mock `listAttributes` / create calls can carry and assert `array`)

## Testing approach

Test-first. Unit tests against the existing mock SDK client — no live Appwrite round-trip in this feature (same pattern as stage-02 feature-01). Live provisioning is proven when the worker boots against a real project in later Stage 03 features that write documents.

### `declarations.test.ts` (replace the “exactly one collection” guard)

- Still asserts `DATABASE_ID` / `DATABASE_NAME` unchanged.
- `COLLECTIONS` length is **4**; ids are exactly `health_check`, `feeds`, `newsletters`, `newsletter_feeds`.
- `health_check` attributes unchanged (status string 255 required; createdAt datetime required; server-only perms).
- `feeds`: display `name` `"Feeds"`; all eight attributes present with the Spec table’s type/size/required/array; `status` is string size 32 required non-array; no unexpected keys.
- `newsletters`: display `name` `"Newsletters"`; `topics` and `dislikedTopics` have `array: true`; `newsItems` is number with default `16`; `dateRange` is string with default `"yesterday"`; `audience` string size 2000 optional; no feed-URL fields on this collection.
- `newsletter_feeds`: display `name` `"Newsletter Feeds"`; `newsletterId`, `feedId`, `createdAt` only; both ids string size 64 required.
- All three new collections have `permissions: { read: [], write: [] }`.
- `FEED_STATUSES` equals `["untested", "ok", "failed"]` (order may be fixed as that tuple).
- Compile-time: `COLLECTIONS` assignable to `SchemaCollection[]`.

### `provisioner.test.ts` (add; keep existing cases green)

- **Array create:** With a temporary declared string attribute `{ key: "topics", type: "string", size: 128, required: false, array: true }` (runtime patch of `COLLECTIONS` like the existing default/`xdefault` test), fresh create calls `createStringAttribute` with `array: true` and **without** `xdefault`.
- **Array drift:** Live attribute has `array: false` (or missing) while declared `array: true` → drift warning, no create, `attributes.drift >= 1`.
- **Array match skip:** Live attribute matches type/size/`array: true` → skipped, not created.
- **Regression:** Existing fresh-provision / idempotent / 409 / type-drift / size-drift / transient-failure / permissions / no-secrets tests still pass. **Critical mock constraint:** today’s `MockDatabases.existingAttributes` is a single global list returned for every `listAttributes` call, ignoring `collectionId`. Once `COLLECTIONS` has four collections, seeding only `health_check` attributes into that global list will contaminate other collections (e.g. live `status` size 255 from health_check vs declared `feeds.status` size 32 → phantom drift). Regression tests MUST use one of these approaches — not merely “adjust expected create counts” while leaving a shared attribute list in place for multi-collection runs:
  1. **Preferred for legacy cases:** temporarily patch `COLLECTIONS` to the `health_check`-only slice for tests that assert health_check-era counts/behavior; restore in `finally`.
  2. **Or:** extend the mock so live attributes are keyed by `collectionId` when asserting a full four-collection provision.

Edge cases: array + accidental default must not be sent; `array` flag drift; non-array attributes unaffected; global mock attribute list must not cross-contaminate collections.

## Tasks

### Task 1: Write failing declaration + array-provisioner tests

- **Action:** Update `shared/src/schema/__tests__/declarations.test.ts` for the four-collection contract and attribute tables above (replace length-1 assertions). Add array create / array drift / array match-skip cases to `shared/src/schema/__tests__/provisioner.test.ts`. Extend `mock-client.ts` if create/list attribute recording does not yet surface `array` on live entries for drift comparison. Do **not** implement declarations or provisioner array wiring yet — tests must fail on the new assertions.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/schema` exits non-zero with assertion failures on the new collection/array expectations (not import/module errors).
- **Verify:** Run that command; confirm failures cite missing collections / missing `array: true` on create calls / missing drift on array mismatch.
- **Depends on:** none.

### Task 2: Wire `array` through the provisioner + `attributeMatches`

- **Action:** In `shared/src/schema/provisioner.ts`, pass `array: declared.array === true` (or equivalent) into `createStringAttribute`, `createDatetimeAttribute`, `createFloatAttribute`, and `createBooleanAttribute` param objects. Skip setting `xdefault` when `array` is true. Update `attributeMatches` to compare `!!declared.array` against live `array` (treat missing live `array` as `false`). Ensure live attribute typing in the listAttributes path includes optional `array?: boolean`.
- **Expected result:** New array provisioner tests pass; existing provisioner tests still pass.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/schema/__tests__/provisioner.test.ts` — all green.
- **Depends on:** Task 1.

### Task 3: Declare feeds, newsletters, and newsletter_feeds collections

- **Action:** Update `shared/src/schema/declarations.ts`: add `FEEDS_COLLECTION_ID`, `NEWSLETTERS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, `FeedStatus`, `FEED_STATUSES`, and `NewsletterDateRange` (four literals). Append the three collection objects to `COLLECTIONS` with attributes exactly as specified. Keep `health_check` first and unchanged.
- **Expected result:** All declaration tests pass; `COLLECTIONS` is the single source of truth for the Stage 03 data contract.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/schema/__tests__/declarations.test.ts` — all green. `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1 (tests exist); may run in parallel with Task 2 after Task 1, but verify after both Task 2 and Task 3.

### Task 4: Full schema suite + typecheck

- **Action:** Run the full shared schema test suite and monorepo typecheck. Fix fallout from `COLLECTIONS` growing. When updating provisioner regression tests, obey the **Critical mock constraint** in Testing approach: either (a) scope legacy health_check-era tests with a temporary `COLLECTIONS` patch to the health_check-only slice (restore in `finally`), or (b) extend `MockDatabases` so `existingAttributes` is keyed by `collectionId`. Do **not** only bump expected create counts while leaving one global attribute list shared across all collections — that produces false drift failures or false greens.
- **Expected result:** Entire schema test suite green; typecheck clean; no web/worker source changes required; no phantom cross-collection attribute drift in tests.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/schema` and `pnpm typecheck` — both succeed with zero failures/errors.
- **Depends on:** Task 2, Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test -- src/schema && pnpm typecheck`
- Expected: Declaration tests confirm four collections with the Spec attribute tables, server-only perms, exported ids/status/date-range vocabulary, and unchanged `health_check` / `DATABASE_ID`. Provisioner tests confirm array attributes are created with `array: true` and without defaults, array-flag drift is detected, and prior idempotency/drift/failure/permission/secret-free behaviors still hold. `tsc --noEmit` is clean across packages. No GUI routes, no document helpers, no worker boot changes beyond what Stage 02 already wired.

## Handoff

When complete, the builder reports to the manager:

- Files changed under `shared/src/schema/` (and tests/mock client if touched).
- Confirmation that `pnpm --filter @newsletter/shared test -- src/schema` and `pnpm typecheck` pass.
- Exact exported symbols: collection-id constants, `FeedStatus` / `FEED_STATUSES`, `NewsletterDateRange`, and the final attribute key lists per collection.
- Confirmation that `array: true` is passed on create and that array attributes never send `xdefault`.
- Confirmation that `attributeMatches` includes the `array` flag.
- Any deviation (e.g. SDK param name quirks, Appwrite rejecting a size, need to adjust mock live-attribute shape) and why.
- **Research note:** Array support required because Stage 02 summary pinned unwired `SchemaAttribute.array`; node-appwrite `Databases.createStringAttribute` accepts `array?: boolean` and rejects defaults on array attributes (`attribute_default_unsupported`). Field defaults (`newsItems: 16`, `dateRange: "yesterday"`) chosen for pipeline parity with `createNewsletterConfig` / `DateRange` — PM may override in review.

## Auto-mode decisions for PM review

These resolve Stage 03 open questions **for the schema only**; say the word and they will be edited in the spec before execute:

1. **Status labels:** `untested` | `ok` | `failed` (stage recommendation).
2. **Item count default:** `16` (pipeline), field name `newsItems`.
3. **Date-range default:** `"yesterday"`, stored as pipeline enum strings (not a raw day count).
4. **Delete-while-attached / re-test UX:** deferred to features 02–03 (not schema).
5. **Junction vs relationships:** plain `newsletter_feeds` documents with string ids (no Appwrite relationship type).
6. **Indexes / URL uniqueness:** deferred to write-path features; not provisioned here.
