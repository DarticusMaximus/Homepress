# Feature 02: Prompts editor

## Intent

Let the operator view and edit the three reusable prompt templates (tagger, scorer, drafter) on the existing Prompts page — seeing each template’s allowed placeholders — so fine-tuning takes effect on the next run without a redeploy or code change.

## Spec

Replace the Prompts page stub with a working editor backed by Feature 01’s prompt template store. The page loads all three templates from Appwrite (get-or-create seed), lets the operator switch among roles, edit the body in a large monospace textarea, and save. Allowed placeholders for the active role are always visible. Validation and unknown-placeholder warnings come from the shared repository — the UI surfaces them; it does not re-implement the contract.

### UI layout (pinned)

| Element | Behavior |
|---------|----------|
| Page shell | Server component at `/prompts`: load via `listPromptTemplates(getServerAppwrite())`; on failure show destructive `Alert` (same pattern as feeds/runs); on success render the client editor. |
| Role switcher | shadcn **Tabs** (install `tabs` if missing) with one tab each for `tagger`, `scorer`, `drafter` in that order. Labels: capitalized role names (“Tagger”, “Scorer”, “Drafter”). |
| Placeholder help | Under the tab list (or above the textarea), show muted helper copy: these tokens are substituted at run time with per-run data — do not paste live article text into the stored template. List the **allowed** placeholders for the active role as `Badge` chips (exact names from `PROMPT_PLACEHOLDERS[role]`, including braces, e.g. `{title}`). |
| Editor | Controlled `Textarea` with `font-mono`, generous `rows` / min-height (~16–20 rows), `aria-label` including the role (e.g. “Tagger prompt template”). |
| Metadata | Muted line showing `updatedAt` for the **last saved** server value of the active role (ISO → locale-friendly short datetime is fine). |
| Save | Primary `Button` “Save” for the **active role only**. Disabled while that save is in flight (`useTransition`). Label → “Saving…” while pending. |
| Footnote | Short muted note: “Changes apply to the next run. Runs already in progress keep the values they started with.” |

### Client draft state (pinned)

- Keep a per-role draft map in React state, initialized from the server-loaded templates.
- Switching tabs **preserves** unsaved drafts for other roles (no confirm dialog).
- Save persists **only** the active role’s current draft via the server action.
- On successful save: update that role’s draft + displayed `updatedAt` from the returned template.
- Feedback is **toast-only** (see Toast / feedback table) — do **not** add a second inline Alert / field-error surface for save failures.
- Do **not** use `beforeunload` / discard prompts (internal-tool quality).

### Server action (pinned)

Create `web/app/(protected)/prompts/actions.ts` (`"use server"`):

```ts
updatePromptTemplateAction(role: PromptRole, body: string)
  → { ok: true; template: PromptTemplate; warnings: string[] }
  | { ok: false; error: string }
```

- Call `updatePromptTemplate(getServerAppwrite(), role, body)`.
- On success: `revalidatePath("/prompts")`; return `template` + `warnings` (may be empty).
- On `PromptRepositoryError` with `code === "validation"`: return `{ ok: false, error: err.message }` (message already lists missing placeholders).
- On Appwrite / unknown errors: `console.error` + `{ ok: false, error: "Something went wrong while saving the prompt template." }` — do **not** leak raw Appwrite dumps.

### Toast / feedback (pinned)

| Outcome | UI |
|---------|-----|
| Save success, no warnings | `toast.success` — e.g. “Tagger prompt saved” |
| Save success, unknown placeholders | `toast.success` as above **and** `toast.warning` listing unknown names (e.g. “Unknown placeholders kept as literal text: foo, bar”) |
| Save failure (validation or other) | `toast.error` with `result.error` |
| Empty / whitespace-only | Rely on repository validation message (no separate client-only rule required); optional client short-circuit is allowed if it matches the same reject semantics |

### Shared export for placeholder chips

Feature 01 owns allow-lists inside `shared/src/prompts/contract.ts`. This feature requires a **public** export the web app can import:

- `PROMPT_PLACEHOLDERS: Record<PromptRole, readonly string[]>` — values are the allowed token **names without braces** (e.g. `"title"`) **or** with braces; pick one shape and use it consistently in the UI (if names without braces, render as `{${name}}` in Badges).

If Feature 01 already exports an equivalent public map under a different name, re-export or alias as `PROMPT_PLACEHOLDERS` from `shared/src/prompts/index.ts` — do not duplicate allow-list data. If the allow-lists are still module-private after Feature 01, export them in a one-line shared change as part of this feature (no contract behavior change).

### Out of scope

- Reset to shipped default (Feature 03).
- Global / per-newsletter model IDs (Features 04–05).
- Worker loading templates from Appwrite at run start (Feature 06) — editor save persists to DB; pipeline consumption is Feature 06.
- Editor role / fourth template (stage out of scope).
- Per-newsletter prompt templates.
- REST `app/api` routes (project uses Server Actions only).
- Nav / sidebar changes (`/prompts` + “Prompts” item already exist).

## Dependencies

- Builds on: **feature-01-prompt-template-store** — `listPromptTemplates`, `updatePromptTemplate`, `PromptRepositoryError`, `PROMPT_ROLES` / `PromptRole`, `PromptTemplate`, placeholder contract (reject missing / warn unknown).
- Soft: Stage 02 protected layout + toast (`@/lib/toast`); Stage 04 retention-controls pattern for inline save + `useTransition`.
- Soft: Stage 03 feeds page load + Alert pattern.

## Constraints

- **Server-only Appwrite** via `getServerAppwrite()` — no browser SDK for prompt documents.
- **Do not** re-implement placeholder validation in the web layer beyond optional empty-body UX; trust `updatePromptTemplate`.
- **Do not** add Reset, model controls, or an editor template.
- **Do not** change Feature 01’s placeholder contract, collection schema, or repository semantics.
- **Do not** edit `nav-items.ts` unless a test regression forces a fix (entry already present).
- **Secrets:** never log API keys or full env dumps.
- Match existing form/action result shapes: `{ ok: true; … } | { ok: false; error: string }`.

## Acceptance criteria

- [ ] `/prompts` loads the three templates (seeding via Feature 01 get-or-create) and shows an editable body for each role via tabs.
- [ ] Allowed placeholders for the active role are visible as named chips/labels matching the Feature 01 contract.
- [ ] Saving a valid body persists via `updatePromptTemplate`, revalidates, and reloads the saved text / `updatedAt`.
- [ ] Saving with a missing required placeholder shows the repository validation error (toast); body is not persisted.
- [ ] Saving with an unknown `{name}` succeeds and surfaces a warning toast that names the unknown placeholder(s).
- [ ] Helper copy states placeholders are filled at run time; footnote states changes apply on the next run.
- [ ] No Reset button, no model fields, no editor-role tab.
- [ ] `pnpm typecheck` and `pnpm lint` pass; new web tests for the editor **and** the server action (including the `updatePromptTemplate` call assertion) pass.

## Files

- Create: `web/app/(protected)/prompts/actions.ts`
- Create: `web/components/prompts/prompts-editor.tsx`
- Create: `web/src/__tests__/prompts-editor.test.tsx`
- Create: `web/src/__tests__/prompts-actions.test.ts`
- Create (if missing): `web/components/ui/tabs.tsx` (shadcn `tabs`)
- Modify: `web/app/(protected)/prompts/page.tsx` (replace stub with load + editor)
- Modify (only if needed): `shared/src/prompts/contract.ts` / `index.ts` — export `PROMPT_PLACEHOLDERS` (or alias) without changing validation behavior
- Test: `web/src/__tests__/prompts-editor.test.tsx`
- Test: `web/src/__tests__/prompts-actions.test.ts`

## Testing approach

Test-first for the **client editor** behavior (Vitest + Testing Library), mirroring `web/src/__tests__/retention-controls.test.tsx`: mock `web/app/(protected)/prompts/actions.ts` and `@/lib/toast`. Page-level Appwrite load is verified by code review + typecheck (same as other list pages); do not require a live Appwrite integration test.

### Editor component cases

1. Renders three role tabs; default tab is Tagger; placeholder chips for tagger include the Feature 01 required set (e.g. `{title}`, `{truncated_content}`).
2. Switching to Scorer shows scorer placeholder chips and that role’s body.
3. Edit + Save calls `updatePromptTemplateAction` with the active `role` and current body; success → `toast.success`.
4. Save returns `{ ok: false, error }` → `toast.error` with that message; no success toast.
5. Save returns `{ ok: true, warnings: ["foo"] }` → success toast **and** `toast.warning` mentioning `foo`.
6. Save button shows disabled / “Saving…” while the transition is pending (assert disabled during in-flight mock if practical; otherwise assert action awaited before re-enable).
7. Unsaved edit on Tagger is still present after switching to Scorer and back (draft preservation) — without calling save.

### Server action cases (`prompts-actions.test.ts`)

Mock `@newsletter/shared`’s `updatePromptTemplate` and `getServerAppwrite` (same style as other web action/unit tests if present; otherwise a thin vitest mock of the shared module). Assert:

1. On success path: `updatePromptTemplate` is called with `(client, role, body)` — **not** a stub that returns `{ ok: true }` without the repo call.
2. Validation `PromptRepositoryError` → `{ ok: false, error: err.message }`.
3. Non-validation / unknown error → generic operator-safe error string (no raw Appwrite dump).

### Not test-first

- Exact typography / min-height / footnote wording beyond presence of the next-run note and placeholder helper (verifier checks strings in the component source or rendered text).
- shadcn Tabs install itself — verifier checks `web/components/ui/tabs.tsx` exists and the editor imports it.

## Tasks

### Task 1: Editor tests (failing) + public `PROMPT_PLACEHOLDERS` if needed

- **Action**: Ensure `PROMPT_PLACEHOLDERS` (or equivalent) is exported from `@newsletter/shared` for the three roles. Write `web/src/__tests__/prompts-editor.test.tsx` covering Testing approach cases 1–7 against `PromptsEditor` (tests fail until Task 3). Mock `updatePromptTemplateAction` and `toast`. Fixture props: three `PromptTemplate` objects with distinct bodies and `updatedAt` values.
- **Expected result**: Test file exists and fails on missing component / failing assertions; shared export available for chip rendering.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-editor.test.tsx` (expect failures until Task 3). Confirm `PROMPT_PLACEHOLDERS` (or documented alias) is importable from `@newsletter/shared`.
- **Depends on**: none (assumes Feature 01 code is present; if not, this feature is blocked until Feature 01 verifies).

### Task 2: Server action + action tests + install Tabs + page load shell

- **Action**: Add `web/app/(protected)/prompts/actions.ts` with `updatePromptTemplateAction` per Spec. Write `web/src/__tests__/prompts-actions.test.ts` covering Testing approach server-action cases 1–3 (mock `updatePromptTemplate` / `getServerAppwrite` so persistence cannot be faked). Install shadcn Tabs into `web/components/ui/tabs.tsx` (prefer shadcn MCP; fallback `pnpm dlx shadcn@latest add tabs` in `web/`). Rewrite `web/app/(protected)/prompts/page.tsx` as an async server page: `listPromptTemplates(getServerAppwrite())`, destructive `Alert` on `PromptRepositoryError` / generic failure, pass templates into `PromptsEditor` (stub component ok until Task 3 — e.g. empty client shell that accepts `templates` prop).
- **Expected result**: Action compiles and tests prove it calls `updatePromptTemplate`; Tabs primitive present; page loads templates or shows Alert; no stub “under construction” copy.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-actions.test.ts`; `pnpm typecheck`; `pnpm lint`; grep/page read confirms stub text removed; action file exports the pinned result union.
- **Depends on**: Task 1 (shared export).

### Task 3: PromptsEditor UI + make tests pass

- **Action**: Implement `web/components/prompts/prompts-editor.tsx` per Spec (Tabs, placeholder Badges from `PROMPT_PLACEHOLDERS`, monospace Textarea, Save + `useTransition`, toast-only feedback, draft map, `updatedAt`, footnote). Wire the real editor from `page.tsx`. Green the Task 1 editor tests. Do not add inline save-error Alerts.
- **Expected result**: Full editor works; all prompts-editor tests pass; prompts-actions tests from Task 2 remain green.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-editor.test.tsx src/__tests__/prompts-actions.test.ts` then `pnpm typecheck` and `pnpm lint`.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm --filter @newsletter/web exec vitest run src/__tests__/prompts-editor.test.tsx src/__tests__/prompts-actions.test.ts && pnpm typecheck && pnpm lint`
- Expected: prompts-editor and prompts-actions tests green (including the action→`updatePromptTemplate` call assertion); typecheck and lint clean (ignore benign missing `pages/` eslint noise). Manually (verifier): `/prompts` shows three tabs, placeholder chips, Save — no Reset / model fields / editor tab.

## Handoff

Builder reports: files created/modified; confirmation that save uses Feature 01 `updatePromptTemplate` only; how `PROMPT_PLACEHOLDERS` was sourced/exported; confirmation Reset and models were not added; any deviation (e.g. Tabs install path). Note that pipeline still does not read DB templates until Feature 06 — GUI persistence alone satisfies this feature’s “next run” claim once Feature 06 lands; do not implement run-time load here.

## Research notes

- Codebase: no `web/app/api` CRUD — Server Actions + `getServerAppwrite()` (feeds/newsletters/runs retention). Closest inline-save UX: `web/components/runs/retention-controls.tsx` + `updateRunRetentionSetting`. Page load Alert pattern: `web/app/(protected)/feeds/page.tsx`.
- Prompts stub + nav already exist (`web/app/(protected)/prompts/page.tsx`, `nav-items.ts`).
- shadcn `tabs` not installed; `textarea` / `badge` / `button` / `alert` / `sonner` present. Prefer shadcn MCP to add tabs.
- Feature 01 pins placeholder contract + reject/warn; Feature 02 only surfaces that contract in the GUI.
