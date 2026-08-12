# SSC Code Review Report

**Date:** 2026-08-12
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-12-settings-and-pwa (stage)
**Profile:** full — severity floor: Medium (Low/Nit: note only; none raised)
**Feature spec anchor:** `.ssc/stages/stage-12-settings-and-pwa/feature-0{1–5}-*.md`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 11 | Low 0 | Nit 0
- **Overall rationale:** Stage 12 Intent is largely delivered (store/resolve, Settings UI, diagnostics, runtime wiring, PWA). All eleven Medium findings were Confirmed: secret-safe logging gaps (SMTP send + Settings actions), authenticated SSRF amplification on the public-URL probe, incomplete/corrupt Appwrite mapping vs Spec, RSS once-per-request freeze drift, silent knob-clear on invalid input, and several tests that encode or mask those defects. No Blockers; address before finalize recommended for secret-log and SSRF clusters.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** stage-12-settings-and-pwa (all five verified features)
- **Base reference:** n/a (SSC-native scope)
- **Profile / floor:** full / Medium; PM asked Low and below to be noted only (none surfaced)
- **Batches:** B1 (store/resolve/diagnostics/schema), B2 (panel/consumers/PWA)
- **Files reviewed:** ~55 text paths across shared settings/schema/pipeline/runs/delivery, web settings UI/actions/tests, RSS route, newsletter edit, PWA manifest/layout/icons/tests, `.env.example`, `scripts/generate-homepress-icons.mjs`
  - `shared/src/settings/{types,repository,operator-settings,resolve-operator-settings,connection-diagnostics,index}.ts` + `__tests__/*`
  - `shared/src/schema/declarations.ts` + declarations test
  - `shared/src/pipeline/{config,drafter}.ts` + drafter test
  - `shared/src/runs/execute-run.ts` + execute-run / resolve-run-llm tests
  - `shared/src/delivery/{app-public-url,send-issue-email,rss-publications,publish-issue-to-rss,index}.ts` + delivery tests
  - `web/app/(protected)/settings/{page,actions}.tsx|ts`
  - `web/lib/{settings-panel,nav-items}.ts`
  - `web/components/settings/*`
  - `web/app/rss/[newsletterId]/route.ts`, `web/app/(protected)/newsletters/[id]/page.tsx`
  - `web/app/{manifest.ts,layout.tsx}`, PWA assets under `web/app/` + `web/public/icons/`
  - Related web/shared tests listed in feature Files sections
- **Files skipped:**
  - Binary PNG/ICO contents — presence/contract only (no pixel audit)
  - Unrelated Stage 11/prior modules not in feature Files sections
  - Live network / device A2HS smoke (out of CI; stage-level operator check)
- **Assumptions and unknowns:**
  - Self-host single-operator trust model for plaintext Appwrite secrets is intentional (Spec / Plan carry-forward)
  - Production HTTPS / reverse-proxy for PWA install assumed (Feature 05)
  - No Low/Nit findings were raised by reviewers under the Medium floor policy

---

## SSC Intent Check

- **Stage Intent:** Make the deployed instance feel like a product you live in — Settings for secrets/knobs, connection diagnostics, PWA install shell — without `.env`/redeploy for day-to-day tuning.
- **Feature Intent lines:**
  1. Persist overrides; resolve GUI → `.env` → default
  2. First-class Settings UI; secrets masked
  3. Prove OpenRouter / SMTP / public URL from Settings
  4. Next run/send/request uses resolved settings; freeze timing
  5. Installable standalone-ish web shell; no SW/native APIs
- **Intent served?** Partially — core capability is present; Confirmed Medium findings show meaningful Spec drift on corrupt/incomplete SMTP read mapping, RSS once-per-request resolve, blank-vs-invalid clear semantics, and secret-log guarantees that Intent/constraints require.
- **Notes:** PWA Intent appears intact (no SW/banner findings). Runtime OpenRouter/SMTP/knob wiring and Settings panel Intent largely hold; see C1–C4, S1–S2, O2, N1–N3, T1.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity then category. Track completion only via these checkboxes.

### [x] S1-20260812: Public URL diagnostic SSRF / unbounded redirects

| Field | Value |
|---|---|
| **ID** | `S1-20260812` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/settings/connection-diagnostics.ts:307-318` |
| **Description** | `diagnosePublicUrl` GETs the operator-controlled public URL with `redirect: "follow"` and no host/SSRF checks (unlike feed validation’s `isPubliclyRoutableUrl`). Settings-capable principals can probe internal/link-local targets or chain redirects to metadata endpoints. |
| **Risk / Impact** | Authenticated SSRF oracle against the Homepress host/network. Spec requires a reachability GET; unbounded cross-host redirects amplify beyond “can we reach our public base.” |
| **Evidence** | `fetchImpl(url, { method: "GET", redirect: "follow", … })` with no DNS/IP allowlist, redirect cap, or same-host pinning. |
| **Recommendation** | Keep http(s) GET for Intent; harden: cap redirects; refuse/warn when final host is link-local/metadata; optionally re-check final URL before pass. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Mock 302 → `http://169.254.169.254/`; assert no successful metadata probe. Same-host redirect can still pass. |
| **Acceptance Criteria** | Probe still pass/warn/fail per Feature 03; cross-host redirect to link-local/metadata does not complete a successful probe; unit tests cover redirect hardening. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Code matches claim; Spec allows redirects “within reason,” so unbounded follow without final-host checks is real amplification, not a false positive. |

---

### [x] S2-20260812: SMTP send failure logs may leak short passwords

| Field | Value |
|---|---|
| **ID** | `S2-20260812` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/delivery/send-issue-email.ts:142-149` |
| **Description** | Transport failures are logged via `sanitizeAppwriteMessageForLog`, which only redacts `sk-*`, Bearer tokens, and ≥24-char `[A-Za-z0-9_-]` runs. Short or punctuation-bearing SMTP passwords echoed in library errors are not redacted. |
| **Risk / Impact** | Operator SMTP password can appear in server logs on send failure — violates Feature 04 never-log-secrets for this path. |
| **Evidence** | Catch logs `sanitizeAppwriteMessageForLog(rawMessage)`; heuristic does not treat known SMTP password specially. |
| **Recommendation** | Log a fixed operator-safe summary, or redact using the known resolved SMTP password/username before logging. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Inject errors containing `hunter2` / `Secret1!`; assert console never includes them. |
| **Acceptance Criteria** | No `sendIssueEmail` failure log path emits the configured SMTP password for short, long, or special-character passwords. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Sanitizer scope matches claim; short/punctuated passwords would survive into `console.error`. |

---

### [x] C1-20260812: Incomplete SMTP Appwrite read not cleared as whole bundle

| Field | Value |
|---|---|
| **ID** | `C1-20260812` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/settings/repository.ts:81-104` |
| **Description** | Feature 01 requires incomplete/corrupt SMTP on read to be treated as no override for the whole bundle. `documentToSettings` maps fields independently, leaving host/port/username/from/secure populated when password is missing. |
| **Risk / Impact** | Resolver falls through to env, but Settings UI / raw `AppSettings` consumers see partial GUI SMTP — operators may believe a GUI override is active while runtime uses env. |
| **Evidence** | Per-field mappers only; incomplete-bundle fixture keeps `smtpHost` etc. with `smtpPassword` → `""`. |
| **Recommendation** | After map, if required SMTP quartet incomplete/invalid, force all six SMTP attrs to unset. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Incomplete SMTP read asserts all six fields unset; complete quartet still round-trips. |
| **Acceptance Criteria** | `getOrCreateAppSettings` never returns a partial SMTP override; resolve incomplete→env remains green. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Spec pin vs independent mapping confirmed; `toSettingsPanelData` can surface partial GUI SMTP — meaningful drift. |

---

### [x] C2-20260812: Whitespace / out-of-range / invalid-enum not unset on read

| Field | Value |
|---|---|
| **ID** | `C2-20260812` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/settings/repository.ts:60-104` |
| **Description** | Spec pins whitespace-only and corrupt-on-read as unset. Mappers keep whitespace strings, invalid enums, and finite out-of-range numbers instead of clearing them. |
| **Risk / Impact** | `AppSettings`/UI can show phantom or invalid overrides; resolve compensates via `tryGui*` only on the resolve path. |
| **Evidence** | String mapper returns raw strings; number mapper checks finite/integer only — no range/enum. |
| **Recommendation** | Trim strings (whitespace→`""`); validate enum/ranges on read; map invalid to unset. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Document with whitespace key, `scoreThreshold=99`, `drafterReasoningEffort="ultra"` → all unset. |
| **Acceptance Criteria** | Whitespace-only and out-of-range/invalid-enum same-type values map to unset in `AppSettings`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Mapper behavior and Spec “corrupt → unset” pin match the claim. |

---

### [x] C3-20260812: RSS GET double-resolves operator settings

| Field | Value |
|---|---|
| **ID** | `C3-20260812` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/app/rss/[newsletterId]/route.ts:31-42` |
| **Description** | Public RSS GET calls `resolveOperatorSettings` for last-N, then `resolveEffectiveAppPublicUrl` which re-calls `resolveOperatorSettings`. Feature 04 pins once per HTTP request. |
| **Risk / Impact** | Doubles Appwrite settings reads (secret-bearing doc) per public feed hit; two snapshots could diverge under concurrent Settings writes. |
| **Evidence** | Route resolves twice; comment still says once-per-request. |
| **Recommendation** | Use one snapshot for last-N and public URL (sync helper over resolved value, or pass snapshot into effective-URL helper). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Assert `resolveOperatorSettings` called exactly once per successful RSS GET. |
| **Acceptance Criteria** | Single cascade read per request; last-N + public URL from that snapshot; tests enforce call count === 1. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Double call path confirmed against Feature 04 timing pin. |

---

### [x] C4-20260812: Invalid knob input silently clears GUI override

| Field | Value |
|---|---|
| **ID** | `C4-20260812` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/components/settings/pipeline-knobs-settings.tsx:29-42,176-182` |
| **Description** | `parseOptionalNumber` / `parseOptionalInteger` map non-finite input to `null`; Save treats `null` as clear. Feature 02 only specifies blank/empty as clear — invalid keystrokes silently clear knobs. |
| **Risk / Impact** | Typo on Save can wipe score/similarity/RSS/token overrides without clear intent; unexpected cascade fall-through on next run. |
| **Evidence** | `Number("5x")` → NaN → `null` passed as clear. |
| **Recommendation** | Block Save with toast on invalid numeric input; only send `null` when field is truly empty. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Set score to `5x`, Save → action must not clear (or toast error); `0` still round-trips. |
| **Acceptance Criteria** | Invalid numeric strings do not persist as null clears; empty still clears; `0` remains valid override. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Parse→null→clear path and Spec blank-only clear pin confirmed; `type=number` softens UX but semantic mismatch remains. |

---

### [x] N1-20260812: Weak incomplete-SMTP read test masks C1

| Field | Value |
|---|---|
| **ID** | `N1-20260812` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `shared/src/settings/__tests__/repository.test.ts:856-875` |
| **Description** | Test titled as leaving incomplete SMTP fields unset only asserts `smtpPassword===""` and loose typeof checks — passes while host/from/secure remain populated. |
| **Risk / Impact** | Suite claims AC coverage without enforcing whole-bundle clear; masks C1. |
| **Evidence** | Fixture keeps smtpHost/from/secure; expects do not require them cleared. |
| **Recommendation** | Require all six SMTP fields unset (or split mapping vs resolve tests with strong expects). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Exact unset checks for all six attrs. |
| **Acceptance Criteria** | Incomplete SMTP read test fails if any of the six override fields remain set. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Weak assertions are a real anti-cheat shortcut masking C1, not a legitimate technique. |

---

### [x] N2-20260812: Password non-leak test uses LONG_RUN-matching fixtures

| Field | Value |
|---|---|
| **ID** | `N2-20260812` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `shared/src/delivery/__tests__/send-issue-email.test.ts:13-14,414-443` |
| **Description** | Non-leak log assertion uses SMTP passwords ≥24 chars of `[A-Za-z0-9_-]`, fully wiped by `LONG_RUN` redaction — can pass when short passwords would still leak. |
| **Risk / Impact** | False confidence on Feature 04 secret-logging; masks S2. |
| **Evidence** | Fixtures `unit-test-smtp-password-do-not-leak` (35) / `gui-smtp-password-do-not-leak` (29). |
| **Recommendation** | Use short/special-char fixtures (`hunter2`, `P@ssw0rd!`); assert non-leakage. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Fixtures that do not match LONG_RUN; expect absence from logs. |
| **Acceptance Criteria** | Password non-leak tests fail if only LONG_RUN heuristic protects short/special-char passwords. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Fixtures match LONG_RUN; test encodes the weak defense. |

---

### [x] N3-20260812: RSS tests lock in double-resolve

| Field | Value |
|---|---|
| **ID** | `N3-20260812` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `web/src/__tests__/rss-feed-route.test.ts:98-99` |
| **Description** | Tests assert both `resolveOperatorSettings` and `resolveEffectiveAppPublicUrl` were called, encoding double-resolve as correct vs Feature 04 once-per-request. |
| **Risk / Impact** | Spec drift becomes tested behavior; fixing C3 requires rewriting tests that encode the bug. |
| **Evidence** | Dual `toHaveBeenCalledWith` with no once-only assertion. |
| **Recommendation** | Assert single cascade resolve; last-N + URL from one snapshot. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `resolveOperatorSettings` call count === 1. |
| **Acceptance Criteria** | RSS tests fail if settings resolved more than once per successful GET. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Tests encode the C3 defect rather than the Spec contract. |

---

### [x] O2-20260812: Settings save/clear logs raw Error objects

| Field | Value |
|---|---|
| **ID** | `O2-20260812` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `web/app/(protected)/settings/actions.ts:72-77` |
| **Description** | `mapSettingsActionError` logs the raw `err` object; diagnostic actions on the same module sanitize. Save/clear paths handle OpenRouter keys and SMTP passwords. |
| **Risk / Impact** | If Appwrite/client errors echo submitted field values, secrets can land in server logs. |
| **Evidence** | `console.error(\`[settings/actions] ${phase}\`, err)` vs sanitized diagnostic logger. |
| **Recommendation** | Log only phase + sanitized string (and safe name/code) on all secret-touching action failures. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Reject with message embedding fake `sk-or-…` / SMTP password; assert console excludes them. |
| **Acceptance Criteria** | All settings action failure logs use the same secret-safe sanitizer as diagnostics. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Raw `err` logging vs sanitized diagnostics confirmed on secret-bearing write path. |

---

### [x] T1-20260812: Missing resolve tests for invalid typed GUI knobs

| Field | Value |
|---|---|
| **ID** | `T1-20260812` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `shared/src/settings/__tests__/resolve-operator-settings.test.ts` |
| **Description** | Suite covers out-of-range env → `default`, but never injects typed-but-invalid GUI values (`scoreThreshold: 99`, reasoning `"ultra"`) to prove `tryGui*` fallthrough (compensatory path for C2). |
| **Risk / Impact** | Regressions dropping GUI range/enum guards could ship green while invalid GUI wins over env/default. |
| **Evidence** | Out-of-range cases only set env vars; GUI tests use in-range or empty. |
| **Recommendation** | Add resolve cases: invalid GUI + valid env → env; invalid GUI + no env → default. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Parameterized per Stage-12 knob. |
| **Acceptance Criteria** | At least one test per knob proving invalid same-type GUI values are not `source: "gui"`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Coverage gap for typed-invalid GUI knobs confirmed. |

---

## Dependencies and Licensing

- Vulnerabilities: none identified in this pass (no dependency audit run; supply-chain not in finding set)
- Outdated critical packages: none flagged
- License concerns: none flagged

---

## Quality Signals

- Lint/config signals: not re-run in review (gates assumed green from feature verification)
- Test/coverage signals: strong suite volume; several Confirmed anti-cheat/testing gaps (N1, N2, N3, T1) weaken trust in secret-log and SMTP/RSS freeze coverage
- Complexity/churn signals: Stage 12 is a large surface (settings + consumers + PWA); findings cluster on secrets logging, mapping honesty, and freeze-once semantics
- **Low / Nit notes:** none raised under Medium floor

---

## Risk Assessment

- **Overall risk:** Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Mid-job live reload; native PWA/SW; Appwrite/TZ/worker-poll in Settings; stronger-than-plaintext secret storage (Plan carry-forward); live device A2HS

**Suggested hardening clusters (for PM triage):**

| Cluster | IDs | Theme |
|---|---|---|
| A | S1 | Public URL diagnostic redirect/SSRF harden |
| B | S2, N2 | SMTP send log secret safety + test fixtures |
| C | O2 | Settings action failure log sanitization |
| D | C1, N1 | Incomplete SMTP whole-bundle clear on read + test |
| E | C2, T1 | Corrupt/out-of-range read mapping + resolve GUI tests |
| F | C3, N3 | RSS once-per-request resolve + test contract |
| G | C4 | Invalid knob input must not silent-clear |

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1-20260812 | Medium | Address now | SSRF/redirect harden before finalize |
| S2-20260812 + N2-20260812 | Medium | Address now | Secret-log + weak test fixtures |
| O2-20260812 | Medium | Address now | Settings action log sanitization |
| C1-20260812 + N1-20260812 | Medium | Address now | Incomplete SMTP whole-bundle clear |
| C2-20260812 + T1-20260812 | Medium | Address now | Corrupt read mapping + resolve coverage |
| C3-20260812 + N3-20260812 | Medium | Address now | RSS once-per-request resolve |
| C4-20260812 | Medium | Address now | Invalid knob must not silent-clear |

**Hardening feature:** `feature-06-hardening-review-2026-08-12` (all clusters A–G).

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
