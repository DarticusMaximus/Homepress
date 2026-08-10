# SSC Code Review Report

**Date:** 2026-06-30
**Reviewer:** ssc-code-review
**Scope:** stage-00-scaffolding (stage)
**Profile:** full
**Feature spec anchor:** `.ssc/stages/stage-00-scaffolding/` (features 01–06)

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 2 | Low 2 | Nit 0
- **Overall rationale:** Stage 00 is solid scaffolding: strict TS, clean lint, green tests, a well-reasoned server-action auth flow (the escalated cookie-domain bug was correctly rescued), secret-safe env handling, and a two-layer auth gate that is authoritative server-side. The Anti-cheat category is clean — no hardcoded test values, no swallowed failures, no spec drift (the login-path deviation is a documented rescue, not hidden). The findings are beyond-spec hardening: both containers run as root, and the orphaned browser-SDK auth module is a latent footgun. None block finalize; all are cheap to fix in an optional hardening pass.

---

## Scope and Coverage

- **Target reviewed:** `stage-00-scaffolding` — all 6 verified features.
- **Base reference:** n/a (SSC-native stage scope; code reviewed as-is on disk).
- **Files reviewed:** 30 source/config files across `shared/`, `web/`, `worker/`, and repo root (all feature spec Files sections cross-checked against disk).
- **Files skipped:** `node_modules/`, `dist/`, `.next/`, `.ssc/`, legacy `AI-Newsletter-Pipeline-main - OLD - DO NOT USE/` (reference only, not part of stage 00).
- **Gates run:** `pnpm test` (8 passed), `pnpm typecheck` (clean), `pnpm lint` (0 errors).
- **Assumptions and unknowns:**
  - Profile `full`, severity floor `Medium`. Low findings are included where they are security/supply-chain-adjacent (per OUTPUT-CONTRACT mandatory-inclusion rules); pure maintainability Low/Nit items are summarized under Quality Signals, not formal findings.
  - Live `/health`, login, and podman runtime behavior were not re-executed during this review; they were gated `verified` by ssc-execute/ssc-finalize. This review is a static, beyond-spec quality pass.
  - The escalated feature-06 rescue (client-side browser-SDK login → server actions) is treated as an acknowledged, documented adaptation, NOT hidden spec drift.

---

## SSC Intent Check

- **Stage Intent line:** "Lay the foundation every later stage stands on — a runnable TypeScript project, a test runner, linting, the Appwrite connection proven, and a podman compose stack that brings up the app the way it will run in production... so that from stage 01 onward, the only question is 'does the feature work,' never 'does the project even run.'"
- **Intent served?** Yes.
- **Notes:** Every stage-00 Acceptance criterion maps to real code on disk: pnpm workspace with three packages, strict TS, Appwrite config + server/browser clients, `/health` authenticated handshake, long-running worker with heartbeat + graceful shutdown, Vitest + ESLint + Prettier, two-service podman stack, and an authoritative auth gate. No newsletter-specific code exists. No drift detected.

---

## Detailed Findings

### [ ] X1-20260630: Containers run as root — no USER directive in Dockerfiles

| Field | Value |
|---|---|
| **ID** | `X1-20260630` |
| **Severity** | Medium |
| **Category** | Config / Infra / CI |
| **Location** | `web/Dockerfile:46-58`, `worker/Dockerfile:39-46` |
| **Description** | The `runner` stage of both Dockerfiles omits a `USER` directive, so the processes start as the container default user (`root`). `node:22-alpine` ships a non-root `node` user (uid 1000) that is unused. |
| **Risk / Impact** | If the web or worker process is compromised (e.g. an RCE via a future stage's input handling — RSS parsing, scraping, LLM output), a root process inside the container has maximal filesystem and capability surface, increasing the blast radius of a container escape or local privilege escalation. Least-privilege (non-root) is a baseline container-hardening control. |
| **Evidence** | `grep -rn "USER" web/Dockerfile worker/Dockerfile` → no matches. Final stage `FROM node:22-alpine AS runner` with no `USER node`. |
| **Recommendation** | In each `runner` stage, after the `WORKDIR`, add `USER node` (the `node:22-alpine` user owns uid 1000). Ensure `WORKDIR /app` is writable by `node` (the standalone bundle / dist copy targets `/app`; create it owned by node or `chown -R node:node /app` before the `USER` switch). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Build both images, run `podman run --rm <image> id -u` → expect `1000`, not `0`. Confirm `podman compose up` still reaches healthy and the app functions identically. |
| **Acceptance Criteria** | `podman run --rm newsletter-generator-web:compose id -u` prints `1000`; same for worker; both services reach `Up (healthy)`; `/health` returns 200/authenticated; login flow unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified by grep: no `USER` directive exists in either Dockerfile; `node:22-alpine` defaults to root. Impact (privilege amplification on compromise) is plausible under normal runtime conditions once later stages add input handling. Recommendation addresses the root cause. |

---

### [ ] M1-20260630: Orphaned browser-SDK auth module + unused dependency (latent auth footgun)

| Field | Value |
|---|---|
| **ID** | `M1-20260630` |
| **Severity** | Medium |
| **Category** | Maintainability (Anti-cheat-adjacent: rescued-path footgun) |
| **Location** | `web/lib/appwrite-client.ts:1-13`, `web/package.json:13` (`"appwrite": "^26.1.0"`) |
| **Description** | `getBrowserAppwrite()` and the entire `appwrite` browser SDK dependency are now dead code. After the feature-06 rescue, login/logout run entirely through `node-appwrite` server actions (`web/app/login/actions.ts`) that manually set the first-party cookie — the browser client is imported by nothing. A repo-wide grep finds `getBrowserAppwrite` referenced only in its own definition. |
| **Risk / Impact** | (1) A future maintainer reading feature-06's spec ("calls the Appwrite browser SDK's `Account.createEmailPasswordSession`") alongside this still-present file may re-wire login through the browser SDK and silently reintroduce the exact cross-domain cookie bug that was escalated and rescued (state `escalations[0]`). (2) The unused `appwrite` package remains in `web`'s dependency tree and could leak into a client bundle if accidentally imported. (3) Two "auth client" modules with opposite architectures is a confusing split. |
| **Evidence** | `grep -rn "getBrowserAppwrite"` → 1 match (the definition only). `grep -rn "from 'appwrite'"` → only `web/lib/appwrite-client.ts:1`. No file imports `@/lib/appwrite-client` or `appwrite-client`. The active login path is `web/app/login/actions.ts` (`node-appwrite`, server action). |
| **Recommendation** | Delete `web/lib/appwrite-client.ts` and remove the `appwrite` browser SDK from `web/package.json` dependencies (run `pnpm install` to update the lockfile). If the browser SDK is genuinely expected to be needed by a later stage, instead add a clear `// TODO(stage-NN): ...` comment and document why it is retained; but prefer deletion now and re-adding when the consuming feature is specced. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | After removal: `pnpm typecheck`, `pnpm build`, `pnpm test`, and the login/logout integration flow all pass; `grep -rn "getBrowserAppwrite\|from 'appwrite'" web/` returns nothing. |
| **Acceptance Criteria** | `web/lib/appwrite-client.ts` no longer exists; `appwrite` is absent from `web/package.json`; `pnpm typecheck && pnpm build && pnpm test` green; login + logout still work end-to-end. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Grep confirms the module and SDK are referenced nowhere outside the definition; the active auth path uses server actions. The footgun risk is real because the spec text still describes the browser-SDK flow, making reintroduction plausible. Deletion is the correct fix. |

---

### [ ] S1-20260630: Raw Appwrite SDK error messages echoed to the login UI

| Field | Value |
|---|---|
| **ID** | `S1-20260630` |
| **Severity** | Low |
| **Category** | Security / UX (information disclosure) |
| **Location** | `web/app/login/actions.ts:52-55` |
| **Description** | The login catch returns the raw `err.message` from the Appwrite SDK directly to the client as the user-visible error string. For invalid-credential errors this is acceptable, but for network failures, 5xx, or rate-limit responses the message can include infrastructure details (endpoint host, SDK-internal wording) that need not be shown to an operator. |
| **Risk / Impact** | Minor information disclosure of backend topology/config on non-credential error paths; no key leakage (the API key lives in a header, never in the error). Impact is low for a single-operator tool but the auth surface is the one place to be careful. |
| **Evidence** | `const message = err instanceof Error && err.message ? err.message : "Login failed"; return { error: message };` — no mapping to a safe, fixed user-facing message. |
| **Recommendation** | Map to a small set of safe user-facing messages: on a credentials failure (Appwrite 401) show "Invalid email or password"; for all other errors log the detail server-side (`console.error`) and show a generic "Login failed. Please try again." to the client. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Unit/integration: submit wrong password → UI shows the credentials message and no endpoint string; simulate a network error → UI shows generic message; server log contains the detail. |
| **Acceptance Criteria** | Login error responses never contain the Appwrite endpoint or SDK-internal strings; a credentials failure shows a clear message; other errors are generic with detail logged server-side. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | The code does return the raw SDK message verbatim. Severity Low is appropriate (single-operator tool, no secret in the message); surfacing it because it sits on the auth path and is trivial to harden. |

---

### [ ] D1-20260630: Base images not pinned by digest (non-reproducible / supply-chain)

| Field | Value |
|---|---|
| **ID** | `D1-20260630` |
| **Severity** | Low |
| **Category** | Dependencies & Supply Chain |
| **Location** | `web/Dockerfile:9,19,46`, `worker/Dockerfile:8,18,39` |
| **Description** | All three stages in each Dockerfile use the floating tag `node:22-alpine` rather than a digest-pinned reference (`node:22-alpine@sha256:...`). Builds are therefore not reproducible: two builds days apart can resolve different base image contents, and a compromised upstream tag would be pulled without verification. |
| **Risk / Impact** | Non-reproducible image builds and a weakened supply-chain posture. The feature-05 handoff explicitly called for recording the pinned `node:22-alpine` digest, which was not captured. |
| **Evidence** | `FROM node:22-alpine AS ...` appears 6 times across the two Dockerfiles; no `@sha256:` pin anywhere. |
| **Recommendation** | Pin all `node:22-alpine` references to a current digest (`node:22-alpine@sha256:<digest>`), record the digest in the feature-05 handoff, and bump deliberately. Optionally enable a policy to flag unpinned base images in CI. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `grep "@sha256" web/Dockerfile worker/Dockerfile` returns the pinned digests; two consecutive `podman compose build` runs resolve the identical base image digest. |
| **Acceptance Criteria** | Every `FROM` in both Dockerfiles pins `node:22-alpine@sha256:<digest>`; the digest is documented in the feature-05/stage-00 record. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verified no digest pins exist; floating tags make builds non-reproducible and weaken supply-chain integrity. Recommendation is standard practice and directly addresses the cause. |

---

## Dependencies and Licensing

- Vulnerabilities: not scanned in this review (no `pnpm audit` run); recommend adding `pnpm audit --prod` to CI as a follow-up.
- Outdated critical packages: none flagged. Notable intentional version choices: `node-appwrite` ^26.2.0, `appwrite` ^26.1.0, `next` ^15.3.4.
- License concerns: none identified at this stage (all permissive JS ecosystem packages).
- **Version skew notes (below floor, not formal findings):**
  - `eslint-config-next` ^16.2.9 vs `next` ^15.3.4 — a major-version skew between the framework and its lint plugin. Lint passes today, but the plugin may apply Next-16 assumptions; align both to the same major when convenient.
  - `@types/node` 20.17.6 (in `web`) while the runtime is Node 22. The worker uses `process.loadEnvFile` (Node 20.12+ API) and has no direct `@types/node` declaration of its own (relies on hoisting). Consider bumping `@types/node` to a 22.x line and declaring it where Node APIs are used.

---

## Quality Signals

- **Lint/config signals:** ESLint flat config (v9+) is correctly layered (typescript-eslint → Next scoped to `web/` → prettier last). `pnpm lint` exits 0. One cosmetic warning is printed by the Next eslint plugin ("Pages directory cannot be found…") despite `jsx-a11y/no-html-link-for-pages` being turned off — the plugin's settings processor still emits the line; it does not affect the exit code. Consider suppressing at the plugin-settings level for a cleaner CI log.
- **Test/coverage signals:** 8 tests pass (routes matcher unit tests are thorough: trailing-slash normalization, prefix tricks, empty string, exact match). Coverage is minimal but appropriate for scaffolding — the only testable pure logic so far is the route matcher. Auth flow is integration-verified (correctly, per spec).
- **Complexity/churn signals:** All files are small and single-purpose. No long functions, no duplication. Worker registry is a clean, tested-seam `Map`.
- **Observations below the severity floor (not formal findings, recorded for awareness):**
  - **Middleware legacy-cookie check (`web/middleware.ts:15-17`):** middleware checks `a_session_<id>_legacy` but neither `session.ts` nor the login action ever reads or writes it — under the server-action architecture the Appwrite server never sets cookies on the client, so the legacy variant is dead. It is harmless (the authoritative layout gate still rejects), but it is an undocumented inconsistency in the auth boundary. Either drop the legacy check or, if retained deliberately, read it in `session.ts` too and document why.
  - **`web/next.config.mjs` hand-rolls `.env` parsing** (lines 7–26) instead of relying on Next.js's built-in `.env` loading. The manual parser doesn't handle multiline values or `export `-prefixed keys. It is non-destructive (`if (process.env[key] === undefined)`) but is a future bug source; prefer Next's native `.env`/`.env.local` handling unless build-time inlining genuinely requires otherwise.
  - **No login rate-limiting / brute-force protection.** Acceptable for stage-00 single-operator scope (Appwrite has server-side auth rate limits); record as a deferred item if the app is ever exposed more broadly.
  - **CSRF:** the login and logout forms use Next.js server actions (`<form action={fn}>`), which carry the framework's built-in origin/action-ID verification. No custom CSRF token is needed at this stage — noted as a positive (the category was checked).

---

## Risk Assessment

- **Overall risk:** Low
- **Merge decision:** Approve with changes — no Blocker or High findings; two Medium issues (root containers, orphaned auth module) plus two Low are best addressed in an optional hardening pass before or alongside stage 01, but none block progress or stage verification.
- **Out-of-scope areas:** legacy `AI-Newsletter-Pipeline-main - OLD - DO NOT USE/` (reference Python pipeline); `.ssc/` framework artifacts; live runtime/integration re-verification (already gated by ssc-execute/ssc-finalize).

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| X1-20260630 | Medium | _Pending PM decision_ | Containers run as root |
| M1-20260630 | Medium | _Pending PM decision_ | Orphaned browser-SDK auth module + dep (footgun) |
| S1-20260630 | Low | _Pending PM decision_ | Raw SDK errors echoed to login UI |
| D1-20260630 | Low | _Pending PM decision_ | Base images not digest-pinned |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
