# Feature 02: Dependency and deployment hardening

## Intent

The internet-facing web tier runs on dependencies with known critical advisories, answers without standard security headers, binds to every interface by default, and reads secret values from the repo `.env` at build time — this feature makes all four fail-safe by default and adds a recurring audit gate so dependency drift can never accumulate invisibly again.

## Spec

Close audit findings D1, D2, S13, X1 (minus CSP), X4, and X2 from `review-app-public-exposure-2026-09-17`:

1. **Recurring audit gate (D1's "none exists today" half).** Root `package.json` gains `"audit:gate": "pnpm audit --prod --audit-level=high"`. New `.github/workflows/security-audit.yml` runs `pnpm audit:gate` on push to `main`, on pull requests, weekly on schedule (Monday 06:00 UTC cron), and via `workflow_dispatch` (steps: checkout → `pnpm/action-setup@v4` [reads `packageManager`] → `actions/setup-node@v4` node 22 with pnpm cache → `pnpm install --frozen-lockfile` → `pnpm audit:gate`). `.github/workflows/release-containers.yml` gains a separate `audit` job (same steps) and `build-and-push` gains `needs: audit`, so no vulnerable image can ship even on a tag push.
2. **Advisory-driven dependency bumps (D1, D2, S13).** Direct-range floors raised: `web/package.json` `next` → `^15.5.24`; `shared/package.json` `nodemailer` → `^9.1.1`, `sanitize-html` → `^2.17.7`, `@mozilla/readability` → `^0.6.0`; `worker/package.json` `@mozilla/readability` → `^0.6.0` (0.5→0.6 is a minor bump forced by an advisory — caret on 0.x pins the minor; this is the only range change beyond patch floors and is advisory-driven, not a major jump). Then refresh the lockfile within existing ranges for the vulnerable transitives: `pnpm -r update postcss sharp undici nanoid browserslist baseline-browser-mapping`. Fallback: if any package still resolves below its patched range after the update (parent range blocks it), add that package (only) to `pnpm.overrides` in root `package.json` and document it in the handoff. Target: `pnpm audit --prod` reports **0 vulnerabilities total**; hard floor per the stage acceptance: 0 critical and 0 high. **Decided (stage open question): the optional patch/minor refresh of the remaining tree does NOT ride this feature** — advisory-driven bumps only, per the Plan pin "small verifiable diffs".
3. **Sanitizer regression case (S13).** `shared/src/delivery/__tests__/email-body.test.ts` already strips `<script>`, event-handler attributes, and `javascript:`/`data:` schemes (lines 55–102) — the audit's suggested tests largely pre-exist. Add one advisory-specific case to that adversarial block: markdown embedding `<svg><animate attributeName="href" values="javascript:...">` (SVG SMIL URI-list payload, the exact 2.17.6 advisory) must not survive `draftMarkdownToEmailHtml` — no `<svg`, no `<animate`, no `javascript:` in output. No production change.
4. **Security headers (X1 minus CSP).** `web/next.config.mjs`: add `poweredByHeader: false` to the config object; add to `headers()` a `source: "/:path*"` entry with `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Keep the existing `/sw.js` entry and the `/rss/:newsletterId.xml` rewrite untouched. **No Content-Security-Policy** (deferred by carry-forward pin — it can break Next inline scripts + the PWA service worker). Duplicate HSTS from the operator's NPM proxy is harmless (browsers take the max).
5. **Env loader secret restriction (X2).** The config-time `.env` loader in `web/next.config.mjs` gains a `SECRET_ENV_KEYS` denylist (`APPWRITE_API_KEY`, `OPENROUTER_API_KEY`, `SMTP_PASSWORD`): those keys are injected **only when `NODE_ENV === "development"`**. Production `next build` / `next start` never read secrets from the repo `.env` — secrets reach production exclusively via container env (`env_file`), which is the intended pattern. `pnpm dev` behavior is unchanged (dev needs the loader because Next auto-loads only `web/.env*`, not the repo root `.env`). All non-secret keys keep loading in every mode. The `SECRET_ENV_KEYS` declaration carries a maintenance comment: **any new secret env key must be added to this denylist** — fail-safe by default, including keys that do not exist yet (e.g. the settings-encryption key Feature 04 introduces).
6. **Loopback port binding default (X4).** `compose.yaml` web `ports` becomes `"${WEB_BIND_ADDR:-127.0.0.1}:3000:3000"` (compose interpolation reads `WEB_BIND_ADDR` from the root `.env` automatically; default is loopback). `.env.example` documents `WEB_BIND_ADDR` **commented** — set to `0.0.0.0` or a specific interface IP only when something outside the host must reach `:3000` directly (e.g. reverse proxy in another container/host, direct LAN access). Never set it empty: the `:-` interpolation form treats empty-as-unset and silently falls back to loopback, so a set-but-empty value ignores the override intent — the operator believes LAN exposure is on, but it is not. `docs/DEPLOY.md` gains a "Web port binding" note after the env table: the exposure model is reverse-proxy + TLS; loopback is the default; the upgrade migration note (deployments ≤0.1.5 that relied on direct `:3000` access must set `WEB_BIND_ADDR` before upgrading); and the firewall/proxy assumption when binding non-loopback. Worker publishes no ports (already true — unchanged).
7. **Audit bookkeeping.** Tick the D1, D2, S13, X1, X4, and X2 checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings (per Plan.md carry-forward pin). The D1 tick is **repo-level**: code, lockfile, and the audit-gated release pipeline are remediated; the audit's "images rebuilt from updated lockfile" clause completes when the stage-end release cuts new GHCR tags — the handoff reports that remainder so it is not lost.

Image version tags (`0.1.5` in `compose.yaml`, GHCR images) are NOT bumped here. No Stage 16 feature or Plan artifact currently owns the release — this spec treats it as a stage-gate responsibility: cut it at `ssc-finalize` (or via the next release tag push, which now cannot ship without passing `pnpm audit:gate`). Recommend recording a "stage-end release owns the image rebuild" pin in Plan.md at finalize time.

## Dependencies

- None code-wise — independent of Feature 01 (auth guard); may execute before or after it. Stage 15 is complete (stage-level dependency satisfied).

## Constraints

- No major-version dependency jumps. The only minor jump is `@mozilla/readability` 0.5→0.6, advisory-driven (declared in Spec §2).
- No full patch/minor refresh of non-vulnerable packages (decided at spec time — Spec §2).
- No Content-Security-Policy header (carry-forward pin: deferred).
- `pnpm-lock.yaml` changes only via pnpm commands (`pnpm install` / `pnpm update`), never hand-edited.
- `pnpm dev` must keep working with secrets from the repo root `.env` (Spec §5 preserves it via the dev-only branch).
- Compose `env_file` mechanism unchanged; no new secrets introduced; `WEB_BIND_ADDR` ships commented in `.env.example` (empty-but-set breaks the port mapping).
- The in-container healthcheck (`http://localhost:3000/health` from inside the web container) is unaffected by the host-side binding change.
- Application source is untouched except `web/next.config.mjs`; everything else is manifests, tests, lockfile, and docs.
- Existing `eslint-config-next` (^16, devDependency) / `next` (15.x) version mismatch is pre-existing and out of scope.
- Image tags and release version are not bumped (rides the stage-end release).

## Acceptance criteria

- [ ] `pnpm audit --prod` reports zero critical and zero high advisories (target: zero total); the lockfile resolves `next` ≥15.5.24, `nodemailer` ≥9.1.1, and `sanitize-html` ≥2.17.7; `pnpm audit:gate` exists as a root script. (D1, D2, S13)
- [ ] The audit gate runs on push/PR/weekly/workflow_dispatch via `.github/workflows/security-audit.yml`, and `release-containers.yml` cannot build images unless the audit job passes (`needs: audit`). (D1)
- [ ] `pnpm audit:gate` demonstrably fails before the bumps: its Task-1 run exits non-zero listing the current next/nodemailer/etc. advisories. (D1 — detection proof)
- [ ] `web/next.config.mjs` sets `poweredByHeader: false` and emits HSTS, `X-Frame-Options: DENY`, `nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` for `/:path*`; no CSP; `/sw.js` headers and the RSS rewrite unchanged — asserted by a test in the default `pnpm test`. (X1 minus CSP)
- [ ] With `NODE_ENV=production`, the config-time loader does not inject `APPWRITE_API_KEY`, `OPENROUTER_API_KEY`, or `SMTP_PASSWORD` from `.env`; with `NODE_ENV=development` it does; non-secret keys load in both modes — asserted by a hermetic test (mocked `node:fs`, never reading the real `.env`). (X2)
- [ ] `compose.yaml` web ports equal `"${WEB_BIND_ADDR:-127.0.0.1}:3000:3000"`; worker has no published ports; `.env.example` documents `WEB_BIND_ADDR` commented; `docs/DEPLOY.md` documents the binding default, the migration note, and the proxy/firewall assumption — asserted by a compose-convention test in the default `pnpm test`. (X4)
- [ ] The SVG-SMIL adversarial case passes against the bumped `sanitize-html`. (S13)
- [ ] D1 (repo-level; GHCR rebuild rides the stage-end release — Spec §7), D2, S13, X1, X4, X2 checkboxes ticked in the audit report's Detailed Findings.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass on the bumped tree.

## Files

- Create: `.github/workflows/security-audit.yml`
- Create: `web/src/__tests__/next-config.test.ts`
- Create: `web/src/__tests__/compose-ports.test.ts`
- Modify: `package.json` (root — `audit:gate` script; `pnpm.overrides` only as Spec §2 fallback)
- Modify: `.github/workflows/release-containers.yml`
- Modify: `web/package.json`
- Modify: `shared/package.json`
- Modify: `worker/package.json`
- Modify: `pnpm-lock.yaml` (via pnpm commands only)
- Modify: `shared/src/delivery/__tests__/email-body.test.ts`
- Modify: `web/next.config.mjs`
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Modify: `.ssc/reviews/review-app-public-exposure-2026-09-17.md` (tick D1, D2, S13, X1, X4, X2)

## Testing approach

Test-first where the surface is code; the workflow files are config verified by content plus the locally-runnable identical command (explicitly not test-first — stated per skill rules).

- **Audit gate (D1):** `pnpm audit:gate` is its own test — Task 1's run against the current tree exits non-zero listing today's advisories (the red proof); Task 2 turns it green. A verifier can re-probe by temporarily lowering a version — not required as a permanent case.
- **`next-config.test.ts` (X1 + X2):** hermetic — `vi.mock("node:fs")` returns a fixture `.env` (secret keys + public keys), never the real repo `.env`. Per case: delete target keys from `process.env`, `vi.stubEnv("NODE_ENV", ...)`, `vi.resetModules()`, dynamic-import `../../next.config.mjs`, assert, then clean up injected keys (`afterEach`). Cases: (a) production → the three secret keys stay unset, `NEXT_PUBLIC_APPWRITE_ENDPOINT` (fixture value) is set; (b) development → the three secret keys are set from the fixture; (c) `headers()` contains the `/:path*` entry with all four security headers plus the unchanged `/sw.js` entry; (d) `poweredByHeader === false`; (e) `rewrites()` still maps `/rss/:newsletterId.xml`. Red before Tasks 3–4 implementation (headers assertions fail against current config; loader assertions fail because the loader currently injects secrets unconditionally).
- **`compose-ports.test.ts` (X4):** reads `compose.yaml` as text (no YAML dependency — plain string assertions) and asserts the web ports template string, worker has no `ports:` under its service block, and both services keep `env_file: .env`. Red before the compose change (`"3000:3000"` today).
- **`email-body.test.ts` (S13):** existing adversarial cases stay green on the bumped `sanitize-html` (they already cover script/event-handler/scheme stripping); the new SVG-SMIL case guards the exact 2.17.6 advisory path.
- **Full-suite regression on the bumped tree** is the compatibility test for `next` 15.5.24, `nodemailer` 9.1.1, and `@mozilla/readability` 0.6 (`new Readability(doc).parse()` at `shared/src/pipeline/scraper.ts:232` is the only Readability call site — API stable across the bump; worker lists it as an esbuild external, so no bundling concern).

## Tasks

### Task 1: audit gate script + CI workflows (red run)

- **Action**: Add `"audit:gate": "pnpm audit --prod --audit-level=high"` to root `package.json` scripts. Create `.github/workflows/security-audit.yml` per Spec §1 (push `main` / PR / weekly cron `0 6 * * 1` / `workflow_dispatch`; checkout → `pnpm/action-setup@v4` → `actions/setup-node@v4` (node 22, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm audit:gate`; `permissions: contents: read`). Add the `audit` job (same steps) to `.github/workflows/release-containers.yml` and `needs: audit` to `build-and-push`.
- **Expected result**: The gate command exists and the two workflows reference it; nothing else changed.
- **Verify**: `pnpm audit:gate` exits **non-zero** and its output lists the next/nodemailer/sanitize-html advisories (record the summary line in the handoff — this is the D1 detection proof). `rg -n "branches: main|pull_request|schedule|workflow_dispatch" .github/workflows/security-audit.yml` hits all four triggers; `rg -n "0 6 \* \* 1" .github/workflows/security-audit.yml` hits the weekly cron. `git diff --name-only` shows exactly: `package.json`, `.github/workflows/security-audit.yml`, `.github/workflows/release-containers.yml`. `pnpm test` still passes (nothing behavioral changed yet).
- **Depends on**: none.

### Task 2: advisory-driven dependency bumps (gate green)

- **Action**: Set the Spec §2 direct-range floors in `web/package.json`, `shared/package.json`, `worker/package.json`; run `pnpm install` (refresh lockfile), then `pnpm -r update postcss sharp undici nanoid browserslist baseline-browser-mapping`; re-run `pnpm audit:gate`. If any critical/high advisory remains because a parent range blocks the patched version, add the minimal `pnpm.overrides` entry (or entries) in root `package.json`, `pnpm install` again, and record the override and reason in the handoff.
- **Expected result**: Lockfile resolves `next` ≥15.5.24, `nodemailer` ≥9.1.1, `sanitize-html` ≥2.17.7, `@mozilla/readability` ≥0.6.0, and every previously-vulnerable transitive at or above its patched version; no other dependency drift.
- **Verify**: `pnpm audit:gate` exits **zero** (run `pnpm audit --prod` and record the totals — target `0 vulnerabilities found`); `pnpm install --frozen-lockfile` succeeds; `pnpm typecheck && pnpm lint && pnpm test` all pass on the bumped tree.
- **Depends on**: Task 1 (the gate command is the verification seam).

### Task 3: sanitizer SVG-SMIL regression case (S13)

- **Action**: Add the Spec §3 case to the adversarial block of `shared/src/delivery/__tests__/email-body.test.ts` — markdown embedding an `<svg><animate attributeName="href" values="javascript:alert(1)">` payload passes through `draftMarkdownToEmailHtml` with no `<svg`, `<animate`, or `javascript:` surviving in the HTML output. Follow the style of the neighboring cases (lines 55–102).
- **Expected result**: The new case passes against the bumped `sanitize-html` 2.17.7+; all existing cases unchanged.
- **Verify**: `pnpm vitest run shared/src/delivery/__tests__/email-body.test.ts` passes including the new case.
- **Depends on**: Task 2 (targets the bumped version).

### Task 4: security headers in next.config (X1 minus CSP) — red then green

- **Action**: Create `web/src/__tests__/next-config.test.ts` with the hermetic fs-mock harness and the X1 cases (c)–(e) from Testing approach (headers entry, `/sw.js` preserved, `poweredByHeader === false`, rewrite unchanged). Run it — it must fail on the headers/poweredBy assertions against current config. Then implement Spec §4 in `web/next.config.mjs`.
- **Expected result**: Red run first (headers/poweredBy missing), then all X1 cases green; `/sw.js` entry and rewrite untouched.
- **Verify**: `pnpm vitest run web/src/__tests__/next-config.test.ts` — record the red assertion set before implementing, then green after. `pnpm typecheck` passes.
- **Depends on**: none (independent of Tasks 1–3; ordered here for a linear chain).

### Task 5: env-loader secret restriction (X2) — red then green

- **Action**: Add the X2 cases (a)–(b) to `web/src/__tests__/next-config.test.ts` (production: secrets unset, public keys set; development: secrets set). Run — case (a) must fail (the loader currently injects secrets unconditionally). Then implement Spec §5 in `web/next.config.mjs`: `SECRET_ENV_KEYS` denylist, dev-only injection, explanatory comment (production secrets arrive via container env; dev relies on this loader because Next auto-loads only `web/.env*`) plus the denylist maintenance comment from Spec §5.
- **Expected result**: Red run first (production case fails), then both loader cases green; headers cases from Task 4 stay green.
- **Verify**: `pnpm vitest run web/src/__tests__/next-config.test.ts` passes all cases; `pnpm test` (full suite) passes; `pnpm dev` smoke is unchanged in behavior by design (no manual dev check required — the development-mode case is the test).
- **Depends on**: Task 4 (same test file/harness).

### Task 6: loopback binding default + docs (X4) — red then green

- **Action**: Create `web/src/__tests__/compose-ports.test.ts` per Testing approach; run it — must fail against `"3000:3000"`. Then change `compose.yaml` web ports to `"${WEB_BIND_ADDR:-127.0.0.1}:3000:3000"`. Add the commented `WEB_BIND_ADDR` block to `.env.example` (Spec §6 wording, including the never-empty warning). Add the "Web port binding" note to `docs/DEPLOY.md` after the env table: default loopback, override for non-same-host proxies / direct LAN access, the ≤0.1.5 migration note, and the firewall/proxy assumption statement.
- **Expected result**: Compose defaults to loopback; override documented in all three places; test green.
- **Verify**: `pnpm vitest run web/src/__tests__/compose-ports.test.ts` passes; `rg -n "WEB_BIND_ADDR" compose.yaml .env.example docs/DEPLOY.md` hits all three files; `rg -n "loopback" docs/DEPLOY.md` hits the binding-default note; `rg -n "0\.1\.5" docs/DEPLOY.md` hits the migration note; `rg -ni "firewall|proxy" docs/DEPLOY.md` hits the exposure-assumption statement; `rg -n "Strict-Transport-Security" web/next.config.mjs` still present (no regression from Tasks 4–5).
- **Depends on**: none (ordered last before gates for a linear chain).

### Task 7: full gates + audit checkbox ticks

- **Action**: Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all must pass). Tick the D1-20260917, D2-20260917, S13-20260917, X1-20260917, X4-20260917, and X2-20260917 checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings.
- **Expected result**: All quality gates green; audit report reflects the six findings as remediated.
- **Verify**: The three commands exit zero; the report shows `[x]` for all six IDs; `pnpm audit:gate` still exits zero.
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm audit:gate && pnpm test && pnpm typecheck && pnpm lint`
- Expected: All exit zero. `pnpm audit --prod` reports 0 vulnerabilities (record totals in the handoff; 0 critical/high is the gate floor). Within `pnpm test`: `next-config.test.ts` asserts the four security headers, `poweredByHeader: false`, dev-only secret injection, and the preserved `/sw.js` + rewrite entries; `compose-ports.test.ts` asserts the loopback-default ports template. Supporting probes: `rg -n "WEB_BIND_ADDR" compose.yaml .env.example docs/DEPLOY.md` (3 files), `rg -n "loopback|0\.1\.5|firewall" docs/DEPLOY.md` (binding note + migration note + assumption), `rg -n "needs: audit" .github/workflows/release-containers.yml`, `rg -n "branches: main|pull_request|schedule|workflow_dispatch" .github/workflows/security-audit.yml` (all four triggers), `rg -n "pnpm/action-setup" .github/workflows/security-audit.yml`.

## Handoff

Report to the manager: files created/modified; the Task-1 red-run audit summary line (pre-fix advisory counts) and the post-fix `pnpm audit --prod` totals (both are the D1 anti-drift evidence); the outstanding repo-level-vs-images remainder for D1 (GHCR tags still carry the vulnerable tree until the stage-end release); any `pnpm.overrides` used and why; confirmation that `pnpm dev`'s secret delivery is preserved (development-mode test case green); confirmation that application source is untouched except `web/next.config.mjs`; any deviations from this spec and why (e.g. a transitive that needed an override, workflow syntax adjustments discovered during implementation — the gate semantics must not weaken).

## Research note

- `pnpm audit --prod` re-run 2026-09-17 (before spec): exactly 30 advisories (1 low / 15 moderate / 12 high / 2 critical) — enumerated per package with patched floors; all patched versions are reachable within current parent ranges (next ≥15.5.24, postcss ≥8.5.23, sharp ≥0.35.4, undici ≥6.28.0, nanoid ≥3.3.18, browserslist ≥4.28.7, baseline-browser-mapping ≥2.11.0, sanitize-html ≥2.17.7, nodemailer ≥9.1.1, @mozilla/readability ≥0.6.0).
- Codebase reads: `web/next.config.mjs` (loader lines 7–26; headers only `/sw.js`), `compose.yaml` (ports line 23 `"3000:3000"`), `.env.example` (no WEB_BIND_ADDR), `docs/DEPLOY.md` (env table at "Configure environment" — insertion point), root `vitest.config.ts` (includes `web|worker|shared/**/*.test.ts` → new web tests run in default `pnpm test`), root `package.json` (`packageManager: pnpm@11.9.0` — `pnpm/action-setup@v4` reads it), default branch `main` (git symbolic-ref).
- `shared/src/delivery/__tests__/email-body.test.ts` already asserts script/event-handler/`javascript:`/`data:` stripping (lines 55–102) — the audit's S13 "add a test" recommendation was already satisfied except the SVG-SMIL case, which Task 3 adds. The audit's B4 pass skipped test review, which explains the miss.
- `@mozilla/readability` has exactly one call site (`shared/src/pipeline/scraper.ts:232`, `new Readability(doc).parse()` — stable across 0.5→0.6) and is an esbuild external in `worker/package.json` (no bundling concern).
- Compose interpolation of `${WEB_BIND_ADDR:-127.0.0.1}` from the project-root `.env` follows the compose spec (works under both `docker compose` and `podman compose`); the `:-` form treats set-but-empty as unset and silently falls back to loopback — the never-empty warning exists because the failure direction is a silently ignored override, not a broken mapping (Spec §6).
