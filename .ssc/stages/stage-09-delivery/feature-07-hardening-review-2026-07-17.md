# Feature 07: Harden stage-09 against review findings (2026-07-17)

## Intent

Harden stage-09-delivery against findings from `review-stage-09-delivery-2026-07-17`: make draft HTML email-safe and RSS CDATA-safe, gate privileged delivery entry points on a validated Appwrite session, fix Delivery list membership/limit ordering and newsletter edit schedule→delivery partial commits, correct auto-delivery UI copy, and lock Runs/Inspect badge absence with a regression test — without reopening features 01–06.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–06 stay `verified`. It addresses **all ten** PM-accepted findings (6 High, 4 Medium) from the review. Distilled work — not a copy of the report:

### S1 + N1 (High) — email-safe HTML (shared sanitizer)

`draftMarkdownToEmailHtml` uses Marked with no sanitization; raw HTML, event handlers, and `javascript:` / `data:` URLs pass through into email, RSS snapshots, and HTML exports while comments/spec claim “email-safe”. After Marked parse, sanitize with a Node-friendly HTML sanitizer (prefer **`sanitize-html`** in `@newsletter/shared` — no browser DOM required) using an email/RSS allowlist (headings, lists, links, emphasis, code, tables, images with `http`/`https`/`mailto` only). Strip scripts, event-handler attributes, and dangerous URL schemes. Keep **one** shared helper so email, RSS `htmlBody`, and HTML export stay byte-equal for the same markdown. Update JSDoc to match real behavior. Add adversarial unit tests that fail on today’s code.

### S2 + N1 (High) — CDATA-safe RSS bodies

`cdata()` in `rss-xml.ts` interpolates `htmlBody` into `<![CDATA[...]]>` without neutralizing `]]>`. Make CDATA emission safe (split/replace `]]>` e.g. `]]]]><![CDATA[>`, or equivalent well-formed strategy). Add a regression test that `]]>` in `htmlBody` cannot terminate CDATA or poison the public feed. Description and `content:encoded` remain equal after the fix.

### S3 + S4 + S6 (High) — authoritative session gates on delivery entry points

Middleware only checks cookie *presence*. Gate privileged Stage 09 entry points with `getAuthenticatedUser()` from `web/lib/auth/session.ts` (calls `account.get()` — already used by `(protected)/layout.tsx`):

| Entry point | On null user |
|-------------|--------------|
| `GET /api/issues/[runId]/export` | **401** plain text (do not call `prepareIssueExport`) |
| `sendIssueEmailAction` | `{ ok: false, error: GENERIC_ERROR }`; do not call `sendIssueEmail` |
| `publishIssueToRssAction` | `{ ok: false, error: GENERIC_ERROR }`; do not call `publishIssueToRss` |
| `updateNewsletterAction` | `{ ok: false, error: GENERIC_ERROR }` (or existing action failure shape); do **not** call schedule/delivery/definition Appwrite writes |

Keep using `getServerAppwrite()` **after** the session gate for data access (single-operator app; no per-user ownership model required). Export must remain absent from `PUBLIC_ROUTES` / `isPublicRoute`. Add unit tests with `getAuthenticatedUser` mocked null vs valid user.

### C1 (Medium) — Delivery list limit after membership

`listDeliveryIssues` currently passes `limit` into `listIssues` then filters `hasDeliveryAttempt` in memory, so newest never-attempted issues can starve the hub. Fix so `limit` applies to the **post-membership** (and outcome-filtered) result. Prefer: paginate/fetch eligible issues in batches until `limit` delivery-attempt rows are collected, or query/filter delivery status ≠ `none` at the data layer if Appwrite queries allow without schema change. Do not change Feature 06 membership rule (≥1 attempt) or outcome filters. Add a test with many recent `none` + older delivered rows proving delivered issues still surface.

### C2 (Medium) — rollback schedule when delivery write fails

`updateNewsletterAction` order is schedule → delivery → definition; dual rollback only wraps definition failure. If `updateNewsletterDelivery` throws after schedule succeeded, restore schedule (and `scheduleLastFiredAt` if needed) to `prior`, then return failure — same compensating style as the definition-failure path. Prefer rollback over a new partial-failure UX. Extend `newsletters-actions.test.ts`.

### N2 (Medium) — auto-delivery copy matches Feature 05

Replace Delivery section helper text that says toggles are “wired in a later feature” with accurate copy: enabled auto-email / auto-RSS run after a successful generate. Update `newsletter-form-delivery.test.tsx` so it no longer requires the “later feature” phrase.

### T1 (Medium) — Runs/Inspect no delivery-badge regression

Add an automated test that renders Runs list and Inspect shell fixtures and asserts Email/RSS delivery badge labels (`DeliveryStatusBadge` / Sent / Published / Failed delivery cluster) are absent. Test must fail if badges are reintroduced on those surfaces.

## Dependencies

- Builds on: **features 01–06 of this stage** (already `verified`) — delivery helpers, SMTP/RSS/export, auto-deliver hook, Delivery hub, Issues chrome.
- Anchor: `.ssc/reviews/review-stage-09-delivery-2026-07-17.md`.
- Auth helper: `web/lib/auth/session.ts` → `getAuthenticatedUser`.

## Constraints

- **Do not reopen** features 01–06 status; this is additive hardening.
- **Keep** Feature 02 BCC addressing, To=From, multipart HTML+text, and re-send/re-publish allowed.
- **Keep** Feature 03 public unauthenticated RSS, last-10 trim, and `.xml` rewrite.
- **Keep** Feature 04 on-demand-only export (no auto-export); HTML export body must still equal sanitized email HTML.
- **Keep** Feature 05 never-throw auto-deliver; email failure must not skip RSS.
- **Keep** Feature 06 last-write-wins delivery status; no delivery chrome on Runs/Inspect.
- **Do not** redesign project-wide middleware in this feature — only gate the Stage 09 entry points listed above.
- **Do not** introduce public signup, unsubscribe, or managed ESP.
- Secrets: never log SMTP passwords or session secrets in new code/tests.
- New dependency allowed: `sanitize-html` (+ types if needed) in `shared/package.json` only if required for S1.

## Acceptance criteria

- [ ] Adversarial markdown (`<script>`, inline event handlers, `javascript:` / `data:` hrefs) does not survive `draftMarkdownToEmailHtml` as executable/dangerous markup; benign GFM still renders; email / RSS snapshot HTML / HTML export remain equal for the same markdown. (S1, N1)
- [ ] `buildRssXml` with `htmlBody` containing `]]>` returns well-formed XML with no CDATA breakout; description and `content:encoded` stay equal. (S2, N1)
- [ ] Unauthenticated / null `getAuthenticatedUser` cannot obtain export bodies (401) or invoke send/publish/newsletter Appwrite writes; authenticated happy paths still work; export stays non-public. (S3, S4, S6)
- [ ] When ≥1 delivery-attempt issues exist, they are not dropped solely because newer never-attempted issues consume the pre-filter `listIssues` limit; `limit` caps the post-membership list. (C1)
- [ ] Failed `updateNewsletterDelivery` after a successful schedule write restores prior schedule (and last-fired as needed) before returning failure. (C2)
- [ ] Newsletter edit Delivery helper copy accurately describes live post-run auto-email/auto-RSS; tests do not require “later feature”. (N2)
- [ ] Automated test fails if delivery status badges appear on Runs list or Inspect chrome. (T1)
- [ ] `pnpm typecheck` and `pnpm lint` pass; shared and web tests covering touched paths pass.

## Files

- Modify: `shared/src/delivery/email-body.ts` — sanitize after Marked (S1, N1)
- Modify: `shared/package.json` — add `sanitize-html` (+ `@types/sanitize-html` if needed) (S1)
- Modify: `shared/src/delivery/__tests__/email-body.test.ts` — adversarial fixtures (S1, N1)
- Modify: `shared/src/delivery/rss-xml.ts` — CDATA-safe wrapper (S2)
- Modify: `shared/src/delivery/__tests__/rss-xml.test.ts` — `]]>` regression (S2, N1)
- Modify: `shared/src/delivery/list-delivery-issues.ts` — limit after membership (C1)
- Modify: `shared/src/delivery/__tests__/list-delivery-issues.test.ts` — under-fill regression (C1)
- Modify: `web/app/api/issues/[runId]/export/route.ts` — `getAuthenticatedUser` → 401 (S3)
- Modify: `web/src/__tests__/issue-export-route.test.ts` — unauthenticated 401 (S3)
- Modify: `web/app/(protected)/issues/actions.ts` — session gate on send/publish (S4)
- Modify: `web/src/__tests__/send-issue-email-action.test.ts` — null user (S4)
- Modify: `web/src/__tests__/publish-issue-to-rss-action.test.ts` — null user (S4)
- Modify: `web/app/(protected)/newsletters/actions.ts` — session gate + delivery-failure schedule rollback (S6, C2)
- Modify: `web/src/__tests__/newsletters-actions.test.ts` — null user + delivery-fail rollback (S6, C2)
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx` — auto-delivery copy (N2)
- Modify: `web/src/__tests__/newsletter-form-delivery.test.tsx` — copy expectation (N2)
- Create or modify: `web/src/__tests__/runs-inspect-no-delivery-badges.test.tsx` (or extend existing) — Runs/Inspect absence (T1)
- Modify as needed: `web/src/__tests__/routes.test.ts` — export remains non-public (S3)

## Testing approach

Test-first where practical: add failing adversarial/session/limit/rollback/copy/absence cases, then implement.

1. **S1/N1** — markdown with `<script>alert(1)</script>`, `<img onerror=...>`, `[x](javascript:alert(1))` → sanitized output; benign heading/list/link still present; HTML export path equals email HTML helper output.
2. **S2/N1** — `htmlBody` with `]]>` → well-formed RSS; no raw breakout sequence outside CDATA.
3. **S3** — export GET with `getAuthenticatedUser` null → 401, `prepareIssueExport` not called; valid user → existing 200 behavior.
4. **S4** — send/publish actions with null user → `ok:false`, shared helpers not called.
5. **S6** — `updateNewsletterAction` with null user → no Appwrite writes.
6. **C1** — fixture: 100+ recent eligible `none` + older `email sent` with default limit → delivered rows returned.
7. **C2** — schedule succeeds, delivery rejects → schedule restored to `prior`; definition not called.
8. **N2** — form test asserts live auto-delivery wording; forbids “later feature”.
9. **T1** — Runs table + InspectShell render → no delivery badge cluster.

## Tasks

### Task 1: Sanitize email HTML + adversarial tests (S1, N1)

- **Action**: Add `sanitize-html` to `shared` if needed. In `shared/src/delivery/email-body.ts`, sanitize Marked output with an email/RSS allowlist; neutralize dangerous URL schemes. Update JSDoc. Extend `email-body.test.ts` with adversarial fixtures and a parity note that callers reuse this helper unchanged.
- **Expected result**: “email-safe” is objectively true; S1/N1 acceptance met for HTML.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/delivery/__tests__/email-body.test.ts`; S1 + N1 HTML Acceptance Criteria met.
- **Depends on**: none.

### Task 2: CDATA-safe RSS bodies (S2, N1)

- **Action**: Fix `cdata()` in `shared/src/delivery/rss-xml.ts` to neutralize `]]>`. Extend `rss-xml.test.ts` with a terminator breakout case. Confirm description/`content:encoded` equality still holds.
- **Expected result**: Public feed cannot be broken via CDATA terminator in htmlBody.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/delivery/__tests__/rss-xml.test.ts`; S2 + N1 CDATA Acceptance Criteria met.
- **Depends on**: Task 1 preferred first (sanitized HTML still must be CDATA-safe), but CDATA fix is independently correct.

### Task 3: Session gates on export, send, publish, newsletter update (S3, S4, S6)

- **Action**: Call `getAuthenticatedUser()` at the start of the export route and the three server actions listed in Spec. On null: 401 / `GENERIC_ERROR` without privileged work. Extend export + action tests with mocked null/valid user. Keep export non-public in routes tests.
- **Expected result**: Cookie-presence-only can no longer authorize Stage 09 privileged delivery mutations/reads through these entry points.
- **Verify**: relevant web vitest files green; S3 + S4 + S6 Acceptance Criteria met.
- **Depends on**: none.

### Task 4: Delivery list membership before limit (C1)

- **Action**: Change `listDeliveryIssues` so `limit` applies after `hasDeliveryAttempt` (+ outcome) filtering — paginate `listIssues` or equivalent until enough rows or exhaustion. Extend `list-delivery-issues.test.ts` with an under-fill regression (many recent `none`, older delivered).
- **Expected result**: `/delivery` surfaces delivery attempts even when many recent issues were never delivered.
- **Verify**: list-delivery-issues tests green; C1 Acceptance Criteria met.
- **Depends on**: none.

### Task 5: Schedule rollback when delivery write fails (C2)

- **Action**: In `updateNewsletterAction`, wrap or catch delivery failure after schedule success: restore schedule (+ last-fired) from `prior`, then return failure. Extend `newsletters-actions.test.ts`. (Session gate from Task 3 may already touch this file — coordinate edits.)
- **Expected result**: Failed Save never leaves an unexplained schedule mutation after a delivery write failure.
- **Verify**: newsletters-actions tests green; C2 Acceptance Criteria met.
- **Depends on**: Task 3 if editing the same action in one pass; otherwise none.

### Task 6: Auto-delivery copy + Runs/Inspect badge regression (N2, T1)

- **Action**: Update Delivery helper copy in `newsletter-form-dialog.tsx` and the form delivery test (N2). Add Runs list + InspectShell absence assertions for delivery badges (T1).
- **Expected result**: Product copy matches Feature 05; Runs/Inspect stay chrome-free under CI.
- **Verify**: newsletter-form-delivery + new/extended Runs/Inspect tests green; N2 + T1 Acceptance Criteria met.
- **Depends on**: none.

### Task 7: Feature gate

- **Action**: Re-read this spec vs implementation; run full gates for touched workspaces; fix gaps.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**: `pnpm --filter @newsletter/shared test && pnpm --filter web test && pnpm typecheck && pnpm lint` (scope web tests to touched files if full suite is impractical, but typecheck/lint must be full-repo).
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web test && pnpm typecheck && pnpm lint`
- Expected: All green. Email HTML sanitization, CDATA-safe RSS, session gates, Delivery list membership/limit, schedule←delivery rollback, accurate auto-delivery copy, and Runs/Inspect badge absence behave per Acceptance criteria. Features 01–06 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; sanitizer choice + allowlist summary; CDATA strategy; session-gate response shapes (401 vs action error); Delivery list pagination approach; schedule rollback details for C2; copy string chosen for N2; any deviation and why. Reference report: `.ssc/reviews/review-stage-09-delivery-2026-07-17.md`.

## Research notes

- `getAuthenticatedUser` already validates via Appwrite `account.get()` on a session client (`web/lib/auth/session.ts`) — reuse; do not invent a second auth path.
- No sanitizer currently in `shared` deps; prefer `sanitize-html` for Node worker/web shared use over browser-only DOMPurify.
