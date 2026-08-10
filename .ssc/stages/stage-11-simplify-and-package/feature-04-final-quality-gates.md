# Feature 04: Final quality gates

## Intent

Make typecheck, lint, tests, and production build green so an honest V1 “ship it” call is grounded in runnable gates — not tribal confidence — before packaging and deploy docs.

## Spec

After Features 01–03 are verified, run a **final quality-gate pass** and fix every ship-blocking failure. No new product capabilities. No operator-visible behavior changes except those required to restore intentional, already-specified behavior that tests prove drifted (or to correct tests that assert the wrong strings / time-frozen fixtures).

### Required gates (must all exit 0)

| Gate | Command | Notes |
|------|---------|--------|
| Typecheck | `pnpm typecheck` | `pnpm -r exec tsc --noEmit` across workspaces. |
| Lint | `pnpm lint` | `eslint .` from repo root. Benign `pages/` warning from leftover `eslint-config-next` Pages-router noise is **allowed** (AGENTS.md) — do not treat stdout warning alone as failure when exit code is 0. |
| Tests | `pnpm test` | Root `vitest run` over web/worker/shared (see `vitest.config.ts`). |
| Build | `pnpm build` | Production build across workspaces — required for an honest ship call ahead of Feature 05 packaging. |

### Out of scope (not hard gates for this feature)

- **`pnpm format:check` / Prettier rewrite** — Research (2026-07-27) shows ~115 files failing Prettier; Stage 11 acceptance criteria do **not** require format green. Do not mass-format the repo in this feature. Touch formatting only on files already edited to fix a gate failure, and only if needed for consistency with nearby code.
- **Knip / unused-export tooling** — Owned by Feature 02 as a one-shot; not a Feature 04 gate.
- **CI workflow authoring** — No GitHub Actions / CI config required here.
- **Compose / Docker / `.env.example` / deploy docs** — Features 05–06.
- **New product surfaces, nav, pipeline semantics, auth gates.**

### Fix policy

1. **Prefer fixing the product** when a test correctly describes Intent-level behavior and production is wrong.
2. **Prefer fixing the test** when the assertion is stale (wrong label casing, absolute ISO dates that fall out of a rolling window, brittle regex vs Title Case UI helpers).
3. **No skips / `.skip` / deleted coverage** to greenwash a gate — unless the test file itself was Feature 02 delete-bucket inventory (already gone) or the assertion duplicates a stronger existing test and the handoff justifies removal.
4. **No expanding into Feature 01/02 cleanup** (list DRY, knip, datetime consolidate) unless a gate failure is caused by incomplete migration left by those features — then fix the breakage only.

### Starting failure inventory (research baseline, 2026-07-27)

Re-baseline after Features 01–03; this inventory is the known pre-F01/F02 ship blockers:

| Suite | Symptom | Likely cause (research) |
|-------|---------|-------------------------|
| `web/src/__tests__/runs-trigger-label.test.tsx` — Inspect meta cases | Regex expects lowercase `completed` / `failed` | UI uses `formatRunStatusLabel` → `"Completed"` / `"Failed"`. Update assertions to Title Case (or call `formatRunStatusLabel`) — not a product regression. |
| `web/src/__tests__/dashboard-home-load.test.tsx` — delivery attention reuse + fallback | Cannot find link `/1 delivery failure/i` | Fixture `STARTED_AT = "2026-07-20T…"` falls outside the rolling 7-day attention window when wall clock is ≥7 days later (`computeAttentionCounts` / `isWithinRecentWindow`). Fix with relative timestamps and/or `vi.setSystemTime` so the window stays stable. |

Typecheck and lint were green at research time; `pnpm build` succeeded. Features 01–03 may introduce new failures — those become in-scope for this feature.

### Research note

- Gate scripts: root `package.json` (`typecheck`, `lint`, `test`, `build`); Vitest root config includes `web/**`, `worker/**`, `shared/**`.
- Inspect meta: `InspectShell` renders `{newsletterName} · {formatRunStatusLabel(status)} · {triggerLabel} · {dateLabel}`.
- Dashboard attention: `web/app/(protected)/page.tsx` reuses `selectFailedDeliveryIssues(allIssues)` then `computeAttentionCounts` (7-day window on `endedAt ?? startedAt`).
- Tools: live `pnpm typecheck` / `lint` / `test` / `build` + codegraph on InspectShell / dashboard-data (2026-07-27).

## Dependencies

- Builds on: **feature-01-shared-list-ui-dry** (list DRY must be verified first), **feature-02-dead-code-consistency-sweep** (interim gate), **feature-03-phase-failure-observability** (failure detail before ship gates; Feature 04 is the stage’s final ship gate).
- Stage 10 complete.

## Constraints

- No new product behavior or operator-facing copy/layout/URL changes except restoring already-specified behavior proven by tests.
- Do not mass-run Prettier across the repo.
- Do not add knip/CI as permanent gates.
- Do not treat the benign eslint `pages/` warning as a failure when exit code is 0.
- Do not change Stage 01–09 pipeline semantics or Appwrite schema.
- Preserve Stage 03 responsive list convention (do not regress Feature 01).

## Acceptance criteria

- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm lint` exits 0 (benign `pages/` warning allowed).
- [ ] `pnpm test` exits 0 with no skipped-to-greenwash suites introduced by this feature.
- [ ] `pnpm build` exits 0.
- [ ] Known baseline failures in `runs-trigger-label.test.tsx` and `dashboard-home-load.test.tsx` are resolved (or superseded by equivalent coverage if files move) — no wall-clock-fragile absolute dates for the 7-day attention window; Inspect meta asserts Title Case status labels.
- [ ] Handoff lists any additional failures found after Features 01–03 and how they were fixed.
- [ ] No Feature 05–06 packaging/docs work landed under this feature id.

## Files

- Modify (expected): `web/src/__tests__/runs-trigger-label.test.tsx`
- Modify (expected): `web/src/__tests__/dashboard-home-load.test.tsx`
- Modify (as needed): production files only if a gate proves real drift (e.g. dashboard attention wiring) — paths discovered at execute time; prefer minimal diffs
- Modify (as needed): any files broken by Features 01–03 migrations that fail typecheck/lint/test/build
- Test: existing suites above (update); add a small focused test only if a production fix needs a lock that the existing cases do not cover
- Do **not** create: CI workflows, knip config, format scripts, compose/Docker changes

## Testing approach

**Not classic test-first product work** — this feature’s “tests” are the monorepo gates themselves. Verifier confirms correctness by green commands, not by new Intent-level product suites.

1. **Baseline** — After Features 01–03 are verified, run all four required gates; record failures in the handoff (update the research inventory).
2. **Fix loop** — For each failure: apply the Fix policy; re-run the failing file/package then the full gate.
3. **Time-window hygiene** — Dashboard attention tests must not depend on wall clock vs a fixed ISO older than 7 days. Prefer `vi.setSystemTime` to a pinned “now” with fixtures inside the window, or `new Date(Date.now() - …)` relative fixtures.
4. **Label hygiene** — Inspect/Runs status assertions must match `formatRunStatusLabel` (Title Case), not raw status enums.
5. **Anti-cheat** — Verifier rejects new `.skip` / `xit` / `xdescribe` greenwashing anywhere in this feature’s diff, empty tests, or deleted failing tests without an Intent-preserving replacement or Feature 02 delete-bucket justification. Vitest exits 0 with skips — exit code alone is not enough.

Edge cases: timezone/`toLocaleDateString` in Inspect meta — continue deriving expected date via the same options as production (or shared helper after Feature 02); do not hardcode `3/15/26`. Lint warning with exit 0 is pass. Format failures alone are not fail.

## Tasks

### Task 1: Post-F01/F02/F03 gate baseline

- **Action**: From repo root, run **all four** required gates — `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` — each to completion (or until that command’s hard failure is recorded). Capture exit code + failing suites/errors per command in the working notes for Task 2+. Confirm Features 01–03 are already `verified` in `.ssc/ssc-state.json` before treating this baseline as final. If an early gate is so broken that a later gate is unusable noise (rare), still *attempt* it and note “unusable after \<gate\> failure: \<reason\>” in the inventory — do not skip attempting a gate silently.
- **Expected result**: Written inventory covering all four gates (pass/fail + blockers; may match or exceed the research table).
- **Verify**: Transcripts (or logged exit codes) exist for **typecheck, lint, test, and build** — all four attempted. “At least one ran” is **not** sufficient. If all four already pass, Task 2 becomes a no-op confirmation pass and Task 3 still re-runs the full matrix.
- **Depends on**: none (assumes Features 01–03 verified).

### Task 2: Fix ship-blocking test (and any compile/lint) failures

- **Action**: Resolve every failure from Task 1 under the Fix policy. Minimum expected from research inventory:
  1. Update `web/src/__tests__/runs-trigger-label.test.tsx` Inspect meta expectations to Title Case status labels via `formatRunStatusLabel` (or equivalent literals `"Completed"` / `"Failed"`).
  2. Stabilize `web/src/__tests__/dashboard-home-load.test.tsx` delivery-attention cases against the 7-day window (fake timers and/or relative dates) so `"1 delivery failure"` still appears when fixtures intend a failure inside the window; keep reuse vs `listDeliveryIssues` fallback assertions.
  Fix any additional F01/F02/F03 fallout the same way. Do not mass-format; do not start Feature 05 work. Do not add `it.skip` / `describe.skip` / `test.skip` / `xit` / `xdescribe` to greenwash failures.
- **Expected result**: Previously failing suites pass in isolation; no new skip greenwashing.
- **Verify**:
  ```bash
  pnpm exec vitest run web/src/__tests__/runs-trigger-label.test.tsx web/src/__tests__/dashboard-home-load.test.tsx
  ```
  exits 0 (plus any other files touched by this task, listed in the verify command). Repo-wide skip anti-cheat is enforced in Task 3 / Feature verification — do not rely on these two files alone.
- **Depends on**: Task 1.

### Task 3: Full required gate matrix

- **Action**: Re-run all four required gates; fix any remaining failures under the same policy until green. Before handoff, confirm this feature did not introduce skip greenwashing (see Verify).
- **Expected result**: Typecheck, lint, test, and build all exit 0; no new skip directives added to silence failures.
- **Verify**:
  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
  all succeed. Benign eslint `pages/` warning may appear; exit code must still be 0.

  **Skip anti-cheat (required):** Against the pre-feature base (merge-base with the branch tip before this feature’s edits, or `git stash` / recorded HEAD from Task 1 start — document which in the handoff), confirm no *new* skip greenwashing:
  ```bash
  git diff --unified=0 <pre-feature-ref> -- '**/*.{ts,tsx,js,jsx}' | \
    rg -n '^\+.*(it|test|describe)\.skip\(|^\+\s*(xit|xdescribe)\('
  ```
  Expected: empty. If a skip line must remain for a justified reason (should be rare / none for this feature), the handoff lists each path + rationale and the verifier confirms it is not hiding a Task 1 failure.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- Expected: All four succeed. Additionally:
  - `runs-trigger-label` Inspect cases pass with Title Case status labels.
  - `dashboard-home-load` delivery attention reuse + fallback cases pass without depending on wall-clock vs a stale absolute ISO.
  - Skip anti-cheat diff from Task 3 Verify is empty (or every hit justified in handoff).
  - No new permanent knip/format/CI gate scripts added for this feature.
  - No compose/Docker/deploy-doc files introduced under this feature.

## Handoff

Builder reports: baseline inventory after Features 01–03 (all four gates attempted + exit codes); each failure fixed (product vs test) with file paths; confirmation all four gates are green; skip anti-cheat `pre-feature-ref` used + result; note that Prettier `format:check` was left out of scope if still failing; any deviations and why.
