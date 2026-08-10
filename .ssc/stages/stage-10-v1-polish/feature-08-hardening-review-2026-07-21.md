# Feature 08: Harden stage-10 against review findings (2026-07-21)

## Intent

Harden stage-10-v1-polish against findings from `review-stage-10-v1-polish-2026-07-21`: gate newsletter mutators on a validated session, fix dashboard failed-run attention undercount, sanitize `?edit=` redirects, exercise real timezone search, parallelize/dedupe dashboard fetches, redact dashboard Appwrite logs, and unify failed-runs deep links via `buildRunsHref` — without reopening features 01–07.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–07 stay `verified`. It addresses **all seven** PM-accepted findings (2 High, 5 Medium) from the review. Distilled work — not a copy of the report:

### S1 (High) — session gates on newsletter mutators

`updateNewsletterAction` already calls `getAuthenticatedUser()` from `web/lib/auth/session.ts` and returns `{ ok: false, error: GENERIC_ERROR }` when null. Mirror that gate on every other mutating export in `web/app/(protected)/newsletters/actions.ts` **before** `getServerAppwrite()`:

| Entry point | On null user |
|-------------|--------------|
| `createNewsletterAction` | `{ ok: false, error: GENERIC_ERROR }`; do not call `createNewsletter` |
| `deleteNewsletterAction` | `{ ok: false, error: GENERIC_ERROR }`; do not delete |
| `attachFeedToNewsletter` | `{ ok: false, error: GENERIC_ERROR }`; do not attach |
| `detachFeedFromNewsletter` | `{ ok: false, error: GENERIC_ERROR }`; do not detach |
| `startNewsletterRun` | `{ ok: false, error: GENERIC_ERROR }`; do not enqueue |

Keep using `getServerAppwrite()` **after** the session gate (single-operator app). Extend `web/src/__tests__/newsletters-actions.test.ts` (or add coverage) so null-user paths never hit Appwrite/enqueue.

### C2 (High) — dedicated failed-run fetch for attention

Dashboard `/` currently uses one unfiltered `listRuns(client, { limit: 100 })` for both Recent runs and `computeAttentionCounts` failed-run counting. Status-filtered `/runs?status=failed` can show failures the badge missed when newer non-failed runs fill the shared window.

Fix:

1. Keep an unfiltered (or window-oriented) fetch for **Recent runs** (`selectRecentRuns` / 7-day cap 10) as today.
2. Fetch **failed-run attention** with a dedicated `listRuns(client, { status: "failed", limit: 100 })` (or equivalent status-filtered call).
3. Pass that failed set into `computeAttentionCounts` (or a thin wrapper) so `failedRuns` counts only in-window failures from the failed query — not from the mixed newest-100 pool.
4. Preserve section error isolation (failed-runs fetch failure must not blank other sections).

Add a regression fixture: many recent completed runs + older-but-in-window failures → attention `failedRuns` > 0.

### S2 (Medium) — validate `?edit=` before redirect

In `web/app/(protected)/newsletters/page.tsx`, only redirect when `edit` matches a safe document-id pattern (alphanumeric plus `_`/`-`; no `/`, `.`, `?`, `#`, or path segments). Malformed values: ignore `edit` (render list) or treat as not-found — never `redirect(\`/newsletters/${raw}\`)` that can normalize outside `/newsletters/<id>`.

### N1 (Medium) — real TimezoneCombobox search coverage

`schedule-fields-builder.test.tsx` mocks `TimezoneCombobox` and reimplements filter logic in the mock. Add a focused test that renders **production** `web/components/schedules/timezone-combobox.tsx` (fixed groups fixture or `listTimezoneGroups`) and asserts typing a substring hides non-matching zones (e.g. “Singapore” → `Asia/Singapore` visible, `America/New_York` absent). Keep pure `listTimezoneGroups` unit coverage separately. Mock-only “supports search” in the schedule-fields suite is insufficient alone.

### P1 (Medium) — parallel dashboard loads + less redundant issues work

In `web/app/(protected)/page.tsx`, load independent sections with `Promise.allSettled` (or equivalent) so health / feeds / runs / issues / delivery do not await each other end-to-end. Map each rejection to the existing per-section error strings. Where recent issues already loaded successfully, prefer reusing that data (or a shared helper) for delivery-failure attention instead of always expanding via a second `listDeliveryIssues` → `listIssues` loop when a cheaper path exists — without breaking Feature 06 membership/outcome semantics. Keep composition order: Needs attention → Recent issues → Recent runs → Health strip. Keep existing dashboard-page isolation tests green.

### O1 (Medium) — sanitize dashboard catch logs

Dashboard catch blocks currently `console.error("[dashboard] …", err)` with the raw exception. Log via `sanitizeAppwriteMessageForLog` from `shared/src/util/log-redact.ts` (message/code only), matching repository `wrapAppwriteError` practice. Operator-facing section errors stay on existing SAFE_* / repository-safe strings — do not leak Appwrite internals into the UI.

### M1 (Medium) — single source for failed-runs href (`buildRunsHref`)

`buildRunsHref` lives in client `web/components/runs/runs-pagination.tsx`, so `dashboard-data.ts` hardcodes `FAILED_RUNS_HREF = "/runs?status=failed"` (Feature 06 Spec pins `buildRunsHref({ status: "failed" })`).

1. Move `buildRunsHref` (pure URL builder) to a non-client module (e.g. `web/lib/runs-url.ts`).
2. Re-export or import from Runs pagination / client UI and from `buildAttentionItems`.
3. Remove the hardcoded twin constant from `dashboard-data.ts`.
4. Assert `buildAttentionItems` failed_runs.href === `buildRunsHref({ status: "failed" })`.

## Dependencies

- Builds on: **features 01–07 of this stage** (already `verified`).
- Anchor: `.ssc/reviews/review-stage-10-v1-polish-2026-07-21.md`.
- Auth helper: `web/lib/auth/session.ts` → `getAuthenticatedUser`.
- Log redaction: `shared/src/util/log-redact.ts` → `sanitizeAppwriteMessageForLog`.

## Constraints

- **Do not reopen** features 01–07 status; this is additive hardening.
- **Do not** redesign project-wide middleware — only gate the newsletter mutators listed under S1.
- **Keep** Feature 01 guided builder encode/decode, Advanced raw cron, and Schedules + Newsletter shared `ScheduleFields`.
- **Keep** Feature 02 tab order, create→edit redirect, forceMount cross-tab Save, Feeds immediate attach/detach.
- **Keep** Feature 03 `{audience}` contract, shipped drafter body, override precedence (blank → global).
- **Keep** Feature 04 default-collapsed inspect sections and stacked draft layout.
- **Keep** Feature 05 sidebar close, nav-active, hit targets, loading/error, title-case labels.
- **Keep** Feature 06 section order, caps (issues 5 / runs 7d×10), attention “show only when count > 0”, compact healthy health.
- **Keep** Feature 07 Advanced collapsed-by-default retention placement and purge semantics.
- Secrets: never log session secrets or raw Appwrite payloads in new code/tests.

## Acceptance criteria

- [ ] Unauthenticated / null `getAuthenticatedUser` cannot create/delete newsletters, attach/detach feeds, or start runs; authenticated happy paths still work; update gate unchanged. (S1)
- [ ] Failed-run attention is not understated solely because newer non-failed runs filled a shared unfiltered `limit: 100`; Recent-runs snapshot (7-day, cap 10) unchanged; section isolation preserved. (C2)
- [ ] Only well-formed newsletter ids trigger `?edit=` redirect; malformed values never produce a Location outside `/newsletters/<id>`. (S2)
- [ ] At least one test fails if production `TimezoneCombobox` search/filter stops matching IANA ids by substring. (N1)
- [ ] Independent dashboard data groups no longer await each other end-to-end; delivery attention does not require a redundant full `listIssues` expansion when a cheaper reuse path is available; composition order + isolation preserved. (P1)
- [ ] Dashboard page catch logging does not print raw Appwrite exception objects/messages; UI section errors remain safe. (O1)
- [ ] Failed-runs attention href is produced by `buildRunsHref`; no hardcoded `/runs?status=failed` twin remains in `dashboard-data`. (M1)
- [ ] `pnpm typecheck` and `pnpm lint` pass; web (and shared if touched) tests covering touched paths pass.

## Files

- Modify: `web/app/(protected)/newsletters/actions.ts` — session gates on create/delete/attach/detach/start (S1)
- Modify: `web/src/__tests__/newsletters-actions.test.ts` — null-user cases for those mutators (S1)
- Modify: `web/app/(protected)/page.tsx` — dedicated failed-runs fetch; parallel loads; sanitized logs (C2, P1, O1)
- Modify: `web/lib/dashboard-data.ts` — use `buildRunsHref`; attention inputs if needed (M1, C2)
- Create: `web/lib/runs-url.ts` (or equivalent) — pure `buildRunsHref` moved off client pagination (M1)
- Modify: `web/components/runs/runs-pagination.tsx` — import `buildRunsHref` from shared lib (M1)
- Modify: `web/app/(protected)/newsletters/page.tsx` — validate `edit` before redirect (S2)
- Create or modify: `web/src/__tests__/timezone-combobox.test.tsx` (or equivalent) — real combobox search (N1)
- Modify as needed: `web/src/__tests__/schedule-fields-builder.test.tsx` — do not rely solely on mock search (N1)
- Modify: `web/src/__tests__/dashboard-data.test.ts` — failed-runs href via `buildRunsHref`; undercount regression helpers if pure (C2, M1)
- Modify: `web/src/__tests__/dashboard-page.test.tsx` / `dashboard-widgets.test.tsx` — isolation + attention after parallel/failed fetch (C2, P1)
- Optional: create `web/src/__tests__/newsletters-edit-redirect.test.ts` (or page-level) — S2 malformed `edit` cases

## Testing approach

Test-first where practical: add failing session/attention/redirect/combobox/parallel/log/href cases, then implement.

1. **S1** — each mutator with `getAuthenticatedUser` → null → `ok: false`, no Appwrite/enqueue; valid user still succeeds.
2. **C2** — fixture: 100 completed newer than 2 in-window failed → attention `failedRuns` ≥ 2 (or > 0); Recent runs still cap 10 in window.
3. **S2** — `edit=nl-1` redirects; `edit=../schedules`, `edit=a/b`, empty/`#`/`?` do not escape.
4. **N1** — render real `TimezoneCombobox`; type substring; matching zone visible, non-match absent.
5. **P1** — isolation tests still pass; optional assert independent loaders start without strict serial dependency.
6. **O1** — verifier/unit: catch paths call sanitize helper (or do not pass raw `err` to `console.error`).
7. **M1** — `buildAttentionItems` failed_runs.href === `buildRunsHref({ status: "failed" })`.

## Tasks

### Task 1: Session gates on newsletter mutators (S1)

- **Action**: Add `getAuthenticatedUser()` early-return to `createNewsletterAction`, `deleteNewsletterAction`, `attachFeedToNewsletter`, `detachFeedFromNewsletter`, and `startNewsletterRun` before any `getServerAppwrite()` call, matching `updateNewsletterAction`. Extend `newsletters-actions.test.ts`.
- **Expected result**: Expired/invalid session cannot mutate via those actions.
- **Verify**: newsletters-actions tests green; S1 Acceptance Criteria met.
- **Depends on**: none.

### Task 2: Validate `?edit=` redirect (S2)

- **Action**: In `newsletters/page.tsx`, allow only a safe id pattern before `redirect`; ignore or not-found otherwise. Add tests for good and escaping `edit` values.
- **Expected result**: Deep-link compat cannot path-escape within the origin.
- **Verify**: S2 Acceptance Criteria met; typecheck/lint clean for touched files.
- **Depends on**: none.

### Task 3: Real TimezoneCombobox search test (N1)

- **Action**: Add a focused test rendering production `TimezoneCombobox` that asserts substring filtering. Keep `listTimezoneGroups` unit coverage. Do not treat mock-only schedule-fields search as sufficient.
- **Expected result**: Feature 01 searchable-timezone Intent is locked at the shipped component.
- **Verify**: new/updated timezone combobox test green; N1 Acceptance Criteria met.
- **Depends on**: none.

### Task 4: Extract `buildRunsHref` + wire attention (M1)

- **Action**: Move pure `buildRunsHref` to `web/lib/runs-url.ts` (or equivalent). Update Runs pagination and `buildAttentionItems` to use it; delete `FAILED_RUNS_HREF` twin. Extend dashboard-data tests.
- **Expected result**: One encoding source for failed-runs deep links.
- **Verify**: dashboard-data (+ any pagination) tests green; M1 Acceptance Criteria met.
- **Depends on**: none (prefer before or with Task 5 so C2 href stays consistent).

### Task 5: Dedicated failed-run attention fetch (C2)

- **Action**: In dashboard `page.tsx`, fetch failed runs with status filter for attention; keep separate path for Recent runs. Extend dashboard tests with undercount regression. Preserve per-section try/catch or allSettled isolation.
- **Expected result**: Badge counts align with status-filtered Runs reality under load.
- **Verify**: dashboard tests green; C2 Acceptance Criteria met.
- **Depends on**: Task 4 preferred first for href helper; otherwise none.

### Task 6: Parallel dashboard loads + sanitized logs (P1, O1)

- **Action**: Refactor `page.tsx` to `Promise.allSettled` (or equivalent) for independent sections; reduce redundant `listIssues` expansion for delivery attention when feasible; log catch paths via `sanitizeAppwriteMessageForLog`. Keep section order and isolation tests green.
- **Expected result**: Faster/safer landing loads; logs match project redaction pattern.
- **Verify**: dashboard-page tests green; P1 + O1 Acceptance Criteria met.
- **Depends on**: Task 5 if editing the same page in one pass; otherwise coordinate carefully.

### Task 7: Feature gate

- **Action**: Re-read this spec vs implementation; run gates for touched workspaces; fix gaps.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**: `pnpm typecheck && pnpm lint` plus vitest for touched web (and shared if any) paths.
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm --filter @newsletter/web exec vitest run` (touched test files at minimum) && `pnpm typecheck` && `pnpm lint`
- Expected: All green. Session gates, failed-run attention, edit redirect, real timezone search, parallel/safe dashboard loads, redacted logs, and unified `buildRunsHref` behave per Acceptance criteria. Features 01–07 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; which mutators gated (S1); failed-runs fetch shape (C2); id regex/pattern for S2; timezone test approach (N1); allSettled grouping + any delivery reuse strategy (P1); log sanitize call sites (O1); `runs-url` path + import updates (M1); any deviation and why. Reference report: `.ssc/reviews/review-stage-10-v1-polish-2026-07-21.md`.

## Research notes

- `getAuthenticatedUser` already validates via Appwrite `account.get()` on a session client — reuse; do not invent a second auth path.
- `sanitizeAppwriteMessageForLog` lives in `shared/src/util/log-redact.ts` — import from `@newsletter/shared` / existing export path used by repositories.
- Review dropped C1 (audience trim in `draft()`) below Medium floor after validation; **not** in this hardening scope unless PM reopens it.
