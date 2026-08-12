# Feature 02: Settings panel

## Intent

Give the operator a first-class Settings surface to view and edit Stage 12 overrides (secrets masked) so day-to-day tuning of OpenRouter, SMTP, public URL, and curation knobs happens in the GUI instead of hunting `.env` or Advanced pockets.

## Spec

Add a protected `/settings` page with two sections — **Connections** and **Pipeline & delivery knobs** — wired to Feature 01’s `getOrCreateAppSettings`, `updateOperatorSettings`, and `resolveOperatorSettings`. Add **Settings** as the ninth sidebar nav item (after Delivery). This feature owns **UI + server actions + secret-safe load/save**. It does **not** add connection diagnostics (Feature 03), rewire pipeline/delivery/RSS callers (Feature 04), or PWA (Feature 05). Run retention stays on Runs → Advanced (do not move).

### Information architecture (PM-pinned)

| Element | Behavior |
|---------|----------|
| Route | `/settings` under the protected layout |
| Nav | `Settings` after `Delivery` in `web/lib/nav-items.ts` (9 items total) |
| Page title | `h1` **Settings** |
| Section 1 | **Connections** — OpenRouter API key, SMTP fields (host/port/username/password/from/secure), public URL |
| Section 2 | **Pipeline & delivery knobs** — score threshold, cross-run similarity, RSS last-N, drafter reasoning effort, drafter max completion tokens |
| Retention | **Unchanged** — still Runs → Advanced only |
| Diagnostics | **None** in this feature — Feature 03 adds Test controls into Connections |
| Future | Banked: if Settings grows further, may later resemble Newsletter Edit (tabs). Not in this feature |

### Cascade visibility (PM-pinned)

Every field shows a short effective-source line (or equivalent muted status):

| Source | Operator-facing label |
|--------|----------------------|
| `gui` | `GUI override` |
| `env` | `from .env` |
| `default` | `built-in default` |
| `none` | `not set` |

**Secrets** (OpenRouter key, SMTP password): never send values to the client. Show status only: `set via GUI` / `from .env` / `not set` (derived from resolved `source`, not raw characters). Masked inputs always start empty.

**Non-secrets:** input shows the GUI override when set, otherwise empty; `placeholder` shows the effective fallback value when one exists (env or built-in). Effective-source line uses resolver `source` + `value` (for display of numbers/URL/enums — never passwords/keys).

### Secrets UX (PM-pinned)

- Always `type="password"` (or equivalent masking). **No reveal toggle.**
- **Replace-on-save:** empty masked field on Save means **keep** the stored GUI secret (server merges from current `AppSettings` before `updateOperatorSettings`).
- Typing a new value replaces on Save.
- **Clear override** control (must **not** be “empty the input and wait for Save” — that would hit keep and become a no-op):
  - OpenRouter: immediately persists clear of `openRouterApiKey` (call the Connections action with an explicit `clearOpenRouter: true`, or a dedicated clear action that writes `""` while preserving other Stage-12 fields).
  - SMTP: one control **immediately** persists clear of the **entire** SMTP GUI bundle (all six attrs per Feature 01) via explicit `clearSmtp: true` / dedicated clear path — not password-only, and not “blank the password field.”
  - Tests must assert Clear does **not** go through the empty-masked-field → keep path.
- Cleared secrets fall through to `.env` (then `not set` if none).

### Non-secret UX (PM-pinned)

- Blank field + Save **clears** that GUI override (Feature 01 empty/`null` semantics).
- **Numeric zero is valid:** `scoreThreshold` / `crossRunSimilarityThreshold` of `0` must round-trip as a GUI override. Only blank / `""` / `null` (after trim for strings) clears — never treat falsy `0` as unset.
- No separate Clear buttons for non-secrets (including public URL).
- Drafter reasoning effort: Select with exactly `low` \| `medium` \| `high` (plus empty = clear / fall through).
- SMTP secure: boolean control via existing inventory (prefer Select On/Off or a simple checkbox — do not add a new design-system dependency unless needed). Empty/cleared secure with a complete required quartet still allowed (Feature 01 optional secure).
- Helper under each section: changes apply on the **next** run / send / request (not mid-job). Mirror Prompts “Default models” tone.

### Save model (PM-pinned)

- **Per-section Save** (`useTransition`, toast success/error, pending “Saving…”). No page-wide single Save. No `beforeunload`.
- Each save still calls `updateOperatorSettings` with the **full** Stage-12 override object:
  - **Connections Save:** Connections fields from the form (with secret merge / clear flags); knobs fields copied from current `AppSettings` (unchanged).
  - **Knobs Save:** knobs from the form; Connections/SMTP/OpenRouter/public URL copied from current `AppSettings` (unchanged).
- Validation errors from `SettingsRepositoryError` `validation` → `toast.error` with the message. Other failures → generic operator-safe error (never include secret values). `revalidatePath("/settings")` on success.
- Incomplete SMTP required quartet after merge → repository rejects; surface that validation message (do not invent a softer client-only bypass). Optional client pre-check is fine if it matches Feature 01 rules.

### Load / DTO (PM-pinned)

Server page loads `getOrCreateAppSettings` + `resolveOperatorSettings` (same client). Pass a **secret-stripped** DTO into client sections. Must never include `openRouterApiKey` or `smtpPassword` string values in props, RSC payload, or action responses.

Suggested shape (names flexible):

```ts
type SettingsSourceLabel = "gui" | "env" | "default" | "none";

type SettingsPanelData = {
  // GUI override fields safe for the browser (secrets as booleans only)
  openRouterApiKeySet: boolean;
  smtpHost: string;
  smtpPort: number | null;
  smtpUsername: string;
  smtpPasswordSet: boolean;
  smtpFrom: string;
  smtpSecure: string; // stored env-like string or normalized; map to control
  appPublicUrl: string;
  scoreThreshold: number | null;
  crossRunSimilarityThreshold: number | null;
  rssFeedMaxItems: number | null;
  drafterReasoningEffort: string; // "" | low | medium | high
  drafterMaxCompletionTokens: number | null;
  // Resolved display (no secret values)
  resolved: {
    openRouterApiKey: { source: SettingsSourceLabel };
    smtp: {
      source: SettingsSourceLabel;
      host: string | null;
      port: number | null;
      username: string | null;
      from: string | null;
      secure: boolean | null;
    };
    appPublicUrl: { value: string | null; source: SettingsSourceLabel };
    scoreThreshold: { value: number; source: Exclude<SettingsSourceLabel, "none"> };
    crossRunSimilarityThreshold: { value: number; source: Exclude<SettingsSourceLabel, "none"> };
    rssFeedMaxItems: { value: number; source: Exclude<SettingsSourceLabel, "none"> };
    drafterReasoningEffort: {
      value: "low" | "medium" | "high";
      source: Exclude<SettingsSourceLabel, "none">;
    };
    drafterMaxCompletionTokens: {
      value: number;
      source: Exclude<SettingsSourceLabel, "none">;
    };
  };
};
```

Load failure → destructive Alert on the page (Prompts pattern), sections not interactive / not rendered with stale data.

### Visual pattern

Mirror `GlobalModelDefaults` / `RetentionControls`: bordered section cards, labels, muted helper text, primary Save. Internal-tool quality — no marketing polish. Usable on phone widths (stacked fields; not a domain list page, so ResponsiveList N/A).

### Out of scope (explicit)

- Diagnostics / Test connection buttons (Feature 03)
- Runtime consumer rewiring (Feature 04)
- Moving retention, global models, or prompts into Settings
- Reveal/show-last-4 for secrets
- Mid-job live reload messaging beyond the “next run/send/request” helper

## Dependencies

- Builds on: **feature-01-settings-store-and-resolution** (`updateOperatorSettings`, `resolveOperatorSettings`, `getOrCreateAppSettings`, Stage 12 field contract, SMTP all-or-nothing).
- GUI patterns: Stage 07 global model defaults section; Stage 10 retention controls (toast / `useTransition`).
- Feature 01 must be verified (or at least its shared APIs present) before this feature’s actions can go green end-to-end.

## Constraints

- Never send OpenRouter key or SMTP password values to the browser (load props, action results, toasts, logs).
- Do not move run retention into Settings.
- Do not add diagnostics UI.
- Do not change Feature 01 schema/resolver contracts except consuming them; secret keep/clear is implemented in the **web server action** merge layer, not by changing empty-string-clears semantics in the repository.
- Do not put Appwrite connection, `TZ`, or worker poll intervals in Settings.
- Do not break existing nav tests without updating them to the new nine-item order.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] `/settings` is reachable from a **Settings** nav item after Delivery.
- [ ] Operator can view/edit Connections and Pipeline & delivery knobs; per-section Save persists via `updateOperatorSettings`.
- [ ] Secrets are always masked, never revealed; empty + Save keeps stored secret; Clear override **immediately** persists clear of OpenRouter key or whole SMTP GUI bundle (not via empty→keep).
- [ ] Non-secret blank + Save clears that override; numeric `0` for score/similarity round-trips; effective-source labels reflect GUI / `.env` / default / not set.
- [ ] Page load and action responses never include secret string values.
- [ ] Validation failures surface operator-readable toasts; load failures show an Alert.
- [ ] Retention remains on Runs → Advanced; no diagnostics controls shipped.
- [ ] Tests cover nav, secret strip/merge/clear, section saves, and cascade labels; `pnpm typecheck` and `pnpm lint` pass.

## Files

- Create: `web/app/(protected)/settings/page.tsx`
- Create: `web/app/(protected)/settings/actions.ts`
- Create: `web/components/settings/connections-settings.tsx` (name flexible)
- Create: `web/components/settings/pipeline-knobs-settings.tsx` (name flexible)
- Create: `web/components/settings/settings-source-label.tsx` (optional small shared label helper)
- Create: `web/src/__tests__/settings-actions.test.ts`
- Create: `web/src/__tests__/settings-panel.test.tsx` (and/or split connections/knobs tests)
- Modify: `web/lib/nav-items.ts` (add Settings after Delivery)
- Modify: `web/src/__tests__/feeds-nav.test.ts` (nine-item order including Settings → `/settings`)
- Modify (if asserted): `web/src/__tests__/shell-polish.test.tsx` or any hard-coded eight-item nav expectations
- Optional: thin mapper helper colocated under `web/lib/settings-panel.ts` for DTO build / secret merge (keeps actions thin)

## Testing approach

Test-first. Behavior under Intent — not pixel trivia.

1. **Nav** — `navItems` ends with Delivery then Settings (`/settings`); title order updated in `feeds-nav` (or successor) test.
2. **Secret strip** — load mapper / page DTO builder never includes key/password strings; `openRouterApiKeySet` / `smtpPasswordSet` reflect GUI presence.
3. **Secret merge** — Connections save with empty password fields calls `updateOperatorSettings` with prior stored secrets.
4. **Secret Clear (immediate)** — Clear OpenRouter / Clear SMTP invoke the explicit clear path (not empty→keep); OpenRouter write is `""`; SMTP write is clear-all-six; assert the keep-merge path is **not** used.
5. **Section isolation** — Connections save preserves knob overrides from current settings; Knobs save preserves connection overrides.
6. **Numeric zero** — saving `scoreThreshold: 0` and/or `crossRunSimilarityThreshold: 0` persists `0` (not clear); blank/`null` clears.
7. **Cascade labels** — with mocked resolved sources, UI shows the pinned labels; secret status shows set via GUI / from .env / not set without values.
8. **Validation** — mocked `SettingsRepositoryError` `validation` → action `ok: false` with message; toast path covered in component test like model defaults / retention.
9. **No diagnostics** — Settings UI tests assert absence of Test / Diagnose controls (guard against scope creep).

Prefer mocking `@newsletter/shared` settings APIs in web tests (same pattern as `prompts-actions.test.ts`).

## Tasks

### Task 1: Failing tests for Settings panel contract

- **Action**: Add `web/src/__tests__/settings-actions.test.ts` and `web/src/__tests__/settings-panel.test.tsx` (names flexible) covering secret strip/merge, **immediate** Clear (not empty→keep), section isolation, numeric-zero round-trip, validation mapping, cascade labels, and no-diagnostics. Update `web/src/__tests__/feeds-nav.test.ts` for Settings after Delivery (expect fail until nav changes). Prefer red before implementation.
- **Expected result**: New/updated tests exist and fail for missing route/actions/components/nav entry.
- **Verify**: `pnpm --filter web test` shows the new cases failing for the right reason (missing export/route/behavior), not syntax errors.
- **Depends on**: none (may mock Feature 01 APIs).

### Task 2: Nav + page shell + DTO load

- **Action**: Add Settings to `web/lib/nav-items.ts` (after Delivery). Create `web/app/(protected)/settings/page.tsx` that loads settings + `resolveOperatorSettings`, maps secret-stripped `SettingsPanelData`, shows Alert on load failure, renders two section placeholders or components. Fix nav tests.
- **Expected result**: `/settings` renders title + two sections; nav links to it; secrets absent from props.
- **Verify**: Nav tests green; page/component tests for load/Alert path green or progressing; spot-check that DTO type/props have no secret string fields.
- **Depends on**: Task 1.

### Task 3: Server actions (merge + full-object write)

- **Action**: Implement `web/app/(protected)/settings/actions.ts`: `saveConnectionsSettingsAction` and `savePipelineKnobsSettingsAction` (names flexible), plus explicit clear flags or dedicated clear actions for OpenRouter / SMTP bundle. Each loads current `AppSettings`, merges form + keep rules, builds full Stage-12 input, calls `updateOperatorSettings`, `revalidatePath("/settings")`, maps validation errors. Clear paths must write `""` / clear-all-six immediately — never via empty-masked keep. Knobs path must persist `0` thresholds. Never return secret values. Unit-test merge/clear/zero/preserve paths to green.
- **Expected result**: Actions enforce PM-pinned keep/clear and section isolation against mocked shared APIs.
- **Verify**: `settings-actions` tests green.
- **Depends on**: Task 2 (page can wire later in Task 4 if preferred; actions may land before UI wiring).

### Task 4: Section UIs + Clear controls

- **Action**: Implement Connections and Pipeline & delivery knobs client components (GlobalModelDefaults-style). Wire Save buttons, Clear override for OpenRouter and SMTP bundle, effective-source labels, masked secrets, placeholders for fallbacks, Select for reasoning effort, helper “next run/send/request” copy. No Test buttons.
- **Expected result**: Operator can edit and save both sections from `/settings` with pinned UX.
- **Verify**: Panel component tests green for labels, clear controls, save calls, absence of diagnostics.
- **Depends on**: Task 3.

### Task 5: Monorepo gates

- **Action**: Run web settings tests + full `pnpm typecheck` and `pnpm lint`; fix fallout only as needed for this feature (including any eight-item nav assertions elsewhere).
- **Expected result**: Gates clean; Settings panel complete without diagnostics or retention move.
- **Verify**: `pnpm --filter web test` (settings + nav suites) green; `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm --filter web test` (settings + nav-related suites) && `pnpm typecheck` && `pnpm lint`
- Expected: Settings nav + `/settings` panel tests pass (secret strip/merge, immediate Clear ≠ keep, numeric-zero round-trip, section saves, cascade labels, no diagnostics); typecheck and lint clean; retention still only on Runs Advanced; no Feature 03 Test buttons.

## Handoff

Builder reports: files changed; exact action and component names; confirmation secrets never reach the client; confirmation empty secret + Save keeps via server merge; confirmation Clear OpenRouter/SMTP **immediately** persists (`""` / clear-all-six) and does not use empty→keep; confirmation score/similarity `0` round-trips; confirmation per-section Save still sends full Stage-12 object; confirmation retention untouched; any deviation (file split, control widgets) and why. Note for Feature 03: hang Test controls inside Connections section on `/settings`. Note for Feature 04: panel already persists overrides — consumers must read `resolveOperatorSettings`.

### Research note

- Codebase: Prompts `GlobalModelDefaults` + `updateGlobalModelDefaultsAction` (`web/components/prompts/`, `web/app/(protected)/prompts/`); retention toast/`useTransition` (`web/components/runs/retention-controls.tsx`); nav in `web/lib/nav-items.ts` + `feeds-nav.test.ts`; Feature 01 store/resolve contract (`.ssc/stages/stage-12-settings-and-pwa/feature-01-settings-store-and-resolution.md`).
- Grill decisions 2026-08-11: single sectioned page; retention stays on Runs; replace-on-save + Clear; per-section Save; cascade source lines; Settings after Delivery; no diagnostics in Feature 02; future tabbed Settings banked.
- Spec review 2026-08-11: Clear override must immediately persist (not empty→keep); numeric `0` is a valid override and must not be treated as blank-clear.
