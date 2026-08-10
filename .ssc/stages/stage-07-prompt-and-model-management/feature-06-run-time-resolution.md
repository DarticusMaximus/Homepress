# Feature 06: Run-time resolution

## Intent

At run start, load the saved prompt templates and resolve each role’s model (newsletter override → global → env → built-in) so the next run uses the operator’s GUI choices without a redeploy, while in-flight phase work inside one claim keeps those claim-time values.

## Spec

Wire Features 01–05 into the live run path. When `executeRun` claims a run, **once** before any phase work: load the three prompt templates from Appwrite, load global model defaults, read the newsletter’s per-role overrides, resolve four effective model IDs, and construct tagger / scorer / drafter / embedder call sites with those values. Placeholder substitution for per-run data still happens at format time via Feature 01’s `renderPromptTemplate` — never by writing live article data into the stored template.

This feature owns **pure model resolution**, **run-start load + apply**, and **phase option injection** (`model` / `promptTemplate`). It does **not** add GUI, schema attributes, or a model catalog.

### Precedence (PM-pinned — implement here; Features 04–05 documented it)

For each `ModelComponent` (`tagger` | `scorer` | `drafter` | `embedder`), effective model ID is the first **non-empty after trim** of:

1. Newsletter override (`newsletter.taggerModel` / `scorerModel` / `drafterModel` / `embedderModel`)
2. Global GUI default (`app_settings.taggerModel` / …)
3. Env var (`TAGGER_MODEL` / `SCORER_MODEL` / `DRAFTER_MODEL` / `EMBED_MODEL`)
4. Built-in `DEFAULT_MODELS[role]`

Empty string, whitespace-only, `null`, and `undefined` all count as unset at every layer.

### Claim-time freeze (pinned)

- Resolve **once** at the start of each `executeRun` invocation (fresh or resume claim), immediately after `buildPipelineConfigForNewsletter` succeeds — same “rebuild at claim” spirit as newsletter config today.
- Within that invocation, every phase uses the claim-time models and prompt bodies (do **not** re-read Appwrite between phases).
- Do **not** add run-document schema to snapshot resolved values. A later resume claim re-resolves from current DB/env (acceptable without a new collection; mid-invocation still frozen).
- Mid-run GUI edits during an active claim do not affect that claim (operator-facing copy in Features 02/04 already says next run / in-progress keeps start values — “start” here means claim start of `executeRun`).

### Pure resolver (pinned)

Add `shared/src/pipeline/resolve-model.ts` (or co-locate in `config.ts` if tiny — prefer a dedicated module + tests):

```ts
resolveModelId(
  role: ModelComponent,
  sources: {
    newsletterOverride?: string | null;
    globalDefault?: string | null;
    envValue?: string | null; // typically process.env[ENV_MODEL_KEYS[role]]
  },
): string
```

- Trim each source; treat empty as unset; return `DEFAULT_MODELS[role]` if all unset.
- Export `ENV_MODEL_KEYS` from `config.ts` (today it is private) so callers and tests share the same env key map.
- **`getModelName(component)` stays env → built-in only** for unit tests and any call site that does not pass overrides. Do **not** make `getModelName` read Appwrite. Production run path uses `resolveModelId` + loaded sources, then injects the result.

Optional thin helper (encouraged):

```ts
resolveAllModelIds(sources: {
  newsletter: Pick<Newsletter, "taggerModel" | "scorerModel" | "drafterModel" | "embedderModel">;
  global: Pick<AppSettings, "taggerModel" | "scorerModel" | "drafterModel" | "embedderModel">;
  env?: NodeJS.ProcessEnv; // default process.env
}): Record<ModelComponent, string>
```

### Run-start loader (pinned)

Add `shared/src/runs/resolve-run-llm.ts` (name flexible; keep under `runs/` next to `execute-run.ts`):

```ts
loadRunLlmResolution(
  client: Client,
  newsletter: Newsletter,
): Promise<RunLlmResolution>
```

Where:

```ts
type RunLlmResolution = {
  models: Record<ModelComponent, string>;
  prompts: { tagger: string; scorer: string; drafter: string };
};
```

Behavior:

1. `listPromptTemplates(client)` (Feature 01 — get-or-create seeds) → map `role → body` for the three prompt roles.
2. `getOrCreateAppSettings(client)` → four global model fields.
3. `resolveAllModelIds` / per-role `resolveModelId` with newsletter + global + `process.env`.
4. Return `{ models, prompts }`.
5. Appwrite / repository failures: throw (or return a typed error) with operator-safe messaging — **no** silent “ignore DB and pretend shipped-only” path that hides a load failure. `executeRun` already fails the run when newsletter load fails; treat LLM resolution the same (markFailed with a clear message, e.g. “Could not load prompt templates or model settings”).

### Phase injection (pinned)

Extend constructor / function options so production can inject claim-time values without each phase calling Appwrite:

| Surface | New options | Behavior when set | When unset (tests / `runPipeline` defaults) |
|---------|-------------|-------------------|---------------------------------------------|
| `ArticleTaggerOptions` | `model?: string`, `promptTemplate?: string` | Use for chatCompletion + format via `renderPromptTemplate` (Feature 01) | `getModelName("tagger")` + shipped / current `TAGGER_PROMPT_TEMPLATE` string |
| `ArticleScorerOptions` | `model?: string`, `promptTemplate?: string` | Same; scorer still joins topics / `"None"` fallbacks then renders | `getModelName("scorer")` + current callable `SCORER_PROMPT_TEMPLATE` path |
| `NewsletterDrafterOptions` | `model?: string`, `promptTemplate?: string` | Same; drafter still builds `topicsStr` / `articlesJson` / `String(count)` then renders | `getModelName("drafter")` + current callable `DRAFTER_PROMPT_TEMPLATE` path |
| `MMRSelectorOptions` | `model?: string` | Embeddings model | `getModelName("embedder")` |
| `SuppressOptions` | `model?: string` | Embeddings model for cross-run suppress | `getModelName("embedder")` |

**Prompt formatting:** After Feature 01, phases already render shipped strings. When `promptTemplate` is provided, render **that** body with the same placeholder value map the phase already builds — do not bypass `renderPromptTemplate`. Keep public export shapes for `SCORER_PROMPT_TEMPLATE` / `DRAFTER_PROMPT_TEMPLATE` callables and `TAGGER_PROMPT_TEMPLATE` string (Feature 01 pin).

### `executeRun` wiring (pinned)

After successful `buildPipelineConfigForNewsletter`:

1. `const resolution = await loadRunLlmResolution(client, newsletter)`.
2. If tests inject full `tagger` / `scorer` / `selector` / `drafter` / `suppress` via `ExecuteRunOptions`, those mocks still win (do not force resolution over explicit phase mocks). When using **default** phase implementations, construct them with injected `model` / `promptTemplate` from `resolution`.
3. Log once at claim (structured, no secrets): `runId`, the four resolved model IDs, and that prompts were loaded for `tagger`/`scorer`/`drafter` (lengths OK; **do not** log full template bodies).
4. Proceed with existing phase / checkpoint / resume logic unchanged.

Concrete construction pattern (illustrative — builder may use wrappers):

```ts
const tagger =
  options?.tagger ??
  ((articles) =>
    tagArticles(articles, {
      model: resolution.models.tagger,
      promptTemplate: resolution.prompts.tagger,
    }));
// scorer / drafter / selectDiverse / suppress similarly with embedder model
```

### Out of scope

- Prompts / models GUI (Features 02–05).
- Persisting resolved models/prompts onto the run document or checkpoint.
- OpenRouter catalog / existence checks.
- Editor prompt / editor phase.
- Per-newsletter prompt templates.
- Changing placeholder contract or validation (Feature 01).
- Re-reading DB between phases inside one claim.

## Dependencies

- Builds on: **feature-01-prompt-template-store** — `listPromptTemplates`, `renderPromptTemplate`, shipped defaults / role bodies.
- Builds on: **feature-04-global-model-defaults** — `app_settings` model fields + `getOrCreateAppSettings`.
- Builds on: **feature-05-per-newsletter-model-overrides** — newsletter `*Model` fields.
- Builds on: Stage 04 **`executeRun`** claim/resume loop and Stage 01 pipeline phases (`getModelName`, tagger/scorer/drafter/MMR/suppress).
- Soft: Features 02–03 (editor/reset) — not required to verify resolution; run path only needs the store + settings + newsletter fields.

## Constraints

- **Do not** add schema collections/attributes for resolution snapshots.
- **Do not** change `getModelName` to read Appwrite; keep env → built-in for default/test paths.
- **Do not** re-resolve models or reload templates between phases in one `executeRun` call.
- **Do not** paste live run data into stored templates; only placeholder render at format time.
- **Server-only** Appwrite via the worker/`executeRun` client.
- **Secrets:** never log `OPENROUTER_API_KEY`, Appwrite keys, or full prompt bodies in claim logs.
- Preserve existing checkpoint / resume / markFailed behavior; only add load+inject before phases.
- Existing phase unit tests that rely on `getModelName` + shipped prompts must keep passing when options omit `model` / `promptTemplate`.

## Acceptance criteria

- [ ] `resolveModelId` implements newsletter → global → env → built-in with trim/empty semantics; unit tests cover each layer winning and all-unset → `DEFAULT_MODELS`.
- [ ] `ENV_MODEL_KEYS` is exported from `config.ts` (or the resolver module re-exports the same map).
- [ ] `loadRunLlmResolution` loads three prompt bodies + globals and returns four resolved models for a newsletter.
- [ ] `executeRun` (default phases) uses claim-time resolved models for tagger, scorer, drafter, and embedder (MMR + cross-run suppress).
- [ ] `executeRun` (default phases) formats tagger/scorer/drafter prompts from loaded template bodies, not only shipped constants.
- [ ] Within one `executeRun` invocation, templates/settings (or `loadRunLlmResolution`) are fetched **exactly once** — enforced by a call-count assert in `execute-run.test.ts` on a multi-phase claim.
- [ ] Explicit `ExecuteRunOptions` phase mocks still override defaults (tests remain injectable).
- [ ] `getModelName` behavior for env → built-in remains intact; existing `config.test.ts` cases still pass.
- [ ] Appwrite failure loading templates/settings fails the run with an operator-safe message (no silent wrong models).
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Create: `shared/src/pipeline/resolve-model.ts`
- Create: `shared/src/pipeline/__tests__/resolve-model.test.ts`
- Create: `shared/src/runs/resolve-run-llm.ts`
- Create: `shared/src/runs/__tests__/resolve-run-llm.test.ts`
- Modify: `shared/src/pipeline/config.ts` (export `ENV_MODEL_KEYS`)
- Modify: `shared/src/pipeline/tagger.ts` (`model` / `promptTemplate` options)
- Modify: `shared/src/pipeline/scorer.ts` (same)
- Modify: `shared/src/pipeline/drafter.ts` (same)
- Modify: `shared/src/pipeline/mmr-selection.ts` (`model` option)
- Modify: `shared/src/pipeline/cross-run-suppress.ts` (`model` option)
- Modify: `shared/src/runs/execute-run.ts` (load + inject)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` (resolution wiring with mocks)
- Modify (as needed): `shared/src/pipeline/index.ts` / `shared/src/index.ts` / `shared/src/runs/index.ts` exports
- Modify: `shared/src/pipeline/__tests__/tagger.test.ts` (injection smoke — required)
- Modify: `shared/src/pipeline/__tests__/scorer.test.ts` (injection smoke — required)
- Modify: `shared/src/pipeline/__tests__/drafter.test.ts` (injection smoke — required)
- Modify: `shared/src/pipeline/__tests__/mmr-selection.test.ts` and/or `cross-run-suppress.test.ts` (embedder `model` injection — at least one)

## Testing approach

Test-first for the pure resolver and the loader; then wire `executeRun` with mocked Appwrite/repos and assert injected models/prompts reach phase constructors (or reach LLM client `model` / prompt content).

### `resolve-model.test.ts`

1. All sources empty → `DEFAULT_MODELS[role]` for each role.
2. Env set, global/newsletter empty → env wins.
3. Global set, env set → **global wins** (env is fallback only).
4. Newsletter set, global and env set → **newsletter wins**.
5. Whitespace-only newsletter + non-empty global → global wins.
6. Trim: `"  provider/model  "` on newsletter resolves to trimmed id (prefer trim on read in resolver for defense in depth).

### `resolve-run-llm.test.ts` (mock Appwrite / repo functions)

1. Returns prompt bodies from `listPromptTemplates` and models from cascade over newsletter + settings + env.
2. Propagates / surfaces repository failure (assert throw or typed error — match whatever `executeRun` consumes).

### Phase option smoke (required — live in the existing phase test files listed under Files)

Injection cases **must** be added to the existing `tagger` / `scorer` / `drafter` test files (and MMR and/or suppress for embedder). Do **not** put them only in an unlisted dedicated file — Task 2 Verify and Feature verification only run the listed suites.

1. Tagger with `{ model: "x/y", promptTemplate: "Title:{title}" }` uses that model and rendered template (mock LLM captures args).
2. Scorer with `{ model, promptTemplate }` analog (required placeholders present in the fixture template).
3. Drafter with `{ model, promptTemplate }` analog.
4. MMR **or** suppress with `{ model: "embed/custom" }` passes that model to embeddings.

### `execute-run.test.ts`

1. With default phases mocked at the LLM boundary **or** by spying constructors: after claim, tag/score/draft/embed calls use resolved models when newsletter override / global fixtures are provided via mocked `listPromptTemplates` + `getOrCreateAppSettings` + newsletter fields.
2. When `options.tagger` (etc.) is provided, resolution must not replace the mock.
3. Load failure → `markFailed` with operator-safe message; run does not proceed into fetch as success.
4. **Claim-time freeze:** in one `executeRun` invocation that runs **multiple** phases, assert `loadRunLlmResolution` is called **exactly once** (or, if the loader is not injectable, assert `listPromptTemplates` and `getOrCreateAppSettings` are each called exactly once). A builder must not be able to re-fetch per phase and still pass.

### Regression

- `shared/src/pipeline/__tests__/config.test.ts` `getModelName` cases unchanged.
- Existing tagger/scorer/drafter/mmr/suppress/execute-run suites still pass when options omit injection.

## Tasks

### Task 1: Pure `resolveModelId` + tests

- **Action**: Export `ENV_MODEL_KEYS` from `shared/src/pipeline/config.ts`. Create `shared/src/pipeline/resolve-model.ts` with `resolveModelId` (and optional `resolveAllModelIds`). Write `shared/src/pipeline/__tests__/resolve-model.test.ts` covering Testing approach cases 1–6. Export from pipeline barrel / package index as needed.
- **Expected result**: Resolver tests fail until implemented, then pass; `getModelName` still env → built-in only.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/pipeline/__tests__/resolve-model.test.ts src/pipeline/__tests__/config.test.ts`
- **Depends on**: none.

### Task 2: Phase option injection (`model` / `promptTemplate`)

- **Action**: Extend tagger, scorer, drafter, MMR, and suppress options per Spec table. When `promptTemplate` is set, format via `renderPromptTemplate` with the same value maps as today; when `model` is set, pass it to chatCompletion/embeddings instead of `getModelName`. Add the required injection smoke cases **inside** `tagger.test.ts`, `scorer.test.ts`, `drafter.test.ts`, and at least one of `mmr-selection.test.ts` / `cross-run-suppress.test.ts` (see Testing approach). Leave unset path behavior identical for existing tests.
- **Expected result**: Phases accept claim-time overrides; injection smoke lives in the listed suites; default path green.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/pipeline/__tests__/tagger.test.ts src/pipeline/__tests__/scorer.test.ts src/pipeline/__tests__/drafter.test.ts src/pipeline/__tests__/mmr-selection.test.ts src/pipeline/__tests__/cross-run-suppress.test.ts`
- **Depends on**: Task 1 (optional parallel if only adding options; sequential is fine). Soft: Feature 01 `renderPromptTemplate` must exist when executing.

### Task 3: `loadRunLlmResolution` + loader tests

- **Action**: Implement `shared/src/runs/resolve-run-llm.ts` (`loadRunLlmResolution` + `RunLlmResolution` type). Write `shared/src/runs/__tests__/resolve-run-llm.test.ts` covering success cascade (prompt bodies + models from newsletter/global/env) and repository failure surface. Export from runs barrel if needed. Do **not** wire `executeRun` in this task.
- **Expected result**: Loader returns resolved models + three prompt bodies; failure is testable; `executeRun` still unchanged.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/runs/__tests__/resolve-run-llm.test.ts src/pipeline/__tests__/resolve-model.test.ts`
- **Depends on**: Task 1.

### Task 4: `executeRun` wiring + claim-time freeze tests

- **Action**: In `execute-run.ts`, after config build, call `loadRunLlmResolution` once and wrap default phases with injected models/prompts; preserve explicit `ExecuteRunOptions` mocks; log resolved model IDs (not full bodies); on load failure `markFailed` with an operator-safe message. Extend `execute-run.test.ts` for injection, mock override, load failure, and **exactly-once** loader/`listPromptTemplates`+`getOrCreateAppSettings` call count across a multi-phase claim.
- **Expected result**: Default `executeRun` uses DB/env cascade + stored prompts; mocks still win; load errors fail the run; freeze is enforced by a call-count assert.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/runs/__tests__/execute-run.test.ts src/runs/__tests__/resolve-run-llm.test.ts` then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: Task 2, Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared exec vitest run src/pipeline/__tests__/resolve-model.test.ts src/pipeline/__tests__/config.test.ts src/pipeline/__tests__/tagger.test.ts src/pipeline/__tests__/scorer.test.ts src/pipeline/__tests__/drafter.test.ts src/pipeline/__tests__/mmr-selection.test.ts src/pipeline/__tests__/cross-run-suppress.test.ts src/runs/__tests__/resolve-run-llm.test.ts src/runs/__tests__/execute-run.test.ts && pnpm typecheck && pnpm lint`
- Expected: all listed tests green (including phase injection smoke and once-per-claim freeze assert); typecheck and lint clean (ignore benign missing `pages/` eslint noise). Confirmed: GUI unchanged; no new schema; claim-time freeze within one `executeRun`; cascade newsletter → global → env → built-in.

## Handoff

Builder reports: files created/modified; confirmation that `getModelName` remained env → built-in; confirmation that `executeRun` injects resolved models into tagger/scorer/drafter/embedder (MMR + suppress); confirmation that loaded prompt bodies are used when present; confirmation that explicit phase mocks still override; confirmation that load failures markFailed without logging secrets or full prompt bodies; confirmation that execute-run tests assert loader/settings/templates are fetched exactly once per claim. Note any deviation on resume re-resolve (should match Spec: re-resolve each claim, freeze within claim).

## Research notes

- Codegraph / codebase: `getModelName` is env → `DEFAULT_MODELS` only (`shared/src/pipeline/config.ts`); phases call it at LLM time (`tagger` / `scorer` / `drafter` / `mmr-selection` / `cross-run-suppress`).
- Codebase: `executeRun` rebuilds newsletter pipeline config at claim via `buildPipelineConfigForNewsletter`, then runs default `tagArticles` / `scoreArticles` / `selectDiverse` / `NewsletterDrafter` / `suppressCrossRunTopics` — natural injection point after config build.
- Features 04–05 already pin precedence and blank semantics; Feature 01 owns placeholder render + `listPromptTemplates`.
- Stage 07 out of scope: mid-run changes, editor phase, per-newsletter prompts, catalog.
- Web search not required for cascade semantics; OpenRouter id shape already pinned in Feature 04.
- Grizzled Senior review (2026-07-14): added once-per-claim freeze assert; required injection smoke in listed phase test files; split loader vs `executeRun` wiring into Tasks 3–4.
