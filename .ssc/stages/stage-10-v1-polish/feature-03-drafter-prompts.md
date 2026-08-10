# Feature 03: Drafter prompts

## Intent

Wire `{audience}` into the drafter placeholder contract and runtime, ship a more generic default drafter that asks for a newsletter title as the first heading, and let each newsletter optionally override the global drafter template — so draft voice and issue titles track the newsletter’s audience without a separate title LLM call.

## Spec

### Placeholder contract (pinned)

Extend the Stage 07 drafter contract in `shared/src/prompts/types.ts`:

| Role | Required (unchanged) | Allowed (add) |
|------|----------------------|---------------|
| `drafter` | `{newsletter_name}`, `{topics}`, `{articles_json}`, `{count}` | **`{audience}`** (new) |

- `{audience}` is **allowed, not required** — existing global templates without it keep validating and saving.
- Prompts editor badges (`PROMPT_PLACEHOLDERS` / `PROMPT_ALLOWED_PLACEHOLDERS`) pick up `{audience}` automatically.
- Same save rules as Stage 07: missing required → reject; unknown `{name}` → warn but allow (global editor); runtime leaves unknown tokens literal.

### Runtime injection (pinned)

Every drafter render (shipped callable, injected `promptTemplate`, global or override) substitutes:

| Placeholder | Value |
|-------------|--------|
| `newsletter_name` | newsletter / config name (unchanged) |
| `topics` | joined topics or `"technology news"` fallback (unchanged) |
| `articles_json` | JSON payload (unchanged) |
| `count` | `String(count)` (unchanged) |
| `audience` | trimmed newsletter `audience`; empty → `""` (no invented fallback string) |

**Draft API shape (pinned — do not leave open):**

`draftNewsletter` already takes a 5th `options?` argument. Put audience on the options object, not as a competing positional 5th param:

| Surface | Signature |
|---------|-----------|
| `NewsletterDrafter.draft` | `draft(articles, newsletterName, topics, count, audience = "")` |
| `draftNewsletter` | `draftNewsletter(articles, newsletterName, topics, count, options?)` where `NewsletterDrafterOptions` gains **`audience?: string`** (default `""` when constructing/`draft` is called). `draftNewsletter` forwards `options?.audience ?? ""` into `draft`. |
| `DRAFTER_PROMPT_TEMPLATE` | args gain **`audience?: string`** (default `""` in the value map). |

**Call sites:**

1. Implement the API shape above; inject `audience` into every render value map (shipped + `promptTemplate` paths).
2. `executeRun` passes `config.audience` into `drafter.draft(...)` (5th positional arg).
3. `runPipeline` passes `config.audience` into `drafter.draft(...)` (5th positional arg).
4. When `promptTemplate` is set, the value map **must** include `audience` (same map as shipped path).

### Prompt resolution precedence (pinned)

At claim time in `loadRunLlmResolution` (or a thin helper it calls), effective drafter body is:

1. Newsletter `drafterPrompt` if **non-empty after trim**
2. Else global `prompt_templates` document `drafter` body (existing `listPromptTemplates` path)

Models resolution unchanged. Claim-time freeze still applies (resolve once per `executeRun` invocation).

### Schema: per-newsletter override (pinned)

Append one optional attribute to `newsletters` in `shared/src/schema/declarations.ts` (create-if-absent; no drop/rename/retype/migrate):

| Attribute | Type | Size | Required | Default on create |
|-----------|------|------|----------|-------------------|
| `drafterPrompt` | string | **50000** | false | `""` |

Mirror Stage 07 Feature 05 model-override patterns:

- Extend `Newsletter`, `CreateNewsletterInput`, `UpdateNewsletterInput`, `NewsletterFields`.
- `documentToNewsletter`: missing/null → `""`.
- Create: omit → `""`; create UI stays Basics-only (Feature 02) — do **not** collect override on create.
- Update: always write `drafterPrompt` with definition fields (explicit `""` clears override).
- Validation when non-empty after trim:
  1. Length ≤ 50000.
  2. `validatePromptTemplate("drafter", body).ok` — missing required placeholders → `NewsletterRepositoryError` `validation` listing missing names.
  3. Unknown placeholders: **allow** (same as global save); warnings optional on the action result — not required in UI.
- Empty / whitespace-only → store `""` (use global).

Form field name: **`drafterPrompt`** (FormData key matches attribute).

### Shipped default drafter (pinned)

Replace `SHIPPED_DRAFTER_PROMPT` in `shared/src/prompts/defaults.ts` with a more generic template that:

1. Uses all five placeholders: `{newsletter_name}`, `{topics}`, `{audience}`, `{count}`, `{articles_json}`.
2. Instructs the model to open with a **newsletter title as the first markdown heading** (`# …`) — Stage 06 `resolveIssueDisplayTitle` / `extractFirstMarkdownHeading` already prefer that heading; no separate title LLM.
3. Drops the legacy rigid length mandates (1000+ word featured / ~500 word summaries) in favor of concise, factual digests suitable for email/RSS.
4. Uses `{audience}` for voice/reader needs; when audience is empty, instruct writing for a general tech-curious reader **in the template prose** (do not invent a non-empty injection string).

**Pinned template body** (byte-stable for tests — builder must use this exact string, including newlines):

```
**Goal** Write a factual markdown newsletter draft for "{newsletter_name}".

**Audience** {audience}
(If audience is empty, write for a general tech-curious reader.)

**Role** Clear technology writer. Prioritize: {topics}.

**Rules**
- Start with a single newsletter title as the first line: `# <Title>` (this is the issue title — make it specific to this issue’s contents, not just the newsletter name).
- Then write {count} items from the articles below (fewer only if the set is smaller).
- One featured item first (deeper), then shorter summaries for the rest.
- Plain, easy-to-understand English. Fact-based. Neutral tone.
- Include the source link under each item.
- Use Markdown (`##` for item headings after the title).
- No preamble before the `#` title. No closing sign-off.

**Articles (JSON)**

---

{articles_json}

---

Write the newsletter using the provided articles.
```

**Existing Appwrite seed pin:** `getOrCreatePromptTemplate` does **not** rewrite an already-seeded `drafter` document. Operators who already have the old body must use **Reset to shipped default** on `/prompts` (or paste the new text) to pick up the new default. Spec tests cover the **code** constant + reset path, not a live DB migrate.

### GUI (pinned — Feature 02 surface)

On the newsletter **edit page** Advanced tab (`newsletter-edit-form.tsx` or whatever Feature 02 names it), **below Model overrides**:

| Element | Behavior |
|---------|----------|
| Heading | **Drafter prompt** |
| Control | `<textarea name="drafterPrompt">` (monospace), prefilled from `newsletter.drafterPrompt` |
| Helper | e.g. `Leave blank to use the global Drafter template on Prompts. Placeholders: {newsletter_name}, {topics}, {audience}, {articles_json}, {count}.` |
| Optional | Same placeholder badges as Prompts editor for drafter (`PROMPT_PLACEHOLDERS.drafter`) — encouraged, not required |
| Save | Part of the edit form Save (Feature 02 forceMount — inactive Advanced tab must still submit `drafterPrompt`) |
| Create | No field (Basics-only dialog); repository default `""` |

Do **not** add a sixth tab. Do **not** put this on the create dialog.

### Out of scope

- Separate post-draft LLM title call (Stage 10 / Plan decision).
- Changing `resolveIssueDisplayTitle` / Issues list enrichment.
- Per-newsletter overrides for tagger or scorer prompts.
- Auto-migrating existing Appwrite `prompt_templates` drafter bodies.
- Changing delivery / schedule / model precedence.

### Research notes (shaped decisions)

- Stage 07 Feature 01 required set for drafter omits audience; Stage 10 asks to wire `{audience}` — kept **optional** so custom globals stay valid.
- Feature 02 explicitly reserves Advanced for Model overrides + this Drafter prompt block; edit is `/newsletters/[id]`, not a dialog.
- Stage 06 already titles issues from the draft’s first markdown heading — template instruction is the V1 title path.
- Codegraph: `PROMPT_REQUIRED_PLACEHOLDERS.drafter`, `SHIPPED_DRAFTER_PROMPT`, `loadRunLlmResolution`, `NewsletterDrafter.draft`, `executeRun` / `runPipeline` draft calls; audience already on `Newsletter` / `NewsletterConfig` but unused by drafter today.

## Dependencies

- Builds on: Stage 07 prompt store + validation + run-time resolution (`validatePromptTemplate`, `renderPromptTemplate`, `loadRunLlmResolution`, Prompts reset); Stage 03 `audience` field; Stage 06 first-heading display title.
- Builds on: Stage 10 Feature 02 newsletter edit page + Advanced tab (UI home for the override). **Execute Feature 02 before this feature** (or land the edit page first if sessions reorder).
- Soft: Stage 10 Feature 01 does not block this feature.

## Constraints

- Schema-as-code only; create-if-absent for `drafterPrompt`.
- Do not change tagger/scorer placeholder contracts.
- Do not change model resolution precedence.
- Blank `drafterPrompt` must mean global template — never copy global body into the newsletter document on save.
- Keep FormData / attribute name `drafterPrompt`.
- Edit UI only on Advanced tab of the Feature 02 edit page (not create dialog).
- Do not auto-overwrite existing seeded global drafter documents in Appwrite.

## Acceptance criteria

- [ ] Drafter allowed placeholders include `{audience}`; required set unchanged; Prompts editor shows `{audience}` for drafter.
- [ ] Runs inject the newsletter’s audience into drafter renders (global and override paths), including `runPipeline` / `executeRun` call sites (spy-tested).
- [ ] Non-empty `drafterPrompt` on a newsletter is used for that newsletter’s runs; blank uses the global drafter template.
- [ ] `SHIPPED_DRAFTER_PROMPT` is byte-identical to the pinned template body; Reset on Prompts restores that exact body.
- [ ] Advanced tab on `/newsletters/[id]` exposes Drafter prompt textarea; Save persists; empty clears override; create does not collect it.
- [ ] Invalid non-empty override (missing required placeholders / oversize) is rejected with a validation error; no partial definition write.

## Files

- Modify: `shared/src/prompts/types.ts` — add `audience` to drafter allowed list
- Modify: `shared/src/prompts/defaults.ts` — replace `SHIPPED_DRAFTER_PROMPT` with pinned body
- Modify: `shared/src/pipeline/drafter.ts` — inject `audience` in render maps + API
- Modify: `shared/src/pipeline/orchestrator.ts` — pass `config.audience`
- Modify: `shared/src/runs/execute-run.ts` — pass `config.audience`
- Modify: `shared/src/runs/resolve-run-llm.ts` — prefer newsletter `drafterPrompt` when set
- Modify: `shared/src/schema/declarations.ts` — `drafterPrompt` attribute size 50000
- Modify: `shared/src/newsletters/types.ts` — field on Newsletter / inputs / NewsletterFields
- Modify: `shared/src/newsletters/validation.ts` — validate override when non-empty
- Modify: `shared/src/newsletters/repository.ts` — read/write/`documentToNewsletter`
- Modify: `web/app/(protected)/newsletters/actions.ts` — read `drafterPrompt` on update (and create default path if needed)
- Modify: `web/components/newsletters/newsletter-edit-form.tsx` (or Feature 02 equivalent) — Advanced Drafter prompt block
- Modify tests:
  - `shared/src/prompts/__tests__/contract.test.ts`
  - `shared/src/prompts/__tests__/repository.test.ts` (shipped body / reset — **exact** equality to pinned `SHIPPED_DRAFTER_PROMPT`)
  - `shared/src/pipeline/__tests__/drafter.test.ts`
  - `shared/src/pipeline/__tests__/orchestrator.test.ts` — mock drafter; assert `draft` called with `config.audience`
  - `shared/src/runs/__tests__/execute-run.test.ts` — mock drafter; assert `draft` called with `config.audience`
  - `shared/src/runs/__tests__/resolve-run-llm.test.ts`
  - `shared/src/newsletters/__tests__/…` validation/repository as applicable
  - `web/src/__tests__/prompts-editor.test.tsx` (badge includes audience)
  - Create: `web/src/__tests__/newsletter-form-drafter-prompt.test.tsx` (Advanced field + save)
- Optional: `shared/src/schema/__tests__/declarations.test.ts` if it asserts attribute lists

## Testing approach

Test-first for contract, resolution, shipped body, and form wiring.

**Prompt contract / defaults:**

1. `validatePromptTemplate("drafter", …)` still requires the four original placeholders; passes without `{audience}`.
2. Template with `{audience}` validates; `{audience}` is in allowed list (not an unknown warning).
3. `SHIPPED_DRAFTER_PROMPT ===` the pinned template body byte-for-byte (exact equality only — no substring escape hatch).
4. `getShippedPromptDefault("drafter")` / reset path returns that same exact body.

**Drafter render:**

5. With `promptTemplate` containing `{audience}`, rendered prompt includes the passed audience string.
6. Empty audience → `{audience}` replaced with `""` (token not left literal when key is provided).
7. Shipped `DRAFTER_PROMPT_TEMPLATE` path also substitutes audience when provided.

**Call-site wiring (required — prevents silent skip of audience):**

8. `runPipeline`: with a mock `drafter` whose `draft` is a spy, after a successful path that reaches draft (or a minimal fixture that forces the draft call), assert `draft` was called with `config.audience` as the 5th argument (extend `shared/src/pipeline/__tests__/orchestrator.test.ts` or add a focused case there).
9. `executeRun`: with a mock `options.drafter` spy, assert the draft-phase call passes the newsletter config’s audience as the 5th argument (extend `shared/src/runs/__tests__/execute-run.test.ts`). Skipping these call sites must fail the suite — default `audience = ""` must not green the Intent.

**Resolution:**

10. `loadRunLlmResolution`: newsletter `drafterPrompt` non-empty → `prompts.drafter` is that body; empty/`""` → global template body.
11. Models still resolve independently (existing tests remain green).

**Newsletter persistence:**

12. Update with valid override persists; blank clears to `""`.
13. Override missing `{newsletter_name}` (or other required) → validation error; no write.
14. Create without field → `drafterPrompt: ""`.

**Web:**

15. Edit form Advanced: textarea `name="drafterPrompt"` present under a Drafter prompt heading; submit includes value when Advanced was not the active tab (forceMount — assert FormData or mock action args).
16. Prompts editor drafter badges include `{audience}`.

**Not test-first:** live Appwrite provision of the new attribute (verifier confirms declarations + create-if-absent pattern); LLM quality of the new template wording.

## Tasks

### Task 1: Failing tests — contract, shipped body, audience render, call sites, resolution

- **Action:** Extend/add failing tests in `shared/src/prompts/__tests__/contract.test.ts`, defaults/repository tests for **exact** pinned `SHIPPED_DRAFTER_PROMPT`, `shared/src/pipeline/__tests__/drafter.test.ts` for `{audience}` substitution, orchestrator + execute-run spy tests that `draft` receives `config.audience` (Testing approach items 8–9), and `shared/src/runs/__tests__/resolve-run-llm.test.ts` for newsletter override vs global. Add newsletter validation/repository failing cases for `drafterPrompt` if those suites exist (or create focused tests under `shared/src/newsletters/__tests__/`).
- **Expected result:** Tests exist and fail against current code (no `audience` in allowed set / no override field / old shipped body / call sites not passing audience).
- **Verify:** Targeted vitest runs show the new assertions failing for the right reasons.
- **Depends on:** none.

### Task 2: Contract + shipped default + drafter API + call-site injection

- **Action:** Add `audience` to drafter allowed placeholders. Replace `SHIPPED_DRAFTER_PROMPT` with the pinned body (exact). Implement the pinned API: `draft(..., count, audience = "")`; `NewsletterDrafterOptions.audience?` forwarded by `draftNewsletter`; `DRAFTER_PROMPT_TEMPLATE` args include `audience?`. Pass `config.audience` from `execute-run.ts` and `orchestrator.ts` as the 5th `draft` arg. Keep required placeholders unchanged.
- **Expected result:** Contract + drafter render + orchestrator/execute-run audience call-site tests pass; shipped constant matches pin byte-for-byte; typecheck clean.
- **Verify:** `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/contract.test.ts src/pipeline/__tests__/drafter.test.ts src/pipeline/__tests__/orchestrator.test.ts src/runs/__tests__/execute-run.test.ts` (plus defaults/repository if touched); `pnpm typecheck`.
- **Depends on:** Task 1.

### Task 3: Schema + newsletter field + resolve-run-llm override

- **Action:** Declare `drafterPrompt` (string 50000, optional). Wire types, validation (non-empty → `validatePromptTemplate`), repository create/update/read. Update `loadRunLlmResolution` to prefer trimmed newsletter override for `prompts.drafter`. Update schema/newsletter tests.
- **Expected result:** Override resolution and persistence tests pass; blank falls back to global.
- **Verify:** `pnpm --filter @newsletter/shared exec vitest run src/runs/__tests__/resolve-run-llm.test.ts` + newsletter tests; `pnpm typecheck`.
- **Depends on:** Task 2.

### Task 4: Edit-page Advanced UI + actions + web tests

- **Action:** On Feature 02 edit form Advanced tab, add **Drafter prompt** block + `name="drafterPrompt"` textarea (helper copy; optional badges). Wire `updateNewsletterAction` to pass `drafterPrompt`. Add `web/src/__tests__/newsletter-form-drafter-prompt.test.tsx`; update `prompts-editor.test.tsx` for `{audience}` badge. Do not add to create dialog.
- **Expected result:** Save from Advanced (or another tab with forceMount) persists override; Prompts UI lists `{audience}`.
- **Verify:** `pnpm --filter web exec vitest run src/__tests__/newsletter-form-drafter-prompt.test.tsx src/__tests__/prompts-editor.test.tsx`; `pnpm typecheck`; `pnpm lint`.
- **Depends on:** Task 3; Feature 02 edit page present.

### Task 5: Feature gate

- **Action:** Run full verification; fix fallout in execute-run / orchestrator / form tests. Confirm handoff notes the Appwrite seed non-migration pin.
- **Expected result:** All gates green.
- **Verify:** `pnpm test && pnpm typecheck && pnpm lint` — all zero (ignore benign `pages/` eslint warning).
- **Depends on:** Task 4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/contract.test.ts src/pipeline/__tests__/drafter.test.ts src/pipeline/__tests__/orchestrator.test.ts src/runs/__tests__/execute-run.test.ts src/runs/__tests__/resolve-run-llm.test.ts && pnpm --filter web exec vitest run src/__tests__/newsletter-form-drafter-prompt.test.tsx src/__tests__/prompts-editor.test.tsx && pnpm test && pnpm typecheck && pnpm lint`
- Expected: All pass. Spot-check via tests: `{audience}` allowed; unit + call-site injection (`runPipeline` / `executeRun` → `draft` 5th arg); blank override → global; non-empty override wins; `SHIPPED_DRAFTER_PROMPT` exact pinned body; Advanced textarea submits `drafterPrompt`.

## Handoff

Builder reports: files changed; confirmation of pinned API (`draft` 5th positional + `options.audience` on `draftNewsletter`); confirmation `loadRunLlmResolution` precedence; exact `drafterPrompt` attribute size; UI location under Advanced; confirmation existing Appwrite drafter docs are not auto-migrated; confirmation shipped body is byte-identical to the pin (no deviation unless PM approved).
