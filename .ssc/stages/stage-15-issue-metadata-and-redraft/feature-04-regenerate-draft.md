# Feature 04: Regenerate draft

## Intent

Let the operator redo only the prose on a completed run (truncated “success,” prompt/model experiments) without re-fetching or re-selecting — so a short draft is recoverable, and already-sent email / already-published RSS stay put until they Send or Publish again.

## Spec

From factory surfaces only, requeue a **completed** run so the worker resumes at **draft** on the existing selection checkpoint. Same run id. New draft **replaces** the previous draft checkpoint. Then run Feature 01 extract + Feature 02 title/dek overlay and `markCompleted`. Skip auto-email / auto-RSS. Keep original `endedAt` and delivery fields. If the new draft is empty or the regenerate aborts **before** a new draft checkpoint is saved, **restore `completed` with the old draft** — never `markFailed`. If abort happens **after** the new checkpoint is saved (`markCompleted` failing twice), restore `completed` and **keep the new checkpoint** (do not roll the file back).

`executeRun` already refuses `status !== "pending"` and `resumeStartPhase("draft")` is `null`, so a completed run cannot resume today. Regenerate rewinds `completedPhase` to `"selection"` and sets `pending`, **keeping** `endedAt` and `checkpointDraftId`. Failed **Retry** still **clears** `endedAt` via `requeueFailedRun`. That difference is the discriminator.

### Grill-pinned decisions

| Topic | Pin |
|---|---|
| Delivery | Do **not** auto-email or auto-RSS after regenerate. Leave last Send/Publish history. RSS snapshot updates only on the next explicit Publish. |
| Abort | Empty draft, LLM/config/checkpoint/save/drafter throw → restore `completed`, keep old draft, no `markFailed`. `markCompleted` failing twice after a new checkpoint → restore `completed`, **keep the new checkpoint**. Race: this run superseded → `restoreCompleted`, not `markFailed`. |
| Surfaces | Admin issue chrome (`showOps`) + Runs completed rows. Confirm Dialog. Not Home, channel, reader issue, Issues list, or Inspect. |
| LLM | Re-claim current drafter + title/dek prompts and models (`loadRunLlmResolution` as today). |
| Date / Home | Keep original `endedAt`. While pending/running the issue drops off Home / Issues. |
| Worker | Requeue; do not call the drafter inside the server action. |

### Discriminator (pinned)

`isDraftRegenerateRun(run, startPhase)` is true iff:

1. `startPhase === "draft"`
2. `run.endedAt` is a non-empty string
3. `run.checkpointDraftId` is a non-empty string

Failed-retry resume from selection has `endedAt === null`. First-time runs start at `fetch`. Capture `preservedEndedAt` and `previousDraftFileId` from the **loaded pending run** before `markRunning` (which currently nulls `endedAt`).

### Requeue write (pinned)

`requeueCompletedRunForDraft(client, runId)`:

- `getRun`; `status !== "completed"` → `RunRepositoryError("validation", … expected "completed")`.
- `completedPhase !== "draft"` → same validation error (`This run cannot regenerate its draft; start a new run instead` is the **request**-layer string; repository may use the status/phase message).
- Payload **only**: `status: "pending"`, `completedPhase: "selection"`, `currentPhase: ""`, `failedPhase: ""`, `failureMessage: ""`.
- **Do not write** `endedAt`, trigger, topicSummary, checkpoint ids, delivery fields, `issueTitle` / `issueDek`, `startedAt`, `failedFeeds`, `suppressSummary`.

`MarkCompletedInput.endedAt?: string` — if non-empty, persist that ISO instead of `new Date().toISOString()`. First-time complete omits it (unchanged).

`restoreCompleted(client, runId, { endedAt: string })`: `status: "completed"`, `endedAt` from input, `completedPhase: "draft"`, `currentPhase: "draft"`, `failedPhase: ""`, `failureMessage: ""`. Do not touch checkpoints, topicSummary, delivery, or issue metadata. `completedPhase: "draft"` is required so a later regenerate is not refused by the `completedPhase !== "draft"` guard.

### Request guards (pinned)

`requestRegenerateDraft(client, runId): Promise<RetryResult>` in `shared/src/runs/regenerate-draft.ts` (reuse `RetryResult` from `retry.ts`). Mirror `requestFailedRunRetry` step order:

1. `getRun` — `not_found` → `"Run not found"`; other repo → `err.message`; unknown → `GENERIC_ERROR` (same string as retry.ts).
2. `status !== "completed"` → `"Only completed runs can regenerate their draft"`.
3. `completedPhase !== "draft"` → `"This run cannot regenerate its draft; start a new run instead"`.
4. Active run for newsletter → `"A run is already in progress for this newsletter"`.
5. `loadPhaseCheckpoint(selection)` then `loadPhaseCheckpoint(draft)`. `checkpoint_missing` → `"Cannot regenerate: checkpoint data is missing. Start a new run instead."` Other load error → `"Could not load checkpoint due to a database error. Try again."`
6. `requeueCompletedRunForDraft`.
7. Race re-check via `listActiveRunsForNewsletter` (oldest `startedAt` wins, same as retry). **Do not `markFailed` this run id.** If `actives[0].$id !== runId`, call `restoreCompleted` with the `endedAt` captured **before** requeue, then return the in-progress string. Other extras (not this run) may still `markFailed` as `"Superseded by a concurrent start"` like retry. If restore of this run throws, log `phase: "regenerate-draft-race-restore"` and still return the in-progress string (do not `markFailed`).

### executeRun (pinned)

After `startPhase` is known, compute `isRegenerate` / `preservedEndedAt` / `previousDraftFileId`. Helper `abortRegenerate(client, runId, preservedEndedAt)` → `restoreCompleted`; log `phase: "regenerate-draft-abort"`. On restore throw, log and **do not** `markFailed`.

When `isRegenerate`, call `abortRegenerate` instead of `markFailed` for: config build fail, LLM resolution fail, OpenRouter key missing, resume hydrate fail, empty draft, drafter throw, outer `catch`, `savePhaseCheckpoint("draft")` throw (this **overwrites** savePhaseCheckpoint’s best-effort `markFailed`), and **`markCompleted` failing twice** after the new draft checkpoint is already saved (current non-regenerate path `markFailed`s with `completedPhase: "selection"` — on regenerate that would fail the issue after the old prose is already replaced). On that last path: `restoreCompleted` with `preservedEndedAt`; **keep the new checkpoint** (do not delete it or restore `previousDraftFileId`).

Success: save new draft checkpoint; Feature 01 extract + Feature 02 overlay (do **not** duplicate generators — same path as a normal complete); `markCompleted({ …metadata, endedAt: preservedEndedAt })`; **skip** `autoDeliverAfterSuccess`; best-effort `Storage.deleteFile` of `previousDraftFileId` if it differs from the new id (log `phase: "regenerate-draft-orphan"`; ignore errors).

Hydrate still loads the **selection** checkpoint. Do not re-run fetch/scrape/tag/score/selection. `loadRunLlmResolution` stays claim-time (current GUI models/prompts).

### GUI (pinned)

| Surface | Behavior |
|---|---|
| Runs table + cards | Completed → **Regenerate draft**. Failed stays **Retry**. Pending/running: neither. |
| Admin issue | `IssueReader` `showOps` success path, next to Send/Publish. Omit on load-error / not-available. |
| Reader `/issues/[runId]` | `showOps={false}` — no button. |

Confirm with existing `@/components/ui/dialog` (same pattern as `reset-prompt-dialog.tsx`). Locked copy (curly apostrophe):

- Title / submit: `Regenerate draft`. Pending submit: `Regenerating…`. Cancel: `Cancel`.
- Body: `Replace this issue’s draft with a new one from the same selected articles? Fetch, tags, scores, and selection will not run again.`
- Extra paragraph iff `emailDeliveryStatus === "sent"` **or** `rssDeliveryStatus === "published"`: `Email and RSS already delivered will not be updated. Send or Publish again if you want the new draft delivered.`
- Toast success: `Draft regeneration started`. Error: `result.error`.
- `aria-label`: `Regenerate draft for ${newsletterName}`.

Action `regenerateDraft` in `web/app/(protected)/admin/runs/actions.ts` (auth like `retryFailedRun`). On ok, `revalidatePath` `/admin/runs`, `/admin/issues`, `/admin/issues/${runId}`, `/issues/${runId}`, `/`.

## Dependencies

- Builds on: **feature-01-persist-title-and-dek**, **feature-02-cheap-model-title-dek** (extract + overlay on complete; `issueTitle` / `issueDek` on `Run` / `markCompleted`), **feature-03-surfaces-use-stored-metadata** (Home/chrome/email/RSS already consume stored fields). Execute 01 → 02 → 03 → 04.
- Builds on: Stage 04 retry/requeue, `executeRun` resume-from-selection, Stage 09 auto-deliver, Stage 14 `showOps` issue chrome.

## Constraints

- Do not re-fetch, re-tag, re-score, or re-select.
- Do not auto-deliver on regenerate success.
- Do not `markFailed` a regenerate abort (issue stays `completed`; old draft unless a new checkpoint already saved).
- Do not change `requeueFailedRun` (still clears `endedAt`).
- Do not add the button to reader issue, Home, channel, `/admin/issues` list, or Inspect.
- Do not rewrite already-sent email or RSS except on the next explicit Publish.
- Do not bump `endedAt` on regenerate complete.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] From Admin issue (`showOps`) or Runs (completed row), the operator can start regenerate; reader issue page has no control.
- [ ] Confirm Dialog appears before the action; delivery warning when email is `sent` or RSS is `published`.
- [ ] Worker re-runs only draft (then title/dek overlay) on existing selected items; same run id.
- [ ] New draft replaces the previous checkpoint; stored title/dek refresh (overlay, else extract).
- [ ] Auto-email / auto-RSS do not run; delivery fields unchanged; `endedAt` unchanged.
- [ ] Empty/throw regenerate restores `completed` (`completedPhase: "draft"`) with the old draft; `markFailed` not called. `markCompleted` double-fail after a new checkpoint still restores `completed` and keeps the new draft.
- [ ] Current drafter + title/dek prompts and models are claimed at regenerate start.
- [ ] Failed runs still use Retry, not this button.

## Files

- Create: `shared/src/runs/regenerate-draft.ts`
- Create: `shared/src/runs/__tests__/regenerate-draft.test.ts`
- Create: `web/components/runs/regenerate-draft-button.tsx`
- Create: `web/components/runs/regenerate-draft-dialog.tsx`
- Create: `web/src/__tests__/regenerate-draft-button.test.tsx`
- Modify: `shared/src/runs/types.ts` — `MarkCompletedInput.endedAt?`; `RestoreCompletedInput` if not inlined
- Modify: `shared/src/runs/repository.ts` — `requeueCompletedRunForDraft`, `restoreCompleted`, `markCompleted` endedAt
- Modify: `shared/src/runs/__tests__/repository.test.ts`
- Modify: `shared/src/runs/execute-run.ts`
- Modify: `shared/src/runs/__tests__/execute-run.test.ts`
- Modify: `shared/src/runs/index.ts` — export regenerate module
- Modify: `web/app/(protected)/admin/runs/actions.ts`
- Modify: `web/components/runs/runs-table.tsx`, `run-list-card.tsx`
- Modify: `web/components/issues/issue-reader.tsx`
- Modify: `web/src/__tests__/runs-responsive-list.test.tsx`, `issue-reader-chrome.test.tsx`

## Testing approach

Test-first. Unit tests only; no live Appwrite/OpenRouter; no screenshots. Tests verify **behavior in the Intent** (same run, draft-only, restore on abort, no auto-deliver, factory-only UI) — not button class names.

### Test cases

**Repository**

1. `requeueCompletedRunForDraft` on completed+`completedPhase: "draft"`: payload keys are only status/completedPhase/currentPhase/failedPhase/failureMessage; `endedAt` / delivery / `checkpointDraftId` absent from payload.
2. Non-completed → `validation`. `completedPhase` not `"draft"` → `validation`.
3. `markCompleted` with `endedAt: "2026-01-01T01:00:00.000Z"` writes that string, not a new timestamp. Omit `endedAt` → writes now (existing test still holds).
4. `restoreCompleted` writes `status: "completed"`, given `endedAt`, `completedPhase: "draft"`, `currentPhase: "draft"`, cleared failure fields; does not send checkpoint or delivery keys.

**requestRegenerateDraft**

5. not_found → `"Run not found"`. pending/failed → `"Only completed runs can regenerate their draft"`. completed but `completedPhase: "selection"` → cannot-regenerate string.
6. Active run → in-progress string. Selection or draft `checkpoint_missing` → cannot-regenerate missing-checkpoint string. Appwrite load error → database-error string.
7. Happy: loads **both** checkpoints, requeues, race list is only this run → `{ ok: true }`.
8. Race: `actives[0].$id !== runId` → in-progress string; `restoreCompleted` called for **this** `runId` with pre-requeue `endedAt`; `markFailed` **not** called for this `runId`; `markFailed` may be called for other extras.

**executeRun**

9. Regenerator fixture: `status: "pending"`, `completedPhase: "selection"`, `endedAt` set, `checkpointDraftId: "old-draft"`. Inject drafter returning new markdown. Assert: no fetcher/tagger/scorer/selector; `draft` once with selection articles; `markCompleted` `endedAt` is the preserved ISO; `autoDeliver` **not** called; `markFailed` not called; `savePhaseCheckpoint` phase `"draft"` once.
10. Same fixture, drafter `{ empty: true }`: `restoreCompleted` with preserved `endedAt`; `markFailed` not called; `markCompleted` not called; `autoDeliver` not called; old draft id not required to change.
11. Same fixture, `savePhaseCheckpoint` throws: `restoreCompleted`; `markFailed` must not be the **final** status writer (restore runs after). `autoDeliver` not called.
12. Same fixture, `loadRunLlmResolution` throws: `restoreCompleted`; `markFailed` not called.
13. Existing resume-from-selection test (`endedAt: null`): still `autoDeliver` once on success (not a regenerate).
14. Existing empty-draft **first run**: still `markFailed` (not restore).
15. Regenerator success: after new checkpoint, best-effort delete `previousDraftFileId` (mock Storage or injectable `deleteCheckpointFile`; throw from delete must still complete).
16. Same fixture, drafter **throws** (not `{ empty: true }`): `restoreCompleted` with preserved `endedAt`; `markFailed` not called; `autoDeliver` not called. Empty-draft (test 10) is not this path.
17. Same fixture, new draft checkpoint saves, then `markCompleted` throws twice: `restoreCompleted` with preserved `endedAt`; `markFailed` not the final status writer; new checkpoint kept (orphan-delete of `previousDraftFileId` still allowed); `autoDeliver` not called.

**GUI**

18. Runs: completed row has **Regenerate draft** in table and cards; failed has **Retry** only; pending has neither.
19. Dialog opens on click; Cancel does not call the action. Confirm calls `regenerateDraft`; success toast `Draft regeneration started`.
20. Dialog includes delivery paragraph when `emailDeliveryStatus: "sent"` or `rssDeliveryStatus: "published"`; omits it when both `none`.
21. `IssueReader` `showOps` success shows the button; default / `showOps={false}` / load-error do not. Existing reader-route source test still asserts `showOps={false}` on `/issues/[runId]`.

## Tasks

### Task 1: Requeue, preserve endedAt, restore completed

- **Action**: Write failing repository tests 1–4. Add `requeueCompletedRunForDraft`, `restoreCompleted`, and optional `MarkCompletedInput.endedAt` in `shared/src/runs/types.ts` + `repository.ts`. Do not change `requeueFailedRun`.
- **Expected result**: Completed runs can be parked as pending-at-selection without wiping date/delivery/draft id; complete can keep a supplied `endedAt`; abort can restore completed.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/repository.test.ts`
- **Depends on**: none (types from Feature 01 must already include `issueTitle` / `issueDek` on `Run`).

### Task 2: requestRegenerateDraft guards

- **Action**: Write failing tests 5–8. Implement `isDraftRegenerateRun` + `requestRegenerateDraft` in `shared/src/runs/regenerate-draft.ts`. Export from `shared/src/runs/index.ts`. Locked strings as pinned. Race loop is like `retry.ts` **except** this `runId` is `restoreCompleted`, never `markFailed` (do not import privately from retry).
- **Expected result**: Only completed+draft-phase runs with both checkpoints requeue; errors match pins.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/regenerate-draft.test.ts`
- **Depends on**: Task 1.

### Task 3: executeRun regenerate branch

- **Action**: Write failing tests 9–17. In `shared/src/runs/execute-run.ts`, detect regenerate from the loaded run; abort via `restoreCompleted` on every listed fail path (including drafter throw / outer `catch` and `markCompleted` double-fail); skip auto-deliver; pass `endedAt: preservedEndedAt` into both `markCompleted` attempts; after a successful new draft checkpoint, best-effort delete `previousDraftFileId`. Reuse Feature 01/02 overlay already in this file — do not add a second title/dek path.
- **Expected result**: Draft-only redo; abort keeps the issue; first-time runs unchanged.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/execute-run.test.ts`
- **Depends on**: Task 2 and Features 01–02 executed.

### Task 4: Runs action + confirm button

- **Action**: Write failing tests 18–20. Add `regenerateDraft` to `web/app/(protected)/admin/runs/actions.ts`. Add dialog + button components. Wire completed rows in `runs-table.tsx` and `run-list-card.tsx`. Pass `newsletterName` and delivery statuses into the dialog.
- **Expected result**: Runs completed rows can confirm and start regenerate; toast matches Retry’s async style.
- **Verify**: `pnpm exec vitest run web/src/__tests__/regenerate-draft-button.test.tsx web/src/__tests__/runs-responsive-list.test.tsx`
- **Depends on**: Task 2.

### Task 5: Admin issue chrome; reader stays clean

- **Action**: Write failing test 21 (extend `issue-reader-chrome.test.tsx`). Render the same button on `IssueReader` success + `showOps` next to Send/Publish. Omit on load-error, not-available, and `showOps={false}`. Keep the existing `/issues/[runId]` `showOps={false}` source assertion.
- **Expected result**: Factory issue can regenerate; reader issue cannot.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-reader-chrome.test.tsx web/src/__tests__/regenerate-draft-button.test.tsx` then `pnpm typecheck` and `pnpm lint`
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm exec vitest run shared/src/runs/__tests__/repository.test.ts shared/src/runs/__tests__/regenerate-draft.test.ts shared/src/runs/__tests__/execute-run.test.ts web/src/__tests__/regenerate-draft-button.test.tsx web/src/__tests__/runs-responsive-list.test.tsx web/src/__tests__/issue-reader-chrome.test.tsx` then `pnpm typecheck` and `pnpm lint`
- Expected: listed tests pass; typecheck clean; lint clean (ignore leftover `pages/` warning). A completed Admin issue / Runs row can regenerate draft-only; abort leaves the old issue; Home/email/RSS do not auto-update.

## Handoff

Report files changed. Confirm `requeueFailedRun` still clears `endedAt`, regenerate skips auto-deliver, `restoreCompleted` writes `completedPhase: "draft"`, race cleanup never `markFailed`s this run id, and reader issue has no button. Note the injectable used for orphan draft-file delete. If `savePhaseCheckpoint` was given a skip-markFailed option instead of restore-after-throw, say so.

### Research notes

- Grill pins 2026-08-20 (this spec). Stage open question on post-delivery regenerate: leave deliveries; operator resends/republishes.
- Codegraph: `requestFailedRunRetry` / `requeueFailedRun` (`shared/src/runs/retry.ts`, `repository.ts`); `executeRun` resume-from-selection already drafts only (`execute-run.test.ts`); `autoDeliverAfterSuccess` after complete; `markRunning` nulls `endedAt`; `IssueReader` `showOps` gates Send/Publish; Dialog pattern in `reset-prompt-dialog.tsx`.
- Feature 01/02: extract then overlay before `markCompleted`; regenerate reuses that path with preserved `endedAt`.
- Grizzled Senior (2026-08-20): `restoreCompleted` must write `completedPhase: "draft"`; race cleanup must not `markFailed` this run; drafter throw + `markCompleted` double-fail must abort via restore (tests 16–17).
