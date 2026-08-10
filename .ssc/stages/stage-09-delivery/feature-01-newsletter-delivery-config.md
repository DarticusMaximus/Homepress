# Feature 01: Newsletter delivery config

## Intent

Let the operator store a per-newsletter recipient list and independent auto-email / auto-RSS toggles (default off while tuning) so later Stage 09 delivery features can read one shared delivery contract instead of inventing ad-hoc flags or address lists.

## Spec

Add delivery-config fields to the `newsletters` collection and wire them through shared types, validation, repository helpers, and the newsletter edit surface. This feature owns **schema**, **persistence**, **email-list validation**, **auto-toggle rules**, and the **Delivery** section on `NewsletterFormDialog` (edit mode). It does **not** send email, publish RSS, download exports, auto-deliver after runs, or show delivery status (Features 02–06).

### Field contract (pinned)

| Persisted attribute | Type | Default on create / missing read | Notes |
|---------------------|------|----------------------------------|-------|
| `recipientEmails` | string[] (element size **320**) | `[]` | Operator-managed family-scale list. Normalized on write (trim + lowercase + case-insensitive dedupe). |
| `autoEmail` | boolean | `false` | When true, Feature 05 will email recipients after a successful draft — this feature only stores the switch. |
| `autoRss` | boolean | `false` | When true, Feature 05 will publish to RSS after a successful draft — independent of `autoEmail`. |

### Validation (pinned)

Add `shared/src/newsletters/delivery.ts` (re-export from `newsletters/index.ts`) with pure helpers:

| Helper | Behavior |
|--------|----------|
| `normalizeEmailAddress(raw: string): string` | Trim + lowercase. |
| `isValidEmailAddress(email: string): boolean` | After normalize: length 1–**254**; match a simple `local@domain` shape (at least one `@`, non-empty local/domain, domain contains a `.`, no whitespace). No MX lookup. |
| `resolveDeliveryFields(input)` | Normalize/validate as below; throw `NewsletterRepositoryError` `validation` with stable messages. |

**`resolveDeliveryFields` rules:**

1. Coerce `autoEmail` / `autoRss` to boolean (`true` / `false` only — reject non-booleans).
2. Coerce `recipientEmails` to an array of strings (reject non-array / non-string elements).
3. For each address: normalize; drop blanks after trim; reject if any remaining address fails `isValidEmailAddress` (message: `Invalid recipient email`).
4. Case-insensitive dedupe (keep first occurrence after normalize).
5. Reject if length > `RECIPIENT_LIST_MAX` (**20**) — message names the max.
6. If `autoEmail === true` and the normalized list is empty → validation error: `At least one recipient is required when auto-email is enabled`.
7. `autoRss === true` with an empty recipient list is **allowed** (RSS has no recipients).

Reject the whole delivery write on any failure (no partial Appwrite update of delivery keys).

Export constants from `declarations.ts`:

- `RECIPIENT_EMAIL_MAX_LENGTH = 254` (validation ceiling; Appwrite element size is **320** for headroom)
- `RECIPIENT_EMAIL_ATTR_SIZE = 320`
- `RECIPIENT_LIST_MAX = 20`

### Schema (pinned)

Append three attributes to the `newsletters` collection in `shared/src/schema/declarations.ts` (create-if-absent via provisioner — no drop / rename / retype / migrate):

| Attribute | Type | Size / default | Required |
|-----------|------|----------------|----------|
| `recipientEmails` | string | size **320**, `array: true` | false |
| `autoEmail` | boolean | default `false` | false |
| `autoRss` | boolean | default `false` | false |

Declaration tests must assert the three attributes and the exported constants.

**Existing documents:** missing / `null` / `undefined` map on read to `recipientEmails: []`, `autoEmail: false`, `autoRss: false` (same defensive coerce pattern as schedule / lookback).

### Domain types & write paths (pinned)

Extend `Newsletter` in `shared/src/newsletters/types.ts` with:

```ts
recipientEmails: string[];
autoEmail: boolean;
autoRss: boolean;
```

**Do not** add delivery fields to `CreateNewsletterInput`, `UpdateNewsletterInput`, or `NewsletterFields`. Definition create/update must not silently overwrite delivery config. Instead:

1. **`createNewsletter`** — always persist create defaults: `recipientEmails: []`, `autoEmail: false`, `autoRss: false`.
2. **`updateNewsletter`** — **omit** the three delivery keys from the Appwrite `data` payload so existing delivery values are preserved when the operator saves definition-only fields.
3. **`updateNewsletterDelivery(client, id, input)`** — new repository function; the only write path that changes delivery fields. Input:

```ts
export interface UpdateNewsletterDeliveryInput {
  recipientEmails: string[];
  autoEmail: boolean;
  autoRss: boolean;
}
```

Validate via `resolveDeliveryFields(input)`, then `updateDocument` with the three fields + `updatedAt`. Return the updated `Newsletter`. `not_found` / Appwrite error mapping matches existing repository helpers.

### UI — Delivery section (edit mode only)

Extend **`NewsletterFormDialog`** (`web/components/newsletters/newsletter-form-dialog.tsx`). Edit opens this dialog — there is no `/newsletters/[id]` page.

**Show** a **Delivery** block when `mode === "edit"` and `newsletter` is present. **Do not** show delivery fields in create mode (create keeps repository defaults).

**Placement (locked):** After the **Schedule** block, still inside the `<form>`, **before** `DialogFooter`. Feeds section stays outside the form as today.

**Section heading (locked):** `Delivery`

**Fields (locked):**

| Field | Control | FormData / notes |
|-------|---------|------------------|
| Recipients | `ChipInput` (reuse topics pattern) | Hidden `name="recipientEmailsJson"` with `JSON.stringify(recipientEmails)`; seed from `newsletter.recipientEmails` |
| Auto-email | Native checkbox (parity with `ScheduleFields`) | `name="autoEmail"` `value="true"`; unchecked → absent → coerce `false` |
| Auto-RSS | Native checkbox | `name="autoRss"` `value="true"`; unchecked → absent → coerce `false` |

**Help copy (locked, muted, under recipients):**  
`Email addresses for this newsletter’s family inbox list. Not a public signup — no unsubscribe flow.`

**Help copy (locked, muted, under toggles):**  
`Auto-email and auto-RSS default off while you tune. Turn them on only when you want Feature 05–style automatic delivery after a successful run. Manual Send / Publish (later features) still work when these are off.`

Keep the second help line operator-facing but shorter if the dialog feels crowded — minimum required meaning: **defaults off; toggles are independent; auto only after success**. Prefer:

`Defaults off while tuning. Auto-email and auto-RSS are independent; they apply after a successful run (wired in a later feature).`

**Prefill (required):** Seed recipients + both toggles from the loaded newsletter whenever the dialog opens (`key={newsletter.$id}` remounts on target change). Blank chips / wrong checkbox state for an already-configured newsletter is a bug.

### Save path (edit)

On **Save changes**, `updateNewsletterAction` must:

1. Parse definition fields as today.
2. Parse schedule fields as today (Feature 08 contract unchanged).
3. Parse delivery fields from the same `FormData`:
   - `autoEmail` / `autoRss` = present with `"on"` / `"true"` / `"1"` → true; else false (mirror `parseScheduleEnabled`).
   - `recipientEmails` = `parseChipJsonField("recipients", recipientEmailsJson, { required: true })`. Empty array `[]` is a valid JSON payload when auto-email is off.
4. **Validate before any Appwrite write (locked — atomicity):** Call `resolveDeliveryFields({ recipientEmails, autoEmail, autoRss })` (and keep existing schedule validation inside `updateNewsletterSchedule` / `resolveScheduleFields`) **before** the first `updateDocument`. Invalid delivery must fail with `validation` and leave schedule **and** delivery unchanged — never commit schedule then reject recipients.
5. Load `prior` via `getNewsletter` before writes (already done for schedule).
6. Call order (locked) — only after step 4 succeeds:
   1. `updateNewsletterSchedule`
   2. `updateNewsletterDelivery` (pass already-resolved fields; may re-validate defensively inside the repository — must not be the first place invalid recipients are caught on this path)
   3. `updateNewsletter` (definition)
7. **Rollback (locked):** If definition write fails after schedule and/or delivery succeeded, roll back **both** schedule and delivery to `prior` values (reuse existing schedule rollback; add delivery rollback via `updateNewsletterDelivery` with prior fields). If rollback fails, return a clear partial-failure message (extend or mirror `SCHEDULE_PARTIAL_FAILURE_ERROR` — e.g. mention schedule/delivery may be out of sync and to refresh).
8. On success: existing toast **Newsletter updated**; `revalidatePath("/newsletters")` and `revalidatePath("/schedules")` as today.

Create action: unchanged — no delivery FormData required.

**Do not** fold delivery keys into `UpdateNewsletterInput` / `updateNewsletter` repository payload.

### Out of scope

- SMTP / `.env` mail credentials or multipart send (Feature 02).
- Public RSS feed URL / publish / last-10 retention (Feature 03).
- MD/HTML download (Feature 04).
- Worker/run completion auto-deliver (Feature 05).
- Delivery status / failure reason on Issues or runs (Feature 06).
- Public signup, double opt-in, unsubscribe tokens.
- Managed ESP SaaS.
- Changing Stage 06 reader/inspect semantics.

## Dependencies

- Builds on: Stage 03 newsletter schema + repository + `NewsletterFormDialog` / `ChipInput`.
- Builds on: Stage 08 schedule fields + `updateNewsletterSchedule` + edit-form schedule save/rollback pattern.
- Soft consumers: Features 02–05 (email/RSS/auto-deliver read these fields) — not required to verify this feature.
- Orphaned by: none — first feature in Stage 09.

## Constraints

- **Schema-as-code only.** Append attributes in `declarations.ts`; no console provisioning.
- **Create-if-absent only.** No drop / rename / retype / migrate.
- **Do not** implement send, publish, download, auto-deliver, or delivery-status UI.
- **`updateNewsletter` must preserve** existing delivery attributes (omit from payload).
- **Server-only** Appwrite via existing shared repository + API-key client patterns.
- **Secrets:** never log API keys, session secrets, or SMTP credentials (none added here).
- Match existing `NewsletterRepositoryError` validation / not_found / appwrite patterns.
- Family-scale recipients only — no subscriber management product surface.
- Keep dialog scroll working (`max-h` + `overflow-y-auto` from Stage 08 Feature 03) — Delivery must remain reachable.

## Acceptance criteria

- [ ] `newsletters` declares `recipientEmails` (string array size 320), `autoEmail` (boolean default false), `autoRss` (boolean default false); declarations tests assert them + exported constants.
- [ ] `Newsletter` exposes the three fields; missing attributes coerce to `[]` / `false` / `false` on read.
- [ ] `createNewsletter` writes delivery defaults; `updateNewsletter` does not overwrite delivery fields.
- [ ] `updateNewsletterDelivery` validates and persists recipients + toggles; invalid email, over-max list, or auto-email-without-recipients rejects with `validation`.
- [ ] Newsletter edit dialog shows a **Delivery** section (edit only) with recipients chip input and two independent auto toggles; create mode has no Delivery section.
- [ ] Saving edit persists delivery via `updateNewsletterDelivery` without clearing schedule or definition fields; definition-only omit of delivery keys still holds on the repository path.
- [ ] Edit save validates delivery with `resolveDeliveryFields` **before** any Appwrite write; invalid recipients do not leave a committed schedule change.
- [ ] On definition failure after schedule+delivery writes, both schedule and delivery roll back to `prior` (covered by required action tests).
- [ ] No SMTP send, RSS publish, download, auto-deliver, or delivery-status UI in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Modify: `shared/src/schema/declarations.ts`
- Modify: `shared/src/schema/__tests__/declarations.test.ts`
- Modify: `shared/src/newsletters/types.ts`
- Create: `shared/src/newsletters/delivery.ts`
- Modify: `shared/src/newsletters/index.ts` (re-export delivery helpers / types)
- Modify: `shared/src/newsletters/repository.ts` (`documentToNewsletter`, create defaults, update omit, `updateNewsletterDelivery`)
- Create: `shared/src/newsletters/__tests__/delivery.test.ts`
- Modify: `shared/src/newsletters/__tests__/repository.test.ts`
- Modify: `web/components/newsletters/newsletter-form-dialog.tsx`
- Modify: `web/app/(protected)/newsletters/actions.ts`
- Create: `web/src/__tests__/newsletter-form-delivery.test.tsx`
- Modify: `web/src/__tests__/newsletters-actions.test.ts` (required call-order + dual-rollback cases)
- Modify as needed: other test fixtures constructing `Newsletter` (add the three fields with defaults)

## Testing approach

Test-first for delivery validation and repository preserve/update semantics; web component tests for Delivery section visibility and prefill. No live SMTP/RSS in this feature.

### `delivery.test.ts`

1. **Normalize** — trim + lowercase; dedupe case-insensitively (`A@B.com` then `a@b.com` → one entry).
2. **Valid list** — two good addresses + both toggles false → accepted.
3. **Invalid email** — reject `not-an-email`, `@nodomain`, `spaces ok@x.com`, over-length local/domain; no Appwrite call in repository tests when validation fails.
4. **Max list** — 21 valid addresses → reject naming max 20.
5. **Auto-email requires recipients** — `autoEmail: true`, `[]` → validation error.
6. **Auto-RSS alone** — `autoRss: true`, empty recipients, `autoEmail: false` → accepted.
7. **Non-boolean toggles** — reject.
8. **Blank chips** — whitespace-only entries dropped before length/validity checks.

### `repository.test.ts` (extend)

9. **create** payload includes `recipientEmails: []`, `autoEmail: false`, `autoRss: false`.
10. **updateNewsletter** mock `updateDocument` data does **not** include the three delivery keys.
11. **updateNewsletterDelivery** success writes the three fields + `updatedAt`; validation errors do not call Appwrite; 404 → `not_found`.
12. **Read coercion** — missing/null/undefined delivery attributes → `[]` / `false` / `false`.

### Declarations

13. Attribute shapes + constants present.

### `newsletter-form-delivery.test.tsx`

14. **Edit mode** — Delivery heading, recipients control, Auto-email and Auto-RSS checkboxes present; checkboxes reflect newsletter defaults (`false` / configured `true`).
15. **Create mode** — no Delivery heading / auto-email checkbox.
16. **Prefill** — newsletter with two recipients and `autoEmail: true` shows those chips / checked state (via accessible labels / values as implemented).

### `newsletters-actions.test.ts` (required — not optional)

17. **Call order** — On a successful edit save, mocks show `updateNewsletterSchedule` then `updateNewsletterDelivery` then `updateNewsletter` (and `resolveDeliveryFields` / delivery validation runs before the first Appwrite update mock is invoked).
18. **Invalid delivery before writes** — Bad recipient list returns `{ ok: false, error }` with the validation message; `updateNewsletterSchedule` / `updateNewsletterDelivery` / `updateNewsletter` are **not** called.
19. **Dual rollback on definition failure** — After schedule + delivery succeed, `updateNewsletter` throws; action restores both schedule and delivery to `prior` (assert rollback calls with prior fields). Keep/extend the existing partial-failure path when rollback itself fails.

## Tasks

### Task 1: Failing tests for delivery helpers + schema + repository expectations

- **Action**: Add `shared/src/newsletters/__tests__/delivery.test.ts` covering cases 1–8 (helpers may not exist yet — tests fail red). Extend `declarations.test.ts` with attribute/constant assertions. Extend `repository.test.ts` with failing cases 9–12 (create defaults, update omit, delivery updater, read coercion).
- **Expected result**: New/extended tests exist and fail for the right reasons (missing exports / missing attributes / wrong payloads / missing coerce).
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new delivery/declaration/repository assertions failing (not infra errors).
- **Depends on**: none.

### Task 2: Schema attributes + constants

- **Action**: Append `recipientEmails`, `autoEmail`, `autoRss` and export `RECIPIENT_EMAIL_MAX_LENGTH`, `RECIPIENT_EMAIL_ATTR_SIZE`, `RECIPIENT_LIST_MAX` in `shared/src/schema/declarations.ts`. Make declaration tests pass.
- **Expected result**: Schema declares the three attributes; constants exported.
- **Verify**: `pnpm --filter @newsletter/shared test` — declarations tests green for the new assertions.
- **Depends on**: Task 1.

### Task 3: Implement delivery module (validate + normalize)

- **Action**: Create `shared/src/newsletters/delivery.ts` with `normalizeEmailAddress`, `isValidEmailAddress`, `resolveDeliveryFields`, and `UpdateNewsletterDeliveryInput` (types may live in `types.ts` if cleaner). Re-export from `newsletters/index.ts`.
- **Expected result**: Delivery helper tests 1–8 pass.
- **Verify**: `pnpm --filter @newsletter/shared test` — `delivery.test.ts` green.
- **Depends on**: Task 2.

### Task 4: Repository wire-up (create defaults, preserve on update, delivery updater)

- **Action**: Extend `Newsletter` + `documentToNewsletter` coerce. `createNewsletter` writes delivery defaults. `updateNewsletter` omits delivery keys. Add `updateNewsletterDelivery`. Make repository tests 9–12 green. Fix compile breakages in shared/web tests that construct partial `Newsletter` objects (add the three fields with empty/false defaults).
- **Expected result**: Persistence + read-coercion contract holds; typecheck clean across workspaces that import `Newsletter`.
- **Verify**: `pnpm --filter @newsletter/shared test` green for repository/delivery; `pnpm typecheck` progressing (web may still need form work).
- **Depends on**: Task 3.

### Task 5: Edit-form Delivery section (UI only)

- **Action**: Add Delivery UI to `NewsletterFormDialog` (edit only) per Spec — recipients `ChipInput`, Auto-email / Auto-RSS checkboxes, help copy, placement after Schedule. Add `web/src/__tests__/newsletter-form-delivery.test.tsx` for cases 14–16. Do **not** change `updateNewsletterAction` save order in this task (hidden fields may be present but action wiring is Task 6).
- **Expected result**: Edit dialog shows Delivery with correct prefill; create mode has no Delivery section; dialog scroll still reaches Delivery + feeds.
- **Verify**: `pnpm --filter @newsletter/web test` — `newsletter-form-delivery.test.tsx` green (cases 14–16).
- **Depends on**: Task 4.

### Task 6: Edit save path — validate-first, order, dual rollback

- **Action**: Extend `updateNewsletterAction` per Save path: parse delivery FormData; call `resolveDeliveryFields` **before** any Appwrite write; then `updateNewsletterSchedule` → `updateNewsletterDelivery` → `updateNewsletter`; on definition failure roll back **both** schedule and delivery to `prior`; keep/extend partial-failure messaging when rollback fails. Add required cases 17–19 to `web/src/__tests__/newsletters-actions.test.ts`.
- **Expected result**: Invalid delivery never commits schedule; successful save writes in locked order; definition failure restores prior schedule + delivery; action tests gate the contract.
- **Verify**: `pnpm --filter @newsletter/web test` — actions cases 17–19 green; `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 5.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint`
- Expected: All shared + web tests pass (including delivery + extended repository/declarations + form delivery + **required** actions call-order / validate-before-write / dual-rollback cases); typecheck and lint clean. A newsletter created via repository has empty recipients and both autos false; after `updateNewsletterDelivery` with valid recipients and `autoEmail: true`, read-back matches; edit dialog shows Delivery only in edit mode; invalid recipients on edit save do not leave schedule changed.

## Handoff

Builder reports: files changed; confirmation that definition `updateNewsletter` omits delivery keys; sample validation messages for invalid email and auto-email-without-recipients; confirmation that `resolveDeliveryFields` runs before any Appwrite write; confirmation of save order (schedule → delivery → definition) and dual rollback on definition failure; pointer to action tests 17–19; any deviation (e.g. types in `types.ts` vs `delivery.ts`) and why. Note for Features 02/05: read `recipientEmails` / `autoEmail` / `autoRss` from `Newsletter`; do not invent parallel config stores.

## Research notes

- **codegraph_explore** — current `Newsletter` / `documentToNewsletter` / `createNewsletter` / `updateNewsletter` / `updateNewsletterSchedule` / `NewsletterFormDialog` schedule section / `ChipInput` / `parseChipJsonField` patterns (2026-07-17).
- **Stage 08 Feature 01 + 03** — separate schedule write path + edit-form save/rollback mirrored for delivery.
- **Stage 09 stage file / Plan.md** — recipients + independent auto-email/auto-RSS defaults off; no signup/unsubscribe; SMTP deferred to Feature 02.
- **Appwrite** — string array attributes use per-element `size` (same pattern as `topics` size 128); recipient element size **320** with validation max **254**.
