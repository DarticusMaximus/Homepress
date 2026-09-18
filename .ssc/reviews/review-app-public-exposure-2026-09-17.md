# SSC Code Review Report

**Date:** 2026-09-17
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** app:public-exposure — whole-app security audit for public internet exposure (ad-hoc scope)
**Profile:** security — severity floor: Medium
**Feature spec anchor:** none (ad-hoc scope)

---

## Summary

- **Merge recommendation:** **Block** — not safe to expose to the public internet in its current state
- **Issues by severity:** Blocker 1 | High 3 | Medium 19 | Low 6 (surfaced) | Nit 0
- **Overall rationale:** One confirmed Blocker (S1) allows an unauthenticated attacker on the public internet to invoke 16 admin server actions — purge all runs, overwrite the stored OpenRouter/SMTP credentials, repoint SMTP, and toggle schedules — because those actions never check the session and Next.js resolves actions from the POST `Next-Action` header, not from the page layout. The unpatched Next.js dependency tree (D1, 2 critical / 12 high advisories incl. unauth RCE in the Image Optimization API) compounds this on the same internet-facing container. Everything else is fixable hardening: SSRF at fetch time (S10), crash recovery for stuck runs (C2), secret-handling design (S4/S6), headers/port binding (X1/X4). Fixing S1 + D1 + X4 (+ X1 verification) is the minimum bar before public exposure; the rest can be sequenced.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** whole repo (`web/`, `worker/`, `shared/`, deployment configs, live Appwrite instance config)
- **Base reference:** `main` @ d09bd91 (Homepress 0.1.5)
- **Files reviewed:** ~135 non-test source files (~31.5k lines), in 4 sequential reviewer batches:
  - **B1 — web attack surface (44 paths):** `web/middleware.ts`, `web/lib/auth/*`, `web/app/login/*`, all `(protected)` pages + `actions.ts` modules, public routes (`/rss/[newsletterId]`, `/api/issues/[runId]/export`, `/health`, `/build-id`), `web/next.config.mjs`, `shared/src/appwrite/{config,server}.ts`, `shared/src/client.ts`, `shared/src/schema/{declarations,provisioner}.ts`
  - **B2 — data layer (42 paths):** all `shared/src` repositories (runs, newsletters, feeds, prompts, settings), `operator-settings`, `connection-diagnostics`, `health/check.ts`, `util/log-redact.ts`, `runs/execute-run.ts` + run lifecycle modules
  - **B3 — outbound fetch + worker (23 paths):** `feeds/ssrf.ts`, `pipeline/{fetch-safety,rss-fetcher,scraper,llm-client,orchestrator,scorer,drafter,mmr-selection,tagger,cross-run-suppress,issue-metadata,vectors,config,types}.ts`, `worker/src/*`
  - **B4 — delivery/rendering/infra (30 paths):** `shared/src/delivery/*`, issue markdown/listen rendering components, `web/public/sw.js`, PWA components, `compose.yaml`, both Dockerfiles, `.env.example`, `SECURITY.md`, `docs/DEPLOY.md`, 4× `package.json` + `pnpm audit --prod`
  - **Live Appwrite instance** (via scoped API key): database + all 8 tables with permissions, `app_settings` column schema, users list
- **Files skipped:**
  - `web/components/ui/*` (shadcn vendored primitives — stock, low review value)
  - `**/__tests__/**` and `*.test.*` (~53k lines — test-quality review out of scope for this pass; tests were read where they evidenced production behavior, e.g. `settings-actions.test.ts:145`)
  - `web/src/__tests__` (same reason)
  - Manifest note (was B1 finding M1, below floor, folded here): batch listed `web/app/(protected)/issues/page.tsx` which does not exist — intentional per Stage 14 pin (Home is the reader inbox). No code gap.
- **Assumptions and unknowns:**
  - Reverse proxy adds TLS but **whether it adds security headers / rate limiting is unverified** (no proxy config in repo) — see X1.
  - Appwrite console-level settings (auth provider toggles, session duration, MFA, captcha, platform allowlists) **not readable** via the MCP API key (missing `project.read` scope) — see manual checklist in Risk Assessment.
  - `pnpm typecheck` not run by sub-agents (node_modules unavailable in their sandboxes); A1's TS2554 sub-claim unverified.
  - Next.js action-ID discovery difficulty: S1 confirmed exploitable in Next 15.3/15.5 because these actions are form-bound (IDs ship in public client chunks) and action encryption is absent.

---

## SSC Intent Check

- **Feature Intent line:** n/a (ad-hoc whole-app scope, anchor "safe to expose publicly")
- **Intent served?** No — the app is **not yet safe for public internet exposure** (S1, D1).
- **Notes:** No spec drift from Stage 14/15 pins found (reader/admin nav split present as pinned; issue metadata/redraft intact). The security posture gaps are cumulative omissions across stages, not drift from any single Intent.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [x] S1-20260917: 16 admin server actions have no authentication check — unauthenticated full admin takeover

| Field | Value |
|---|---|
| **ID** | `S1-20260917` |
| **Severity** | **Blocker** |
| **Category** | Security |
| **Location** | `web/app/(protected)/admin/runs/actions.ts:14-67`; `web/app/(protected)/admin/feeds/actions.ts:33-112`; `web/app/(protected)/admin/settings/actions.ts:114-241`; `web/app/(protected)/admin/schedules/actions.ts:19-48` |
| **Description** | Sixteen exported server actions across four modules perform no authentication check: `retryFailedRun`, `regenerateDraft`, `updateRunRetentionSetting`, `purgeRunsNow` (runs); `createFeedAction`, `updateFeedAction`, `deleteFeedAction`, `testFeed` (feeds); `saveConnectionsSettingsAction`, `savePipelineKnobsSettingsAction`, `clearOpenRouterOverrideAction`, `clearSmtpOverrideAction`, `testOpenRouterConnectionAction`, `testSmtpConnectionAction`, `checkPublicUrlAction` (settings); `updateNewsletterScheduleAction` (schedules). None call `getAuthenticatedUser()`, unlike the gated sibling modules (`issues/actions.ts:27,48`; `admin/newsletters/actions.ts:82,127,277,296,313,327`; `admin/prompts/actions.ts:54,78,102`). All run against `getServerAppwrite()` — the `APPWRITE_API_KEY` client with full access to the locked-down tables. In Next.js App Router a server action is invoked by POST with a `Next-Action` header, resolved from the actions manifest **not** the page layout, so the authoritative `getAuthenticatedUser()` in `(protected)/layout.tsx:12` never runs. Public paths (`/login`, `/health`, `/build-id`) pass middleware via `isPublicRoute` (`web/lib/auth/routes.ts:1-13`); `/admin/*` needs only any non-empty `a_session_*` cookie (S2). These actions are form-bound, so their IDs ship in public client chunks under `/_next/static`; action encryption is not enabled. |
| **Risk / Impact** | Unauthenticated remote attacker on the public internet gains full administrative control: purge/delete all runs, mass data loss via retention=1, burn OpenRouter credits, overwrite/clear stored OpenRouter key and SMTP credentials, repoint SMTP to an attacker host (capture outbound newsletter email), toggle arbitrary schedules. |
| **Evidence** | `runs/actions.ts:14-20` `retryFailedRun` calls `requestFailedRunRetry(getServerAppwrite(), runId)` — no `getAuthenticatedUser()` anywhere in the file. Same shape in feeds/settings/schedules actions. Validator re-opened all four files and confirmed the count (16) and the absence of any gate. |
| **Recommendation** | Add a shared `requireUser()` guard (wrapping `getAuthenticatedUser()`, failing closed) as the first statement of every exported action in all four modules, mirroring issues/newsletters/prompts. Add an architectural test that imports every `web/app/**/actions.ts` module and asserts every exported async function rejects an unauthenticated caller; wire into `pnpm test`. Optionally gate `/build-id` behind auth to blunt action-ID discovery. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Integration: POST to `/login` and `/admin/runs` with `Next-Action` set to each ungated action's ID, with no cookie and with fabricated `a_session_x=garbage` — assert 401/no-op for every action. Arch test: mock `getAuthenticatedUser` → null and assert fixed auth error from every `"use server"` export. |
| **Acceptance Criteria** | Every exported server action in `web/app/**/actions.ts` fails closed when `getAuthenticatedUser()` returns null, verified by test; no `"use server"` export lacks the guard; the arch test runs in default `pnpm test`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Re-opened all four modules (16 exports, none gated); Next 15 resolves actions via POST+`Next-Action` independent of layout rendering; counterexamples (Origin checks, encrypted action IDs, layout gating) fail — encryption is opt-in and absent, side effects complete before any redirect. |

---

### [x] S10-20260917: SSRF guard never enforced at fetch time — worker is an intranet HTTP client for feed-controlled URLs

| Field | Value |
|---|---|
| **ID** | `S10-20260917` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `shared/src/pipeline/fetch-safety.ts:9-13`; `shared/src/pipeline/scraper.ts:186-198`; `shared/src/pipeline/rss-fetcher.ts:113-116`; `shared/src/feeds/ssrf.ts:241-246` |
| **Description** | The only routability gate (`isPubliclyRoutableUrl` — blocks private/loopback/link-local IPv4+IPv6 incl. mapped forms) runs **only** on operator-entered feed URLs at create/update/test time. The actual pipeline fetchers (rss-fetcher, scraper) use `fetchWithSizeLimit`/`assertSafeFetchUrl`, which by documented design performs no IP checks ("private/loopback/link-local IPs are intentionally NOT blocked"). Article URLs scraped by the worker come from RSS `<link>` fields — attacker-influenced feed content, not operator input — and are fetched with zero private-IP restrictions. Additionally the validation-time gate resolves DNS once and discards the result while the fetch re-resolves independently (DNS-rebinding TOCTOU). Redirects are fully blocked (`redirect: "error"`, fetch-safety.ts:135-138) — the one mitigation that holds. |
| **Risk / Impact** | A malicious feed (or a compromised account, chaining S1) can make the worker issue blind GETs against internal services: Appwrite itself (internal, network-trusted), the reverse-proxy admin interface, docker-network services, and `169.254.169.254`-style metadata endpoints. Worker becomes an SSRF pivot into the LAN. |
| **Evidence** | `fetch-safety.ts:9-13` disclaimer comment; `:71` "No host/IP allowlist"; `scraper.ts:186-198` only `assertSafeFetchUrl`+`fetchWithSizeLimit`; `ssrf.ts:241-245` resolves-and-discards. |
| **Recommendation** | Enforce a fetch-time routability check inside `fetchWithSizeLimit` (or a wrapper used by both fetchers), at minimum for article-link fetches: resolve the hostname and pin the connection to the validated IP (custom undici Agent/dispatcher or lookup+connect-by-IP with Host header), rejecting private/loopback/link-local/metadata targets. Keep operator internal-feed fetch possible behind an explicit opt-in env (e.g. `ALLOW_PRIVATE_FEED_FETCH=1`). Block `169.254.169.254` and `metadata.google.internal` explicitly. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Feed fixture with item `<link>` = `http://127.0.0.1:8080/x`, `http://10.0.0.5/y`, `http://[::1]/z`, `http://[::ffff:10.0.0.5]/z`, `http://169.254.169.254/latest/meta-data` → scraper returns fallback with BlockedError-class diagnostic, no fetch issued. Rebinding test: resolver mock returns public IP on first lookup, private on second → pinned connection still refuses. |
| **Acceptance Criteria** | Scrape/RSS fetch of any URL whose effective connection target resolves to private/loopback/link-local/metadata space is refused (structured error) unless explicit operator opt-in is set; DNS answers at fetch time are re-validated; regression suite covers IPv4, IPv6, mapped IPv6, NAT64/6to4, and rebinding sequences. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Comments and call sites verified; article links from RSS content reach internal endpoints with no fetch-time check, and feed content is attacker-influenced without operator compromise; redirect blocking confirmed as the sole compensating control. |

---

### [x] C2-20260917: No crash recovery for stuck "running" runs — one hard worker kill permanently halts a newsletter

| Field | Value |
|---|---|
| **ID** | `C2-20260917` |
| **Severity** | High |
| **Category** | Correctness & Reliability |
| **Location** | `worker/src/run-poller.ts:21-34,125`; `worker/src/index.ts:181-184,203-214`; `shared/src/runs/execute-run.ts:893-896` |
| **Description** | `shouldClaim` refuses any run for a newsletter while another run of that newsletter has status `"running"` (run-poller.ts:24). If the worker dies hard mid-run (SIGKILL, OOM, power loss) — where the graceful SIGTERM/SIGINT shutdown never runs — or `executeRun`'s own `markFailed` fails (conceded in code comment: "stale-run sweep is a future improvement"), the run stays `"running"` forever and permanently blocks every future run for that newsletter. The heartbeat (index.ts:181-184) is log-only; no component sweeps stale runs. Graceful shutdown also mislabels the failure phase as `"fetch"` regardless of actual progress (run-poller.ts:125). `start.ts`'s race cleanup cannot rescue this — `findActiveRunForNewsletter` returns the stuck run so every new enqueue is rejected. |
| **Risk / Impact** | One unclean worker death silently halts newsletter generation for the affected newsletter until an operator manually edits the run document — recurring availability failure for an unattended public service. |
| **Evidence** | `run-poller.ts:24` `if (other.status === "running") return false;`; `index.ts:181-184` heartbeat logs only; `execute-run.ts:893-896` comment concedes the block. |
| **Recommendation** | Add a stale-run reaper: persist `lastHeartbeatAt` (or reuse `$updatedAt`) on the run document, heartbeat it while executing, and mark runs `failed` (with the true persisted `currentPhase`, not hardcoded `"fetch"`) when the heartbeat exceeds a timeout. Run the sweep at worker boot and periodically. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Integration: create a run with status `running` and stale heartbeat; start worker → run marked failed with crash-recovery message; a subsequent pending run for the same newsletter is claimed. Unit: shutdown mid-run marks failed with the persisted current phase. |
| **Acceptance Criteria** | A run left `running` with an expired heartbeat auto-transitions to `failed` within one sweep interval; the newsletter's next pending run executes without manual intervention; failure records identify the true in-flight phase. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Control flow verified end-to-end including start.ts enqueue rejection; no sweep exists; log-only heartbeat confirmed. |

---

### [x] D1-20260917: 30 known vulnerabilities in web prod tree — incl. 2 critical unauth RCE in Next.js (<15.5.24) (repo-level; GHCR image rebuild rides the stage-end release)

| Field | Value |
|---|---|
| **ID** | `D1-20260917` |
| **Severity** | High |
| **Category** | Dependencies |
| **Location** | `web/package.json:20` (`next ^15.3.4`, lockfile resolves 15.5.19); `pnpm-lock.yaml` |
| **Description** | `pnpm audit --prod` reports 30 vulnerabilities (1 low / 15 moderate / 12 high / 2 critical) in the web production tree — the only publicly exposed service. Worst: **two CRITICAL unauthenticated RCE advisories in Next.js <15.5.24** (Image Optimization API AVIF variant — applies to Linux containers; windows-hosted variant moot here), plus HIGH SSRF via rewrites (<15.5.21), Server Actions DoS/SSRF, and moderate cache-confusion / Server-Function endpoint disclosure. Secondary: nodemailer (D2), sanitize-html (S13), undici/postcss/sharp/browserslists advisories. |
| **Risk / Impact** | Unauthenticated remote code execution and SSRF on the internet-facing container — full compromise of the web tier including its `APPWRITE_API_KEY` and GUI-stored secrets, bypassing the reverse proxy. |
| **Evidence** | Audit re-run by validator: exactly 30 vulns; lockfile resolves next 15.5.19 < 15.5.24. |
| **Recommendation** | Upgrade `next` to ≥15.5.24 (latest 15.x), refresh the lockfile, rebuild and redeploy both GHCR images; adopt `pnpm audit --prod` as a CI gate (none exists today — only a release workflow). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `pnpm audit --prod` exits clean for next critical/high; web build + `pnpm typecheck`/`lint`/`test` pass on the bumped version. |
| **Acceptance Criteria** | Lockfile resolves next ≥15.5.24; no Next.js critical/high advisories in `pnpm audit --prod`; images rebuilt from updated lockfile; audit gate in CI. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Audit re-run reproduced the counts and versions; windows-RCE moot on Linux but AVIF RCE and high-severity items apply to the internet-facing tier. |

---

### [x] S2-20260917: Middleware auth gate is cookie-presence-only (fabricated `a_session_*` passes)

| Field | Value |
|---|---|
| **ID** | `S2-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/middleware.ts:5-12,22-26` |
| **Description** | The edge gate only checks that some cookie named `a_session_*` has a non-empty value; any fabricated value (e.g. `a_session_x=1`) passes. It never validates the session against Appwrite. Pages are safe today because `(protected)/layout.tsx:12` and the export route re-validate authoritatively (`session.ts:67-86`), but middleware is the only gate for S1's ungated actions and would be silently relied upon by any future route that omits a per-route check. |
| **Risk / Impact** | Defense-in-depth gap: invalid-session requests pass the edge; whether they're stopped depends on every downstream consumer remembering to re-check (S1 shows four modules forgot). |
| **Evidence** | `middleware.ts:6-11` presence check only; real validation in `web/lib/auth/session.ts:67-86`. |
| **Recommendation** | Keep middleware purely as a UX redirect and document (comment + AGENTS.md) that it is NOT an auth boundary; make per-action/per-route `getAuthenticatedUser()` the enforced standard (S1 fix + arch test). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | With `a_session_fake=garbage`: protected page still ends at /login (layout check); every action fails closed (S1 fix). |
| **Acceptance Criteria** | A fabricated session cookie grants access to zero pages (beyond login redirect) and zero actions; middleware comment states it is redirect-only. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Presence-only loop verified; authoritative validation location confirmed. |

---

### [x] S3-20260917: Public RSS route — unvalidated newsletterId, raw error body to anonymous clients, no cache headers

| Field | Value |
|---|---|
| **ID** | `S3-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/app/rss/[newsletterId]/route.ts:18-29,40-48` |
| **Description** | The intentionally public RSS handler passes the raw `newsletterId` path segment into the API-key-backed `getNewsletter` with no format validation — while the reader channel page validates the same kind of ID via `isSafeNewsletterId` (`web/lib/newsletter-id.ts:5-8`). On `AppPublicUrlError` the raw exception message is returned in the 500 body to anonymous clients; the 200 sets no `Cache-Control`. Core design is sound: newsletter `$id`s are `ID.unique()` random values (capability URLs), and only `rss_publications` snapshots are served — unpublished drafts cannot leak. |
| **Risk / Impact** | Arbitrary unvalidated input reaching an API-key-backed document read on an unauthenticated route (Appwrite rejects malformed IDs — impact contained); deployment/config detail leaked to anonymous users on misconfiguration. |
| **Evidence** | `route.ts:23` passes `newsletterId` unchecked; `:44-46` returns `err.message` with 500. |
| **Recommendation** | Reject non-conforming IDs with 404 via `isSafeNewsletterId`; return a fixed generic body on `AppPublicUrlError` (log detail server-side); add `Cache-Control` (e.g. `public, max-age=300`). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `GET /rss/<bad%2Fid>`, `/rss/../etc`, `/rss/<600-char id>` → 404/400 without hitting Appwrite; unset `appPublicUrl` → 500 with fixed message; response carries Cache-Control. |
| **Acceptance Criteria** | RSS route validates the ID, returns only fixed error strings, sets cache headers; published-only snapshot content unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Unchecked pass-through, raw error body, and missing header all verified; ID.unique() capability-URL design confirmed as the containing factor. |

---

### [x] S4-20260917: Operator secrets stored as plaintext columns in app_settings

| Field | Value |
|---|---|
| **ID** | `S4-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/schema/declarations.ts:292-298` |
| **Description** | `openRouterApiKey` and `smtpHost/Port/Username/Password/From` are declared and stored as plaintext string attributes in `app_settings` (live DB confirms `encrypt: false`, `$permissions: []`). Any server code holding `APPWRITE_API_KEY`, a DB dump/backup, or a future read-path regression exposes the paid LLM key and SMTP credentials in cleartext. Mitigating: Appwrite internal-only; web app sole public surface. |
| **Risk / Impact** | Secrets-at-rest exposure via Appwrite host compromise, backup leak, or future read-path regression. Combined with S1, an unauthenticated actor can already overwrite/clear these values today. |
| **Evidence** | `declarations.ts:292` `openRouterApiKey` string 512; `:296` `smtpPassword` string; settings actions read/write verbatim (write path masks empties via `mergeSecretKeep`, storage is cleartext). |
| **Recommendation** | Prefer env/container-only secrets for machine credentials (drop GUI override), or encrypt `openRouterApiKey`/`smtpPassword` at rest with a key held only in server env (encrypt on write, decrypt only at use sites). Never serialize raw secret values into RSC payloads. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Round-trip stores ciphertext (attribute ≠ plaintext); `resolveOperatorSettings` returns plaintext only to server call sites; settings RSC payload contains no substring of stored key/password. |
| **Acceptance Criteria** | No plaintext API key or SMTP password retrievable from any `app_settings` dump; masked-edit flow still works; documented fallback to env-only. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Declarations (provisioning source of truth) verified as plaintext strings with empty permissions; live schema corroborates. |

---

### [x] S5-20260917: No reader/admin authorization boundary — any invited account is a full operator

| Field | Value |
|---|---|
| **ID** | `S5-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/app/(protected)/layout.tsx:11-15`; `web/app/(protected)/admin/page.tsx:52`; `web/app/api/issues/[runId]/export/route.ts:28-31` |
| **Description** | No role/team/label authorization exists anywhere: the protected layout checks authentication only, and every admin page/action plus the export API is reachable by any valid session user. Reader vs admin surfaces differ only in navigation. Matches the current 1-user household model and the Stage 14 nav-split spec (not drift) — but the exposure model is "invite-only household accounts" (plural), and nothing distinguishes operator from invited reader. |
| **Risk / Impact** | The moment a second, non-operator household member is invited, that account has full factory control: purge runs, edit prompts, change SMTP/OpenRouter settings, export all issues. Export route: any authenticated user can export any `runId` (IDOR becomes real with two users). |
| **Evidence** | `(protected)/layout.tsx:12-15` auth-only; grep across `web/lib` + `web/app` finds no team/role/label check; export route checks authentication only. |
| **Recommendation** | Pin the trust model explicitly before the first non-operator invite: either document "every invited account is a full operator" in PRODUCT/Plan, or add an Appwrite team/label check (e.g. membership in an `operators` team) enforced in `requireUser()` for /admin routes, admin actions, and the export route. (Note: Stage 16 "household-roles" is already pending in the plan — this finding feeds it.) |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | If RBAC: non-operator user hitting /admin pages, admin actions, export → 403/redirect; operator unaffected. If documented: PRODUCT.md carries the flat-trust decision. |
| **Acceptance Criteria** | Reader-vs-admin trust boundary enforced (role check on all admin surfaces) or explicitly documented as intentionally flat in a durable `.ssc` artifact. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | No authorization construct found anywhere in web; single-user mitigation verified. |

---

### [x] S6-20260917: Settings layer API forces plaintext secrets through the action boundary (latent)

| Field | Value |
|---|---|
| **ID** | `S6-20260917` |
| **Severity** | Medium *(validator downgraded from High)* |
| **Category** | Security |
| **Location** | `shared/src/settings/repository.ts:186-218,225-258,347-393`; `shared/src/settings/operator-settings.ts:88-104,218-235` |
| **Description** | Every settings read/write returns the full object including plaintext `openRouterApiKey`/`smtpPassword` (`documentToSettings` maps them unchecked at :195; `updateOperatorSettings` returns the full view at :381-388). There is no keep-sentinel: empty string means CLEAR, so a settings save requires the action to read stored plaintext secrets and resend them (read-modify-write confirmed by `web/src/__tests__/settings-actions.test.ts:145`). Today the settings page DTO strips the secret fields and actions return only `{ok}` envelopes — no plaintext crosses to the browser — so this is a latent design hazard, not a live leak. |
| **Risk / Impact** | A single regression (an action returning `AppSettings`, logging the merge payload) ships the live OpenRouter key / SMTP password to the browser or logs. |
| **Evidence** | `repository.ts:195` unchecked map; `operator-settings.ts:94` empty→clear (no keep sentinel); test at :145 proves the read-modify-write. |
| **Recommendation** | Split the repository API: a `PublicAppSettings` type omitting/masking secrets for GUI reads; a secret-write-only path accepting a new value or an explicit `"keep"` sentinel so actions never read/resend stored secrets; return the public view from secret writes. |
| **Effort** | M |
| **Confidence** | Medium |
| **Suggested Tests** | Sentinel save preserves stored key without resending; `getOrCreateAppSettings` returns masked view; snapshot-assert serialized return values contain no secret values. |
| **Acceptance Criteria** | No shared settings function returns plaintext secrets to GUI callers; a save never requires reading/resending stored secrets; web settings tests updated to the sentinel path. |
| **Validation Decision** | Confirmed (severity High → Medium) |
| **Validation Rationale** | Layer behavior verified, but every current consumer masks or discards the secret fields (test-asserted), so exposure requires a future regression — latent hazard, Medium. |

---

### [x] S7-20260917: No `server-only` guard on the API-key client — key safety is incidental

| Field | Value |
|---|---|
| **ID** | `S7-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/appwrite/server.ts:1-14`; `shared/src/appwrite/config.ts:14-45` |
| **Description** | The API-key-backed client factory and config module carry no `import "server-only"` guard (zero usage in `shared/`). Nothing structurally prevents a client component importing `getServerAppwrite()`/`getAppwriteConfig()`. Today the dynamic `process.env[name]` access means the key resolves `undefined` in a browser bundle (no current leak) — but that safety is incidental: a refactor to static `process.env.APPWRITE_API_KEY` would silently inline the key into the public bundle. |
| **Risk / Impact** | Security control by convention rather than build failure; a one-line refactor ships `APPWRITE_API_KEY` to every browser. |
| **Evidence** | `server.ts:6-14` no server-only import; `config.ts:32` `readRuntimeEnv("APPWRITE_API_KEY")`; `shared/src/client.ts` barrel has no boundary marker. |
| **Recommendation** | Add `import "server-only"` to `server.ts` and `config.ts`; add the `server-only` package to shared's deps so any client-graph import fails the build. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | A client component importing `getServerAppwrite` must fail `next build`; production client bundle contains no `APPWRITE_API_KEY` string. |
| **Acceptance Criteria** | Client-graph import of the server modules fails the build; client bundle grep clean. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Zero server-only usage verified; dynamic-env incidental safety verified. |

---

### [x] S8-20260917: Redaction is opt-in per call site — health/qualify/markFailed paths log and persist raw error text

| Field | Value |
|---|---|
| **ID** | `S8-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/health/check.ts:41-53,79-87,108-116,151-160`; `shared/src/feeds/qualify.ts:31-36,84-88`; `shared/src/runs/repository.ts:453-465` |
| **Description** | (1) `health/check.ts` logs raw Appwrite exception messages via `console.error` and returns them verbatim in `HealthStepResult.errorMessage` for GUI rendering (the file's own TODO at :41-44 concedes `sanitizeAppwriteMessageForLog` is not applied). (2) `feeds/qualify.ts` logs `errorMessage`/`scrapeError` unsanitized and unbounded. (3) `runs/repository.ts markFailed` slices `failureMessage` to 2000 chars without calling `redactMessageForStorage` — redaction is only enforced at call sites (`execute-run.ts:891`, `phase-failure-summary.ts`), so any future caller persists raw error text onto run documents displayed in the GUI. |
| **Risk / Impact** | Upstream error messages (Appwrite HTTP errors, feed servers, OpenRouter error bodies echoed by pipeline stages) can reach container logs, the health page, and run documents without token scrubbing. |
| **Evidence** | `check.ts:80` raw `console.error({phase, code, message})`; `qualify.ts:35` no sanitize/bound; `repository.ts:460` `slice(0, FAILURE_MESSAGE_MAX)` without redaction. |
| **Recommendation** | Route health messages through `sanitizeAppwriteMessageForLog` for the log field (bounded redacted copy for UI); sanitize+bound qualify failure messages; apply `redactMessageForStorage` **inside** `markFailed` so persisted text is redacted regardless of caller; remove the TODO. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `markFailed` with a message containing `sk-or-v1-<64hex>` stores `[redacted]`; health check with an `AppwriteException` embedding a bearer token logs/returns no token; qualify failure log is bounded and redacted. |
| **Acceptance Criteria** | No `console.error` or persisted `errorMessage` in these files bypasses the redactors. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | All three gaps verified in current code; some current callers pass static strings so realized exposure is narrow but structural. |

---

### [x] S9-20260917: Document IDs and pagination limits unvalidated against the API-key-backed client

| Field | Value |
|---|---|
| **ID** | `S9-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/runs/repository.ts:179-194,1152-1194`; `shared/src/newsletters/repository.ts:159-174,403-445`; `shared/src/feeds/repository.ts:255-270`; `shared/src/runs/repository.ts:249-343,1204-1233` |
| **Description** | `getRun`/`deleteRun`/`getNewsletter`/`deleteNewsletter`/`getFeed` interpolate caller-supplied ids into API-key-backed calls with no format validation; `listRuns`/`listPendingRuns`/`listAllRuns` forward caller-supplied `limit` to `Query.limit` unchecked. Query values are SDK-encoded (no query-string injection), but ids containing `/`, `..`, `?` are not rejected before REST-path interpolation by node-appwrite. Mitigated today by invite-only auth + internal Appwrite. |
| **Risk / Impact** | A hostile/buggy action can direct the privileged client at arbitrary path segments (`runId='../../users/...'` → path confusion against internal Appwrite) or force oversized scans. |
| **Evidence** | `repository.ts:185` `documentId: runId` unvalidated; `:284` limit forwarded unchecked; no shared id-validation helper exists. |
| **Recommendation** | Add shared `assertAppwriteDocumentId(id)` (non-empty, max length, charset `[A-Za-z0-9_-]`) in all get/delete paths; clamp limits to a max at the repository boundary. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Get/delete reject ids containing `/`, `..`, `?`, or over-length before any SDK call; `listRuns` clamps limit > MAX. |
| **Acceptance Criteria** | All document-id parameters pass a single validated gate; all limits clamped; rejection tests pass. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Unvalidated interpolation verified at every cited site; whether node-appwrite URL-encodes path segments is unconfirmed, so path confusion is plausible not proven — consistent with Medium. |

---

### [x] S11-20260917: SSRF gate fails open on DNS errors; NAT64/6to4 ranges unlisted

| Field | Value |
|---|---|
| **ID** | `S11-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/feeds/ssrf.ts:234-239,112-120` |
| **Description** | `isPubliclyRoutableUrl` returns `{ok: true}` when DNS resolution throws (fail-open), accepting the URL. The IPv6 blocklist blocks `::1`, `::`, `100::/64`, `2001:db8::/32`, `fc00::/7`, `fe80::/10`, `ff00::/8` and unwraps `::ffff:0:0/96` + `::/96` mapped IPv4 — but omits `64:ff9b::/96` (NAT64) and `2002::/16` (6to4), which encode arbitrary IPv4 (incl. RFC1918) reachable on dual-stack networks. |
| **Risk / Impact** | Combined with S10's fetch-time absence and rebinding, the qualification gate can be made to pass for hostnames resolving to internal addresses at fetch time. |
| **Evidence** | `ssrf.ts:236-239` `catch { return { ok: true }; }`; `IPV6_BLOCKED` contents at :112-120. |
| **Recommendation** | Fail closed on resolver error (`ok:false, reason:'host-unresolvable'`); add `64:ff9b::/96` and `2002::/16` with embedded-IPv4 extraction applied to them. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Resolver mock that throws → `ok:false`; `64:ff9b::0:0:7f00:1` and `2002:0a00:0005::` → blocked; existing mapped-form cases remain blocked. |
| **Acceptance Criteria** | Fail-closed on resolution error; NAT64/6to4 encodings of every blocked IPv4 range evaluate blocked; existing routability tests pass. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Fail-open catch and blocklist contents verified verbatim. |

---

### [x] S12-20260917: Drafter output persisted with no storage-side sanitization or size bound

| Field | Value |
|---|---|
| **ID** | `S12-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/pipeline/drafter.ts:144-151,224-232` |
| **Description** | The drafter prompt embeds full untrusted scraped article content; the returned markdown is persisted as the issue body unchanged — no raw-HTML/scheme stripping, no control-character scrubbing, no size bound. Issue title/dek are strictly parsed and hard-sliced (`issue-metadata.ts:92-108`); the body has no equivalent gate. Rendering-side sanitizers exist today (sanitize-html for email/RSS/export; react-markdown safe transform in GUI), so this is a defense-in-depth storage gap. |
| **Risk / Impact** | Attacker-influenced markup (via prompt injection through a malicious article) becomes durable stored content flowing to three rendering channels; any future renderer regression has no storage-side backstop. |
| **Evidence** | `drafter.ts:147` `content: a.content`; `:226` `markdown: content` with only an emptiness check; no sanitize/truncate call anywhere in the path. |
| **Recommendation** | Storage-side normalization: strip control chars (except \n\t) and null bytes; drop raw inline HTML (or allowlist); validate link schemes to http(s); hard character cap sized to the attribute limit, before persistence. |
| **Effort** | M |
| **Confidence** | Medium |
| **Suggested Tests** | Mock client returning markdown with `<script>`, `[x](javascript:alert(1))`, tracking pixel, `\x00` bytes → stored markdown sanitized/capped; long output hits the hard cap. |
| **Acceptance Criteria** | No raw HTML/script tags, non-http(s) schemes, or control/null bytes survive into persisted issue markdown; length bounded by an explicit constant. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Verbatim persistence verified; rendering-side mitigations confirmed present (accurately framed as defense-in-depth). |

---

### [x] S13-20260917: sanitize-html 2.17.6 — known stored-XSS advisory (the single XSS boundary for 3 channels)

| Field | Value |
|---|---|
| **ID** | `S13-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/package.json:38`; `shared/src/delivery/email-body.ts:15-75` |
| **Description** | `sanitize-html ^2.17.6` (lockfile resolves 2.17.6) carries a known stored-XSS advisory (SVG SMIL URI-list scheme-policy bypass; patched in 2.17.7). This library is the single XSS boundary between untrusted drafts and email HTML, the public RSS `htmlBody`, and the HTML export (`email-body.ts:75` is the sole `sanitizeHtml` call). No confirmed exploit through the current allowlist (no svg tags; schemes restricted to http/https/mailto). |
| **Risk / Impact** | If a future allowlist change (e.g. adding svg/math tags) meets the known bypass, scraped-content-driven script/scheme injection flows into inboxes and the public feed. |
| **Evidence** | `pnpm audit --prod`: MODERATE sanitize-html `>=1.9.0 <=2.17.6 → >=2.17.7`. |
| **Recommendation** | Bump to ≥2.17.7 (patch, no API change), refresh lockfile, rebuild images; add a test asserting `javascript:`/`data:` URLs, `<script>`, `onerror` stripped from `draftMarkdownToEmailHtml` output. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Sanitizer unit test above; audit clean for sanitize-html. |
| **Acceptance Criteria** | `pnpm audit --prod` no longer lists sanitize-html; existing sanitization tests pass unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Advisory and lockfile version re-verified via audit re-run; no current-exploit claim checked against the allowlist. |

---

### [x] S14-20260917: Remote images and unrestricted links from untrusted drafts reach emails, RSS, and reader

| Field | Value |
|---|---|
| **ID** | `S14-20260917` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `shared/src/delivery/email-body.ts:45,54-57`; `shared/src/delivery/send-issue-email.ts:135-142`; `web/components/issues/issue-markdown.tsx:32` |
| **Description** | The email/RSS allowlist keeps remote http/https `<img>` and unrestricted `<a href>` from untrusted draft markdown. Scraped/injected image URLs and links flow into branded emails under the operator's From identity (no `rel=nofollow`), the public RSS `htmlBody`, and the GUI reader (react-markdown is safe against raw HTML/URL schemes, but remote images pass). |
| **Risk / Impact** | A malicious source article can make every subscriber's mail client and every reader's browser fetch attacker-controlled URLs (IP/device fingerprinting, open-rate tracking) and place attacker-chosen anchor text/links inside a trusted branded newsletter — phishing aid. |
| **Evidence** | `email-body.ts:49,55-57` img src from any http/https origin, no rel injection; `send-issue-email.ts:135-142` sends to `bcc: recipientEmails`. |
| **Recommendation** | Decide channel policy: strip or domain-allowlist `<img>` in `EMAIL_HTML_SANITIZE_OPTIONS`; add `rel="nofollow noreferrer"` to emitted `<a>`; consider an origin policy for reader images; document the decision in SECURITY.md. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `draftMarkdownToEmailHtml('![p](https://evil.test/p.gif)')` has no `<img>` under the chosen policy; `<a>` carries `rel="nofollow noreferrer"`; reader issues no remote image requests under policy. |
| **Acceptance Criteria** | Remote-content policy implemented and tested for email, RSS, and reader; documented in SECURITY.md. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Allowlist options and send path verified; GUI reader image pass-through confirmed. |

---

### [x] D2-20260917: nodemailer <9.1.1 — DoS + recipient-domain bypass advisories

| Field | Value |
|---|---|
| **ID** | `D2-20260917` |
| **Severity** | Medium |
| **Category** | Dependencies |
| **Location** | `shared/package.json:37` (`nodemailer ^9.0.3`, lockfile 9.0.3) |
| **Description** | HIGH quadratic-time addressparser DoS (<9.1.0), plus moderates: RFC 5322 comment mis-parse recipient-domain validation bypass, IDN/punycode allow-list bypass (mail delivered to attacker-controlled domain), `resolveContent()` disableFileAccess bypass (<9.1.1). Inputs are operator-supplied, so paths are indirect. |
| **Risk / Impact** | A hostile/compromised settings row or a very large recipient list could DoS the worker or mis-route mail. |
| **Evidence** | `pnpm audit --prod` re-run confirms all three advisories. |
| **Recommendation** | Bump to ≥9.1.1 alongside the Next.js upgrade (same maintenance pass). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Existing send-issue-email tests pass on ≥9.1.1; audit clean for nodemailer. |
| **Acceptance Criteria** | Lockfile resolves nodemailer ≥9.1.1; audit clean; email path regression-tested. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Advisories and pinned version re-verified via audit. |

---

### [x] C1-20260917: deleteFeed attached-guard reads only the first 100 junction rows

| Field | Value |
|---|---|
| **ID** | `C1-20260917` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/feeds/repository.ts:219-253` |
| **Description** | `deleteFeed`'s attached-guard lists one page (`Query.limit(FEED_LIST_LIMIT)` = 100, no pagination) and checks `some()` on that page. Beyond 100 junction documents, a target feed's junction on page 2 → guard passes → feed deleted while junction rows remain — producing the orphan-attachment state `listAttachmentsForNewsletter` silently drops. `deleteNewsletter`'s cascade (`newsletters/repository.ts:409-425`) demonstrates the correct paginated pattern. |
| **Risk / Impact** | Silent referential-integrity break at >100 junction rows; newsletters keep phantom attachments that vanish from the UI; run building loses the feed. Unlikely at current scale. |
| **Evidence** | `feeds/repository.ts:226` single-page limit; `:229-231` in-memory `some()`. |
| **Recommendation** | Page the attached-check loop like `deleteNewsletter`, or filter server-side with `Query.equal("feedId", feedId)` (cap moot). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | 150 junction fixtures with target feedId on page 2 → `deleteFeed` throws 'attached' instead of deleting. |
| **Acceptance Criteria** | `deleteFeed` reliably rejects deletion when any junction (not just first 100) references the feed, verified by a >100-junction test. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Single-page guard and paginated counterexample verified. |

---

### [ ] C3-20260917: Run claiming is check-then-act — no atomic pending→running transition

| Field | Value |
|---|---|
| **ID** | `C3-20260917` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `worker/src/run-poller.ts:58-98` |
| **Description** | `tick()` lists pending runs, lists active runs, evaluates `shouldClaim`, then executes — nothing atomically flips the run to `running` before execution (the transition happens later inside `executeRun`). Two worker processes can both observe the same pending candidate and both execute it: duplicate issues, double LLM spend. Single-worker assumption is documented only in `feeds/health.ts:57-65` for an unrelated counter; nothing enforces single instance. |
| **Risk / Impact** | Silent double-execution and duplicate deliveries the moment a second worker replica exists; latent footgun today (one container in compose.yaml). |
| **Evidence** | `run-poller.ts:60-90` sequence with no CAS/lease. |
| **Recommendation** | Make the claim atomic: pending→running via optimistic-concurrency update (compare `$updatedAt` from the read snapshot, retry on mismatch) or a leases collection with unique document id = runId; or assert single-instance at boot via a TTL lease and refuse to poll when held. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Deterministic interleaving test: two simulated pollers list-list-claim against a shared fake store → exactly one transitions, other skips. |
| **Acceptance Criteria** | Concurrent claim attempts of the same pending run result in exactly one executor; loser logs a skip. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | No CAS/lease anywhere in the path; single-container mitigation confirmed today. |

---

### [x] X1-20260917: No security headers configured (HSTS/CSP/XFO/nosniff/Referrer-Policy; X-Powered-By on)

| Field | Value |
|---|---|
| **ID** | `X1-20260917` |
| **Severity** | Medium |
| **Category** | Config/Infra/CI |
| **Location** | `web/next.config.mjs:28-59` |
| **Description** | No HSTS, CSP, X-Frame-Options/frame-ancestors, X-Content-Type-Options, or Referrer-Policy; `poweredByHeader` not disabled (Next default true). Only headers() entry is Content-Type/Cache-Control for `/sw.js`. The reverse proxy may add these — unverified (no proxy config in repo). |
| **Risk / Impact** | If the edge doesn't add them: login page and admin UI are frameable (clickjacking on destructive actions), no HSTS on first visits, no nosniff on RSS/export responses, `X-Powered-By` disclosure. |
| **Evidence** | `next.config.mjs:43-59` headers() returns only the `/sw.js` entry. |
| **Recommendation** | Verify at the proxy; regardless add defense-in-depth in next.config: HSTS `max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY` (or CSP frame-ancestors), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `poweredByHeader: false`; evaluate a CSP compatible with the PWA (service worker + styles). |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `curl -I` on `/`, `/login`, `/rss/<id>.xml`, `/api/...` asserting headers present and X-Powered-By absent — through the public proxy hostname to record what the edge adds. |
| **Acceptance Criteria** | All public responses carry HSTS, frame denial, nosniff, Referrer-Policy (app and/or verified proxy); X-Powered-By removed; CSP choice documented and tested against the PWA. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | No proxy config exists in-repo to prove edge coverage; conditional impact accurate. |

---

### [x] X4-20260917: compose publishes 0.0.0.0:3000 — plain-HTTP side door around the reverse proxy

| Field | Value |
|---|---|
| **ID** | `X4-20260917` |
| **Severity** | Medium |
| **Category** | Config/Infra/CI |
| **Location** | `compose.yaml:22-23` |
| **Description** | `ports: - "3000:3000"` with no host-IP prefix binds 0.0.0.0:3000 on the host. The exposure model is reverse-proxy+TLS only; this mapping makes plain-HTTP 3000 directly reachable on every host interface (LAN, and the public interface on a typical VPS), bypassing TLS termination and any proxy protections. Worker correctly publishes no ports. |
| **Risk / Impact** | Direct unencrypted access (session cookies over plain HTTP if a user hits :3000), no proxy headers/WAF, and a second undocumented public entry point. |
| **Evidence** | `compose.yaml:22-23`; DEPLOY.md contains no compensating firewall documentation. |
| **Recommendation** | Change to `127.0.0.1:3000:3000` (same-host proxy) or a dedicated proxy-network interface; document the firewall rule if loopback binding isn't used. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `ss -tlnp | grep 3000` shows 127.0.0.1 binding only; proxy URL still serves; external interface :3000 refuses. |
| **Acceptance Criteria** | Web bound to loopback (or documented private interface); DEPLOY.md states the proxy/firewall assumption. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Binding verified; no in-repo compensating control. |

---

### [x] A1-20260917: PipelineOptions.drafter.draft declares 4 params, invoked with 5 (audience)

| Field | Value |
|---|---|
| **ID** | `A1-20260917` |
| **Severity** | Medium |
| **Category** | API & Contracts |
| **Location** | `shared/src/pipeline/orchestrator.ts:45-52,278-284` |
| **Description** | `PipelineOptions.drafter.draft` is declared with four parameters but `runPipeline` invokes it with five (passes `config.audience`). The concrete `NewsletterDrafter.draft` accepts the fifth (`drafter.ts:121-127`), so the real path works — but a strictly-typed injected drafter silently drops audience, and the "no options bags are forwarded" comment (`:26-28`) is stale. TS2554-on-main sub-claim unverified (typecheck not runnable in sandbox). |
| **Risk / Impact** | Injected drafter implementations (tests, future alternatives) silently drop the audience field — newsletters with wrong audience framing. |
| **Evidence** | `orchestrator.ts:46-51` 4-param declaration; `:278-284` 5-arg call; `orchestrator.test.ts:249` asserts the 5th arg. |
| **Recommendation** | Add `audience: string` as the fifth parameter of the interface (or switch to an options object); update the stale comment; run `pnpm typecheck`. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Type-level test: a mock drafter declared with exactly `PipelineOptions` receives audience; existing orchestrator test :249 keeps passing. |
| **Acceptance Criteria** | Interface matches the actual call; `pnpm typecheck` passes. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Signature mismatch, concrete 5-param implementation, and stale comment all verified; compiler-error sub-claim remains unverified. |

---

### [x] P1-20260917: Drafter prompt embeds untruncated article content — multi-MB LLM prompts

| Field | Value |
|---|---|
| **ID** | `P1-20260917` |
| **Severity** | Medium |
| **Category** | Performance |
| **Location** | `shared/src/pipeline/drafter.ts:144-151` |
| **Description** | Tagger caps prompt content at 70k chars (`tagger.ts:174` `content.slice`), MMR embeds 1k chars — but the drafter's `articles_json` embeds `content: a.content` verbatim, bounded only by the 5MB fetch cap, across up to 16 articles. |
| **Risk / Impact** | LLM input blowout: runaway OpenRouter token cost per run and context-limit 4xx failures the retry policy refuses to retry; worker memory/serialization inflation. |
| **Evidence** | `drafter.ts:147` no slice; `config.ts:32` `DEFAULT_MAX_CONTENT_LENGTH` consumed only by the tagger. |
| **Recommendation** | Apply content truncation in the drafter payload (reuse `DEFAULT_MAX_CONTENT_LENGTH` or a drafter-specific cap sized to count × budget); note truncation in the prompt. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock client capturing the prompt: 200k-char article → rendered content capped; multi-article prompt under computed budget. |
| **Acceptance Criteria** | Each article's content contribution is capped by an explicit constant; total prompt bounded. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | No truncation anywhere in the drafter path; tagger precedent verified. |

---

### [x] X2-20260917: next.config.mjs loads repo-root .env into process.env (incl. APPWRITE_API_KEY) at config time

| Field | Value |
|---|---|
| **ID** | `X2-20260917` |
| **Severity** | Low (security misconfig — surfaced below floor) |
| **Category** | Config/Infra/CI |
| **Location** | `web/next.config.mjs:7-26` |
| **Description** | Config-time loader injects every key from repo-root `.env` (including `APPWRITE_API_KEY`) into `process.env` when undefined; silently swallows a missing file. Docker build-context exposure is already mitigated (`.dockerignore` excludes `.env*`); residual risk is host-side builds/logs and dev convenience. |
| **Risk / Impact** | Secret can leak via host build logs or a mis-copied `.env`; mechanism invisible to operators assuming env-only delivery. |
| **Evidence** | `next.config.mjs:8` readFileSync of `../.env`; `:22` sets `process.env[key]`. |
| **Recommendation** | Restrict the loader to explicitly non-secret keys, or drop it for `APPWRITE_API_KEY` (runtime container env is the intended pattern); keep `.env` out of build context and VCS. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | Build image with no `.env`, only container env → app boots (proves env-only delivery); layer scan shows no `.env`. |
| **Acceptance Criteria** | `APPWRITE_API_KEY` reaches the server exclusively via container env; loader (if retained) covers only non-secret keys. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Mechanism verified; `.dockerignore` counterexample found (already mitigated in Docker path) — Low is accurate. |

---

### [x] N1-20260917: No enforced convention for server-action authorization (S1's root cause)

| Field | Value |
|---|---|
| **ID** | `N1-20260917` |
| **Severity** | Low (anti-cheat — always surfaced) |
| **Category** | Anti-cheat |
| **Location** | `web/app/(protected)/admin/{runs,feeds,settings,schedules}/actions.ts:1` |
| **Description** | Pattern drift, not test fraud: no shared wrapper, lint rule, or architectural test enforces server-action authorization — 3 modules gate every action, 4 gate none. The middleware redirect (S2) makes the gap invisible in normal UI use: a broken security invariant that "appears to work." This is precisely how S1 survived three verification passes. |
| **Risk / Impact** | The authorization gap survived verification because correctness in the UI flow is indistinguishable from correctness under direct invocation; future action modules can repeat it silently. |
| **Evidence** | Gated: issues (2 sites), newsletters (6), prompts (3). Ungated: all 16 exports across the four files. |
| **Recommendation** | Extract `requireUser()` into `web/lib/auth`; add the architectural test (every `web/app/**/actions.ts` export rejects unauthenticated callers) wired into `pnpm test`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | The arch test itself. |
| **Acceptance Criteria** | Arch test in default `pnpm test`, covers every current and future `"use server"` module, fails on any ungated export. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Gating counts re-verified by grep; no enforcement mechanism exists. |

---

### [x] N2-20260917: Production test seam — resetConsumedScheduleFiresForTests in production module

| Field | Value |
|---|---|
| **ID** | `N2-20260917` |
| **Severity** | Low (anti-cheat — always surfaced) |
| **Category** | Anti-cheat |
| **Location** | `shared/src/newsletters/due-check.ts:62-68` |
| **Description** | Module-level mutable `defaultConsumedFires` Set plus exported `resetConsumedScheduleFiresForTests()` in production code; the `opts.consumedFires` injection point already exists (:55/:224). |
| **Risk / Impact** | Test isolation risk (tests coupled to module state); production-code test seam. No runtime security impact. |
| **Evidence** | `due-check.ts:63` Set; `:66-68` exported reset. |
| **Recommendation** | Guard the reset behind `process.env.VITEST` or a factory; require tests to inject `consumedFires`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Due-check tests pass using injected ledgers only; no `*ForTests` export in production build. |
| **Acceptance Criteria** | No `*ForTests` export in shared production modules. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Seam verified; injection point exists, so it's hygiene not fraud — Low fits. |

---

### [x] N3-20260917: Dead/masking code on Appwrite-adjacent paths (dead branch, void-suppressed read, 8× duplicated helper)

| Field | Value |
|---|---|
| **ID** | `N3-20260917` |
| **Severity** | Low (anti-cheat — always surfaced) |
| **Category** | Anti-cheat |
| **Location** | `shared/src/newsletters/attachments.ts:191-196`; `shared/src/settings/repository.ts:277,296`; `shared/src/runs/issues.ts:358-366` (+ 7 more files) |
| **Description** | (1) `attachments.ts` `instanceof FeedRepositoryError` branch is dead — both arms call identical `wrapAppwriteError`. (2) `settings/repository.ts` fetches `existing` in `updateRunRetentionDays`, never uses it, silences lint with `void existing;` — a pointless privileged DB read per save. (3) `describeError` duplicated in **8** files (validator found more than the reviewer's 5), inviting divergent redaction. No swallowed-failure cheats found in the reviewed best-effort blocks. |
| **Risk / Impact** | Obscured error-domain mapping (feed not_found re-labeled generic appwrite); dead privileged read; redaction drift risk. |
| **Evidence** | Identical wrap calls both arms; `void existing;`; 8 duplicates of `describeError`. |
| **Recommendation** | Delete the dead branch (or remap codes), remove the unused fetch + `void`, hoist `describeError` into `util/log-redact.ts`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Existing tests stay green; one assertion that a feed not_found surfaces a distinct error code. |
| **Acceptance Criteria** | No `void x;` suppressions or dead duplicated branches; `describeError` in exactly one location. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | All three sub-claims verified; duplicate count is actually higher than claimed. |

---

### [x] N4-20260917: Worker startup "pipeline smoke" log is verification theater (undefined placeholders)

| Field | Value |
|---|---|
| **ID** | `N4-20260917` |
| **Severity** | Low (anti-cheat — always surfaced) |
| **Category** | Anti-cheat |
| **Location** | `worker/src/index.ts:23-58,93-96` |
| **Description** | ~35 lines of "smoke reference" placeholder constants (several literally `undefined`) whose stated purpose is to stop tsc flagging unused imports ("so tsc treats them as used"), logged at startup as `pipeline smoke: ... tagger=undefined` — presenting a compile-time reference as a liveness smoke test. |
| **Risk / Impact** | Misleading startup log suggests pipeline components are verified when none are instantiated; dead imports mask the entrypoint's real dependency surface. |
| **Evidence** | `index.ts:43-52` undefined placeholders; `:94-96` logs `typeof` (prints undefined); comments "Not invoked / Not instantiated". |
| **Recommendation** | Delete placeholders and their type-only imports; optionally wire a real `--selftest` behind the `OPENROUTER_API_KEY` guard. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `pnpm typecheck`/`lint` pass after deletion; no "pipeline smoke" line in startup logs. |
| **Acceptance Criteria** | No placeholder constants/unused imports; startup log contains only true statements. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Placeholders and misleading log verified; compile-time-reference technique itself is legitimate, the smoke framing is not — Low fits. |

---

### [x] N5-20260917: getNewsletter catch-alls swallow all error classes with zero logging (email + RSS publish)

| Field | Value |
|---|---|
| **ID** | `N5-20260917` |
| **Severity** | Low (anti-cheat — always surfaced) |
| **Category** | Anti-cheat |
| **Location** | `shared/src/delivery/send-issue-email.ts:95-100`; `shared/src/delivery/publish-issue-to-rss.ts:93-97` |
| **Description** | Broad catch-alls around `getNewsletter` swallow every error class (404, 500, network) returning a generic operator message with zero logging — unlike sibling failure paths in the same files which log structured sanitized errors. Failure still surfaces as a delivery `failed` status (not masking a working feature), but the diagnostic is lost. |
| **Risk / Impact** | Operator sees "Couldn't load newsletter for sending" with no server trace; unlogged branches hide real defects. |
| **Evidence** | `catch { return finish({ok:false, generic}) }` with no `console.error`, contrast `:143-153`. |
| **Recommendation** | Add structured `console.error` with sanitized message before returning the generic failure in both blocks. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Fake `getNewsletter` rejecting with 500 → result.ok false AND structured log emitted. |
| **Acceptance Criteria** | Both catch blocks log sanitized structured errors. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Both swallow blocks verified; contrast with logged siblings confirmed. |

---

## Dependencies and Licensing

- **Vulnerabilities** (`pnpm audit --prod`, re-verified by validator): **30 total — 1 low / 15 moderate / 12 high / 2 critical.**
  - `next` 15.5.19: 2 critical (unauth RCE Image Optimization AVIF; windows-hosted RCE), high (SSRF via rewrites; Server Actions DoS/SSRF), moderates → D1
  - `nodemailer` 9.0.3: 1 high (quadratic addressparser DoS), 3 moderates (recipient-domain bypass ×2, resolveContent bypass) → D2
  - `sanitize-html` 2.17.6: moderate (SVG SMIL scheme bypass, fixed 2.17.7) → S13
  - Others (undici/postcss/sharp/browserslist): moderate, bundled within D1's remediation pass
- **Outdated critical packages:** `next`, `nodemailer`, `sanitize-html` (see above).
- **License concerns:** none identified (MIT-licensed app; no copyleft conflicts spotted in direct deps — full license scan not performed this pass).
- **CI gap:** no test/lint/audit gate exists — only `.github/workflows/release-containers.yml`. Dependency drift was able to accumulate invisibly.

## Quality Signals

- **Lint/config signals:** No `server-only` boundary in shared/ (S7); `.env` loader in next.config (X2); no security headers (X1); `pnpm typecheck`/`lint` not runnable in sub-agent sandboxes — run locally before merge.
- **Test/coverage signals:** Strong unit-test culture (~53k test lines; e.g. settings-actions tests assert secret masking). But no architectural test enforcing the action-auth convention (N1) and no integration test for direct action invocation — the exact blind spot S1 lived in.
- **Complexity/churn signals:** `describeError` duplicated 8× (N3); worker index carries dead placeholder code (N4); settings secrets round-trip design (S6) is the main structural debt.

## Risk Assessment

- **Overall risk:** **Critical (currently) → Low/Medium after the pre-exposure minimum set below.**
- **Merge/exposure decision:** **Block public exposure** until at minimum: **S1** (auth guard on all actions), **D1** (Next.js ≥15.5.24 + audit CI gate), **X4** (loopback port binding), and **X1** (verified security headers at app or proxy). S3, S13, D2 are cheap and should ride along. S10/S11 (SSRF) and C2 (stale-run sweep) strongly recommended before or shortly after exposure. S4/S6/S5 (secrets handling + roles) before inviting any non-operator account.
- **Out-of-scope areas / manual checklist (could not verify from here):**
  1. **Reverse proxy config** (headers, TLS versions, rate limiting on `/login`, body-size limits) — not in repo; verify X1 there.
  2. **Appwrite console security settings** (auth provider enablement, session durations, MFA, captcha, platform hostname allowlists) — API key lacks `project.read`; recommend: confirm only Email/Password is enabled, no wildcard Web platform origin, and that the Appwrite endpoint stays firewall-internal (its public DNS name notwithstanding).
  3. **Appwrite volume backups** contain `app_settings` plaintext secrets (S4) — protect/encrypt backups.
  4. Live penetration testing of the deployed stack (this was a static review + live config read, not dynamic testing).
  5. `pnpm typecheck` / `pnpm lint` locally (sub-agents couldn't run them; A1 TS2554 sub-claim pending).

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1-20260917 | Blocker | Address now | Stage 16 Feature 01 (fail-closed actions + architectural test). |
| S10-20260917, S11-20260917 | High + Medium | Address now | Stage 16 Feature 03 (fetch-time SSRF, fail-closed, NAT64/6to4, DNS pinning). |
| C2-20260917 | High | Address now | Stage 16 Feature 03 (stale-run reaper). |
| D1-20260917 | High | Address now | Stage 16 Feature 02 (advisory-driven bumps + recurring audit gate). |
| S2, S3, S13, D2, X1, X4 | Medium | Address now | S2→F01; S3→F05; S13/D2→F02; X1 headers→F02, CSP portion **deferred** (can break Next+PWA); X4→F02 as configurable binding default — operator's LAN exposure preserved. PM notes proxy adds HSTS and firewall/VPN sits in front of prod. |
| S4, S6, S7, S8, S9 | Medium | Address now | Stage 16 Feature 04 (S4/S6/S7/S8); S9→F05. |
| S5 (roles) | Medium | Address now | Stage 16 Feature 06 — in-app operator-gated invites, no open sign-up. |
| S12, S14 (content policy) | Medium | Address now | Stage 16 Feature 05 — S12 kept loose per PM (output token limit is the effective size bound); S14 policy decided at spec time. |
| C1, C3, A1, P1 | Medium | Address now: C1, A1, P1 (F05; P1 cap generous ~2× typical run). **Defer: C3.** | C3: single-worker is a firm deployment assumption; the fix redesigns the claim path for a problem that cannot occur today. Pinned in Plan.md carry-forward. |
| X2, N1–N5 | Low | Address now | X2→F02; N1→F01 (same fix as S1); N2/N4→F03; N3→F04; N5→F05. |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

Remediation is carried by **Stage 16 (security-and-roles)** features rather than a single hardening spec; see `.ssc/stages/stage-16-security-and-roles.md`. Tick the Detailed Findings checkboxes above as the corresponding features verify.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
