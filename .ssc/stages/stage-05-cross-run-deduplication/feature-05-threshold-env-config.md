# Feature 05: Threshold env config

## Intent

Let the operator tune cross-run topic-suppression strictness via a documented project-root `.env` variable — no GUI and no code edit — so the next worker run after a restart uses the new similarity threshold.

## Spec

Document and pin the **operator-facing contract** for the Stage 05 similarity threshold that feature 03 already reads at suppress time. This feature owns **documentation + contract guards**, not the suppress algorithm.

### Env contract (locked by feature 03 — do not rename)

| Item | Value |
|------|--------|
| Env key | `CROSS_RUN_SIMILARITY_THRESHOLD` |
| Constant | `CROSS_RUN_SIMILARITY_THRESHOLD_ENV` in `shared/src/pipeline/config.ts` |
| Default | `0.85` (`DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD`) |
| Meaning | Cosine similarity on **title+tags** embeddings; candidates with max similarity **≥** threshold are hard-dropped before MMR |
| Valid range | Finite number clamped to **`[0, 1]`**; empty / NaN / non-finite → default `0.85` |
| Scope | Global (all newsletters). Per-newsletter lookback remains the only per-newsletter suppress control (feature 01). |
| GUI | **None** in V1 |

### What this feature delivers

1. **Create** project-root `.env.example` (gitignored `.env*` with `!.env.example` already in `.gitignore` — file does not exist yet).
   - Include placeholders for required secrets/config the operator already needs (`NEXT_PUBLIC_APPWRITE_*`, `APPWRITE_API_KEY`, `OPENROUTER_API_KEY`) as empty/placeholder values — **never** real secrets.
   - Add a clearly commented **Cross-run deduplication** section with:
     ```env
     # Cosine similarity (0–1) for cross-run topic suppress (title+tags).
     # Candidates at or above this value are hard-dropped before MMR. Default 0.85.
     # Higher = stricter (more suppressions). Lower = looser. Unset/invalid → 0.85.
     CROSS_RUN_SIMILARITY_THRESHOLD=0.85
     ```
   - Optional other knobs (`TAGGER_MODEL`, `WORKER_RUN_POLL_MS`, etc.) may appear as commented examples; they are **not** acceptance criteria for this feature. The threshold key **is**.

2. **Document** in root `README.md` a short **Environment** (or **Configuration**) section that states:
   - Copy `.env.example` → `.env` and fill secrets (if not already said).
   - `CROSS_RUN_SIMILARITY_THRESHOLD` — purpose, default `0.85`, range `[0,1]`, ≥ comparison, no GUI.
   - **Effectivity:** edit `.env`, then **restart the worker** (or recreate the compose `worker` service). The next run after restart uses the new value — no application code change. (Worker loads `.env` once at boot via `process.loadEnvFile`; compose injects `env_file` at container start. Do **not** claim hot-reload without restart.)

3. **Compose comment (optional polish):** extend the env comment block in `compose.yaml` to mention `CROSS_RUN_SIMILARITY_THRESHOLD` as an optional worker-consumed knob (still loaded via existing `env_file: .env`). Do not add a separate `environment:` hardcode that overrides the file.

4. **Contract guard tests** (see Testing approach): assert the documented key/default match feature 03’s exported constants + parse behavior, and that `.env.example` / README actually name the key. Do **not** re-implement suppress.

### Out of scope

- Re-implementing or changing `parseCrossRunSimilarityThreshold` / `getCrossRunSimilarityThreshold` / suppress algorithm (feature 03).
- Run-summary UI (feature 04).
- Lookback field or topic load (features 01–02).
- GUI for the threshold.
- Committing or rewriting the real `.env` (secrets); do not put live keys in `.env.example`.
- Hot-reloading env into a long-running worker without restart.
- LLM-as-judge / soft-penalty modes.

## Dependencies

- Builds on: **feature-03-pre-mmr-semantic-suppress** — env key, default `0.85`, clamp `[0,1]`, `getCrossRunSimilarityThreshold()` used at suppress time in `executeRun`. **Hard dependency:** `ssc-execute` this feature only after feature 03 is verified (Task 1 imports feature 03 exports).
- Soft: features 01–02–04 (lookback + visibility) — not required to verify this feature’s docs/guards.
- Orphaned by: none within Stage 05 once feature 03 exists.
- **Execute order:** `… → feature-03 → … → feature-05`.

## Constraints

- **No GUI** for the threshold.
- **Do not rename** `CROSS_RUN_SIMILARITY_THRESHOLD` or change the default away from `0.85` without an explicit PM decision (would break feature 03 + stage AC).
- **Do not** put real API keys or Appwrite secrets into `.env.example` or README.
- **Do not** change suppress / MMR / lookback / retention behavior in this feature.
- **Secrets:** never log full env dumps or API keys.
- Documentation must tell the operator to **restart the worker** after editing `.env` so the next run picks up the value.

## Acceptance criteria

- [ ] Project-root `.env.example` exists, is not gitignored (`!.env.example`), and documents `CROSS_RUN_SIMILARITY_THRESHOLD=0.85` with a short comment explaining purpose / default / higher=stricter.
- [ ] Root `README.md` documents the same key, default `0.85`, clamp/range `[0,1]`, that candidates at or **above** (`≥`) the threshold are suppressed, and that a worker restart is required for the next run to use a new value — without editing application code.
- [ ] Feature 03 exports still match the docs: `CROSS_RUN_SIMILARITY_THRESHOLD_ENV === "CROSS_RUN_SIMILARITY_THRESHOLD"`, `DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD === 0.85`, and `parseCrossRunSimilarityThreshold` still clamps invalid → `0.85` / out-of-range to `[0,1]`.
- [ ] No GUI control for the threshold; no suppress-algorithm changes; no real secrets in committed docs.
- [ ] `pnpm --filter @newsletter/shared test` (config + env-doc guards), `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass.

## Files

- Create: `.env.example`
- Create: `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts` (or extend `config.test.ts` — prefer a small dedicated docs-guard file so feature 05 ownership is clear)
- Modify: `README.md` (Environment / Configuration section)
- Modify (optional): `compose.yaml` (comment block only — list optional `CROSS_RUN_SIMILARITY_THRESHOLD`)
- Modify: `product_spec.md` (one-line Implemented features entry at handoff)
- Do **not** modify: `shared/src/pipeline/cross-run-suppress.ts`, `execute-run.ts`, or run-summary UI (unless a typo-only import path fix is required for the guard test)

## Testing approach

**Hybrid:** feature 03 already owns parse/getter unit tests. This feature adds **documentation contract guards** so a builder cannot “finish” by inventing a different key name in docs only, or by omitting `.env.example`.

### `cross-run-threshold-env-docs.test.ts` (or equivalent in `config.test.ts`)

1. **Constants match docs:** import `CROSS_RUN_SIMILARITY_THRESHOLD_ENV`, `DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD`, `parseCrossRunSimilarityThreshold` from pipeline config; assert env string is exactly `CROSS_RUN_SIMILARITY_THRESHOLD` and default is `0.85`.
2. **Parse smoke (regression):** `undefined` / `""` → `0.85`; `"0.9"` → `0.9`; `1.5` → `1`; `-0.1` → `0` (same contract as feature 03 — fails loudly if feature 03 not implemented yet).
3. **`.env.example` presence:** Resolve the **repo root by walking up from `import.meta.url`** until `pnpm-workspace.yaml` (or root `package.json` with workspaces) is found — **do not** use `process.cwd()` alone (`pnpm --filter @newsletter/shared test` runs with cwd = `shared/`). Then `fs.readFileSync` `.env.example`. Assert file exists and contains `CROSS_RUN_SIMILARITY_THRESHOLD` and `0.85`.
4. **`README.md` presence:** Same walk-up root resolution. Assert README contains `CROSS_RUN_SIMILARITY_THRESHOLD` and mentions restart (both `CROSS_RUN_SIMILARITY_THRESHOLD` and `/restart/i` appear in the file). Prefer also asserting a `≥` / “at or above” / “greater than or equal” signal so comparison direction is documented.

### Not required

- Playwright / PM GUI gate (no UI).
- Live compose restart e2e.
- Editing the real `.env`.

### Not test-first for prose quality

Wording of README comments is verifier-reviewed by reading the files; the automated guards only prove the key/default/restart signal exist. State this explicitly for the verifier.

## Tasks

### Task 1: Failing docs-guard tests

- **Action:** Add `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts` covering Testing approach cases 1–4. Include a small `findRepoRoot(fromUrl)` helper that walks up from `import.meta.url` to `pnpm-workspace.yaml`. Point assertions at repo-root `.env.example` and `README.md` so tests fail for the right reason (missing file / missing substring) once feature 03 exports exist.
- **Expected result:** Targeted Vitest run for that file exits non-zero on missing docs (not on cwd path bugs).
- **Verify:** `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/cross-run-threshold-env-docs` exits non-zero citing missing `.env.example` content and/or missing README substrings. Confirm the test resolves paths via walk-up (not bare `process.cwd()`).
- **Depends on:** **feature-03-pre-mmr-semantic-suppress** verified (exports `CROSS_RUN_SIMILARITY_THRESHOLD_ENV`, `DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD`, `parseCrossRunSimilarityThreshold`).

### Task 2: `.env.example` + README (+ optional compose comment)

- **Action:** Create `.env.example` with placeholder Appwrite/OpenRouter keys and the documented `CROSS_RUN_SIMILARITY_THRESHOLD=0.85` block per Spec. Add README Environment section covering key, default, range, ≥ semantics, no GUI, and worker restart for effectivity. Optionally extend `compose.yaml` header comments to list the optional var.
- **Expected result:** Docs-guard tests green; `.env.example` has no real secrets.
- **Verify:** Docs-guard test file green; `rg -n 'CROSS_RUN_SIMILARITY_THRESHOLD' .env.example README.md` shows matches; `git check-ignore -v .env.example` shows the `!.env.example` exception (file is tracked-eligible).
- **Depends on:** Task 1.

### Task 3: Regression + product_spec note

- **Action:** Run full `pnpm test`, `pnpm typecheck`, `pnpm lint`; fix fallout. Update `product_spec.md` Implemented features with one line for Stage 05 feature 05 threshold env documentation. Diff-check: no suppress/UI/lookback code changes beyond docs/tests.
- **Expected result:** Full suite green; product_spec updated.
- **Verify:** `pnpm test && pnpm typecheck && pnpm lint` — all zero. Diff limited to `.env.example`, `README.md`, optional `compose.yaml` comments, the docs-guard test, and `product_spec.md`.
- **Depends on:** Task 2.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/cross-run-threshold-env-docs src/pipeline/__tests__/config && pnpm test && pnpm typecheck && pnpm lint`
- Expected: Docs-guard tests prove `.env.example` + README document `CROSS_RUN_SIMILARITY_THRESHOLD` / `0.85` / restart; config constants + parse still match feature 03; full suite green; no GUI / no suppress algorithm edits.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified (`.env.example`, `README.md`, optional `compose.yaml`, docs-guard test, `product_spec.md`).
- Confirmation of test/typecheck/lint commands and results.
- Confirmation that `.env.example` contains no real secrets.
- Confirmation that README states worker restart is required for a new threshold to affect the next run.
- Confirmation that suppress/UI/lookback code was untouched.
- **Research note:** Feature 03 locks env key/default/clamp and reads `process.env` at suppress time. Worker boots with `process.loadEnvFile` on the nearest `.env`; compose uses `env_file: .env` at container start — so docs must say restart, not “edit and next run with zero ops.” `.gitignore` already allows `.env.example` via `!.env.example`. Stage AC: documented `.env` variable; changing it takes effect on the next run without editing application code.

## Locked decisions (from stage + feature 03)

1. **Env key:** `CROSS_RUN_SIMILARITY_THRESHOLD`.
2. **Default:** `0.85`; compare with **`>=`**; clamp **`[0, 1]`**.
3. **No GUI** in V1.
4. **Global** threshold (not per-newsletter).
5. **Docs + contract guards** in this feature; **read path** owned by feature 03.
6. **Worker restart** (or compose worker recreate) required after editing `.env` for the new value to apply.
7. **`.env.example` created** as the committed template; real `.env` stays local/gitignored.
