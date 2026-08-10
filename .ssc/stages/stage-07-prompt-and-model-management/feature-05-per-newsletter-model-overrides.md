# Feature 05: Per-newsletter model overrides

## Intent

Let the operator set optional per-role OpenRouter model IDs on a newsletter definition so one newsletter can use different models than the globals (e.g. when a provider censors inputs) while blank fields keep that newsletter on the shared defaults.

## Spec

Add four optional model-override attributes on the `newsletters` collection and surface them on the existing create/edit newsletter dialog. Blank (after trim) means “no override” — Feature 06 will resolve that role via global → env → built-in. This feature owns **schema**, **newsletter types/validation/repository**, **form + actions wiring**, and **persisted blank-vs-set semantics**. It does **not** resolve models at run start or change `getModelName`.

### Precedence reminder (PM-pinned — Feature 06 implements)

At run start, each role’s effective model is:

1. **Newsletter override** for that role, if non-empty (this feature persists it)
2. Else **global GUI default** (Feature 04)
3. Else **env var** (`TAGGER_MODEL` / `SCORER_MODEL` / `DRAFTER_MODEL` / `EMBED_MODEL`)
4. Else **built-in** `DEFAULT_MODELS[role]`

This feature only stores step-1 values. Empty override must remain `""` in the DB — do **not** copy the current global or env into the newsletter document on save or create.

### Attribute keys & roles (pinned — match Feature 04)

| Role (`ModelComponent`) | Newsletter attribute | Form `name` |
|-------------------------|----------------------|-------------|
| `tagger` | `taggerModel` | `taggerModel` |
| `scorer` | `scorerModel` | `scorerModel` |
| `drafter` | `drafterModel` | `drafterModel` |
| `embedder` | `embedderModel` | `embedderModel` |

Same free-text OpenRouter model ID rules as Feature 04 (see Validation). Reuse Feature 04’s shared validation helper if exported (e.g. from `shared/src/settings/model-defaults.ts` or equivalent); do **not** invent a second divergent id grammar. If Feature 04 left validation inline, extract a shared pure function both features can call, or duplicate the **identical** rules in newsletter validation with a comment pointing at Feature 04 — prefer shared.

### Schema (pinned)

Append four **optional** string attributes to the `newsletters` collection in `shared/src/schema/declarations.ts` (create-if-absent via provisioner — no drop / rename / retype / migrate):

| Attribute | Type | Size | Required |
|-----------|------|------|----------|
| `taggerModel` | string | **256** | false |
| `scorerModel` | string | **256** | false |
| `drafterModel` | string | **256** | false |
| `embedderModel` | string | **256** | false |

**Existing documents:** missing / `null` / `undefined` map to `""` on read (same defensive coerce as lookback / Feature 04 globals).

### Domain types & persistence (pinned)

Extend `Newsletter`, `CreateNewsletterInput`, `UpdateNewsletterInput`, and `NewsletterFields` in `shared/src/newsletters/types.ts` with:

```ts
taggerModel: string;
scorerModel: string;
drafterModel: string;
embedderModel: string;
```

- **Create:** each field optional on input; omitted → `""` after resolve.
- **Update:** all four required on the input object (may be `""`); always written with the rest of the definition fields.
- `documentToNewsletter`: map four attributes; missing → `""`.
- `createNewsletter` / `updateNewsletter` data payloads include the four fields.

### Validation (pinned — identical non-empty rules to Feature 04)

For **each** of the four values independently (via `resolveCreateFields` / `resolveUpdateFields`):

1. Coerce to string; **trim** whitespace.
2. Empty after trim → store `""` (no override).
3. Non-empty length **> 256** → `NewsletterRepositoryError` `validation` naming the role.
4. Non-empty must match Feature 04’s OpenRouter-style id: at least one `/` with non-empty author and slug segments (e.g. `provider/model` or `provider/model:free`). Reject otherwise.
5. Reject values containing whitespace or control characters after trim.

All-or-nothing with the rest of the newsletter write: if any model field fails, reject the whole create/update (no partial Appwrite write of definition fields).

### GUI (pinned)

On `NewsletterFormDialog` (create **and** edit), add a **Model overrides** section **after Lookback** and **before** the dialog footer (feeds section stays below the form as today).

| Element | Behavior |
|---------|----------|
| Heading | **Model overrides** |
| Fields | Four text inputs in order: **Tagger**, **Scorer**, **Drafter**, **Embedder** — labels use those display names. |
| Input | Free-text; `name` attributes as in the table above; `defaultValue` from `newsletter?.…Model ?? ""` on edit; empty on create. |
| Placeholder | When empty: **`Use global default`** (literal). Do **not** show `DEFAULT_MODELS` here — empty falls through to global/env/built-in via Feature 06, not straight to built-in. |
| Helper copy | Muted note: leave blank to use the global default from the Prompts page; changes apply on the **next run**. No catalog / picker. |
| Save | Same primary submit as today (“Add newsletter” / “Save changes”) — overrides save with the rest of the definition (no separate Save models button). |
| List pages | **Do not** add model columns to the newsletters table/cards. |

Update the dialog description only if needed so create copy still fits (optional one-line mention of model overrides is fine; do not bloat).

### Server actions (pinned)

Extend `createNewsletterAction` / `updateNewsletterAction` in `web/app/(protected)/newsletters/actions.ts` to read the four FormData string fields and pass them into `createNewsletter` / `updateNewsletter`. Missing FormData keys → treat as `""` (create) or `""` (update). Existing `{ ok: true } | { ok: false; error }` and `NewsletterRepositoryError` → toast path unchanged.

### Out of scope

- Run-time resolution / `getModelName` changes (Feature 06).
- Global defaults GUI or `app_settings` fields (Feature 04).
- Per-newsletter **prompt** templates (stage: prompts are global only).
- OpenRouter catalog / existence checks.
- Showing overrides on the newsletters list.
- Mid-run model changes.

## Dependencies

- Builds on: **feature-04-global-model-defaults** — shared model-ID validation contract, role vocabulary (`ModelComponent`), attribute key naming, and precedence documentation.
- Builds on: Stage 03 newsletter CRUD (`NewsletterFormDialog`, `createNewsletter` / `updateNewsletter`, validation resolve path).
- Soft consumer: Feature 06 (reads these fields at run start) — not required to verify this feature.

## Constraints

- **Schema-as-code only.** Append attributes in `declarations.ts`; no console provisioning.
- **Create-if-absent only.** No drop / rename / retype / migrate of `newsletters` or other collections.
- **Do not** change `getModelName`, pipeline phases, or worker run-start wiring.
- **Do not** seed overrides from env or from current global defaults on create.
- **Do not** add a model catalog or OpenRouter live checks.
- **Server-only** Appwrite via `getServerAppwrite()`.
- Match existing newsletter action / toast patterns.
- Preserve lookback, feeds attach, and all existing newsletter field behavior.

## Acceptance criteria

- [ ] `newsletters` declares `taggerModel` / `scorerModel` / `drafterModel` / `embedderModel` (string, size 256, optional); declarations tests assert them.
- [ ] `Newsletter` (and create/update/fields types) expose the four strings; missing attributes read as `""`.
- [ ] Create/update validate each override (trim, empty OK, max 256, `author/slug` when non-empty); invalid rejects whole write.
- [ ] Newsletter create/edit dialog shows Model overrides with four fields; values persist and reload on edit.
- [ ] Empty fields show placeholder “Use global default”; helper mentions Prompts-page globals and next-run effect.
- [ ] `createNewsletterAction` / `updateNewsletterAction` read the four FormData model fields and pass them to the repository (covered by action tests — not form-only).
- [ ] Clearing a previously set override to blank persists `""` (no silent re-fill from global/env).
- [ ] Newsletters list table/cards unchanged (no model columns).
- [ ] `getModelName` / pipeline resolution unchanged by this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts` (four attributes on `newsletters`)
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/newsletters/types.ts`
- Modify: `shared/src/newsletters/validation.ts` (resolve create/update include model fields; shared or local id validation)
- Modify: `shared/src/newsletters/repository.ts` (`documentToNewsletter`, create/update payloads)
- Modify: `shared/src/newsletters/__tests__/validation.test.ts`
- Modify: `shared/src/newsletters/__tests__/repository.test.ts`
- Modify (if extracting shared helper): Feature 04 validation module + its tests / exports barrel
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx`
- Modify: `web/app/(protected)/newsletters/actions.ts`
- Create: `web/src/__tests__/newsletter-form-model-overrides.test.tsx` (form section — patterns from Feature 04 `global-model-defaults.test.tsx` / retention-controls)
- Create or modify: `web/src/__tests__/newsletters-actions.test.ts` (FormData → action → repository wiring; mirror Feature 04 `prompts-actions` models coverage)

## Testing approach

Test-first for validation + repository mapping; web tests cover the form section **and** action wiring (mock repository / assert call args — follow Feature 04 `global-model-defaults` and retention-controls patterns; there are no pre-existing newsletter form tests).

### Validation

1. Omitted model fields on create → all four `""` in resolved fields.
2. Whitespace-only override → stored as `""`.
3. Valid `author/slug` and `author/slug:free` accepted.
4. Missing `/`, length > 256, internal whitespace, or control char → `validation` error naming the role.
5. One invalid model + otherwise valid newsletter payload → whole resolve throws; repository write not attempted when tests go through create/update.

### Repository

1. `documentToNewsletter` maps missing model attrs to `""`.
2. `createNewsletter` persists four model fields (including all `""`).
3. `updateNewsletter` can set non-empty overrides and later clear them back to `""`.
4. Existing name/lookback/etc. behavior still passes.

### Declarations

- `newsletters` attributes include the four keys with `type: "string"`, `size: 256`, `required: false`.

### Web — form section

1. Edit mode renders four inputs with `defaultValue` from newsletter props.
2. Empty field placeholder is exactly `Use global default`.
3. Helper copy present (global defaults / next run).
4. Form includes `name="taggerModel"` (and the other three) so FormData can carry them (assert via DOM `name` attributes, same style as Feature 04 global-model-defaults field coverage).

### Web — actions (FormData → repository)

1. `createNewsletterAction` with FormData containing the four model fields calls `createNewsletter` with those four values (trimmed / as passed through to the repo input).
2. `updateNewsletterAction` likewise passes all four into `updateNewsletter`.
3. Missing FormData keys for models → actions pass `""` for each (create and update).
4. Repository `validation` error on a model field → `{ ok: false, error }` with that message (existing `NewsletterRepositoryError` path).

A builder must not be able to ship green form tests while actions ignore the new fields.

### Regression

- Existing newsletter validation/repository tests still pass.
- No changes required to pipeline `getModelName` tests; they must still pass unchanged.
- If Task 2 extracts a shared model-id helper from Feature 04, existing `shared/src/settings` (or `model-defaults`) tests must still pass — include them in Verify (below).

## Tasks

### Task 1: Failing newsletter tests for model override fields

- **Action**: Extend `shared/src/newsletters/__tests__/validation.test.ts` and `repository.test.ts` with Testing approach cases for the four model fields. Assert expected type/shape on `NewsletterFields`. Do not fully implement production mapping yet if following strict TDD — tests fail on missing fields/API first.
- **Expected result**: Newsletter tests fail for missing model-override support (not harness misconfig).
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/newsletters`
- **Depends on**: none.

### Task 2: Schema + types + validation + repository

- **Action**: Append the four attributes to `newsletters` in `declarations.ts`; update declarations tests. Extend types; wire `resolveCreateFields` / `resolveUpdateFields` with Feature 04–identical model validation (prefer shared helper); update `documentToNewsletter` and create/update payloads. If extracting a shared helper from Feature 04, keep Feature 04’s settings/model-defaults tests green.
- **Expected result**: Declarations + newsletter validation/repository tests pass; missing attrs read as `""`; clear-to-blank works; shared helper (if used) does not break Feature 04 settings tests.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/schema/__tests__/declarations.test.ts src/newsletters` — and if a shared helper was extracted from Feature 04, also `src/settings` (or the Feature 04 `model-defaults` test path).
- **Depends on**: Task 1.

### Task 3: Form UI + server actions + web tests

- **Action**: Add Model overrides section to `newsletter-form-dialog.tsx` per GUI table. Pass the four fields through `createNewsletterAction` / `updateNewsletterAction`. Add `web/src/__tests__/newsletter-form-model-overrides.test.tsx` (form section) and action wiring tests in `web/src/__tests__/newsletters-actions.test.ts` (or extend that file if it already exists) per Testing approach — mock `createNewsletter` / `updateNewsletter` and assert FormData fields reach the repo.
- **Expected result**: Operator can set/clear overrides on create/edit; values reload; invalid IDs toast via existing error path and do not persist; actions cannot silently drop model fields.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/newsletter-form-model-overrides.test.tsx src/__tests__/newsletters-actions.test.ts`; then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm --filter @newsletter/shared exec vitest run src/newsletters src/schema/__tests__/declarations.test.ts && pnpm --filter @newsletter/web exec vitest run src/__tests__/newsletter-form-model-overrides.test.tsx src/__tests__/newsletters-actions.test.ts && pnpm typecheck && pnpm lint`
- If Task 2 extracted a shared model-id helper from Feature 04, also run: `pnpm --filter @newsletter/shared exec vitest run src/settings` (or the concrete `model-defaults` test path) before declaring the feature done.
- Expected: listed tests green (including action FormData wiring); typecheck and lint clean (ignore benign missing `pages/` eslint noise). Confirm `getModelName` / worker resolution were not modified for DB wiring.

## Handoff

Builder reports: files created/modified; confirmation that blank overrides stay `""` (no seed from global/env); confirmation that validation matches Feature 04; confirmation Model overrides live on the newsletter dialog (not list, not Prompts page); confirmation action tests prove FormData → repository wiring; confirmation `getModelName` left unchanged (Feature 06 owns resolution). Note whether validation was shared or duplicated (and that settings tests were re-run if shared).

## Research notes

- Codebase: `NewsletterFormDialog` — create/edit FormData + lookback pattern; natural home for overrides after Lookback.
- Codebase: `shared/src/newsletters/{types,validation,repository}.ts` — extend the existing resolve → persist path (same as lookback).
- Feature 04 spec: global attribute keys, OpenRouter `author/slug` (+ optional `:variant`) validation, precedence newsletter → global → env → built-in; Feature 05 must not re-pin conflicting rules.
- Stage 07: blank means use global; free-text IDs; no catalog; no per-newsletter prompts.
