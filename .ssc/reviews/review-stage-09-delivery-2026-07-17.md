# SSC Code Review Report

**Date:** 2026-07-17
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-09-delivery (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-09-delivery/feature-01-newsletter-delivery-config.md` … `feature-06-delivery-visibility.md` (all six verified features)

---

## Summary

- **Merge recommendation:** Block
- **Issues by severity:** Blocker 0 | High 6 | Medium 4 | Low 0 | Nit 0
- **Overall rationale:** Six High findings hit the delivery security core — unsanitized HTML into email/RSS/export, CDATA breakout on the public feed, and privileged send/publish/export/newsletter-update paths gated only by middleware cookie *presence* (not a validated Appwrite session). Medium findings cover Delivery list under-fill, a schedule/delivery partial-commit gap, outdated auto-delivery copy locked by tests, and a missing Runs/Inspect badge regression test. Do not finalize Stage 09 until High security items are hardened or explicitly dismissed by the PM.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-09-delivery` (features 01–06, all `verified`)
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 75 (2 batches; large pre-existing repository/schema tests moved to B2 for token budget)
  - Batch B1 (~73k tokens): `shared/src/delivery/**`, newsletter delivery helpers/repo, schema declarations, `execute-run` + auto-deliver hook, RSS + export routes, `web/lib/auth/routes.ts`, `.env.example`
  - Batch B2 (~73k tokens): Delivery GUI, Issues send/publish/download/badges, newsletter form Delivery section, issues/newsletters actions, `next.config.mjs`, related web tests, plus `runs`/`newsletters`/`schema` repository/declarations tests
- **Files skipped:** 3
  - `shared/package.json` — dep manifest only
  - `.ssc/stages/stage-09-delivery.md` — Intent already used as anchor (not code)
  - Unrelated Runs/Inspect implementation files — absence of delivery chrome checked via Feature 06 acceptance + B2 test gap (T1), not full Runs/Inspect module review
- **Assumptions and unknowns:**
  - Middleware auth pattern (cookie presence) is project-wide; findings treat Stage 09 delivery entry points as in-scope defense-in-depth gaps even if the same pattern exists elsewhere.
  - Validator rejected S5 (Delivery Alert `RunRepositoryError.message`) because repository wrappers already sanitize Appwrite errors on this path.
  - Severity bumps applied per validator: S3 and S6 Medium → High.

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Stage Intent:** Get finished issues to family inboxes (email), RSS readers (public feed), and the operator (download); auto-delivery closes the loop once tuned; delivery outcomes visible in the GUI.
- **Feature Intent lines:**
  - **01:** Shared delivery contract (recipients + independent auto toggles, default off).
  - **02:** Manual multipart SMTP email from Issues during tuning.
  - **03:** Public last-10 RSS + Publish from Issues.
  - **04:** On-demand MD/HTML download (HTML = email HTML).
  - **05:** Honor auto toggles after successful run without a click.
  - **06:** `/delivery` hub + Issues badges; no Runs/Inspect delivery chrome.
- **Intent served?** Partially — drift detected
- **Notes:** Happy-path delivery behavior is present (config, send, publish, export, auto-deliver hook, visibility UI). Drift/anti-cheat: Feature 02/03 “email-safe” / “CDATA-safe” contracts are claimed but not enforced (N1/S1/S2); Feature 05 is live but Feature 01 UI copy still says “later feature” (N2); Feature 06 membership/limit ordering can hide delivered issues (C1); Feature 06 Runs/Inspect absence lacks a regression test (T1).

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [ ] S1-20260717: Unsanitized draft HTML into email / RSS / export

| Field | Value |
|---|---|
| **ID** | `S1-20260717` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `shared/src/delivery/email-body.ts:14-16` |
| **Description** | `draftMarkdownToEmailHtml` uses Marked with no HTML sanitization or dangerous-URI filtering. Raw HTML and `javascript:` links in draft markdown pass through into email HTML, RSS `htmlBody`, and HTML exports. |
| **Risk / Impact** | Operator/LLM/scraped content can inject scripts, event handlers, or `javascript:` links into family email clients, public RSS readers, and downloaded HTML. |
| **Evidence** | Marked default emits raw input HTML; callers include `send-issue-email.ts`, `publish-issue-to-rss.ts`, `issue-export.ts`. Feature 02 Spec requires “email-safe HTML”. |
| **Recommendation** | Sanitize Marked output with an email/RSS allowlist; strip/rewrite `javascript:` / `data:` schemes; one shared sanitizer so email, RSS, and export stay in parity. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Adversarial fixtures: raw `<script>`, `<img onerror=...>`, `javascript:` / `data:` hrefs must not remain executable; benign GFM still renders; email/RSS/export HTML remain equal. |
| **Acceptance Criteria** | `draftMarkdownToEmailHtml` never emits `<script>`, inline event handlers, or `javascript:`/`data:` URLs for adversarial markdown; GFM still works; channel parity preserved. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Runtime check shows raw script/`javascript:`/onerror survive Marked.parse; tests only cover benign GFM. High (not Blocker): drafts are primarily operator/LLM-sourced, not an open unauthenticated write path. |

---

### [ ] S2-20260717: RSS CDATA breakout via `]]>` in htmlBody

| Field | Value |
|---|---|
| **ID** | `S2-20260717` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `shared/src/delivery/rss-xml.ts:27-29` |
| **Description** | `cdata()` wraps `htmlBody` in `<![CDATA[...]]>` without neutralizing the CDATA terminator `]]>`. Feature 03 requires CDATA-safe description/content:encoded. |
| **Risk / Impact** | Public unauthenticated RSS can be malformed or poisoned when published HTML contains `]]>`. |
| **Evidence** | `return \`<![CDATA[${html}]]>\`;` with no replace. Titles use `escapeXmlText`; body does not. |
| **Recommendation** | Split/replace `]]>` (e.g. `]]]]><![CDATA[>`) or escape as XML text; add regression test. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `htmlBody` containing `]]>` still produces well-formed RSS with no CDATA breakout; description and content:encoded remain equal. |
| **Acceptance Criteria** | `buildRssXml` with `]]>` in `htmlBody` returns well-formed XML; Feature 03 CDATA-safe acceptance met. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Confirmed interpolation with no terminator handling; rss-xml tests cover title escaping but not CDATA terminators. |

---

### [ ] S3-20260717: Export route has no in-handler session validation

| Field | Value |
|---|---|
| **ID** | `S3-20260717` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `web/app/api/issues/[runId]/export/route.ts:34-44` |
| **Description** | Export GET loads any issue via `getServerAppwrite()` (API key) with no session/ownership check in the handler. Privacy depends on middleware cookie *presence* only. |
| **Risk / Impact** | A non-empty forged/stale cookie matching the expected name can authorize API-key export of any `runId` (IDOR on private drafts). |
| **Evidence** | Route calls `getServerAppwrite()` then `prepareIssueExport` with no auth helpers; export is not public but also not authorized in-handler. |
| **Recommendation** | Validate a real Appwrite session (`getAuthenticatedUser` or equivalent) in the handler; return 401 if missing. |
| **Effort** | M |
| **Confidence** | Medium → High (validator bump) |
| **Suggested Tests** | Request without valid session → 401/redirect, not 200; `isPublicRoute('/api/issues/.../export') === false`. |
| **Acceptance Criteria** | Unauthenticated clients cannot obtain export bodies even with a known `runId`; authenticated export still works. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Middleware only requires Boolean(sessionCookie\|\|legacyCookie); zero-cookie clients redirect, but presence-only auth still fails Feature 04 “export not public” defense-in-depth. Severity bumped to High. |

---

### [ ] S4-20260717: Send/Publish actions skip `getAuthenticatedUser`

| Field | Value |
|---|---|
| **ID** | `S4-20260717` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `web/app/(protected)/issues/actions.ts:23-47` |
| **Description** | `sendIssueEmailAction` and `publishIssueToRssAction` invoke privileged shared delivery with the API-key client and never call `getAuthenticatedUser()`. |
| **Risk / Impact** | Stale/forged session cookie may authorize family email blasts and public RSS publishes. |
| **Evidence** | Actions call `sendIssueEmail`/`publishIssueToRss(getServerAppwrite(), runId)` with no session gate; `getAuthenticatedUser` is used in layout for page renders, not these actions. |
| **Recommendation** | At start of both actions, `await getAuthenticatedUser()`; if null, return `{ ok: false, error: GENERIC_ERROR }` without calling shared delivery. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Mock `getAuthenticatedUser` null → `ok:false` and helpers not called; valid user → helpers invoked. |
| **Acceptance Criteria** | Both delivery actions refuse when `getAuthenticatedUser()` returns null; tests assert helpers are not invoked. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Confirmed no session gate on privileged send/publish; middleware cookie-presence pattern matches the claim. |

---

### [ ] S6-20260717: Newsletter update action skips session validation

| Field | Value |
|---|---|
| **ID** | `S6-20260717` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `web/app/(protected)/newsletters/actions.ts:113-224` |
| **Description** | `updateNewsletterAction` writes schedule/delivery/definition via `getServerAppwrite()` with no `getAuthenticatedUser()` gate. |
| **Risk / Impact** | Stale/forged session can alter recipient lists and enable auto-email/auto-RSS (delivery configuration takeover). |
| **Evidence** | Action uses API-key client after FormData parse; no `getAuthenticatedUser` before Appwrite writes. |
| **Recommendation** | Gate `updateNewsletterAction` with `getAuthenticatedUser()` before any Appwrite write. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `getAuthenticatedUser` null → `ok:false`; schedule/delivery/definition helpers not called. |
| **Acceptance Criteria** | Newsletter update including delivery fields does not call Appwrite when the session is invalid/absent. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Same cookie-presence-only pattern as S4; severity bumped to High because recipient/auto-toggle changes are privilege-equivalent to delivery config takeover. |

---

### [ ] N1-20260717: Anti-cheat — claimed email-safe / CDATA-safe without enforcing

| Field | Value |
|---|---|
| **ID** | `N1-20260717` |
| **Severity** | High |
| **Category** | Anti-cheat |
| **Location** | `shared/src/delivery/email-body.ts:10-16`; `shared/src/delivery/rss-xml.ts:27-29` |
| **Description** | Spec drift vs Feature 02/03: comments and acceptance language claim “email-safe” and “CDATA-safe”, but implementation performs neither; tests lack adversarial fixtures. |
| **Risk / Impact** | Verifier-green delivery can ship unsafe HTML while appearing to meet Stage 09 safety contracts; root cause paired with S1/S2. |
| **Evidence** | JSDoc “email-safe HTML fragment”; Feature 03 CDATA-safe table; `email-body.test.ts` / `rss-xml.test.ts` lack script/`]]>` cases. |
| **Recommendation** | Implement real sanitization + CDATA-safe encoding (fixes S1/S2); update comments; add adversarial tests. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Fixtures that pass today (raw script, `]]>`) fail until fixes land. |
| **Acceptance Criteria** | Feature 02 “email-safe” and Feature 03 “CDATA-safe” are objectively met in code + tests; comments match behavior. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Real shortcut/spec drift, not a legitimate technique; pairs with S1/S2. |

---

### [ ] C1-20260717: Delivery list applies limit before membership filter

| Field | Value |
|---|---|
| **ID** | `C1-20260717` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/delivery/list-delivery-issues.ts:39-56` |
| **Description** | `listDeliveryIssues` passes `limit` into `listIssues`, then filters `hasDeliveryAttempt` in memory. Newest never-attempted issues can consume the page and hide older delivered ones. |
| **Risk / Impact** | `/delivery` under-fills or empties even when delivery attempts exist — undermines Feature 06 Intent. |
| **Evidence** | `listIssues({ limit })` then `filter(hasDeliveryAttempt)`; tests use pre-filtered mocks and assert limit forwarding, not post-filter sizing. |
| **Recommendation** | Apply `limit` after membership (paginate/fetch until enough delivery-attempt rows) or query runs with delivery status ≠ `none`. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Many recent `none` + older `sent` with limit → returned set includes delivered issues; limit caps post-filter size. |
| **Acceptance Criteria** | Delivery-attempt issues are not dropped solely because newer never-attempted issues consume `listIssues` limit. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Limit-before-filter behavior confirmed; tests do not catch under-fill. |

---

### [ ] C2-20260717: Schedule commits if delivery write fails mid-update

| Field | Value |
|---|---|
| **ID** | `C2-20260717` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/app/(protected)/newsletters/actions.ts:168-174` |
| **Description** | `updateNewsletterAction` writes schedule → delivery → definition. Dual rollback only wraps definition failure. If `updateNewsletterDelivery` fails after schedule succeeded, the new schedule remains committed while the action returns failure. |
| **Risk / Impact** | Partial commit: operator believes save failed, but schedule (and last-fired semantics) already changed. |
| **Evidence** | Locked order schedule→delivery→definition; try/catch rollback starts only around definition update. |
| **Recommendation** | On delivery failure, roll back schedule (and last-fired) like the definition-failure path; or reorder writes if product constraints allow. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Schedule succeeds, delivery rejects → schedule restored to prior; definition not called. |
| **Acceptance Criteria** | Failed delivery after schedule write restores prior schedule or signals partial failure explicitly. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Dual rollback only in definition catch; delivery-failure path leaves schedule committed. |

---

### [ ] N2-20260717: Anti-cheat — UI copy says auto-delivery is “a later feature”

| Field | Value |
|---|---|
| **ID** | `N2-20260717` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `web/components/newsletters/newsletter-form-dialog.tsx:355-358` |
| **Description** | Delivery section helper copy still says auto-email/auto-RSS “apply after a successful run (wired in a later feature)” though Feature 05 already honors those toggles. The form test locks the outdated sentence. |
| **Risk / Impact** | Operators are told auto-delivery is unwired when Stage 09 Feature 05 already closes generate→deliver; tests encode the false product state. |
| **Evidence** | Dialog lines 355–358; `newsletter-form-delivery.test.tsx` asserts the exact “later feature” string. |
| **Recommendation** | Update helper copy to describe live post-run auto-delivery; update the form test expectation. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Assert copy mentions post-run auto-delivery without “later feature” wording. |
| **Acceptance Criteria** | Edit Delivery section copy accurately describes live auto-email/auto-RSS; tests no longer require “later feature”. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Meaningful product-state drift vs Feature 05; not stylistic. |

---

### [ ] T1-20260717: No Runs/Inspect regression test for missing delivery badges

| Field | Value |
|---|---|
| **ID** | `T1-20260717` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `web/src/__tests__/issues-delivery-badges.test.tsx:75-160` |
| **Description** | Feature 06 Acceptance requires no delivery chrome on Runs/Inspect. Batch tests cover Issues badge presence/absence but never assert Runs list or Inspect shell lack Email/RSS delivery badges. |
| **Risk / Impact** | A regression that reintroduces `DeliveryStatusBadge` on Runs/Inspect would not be caught by the Stage 09 GUI test suite. |
| **Evidence** | Test file only renders IssuesTable/IssueListCard/IssueReader variants. |
| **Recommendation** | Add focused regression tests rendering Runs table / InspectShell fixtures asserting absence of Sent/Published/Failed delivery badge labels. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | InspectShell + Runs table fixtures → no Email/RSS delivery badge cluster. |
| **Acceptance Criteria** | Automated test fails if delivery status badges appear on Runs list or Inspect chrome. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Runs/Inspect do not import badges today, but the acceptance-criteria regression gap is real. |

---

### Rejected (not in final counts)

| ID | Decision | Why dropped |
|---|---|---|
| S5-20260717 | Rejected | Delivery page surfaces `RunRepositoryError.message`, but `wrapAppwriteError` already maps Appwrite failures to `APPWRITE_SAFE_MESSAGE` / fixed operator strings on this path — not a Medium disclosure. |

---

## Dependencies and Licensing

- Vulnerabilities: none newly identified in this pass (Marked sanitization gap is usage, not a known CVE inventory).
- Outdated critical packages: not audited in depth this pass.
- License concerns: none noted.

---

## Quality Signals

- Lint/config signals: not re-run as part of this review (quality pass, not verification).
- Test/coverage signals: delivery unit/GUI tests are broad on happy paths; adversarial HTML/CDATA and session-gate negatives are thin (see S1/S2/N1/S3/S4/S6/T1).
- Complexity/churn signals: Stage 09 concentrates risk in `shared/src/delivery/**` and privileged web actions — appropriate focus for pre-finalize hardening.

---

## Risk Assessment

- **Overall risk:** High
- **Merge decision:** Block
- **Out-of-scope areas:** Managed ESP / bounce handling; public signup; full project-wide middleware redesign beyond Stage 09 delivery entry points; Stage 06 Inspect semantics beyond “no delivery chrome”.

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1 + N1 (email HTML sanitization) | High | Address now | PM: address all |
| S2 + N1 (RSS CDATA-safe) | High | Address now | PM: address all |
| S3 (export session gate) | High | Address now | PM: address all |
| S4 (send/publish session gate) | High | Address now | PM: address all |
| S6 (newsletter update session gate) | High | Address now | PM: address all |
| C1 (delivery list limit/membership) | Medium | Address now | PM: address all |
| C2 (schedule/delivery partial commit) | Medium | Address now | PM: address all |
| N2 (outdated “later feature” copy) | Medium | Address now | PM: address all |
| T1 (Runs/Inspect badge regression test) | Medium | Address now | PM: address all |

Hardening feature written: `feature-07-hardening-review-2026-07-17` → `.ssc/stages/stage-09-delivery/feature-07-hardening-review-2026-07-17.md`

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
