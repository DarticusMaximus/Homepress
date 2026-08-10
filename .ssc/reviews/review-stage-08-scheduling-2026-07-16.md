# SSC Code Review Report

**Date:** 2026-07-16
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-08-scheduling (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-08-scheduling/` (features 01–06)

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 2 | Medium 6 | Low 0 | Nit 0
- **Overall rationale:** Stage 08 delivers the schedule contract, worker due-trigger, concurrency consume-on-busy, Manual/Scheduled labels, and Schedules/edit GUI. Two Highs remain before finalize is comfortable: non-atomic enqueue+stamp can double-fire a slot after stamp failure (C1), and Schedules “Edit newsletter” deep-links silently no-op when the newsletter is off the current Newsletters page/sort slice (C4). Six Mediums cover the 100-newsletter due-check cap, partial schedule+definition saves, poller observability/config floors, deep-link test gap, and Schedules a11y labels. No Blockers; no Confirmed anti-cheat. Suitable for a hardening feature on the Highs (and any Mediums the PM accepts).

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-08-scheduling` (6 verified features: per-newsletter schedule, Schedules page, newsletter-edit schedule+scroll, due trigger, concurrency policy, missed fires + history)
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 46 (production + tests across `shared/`, `worker/`, `web/`)
  - **Batch B1 — Shared schedule + worker due path (F01, F04, F05, F06 backend):** `shared/src/schema/declarations.ts`, `shared/src/schema/__tests__/declarations.test.ts`, `shared/src/newsletters/{types,repository,schedule,due-check,index}.ts`, `shared/src/newsletters/__tests__/{schedule,repository,due-check}.test.ts`, `shared/src/runs/{start,types,repository}.ts`, `shared/src/runs/__tests__/{start,repository,retry}.test.ts`, `worker/src/{schedule-poller,run-poller,index}.ts`, `worker/src/__tests__/{schedule-poller,run-poller}.test.ts`
  - **Batch B2 — Web Schedules + edit + history labels (F02, F03, F06 GUI):** `web/app/(protected)/schedules/{page,actions}.tsx`, `web/components/schedules/{schedules-view,schedules-table,schedule-list-card,schedule-edit-dialog,schedules-pagination,schedule-fields}.tsx`, `web/app/(protected)/newsletters/{page,actions}.tsx`, `web/components/newsletters/{newsletters-view,newsletters-table,newsletter-form-dialog}.tsx`, `web/components/runs/{run-display,runs-table,run-list-card,inspect-shell}.{ts,tsx}`, `web/src/__tests__/{feeds-nav,schedules-responsive-list,schedules-actions,newsletters-edit-deeplink,newsletter-form-schedule,newsletters-actions,runs-trigger-label,schedules-missed-fires-note}.test.{ts,tsx}`
- **Files skipped:**
  - `shared/package.json` — dep pin (`cron-parser`) only; not line-reviewed
  - `web/lib/nav-items.ts` — Spec pin “do not reorder”; Schedules href covered via nav test only
  - `web/components/ui/dialog.tsx` — optional scroll default; scroll landed on newsletter dialog content
  - `shared/src/runs/schedule-due.ts` — does not exist; due path lives in `due-check.ts`
- **Assumptions and unknowns:**
  - Spec Files sections cross-checked against disk; all required files present.
  - No live Appwrite/worker integration; stamp/enqueue races judged from unit structure + code paths.
  - Validator rejected C3 (Intl hour-24 midnight claim) and N1 (canned next-fire mock as anti-cheat) — dropped from this report.
  - Product V1 may intend ≤100 newsletters; C2 still conflicts with “evaluate ALL enabled” pin unless a create-time cap is documented.

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Feature Intent lines:** (all six)
  - F01 — Persist enable/disable schedule (cron + IANA TZ); expose correct next-fire when enabled.
  - F02 — Top-level Schedules list (responsive) with edit + deep-link into newsletter edit.
  - F03 — Schedule controls on newsletter edit dialog; dialog scrolls so all sections reachable.
  - F04 — Worker due-check enqueues Stage 04 pending runs without OS cron.
  - F05 — Skip+consume due fire when same newsletter already active; serial cross-newsletter execution.
  - F06 — No catch-up backlog after downtime; Manual vs Scheduled distinguishable in history/inspect.
- **Intent served?** Partially
- **Notes:** Core schedule persistence, due semantics, stamp-on-`already_in_progress`, no-catch-up enqueue-once, trigger labels, Schedules UI, and edit-mode schedule+scroll are present and largely match pins. Material drift risks: C4 undermines F02 deep-link Intent for multi-page libraries; C1 undermines F05 “consume the fire” durability when stamp fails after enqueue. C2 can starve schedules beyond the list cap. Remaining Mediums are operability/hardening, not Intent failures.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [ ] C1-20260716: Enqueue + scheduleLastFiredAt stamp is not durable (double-fire after stamp failure)

| Field | Value |
|---|---|
| **ID** | `C1-20260716` |
| **Severity** | High |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/newsletters/due-check.ts:78-114` |
| **Description** | Enqueue (or `already_in_progress` busy-skip) and `scheduleLastFiredAt` stamp are not atomic. A successful enqueue / busy-skip followed by a thrown `setScheduleLastFiredAt` leaves the fire unconsumed. After the active/pending run ends, the next tick still sees `isScheduleDue=true` and can enqueue again for the same previous-fire slot. |
| **Risk / Impact** | Duplicate scheduled runs for one fire window — extra OpenRouter cost and back-to-back generation that F05 busy-skip is meant to prevent when the stamp write fails or the process crashes between enqueue and stamp. |
| **Evidence** | Success path awaits stamp only after `enqueueResult.ok`; `already_in_progress` path stamps separately. Both sit inside try/catch that increments `errors` and continues without a consumed stamp. Recovery via `already_in_progress` only works while that run is still active. |
| **Recommendation** | Make consume durable: retry stamp with backoff after ok/already_in_progress; stamp-with-compare (only advance if null or older) for idempotent retries; on persistent stamp failure leave a clear error metric. Prefer crash-safe ordering so a completed run without stamp cannot re-fire the same `previousFire`. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Unit: enqueue ok, stamp rejects once then succeeds — assert retry and single enqueue. Unit: stamp always fails, run no longer active on next tick — assert no second enqueue for same previousFire (or documented reconcile). Integration: kill between enqueue and stamp, restart, assert at most one scheduled run for that fire. |
| **Acceptance Criteria** | After a successful scheduled enqueue or busy-skip, a transient or hard stamp failure cannot produce a second enqueue for the same `previousFire` once any in-flight run for that newsletter has finished; tests cover stamp-fail-then-retry and stamp-fail-after-run-complete. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | `processDueSchedules` enqueues then awaits stamp; throws hit catch without consuming the fire, leaving `isScheduleDue` true so a completed run can be re-enqueued for the same previous-fire slot. |

---

### [ ] C4-20260716: Schedules “Edit newsletter” deep-link silently no-ops for off-page / sort-mismatch ids

| Field | Value |
|---|---|
| **ID** | `C4-20260716` |
| **Severity** | High |
| **Category** | Correctness & Reliability |
| **Location** | `web/app/(protected)/newsletters/page.tsx:57-137` (also `newsletters-table.tsx` resolveInitialEditTarget; Schedules hrefs in `schedules-table.tsx` / `schedule-list-card.tsx`) |
| **Description** | Schedules links to `/newsletters?edit={id}` without ensuring the target is on the current page. Newsletters only opens the dialog when the id is in the current page slice. Schedules sorts by name; newsletters list is `updatedAt` desc — with >20 newsletters the target is often absent from page 1 and the dialog never opens (silent no-op). |
| **Risk / Impact** | Primary Schedules CTA to edit a newsletter definition fails for many rows once the library grows past one page, undermining Feature 02 Intent. |
| **Evidence** | Page passes only the sliced `newsletters` plus `initialEditId`; resolve finds only within that slice; Schedules emits `/newsletters?edit=${id}` with no `page=` or id-based redirect; list sort orders diverge. |
| **Recommendation** | When `edit` is present, resolve across the full list (or fetch by id), redirect to the page that contains it (preserving `edit`), or open the dialog from a fetched record even if not on the current page. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | >PAGE_SIZE newsletters with divergent name vs updatedAt order; follow Schedules Edit newsletter href and assert Edit dialog opens for that id. |
| **Acceptance Criteria** | Visiting `/newsletters?edit=<id>` for any existing newsletter id opens `NewsletterFormDialog` in edit mode for that newsletter, regardless of default page-1 membership or list sort order. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | NewslettersPage slices PAGE_SIZE=20 after updatedAt sort; resolveInitialEditTarget is slice-local; Schedules name-sort links have no page redirect — off-page ids silently no-op. |

---

### [ ] C2-20260716: Due-check only sees first 100 newsletters (list hard-cap)

| Field | Value |
|---|---|
| **ID** | `C2-20260716` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/newsletters/repository.ts:25-89`; consumed by `shared/src/newsletters/due-check.ts:44-56` |
| **Description** | `listNewsletters` hard-caps at `NEWSLETTER_LIST_LIMIT` (100). `processDueSchedules` uses that list as the sole universe of schedules, so enabled newsletters beyond the cap are never due-checked on a tick. |
| **Risk / Impact** | Spec pin requires evaluating ALL enabled newsletters each tick; silent schedule starvation for newsletters sorted out of the top 100. |
| **Evidence** | `NEWSLETTER_LIST_LIMIT = 100`; `Query.limit(NEWSLETTER_LIST_LIMIT)`; due-check iterates only that array with no pagination. |
| **Recommendation** | Paginate until a short page, or add `listEnabledSchedules`, or document/enforce a hard create-time product cap. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Fixture with >100 newsletters including an enabled due schedule only on page 2; assert `processDueSchedules` enqueues it (or create rejects beyond documented cap). |
| **Acceptance Criteria** | Every enabled newsletter with a due previous fire is considered in one `processDueSchedules` invocation regardless of total count (or create is blocked before exceeding a documented cap); regression test fails if only the first page is scanned. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Hard-cap + single-page iteration verified; only manifests above 100 newsletters but conflicts with “evaluate all” pin. |

---

### [ ] C5-20260716: Newsletter edit can commit schedule then fail definition with no rollback

| Field | Value |
|---|---|
| **ID** | `C5-20260716` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/app/(protected)/newsletters/actions.ts:136-154` |
| **Description** | `updateNewsletterAction` persists schedule via `updateNewsletterSchedule` before `updateNewsletter` with no rollback. If the definition write fails after a successful schedule write, Appwrite already has the new schedule (and cleared `scheduleLastFiredAt`) while the action returns `ok:false`. |
| **Risk / Impact** | Operator sees a failure toast but schedule may already have changed; Schedules and Newsletters can disagree with what the operator believes was saved. |
| **Evidence** | Sequential awaits inside one action; tests cover schedule validation aborting before definition update, not definition failure after schedule success. |
| **Recommendation** | On definition failure after schedule success, roll back schedule to prior values, or surface an explicit partial-failure error and force revalidate of both surfaces. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | `updateNewsletterSchedule` resolves, `updateNewsletter` rejects → assert `ok:false` and document/assert rollback or partial-success messaging. |
| **Acceptance Criteria** | A failed definition update after a successful schedule write cannot leave an unexplained schedule change, or the UI clearly reports partial success and refreshes both surfaces. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Schedule-then-definition order with no compensating write verified; schedule clear of `scheduleLastFiredAt` makes partial commits especially sharp. |

---

### [ ] O1-20260716: Schedule poller discards DueCheckResult (no tick summary logs)

| Field | Value |
|---|---|
| **ID** | `O1-20260716` |
| **Severity** | Medium |
| **Category** | Observability |
| **Location** | `worker/src/schedule-poller.ts:34-50` |
| **Description** | `SchedulePoller` discards `processDueSchedules`’ `DueCheckResult`. Successful ticks emit no structured summary of considered/due/enqueued/skippedActive/errors; only uncaught tick throws and per-newsletter `console.error` inside due-check are visible. |
| **Risk / Impact** | Operators cannot tell from worker logs whether the schedule poller is healthy, skipping busy fires, or repeatedly erroring stamps/enqueues. |
| **Evidence** | `tick()` awaits and ignores the return value; `start()` only logs on rejection. |
| **Recommendation** | Log a structured summary each tick at least when `due>0` or `errors>0` (considered, due, enqueued, skipped, skippedActive, errors); keep secret redaction. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | SchedulePoller test with mock resolving a non-zero result; assert log receives summary including enqueued/errors/skippedActive. |
| **Acceptance Criteria** | Every completed schedule tick that had due work or errors produces a structured log line with the `DueCheckResult` counters. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Return value discarded; only thrown tick errors logged. |

---

### [ ] T1-20260716: Deep-link tests never cover off-page / sort-mismatch (C4 stays green)

| Field | Value |
|---|---|
| **ID** | `T1-20260716` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `web/src/__tests__/newsletters-edit-deeplink.test.tsx:69-95` |
| **Description** | Deep-link coverage only renders `NewslettersTable` with a newsletter already in the `newsletters` prop. There is no test that page parsing + Schedules href + off-page / sort-mismatch cases open (or redirect to) the edit dialog. |
| **Risk / Impact** | The High deep-link defect (C4) can regress indefinitely while existing tests stay green. |
| **Evidence** | Test covers matching and unknown ids within a one-item in-memory list; Schedules responsive-list checks href shape but not newsletters page behavior for off-page ids. |
| **Recommendation** | Add a page-level/integration test with an edit id absent from the current page slice (or >PAGE_SIZE fixtures) asserting dialog open or correct redirect. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Fixture ≥21 newsletters; name-ordered id not in page-1 updatedAt slice; assert deep-link opens edit dialog after fix. |
| **Acceptance Criteria** | Automated test fails on current implementation for off-page edit ids and passes once deep-link resolution works across pages/sorts. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Only in-list match/unknown covered; no off-page assertion — C4 remains green under current tests. |

---

### [ ] U1-20260716: Schedules actions lack per-row accessible names

| Field | Value |
|---|---|
| **ID** | `U1-20260716` |
| **Severity** | Medium |
| **Category** | UX / i18n / Accessibility |
| **Location** | `web/components/schedules/schedules-table.tsx:34-39` (also `schedule-list-card.tsx:52-62`) |
| **Description** | Schedules row/card actions expose multiple identical accessible names (“Edit schedule”, “Edit newsletter”) with no per-row `aria-label`, unlike Newsletters Edit/Delete which use `aria-label={\`Edit ${newsletter.name}\`}`. |
| **Risk / Impact** | Screen-reader and voice-control users cannot distinguish which newsletter an action targets when the list has more than one row. |
| **Evidence** | Bare button/link text on Schedules; name-scoped aria-labels already established on newsletters table. |
| **Recommendation** | Add `aria-label` (and matching link accessible name) including the newsletter name on Edit schedule and Edit newsletter in both table and card presentations. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Extend `schedules-responsive-list.test.tsx` to assert unique accessible names per fixture row. |
| **Acceptance Criteria** | Each Schedules Edit schedule / Edit newsletter control has a unique accessible name that includes the newsletter name in both ResponsiveList presentations. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | No per-row aria-label on Schedules actions; newsletters table already has the pattern. |

---

### [ ] X1-20260716: WORKER_SCHEDULE_POLL_MS allows 0 / negative (busy-loop risk)

| Field | Value |
|---|---|
| **ID** | `X1-20260716` |
| **Severity** | Medium |
| **Category** | Config / Infra / CI |
| **Location** | `worker/src/schedule-poller.ts:5-7` |
| **Description** | `parseSchedulePollMs` accepts any finite `parseInt` result, including 0 and negative values, and uses it as `setInterval` delay. |
| **Risk / Impact** | Mis-set env can busy-loop the due check (CPU + Appwrite load) and amplify enqueue/stamp races under load. |
| **Evidence** | Finite check only — no minimum; constructor/`start()` pass value through to `setInterval`. |
| **Recommendation** | Clamp to a minimum (e.g. 1000ms) and treat `<=0` or non-finite as `DEFAULT_SCHEDULE_POLL_MS`; log when falling back. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `parseSchedulePollMs("0")`, `("-1")`, `("abc")` → default or clamped minimum. |
| **Acceptance Criteria** | Non-positive or invalid `WORKER_SCHEDULE_POLL_MS` never becomes the interval delay; documented default/floor enforced with unit tests. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Zero/negative finite values accepted and passed to `setInterval`. |

---

## Dependencies and Licensing

- Vulnerabilities: none reviewed in depth this pass (`cron-parser` present via Feature 01; lockfile not audited)
- Outdated critical packages: not assessed line-by-line
- License concerns: none identified in scope

---

## Quality Signals

- Lint/config signals: not re-run in this review pass (features already verified green)
- Test/coverage signals: strong unit coverage for due helpers, stamp-on-busy, trigger coerce; gaps called out in T1 (deep-link off-page) and C1 (stamp-fail durability)
- Complexity/churn signals: Stage 08 concentrates risk in `due-check.ts` + Schedules↔Newsletters deep-link; GUI schedule fields share a common component path

---

## Risk Assessment

- **Overall risk:** Medium-High (two High correctness findings on fire consumption and deep-link)
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Stage 09 delivery; OS cron; catch-up backlog by design; parallel cross-newsletter pipeline execution; live multi-node worker fleets

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| C1-20260716 | High | Address now | Fire consumption durability before finalize |
| C4-20260716 | High | Address now | Deep-link operability |
| C2-20260716 | Medium | Address now | Due-check must see all schedules |
| C5-20260716 | Medium | Address now | No silent partial schedule commits |
| O1-20260716 | Medium | Address now | Poller visibility |
| T1-20260716 | Medium | Address now | Lock C4 with regression test |
| U1-20260716 | Medium | Address now | Schedules a11y parity |
| X1-20260716 | Medium | Address now | Prevent poll busy-loop |

Hardening feature: `feature-07-hardening-review-2026-07-16`

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
