# Feature 01: Next.js + TypeScript project skeleton

## Intent
Establish the monorepo foundation every later stage stands on — a runnable TypeScript workspace where the web app boots, strict types are enforced, and the worker/shared packages exist as wired-in workspace members — so that from Feature 02 onward the only question is "does the feature work," never "does the project even run."

## Spec
A pnpm-workspace monorepo at the repo root with three packages: `web/` (a Next.js App Router app in TypeScript strict mode that boots and serves a placeholder home page), `shared/` (a workspace package exporting a trivial module, the future home of pipeline code written once and imported by both web and worker), and `worker/` (a workspace package with a placeholder entry that imports from `shared`, proving cross-package resolution; it does not boot as a long-running process in this feature). A shared `tsconfig.base.json` enforces TypeScript strict mode and is extended by each package. The project root `.env` (already present) is left untouched and is not read by any code in this feature. No lint, test, Appwrite, or worker-process functionality is added here — those are Features 04, 02, and 03 respectively.

## Dependencies
- None — first feature in the stage.

## Constraints
- The repo-root `.env` must not be modified or consumed by code in this feature (Appwrite wiring is Feature 02).
- No ESLint, Prettier, or Vitest configuration is introduced (Feature 04).
- The `worker/` package must not start a long-running process (Feature 03). It only exists as a wired workspace member with a placeholder entry.
- No newsletter-specific code, collections, or data.
- TypeScript `strict: true` is mandatory in the base config; no package may override it off.
- Node 22 LTS is the target runtime (recorded in `.nvmrc`); no use of features requiring a newer runtime.

## Acceptance criteria
- [ ] `pnpm install` at the repo root completes with no errors and recognizes `web/`, `worker/`, and `shared/` as workspace packages.
- [ ] `pnpm --filter web build` (or root `pnpm build`) succeeds.
- [ ] `pnpm --filter web dev` starts a dev server; opening the served URL shows the text "Newsletter Generator".
- [ ] `pnpm -r exec tsc --noEmit` (or root `pnpm typecheck`) passes with zero errors under strict mode across all three packages.
- [ ] `worker/` imports a symbol from `shared/` and its TypeScript compiles.
- [ ] `web/` imports a symbol from `shared/` and its build succeeds, proving cross-package resolution.
- [ ] `.nvmrc` specifies Node 22 LTS.
- [ ] No Appwrite, lint, test, worker-process, or newsletter code exists yet.

## Files
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (repo root, private workspace root)
- Create: `tsconfig.base.json` (repo root)
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.mjs`
- Create: `web/app/layout.tsx`
- Create: `web/app/page.tsx`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/src/index.ts`
- Modify: (none)

## Testing approach
This feature is scaffolding and configuration — it is genuinely not test-first. There is no behavior to express as a failing unit test that adding the skeleton would then make pass; the artifact IS the buildable, runnable project. Per SSC, this is stated explicitly.

Instead of unit tests, the verifier confirms correctness through executable evidence:
- **Build gate:** every package compiles and builds under strict TypeScript.
- **Resolution gate:** cross-package imports (`web`→`shared`, `worker`→`shared`) resolve at build time, proving the workspace wiring.
- **Runtime smoke check:** the web dev server boots and the home page renders the expected text.

Edge cases covered by the verification:
- Strict mode actually bites (a deliberately loose type in any package fails the typecheck gate).
- Workspace is real, not three unrelated folders (deleting `shared/src/index.ts` breaks both `web` and `worker` builds).

## Tasks

### Task 1: Scaffold pnpm workspace and base config
- **Action:** Create `pnpm-workspace.yaml` listing `web`, `worker`, `shared`. Create a private root `package.json` with workspace-aware scripts (`dev`, `build`, `typecheck`) that delegate to packages via `pnpm -r` / `--filter`. Create `tsconfig.base.json` with `strict: true` and sensible compiler options for the stack. Create `.nvmrc` containing the Node 22 LTS version string. Create `.gitignore` covering `node_modules`, `.next`, build output, and `.env`.
- **Expected result:** A repo root that `pnpm` recognizes as a workspace root, with shared base config and scripts in place. No packages exist yet.
- **Verify:** Run `pnpm install` at the repo root — exits 0 with no resolution errors. Confirm `pnpm-workspace.yaml` lists the three packages. Confirm `cat .nvmrc` shows a Node 22 LTS version and `tsconfig.base.json` contains `"strict": true`.
- **Depends on:** none.

### Task 2: Create the `web/` Next.js package
- **Action:** Create `web/package.json` (Next.js + React + TypeScript dev deps, scripts for `dev`/`build`/`typecheck`). Create `web/tsconfig.json` extending the root `tsconfig.base.json` with Next.js's required options and JSX settings. Create `web/next.config.mjs`. Create `web/app/layout.tsx` (root layout) and `web/app/page.tsx` rendering the text "Newsletter Generator" and nothing else.
- **Expected result:** A standalone Next.js App Router app in strict TypeScript that builds and serves a placeholder home page.
- **Verify:** Run `pnpm --filter web build` — succeeds. Run `pnpm --filter web dev`, open the printed localhost URL, confirm the page displays "Newsletter Generator". Run `pnpm --filter web exec tsc --noEmit` — passes with zero errors.
- **Depends on:** Task 1.

### Task 3: Create `shared/` and `worker/` packages, wire cross-package imports
- **Action:** Create `shared/package.json` (name e.g. `@newsletter/shared`, with a `src/index.ts` entry and `types`/`main` fields) and `shared/tsconfig.json` extending the base config. Put one trivial exported symbol in `shared/src/index.ts` (e.g. an exported constant or function). Create `worker/package.json` (name e.g. `@newsletter/worker`) and `worker/tsconfig.json` extending the base config. Create `worker/src/index.ts` that imports the symbol from `@newsletter/shared` and references it (proving resolution); it must NOT start a server, loop, or any long-running process. Add `@newsletter/shared` as a workspace dependency to both `web` and `worker` (`pnpm --filter web add @newsletter/shared`, etc., or via `workspace:*` in package.json). Add an import of the shared symbol somewhere in `web/` (e.g. referenced from the page or a small module) so web→shared resolution is exercised at build time.
- **Expected result:** Three wired workspace packages. `web` and `worker` both resolve and use a symbol from `shared`. The worker does not run as a process.
- **Verify:** Run `pnpm install` — workspace links resolve with no errors. Run `pnpm --filter web build` — succeeds, proving web→shared resolution. Run `pnpm --filter worker exec tsc --noEmit` — passes, proving worker→shared resolution. Confirm `worker/src/index.ts` contains no `setInterval`/server/listen/keep-alive call.
- **Depends on:** Task 2.

### Task 4: Root convenience scripts and end-to-end check
- **Action:** Finalize root `package.json` scripts so `pnpm dev` runs the web dev server, `pnpm build` builds all packages (`pnpm -r build`), and `pnpm typecheck` runs `tsc --noEmit` across all packages. Ensure a clean-install path works: remove install artifacts, reinstall, and rebuild.
- **Expected result:** A single set of root commands that drive the whole workspace.
- **Verify:** From a clean state (`rm -rf node_modules web/.next web/node_modules worker/node_modules shared/node_modules` then `pnpm install`): `pnpm typecheck` passes across all three packages; `pnpm build` succeeds; `pnpm dev` starts the web server and the home page shows "Newsletter Generator".
- **Depends on:** Task 3.

## Feature verification
- Run: `pnpm install && pnpm typecheck && pnpm build && pnpm dev`
- Expected: Install resolves cleanly; typecheck passes with zero errors under strict mode across `web`, `worker`, and `shared`; build succeeds for all packages; the dev server starts and the home page at the printed URL renders the text "Newsletter Generator". No Appwrite code, lint/test tooling, worker process, or newsletter data exists anywhere in the tree.

## Handoff
When complete, the builder reports to the manager:
- The full list of files created (workspace config, three packages, base TS config, `.nvmrc`, `.gitignore`).
- Confirmation that `pnpm install`, `pnpm typecheck`, `pnpm build`, and `pnpm dev` all succeed from a clean state.
- The exact versions of pnpm, Node, Next.js, React, and TypeScript used.
- The names chosen for the workspace packages (e.g. `@newsletter/shared`) so later features can import them consistently.
- Any deviation from this spec and the reason (e.g. a config option Next.js required that wasn't anticipated).
