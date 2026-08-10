# Feature 02: Email delivery

## Intent

Let the operator manually email a completed issue to that newsletter’s recipient list (multipart HTML + plain text via `.env` SMTP) from the Issues UI, so a finished draft can leave the app during tuning — without auto-delivery or lasting delivery-status UI yet.

## Spec

Implement **manual email send** for an eligible issue: load the completed draft, derive multipart bodies, send via Nodemailer using SMTP credentials from `.env`, and surface immediate success/failure feedback on the issue detail page. Recipients come only from Feature 01’s `recipientEmails` (no per-send picker). This feature does **not** auto-send after runs (Feature 05), persist delivery status (Feature 06), publish RSS (Feature 03), or export downloads (Feature 04) — but it **does** own the shared draft→HTML converter and the shared send orchestration that those features will reuse.

### SMTP `.env` contract (locked)

| Variable | Required | Behavior |
|----------|----------|----------|
| `SMTP_HOST` | yes (to send) | Hostname. Missing/blank → config error before connect. |
| `SMTP_PORT` | yes (to send) | Integer port (e.g. `587` or `465`). Missing/invalid → config error. |
| `SMTP_USERNAME` | yes (to send) | Auth user. Missing/blank → config error. |
| `SMTP_PASSWORD` | yes (to send) | Auth password. Missing/blank → config error. |
| `SMTP_FROM` | no | From header value (may include display name, e.g. `Tech Digest <news@example.com>`). If unset/blank → use `SMTP_USERNAME` as From. |
| `SMTP_SECURE` | no | `true` / `1` / `yes` (case-insensitive) → Nodemailer `secure: true` (implicit TLS, typical 465). Anything else / unset → `secure: false` (STARTTLS upgrade, typical 587). |

Document all six keys in `.env.example` with short comments (no live secrets). Do **not** add a GUI for SMTP.

### Multipart body derivation (locked)

Export pure helpers from shared (Feature 04 will reuse the HTML path):

| Helper | Behavior |
|--------|----------|
| `draftMarkdownToEmailHtml(markdown: string): string` | Convert draft markdown to email-safe HTML. Support GFM basics used in drafts (headings, paragraphs, lists, links, emphasis, fenced code, tables). Output is an HTML **fragment** suitable as Nodemailer `html` (no full document chrome required unless a minimal wrapper is needed for client quirks — prefer fragment). Not a clone of in-app `prose` styles. |
| `draftMarkdownToEmailText(markdown: string): string` | Plain-text part = the draft markdown string as-is (after normalizing `\r\n` → `\n`). No fancy plaintext rewriter. |

**Library (locked):** add `marked` to `@newsletter/shared` for HTML conversion (GFM enabled). Do not pull `react-markdown` into shared.

**Subject (locked):** `resolveIssueDisplayTitle({ markdown, newsletterName, dateIso })` with `dateIso = run.endedAt ?? run.startedAt`. Future issue-title generator is out of scope.

### Recipient addressing (locked)

- Recipients = that newsletter’s `recipientEmails` (already normalized/validated by Feature 01).
- Put the full list in Nodemailer **`bcc`** (colleagues / family must not see each other’s addresses).
- Set visible **`to`** to the resolved From address (same mailbox the operator sends as). Do not put recipient emails in `to` or `cc`.
- Empty list after load → do not send; operator-facing error: `No recipients configured for this newsletter`.
- Re-send is always allowed (no “already emailed” gate — Feature 06 owns lasting status).

### Shared send orchestration (locked)

Add a shared entry point (name may vary slightly; keep intent):

```ts
sendIssueEmail(client, runId, options?: { transport?: Transporter }): Promise<SendIssueEmailResult>
```

Orchestration order:

1. `loadIssueDraft(client, runId)` — on failure / empty draft, do not call SMTP. Locked operator-facing errors:
   - `IssueLoadError` (any code: not_found / not_eligible / checkpoint_missing / appwrite) → `Couldn’t load this issue for sending`
   - Empty or whitespace-only `markdown` after a successful load → `Issue draft is empty`
2. `getNewsletter(client, run.newsletterId)` — read `recipientEmails`. Empty list → `No recipients configured for this newsletter` (no SMTP). On `not_found` / Appwrite failure → `Couldn’t load newsletter for sending` (no SMTP).
3. Resolve SMTP config from `process.env` — missing/invalid → error naming which requirement failed (never include password in the message).
4. Build `subject`, `html`, `text` via helpers above.
5. `sendMail` with `from`, `to` (From address), `bcc` (recipients), `subject`, `html`, `text`.
6. Return success with `recipientCount` (and optionally messageId if useful for logs).

**SMTP send failure (locked operator-facing):** `Failed to send email` (details may be logged sanitized; toast/action returns this stable string, never credentials).

**Transport injection (locked):** production creates a Nodemailer SMTP transport from resolved config; tests inject a mock `sendMail` transport — **no live SMTP in unit tests**. Default transport creation lives with orchestration (Task 4); Task 3 only ships config resolution + failing orchestration tests.

**Logging (locked):** never log `SMTP_PASSWORD`, full auth objects, or raw env dumps. On SMTP failure, log sanitized error type/message only (reuse existing redact helpers where applicable). Operator-facing error must not echo credentials.

### Manual Send UI (locked)

- Surface: issue detail success path only (`IssueReader` when markdown loaded — not list, not load-error / not-available).
- Control: **Send** button (label locked: `Send`). Placement: in the chrome row with Back / Inspect (same flex wrap), or immediately under the meta line — reachable on phone widths; do not require a confirmation dialog.
- Server action (e.g. `sendIssueEmailAction(runId)` in `web/app/(protected)/issues/actions.ts` or colocated): calls shared `sendIssueEmail` with `getServerAppwrite()`.
- Feedback: `toast.success` on success naming recipient count (e.g. `Sent to N recipients`); `toast.error` with the operator-facing message on failure. Match existing sonner patterns.
- In-flight: disable the Send button while the action is pending (prevent double-send from double-click).
- No delivery-status badges, schema fields, or “last emailed at” in this feature.

### Out of scope

- Auto-email after successful run (Feature 05).
- Persisting email/RSS delivery status or failure reason on runs (Feature 06).
- RSS publish / download export.
- Per-send recipient override, confirmation modal, BCC opt-out.
- Managed ESP SDKs (Resend, etc.).
- Issue title generator.
- Changing Stage 06 reader/inspect semantics beyond adding Send.

## Dependencies

- **Hard execute prerequisite:** **feature-01-newsletter-delivery-config** must be `verified` before this feature is executed. This feature needs `recipientEmails` on `Newsletter`, read coercion in `documentToNewsletter`, and `getNewsletter` returning that field — without Feature 01 code, shared will not typecheck or wire send orchestration. Do not treat Feature 01 as a soft “contract assumed” parallel track.
- Builds on: Stage 06 Issues surface (`loadIssueDraft`, `resolveIssueDisplayTitle`, `IssueReader`).
- Soft consumers: Feature 04 (reuse `draftMarkdownToEmailHtml`), Feature 05 (reuse `sendIssueEmail`), Feature 06 (will record outcomes later).

## Constraints

- Do not start `ssc-execute` for this feature until Feature 01 is verified.
- SMTP credentials live in `.env` only — never in Appwrite documents or client bundles.
- Secrets must not appear in logs, toast copy, or thrown messages.
- Recipients go in **BCC**; visible To is the From address.
- No run-schema changes for delivery status in this feature.
- Server-only send path (Next.js server action + shared); do not expose SMTP from client components.
- Add `nodemailer` (+ `@types/nodemailer` if needed) and `marked` to `@newsletter/shared` (or web only for nodemailer if tree-shaking prefers — **prefer shared** so worker Feature 05 can call the same module without duplicating).
- Match existing error/action result shapes (`{ ok: true, ... } | { ok: false, error: string }`) used elsewhere in web actions.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] `.env.example` documents `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`.
- [ ] Shared helpers convert draft markdown to email HTML and plain text; HTML path is exported for Feature 04 reuse.
- [ ] Shared `sendIssueEmail` loads draft + newsletter recipients, sends multipart via Nodemailer with recipients in BCC and To = From; rejects empty recipients / missing SMTP / unloadable or empty draft without sending.
- [ ] Unit tests cover body conversion, SMTP config resolution, BCC addressing, and orchestration failures with a mock transport (no live SMTP).
- [ ] Issue detail success UI shows a Send button; clicking it invokes the server action; success/error toasts fire; button disables while pending.
- [ ] Re-send is allowed; no delivery-status persistence or auto-email in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Create: `shared/src/delivery/email-body.ts` (HTML + text helpers)
- Create: `shared/src/delivery/smtp-config.ts` (env → config)
- Create: `shared/src/delivery/send-issue-email.ts` (orchestration + transport)
- Create: `shared/src/delivery/index.ts` (re-exports)
- Create: `shared/src/delivery/types.ts` (result / error types as needed)
- Modify: `shared/src/index.ts` (export delivery module)
- Modify: `shared/package.json` (deps: `nodemailer`, `marked`; types as needed)
- Create: `shared/src/delivery/__tests__/email-body.test.ts`
- Create: `shared/src/delivery/__tests__/smtp-config.test.ts`
- Create: `shared/src/delivery/__tests__/send-issue-email.test.ts`
- Modify: `.env.example`
- Create: `web/app/(protected)/issues/actions.ts` (or extend if one already exists)
- Modify: `web/components/issues/issue-reader.tsx` (Send control on success path)
- Create: `web/components/issues/send-issue-button.tsx` (client button + pending + toast; preferred split if `IssueReader` stays server-friendly)
- Create: `web/src/__tests__/send-issue-email-action.test.ts`
- Create: `web/src/__tests__/send-issue-button.test.tsx`
- Modify as needed: `web/app/(protected)/issues/[runId]/page.tsx` if props must pass `runId` into a client Send control (already available)

## Testing approach

Test-first. No live SMTP.

### `email-body.test.ts`

1. **HTML basics** — markdown with heading + paragraph + link produces HTML containing those elements/text.
2. **GFM list / emphasis** — list items and bold/italic render.
3. **Plain text** — `draftMarkdownToEmailText` returns the markdown (newline-normalized); does not strip to bare text.

### `smtp-config.test.ts`

4. **Happy path** — all required vars set → host/port/user/pass/from/secure resolved; From falls back to username when `SMTP_FROM` unset.
5. **SECURE parsing** — `true`/`1`/`yes` → secure true; unset/`false` → secure false.
6. **Missing required** — each of host/port/user/pass missing → config error with stable operator-facing message; password never appears in message.

### `send-issue-email.test.ts`

7. **Success** — mock draft + newsletter with 2 recipients → mock `sendMail` called once with `bcc` = those addresses, `to` = From, both `html` and `text` set, subject = display title; returns recipientCount 2.
8. **Empty recipients** — no `sendMail`; error `No recipients configured for this newsletter`.
8b. **Newsletter load failure** — `getNewsletter` throws `not_found` / Appwrite → no `sendMail`; error `Couldn’t load newsletter for sending`.
9. **Missing SMTP** — no `sendMail`; config error surfaced.
10a. **Draft load failure** — `loadIssueDraft` throws `IssueLoadError` → no `sendMail`; error `Couldn’t load this issue for sending`.
10b. **Empty markdown** — draft loads with `""` or whitespace-only → no `sendMail`; error `Issue draft is empty`.
11. **SMTP transport failure** — `sendMail` rejects → error `Failed to send email`; returned/logged strings must not contain password.

### Web

12. **Send button** — success-path IssueReader (or Send button component) shows Send; load-error / not-available paths do not.
13. **Action success** — mocked shared send → `{ ok: true }`; button test shows success toast with recipient count.
14. **Action failure** — mocked failure → toast.error with message; button re-enabled after settle.
15. **In-flight disable** — while pending, Send is disabled.

## Tasks

### Task 1: Failing tests for email body + SMTP config

- **Action**: Add `shared/src/delivery/__tests__/email-body.test.ts` (cases 1–3) and `smtp-config.test.ts` (cases 4–6). Helpers/modules may not exist yet — tests fail red for missing exports.
- **Expected result**: New tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new delivery body/config assertions failing (not infra errors).
- **Depends on**: none.

### Task 2: Implement draft → multipart body helpers

- **Action**: Add `marked` dependency; implement `draftMarkdownToEmailHtml` and `draftMarkdownToEmailText` in `shared/src/delivery/email-body.ts`; export via `delivery/index.ts` + `shared/src/index.ts`. Make cases 1–3 green.
- **Expected result**: Body helpers pass tests; HTML export ready for Feature 04.
- **Verify**: `pnpm --filter @newsletter/shared test` — `email-body.test.ts` green.
- **Depends on**: Task 1.

### Task 3: SMTP config green + failing orchestration tests

- **Action**: Add `nodemailer` (+ types) to shared. Implement `smtp-config.ts` only (env → config; no production `sendIssueEmail` yet). Make cases 4–6 green. Add `send-issue-email.test.ts` covering cases 7–11 (including 8b / 10a / 10b) that fail red for missing `sendIssueEmail` / missing exports — do **not** implement orchestration or default transport in this task.
- **Expected result**: Config resolution tested and green; orchestration tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/shared test` — `smtp-config.test.ts` green; `send-issue-email.test.ts` cases 7–11 fail (missing export / not implemented), not infra errors.
- **Depends on**: Task 2.

### Task 4: `sendIssueEmail` orchestration + transport

- **Action**: Implement `sendIssueEmail(client, runId, options?)` in `send-issue-email.ts`: load draft → get newsletter → resolve SMTP → build multipart → send with BCC. Create default Nodemailer SMTP transport from config when `options.transport` is omitted; honor injected mock transport in tests. Locked operator-facing errors for empty recipients, newsletter load failure, draft load failure, empty markdown, config, and SMTP failure. Make cases 7–11 (incl. 8b / 10a / 10b) green.
- **Expected result**: Shared send entry point ready for Feature 05 reuse; no schema writes; transport injectable.
- **Verify**: `pnpm --filter @newsletter/shared test` — all `delivery/` tests green.
- **Depends on**: Task 3.

### Task 5: Issues UI Send button + server action

- **Action**: Add `sendIssueEmailAction`; add Send control on issue detail success path (`send-issue-button.tsx` + wire into `IssueReader` / page). Toast success with recipient count / toast error; disable while pending. Tests 12–15.
- **Expected result**: Operator can Send from `/issues/[runId]` when the issue loaded successfully.
- **Verify**: `pnpm --filter @newsletter/web test` — send button/action tests green.
- **Depends on**: Task 4.

### Task 6: `.env.example` + monorepo gate

- **Action**: Document the six SMTP keys in `.env.example`. Run full gates; fix any export/type/lint fallout.
- **Expected result**: Template documents SMTP; typecheck + lint clean.
- **Verify**: `pnpm typecheck && pnpm lint` pass; shared + web delivery-related tests still green.
- **Depends on**: Task 5.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint`
- Expected: All tests pass including delivery body/config/orchestration and Send UI/action cases; typecheck and lint clean. Manually (optional smoke): with real SMTP in `.env` and recipients on a newsletter, Send from an issue detail delivers multipart mail with recipients only in BCC — not required for verifier automation.

## Handoff

Builder reports: files changed; confirmation that recipients are BCC and To = From; sample operator-facing errors for empty recipients, empty draft, issue/newsletter load failure, missing SMTP, and send failure; confirmation that HTML helper is exported for Feature 04; confirmation that Feature 01 was verified before execute; confirmation that no delivery-status fields were added; any deviation (file splits, wrapper HTML document vs fragment) and why. Note for Feature 05: call `sendIssueEmail` after successful draft; Feature 06: record outcomes separately.

## Research notes

- **Grill (2026-07-17)** — Manual Send on issue detail; saved recipients only; empty list errors; re-send allowed; SMTP env contract; multipart HTML + markdown plain; subject = Issues display title; no status persistence; shared send core; **BCC** (not To) for colleague privacy; empty draft errors; in-flight disable.
- **Grizzled Senior (2026-07-17)** — Applied: Feature 01 hard execute prerequisite; Task 3/4 red–green split; locked draft/load/newsletter/send error strings (+ case 8b/10a/10b).
- **Nodemailer docs (context7 `/websites/nodemailer`)** — `createTransport` SMTP + `sendMail` with `html`/`text`/`bcc`; `secure: false` uses STARTTLS.
- **codegraph_explore** — `IssueReader` / `loadIssueDraft` / `resolveIssueDisplayTitle` / `getNewsletter`; no existing SMTP code in the TS app; legacy Python used HTML-only + To-all (superseded by BCC + multipart).
- **Deps** — `marked` + `nodemailer` added to shared; web already uses sonner toasts.
