# Feature 06: Delivery visibility

## Intent

Fill the Stage 02 `/delivery` nav placeholder as the primary delivery hub (Runs-like list of issues with email/RSS outcomes and failure reasons) and add compact status badges on Issues, so the operator can see whether an issue was emailed and/or published — and why a delivery failed — without log-diving.

## Spec

Persist **last-write-wins** per-channel delivery outcomes on the **run** document. Record after every manual and auto call to `sendIssueEmail` / `publishIssueToRss`. Replace the under-construction `/delivery` page with a Runs-pattern hub listing **eligible issues that have ≥1 delivery attempt**. Add compact email/RSS badges on Issues list + detail. Do **not** add delivery chrome to Runs or Inspect. Do **not** move Send/Publish/Download off Issues.

### Status model (locked)

| Channel | Status values | Timestamp field | Error field |
|---------|---------------|-----------------|-------------|
| Email | `none` \| `sent` \| `failed` | `emailDeliveryAt` | `emailDeliveryError` |
| RSS | `none` \| `published` \| `failed` | `rssDeliveryAt` | `rssDeliveryError` |

| Rule | Contract |
|------|----------|
| Defaults | On create / missing read: status `none`, timestamp `null`, error `""`. |
| Success | Set status to `sent` / `published`; set `*At` to now (ISO); clear that channel’s error to `""`. |
| Failure | Set status to `failed`; set `*At` to now; store operator-facing / sanitized error (truncate to `DELIVERY_ERROR_MAX` = **2000**); never store secrets. |
| Re-attempt | Overwrite that channel’s three fields (last-write-wins). Other channel untouched. |
| Attempt | Any finished orchestration call that returns success **or** failure (including empty recipients, missing SMTP, load errors, transport/Appwrite failures) **records**. Do not leave `none` after the operator (or auto-deliver) invoked the channel entry point. |
| Persist isolation | If send/publish **succeeds** but the status write fails: keep the channel result success for the caller; log sanitized persist failure; leave prior status (may stay `none`/stale) until a later attempt. Never fail the send/publish because status persistence failed. If send/publish **fails**, still attempt to record `failed` + error; if that write also fails, log and return the original channel failure. |
| Retention | Delivery fields live on the run; Stage 04 retention purges them with the run. RSS snapshots may outlive the run — Delivery list is run/issue-scoped. |

### Schema (locked)

Append to `runs` in `shared/src/schema/declarations.ts` (create-if-absent; no drop/rename/retype/migrate):

| Attribute | Type | Notes |
|-----------|------|-------|
| `emailDeliveryStatus` | string size **16**, default `"none"` | Required false |
| `emailDeliveryAt` | datetime | Required false |
| `emailDeliveryError` | string size **2000** | Required false |
| `rssDeliveryStatus` | string size **16**, default `"none"` | Required false |
| `rssDeliveryAt` | datetime | Required false |
| `rssDeliveryError` | string size **2000** | Required false |

Export constants:

- `EMAIL_DELIVERY_STATUSES = ["none", "sent", "failed"]`
- `RSS_DELIVERY_STATUSES = ["none", "published", "failed"]`
- `DELIVERY_ERROR_MAX = 2000`
- `DELIVERY_STATUS_ATTR_SIZE = 16`

Extend `Run` in `shared/src/runs/types.ts` with the six fields. Coerce in `documentToRun`: unknown/missing status → `none`; missing error → `""`; missing datetime → `null`. `createRun` writes the six defaults.

### Recording (locked)

Shared helpers (names may vary slightly; keep intent) in `shared/src/delivery/`:

```ts
recordEmailDelivery(client, runId, outcome: { ok: true } | { ok: false; error: string }): Promise<void>
recordRssDelivery(client, runId, outcome: { ok: true } | { ok: false; error: string }): Promise<void>
```

- Update only that channel’s three attributes (+ do not touch pipeline fields).
- Swallow Appwrite errors after logging (sanitized) — callers treat record as best-effort except tests that inject a failing updater may assert log/swallow.
- Wire **inside** `sendIssueEmail` and `publishIssueToRss` after the channel outcome is known (success or failure), so Feature 05 auto-deliver and Issues manual actions both persist without a second call site.

Injectable record deps on send/publish for unit tests (optional override) are allowed; production defaults to the real recorders.

### List membership & filters (locked)

```ts
hasDeliveryAttempt(run: Run): boolean
// emailDeliveryStatus !== "none" OR rssDeliveryStatus !== "none"

listDeliveryIssues(client, opts?: {
  newsletterId?: string;
  outcome?: "all" | "any_failure" | "email_failed" | "rss_failed";
  limit?: number; // default 100
}): Promise<Run[]>
```

1. Start from eligible issues (`listIssues` semantics: completed + non-empty `checkpointDraftId`).
2. Keep only `hasDeliveryAttempt`.
3. Apply `outcome` in memory:
   - `all` — no extra filter
   - `any_failure` — email `failed` OR rss `failed`
   - `email_failed` — email `failed`
   - `rss_failed` — rss `failed`
4. Sort same as Issues (`endedAt ?? startedAt` desc, then `$id` desc).

Issues with both channels still `none` never appear on `/delivery` (they remain on Issues only).

### Delivery page UI (locked)

Replace `web/app/(protected)/delivery/page.tsx` placeholder.

Mirror **Runs** structure:

- Title: `Delivery`
- Subtitle: e.g. `Email and RSS outcomes for issues that have been sent or published — diagnose delivery failures here.`
- Filters: Newsletter (All / pick) + Outcome (All / Any failure / Email failed / RSS failed) via URL search params (same pattern as Runs).
- Responsive list (table desktop / cards phone) — shared `ResponsiveList` convention.
- Columns: **Title** (issue display title; page may enrich via `resolveIssueDisplayTitlesForRuns` like Issues), **Newsletter**, **Date**, **Email** (badge), **RSS** (badge), **Failure** (combined), **Actions**.
- Badge labels (locked): Email — `—` / `Sent` / `Failed`; RSS — `—` / `Published` / `Failed`. Badge variants: success → default; failed → destructive; none → secondary or muted `—` text.
- Failure column: if email failed and/or RSS failed, show operator-facing error(s); both → `Email: … · RSS: …`; truncate with full `title` tooltip; if neither failed → `—`.
- Actions: **Open** → `/issues/[runId]` only (no Send/Publish on this page).
- Empty state: copy that delivery rows appear after Send, Publish, or auto-deliver — point operator at Issues / newsletter Delivery toggles.
- Pagination: page size **20**, same clamp/redirect pattern as Runs/Issues.

### Issues compact badges (locked)

- **Issues list** (table + cards): show compact Email + RSS badges using the same labels/variants (from run fields already on the issue row — no extra fetch).
- **Issue detail** success path: show the same compact badges in chrome (meta row or beside Send/Publish) so status is visible without opening `/delivery`.
- Load-error / not-available paths: no badges.
- Runs list and Inspect: **no** delivery badges.

### Stage acceptance amendment (locked)

This feature updates `.ssc/stages/stage-09-delivery.md` acceptance from “Issues/run UI shows…” to: **Delivery page (`/delivery`) is the primary hub** for email/RSS status + failure reasons; **Issues** show compact badges; Runs/Inspect do not.

### Out of scope

- Attempt history / separate deliveries collection.
- Moving Send/Publish/Download onto `/delivery`.
- Delivery chrome on Runs or Inspect.
- Auto-export, signup, unsubscribe.
- Changing SMTP/RSS body semantics.

## Dependencies

- **Hard execute prerequisites (must be `verified` before execute):**
  - **feature-02-email-delivery** — `sendIssueEmail` exists to wrap.
  - **feature-03-rss-publication** — `publishIssueToRss` exists to wrap.
- **Soft / recommended:** feature-05-auto-deliver-after-success verified so auto path is live; not required if wrap is inside send/publish (auto inherits recording).
- Builds on: Stage 02 `/delivery` placeholder + nav; Stage 06 Issues list/detail; Runs page layout patterns; Feature 01 does not need to change.

## Constraints

- Do not start `ssc-execute` until Features 02 and 03 are verified.
- Schema-as-code only; create-if-absent; no drop/rename/retype/migrate.
- Last-write-wins on run; no attempt log.
- Status persist must not fail a successful send/publish.
- Secrets must not appear in delivery error fields, logs, or UI.
- Responsive list convention for Delivery table/cards.
- Update stage-09 acceptance criterion as part of this feature.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] Run schema + `Run` type include the six delivery fields with locked defaults/coercion; declarations tests assert them.
- [ ] `sendIssueEmail` / `publishIssueToRss` record success and failure outcomes (manual and auto inherit); re-attempt overwrites; persist failure does not fail a successful channel call.
- [ ] `listDeliveryIssues` returns only eligible issues with ≥1 attempt; outcome filters work; never-attempted issues excluded.
- [ ] `/delivery` is a Runs-like hub (filters, responsive list, failure column, Open → issue); placeholder copy is gone.
- [ ] Issues list + detail success path show compact Email/RSS badges; Runs/Inspect do not.
- [ ] Stage 09 acceptance criterion updated to Delivery hub + Issues badges.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/runs/types.ts`
- Modify: `shared/src/runs/repository.ts` (`documentToRun`, `createRun`)
- Modify: `shared/src/runs/__tests__/repository.test.ts` (coercion / create defaults)
- Create: `shared/src/delivery/record-delivery.ts` (or equivalent name)
- Modify: `shared/src/delivery/send-issue-email.ts` (record after outcome)
- Modify: `shared/src/delivery/publish-issue-to-rss.ts` (record after outcome)
- Modify: `shared/src/delivery/index.ts` (re-exports)
- Create: `shared/src/delivery/__tests__/record-delivery.test.ts`
- Modify: `shared/src/delivery/__tests__/send-issue-email.test.ts` (assert record called)
- Modify: `shared/src/delivery/__tests__/publish-issue-to-rss.test.ts` (assert record called)
- Create: `shared/src/delivery/list-delivery-issues.ts` (helpers + list; may live under `runs/` if cleaner — prefer `delivery/`)
- Create: `shared/src/delivery/__tests__/list-delivery-issues.test.ts`
- Modify: `web/app/(protected)/delivery/page.tsx`
- Create: `web/components/delivery/delivery-view.tsx`
- Create: `web/components/delivery/delivery-table.tsx`
- Create: `web/components/delivery/delivery-list-card.tsx`
- Create: `web/components/delivery/delivery-status-badge.tsx` (shared badge helper for Delivery + Issues)
- Create: `web/components/delivery/delivery-pagination.tsx` / `delivery-url.ts` (or colocate URL builders)
- Create: `web/src/__tests__/delivery-page.test.tsx` (and/or view/table tests)
- Create: `web/src/__tests__/delivery-status-badge.test.tsx`
- Modify: `web/components/issues/issues-table.tsx`
- Modify: `web/components/issues/issue-list-card.tsx`
- Modify: `web/components/issues/issue-reader.tsx` (badges on success chrome)
- Create or modify: `web/src/__tests__/issues-delivery-badges.test.tsx`
- Modify: `.ssc/stages/stage-09-delivery.md` (acceptance + feature 6 bullet)

## Testing approach

Test-first. Mock Appwrite; no live SMTP.

### Schema / repository

1. **Declarations** — six attributes + constants present.
2. **documentToRun coercion** — missing/unknown status → `none`; missing error → `""`; missing at → `null`.
3. **createRun** — persists delivery defaults.

### Recording

4. **Email success** — recorder sets `sent`, `emailDeliveryAt` set, error cleared.
5. **Email failure** — `failed` + truncated error; no secrets in stored string.
6. **RSS success / failure** — analogous with `published` / `failed`.
7. **Overwrite** — second record replaces prior status/error/at for that channel only.
8. **sendIssueEmail wires record** — success and `{ ok: false }` paths each call email recorder once.
9. **publishIssueToRss wires record** — same for RSS.
10. **Persist isolation** — channel returns ok when record throws/rejects; record failure logged (assert call still returned ok).

### List

11. **Membership** — both `none` excluded; either non-`none` included.
12. **Outcome filters** — `any_failure` / `email_failed` / `rss_failed` / `all` behave as locked.
13. **Newsletter filter** — passed through / applied like `listIssues`.

### Web

14. **Delivery empty** — no attempted issues → empty-state copy (not “under construction”).
15. **Delivery row** — badges + failure text + Open href `/issues/{id}`.
16. **Filters** — changing newsletter/outcome updates URL search params (mirror Runs tests).
17. **Issues badges** — list/card and detail success show badges; not-available / load-error do not.
18. **Responsive** — Delivery table/cards both render same fields (ResponsiveList).

## Tasks

### Task 1: Failing tests for schema, coercion, record helpers, list membership

- **Action**: Add/extend declarations + repository tests (cases 1–3); add `record-delivery.test.ts` (cases 4–7, 10) and `list-delivery-issues.test.ts` (cases 11–13) failing red for missing exports/attributes.
- **Expected result**: New tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new delivery-visibility assertions failing (not infra errors).
- **Depends on**: none (execute only after Features 02–03 verified).

### Task 2: Schema + Run type + documentToRun / createRun

- **Action**: Append six run attributes + constants; extend `Run`; coerce on read; defaults on create. Make cases 1–3 green.
- **Expected result**: Delivery fields provisionable and readable with locked defaults.
- **Verify**: `pnpm --filter @newsletter/shared test` — declarations + repository delivery cases green.
- **Depends on**: Task 1.

### Task 3: Record helpers + wrap send/publish

- **Action**: Implement `recordEmailDelivery` / `recordRssDelivery`; call from `sendIssueEmail` / `publishIssueToRss` after outcome; persist isolation (case 10); extend send/publish tests (cases 8–9). Make cases 4–10 green.
- **Expected result**: Every channel attempt persists last status; auto-deliver inherits; successful channel not failed by status write errors.
- **Verify**: `pnpm --filter @newsletter/shared test` — record + send/publish delivery-recording tests green.
- **Depends on**: Task 2.

### Task 4: `listDeliveryIssues` + membership helpers

- **Action**: Implement `hasDeliveryAttempt` + `listDeliveryIssues` per Spec; make cases 11–13 green; export from delivery/index.
- **Expected result**: Delivery page can load the correct population and filters.
- **Verify**: `pnpm --filter @newsletter/shared test` — list-delivery-issues tests green.
- **Depends on**: Task 2.

### Task 5: Delivery page UI (replace placeholder)

- **Action**: Build Delivery view/table/card/pagination/URL helpers + shared status badge component; wire `delivery/page.tsx`; tests 14–16, 18. Title enrichment optional but preferred (reuse Issues pattern).
- **Expected result**: `/delivery` is a usable Runs-like hub; “under construction” gone.
- **Verify**: `pnpm --filter @newsletter/web test` — delivery UI tests green.
- **Depends on**: Task 3, Task 4.

### Task 6: Issues compact badges + stage acceptance + gates

- **Action**: Add badges to Issues table/cards and issue detail success chrome (case 17). Update `.ssc/stages/stage-09-delivery.md` acceptance + feature 6 bullet to Delivery hub + Issues badges. Run `pnpm typecheck && pnpm lint`; fix fallout.
- **Expected result**: Compact status on Issues; stage file matches product decision; monorepo clean.
- **Verify**: Issues badge tests green; stage file contains Delivery-hub acceptance wording; `pnpm typecheck && pnpm lint` pass; shared delivery tests still green.
- **Depends on**: Task 5.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint`
- Expected: All tests pass including schema/record/list, Delivery page, Issues badges; typecheck and lint clean; stage-09 acceptance mentions `/delivery` hub. Optional smoke: Send/Publish (or auto) then see row on `/delivery` and badges on Issues — not required for verifier automation.

## Handoff

Builder reports: files changed; confirmation Features 02–03 verified before execute; sample recorded success/failure field shapes; confirmation persist isolation; confirmation list excludes never-attempted; confirmation `/delivery` no longer under construction; confirmation Runs/Inspect unchanged for delivery chrome; confirmation stage acceptance updated; any deviation (file under `runs/` vs `delivery/`, title enrichment skipped) and why.

## Research notes

- **Grill (2026-07-17)** — `/delivery` Stage 02 placeholder unused; Stage 09 had put actions on Issues + config on newsletter edit. PM chose Option 1: Delivery page as primary hub (Runs-like), one row per issue with ≥1 attempt, last-write-wins on run, compact Issues badges, filters Newsletter + outcome (All / Any failure / Email failed / RSS failed), Open → issue only, leave Features 01–05 action surfaces in place; stage acceptance amended.
- **codegraph_explore** — `DeliveryPage` placeholder; `RunsView`/`RunsTable` pattern; `listIssues` / `IssueReader` / `IssuesTable`; `Run` has no delivery fields yet; Features 02/03/05 specs explicitly defer status to Feature 06.
- **Prior specs** — Feature 02/03 allow re-send/republish with no status; Feature 05 never-throw auto-deliver; Feature 06 owns lasting GUI visibility.
