# Feature 06: Missed fires and history

## Intent

Prove that downtime does not enqueue a catch-up backlog of missed schedule fires, and label every run as Manual or Scheduled in run history (and inspect), so the operator can trust automatic generation and tell scheduled work apart from on-demand starts without digging through logs.

## Spec

Close Stage 08’s remaining acceptance criteria: **no catch-up after downtime**, and **scheduled vs manual distinguishability** in history. Feature 04 already evaluates only the latest previous cron occurrence (so a multi-slot outage cannot enqueue N past fires). This feature **locks that guarantee with an explicit orchestration test**, adds a persisted run **`trigger`** field, wires writers (Generate / due-check / Retry), shows **Manual** / **Scheduled** labels on the Runs list and Inspect chrome, and adds a short **Schedules-page note** about the no-backlog policy.

This feature does **not** add a trigger filter on `/runs`, Issues badges, missed-fire history rows for skipped/busy fires, OS cron, or concurrency-policy changes (Feature 05).

### Field contract — `trigger` (pinned — PM grill 2026-07-16)

| Persisted attribute | Type | Default on create / missing read | Notes |
|---------------------|------|----------------------------------|-------|
| `trigger` | string (size **32**) | `"manual"` | Values: `"manual"` \| `"scheduled"`. Missing, `null`, empty, or unknown → coerce to `"manual"`. |

Export shared constants/types:

```ts
export const RUN_TRIGGERS = ["manual", "scheduled"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
```

Prefer declaring `RUN_TRIGGERS` / `RunTrigger` next to `RUN_STATUSES` in `shared/src/schema/declarations.ts` (or `shared/src/runs/types.ts` if that keeps the declarations→runs cycle cleaner — pick one and re-export from `@newsletter/shared`).

**`Run.trigger: RunTrigger`** is required on the in-memory type (always coerced).

**`CreateRunInput`** gains `trigger?: RunTrigger` (default `"manual"` when omitted).

### Writers (pinned)

| Path | `trigger` written |
|------|-------------------|
| Web Generate → `enqueueNewsletterRun(client, id)` | `"manual"` (default) |
| Due-check → `enqueueNewsletterRun(client, id, { trigger: "scheduled" })` | `"scheduled"` |
| Retry → `requestFailedRunRetry` / `requeueFailedRun` | Set **`"manual"`** on successful requeue |

**Retry note (codebase reality):** Stage 04 Retry does **not** create a second run document — it requeues the same failed run to `pending`. PM intent (“Retry is an operator action → Manual”) is satisfied by **setting `trigger: "manual"`** in the `requeueFailedRun` update payload (or immediately after successful requeue). Do **not** invent a new-run-on-retry path.

**`enqueueNewsletterRun` signature:**

```ts
export async function enqueueNewsletterRun(
  client: Client,
  newsletterId: string,
  opts?: { trigger?: RunTrigger },
): Promise<StartRunResult>;
```

- `opts?.trigger` defaults to `"manual"`.
- Pass through to `createRun({ …, trigger })`.
- Invalid values must not be persisted — coerce or reject before write; prefer coerce to `"manual"` only at read time, and **only allow** `"manual"` | `"scheduled"` on write (TypeScript + runtime guard if needed).

### No catch-up (pinned)

Feature 04 due semantics already use a single `computePreviousFireAt` (latest ≤ now). This feature must prove at **`processDueSchedules`** level:

- Given an enabled schedule whose cron would have fired **multiple** times during a simulated downtime window, and `scheduleLastFiredAt` still at (or before) the pre-downtime fire,
- One tick at `now` after downtime calls `enqueue` **exactly once** for that newsletter (with `{ trigger: "scheduled" }`) and stamps **only** the latest previous-fire ISO — never loops `prev()` to enqueue a backlog.

Busy-skip / other `!ok` paths stay Feature 05 rules. Skipped/busy fires still leave **no** run row (by design).

### History / Inspect UI (pinned)

| Surface | Behavior |
|---------|----------|
| Runs table | New **Trigger** column (or compact badge beside status) showing **Manual** / **Scheduled** |
| Run list cards | Same label in the card body (parity with table fields) |
| Inspect shell | Include trigger in the meta line (e.g. `{name} · {status} · {Manual\|Scheduled} · {date}`) |
| Issues list / reader | **No** trigger badge (out of scope) |
| Runs filters | **No** trigger filter / query param (V1) |

Shared display helper (web, next to `run-display.ts`):

```ts
export function formatRunTriggerLabel(trigger: RunTrigger): string {
  return trigger === "scheduled" ? "Scheduled" : "Manual";
}
```

Use a secondary Badge or muted text — do not invent a third status color system; keep status badges for `Run.status`.

### Schedules page note (pinned)

On `/schedules`, under the **Schedules** heading (or directly above the list), add a short muted help line. Locked copy:

> If the worker was offline across scheduled times, only the latest due window runs — missed fires are not queued as catch-up.

Do not add a separate “Missed fires” page, log viewer, or history rows for skipped slots.

### Out of scope

- Trigger filter on `/runs`.
- Issues trigger labeling.
- Missed-fire audit rows / notifications.
- Changing Feature 04 previous-fire math or Feature 05 busy-skip stamp rules (except passing `trigger: "scheduled"` on due enqueue).
- OS cron; parallel cross-newsletter execution; cancelling in-progress runs.
- Changing Stage 04 execute / checkpoint / prompt-freeze path.

## Dependencies

- Builds on: **feature-04-due-trigger** — `processDueSchedules`, previous-fire / due helpers, schedule poller. **Execute Features 04 (and preferably 05) before this feature.**
- Builds on: **feature-05-concurrency-policy** — busy-skip stamp rules; due-check still calls `enqueueNewsletterRun` (now with `trigger`). Soft: if F05 not yet in tree, F06 still works on F04’s enqueue path — but prefer F05 first so stamp-on-busy tests stay green.
- Builds on: Stage 04 — `createRun`, `enqueueNewsletterRun`, `requeueFailedRun` / `requestFailedRunRetry`, Runs list + Inspect shell.
- Soft: **feature-02-schedules-page** — Schedules list shell for the downtime note; if F02 not executed, still land the note on whatever `/schedules` page exists (heading + muted paragraph).
- Orphaned by: none once Feature 04 exists.

## Constraints

- **Schema-as-code only.** Append `trigger` on `runs` in `declarations.ts`; create-if-absent; no drop / rename / retype / migrate of existing attributes.
- **Do not** add a trigger filter or Issues badge.
- **Do not** create missed-fire run rows for skipped/busy/consumed slots.
- **Do not** loop cron `prev()` to enqueue catch-up.
- **Do not** change Retry into a second-document create — only set `trigger: "manual"` on requeue.
- **Server-only** Appwrite via existing clients.
- **Secrets:** never log API keys or session secrets.
- Match existing `RunRepositoryError` / ResponsiveList patterns.

## Acceptance criteria

- [ ] `runs` declares `trigger` (string, size 32, required false, default `"manual"`); missing/null/unknown reads as `"manual"`.
- [ ] Generate / default `enqueueNewsletterRun` creates runs with `trigger: "manual"`; due-check enqueues with `trigger: "scheduled"`.
- [ ] Successful Retry requeue sets `trigger: "manual"` on that run document (even if it was originally scheduled).
- [ ] After simulated downtime spanning multiple cron slots, `processDueSchedules` enqueues at most one scheduled run for that newsletter and stamps only the latest previous fire (no backlog).
- [ ] Runs table + cards and Inspect meta show **Manual** / **Scheduled**; no trigger filter; Issues unchanged.
- [ ] Schedules page shows the locked no-catch-up help line.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts` — append `trigger` on `runs`; export `RUN_TRIGGERS` / `RunTrigger` (or place types in runs and re-export)
- Modify: `shared/src/schema/__tests__/declarations.test.ts` — assert attribute present
- Modify: `shared/src/runs/types.ts` — `Run.trigger`; `CreateRunInput.trigger?`
- Modify: `shared/src/runs/repository.ts` — `documentToRun` coerce; `createRun` write; `requeueFailedRun` set `"manual"`
- Modify: `shared/src/runs/start.ts` — `enqueueNewsletterRun(…, opts?)` pass `trigger`
- Modify: `shared/src/newsletters/due-check.ts` (or Feature 04 path) — pass `{ trigger: "scheduled" }`
- Modify: `shared/src/runs/__tests__/repository.test.ts` — create/coerce/requeue trigger cases
- Modify: `shared/src/runs/__tests__/start.test.ts` — default manual + explicit scheduled
- Modify: `shared/src/runs/__tests__/retry.test.ts` (or create if missing coverage) — requeue sets manual
- Modify: Feature 04 due-check test file — scheduled trigger + no-catch-up orchestration case
- Modify: `web/components/runs/run-display.ts` — `formatRunTriggerLabel`
- Modify: `web/components/runs/runs-table.tsx` — Trigger column / label
- Modify: `web/components/runs/run-list-card.tsx` — Trigger field
- Modify: `web/components/runs/inspect-shell.tsx` — meta line includes trigger label
- Modify: Schedules page / view under `web/app/(protected)/schedules/` (and Feature 02 components if present) — help line
- Create/Modify: `web/src/__tests__/runs-trigger-label.test.tsx` (and/or extend existing runs/inspect tests)
- Create/Modify: `web/src/__tests__/schedules-missed-fires-note.test.tsx` (or extend Feature 02 schedules tests)
- Modify: fixture `Run` objects in tests as needed for the new required field

## Testing approach

Test-first. Behavior verifies Intent (no catch-up backlog; scheduled vs manual visible in history).

### Schema / repository

1. **Declarations** — `runs` attributes include `trigger` string size 32, not required, default `"manual"`.
2. **Read coerce** — missing / `null` / `""` / `"bogus"` → `Run.trigger === "manual"`; `"scheduled"` preserved.
3. **createRun** — omits trigger → persisted/returned `"manual"`; `trigger: "scheduled"` → `"scheduled"`.
4. **requeueFailedRun** — after requeue, returned run has `trigger: "manual"` (even when document was `"scheduled"` before).

### Start / due-check

5. **Default enqueue** — `enqueueNewsletterRun(client, id)` calls `createRun` with `trigger: "manual"` (or omitted → create default).
6. **Scheduled enqueue** — `enqueueNewsletterRun(client, id, { trigger: "scheduled" })` passes `"scheduled"` to `createRun`.
7. **Due-check passes scheduled** — `processDueSchedules` success path invokes enqueue with `{ trigger: "scheduled" }` (assert mock call args).
8. **No catch-up backlog** — newsletter due after multi-slot downtime (`scheduleLastFiredAt` old; `now` after ≥2 cron boundaries); mock enqueue `ok: true`; assert enqueue called **once** for that id; `setScheduleLastFiredAt` called once with the **latest** previous-fire ISO only. (May share fixtures with Feature 04 helper case 4 — this case must assert enqueue count, not only `isScheduleDue`.)

### Retry

9. **Retry → manual** — failed run with `trigger: "scheduled"`; successful `requestFailedRunRetry` (or unit `requeueFailedRun`) yields / persists `trigger: "manual"`.

### GUI

10. **Runs list parity** — fixture runs (one manual, one scheduled) render **Manual** and **Scheduled** in both ResponsiveList table and card slots.
11. **Inspect meta** — InspectShell (or page test) shows the Scheduled/Manual label for the run’s trigger.
12. **Schedules note** — Schedules page contains the locked downtime / no-catch-up sentence (exact or normalized whitespace match).

## Tasks

### Task 1: Failing tests for trigger, no-catch-up, labels, Schedules note

- **Action**: Add/extend tests for cases 1–12 in the Files listed above. Due-check case 8 must fail until writers exist. GUI tests may fail red on missing labels/note. Update `Run` fixtures that break compile once types land in Task 2 (or leave `as any` only if unavoidable — prefer adding `trigger` in Task 2 immediately after red tests).
- **Expected result**: New tests exist and fail for the right reasons (missing attribute / missing opts / missing label / missing note).
- **Verify**: `pnpm --filter @newsletter/shared test` and `pnpm --filter @newsletter/web test` (or web vitest path) show new assertions failing, not infra crashes.
- **Depends on**: none (assumes Feature 04 due-check exists; if not, stop and escalate — do not invent a parallel due-check).

### Task 2: Schema + `Run.trigger` coerce + `createRun` / `requeueFailedRun`

- **Action**: Append `trigger` attribute; extend `Run` / `CreateRunInput`; coerce in `documentToRun`; write on `createRun`; set `"manual"` in `requeueFailedRun`. Make repository/declaration tests 1–4 green. Fix compile breaks in shared fixtures.
- **Expected result**: Persistence + read contract for `trigger` holds; Retry requeue forces Manual.
- **Verify**: `pnpm --filter @newsletter/shared test` — repository/declaration trigger cases green; `pnpm typecheck` progressing for shared.
- **Depends on**: Task 1.

### Task 3: `enqueueNewsletterRun` opts + due-check `scheduled` + no-catch-up test green

- **Action**: Add `opts?: { trigger?: RunTrigger }` to `enqueueNewsletterRun` (default manual). Update `processDueSchedules` to pass `{ trigger: "scheduled" }`. Make start/due-check tests 5–8 green (including single-enqueue-after-downtime). Update Feature 04 comments that say “no trigger field” if present.
- **Expected result**: Scheduled fires are labeled at create time; downtime cannot enqueue a backlog.
- **Verify**: `pnpm --filter @newsletter/shared test` — start + due-check trigger/no-catch-up cases green.
- **Depends on**: Task 2.

### Task 4: History / Inspect labels + Schedules note + feature gate

- **Action**: Add `formatRunTriggerLabel`; show labels on `runs-table.tsx`, `run-list-card.tsx`, and `inspect-shell.tsx` meta; add locked Schedules help line. Make GUI tests 10–12 green. Run full shared + web (+ worker if due-check touched) tests, `pnpm typecheck`, `pnpm lint`.
- **Expected result**: Operator can distinguish Manual vs Scheduled in history/inspect; Schedules explains no catch-up; feature complete.
- **Verify**: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint` all green (include worker tests if this branch touched worker).
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint`
- Expected: All green. Due-check enqueues with `trigger: "scheduled"` once after multi-slot downtime; Generate/Retry yield Manual; Runs list + Inspect show labels; Schedules shows the locked no-catch-up note.

## Handoff

Builder reports: files changed; confirmation of `trigger` attribute + coerce; confirmation due-check passes `{ trigger: "scheduled" }`; confirmation `requeueFailedRun` forces `"manual"`; confirmation no-catch-up enqueue-once test; GUI label + Schedules note locations; any deviation (e.g. types file placement, Badge vs plain text) and why. Notes: no trigger filter / Issues badge / missed-fire rows — post-V1 if desired.

## Research notes

- **codegraph_explore** — `createRun` / `documentToRun` / `requeueFailedRun` (`shared/src/runs/repository.ts`); `enqueueNewsletterRun` (`shared/src/runs/start.ts`); `requestFailedRunRetry` (`shared/src/runs/retry.ts`); Runs table/cards + `InspectShell` meta line; `/schedules` stub/page.
- **Feature 04 / 05 specs** — no-catch-up via latest previous only; `trigger` explicitly deferred to this feature; busy-skip leaves no run row.
- **PM grill (2026-07-16)** — `trigger` manual|scheduled; labels on list + inspect; Retry → Manual (requeue same doc); no missed-fire rows; tests + Schedules note for downtime policy; no V1 filter; Issues unlabeled.
