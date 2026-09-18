# Feature 04: Secrets and leakage hygiene

## Intent

Stored operator secrets (OpenRouter key, SMTP password) are unreadable from a database dump, a settings save never reads or re-sends them, the API-key-backed client is structurally unbundlable into browser code, and token-scrubbing is enforced inside the low-level persist/log functions instead of remembered per call site — closing audit findings S4, S6, S7, S8, N3.

## Spec

### 1. Secrets encryption at rest (S4)

- New module `shared/src/settings/secrets.ts` (guarded, see §3): AES-256-GCM via `node:crypto`.
  - Env: `SETTINGS_SECRET_KEY` — exactly 64 hex chars (32 bytes). Read via `readRuntimeEnv`.
  - Ciphertext format: `enc1:` + base64( 12-byte random IV ‖ 16-byte GCM tag ‖ ciphertext ). Longest legal plaintext when encrypting is **350 UTF-8 bytes** (`Buffer.byteLength(plain, "utf8")` — char-count would break the bound for multibyte passwords), giving ciphertext ≤ 509 chars, which fits the existing 512-char attributes (Appwrite attribute sizes are immutable so the schema is deliberately unchanged).
  - Exports: `SETTINGS_SECRET_KEY_ENV`; `settingsCipherStatus(env?): "off" | "on" | "invalid"` (unset → `off`, 64-hex → `on`, set-but-malformed → `invalid`); `encryptSecretValue(plain): string` (throws `SettingsRepositoryError("validation", …)` — an operator-facing message — when cipher is `invalid`, or when `Buffer.byteLength(plain, "utf8") > 350` under `on`); `decryptSecretValue(stored): string` (no `enc1:` marker → returned as-is — legacy plaintext stays readable; marker + wrong/missing key or tampered ciphertext → returns `""` and `console.error`s a sanitized line — treat as unreadable, never throw); `isEncryptedSecretValue(v): boolean`.
- **Unset key (PM lean confirmed):** storing secrets is still allowed in plaintext; the Settings page shows a loud warning (§4). **Invalid key:** secret **writes** are refused (validation error surfaced to the GUI); reads of marked ciphertext count as unreadable (§4 banner).
- Encryption applies to `openRouterApiKey` and `smtpPassword` only. `smtpHost/Port/Username/From/Secure` stay plaintext (not secrets; masking flow treats them as normal fields).

### 2. Repository API split — sentinel saves, no read-modify-write (S6, S4 read path, N3 dead read)

Replace the full-object writer with section-scoped partial writers. **Delete `updateOperatorSettings`** (its only non-test callers are the settings actions, redesigned below) and the action-side helpers `mergeSecretKeep`, `operatorInputFromCurrent`, `persistOperatorSettings`.

- `getOrCreateAppSettings(client): Promise<AppSettings>` — unchanged signature; `documentToSettings` now **decrypts** the two secret fields via `decryptSecretValue` (legacy no-marker values pass through). `AppSettings` remains the server-side decrypted read model.
- New `updateConnectionSettings(client, input: UpdateConnectionInput): Promise<PublicAppSettings>`:
  - Non-secret fields use current semantics (present value replaces, `""`/null clears).
  - Secrets use **keep-sentinel semantics**: `""` → keep stored value; non-empty → replace. Effective resolution happens server-side by reading the stored document (raw, in-repository — never in the action).
  - Validates the **effective** SMTP bundle (complete host/port/username/password set, or all cleared) and the effective OpenRouter key charset/length — same messages as today. Length caps: the existing ≤ 512-char field validation still applies first; under cipher `on` the 350-byte encryption cap additionally applies and its validation error is the operator-facing one.
  - **Encrypt-on-write:** when cipher is `on`, any secret being persisted (new value, or a kept legacy-plaintext value) is stored as `enc1:` ciphertext; a kept already-encrypted value is re-persisted as-is. When `off`, stored plaintext. When `invalid`, a write that would persist a non-empty secret throws validation ("SETTINGS_SECRET_KEY is set but malformed…") — **including a kept stored secret**: a Connections save that keeps a stored secret is refused under an invalid key (fail-closed; non-secret-only saves succeed when nothing non-empty is being persisted, and fully-clearing writes always succeed). A kept **legacy-plaintext value longer than 350 bytes** cannot be re-encrypted — refuse with a validation error telling the operator to clear and re-enter the secret (or move it to env); never let it surface as a generic Appwrite-size error.
  - `updateDocument` sends **only** the connection attributes + `updatedAt` — knobs, retention, and model defaults are never touched and never read.
- New `updatePipelineKnobsSettings(client, input: UpdatePipelineKnobsInput): Promise<PublicAppSettings>` — validates the five knob fields (existing validators), partial-updates only those attributes + `updatedAt`. No read of anything.
- `updateGlobalModelDefaults` — partial-update only the five model attributes + `updatedAt`; delete the `existing = await getOrCreateAppSettings(...)` read (its retention echo is unnecessary under partial update).
- `updateRunRetentionDays` — delete the dead `existing` read and the `void existing;` suppression (N3 sub-finding 2).
- New `clearOpenRouterApiKeyOverride(client)` / `clearSmtpBundleOverride(client)` — partial-update `openRouterApiKey: ""` / all six SMTP attributes cleared, + `updatedAt`. No read.
- New `PublicAppSettings` type = `Omit<AppSettings, "openRouterApiKey" | "smtpPassword">` + `{ hasOpenRouterApiKey: boolean; hasSmtpPassword: boolean }`, and `toPublicAppSettings(settings): PublicAppSettings`. All `update*` functions above return it. No shared settings function returns plaintext secrets to GUI callers.
- New `getSettingsSecretsHealth(client): Promise<SettingsSecretsHealth>` = `{ cipher: "off" | "on" | "invalid"; storedSecretCount: 0 | 1 | 2; unreadableSecretCount: number }` — one raw doc read: counts stored (non-empty raw) secrets and unreadable ones (marker present but decrypt yields `""` with key missing/invalid).

### 3. `server-only` boundary on the API-key client and secret-bearing modules (S7 + S4 structural)

- Add `"server-only": "^0.0.1"` to `shared/package.json` dependencies.
- `import "server-only"` as the first line of `shared/src/appwrite/config.ts`, `shared/src/appwrite/server.ts`, `shared/src/settings/secrets.ts`, and `shared/src/settings/resolve-operator-settings.ts` (the latter returns plaintext resolved secrets — same boundary). Client components already import runtime values only via `@newsletter/shared/client` (verified: no client-graph runtime import of the root barrel today; root-barrel imports in `"use client"` files are type-only and erased).
- Worker bundling: the `server-only` package's default export throws outside the `react-server` condition — add `--conditions=react-server` to the esbuild `build` script in `worker/package.json` (resolves to its no-op empty module). No Dockerfile change (it runs the same script).
- Vitest: add `resolve: { conditions: ["react-server"] }` to all three configs (`vitest.config.ts`, `shared/vitest.config.ts`, `worker/vitest.config.ts`) so node-side tests resolve the no-op module. (If the installed Vite treats `conditions` as replacing rather than appending defaults, fall back to an alias `server-only` → a checked-in empty stub file — guard semantics must not weaken; note the choice in handoff.)
- `worker/package.json` `parity-run` script: prefix `NODE_OPTIONS=--conditions=react-server` so the tsx dev path still runs.
- Build probe (acceptance evidence, like Feature 03's loopback smoke): a throwaway `"use client"` component importing `getServerAppwrite` must FAIL `pnpm --filter web build` with the server-only error; revert immediately. Normal build must pass and client chunks must not contain `APPWRITE_API_KEY`.

### 4. Web actions, page, and cipher-health banner (S6 GUI + S4 warning)

- `web/app/(protected)/admin/settings/actions.ts`:
  - `saveConnectionsSettingsAction` passes the form payload straight to `updateConnectionSettings` — it no longer calls `getOrCreateAppSettings` and never sees stored secrets. GUI semantics are unchanged for the operator (the inputs already say "Leave blank to keep current").
  - `savePipelineKnobsSettingsAction` → `updatePipelineKnobsSettings` (no read of current).
  - `clearOpenRouterOverrideAction` / `clearSmtpOverrideAction` → the two dedicated clear functions (no read of current).
  - Diagnostics actions (`testOpenRouterConnectionAction`, `testSmtpConnectionAction`, `checkPublicUrlAction`) unchanged — they resolve saved settings through `resolveOperatorSettings`, which now decrypts transparently.
- Settings page (`web/app/(protected)/admin/settings/page.tsx` + `web/lib/settings-panel.ts`): also call `getSettingsSecretsHealth` and pass it into the DTO (`SettingsPanelData.secretsHealth`). `ConnectionsSettings` renders above the Connections section:
  - `cipher === "off"` **and** `storedSecretCount > 0` → warning: stored secrets are unencrypted; how to set `SETTINGS_SECRET_KEY`.
  - `cipher === "invalid"` → destructive alert: secret saves are refused until the key is fixed.
  - `unreadableSecretCount > 0` → destructive alert: stored secrets can't be decrypted with the current key (key changed/lost); resolution falls back to env — re-enter secrets to re-store them.
- No other GUI change; masked-edit flow keeps working (blank = keep).

### 5. Enforced redaction in low-level persist/log functions (S8)

- `markFailed` (`shared/src/runs/repository.ts`): replace `input.failureMessage.slice(0, FAILURE_MESSAGE_MAX)` with `redactMessageForStorage(input.failureMessage, FAILURE_MESSAGE_MAX)` — persisted text is redacted regardless of caller. (Idempotent: existing caller-side redaction is harmless.)
- `recordFeedTestResult` (`shared/src/feeds/repository.ts`): persist `redactMessageForStorage(error, 200)` for the failed case.
- `shared/src/health/check.ts`: delete the TODO block; every `console.error({ phase, code, message })` (create / read / cleanup-delete / delete) becomes `message: sanitizeAppwriteMessageForLog(message)`; every `HealthStepResult.errorMessage` becomes a bounded redacted copy via `sanitizeAppwriteMessageForLog(message)` (the GUI health card never renders raw upstream errors).
- `shared/src/feeds/qualify.ts`: both `console.error` blocks sanitize — `errorMessage: sanitizeAppwriteMessageForLog(failure.errorMessage)` and `scrapeError: sanitizeAppwriteMessageForLog(String(scraped.error))`. Returned `reason` strings stay fixed literals (already safe).

### 6. Code hygiene (N3)

- Hoist `describeError` into `shared/src/util/log-redact.ts` (exported). Delete the 8 local copies: `settings/repository.ts`, `runs/repository.ts`, `prompts/repository.ts`, `newsletters/repository.ts`, `newsletters/attachments.ts`, `health/check.ts`, `feeds/repository.ts`, and `runs/issues.ts` (there under the name `describeErrorForLog` — switch its call sites to the shared import).
- `newsletters/attachments.ts` `listAttachments` feeds fallback: delete the dead `instanceof FeedRepositoryError` branch (both arms were identical `wrapAppwriteError` calls) — single `wrapAppwriteError(err, "list-attachments-feeds")`.
- `void existing;` removal is covered by §2.

### 7. Docs and audit bookkeeping

- `.env.example`: new commented section (place before the SMTP section) documenting `SETTINGS_SECRET_KEY` — 64 hex chars, `openssl rand -hex 32`, what it protects, plaintext-with-warning behavior when unset, and that rotating/losing it makes stored secrets unreadable until re-entered.
- `docs/DEPLOY.md` → "Configure environment": one short paragraph + the generation command; note the key must be identical in the one `.env` both containers read (`env_file`).
- Tick the `S4-20260917`, `S6-20260917`, `S7-20260917`, `S8-20260917`, `N3-20260917` checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings (Plan.md carry-forward pin).

## Dependencies

- None code-wise — independent of Features 01/02/03 (may run before or after). Stage 15 complete (stage-level dependency satisfied).
- Overlap note: Feature 02 also edits `.env.example` (X2 loader note) and `docs/DEPLOY.md` (headers/binding). Different sections; whichever runs second rebases trivially.

## Constraints

- **No schema changes** — attribute sizes are immutable in Appwrite; the 512-char attributes stay, and the `enc1:` format guarantees ciphertext ≤ 509 chars for the ≤ 350-UTF-8-byte plaintext cap enforced under encryption.
- Existing deployments without `SETTINGS_SECRET_KEY` must behave exactly as today (plaintext storage + a warning banner; runs, sends, and diagnostics untouched).
- `resolveOperatorSettings` return shape is unchanged — the worker (`sendIssue-email`, LLM key resolution) and diagnostics need zero code changes; decryption is transparent.
- `AppSettings` stays the server-side decrypted read model; only GUI-facing functions return `PublicAppSettings` / `{ok}` envelopes.
- Secrets cross the action boundary only as operator-typed input (replace) or `""` (keep) — stored secrets are never re-sent to or read by the browser.
- Existing GUI masked-edit UX is unchanged (blank = keep; Clear buttons dedicated).
- The `@newsletter/shared/client` barrel keeps its current export set (browser-safe only); no new runtime exports move there.
- Legacy plaintext secrets remain readable until replaced; any Connections save with the key set migrates kept values to ciphertext (lazy migration, no backfill job).
- Env-delivered secrets (`OPENROUTER_API_KEY`, `SMTP_PASSWORD` in `.env`) are untouched — they already live only in the deploy environment.

## Acceptance criteria

- [ ] With `SETTINGS_SECRET_KEY` set, a saved OpenRouter key / SMTP password round-trips (GUI save → `resolveOperatorSettings` returns the plaintext) while the stored document attribute contains only `enc1:` ciphertext — no plaintext secret is retrievable from a document dump. (S4)
- [ ] Key unset: saves still work, stored values stay plaintext, and the Settings page shows the warning; key malformed: secret saves are refused with a clear error and the page shows the destructive alert; unreadable ciphertext (key changed) surfaces the unreadable-secrets alert and resolution falls back to env. (S4)
- [ ] A Connections or Pipeline-knobs save never calls `getOrCreateAppSettings` in the action and never re-sends stored secrets — `""` secrets keep stored values; partial updates never touch other sections' attributes. (S6)
- [ ] No shared settings function exposes plaintext secrets to GUI callers; serialized action results and the page DTO contain no substring of stored secrets (snapshot-asserted). (S4, S6)
- [ ] Importing `getServerAppwrite` (or anything from the guarded modules) into a `"use client"` component fails `next build`; the normal build passes; `rg APPWRITE_API_KEY` over `.next/static` finds nothing; the worker still builds and its tests pass. (S7)
- [ ] `markFailed` persists `[redacted]` for messages containing `sk-or-v1-…` tokens; health-check logs and `HealthStepResult.errorMessage` are redacted and bounded; qualify logs are sanitized; `recordFeedTestResult` persists bounded redacted errors. (S8)
- [ ] `describeError` is defined exactly once (`util/log-redact.ts`); no `void x;` suppressions or dead duplicated branches remain. (N3)
- [ ] S4, S6, S7, S8, N3 checkboxes ticked in the audit report.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.

## Files

- Create: `shared/src/settings/secrets.ts`
- Create: `shared/src/settings/__tests__/secrets.test.ts`
- Modify: `shared/package.json` (+`server-only`)
- Modify: `worker/package.json` (build `--conditions=react-server`; `NODE_OPTIONS` on `parity-run`)
- Modify: `vitest.config.ts`, `shared/vitest.config.ts`, `worker/vitest.config.ts` (+`react-server` condition or stub alias)
- Modify: `shared/src/appwrite/{config,server}.ts` (server-only guard)
- Modify: `shared/src/settings/resolve-operator-settings.ts` (server-only guard)
- Modify: `shared/src/settings/repository.ts` (§2 API split, decrypt-on-read, encrypt-on-write, secrets health, N3)
- Modify: `shared/src/settings/operator-settings.ts` (input types → `UpdateConnectionsInput` / `UpdatePipelineKnobsInput`; validators refactored; bundle check on effective values)
- Modify: `shared/src/settings/types.ts` (`PublicAppSettings`, `SettingsSecretsHealth`)
- Modify: `shared/src/settings/index.ts` (exports)
- Modify: `shared/src/settings/__tests__/repository.test.ts` (rewrite operator-override writer tests to the new API; add encryption/keep/clear cases)
- Modify: `shared/src/settings/__tests__/resolve-operator-settings.test.ts` (decrypt passthrough cases)
- Modify: `web/app/(protected)/admin/settings/actions.ts` (§4)
- Modify: `web/app/(protected)/admin/settings/page.tsx`, `web/lib/settings-panel.ts`, `web/components/settings/connections-settings.tsx` (banner)
- Modify: `web/src/__tests__/settings-actions.test.ts` (rewrite merge tests to sentinel contract)
- Modify: `web/src/__tests__/settings-panel.test.tsx` (banner data; keep no-secret assertions)
- Modify: `shared/src/util/log-redact.ts` (+`describeError`)
- Modify: `shared/src/runs/repository.ts` (markFailed redaction; shared describeError)
- Modify: `shared/src/runs/__tests__/repository.test.ts` (markFailed token case)
- Modify: `shared/src/runs/issues.ts` (shared describeError)
- Modify: `shared/src/{feeds,newsletters,prompts}/repository.ts` (shared describeError)
- Modify: `shared/src/newsletters/attachments.ts` (dead branch)
- Modify: `shared/src/health/check.ts` (+ its test)
- Modify: `shared/src/feeds/qualify.ts` (+ its test)
- Modify: `.env.example`, `docs/DEPLOY.md`
- Modify: `.ssc/reviews/review-app-public-exposure-2026-09-17.md` (tick S4, S6, S7, S8, N3)

## Testing approach

Test-first throughout (hermetic — fake Databases via the existing mock patterns, env injected via `opts.env`/`vi.stubEnv`):

- **`secrets.test.ts` (§1):** round-trip encrypt→decrypt equals plaintext and differs from it; output has `enc1:` marker and ≤ 509 chars for a 350-byte input; a 200-char multibyte (e.g. emoji) password exceeds the 350-byte cap and throws validation; decrypt of legacy no-marker value passes through; wrong key / tampered ciphertext → `""`; status `off`/`on`/`invalid` for unset / 64-hex / malformed; > 350 bytes under `on` throws validation; `invalid` status write refusal.
- **`repository.test.ts` (§2):** `updateConnectionSettings` with `""` secrets → updateDocument data carries the kept stored value (encrypted when key on) and never the plaintext; with new values under key on → data carries `enc1:` ciphertext; SMTP effective-bundle reject (cleared host + kept password); keep of legacy plaintext under key on re-stores ciphertext (lazy migration); keep of a > 350-byte legacy-plaintext secret under key on → validation refusal with the clear-and-re-enter message (not a generic Appwrite error); **invalid-key matrix:** invalid + stored non-empty secret + keep → validation refusal, invalid + no stored secret + non-secret-only save → succeeds, invalid + fully-clearing save → succeeds; partial-update assertion — data keys contain exactly the connection attributes + `updatedAt`; `updatePipelineKnobsSettings` touches only knob attributes; `updateGlobalModelDefaults` / `updateRunRetentionDays` make no `getDocument` call; clear functions write `""`s; all updates return `PublicAppSettings` (no secret keys present); `getOrCreateAppSettings` decrypts marked values with the key set, passes legacy through, yields `""` for unreadable; `getSettingsSecretsHealth` counts stored/unreadable for the off/invalid/on matrix.
- **`settings-actions.test.ts` (§4):** rewritten — save actions do not mock-see `getOrCreateAppSettings` called; `""` passes through untouched (no merged stored value in the payload); Clear actions call the dedicated functions; every serialized result lacks stored-secret substrings.
- **DTO/banner tests (§4):** `toSettingsPanelData` output + `secretsHealth` mapping — serialized DTO never contains stored key/password (existing sentinel assertions kept); banner variant per health state (component test).
- **S8:** `markFailed` with `sk-or-v1-<64hex>` in the message → stored `[redacted]` (fake Databases captures data); health check with a throwing fake whose message embeds a bearer token → log spy shows no token and `errorMessage` redacted/bounded; qualify failure logs sanitized (console.error spy); `recordFeedTestResult` persists redacted/bounded error.
- **S7:** the build probe (throwaway client import → `pnpm --filter web build` fails; reverted) + green `pnpm --filter web build` + `rg -n "APPWRITE_API_KEY" web/.next/static` → no matches; `pnpm --filter worker build` succeeds and `pnpm vitest run worker` passes (proves the condition resolves the no-op module).
- **N3:** `rg -n "function describeError" shared/src` → only `util/log-redact.ts`; existing feeds/newsletters/settings tests stay green (attachments dead-branch deletion changes nothing observable).

## Tasks

### Task 1: server-only boundary plumbing (S7)

- **Action**: Add `server-only` to `shared/package.json`; add `import "server-only"` to `config.ts`, `server.ts`, `resolve-operator-settings.ts`; add `--conditions=react-server` to the worker build script and `NODE_OPTIONS=--conditions=react-server` to `parity-run`; add the `react-server` condition (or stub alias fallback) to all three vitest configs.
- **Expected result**: All existing tests and both builds pass unchanged; guarded modules resolve the no-op module in worker/vitest contexts.
- **Verify**: `pnpm test` green; `pnpm --filter worker build` exits zero; `pnpm --filter web build` exits zero and `rg -n "APPWRITE_API_KEY" web/.next/static` returns nothing. Then the throwaway probe: a temp `"use client"` component importing `getServerAppwrite` makes `pnpm --filter web build` FAIL with the server-only error — record evidence, revert probe.
- **Depends on**: none.

### Task 2: secrets crypto module (S4 core) — red then green

- **Action**: Create `shared/src/settings/__tests__/secrets.test.ts` per Testing approach (red — module absent). Then implement `shared/src/settings/secrets.ts` (Spec §1) with its own `import "server-only"`.
- **Expected result**: All secrets tests green; no other module touches it yet.
- **Verify**: `pnpm vitest run shared/src/settings/__tests__/secrets.test.ts` passes.
- **Depends on**: Task 1 (guarded module needs the condition in place).

### Task 3: repository split + encryption wiring (S4, S6, N3 dead read) — red then green

- **Action**: Rewrite the operator-override blocks of `shared/src/settings/__tests__/repository.test.ts` to the new API (red), then implement Spec §2 in `shared/src/settings/{repository,operator-settings,types,index}.ts`.
- **Expected result**: Sentinel saves, encrypt-on-write, decrypt-on-read, clear functions, `PublicAppSettings` returns, secrets health, and the N3 dead-read removal are all in place; `updateOperatorSettings` is gone.
- **Verify**: `pnpm vitest run shared/src/settings` passes; `rg -n "updateOperatorSettings" shared/src web/app` returns nothing.
- **Depends on**: Task 2.

### Task 4: web actions + banner (S6 GUI, S4 warning) — red then green

- **Action**: Rewrite `web/src/__tests__/settings-actions.test.ts` to the sentinel contract (red), extend the settings-panel/DTO tests with `secretsHealth`. Then implement Spec §4 in the actions, page, `settings-panel.ts`, and `connections-settings.tsx` banner.
- **Expected result**: Actions never read settings to save them; banner renders per health state; masked-edit flow unchanged.
- **Verify**: `pnpm vitest run web/src/__tests__/settings-actions.test.ts web/src/__tests__/settings-panel.test.tsx` passes.
- **Depends on**: Task 3.

### Task 5: describeError hoist + dead branch (N3)

- **Action**: Add `describeError` to `shared/src/util/log-redact.ts`; switch the 8 files to import it (deleting local copies incl. `describeErrorForLog`); delete the dead `instanceof FeedRepositoryError` branch in `attachments.ts`.
- **Expected result**: One definition; behavior unchanged.
- **Verify**: `rg -n "function describeError" shared/src` matches only `util/log-redact.ts`; `pnpm vitest run shared/src` passes; `pnpm typecheck` passes.
- **Depends on**: none (ordered after Task 3 to avoid churn in `settings/repository.ts`).

### Task 6: enforced redaction (S8) — red then green

- **Action**: Add red-first cases: markFailed token redaction in `runs/__tests__/repository.test.ts`, sanitized health results in `health/__tests__/check.test.ts`, sanitized qualify logs in `feeds/__tests__/qualify.test.ts`, bounded `recordFeedTestResult` in the feeds repository tests. Then implement Spec §5.
- **Expected result**: No `console.error` or persisted `errorMessage` in the touched paths bypasses the redactors; the health TODO is gone.
- **Verify**: `pnpm vitest run shared/src/runs/__tests__/repository.test.ts shared/src/health shared/src/feeds` passes.
- **Depends on**: Task 5 (check.ts imports the shared describeError).

### Task 7: docs, gates, audit ticks

- **Action**: `.env.example` + `docs/DEPLOY.md` entries (Spec §7). Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all must pass). Tick S4, S6, S7, S8, N3 in the audit report.
- **Expected result**: All gates green; report reflects the five findings remediated.
- **Verify**: Three commands exit zero; the report shows `[x]` for all five IDs.
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build && pnpm --filter worker build`
- Expected: All exit zero. Within `pnpm test`: secrets tests prove round-trip + ciphertext-only storage + status matrix; repository tests prove keep-sentinel saves, partial updates, and lazy migration; action tests prove no read-modify-write and no secret substrings in results; S8 tests prove enforced redaction. Supporting probes: `rg -n "APPWRITE_API_KEY" web/.next/static` → nothing; `rg -n "function describeError" shared/src` → one hit; `rg -n "updateOperatorSettings|mergeSecretKeep" shared/src web/app` → nothing; `rg -n "SETTINGS_SECRET_KEY" .env.example docs/DEPLOY.md shared/src/settings/secrets.ts` → hits all three.

## Handoff

Report to the manager: files created/modified; red-run evidence for Tasks 2, 3, 4, 6 (which assertions failed pre-implementation); the vitest condition-vs-alias choice made in Task 1 and why; the build-probe evidence (client-import failure output + clean normal build); confirmation that an unkeyed deployment path was exercised (a test simulating key-unset save/load); any deviations from this spec and why (e.g. Appwrite SDK partial-update behavior, Vite condition semantics — security semantics must not weaken).

## Research note

- Codebase reads (2026-09-17): `settings/repository.ts` (`updateOperatorSettings` 347–393 full-write + `existing` read; `updateRunRetentionDays` 265–298 dead `existing`/`void`; `documentToSettings` 186–218), `settings/operator-settings.ts` (input semantics "" = clear; SMTP all-or-nothing bundle validation 218–291; length caps 512), `settings/resolve-operator-settings.ts` (262–349; return shape consumed unchanged by worker/diagnostics), `settings/types.ts` (`AppSettings`), `settings/connection-diagnostics.ts` (`loadResolved`), `web/app/(protected)/admin/settings/{actions,page}.tsx` (`mergeSecretKeep` 68–70, read-modify-write 114–144; page passes `settings` into `toSettingsPanelData`), `web/lib/settings-panel.ts` (secret-stripped DTO + existing no-leak assertions), `web/components/settings/connections-settings.tsx` (blank = keep placeholders; dedicated Clear buttons — GUI already matches sentinel semantics), `web/src/__tests__/settings-actions.test.ts` (read-modify-write assertions ~143–200 to rewrite), `runs/repository.ts` (`markFailed` 453–489 slice without redaction), `health/check.ts` (raw `console.error`/`errorMessage` at 78–160; TODO 41–44), `feeds/qualify.ts` (unsanitized logs 31–36, 84–88), `feeds/repository.ts` (`recordFeedTestResult` persists `error` verbatim; local describeError 30–38), `newsletters/attachments.ts` (dead branch 189–196), `runs/issues.ts` (`describeErrorForLog` 358–366), `util/log-redact.ts` (redactors; idempotent under repeat application), `appwrite/{config,server}.ts` + `shared/src/index.ts` vs `client.ts` (client components import runtime values only via `@newsletter/shared/client`; root-barrel imports in client files are type-only), worker `package.json` (esbuild CLI build; `parity-run` tsx), all three vitest configs (no conditions today), `schema/declarations.ts` (secret attrs string 512 — sizes immutable; ciphertext ≤ 509 for ≤ 350-char plaintext), `compose.yaml` (`env_file: .env` reaches both containers — one env var covers web+worker).
- `server-only` package mechanics (web search + docs 2026-09-17: npm `server-only@0.0.1`, Vercel "Server-Only Packages" guide, esbuild `--conditions` docs): default export throws outside the `react-server` condition; Next fails the client build with a dedicated error; esbuild/tsx/vitest need the condition added explicitly. PM decisions confirmed this session: auto mode; lean adopted — key unset → plaintext + loud warning, key invalid → refuse secret writes; env name `SETTINGS_SECRET_KEY`; lazy migration on next save (no backfill); Settings page is the banner surface.
