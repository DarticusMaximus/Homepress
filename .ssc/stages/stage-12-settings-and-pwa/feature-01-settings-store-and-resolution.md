# Feature 01: Settings store and resolution

## Intent

Persist operator overrides for OpenRouter, SMTP, public URL, and the Stage 12 curation knobs in Appwrite, and resolve each value as GUI override → `.env` → code default, so later Settings UI and runtime consumers can tune a live deploy without editing `.env` or recreating containers.

## Spec

Extend the existing singleton `app_settings` document (`$id: "default"`) with optional override attributes for this stage’s knobs. Provide shared **validation + repository write/read** and a **resolver** that applies the pinned cascade (including SMTP all-or-nothing). Document new optional env bootstrap keys in `.env.example`.

This feature owns **schema**, **store**, **resolve**, and **tests/docs** for that contract. It does **not** add a Settings UI (Feature 02), connection diagnostics (Feature 03), rewire pipeline/delivery/RSS callers to the resolver (Feature 04), or PWA (Feature 05). Existing `getModelName` / `resolveSmtpConfig` / `resolveAppPublicUrl` / `getCrossRunSimilarityThreshold` call sites stay as they are until Feature 04.

### Precedence (PM-pinned)

For each setting (except SMTP — see below), effective value is the first **present** layer:

1. **GUI override** on `app_settings` (non-empty after trim for strings; finite in-range number / valid enum for knobs)
2. Else **`.env`** bootstrap key (non-empty after trim)
3. Else **code default** (where one exists)

Empty / whitespace-only / `null` / `undefined` / corrupt-on-read at a layer = unset at that layer.

**SMTP is all-or-nothing:** GUI SMTP counts only when the required quartet (`smtpHost`, `smtpPort`, `smtpUsername`, `smtpPassword`) are all present and valid in Appwrite. If any required field is missing/blank/corrupt, treat the **entire** SMTP GUI override as absent and resolve all SMTP fields from `.env` (then optional `FROM`/`SECURE` fallbacks as today). Do not mix GUI password with env host (etc.).

**OpenRouter key** and **public URL** remain single-field cascades (blank GUI → env → none).

### Blank / invalid behavior (PM-pinned)

| Path | Behavior |
|------|----------|
| **Write** | Reject invalid input with `SettingsRepositoryError` `validation` — nothing bad persisted. SMTP: reject incomplete required quartet (unless clearing the whole SMTP override). |
| **Read (corrupt Appwrite data)** | Treat that field (or whole SMTP bundle if incomplete/corrupt) as **no override**; do not crash settings load. |
| **Blank / clear** | Strings → `""`; optional numbers → `null`. Cleared = fall through. **SMTP clear** writes empty/`null` for the **full** SMTP attr set (required quartet **and** `smtpFrom` / `smtpSecure`) so optional fields cannot orphan. |

### Secrets (PM-pinned)

Store OpenRouter key and SMTP password as **plaintext** string attributes on `app_settings` (single-operator self-host trust model, same as `.env`). Never log secret values (reuse `sanitizeAppwriteMessageForLog` / existing redact helpers). Feature 02 owns UI masking. Stronger secret handling is **banked** in `.ssc/Plan.md` Carry-forward pins — out of Stage 12 scope.

### Fields, env keys, defaults, ranges (PM-pinned)

| Setting | Appwrite attr | Env key | Code default | Write validation |
|---------|---------------|---------|--------------|------------------|
| OpenRouter API key | `openRouterApiKey` (string, optional, size ≥ 512) | `OPENROUTER_API_KEY` | none | trim; empty clears; non-empty max size; no whitespace/control |
| SMTP host | `smtpHost` | `SMTP_HOST` | none | part of SMTP bundle |
| SMTP port | `smtpPort` (number, optional) | `SMTP_PORT` | none | positive integer; part of bundle |
| SMTP username | `smtpUsername` | `SMTP_USERNAME` | none | part of bundle |
| SMTP password | `smtpPassword` | `SMTP_PASSWORD` | none | part of bundle; never in error messages |
| SMTP from | `smtpFrom` | `SMTP_FROM` | (fallback: username when bundle/env active) | optional inside complete bundle |
| SMTP secure | `smtpSecure` (string optional, env-like truthy) | `SMTP_SECURE` | `false` when unset | optional; parse like today’s `true`/`1`/`yes` |
| Public URL | `appPublicUrl` | `APP_PUBLIC_URL` | none | trim; strip trailing `/` on store; empty clears; non-empty must be absolute `http://` or `https://` URL; never invent a host |
| Score threshold | `scoreThreshold` (number, optional) | **`SCORE_THRESHOLD`** (new optional) | `7.0` (`DEFAULT_SCORE_THRESHOLD`) | finite number in `[0, 10]`; reject out-of-range on write |
| Cross-run similarity | `crossRunSimilarityThreshold` (number, optional) | `CROSS_RUN_SIMILARITY_THRESHOLD` | `0.85` | finite number in `[0, 1]`; reject out-of-range on write |
| RSS last-N | `rssFeedMaxItems` (number, optional) | **`RSS_FEED_MAX_ITEMS`** (new optional) | `10` (`RSS_FEED_MAX_ITEMS` const) | integer in `1…50` |
| Drafter reasoning effort | `drafterReasoningEffort` (string, optional) | **`DRAFTER_REASONING_EFFORT`** (new optional) | `"high"` | exactly `low` \| `medium` \| `high` |
| Drafter max completion tokens | `drafterMaxCompletionTokens` (number, optional) | **`DRAFTER_MAX_COMPLETION_TOKENS`** (new optional) | `32000` | integer in `1024…128000` |

**Env middle-tier parse (PM-pinned — do not reuse clamp-as-success for `source`):** For resolver env layer (score, similarity, RSS last-N, reasoning effort, max tokens), use **try-parse** helpers that return `null` when the env value is empty, non-finite, out-of-range, or an invalid enum — then fall through with `source: "default"`. Do **not** treat clamp-as-success as env presence (e.g. `SCORE_THRESHOLD=99` must **not** become `source: "env"` with a clamped `10`). Existing `parseScoreThreshold` / `parseCrossRunSimilarityThreshold` may remain for legacy callers; the Stage 12 resolver must use strict try-parse (new helpers or wrappers) so `source` is unambiguous. **GUI write** still rejects out-of-range rather than clamping into the DB.

### Schema (pinned)

Append optional attributes to `app_settings` in `shared/src/schema/declarations.ts`. Provisioner create-if-absent only — no drop / rename / retype. Do **not** change `APP_SETTINGS_DOCUMENT_ID`, `runRetentionDays`, or the four global model fields.

Suggested string sizes: secrets/URL/host/user/from ≥ 512 (or match existing patterns); reasoning effort small (e.g. 16). Port/thresholds/tokens as `number` optional.

### Repository API (pinned)

Extend `shared/src/settings/`:

- Expand `AppSettings` with the new override fields (strings as `""` when unset; optional numbers as `number | null`).
- `getOrCreateAppSettings` maps new attributes defensively (corrupt → unset).
- **`updateOperatorSettings(client, input)` — full Stage-12 override object every call** (same spirit as `updateGlobalModelDefaults`, not sparse `Partial`). Caller always sends every Stage 12 field. Empty string / `null` **clears** that override. Omitted retention/models (preserve existing). All-or-nothing validation: any invalid field rejects the whole write.
- **SMTP in that full object:** either (A) complete valid required quartet (optional from/secure allowed), or (B) **clear-all**: all six SMTP attrs empty/`null`. Anything in between → `validation` error. Clear-all must wipe `smtpFrom` and `smtpSecure` too.
- Do not break `updateRunRetentionDays` / `updateGlobalModelDefaults`.

### Resolver API (pinned)

Add something like `shared/src/settings/resolve-operator-settings.ts` (name flexible):

```ts
type SettingsSource = "gui" | "env" | "default" | "none";

type ResolvedOperatorSettings = {
  openRouterApiKey: { value: string | null; source: SettingsSource };
  smtp: { value: SmtpConfig | null; source: SettingsSource }; // gui only if complete bundle
  appPublicUrl: { value: string | null; source: SettingsSource };
  scoreThreshold: { value: number; source: Exclude<SettingsSource, "none"> };
  crossRunSimilarityThreshold: { value: number; source: Exclude<SettingsSource, "none"> };
  rssFeedMaxItems: { value: number; source: Exclude<SettingsSource, "none"> };
  drafterReasoningEffort: { value: "low" | "medium" | "high"; source: Exclude<SettingsSource, "none"> };
  drafterMaxCompletionTokens: { value: number; source: Exclude<SettingsSource, "none"> };
};

resolveOperatorSettings(
  client: Client,
  opts?: { env?: NodeJS.ProcessEnv; settings?: AppSettings },
): Promise<ResolvedOperatorSettings>
```

- Load settings via `getOrCreateAppSettings` unless `settings` injected (tests).
- `source: "none"` only when a required-at-use value has no GUI/env and no code default (`openRouterApiKey`, `smtp`, `appPublicUrl`).
- Knobs with code defaults never use `"none"`.
- Env layer uses **strict try-parse → `null`** (see Env middle-tier parse above). Only an in-range / valid-enum env value yields `source: "env"`.
- Export those try-parse helpers (and env key name constants) so Feature 04 can call the same logic.
- **Do not** change production callers of `resolveSmtpConfig` / `resolveAppPublicUrl` / threshold getters in this feature.

### Docs (pinned)

Update project-root `.env.example` with commented optional keys:

- `SCORE_THRESHOLD=7.0`
- `RSS_FEED_MAX_ITEMS=10`
- `DRAFTER_REASONING_EFFORT=high`
- `DRAFTER_MAX_COMPLETION_TOKENS=32000`

Keep existing `CROSS_RUN_SIMILARITY_THRESHOLD`, SMTP, `APP_PUBLIC_URL`, `OPENROUTER_API_KEY` documentation. Short comments: GUI Settings override these when set; blank GUI falls back to env then code default.

## Dependencies

- Builds on: Stage 07 global model defaults / `app_settings` singleton pattern; Stage 05 similarity env parse; Stage 09 SMTP + `APP_PUBLIC_URL` helpers; Stage 11 `.env.example` packaging.
- Feature 02+ consume this store/resolver; Feature 04 wires runtime readers.

## Constraints

- Do not move Appwrite connection, `TZ`, or worker poll intervals into Settings.
- Do not add Settings UI, diagnostics, or consumer rewiring.
- Do not encrypt secrets in Stage 12 (plaintext + never-log; later security pass banked in Plan.md).
- Do not change mid-job live reload semantics — resolve is a library for next run/send/request (Feature 04).
- Do not drop/rename existing `app_settings` attributes.
- Never log OpenRouter key or SMTP password in plain form.

## Acceptance criteria

- [ ] `app_settings` schema declares the Stage 12 override attributes; provisioner can create them if absent.
- [ ] Operator overrides persist via repository update; blank clears fall through; invalid writes rejected with clear validation errors.
- [ ] Corrupt stored values on read do not crash load — field/bundle treated as no override.
- [ ] `resolveOperatorSettings` implements GUI → env → default, with SMTP all-or-nothing and `source` attribution.
- [ ] New optional env keys are documented in `.env.example`.
- [ ] Unit tests cover persist, resolve, SMTP incomplete-bundle fallthrough, invalid write, and corrupt-read fallthrough.
- [ ] Pipeline/delivery/RSS production callers are unchanged in this feature (Feature 04).
- [ ] `pnpm typecheck` and `pnpm lint` pass.

## Files

- Create: `shared/src/settings/resolve-operator-settings.ts` (name flexible)
- Create: `shared/src/settings/operator-settings.ts` (validation/types for Stage 12 overrides — or colocate; prefer not dumping everything into `repository.ts`)
- Create: `shared/src/settings/__tests__/resolve-operator-settings.test.ts`
- Modify: `shared/src/settings/types.ts`
- Modify: `shared/src/settings/repository.ts`
- Modify: `shared/src/settings/index.ts` (re-exports)
- Modify: `shared/src/settings/__tests__/repository.test.ts`
- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts` (assert new attrs present)
- Modify: `.env.example`
- Modify (as needed): `shared/src/pipeline/config.ts` (export env key constants / parsers for new knobs if that is the natural home alongside `CROSS_RUN_SIMILARITY_THRESHOLD_ENV`)
- Test (optional docs guard): extend an existing deploy/docs smoke test to assert the four new env key names appear in `.env.example` if a similar pattern already exists for `CROSS_RUN_SIMILARITY_THRESHOLD`

## Testing approach

Test-first. Behavior under Intent — not implementation trivia.

1. **Schema declarations** — `app_settings` includes the new optional attributes with expected types/required=false.
2. **Write validation** — out-of-range score/similarity/RSS/tokens, bad reasoning enum, bad public URL, incomplete SMTP quartet → `SettingsRepositoryError` `validation`; DB unchanged for that update.
3. **Clear overrides** — empty strings / null numbers persist as unset; SMTP clear-all empties all six SMTP attrs; resolver falls through to env then default.
4. **Corrupt read** — garbage types in document mapping → unset override, load succeeds.
5. **Resolve cascade** — GUI wins; else in-range env; else default; `source` correct. Out-of-range env (e.g. `SCORE_THRESHOLD=99`) → `source: "default"` (not `"env"`).
6. **SMTP bundle** — complete GUI quartet → `source: "gui"`; password-only / incomplete mapped state → resolve uses env for whole SMTP config; never mix. Incomplete write rejected.
7. **Secrets** — validation/appwrite error paths do not include raw password/key in thrown messages (spot-check like existing SMTP tests).
8. **Env docs** — `.env.example` contains the four new optional keys (and still documents existing ones).

## Tasks

### Task 1: Failing tests for store + resolve contract

- **Action**: Add/extend tests in `shared/src/settings/__tests__/repository.test.ts` and new `shared/src/settings/__tests__/resolve-operator-settings.test.ts` covering AC cases above (write reject, clear, corrupt read, cascade, SMTP incomplete → env, source tags). Add schema assertion stubs for new attrs if declarations tests are the home. Prefer tests red before implementation.
- **Expected result**: New tests exist and fail for missing APIs/attrs.
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new cases failing for the right reason (missing export/behavior), not syntax errors.
- **Depends on**: none.

### Task 2: Schema + `.env.example` optional keys

- **Action**: Append optional Stage 12 attributes to `app_settings` in `shared/src/schema/declarations.ts`. Update `shared/src/schema/__tests__/declarations.test.ts`. Add commented optional env keys to `.env.example` (`SCORE_THRESHOLD`, `RSS_FEED_MAX_ITEMS`, `DRAFTER_REASONING_EFFORT`, `DRAFTER_MAX_COMPLETION_TOKENS`) with short cascade comments. Export env key name constants next to existing similarity env constant if that keeps Feature 04 DRY.
- **Expected result**: Schema + example env document the contract; declarations tests green for new attrs.
- **Verify**: Declarations tests pass for new keys; `rg` shows the four new names in `.env.example`.
- **Depends on**: Task 1.

### Task 3: Types + validation helpers

- **Action**: Add Stage 12 override types and `validateOperatorSettings` (or equivalent) in `shared/src/settings/` — full-object input shape; ranges/enums from Spec table; SMTP complete-quartet **or** clear-all-six; public URL absolute http(s); never put secrets in validation messages.
- **Expected result**: Pure validation module used by repository update; unit-testable without Appwrite.
- **Verify**: Validation-focused tests pass (can live in repository or dedicated test file).
- **Depends on**: Task 2.

### Task 4: Repository read/write

- **Action**: Extend `AppSettings` + `documentToSettings` + `getOrCreateAppSettings` mapping. Implement `updateOperatorSettings(client, fullInput)` (full Stage-12 object every call; empty/`null` clears; SMTP clear wipes all six attrs). Reject-on-write; preserve retention/models. Extend repository tests to green for persist/clear/corrupt-read.
- **Expected result**: Overrides round-trip through mocked Appwrite; invalid updates throw `validation`.
- **Verify**: Repository tests green for Stage 12 fields.
- **Depends on**: Task 3.

### Task 5: Resolver

- **Action**: Implement `resolveOperatorSettings` (+ strict try-parse env helpers that return `null` for empty/out-of-range/invalid — not clamp-as-env). SMTP all-or-nothing; sources pinned; out-of-range env → `source: "default"`. No production caller rewiring. Make resolve tests green.
- **Expected result**: Exported resolver matches Spec; Feature 04 can import it later.
- **Verify**: Resolve tests green; `rg` confirms `resolveSmtpConfig(` / `resolveAppPublicUrl(` / `getCrossRunSimilarityThreshold(` call sites in delivery/pipeline/web are unchanged by this feature (no drive-by rewires).
- **Depends on**: Task 4.

### Task 6: Monorepo gates

- **Action**: Export new symbols from `shared/src/settings/index.ts`. Run full gates; fix fallout only as needed for this feature.
- **Expected result**: Typecheck + lint clean; shared settings/schema tests green.
- **Verify**: `pnpm typecheck` and `pnpm lint` pass; `pnpm --filter @newsletter/shared test` green for settings/schema suites touched.
- **Depends on**: Task 5.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test` (settings + schema suites) && `pnpm typecheck` && `pnpm lint`
- Expected: All new store/resolve/SMTP-bundle/corrupt-read/docs cases pass; typecheck and lint clean; no Settings UI route; production SMTP/public-URL/threshold readers still env-only until Feature 04.

## Handoff

Builder reports: files changed; attribute names chosen; `updateOperatorSettings` / `resolveOperatorSettings` exact export names; confirmation full-object write (not sparse patch); confirmation SMTP clear wipes optional from/secure; confirmation out-of-range env → `source: "default"`; confirmation secrets never logged; confirmation no consumer rewiring; any deviation (file split, attr sizes) and why. Note for Feature 02: always submit the full Stage-12 object; resolver `source` + raw `AppSettings` overrides are the load surface; Feature 04: swap call sites to `resolveOperatorSettings` (or thin wrappers) at next run/send/request.

### Research note

- Codebase: existing `app_settings` singleton + model-default empty→env→default pattern (`shared/src/settings/`); SMTP env resolver (`shared/src/delivery/smtp-config.ts`); `APP_PUBLIC_URL` (`shared/src/delivery/app-public-url.ts`); similarity env parse (`shared/src/pipeline/config.ts`); Stage 12 grill decisions 2026-08-10 / 2026-08-11 (Plan.md decision log + secrets carry-forward pin).
