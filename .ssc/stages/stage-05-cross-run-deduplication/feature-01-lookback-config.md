# Feature 01: Lookback config

## Intent

Let the operator set how many recent completed issues a newsletter suppresses against (including off), so Stage 05’s cross-run dedup can honor a per-newsletter lookback window without code changes.

## Spec

Add a per-newsletter **`lookback`** field: the count of that newsletter’s most recent **completed** runs used for cross-run topic suppression. This feature owns schema, persistence, validation, and the newsletter definition form control only. It does **not** load prior topics or suppress candidates (features 02–03).

### Field contract

| Rule | Value |
|------|--------|
| Attribute / FormData key | `lookback` |
| Default | `3` |
| Bounds | integer **0..10** inclusive |
| `0` | disables cross-run suppression for that newsletter (consumers in features 02–03 treat as no-op) |
| Semantics | Count of recent **completed** issues (same newsletter), not calendar days and not Stage 03’s fetch `dateRange` |
| UI | Create/edit dialog number input — **not** a list/table column |

### Schema

Append to the `newsletters` collection in `shared/src/schema/declarations.ts`:

```ts
{ key: "lookback", type: "number", required: false, default: 3 }
```

Same Appwrite `number` (float) attribute style as `newsItems`. Create-if-absent only via the existing provisioner — no drop, rename, retype, or migration scripts.

Export constants from `declarations.ts` (alongside retention-style constants):

- `DEFAULT_LOOKBACK = 3`
- `LOOKBACK_MIN = 0`
- `LOOKBACK_MAX = 10`

Declaration tests must assert the attribute shape and the three constants.

**Existing documents:** Appwrite attribute defaults do not reliably backfill already-stored documents (Context7 / Appwrite update-attribute docs: changing default does not rewrite existing docs). `documentToNewsletter` **must** coerce missing / `null` / `undefined` `lookback` to `DEFAULT_LOOKBACK` (`3`) on read so pre-attribute newsletters behave as default-on without a data migration.

**Lookback vs protected floor:** Stage 04’s `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER = 3` is a retention floor, not a lookback cap. `LOOKBACK_MAX` may exceed 3; feature 02 loads whatever completed runs exist within N. Do **not** raise the protected floor in this feature.

### Write path

Extend `shared/src/newsletters/`:

- `Newsletter`, `CreateNewsletterInput`, `UpdateNewsletterInput`, `NewsletterFields` — add `lookback: number` (optional on create input; required on update / fields after resolve).
- `validateLookback(value: number): number` — finite integer in `LOOKBACK_MIN..LOOKBACK_MAX`; reject otherwise with `NewsletterRepositoryError` `code: "validation"` and a stable message (e.g. `"Lookback must be an integer between 0 and 10"`).
- `resolveCreateFields`: omitted / blank → `DEFAULT_LOOKBACK`, then validate.
- `resolveUpdateFields`: validate submitted `lookback` (no silent default on update — form always submits the field).
- `createNewsletter` / `updateNewsletter`: always include `lookback` in the Appwrite `data` payload.

### Form + server actions

In `web/components/newsletters/newsletter-form-dialog.tsx`:

- Number `Input` (`type="number"`, `name="lookback"`, `min={0}`, `max={10}`, **`required`** — same as `newsItems`).
- Create: `defaultValue` / prefill `String(DEFAULT_LOOKBACK)` (`3`).
- Edit: `defaultValue` from `newsletter.lookback`.
- Helper text (operator-facing): explain that this is how many recent completed issues to suppress similar topics against, and that `0` turns cross-run suppression off.
- Update DialogDescription only if needed so “lookback” is mentioned among definition fields — keep tone consistent with existing copy.

In `web/app/(protected)/newsletters/actions.ts`:

- Parse FormData `lookback` via the same `parseOptionalInt` pattern as `newsItems`.
- Create: pass through (repository applies default when omitted).
- Update: **do not** copy `newsItems ?? 0` — `0` is a **valid** lookback (off). Pass `lookback: lookback ?? -1` (or any integer outside `0..10`) so a missing/blank field fails `validateLookback` instead of silently disabling suppression. `UpdateNewsletterInput.lookback` remains a required `number`; the form `required` attribute is the primary guard, the `-1` sentinel is defense in depth.

### Out of scope

- Loading `topicSummary` from prior runs (feature 02).
- Pre-MMR semantic suppress / embeddings (feature 03).
- Suppress visibility on run summary (feature 04).
- Similarity threshold `.env` (feature 05).
- Wiring `lookback` into `NewsletterConfig` / `createNewsletterConfig` / `execute-run` (later features).
- Raising Stage 04 retention protected floor.
- List / card column for lookback.
- GUI for similarity threshold.

## Dependencies

- Builds on: Stage 03 newsletter schema (`NEWSLETTERS_COLLECTION_ID`, provisioner), newsletter repository / validation / form / actions (`shared/src/newsletters/`, `newsletter-form-dialog.tsx`, `newsletters/actions.ts`).
- Builds on: Stage 04 complete (protected completed-run floor exists for later stage features; this feature does not call run APIs).
- Orphaned by: none — first feature in Stage 05.
- Soft: features 02–05 consume this field; they are not required to verify this feature.

## Constraints

- **Schema-as-code only.** Append attribute in `declarations.ts`; do not provision via console or one-off scripts.
- **Create-if-absent only.** No drop / rename / retype / migrate. Drift → warn + skip (existing provisioner contract).
- **Do not change** `DATABASE_ID`, `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER`, retention purge behavior, or run checkpoint schema.
- **Do not implement** topic load, suppress, threshold env, or run-summary suppress UI.
- **Do not add** `lookback` to pipeline `NewsletterConfig` in this feature.
- **Server-only DB access** via API key client; no browser Appwrite SDK for document writes.
- **Secrets:** never log API keys, session secrets, or full env dumps.
- **Reuse** existing form/action patterns (`newsItems`-style number field); no `react-hook-form` / `zod`.

## Acceptance criteria

- [ ] New newsletters default `lookback` to `3`; create form prefills `3`.
- [ ] Operator can set any integer in `0..10` inclusive (including `0` = off); value persists and reloads after a full page reload.
- [ ] Out-of-range or non-integer `lookback` is rejected with a validation error and no write.
- [ ] Newsletters that predate the attribute read as `lookback: 3` after the provisioner adds the attribute (read-path coerce).
- [ ] `lookback` is declared on `newsletters` with `required: false`, `default: 3`; provisioner creates it idempotently on worker boot.
- [ ] No pipeline / suppress / topic-load / threshold / run-summary behavior changes in this feature.
- [ ] `pnpm --filter @newsletter/shared test` (newsletters + schema), `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` pass.
- [ ] **PM manual gate:** create (default 3) → edit to `0` → reload → edit to `5` → reload; invalid value → error toast, no write.

## Files

- Modify: `shared/src/schema/declarations.ts` (attribute + `DEFAULT_LOOKBACK` / `LOOKBACK_MIN` / `LOOKBACK_MAX`)
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/newsletters/types.ts`
- Modify: `shared/src/newsletters/validation.ts` (`validateLookback`, create/update resolve)
- Modify: `shared/src/newsletters/repository.ts` (write + `documentToNewsletter` coerce)
- Modify: `shared/src/newsletters/__tests__/validation.test.ts`
- Modify: `shared/src/newsletters/__tests__/repository.test.ts`
- Modify: `web/app/(protected)/newsletters/actions.ts`
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx`
- Modify: `product_spec.md` (one-line Implemented features entry at handoff)

## Testing approach

**Test-first for shared validation and repository.** GUI verified by build/typecheck/lint plus a PM manual gate.

### `validation.test.ts`

- Accepts integers `0` through `10`.
- Create path: omitted `lookback` → `DEFAULT_LOOKBACK` (`3`).
- Rejects `-1`, `11`, `1.5`, `NaN`, `Infinity`, non-finite values with `code: "validation"`.

### `repository.test.ts` (mock `Databases`)

- **create:** writes `lookback: 3` when omitted; writes explicit values including `0`.
- **update:** writes submitted `lookback`; bumps `updatedAt`.
- **list/get:** mapped records include `lookback`.
- **read coerce:** document missing `lookback` (or `null`/`undefined`) maps to `3`.
- Existing create/update/list/delete behaviors still pass (regression).

### `declarations.test.ts`

- Newsletters attributes include `lookback` with `type: "number"`, `required: false`, `default: 3`.
- Exports `DEFAULT_LOOKBACK === 3`, `LOOKBACK_MIN === 0`, `LOOKBACK_MAX === 10`.

### Web automated

- `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, full `pnpm test` green.
- No Playwright in this feature.

### PM manual gate

1. Worker has provisioned the new attribute (restart/boot if needed).
2. Create newsletter → lookback shows `3` → save → reload edit → still `3`.
3. Set lookback to `0` → save → reload → `0`.
4. Set lookback to `5` → save → reload → `5`.
5. Set lookback to `11` or a non-integer → error toast; value not persisted.
6. Confirm list still works; no new Lookback column required.

## Tasks

### Task 1: Failing validation + repository tests for lookback

- **Action:** Extend `shared/src/newsletters/__tests__/validation.test.ts` and `repository.test.ts` with the lookback cases in Testing approach (including read coerce and create default). Do **not** implement production lookback yet — tests must fail on missing field / assertions.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/newsletters` exits non-zero on missing lookback behavior (not harness misconfig).
- **Verify:** Run that command; failures cite missing `lookback` / unimplemented validation.
- **Depends on:** none.

### Task 2: Schema attribute + constants

- **Action:** Add `lookback` to newsletters attributes in `shared/src/schema/declarations.ts`; export `DEFAULT_LOOKBACK`, `LOOKBACK_MIN`, `LOOKBACK_MAX`. Update `shared/src/schema/__tests__/declarations.test.ts`.
- **Expected result:** Declaration tests green; attribute shape matches Spec.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/schema` — green for declarations.
- **Depends on:** none (can parallel Task 1 in practice; execute after or before Task 3).

### Task 3: Implement validation, types, repository + wire form/actions

- **Action:** Implement `validateLookback` and wire create/update resolve; extend types; write `lookback` in repository create/update; coerce on read. Import bounds/default from declarations (or re-export via newsletters module — prefer importing constants from `@newsletter/shared` / declarations to avoid drift). Update `newsletter-form-dialog.tsx` with the number field (`required`, `min={0}`, `max={10}`, helper text, create prefill 3). Update `actions.ts`: create passes through; update uses `lookback: lookback ?? -1` — **never** `?? 0`.
- **Expected result:** Newsletters unit tests green; form submits `lookback` with `required`; create prefills 3; edit shows stored value; missing update value rejects via sentinel.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/newsletters` green; `pnpm --filter @newsletter/shared exec tsc --noEmit` zero errors; `pnpm --filter web build` + `pnpm typecheck` + `pnpm lint` zero. Code review: Input has `required`; update action uses `?? -1` (not `?? 0`).
- **Depends on:** Task 1, Task 2.

### Task 4: Regression + product_spec note

- **Action:** Run full `pnpm test`, fix fallout. Update `product_spec.md` Implemented features with one line for Stage 05 feature 01 lookback config. Diff-check: no pipeline suppress, no retention floor change, no list column unless accidentally added (remove if so).
- **Expected result:** Full suite green; product_spec reflects the field.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero.
- **Depends on:** Task 3.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/newsletters src/schema && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: Lookback validation/repository/declaration tests pass (default 3, bounds 0..10, read coerce, create/update write). Full suite green. Web build includes form field `lookback`. No suppress/topic-load/threshold code introduced.

### Stage B — PM manual gate

- With worker provisioned, log in → Newsletters → create / edit / reload persistence for `3`, `0`, `5` and validation reject as in Testing approach.

## Handoff

When complete, the builder reports to the manager:

- Files modified under `shared/src/schema/`, `shared/src/newsletters/`, and `web/.../newsletters/`.
- Confirmation of test/build/typecheck/lint commands and results.
- Confirmation of locked decisions below as implemented (or deviations + why).
- Confirmation that `documentToNewsletter` coerces missing lookback → `3`.
- Confirmation that the lookback Input is `required` and update uses `lookback ?? -1` (not `?? 0`).
- Confirmation that retention floor and pipeline were untouched.
- **Research note:** Pattern mirrors Stage 03 `newsItems` (Appwrite `number` + integer validation). Stage open question (lookback min/max) pinned to `0..10` / default `3`. Appwrite docs: optional attribute `default` allowed when not required; existing documents are not rewritten by default changes — read-path coerce required. Protected-3 floor is retention, not a lookback max (Plan.md / stage-04 SUMMARY pin).

## Locked decisions (PM confirmed 2026-07-13)

1. **Attribute / FormData key:** `lookback`.
2. **Default:** `3`.
3. **Bounds:** integer `0..10` inclusive; `0` = off.
4. **UI:** form field only — no list/card column.
5. **Max may exceed** `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` (3); feature 02 loads what exists.
6. **No pipeline / suppress wiring** in this feature.
7. **Read coerce** missing/null/undefined → `3`.
8. **Constants** exported from `declarations.ts`: `DEFAULT_LOOKBACK`, `LOOKBACK_MIN`, `LOOKBACK_MAX`.
9. **Form Input `required`** on lookback (match `newsItems`).
10. **Update missing sentinel:** `lookback ?? -1` (outside `0..10`) — never `?? 0`, because `0` is valid (off).
