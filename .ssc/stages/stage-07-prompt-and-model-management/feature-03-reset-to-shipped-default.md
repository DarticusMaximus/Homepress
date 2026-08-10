# Feature 03: Reset to shipped default

## Intent

Let the operator restore any of the three prompt templates to the built-in shipped default text from the Prompts editor, so a bad edit is recoverable without a code change or redeploy.

## Spec

Add a per-role **Reset to default** action on the Feature 02 Prompts editor. Confirming it overwrites the stored template for the **active role only** with that role’s Feature 01 shipped default body, persists immediately (no separate Save), and refreshes the editor draft + `updatedAt` from the server result.

### Shipped-default source (pinned)

Feature 01 owns the default strings in `shared/src/prompts/defaults.ts`. This feature requires a **public** lookup the repository (and tests) can use:

- Export `SHIPPED_PROMPT_DEFAULTS: Record<PromptRole, string>` from `shared/src/prompts` (via `defaults.ts` + barrel), **or** `getShippedPromptDefault(role: PromptRole): string` that returns the same strings Feature 01 uses for seeding.
- Do **not** duplicate the default text in the web layer or hardcode bodies in the server action.
- If Feature 01 already exports an equivalent public map under a different name, re-export or alias as `SHIPPED_PROMPT_DEFAULTS` / `getShippedPromptDefault` — do not fork a second source of truth.

### Repository API (pinned)

Add to `shared/src/prompts/repository.ts`:

```ts
resetPromptTemplate(client, role: PromptRole)
  → { template: PromptTemplate; warnings: string[] }
```

Behavior:

1. Resolve the shipped default body for `role` via the public defaults export.
2. Persist by calling **`updatePromptTemplate(client, role, shippedBody)`** — reuse validation, get-or-create-on-missing, and return shape. Do **not** bypass validation with a raw `updateDocument`.
3. Return the same `{ template, warnings }` shape as update. Shipped defaults must validate cleanly (empty `warnings`); if a future default somehow fails validation, the error propagates as `PromptRepositoryError`.
4. Invalid `role` → same validation error as other repository methods.
5. **Idempotent:** if the stored body already equals the shipped default, still run update (new `updatedAt` is fine) — no special “already default” short-circuit required.

### Server action (pinned)

Extend `web/app/(protected)/prompts/actions.ts`:

```ts
resetPromptTemplateAction(role: PromptRole)
  → { ok: true; template: PromptTemplate; warnings: string[] }
  | { ok: false; error: string }
```

- Call `resetPromptTemplate(getServerAppwrite(), role)`.
- On success: `revalidatePath("/prompts")`; return `template` + `warnings`.
- On `PromptRepositoryError` with `code === "validation"`: `{ ok: false, error: err.message }`.
- On Appwrite / unknown errors: `console.error` + `{ ok: false, error: "Something went wrong while resetting the prompt template." }` — no raw Appwrite dumps.

### UI (pinned)

| Element | Behavior |
|---------|----------|
| Trigger | Outline (or secondary) `Button` labeled **“Reset to default”** next to Save, scoped to the **active role**. Disabled while Save or Reset is in flight. |
| Confirm | Existing shadcn **`Dialog`** pattern (same family as `DeleteFeedDialog` / `DeleteNewsletterDialog` — not `window.confirm`, not a new AlertDialog primitive unless already installed). |
| Title | “Reset to shipped default” |
| Description | States that the **active role’s** template will be replaced with the built-in default, that **unsaved edits for this role will be discarded**, and that the change applies on the **next run**. Name the role in the copy (e.g. “Tagger”). |
| Confirm button | Destructive variant; label **“Reset”** (or “Reset tagger” etc.). Pending → “Resetting…”. |
| Cancel | Closes dialog; does **not** call the action. |
| On success | Close dialog; set that role’s draft + displayed `updatedAt` from returned `template`; `toast.success` (e.g. “Tagger prompt reset to default”). If `warnings` non-empty (should not happen for shipped defaults), also `toast.warning` listing them — same as Save. |
| On failure | Keep dialog open or close — either is fine if consistent; `toast.error` with `result.error`. Prefer close-on-success only (match delete dialogs: close on success, stay open + toast on failure). |
| Other roles | Unsaved drafts for non-active roles are **preserved** (reset does not touch them). |

Do **not** preview the full default body in the dialog (internal-tool quality; confirm is enough).

### Out of scope

- Global / per-newsletter model IDs (Features 04–05).
- Worker loading templates from Appwrite at run start (Feature 06).
- Reset-all-three-at-once.
- Undo / version history of prior custom text.
- Editor role / fourth template.
- Changing Feature 01 placeholder contract or collection schema.

## Dependencies

- Builds on: **feature-01-prompt-template-store** — shipped defaults, `updatePromptTemplate`, `PromptRepositoryError`, `PromptRole` / `PromptTemplate`.
- Builds on: **feature-02-prompts-editor** — Prompts editor page, `updatePromptTemplateAction`, draft map, toast-only feedback, Tabs UI.
- Soft: Stage 03 delete-dialog confirm pattern (`DeleteFeedDialog` / `DeleteNewsletterDialog`).

## Constraints

- **Server-only Appwrite** via `getServerAppwrite()` — no browser SDK.
- **Single source of truth** for default text: Feature 01 `defaults.ts` (public export only).
- **Reset must go through** `updatePromptTemplate` (via `resetPromptTemplate`) so validation and get-or-create semantics stay identical to Save.
- **Do not** change Feature 01 placeholder contract, collection schema, or Feature 02 Save behavior except adding the Reset control + action.
- **Do not** add model controls or an editor-role tab.
- **Secrets:** never log API keys or full env dumps.
- Match existing action result shapes: `{ ok: true; … } | { ok: false; error: string }`.

## Acceptance criteria

- [ ] Active-role **Reset to default** control exists on `/prompts` with a confirm Dialog before write.
- [ ] Confirming reset persists the Feature 01 shipped default body for that role only (via repository `resetPromptTemplate` → `updatePromptTemplate`).
- [ ] After success, the editor shows the shipped default text and updated `updatedAt` for that role without a full page reload requirement (client state updated from action result).
- [ ] Unsaved drafts for other roles survive a reset of the active role.
- [ ] Cancel / dismiss does not call the reset action or change stored bodies.
- [ ] Failure surfaces an error toast; success surfaces a success toast.
- [ ] Idempotent reset (already-default body) succeeds.
- [ ] Reset / Save in-flight disables the Reset trigger; confirm pending label is “Resetting…”.
- [ ] `pnpm typecheck` and `pnpm lint` pass; shared repository tests and web editor/action tests for reset pass.

## Files

- Modify: `shared/src/prompts/defaults.ts` (ensure public `SHIPPED_PROMPT_DEFAULTS` or `getShippedPromptDefault`)
- Modify: `shared/src/prompts/index.ts` (export defaults lookup if not already)
- Modify: `shared/src/prompts/repository.ts` (`resetPromptTemplate`)
- Modify: `shared/src/prompts/__tests__/repository.test.ts` (reset cases)
- Modify: `web/app/(protected)/prompts/actions.ts` (`resetPromptTemplateAction`)
- Modify: `web/components/prompts/prompts-editor.tsx` (Reset button + wire dialog)
- Create: `web/components/prompts/reset-prompt-dialog.tsx` (confirm Dialog; mirror delete-dialog style)
- Modify: `web/src/__tests__/prompts-editor.test.tsx` (reset UI cases)
- Modify: `web/src/__tests__/prompts-actions.test.ts` (reset action cases)
- Optional Create: `shared/src/prompts/__tests__/defaults.test.ts` — only if a thin export/lookup assertion is cleaner than folding into repository tests (not required if repository tests assert body equality to `SHIPPED_PROMPT_DEFAULTS[role]`)

## Testing approach

Test-first for repository reset and for editor/action behavior. No live Appwrite integration test.

### Repository (`repository.test.ts`)

1. `resetPromptTemplate` for each role writes a body **equal** to `SHIPPED_PROMPT_DEFAULTS[role]` (or `getShippedPromptDefault(role)`).
2. Reset when the document is missing still succeeds (get-or-create then write via `updatePromptTemplate`).
3. Reset when body is already the shipped default succeeds (idempotent).
4. Invalid role throws `validation`.
5. Assert reset goes through update semantics (e.g. mock/spy that `updateDocument` / update path is used with the shipped body — not a delete+create). Exact spy style may match existing repository test doubles.

### Server action (`prompts-actions.test.ts`)

Mock `resetPromptTemplate` and `getServerAppwrite`:

1. Success path calls `resetPromptTemplate(client, role)` and returns `{ ok: true, template, warnings }`.
2. Validation `PromptRepositoryError` → `{ ok: false, error: err.message }`.
3. Unknown error → generic operator-safe reset error string.

### Editor / dialog (`prompts-editor.test.tsx`)

Mock `resetPromptTemplateAction` and `toast` (and keep Save mocks):

1. **Reset to default** button is present for the active role.
2. Clicking Reset opens confirm dialog; confirming calls `resetPromptTemplateAction` with the active role; success → `toast.success` and textarea shows returned body.
3. Cancel / dismiss does **not** call the action.
4. After editing Tagger draft, switching to Scorer, resetting Scorer, and switching back to Tagger — Tagger’s unsaved draft is still present.
5. Failure `{ ok: false, error }` → `toast.error`; no success toast.
6. While Reset is in flight: confirm button shows “Resetting…” and is disabled; the editor’s **Reset to default** trigger is also disabled. While Save is in flight: **Reset to default** is disabled (assert disabled during in-flight mock if practical; otherwise assert action awaited before re-enable — same bar as Feature 02 Save pending).

### Not test-first

- Exact Dialog copy wording beyond presence of role name / next-run / discard-unsaved meaning (verifier may check key substrings).
- Visual placement of the button (next to Save is pinned; pixel layout is not).

## Tasks

### Task 1: Public shipped defaults + `resetPromptTemplate` + repository tests

- **Action**: Ensure `SHIPPED_PROMPT_DEFAULTS` or `getShippedPromptDefault` is exported from `@newsletter/shared` as the Feature 01 seed source (alias only if needed). Implement `resetPromptTemplate` in `shared/src/prompts/repository.ts` per Spec (delegate to `updatePromptTemplate`). Extend `shared/src/prompts/__tests__/repository.test.ts` with Testing approach repository cases 1–5.
- **Expected result**: Repository reset tests pass; defaults are importable from the shared package without private-path imports.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/repository.test.ts` then `pnpm typecheck`.
- **Depends on**: Feature 01 code present (blocked if Feature 01 not verified / missing).

### Task 2: Server action + action tests

- **Action**: Add `resetPromptTemplateAction` to `web/app/(protected)/prompts/actions.ts` per Spec. Extend `web/src/__tests__/prompts-actions.test.ts` with Testing approach server-action cases 1–3 (mock `resetPromptTemplate`, not only `updatePromptTemplate`).
- **Expected result**: Action tests prove the action calls `resetPromptTemplate` and maps errors correctly.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-actions.test.ts`
- **Depends on**: Task 1.

### Task 3: Reset dialog + editor wiring + editor tests

- **Action**: Create `web/components/prompts/reset-prompt-dialog.tsx` (Dialog confirm mirroring delete-dialog patterns; call `resetPromptTemplateAction` via `useTransition` or `useActionState` — prefer the same style as Feature 02 Save / retention controls if simpler than form+`useActionState`). Wire **Reset to default** into `web/components/prompts/prompts-editor.tsx` per Spec. Extend `web/src/__tests__/prompts-editor.test.tsx` with Testing approach editor cases 1–6 (including in-flight disabled / “Resetting…”). Keep Feature 02 Save tests green.
- **Expected result**: Full reset UX works; editor + action tests pass.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-editor.test.tsx src/__tests__/prompts-actions.test.ts` then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm --filter @newsletter/shared exec vitest run src/prompts/__tests__/repository.test.ts && pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-editor.test.tsx src/__tests__/prompts-actions.test.ts && pnpm typecheck && pnpm lint`
- Expected: repository reset cases green; prompts editor/action tests green (including reset call assertion, draft-preservation across roles, and in-flight disabled / “Resetting…”); typecheck and lint clean (ignore benign missing `pages/` eslint noise). Manually (verifier): `/prompts` Reset → confirm → body matches shipped default; Cancel does nothing; other-tab drafts survive.

## Handoff

Builder reports: files created/modified; how shipped defaults were exported/aliased; confirmation that reset delegates to `updatePromptTemplate`; confirmation that reset is per active role only with confirm Dialog; any deviation (e.g. dialog implemented inline vs `reset-prompt-dialog.tsx`) and why. Note Feature 06 still owns pipeline DB load.

## Research notes

- Feature 01: shipped defaults in `defaults.ts`; seed + later reset called out; `updatePromptTemplate` already get-or-creates then writes.
- Feature 02: explicitly deferred Reset; toast-only feedback; per-role draft map; Server Actions only.
- Codebase confirm pattern: `DeleteFeedDialog` / `DeleteNewsletterDialog` use shadcn `Dialog` + destructive confirm (no `alert-dialog` UI component installed under `web/components/ui/`).
- Codegraph: delete-dialog sources used as the UX template for reset confirm.
