# Feature 06: Remediation — stage-02 cross-feature regression (attribute-type contract + API-key scope doc)

## Intent

Fix the stage-02 Acceptance criterion "A later stage's developer (or the PM) can add a new collection by adding a declaration to the schema module and restarting the worker; no other steps required" that fails after cross-feature verification: the schema module's own `AttributeType` union advertises `number`/`boolean` (and a `default?` field) that the provisioner cannot create, and the documented Appwrite API-key scope was not updated for the write operations stage-02 introduced.

## Dependencies

- Builds on / hardens code from:
  - `feature-01-schema-provisioner` (`shared/src/schema/declarations.ts` — `AttributeType`, `SchemaAttribute`; `shared/src/schema/provisioner.ts` — attribute create switch)
  - `feature-05-hardening-review-20260701` (the prior hardening pass; this feature extends the same files)
- Stage-00 carry-over: `.ssc/stages/stage-00-scaffolding/feature-02-appwrite-connection.md:17,88` documents the API-key scope as `databases.read` only — now stale.

## Constraints

- **Do not modify** the `health_check` collection declaration, its attributes, its `read: []/write: []` permissions, or any existing provisioned state. The proving artifact must keep round-tripping unchanged.
- **Do not modify** the provisioner's create-if-absent / 409-swallow / drift-skip semantics established by feature-01 and feature-05 (C1). This feature only extends the attribute-create switch and wires the `default` field.
- **Do not change** the documented `AttributeType` set in a way that silently breaks a later stage. The chosen direction (extend the provisioner to honor the full declared union, including `default`) must leave `AttributeType = "string" | "datetime" | "number" | "boolean"` intact so forward-compat is real, not advertised-only.
- **No new collections, no new routes, no new nav items, no new runtime dependencies.** Test-only deps are not runtime deps.
- Preserve the no-secrets rule.
- All stage-02 Acceptance criteria must still hold after this remediation (re-verified in Feature verification).

## Spec

Three findings, grouped by concern. Evidence is from the stage-02 cross-feature regression pass (ssc-finalize, 2026-07-01).

### R1 — `AttributeType` advertises types the provisioner cannot create
`shared/src/schema/declarations.ts:7` declares `AttributeType = "string" | "datetime" | "number" | "boolean"`. `shared/src/schema/provisioner.ts:199-225` handles only `"string"` (`createStringAttribute`) and `"datetime"` (`createDatetimeAttribute`); the `else` branch logs `"Unsupported attribute type in declaration"` and counts the attribute as `failed`. A later stage declaring `{ type: "number" }` or `{ type: "boolean" }` would silently fail to provision on every boot (the worker keeps running; the failure is buried in the `attributes.failed` count and a console error). This directly contradicts criterion 6's "no other steps required."

**Correct behavior:** every member of `AttributeType` is honored by the provisioner — `number` → `createFloatAttribute`, `boolean` → `createBooleanAttribute` (node-appwrite v26 object-parameter shape). The drift-detection `attributeMatches` path must also handle the new types sensibly (a number/boolean attribute has no `size`, so it must not be flagged as drift for lacking one).

### R2 — `default?` field is declared but never passed to the SDK
`shared/src/schema/declarations.ts:14` declares `SchemaAttribute.default?: string | number | boolean`. The provisioner's create calls (`provisioner.ts:201-214`) never pass `xdefault`, so any later stage setting a default silently loses it. (The SDK reserves `default` as a JS keyword and accepts it as `xdefault`.)

**Correct behavior:** when a declaration sets `default`, the provisioner passes it as `xdefault` to the matching `create<Type>Attribute` call. When `default` is absent, `xdefault` is omitted (Appwrite treats it as no default).

### R3 — Appwrite API-key scope doc drift (write operations added, scope not updated)
Stage-00 documented the required `APPWRITE_API_KEY` scope as `databases.read` only (`.ssc/stages/stage-00-scaffolding/feature-02-appwrite-connection.md:17,88`). Stage-02's provisioner performs `databases.create`, `createCollection`, `createStringAttribute`/`createDatetimeAttribute` (and after R1, `createFloatAttribute`/`createBooleanAttribute`) — all requiring write scopes. The PM's actual key has these (the health card works), but the documented scope is stale, so a fresh-environment bring-up following the documented scope would see every create call 401/403, fall into the non-409 catch, and leave the DB silently unprovisioned.

**Correct behavior:** the documented API-key scope reflects the write operations stage-02 introduced. The natural home is the feature that introduced them: a Setup/Constraints note in `feature-01-schema-provisioner.md` stating the key must carry `databases.read`, `databases.write` (covers create DB/collection/attribute), and is updated as later stages add more operations. (Appwrite key scopes are documented at the Appwrite console; the exact scope label set is the Appwrite-current one for database+collection+attribute writes.)

## Tasks

### Task 1: Extend the provisioner to handle all declared attribute types + wire `default` (R1 + R2)

- **Action:** In `shared/src/schema/provisioner.ts`:
  - Extend the attribute-create switch (`:199-225`) to handle `"number"` via `databases.createFloatAttribute({ databaseId, collectionId, key, required, min?, max?, default?, xdefault? })` and `"boolean"` via `databases.createBooleanAttribute({ databaseId, collectionId, key, required, default?, xdefault? })`. Use the node-appwrite v26 object-parameter shape. Remove the `else` "Unsupported attribute type" branch (it should now be unreachable; if a truly unknown type sneaks through, a TypeScript exhaustiveness check or a runtime `default: assertNever` is preferable to a silent `failed` count).
  - Wire `default`: in every `create<Type>Attribute` call (string, datetime, number, boolean), pass `xdefault: declared.default` when `declared.default !== undefined`, and omit `xdefault` otherwise. (`xdefault` is the SDK's reserved-keyword-safe name for the column default.)
  - In `attributeMatches`: ensure number/boolean attributes are compared by type only (they have no `size`); a missing `size` on a non-string attribute must not be reported as drift. (The C1 fix from feature-05 tightened only the string branch; confirm number/boolean don't trip it.)
- **Expected result:** Declaring `{ type: "number", required: true }` or `{ type: "boolean", required: true, default: false }` provisions successfully; declaring a `default` on any type is applied. The "Unsupported attribute type" path is gone.
- **Verify:** `pnpm --filter @newsletter/shared test` — add provisioner tests: (a) a string attribute with `default` asserts `xdefault` is passed to `createStringAttribute`; (b) a `number` attribute asserts a `createFloatAttribute` call with the right params; (c) a `boolean` attribute with `default: false` asserts `createBooleanAttribute` received `xdefault: false`; (d) `attributeMatches` returns `true` for a number/boolean attribute pair where sizes are absent on both sides (no false drift). Extend the drift case if needed so a type mismatch (declared number, live string) is still caught. `pnpm typecheck`, `pnpm lint` exit zero.
- **Depends on:** none.

### Task 2: Update the documented API-key scope (R3)

- **Action:** In `.ssc/stages/stage-02-app-foundation/feature-01-schema-provisioner.md`, add a Setup/Constraints note (or extend the existing Constraints section) stating that the Appwrite API key (`APPWRITE_API_KEY`) must carry scopes sufficient for provisioning: `databases.read` + `databases.write` (database, collection, and attribute create/update), in addition to the `databases.read` required by stage-00's `/health` handshake. Note that later stages adding more domain collections reuse the same provisioner and the same write scopes — no scope change needed per stage unless a stage touches a non-database Appwrite service. Do not edit the stage-00 spec (it is a finalized historical record); record the superseding scope here.
- **Expected result:** The required API-key scope for a fresh-environment bring-up is documented in the stage-02 feature that introduced write operations, so a PM following the docs provisions a key with the right scope the first time.
- **Verify:** Grep `.ssc/stages/stage-02-app-foundation/feature-01-schema-provisioner.md` for a scope note mentioning `databases.write`. No source code changes (doc-only task). `pnpm typecheck`, `pnpm lint` unaffected.
- **Depends on:** none.

### Task 3: Full regression

- **Action:** Run the full verification chain. Inspect the diff to ensure no files outside the task scopes were changed and no new collections/routes/nav items/deps were introduced.
- **Expected result:** R1, R2, R3 addressed; all stage-02 ACs still hold; criterion 6 now passes for all advertised `AttributeType` members.
- **Verify:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build && pnpm --filter @newsletter/worker build` — all exit zero. Re-confirm stage-02 Acceptance criteria, specifically criterion 6: the schema module's `AttributeType` union is fully honored by the provisioner, so a later stage can declare any supported type without editing provisioner code. Confirm `worker/dist/index.js` still boots and provisions the `health_check` collection unchanged.
- **Depends on:** Tasks 1–2.

## Feature verification

- Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build && pnpm --filter @newsletter/worker build`
- Expected: every command exits zero. `pnpm test` includes the new provisioner cases (number/boolean/default/xdefault, attributeMatches number/boolean no false drift) and all prior tests. No behavior regressions: the `health_check` collection still provisions idempotently; the dashboard health card still round-trips; the six nav routes, auth gate, sidebar brand, and login paths are unchanged.
- Stage-02 Acceptance criterion 6 re-checked end-to-end: declaring a `number` or `boolean` attribute and restarting the worker provisions it with no code changes outside `declarations.ts`. The documented API-key scope now covers write operations.
- PM manual re-check recommended: (a) confirm a `number`/`boolean` declaration would provision (can be verified by reading the new test, or by a live declaration on a throwaway collection if the PM prefers); (b) confirm a fresh-env key with the documented scope succeeds at provisioning.

## Handoff

- Regression evidence: ssc-finalize cross-feature regression pass, 2026-07-01 (Cluster A verifier report — criterion 6 latent gap; Cluster B verifier report — criteria 3/4/5 verified).
- Files expected to change:
  - `shared/src/schema/provisioner.ts` (R1 — number/boolean create paths; R2 — `xdefault` wiring; exhaustiveness)
  - `shared/src/schema/__tests__/provisioner.test.ts` (R1/R2 — new cases for number, boolean, default/xdefault, attributeMatches number/boolean)
  - `shared/src/schema/__tests__/mock-client.ts` (R1/R2 — add `createFloatAttribute`/`createBooleanAttribute` recording + `xdefault` capture if not already present)
  - `.ssc/stages/stage-02-app-foundation/feature-01-schema-provisioner.md` (R3 — doc-only scope note)
- Confirmation that `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter web build`, `pnpm --filter @newsletter/worker build` all pass.
- Confirmation that no schema declarations for `health_check`, no provisioner create-if-absent semantics, and no user-visible behavior were changed.
- After this feature verifies, re-run `ssc-finalize` on stage-02 to close it.
