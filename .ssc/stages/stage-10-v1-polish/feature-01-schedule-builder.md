# Feature 01: Schedule builder

## Intent

Give the operator an in-app guided schedule builder (cadence + time + searchable timezone) so they can set a newsletter schedule without an external cron cheat-sheet, while still storing a valid 5-field cron + IANA timezone and keeping raw cron as an Advanced escape hatch.

## Spec

Upgrade the shared `ScheduleFields` UI (used by **Schedules edit** and **Newsletter edit**) from free-text cron/timezone into a **guided builder** plus **searchable timezone** plus **Advanced raw cron**. Persistence, validation, and worker due-check semantics stay exactly as Stage 08 — this feature is GUI + pure encode/decode helpers only.

### Out of scope

- Changing `updateNewsletterSchedule`, schema, due-check, missed-fire policy, or run enqueue.
- Monthly / hourly / “every N hours” guided modes (raw Advanced covers those).
- Newsletter edit tabs/sections restructure (Feature 02).
- Preset chip shortcuts beyond the guided frequency select.

### Data contract (unchanged — do not re-litigate)

| Form field | Maps to | Notes |
|------------|---------|-------|
| `scheduleEnabled` | `scheduleEnabled` | Checkbox; unchecked → absent → false (same as Stage 08). |
| `scheduleCron` | `scheduleCron` | Always a 5-field string (or empty when disabled + empty). Server still validates via `resolveScheduleFields` / `assertValidCronExpression`. |
| `scheduleTimezone` | `scheduleTimezone` | IANA id; empty still defaults to `UTC` server-side. |

Submit path and actions stay as today: Schedules → `updateNewsletterScheduleAction`; Newsletter edit → `updateNewsletterAction` calling `updateNewsletterSchedule` first.

### Guided builder — cadence & time (pinned)

| Control | Options |
|---------|---------|
| Frequency | **Daily** · **Weekdays** · **Weekly** (one weekday) · **Custom weekdays** (multi-select Mon–Sun) |
| Weekly day | Single select: Sun–Sat (when frequency = Weekly) |
| Custom days | Multi-select toggles Sun–Sat (when frequency = Custom weekdays); see empty-days pin below |
| Hour | Select `0`–`23` (24-hour) |
| Minute | Select `00`, `05`, `10`, …, `55` |

**Default seed (empty cron):** When `defaultCron` is blank (or operator enables with empty cron), seed UI to **Weekdays at 09:00** → cron `0 9 * * 1-5`. The form’s submitted `scheduleCron` must reflect that seed once the builder is showing it (so Enable + Save without further edits is valid).

**Empty Custom weekdays (pinned):** `encodeGuidedCron` for Custom with **zero** days **throws** (or returns a documented error — prefer throw / never emit an empty dow field). In the UI: if the operator deselects the last Custom day, **keep the last valid cron** (and the previous non-empty day selection in submitted cron) — do not clear `scheduleCron` to empty and do not call encode with zero days. Day toggles may visually attempt empty, but cron state stays at the last successful encode until ≥1 day is selected again.

### Cron encode / decode (pinned)

Add pure helpers in shared (new file `shared/src/newsletters/schedule-builder.ts`, re-exported from `newsletters/index.ts` and browser-safe `@newsletter/shared/client`):

| Helper | Behavior |
|--------|----------|
| `encodeGuidedCron(state: GuidedScheduleState): string` | Produce a canonical 5-field cron from guided state. |
| `decodeGuidedCron(cron: string): GuidedScheduleState \| null` | Return guided state when cron matches a guided pattern; otherwise `null` (Custom). |
| `DEFAULT_GUIDED_SCHEDULE` | Constant: weekdays, hour `9`, minute `0`. |

**Day-of-week numbering (cron-parser / standard):** `0` = Sunday … `6` = Saturday. Prefer emitting `0` for Sunday, never `7`. Labels in UI: Sun Mon Tue Wed Thu Fri Sat.

**Encode table:**

| Frequency | Cron shape |
|-----------|------------|
| Daily | `{minute} {hour} * * *` |
| Weekdays | `{minute} {hour} * * 1-5` |
| Weekly | `{minute} {hour} * * {dow}` (single `0`–`6`) |
| Custom weekdays | `{minute} {hour} * * {sorted unique dows joined by comma}` e.g. `0 9 * * 1,3,5` — **requires ≥1 day**; zero days → throw (UI keeps last valid cron; see above) |

Minute/hour are decimal integers with no leading-zero requirement in the cron string (`0` not `00`).

**Decode — match only when all of:**

1. Trimmed cron has exactly 5 whitespace-separated fields (no `@` aliases).
2. Day-of-month is `*` and month is `*`.
3. Minute is an integer `0`–`59` and `minute % 5 === 0`.
4. Hour is an integer `0`–`23`.
5. Day-of-week is one of:
   - `*` → Daily
   - `1-5` exactly → Weekdays
   - single digit `0`–`6` (also accept `7` as Sunday → normalize to `0`) → Weekly
   - comma-separated list of unique `0`–`6` (normalize `7`→`0`, sort ascending, dedupe) with **≥1** day, and **not** exactly the set `{1,2,3,4,5}` written as `1-5` already handled — a literal `1,2,3,4,5` **may** decode as Custom weekdays with those five days (do **not** auto-promote to Weekdays on decode; Weekdays is only exact `1-5`). Reject steps (`*/2`), names (`MON`), `L`, `#`, `?`, ranges other than the single allowed `1-5` weekdays token.

Anything else (including `0 9 1 * *`, `*/15`, `0 9 * * 1-5,0`, non-5-minute minutes) → `null` (Custom).

**Round-trip pin:** `encode(decode(cron))` equals the canonical encode for every matched cron; never rewrite Custom on open/save unless the operator changes frequency out of Custom or edits the builder.

### Custom expression / Advanced (pinned)

- Mode is **guided** when `decodeGuidedCron(cron) !== null` (or empty cron seeded to default guided).
- Mode is **Custom expression** when decode returns `null`, or when the operator edits the Advanced cron field to a value that no longer matches the current guided encode.
- In Custom: show a clear status line (e.g. `Custom expression`) and **disable** (or dim + ignore) the guided frequency/day/time controls until the operator picks a guided frequency — that pick **overwrites** cron from the new guided state.
- **Advanced** is a collapsible section (shadcn `Collapsible` preferred; native `<details>` acceptable fallback):
  - **Closed by default** in guided mode.
  - **Open by default** in Custom mode.
  - Contains the monospace **Cron expression** text input plus the existing help copy: `Five fields: minute hour day-of-month month day-of-week. Example: 0 9 * * 1-5`.
- In guided mode the Advanced cron input stays **controlled** from builder state (editing it switches to Custom as above).
- **Collapsed-submit pin (critical):** `name="scheduleCron"` must still be present in the submitted form when Advanced is **closed**. shadcn Collapsible often unmounts children when closed — do **not** rely on the only cron input living inside unmounted content. Required approach: always-mounted controlled `input[name="scheduleCron"]` (visible inside Advanced when open; `type="hidden"` or visually hidden twin when closed is fine) **or** force Collapsible content to stay mounted (`forceMount` / equivalent) while hiding it. Exactly one `name="scheduleCron"` in the form. Same rule for `scheduleTimezone` if the combobox does not natively submit.

### Timezone picker (pinned)

Replace free-text timezone with a **searchable combobox** of IANA zones:

1. Build the full list via `Intl.supportedValuesOf("timeZone")` when available; if missing, fall back to a static curated list that at least includes the common zones below plus `UTC`.
2. **Common zones first** (pinned order, then a separator / remaining alphabetical):

   `UTC`, `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, `America/Toronto`, `Europe/London`, `Europe/Paris`, `Europe/Berlin`, `Asia/Tokyo`, `Asia/Singapore`, `Australia/Sydney`

3. Filter by substring match on the zone id (case-insensitive).
4. Submit via controlled value + hidden (or combobox-backed) input `name="scheduleTimezone"`.
5. Prefill from `defaultTimezone`; if empty, show `UTC` (aligns with `DEFAULT_SCHEDULE_TIMEZONE`).
6. Invalid / unknown stored tz that isn’t in the list: still show the raw value as selected so the operator can fix it (do not silently coerce on load).

Install UI primitives via shadcn (`pnpm dlx shadcn@latest add combobox collapsible` or equivalent `popover` + `command` + `collapsible`) — prefer MCP/shadcn CLI over hand-rolling.

### Live next fire (pinned)

`ScheduleFields` owns the **Next fire:** line (both surfaces):

- Recompute client-side with `computeNextFireAt(cron, timezone, now)` + `formatScheduleNextFireAt`.
- Update when enable / cron / timezone change in the UI.
- When schedule is **disabled** or cron empty/invalid or timezone invalid → `Next fire: —`.
- Export `computeNextFireAt` (and builder helpers) from `@newsletter/shared/client` so the web bundle does not import the full server entry.

**Newsletter form:** Remove the duplicate static next-fire paragraph that currently sits outside `ScheduleFields` (it used saved-only `toNewsletterScheduleView`). Schedules edit dialog previously had no next-fire line — it gains one via `ScheduleFields`.

### Surfaces (pinned)

| Surface | Change |
|---------|--------|
| `web/components/schedules/schedule-fields.tsx` | Become the guided builder (client component). Props stay `idPrefix`, `defaultEnabled`, `defaultCron`, `defaultTimezone`, `disabled?`. |
| `ScheduleEditDialog` | Keep using `ScheduleFields`; no API change. |
| Newsletter edit page (`NewsletterEditForm` Schedule tab) | Uses `ScheduleFields` (Feature 02 moved schedule off `NewsletterFormDialog`; create dialog is Basics-only and has no Schedule). |

Create mode still hides Schedule entirely (unchanged).

### Research notes (shaped decisions)

- Existing Stage 08 `ScheduleFields` is free-text only; placeholder already `0 9 * * 1-5` — used as default seed.
- `cron-parser` day-of-week is `0`–`7` with `0` or `7` = Sunday (Context7 `/harrisiirak/cron-parser`).
- shadcn: combobox pattern + collapsible via `@shadcn` registry (`pnpm dlx shadcn@latest add combobox collapsible`).

## Dependencies

- Builds on: Stage 08 schedule fields + `updateNewsletterSchedule` / `computeNextFireAt` / `toNewsletterScheduleView` / shared `ScheduleFields` on both edit surfaces.
- Or: None within Stage 10 — first feature in the stage.

## Constraints

- **Do not** change schema, repository write semantics, due-check, or validation messages except where UI copy only.
- **Do not** accept `@daily` / other aliases — server still rejects `@` prefixes.
- Stored value remains valid **5-field** cron + IANA timezone.
- Keep form field **names** `scheduleEnabled` / `scheduleCron` / `scheduleTimezone` so existing server actions keep working.
- One shared component for both surfaces — no divergent builders.
- Do not invent a new Settings page or Schedules-only builder.

## Acceptance criteria

- [ ] Operator can set Daily / Weekdays / Weekly / Custom weekdays + time + timezone without typing cron.
- [ ] Saving still persists valid 5-field cron + IANA timezone through existing actions.
- [ ] Empty cron seeds Weekdays 09:00 (`0 9 * * 1-5`).
- [ ] Advanced raw cron remains available; Custom non-matching crons open Advanced and do not silently rewrite.
- [ ] Timezone is a searchable IANA combobox with common zones first.
- [ ] Next fire updates live as builder/timezone/enable change; disabled → `—`.
- [ ] Both Schedules edit and Newsletter edit use the same upgraded `ScheduleFields`.
- [ ] Pure encode/decode helpers are unit-tested; UI tests cover guided prefills, custom mode, live next fire, timezone combobox submit, and collapsed-Advanced still submitting cron.

## Files

- Create: `shared/src/newsletters/schedule-builder.ts`
- Create: `shared/src/newsletters/__tests__/schedule-builder.test.ts`
- Create: `web/src/__tests__/schedule-fields-builder.test.tsx`
- Modify: `shared/src/newsletters/index.ts` — re-export builder helpers
- Modify: `shared/src/client.ts` — export `computeNextFireAt`, builder helpers / types needed by web
- Modify: `web/components/schedules/schedule-fields.tsx` — guided builder UI (client)
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx` — remove duplicate next-fire line
- Modify: `web/src/__tests__/newsletter-form-schedule.test.tsx` — align with builder labels / live next fire
- Create (via shadcn as needed): `web/components/ui/popover.tsx`, `web/components/ui/command.tsx`, `web/components/ui/collapsible.tsx` (and any deps the CLI adds)
- Optional: `web/components/schedules/timezone-combobox.tsx` if extraction keeps `ScheduleFields` readable
- Optional: `web/lib/timezones.ts` — common-first list + `listIanaTimezones()` helper

## Testing approach

Test-first for pure helpers; component tests for UI behavior.

**`schedule-builder.test.ts` (shared):**

1. Encode Daily / Weekdays / Weekly / Custom → exact cron strings (including `0 9 * * 1-5`, `0 9 * * *`, `30 14 * * 1`, `0 9 * * 0,6`).
2. Decode those same strings back to equivalent guided state.
3. Decode returns `null` for: empty, `@daily`, `0 9 1 * *`, `*/15 * * * *`, `0 9 * * 1-5,6`, `7 9 * * 1-5` (minute not on 5-min grid), named days.
4. Sunday `7` in a single-dow field decodes as Weekly Sunday (`0`); encode emits `0` not `7`.
5. `DEFAULT_GUIDED_SCHEDULE` encodes to `0 9 * * 1-5`.
6. Custom with zero days: `encodeGuidedCron` throws (does not emit empty dow).

**`schedule-fields-builder.test.tsx` (web):**

1. Blank `defaultCron` shows Weekdays + 09:00 and the form has `input[name="scheduleCron"]` with value `0 9 * * 1-5` **even when Advanced is collapsed**.
2. Prefill `0 9 * * 1-5` + `America/New_York` → Weekdays, 9, 00, timezone selected; `input[name="scheduleTimezone"]` value is `America/New_York`.
3. Prefill `0 0 1 * *` → Custom expression; Advanced open; guided controls disabled/dimmed.
4. Changing frequency from Custom to Daily overwrites cron to a daily pattern.
5. Editing Advanced cron away from guided encode enters Custom.
6. Live next fire: with enable checked + valid cron/tz, next-fire text is non-`—` and changes when hour changes (mock `computeNextFireAt` or use real helper with fixed `now` if injectable — prefer testing via visible label change or spy).
7. Enable unchecked → `Next fire: —`.
8. **Timezone combobox:** pinned common zones are present in the options list (at least the twelve listed above, with `UTC` / `America/New_York` among them); filtering/search can surface a zone; selecting it updates `name="scheduleTimezone"`. Optional: unknown stored tz still appears as the current value.
9. **Empty Custom days:** starting from a Custom selection with ≥1 day, deselecting the last day **keeps** the previous cron value on `name="scheduleCron"` (does not clear to empty).

**Update `newsletter-form-schedule.test.tsx`:** Still asserts Schedule section in edit / hidden in create / scroll classes; update assertions that assumed a top-level always-visible cron/timezone text inputs (cron may live under Advanced; timezone is combobox). Prefill case should assert builder state or opened Advanced value as appropriate.

## Tasks

### Task 1: Pure schedule-builder helpers (test-first)

- **Action**: Add failing tests in `shared/src/newsletters/__tests__/schedule-builder.test.ts`, then implement `shared/src/newsletters/schedule-builder.ts` with `GuidedScheduleState`, `DEFAULT_GUIDED_SCHEDULE`, `encodeGuidedCron`, `decodeGuidedCron` per the encode/decode tables. Re-export from `shared/src/newsletters/index.ts`. Export builder helpers + `computeNextFireAt` from `shared/src/client.ts`.
- **Expected result**: Shared unit tests pass; client entry exports the symbols web needs.
- **Verify**: `pnpm --filter @newsletter/shared test -- schedule-builder` (or equivalent vitest path) and `pnpm typecheck` for shared/client exports.
- **Depends on**: none.

### Task 2: Install shadcn collapsible + combobox primitives

- **Action**: From `web/`, install via shadcn CLI/MCP: `combobox` + `collapsible` (pulls `popover` / `command` as needed). Do not hand-roll Radix wrappers if the CLI can add them.
- **Expected result**: UI primitives exist under `web/components/ui/` and the app still typechecks.
- **Verify**: `pnpm typecheck` (web); files present for popover/command/collapsible (or combobox demo deps).
- **Depends on**: none (parallel with Task 1).

### Task 3: Upgrade `ScheduleFields` guided UI

- **Action**: Convert `web/components/schedules/schedule-fields.tsx` to a client component implementing enable checkbox, frequency/day/time controls, timezone combobox (common-first searchable list), Advanced collapsible with cron input, Custom-expression behavior, default seed, empty-Custom keep-last-valid-cron, collapsed-Advanced still submitting `scheduleCron`, and live Next fire line using `computeNextFireAt` + `formatScheduleNextFireAt`. Extract `timezone-combobox.tsx` / `web/lib/timezones.ts` if needed for clarity. Keep props and form field names stable.
- **Expected result**: Both dialogs that already render `ScheduleFields` show the builder without further API changes.
- **Verify**: Manual smoke not required; covered by Task 4 tests. `pnpm typecheck` + `pnpm lint`.
- **Depends on**: Task 1, Task 2.

### Task 4: Wire newsletter form + tests

- **Action**: Remove the duplicate next-fire paragraph from `web/components/newsletters/newsletter-form-dialog.tsx`. Add `web/src/__tests__/schedule-fields-builder.test.tsx` per Testing approach. Update `web/src/__tests__/newsletter-form-schedule.test.tsx` for new labels/structure.
- **Expected result**: Edit surfaces share one builder; tests document guided/custom/live next-fire behavior.
- **Verify**: `pnpm --filter web test -- schedule-fields-builder newsletter-form-schedule` (or repo `pnpm test` filtered); `pnpm typecheck`; `pnpm lint`.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test`
- Expected: All pass. Spot-check behavior covered by tests: blank → weekdays 9:00; `0 9 * * 1-5` prefills guided; non-matching cron → Custom + Advanced open; timezone searchable; next fire live; Schedules edit dialog and newsletter edit Schedule tab still submit `scheduleEnabled` / `scheduleCron` / `scheduleTimezone`.

## Handoff

Builder reports: files created/modified; confirm encode/decode table and Custom round-trip pins; note any shadcn components added; list test files; call out any deviation (e.g. used `<details>` instead of Collapsible) and why.
