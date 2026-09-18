# Stage 16: Security and roles — Summary

## What this stage delivered

Homepress is no longer one crafted request away from full admin takeover, and it is no longer a single-login household. Strangers who clone the public repo get fail-closed defaults. The household that already runs the box can invite a reader without handing them the factory.

Every in-app action now refuses a missing login before it does anything, and a standing test fails the default suite if a future action forgets that check. Known-vulnerable packages are gone, a CI audit gate keeps them gone, and the web port binds to loopback unless the operator explicitly asks otherwise. The worker will not fetch internal or cloud-metadata addresses on a feed's say-so (unless that feed is marked Internal), and a crashed “running” job no longer permanently stalls that newsletter — the next scheduled run proceeds.

GUI-stored API keys and SMTP passwords are encrypted at rest when a deploy key is set; Settings never shows or re-sends the stored secret (blank means keep). Untrusted IDs, drafts, email, and RSS are clamped and sanitized. An operator can create a household reader in Admin → Accounts; that account can use Home, newsletter channels, and listen, and cannot reach factory pages, factory actions, or issue export. There is no public sign-up.

## How it maps to the plan

- **Stage Intent:** Two audiences depend on this code being safe: the household that reads the digest, and the strangers who find the public git repo and self-host their own instance. The 2026-09-17 whole-app audit (review-app-public-exposure-2026-09-17) found the app one crafted HTTP request away from full admin takeover — plus a worker that fetches internal addresses on a feed's say-so, newsletters that silently stop after one hard crash, secrets readable from the database, and no trust boundary between an operator and an invited reader. This stage closes every triaged audit finding and adds a real operator-vs-reader boundary, with in-app account creation, before the first non-operator account exists — while preserving the original Stage 16 intent that readers use Home, channels, and listen without ever seeing the factory.
- **Acceptance criteria met:**
  - [x] Direct invocation of any server action without a valid session fails closed — asserted by a test covering every exported action in every action module, running in the default test command. (S1, N1, S2)
  - [x] The production dependency audit reports no critical or high advisories and runs as a CI gate; the web framework, mailer, and HTML sanitizer resolve to their fixed versions. (D1, D2, S13)
  - [x] Feed or article URLs whose effective connection target resolves to private/loopback/link-local/metadata space are refused with a structured error — across IPv4, IPv6, mapped, NAT64/6to4, and DNS-rebinding cases — unless the operator has explicitly opted into private-feed fetching. (S10, S11)
  - [x] A run left "running" with a stale heartbeat auto-fails within one sweep interval, records the true in-flight phase, and that newsletter's next run executes without manual intervention. (C2)
  - [x] No plaintext API key or SMTP password is retrievable from a database dump; a settings save never requires reading or re-sending stored secrets; the masked-edit flow still works. (S4, S6)
  - [x] Importing the API-key-backed client into browser code fails the build; error text persisted or logged by run-failure, health, and feed-qualification paths is redacted and bounded. (S7, S8)
  - [x] The public RSS route rejects malformed IDs, returns only fixed error strings, and sets cache headers; repository get/delete reject malformed IDs and clamp limits; feed deletion refuses a feed attached beyond the first page of attachments. (S3, S9, C1)
  - [x] Persisted drafts contain no control/null bytes or non-http(s) link schemes and are capped far above real draft sizes; email and RSS follow the decided remote-image/link policy; the drafter prompt caps content at a generous bound (~2× a typical full run) so typical runs are untouched. (S12, S14, P1)
  - [x] All responses carry HSTS, frame denial, nosniff, and Referrer-Policy, and no framework advertisement header; the deployed port binding defaults to loopback for new deployments while the existing operator deployment keeps its current LAN exposure. (X1 minus CSP, X4)
  - [x] A reader session cannot reach any factory page, factory action, or issue export; an operator can create a reader account in-app; no anonymous or open sign-up path exists. (S5)
  - [x] Quality gates pass: typecheck, lint, and the full test suite.
- **North star link:** The digest is still the daily product. This stage makes that product safe to share with a household reader, and safe for anyone who self-hosts from the public repo — without turning Homepress into a multi-tenant SaaS.

## What was built

- **Feature 01 — Fail-closed admin actions:** Every server action requires a real session as its first step. A standing architectural test in the default suite discovers every `"use server"` module and fails if any export skips the guard. Middleware stays a login-page convenience, not the security boundary.
- **Feature 02 — Dependency and deployment hardening:** Next, the mailer, and the HTML sanitizer sit on patched versions; `pnpm audit:gate` runs on push, PR, weekly, and before any container release. Responses send HSTS / frame-deny / nosniff / Referrer-Policy and drop the framework advertisement. New deploys bind `:3000` to loopback; existing LAN exposure is an explicit `WEB_BIND_ADDR` override.
- **Feature 03 — Worker hardening:** Feed and article fetches refuse private, loopback, link-local, and cloud-metadata targets (IPv4/IPv6, mapped, NAT64/6to4, DNS-rebinding) unless the operator marks that feed Internal. A stale-run reaper marks crashed “running” jobs failed with the true in-flight phase so the next run is not blocked.
- **Feature 04 — Secrets and leakage hygiene:** GUI-stored OpenRouter key and SMTP password encrypt at rest with a deploy-only key. Settings saves use keep-blank sentinels — they never read or re-send stored secrets. The API-key client cannot be bundled into browser code. Persisted and logged errors are redacted at the write site.
- **Feature 05 — Untrusted input and content policy:** Public RSS and repositories reject malformed IDs and clamp list sizes; deleting a feed sees attachments beyond the first page. Drafts drop control bytes and hostile link schemes. Email, RSS, HTML export, and the reader show no remote images; emitted links are hardened. Drafter prompt content is capped so a runaway article cannot blow up token spend.
- **Feature 06 — Household roles with in-app invites:** `operator` vs reader via Appwrite labels. Readers keep Home, channels, and listen. Factory pages, factory actions, and issue export require the operator. Operators create, block, unblock, reset, and delete reader accounts at Admin → Accounts. No open sign-up. First operator is bootstrapped once after deploy.
- **Feature 07 — Hardening (review 2026-09-18):** Closed the arch-test discovery hole (including the health-card action), added the new encryption key to the production env denylist, pinned the SSRF dispatcher with a real-socket smoke, made claim+heartbeat one write, closed draft-scheme-scrub bypasses, and picked up the accepted Low residuals.

## Decisions and deviations

- After Features 01–06 verified, `ssc-code-review` found 0 Blocker / 0 High / 5 Medium / 18 Low. PM addressed every Medium and the accepted Lows in Feature 07. Dismissed as pedantic: SMTP password literally starting with `enc1:`, emoji split at a 70k/1M cap boundary, indented-code over-scrub.
- Unset encryption key stores secrets in plaintext with a loud Settings warning (the stage's lean). A malformed key refuses secret writes.
- Remote images are stripped from every channel, including the in-app reader — not email/RSS only. Links get `rel` hardening. Stored markdown is not rewritten; policy is at render time, plus a storage-side scheme scrub on new drafts.
- Roles use Appwrite user labels, not teams. The operator sets the reader's password. Promoting someone to operator stays an Appwrite-console action. Account creation is operator-gated only.
- Advisory-driven dependency bumps only — no optional patch/minor refresh of the rest of the tree.
- Feature 05's spec text said the pending-runs list defaulted to 100; the code kept the original default of 10 and still clamps to 1–500. Stage acceptance only required the clamp.
- D1's remaining clause — GHCR images still carrying the pre-stage tree — is closed by the stage-end 0.1.6 release, not by Feature 02 itself.
- Regression pass is contract + composition tests (2596 tests, typecheck, lint, `pnpm audit:gate`), not a live penetration test of the deployed box. Operator smoke (bootstrap, create a reader, confirm the factory is invisible to them, set `WEB_BIND_ADDR` if you currently hit `:3000` off-host) remains an operator check.

## Deferred and out of scope

- Atomic run claiming for multi-worker deployments (audit C3) — single-worker is still a firm assumption.
- Content-Security-Policy header — the one header that can white-screen Next + the PWA service worker.
- Reverse-proxy configuration, Appwrite console settings, and backup encryption — operator checklist; deploy docs cover what the app can.
- Live penetration testing of the deployed stack.
- Multi-tenant anything — one household, operator-invited accounts only.
- Major-version refresh of packages without advisories.
- Dismissed review leftovers C2 / C4 / C5 (see Decisions).

## Open questions for the next stage

- What comes after security-and-roles is a new `ssc-plan` call. Banked durability/ops from Stage 12 (definition backup/export, out-of-band alerts) are still sitting there.
- CSP still needs a dedicated pass that will not break inline scripts or the service worker.
- If a second worker replica is ever introduced, pending→running claim must become atomic first (carry-forward pin).
- Whether Listen should ever speak the stored title remains pinned no from Stage 15.
