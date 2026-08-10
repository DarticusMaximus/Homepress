# Feature 01: Schema-as-code provisioner

## Intent

Make the Appwrite database shape a versioned artifact in the repo instead of console-clicked state, so a fresh Appwrite project provisions itself to a working state on worker boot — and every later data-bearing stage adds its collections to the same module rather than out-of-band. Proven in this feature by one trivial proving collection (the health-check entity) that the dashboard round-trips in feature 04.

## Spec

A `shared/src/schema/` module containing two files: `declarations.ts` (pure data — the database ID/name and an array of collection declarations) and `provisioner.ts` (the function that reads the declarations and calls the node-appwrite SDK to make them real). The declarations are declarative object literals — one TS object per collection describing its ID, name, attributes (type, size, required, default), and permissions. This feature ships exactly one collection: `health_check` with two attributes — `status` (string, size 255, required) and `createdAt` (datetime, required). The database ID is `newsletter_db`, name `Newsletter Generator` (both exported as constants so later stages import them rather than hardcoding). Collections are created with server-only permissions (`read: [], write: []`) — all access goes through the server client (`getServerAppwrite()`) which bypasses collection permissions via the API key; the auth gate is the security boundary, not the collection rules.

The provisioner function `provisionDatabase(client: Client): Promise<ProvisionResult>` runs idempotently: it creates the database, then each collection, then each attribute, swallowing Appwrite's 409-conflict errors when a resource already exists. It does NOT swallow other errors. Before creating an attribute, it lists the collection's existing attributes; if an attribute with the same key exists, it compares the declared type/size against the live one — on mismatch (type drift), it logs a clear warning naming the collection, attribute, expected vs. found type, skips the attribute (does NOT attempt to alter or drop it — that would be destructive), and continues. On any non-409 error during a single collection/attribute creation (transient 500, timeout), it logs a structured error and continues to the next resource — the worker keeps booting so a single misshapen collection doesn't take down the whole process. It returns a `ProvisionResult` summarizing what was created vs. skipped vs. drifted vs. failed.

The worker calls `provisionDatabase(getServerAppwrite())` once on boot, after the existing Appwrite-init gate (which already exits the process on total unreachability), logs the result, and continues regardless of partial provisioning failures. Re-running the worker is safe and produces no errors or duplicates.

## Dependencies

- Builds on: stage-00 feature-02 (`getServerAppwrite`, `getAppwriteConfig` in `shared/src/appwrite/` — provides the server client the provisioner calls).
- Builds on: stage-00 feature-04 (Vitest test runner in `shared` — provides `pnpm --filter @newsletter/shared test`).
- Orphaned by: none — first feature in stage 02.

## Constraints

- **`APPWRITE_API_KEY` scope:** stage-00 documented only `databases.read` (needed for the `/health` handshake's `databases.list()`). This feature's provisioner performs write operations — `databases.create`, `createCollection`, and `create<Type>Attribute` (`createStringAttribute`/`createDatetimeAttribute`/`createFloatAttribute`/`createBooleanAttribute`) — all of which require `databases.write`. For a fresh-environment bring-up, the key must therefore carry **`databases.read` + `databases.write`** (sufficient to create/update databases, collections, and attributes). A key scoped to `databases.read` alone will see every create call fail with 401/403, fall into the non-409 catch path, and leave the DB silently unprovisioned. (This supersedes the stage-00 scope note; the stage-00 spec is a finalized historical record and is not edited.) Later stages that add more domain collections reuse the same provisioner and the same write scopes — no scope change is needed per stage unless a stage touches a non-database Appwrite service (e.g. storage, functions, users).
- **Schema-as-code is the binding contract for all later data-bearing stages** (stages 03, 04, 07, 08, 09). They add their collections to `declarations.ts` and restart the worker — they do NOT provision via the console or out-of-band scripts. The declaration style (object literals) and the run trigger (every worker boot, idempotent) are fixed by this feature and must not change without a deliberate re-plan.
- Database ID (`newsletter_db`) is **immutable once created** in Appwrite — do not change it after a real environment is provisioned. Export as a constant; later stages import the constant.
- The provisioner is **create-if-absent only.** It does NOT drop, rename, retype, or migrate existing resources. Drift between the declarations and the live DB is logged as a warning and surfaced to the operator; it is NOT auto-resolved. (Migrations are explicitly out of scope per the stage file.)
- Idempotent re-run: a second boot against an already-provisioned project must complete without errors, without creating duplicates, and without altering existing resources.
- `read: [], write: []` permissions on all collections in this stage — server-only access. Do not introduce `role:users` or any per-user permission dimension in this feature.
- The provisioner must never log secrets. It logs resource IDs, names, and status (created/skipped/drift/failed) — never the API key or session secret.
- No domain collections (newsletters, feeds, runs, prompts, schedules, deliveries) in this feature — only the one proving collection (`health_check`). Later stages add their own.
- No GUI, no web app changes — the dashboard that consumes the health-check collection is feature 04. This feature only shapes the DB; nothing reads or writes the collection yet except the provisioner's own idempotency checks.

## Acceptance criteria

- [ ] `shared/src/schema/declarations.ts` exports `DATABASE_ID` (`"newsletter_db"`), `DATABASE_NAME` (`"Newsletter Generator"`), a `COLLECTIONS` array with one `health_check` collection declaration (two attributes: `status` string size 255 required, `createdAt` datetime required, `read: [], write: []`), and the `SchemaCollection` / `SchemaAttribute` / `AttributeType` types.
- [ ] `shared/src/schema/provisioner.ts` exports `provisionDatabase(client)` and the `ProvisionResult` / `CollectionResult` types.
- [ ] `provisionDatabase` creates the database, then the `health_check` collection, then each attribute, idempotently — a second call against the already-provisioned project completes without errors and without duplicates.
- [ ] On attribute type/size drift (declared `status` string 255, live `status` number), the provisioner logs a warning naming the collection, attribute, expected and found type/size, skips the attribute, and continues — does NOT throw, does NOT alter the live attribute.
- [ ] On a non-409 error during a single resource creation (simulated 500), the provisioner logs a structured error and continues to the next resource; the returned `ProvisionResult` records the failure.
- [ ] The worker calls `provisionDatabase(getServerAppwrite())` on boot after the existing Appwrite-init gate, logs the result summary (created/skipped/drift/failed counts), and continues booting regardless of partial failures.
- [ ] `pnpm --filter @newsletter/shared test` passes — all declaration + provisioner unit tests green.
- [ ] `pnpm typecheck` passes with zero errors across `shared` and `worker` under strict mode.
- [ ] No secrets are logged by the provisioner (no API key, no session secret in any log line or returned result).
- [ ] A later stage's developer can add a new collection by appending a declaration object to `COLLECTIONS` in `declarations.ts` and restarting the worker — no other steps required.

## Files

- Create: `shared/src/schema/declarations.ts`
- Create: `shared/src/schema/provisioner.ts`
- Create: `shared/src/schema/index.ts` (re-exports `declarations` + `provisioner`)
- Modify: `shared/src/index.ts` (re-export `./schema`)
- Create: `shared/src/schema/__tests__/declarations.test.ts`
- Create: `shared/src/schema/__tests__/provisioner.test.ts`
- Modify: `worker/src/index.ts` (call `provisionDatabase(getServerAppwrite())` after the Appwrite-init gate, log result, continue booting)

## Testing approach

Test-first. Unit tests exist and fail before implementation, verifying behavior described in the Intent — idempotent provisioning, drift detection, partial-failure resilience — against a mock SDK client. No live Appwrite round-trip in unit tests; the live end-to-end proof (provisioning actually shapes a real project) is deferred to feature 04's dashboard health-card, which round-trips a document through the provisioned collection.

The mock SDK client is a test double recording its calls and returning canned responses: 201/Created on first create, 409/Conflict on second create (already exists), and configurable per-call overrides to simulate drift (listAttributes returns a mismatched type) and transient failures (a 500 on one attribute). It does NOT require a real Appwrite instance.

`shared/src/schema/__tests__/declarations.test.ts`:
- `DATABASE_ID` equals `"newsletter_db"`; `DATABASE_NAME` equals `"Newsletter Generator"`.
- `COLLECTIONS` is an array of length 1; the first entry has `id: "health_check"`, a human-readable `name`, `permissions: { read: [], write: [] }`, and an `attributes` array of length 2.
- The `status` attribute: `type: "string"`, `size: 255`, `required: true`.
- The `createdAt` attribute: `type: "datetime"`, `required: true`.
- No extra collections or attributes in this feature's declarations (guards against a later stage accidentally bundling collections into this feature).
- Compile-time: `COLLECTIONS` is assignable to `SchemaCollection[]`; each attribute is assignable to `SchemaAttribute` (type-level test via `const _check: SchemaCollection[] = COLLECTIONS;`).

`shared/src/schema/__tests__/provisioner.test.ts`:
- **Fresh provision:** mock returns 404/empty on list calls and 201 on creates → `provisionDatabase` calls `databases.create` (database), `databases.createCollection` (collection, with `permissions: { read: [], write: [] }`), `databases.createStringAttribute` (status, size 255, required true), `databases.createDatetimeAttribute` (createdAt, required true), in that order. `ProvisionResult` reports 1 database created, 1 collection created, 2 attributes created, 0 skipped, 0 drift, 0 failed.
- **Idempotent re-run:** mock returns the existing database/collection/attributes on list calls → `provisionDatabase` does NOT call any create method; `ProvisionResult` reports all-skipped, 0 created, 0 drift, 0 failed. No errors thrown.
- **409 race on create:** mock returns "not found" on list, then 409 on the actual create (race between list and create) → provisioner swallows the 409, does NOT retry, logs nothing alarming, result reports the resource as skipped. (This is the list-then-create race; the 409 is the SDK's signal that another process won.)
- **Type drift:** mock `listAttributes` returns `status` as `{ key: "status", type: "integer", size: 0 }` (declared string 255) → provisioner logs a warning matching `/drift/i` or `/status.*string.*integer/i`, skips the attribute (no create call), does NOT throw. `ProvisionResult` reports `drift: 1`. Other attributes provision normally.
- **Size drift:** mock returns `status` as `{ key: "status", type: "string", size: 100 }` (declared 255) → same warning + skip behavior; `drift: 1`.
- **Transient failure on one attribute:** mock `createDatetimeAttribute` throws a non-409 error (e.g. a fake 500) → provisioner logs a structured error, continues to the next resource (none left in this collection, but the flow doesn't abort), `ProvisionResult` reports `failed: 1`. Other resources still provisioned.
- **Permissions passed correctly:** the `createCollection` mock call's `permissions` argument equals `{ read: [], write: [] }` (or the SDK-shaped equivalent — assert empty arrays, no `role:users`).
- **Result shape:** `ProvisionResult` has `databases: { created, skipped, failed }`, `collections: { created, skipped, failed, drift }`, `attributes: { created, skipped, failed, drift }`, and an optional `warnings: string[]` carrying drift messages. (Exact shape is the builder's choice but must carry these counts so the worker boot log is informative.)
- **No secrets logged:** the provisioner's returned `ProvisionResult` and any captured log output contain no API key value and no session secret.

Edge cases covered: list-then-create race (409 on create after list said absent), type drift, size drift, transient non-409 failure isolation, permission flags, result-shape completeness, secret-free output.

## Tasks

### Task 1: Write failing schema tests

- **Action:** Create `shared/src/schema/__tests__/declarations.test.ts` and `shared/src/schema/__tests__/provisioner.test.ts` with all the cases listed in the Testing approach. The tests import from `../declarations` and `../provisioner` (which do not exist yet). Create empty placeholder `shared/src/schema/declarations.ts` and `shared/src/schema/provisioner.ts` exporting nothing (or minimal stubs) so the test files' imports resolve at the module level but every assertion fails. Build the mock SDK client as a reusable helper inside `__tests__/` (a class or factory recording calls in arrays, with per-call configurable responses).
- **Expected result:** A test suite that compiles far enough to run and fails on every behavioral assertion, proving the contract is captured before any implementation.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- src/schema` — exits non-zero with assertion failures (not module-resolution errors). Confirm both test files exist and the mock helper is defined.
- **Depends on:** none.

### Task 2: Implement schema declarations

- **Action:** Implement `shared/src/schema/declarations.ts`: export `AttributeType` (`"string" | "datetime" | ...` — include the types this feature uses plus `number`, `boolean` as forward-compat for later stages, but do not over-engineer), `SchemaAttribute` (`key`, `type`, `size?`, `required`, `default?`, `array?`), `SchemaCollection` (`id`, `name`, `permissions: { read: string[]; write: string[] }`, `attributes: SchemaAttribute[]`), `DATABASE_ID` (`"newsletter_db"`), `DATABASE_NAME` (`"Newsletter Generator"`), and `COLLECTIONS: SchemaCollection[]` with the one `health_check` collection (two attributes as specified, `read: [], write: []`).
- **Expected result:** All declaration tests pass; the schema shape is fixed and exported.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- src/schema/__tests__/declarations.test.ts` — all declaration tests green. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Implement provisioner function

- **Action:** Implement `shared/src/schema/provisioner.ts`: export `ProvisionResult` and `CollectionResult` types, and `provisionDatabase(client: Client): Promise<ProvisionResult>`. Implementation: instantiate `new Databases(client)`; create the database (`databases.create({ databaseId: DATABASE_ID, name: DATABASE_NAME })`) catching `AppwriteException` with code 409 (already exists); for each collection in `COLLECTIONS`, create it (`databases.createCollection({ databaseId, collectionId: c.id, name: c.name, permissions: c.permissions.read.concat(c.permissions.write).length ? c.permissions.read : [] })` — pass empty `permissions: []` for server-only; the exact SDK shape is the builder's call, but the result must be no `role:users`); then list existing attributes (`databases.listAttributes({ databaseId, collectionId: c.id })`); for each declared attribute, if it exists, compare type (and size for string) — on mismatch log a warning and record drift; if it doesn't exist, call the matching `create<Type>Attribute` method (`createStringAttribute` for string with `size`, `createDatetimeAttribute` for datetime), catching 409 as a race skip and non-409 as a logged failure that continues. Return the aggregated `ProvisionResult` with created/skipped/failed/drift counts per resource kind and a `warnings` array of drift messages. Never log or return secrets.
- **Expected result:** All provisioner tests pass (fresh provision, idempotent re-run, 409 race, type drift, size drift, transient failure, permissions, result shape, no secrets).
- **Verify:** Run `pnpm --filter @newsletter/shared test -- src/schema/__tests__/provisioner.test.ts` — all provisioner tests green. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 2.

### Task 4: Wire schema exports + worker boot call

- **Action:** Create `shared/src/schema/index.ts` re-exporting `./declarations` and `./provisioner`. Modify `shared/src/index.ts` to re-export `./schema`. Modify `worker/src/index.ts` to import `provisionDatabase` and `getServerAppwrite` (the latter already imported), and after the existing `getServerAppwrite()` init gate (the `try` block around line 78-85 that logs "appwrite server-client initialized"), call `const provisionResult = await provisionDatabase(getServerAppwrite());` and log a one-line summary (e.g. `schema provisioned: db=created/skipped collections=created/skipped attributes=created/skipped drift=N failed=N`). Wrap the call so any thrown error is logged and boot continues (do NOT exit on partial provisioning failure — that's the spec). The worker's existing heartbeat and shutdown handlers remain unchanged.
- **Expected result:** The full schema module is reachable from `@newsletter/shared`, and the worker provisions the DB on boot, logging the result.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — all schema tests green (and no other shared tests regressed). Run `pnpm typecheck` — zero errors across `shared`, `web`, and `worker`. Confirm `worker/src/index.ts` imports `provisionDatabase` from `@newsletter/shared` and calls it after the Appwrite-init gate.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves cleanly; the full Vitest suite in `shared` passes — declaration tests confirm the schema shape (one database, one `health_check` collection, two attributes, server-only perms); provisioner tests confirm fresh provision calls the right SDK methods in order, idempotent re-run creates nothing and throws nothing, 409 races are swallowed, type and size drift log warnings and skip without throwing, transient 500s are isolated and don't abort the run, permissions are server-only, results carry the required counts, and no secrets appear in output. `tsc --noEmit` passes with zero errors across all three packages. `worker/src/index.ts` calls `provisionDatabase(getServerAppwrite())` on boot after the existing Appwrite-init gate and logs the summary, continuing on partial failure. No GUI, no domain collections, no web app changes — only the schema module and the worker boot wiring.

## Handoff

When complete, the builder reports to the manager:
- The list of files created/modified (`shared/src/schema/{declarations,provisioner,index}.ts`, `shared/src/schema/__tests__/{declarations,provisioner}.test.ts`, `shared/src/index.ts`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass.
- The exact exported symbol names (`DATABASE_ID`, `DATABASE_NAME`, `COLLECTIONS`, `SchemaCollection`, `SchemaAttribute`, `AttributeType`, `provisionDatabase`, `ProvisionResult`, `CollectionResult`) so later stages import them consistently.
- The exact `ProvisionResult` shape (the counts and warning fields) so the worker boot log line and any future consumer knows what to read.
- The exact SDK method call sequence the provisioner makes (database → collection → attributes, list-before-create, 409-swallowing, drift-warning path) so a later stage adding a collection can trust the pattern.
- Confirmation that the 409-detection path distinguishes "already exists" (swallow) from other errors (log + continue), and that drift detection compares both type and size.
- Any deviation from this spec and the reason (e.g. an SDK method signature that differs from the spec's pseudocode, an Appwrite version difference in the 409 error shape, a `Permissions`/`Roles` import quirk).