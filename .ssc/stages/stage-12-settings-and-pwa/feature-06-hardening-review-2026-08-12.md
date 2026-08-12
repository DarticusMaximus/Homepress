# Feature 06: Harden stage-12 against review findings (2026-08-12)

## Intent

Harden `stage-12-settings-and-pwa` against findings from `review-stage-12-settings-and-pwa-2026-08-12`: lock down the public-URL diagnostic against redirect/SSRF amplification, keep SMTP and Settings failure logs free of secrets, make incomplete/corrupt Appwrite reads honest (whole-bundle SMTP clear + invalid knobs unset), resolve RSS settings once per request, and stop invalid knob keystrokes from silently clearing overrides — without reopening features 01–05.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–05 stay `verified`. It addresses **all eleven** PM-accepted Medium findings (clusters A–G). Distilled work — not a copy of the report.

### S1 (Medium) — harden `diagnosePublicUrl` redirects (cluster A)

Today `diagnosePublicUrl` in `shared/src/settings/connection-diagnostics.ts` does `fetch(url, { redirect: "follow" })` with no redirect cap and no final-host check. Feature 03 intentionally requires a server-side reachability GET (including hairpin/NAT and private LAN bases for self-host). **Do not** require the configured public URL itself to pass feed-style `isPubliclyRoutableUrl` — that would break legitimate LAN/`APP_PUBLIC_URL` deploys.

**Fix (required):**

1. Cap redirects (e.g. max **5**) and/or follow manually (`redirect: "manual"`) so unbounded cross-host chains cannot run.
2. Before issuing a request to a URL (initial **and** each redirect target), if the host is a **literal** link-local / cloud-metadata address (`169.254.169.254`, `metadata.google.internal`, IPv6 link-local equivalents as already blocked in `shared/src/feeds/ssrf.ts` where cheap to reuse), return **`warn`** (Feature 03 unreachable class) **without** performing that hop. Message must remain operator-readable and include the resolved public URL when applicable; never include secrets.
3. Prefer same-host redirects; on **cross-host** redirect to a blocked/metadata/link-local target → **warn**, do not fetch the blocked hop.
4. Keep Feature 03 outcomes: unset/`none` → **fail**; non-http(s) → **fail**; final 2xx → **pass**; timeout/refused/DNS/TLS/non-2xx → **warn**.
5. Reuse helpers from `shared/src/feeds/ssrf.ts` only where they fit without inventing a second IP-block alphabet; if full DNS-based `isPubliclyRoutableUrl` would reject private LAN **base** URLs, do **not** apply it to the configured base — apply block checks to **redirect targets** (and literal metadata hosts) as pinned above.

### S2 + N2 (Medium) — SMTP send failure logs must not leak passwords (cluster B)

Today `sendIssueEmail` logs transport failures through `sanitizeAppwriteMessageForLog`, which only redacts `sk-*`, Bearer tokens, and ≥24-char `[A-Za-z0-9_-]` runs. Short / punctuation SMTP passwords echoed by nodemailer survive. Tests use LONG_RUN-matching fixtures (`unit-test-smtp-password-do-not-leak`, etc.), so they pass under the weak heuristic (N2).

**Fix (required):**

1. On the `sendIssueEmail` transport-failure log path: **never** log the raw transport message as the sole defense. Prefer one of:
   - Log a **fixed** operator-safe summary (e.g. phase + “SMTP send failed”), **or**
   - Redact using the **known resolved SMTP password** (and username if present) before any console output — substring replace of the exact secret values, then optionally still run `sanitizeAppwriteMessageForLog`.
2. Operator-facing `{ ok: false, error }` remains a safe generic string (no password) — keep that contract.
3. **Tests (N2):** change fixtures to short/special-char passwords that do **not** match LONG_RUN (e.g. `hunter2`, `P@ssw0rd!`). Inject them into transport `Error` messages; assert `console.error` output never contains those substrings. Existing “operator error excludes password” asserts stay.

### O2 (Medium) — Settings action failure logs must sanitize (cluster C)

Today `mapSettingsActionError` in `web/app/(protected)/settings/actions.ts` does `console.error(\`[settings/actions] ${phase}\`, err)` with the raw object, while `mapDiagnosticActionError` sanitizes. Save/clear paths merge OpenRouter keys and SMTP passwords.

**Fix (required):**

1. Log only phase + a **sanitized string** (and optional safe `name`/`code`), never the raw `Error` object / unknown err dump, on all settings action failure paths that touch operator secrets (Connections save, OpenRouter clear, SMTP clear — and knobs save for consistency).
2. Reuse `sanitizeAppwriteMessageForLog` (same spirit as diagnostics). Extract a small shared helper in the actions module if it avoids duplication.
3. Add a test: force `updateOperatorSettings` to reject with a message embedding a fake `sk-or-TESTSECRET` and a short SMTP password; assert console output excludes both.

### C1 + N1 (Medium) — incomplete SMTP read clears all six attrs (cluster D)

Feature 01 Spec: incomplete/corrupt SMTP Appwrite data → **no override for the whole SMTP bundle** on read. `documentToSettings` maps fields independently; incomplete fixtures leave host/from/secure populated. The repository test titled as “leaves SMTP fields unset” only asserts `smtpPassword === ""` and weak typeof checks (N1).

**Fix (required):**

1. After mapping SMTP fields in `documentToSettings` (or a post-map step), if the required quartet (`smtpHost`, `smtpPort`, `smtpUsername`, `smtpPassword`) is not **all** present and valid (non-empty trimmed strings; port finite positive integer), force **all six** SMTP attrs to unset (`""` / `null` for port) before returning `AppSettings`.
2. Complete valid quartet still round-trips (optional from/secure remain as mapped when quartet complete).
3. **Rewrite N1:** incomplete/corrupt SMTP read test must assert all six fields unset. Drop tautological typeof-only expects. Keep / add a paired resolve case that historically incomplete stored mapping still yields `smtp.source === "env"` (or `"none"`) — not `"gui"`.

### C2 + T1 (Medium) — corrupt / out-of-range / invalid-enum unset on read + resolve coverage (cluster E)

Spec: whitespace-only and corrupt-on-read → unset at that layer. Mappers currently keep whitespace strings, invalid reasoning enums, and finite out-of-range numbers. Resolve compensates via `tryGui*`, but raw `AppSettings` / Settings UI can show phantom overrides. Resolve tests cover out-of-range **env** but not typed-invalid **GUI** values (T1).

**Fix (required):**

1. On read mapping for Stage 12 fields:
   - Strings: trim; whitespace-only → `""`.
   - `drafterReasoningEffort`: only `low` \| `medium` \| `high` (exact); else `""`.
   - `appPublicUrl`: if non-empty after trim, must be absolute `http:`/`https:` (same spirit as write validation); else `""`. Prefer strip trailing `/` when keeping a valid URL (match store behavior).
   - Numbers: apply the same ranges as Feature 01 write validation (`scoreThreshold` `[0,10]`, `crossRunSimilarityThreshold` `[0,1]`, `rssFeedMaxItems` `1…50`, `drafterMaxCompletionTokens` `1024…128000`, `smtpPort` positive integer). Out-of-range / non-finite → `null`.
2. Do **not** change write-path reject-on-invalid behavior.
3. **T1 tests:** for each Stage 12 knob, resolve with invalid same-type GUI value + valid env → `source: "env"`; invalid GUI + no env → `source: "default"` (or `"none"` only where applicable). Never `source: "gui"`.

### C3 + N3 (Medium) — RSS GET resolves operator settings once (cluster F)

Feature 04: public RSS GET resolves **once** per HTTP request. Today the route calls `resolveOperatorSettings` for last-N then `resolveEffectiveAppPublicUrl` (which re-calls the resolver). Tests assert both helpers were called (N3), locking in the bug.

**Fix (required):**

1. Perform a **single** `resolveOperatorSettings(client)` (or equivalent single cascade read) per successful RSS GET.
2. Derive `rssFeedMaxItems` **and** the public base URL from that snapshot. Prefer a sync helper (e.g. extract base from `resolved.appPublicUrl`, throwing/mapping `AppPublicUrlError` when `source === "none"`) so `resolveEffectiveAppPublicUrl` is not required on this path — **or** extend the effective-URL API to accept an already-resolved snapshot / value without a second Appwrite read.
3. Update `web/src/__tests__/rss-feed-route.test.ts`: assert `resolveOperatorSettings` call count === **1**; stop requiring a second Appwrite-backed `resolveEffectiveAppPublicUrl` round-trip. Limit + feed URL must come from the same snapshot.

### C4 (Medium) — invalid knob input must not silent-clear (cluster G)

Feature 02: blank / `""` / `null` after trim clears; numeric `0` is a valid override. Today `parseOptionalNumber` / `parseOptionalInteger` in `pipeline-knobs-settings.tsx` map non-finite non-empty input to `null`, and Save sends `null` as clear — so typos can wipe overrides.

**Fix (required):**

1. Distinguish **empty** (clear) from **invalid non-empty** (block Save).
2. On invalid numeric/integer input: do **not** call the save action with `null` clears; show `toast.error` with an operator-readable message (field-level or section-level).
3. Empty still clears; `0` still round-trips as GUI override; in-range values still save.
4. Add a component test: set score (or another knob) to an invalid string (or simulate the parse path), click Save → action not called with null-clear for that field (or not called at all) + error toast path covered.

## Dependencies

- Builds on: **features 01–05 of this stage** (already `verified`).
- Anchor: `.ssc/reviews/review-stage-12-settings-and-pwa-2026-08-12.md`.
- Redaction: `shared/src/util/log-redact.ts` → `sanitizeAppwriteMessageForLog`.
- SSRF helpers (reuse carefully): `shared/src/feeds/ssrf.ts`.
- Resolver / store: `shared/src/settings/repository.ts`, `resolve-operator-settings.ts`, `operator-settings.ts` validation ranges/enums.
- RSS: `web/app/rss/[newsletterId]/route.ts`, `shared/src/delivery/app-public-url.ts`.

## Constraints

- **Do not reopen** features 01–05 status; this is additive hardening.
- **Keep** Feature 01 cascade, SMTP all-or-nothing write rules, plaintext-in-Appwrite secret model (stronger secret storage remains Plan carry-forward).
- **Keep** Feature 03 diagnostic Intent: OpenRouter key GET, SMTP To=From, public URL pass/warn/fail semantics — harden redirects without removing the reachability check.
- **Keep** Feature 04 freeze-once for runs; this feature only fixes RSS once-per-request.
- **Keep** Feature 05 PWA contract (no SW / install banner work in this feature).
- **Do not** require the configured public URL base itself to be “publicly routable” (LAN self-host must still be checkable).
- **Do not** log OpenRouter keys or SMTP passwords in any new or changed log path.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [x] Public URL diagnostic still pass/warn/fail per Feature 03; cross-host / metadata / link-local redirect targets are not successfully fetched; unit tests cover redirect hardening (S1).
- [x] `sendIssueEmail` failure logs never emit short, long, or special-character SMTP passwords; fixtures no longer rely on LONG_RUN-only redaction (S2, N2).
- [x] Settings save/clear failure logs use sanitized strings (no raw `err` object dump); tests cover fake key + short password in reject messages (O2).
- [x] `getOrCreateAppSettings` never returns a partial SMTP override; incomplete/corrupt SMTP maps to all-six unset; repository test enforces all six (C1, N1).
- [x] Whitespace-only strings and out-of-range / invalid-enum same-type values map to unset in `AppSettings`; resolve tests prove invalid GUI knobs are never `source: "gui"` (C2, T1).
- [x] Public RSS GET performs a single operator-settings resolve per request; last-N + public URL share that snapshot; tests enforce call count === 1 (C3, N3).
- [x] Invalid non-empty knob input does not persist as null clears; empty still clears; `0` still round-trips (C4).
- [x] `pnpm typecheck` and `pnpm lint` pass; touched shared + web suites green.

## Files

- Modify: `shared/src/settings/connection-diagnostics.ts` — redirect/SSRF harden for public URL probe (S1)
- Modify: `shared/src/settings/__tests__/connection-diagnostics.test.ts` — redirect / metadata cases (S1)
- Modify: `shared/src/delivery/send-issue-email.ts` — secret-safe transport failure logging (S2)
- Modify: `shared/src/delivery/__tests__/send-issue-email.test.ts` — short/special-char password fixtures + log asserts (S2, N2)
- Modify: `web/app/(protected)/settings/actions.ts` — sanitize settings action failure logs (O2)
- Modify: `web/src/__tests__/settings-actions.test.ts` — secret-in-reject-message log asserts (O2)
- Modify: `shared/src/settings/repository.ts` — whole-bundle SMTP clear + corrupt/out-of-range/invalid mapping on read (C1, C2)
- Modify: `shared/src/settings/__tests__/repository.test.ts` — all-six unset + whitespace/range/enum mapping (C1, N1, C2)
- Modify: `shared/src/settings/__tests__/resolve-operator-settings.test.ts` — invalid typed GUI knob fallthrough (T1)
- Modify: `web/app/rss/[newsletterId]/route.ts` — single resolve per GET (C3)
- Modify (as needed): `shared/src/delivery/app-public-url.ts` — sync helper or snapshot overload so RSS need not double-resolve (C3)
- Modify: `web/src/__tests__/rss-feed-route.test.ts` — once-only resolve contract (C3, N3)
- Modify: `web/components/settings/pipeline-knobs-settings.tsx` — invalid input blocks clear (C4)
- Modify: `web/src/__tests__/settings-panel.test.tsx` (and/or knobs-focused test) — invalid Save path (C4)

## Testing approach

Test-first where practical: add failing cases per cluster, then implement.

1. **S1** — Mock fetch that 302s to `http://169.254.169.254/`; assert warn/fail without requesting metadata. Same-host redirect can still pass. Cross-host to blocked target → warn. Unset URL still fail.
2. **S2/N2** — Transport error message includes `hunter2` / `P@ssw0rd!`; console must not contain them; operator `{ ok: false }` still safe.
3. **O2** — Reject with message containing `sk-or-TESTSECRET` and `hunter2`; settings action console output excludes both.
4. **C1/N1** — Incomplete SMTP document → all six unset; complete quartet round-trips; weak password-only expect removed.
5. **C2/T1** — Whitespace / out-of-range / bad enum map to unset; resolve invalid GUI + env → env; invalid GUI alone → default.
6. **C3/N3** — RSS route: `resolveOperatorSettings` called once; limit + link base from that snapshot.
7. **C4** — Invalid knob string → Save blocked / no null-clear; empty clears; `0` persists.

Anti-cheat: do not `.skip` failing gates; do not “fix” N2 by lengthening passwords to match LONG_RUN again.

## Tasks

### Task 1: S1 public URL redirect harden (red → green)

- **Action**: Add failing connection-diagnostics cases for metadata/cross-host redirect. Implement redirect cap + blocked-hop warn without applying full public-routability to the configured LAN base. Make tests green.
- **Expected result**: S1 Acceptance Criteria met.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/settings/__tests__/connection-diagnostics.test.ts`
- **Depends on**: none.

### Task 2: S2 + N2 SMTP log secret safety (red → green)

- **Action**: Change send-issue-email password fixtures to short/special-char; add failing log asserts; implement secret-safe transport failure logging; make tests green.
- **Expected result**: S2/N2 Acceptance Criteria met.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/delivery/__tests__/send-issue-email.test.ts`
- **Depends on**: none.

### Task 3: O2 settings action log sanitization (red → green)

- **Action**: Add failing settings-actions log assert with fake key + short password; sanitize `mapSettingsActionError` (and consistent siblings); make tests green.
- **Expected result**: O2 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/settings-actions.test.ts`
- **Depends on**: none.

### Task 4: C1 + N1 + C2 repository read honesty (red → green)

- **Action**: Strengthen repository incomplete-SMTP and corrupt/out-of-range/invalid-enum read tests (fail first). Implement whole-bundle SMTP clear + trimmed/validated mapping in `documentToSettings`. Make tests green.
- **Expected result**: C1, N1, C2 Acceptance Criteria met (mapping half).
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/settings/__tests__/repository.test.ts`
- **Depends on**: none.

### Task 5: T1 resolve invalid GUI knob coverage (red → green)

- **Action**: Add resolve tests for typed-invalid GUI knobs (fail if `source: "gui"`). Confirm resolver already falls through via `tryGui*` after Task 4 mapping — if not, fix resolve guards. Make tests green.
- **Expected result**: T1 Acceptance Criteria met; pairs with C2.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/settings/__tests__/resolve-operator-settings.test.ts`
- **Depends on**: Task 4 (preferred; mapping + resolve stay consistent).

### Task 6: C3 + N3 RSS once-per-request (red → green)

- **Action**: Update rss-feed-route tests to require a single resolve (fail on current double call). Rewire RSS route (+ optional app-public-url helper) to one snapshot. Make tests green.
- **Expected result**: C3/N3 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/rss-feed-route.test.ts` (plus any shared app-public-url tests touched)
- **Depends on**: none.

### Task 7: C4 invalid knob Save guard (red → green)

- **Action**: Add failing panel/knobs test for invalid numeric Save. Implement empty-vs-invalid parse + toast block. Make tests green (`0` and blank paths remain).
- **Expected result**: C4 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/settings-panel.test.tsx`
- **Depends on**: none.

### Task 8: Feature gate

- **Action**: Re-read this spec vs implementation; run typecheck/lint and the touched suites; fix gaps only as needed for this feature. Do not change features 01–05 status. Optionally tick Detailed Findings checkboxes in the review report when AC are met.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**:
  ```bash
  pnpm typecheck && pnpm lint && \
  pnpm --filter @newsletter/shared exec vitest run \
    src/settings/__tests__/connection-diagnostics.test.ts \
    src/settings/__tests__/repository.test.ts \
    src/settings/__tests__/resolve-operator-settings.test.ts \
    src/delivery/__tests__/send-issue-email.test.ts && \
  pnpm --filter web exec vitest run \
    src/__tests__/settings-actions.test.ts \
    src/__tests__/settings-panel.test.tsx \
    src/__tests__/rss-feed-route.test.ts
  ```
- **Depends on**: Tasks 1–7.

## Feature verification

- Run: the Task 8 verify matrix.
- Expected: All green. Redirect/SSRF harden on public URL probe; secret-safe SMTP + Settings logs; honest Appwrite read mapping; resolve GUI invalid coverage; RSS single resolve; invalid knobs do not silent-clear. Features 01–05 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; redirect strategy chosen for S1 (manual follow vs cap) and confirmation LAN base URLs still checkable; SMTP log strategy (fixed message vs known-password redact); whether `resolveEffectiveAppPublicUrl` gained a snapshot overload or RSS uses a sync helper; confirmation incomplete SMTP clears all six; confirmation invalid knob Save blocks; any deviation and why. Reference report: `.ssc/reviews/review-stage-12-settings-and-pwa-2026-08-12.md`.

## Research notes

- Review + validator (2026-08-12): all 11 findings Confirmed at Medium; PM triage 2026-08-12 → Address now (all clusters).
- `sanitizeAppwriteMessageForLog` LONG_RUN heuristic is insufficient for short SMTP passwords — do not “fix” tests by lengthening fixtures.
- Feature 03 public URL warn-on-unreachable + self-host LAN: do not blanket-apply feed SSRF to the configured base URL.
- Feature 04 RSS timing pin: “Once per HTTP request” — double `resolveOperatorSettings` is Spec drift even when values match.
