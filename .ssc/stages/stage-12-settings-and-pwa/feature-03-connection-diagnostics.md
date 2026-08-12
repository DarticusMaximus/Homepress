# Feature 03: Connection diagnostics

## Intent

From Settings, let the operator prove OpenRouter, SMTP, and public URL with pass/fail (and warn where appropriate) and an operator-readable reason, so they can trust delivery and RSS links without guessing from a live run or send.

## Spec

Add **connection diagnostics** to the Feature 02 Settings **Connections** section: three separate Test/Check controls that exercise the **saved, resolved** settings (GUI → `.env` → default via Feature 01’s `resolveOperatorSettings`). This feature owns **shared probe helpers**, **Settings server actions**, and **Connections UI**. It does **not** rewire pipeline/delivery/RSS production callers (Feature 04), change the Settings store schema, or add PWA (Feature 05).

### What each check proves (PM-pinned)

| Check | Behavior |
|-------|----------|
| **OpenRouter** | Resolve API key. If `source: "none"` → **Fail** immediately (“OpenRouter API key is not set”) — no network. Else `GET` OpenRouter key-info at `{baseUrl}/key` (default base `https://openrouter.ai/api/v1`, same family as `LLMClient`) with `Authorization: Bearer <resolved key>`. **Pass** on 2xx. **Fail** on 401/other HTTP/network/timeout with a sanitized operator-readable reason. No chat/completion — no model spend. |
| **SMTP** | Resolve SMTP bundle. If `source: "none"` → **Fail** (“SMTP is not configured”) — no network. Else send a real test email via nodemailer using the resolved config. **To = From** (resolved `from`, which already falls back to username). No recipient prompt / no newsletter recipient list. Subject/body: short Homepress SMTP test copy (exact wording flexible). **Pass** when `sendMail` succeeds. **Fail** on send/config/timeout with sanitized reason — never include password. |
| **Public URL** | Resolve public URL. If `source: "none"` or value missing → **Fail** (“Public URL is not set”). If somehow not absolute `http:`/`https:` → **Fail** with clear invalid reason. Else server-side `GET` the resolved base URL (timeout ~10–15s; follow redirects within reason). **Pass** on final 2xx. **Warn** (not hard Fail) on timeout / connection refused / DNS / TLS / non-2xx — message must say the server could not reach the URL and that browsers/RSS clients may still work; include the resolved URL in the message for spot-check. |

### Shared result shape (pinned)

```ts
type ConnectionDiagnosticStatus = "pass" | "fail" | "warn";

type ConnectionDiagnosticResult = {
  status: ConnectionDiagnosticStatus;
  /** Operator-facing; never contains API key or SMTP password. */
  message: string;
};
```

- OpenRouter and SMTP use only `pass` | `fail` (no `warn`).
- Public URL may return `pass` | `fail` | `warn`.
- Prefer returning results over throwing for expected probe outcomes; unexpected infra errors may still surface via action-level generic mapping.

### Settings / values under test (PM-pinned)

- Always use **saved** resolved settings via `resolveOperatorSettings` (and Appwrite client as Feature 01/02).
- **Do not** probe unsaved form drafts.
- Helper copy near the Test controls: uses saved settings — Save Connections first if you just changed them.
- Diagnostics may call the resolver even though Feature 04 has not yet rewired production send/run paths — that is intentional for this feature.

### UI (PM-pinned)

| Element | Behavior |
|---------|----------|
| Placement | Inside Connections section on `/settings` (Feature 02 handoff) |
| Controls | Three separate buttons: **Test OpenRouter**, **Test SMTP**, **Check public URL** — not “Test all” |
| Pending | Per-button `useTransition` (or equivalent); label → “Testing…” / “Checking…” while pending |
| Toast | Success toast on `pass`; error toast on `fail`; warn toast (or distinct non-error toast) on `warn` — mirror Feeds `TestFeedButton` spirit |
| Inline status | Under each control: Pass / Fail / Warn + reason; lasts until next test of that control or page reload. **Do not** persist last-test history to Appwrite |
| SMTP | No recipient field / dialog |
| Secrets | Never display or return key/password values |

### Actions (pinned)

Add Settings server actions (names flexible), e.g. in `web/app/(protected)/settings/actions.ts`:

- `testOpenRouterConnectionAction()`
- `testSmtpConnectionAction()`
- `checkPublicUrlAction()`

Each: get Appwrite client → call shared diagnostic → return `{ status, message }` (or thin wrapper). Never include secrets in the result. Log failures with existing redact helpers only.

### Timeouts (PM-pinned)

Hard timeout per probe ~**10–15s** (`AbortSignal.timeout` or nodemailer-equivalent). On timeout → `fail` for OpenRouter/SMTP; `warn` for public URL (unreachable-from-server class).

### Out of scope (explicit)

- Rewiring pipeline/delivery/RSS callers to the resolver (Feature 04)
- Persisting diagnostic history on `app_settings` or elsewhere
- “Test all” / single combined probe
- Testing unsaved form values
- Mid-job live reload
- PWA (Feature 05)
- Appwrite / TZ / worker-poll diagnostics

## Dependencies

- Builds on: **feature-01-settings-store-and-resolution** (`resolveOperatorSettings`, SMTP all-or-nothing, secret never-log), **feature-02-settings-panel** (Connections section on `/settings`, secret-stripped DTO — diagnostics hang here).
- Patterns: Feeds `TestFeedButton` / `testFeed` toast UX; delivery nodemailer + `SmtpConfig`; `LLMClient` OpenRouter base URL; `sanitizeAppwriteMessageForLog` / existing redact helpers.
- Feature 01 APIs must be present for shared probes; Feature 02 Connections UI is the hang point (may mock either in unit tests).

## Constraints

- Never return or log OpenRouter API key or SMTP password in plain form.
- Do not change Feature 01 schema/write contracts.
- Do not rewire production `sendIssueEmail` / pipeline / RSS readers (Feature 04).
- Do not move retention or add diagnostics outside Connections.
- Public URL unreachable-from-server must be **warn**, not hard fail (hairpin/NAT false alarms).
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] From Settings → Connections, operator can Test OpenRouter, Test SMTP, and Check public URL as three separate controls.
- [ ] OpenRouter check uses resolved key + OpenRouter key-info GET; pass/fail with readable reason; no chat completion.
- [ ] SMTP check sends a real test email To=From using resolved SMTP; no recipient prompt; pass/fail with readable reason; password never in messages.
- [ ] Public URL: fail if unset/invalid; pass on reachable 2xx; warn (not fail) when the server cannot reach a configured URL.
- [ ] Checks use saved resolved settings only; UI helper tells the operator to Save Connections first if they just edited.
- [ ] Results show via toast + ephemeral inline status; no Appwrite last-test persistence.
- [ ] Tests cover probe outcomes, secret stripping, warn-vs-fail for public URL, and UI controls; `pnpm typecheck` and `pnpm lint` pass.

## Files

- Create: `shared/src/settings/connection-diagnostics.ts` (name flexible)
- Create: `shared/src/settings/__tests__/connection-diagnostics.test.ts`
- Modify: `shared/src/settings/index.ts` (re-exports)
- Modify: `web/app/(protected)/settings/actions.ts` (add three diagnostic actions)
- Modify: `web/components/settings/connections-settings.tsx` (or Feature 02 Connections component — hang Test controls)
- Create or modify: `web/src/__tests__/settings-diagnostics-actions.test.ts` (and/or extend `settings-actions.test.ts`)
- Create or modify: `web/src/__tests__/settings-diagnostics-panel.test.tsx` (and/or extend `settings-panel.test.tsx`; remove/relax Feature 02 “no diagnostics” assertions that would conflict)
- Optional: `web/components/settings/connection-diagnostic-button.tsx` if it keeps Connections cleaner

## Testing approach

Test-first. Behavior under Intent — not pixel trivia.

1. **OpenRouter** — missing key → fail, no fetch; 2xx key endpoint → pass; 401 → fail with sanitized message; assert Authorization header used in mock fetch; assert no `/chat/completions` call.
2. **SMTP** — missing config → fail, no send; success path asserts `to === from` and sendMail called; send error → fail; password absent from `message`.
3. **Public URL** — unset → fail; mock 2xx GET → pass; mock network/timeout/non-2xx → **warn** (not fail); message includes resolved URL on warn path when applicable.
4. **Secrets** — action/unit results never contain key/password strings even when mocks throw rich errors (redact/sanitize).
5. **Actions** — each action maps shared result through; Appwrite/resolve failures → operator-safe error.
6. **UI** — three controls present; pending labels; toast on pass/fail/warn; inline status updates; helper about saved settings; no recipient field for SMTP.
7. **Feature 02 conflict** — update any “assert no Test/Diagnose controls” tests from Feature 02 so they no longer block Feature 03.

Prefer mocking `fetch` / nodemailer transport / `resolveOperatorSettings` in unit tests (no live network).

### Research note

- OpenRouter: `GET /api/v1/key` (key info for current Bearer token) — Context7 OpenAPI + openrouter.ai docs; avoids chat spend.
- Codebase: `LLMClient` default base `https://openrouter.ai/api/v1`; nodemailer in `send-issue-email.ts` (To=From pattern); Feeds `TestFeedButton`; Feature 01 resolver; Feature 02 Connections hang point.
- Grill 2026-08-11: three separate checks; OpenRouter key GET; SMTP real mail to self (From); public URL GET with warn-on-unreachable; saved settings only; toast + inline ephemeral status; no history persist.

## Tasks

### Task 1: Failing tests for diagnostics contract

- **Action**: Add `shared/src/settings/__tests__/connection-diagnostics.test.ts` covering OpenRouter/SMTP/public-URL cases above (including public-URL **warn**). Add/extend web action + panel tests for the three actions, secret stripping, three UI controls, saved-settings helper, and no SMTP recipient field. Update Feature 02 “no diagnostics” assertions so they expect the new controls (or move that negative assert out). Prefer red before implementation.
- **Expected result**: New/updated tests exist and fail for missing exports/UI/behavior.
- **Verify**: `pnpm --filter @newsletter/shared test` and `pnpm --filter web test` show the new cases failing for the right reason (missing module/behavior), not syntax errors.
- **Depends on**: none (mock Feature 01 resolver / Feature 02 components as needed).

### Task 2: Shared connection diagnostic helpers

- **Action**: Implement `shared/src/settings/connection-diagnostics.ts` (names flexible): `diagnoseOpenRouterConnection`, `diagnoseSmtpConnection`, `diagnosePublicUrl` (or a small cohesive API). Each accepts resolved values and/or loads via `resolveOperatorSettings` with injectables (`fetch`, nodemailer transport factory, timeoutMs, optional pre-resolved settings) for tests. Enforce PM-pinned pass/fail/warn rules, ~10–15s timeouts, To=From test mail, OpenRouter `GET {base}/key`, never log secrets. Export from `shared/src/settings/index.ts`. Make shared diagnostic tests green.
- **Expected result**: Shared probes match Spec; unit-testable without live network.
- **Verify**: Shared connection-diagnostics tests green.
- **Depends on**: Task 1.

### Task 3: Settings diagnostic server actions

- **Action**: Add the three actions to `web/app/(protected)/settings/actions.ts`. Wire `getServerAppwrite` + shared diagnostics. Return `{ status, message }` (shape flexible but stable for UI). Map unexpected errors to generic operator-safe messages; never return secrets. Unit-test actions to green with mocked shared helpers.
- **Expected result**: Actions callable from the Settings client; contract covered by tests.
- **Verify**: Settings diagnostics action tests green.
- **Depends on**: Task 2.

### Task 4: Connections UI Test controls

- **Action**: Hang **Test OpenRouter**, **Test SMTP**, and **Check public URL** on the Connections section component. Per-button pending state, toast on outcome, ephemeral inline Pass/Fail/Warn + reason, saved-settings helper copy, no SMTP recipient UI. Remove Feature 02 “no diagnostics” product constraint from UI tests as already adjusted in Task 1.
- **Expected result**: Operator can run all three checks from `/settings` Connections.
- **Verify**: Panel/diagnostics component tests green.
- **Depends on**: Task 3.

### Task 5: Monorepo gates

- **Action**: Run shared + web diagnostics-related tests and full `pnpm typecheck` / `pnpm lint`; fix fallout only as needed for this feature.
- **Expected result**: Gates clean; diagnostics complete without Feature 04 rewiring or history persistence.
- **Verify**: Relevant test suites green; `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test` (connection-diagnostics suite) && `pnpm --filter web test` (settings diagnostics / panel / actions suites) && `pnpm typecheck` && `pnpm lint`
- Expected: Probe contracts (OpenRouter key GET, SMTP To=From, public URL warn-on-unreachable), actions, and Connections UI tests pass; typecheck and lint clean; no production delivery/pipeline caller rewiring; no Appwrite last-test fields added.

## Handoff

Builder reports: files changed; exact diagnostic function and action names; confirmation OpenRouter uses key-info GET not chat; confirmation SMTP To=From with no recipient prompt; confirmation public URL unreachable → `warn`; confirmation saved resolved settings only; confirmation secrets never in results/logs; confirmation no Feature 04 rewiring and no last-test persistence; any deviation (file split, toast variant for warn, timeout ms) and why. Note for Feature 04: diagnostics already resolve via `resolveOperatorSettings` — production send/run/RSS should use the same resolver next.
