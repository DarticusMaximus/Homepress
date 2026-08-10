# Feature 01: Prompt template store

## Intent

Persist the three reusable LLM prompt templates (tagger, scorer, drafter) under a fixed named-placeholder contract, seeded from shipped code defaults, so the operator can later edit them in the GUI and the pipeline can load them without redeploying.

## Spec

Add a dedicated Appwrite collection and shared TypeScript store for the three global prompt templates. This feature owns the **placeholder contract**, **shipped defaults**, **schema**, and **repository** (get-or-create seed + validated update). It does **not** build the Prompts editor UI, reset action, model defaults, or run-time DB loading (features 02–06).

### Placeholder contract (PM-pinned)

| Role | Required placeholders (each must appear ≥1 time) |
|------|--------------------------------------------------|
| `tagger` | `{title}`, `{truncated_content}` |
| `scorer` | `{topics}`, `{disliked_topics}`, `{tags}`, `{title}` |
| `drafter` | `{newsletter_name}`, `{topics}`, `{articles_json}`, `{count}` |

**Rules (global — all roles):**

- Any allowed placeholder may appear **one or more times** in that template (reuse is fine; required means at least once).
- On **save** (`updatePromptTemplate`):
  - **Missing** any required placeholder for that role → **reject** (do not write). Error lists the missing names.
  - **Unknown** `{name}` tokens (not in that role’s allowed set) → **warn but allow** save. Warnings are returned to the caller for the future editor; runtime leaves unknown tokens as literal text.
- On **render**: substitute each provided value for every occurrence of its `{name}`; leave unrecognized `{…}` tokens unchanged. Call sites prepare string values (joins, `"None"` fallbacks, `String(count)`, truncated content) **before** render — the renderer does not join arrays.
- Empty or whitespace-only `body` → reject on save.
- Placeholder token shape: `{` + `[a-z][a-z0-9_]*` + `}` (matches the names above). Do not treat `$var` or bare `title` as placeholders.

### Shipped defaults

Export three **string** constants in `shared/src/prompts/defaults.ts` (named-placeholder form) as the **single source of truth** for both DB seeding and pipeline formatting:

- **Tagger** — same text as today’s `TAGGER_PROMPT_TEMPLATE` (already uses `{title}` / `{truncated_content}`).
- **Scorer** — convert today’s function-built prompt to a string that uses `{topics}` twice (Positive Topics + Newsletter focus), plus `{disliked_topics}`, `{tags}`, `{title}`.
- **Drafter** — convert today’s function body to a string with `{newsletter_name}`, `{topics}`, `{articles_json}`, `{count}`.

**Public export shapes (pinned — do not break phase tests):**

| Export | Shape after this feature |
|--------|--------------------------|
| `TAGGER_PROMPT_TEMPLATE` | Remains a **string** (may re-export the shipped tagger default). |
| `SCORER_PROMPT_TEMPLATE` | Remains a **callable** with today’s `ScorerPromptArgs` shape. Implementation: join topics; empty disliked/tags → `"None"`; then `renderPromptTemplate(SHIPPED_SCORER, values)`. |
| `DRAFTER_PROMPT_TEMPLATE` | Remains a **callable** with today’s `{ newsletterName, topicsStr, articlesJson, count }` arg shape. Implementation: map args → placeholder values (incl. `String(count)`); then `renderPromptTemplate(SHIPPED_DRAFTER, values)`. Callers still build `topicsStr` (fallback `"technology news"`) and `articlesJson` before invoking. |

Refactor `tagger.ts` / `scorer.ts` / `drafter.ts` so formatting goes through `renderPromptTemplate` against the shipped strings — **not** against Appwrite. Behavior of the rendered prompt for equivalent inputs must match pre-feature output. Existing phase tests must keep passing **without** rewriting them to treat scorer/drafter templates as strings.

### Schema

Append to `shared/src/schema/declarations.ts`:

| Constant | Value |
|----------|--------|
| `PROMPT_TEMPLATES_COLLECTION_ID` | `"prompt_templates"` |
| Display `name` | `"Prompt Templates"` |
| Permissions | server-only (`read: [], write: []`) |

| Attribute | Type | Size / notes | Required |
|-----------|------|--------------|----------|
| `body` | string | **50000** | true |
| `updatedAt` | datetime | — | true |

Document `$id` **is** the role: exactly `tagger` | `scorer` | `drafter`. Do **not** add a separate `role` attribute. Export `PROMPT_ROLES` const array + `PromptRole` union from the prompts module (and/or declarations — prefer prompts module for role vocabulary used by validate/repo; declarations only needs the collection id).

Create-if-absent via existing provisioner; no indexes, drops, renames, or migrations.

### Repository (`shared/src/prompts/`)

Mirror the `app_settings` get-or-create pattern:

| API | Behavior |
|-----|----------|
| `getOrCreatePromptTemplate(client, role)` | `getDocument` by role id; on 404, `createDocument` with shipped default `body` + `updatedAt: now`. On create race, re-get. Invalid `role` → validation error. |
| `listPromptTemplates(client)` | get-or-create all three roles; return stable order `tagger`, `scorer`, `drafter`. |
| `updatePromptTemplate(client, role, body)` | Run validate; on missing required → throw `PromptRepositoryError` `code: "validation"` with a message that lists missing placeholders. On success, `updateDocument` (get-or-create first if missing so update never 404s on a fresh DB). Return `{ template, warnings }` where `warnings` lists unknown placeholder names (may be empty). |

Types: `PromptTemplate` = `{ role: PromptRole; body: string; updatedAt: string }`. Error class parallel to `SettingsRepositoryError` (`validation` | `appwrite`); Appwrite failures use the same operator-safe message pattern (no raw Appwrite dumps / secrets in thrown messages).

Export the module from `shared/src/index.ts` via `export * from "./prompts"`.

### Out of scope

- Prompts page / editor UI (feature 02).
- Reset-to-shipped-default action (feature 03) — though shipped defaults exist here for seed + later reset.
- Global / per-newsletter model IDs (features 04–05).
- Worker loading templates from Appwrite at run start (feature 06).
- Editor prompt / editor phase (stage out of scope).
- Per-newsletter prompt templates.

## Dependencies

- Builds on: Stage 02 schema provisioner (`declarations.ts`, `provisioner.ts`, worker boot `provisionDatabase`).
- Builds on: Stage 01 pipeline tagger / scorer / drafter prompt surfaces and their Vitest suites.
- Soft: Stage 04 `app_settings` repository as the get-or-create pattern to mirror.
- Orphaned by: none — first feature in Stage 07.
- Soft consumers: features 02–03 (editor/reset), feature 06 (run-time load) — not required to verify this feature.

## Constraints

- **Schema-as-code only.** Append collection in `declarations.ts`; no console provisioning or one-off scripts.
- **Create-if-absent only.** No drop / rename / retype / migrate. Drift → warn + skip.
- **Do not change** `DATABASE_ID`, existing collection attribute shapes, or run checkpoint schema.
- **Do not** read prompt templates from Appwrite inside the pipeline in this feature.
- **Do not** add Prompts GUI beyond what already exists (stub page stays stub).
- **Server-only** Appwrite access via API-key client; no browser SDK for prompt documents.
- **Secrets:** never log API keys, session secrets, or full env dumps.
- **No editor role** — only `tagger` | `scorer` | `drafter`.

## Acceptance criteria

- [ ] `COLLECTIONS` includes `prompt_templates` with `body` (string, size 50000, required) and `updatedAt` (datetime, required); server-only permissions; `PROMPT_TEMPLATES_COLLECTION_ID` exported.
- [ ] Placeholder allow-lists and validate/render helpers exist; missing required → fail validation; unknown → warnings only; multi-occurrence substitution works for any allowed name.
- [ ] Shipped defaults for all three roles are named-placeholder strings; tagger/scorer/drafter format prompts via render against those defaults (no DB).
- [ ] `getOrCreatePromptTemplate` seeds missing docs from the matching shipped default; `listPromptTemplates` returns all three; `updatePromptTemplate` rejects missing required placeholders, persists valid bodies (including when the role doc was missing — get-or-create then write), and returns unknown-placeholder warnings.
- [ ] `SCORER_PROMPT_TEMPLATE` and `DRAFTER_PROMPT_TEMPLATE` remain callables with their pre-feature argument shapes; `TAGGER_PROMPT_TEMPLATE` remains a string.
- [ ] Existing pipeline phase tests still pass; new contract + repository tests cover the cases in Testing approach.
- [ ] `pnpm typecheck` and `pnpm lint` pass; `pnpm --filter @newsletter/shared test` passes.

## Files

- Create: `shared/src/prompts/types.ts`
- Create: `shared/src/prompts/contract.ts` (allow-lists, `validatePromptTemplate`, `renderPromptTemplate`)
- Create: `shared/src/prompts/defaults.ts` (three shipped default strings)
- Create: `shared/src/prompts/repository.ts`
- Create: `shared/src/prompts/index.ts`
- Create: `shared/src/prompts/__tests__/contract.test.ts`
- Create: `shared/src/prompts/__tests__/repository.test.ts`
- Modify: `shared/src/schema/declarations.ts` (collection + id constant)
- Modify: `shared/src/schema/__tests__/declarations.test.ts` (assert new collection)
- Modify: `shared/src/pipeline/tagger.ts` (render shipped default string)
- Modify: `shared/src/pipeline/scorer.ts` (`SCORER_PROMPT_TEMPLATE` stays callable; body uses shipped string + render)
- Modify: `shared/src/pipeline/drafter.ts` (`DRAFTER_PROMPT_TEMPLATE` stays callable; body uses shipped string + render)
- Modify: `shared/src/index.ts` (`export * from "./prompts"`)
- Modify (only if needed): `shared/src/pipeline/index.ts` — keep existing public export names; do not change scorer/drafter from callable → string.

## Testing approach

Test-first for the contract and repository. Pipeline changes are verified by existing phase tests plus targeted format assertions where helpful.

### Contract (`contract.test.ts`)

1. Each role’s shipped default (or a minimal fixture) **passes** validation with empty warnings.
2. Removing a required placeholder **fails** validation and lists that name in missing.
3. An unknown `{foo}` **passes** validation with `foo` in warnings.
4. `renderPromptTemplate` replaces **all** occurrences of a repeated placeholder (e.g. `{topics}` twice).
5. Unknown tokens survive render unchanged.
6. Empty / whitespace-only body fails validation.

### Repository (`repository.test.ts`) — mock Appwrite client (same style as `settings/__tests__/repository.test.ts`)

1. `getOrCreate` on missing doc creates with shipped default body for that role.
2. `getOrCreate` on existing doc returns stored body (does not overwrite).
3. `listPromptTemplates` returns three templates in role order, seeding any missing.
4. `update` with missing required placeholder throws `validation` and does not write.
5. `update` with unknown placeholder writes body and returns warnings.
6. **`update` when the role document is missing** succeeds: get-or-create (seed) then write the new body; returns that body; does **not** throw Appwrite 404.
7. Invalid role throws `validation`.

### Pipeline regression

- Existing `tagger` / `scorer` / `drafter` Vitest suites still pass after the render refactor.

## Tasks

### Task 1: Placeholder contract module + tests

- **Action**: Create `shared/src/prompts/types.ts` and `contract.ts` with `PROMPT_ROLES`, `PromptRole`, per-role allow-lists, `validatePromptTemplate(role, body)`, and `renderPromptTemplate(body, values: Record<string, string>)`. Write `shared/src/prompts/__tests__/contract.test.ts` covering Testing approach cases 1–6 (use inline fixture strings for missing/unknown cases; shipped defaults may land in Task 2 — until then, minimal fixtures that include the required set are fine). Export via `shared/src/prompts/index.ts` and `shared/src/index.ts`.
- **Expected result**: Contract tests fail until implementation, then pass. Package exports `validatePromptTemplate` / `renderPromptTemplate` / role types.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/contract.test.ts`
- **Depends on**: none.

### Task 2: Shipped defaults + pipeline render refactor

- **Action**: Add `shared/src/prompts/defaults.ts` with the three named-placeholder shipped strings (tagger parity; scorer/drafter converted as Spec). Refactor phases to call `renderPromptTemplate` against those strings. **Keep `SCORER_PROMPT_TEMPLATE` and `DRAFTER_PROMPT_TEMPLATE` as callables** with today’s argument shapes (join/`None`/fallback inside the callable, then render). Keep `TAGGER_PROMPT_TEMPLATE` as a string. Do **not** change scorer/drafter exports to bare strings (that would break `scorer.test.ts` and similar call sites).
- **Expected result**: Pipeline phases produce the same substituted prompt text as before for equivalent inputs; existing phase tests pass without rewriting them for a string-only scorer/drafter export.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/pipeline/__tests__/tagger.test.ts src/pipeline/__tests__/scorer.test.ts src/pipeline/__tests__/drafter.test.ts` and re-run contract tests (shipped defaults should now validate cleanly).
- **Depends on**: Task 1.

### Task 3: Schema declaration for `prompt_templates`

- **Action**: Add `PROMPT_TEMPLATES_COLLECTION_ID` and the collection entry to `shared/src/schema/declarations.ts` per Spec. Update `shared/src/schema/__tests__/declarations.test.ts` to assert id, permissions, and attribute keys/types/sizes/required.
- **Expected result**: Declarations tests pass; provisioner will create the collection on next worker boot (no provisioner code change expected unless tests need a count update).
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/schema/__tests__/declarations.test.ts`
- **Depends on**: none (can parallelize with Task 1; sequential after Task 2 is fine).

### Task 4: Repository get-or-create / update / list + tests

- **Action**: Implement `shared/src/prompts/repository.ts` (`getOrCreatePromptTemplate`, `listPromptTemplates`, `updatePromptTemplate`, `PromptRepositoryError`) mirroring `shared/src/settings/repository.ts` patterns. Wire tests in `shared/src/prompts/__tests__/repository.test.ts` per Testing approach cases 1–7 — including **update when the document is missing** (get-or-create then write; no 404). Ensure `update` runs validation before write and returns `{ template, warnings }`.
- **Expected result**: Repository tests pass; seed uses Task 2 shipped defaults; virgin-DB update path is covered.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/repository.test.ts` then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: Task 1, Task 2, Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm typecheck && pnpm lint`
- Expected: all shared tests green (including new prompts + updated declarations); typecheck and lint clean (ignore benign missing `pages/` eslint noise). No Prompts UI changes required for this feature.

## Handoff

Builder reports: files created/modified; confirmation that shipped defaults validate and seed correctly; confirmation that `SCORER_PROMPT_TEMPLATE` / `DRAFTER_PROMPT_TEMPLATE` remained callables; confirmation that update-on-missing was tested; note that the pipeline still does not read Appwrite templates (feature 06). Deviations only if Appwrite attribute size forced a documented change.

## Research notes

- Codegraph: current `TAGGER_PROMPT_TEMPLATE` already uses `{title}` / `{truncated_content}`; scorer/drafter were TS functions interpolating the same fields as legacy Python.
- Stage 07 open questions pinned in grill: placeholder names; reject-missing / warn-unknown; dedicated `prompt_templates` collection; Feature 01 = store only (no GUI / no run-time DB load).
