# Stage 16: Security and roles

## Intent

Two audiences depend on this code being safe: the household that reads the digest, and the strangers who find the public git repo and self-host their own instance. The 2026-09-17 whole-app audit (review-app-public-exposure-2026-09-17) found the app one crafted HTTP request away from full admin takeover — plus a worker that fetches internal addresses on a feed's say-so, newsletters that silently stop after one hard crash, secrets readable from the database, and no trust boundary between an operator and an invited reader. This stage closes every triaged audit finding and adds a real operator-vs-reader boundary, with in-app account creation, before the first non-operator account exists — while preserving the original Stage 16 intent that readers use Home, channels, and listen without ever seeing the factory.

## Goal

Every admin action fails closed without a valid session, enforced by a test that catches any future action that forgets the check. Known-vulnerable dependencies are gone and a gate keeps them gone. The worker refuses to fetch internal addresses and recovers on its own from hard crashes. Stored secrets are unreadable from a database dump. Untrusted content cannot abuse the delivery channels. An operator can create household reader accounts in-app; those accounts can read and listen but never touch the factory. The operator's own deployment (LAN exposure behind firewall/VPN, Nginx Proxy Manager) behaves identically after the update.

## Features

1. **Fail-closed admin actions** — Every server action, current and future, requires an authenticated session before doing anything; an architectural test in the default test run fails if any exported action lacks the check. The middleware redirect is documented as a UX convenience, not a security boundary. (Audit S1, N1, S2)
2. **Dependency and deployment hardening** — Update every package with a known advisory and add a recurring audit gate so drift cannot accumulate invisibly; optionally refresh patch/minor versions of the rest if quality gates stay green (no major jumps). Standard security headers on all responses. The web port binds to loopback by default with an explicit override so existing deployments keep their current exposure. The build no longer pulls secret values from the repo `.env`. (D1, D2, S13, X1 minus CSP, X4, X2)
3. **Worker hardening** — At fetch time, refuse any feed- or article-supplied URL whose connection target resolves to a private, loopback, link-local, or cloud-metadata address — covering IPv4, IPv6 spellings, and DNS-rebinding — with an explicit operator opt-out for genuinely internal feeds. A stale-run reaper marks crashed "running" runs as failed (with the true in-flight phase) so one hard worker kill never permanently halts a newsletter. Worker code hygiene. (S10, S11, C2, N2, N4)
4. **Secrets and leakage hygiene** — The GUI-stored API key and SMTP password are encrypted at rest with a key held only in the deploy environment; the GUI never displays or re-sends stored secrets (keep-sentinel saves instead of read-modify-write). The API-key-backed client becomes structurally impossible to bundle into browser code. Token-scrubbing is enforced inside the low-level persist/log functions rather than remembered per call site. (S4, S6, S7, S8, N3)
5. **Untrusted input and content policy** — Validate IDs and clamp limits at repository and public-route boundaries; the feed-delete safety check sees beyond the first page of attachments. Persisted issue drafts are normalized loosely — control bytes out, link schemes validated, capped far above real drafts — without fighting the model's token limits. A decided remote-content policy for email and RSS (images, link hardening). A generous cap on drafter prompt content (~2× a typical full run) so runaway articles cannot blow up token spend while typical runs pass untouched. Small correctness fixes. (S3, S9, C1, S12, S14, P1, A1, N5)
6. **Household roles with in-app invites** — An operator role and a reader role: readers keep Home, newsletter channels, and listen; every factory surface and the issue export require the operator role. Operators create reader accounts in-app; account creation is itself operator-gated and there is no open sign-up path anywhere. (S5)

## Acceptance criteria

- [ ] Direct invocation of any server action without a valid session fails closed — asserted by a test covering every exported action in every action module, running in the default test command. (S1, N1, S2)
- [ ] The production dependency audit reports no critical or high advisories and runs as a CI gate; the web framework, mailer, and HTML sanitizer resolve to their fixed versions. (D1, D2, S13)
- [ ] Feed or article URLs whose effective connection target resolves to private/loopback/link-local/metadata space are refused with a structured error — across IPv4, IPv6, mapped, NAT64/6to4, and DNS-rebinding cases — unless the operator has explicitly opted into private-feed fetching. (S10, S11)
- [ ] A run left "running" with a stale heartbeat auto-fails within one sweep interval, records the true in-flight phase, and that newsletter's next run executes without manual intervention. (C2)
- [ ] No plaintext API key or SMTP password is retrievable from a database dump; a settings save never requires reading or re-sending stored secrets; the masked-edit flow still works. (S4, S6)
- [ ] Importing the API-key-backed client into browser code fails the build; error text persisted or logged by run-failure, health, and feed-qualification paths is redacted and bounded. (S7, S8)
- [ ] The public RSS route rejects malformed IDs, returns only fixed error strings, and sets cache headers; repository get/delete reject malformed IDs and clamp limits; feed deletion refuses a feed attached beyond the first page of attachments. (S3, S9, C1)
- [ ] Persisted drafts contain no control/null bytes or non-http(s) link schemes and are capped far above real draft sizes; email and RSS follow the decided remote-image/link policy; the drafter prompt caps content at a generous bound (~2× a typical full run) so typical runs are untouched. (S12, S14, P1)
- [ ] All responses carry HSTS, frame denial, nosniff, and Referrer-Policy, and no framework advertisement header; the deployed port binding defaults to loopback for new deployments while the existing operator deployment keeps its current LAN exposure. (X1 minus CSP, X4)
- [ ] A reader session cannot reach any factory page, factory action, or issue export; an operator can create a reader account in-app; no anonymous or open sign-up path exists. (S5)
- [ ] Quality gates pass: typecheck, lint, and the full test suite.

## Dependencies

- Stage 15 (issue-metadata-and-redraft) must be complete — the audit reviewed the codebase including Stage 15 surfaces, and the redraft action is among those that must fail closed.

## Out of scope

- Atomic run claiming for multi-worker deployments (audit C3) — deferred: single-worker is a firm deployment assumption; carry-forward pin records it.
- Content-Security-Policy header — deferred: the one header that can break the app outright (inline scripts + PWA service worker); carry-forward pin records it.
- Reverse-proxy configuration, Appwrite console settings, and backup encryption — the operator's manual checklist; the app documents what it can (deploy docs).
- Live penetration testing of the deployed stack (the audit was static review + live config read).
- Multi-tenant anything — one household, operator-invited accounts only.
- Major-version refresh of packages without advisories.

## Open questions

- Secrets encryption key unset behavior: refuse GUI secret saves, or store plaintext with a loud diagnostics warning? (lean: warning; ssc-spec)
- Exact remote-content policy for email and RSS: strip remote images from email and RSS but keep them in the reader GUI? Link hardening (rel attributes) on emitted links? (lean: yes to both; ssc-spec)
- Roles mechanics: Appwrite team vs user labels as the role source of truth; how the initial password reaches the household member (generated and shown once vs operator-set); Appwrite's user limit must be raised manually — deploy-docs update. (ssc-spec)
- Where in-app account management lives in Admin, and whether operators can deactivate or reset reader accounts. (ssc-spec)
- Whether the optional patch/minor dependency refresh rides Feature 02 or is skipped. (decide at spec time)
