# Feature 08: Stage 06 hardening - review 2026-07-14

## Intent

Harden Stage 06 preview and inspection against findings from `review-stage-06-preview-and-inspection-2026-07-14`: unsafe external-link protocols, durable provider-error disclosure, an empty-selection retry-state failure, and malformed draft checkpoints. This preserves safe reading and trustworthy pipeline audit without reopening the seven verified Stage 06 features.

## Spec

Implement exactly the four PM-accepted review fixes below. The review report is evidence and handoff, not implementation text; this spec defines the work to build.

### S1 - Safe external Inspect links (`S1-20260714`)

Add one small shared web helper for Inspect external links. It must parse a candidate string and return a safe URL only when its protocol is `http:` or `https:`. Invalid, empty, relative, or any other-scheme value returns no safe link.

Use the helper in both existing Inspect link renderers:

- `web/components/runs/inspect-article-list.tsx` - fetched, scraped, tagged, and scored article links.
- `web/components/runs/inspect-selection-section.tsx` - selection-drop and suppression links.

For an unsafe value, render plain unavailable text rather than an anchor. Keep valid-link behavior unchanged: visible `Open` label, new tab, `rel="noopener noreferrer"`, and the full safe URL in the title attribute. Do not change raw article, selection-failure, or suppression data; this is a presentation boundary.

### S2 - Redact selection-failure detail before storage and display (`S2-20260714`)

Before every selection checkpoint save in `shared/src/runs/execute-run.ts`, map `selectionResult.failures` to the persisted JSON shape with a bounded, redacted `error` field. Preserve `articleTitle`, `articleLink`, and `reason`; do not alter MMR selection behavior or suppress logic.

Use the project's existing redaction utility where it fits. If it does not safely cover persisted details, add the smallest reusable sanitizer beside the existing logging/storage redaction utilities. The persisted value must remove recognized secrets such as API keys and `Authorization: Bearer` tokens and must be length-bounded. Never write a raw provider exception to a new checkpoint.

Apply the same safe-display boundary in `web/components/runs/inspect-selection-section.tsx` so legacy checkpoints containing raw error text cannot expose secrets. A redacted detail remains useful; absent or fully redacted details retain the existing empty-detail presentation.

### C1 - Preserve retry phase after an empty-selection status-update failure (`C1-20260714`)

Keep the empty-selection checkpoint save at `completedPhase: "selection"`, but make the status-update failure path reliably record `completedPhase: "score"`. A transient rejection from the primary `markFailed` call must not allow the outer catch fallback to leave the run resumable from draft with an empty selection.

Make the smallest local change that keeps this invariant explicit. For example, retry the empty-selection status update locally with the same `completedPhase: "score"`, or carry the required override into the outer fallback only for this path. Do not change retry behavior for other phase failures.

### C2 - Validate draft checkpoint shape at revival (`C2-20260714`)

Validate draft checkpoint JSON at the `reviveCheckpoint` boundary in `shared/src/runs/repository.ts`. Accept only a complete `DraftCheckpointPayload` with:

- `markdown` as a string.
- `empty` as a boolean.
- `reason` as `null` or a string.
- `articleCount` and `attempts` as finite, non-negative numbers.

Reject all malformed values, including primitives, `null`, empty objects, missing required fields, and wrong field types. Rejection must use the existing checkpoint download/revival error path so callers receive `RunRepositoryError` with `code === "checkpoint_missing"`. Do not invent a new error code or change the persisted wire shape.

## Out of scope

- Changing RSS/feed ingestion, source article data, MMR selection, suppression algorithms, or retry behavior outside the empty-selection failure path.
- New Appwrite schema attributes, collections, migrations, or Storage paths.
- Editing draft or selection content from Inspect.
- Changing the Issue reader's Markdown renderer, Issue title logic, Inspect route/navigation, or responsive list layout.
- Reprocessing or rewriting existing checkpoint files. Legacy raw failure detail is redacted at render time only.
- Changing feature statuses or reopening Stage 06 features 01-07.

## Dependencies

- Builds on: `review-stage-06-preview-and-inspection-2026-07-14` and its four accepted findings.
- Builds on: Stage 06 verified Inspect components, selection checkpoint persistence, retry behavior, and draft checkpoint loading.
- Consumed by: `ssc-finalize` for Stage 06 after this hardening feature verifies.
- Original Stage 06 features remain `verified`; this is a new, pending hardening feature layered on top.

## Constraints

- Make narrow fixes only; do not refactor unrelated run, checkpoint, or Inspect code.
- Test first for every corrected boundary and failure path.
- Retain the existing safe new-tab attributes for valid external links.
- Never persist or render raw provider error payloads from new selection checkpoints.
- Preserve existing checkpoint error contracts: malformed draft data maps to `checkpoint_missing`.
- Preserve the pinned empty-selection retry invariant: retry re-enters selection from score.
- Do not modify Appwrite schema declarations, data collections, or original feature status entries.
- Run `pnpm typecheck`, `pnpm lint`, and the relevant test suites before verification.

## Acceptance criteria

- [ ] Every Inspect external link is an anchor only for an absolute HTTP(S) URL; unsafe schemes, relative URLs, malformed values, and blanks render without an actionable link.
- [ ] Valid HTTP(S) Inspect links continue to show `Open`, open in a new tab, and use `rel="noopener noreferrer"` across article, selection-drop, and suppression lists.
- [ ] New selection checkpoint failures persist bounded, redacted error detail; a raw provider secret or Bearer token is neither stored nor displayed.
- [ ] Legacy selection checkpoint error detail is redacted before Inspect renders it.
- [ ] If the first `markFailed` after an empty selection rejects, the successful retry/fallback still stores `completedPhase: "score"`, and a run retry starts at selection rather than draft.
- [ ] Malformed draft checkpoint JSON always surfaces as `RunRepositoryError("checkpoint_missing", ...)`; valid draft checkpoints still revive unchanged.
- [ ] Focused tests cover all four fixes and their valid control cases; `pnpm test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm lint` exit zero.

## Files

- Create: `web/components/runs/inspect-external-link.tsx` (or a similarly narrow shared Inspect-link helper) and focused test if extraction is used.
- Modify: `web/components/runs/inspect-article-list.tsx` - use the safe-link boundary.
- Modify: `web/components/runs/inspect-selection-section.tsx` - use the safe-link boundary and redact legacy failure detail before display.
- Modify: `web/src/__tests__/inspect-phase-lists.test.tsx` - article-link safety coverage.
- Modify: `web/src/__tests__/inspect-selection-suppress.test.tsx` - selection/suppression link safety and legacy-detail redaction coverage.
- Modify: `shared/src/runs/execute-run.ts` - sanitize failure details before both selection checkpoint saves and preserve the empty-selection retry-state invariant.
- Modify: `shared/src/runs/repository.ts` - validate draft checkpoint payloads during revival.
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` - persistence-redaction and transient `markFailed` failure regression coverage.
- Modify: `shared/src/runs/__tests__/repository.test.ts` - malformed and valid draft checkpoint revival coverage.
- Modify only if needed: the existing shared redaction utility and its focused tests, keeping its public behavior compatible with current callers.

## Testing approach

Use fixtures and mocks at the existing component/repository boundaries; no live Appwrite service is required.

1. Render article, selection-drop, and suppression links with `https://example.test/path` and assert the existing safe external anchor behavior.
2. Render those same lists with `javascript:`, `data:`, `mailto:`, `/relative`, blank, and malformed values; assert no actionable anchor is emitted.
3. Drive `executeRun` through both non-empty and empty selection saves with a provider-like error containing an API-key pattern and Bearer token. Assert saved JSON is bounded and redacted; render an equivalent legacy failure fixture and assert the sensitive literal is absent from both table and card views.
4. Make the primary empty-selection `markFailed` call reject and its recovery call succeed. Assert the persisted failure has `completedPhase: "score"` and retry resumes selection.
5. Mock checkpoint download for valid draft JSON, `{}`, a primitive, `null`, missing fields, and each wrong field type. Assert only valid payloads revive; every invalid value yields `checkpoint_missing`.

## Tasks

### Task 1: Safe external-link boundary

- **Action:** Write failing component tests for HTTP(S) controls and invalid protocol/value cases. Add the smallest shared Inspect-link helper or component, then route article, selection-drop, and suppression links through it.
- **Expected result:** Untrusted persisted link values cannot create actionable non-HTTP(S) anchors; valid links retain existing behavior.
- **Verify:** Focused `inspect-phase-lists` and `inspect-selection-suppress` tests pass for valid and unsafe-link fixtures.
- **Depends on:** none.

### Task 2: Selection-failure secret redaction

- **Action:** Add failing execute-run tests for redaction and bounds before selection checkpoint persistence, plus web tests proving legacy detail is safe before table/card rendering. Implement the narrow sanitizer at persistence and display boundaries.
- **Expected result:** Provider errors remain diagnostically useful without becoming a durable or visible secret channel.
- **Verify:** Shared execute-run and web selection/suppression tests pass with API-key and Bearer-token fixtures absent from saved and rendered output.
- **Depends on:** none.

### Task 3: Empty-selection retry-state recovery

- **Action:** Add a failing regression that makes the first empty-selection `markFailed` reject and recovery succeed. Implement the smallest path-specific change that records `completedPhase: "score"` for the successful failure update.
- **Expected result:** Retrying an empty-selection failure re-enters selection and never drafts from an empty selection.
- **Verify:** The regression test observes the preserved completed phase and subsequent retry start phase.
- **Depends on:** Task 2 may share execute-run test fixtures but does not require its implementation.

### Task 4: Draft checkpoint schema validation

- **Action:** Add failing repository tests for malformed draft payload variants and valid controls. Validate the runtime shape in draft revival and route malformed values through the existing `checkpoint_missing` contract.
- **Expected result:** Issue and Inspect callers receive their existing safe missing-checkpoint behavior for corrupt-but-valid-JSON drafts.
- **Verify:** Focused repository tests pass for every malformed fixture and the valid draft fixture remains unchanged.
- **Depends on:** none.

### Task 5: Full regression verification

- **Action:** Re-read this spec against the implementation, run the focused suites and repository-wide gates, and correct only failures attributable to Tasks 1-4.
- **Expected result:** All four accepted review findings are closed without behavior outside this hardening scope changing.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` exits zero.
- **Depends on:** Tasks 1-4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web test && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: valid Inspect links remain safe and usable; non-HTTP(S) links are inert; selection failures never preserve or render fixture secrets; empty-selection retry remains at score/selection after a transient status update failure; malformed draft checkpoints map to `checkpoint_missing`; all gates are green.

## Handoff

Builder reports:

- The source and test files changed for each of S1, S2, C1, and C2.
- The sanitization strategy and explicit secret-pattern/bounds coverage.
- The empty-selection failure/retry regression result.
- The malformed draft payload matrix and `checkpoint_missing` result.
- Focused and full verification command results.
- Confirmation that no Appwrite schema, source checkpoint data, Stage 06 original feature status, or out-of-scope behavior changed.

**Review handoff:** `.ssc/reviews/review-stage-06-preview-and-inspection-2026-07-14.md`
