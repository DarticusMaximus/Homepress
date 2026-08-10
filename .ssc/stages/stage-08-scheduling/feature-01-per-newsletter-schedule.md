# Feature 01: Per-newsletter schedule

## Intent

Persist an enable/disable schedule per newsletter (cron + IANA timezone) and expose a correct next-fire time when enabled, so later Stage 08 UI and the worker due-check can rely on one shared schedule contract instead of OS cron or ad-hoc strings.

## Spec

Add schedule fields to the `newsletters` collection and wire them through shared types, validation, and repository helpers. This feature owns **schema**, **persistence**, **cron/timezone validation**, and **next-fire computation**. It does **not** add Schedules UI, newsletter-edit schedule controls, or the worker due trigger (features 02–04).

### Field contract (pinned)

| Persisted attribute | Type | Default on create / missing read | Notes |
|---------------------|------|----------------------------------|-------|
| `scheduleEnabled` | boolean | `false` | When `false`, schedule must not be treated as due by later features; next fire is `null`. |
| `scheduleCron` | string (size **128**) | `""` | Standard **5-field** crontab: `minute hour day-of-month month day-of-week` (legacy `newsletters.yaml` shape, e.g. `0 1 * * 1-5`). No seconds field. |
| `scheduleTimezone` | string (size **64**) | `"UTC"` | IANA timezone id (e.g. `America/New_York`). |

**Not persisted:** `nextFireAt`. Always compute from cron + timezone + a reference instant. Storing it would drift and fight Feature 04/06 due semantics.

### Derived view (pinned)

Export a pure helper that builds the operator/API-facing schedule view:

```ts
export interface NewsletterScheduleView {
  enabled: boolean;
  cron: string;
  timezone: string;
  /** ISO-8601 UTC instant of the next fire, or null when disabled. */
  nextFireAt: string | null;
}

export function toNewsletterScheduleView(
  newsletter: Pick<Newsletter, "scheduleEnabled" | "scheduleCron" | "scheduleTimezone">,
  now?: Date,
): NewsletterScheduleView;
```

Rules:

- `enabled === false` → `nextFireAt === null` (do not compute).
- `enabled === true` → parse cron in `scheduleTimezone` with `cron-parser` and return the next fire **strictly after** `now` (default `new Date()`) as `date.toISOString()`.
- Re-parse with `{ tz, currentDate }` on each call — do **not** rely on `CronExpression.reset()` (known tz-drop bug in cron-parser).

### Dependency (pinned)

Add **`cron-parser`** (^5.6) to `shared/package.json` dependencies. Use the current API:

```ts
import { CronExpressionParser } from "cron-parser";
CronExpressionParser.parse(cron, { currentDate: now, tz: timezone });
```

Research note (2026-07-16): npm `cron-parser` 5.6.x documents IANA `tz` + DST handling via Luxon; `CronExpressionParser.parse` is the v5 entry point.

### Schema (pinned)

Append three attributes to the `newsletters` collection in `shared/src/schema/declarations.ts` (create-if-absent via provisioner — no drop / rename / retype / migrate):

| Attribute | Type | Size / default | Required |
|-----------|------|----------------|----------|
| `scheduleEnabled` | boolean | default `false` | false |
| `scheduleCron` | string | size **128** | false |
| `scheduleTimezone` | string | size **64**, default `"UTC"` | false |

Export constants from `declarations.ts`:

- `DEFAULT_SCHEDULE_TIMEZONE = "UTC"`
- `SCHEDULE_CRON_MAX_LENGTH = 128`
- `SCHEDULE_TIMEZONE_MAX_LENGTH = 64`

Declaration tests must assert the three attributes and these constants.

**Existing documents:** missing / `null` / `undefined` map on read to `scheduleEnabled: false`, `scheduleCron: ""`, `scheduleTimezone: DEFAULT_SCHEDULE_TIMEZONE` (same defensive coerce pattern as lookback / model overrides).

### Domain types & write paths (pinned)

Extend `Newsletter` in `shared/src/newsletters/types.ts` with:

```ts
scheduleEnabled: boolean;
scheduleCron: string;
scheduleTimezone: string;
```

**Do not** add schedule fields to `CreateNewsletterInput`, `UpdateNewsletterInput`, or `NewsletterFields`. Definition create/update must not require schedule FormData yet (GUI is Features 02–03). Instead:

1. **`createNewsletter`** — always persist create defaults: `scheduleEnabled: false`, `scheduleCron: ""`, `scheduleTimezone: DEFAULT_SCHEDULE_TIMEZONE`.
2. **`updateNewsletter`** — **omit** the three schedule keys from the Appwrite `data` payload so existing schedule values are preserved when the operator saves the definition form.
3. **`updateNewsletterSchedule(client, id, input)`** — new repository function; the only write path that changes schedule fields. Input:

```ts
export interface UpdateNewsletterScheduleInput {
  scheduleEnabled: boolean;
  scheduleCron: string;
  scheduleTimezone: string;
}
```

Validate via `resolveScheduleFields(input)` (below), then `updateDocument` with the three fields + `updatedAt`. Return the updated `Newsletter`. `not_found` / Appwrite error mapping matches existing repository helpers.

### Validation (pinned)

Add `shared/src/newsletters/schedule.ts` (or co-locate under `newsletters/` and export from `newsletters/index.ts`) with pure helpers:

| Helper | Behavior |
|--------|----------|
| `isValidIanaTimezone(tz: string): boolean` | Probe with `Intl.DateTimeFormat("en-US", { timeZone: tz })` (same idea as `resolveTimezone` in `shared/src/pipeline/config.ts`). Empty → false. |
| `assertValidCronExpression(cron: string): string` | Trim; reject empty when caller requires it; reject length > `SCHEDULE_CRON_MAX_LENGTH`; **reject any expression whose trimmed form starts with `@`** (predefined aliases like `@hourly` / `@daily` — `cron-parser` accepts these and expands them to 6-field forms); then require **exactly 5** whitespace-separated fields; **only then** parse with `CronExpressionParser.parse` (no `strict: true` — that forces 6 fields). Order matters: alias check and field-count **before** parse. On failure → `NewsletterRepositoryError` `validation`. |
| `resolveScheduleFields(input)` | Normalize and validate as below; throw `NewsletterRepositoryError` `validation` with stable messages. |
| `computeNextFireAt(cron, timezone, now?): Date \| null` | Used by `toNewsletterScheduleView`; returns `null` only if parsing somehow fails after validation (should not happen for validated inputs) — prefer throwing in tests if validated inputs fail. |

**`resolveScheduleFields` rules:**

1. Coerce `scheduleEnabled` to boolean (`true` / `false` only — reject non-booleans if coming from untyped input; repository callers pass boolean).
2. `scheduleTimezone`: coerce to string, trim; empty → `DEFAULT_SCHEDULE_TIMEZONE`; length > 64 → validation error; must pass `isValidIanaTimezone`.
3. `scheduleCron`: coerce to string, trim; length > 128 → validation error.
4. If `scheduleEnabled === true`: cron must be non-empty and pass `assertValidCronExpression`; timezone already validated.
5. If `scheduleEnabled === false`: empty cron is allowed and stored as `""`; non-empty cron must still pass `assertValidCronExpression` (no silent junk).

Reject the whole schedule write on any failure (no partial Appwrite update of schedule keys).

### Out of scope

- Schedules page / nav content (Feature 02) — stub `/schedules` page may remain placeholder.
- Newsletter edit schedule fields or scroll fix (Feature 03).
- Worker due-check, run creation, concurrency, missed-fire policy (Features 04–06).
- OS cron / host crontab.
- Storing `nextFireAt` or `lastFiredAt` on the newsletter document.
- Changing Stage 04 run schema / execute path.
- Adding schedule controls to `NewsletterFormDialog` or `createNewsletterAction` / `updateNewsletterAction` FormData (those actions keep working unchanged because schedule is omitted from definition update payload).

## Dependencies

- Builds on: Stage 03 newsletter schema + repository (`shared/src/schema/declarations.ts`, `shared/src/newsletters/*`).
- Builds on: Stage 04 complete (conceptual — scheduled runs will enqueue via that path later; this feature does not call run APIs).
- Soft consumers: Features 02–04 (UI + due trigger) — not required to verify this feature.
- Orphaned by: none — first feature in Stage 08.

## Constraints

- **Schema-as-code only.** Append attributes in `declarations.ts`; no console provisioning.
- **Create-if-absent only.** No drop / rename / retype / migrate.
- **Do not** implement due-check, run enqueue, or Schedules/edit GUI.
- **Do not** add schedule keys to `UpdateNewsletterInput` / definition FormData in this feature.
- **`updateNewsletter` must preserve** existing schedule attributes (omit from payload).
- **5-field cron only** — reject 6-field (seconds) and `@hourly`-style aliases for V1 consistency with legacy YAML.
- **Server-only** Appwrite via existing shared repository + API-key client patterns.
- **Secrets:** never log API keys or session secrets.
- Match existing `NewsletterRepositoryError` validation / not_found / appwrite patterns.

## Acceptance criteria

- [ ] `newsletters` declares `scheduleEnabled` (boolean, default false), `scheduleCron` (string 128), `scheduleTimezone` (string 64, default `"UTC"`); declarations tests assert them + exported constants.
- [ ] `Newsletter` exposes the three persisted fields; missing attributes coerce to disabled / `""` / `UTC` on read.
- [ ] `createNewsletter` writes schedule defaults (disabled, empty cron, UTC); `updateNewsletter` does not overwrite schedule fields.
- [ ] `updateNewsletterSchedule` validates and persists enable + cron + timezone; invalid cron/TZ or enable-without-cron rejects with `validation`.
- [ ] `toNewsletterScheduleView` returns `nextFireAt: null` when disabled; when enabled, returns an ISO UTC next fire consistent with cron + IANA timezone (including a DST-sensitive fixture).
- [ ] `cron-parser` is a `shared` dependency; next-fire uses `CronExpressionParser.parse` with `tz` and does not use `reset()` to re-anchor.
- [ ] No Schedules UI, newsletter-form schedule section, or worker due-check changes in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/package.json` (add `cron-parser`)
- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/newsletters/types.ts`
- Modify: `shared/src/newsletters/repository.ts` (`documentToNewsletter`, create defaults, update omit, `updateNewsletterSchedule`)
- Create: `shared/src/newsletters/schedule.ts` (validation + next-fire + `toNewsletterScheduleView`)
- Modify: `shared/src/newsletters/index.ts` (re-export schedule helpers / types)
- Create: `shared/src/newsletters/__tests__/schedule.test.ts`
- Modify: `shared/src/newsletters/__tests__/repository.test.ts` (create defaults, update preserve, read coercion, schedule update path)

## Testing approach

Test-first for schedule validation and next-fire; repository tests for persist/preserve semantics. No web/UI tests in this feature.

### `schedule.test.ts`

1. **Disabled → null next fire** — `toNewsletterScheduleView({ scheduleEnabled: false, … })` → `nextFireAt === null`.
2. **Valid weekday cron in TZ** — enabled, cron `0 9 * * 1-5`, timezone `America/New_York`, fixed `now` on a Sunday evening UTC → next fire is Monday 09:00 America/New_York as the correct UTC ISO string.
3. **DST spring-forward fixture** — pick a known US DST transition weekend and assert next fire does not land on a skipped local hour (document the expected UTC instant in the test).
4. **Invalid timezone** — `resolveScheduleFields` / `isValidIanaTimezone` rejects `Not/A_Zone`.
5. **Invalid cron** — reject empty when enabled; reject 6-field; reject garbage; reject over-length; **reject `@hourly` and `@daily`** (alias fixtures — must fail even though `cron-parser` would accept them).
6. **Disabled with invalid non-empty cron** — still rejected.
7. **Disabled with empty cron** — accepted; stores `""`.
8. **Empty timezone** — resolves to `UTC`.

### `repository.test.ts` (extend)

9. **create** payload includes schedule defaults.
10. **updateNewsletter** mock `updateDocument` data does **not** include `scheduleEnabled` / `scheduleCron` / `scheduleTimezone`.
11. **updateNewsletterSchedule** success writes the three fields + `updatedAt`; validation errors do not call Appwrite; 404 → `not_found`.
12. **Read coercion** — `documentToNewsletter` / `getNewsletter` / `listNewsletters` with documents missing `scheduleEnabled`, `scheduleCron`, and `scheduleTimezone` (and `null` variants) yield `false`, `""`, and `"UTC"` respectively — mirror the existing lookback coerce test (`"coerces a missing/null/undefined lookback to DEFAULT_LOOKBACK"`).

### Declarations

13. Attribute shapes + constants present.

## Tasks

### Task 1: Failing tests for schedule helpers + schema expectations

- **Action**: Add `shared/src/newsletters/__tests__/schedule.test.ts` covering cases 1–8 above (include `@hourly` / `@daily` alias rejection in case 5; helpers may be imported from paths that do not exist yet — tests fail red). Extend `declarations.test.ts` with expected attribute/constant assertions for the three schedule fields. Extend `repository.test.ts` with failing cases 9–12 (create defaults, update omit, schedule updater, **and read coercion** for missing/null schedule attributes).
- **Expected result**: New/extended tests exist and fail for the right reasons (missing exports / missing attributes / wrong payloads / missing coerce).
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new schedule/declaration/repository assertions failing (not infra errors).
- **Depends on**: none.

### Task 2: Schema attributes + cron-parser dependency

- **Action**: Add `cron-parser` to `shared/package.json`; run install from repo root. Append `scheduleEnabled`, `scheduleCron`, `scheduleTimezone` and export `DEFAULT_SCHEDULE_TIMEZONE`, `SCHEDULE_CRON_MAX_LENGTH`, `SCHEDULE_TIMEZONE_MAX_LENGTH` in `shared/src/schema/declarations.ts`. Make declaration tests pass.
- **Expected result**: Schema declares the three attributes; constants exported; `cron-parser` resolvable from `@newsletter/shared`.
- **Verify**: `pnpm --filter @newsletter/shared test` — declarations tests green; `pnpm install` succeeds.
- **Depends on**: Task 1.

### Task 3: Implement schedule module (validate + next fire)

- **Action**: Create `shared/src/newsletters/schedule.ts` with `isValidIanaTimezone`, `assertValidCronExpression` (**`@` alias reject + 5-field check before parse**), `resolveScheduleFields`, `computeNextFireAt`, `toNewsletterScheduleView`, and `UpdateNewsletterScheduleInput` / `NewsletterScheduleView` types (types may live in `types.ts` if cleaner — either is fine if exports are public). Re-export from `newsletters/index.ts`. Use `CronExpressionParser.parse` with `tz`; never `reset()` to change `currentDate`.
- **Expected result**: Schedule helper tests 1–8 pass (including `@hourly` / `@daily` rejection).
- **Verify**: `pnpm --filter @newsletter/shared test` — `schedule.test.ts` green.
- **Depends on**: Task 2.

### Task 4: Repository wire-up (create defaults, preserve on update, schedule updater)

- **Action**: Extend `Newsletter` + `documentToNewsletter` coerce (missing/null → `false` / `""` / `UTC`). `createNewsletter` writes schedule defaults. `updateNewsletter` omits schedule keys. Add `updateNewsletterSchedule`. Make repository tests 9–12 green. Fix any compile breakages in shared/web tests that construct partial `Newsletter` objects (add the three fields with disabled defaults).
- **Expected result**: Persistence + read-coercion contract holds; typecheck clean across workspaces that import `Newsletter`.
- **Verify**: `pnpm --filter @newsletter/shared test` green; `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm typecheck && pnpm lint`
- Expected: All shared tests pass (including schedule + extended repository/declarations); typecheck and lint clean. A newsletter created via repository has `scheduleEnabled === false` and `toNewsletterScheduleView(…).nextFireAt === null`; after `updateNewsletterSchedule` with a valid enabled cron+TZ, `nextFireAt` is a future ISO UTC string.

## Handoff

Builder reports: files changed; `cron-parser` version pinned in `shared/package.json`; confirmation that definition `updateNewsletter` omits schedule keys; sample of one DST or weekday next-fire fixture used in tests; any deviation (e.g. types placed in `types.ts` vs `schedule.ts`) and why. Note for Features 02–03: use `updateNewsletterSchedule` + `toNewsletterScheduleView`; do not put schedule into definition FormData until Feature 03 intentionally extends the edit surface.

## Research notes

- **codegraph_explore** — current `Newsletter` / `documentToNewsletter` / `createNewsletter` / `updateNewsletter` / `declarations.ts` newsletters attributes (lookback + model overrides pattern).
- **npm / WebSearch** — `cron-parser` 5.6.x `CronExpressionParser.parse` + `tz`; avoid `reset()` tz-drop (GitHub issue #406).
- **Legacy** — `newsletters.yaml` uses 5-field cron (`0 1 * * 1-5`), reinforcing the 5-field pin.
