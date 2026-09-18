# SSC Code Review Report

**Date:** 2026-09-18
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-16-security-and-roles (stage)
**Profile:** full — security-leaning; severity floor: Low
**Feature spec anchor:** `.ssc/stages/stage-16-security-and-roles.md` + all six feature specs in `.ssc/stages/stage-16-security-and-roles/`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 5 | Low 18 | Nit 0
- **Overall rationale:** Stage 16 substantively delivers its Intent. The 2026-09-17 audit's triaged findings are closed in production code for the named sites (fail-closed actions, SSRF pinning, stale-run reaper, AES-GCM secrets, sentinel saves, roles, RSS route, headers, audit gate, image-strip). Five Medium residuals remain: an ungated `"use server"` module that lives outside the arch test's discovery net (S1); a storage-side markdown-scheme scrub that CommonMark whitespace/escape tricks can defeat (S3 — render sanitizers still hold); the new `SETTINGS_SECRET_KEY` omitted from the X2 denylist (S2); no durable evidence the undici dispatcher is honored by the real fetch (N1); and a reap-a-live-run race between `markRunning` and the first heartbeat write (C1). None are Blocker/High. One draft finding (WORKER_HEARTBEAT_MS coupling) was rejected by the validator and dropped.

**Audit-closure verdict (PM mandate 1):**

| Prior finding | Closed? | Residual in this report |
|---|---|---|
| S1, N1 (ungated actions + no arch test) | Substantively yes for 31 discovered exports | S1 (health-card module outside discovery); N2 (static-check bypasses) |
| S2 (middleware UX-only) | Yes | — |
| S5 (no roles) | Yes | C6, U1, S7 (accounts hygiene) |
| S10 (fetch-time SSRF) | Yes at wiring | N1 (no real-socket evidence); S9 (web-path dispatcher, Needs-More-Evidence) |
| S11 (fail-open DNS / NAT64) | Yes | S8 (empty-answer inconsistency) |
| C2 (stuck running) | Yes | C1 (claim/heartbeat race) |
| N2, N4 (ForTests / smoke log) | Yes | — |
| S4, S6 (plaintext secrets / RMW) | Yes — crypto verified | C2, C3, M2 (edges) |
| S7 (`server-only`) | Yes for four named modules | S6 (transitive-only on remaining secret readers) |
| S8 (opt-in redaction) | Yes for named sites | S5 (`failedFeeds` / `lastFetchError`) |
| S9 (id/limit gates) | Yes for named get/delete + lists | S4 (update-path writers) |
| C1 (deleteFeed first page) | Yes | — |
| S3 (RSS route) | Yes | X1 (500 missing no-store) |
| S12 (draft persist) | Partial | S3 (scrub bypass family); C5 (over-scrub) |
| S14, P1, A1, N5 | Yes | — |
| D1, D2, S13 | Yes (repo-level; B5 ran `pnpm audit`, no D findings) | GHCR rebuild rides stage-end release |
| X1 headers, X4 loopback | Yes | — |
| X2 env denylist | Yes for the three original keys | S2 (`SETTINGS_SECRET_KEY` omitted) |
| C3 (atomic claim) | Deferred by design | — |

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-16-security-and-roles` — all six verified features (F01–F06)
- **Base reference:** `d09bd91` (Homepress 0.1.5 / Stage 15 ship); working-tree delta (~182 files)
- **Files reviewed:** ~140 (production + tests), in 5 sequential reviewer batches + 1 validator pass:
  - **B1 — Auth & roles (F01+F06):** `web/lib/auth/{require-user,require-operator,session,login-errors,routes}.ts`, `web/lib/accounts/account-admin.ts`, `web/app/(protected)/admin/layout.tsx`, `web/app/(protected)/admin/accounts/{actions,page}.tsx`, seven factory `actions.ts` modules + `issues/actions.ts`, `(protected)/layout.tsx`, export route, `app-sidebar.tsx`, `nav-items.ts`, accounts components (view + 3 dialogs), `middleware.ts`, `shared/scripts/bootstrap-operator.mjs`, arch test + 17 related tests
  - **B2 — SSRF & worker (F03):** `ssrf.ts`, `fetch-safety.ts`, rss-fetcher/scraper/orchestrator/types, feeds types/validation/qualify, `stale-run-reaper.ts`, `due-check.ts`, schema declarations, `worker/src/{index,run-poller}.ts`, feeds GUI (form/table/card), feeds actions, 12 test files
  - **B3 — Repos & redaction (F03/F04/F05 overlap):** `runs/{repository,execute-run,issues,index}.ts`, newsletters/{repository,attachments}, prompts/repository, `health/check.ts`, `util/{log-redact,document-id}.ts`, feeds/repository, 9 test files
  - **B4 — Secrets & settings (F04):** `settings/{secrets,repository,operator-settings,types,index,resolve-operator-settings,connection-diagnostics}.ts`, `appwrite/{config,server}.ts`, barrels, vitest configs + `vitest-stubs/server-only.ts`, worker/shared package.json, settings actions/page/panel/connections-settings, 7 test files
  - **B5 — Input policy & deploy (F05+F02):** drafter, draft-normalize, email-body, send-issue-email, publish-issue-to-rss, issue-export, RSS route, issue-markdown, `next.config.mjs`, compose.yaml, `.env.example`, DEPLOY.md, SECURITY.md, package.jsons, both GitHub workflows, 10 test files
- **Files skipped:**
  - `.ssc/` artifacts — used as anchors, not review targets
  - `pnpm-lock.yaml` — generated; B5 grepped resolved versions + ran `pnpm audit` instead of reading the lockfile
  - `web/components/ui/*` — shadcn vendored, not in the stage delta
  - `opencode.json.example` — trivial config
  - GHCR image contents — not rebuilt this stage (spec: rides stage-end release)
- **Assumptions and unknowns:**
  - Single-worker, compose, reverse-proxy+TLS deployment (Plan pin). Audit C3 (atomic claim) and CSP remain deferred by design — not findings.
  - Reviewers did not run `pnpm test` / typecheck / lint (static + targeted Node probes). Feature verification already gated those.
  - Validator independently re-probed S3's marked bypasses and C11's claimed heartbeat coupling (rejected).
  - One draft finding **C11-20260918** (WORKER_STALE_RUN_MS not coupled to WORKER_HEARTBEAT_MS) was **Rejected**: run heartbeat is hardcoded 30s in `execute-run.ts`, decoupled from the worker sweep timer. Dropped from this report.

---

## SSC Intent Check

- **Feature Intent line (stage):** Two audiences depend on this code being safe: the household that reads the digest, and the strangers who find the public git repo and self-host their own instance. … This stage closes every triaged audit finding and adds a real operator-vs-reader boundary, with in-app account creation, before the first non-operator account exists — while preserving the original Stage 16 intent that readers use Home, channels, and listen without ever seeing the factory.
- **Intent served?** Yes — with Medium residuals (S1, S2, S3, C1, N1)
- **Notes:** F01's "enforced by default for every current and future action" is live-falsified by `web/components/health-card/actions.ts` (S1) — the 8 discovered `web/app/**/actions.ts` modules are guarded. F03's SSRF control is implemented but its mandated real-socket smoke left no durable evidence (N1). F05's storage-side scheme scrub is defeatable (S3) while render-layer sanitizers still hold. F04 crypto itself had no findings.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [x] S1-20260918: Unguarded `"use server"` module outside arch-test discovery (health-card)

| Field | Value |
|---|---|
| **ID** | `S1-20260918` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/components/health-card/actions.ts:14-16`; `web/src/__tests__/server-actions-auth.test.ts:59-71` |
| **Description** | `revalidateHealthCheck()` is a `"use server"` export that only calls `revalidatePath("/admin")` — no `requireUser()`/`requireOperator()`. The arch test discovers only files named `actions.ts` under `web/app`, so this module is invisible to unauth/reader/seam/static checks. The action is form-bound (`revalidate-health-button.tsx`), so its ID ships in client chunks and is POST-invocable via `Next-Action` — the original S1 mechanism. All 31 exports across the 8 discovered modules ARE guard-first. |
| **Risk / Impact** | Anonymous cache-thrash of `/admin` (cheap amplification). More materially: live counterexample to F01's "enforced by default for every current and future action" and AGENTS.md's "ONLY exempt module is login". Open template: any future action in `web/components/**` silently escapes the net. |
| **Evidence** | `web/components/health-card/actions.ts:1` `"use server"`; `:14-16` unguarded. Arch test `walk(path.join(WEB_DIR, "app"))` + `entry.name === "actions.ts"`. `rg '"use server"' web/` lists 10 modules; 9 under `web/app`. Validator confirmed form-binding. |
| **Recommendation** | Add `await requireOperator();` as the first statement. Widen arch-test discovery to every file under `web/` whose source contains a top-level `"use server"` directive (keep the login allowlist). Correct AGENTS.md wording. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Extended discovery must include the health-card module; unauth + reader scenarios fail on it until guarded. Self-check: every `"use server"` file is discovered or consciously allowlisted. |
| **Acceptance Criteria** | Every top-level `"use server"` file under `web/` is covered by the arch test; `revalidateHealthCheck` rejects with `UnauthorizedError`/`ForbiddenError`; AGENTS.md allowlist statement is accurate. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Re-opened the module (no guard) and the client form binding. Arch-test walk confirmed. Impact of the action itself is only revalidation, but it live-falsifies the invariant — Medium stands. |

---

### [x] S2-20260918: `SETTINGS_SECRET_KEY` omitted from `SECRET_ENV_KEYS` denylist

| Field | Value |
|---|---|
| **ID** | `S2-20260918` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/next.config.mjs:14` |
| **Description** | The X2 denylist is `APPWRITE_API_KEY`, `OPENROUTER_API_KEY`, `SMTP_PASSWORD`. Feature 04's AES key `SETTINGS_SECRET_KEY` is a real secret (`.env.example`, `DEPLOY.md`) living in the root `.env`. The denylist's own maintenance comment names this exact future key as what MUST be added — it never was. Production-mode config evaluation therefore injects it from a repo `.env` into `process.env`. The next-config test fixture omits the key, so the gap is invisible. |
| **Risk / Impact** | The at-rest encryption key becomes readable from `process.env` of any process evaluating `next.config.mjs` next to a populated repo `.env` in production (`next build`/`next start` from a checkout). Not reachable in the canonical container image (no repo `.env`). Defense-in-depth erosion of F04. |
| **Evidence** | `next.config.mjs:14` Set of three keys; comment `:11-13` names this key; `.env.example` documents it as the AES-256-GCM key. |
| **Recommendation** | Add `SETTINGS_SECRET_KEY` to `SECRET_ENV_KEYS`; pin it in `next-config.test.ts` (prod unset / dev set). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Fixture `.env` containing `SETTINGS_SECRET_KEY` — production stays unset; development is set. |
| **Acceptance Criteria** | All four secret keys are in the denylist and asserted by the hermetic next-config test. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Denylist, comment, and loader skip-logic re-verified. Medium (partial weakness, checkout-run gated) stands. |

---

### [x] S3-20260918: Draft-normalize scheme-scrub bypass family (newline / next-line definition / backslash)

| Field | Value |
|---|---|
| **ID** | `S3-20260918` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/pipeline/draft-normalize.ts:150-199,233-266,41-46` |
| **Description** | Three CommonMark constructs survive `normalizeDraftMarkdown` with disallowed-scheme destinations: (1) `[a](\njavascript:alert(1))` — `parseParenDestination` treats newline as terminator, returns null, link never matched; (2) `[r]:\njavascript:x` + `[r]` — `matchLinkDefinition` bails at newline; (3) `[a](javascript\:alert(3))` — scheme regex sees no colon. Validator re-ran against the repo's `marked` v18: all three emit `<a href="javascript:…">`. No current XSS: sanitize-html strips at email/RSS/export; react-markdown `urlTransform` neutralizes in the reader. S12's storage-side backstop is defeatable. |
| **Risk / Impact** | Any future render-layer regression loses the storage backstop the original audit feared. |
| **Evidence** | `:154` skipHorizontalWs is space/tab only; `:246` newline returns null; `:15` scheme regex has no escape handling. Independent marked probe reproduced the three hrefs. |
| **Recommendation** | Honor CommonMark `spnl` after `(` and after definition `:`; reject/unescape backslash-escaped characters before the scheme test. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | draft-normalize.test.ts: the three hostile cases reduce to text; benign `[a](\nhttps://ok.example)` stays byte-identical. |
| **Acceptance Criteria** | `normalizeDraftMarkdown` reduces every construct for which marked/react-markdown would emit a non-http/https/mailto href; benign-fixture byte-identity stays green. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Independent marked probe reproduced all three bypasses. Render-layer backstops verified present. Medium (defense-in-depth eroded, no current exploit) stands. |

---

### [x] C1-20260918: Reaper can mark a live run failed (non-atomic claim+heartbeat; silent heartbeat death)

| Field | Value |
|---|---|
| **ID** | `C1-20260918` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/execute-run.ts:431-432,245-252`; `shared/src/runs/repository.ts:345-357,475-511`; `shared/src/runs/stale-run-reaper.ts:33-42`; `worker/src/index.ts:152-158` |
| **Description** | Two residual reap-a-live-run paths in the C2 fix. (1) `markRunning` flips status to `running` without `lastHeartbeatAt`; the immediate heartbeat is a second awaited write. A sweep whose `listRuns` snapshot lands in that window sees `running` + null heartbeat + old `startedAt` (long-queued run) and marks it failed. Window is one Appwrite RTT. (2) `pulseHeartbeat` failures are log-only. If schema provision of `lastHeartbeatAt` failed (worker logs and continues), every run longer than `staleMs` is reaped mid-flight. `markFailed` has no status guard — last-write-wins can overwrite a concurrent `markCompleted`. |
| **Risk / Impact** | Healthy executing run marked failed; in a botched-upgrade scenario every long run fails until the schema is fixed — a regression of the availability C2 restored. |
| **Evidence** | `markRunning` data lacks `lastHeartbeatAt`; two separate awaited writes; reaper `lastBeat = Date.parse(run.lastHeartbeatAt ?? run.startedAt)`; provision failure is log-and-continue; pulse errors `console.error` only. |
| **Recommendation** | Include `lastHeartbeatAt` in `markRunning`'s payload (atomic claim+beat). Escalate persistent pulse failures (abort after N consecutive failures). |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | `markRunning` asserts `lastHeartbeatAt` present. Interleaving: sweep between `markRunning` and first touch does not reap a long-queued run. N consecutive `touchRunHeartbeat` failures abort the run. |
| **Acceptance Criteria** | The pending→running transition and first heartbeat are the same document write (or otherwise atomic); a persistently failing heartbeat write terminates the run rather than leaving it reap-eligible while executing. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Both paths re-verified in current code. Low-probability (ms window / botched-upgrade) but code-real; Medium stands. |

---

### [x] N1-20260918: No durable evidence the pinned dispatcher is honored by the real fetch

| Field | Value |
|---|---|
| **ID** | `N1-20260918` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `shared/src/pipeline/__tests__/fetch-safety.test.ts:358-394`; `shared/src/pipeline/fetch-safety.ts:198-203` |
| **Description** | Feature 03's Handoff mandated a one-time loopback smoke of the REAL fetch + dispatcher path ("mocked fetch cannot prove Node's global fetch honors an npm-undici dispatcher"). No durable evidence exists: every S10 test mocks `globalThis.fetch` (wiring assertion only) or unit-tests `createPinnedLookup`; no comment/script/docs records a real-socket result. The spec even ordered the throwaway script deleted. |
| **Risk / Impact** | If the runtime silently drops `init.dispatcher`, DNS-rebinding TOCTOU protection is dead while all tests stay green — the security control as verification theater. |
| **Evidence** | Test `:368-373` asserts dispatcher passed to a MOCKED fetch. Repo-wide search (src, scripts, docs, `.ssc`, comments) finds zero real-socket record. |
| **Recommendation** | Add an opt-in integration test (loopback `node:http` server, unmocked fetch, expect `BlockedTargetError` and zero server hits) or record the smoke result durably. Run once in CI. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Real-socket test as above; optionally also under the Next server runtime (see S9). |
| **Acceptance Criteria** | A real-socket (no fetch mock) test or documented smoke exists proving the guarded path refuses a live loopback target through the actual global fetch + npm-undici dispatcher used in production. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Spec mandate verified; repo-wide search found nothing. Anti-cheat: the verification step left no artifact. Medium (code smell carrying real risk) fits; the runtime itself very likely honors `init.dispatcher` in plain Node. |

---

### [x] S4-20260918: Update-path repository writers still interpolate unvalidated ids (S9 residual)

| Field | Value |
|---|---|
| **ID** | `S4-20260918` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `shared/src/runs/repository.ts:360-365,383-388,497-501` (and sibling writers in newsletters/feeds/rss-publications/record-delivery) |
| **Description** | S9 closure verified REAL for the six named get/delete functions and three list clamps. Every exported UPDATE-path writer still interpolates caller ids unvalidated (`markRunning`, `touchRunHeartbeat`, `markFailed`, `markCompleted`, `updateNewsletter`, `updateFeed`, …). Exposure requires an authenticated operator or a future action regression. |
| **Risk / Impact** | Path-confusion class S9 flagged remains open on writers; contained by auth gating and unproven traversal in node-appwrite. |
| **Evidence** | `markFailed` `documentId: runId` with no gate (contrast `getRun:177-179`). 15+ ungated writer sites. |
| **Recommendation** | Route every exported repository function interpolating ids through `isValidAppwriteDocumentId` (domain `not_found`); extend the malformed-id matrix to writers. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `it.each(malformed)` on `markFailed`/`updateNewsletter`/`updateFeed`: domain `not_found`, zero SDK calls. |
| **Acceptance Criteria** | No exported repository function interpolates a caller-supplied document id without a prior `isValidAppwriteDocumentId` gate. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Spot-checked cited writers. Low is correct given operator gating. |

---

### [x] S5-20260918: `failedFeeds` JSON and `lastFetchError` persisted unredacted (S8 residual)

| Field | Value |
|---|---|
| **ID** | `S5-20260918` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `shared/src/runs/repository.ts:492-494`; `shared/src/feeds/health.ts:81` |
| **Description** | S8 closure verified REAL for named sites (`markFailed` redacts `failureMessage`; health/check sanitizes; `recordFeedTestResult` redacts). Residuals: (1) `markFailed` persists `data.failedFeeds = JSON.stringify(input.failedFeeds)` unredacted — `FeedFailure.errorMessage` is raw upstream text, `feedUrl` raw; (2) `applyFeedFetchOutcomes` writes `lastFetchError = failure.errorMessage.slice(0, 1000)` with no redaction — inconsistent with the just-fixed neighbor on the same collection. |
| **Risk / Impact** | Upstream error text and credential-bearing feed URLs persist unscrubbed and render in the operator GUI — defeats F04's "enforced inside low-level persist functions" invariant. |
| **Evidence** | `repository.ts:493` JSON.stringify (contrast `:482` two lines above); `feeds/health.ts:81` slice only. |
| **Recommendation** | Map `failedFeeds` through a redacting serializer; apply `redactMessageForStorage` to `lastFetchError`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `markFailed` with `sk-or-v1-…` in `failedFeeds[].errorMessage` → stored JSON contains `[redacted]`; `applyFeedFetchOutcomes` same. |
| **Acceptance Criteria** | No persisted error-message field in `markFailed`/`applyFeedFetchOutcomes` bypasses `redactMessageForStorage`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Both residual sites re-verified; `recordFeedTestResult` contrast confirmed. |

---

### [x] S6-20260918: `server-only` guard transitive-only on remaining secret-bearing modules (S7 residual)

| Field | Value |
|---|---|
| **ID** | `S6-20260918` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `shared/src/pipeline/llm-client.ts:124`; `shared/src/delivery/smtp-config.ts:50`; `shared/src/settings/repository.ts:1-44` |
| **Description** | S7 correctly guards the four spec-named modules. Other secret-bearing modules lack their own guard: `llm-client.ts` reads static `process.env.OPENROUTER_API_KEY`; `smtp-config.ts` reads `SMTP_PASSWORD`; `settings/repository.ts` decrypts stored secrets. Protection is transitive via the root barrel re-exporting guarded `appwrite/config` first + package exports map (`"."` and `"./client"` only). Boundary holds today; same "safety is incidental" pattern one level down. |
| **Risk / Impact** | A future packaging/refactor (new subpath export, barrel change) could bundle env-secret readers into a client graph without a build failure. |
| **Evidence** | `llm-client.ts:124` static env read, no `import "server-only"`; package.json exports map. |
| **Recommendation** | Add `import "server-only"` as the first line of `llm-client.ts`, `smtp-config.ts`, `settings/repository.ts`, and `connection-diagnostics.ts`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Throwaway `"use client"` import of `LLMClient` / `updateConnectionSettings` must fail `pnpm --filter web build`; revert after evidence. Worker build stays green. |
| **Acceptance Criteria** | Every shared module that reads those env secrets or returns decrypted secrets begins with `import "server-only"`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Unguarded reads and transitive barrel protection re-verified. Low (no current leak) stands. |

---

### [x] S7-20260918: bootstrap-operator trusts email-filter result without equality check

| Field | Value |
|---|---|
| **ID** | `S7-20260918` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `shared/scripts/bootstrap-operator.mjs:109-127` |
| **Description** | The script lists users with `Query.equal("email", email)` + `Query.limit(1)` and then labels `listed.users[0]` without asserting `existing.email === email`. If the deployed Appwrite ignores the email filter, the wrong/first-listed user gets the `operator` label. |
| **Risk / Impact** | Privilege mis-grant on a run-once ops script. Mitigating: Appwrite commonly rejects unsupported queries loudly. |
| **Evidence** | `:109-112` list then `users[0]`; `:114-123` `updateLabels` with no email check. |
| **Recommendation** | Assert `existing.email` matches `HOMEPRESS_OPERATOR_EMAIL` before labeling; exit non-zero on mismatch. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Code-level guard; PM smoke already required by the spec. |
| **Acceptance Criteria** | The script refuses to label any user whose email does not exactly match `HOMEPRESS_OPERATOR_EMAIL`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Code-verified. Low (defensive gap on a run-once script) is honest. |

---

### [x] S8-20260918: Empty-DNS-answer treated inconsistently between validation and fetch gates

| Field | Value |
|---|---|
| **ID** | `S8-20260918` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `shared/src/feeds/ssrf.ts:242-255`; `shared/src/pipeline/fetch-safety.ts:277-293` |
| **Description** | `isPubliclyRoutableUrl` returns `{ok: true}` when the resolver yields `[]` (loop never runs). The fetch-time guard fails closed (`BlockedTargetError` `"unresolvable"`). Default getaddrinfo throws ENOTFOUND rather than returning `[]` — reachable via injected/edge resolver. S11's point was fail-closed consistency. |
| **Risk / Impact** | Weaker gate runs first; operator sees create succeed then fetch refuse. |
| **Evidence** | `ssrf.ts:250-255` empty array falls through to `ok: true`; `fetch-safety.ts:287-293` empty → throw. |
| **Recommendation** | Return `{ok: false, reason: REASON_UNRESOLVABLE}` on empty answer in `isPubliclyRoutableUrl`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `ssrf.test.ts`: resolver returning `[]` → `ok: false`. |
| **Acceptance Criteria** | Both gates return not-ok/unresolvable for an empty resolver answer. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Inconsistency code-verified. Low given default-resolver behavior. |

---

### [x] S9-20260918: Web qualification path may drop the pinned dispatcher under Next's patched fetch

| Field | Value |
|---|---|
| **ID** | `S9-20260918` |
| **Severity** | Low |
| **Category** | Security |
| **Location** | `shared/src/pipeline/fetch-safety.ts:198-203`; `web/app/(protected)/admin/feeds/actions.ts:100` |
| **Description** | `fetchWithSizeLimit` passes the pinned Agent via non-standard `RequestInit.dispatcher`. Worker (plain Node) honors it. The web qualification path (`testFeed` → `qualifyFeed`) runs under Next's patched fetch, which is known to reconstruct/drop non-standard init properties. If dropped, only pre-flight remains on that operator-triggered path (rebinding window milliseconds). Worker runs (the attacker-facing surface) unaffected. |
| **Risk / Impact** | Reduced pinning on one operator-triggered path. Mitigated by `redirect: "error"` + pre-flight + operator-only trigger. |
| **Evidence** | `fetch-safety.ts:198-203` builds init with `dispatcher`. Cannot be resolved statically. |
| **Recommendation** | Run the loopback smoke (N1) in both runtimes; for web, capture pristine fetch at module load or verify forwarding. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Integration under a Next server-action environment asserting the connection is refused for a private target through the real fetch. |
| **Acceptance Criteria** | The web qualification fetch path demonstrably connects through the pinned dispatcher, or an equivalent compensating control is documented. |
| **Validation Decision** | Needs-More-Evidence |
| **Validation Rationale** | Path confirmed; whether Next drops `dispatcher` is version/cache-mode-dependent and unprovable from static reading. The recommended runtime smoke is exactly the missing evidence. Low stands. |

---

### [ ] C2-20260918: Plaintext SMTP password beginning with `enc1:` silently misclassified

| Field | Value |
|---|---|
| **ID** | `C2-20260918` |
| **Severity** | Low |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/settings/secrets.ts:45-47,84-94`; `shared/src/settings/operator-settings.ts:306-310` |
| **Description** | `isEncryptedSecretValue` is `startsWith("enc1:")`. Under cipher `off`, an SMTP password that itself begins with `enc1:` is stored verbatim, then classified as ciphertext on every read → decrypt returns `""` → read model clears the entire SMTP bundle. Later keep-save under cipher `on` re-persists as-is — unrecoverable through the GUI. OpenRouter `sk-or-` keys cannot collide. |
| **Risk / Impact** | SMTP silently stops resolving; operator sees empty fields despite a stored value. Absurdly rare input. |
| **Evidence** | `secrets.ts:46` `startsWith(CIPHER_MARKER)`; validator has no marker check. |
| **Recommendation** | Under cipher `off`, reject non-empty secret input starting with `enc1:`. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | `updateConnectionSettings` with `smtpPassword: "enc1:hunter2"` under cipher off → validation error. |
| **Acceptance Criteria** | No new save can store a plaintext secret the read path will misclassify as ciphertext. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Marker + decrypt-empty + quartet-clear path re-verified. Low (rare, silent) stands. |

---

### [x] C3-20260918: Key-loss recovery clears non-secret SMTP fields and blocks unrelated Connections saves

| Field | Value |
|---|---|
| **ID** | `C3-20260918` |
| **Severity** | Low |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/settings/repository.ts:156-186`; `web/lib/settings-panel.ts:70-76`; `web/components/settings/connections-settings.tsx:96-105` |
| **Description** | After key loss, an unreadable SMTP password decrypts to `""` and the read model returns `UNSET_SMTP` for all six attributes (quartet rule), including intact non-secret host/port/username. GUI prefills empty. Any Connections save (even `appPublicUrl`) sends empty non-secret SMTP + blank password (keep → ciphertext still present) → effective-quartet validation refuses until the operator re-enters the full set or clicks Clear SMTP. Fail-closed (no silent data loss) but confusing. |
| **Risk / Impact** | Operator confusion and blocked Connections saves during key-loss recovery. |
| **Evidence** | `repository.ts:171-175` incomplete quartet → `UNSET_SMTP`; form prefills from that DTO. |
| **Recommendation** | Keep non-secret SMTP attrs in the read model when only the password is unreadable, or extend the banner copy to explain re-entry / Clear SMTP. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Unreadable stored password → panel DTO host empty (pin chosen behavior); Connections save with blank non-secret SMTP + kept unreadable ciphertext → validation error (intentional). |
| **Acceptance Criteria** | Key-loss recovery flow documented/tested: the operator can always complete a valid SMTP bundle or clear it, and the GUI makes clear why an unrelated save is refused. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Quartet-clear + form-submit-full-bundle + validation refusal re-verified. |

---

### [ ] C4-20260918: Cap slices can split UTF-16 surrogate pairs

| Field | Value |
|---|---|
| **ID** | `C4-20260918` |
| **Severity** | Low |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/drafter.ts:149-152`; `shared/src/pipeline/draft-normalize.ts:28-30` |
| **Description** | Both new caps slice by UTF-16 code units. A boundary inside a surrogate pair produces a lone-surrogate tail (invalid Unicode; UTF-8 encodes as U+FFFD). |
| **Risk / Impact** | One-character corruption (or a rejected Appwrite write) at the exact truncation boundary for astral-plane content. Very low probability. |
| **Evidence** | Both sites use `.slice(0, CAP)`. Node probe confirms lone-surrogate tail. |
| **Recommendation** | Shared `sliceAtCodePointBoundary` helper: back off one unit if last char is a high surrogate. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `'😀'.repeat(N)` engineered so the boundary splits a pair → no lone surrogates. |
| **Acceptance Criteria** | Neither cap site can emit a string ending in an unpaired surrogate. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Independent probe reproduced the lone-surrogate tail. Low stands. |

---

### [ ] C5-20260918: Over-scrub: indented code blocks not exempted (benign pass-through violated at margins)

| Field | Value |
|---|---|
| **ID** | `C5-20260918` |
| **Severity** | Low |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/pipeline/draft-normalize.ts:59-90,297-360` |
| **Description** | Only column-0 fences (≤3-space indent) and inline code spans are exempted. An indented (4+ spaces) code block quoting `[x](javascript:alert(1))` is rewritten to `x`. Validator **falsified** the original prose example (`[x]: javascript is fun` survives — first token lacks a colon). Genuine over-scrub is indented/nested code, not definition-lookalike prose. Content loss only, never a security hole. |
| **Risk / Impact** | Rare silent corruption of legitimate model output that quotes hostile syntax inside indented code. Contradicts "benign drafts byte-identical" at the margins. |
| **Evidence** | Probe-confirmed: indented code block quoting a javascript: link is rewritten. `:76-77` only ≤3-space column-0 fences. |
| **Recommendation** | Exempt 4+-space indented lines, or document + pin the tradeoff with a named test. Drop the falsified prose example. |
| **Effort** | M |
| **Confidence** | Medium |
| **Suggested Tests** | Indented code block containing `[x](javascript:alert(1))` stays byte-identical (if exempting) or the deviation is explicitly pinned. |
| **Acceptance Criteria** | Either the over-scrub is exempted or the behavior is consciously pinned by named tests + a doc comment. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Core (indented code) confirmed; one original example falsified. Low unchanged; hardening builder must drop the falsified example. |

---

### [x] C6-20260918: `listAccounts` reads one page (default 25) with no pagination

| Field | Value |
|---|---|
| **ID** | `C6-20260918` |
| **Severity** | Low |
| **Category** | Correctness & Reliability |
| **Location** | `web/lib/accounts/account-admin.ts:137-145` |
| **Description** | `users.list()` with no queries — Appwrite default page limit 25. Beyond 25 household accounts the `/admin/accounts` page silently omits overflow rows; no truncation indicator. |
| **Risk / Impact** | Operator loses management visibility of the tail of the list. Household scale makes >25 unlikely but not prevented. |
| **Evidence** | `:139` `await users.list();` — no limit, no cursor. |
| **Recommendation** | Cursor-paginate until `total` reached, or explicit high limit + truncation indicator. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Stubbed `Users.list` returning two pages (total=30) → `listAccounts` returns 30. |
| **Acceptance Criteria** | `listAccounts` returns every user in the project regardless of count. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Call site and Appwrite default-page behavior verified. |

---

### [x] N2-20260918: Arch-test static check has bypass vectors (comments, arrows, silent skips)

| Field | Value |
|---|---|
| **ID** | `N2-20260918` |
| **Severity** | Low |
| **Category** | Anti-cheat |
| **Location** | `web/src/__tests__/server-actions-auth.test.ts:93-116,259-295` |
| **Description** | The N1-20260917 fix (arch test) is real and strong overall (discovery self-check, runtime rejection under both sessions, throwing spies, one-module allowlist) but the static convention check has documented holes: regex matches `requireUser()` in comments/strings; no first-statement enforcement; only `export async function` (arrow exports escape static, runtime still imports them); brace-matching silently `continue`s on unparseable bodies; seams mocked only for `@newsletter/shared` + `next/cache`. No current action exploits this. |
| **Risk / Impact** | A future arg-tolerant ungated action could evade both checks, reintroducing the S1 class invisibly. Likelihood low. |
| **Evidence** | `:265-266` pattern; `:94` no arrows; `:99/:112` silent continue; `:24-38` seam scope. |
| **Recommendation** | Strip comments/strings before static patterns; fail on unparseable bodies; extend to arrow exports; document seam-mock scope. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Mutation probes: commented-out guard still fails static; temp `export const tempAction = async (input = {}) => …` with no guard fails; brace-in-string does not skip. |
| **Acceptance Criteria** | Static check fails on guard-in-comment-only bodies, unparseable bodies, and ungated arrow exports; existing 31-export/8-module green path unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | All five weaknesses verified. Runtime zero-arg checks compensate today. Low stands. |

---

### [x] M1-20260918: `runPipeline` advertises but does not thread per-feed trust flags

| Field | Value |
|---|---|
| **ID** | `M1-20260918` |
| **Severity** | Low |
| **Category** | Maintainability & Best Practices |
| **Location** | `shared/src/pipeline/orchestrator.ts:30-41,137-139,167-172` |
| **Description** | `PipelineOptions.fetcher` advertises `privateFeedUrls` and scraper items advertise `allowPrivateTarget`, but `runPipeline` never threads either (fetch call passes only `{dateRange}`; scrape mapping drops `feedUrl`). `NewsletterConfig` has no `privateFeedUrls` field. Only non-test caller is `worker/src/parity-run.ts:43`. Latent trap: a future production caller of `runPipeline` silently degrades internal feeds. |
| **Risk / Impact** | Option types imply support the default pipeline does not deliver. |
| **Evidence** | `:137-139` fetcher without `privateFeedUrls`; `:168-171` scrape items url+fallbackContent only. |
| **Recommendation** | Thread `privateFeedUrls` through config, or remove the misleading option fields and document `runPipeline` as parity-only/public-only. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | If threaded: orchestrator test asserting fetcher receives `privateFeedUrls`. If removed: types no longer advertise the flags. |
| **Acceptance Criteria** | `runPipeline` either forwards per-feed trust end-to-end or its types no longer suggest it does. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Call sites and sole non-test caller re-verified. |

---

### [x] M2-20260918: Dead legacy full-object validator retained (clear-on-empty semantics)

| Field | Value |
|---|---|
| **ID** | `M2-20260918` |
| **Severity** | Low |
| **Category** | Maintainability |
| **Location** | `shared/src/settings/operator-settings.ts:22-42,74-89,369-386` |
| **Description** | `updateOperatorSettings` is gone, but `validateOperatorSettings` + `OperatorSettingsInput` + `ValidatedOperatorSettings` remain with zero production callers (only the test file). Semantics are `""` = clear — exactly the pattern S6 removed. Invites a future caller to rebuild read-modify-write against the wrong contract. |
| **Risk / Impact** | Latent API-surface confusion. |
| **Evidence** | `rg` for those names outside the defining file matches only `operator-settings.test.ts`. |
| **Recommendation** | Delete them (+tests), or mark `@deprecated` with a pointer to the section-scoped inputs. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | After deletion: `rg` returns nothing; settings test suite green. |
| **Acceptance Criteria** | No exported settings-validation function exists whose input type mixes secrets with clear-on-empty semantics. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Zero production callers re-verified. |

---

### [x] T1-20260918: No obfuscated-IPv4-literal / zone-ID regression tests

| Field | Value |
|---|---|
| **ID** | `T1-20260918` |
| **Severity** | Low |
| **Category** | Testing |
| **Location** | `shared/src/feeds/__tests__/ssrf.test.ts:89-160`; `shared/src/pipeline/__tests__/fetch-safety.test.ts:199-310` |
| **Description** | Suites never exercise `http://2130706433/`, `http://0x7f.1/`, `http://0177.0.0.1/`, or `[fe80::1%25eth0]`. WHATWG URL currently normalizes decimal/hex/octal IPv4 to dotted-quad (blocked) and zone-ID hosts fail parse (fail-closed) — correct today, pinned by zero tests. |
| **Risk / Impact** | A future refactor of literal detection could silently reopen an obfuscated-literal bypass. |
| **Evidence** | No test contains those forms. Validator's Node probe confirmed current parser behavior. |
| **Recommendation** | Add `it.each` cases to both suites. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Those four URLs → blocked; numeric forms do not consult the resolver. |
| **Acceptance Criteria** | Both suites contain and pass obfuscated-literal cases. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Coverage gap and implicit-parser behavior independently confirmed. |

---

### [x] T2-20260918: `touchRunHeartbeat` has no repository-level tests

| Field | Value |
|---|---|
| **ID** | `T2-20260918` |
| **Severity** | Low |
| **Category** | Testing |
| **Location** | `shared/src/runs/__tests__/repository.test.ts` (absence) |
| **Description** | New production function `touchRunHeartbeat` (`runs/repository.ts:376-396`) has zero direct unit tests. `execute-run.test.ts` mocks the whole repository module, so a regression that broadened the update payload (clobbering phase attrs every 30s) would pass the suite. |
| **Risk / Impact** | The partial-update invariant the heartbeat design depends on is unpinned. |
| **Evidence** | `rg touchRunHeartbeat` in `repository.test.ts` → no matches. |
| **Recommendation** | Add a describe: payload-exactness (`Object.keys(data) === ["lastHeartbeatAt"]`), 404 → not_found, wrap. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | As in Recommendation. |
| **Acceptance Criteria** | `touchRunHeartbeat` has direct repository-level tests covering payload-exactness and both error paths. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Absence and mock-out of the execute-run suite re-verified. |

---

### [x] U1-20260918: Duplicate-email account creation returns a generic retry-forever error

| Field | Value |
|---|---|
| **ID** | `U1-20260918` |
| **Severity** | Low |
| **Category** | UX/i18n/Accessibility |
| **Location** | `web/lib/accounts/account-admin.ts:169-175` |
| **Description** | `createReaderAccount` wraps every `users.create` error — including Appwrite `user_already_exists` (409) — into the generic `"Something went wrong while updating accounts. Please try again."`. The operator is told to retry an operation that can never succeed. |
| **Risk / Impact** | Operator confusion on the most common creation error. No security impact. |
| **Evidence** | `wrapAppwriteError` discards type/code; no 409 mapping in the accounts chain. |
| **Recommendation** | Map 409 / `user_already_exists` to `AccountAdminError("validation", "An account with this email already exists")`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Stub `users.create` rejecting `{code: 409, type: "user_already_exists"}` → validation error with the duplicate-email message. |
| **Acceptance Criteria** | Creating a reader with an existing email shows a fixed "already exists" message; other Appwrite failures keep the generic safe string. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | wrapAppwriteError + no 409 mapping re-verified. |

---

### [x] X1-20260918: RSS 500 response missing `Cache-Control: no-store`

| Field | Value |
|---|---|
| **ID** | `X1-20260918` |
| **Severity** | Low |
| **Category** | Config/Infra/CI |
| **Location** | `web/app/rss/[newsletterId]/route.ts:50-56` |
| **Description** | 404s send `no-store` and 200 sends `public, max-age=300`, but the `AppPublicUrlError` 500 constructs the Response with no headers. A caching intermediary could pin the "temporarily unavailable" body across a transient misconfiguration. Adjacent log is a bare `{message}` without the `phase`/`errorType` keys used by sibling structured logs. |
| **Risk / Impact** | Minor: stale 5xx; weaker ops attribution. |
| **Evidence** | `:55` `new Response(..., { status: 500 })` — no headers option. |
| **Recommendation** | Add `Cache-Control: no-store` to the 500; add `phase` to the log record. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | rss-feed-route.test.ts `AppPublicUrlError` case: expect `Cache-Control` `no-store`. |
| **Acceptance Criteria** | All non-200 RSS responses carry `Cache-Control: no-store`; error log includes a phase key. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Header asymmetry re-verified. |

---

## Dependencies and Licensing

- **Vulnerabilities:** B5 reviewer ran `pnpm audit` (per prompt); no D-category findings raised. Prior D1/D2/S13 closures treated as holding at repo level. GHCR images still carry the pre-stage tree until the stage-end release rebuilds them (spec remainder, not a new finding).
- **Outdated critical packages:** none identified this pass.
- **License concerns:** none identified.

---

## Quality Signals

- **Lint/config signals:** Arch-test culture is strong (discovery + dual runtime scenarios). Gaps: discovery scoped to `web/app/**/actions.ts` (S1); static check has bypasses (N2); X2 denylist not maintained when F04 added a secret (S2).
- **Test/coverage signals:** Feature-level tests are real (not tautological) for crypto, sentinel saves, SSRF matrix, RSS route, headers. Notable gaps: no real-socket dispatcher smoke (N1), no `touchRunHeartbeat` repo tests (T2), no obfuscated-literal cases (T1). Reviewers did not re-run `pnpm test`.
- **Complexity/churn signals:** Stage was large (182-file delta). Residuals cluster at trust-boundary edges (discovery net, denylist maintenance, scrub parser vs CommonMark, claim/heartbeat atomicity) rather than core-control absence.

---

## Risk Assessment

- **Overall risk:** Medium (no Blocker/High; five Medium residuals, none currently exploitable as a takeover)
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** CSP (deferred pin); atomic run claiming / C3 (deferred pin, single-worker); reverse-proxy config; Appwrite console settings; live pentest; GHCR image rebuild (stage-end release).

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1-20260918 | Medium | Address now | Ungated health-card action + discovery hole |
| S2-20260918 | Medium | Address now | SETTINGS_SECRET_KEY denylist miss |
| S3-20260918 | Medium | Address now | Draft-normalize scrub bypass family |
| C1-20260918 | Medium | Address now | Reap-a-live-run race |
| N1-20260918, S9-20260918 | Medium + Low | Address now | Real-socket dispatcher smoke (both runtimes); S9 folded into N1 |
| N2-20260918 | Low | Address now | Arch-test static-check bypasses (rides S1) |
| S4-20260918 | Low | Address now | Update-path writer id gates |
| S5-20260918 | Low | Address now | failedFeeds / lastFetchError unredacted |
| S6-20260918 | Low | Address now | server-only on remaining secret modules |
| S7-20260918 | Low | Address now | bootstrap email equality check |
| S8-20260918 | Low | Address now | Empty-DNS-answer fail-closed |
| C3-20260918 | Low | Address now | Key-loss SMTP form UX |
| C6-20260918 | Low | Address now | listAccounts pagination |
| M1-20260918 | Low | Address now | Document runPipeline as public-only |
| M2-20260918 | Low | Address now | Delete dead legacy validator |
| T1-20260918 | Low | Address now | Obfuscated-literal SSRF tests |
| T2-20260918 | Low | Address now | touchRunHeartbeat repo tests (rides C1) |
| U1-20260918 | Low | Address now | Duplicate-email message |
| X1-20260918 | Low | Address now | RSS 500 no-store |
| C2-20260918 | Low | Dismiss | Pedantic: SMTP password literally starting with `enc1:` |
| C4-20260918 | Low | Dismiss | Pedantic: emoji split at 70k/1M cap boundary |
| C5-20260918 | Low | Dismiss | Pedantic: indented-code over-scrub; not a security hole |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

Suggested clusters if you want to batch:

| Cluster | IDs | One-line |
|---|---|---|
| Arch-test net | S1, N2 | Widen discovery + harden static check |
| Secrets hygiene | S2, S6, C2, C3, M2 | Denylist, server-only, marker collision, key-loss UX, dead validator |
| SSRF evidence | N1, S9, S8, T1 | Real-socket smoke, empty-DNS, obfuscated literals |
| Reaper | C1, T2 | Atomic heartbeat + tests |
| Content policy | S3, C4, C5 | Scrub bypasses, surrogate slice, indented-code exemption |
| Redaction/ids | S4, S5 | Writer id gates; failedFeeds/lastFetchError |
| Accounts UX | C6, U1, S7 | Pagination, duplicate-email, bootstrap email assert |
| RSS 500 | X1 | no-store header |
| Orchestrator types | M1 | Thread or document |

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
