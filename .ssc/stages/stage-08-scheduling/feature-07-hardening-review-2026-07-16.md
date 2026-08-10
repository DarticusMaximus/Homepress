# Feature 07: Harden stage-08 against review findings (2026-07-16)

## Intent

Harden stage-08-scheduling against findings from `review-stage-08-scheduling-2026-07-16`: make scheduled fire consumption durable after enqueue, fix Schedules→newsletter deep-link for off-page ids, ensure due-check sees every newsletter, avoid silent partial schedule saves, and close the poller observability/config/a11y gaps — without reopening features 01–06.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–06 stay `verified`. It addresses eight PM-accepted findings (2 High, 6 Medium) from the review. Distilled work — not a copy of the report:

### C1 (High) — durable stamp after enqueue / busy-skip

`processDueSchedules` can enqueue (or busy-skip with `already_in_progress`) and then fail `setScheduleLastFiredAt`, leaving `isScheduleDue` true so the same previous-fire slot re-enqueues after the run ends. Make consume durable: retry stamp with backoff on ok/`already_in_progress`; use stamp-with-compare (only advance if current stamp is null or older than the new previous-fire ISO) so retries are idempotent; ensure a completed run without stamp cannot silently double-fire the same slot.

### C4 (High) + T1 (Medium) — deep-link works across pages/sorts + regression test

`/newsletters?edit={id}` only opens the dialog when the id is in the current page slice (updatedAt desc, 20/page), while Schedules links by name with no page hint — silent no-op. Resolve the target across the full list (or fetch by id), open edit (and/or redirect to the page that contains it preserving `edit`). Add an automated test that fails on the current off-page/sort-mismatch behavior and passes after the fix (covers T1).

### C2 (Medium) — due-check evaluates every newsletter

`listNewsletters` hard-caps at 100; `processDueSchedules` only iterates that page. Paginate (or add a due-check-specific full walk) so every enabled newsletter is considered each tick. Do **not** silently starve schedules beyond the GUI list page size. A create-time hard product cap is an acceptable alternative only if create rejects beyond the cap **and** due-check documents that bound — prefer pagination.

### C5 (Medium) — no unexplained partial schedule commit on newsletter edit

`updateNewsletterAction` writes schedule then definition with no rollback. On definition failure after schedule success: roll back schedule (and `scheduleLastFiredAt` clear) to the pre-save values, **or** return an explicit partial-failure result that forces revalidate and tells the operator schedule already changed. Prefer rollback so a failed Save does not leave schedule mutated.

### O1 (Medium) — structured schedule-tick logs

`SchedulePoller` discards `DueCheckResult`. Log a structured summary at least when `due > 0` or `errors > 0` (considered, due, enqueued, skipped, skippedActive, errors). No secrets/PII beyond newsletter ids already logged elsewhere.

### U1 (Medium) — Schedules action accessible names

Add per-row `aria-label` (and link accessible name) including the newsletter name on Edit schedule / Edit newsletter in both table and card presentations, matching the Newsletters list pattern.

### X1 (Medium) — clamp schedule poll interval

`parseSchedulePollMs` must reject/clamp non-positive and invalid values to `DEFAULT_SCHEDULE_POLL_MS` (or a documented minimum ≥ 1000ms); never pass `0`/negative to `setInterval`.

## Dependencies

- Builds on: **features 01–06 of this stage** (already `verified`) — schedule helpers, due-check, RunPoller serial execution, Schedules/edit GUI, trigger labels.
- Anchor: `.ssc/reviews/review-stage-08-scheduling-2026-07-16.md`.

## Constraints

- **Do not reopen** features 01–06 status; this is additive hardening.
- **Keep** Feature 05 stamp-on-`already_in_progress` and Feature 04 multi-due enqueue-all / no catch-up backlog semantics.
- **Keep** `updateNewsletter` omitting schedule keys; schedule writes stay on `updateNewsletterSchedule` / `setScheduleLastFiredAt`.
- **No OS cron**, no catch-up backlog of missed fires, no parallel cross-newsletter `executeJob`.
- **No schema attribute renames**; new helpers/opts OK if needed for stamp-compare or list pagination.
- Secrets: never log API keys or session material in new poller logs.

## Acceptance criteria

- [ ] After a successful scheduled enqueue or busy-skip, a transient or hard stamp failure cannot produce a second enqueue for the same `previousFire` once any in-flight run for that newsletter has finished; tests cover stamp-fail-then-retry and stamp-fail-after-run-complete. (C1)
- [ ] Visiting `/newsletters?edit=<id>` for any existing newsletter id opens `NewsletterFormDialog` in edit mode for that newsletter, regardless of default page-1 membership or list sort order. (C4)
- [ ] An automated test fails on the pre-fix off-page/sort-mismatch deep-link behavior and passes after the fix. (T1)
- [ ] Every enabled newsletter with a due previous fire is considered in one `processDueSchedules` invocation regardless of total count (or create is blocked before exceeding a documented cap); regression test fails if only the first page is scanned. (C2)
- [ ] A failed definition update after a successful schedule write cannot leave an unexplained schedule change, or the UI clearly reports partial success and refreshes both surfaces (prefer rollback). (C5)
- [ ] Every completed schedule tick that had due work or errors produces a structured log line with the `DueCheckResult` counters. (O1)
- [ ] Each Schedules Edit schedule / Edit newsletter control has a unique accessible name that includes the newsletter name in both ResponsiveList presentations. (U1)
- [ ] Non-positive or invalid `WORKER_SCHEDULE_POLL_MS` never becomes the interval delay; documented default/floor enforced with unit tests. (X1)
- [ ] `pnpm typecheck` and `pnpm lint` pass; shared, worker, and web tests covering touched paths pass.

## Files

- Modify: `shared/src/newsletters/due-check.ts` — durable stamp / retry / compare (C1)
- Modify: `shared/src/newsletters/repository.ts` — stamp-with-compare and/or pagination helper for due-check (C1, C2)
- Modify: `shared/src/newsletters/__tests__/due-check.test.ts` — stamp-fail durability + multi-page due (C1, C2)
- Modify: `shared/src/newsletters/__tests__/repository.test.ts` — pagination / stamp-compare as needed (C1, C2)
- Modify: `web/app/(protected)/newsletters/page.tsx` — resolve `edit` across full list / fetch / redirect (C4)
- Modify: `web/components/newsletters/newsletters-table.tsx` and/or view — open dialog from resolved target (C4)
- Modify: `web/src/__tests__/newsletters-edit-deeplink.test.tsx` (and/or new page-level test) — off-page / sort-mismatch (C4, T1)
- Modify: `web/app/(protected)/newsletters/actions.ts` — rollback or explicit partial-failure on schedule-then-definition (C5)
- Modify: `web/src/__tests__/newsletters-actions.test.ts` — definition fail after schedule success (C5)
- Modify: `worker/src/schedule-poller.ts` — tick summary log + poll-ms clamp (O1, X1)
- Modify: `worker/src/__tests__/schedule-poller.test.ts` — log + parse clamp cases (O1, X1)
- Modify: `web/components/schedules/schedules-table.tsx` — per-row aria-labels (U1)
- Modify: `web/components/schedules/schedule-list-card.tsx` — per-row aria-labels (U1)
- Modify: `web/src/__tests__/schedules-responsive-list.test.tsx` — accessible name assertions (U1)

## Testing approach

Test-first where practical: add failing cases for C1 stamp durability, C2 multi-page due, C4/T1 off-page deep-link, C5 partial-save policy, X1 clamp, O1 log, U1 a11y — then implement.

1. **C1** — enqueue ok + stamp reject once → retry stamp, single enqueue; stamp always fails + next tick with no active run → no second enqueue for same previousFire (or documented reconcile that still prevents double-fire).
2. **C2** — >100 newsletters with due schedule only on later page → enqueued once.
3. **C4/T1** — ≥21 newsletters; Schedules/name-ordered id absent from newsletters page-1 updatedAt slice → dialog opens (or redirect then open).
4. **C5** — schedule update succeeds, definition update rejects → schedule rolled back (preferred) or explicit partial-failure contract asserted.
5. **O1** — mock non-zero `DueCheckResult` → structured log includes counters.
6. **X1** — `"0"`, `"-1"`, `"abc"` → default/floor; poller never uses ≤0.
7. **U1** — getByRole with name including newsletter name for Edit schedule / Edit newsletter in table and cards.

## Tasks

### Task 1: Durable scheduleLastFiredAt consume (C1)

- **Action**: In `shared/src/newsletters/due-check.ts` (and repository helpers as needed), after successful enqueue or `already_in_progress` busy-skip, retry `setScheduleLastFiredAt` with bounded backoff on transient failure. Prefer stamp-with-compare so the stamp only advances when null or older than the previous-fire ISO (idempotent retries). Add due-check tests for stamp-fail-then-retry and stamp-fail-after-run-complete (no second enqueue for the same previousFire).
- **Expected result**: Fire consumption is durable across stamp failures; double-fire of one slot is prevented by tests.
- **Verify**: `pnpm --filter @newsletter/shared exec vitest run src/newsletters/__tests__/due-check.test.ts` (and repository stamp tests if added); finding C1 Acceptance Criteria met.
- **Depends on**: none.

### Task 2: Due-check walks every newsletter (C2)

- **Action**: Paginate newsletter listing for due-check (extend `listNewsletters` with cursor/page loop, or add a dedicated helper used only by `processDueSchedules`) so every document is considered. Add a regression test with >`NEWSLETTER_LIST_LIMIT` fixtures where only a later-page newsletter is due. If choosing a hard create-time cap instead, enforce reject-on-create and document the bound in code comments + test — prefer pagination.
- **Expected result**: No silent schedule starvation beyond the first page.
- **Verify**: due-check / repository tests green; C2 Acceptance Criteria met.
- **Depends on**: none (can parallel conceptually with Task 1; implement after or with Task 1 as convenient).

### Task 3: Deep-link resolves off-page ids + regression test (C4, T1)

- **Action**: Fix `web/app/(protected)/newsletters/page.tsx` (and table/view as needed) so `edit` resolves against the full newsletter list or a fetch-by-id, then opens `NewsletterFormDialog` (redirect to the correct page preserving `edit` is OK if dialog still opens). Extend `newsletters-edit-deeplink.test.tsx` (or add a page-level test) with ≥21 newsletters / sort-mismatch so the test fails before the fix and passes after.
- **Expected result**: Schedules Edit newsletter works for any existing id; T1 gap closed.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/newsletters-edit-deeplink.test.tsx` (and any new test file); C4 + T1 Acceptance Criteria met.
- **Depends on**: none.

### Task 4: Newsletter edit schedule/definition partial-failure policy (C5)

- **Action**: In `web/app/(protected)/newsletters/actions.ts`, on `updateNewsletter` failure after successful `updateNewsletterSchedule`, roll back schedule fields (and last-fired) to the values loaded before the attempt (preferred). If rollback is impractical, return a distinct partial-failure error and revalidate `/schedules` + `/newsletters` with copy that schedule already changed. Extend `newsletters-actions.test.ts` accordingly.
- **Expected result**: Failed Save never leaves an unexplained schedule mutation (or clearly reports partial success).
- **Verify**: newsletters-actions tests green; C5 Acceptance Criteria met.
- **Depends on**: none.

### Task 5: Poller tick logs + poll-ms floor (O1, X1)

- **Action**: In `worker/src/schedule-poller.ts`, clamp/reject non-positive and invalid `WORKER_SCHEDULE_POLL_MS` to the default (or ≥1000ms floor); log when falling back. After each successful `processDueSchedules`, when `due > 0` or `errors > 0`, emit a structured summary with DueCheckResult counters. Extend `schedule-poller.test.ts`.
- **Expected result**: Misconfigured env cannot busy-loop; operators can see due/enqueue/skip/error counts on active ticks.
- **Verify**: `pnpm --filter worker test` (or vitest path for schedule-poller); O1 + X1 Acceptance Criteria met.
- **Depends on**: none.

### Task 6: Schedules per-row accessible names (U1)

- **Action**: Add newsletter-name-scoped `aria-label` / accessible names on Edit schedule and Edit newsletter in `schedules-table.tsx` and `schedule-list-card.tsx`. Extend `schedules-responsive-list.test.tsx`.
- **Expected result**: Each row’s actions are distinguishable to assistive tech.
- **Verify**: schedules-responsive-list tests green; U1 Acceptance Criteria met.
- **Depends on**: none.

### Task 7: Feature gate

- **Action**: Re-read this spec vs implementation; run full gates for touched workspaces; fix gaps.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**: `pnpm --filter @newsletter/shared test && pnpm --filter worker test && pnpm --filter web test && pnpm typecheck && pnpm lint` (scope web/worker tests to touched files if full suite is impractical, but typecheck/lint must be full-repo).
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter worker test && pnpm --filter web test && pnpm typecheck && pnpm lint`
- Expected: All green. Stamp durability, multi-page due-check, off-page deep-link, partial-save policy, poller log/clamp, and Schedules a11y labels behave per Acceptance criteria. Features 01–06 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; confirmation of stamp retry/compare behavior; deep-link strategy chosen (full-list resolve vs fetch-by-id vs redirect); due-check pagination approach; schedule rollback vs partial-failure messaging for C5; poll-ms floor value; any deviation and why. Reference report: `.ssc/reviews/review-stage-08-scheduling-2026-07-16.md`.
