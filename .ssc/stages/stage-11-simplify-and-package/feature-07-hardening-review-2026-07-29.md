# Feature 07: Harden stage-11 against review findings (2026-07-29)

## Intent

Harden `stage-11-simplify-and-package` against findings from `review-stage-11-simplify-and-package-2026-07-29`: redact halt `haltReason` before persist/Inspect/stdout, shrink public `/health` so it no longer discloses Appwrite target or key-validity details, validate `phaseFailure` at revive so Inspect cannot crash on corrupt checkpoints, and lock Feature 02 datetime-wrapper + domain-pagination smoke tests — without reopening features 01–06.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–06 stay `verified`. It addresses **all five** PM-accepted findings (2 High, 3 Medium). Distilled work — not a copy of the report.

### S1 (High) — redact `haltReason` on write (+ display defense-in-depth)

Today `buildPhaseFailureSummary` in `shared/src/runs/phase-failure-summary.ts` assigns `haltReason: result.haltReason` unchanged while `failures[].error` goes through `redactMessageForStorage(..., PHASE_FAILURE_ERROR_MAX)`. Tagger/scorer halt reasons embed the last provider error (`… (last error: ${attempt.error})`), so raw `sk-…` / `Bearer …` material can land in Storage checkpoints, Inspect summary lines, and stdout `fatal-outcome.haltReason` even though `buildHaltFailureMessage` redacts the combined `failureMessage` string.

**Fix (required):**

1. In `buildPhaseFailureSummary`, when `result.haltReason` is a non-null string, set  
   `haltReason: redactMessageForStorage(result.haltReason, PHASE_FAILURE_ERROR_MAX)`  
   (reuse the existing per-error bound; or introduce `PHASE_FAILURE_HALT_REASON_MAX` equal to that value and use it — one named constant, not a magic number). When `haltReason` is `null`, keep `null`.
2. Do **not** change enrichment fields: `halted`, `consecutiveErrors`, `totalArticles`, `failureCount`, capped `failures[]` still behave as Feature 03.
3. `buildHaltFailureMessage` may keep its whole-string `redactMessageForStorage` pass (idempotent if `haltReason` is already redacted).
4. Stdout in `execute-run.ts` that logs `phaseFailure.haltReason` must only ever see the builder-redacted value (no separate raw copy). Prefer logging the summary object produced by `buildPhaseFailureSummary` — do not re-read an unredacted pipeline `haltReason` for logs.

**Defense in depth (required for already-written checkpoints):**

5. In `web/components/runs/inspect-phase-failure.tsx`, when rendering:
   - `formatPhaseFailureSummaryLine`: if `haltReason` is a non-empty string, pass it through `redactMessageForStorage(haltReason, PHASE_FAILURE_ERROR_MAX)` (import from `@newsletter/shared`) before interpolating.
   - Per-row `failure.error` display: re-redact with the same helper/bound before showing in table/cards (mirror selection-drops if that pattern already exists; otherwise apply the same call).
6. Do **not** invent a second redaction alphabet — reuse `redactMessageForStorage` from `shared/src/util/log-redact.ts` (already exported via `@newsletter/shared`).

### S2 (High) — minimal public `/health` (keep handshake, drop disclosure)

Today `web/app/health/route.ts` is public (`PUBLIC_ROUTES`), published on compose port `3000`, and on success returns:

```json
{ "status": "ok", "appwrite": { "endpoint", "project", "reachable": true, "authenticated": true } }
```

That discloses the Appwrite target and acts as an unauthenticated API-key validity oracle. Feature 06 documented that shape for smoke; this hardening **deliberately changes** the public contract while preserving “stack alive / handshake succeeded” signal.

**Pinned public contract (replace current bodies):**

| Outcome | HTTP | Body (exact shape) |
|---|---|---|
| Handshake success (`databases.list()` resolves) | **200** | `{ "status": "ok" }` only — **no** `appwrite` key, **no** `endpoint`, **no** `project`, **no** `authenticated`, **no** `reachable` |
| Handshake failure | **503** | `{ "status": "degraded", "message": "Appwrite handshake failed" }` only — **no** `appwrite` object and **no** `reachable` / `authenticated` fields |

**Keep:**

- Force-dynamic route; still call `getServerAppwrite()` + `Databases.list()` so **HTTP 200 iff handshake succeeded** (compose healthcheck already exits on `statusCode === 200` only — no body parse).
- Structured `console.error` on failure (existing `[/health] …` log). Prefer not logging raw secrets; if the catch string may contain keys, pass through `sanitizeAppwriteMessageForLog` / `redactMessageForStorage` before `console.error`.

**Do not:**

- Add a second public readiness endpoint that re-exposes endpoint/project/authenticated.
- Require auth or a shared-secret header for `/health` in this feature (V1 self-host: status-code + `"status":"ok"` is enough).
- Change compose port publishing or remove the web healthcheck.

**Docs + contract tests (required):**

1. Update `docs/DEPLOY.md` Smoke §2:
   - Expect HTTP **200** and JSON containing top-level `"status":"ok"`.
   - State clearly that **200 means the Appwrite handshake succeeded**, without showing endpoint/project/authenticated in the response.
   - Remove the example JSON that prints `endpoint` / `project` / nested `authenticated: true`.
   - Degraded: **503** + `"status":"degraded"` + the fixed `message` string; remove references to `appwrite.authenticated: false`.
2. Update `shared/src/pipeline/__tests__/deploy-documentation-smoke.test.ts`:
   - Drop the old requirement that DEPLOY.md contain both substrings `appwrite` and `authenticated` as the “nesting gate” for the **response body**.
   - Require docs still mention `/health`, `"status":"ok"` (or equivalent documented success), and that a successful probe means the Appwrite handshake worked.
   - Require docs **do not** teach operators to expect response fields `endpoint`, `project`, or `authenticated` on `/health` (assert absence of those field names in the smoke/example section, or assert the new minimal example is present and the old nested example is gone — pick one concrete strategy and stick to it in tests).
3. `README.md` Deploy blurb may stay a short pointer; only change if it embeds the old JSON shape.
4. `compose.yaml` healthcheck: leave as status-code-only unless a comment needs a one-line update that 200 = handshake without body fields.

### C1 (Medium) — assert `phaseFailure` shape at revive

`reviveCheckpoint` tag/score branches in `shared/src/runs/repository.ts` assign `p.phaseFailure` when the key is present, with no runtime guard. `InspectPhaseFailureBlock` assumes `failures` is an array (`failures.some` / `.map`). Corrupt Storage JSON can crash Inspect.

**Fix:**

1. Add `assertPhaseFailureSummary(value: unknown): PhaseFailureSummaryJson` next to `assertDraftCheckpointPayload` in `repository.ts` (or a tiny colocated helper in the same file — do not invent a new package).
2. Required shape (throw `SyntaxError` with a clear message on any failure, matching draft revive):
   - value is a non-null object
   - `halted === true` (literal boolean true)
   - `haltReason` is `null` or `string`
   - `consecutiveErrors`, `totalArticles`, `failureCount` are finite numbers ≥ 0 (reuse `isNonNegativeFiniteNumber`)
   - `failures` is an **array**
   - each failure element is an object with:
     - `articleTitle`: string
     - `articleLink`: string
     - `error`: string
     - `attempts`: non-negative finite number
     - optional `reason`: only if present, must be `"exception"` or `"parse"`; omit otherwise
3. In tag/score revive: when `"phaseFailure" in parsed` and value is not `undefined`, set `checkpoint.phaseFailure = assertPhaseFailureSummary(p.phaseFailure)`.
4. Corrupt payloads must map through the existing download/load path to `checkpoint_missing` / error (same as corrupt draft) — **never** return a partial object that reaches Inspect.
5. Valid Feature 03 halt payloads must still round-trip.

### T1 (Medium) — datetime wrapper equivalence tests

Feature 02 Testing approach required wrapper equivalence; `web/src/__tests__/format-operator-datetime.test.ts` only covers `formatOperatorDate` / `formatOperatorDateTime`.

**Fix:** extend that file (preferred) to assert, for a fixed `SAMPLE_ISO`:

| Wrapper | Expected |
|---|---|
| `formatRunDateTime(SAMPLE_ISO)` from `web/components/runs/run-display.ts` | `=== formatOperatorDateTime(SAMPLE_ISO)` |
| `formatDeliveryIssueDate(SAMPLE_ISO)` from `web/components/delivery/delivery-display.ts` | `=== formatOperatorDate(SAMPLE_ISO)` |
| `formatPhasePublished(new Date(SAMPLE_ISO))` from `web/components/runs/inspect-article-list.tsx` | `=== formatOperatorDate(SAMPLE_ISO)` |

Optional but recommended: `formatUpdatedAt` from `web/components/domain-list/format-list-datetime.ts` ≡ `formatOperatorDateTime` if that re-export still exists.

Do not delete the existing direct `toLocale*` comparisons for the lib helpers.

### T2 (Medium) — domain pagination wrapper smoke

Feature 02 Testing approach required a domain-wrapper smoke in `domain-list-pagination.test.tsx`. That file only unit-tests `DomainListPagination`.

**Fix:** in `web/src/__tests__/domain-list-pagination.test.tsx`, add a case that renders production `FeedsPagination` (from `web/components/feeds/feeds-pagination.tsx`) with `total > 20` (e.g. page 1, totalPages 3, total 45) and asserts:

- `getByLabelText("Feeds pagination")` (nav aria-label from the thin wrapper)
- Status text matching the shared shell pattern: `Page 1 of 3 (45 feeds)` (or equivalent regex)

Mock `next/link` only if the suite already does; do not reimplement pagination logic in the test.

## Dependencies

- Builds on: **features 01–06 of this stage** (already `verified`).
- Anchor: `.ssc/reviews/review-stage-11-simplify-and-package-2026-07-29.md`.
- Redaction: `shared/src/util/log-redact.ts` → `redactMessageForStorage` (and `sanitizeAppwriteMessageForLog` for `/health` catch logs if used).
- Phase failure types: `PhaseFailureSummaryJson` / `PhaseArticleFailureJson` in `shared/src/runs/types.ts`.
- Feature 03 builders: `shared/src/runs/phase-failure-summary.ts`.
- Feature 06 docs/contracts: `docs/DEPLOY.md`, `deploy-documentation-smoke.test.ts`.

## Constraints

- **Do not reopen** features 01–06 status; this is additive hardening.
- **Keep** Feature 01 shared card shell and Stage 03 table/card responsive convention.
- **Keep** Feature 02 datetime pin (`dateStyle`/`timeStyle` short) and pagination threshold 20 / six thin domain wrappers.
- **Keep** Feature 03 enrichment Intent: operators still diagnose halt / empty-selection / full-suppress from stdout, `failureMessage`, and Inspect — redaction must not strip halt/count/sample signal into empty one-liners.
- **Keep** Feature 05 compose scope: exactly `web` + `worker`; Appwrite external; secrets via `env_file` / runtime, not Dockerfile `ARG` for API keys.
- **Keep** `/health` public and compose healthcheck on HTTP 200 — only shrink the **response body**.
- **Do not** add a Logs product, live tail, or new Runs-list badges.
- **Do not** spawn Appwrite/SMTP in compose.
- Secrets: never assert raw API keys in tests as expected visible output; use fake `sk-test…` / `Bearer …` fixtures that must **disappear** after redaction.

## Acceptance criteria

- [x] Any `phaseFailure.haltReason` written by `buildPhaseFailureSummary` has secrets redacted; Inspect summary and per-row errors re-redact on display; stdout does not log an unredacted pipeline haltReason; consecutive errors, failure count, and samples still appear. (S1)
- [x] Unauthenticated GET `/health` success body is exactly `{ "status": "ok" }` (no endpoint/project/authenticated/reachable); degraded is 503 with `{ "status": "degraded", "message": "Appwrite handshake failed" }` and no `appwrite` object; compose healthcheck still treats 200 as healthy; `docs/DEPLOY.md` + deploy-docs contract match the new smoke. (S2)
- [x] Malformed `phaseFailure` never reaches Inspect as a partial object; load fails via the existing corrupt-checkpoint path; valid halt payloads still round-trip. (C1)
- [x] `format-operator-datetime.test.ts` asserts sample-ISO equivalence for `formatRunDateTime`, `formatDeliveryIssueDate`, and `formatPhasePublished` against the canonical lib helpers. (T1)
- [x] `domain-list-pagination.test.tsx` includes a `FeedsPagination` smoke that asserts aria-label composition onto `DomainListPagination`. (T2)
- [x] `pnpm typecheck` and `pnpm lint` pass; shared + web tests covering touched paths pass.

## Files

- Modify: `shared/src/runs/phase-failure-summary.ts` — redact `haltReason` in `buildPhaseFailureSummary` (S1)
- Modify: `shared/src/runs/__tests__/phase-failure-summary.test.ts` — secret-in-haltReason cases (S1)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — tag/score halt fatal-outcome stdout: logged `haltReason` must not contain raw secrets when the pipeline haltReason did (S1)
- Modify: `shared/src/runs/execute-run.ts` — only if fatal-outcome still logs an unredacted pipeline `haltReason` (today it logs `phaseFailure.haltReason` from the builder — keep that; do not switch to raw `tagResult.haltReason` / `scoreResult.haltReason`) (S1)
- Modify: `web/components/runs/inspect-phase-failure.tsx` — display-time re-redact haltReason + errors (S1)
- Modify: `web/src/__tests__/inspect-phase-failure.test.tsx` — assert fake secrets not visible (S1)
- Modify: `web/app/health/route.ts` — minimal public bodies (S2)
- Create: `web/src/__tests__/health-route.test.ts` — success/degraded body shape + no disclosure fields (S2)
- Modify: `docs/DEPLOY.md` — smoke expectations for minimal `/health` (S2)
- Modify: `shared/src/pipeline/__tests__/deploy-documentation-smoke.test.ts` — contract for new smoke docs (S2)
- Modify (only if needed): `README.md` — remove old `/health` JSON example if present (S2)
- Modify (optional comment only): `compose.yaml` (S2)
- Modify: `shared/src/runs/repository.ts` — `assertPhaseFailureSummary` + tag/score revive (C1)
- Modify: `shared/src/runs/__tests__/phase-failure-summary.test.ts` and/or repository revive tests — malformed `phaseFailure` cases (C1)
- Modify: `web/src/__tests__/format-operator-datetime.test.ts` — wrapper equivalence (T1)
- Modify: `web/src/__tests__/domain-list-pagination.test.tsx` — FeedsPagination smoke (T2)

## Testing approach

Test-first where practical: add failing cases for S1/S2/C1/T1/T2, then implement.

1. **S1 unit** — `buildPhaseFailureSummary` with `haltReason` containing `sk-ant-api03-TESTSECRET` and `Bearer TESTTOKEN`: assert returned `haltReason` does not contain those substrings and does contain `[redacted]` (or the project’s redaction token); enrichment fields still present. Extend Inspect tests: render block with secretful haltReason/error → queryByText for raw secret is null.
2. **S1 stdout** — In `execute-run.test.ts`, drive a tag (or score) halt whose pipeline `haltReason` embeds a fake `sk-…` secret; spy `console.log` (or whatever structured logger the halt path already uses); assert the `fatal-outcome` payload’s `haltReason` does **not** contain the raw secret. This locks the third surface even if someone later logs `tagResult.haltReason` instead of `phaseFailure.haltReason`.
3. **S2 route** — mock `getServerAppwrite` / `Databases.list` success → 200 and body deep-equal `{ status: "ok" }`; failure → 503 body without `appwrite` / `endpoint` / `project` / `authenticated`. Contract: DEPLOY.md markers updated; suite fails if old nested example returns. Test file path is exactly `web/src/__tests__/health-route.test.ts`.
4. **C1** — revive/load helpers with `phaseFailure: { halted: true }` (no failures), `failures: null`, `failures: "oops"` → SyntaxError / checkpoint_missing path; happy-path round-trip with valid summary still passes.
5. **T1** — three wrapper equivalence assertions on fixed ISO.
6. **T2** — render **`FeedsPagination`** (not Runs) above threshold; aria-label `"Feeds pagination"` + status chrome.

Anti-cheat: do not `.skip` failing gates; do not weaken redaction tests to assert only message length.

## Tasks

### Task 1: Failing tests for S1 redaction + Inspect + stdout

- **Action**: Extend `shared/src/runs/__tests__/phase-failure-summary.test.ts` with haltReason secret fixtures that fail until builder redacts. Extend `web/src/__tests__/inspect-phase-failure.test.tsx` with display cases that fail until Inspect re-redacts (prefer red first). Extend `shared/src/runs/__tests__/execute-run.test.ts` with a halt case whose pipeline `haltReason` embeds a fake `sk-…` and assert the logged `fatal-outcome.haltReason` does not contain that secret (fail until builder redaction lands, if the log already reads `phaseFailure`).
- **Expected result**: New assertions exist and fail (or clearly target missing behavior) across builder, Inspect, and stdout.
- **Verify**:  
  `pnpm --filter @newsletter/shared exec vitest run src/runs/__tests__/phase-failure-summary.test.ts src/runs/__tests__/execute-run.test.ts`  
  and  
  `pnpm --filter @newsletter/web exec vitest run src/__tests__/inspect-phase-failure.test.tsx`  
  show the new cases red/failing for the right reason.
- **Depends on**: none.

### Task 2: Implement S1 haltReason redaction + Inspect re-redact

- **Action**: Update `buildPhaseFailureSummary` to redact non-null `haltReason`. Update `inspect-phase-failure.tsx` summary line + error cells to re-redact via `redactMessageForStorage`. Keep `execute-run.ts` fatal-outcome logging on `phaseFailure.haltReason` (builder output) — do not log raw `tagResult`/`scoreResult` haltReason. Fix any test wiring from Task 1.
- **Expected result**: S1 Acceptance Criteria met (persist + Inspect + stdout); Feature 03 enrichment still diagnosable.
- **Verify**: Task 1 suites green — including execute-run fatal-outcome secret absence; no raw `sk-` in haltReason assertions.
- **Depends on**: Task 1.

### Task 3: Failing tests for S2 minimal `/health` + docs contract

- **Action**: Create exactly `web/src/__tests__/health-route.test.ts` asserting success/degraded shapes and absence of disclosure fields (will fail on current route). Update `deploy-documentation-smoke.test.ts` expectations for the new DEPLOY smoke (will fail until docs change).
- **Expected result**: Route + docs contract tests fail for current code/docs.
- **Verify**: `web/src/__tests__/health-route.test.ts` fails on disclosure fields; deploy-docs test fails on old nested markers / missing new markers as designed.
- **Depends on**: none (can parallel Task 1 in spirit; sequential in execute).

### Task 4: Implement S2 minimal `/health` + update DEPLOY.md

- **Action**: Change `web/app/health/route.ts` to the pinned bodies. Rewrite `docs/DEPLOY.md` smoke section. Adjust README only if it embeds old JSON. Leave compose healthcheck status-code logic intact. Make Task 3 tests green.
- **Expected result**: Public probe no longer discloses Appwrite target or auth boolean; strangers can still verify alive via 200 + `"status":"ok"`.
- **Verify**: `pnpm --filter @newsletter/web exec vitest run src/__tests__/health-route.test.ts` and deploy-documentation-smoke tests green; S2 Acceptance Criteria met.
- **Depends on**: Task 3.

### Task 5: C1 assertPhaseFailureSummary + revive wiring

- **Action**: Implement `assertPhaseFailureSummary` and wire tag/score `reviveCheckpoint`. Add malformed revive tests (in phase-failure-summary and/or repository test file — follow existing revive test location). Keep happy-path round-trip green.
- **Expected result**: Poison `phaseFailure` cannot reach Inspect; valid halts still load.
- **Verify**: New malformed cases pass (clean failure); existing ser/de + Inspect tests green; C1 Acceptance Criteria met.
- **Depends on**: none (prefer after S1 so redacted fixtures remain valid shapes).

### Task 6: T1 + T2 Feature 02 test locks

- **Action**: Extend `format-operator-datetime.test.ts` with wrapper equivalence (T1). Extend `domain-list-pagination.test.tsx` with `FeedsPagination` aria-label smoke (T2).
- **Expected result**: Feature 02 Testing approach items locked.
- **Verify**:  
  `pnpm --filter @newsletter/web exec vitest run src/__tests__/format-operator-datetime.test.ts src/__tests__/domain-list-pagination.test.tsx`  
  green; T1 + T2 Acceptance Criteria met.
- **Depends on**: none.

### Task 7: Feature gate

- **Action**: Re-read this spec vs implementation; run typecheck/lint and touched test files; fix gaps. Update review report checkboxes only if the execute handoff asks — do not change feature 01–06 status.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**:  
  ```bash
  pnpm typecheck && pnpm lint && \
  pnpm --filter @newsletter/shared exec vitest run \
    src/runs/__tests__/phase-failure-summary.test.ts \
    src/runs/__tests__/execute-run.test.ts \
    src/pipeline/__tests__/deploy-documentation-smoke.test.ts && \
  pnpm --filter @newsletter/web exec vitest run \
    src/__tests__/inspect-phase-failure.test.tsx \
    src/__tests__/health-route.test.ts \
    src/__tests__/format-operator-datetime.test.ts \
    src/__tests__/domain-list-pagination.test.tsx
  ```
  (Include repository revive test paths if Task 5 added cases outside `phase-failure-summary.test.ts`.)
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: the Task 7 verify matrix (typecheck, lint, listed vitest files including `execute-run.test.ts` and `health-route.test.ts`).
- Expected: All green. Halt secrets redacted on persist/Inspect/stdout; public `/health` minimal; corrupt `phaseFailure` fails cleanly; datetime wrappers and `FeedsPagination` smoke locked. Features 01–06 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; haltReason redaction bound used (S1); execute-run fatal-outcome stdout assertion result and whether `execute-run.ts` needed a tweak (S1); exact `/health` success/degraded JSON (S2); docs/contract edits (S2); assertPhaseFailureSummary rules (C1); wrapper list asserted (T1); `FeedsPagination` smoke (T2); any deviation and why. Reference report: `.ssc/reviews/review-stage-11-simplify-and-package-2026-07-29.md`.

## Research notes

- `redactMessageForStorage` / `sanitizeAppwriteMessageForLog` live in `shared/src/util/log-redact.ts` and are exported from `@newsletter/shared`.
- `buildHaltFailureMessage` already redacts the combined string; S1 still requires redacting stored `haltReason` because Inspect and stdout read that field directly.
- Compose web healthcheck only checks HTTP status — body shrink does not break `podman compose ps` healthy.
- Validator Rejected review drafts N1/N2 (docs substring / compose build-args allowlist) as matching prescribed Feature 05/06 Testing approaches — **out of scope** for this hardening unless PM reopens them.
- Codegraph (2026-07-29): confirmed `buildPhaseFailureSummary` assigns raw `haltReason`; `InspectPhaseFailureBlock` renders it plain; `reviveCheckpoint` tag/score unguarded; `FeedsPagination` already passes `ariaLabel="Feeds pagination"`.
