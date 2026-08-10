# SSC Code Review Report

**Date:** 2026-07-14
**Review:** ssc-code-review (manager-orchestrated - sequential reviewer + validator sub-agents)
**Scope:** stage-06-preview-and-inspection (stage)
**Profile:** full - severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-06-preview-and-inspection/feature-01-issues-list.md` through `feature-07-draft-inspect.md`

---

## Summary

- **Merge recommendation:** Block
- **Issues by severity:** Blocker 0 | High 1 | Medium 3 | Low 0 | Nit 0
- **Overall rationale:** The stage delivers its reading and pipeline-inspection surfaces, with no validated intent-drift or anti-cheat finding. However, selection failure details can be stored and rendered without redaction, which can make provider credentials durable and visible to operators. The remaining validated findings weaken safe external-data handling, malformed-checkpoint recovery, and the empty-selection retry invariant.

---

## Scope and Coverage

> Records what was and was not checked - the files-reviewed breadcrumb.

- **Target reviewed:** `stage-06-preview-and-inspection` (seven verified features)
- **Base reference:** n/a (SSC-native scope)
- **Files reviewed:** 40
  - `shared/src/runs/issues.ts`
  - `shared/src/runs/repository.ts`
  - `shared/src/runs/types.ts`
  - `shared/src/runs/execute-run.ts`
  - `shared/src/runs/index.ts`
  - `shared/src/runs/__tests__/issues.test.ts`
  - `shared/src/runs/__tests__/repository.test.ts`
  - `shared/src/runs/__tests__/execute-run.test.ts`
  - `web/package.json`
  - `web/app/globals.css`
  - `web/lib/nav-items.ts`
  - `web/app/(protected)/issues/page.tsx`
  - `web/app/(protected)/issues/[runId]/page.tsx`
  - `web/components/issues/issue-markdown.tsx`
  - `web/components/issues/issue-list-card.tsx`
  - `web/components/issues/issues-url.ts`
  - `web/components/issues/issues-pagination.tsx`
  - `web/components/issues/issue-reader.tsx`
  - `web/components/issues/issues-view.tsx`
  - `web/components/issues/issues-table.tsx`
  - `web/app/(protected)/runs/[runId]/inspect/page.tsx`
  - `web/components/runs/load-inspect-phases.ts`
  - `web/components/runs/inspect-shell.tsx`
  - `web/components/runs/inspect-url.ts`
  - `web/components/runs/inspect-selection-section.tsx`
  - `web/components/runs/inspect-phase-section.tsx`
  - `web/components/runs/inspect-draft-section.tsx`
  - `web/components/runs/inspect-article-list.tsx`
  - `web/components/runs/runs-table.tsx`
  - `web/components/runs/run-list-card.tsx`
  - `web/components/runs/run-display.ts`
  - `web/components/runs/run-suppress-summary.tsx`
  - `web/src/__tests__/feeds-nav.test.ts`
  - `web/src/__tests__/issue-markdown.test.tsx`
  - `web/src/__tests__/issue-reader.test.tsx`
  - `web/src/__tests__/issues-responsive-list.test.tsx`
  - `web/src/__tests__/inspect-entry.test.tsx`
  - `web/src/__tests__/inspect-phase-lists.test.tsx`
  - `web/src/__tests__/inspect-selection-suppress.test.tsx`
  - `web/src/__tests__/inspect-draft-section.test.tsx`
- **Files skipped:** pre-existing upstream run, checkpoint, and suppression dependencies not directly listed by Stage 06 feature specs - out of scope; reviewers could consult them only to validate a finding.
- **Assumptions and unknowns:** No Git base is available for this SSC-native scope. This review was source and test inspection only; it did not execute application gates or an external dependency-vulnerability scan.

---

## SSC Intent Check

- **Feature Intent line:** Let the operator read completed drafts in-app as the everyday consumption surface, and audit how a run chose its items - replacing the Obsidian/Nextcloud path and making pipeline decisions inspectable for tuning. This serves the product's preview-and-inspect goals and makes retained run checkpoints useful for both reading and diagnosis.
- **Intent served?** Yes
- **Notes:** The reviewer found no validated spec drift or SSC anti-cheat pattern. The findings below concern protection and reliability of the delivered surfaces rather than whether the stage implements its stated capability.

---

## Detailed Findings

> Single source of truth - each finding listed exactly once, sorted by severity (Blocker to Nit) then category. Track completion only via these checkboxes.

### [ ] S2-20260714: Selection failure details can persist and expose secrets

| Field | Value |
|---|---|
| **ID** | `S2-20260714` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `shared/src/runs/execute-run.ts:357-360` |
| **Description** | Selection failure error details are persisted unchanged and rendered verbatim in the Inspect Selection drops pane. |
| **Risk / Impact** | Embedding or LLM provider errors can contain credentials, authorization headers, or endpoint details. Those values become durable checkpoint data visible to operators. |
| **Evidence** | `selectionResult.failures` is passed to `savePhaseCheckpoint` unchanged; `web/components/runs/inspect-selection-section.tsx:189-191` renders the stored detail. |
| **Recommendation** | Redact and bound failure error strings before checkpoint persistence while retaining safe diagnostics. Redact legacy checkpoint details before rendering as well. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Inject a selection failure containing an OpenRouter key and Bearer token; assert neither is persisted nor rendered, while a safe diagnostic remains visible. |
| **Acceptance Criteria** | Selection-drop details in new checkpoints and Inspect cannot contain recognized secrets or unbounded provider error payloads. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | MMR selection copies caught error text into every failure, persistence keeps it unchanged, and Inspect renders it. Neither path redacts or bounds the field, contrary to the stage's sanitized-error constraint. |

### [ ] S1-20260714: Inspect accepts unvalidated external-link protocols

| Field | Value |
|---|---|
| **ID** | `S1-20260714` |
| **Severity** | Medium |
| **Category** | Security |
| **Location** | `web/components/runs/inspect-article-list.tsx:28-40` |
| **Description** | Inspect renders checkpoint article links directly in anchor `href` attributes without an allowed-protocol check. |
| **Risk / Impact** | Checkpoint and RSS-derived links are untrusted. React blocks `javascript:` URLs, but other non-HTTP(S) schemes remain unvalidated in article, selection-drop, and suppression links. |
| **Evidence** | `ExternalArticleLink` passes the raw value into an anchor; equivalent raw-link handling also appears in `web/components/runs/inspect-selection-section.tsx`. |
| **Recommendation** | Validate links centrally and render an external anchor only for approved HTTP(S) URLs; render inert text or omit the control otherwise. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Render each Inspect list with a non-HTTP(S) URL and assert that no unsafe clickable `href` is emitted; retain valid HTTPS link coverage. |
| **Acceptance Criteria** | All Inspect external-link renderers reject non-HTTP(S) schemes while valid HTTP(S) links still open in a new tab with `noopener noreferrer`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | The validator confirmed raw persisted links reach anchors in article and selection/suppression lists. React reduces the original JavaScript-URL impact, so severity is Medium, but protocol validation is still absent. |

### [ ] C1-20260714: Fallback failure path can skip empty-selection retry work

| Field | Value |
|---|---|
| **ID** | `C1-20260714` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/execute-run.ts:367-371` |
| **Description** | The empty-selection retry invariant is lost if the explicit `markFailed` call throws after the selection checkpoint advances `completedPhase` to `selection`. |
| **Risk / Impact** | If the first status update fails and the outer fallback succeeds, it omits `completedPhase: "score"`. Retry can then resume at draft with an empty selection instead of re-running selection. |
| **Evidence** | The empty branch calls `markFailed` with `completedPhase: "score"`; the outer fallback at `shared/src/runs/execute-run.ts:470-476` calls `markFailed` without that override. |
| **Recommendation** | Preserve `completedPhase: "score"` in the outer failure fallback for this path, or handle the primary status-update failure locally with an equivalent retry. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Make the empty-selection branch's first `markFailed` reject and its outer fallback succeed; assert the fallback writes `completedPhase: "score"` and retry starts at selection. |
| **Acceptance Criteria** | Every persisted empty-selection failure that can be retried records `completedPhase: "score"`, including when the first failure-status update transiently fails. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | The checkpoint advances to selection before the primary status update. The fallback demonstrably omits the required override, so a successful fallback violates the pinned retry invariant. |

### [ ] C2-20260714: Malformed draft JSON bypasses checkpoint recovery

| Field | Value |
|---|---|
| **ID** | `C2-20260714` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `shared/src/runs/repository.ts:606-608` |
| **Description** | Draft checkpoint revival trusts any valid JSON value as `DraftCheckpointPayload` without validating its required shape. |
| **Risk / Impact** | A valid but malformed payload bypasses the `checkpoint_missing` path. The reader can render an empty body and Inspect can show undefined draft metadata rather than the locked safe state. |
| **Evidence** | The draft branch returns parsed JSON through a type assertion, while malformed article phases throw during revival and are mapped to `checkpoint_missing`. Existing tests cover invalid JSON and malformed fetch data, not malformed draft data. |
| **Recommendation** | Validate `markdown`, `empty`, `reason`, `articleCount`, and `attempts` before returning a draft payload; throw on malformed data so download/revival maps it to `checkpoint_missing`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Load draft checkpoints containing `{}`, a primitive JSON value, and invalid field types; assert `checkpoint_missing` and the reader/Inspect safe state. |
| **Acceptance Criteria** | Only complete `DraftCheckpointPayload` objects are revived; every malformed draft payload produces `RunRepositoryError` with code `checkpoint_missing`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | The validator confirmed the draft branch has no runtime validation and only thrown revival errors become `checkpoint_missing`; valid JSON such as `{}` reaches consumers with missing fields. |

---

## Dependencies and Licensing

- Vulnerabilities: no vulnerability scan was run in this review.
- Outdated critical packages: no finding reported from the reviewed package manifest; dependency versions were not externally audited.
- License concerns: not assessed; no license inventory was in scope.

---

## Quality Signals

- Lint/config signals: no source formatting or configuration changes were made; application gates were not executed in this review.
- Test/coverage signals: focused shared and web tests exist in the reviewed scope. The confirmed findings identify missing coverage for malformed draft payloads, transient empty-selection status failures, unsafe link protocols, and error redaction.
- Complexity/churn signals: scope is 40 direct Stage 06 source and test files, approximately 86k tokens; no validated anti-cheat, test-disabling, or spec-drift finding.

---

## Risk Assessment

- **Overall risk:** High
- **Merge decision:** Block
- **Out-of-scope areas:** pre-existing upstream run, checkpoint, and suppression dependencies not directly listed by Stage 06 specifications; live Appwrite behavior; executed test, lint, typecheck, and vulnerability-scan results.

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S2-20260714 | High | Address now | Accepted by PM; included in `feature-08-hardening-review-2026-07-14`. |
| S1-20260714 | Medium | Address now | Accepted by PM; included in `feature-08-hardening-review-2026-07-14`. |
| C1-20260714 | Medium | Address now | Accepted by PM; included in `feature-08-hardening-review-2026-07-14`. |
| C2-20260714 | Medium | Address now | Accepted by PM; included in `feature-08-hardening-review-2026-07-14`. |

PM Decisions: `Address now` -> included in a hardening feature. `Defer` -> recorded for a future stage. `Dismiss` -> no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
