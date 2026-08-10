# Feature 03: Newsletter edit schedule and scroll

## Intent

Put schedule controls on the newsletter edit surface (same dialog Feature 02 deep-links into) and restore scroll so every section — including schedule — is reachable on typical viewport heights, fulfilling the Stage 08 “edit from both places” decision and the Plan.md scroll pin.

## Spec

Extend **`NewsletterFormDialog`** (the edit surface on `/newsletters` — there is no `/newsletters/[id]` page) with a **Schedule** section in **edit mode**, and fix dialog overflow so the full form scrolls. This feature owns the **second schedule edit surface** and the **scroll fix**. It does **not** change the Schedules list page (Feature 02), schema (Feature 01), or worker due-check (Feature 04).

### Clarification — “edit page” = dialog

Plan.md / stage wording say “newsletter edit page.” In this codebase, Edit opens `NewsletterFormDialog` inside a shadcn/Radix `Dialog`. The overflow bug is that `DialogContent` has **no `max-height` / `overflow-y-auto`**, so tall content (definition + model overrides + feeds) clips below the viewport with no scroll. Fix that dialog; do **not** invent a new route.

### Data contract (from Feature 01 — do not re-litigate)

| Source | Use |
|--------|-----|
| `newsletter.scheduleEnabled` / `scheduleCron` / `scheduleTimezone` | Prefill schedule fields in edit mode (Feature 01 coerce defaults if missing). |
| `toNewsletterScheduleView(newsletter, now?)` | Optional read-only **Next fire** display under the schedule fields. |
| `updateNewsletterSchedule(client, id, input)` | **Only** write path for schedule fields. |
| `updateNewsletter` | Definition fields only — must continue to **omit** schedule keys from the Appwrite payload (Feature 01 pin). |

Assume Features 01–02 are verified (or at least Feature 01 helpers + Feature 02 field contract exist). Schedule field labels / help copy must match Feature 02’s Schedules edit dialog so operators see one mental model.

### Schedule section (edit mode only)

Show a **Schedule** block inside `NewsletterFormDialog` when `mode === "edit"` and `newsletter` is present. **Do not** show schedule fields in create mode (create keeps Feature 01 defaults: disabled / empty cron / UTC via `createNewsletter`).

**Placement (locked):** After the **Model overrides** block, still inside the `<form>`, **before** `DialogFooter`. Feeds section stays outside the form as today (sibling under `DialogContent`); scrolling the dialog body must reach schedule **and** feeds.

**Fields (locked — parity with Feature 02):**

| Field | Control | FormData / notes |
|-------|---------|------------------|
| Enable schedule | Checkbox (preferred; same as Feature 02 — install shadcn `checkbox` if missing). Native `<input type="checkbox">` acceptable only if Feature 02 used that. | `name="scheduleEnabled"`; unchecked → absent → coerce `false` |
| Cron expression | Text input, `font-mono` | `name="scheduleCron"`; placeholder `0 9 * * 1-5` |
| Timezone | Text input | `name="scheduleTimezone"`; placeholder `America/New_York` or `UTC` |

**Help copy under cron (locked, muted):** `Five fields: minute hour day-of-month month day-of-week. Example: 0 9 * * 1-5`

**Section heading (locked):** `Schedule`

**Next fire (locked):** When editing, compute `toNewsletterScheduleView(newsletter)` (or with a fixed `now` if testing) and show a muted line:

- If `nextFireAt` non-null: `Next fire: {locale short datetime}` — reuse Feature 02’s `formatScheduleNextFireAt` if it exists; else same `dateStyle: "short"` + `timeStyle: "short"` rules.
- If null: `Next fire: —`

This is **display-only** from the loaded newsletter (not live-recomputed as the operator types). After a successful save + revalidate, the next open shows the updated next fire.

**Prefill (required):** Seed enable/cron/timezone from `newsletter.scheduleEnabled` / `scheduleCron` / `scheduleTimezone` whenever the dialog opens for that newsletter (`key={newsletter.$id}` already remounts on target change). Blank fields for an already-configured schedule are a bug.

**Shared markup (preferred):** If Feature 02 extracted a reusable schedule-fields component (e.g. `web/components/schedules/schedule-fields.tsx`), use it here. If not, implement matching markup in the newsletter dialog and optionally extract a shared component used by both surfaces in this feature — avoid divergent help copy / placeholders.

### Save path (edit)

On **Save changes**, `updateNewsletterAction` must:

1. Parse definition fields as today.
2. Parse schedule fields from the same `FormData`:
   - `scheduleEnabled` = formData has `"scheduleEnabled"` with a truthy checked value (treat `"on"` / `"true"` / `"1"` as true; absent → false).
   - `scheduleCron` = string (trim; default `""`).
   - `scheduleTimezone` = string (trim; empty may be passed through — Feature 01 `resolveScheduleFields` maps empty TZ → UTC).
3. Call `updateNewsletterSchedule(getServerAppwrite(), newsletterId, { scheduleEnabled, scheduleCron, scheduleTimezone })` **and** `updateNewsletter(...)` for definition fields.
4. **Order (locked):** Call `updateNewsletterSchedule` **first**, then `updateNewsletter`. Rationale: invalid cron/TZ fails before definition write; Feature 01 validation stays the source of truth. Do **not** reimplement cron-parser rules in web.
5. On any `NewsletterRepositoryError`: return `{ ok: false, error }` with a safe message (same mapping as other newsletter actions).
6. On success: existing toast **Newsletter updated** is fine (do not require a second toast). `revalidatePath("/newsletters")` and **`revalidatePath("/schedules")`** so the Schedules list reflects the change.

Create action: unchanged — no schedule FormData required.

**Do not** fold schedule keys into `UpdateNewsletterInput` / `updateNewsletter` repository payload.

### Scroll fix (locked)

In `NewsletterFormDialog`, give `DialogContent` classes that keep the dialog within the viewport and allow vertical scroll of its content, e.g.:

```tsx
<DialogContent className="flex max-h-[min(90vh,calc(100dvh-2rem))] flex-col gap-4 overflow-y-auto">
```

(or equivalent Tailwind that achieves the same: **max height ≤ ~viewport**, **`overflow-y-auto`**).

**Scope:** Fix on `NewsletterFormDialog`’s `DialogContent` (required). Optionally also harden the shared `web/components/ui/dialog.tsx` `DialogContent` defaults the same way if that is cleaner and does not break short dialogs — either is acceptable; newsletter edit must scroll regardless.

Header + form + feeds must all be reachable by scrolling inside the dialog on a typical laptop height (~700–900px content taller than viewport). Sticky footer is **not** required for V1.

Add `data-testid="newsletter-form-dialog-content"` on that `DialogContent` (via `data-testid` / prop if supported, or a wrapper with the test id that carries the scroll classes) so tests can assert scroll classes without brittle full-class-string matching — assert presence of `overflow-y-auto` and a `max-h-` utility on the scroll container.

### Out of scope

- Schedules list page / Feature 02 dialog behavior changes beyond optional shared field extract.
- Schema / `cron-parser` / `toNewsletterScheduleView` implementation (Feature 01).
- Worker due-check, concurrency, missed fires (Features 04–06).
- Create-mode schedule UI.
- New `/newsletters/[id]` route.
- Changing Stage 04 run path or distinguishing scheduled vs manual runs (Feature 06).

## Dependencies

- Builds on: **feature-01-per-newsletter-schedule** — fields, `updateNewsletterSchedule`, `toNewsletterScheduleView`, validation.
- Builds on: **feature-02-schedules-page** — field/help-copy contract; deep-link opens this dialog; optional shared schedule-fields component / `formatScheduleNextFireAt`.
- Builds on: Stage 03 / 07 newsletter form (definition + model overrides + feeds).
- Consumed later by: Features 04–06 (operator configures schedule here or on Schedules).

## Constraints

- Schedule writes **only** via `updateNewsletterSchedule` — never via `updateNewsletter` payload.
- **Do not** implement due-check or run creation.
- **Do not** remove or replace the Schedules-page edit dialog (Feature 02).
- **Server-only** Appwrite via `getServerAppwrite()` + shared helpers.
- **Secrets:** never log API keys; sanitize errors like other actions.
- Preserve existing create/edit definition behavior and feeds attach/detach UX.
- Match Feature 02 schedule field copy and 5-field cron help text.

## Acceptance criteria

- [ ] Edit-mode `NewsletterFormDialog` shows a Schedule section (enable, cron, timezone) prefilled from the newsletter; create mode does not show it.
- [ ] Saving edit persists schedule via `updateNewsletterSchedule` and definition via `updateNewsletter`; invalid cron/TZ returns a safe validation error; Schedules path is revalidated.
- [ ] Next fire line shows locale short datetime or `—` from `toNewsletterScheduleView` of the loaded newsletter.
- [ ] Dialog content scrolls: max-height constrained to the viewport and `overflow-y-auto` so schedule and feeds are reachable when content exceeds viewport height.
- [ ] Help copy and field semantics match Feature 02; no schema / worker / Schedules-list regressions required beyond revalidation.
- [ ] Automated tests cover schedule section visibility/prefill, action schedule write path, and scroll-container classes; `pnpm typecheck`, `pnpm lint`, and relevant tests / web build pass.

## Files

- Modify: `web/components/newsletters/newsletter-form-dialog.tsx` — Schedule section (edit) + scrollable `DialogContent`
- Modify: `web/app/(protected)/newsletters/actions.ts` — `updateNewsletterAction` schedule parse + `updateNewsletterSchedule` + revalidate `/schedules`
- Create (optional): `web/components/schedules/schedule-fields.tsx` — shared fields if extracting / aligning with Feature 02
- Modify (optional): `web/components/ui/dialog.tsx` — only if choosing global DialogContent scroll defaults
- Modify (optional): Feature 02 `schedule-edit-dialog.tsx` — switch to shared fields if extracted here
- Test: `web/src/__tests__/newsletter-form-schedule.test.tsx` — section visibility, prefill, scroll classes
- Modify: `web/src/__tests__/newsletters-actions.test.ts` — schedule write / validation / revalidate cases
- Modify: `web/src/__tests__/newsletter-form-model-overrides.test.tsx` — extend `NEWSLETTER` fixture with schedule fields if `Newsletter` type requires them (Feature 01)

## Testing approach

Test-first for the action schedule path and dialog schedule/scroll assertions. No live Appwrite.

### `newsletter-form-schedule.test.tsx`

1. **Edit shows Schedule** — render edit dialog → heading `Schedule`, labels for enable / cron / timezone, help copy text present.
2. **Prefill** — newsletter with `scheduleEnabled: true`, cron `0 9 * * 1-5`, timezone `America/New_York` → controls reflect those values; next-fire line is not blank (either `—` only when disabled / null next, or a non-empty datetime string when enabled — mock `toNewsletterScheduleView` if needed for a stable string).
3. **Create hides Schedule** — create mode → no Schedule heading / no `scheduleCron` input.
4. **Scroll container** — edit dialog’s scroll container (`data-testid="newsletter-form-dialog-content"` or documented equivalent) has class tokens including `overflow-y-auto` and a `max-h-` prefix (string/classList check — not pixel-perfect layout).

### `newsletters-actions.test.ts` (extend)

5. **updateNewsletterAction — schedule success:** FormData includes schedule fields → mocks `updateNewsletterSchedule` called with coerced `{ scheduleEnabled, scheduleCron, scheduleTimezone }` **before** `updateNewsletter`; returns `ok: true`; `revalidatePath` includes `/schedules` (and `/newsletters` as today).
6. **updateNewsletterAction — schedule validation:** mocked `NewsletterRepositoryError` `validation` from `updateNewsletterSchedule` → `ok: false` with message; `updateNewsletter` **not** called (because schedule runs first).
7. **Unchecked enable:** omit `scheduleEnabled` from FormData → `scheduleEnabled: false` passed to `updateNewsletterSchedule`.

### Fixture hygiene

8. Any `Newsletter` test fixtures missing schedule fields must add `scheduleEnabled` / `scheduleCron` / `scheduleTimezone` once Feature 01 types require them (disabled defaults).

## Tasks

### Task 1: Failing tests for schedule UI + action path

- **Action:** Add `web/src/__tests__/newsletter-form-schedule.test.tsx` covering cases 1–4 (components may lack Schedule / scroll classes — fail red). Extend `web/src/__tests__/newsletters-actions.test.ts` with cases 5–7 (mock `updateNewsletterSchedule` from `@newsletter/shared`). Fix fixtures for case 8 as needed so typecheck isn’t blocked by missing fields.
- **Expected result:** New/extended tests exist and fail for the right reasons.
- **Verify:** `pnpm --filter web test` shows the new schedule/scroll/action assertions failing, not infra errors.
- **Depends on:** none (requires Feature 01 exports in workspace; execute after Feature 01 verified; Feature 02 field copy is the parity target).

### Task 2: Scrollable DialogContent on NewsletterFormDialog

- **Action:** Apply max-height + `overflow-y-auto` (and test id) on `NewsletterFormDialog`’s `DialogContent` per Spec. Make scroll assertion (case 4) green. Optionally update shared `dialog.tsx` if choosing global default.
- **Expected result:** Tall edit dialog content scrolls within the viewport.
- **Verify:** Case 4 green; `pnpm --filter web build` / typecheck succeed for the dialog change.
- **Depends on:** Task 1.

### Task 3: Schedule section UI + shared fields if extracting

- **Action:** Add Schedule section (edit only) with Feature 02-parity fields, help copy, prefill, and next-fire line. Prefer shared `schedule-fields` component with Feature 02 if present; else implement and optionally extract. Make UI tests 1–3 green.
- **Expected result:** Operator sees schedule controls on edit; create unchanged.
- **Verify:** Cases 1–3 green; typecheck clean.
- **Depends on:** Task 2.

### Task 4: Wire updateNewsletterAction + feature verification

- **Action:** Extend `updateNewsletterAction` to parse schedule FormData, call `updateNewsletterSchedule` then `updateNewsletter`, revalidate `/schedules` + `/newsletters`. Make action tests 5–7 green. Re-read Spec vs implementation; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied; Schedules list stays in sync after newsletter-edit schedule save.
- **Verify:** Action tests green; `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build` exit 0.
- **Depends on:** Task 3.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build`
- Expected: All green. Optional PM: open Edit on a newsletter with a short viewport (or zoomed browser) — scroll reaches Schedule and Feeds; enable `0 9 * * 1-5` + valid TZ, Save — Schedules page shows Enabled + a next fire; invalid cron shows an error and does not claim success.

## Handoff

Builder reports: files changed; confirmation that schedule writes use only `updateNewsletterSchedule` (definition update still omits schedule keys); scroll approach (dialog-local vs shared `DialogContent`); whether a shared `schedule-fields` component was extracted; any deviation (e.g. native checkbox vs shadcn) and why. Note for Features 04+: schedule is configurable from both Schedules and newsletter edit.

## Research notes

- **codegraph_explore** — `NewsletterFormDialog` is a tall `Dialog` with no max-h/overflow; feeds sit outside the form inside `DialogContent`; `DialogContent` in `web/components/ui/dialog.tsx` centers with `translate-y-[-50%]` and no scroll defaults. Feature 01/02 specs pin `updateNewsletterSchedule` + field/help-copy contract; Feature 02 deep-links `?edit=` into this dialog.
- **Plan.md carry-forward** — “Newsletter edit page does not scroll”; Stage 08 Feature 03 must fix scroll while adding schedule fields.
- **Auto decisions (2026-07-16):** Edit surface = dialog (not new route); schedule section edit-only; save via same Save changes with `updateNewsletterSchedule` **before** `updateNewsletter`; Feature 02 field/help parity; next-fire display-only from loaded newsletter; scroll via max-h + overflow-y-auto on newsletter dialog content.
