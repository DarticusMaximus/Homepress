# Feature 04: Test runner + lint

## Intent
Establish the project's quality gates — a working test runner (Vitest) with a trivial green test, and ESLint + Prettier configured and passing on the whole monorepo — so every feature from here on can be test-first by default and the verifier has a consistent `pnpm test` / `pnpm lint` contract to gate against.

## Spec
Vitest is configured at the workspace root with a project/workspacespaces setup so tests in any package (`web`, `worker`, `shared`) are discovered and run together. A single trivial passing test exists in `shared/` (the package with the most testable pure logic so far) proving the runner works end-to-end. ESLint is configured at the root with a flat config (ESLint 9+) using the TypeScript ESLint and Next.js presets, with Prettier integrated (via `eslint-config-prettier`) so lint and format do not conflict. Prettier is configured via a root `.prettierrc`. Root scripts `test`, `lint`, and `format` drive the tools across all packages. All existing skeleton code (features 01–03) passes lint with zero errors and the test suite is green.

## Dependencies
- Builds on: feature-01 (workspace structure and root scripts), and implicitly features 02–03 (the code that lint must pass cleanly on).

## Constraints
- Do not change the runtime behavior of existing features 01–03; only add tooling and config.
- ESLint must use flat config (`eslint.config.js`/`.mjs`); legacy `.eslintrc` is not acceptable.
- Prettier and ESLint must not fight — `eslint-config-prettier` must be last in the config chain.
- Vitest config must not require a live Appwrite instance or network to run the trivial test (pure unit test only).
- `pnpm lint` must exit non-zero on any error; warnings are acceptable but should be near-zero on the existing skeleton.
- Do not introduce a CI pipeline (out of scope for this stage).

## Acceptance criteria
- [ ] `pnpm test` runs Vitest and exits 0 with at least one passing test.
- [ ] `pnpm lint` runs ESLint across all packages and exits 0 with zero errors on the existing skeleton.
- [ ] `pnpm format` runs Prettier (check or write) consistently across the repo.
- [ ] A trivial passing test exists in `shared/` and is discovered by the root Vitest config.
- [ ] ESLint uses flat config (`eslint.config.mjs` at root); no `.eslintrc*` files exist.
- [ ] A deliberately failing test (temporarily) causes `pnpm test` to exit non-zero — proving the gate is real.
- [ ] A deliberately lint-erroring file (temporarily) causes `pnpm lint` to exit non-zero.
- [ ] `.prettierrc` exists at root and is respected by `pnpm format`.

## Files
- Create: `vitest.config.ts` (workspace root)
- Create: `eslint.config.mjs` (workspace root)
- Create: `.prettierrc` (workspace root)
- Create: `.prettierignore` (workspace root)
- Create: `shared/src/__tests__/smoke.test.ts`
- Modify: `package.json` (root — add `test`, `lint`, `format` scripts and dev deps)
- Modify: `web/package.json`, `worker/package.json`, `shared/package.json` (add per-package `lint`/`test` scripts if the root delegates per-filter; otherwise note root-only)
- Test: `shared/src/__tests__/smoke.test.ts` (the trivial test itself)

## Testing approach
This feature IS the test infrastructure, so it is naturally test-first in a bootstrapping sense: the trivial test is written and the runner is proven when it goes green. The meta-verification (that `test` and `lint` are real gates) is covered by the negative-path acceptance criteria: a forced failure must flip each command's exit code.

- **Runner gate:** `pnpm test` green with the smoke test; flipping the assertion red makes it exit non-zero.
- **Lint gate:** `pnpm lint` green on existing code; introducing a known error (e.g. an unused var with `no-unused-vars` as error) flips it non-zero.
- **Format gate:** `pnpm format --check` (or equivalent) passes on all files.

## Tasks

### Task 1: Vitest workspace config + smoke test
- **Action:** Add `vitest` as a root dev dependency. Create `vitest.config.ts` at the root using Vitest's workspace/projects support so tests under `web/`, `worker/`, and `shared/` are discovered (e.g. `projects` matching each package's `**/*.test.ts`, or a root `include` glob). Create `shared/src/__tests__/smoke.test.ts` containing one trivial assertion (e.g. `expect(1 + 1).toBe(2)` and/or an import-and-call test against `@newsletter/shared`'s existing exported symbol from feature-01). Add a root `test` script (`vitest run`) and a `test:watch` script.
- **Expected result:** `pnpm test` discovers and runs the smoke test and exits green.
- **Verify:** `pnpm test` exits 0 and output shows the smoke test passing. Then temporarily change the assertion to `toBe(3)`, re-run, confirm non-zero exit, then revert.
- **Depends on:** feature-01 complete.

### Task 2: ESLint flat config + Prettier
- **Action:** Add `eslint` (v9+), `typescript-eslint`, `eslint-config-next`, `eslint-config-prettier`, and `prettier` as root dev deps. Create `eslint.config.mjs` (flat config) composing: `typescript-eslint` recommended config, Next.js config scoped to `web/`, and `eslint-config-prettier` last. Set sensible rules (e.g. `no-unused-vars` as error, but relax any rule that fights Next.js conventions). Create `.prettierrc` (consistent style — e.g. semi true, single quotes, 2-space) and `.prettierignore` (covering `node_modules`, `.next`, build output, `.ssc`). Add root `lint` (`eslint .`) and `format` (`prettier --write .`) scripts plus `format:check` (`prettier --check .`).
- **Expected result:** A flat ESLint config and Prettier config that agree, with root scripts to drive them.
- **Verify:** `pnpm lint` exits 0 with zero errors on the existing skeleton. `pnpm format:check` exits 0 (run `pnpm format` first if any files need formatting, then confirm check passes). Then add a file with `const _x = 1;` and an unused var flagged as error, re-run `pnpm lint`, confirm non-zero exit, then remove the file.
- **Depends on:** Task 1 (so the test file itself is also lint-clean).

### Task 3: Verify all gates pass clean from a fresh install
- **Action:** Ensure every package's existing code (features 01–03) is lint-clean and formatted. Add per-package `lint`/`test` scripts where helpful, or document that the root commands cover all packages. Run the full suite from a clean install.
- **Expected result:** A clean baseline where `pnpm install && pnpm lint && pnpm test && pnpm format:check` all pass.
- **Verify:** From clean state: `pnpm install`, `pnpm lint` (0 errors), `pnpm test` (green), `pnpm format:check` (clean). Confirm no `.eslintrc*` files exist anywhere. Confirm the smoke test in `shared/` is the only test and it passes.
- **Depends on:** Task 2.

## Feature verification
- Run: `pnpm install && pnpm lint && pnpm test && pnpm format:check`
- Expected: All four pass — install resolves, ESLint reports zero errors across `web`/`worker`/`shared`, Vitest runs and the smoke test passes, and Prettier reports all files formatted. The negative paths (forced test failure, forced lint error) each flip the respective command's exit code to non-zero, confirming the gates are real.

## Handoff
When complete, the builder reports to the manager:
- Files created/modified (Vitest config, ESLint flat config, Prettier config, smoke test, root scripts, per-package scripts if added).
- Exact versions of `vitest`, `eslint`, `typescript-eslint`, `eslint-config-next`, `eslint-config-prettier`, and `prettier`.
- Confirmation that `pnpm lint`, `pnpm test`, and `pnpm format:check` all pass on the existing skeleton.
- Confirmation of the negative-path checks (forced test failure and forced lint error each exit non-zero).
- Any rules relaxed and why (e.g. a Next.js convention that conflicted with the TS recommended set).
- Any deviation from this spec and the reason.
