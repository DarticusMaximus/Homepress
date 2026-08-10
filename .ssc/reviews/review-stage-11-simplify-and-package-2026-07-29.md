# SSC Code Review Report

**Date:** 2026-07-29
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-11-simplify-and-package (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-11-simplify-and-package/` (features 01–06)

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 2 | Medium 3 | Low 0 | Nit 0
- **Overall rationale:** Stage 11 delivers its Intent (DRY lists, cleanup, diagnosable failures, green gates, packaging, deploy docs). Two High security findings remain beyond the specs: unredacted `haltReason` can persist provider secrets into checkpoints/Inspect/stdout, and public `/health` discloses Appwrite endpoint/project plus an API-key validity oracle. Three Medium items (checkpoint revive shape guard; two Feature 02 test-coverage gaps) are real but non-blocking for ship. No Blockers. Address Highs before finalize if the stack will be network-exposed.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** `stage-11-simplify-and-package` (all six `verified` features)
- **Base reference:** n/a (SSC-native scope)
- **Batches:** B1 (F01+F02 UI DRY/sweep) → B2 (F03 phase failure) → B3 (F04–F06 gates/packaging/docs) → one validator pass
- **Files reviewed:** 49
  - Domain list: `web/components/domain-list/domain-list-card.tsx`, `domain-list-field.tsx`, `domain-list-pagination.tsx`, `format-list-datetime.ts`, `index.ts`
  - Domain cards/tables/pagination: feeds/newsletters/schedules/runs/issues/delivery `*-list-card.tsx`, `feeds-table.tsx`, `newsletters-table.tsx`, six `*-pagination.tsx`
  - Datetime/display: `web/lib/format-operator-datetime.ts`, `web/components/runs/run-display.ts`, `web/components/delivery/delivery-display.ts`
  - Inspect/pipeline leftovers: `web/components/runs/inspect-shell.tsx`, `shared/src/pipeline/orchestrator.ts`, `shared/src/pipeline/index.ts`
  - Phase failure: `shared/src/runs/phase-failure-summary.ts`, `types.ts`, `repository.ts`, `execute-run.ts`, `index.ts`, `web/components/runs/inspect-phase-failure.tsx`, `inspect-phase-section.tsx`
  - Packaging/docs/health: `compose.yaml`, `web/Dockerfile`, `worker/Dockerfile`, `.dockerignore`, `.env.example`, `docs/DEPLOY.md`, `README.md`, `web/app/health/route.ts`
  - Tests: `domain-list-card`, `format-operator-datetime`, `domain-list-pagination`, `inspect-entry`, `phase-failure-summary`, `inspect-phase-failure`, `execute-run`, `runs-trigger-label`, `dashboard-home-load`, `production-packaging-docs`, `deploy-documentation-smoke`
- **Files skipped:**
  - Project-root `.env` — secrets / gitignored
  - `web/src/__tests__/inspect-phase-lists.test.tsx` — optional/alternate per F03 Files; dedicated `inspect-phase-failure.test.tsx` reviewed instead
  - Responsive-list “must stay green” suites not in Files create/modify lists — regression context only
  - Generated/build output (`node_modules`, `.next`, dist) — generated
- **Assumptions and unknowns:**
  - Feature 04 production drift fixes beyond the two named test files were assumed minimal; no additional production paths were discovered in the Files section.
  - `/health` disclosure is Confirmed as beyond-spec security even though Feature 06 Acceptance criteria document the current public JSON shape.
  - Two draft Anti-cheat findings (N1 deploy-docs substrings; N2 compose build-args allowlist) were Rejected by the validator as matching prescribed Testing approaches — dropped from Detailed Findings.

---

## SSC Intent Check

For SSC-native scope, this records whether the implementation actually serves the feature spec's Intent line.

- **Stage Intent:** Make the codebase shippable for initial V1 — DRY GUI drift, diagnosable failed runs, honest quality gates, documented podman compose against external Appwrite via `.env` only.
- **Feature Intent lines:**
  1. **01** — Collapse duplicated table/card list chrome into one shared card shell; Stage 03 responsive preserved; no operator-visible behavior change.
  2. **02** — Remove leftovers; cheap GUI/helper drift collapse + one datetime-style unify.
  3. **03** — Diagnose mid-pipeline deaths from stdout, `failureMessage`, and Inspect instead of one-liners.
  4. **04** — Typecheck/lint/tests/build green for an honest ship call.
  5. **05** — Harden compose/Docker/`.env.example` for clone → fill `.env` → `podman compose up`.
  6. **06** — In-repo docs so a stranger can deploy and verify the stack is alive.
- **Intent served?** Yes (with beyond-spec security gaps)
- **Notes:** Implementations match Intents; Shared card/pagination shells and delete targets look real. Phase-failure enrichment is real, but `haltReason` bypasses the redaction path the feature otherwise applies (S1). Public `/health` smoke matches Feature 06 Accept criteria but is a security tradeoff (S2). Feature 02 Testing approach items for wrapper equivalence and pagination smoke are incompletely locked (T1, T2) — test-gap, not product drift.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [x] S1-20260729: Unredacted haltReason persists provider secrets

| Field | Value |
|---|---|
| **ID** | `S1-20260729` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `shared/src/runs/phase-failure-summary.ts:56-64` |
| **Description** | `buildPhaseFailureSummary` copies `haltReason` into the persisted `phaseFailure` wire object without `redactMessageForStorage`. Pipeline halt reasons embed the last provider error (`… (last error: ${attempt.error})`), so API keys and bearer tokens in that error can survive into Storage checkpoints, Inspect (`formatPhaseFailureSummaryLine`), and stdout `fatal-outcome.haltReason`. Per-article `failures[].error` and enriched `failureMessage` are redacted; these three surfaces bypass that path. |
| **Risk / Impact** | Provider secrets from LLM/API failures can be stored in run checkpoint JSON, shown to operators in Inspect, and printed to worker logs — broader exposure than the already-redacted `failureMessage`. |
| **Evidence** | Tagger/scorer set `haltReason` via `truncateForHaltReason` only (no secret redaction). Builder assigns `haltReason: result.haltReason` unchanged. `execute-run` logs `haltReason` beside a redacted `reason`. Inspect renders `summary.haltReason` as plain text. Unit redaction tests cover `failures[].error`, not `haltReason`. |
| **Recommendation** | In `buildPhaseFailureSummary`, redact/bound `haltReason` (e.g. `redactMessageForStorage(haltReason, 200)` when non-null). Redact before stdout logging (or log only the redacted summary). Optionally re-redact in `InspectPhaseFailureBlock` for already-written checkpoints. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Build phaseFailure from a TagResult whose haltReason embeds `sk-…` / `Bearer …`; assert checkpoint `haltReason` and Inspect do not contain the raw secret; enrichment fields still present. |
| **Acceptance Criteria** | Any `phaseFailure.haltReason` written by the builders has secrets redacted; Inspect and stdout do not show raw `sk-`/`Bearer` material from the embedded last error; consecutive errors, failure count, and samples still appear. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Tagger/scorer embed last provider error into haltReason; builder leaves it unchanged while sibling fields redact. Inspect renders haltReason as plain text — secret-persistence bypass is real. |

---

### [x] S2-20260729: Public /health discloses Appwrite target and key validity

| Field | Value |
|---|---|
| **ID** | `S2-20260729` |
| **Severity** | High |
| **Category** | Security |
| **Location** | `web/app/health/route.ts:14-30` |
| **Description** | Unauthenticated public `/health` (in `PUBLIC_ROUTES`, published via compose `3000:3000`) returns Appwrite `endpoint`, `project` id, and `authenticated: true` after a live `databases.list()` with the server API key. That is infrastructure disclosure plus a remote credential-validity oracle. Feature 06 documents this shape for smoke — this finding is beyond-spec security, not Intent drift. |
| **Risk / Impact** | An internet-facing or LAN-exposed deploy lets unauthenticated callers map the Appwrite target and learn whether `APPWRITE_API_KEY` currently works, aiding targeted attacks. |
| **Evidence** | Success body includes `endpoint`, `project`, `authenticated: true`; `/health` is public; compose publishes port 3000 and healthchecks that URL; `docs/DEPLOY.md` documents the JSON. |
| **Recommendation** | Keep liveness separate from Appwrite readiness: public probe returns only a minimal ok/degraded signal (or HTTP status alone). Move detailed handshake behind auth, an internal-only port, or a shared-secret header used by compose healthcheck. Update deploy docs and contract expectations to match. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Unauthenticated GET `/health` must not include endpoint, project id, or API-key success boolean; authenticated or secret-gated readiness still proves handshake for smoke. |
| **Acceptance Criteria** | Public `/health` body contains no Appwrite endpoint, project id, or authenticated flag; compose healthcheck and `docs/DEPLOY.md` smoke steps still verify stack liveness without exposing those fields. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Disclosure and credential-validity oracle are real on a public, published route even though Feature 06 preserves this public smoke contract. High (not Blocker): not a full key leak. |

---

### [x] C1-20260729: reviveCheckpoint accepts unvalidated phaseFailure shapes

| Field | Value |
|---|---|
| **ID** | `C1-20260729` |
| **Severity** | Medium |
| **Category** | Correctness |
| **Location** | `shared/src/runs/repository.ts:678-713` |
| **Description** | `reviveCheckpoint` for tag/score assigns `phaseFailure` from parsed JSON with no runtime shape guard (unlike draft’s `assertDraftCheckpointPayload`). A corrupt or partially written checkpoint where `phaseFailure` is present but `failures` is missing/non-array can crash Inspect when `InspectPhaseFailureBlock` calls `failures.some` / `.map`. |
| **Risk / Impact** | Operators cannot open Tagged/Scored Inspect for an affected halt run; diagnosis UI fails hard instead of degrading. |
| **Evidence** | Tag/score revive only checks `"phaseFailure" in parsed`; Inspect assumes `failures` is an array; draft revive validates fields. |
| **Recommendation** | Add `assertPhaseFailureSummary` at the tag/score revive boundary; on failure throw the same class of error used for corrupt drafts so load maps to checkpoint_missing/error. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Load tag/score JSON with `phaseFailure: { halted: true }` (no failures), `failures: null`, `failures: "oops"`; expect clean load failure, not Inspect crash. Happy-path round-trip still passes. |
| **Acceptance Criteria** | Malformed `phaseFailure` never reaches Inspect as a partial object; load fails via the existing corrupt-checkpoint path; valid halt payloads still round-trip. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Revive boundary gap is real and Inspect-breaking for malformed storage; normal writers emit a valid shape, so impact needs corruption — Medium is appropriate. |

---

### [x] T1-20260729: Datetime wrapper equivalence tests missing

| Field | Value |
|---|---|
| **ID** | `T1-20260729` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `web/src/__tests__/format-operator-datetime.test.ts:1-27` |
| **Description** | Feature 02 Testing approach requires asserting that kept domain wrappers (`formatRunDateTime`, `formatDeliveryIssueDate`, `formatPhasePublished`) delegate equivalently to the canonical lib helpers. The new test file only compares the two lib helpers to direct `toLocale*` calls. |
| **Risk / Impact** | A mistaken re-export or broken `formatPhasePublished` conversion can ship while this suite stays green. |
| **Evidence** | Test imports only `formatOperatorDate` / `formatOperatorDateTime`; wrappers still exist in `run-display.ts` / `delivery-display.ts` / related helpers. |
| **Recommendation** | Assert sample-ISO equivalence for the kept wrappers against the lib helpers. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | `formatRunDateTime(iso) === formatOperatorDateTime(iso)`, etc., on a fixed `SAMPLE_ISO`. |
| **Acceptance Criteria** | `format-operator-datetime.test.ts` imports kept wrappers and asserts sample-ISO equivalence; suite passes. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Spec-required test gap with moderate regression risk; wrappers still exist and are unexercised by this suite. |

---

### [x] T2-20260729: Domain pagination wrapper smoke missing

| Field | Value |
|---|---|
| **ID** | `T2-20260729` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `web/src/__tests__/domain-list-pagination.test.tsx:39-143` |
| **Description** | Feature 02 Testing approach requires a smoke case that one domain wrapper (e.g. Feeds/Runs) still composes `DomainListPagination` with the same aria-label pattern. The file only unit-tests the shared shell in isolation. |
| **Risk / Impact** | Thin domain wrappers can stop composing the shared shell without failing this feature’s dedicated pagination suite. |
| **Evidence** | File imports only `DomainListPagination`; `feeds-health-pagination.test.tsx` does not fully substitute for the named smoke. |
| **Recommendation** | Render `FeedsPagination` or `RunsPagination` with `total > 20` and assert nav aria-label + status chrome. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Expect `getByLabelText("Feeds pagination")` and status text matching Page X of Y. |
| **Acceptance Criteria** | `domain-list-pagination.test.tsx` includes at least one domain-wrapper smoke asserting aria-label composition; test passes. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Named suite omits the required smoke; partial coverage elsewhere and Task 4 rg gate reduce blast radius but do not close the gap. |

---

## Dependencies and Licensing

- Vulnerabilities: none reviewed in this pass (packaging/docs focus; no dependency audit run)
- Outdated critical packages: none flagged
- License concerns: none

---

## Quality Signals

- Lint/config signals: not re-run in review; Feature 04 Intent assumes gates green at verify time
- Test/coverage signals: Feature 02 Testing approach incompletely locked (T1, T2); packaging/deploy contract suites match their prescribed substring/Dockerfile gates (validator Rejected N1/N2 as anti-cheat)
- Complexity/churn signals: Stage is simplify/package — low new product surface; highest risk in F03 persistence + public health smoke

---

## Risk Assessment

- **Overall risk:** High (two High security findings on network-reachable / persisted-error paths)
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Registry publishing, Appwrite-in-compose, live log tail, Features 01–09 semantics beyond failure capture, customer marketing docs

---

## PM Triage

Filled in after the PM reviews this report. This is the trigger for whether a hardening feature gets written.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| S1-20260729 | High | Address now | PM: harden all findings |
| S2-20260729 | High | Address now | PM: harden all findings |
| C1-20260729 | Medium | Address now | PM: harden all findings |
| T1-20260729 | Medium | Address now | PM: harden all findings |
| T2-20260729 | Medium | Address now | PM: harden all findings |

Hardening feature: `feature-07-hardening-review-2026-07-29` (`.ssc/stages/stage-11-simplify-and-package/feature-07-hardening-review-2026-07-29.md`).

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
