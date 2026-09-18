# Feature 07: Harden stage-16 against review findings (2026-09-18)

## Intent

Harden `stage-16-security-and-roles` against findings from `review-stage-16-security-and-roles-2026-09-18`: close the arch-test discovery hole, pin the SSRF dispatcher with a real-socket smoke, make claim+heartbeat atomic, close the draft-scheme-scrub bypasses, and pick up the accepted Low residuals — without reopening features 01–06.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–06 stay `verified`. Distilled work — not a copy of the report.

**PM triage (2026-09-18):** Address now on S1, S2, S3, C1, N1 (+S9 folded), N2, S4, S5, S6, S7, S8, C3, C6, M1, M2, T1, T2, U1, X1. **Dismiss:** C2 (`enc1:` SMTP prefix), C4 (surrogate split), C5 (indented-code over-scrub).

### Cluster 1 — Arch-test net (S1 Medium, N2 Low)

`web/components/health-card/actions.ts` exports `revalidateHealthCheck` with `"use server"` and no guard. The arch test only walks `web/app` for files named `actions.ts`.

**Fix:**

1. `await requireOperator();` as the first statement of `revalidateHealthCheck` (outside any try/catch). Import from `@/lib/auth/require-operator`.
2. Widen `web/src/__tests__/server-actions-auth.test.ts` discovery: scan all of `web/` (not just `web/app`) for files whose source contains a top-level `"use server"` directive (not filename `actions.ts` only). Keep the login allowlist. Bump the discovery self-check floor to include the health-card module (non-allowlisted count ≥ 9).
3. Static check: strip comments and string/template literals before the `requireUser()`/`requireOperator()` regex; treat unparseable bodies as failures (no silent `continue`); also match `export const X = async` arrow forms. Runtime unauth + reader scenarios unchanged and still authoritative.
4. AGENTS.md "ONLY exempt module is login" wording: any `"use server"` module outside the discovered set is a violation unless consciously allowlisted.

### Cluster 2 — Secrets hygiene (S2 Medium, S6 Low, C3 Low, M2 Low)

**S2:** Add `SETTINGS_SECRET_KEY` to `SECRET_ENV_KEYS` in `web/next.config.mjs`. Pin in `web/src/__tests__/next-config.test.ts` (production unset / development set from fixture).

**S6:** `import "server-only"` as the first line of `shared/src/pipeline/llm-client.ts`, `shared/src/delivery/smtp-config.ts`, `shared/src/settings/repository.ts`, and `shared/src/settings/connection-diagnostics.ts`. Worker/vitest already resolve the no-op via `--conditions=react-server` / stub.

**C3:** When only the SMTP password is unreadable, keep non-secret SMTP attrs (host/port/username/from/secure) in the read model instead of returning `UNSET_SMTP` for all six. Banner copy already says re-enter secrets; do not blank fields the operator never lost. Clear SMTP still works. Unrelated Connections saves must not be blocked solely because the password is unreadable *and* the form prefills empty host.

**M2:** Delete `validateOperatorSettings`, `OperatorSettingsInput`, `ValidatedOperatorSettings`, and their tests. Keep live section validators (`validateSmtpBundle`, `validatePipelineKnobsSettings`, `validateOpenRouterApiKey`).

### Cluster 3 — Draft-normalize bypasses (S3 Medium)

In `shared/src/pipeline/draft-normalize.ts`:

1. After `(` in inline links/images, skip CommonMark `spnl` (optional whitespace including up to one line ending) before the destination.
2. After `:` in a link definition, skip the same `spnl` before the destination.
3. Before the scheme test, treat a destination containing a backslash before the first `:` as bad (or unescape then re-test).

Benign `[a](\nhttps://ok.example)` stays byte-identical. Do not reopen dismissed C5 (indented-code exemption).

### Cluster 4 — Reaper atomicity (C1 Medium, T2 Low)

1. `markRunning`'s `updateDocument` payload also sets `lastHeartbeatAt: new Date().toISOString()` so pending→running and the first beat are one write. Keep the 30s interval pulse.
2. After N consecutive `touchRunHeartbeat` failures (N=3), abort the run (`markFailed` with a heartbeat-stall message) instead of continuing heartbeat-less while the reaper is live.
3. Add repository-level tests for `touchRunHeartbeat`: payload keys exactly `["lastHeartbeatAt"]`; 404 → `not_found`; other errors wrapped. Add a `markRunning` assertion that `lastHeartbeatAt` is present.

### Cluster 5 — SSRF evidence (N1 Medium, S9 Low, S8 Low, T1 Low)

**N1+S9:** Add a real-socket test (no `globalThis.fetch` mock) that starts a `node:http` listener on `127.0.0.1:0`, calls `fetchWithSizeLimit` on that URL, expects `BlockedTargetError` (`blocked-range`), and asserts the server received zero requests. Lives in `shared/src/pipeline/__tests__/fetch-safety.test.ts` (or a sibling `fetch-safety.smoke.test.ts` included by default `pnpm test`). This is the worker/Node path. For the web path (S9): either run the same assertion against a captured pristine `fetch` used by `fetchWithSizeLimit`, or document in a file-top comment on `fetch-safety.ts` that Next's patched fetch is bypassed by holding `const rawFetch = globalThis.fetch` at module load — implement the capture if the smoke cannot otherwise prove the web path.

**S8:** `isPubliclyRoutableUrl` returns `{ ok: false, reason: REASON_UNRESOLVABLE }` when the resolver yields an empty array.

**T1:** Add `it.each` cases to `ssrf.test.ts` and `fetch-safety.test.ts` for `http://2130706433/`, `http://0x7f.1/`, `http://0177.0.0.1/`, `http://[fe80::1%25eth0]/` → blocked; numeric forms do not consult the resolver.

### Cluster 6 — Persist hygiene (S4 Low, S5 Low)

**S4:** Gate every exported repository function that interpolates a caller-supplied id into `documentId` through `isValidAppwriteDocumentId` (throw the existing domain `not_found`). Minimum set: `markRunning`, `touchRunHeartbeat`, `markFailed`, `markCompleted`, `updateNewsletter`, `updateFeed`. Extend the malformed-id matrix to one writer per repository.

**S5:** In `markFailed`, map `failedFeeds` through `redactMessageForStorage` on each `errorMessage` before `JSON.stringify`. In `applyFeedFetchOutcomes` (`shared/src/feeds/health.ts`), persist `lastFetchError` via `redactMessageForStorage`, not raw `.slice`.

### Cluster 7 — Accounts + bootstrap (C6 Low, U1 Low, S7 Low)

**C6:** `listAccounts` paginates with Appwrite cursor/`cursorAfter` until `total` is reached (or loop until a short page).

**U1:** Map Appwrite `user_already_exists` / code 409 in `createReaderAccount` to `AccountAdminError("validation", "An account with this email already exists")`. Other Appwrite failures keep the generic safe string.

**S7:** In `shared/scripts/bootstrap-operator.mjs`, after listing, refuse to label unless `String(existing.email ?? "").toLowerCase() === email`; exit non-zero with a clear mismatch message.

### Cluster 8 — RSS 500 (X1 Low)

`AppPublicUrlError` 500 response includes `Cache-Control: no-store`. Log record gains `phase: "rss-route-public-url"`.

### Cluster 9 — Orchestrator types (M1 Low)

Do **not** thread `privateFeedUrls` through `runPipeline` (parity-run is public-only by design). Remove the misleading option fields from `PipelineOptions` **or** add a one-line comment on `runPipeline` and the option types stating they are unused by `runPipeline` / parity-only / always public-only. Prefer the comment if removing the fields would churn execute-run types. Either way, types must not imply `runPipeline` honors the flags unless it does.

## Dependencies

- Builds on: features 01–06 of this stage (already `verified`).
- Anchor: `.ssc/reviews/review-stage-16-security-and-roles-2026-09-18.md`.

## Constraints

- **Do not reopen** features 01–06 status; this is additive hardening.
- **Keep** `web/app/login/actions.ts` anonymous-reachable.
- **Keep** per-feed `allowPrivateNetwork` as the only SSRF opt-out (no global env bypass).
- **Keep** cipher-unset plaintext + warning; invalid key still refuses secret writes.
- **Keep** render-layer image strip and `rel` hardening (S14) — this feature does not change channel policy.
- Do not add CSP. Do not implement atomic multi-worker claiming (C3 deferred).
- Do not address dismissed C2/C4/C5.

## Acceptance criteria

- [ ] Every top-level `"use server"` file under `web/` is discovered or consciously allowlisted; `revalidateHealthCheck` rejects unauth/reader; static check fails on comment-only guards, unparseable bodies, and ungated arrow exports. (S1, N2)
- [ ] `SETTINGS_SECRET_KEY` is in `SECRET_ENV_KEYS` and asserted by `next-config.test.ts`. (S2)
- [ ] `llm-client.ts`, `smtp-config.ts`, `settings/repository.ts`, `connection-diagnostics.ts` begin with `import "server-only"`. (S6)
- [ ] Unreadable SMTP password does not blank stored non-secret SMTP fields in the read model. (C3)
- [ ] `validateOperatorSettings` / `OperatorSettingsInput` / `ValidatedOperatorSettings` are gone. (M2)
- [ ] `normalizeDraftMarkdown` reduces the three hostile constructs (newline-after-`(`, next-line definition, backslash-escaped colon); benign `https` newline variant stays byte-identical. (S3)
- [ ] `markRunning` stamps `lastHeartbeatAt` in the same write; `touchRunHeartbeat` has payload-exactness tests; N consecutive pulse failures abort the run. (C1, T2)
- [ ] A real-socket (unmocked fetch) test refuses a live loopback target with `BlockedTargetError` and zero server hits. (N1, S9)
- [ ] Empty resolver answer → `isPubliclyRoutableUrl` `ok: false`. (S8)
- [ ] Obfuscated IPv4 / zone-ID cases exist and pass in both SSRF suites. (T1)
- [ ] Named update-writers reject malformed ids before any SDK call. (S4)
- [ ] `failedFeeds` JSON and `lastFetchError` go through `redactMessageForStorage`. (S5)
- [ ] `listAccounts` returns every user across pages. (C6)
- [ ] Duplicate-email create shows a fixed "already exists" message. (U1)
- [ ] Bootstrap script refuses to label a user whose email does not match. (S7)
- [ ] RSS 500 carries `Cache-Control: no-store`. (X1)
- [ ] `runPipeline` either does not advertise unused trust flags or documents that it ignores them. (M1)
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.

## Files

- Modify: `web/components/health-card/actions.ts`
- Modify: `web/src/__tests__/server-actions-auth.test.ts`
- Modify: `AGENTS.md`
- Modify: `web/next.config.mjs`, `web/src/__tests__/next-config.test.ts`
- Modify: `shared/src/pipeline/llm-client.ts`, `shared/src/delivery/smtp-config.ts`, `shared/src/settings/repository.ts`, `shared/src/settings/connection-diagnostics.ts`
- Modify: `shared/src/settings/operator-settings.ts` (+ its test)
- Modify: `web/lib/settings-panel.ts` / settings tests as needed for C3
- Modify: `shared/src/pipeline/draft-normalize.ts`, `shared/src/pipeline/__tests__/draft-normalize.test.ts`
- Modify: `shared/src/runs/repository.ts`, `shared/src/runs/execute-run.ts`, `shared/src/runs/__tests__/repository.test.ts`, `shared/src/runs/__tests__/execute-run.test.ts`
- Modify: `shared/src/pipeline/fetch-safety.ts`, `shared/src/pipeline/__tests__/fetch-safety.test.ts`
- Modify: `shared/src/feeds/ssrf.ts`, `shared/src/feeds/__tests__/ssrf.test.ts`
- Modify: `shared/src/newsletters/repository.ts`, `shared/src/feeds/repository.ts`, `shared/src/feeds/health.ts` (+ tests)
- Modify: `web/lib/accounts/account-admin.ts`, `web/src/__tests__/account-admin.test.ts`
- Modify: `shared/scripts/bootstrap-operator.mjs`
- Modify: `web/app/rss/[newsletterId]/route.ts`, `web/src/__tests__/rss-feed-route.test.ts`
- Modify: `shared/src/pipeline/orchestrator.ts`
- Modify: `.ssc/reviews/review-stage-16-security-and-roles-2026-09-18.md` (tick addressed findings)

## Testing approach

Test-first per cluster. Red runs recorded in the handoff for Clusters 1, 3, 4, 5.

- Arch test: first run after widening discovery fails on `revalidateHealthCheck`; green after the guard. Mutation probes for N2 (comment-only guard, arrow export) are verifier-executed, not permanent cases — or add them as permanent if cheap.
- next-config: `SETTINGS_SECRET_KEY` in the fixture; prod unset / dev set.
- draft-normalize: the three hostile cases + benign newline-https.
- markRunning / touchRunHeartbeat / pulse-abort: repository + execute-run tests.
- fetch-safety smoke: real loopback server, unmocked fetch.
- ssrf empty-array + obfuscated literals.
- redact `failedFeeds` / `lastFetchError`.
- listAccounts two-page stub; createReader 409; RSS 500 header.

## Tasks

### Task 1: Arch-test net (S1, N2)

- **Action**: Guard `revalidateHealthCheck`; widen discovery to every `"use server"` file under `web/`; harden the static check (strip comments/strings, fail unparseable bodies, match arrow exports); update AGENTS.md.
- **Expected result**: Health-card module is in the discovered set and rejects unauth/reader; login remains allowlisted.
- **Verify**: `pnpm vitest run web/src/__tests__/server-actions-auth.test.ts` passes; `rg -n "requireOperator" web/components/health-card/actions.ts` hits.
- **Depends on**: none.

### Task 2: Secrets hygiene (S2, S6, C3, M2)

- **Action**: Denylist `SETTINGS_SECRET_KEY`; `import "server-only"` on the four remaining secret modules; keep non-secret SMTP attrs when only the password is unreadable; delete the dead full-object validator + tests.
- **Expected result**: X2 denylist complete; client-graph import of those modules still fails the build (existing plumbing); key-loss form still shows host; `rg validateOperatorSettings shared/src` is empty except history.
- **Verify**: `pnpm vitest run web/src/__tests__/next-config.test.ts shared/src/settings` passes; `pnpm typecheck` passes.
- **Depends on**: none.

### Task 3: Draft-normalize bypasses (S3)

- **Action**: Add red cases for newline-after-`(`, next-line definition, backslash-escaped colon (and benign newline-https). Implement `spnl` skip + backslash-as-bad in `draft-normalize.ts`.
- **Expected result**: Hostile cases reduce to text; benign newline-https byte-identical.
- **Verify**: `pnpm vitest run shared/src/pipeline/__tests__/draft-normalize.test.ts` passes.
- **Depends on**: none.

### Task 4: Reaper atomicity (C1, T2)

- **Action**: Stamp `lastHeartbeatAt` inside `markRunning`; abort after 3 consecutive pulse failures; add `touchRunHeartbeat` repository tests (payload-exactness + 404 + wrap).
- **Expected result**: No running run is observable without a fresh heartbeat field from the claim write.
- **Verify**: `pnpm vitest run shared/src/runs/__tests__/repository.test.ts shared/src/runs/__tests__/execute-run.test.ts` passes.
- **Depends on**: none.

### Task 5: SSRF evidence (N1, S9, S8, T1)

- **Action**: Real-socket loopback smoke (unmocked fetch); empty-array fail-closed in `isPubliclyRoutableUrl`; obfuscated-literal cases in both suites; pristine-fetch capture at module load if needed so the dispatcher cannot be dropped.
- **Expected result**: Live loopback fetch is refused with zero server hits; empty DNS is unresolvable at both gates; sneaky IP spellings blocked.
- **Verify**: `pnpm vitest run shared/src/pipeline/__tests__/fetch-safety.test.ts shared/src/feeds/__tests__/ssrf.test.ts` passes.
- **Depends on**: none.

### Task 6: Persist hygiene (S4, S5)

- **Action**: Id-gate the named update-writers; redact `failedFeeds` error messages and `lastFetchError`.
- **Expected result**: Malformed writer ids throw domain `not_found` with zero SDK calls; token in `failedFeeds` stores `[redacted]`.
- **Verify**: `pnpm vitest run shared/src/runs/__tests__/repository.test.ts shared/src/newsletters/__tests__/repository.test.ts shared/src/feeds/__tests__/repository.test.ts shared/src/feeds` passes.
- **Depends on**: Task 4 (same `markRunning` / `markFailed` files — run after to avoid churn).

### Task 7: Accounts + bootstrap (C6, U1, S7)

- **Action**: Paginate `listAccounts`; map 409 to a validation "already exists" message; bootstrap email equality check before `updateLabels`.
- **Expected result**: Two-page stub returns all records; duplicate email is actionable; script will not label a mismatched email.
- **Verify**: `pnpm vitest run web/src/__tests__/account-admin.test.ts` passes; `node --check shared/scripts/bootstrap-operator.mjs` passes.
- **Depends on**: none.

### Task 8: RSS 500 + orchestrator comment (X1, M1)

- **Action**: RSS `AppPublicUrlError` 500 gets `Cache-Control: no-store` + `phase` on the log. Comment (or trim types) so `runPipeline` does not imply it honors `privateFeedUrls`.
- **Expected result**: rss-feed-route test asserts no-store on 500; orchestrator types/docs match behavior.
- **Verify**: `pnpm vitest run web/src/__tests__/rss-feed-route.test.ts` passes; `pnpm typecheck` passes.
- **Depends on**: none.

### Task 9: Full gates + report ticks

- **Action**: `pnpm typecheck && pnpm lint && pnpm test`. Tick the Address-now finding checkboxes in `.ssc/reviews/review-stage-16-security-and-roles-2026-09-18.md`. Leave dismissed C2/C4/C5 unchecked (or mark dismissed in the triage table — already recorded).
- **Expected result**: Gates green; report reflects addressed findings.
- **Verify**: Three commands exit zero; report shows `[x]` for the Address-now IDs.
- **Depends on**: Tasks 1–8.

## Feature verification

- Run: `pnpm test && pnpm typecheck && pnpm lint`
- Expected: All pass. Arch test discovers the health-card module. Real-socket fetch-safety case green. draft-normalize hostile cases green.

## Handoff

Report to the manager: files created/modified; red-run evidence for Tasks 1, 3, 4, 5; confirmation that dismissed C2/C4/C5 were not implemented; any deviations and why (guard semantics must not weaken). Anchor: `.ssc/reviews/review-stage-16-security-and-roles-2026-09-18.md`.
