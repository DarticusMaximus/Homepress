# SSC Code Review Report

**Date:** 2026-07-21
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-10-v1-polish (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-10-v1-polish/feature-01-schedule-builder.md` … `feature-07-runs-advanced-retention.md` (all seven verified features)

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 2 | Medium 5 | Low 0 | Nit 0
- **Overall rationale:** Two High findings — newsletter mutators that skip the session gate present on update, and dashboard failed-run attention undercounted when non-failed runs fill a shared `limit: 100` — should be fixed or explicitly dismissed before treating Stage 10 as launch-ready. Medium items cover same-origin `?edit=` path escape, timezone search covered only via a mock, sequential/redundant dashboard fetches, unsanitized dashboard error logs, and a hardcoded Runs href twin. No Blockers; polish Intent is largely served.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-10-v1-polish` (features 01–07, all `verified`)
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 75 (~101k tokens; 2 sequential batches)
  - Batch B1 (features 01–03): schedule-builder helpers/UI, newsletter edit page/tabs/actions/lists, drafter `{audience}` + override path, related tests (~33 files)
  - Batch B2 (features 04–07): inspect layout, mobile/shell polish, dashboard widgets/`/`, Runs Advanced retention, related tests (~42 files)
- **Files skipped:**
  - Optional `web/components/dashboard/health-strip.tsx` — not present; compact density lives on existing health cards (in-scope)
  - Spec-optional shadcn `popover.tsx` / `command.tsx` — not present; `web/components/ui/combobox.tsx` used instead
  - Deleted `web/app/(protected)/design-system/**` — correctly absent (Feature 05); absence confirmed, not re-reviewed as source
  - Unrelated pipeline/worker retention poller internals — Feature 07 is UI placement only; purge semantics out of review scope
- **Assumptions and unknowns:**
  - Middleware cookie-presence pattern is project-wide; S1 treats newsletter Server Actions as in-scope defense-in-depth (same class as Stage 09 session-gate findings).
  - Validator downgraded C1 (audience trim in `draft()`) to Low because `validateAudience` already trims on create/update — dropped below Medium floor (not listed in Detailed Findings).
  - M1 and N2 (hardcoded `FAILED_RUNS_HREF` vs `buildRunsHref` pin) merged into one Medium finding (M1); anti-cheat pin angle retained in description.

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Stage Intent:** Make daily operator use pleasant enough to launch V1 — scheduling without a cron cheat-sheet, a useful home page, less painful newsletter edit / inspect / mobile chrome, and drafter quality you can tune per newsletter.
- **Feature Intent lines:**
  - **01:** Guided schedule builder + searchable TZ; store valid cron + IANA; Advanced raw cron.
  - **02:** Dedicated edit page with tabs; Basics-only create → edit page.
  - **03:** `{audience}` in drafter contract/runtime; generic default with title-as-first-heading; per-newsletter override.
  - **04:** Inspect sections collapsed by default; draft stacks under inputs.
  - **05:** Mobile sidebar close, nested nav highlight, hit targets, no design-system, loading/error, title-case status.
  - **06:** Useful `/` landing — attention, recent issues/runs, compact health.
  - **07:** Retention in collapsed Advanced at bottom of Runs.
- **Intent served?** Partially — drift detected
- **Notes:** Happy-path polish is present across all seven features. Drift/gaps: Feature 01 searchable TZ is not exercised against the real combobox (N1); Feature 06 attention badges can undercount failed runs vs the deep-linked Runs filter (C2) and bypass the pinned `buildRunsHref` helper (M1); Feature 03 runtime trim pin is incomplete in `draft()` but largely mitigated by validation (C1 dropped as Low). Auth session gates on newsletter mutators are inconsistent with update (S1) — security beyond Intent but launch-relevant.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [ ] S1-20260721: Newsletter mutators skip session gate (API key path)

| Field | Value |
|---|---|
| **ID** | `S1-20260721` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `web/app/(protected)/newsletters/actions.ts:78-116` (and sibling mutators in same file) |
| **Description** | `createNewsletterAction`, `deleteNewsletterAction`, `attachFeedToNewsletter`, `detachFeedFromNewsletter`, and `startNewsletterRun` call `getServerAppwrite()` (privileged `APPWRITE_API_KEY`) without `getAuthenticatedUser()`. Only `updateNewsletterAction` gates on a validated session. |
| **Risk / Impact** | Session-expired clients that still hold a cookie can mutate newsletters/feeds and enqueue runs via the admin key, bypassing the gate explicitly added for update. |
| **Evidence** | `updateNewsletterAction` requires `getAuthenticatedUser()`; create/delete/attach/detach/start do not before `getServerAppwrite()`. Middleware checks cookie presence only; protected layout does not authorize Server Actions. |
| **Recommendation** | Add the same `getAuthenticatedUser()` early-return used by update to every mutating export before any `getServerAppwrite()` call. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Extend `newsletters-actions.test.ts`: for create/delete/attach/detach/start, mock `getAuthenticatedUser` → null → assert safe error and no Appwrite/enqueue calls. |
| **Acceptance Criteria** | Every mutating export in `newsletters/actions.ts` refuses unauthenticated callers before `getServerAppwrite()`; unit tests prove no repository/enqueue calls when session is null. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Code confirms only update is gated. High (not Blocker): cookie-less callers are redirected by middleware; expired/invalid session still reaches these actions. |

---

### [ ] C2-20260721: Failed-run attention undercounted vs `/runs?status=failed`

| Field | Value |
|---|---|
| **ID** | `C2-20260721` |
| **Severity** | High |
| **Category** | Correctness & Reliability |
| **Location** | `web/app/(protected)/page.tsx:68-109` |
| **Description** | Needs-attention failed-run counts come from the same unfiltered `listRuns(client, { limit: 100 })` used for the recent-runs snapshot. In-window failures outside the newest 100 overall runs are omitted, while the deep link `/runs?status=failed` uses a status-filtered query. |
| **Risk / Impact** | Operators can open `/` and see no (or too few) failed-run badges even when recent failures exist and the linked Runs filter lists them — undermining Feature 06 Intent. |
| **Evidence** | One shared unfiltered `limit: 100` feeds both Recent runs and `computeAttentionCounts`; Runs page filters by status separately. |
| **Recommendation** | Fetch failed-run attention with `listRuns({ status: "failed", limit: 100 })` (or equivalent); keep the unfiltered/windowed fetch only for Recent runs; still apply the 7-day window in `computeAttentionCounts`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Fixture: 100 completed runs newer than 2 in-window failed runs → attention `failedRuns` > 0; href still `/runs?status=failed`. |
| **Acceptance Criteria** | Failed-run attention is not understated solely because newer non-failed runs filled the shared `limit: 100`; Recent-runs snapshot (7-day, cap 10) unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Shared unfiltered list vs status-filtered destination confirmed; undercount only bites when total runs exceed 100. |

---

### [ ] S2-20260721: Unvalidated `?edit=` redirect path escape

| Field | Value |
|---|---|
| **ID** | `S2-20260721` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/app/(protected)/newsletters/page.tsx:58-63` |
| **Description** | Compat deep-link redirects to `/newsletters/${editId}` using the raw trimmed `edit` query with no ID-format validation. Values with path segments (e.g. `../schedules`, `a/b`) can normalize outside `/newsletters/[id]` within the origin. |
| **Risk / Impact** | Crafted bookmarks/links can bounce operators to unexpected in-app routes, weakening the deep-link→edit-page contract. |
| **Evidence** | `redirect(\`/newsletters/${editId}\`)` after trim only — no single-segment / Appwrite-id check. |
| **Recommendation** | Allow only a safe document-id pattern (alphanumeric/`_`/`-`, no `/`, `.`, `?`, `#`) before redirect; otherwise ignore `edit` or not-found. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `edit=nl-1` redirects to `/newsletters/nl-1`; `edit=../schedules`, `edit=a/b` do not escape. |
| **Acceptance Criteria** | Only well-formed newsletter ids trigger redirect; malformed `edit` values never produce a Location outside `/newsletters/<id>`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Redirect construction confirmed; same-origin path escape is real. |

---

### [ ] N1-20260721: Timezone search asserted only against mocked combobox

| Field | Value |
|---|---|
| **ID** | `N1-20260721` |
| **Severity** | Medium |
| **Category** | Anti-cheat |
| **Location** | `web/src/__tests__/schedule-fields-builder.test.tsx:146-189` |
| **Description** | Feature 01’s “searchable IANA combobox” acceptance is covered by a hoisted mock of `TimezoneCombobox` that reimplements substring filtering in the test. Production `timezone-combobox.tsx` is never exercised for search/filter. |
| **Risk / Impact** | Tests stay green while the real Combobox can fail to filter zone ids — Feature 01 searchable-timezone Intent unverified at the shipped surface. |
| **Evidence** | `vi.mock("@/components/schedules/timezone-combobox")`; “supports search” filters via mock local state, not production Combobox. |
| **Recommendation** | Add a focused RTL/jsdom test that renders the real `TimezoneCombobox` and asserts substring filtering; keep `listTimezoneGroups` unit coverage separately. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Render real combobox with fixed groups; type “Singapore”; expect `Asia/Singapore` visible and `America/New_York` absent. |
| **Acceptance Criteria** | At least one test fails if production `TimezoneCombobox` search/filter stops matching IANA ids by substring; mock-only search coverage is insufficient alone. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Mock reimplements filter logic — real anti-cheat shortcut vs Feature 01 AC, not a mere unrelated UI stub. |

---

### [ ] P1-20260721: Dashboard sequential + redundant Appwrite fetches

| Field | Value |
|---|---|
| **ID** | `P1-20260721` |
| **Severity** | Medium |
| **Category** | Performance |
| **Location** | `web/app/(protected)/page.tsx:34-109` |
| **Description** | `/` awaits health → feeds → runs → issues → delivery sequentially. `listDeliveryIssues` expands via `listIssues` again after the page already listed issues. Isolation via try/catch does not require serial execution. |
| **Risk / Impact** | Daily landing latency stacks round-trips and can re-list issues — slowing the page Feature 06 positions as the first view. |
| **Evidence** | Sequential awaits in `page.tsx`; `listDeliveryIssues` nested `listIssues` expansion. |
| **Recommendation** | Load independent sections with `Promise.allSettled` (or equivalent); reuse already-fetched issues for delivery attention when feasible instead of a second expansion. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Keep dashboard-page isolation/order tests green after refactor. |
| **Acceptance Criteria** | Independent dashboard data groups no longer await each other end-to-end; delivery attention does not require a redundant full `listIssues` expansion when issues already loaded; section error isolation preserved. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Sequential awaits and nested `listIssues` confirmed; full reuse of the recent-issues slice for delivery membership may need a different fetch shape, but redundant work is structural. |

---

### [ ] O1-20260721: Dashboard logs raw Appwrite exceptions

| Field | Value |
|---|---|
| **ID** | `O1-20260721` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `web/app/(protected)/page.tsx:38-100` |
| **Description** | Dashboard catch blocks log raw `err` via `console.error("[dashboard] …", err)`. Shared repositories sanitize via `sanitizeAppwriteMessageForLog`; the page bypasses that path. |
| **Risk / Impact** | Server logs may retain Appwrite exception text/codes the rest of the stack redacts. |
| **Evidence** | Direct `console.error(..., err)` in page catches vs `wrapAppwriteError` sanitized logging elsewhere. |
| **Recommendation** | Log structured fields with `sanitizeAppwriteMessageForLog`; keep operator-facing section strings on existing safe messages. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Verifier reads page catch blocks for sanitized logging. |
| **Acceptance Criteria** | Dashboard page catch logging does not print raw Appwrite exception objects/messages; UI section errors remain safe. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Page bypasses the established redaction helper as claimed. |

---

### [ ] M1-20260721: Hardcoded failed-runs href twin (Feature 06 `buildRunsHref` pin)

| Field | Value |
|---|---|
| **ID** | `M1-20260721` |
| **Severity** | Medium |
| **Category** | Maintainability & Best Practices |
| **Location** | `web/lib/dashboard-data.ts:4-5` (also `buildAttentionItems`) |
| **Description** | `buildRunsHref` lives in client `runs-pagination.tsx`, so `dashboard-data.ts` hardcodes `FAILED_RUNS_HREF = "/runs?status=failed"`. Feature 06 Spec pins failed-runs attention via `buildRunsHref({ status: "failed" })`. (Deduped anti-cheat finding N2 into this record — same root cause.) |
| **Risk / Impact** | Future Runs query encoding changes can desync attention deep links without a compile-time guard; tests asserting the string literal can stay green while skipping the pinned helper contract. |
| **Evidence** | Hardcoded constant in `dashboard-data.ts`; `buildRunsHref` exported from `"use client"` pagination module; delivery attention already uses `buildDeliveryHref`. |
| **Recommendation** | Move `buildRunsHref` to a non-client module (e.g. `web/lib/runs-url.ts`) and call it from pagination and `buildAttentionItems`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `buildAttentionItems` failed_runs.href === `buildRunsHref({ status: "failed" })`; widget href assertions remain green. |
| **Acceptance Criteria** | Failed-runs attention href is produced by the same pure helper used by Runs navigation; no hardcoded `/runs?status=failed` twin remains in `dashboard-data`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Dual source of truth and Spec pin bypass confirmed; functional href currently matches (Low anti-cheat alone), elevated to Medium with maintainability risk. |

---

## Dependencies and Licensing

- Vulnerabilities: none identified in this pass (no lockfile/CVE scan run; UI/shared polish scope)
- Outdated critical packages: none flagged in-scope
- License concerns: none

---

## Quality Signals

- Lint/config signals: not re-run in review; stage features previously verified with `pnpm typecheck` / `pnpm lint`
- Test/coverage signals: Feature 01 timezone search over-mocked (N1); dashboard attention vs Runs filter divergence lacks a regression fixture (C2); newsletter action session gate covered for update only (S1)
- Complexity/churn signals: Dashboard `page.tsx` is the densest risk surface (C2/P1/O1); newsletter actions auth inconsistency (S1)
- Dropped below floor after validation: C1-20260721 (audience trim in `draft()` → Low; mitigated by `validateAudience` on write)

---

## Risk Assessment

- **Overall risk:** Medium–High (two Highs in auth + dashboard attention correctness)
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Worker retention poller semantics (Feature 07 UI-only); Stage 09 delivery sanitization already reviewed; full middleware redesign project-wide

---

## PM Triage

PM accepted **all seven** findings for immediate hardening → `feature-08-hardening-review-2026-07-21`.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1-20260721 | High | Address now | Newsletter mutators missing session gate |
| C2-20260721 | High | Address now | Failed-run attention undercount |
| S2-20260721 | Medium | Address now | `?edit=` path escape |
| N1-20260721 | Medium | Address now | Timezone search mock-only |
| P1-20260721 | Medium | Address now | Sequential/redundant dashboard fetches |
| O1-20260721 | Medium | Address now | Unsanitized dashboard error logs |
| M1-20260721 | Medium | Address now | Hardcoded `buildRunsHref` twin (+ N2 pin) |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
