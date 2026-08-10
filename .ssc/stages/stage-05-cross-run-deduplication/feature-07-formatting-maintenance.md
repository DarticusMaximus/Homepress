# Feature 07: Formatting maintenance

## Intent

Restore a trustworthy repository-wide formatting gate so maintainers can identify new style regressions without 171 pre-existing warnings obscuring the result.

## Spec

Format every currently Prettier-selected maintained project file using the repository's existing Prettier 3.9.1 configuration. Update `.prettierignore` to exclude the generated newsletter archive under `output/`, the legacy `newsletters.yaml` configuration, and the IDE-owned `.cursor/` and `.opencode/` directories. None of these paths is maintained application source. Do not ignore active source, tests, or project documentation. Preserve behavior and text meaning: this feature changes only Prettier-controlled presentation and the four documented ignore rules. The existing `format` and `format:check` scripts and `.prettierrc` settings remain unchanged.

## Dependencies

- Builds on: feature-06-hardening-review-2026-07-13, which left Stage 05's source and quality gates at their current baseline.

## Constraints

- Do not change application logic, test assertions, public APIs, schemas, dependencies, package scripts, or `.prettierrc`.
- Add exactly four `.prettierignore` entries: `output/`, `newsletters.yaml`, `.cursor/`, and `.opencode/`.
- Do not add ignore entries for maintained source, tests, or `product_spec.md`.
- The generated file `output/Tech Trench-2026-07-01.md`, legacy `newsletters.yaml`, and IDE-owned `.cursor/` and `.opencode/` paths must not be reformatted.
- Preserve all file content except changes made by the existing Prettier configuration.

## Acceptance criteria

- [ ] `.prettierignore` ignores `output/`, `newsletters.yaml`, `.cursor/`, and `.opencode/`, and no other new path.
- [ ] `pnpm exec prettier --file-info "output/Tech Trench-2026-07-01.md"`, `pnpm exec prettier --file-info newsletters.yaml`, `pnpm exec prettier --file-info .cursor/skills/ssc-spec/SKILL.md`, and `pnpm exec prettier --file-info .opencode/skills/ssc-spec/SKILL.md` each report `"ignored": true`.
- [ ] All maintained files that the initial `pnpm format:check` baseline reported are formatted with the unchanged repository configuration.
- [ ] `pnpm format:check` exits zero and reports no formatting warnings.
- [ ] `pnpm typecheck` and `pnpm lint` exit zero after formatting.
- [ ] The generated archive, legacy YAML, IDE directories, Prettier configuration, and package scripts are unchanged except for the four `.prettierignore` rules.

## Files

- Modify: `.prettierignore`
- Modify: `shared/src/**/*.{ts,html}`
- Modify: `web/**/*.{ts,tsx}`
- Modify: `worker/src/**/*.ts`
- Modify: `product_spec.md`
- Do not modify: `output/Tech Trench-2026-07-01.md`
- Do not modify: `newsletters.yaml`
- Do not modify: `.cursor/**/*`
- Do not modify: `.opencode/**/*`
- Do not modify: `.prettierrc`
- Do not modify: `package.json`
- Test: repository formatting, typecheck, and lint commands only; no test file is created.

## Testing approach

This is not test-first because it changes no runtime behavior and creates no implementation that unit tests could meaningfully exercise. Verification is command-driven: Prettier's `--file-info` confirms all four intentional exclusions, `pnpm format:check` verifies every maintained Prettier-selected file, and the existing typecheck and lint gates confirm that mechanical formatting caused no repository regression. The baseline before this spec was `pnpm format:check` reporting 171 files; it must not be accepted merely because warnings were hidden by an ignore rule outside the four listed paths.

## Tasks

### Task 1: Establish the maintained formatting scope

- **Action**: In `.prettierignore`, add `output/` under the generated-artifact section; add `newsletters.yaml` under the legacy-reference section; and add `.cursor/` plus `.opencode/` under a new IDE-artifacts section. Do not add any other ignore entry. Run `pnpm format:check` once before formatting to retain the baseline scope, then run `pnpm exec prettier --file-info` for `output/Tech Trench-2026-07-01.md`, `newsletters.yaml`, `.cursor/skills/ssc-spec/SKILL.md`, and `.opencode/skills/ssc-spec/SKILL.md` after the ignore edit.
- **Expected result**: The four excluded paths report `"ignored": true`; all application code, tests, and maintained project documentation remain eligible for Prettier.
- **Verify**: Inspect the `.prettierignore` diff to confirm the only additions are `output/`, `newsletters.yaml`, `.cursor/`, and `.opencode/`; all four `--file-info` commands output JSON containing `"ignored": true`.
- **Depends on**: none.

### Task 2: Apply the existing Prettier configuration

- **Action**: Run `pnpm format` from the repository root. Limit resulting edits to `shared/src/**/*.{ts,html}`, `web/**/*.{ts,tsx}`, `worker/src/**/*.ts`, and `product_spec.md`, plus `.prettierignore` from Task 1. Review the diff to ensure changes are mechanical formatting only.
- **Expected result**: Every maintained file from the initial Prettier baseline is rewritten to conform to the existing `.prettierrc`; `output/Tech Trench-2026-07-01.md`, `newsletters.yaml`, `.cursor/`, and `.opencode/` remain unchanged.
- **Verify**: Run `pnpm format:check`; it exits zero with no `[warn]` file entries. Inspect `git diff --check` and the changed-file list to confirm no file outside the listed scope changed and no generated, legacy, or IDE-owned artifact was rewritten.
- **Depends on**: Task 1.

### Task 3: Run repository regression gates

- **Action**: Run `pnpm typecheck` and `pnpm lint`. If either command finds formatting-related fallout, correct it only through the existing Prettier configuration and rerun the affected gate; do not alter behavior to make a gate pass.
- **Expected result**: The project remains type-safe and lint-clean after the mechanical formatting cleanup.
- **Verify**: `pnpm format:check && pnpm typecheck && pnpm lint` exits zero.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm exec prettier --file-info "output/Tech Trench-2026-07-01.md" && pnpm exec prettier --file-info newsletters.yaml && pnpm exec prettier --file-info .cursor/skills/ssc-spec/SKILL.md && pnpm exec prettier --file-info .opencode/skills/ssc-spec/SKILL.md && pnpm format:check && pnpm typecheck && pnpm lint`
- Expected: Each `--file-info` response contains `"ignored": true`; formatting, typecheck, and lint all exit zero with no Prettier warnings. The final diff contains only `.prettierignore`'s four ignore rules and mechanical Prettier output in the Files section's maintained paths.

## Handoff

When complete, the builder reports the exact changed-file count and path list; the four `.prettierignore` entries added; the `--file-info` results for every excluded path; and the exit status of `pnpm format:check`, `pnpm typecheck`, and `pnpm lint`. Report any non-mechanical or out-of-scope diff immediately rather than accepting it. Research note: Context7 `/prettier/prettier` query on Prettier CLI `--check`, `--write`, `.prettierignore`, and `--file-info` confirmed that repository-wide checks use ignore files and that `--file-info` is the concrete way to verify an intentional exclusion.
