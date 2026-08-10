# Feature 04: Global model defaults

## Intent

Let the operator set free-text OpenRouter model IDs for tagger, scorer, drafter, and embedder in the GUI so day-to-day model choice lives in the app (with env vars as bootstrap/fallback only) and takes effect on the next run without a redeploy.

## Spec

Persist four **global** default model IDs on the existing singleton `app_settings` document, expose get/update in the shared settings repository, and add a **Default models** section on the Prompts page (`/prompts`) so the operator can view and save them. This feature owns **schema**, **repository**, **GUI**, and the **documented precedence contract**. It does **not** change pipeline `getModelName` call sites or resolve models at run start (Feature 06), and it does **not** add per-newsletter overrides (Feature 05).

### Precedence contract (PM-pinned — document here; Feature 06 implements)

At run start, each role’s effective model is:

1. **Newsletter override** for that role, if non-empty (Feature 05)
2. Else **global GUI default** for that role, if non-empty (this feature)
3. Else **env var** for that role (`TAGGER_MODEL` / `SCORER_MODEL` / `DRAFTER_MODEL` / `EMBED_MODEL`)
4. Else **built-in** `DEFAULT_MODELS[role]` from `shared/src/pipeline/config.ts`

**Empty / unset global** means “not set in GUI” — do **not** copy env into the DB on first load. Env remains bootstrap/fallback until the operator saves a non-empty global value.

This feature **must not** change `getModelName` behavior. Pipeline phases keep using today’s env → built-in path until Feature 06 wires DB resolution.

### GUI location (PM-pinned)

**Prompts page** (`/prompts`): a **Default models** section on the same page as the prompt editor — not a separate Settings route, not on Runs.

| Element | Behavior |
|---------|----------|
| Placement | Above the Feature 02 prompt-editor tabs (models first, templates below). Same page title “Prompts” (or “Prompts & models” only if a one-line subtitle is clearer — prefer keeping `h1` as **Prompts** and section heading **Default models**). |
| Fields | Four text inputs, one per role in order: **Tagger**, **Scorer**, **Drafter**, **Embedder**. Labels use those display names. |
| Input | Free-text OpenRouter model ID (e.g. `nvidia/nemotron-3-nano-30b-a3b`). `font-mono` optional; full width or generous `max-w`. |
| Empty hint | When a field is empty, `placeholder` shows that role’s `DEFAULT_MODELS[role]` so the operator sees the built-in fallback. |
| Helper copy | Muted note under the section: leave blank to fall through to env (`TAGGER_MODEL`, `SCORER_MODEL`, `DRAFTER_MODEL`, `EMBED_MODEL`) then the built-in default; changes apply on the **next run**. No model catalog / picker. |
| Save | One primary **Save models** button for all four fields together (`useTransition`). Pending → “Saving…”. Disabled while in flight. |
| Feedback | Toast-only (same family as retention / prompts editor). Success → e.g. “Default models saved”. Failure → `toast.error` with action error. |
| Load | Server page loads `getOrCreateAppSettings` (or a dedicated models read) alongside Feature 02’s `listPromptTemplates` when both are present; pass current model strings into the client section. |

Mirror RetentionControls / prompts-editor patterns: client component, server action, toast, no `beforeunload`.

### Schema (pinned)

Append four **optional** string attributes to the existing `app_settings` collection in `shared/src/schema/declarations.ts` (create-if-absent via provisioner — no drop / rename / retype / migrate):

| Attribute | Type | Size | Required |
|-----------|------|------|----------|
| `taggerModel` | string | **256** | false |
| `scorerModel` | string | **256** | false |
| `drafterModel` | string | **256** | false |
| `embedderModel` | string | **256** | false |

Do **not** add a separate collection. Do **not** change `APP_SETTINGS_DOCUMENT_ID` (`"default"`) or `runRetentionDays`.

**Existing documents:** missing / `null` / `undefined` attributes map to empty string (`""`) on read — same defensive coerce spirit as lookback on newsletters.

### Roles & vocabulary (pinned)

Reuse `ModelComponent` from `shared/src/pipeline/config.ts` (`"tagger" | "scorer" | "drafter" | "embedder"`). Export a stable ordered list for UI/tests if helpful, e.g. `MODEL_COMPONENTS: readonly ModelComponent[]` (or re-export an existing constant — do not invent a second role union).

Attribute key mapping:

| Role | Attribute | Env key (fallback, Feature 06) |
|------|-----------|--------------------------------|
| `tagger` | `taggerModel` | `TAGGER_MODEL` |
| `scorer` | `scorerModel` | `SCORER_MODEL` |
| `drafter` | `drafterModel` | `DRAFTER_MODEL` |
| `embedder` | `embedderModel` | `EMBED_MODEL` |

Built-in defaults remain `DEFAULT_MODELS` in `config.ts` (do not duplicate the strings in the web layer).

### Validation (pinned)

On update, for **each** of the four values independently:

1. Coerce to string; **trim** whitespace.
2. Empty after trim → store `""` (unset — env/built-in apply later).
3. Non-empty length **> 256** → reject whole update (`SettingsRepositoryError` `validation`) with a message naming the role(s).
4. Non-empty must match a minimal OpenRouter-style id: at least one `/` separating non-empty author and slug segments (e.g. `provider/model` or `provider/model:free`). Reject otherwise with a clear validation message. **Do not** call OpenRouter to verify the model exists (stage: no catalog).
5. Reject values containing whitespace or control characters after trim.

All-or-nothing: if any field fails validation, write nothing.

### Repository API (pinned)

Extend `shared/src/settings/`:

```ts
// AppSettings gains:
taggerModel: string;
scorerModel: string;
drafterModel: string;
embedderModel: string;
// (plus existing runRetentionDays, updatedAt)

updateGlobalModelDefaults(
  client,
  models: {
    taggerModel: string;
    scorerModel: string;
    drafterModel: string;
    embedderModel: string;
  },
): Promise<AppSettings>
```

Behavior:

1. Validate all four fields (above rules).
2. `getOrCreateAppSettings` first (so virgin DB never 404s on update).
3. `updateDocument` with the four model fields + `updatedAt: now`. **Preserve** `runRetentionDays` (do not overwrite with undefined).
4. Return mapped `AppSettings`.
5. Appwrite failures → same operator-safe `SettingsRepositoryError` / message pattern as retention (no raw dumps).

`getOrCreateAppSettings` / `documentToSettings`: map the four attributes; missing → `""`. On **create** of the singleton, omit model fields or write `""` — do **not** seed from `process.env` or `DEFAULT_MODELS`.

Optional pure helper (encouraged for Feature 06 / tests, not required to change call sites yet):

```ts
normalizeModelIdInput(raw: string): string  // trim; empty → ""
```

Do **not** implement full newsletter→global→env→built-in resolution in this feature.

### Server action (pinned)

Extend or add alongside prompts actions — prefer `web/app/(protected)/prompts/actions.ts` (same route family):

```ts
updateGlobalModelDefaultsAction(models: {
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  embedderModel: string;
})
  → { ok: true; settings: Pick<AppSettings, "taggerModel" | "scorerModel" | "drafterModel" | "embedderModel" | "updatedAt"> }
  | { ok: false; error: string }
```

- Call `updateGlobalModelDefaults(getServerAppwrite(), models)`.
- On success: `revalidatePath("/prompts")`; return the four models + `updatedAt`.
- On `SettingsRepositoryError` `validation`: `{ ok: false, error: err.message }`.
- On Appwrite / unknown: `console.error` + `{ ok: false, error: "Something went wrong while saving default models." }`.

### Out of scope

- Per-newsletter model overrides (Feature 05).
- Worker / pipeline resolution at run start (Feature 06) — saving here persists only; `getModelName` unchanged.
- OpenRouter model catalog browser or live existence checks.
- Changing prompt templates, Reset, or placeholder contract (Features 01–03).
- Separate top-level Settings nav item.
- Mid-run model changes.

## Dependencies

- Builds on: Stage 04 **`app_settings`** repository (`getOrCreateAppSettings`, `SettingsRepositoryError`, singleton `default` doc) and schema provisioner create-if-absent attributes.
- Builds on: Stage 01 **`ModelComponent` / `DEFAULT_MODELS` / env key map** in `shared/src/pipeline/config.ts` (vocabulary + placeholders only — do not change `getModelName`).
- Soft: **feature-02-prompts-editor** — Prompts page shell; this feature adds the Default models section above the editor. If Feature 02 is not yet built in the same execute order, compose the page so both sections can coexist (Feature 02 owns the editor; Feature 04 owns the models block).
- Soft consumers: Feature 05 (overrides), Feature 06 (resolution) — not required to verify this feature.

## Constraints

- **Schema-as-code only.** Append attributes in `declarations.ts`; no console provisioning.
- **Create-if-absent only.** No drop / rename / retype / migrate of `app_settings` or other collections.
- **Do not** change `getModelName` or pipeline phase constructors in this feature.
- **Do not** seed GUI values from env on first create (would erase env-as-fallback).
- **Do not** add a model catalog, autocomplete against OpenRouter, or API key UI.
- **Server-only** Appwrite via `getServerAppwrite()` — no browser SDK for settings.
- **Secrets:** never log `OPENROUTER_API_KEY` or Appwrite keys.
- Match `{ ok: true; … } | { ok: false; error: string }` action shapes.

## Acceptance criteria

- [ ] `app_settings` declares `taggerModel` / `scorerModel` / `drafterModel` / `embedderModel` (string, size 256, optional); declarations tests assert them.
- [ ] `AppSettings` and `getOrCreateAppSettings` expose the four fields; missing attributes read as `""`.
- [ ] `updateGlobalModelDefaults` validates (trim, max 256, requires `author/slug` shape when non-empty, allows empty), persists all four, preserves `runRetentionDays`, bumps `updatedAt`.
- [ ] `/prompts` shows a Default models section with four editable fields and Save models; values persist and reload after save.
- [ ] Empty fields show `DEFAULT_MODELS` placeholders; helper copy mentions env fallback and next-run effect.
- [ ] Invalid non-empty IDs (no `/`, too long) are rejected with toast error and no write.
- [ ] `getModelName` behavior and existing pipeline tests are unchanged by this feature.
- [ ] No per-newsletter model fields, no catalog UI, no Feature 06 resolution wiring.
- [ ] `pnpm typecheck` and `pnpm lint` pass; new settings + web tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts` (four attributes on `app_settings`)
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/settings/types.ts` (`AppSettings` fields)
- Modify: `shared/src/settings/repository.ts` (`documentToSettings`, create path, `updateGlobalModelDefaults`)
- Modify: `shared/src/settings/__tests__/repository.test.ts`
- Create (optional if validation extracted): `shared/src/settings/model-defaults.ts` + `__tests__/model-defaults.test.ts`
- Modify: `web/app/(protected)/prompts/page.tsx` (load settings; render models section)
- Modify: `web/app/(protected)/prompts/actions.ts` (`updateGlobalModelDefaultsAction`)
- Create: `web/components/prompts/global-model-defaults.tsx`
- Create: `web/src/__tests__/global-model-defaults.test.tsx`
- Create or modify: `web/src/__tests__/prompts-actions.test.ts` (cover models action)
- Modify (only if needed): `shared/src/settings/index.ts` exports

## Testing approach

Test-first for repository validation + update; web component tests mirror retention-controls / prompts-editor (mock the server action + toast).

### Repository / validation

1. `getOrCreate` maps missing model attributes to `""`.
2. `updateGlobalModelDefaults` with four valid IDs persists them and returns them; `runRetentionDays` unchanged.
3. Empty strings for all four succeed (clear globals).
4. Whitespace-only → stored as `""`.
5. Value without `/` → `validation` error; no write.
6. Value length > 256 → `validation` error; no write.
7. Non-empty id with internal whitespace (e.g. `foo/bar baz`) or a control character → `validation` error; no write.
8. Mixed payload: one invalid field + three valid → `validation` error; **no write** (all-or-nothing — assert `updateDocument` not called / stored values unchanged).
9. Valid ids with `:free` suffix (e.g. `meta-llama/llama-3.2-3b-instruct:free`) succeed.
10. Create path for virgin settings does not invent model IDs from env.

### Declarations

- `app_settings` attributes include the four keys with `type: "string"`, `size: 256`, `required: false`.

### Web — `global-model-defaults.test.tsx`

1. Renders four labeled inputs initialized from props.
2. Empty field shows placeholder equal to `DEFAULT_MODELS` for that role.
3. Save calls action with all four current values; success toast on `ok: true`.
4. Failure toast on `ok: false`; inputs keep draft values.

### Web — actions

1. `updateGlobalModelDefaultsAction` calls `updateGlobalModelDefaults` with trimmed payload shape; revalidates `/prompts` on success.
2. Validation error from repository → `{ ok: false, error }`.

### Regression

- Existing `shared/src/pipeline/__tests__` for `getModelName` / config still pass without env/GUI changes from this feature.
- Existing retention settings tests still pass.

## Tasks

### Task 1: Failing settings tests for global model fields

- **Action**: Extend `shared/src/settings/__tests__/repository.test.ts` (and add `model-defaults.test.ts` if validation is extracted) with Testing approach repository cases 1–10. Assert `AppSettings` shape expectations. Do **not** fully implement production update yet if following strict TDD — tests must fail on missing API / fields first.
- **Expected result**: Shared settings tests fail for missing `updateGlobalModelDefaults` / model fields (not harness misconfig).
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/settings`
- **Depends on**: none.

### Task 2: Schema attributes + AppSettings mapping + update API

- **Action**: Append the four attributes to `app_settings` in `declarations.ts`; update declarations tests. Extend `AppSettings`, `documentToSettings`, create-document data, and implement `updateGlobalModelDefaults` with validation rules from Spec. Export from settings barrel if needed.
- **Expected result**: Declarations + settings repository tests pass; virgin create leaves models empty; update validates and persists.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/schema/__tests__/declarations.test.ts src/settings`
- **Depends on**: Task 1.

### Task 3: Server action + Default models UI on `/prompts`

- **Action**: Add `updateGlobalModelDefaultsAction` to `web/app/(protected)/prompts/actions.ts`. Create `web/components/prompts/global-model-defaults.tsx` per UI table. Update `prompts/page.tsx` to load `getOrCreateAppSettings` and render the section **above** the prompt editor. Write `web/src/__tests__/global-model-defaults.test.tsx` and action tests per Testing approach.
- **Expected result**: Operator can edit/save four model IDs on `/prompts`; values reload; invalid IDs toast and do not persist.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/global-model-defaults.test.tsx src/__tests__/prompts-actions.test.ts` (or the action test file that covers this action); then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm --filter @newsletter/shared exec vitest run src/settings src/schema/__tests__/declarations.test.ts && pnpm --filter @newsletter/web exec vitest run src/__tests__/global-model-defaults.test.tsx src/__tests__/prompts-actions.test.ts && pnpm typecheck && pnpm lint`
- Expected: listed tests green (including models action coverage in `prompts-actions.test.ts` — or the equivalent action test file if split); typecheck and lint clean (ignore benign missing `pages/` eslint noise). Confirm manually or via code review that `getModelName` / pipeline phases were not modified for DB resolution.

## Handoff

Builder reports: files created/modified; confirmation that empty globals stay empty (no env seed); confirmation that validation requires `author/slug` when non-empty; confirmation that Default models lives on `/prompts` above the editor; confirmation that `getModelName` was left unchanged (Feature 06 owns resolution). Deviations only if Appwrite attribute constraints forced a documented size change.

## Research notes

- Codebase: `shared/src/pipeline/config.ts` — `ModelComponent`, `DEFAULT_MODELS`, env keys `TAGGER_MODEL`/`SCORER_MODEL`/`DRAFTER_MODEL`/`EMBED_MODEL`; `getModelName` is env → built-in only today.
- Codebase: `shared/src/settings/` + `app_settings` singleton — retention pattern to extend (not a new collection).
- Stage 07 open questions pinned: GUI on Prompts page; precedence newsletter → global → env → built-in (Feature 06 implements).
- OpenRouter docs (web search): model IDs are `author/slug` with optional `:variant` (e.g. `:free`) — informs the minimal `/` validation rule without a catalog.
