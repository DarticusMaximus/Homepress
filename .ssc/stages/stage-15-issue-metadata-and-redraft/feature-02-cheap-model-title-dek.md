# Feature 02: Cheap-model title and dek

## Intent

After a successful draft, a cheap-model pass writes an honest issue title and dek onto Feature 01’s stored fields so Home and later surfaces can label the digest (not the lead story) without failing the run if that pass hiccups.

## Spec

Two **new Prompts roles** (`title`, `dek`) share **one** cheap-model slot (`titleDek`). This is a deliberate 2:1 exception to Stage 07’s 1:1 prompt-to-model mapping — not a cheap/expensive architecture (deferred). After Feature 01 extracts title/dek from the draft, run two sequential OpenRouter calls (title, then dek) on the same claim-time model. Each call returns a single plain string. Overlay per field: usable generated text replaces that field; failure keeps the extract. **Never** `markFailed` because this pass failed.

Not a checkpointed pipeline phase. Not on Settings. No Inspect UI. No per-newsletter prompt override (global templates only, unlike `drafterPrompt`).

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| Placement | Prompts page: tabs **Title** and **Dek** after Drafter; one **Title & dek** Default models field (after Drafter, before Embedder); newsletter **Model overrides** gets the same field. |
| Roles | `PromptRole` += `"title" \| "dek"`. Document `$id` is the role. |
| Model slot | `ModelComponent` += `"titleDek"`. Attribute `titleDekModel` (settings + newsletters). Env `TITLE_DEK_MODEL`. Built-in `DEFAULT_MODELS.titleDek` = `nvidia/nemotron-3-nano-30b-a3b`. Cascade: newsletter → global → env → built-in. |
| Placeholders | Both roles **required:** `{draft}`, `{newsletter_name}`. **Allowed:** those plus `{audience}`. No `{articles_json}`. |
| Editorial ask | Title: at most **8 words** (~60 characters). Dek: at most **25 words** (~160 characters). Honest, not clickbait / shock / audience-bait. Prompt-only — no vibe classifier. |
| Output contract | Plain string only. No commentary, formatting, quotes, or markdown. |
| Parse | Trim; unwrap one matching wrap of `"`, `'`, `` ` ``, or a single fenced block; leftover fence → fail that field; strip one leading ATX `#` prefix; collapse whitespace; punctuation-only / empty → fail. Over-ask length is kept if under clamp. |
| Clamp | Title hard-slice `ISSUE_TITLE_ATTR_SIZE` (512). Dek hard-slice `ISSUE_DEK_ATTR_SIZE` (**512**, Feature 01 bump). Do **not** ellipsis-slice LLM dek at `ISSUE_DEK_MAX_CHARS` (160) — that cap stays extract-fallback only. |
| Overlay | Extract first (Feature 01). Title call, then dek call. Independent. Sequential. |
| LLM | `withRetry` + `DEFAULT_TIMEOUT_MS` (60s, 3 attempts) like tagger. `extraBody.max_completion_tokens` = **4000** both calls (`TITLE_DEK_MAX_COMPLETION_TOKENS`). No drafter `reasoning_effort`. `messages: [{ role: "user", content: rendered }]`. |
| Claim freeze | `loadRunLlmResolution` loads both prompt bodies + `models.titleDek` once with the other roles. Mid-run GUI edits do not affect that claim. |
| Logging | Failures: `phase: "generate-issue-title"` / `"generate-issue-dek"` via `sanitizeAppwriteMessageForLog`. Do not log raw draft or completion text. |

### Shipped defaults (byte-identical in `shared/src/prompts/defaults.ts`)

**Title (`SHIPPED_TITLE_PROMPT`):**

```
Read the newsletter draft below for "{newsletter_name}".

Audience (context only — do not write clickbait, shock, or bait aimed at them): {audience}

Write an honest issue title of at most 8 words (about 60 characters). Name this digest as a whole, not the lead story.

Return only the title string. No commentary, no formatting, no quotes, no markdown, nothing else.

Draft:
{draft}
```

**Dek (`SHIPPED_DEK_PROMPT`):**

```
Read the newsletter draft below for "{newsletter_name}".

Audience (context only — do not write clickbait, shock, or bait aimed at them): {audience}

Write an honest one- or two-sentence summary of at most 25 words (about 160 characters). Name this digest as a whole, not the lead story.

Return only the summary string. No commentary, no formatting, no quotes, no markdown, nothing else.

Draft:
{draft}
```

`SHIPPED_PROMPT_DEFAULTS` / `getShippedPromptDefault` must include both. Reset-to-default uses that map automatically once roles exist. Shipped bodies must validate with empty warnings.

### Overlay in `executeRun` (pinned)

After a non-empty draft checkpoint, **after** Feature 01’s extract try/catch and **before** the `markCompleted` try / one-retry, overlay:

```ts
try {
  const generated = await generateIssueTitle(/* claim-time model, title prompt, draft, newsletter name, audience, llm */);
  if (generated !== null) issueTitle = generated;
} catch (err) {
  console.error({ phase: "generate-issue-title", runId, message: sanitizeAppwriteMessageForLog(...) });
}
try {
  const generated = await generateIssueDek(/* same llm + titleDek model, dek prompt, ... */);
  if (generated !== null) issueDek = generated;
} catch (err) {
  console.error({ phase: "generate-issue-dek", runId, message: sanitizeAppwriteMessageForLog(...) });
}
```

Pass the same locals into **both** `markCompleted` attempts. Empty-draft fatal path still skips this pass. Auto-deliver still runs only after successful complete (unchanged).

`generateIssueTitle` / `generateIssueDek` in `shared/src/pipeline/issue-metadata.ts`: render template, `withRetry(chatCompletion)`, parse/clamp, return `string | null`. LLM/parse/retry exhaustion → `null` + log inside the function. Inject defaults via `ExecuteRunOptions.generateIssueTitle` / `generateIssueDek` so execute-run tests stay hermetic.

`{draft}` = full `draftResult.markdown` (no extra truncation). `{newsletter_name}` = `config.name`. `{audience}` = `config.audience` (may be `""`).

### GUI (pinned)

| Surface | Behavior |
|---|---|
| Prompts tabs | Iterate `PROMPT_ROLES`. Labels: Tagger, Scorer, Drafter, **Title**, **Dek**. Placeholder chips from `PROMPT_PLACEHOLDERS`. Reset dialog labels for the two new roles. |
| Default models | Fifth field **Title & dek**, `titleDekModel`, placeholder `DEFAULT_MODELS.titleDek`. Save still one **Save models** for all fields. Helper copy lists `TITLE_DEK_MODEL`. |
| Newsletter overrides | Field **Title & dek**, `name="titleDekModel"`, placeholder **Use global default**. Blank = no override. Create + edit + actions wiring. |

## Dependencies

- Builds on: **feature-01-persist-title-and-dek** (`issueTitle` / `issueDek`, `buildIssueMetadataFromMarkdown`, `markCompleted` metadata, extract-before-complete). Feature 01 must be executed first.
- Builds on: Stage 07 prompt store, Prompts editor, reset, global models, newsletter overrides, `loadRunLlmResolution`.
- Unlocks: Feature 03 (surfaces prefer stored), Feature 04 (regenerate re-runs this pass).

## Constraints

- Do not fail a run because title/dek generation failed, returned empty, or was skipped.
- Do not add a checkpointed phase, Inspect panel, or Settings page for this pass.
- Do not change Home / channel / email / RSS resolvers (Feature 03).
- Do not add regenerate-draft (Feature 04).
- Do not introduce a second `titleDek` model field (one shared slot).
- Do not 160-ellipsis-slice LLM dek; do not change `ISSUE_DEK_MAX_CHARS` extract behavior.
- Do not drop / rename / retype existing attributes except **increasing** `issueDek` size 256 → 512 in declarations (Feature 01 ships 512; live DBs that already provisioned 256: Appwrite allows size increase — if the create-if-absent provisioner cannot enlarge, add a one-shot size update in the provisioner for `issueDek` only, with a test). Prefer Feature 01 executing with 512 so greenfield never sees 256.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] Prompts page has Title and Dek tabs; shipped defaults are editable; reset restores shipped text; next claim uses the saved bodies.
- [ ] Global Default models and per-newsletter Model overrides include **Title & dek** (`titleDekModel`); blank falls through to `TITLE_DEK_MODEL` then `nvidia/nemotron-3-nano-30b-a3b`.
- [ ] After a successful draft, `executeRun` extracts then overlays generated title/dek when both calls return usable strings.
- [ ] Title-call failure keeps extracted title; dek still runs. Dek-call failure keeps extracted dek. Run completes.
- [ ] Both calls fail (or return null) → stored fields are the Feature 01 extract (or `""` if extract was empty). Run completes; `markFailed` not called for this pass.
- [ ] Generated strings are clamped to 512; LLM dek is not ellipsis-sliced at 160.
- [ ] Surfaces still resolve titles from draft parse (Feature 03).

## Files

- Modify: `shared/src/prompts/types.ts`, `defaults.ts`, `contract` tests, `repository` tests
- Modify: `shared/src/pipeline/config.ts` — `titleDek` in `ModelComponent`, `DEFAULT_MODELS`, `ENV_MODEL_KEYS`
- Modify: `shared/src/pipeline/__tests__/config.test.ts` — exact-equals includes `titleDek`
- Modify: `shared/src/pipeline/resolve-model.ts` (+ tests)
- Modify: `shared/src/settings/{types,model-defaults,repository}.ts` (+ tests)
- Modify: `shared/src/newsletters/{types,validation,repository}.ts` (+ tests)
- Modify: `shared/src/schema/declarations.ts` (+ `declarations.test.ts`) — `titleDekModel` on `app_settings` and `newsletters`; `ISSUE_DEK_ATTR_SIZE` 512 if not already
- Modify: `shared/src/runs/resolve-run-llm.ts` (+ tests) — `prompts.title` / `prompts.dek` / `models.titleDek`
- Create: `shared/src/pipeline/issue-metadata.ts` + `shared/src/pipeline/__tests__/issue-metadata.test.ts`
- Modify: `shared/src/runs/issues.ts` — export `isEmptyOrPunctuationOnly` (or a shared sanitize used by parse); parse/clamp helpers if co-located
- Modify: `shared/src/runs/execute-run.ts` + `shared/src/runs/__tests__/execute-run.test.ts`
- Modify: `web/components/prompts/{prompts-editor,reset-prompt-dialog,global-model-defaults}.tsx` + `web/src/__tests__/prompts-editor.test.tsx` + `global-model-defaults.test.tsx`
- Modify: `web/app/(protected)/admin/prompts/{page,actions}.ts(x)` + `web/src/__tests__/prompts-actions.test.ts`
- Modify: `web/components/newsletters/newsletter-model-override-fields.tsx` + form tests
- Modify: `web/app/(protected)/admin/newsletters/actions.ts` + newsletter action tests
- Modify: `.env.example` — commented `# TITLE_DEK_MODEL=`
- Modify: every `Newsletter` / `AppSettings` / `GlobalModelDefaults` / `RunLlmResolution` fixture that must typecheck (`titleDekModel: ""` or the new prompt keys)

## Testing approach

Test-first. Unit tests only; no live OpenRouter; no screenshots.

### Test cases

**Prompts**

1. `PROMPT_ROLES` is `tagger, scorer, drafter, title, dek`. Required/allowed maps as pinned. Shipped title/dek validate `ok` with empty warnings. Missing `{draft}` rejects. Unknown `{foo}` warns but allows save.
2. `listPromptTemplates` get-or-creates five roles in that order (repository test, mock Appwrite).

**Models / schema**

3. `DEFAULT_MODELS.titleDek === "nvidia/nemotron-3-nano-30b-a3b"`; `ENV_MODEL_KEYS.titleDek === "TITLE_DEK_MODEL"`. Update `shared/src/pipeline/__tests__/config.test.ts` exact-equals of `DEFAULT_MODELS` to include `titleDek` (the “legacy dict literal” comment no longer applies to that key).
4. `resolveModelId("titleDek", {})` returns the nemotron built-in; newsletter override wins; then global; then env.
5. `app_settings` and `newsletters` declare optional `titleDekModel` string size 256. Settings attrs length **20**; newsletters sorted keys include `titleDekModel`. `ISSUE_DEK_ATTR_SIZE === 512`.
6. `updateGlobalModelDefaults` / newsletter create+update persist `titleDekModel`; empty → `""`; invalid id rejects the whole write (same rules as existing `normalizeModelIdFields` / Stage 07 Feature 04 — not this stage’s regenerate-draft).

**Parse + LLM module**

7. `"  \"Hello World\"  "` → `"Hello World"`. `` `# Hello World` `` → `"Hello World"`. Fenced leftover / `""` / `"..."` → `null`.
8. Title 600 chars → length 512. Dek 600 chars → length 512, no `…` from the 160 extractor.
9. Mock `chatCompletion` resolves `{ content: "Hello World", raw: {} }` (not a bare string). Production reads `result.content` (same as tagger). Assert `extraBody.max_completion_tokens === 4000`, `timeoutMs: DEFAULT_TIMEOUT_MS`, model from args, rendered prompt containing the draft. Retry exhaustion → `null` (mock `withRetry` or failing client).
10. Dek generator: mock `{ content: "A calm digest dek.", raw: {} }`; uses the dek template and the **same** model id; same `extraBody.max_completion_tokens === 4000`.

**executeRun**

11. Happy path: extract would be Feature 01 strings; injected generators return `"Generated Title"` / `"Generated dek sentence."` → `markCompleted` once with those generated strings.
12. Title generator returns `null`, dek returns a string → completed title is extract, dek is generated.
13. Both throw → completed fields are extract; `markFailed` not called; logs use the generate-issue-\* phases (not `mark-completed-retry`).
14. Empty-draft fatal: generators not called.
15. C5 complete-retry: both payloads include the **same** post-overlay strings.
16. **Default-path wiring (no generator stubs).** Do not pass `generateIssueTitle` / `generateIssueDek`. Extend `defaultPromptTemplates()` with `title` / `dek` bodies containing `TITLE_PROMPT_CANARY` / `DEK_PROMPT_CANARY` plus required placeholders. Set newsletter or settings `titleDekModel` to `vendor/title-dek-canary`. Extend the existing `MockLLMClient` in `execute-run.test.ts` with `chatCompletion` that resolves `{ content: "Canary Title", raw: {} }` then `{ content: "Canary dek here.", raw: {} }`. Assert two calls: `model === "vendor/title-dek-canary"`; first `messages[0].content` includes `TITLE_PROMPT_CANARY` and the draft markdown; second includes `DEK_PROMPT_CANARY`; both `extraBody.max_completion_tokens === 4000`. `markCompleted` stores the parsed contents.

**GUI**

17. Prompts editor shows Title and Dek tabs (update the existing “three role tabs” / “all three roles” cases in `web/src/__tests__/prompts-editor.test.tsx` to five). Default models shows **Title & dek**.
18. Newsletter form shows **Title & dek** override named `titleDekModel`.
19. `updateGlobalModelDefaultsAction` / newsletter actions include `titleDekModel` in the payload.

Feature 01 extract tests and overlay tests 11–15 **must** inject generator stubs (`null` or canned strings) so they do not call `chatCompletion`. Default the execute-run test helper to stub generators to `null`. Test 16 is the only unstubbed default-path test.

## Tasks

### Task 1: Prompt roles and shipped defaults

- **Action**: Write failing contract/repository tests 1–2. Extend `PROMPT_ROLES`, required/allowed maps, `SHIPPED_TITLE_PROMPT` / `SHIPPED_DEK_PROMPT`, and `SHIPPED_PROMPT_DEFAULTS` in `shared/src/prompts/{types,defaults}.ts`. Shipped strings must be the pinned text above. `listPromptTemplates` already loops `PROMPT_ROLES` — no repository loop change unless tests prove otherwise.
- **Expected result**: Five roles; shipped title/dek validate; list seeds `title` and `dek` documents.
- **Verify**: `pnpm exec vitest run shared/src/prompts/__tests__/contract.test.ts shared/src/prompts/__tests__/repository.test.ts`
- **Depends on**: none (Feature 01 need not be done for this task).

### Task 2: Shared `titleDek` model slot

- **Action**: Write failing tests 3–6. Add `titleDek` to `ModelComponent` / `DEFAULT_MODELS` / `ENV_MODEL_KEYS`. Add `titleDekModel` on `app_settings` + `newsletters` (schema, settings types/repo/validation, newsletter types/validation/repo). Extend `resolveAllModelIds` and `loadRunLlmResolution` (`prompts.title`/`dek`, `models.titleDek`). Comment `# TITLE_DEK_MODEL=` in `.env.example`. Default `titleDekModel: ""` on fixtures until typecheck is clean.
- **Expected result**: Cascade works; claim-time resolution includes both prompts and one model id.
- **Verify**: `pnpm exec vitest run shared/src/pipeline/__tests__/config.test.ts shared/src/pipeline/__tests__/resolve-model.test.ts shared/src/runs/__tests__/resolve-run-llm.test.ts shared/src/schema/__tests__/declarations.test.ts shared/src/settings/__tests__/model-defaults.test.ts shared/src/settings/__tests__/repository.test.ts shared/src/newsletters/__tests__/repository.test.ts shared/src/newsletters/__tests__/validation.test.ts` and `pnpm typecheck`
- **Depends on**: Task 1.

### Task 3: LLM pass module

- **Action**: Write failing tests 7–10. Implement parse/clamp (reuse `isEmptyOrPunctuationOnly` from `shared/src/runs/issues.ts` — export it if still private) and `generateIssueTitle` / `generateIssueDek` in `shared/src/pipeline/issue-metadata.ts` using `renderPromptTemplate`, `withRetry`, and `LLMClient.chatCompletion` with `TITLE_DEK_MAX_COMPLETION_TOKENS = 4000`. Read `result.content` from `{ content, raw }` — never treat the result as a bare string. Export the constant from that module.
- **Expected result**: Mocked calls match budget/timeout; parse/clamp match pins; failures return `null`.
- **Verify**: `pnpm exec vitest run shared/src/pipeline/__tests__/issue-metadata.test.ts shared/src/runs/__tests__/issues.test.ts`
- **Depends on**: Task 2.

### Task 4: executeRun overlay

- **Action**: Write failing tests 11–16. Extend `ExecuteRunOptions` with optional `generateIssueTitle` / `generateIssueDek`. In `shared/src/runs/execute-run.ts`, after Feature 01 extract and before `markCompleted`, run the overlay as pinned. Default implementations call the Task 3 functions with claim-time `resolution.models.titleDek`, `resolution.prompts.title` / `.dek`, `llm`, and newsletter name/audience/draft. Confirm `ISSUE_DEK_ATTR_SIZE === 512`. Include `titleDek` on the existing `llm-resolution` log `models` / `promptLengths` objects (no raw bodies). Default the execute-run test helper to stub generators `null`; test 16 omits those stubs.
- **Expected result**: Overlay semantics hold; extract-only when generators return null; complete retry keeps overlay strings; production default path uses claim-time title/dek prompts and `models.titleDek`.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/execute-run.test.ts`
- **Depends on**: Task 3 and Feature 01 executed.

### Task 5: Prompts GUI

- **Action**: Write failing tests 17 and 19 (prompts side). Add **Title** / **Dek** to `ROLE_LABELS` in `web/components/prompts/prompts-editor.tsx` and `reset-prompt-dialog.tsx`. Add **Title & dek** to `web/components/prompts/global-model-defaults.tsx`, `web/app/(protected)/admin/prompts/page.tsx`, and `actions.ts` (`GlobalModelDefaultsInput` + Pick on settings). Update `web/src/__tests__/prompts-editor.test.tsx` (five tabs, not three), `global-model-defaults.test.tsx`, and `prompts-actions.test.ts`.
- **Expected result**: Operator can edit both templates and save the shared model default on `/admin/prompts`.
- **Verify**: `pnpm exec vitest run web/src/__tests__/global-model-defaults.test.tsx web/src/__tests__/prompts-actions.test.ts web/src/__tests__/prompts-editor.test.tsx`
- **Depends on**: Task 2.

### Task 6: Newsletter override GUI

- **Action**: Write failing tests 18–19 (newsletter side). Add the field to `web/components/newsletters/newsletter-model-override-fields.tsx`, `web/app/(protected)/admin/newsletters/actions.ts`, and fixtures in `web/src/__tests__/newsletter-form-model-overrides.test.tsx` / `newsletters-actions.test.ts` / other Newsletter stubs that fail typecheck.
- **Expected result**: Create/edit persist `titleDekModel`; blank means global cascade.
- **Verify**: `pnpm exec vitest run web/src/__tests__/newsletter-form-model-overrides.test.tsx web/src/__tests__/newsletters-actions.test.ts` then `pnpm typecheck` and `pnpm lint`
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm exec vitest run shared/src/prompts/__tests__/contract.test.ts shared/src/prompts/__tests__/repository.test.ts shared/src/pipeline/__tests__/config.test.ts shared/src/pipeline/__tests__/resolve-model.test.ts shared/src/pipeline/__tests__/issue-metadata.test.ts shared/src/runs/__tests__/resolve-run-llm.test.ts shared/src/runs/__tests__/execute-run.test.ts shared/src/schema/__tests__/declarations.test.ts shared/src/settings/__tests__/model-defaults.test.ts shared/src/settings/__tests__/repository.test.ts shared/src/newsletters/__tests__/validation.test.ts web/src/__tests__/global-model-defaults.test.tsx web/src/__tests__/prompts-actions.test.ts web/src/__tests__/prompts-editor.test.tsx web/src/__tests__/newsletter-form-model-overrides.test.tsx web/src/__tests__/newsletters-actions.test.ts` then `pnpm typecheck` and `pnpm lint`
- Expected: listed tests pass; typecheck clean; lint clean (ignore leftover `pages/` warning). A completed run stores overlay title/dek when the cheap pass succeeds, Feature 01 extract when it does not, and the Prompts page exposes two templates plus one Title & dek model field.

## Handoff

Report files changed, that `title`/`dek` share `titleDekModel`, the 4000-token budget, and the Feature 01 dek size (512). Confirm surfaces were **not** switched to stored fields (Feature 03) and regenerate was **not** added (Feature 04). Note any extra fixtures touched for typecheck. If the provisioner needed an `issueDek` size enlarge for an already-provisioned 256 attribute, say so.

### Research notes

- Stage 07: `PROMPT_ROLES` / Prompts tabs / `MODEL_COMPONENTS` / `loadRunLlmResolution` (`shared/src/runs/resolve-run-llm.ts`). Tagger already uses `withRetry` + `DEFAULT_TIMEOUT_MS` and does not set `max_completion_tokens`; drafter passes `max_completion_tokens` via `extraBody` (`shared/src/pipeline/drafter.ts`).
- Feature 01 persist: extract in its own try/catch before `markCompleted`; this feature overlays between those two steps.
- `app_settings` currently 19 attributes; `runs` 25 today / 27 after Feature 01. Provisioner is create-if-absent.
- Grill pins (2026-08-20): two prompts, one cheap model, nemotron default, independent overlay, word-asks with 512 clamps, 4000 completion tokens because cheap models spend budget thinking.
