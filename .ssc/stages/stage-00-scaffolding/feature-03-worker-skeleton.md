# Feature 03: Worker process skeleton

## Intent
Stand up the long-running background process that later stages hand slow jobs to — a worker that boots as its own process, stays alive observably, shuts down gracefully, and exposes a job-handler registry hook that stage 03 fills in — so the web app never has to block on long-running work and stage 03 has a clear, tested seam to plug real jobs into.

## Spec
A Node/TypeScript entrypoint in `worker/src/index.ts` boots a long-running process. On startup it logs a structured line, initializes the Appwrite server client from `@newsletter/shared` (proving shared infra is reachable from the worker), registers an empty job-handler registry (a `Map<string, JobHandler>` exposed via `registerJob(name, handler)` and `getJob(name)` helpers, with no handlers registered yet), and enters a heartbeat loop that logs a liveness line on a fixed interval (default 30s, configurable via `WORKER_HEARTBEAT_MS`). It installs `SIGTERM` and `SIGINT` handlers that log a shutdown line, clear the heartbeat, and exit cleanly with code 0 so Feature 05's podman `stop`/restart behaves correctly. The process does no real work — the registry is empty; this feature only proves the process lifecycle and gives stage 03 a stable interface to register real job handlers against. The worker is runnable via a `start` script in `worker/package.json` and a root `pnpm dev:worker` / `pnpm worker` script.

## Dependencies
- Builds on: feature-01 (workspace + `worker/` package layout), feature-02 (`getServerAppwrite` server client the worker imports to prove shared infra access).

## Constraints
- The worker must run as a standalone Node process driven by its own `start` script — it is not spawned by the web app. (Containerization is feature-05; this feature proves the process, not the container.)
- No real job work runs in this feature. The registry must stay empty; `registerJob` is provided but not called with any handler.
- The worker must not depend on the `web` package. It may depend only on `@newsletter/shared` and its own deps.
- The browser Appwrite client (`appwrite` SDK) must never be imported by the worker — server SDK only.
- Graceful shutdown must complete within a short window (the podman stop grace period in feature-05 will rely on this); default the heartbeat clear + exit to be near-instant.
- No queues, schedulers, DB writes, or external integrations — purely the process lifecycle and registry interface.

## Acceptance criteria
- [ ] `pnpm --filter worker start` boots the worker; a startup log line is emitted and the process stays alive (does not exit).
- [ ] A heartbeat log line is emitted at the configured interval (verifiable with a short interval like 1000ms during testing).
- [ ] Sending `SIGTERM` (or `SIGINT`) to the running worker causes a shutdown log line, the heartbeat stops, and the process exits with code 0 within ~1 second.
- [ ] `getServerAppwrite()` from `@newsletter/shared` is imported and invoked at boot without throwing (worker reaches shared infra).
- [ ] `registerJob(name, handler)` and `getJob(name)` are exported and behave as an empty registry: `getJob('anything')` returns `undefined` before any registration; registering then retrieving returns the handler.
- [ ] No handlers are registered at startup (registry is empty).
- [ ] The worker package does not import from `web` and does not import the browser Appwrite SDK.
- [ ] `pnpm typecheck` and `pnpm build` pass across all packages.

## Files
- Modify: `worker/src/index.ts` (boot, heartbeat, shutdown, registry init, Appwrite init)
- Create: `worker/src/registry.ts` (job-handler registry: `JobHandler` type, `registerJob`, `getJob`)
- Modify: `worker/package.json` (add `start` script, `tsx`/`ts-node` or build-then-run dev dependency for running TS)
- Modify: `package.json` (repo root — add `dev:worker` and `worker` scripts)
- Test: none in-tree (test runner arrives in feature-04); verification is via process behavior documented under Testing approach.

## Testing approach
This feature is **not test-first** for two stated reasons, per SSC: (1) the test runner (Vitest) does not exist yet (feature-04), and (2) the core behavior is process lifecycle (boot/stay-alive/shutdown) which is integration-level and observed at the OS level rather than asserted by an in-tree unit test. The verifier confirms correctness through executable evidence:

- **Boot/liveness gate:** starting the worker emits a startup line and the process is still alive after >1 heartbeat interval.
- **Heartbeat gate:** with `WORKER_HEARTBEAT_MS=1000`, a second heartbeat line appears ~1s after the first.
- **Shutdown gate:** `kill -TERM <pid>` produces a shutdown line and exit code 0, quickly.
- **Registry gate:** a throwaway `tsx` one-liner imports `registerJob`/`getJob`, asserts `getJob('x')` is `undefined`, registers a no-op handler, and asserts `getJob('x')` returns it.
- **Infra gate:** the worker's startup log confirms the Appwrite server client initialized without error.

When feature-04 lands, the registry (`registry.ts`) is the natural unit-test target; recorded as a follow-up, not a gate for this feature.

## Tasks

### Task 1: Job-handler registry module
- **Action:** Create `worker/src/registry.ts`. Define an exported `JobHandler` type (e.g. `type JobHandler = (input: unknown) => Promise<void>` — kept generic since no real jobs exist yet). Implement a module-level `Map<string, JobHandler>`. Export `registerJob(name: string, handler: JobHandler): void` and `getJob(name: string): JobHandler | undefined`. Export `listJobs(): string[]` for debug visibility. Re-export from `worker/src/index.ts`.
- **Expected result:** A minimal, typed, empty registry with stable functions stage 03 will call to register real handlers.
- **Verify:** `pnpm --filter worker exec tsc --noEmit` passes. Run a `tsx`/`ts-node` one-liner that imports `getJob`/`registerJob`/`listJobs`, asserts `getJob('noop') === undefined`, registers a handler, asserts `getJob('noop') === handler`, and `listJobs()` returns `['noop']`.
- **Depends on:** feature-02 complete (worker package already imports `@newsletter/shared`).

### Task 2: Worker entrypoint — boot, Appwrite init, heartbeat, shutdown
- **Action:** Rewrite `worker/src/index.ts` (currently a placeholder that imports shared but does not run, per feature-02) into the real long-running entrypoint. On boot: emit a startup log line, call `getServerAppwrite()` inside try/catch (log success or a descriptive non-secret error and exit non-zero on failure), read `WORKER_HEARTBEAT_MS` from env (default `30000`), start a `setInterval` heartbeat logging a liveness line (include an incrementing tick count and uptime). Register `SIGTERM` and `SIGINT` handlers that clear the interval, log a shutdown line, and `process.exit(0)`. Ensure the process does not exit on its own (the interval keeps the event loop alive).
- **Expected result:** A worker process that boots, proves shared-infra reachability, stays alive with a heartbeat, and shuts down cleanly on signal.
- **Verify:** `pnpm --filter worker exec tsc --noEmit` passes. `WORKER_HEARTBEAT_MS=1000 pnpm --filter worker start` — confirm a startup line, then ≥2 heartbeat lines ~1s apart, and the process is still running. Then `kill -TERM <pid>` — confirm a shutdown line and `echo $?` reports `0`, all within ~1s. Confirm a startup line references successful Appwrite client init.
- **Depends on:** Task 1.

### Task 3: Run scripts and end-to-end check
- **Action:** Add a `start` script to `worker/package.json` (e.g. `tsx src/index.ts` for dev simplicity; a build-then-run variant can be added in feature-05 when the container needs a compiled artifact). Add `tsx` as a worker dev dependency. Add root scripts: `dev:worker` (`pnpm --filter worker start`) and `worker` (alias) to the root `package.json`. Run the worker from the repo root via the new script and confirm the full lifecycle from a clean install.
- **Expected result:** The worker is launchable from the repo root with one command; the whole feature works from clean state.
- **Verify:** From clean state (`pnpm install`): `pnpm typecheck` and `pnpm build` green. `WORKER_HEARTBEAT_MS=1000 pnpm dev:worker` boots from root, emits startup + heartbeat, shuts down on SIGTERM with exit 0. Confirm `worker/package.json` has no dependency on `web`, and `rg -n "from 'appwrite'|require\('appwrite'\)" worker/src` returns nothing (browser SDK never imported by worker).
- **Depends on:** Task 2.

## Feature verification
- Run: `pnpm install && pnpm typecheck && pnpm build` then `WORKER_HEARTBEAT_MS=1000 pnpm dev:worker` (send `SIGTERM` after a few seconds)
- Expected: Install/typecheck/build all green. The worker boots, logs a startup line that confirms Appwrite server-client init succeeded, emits heartbeat lines ~1s apart, and on `SIGTERM` logs a shutdown line and exits with code 0 within ~1 second. The job-handler registry is importable and empty at boot. The worker imports only `@newsletter/shared` (not `web`, not the browser Appwrite SDK).

## Handoff
When complete, the builder reports to the manager:
- Files created/modified (`worker/src/registry.ts`, `worker/src/index.ts`, `worker/package.json`, root `package.json` scripts).
- The runner used to execute TS (`tsx`) and its version, and whether a compiled-artifact path was added or deferred to feature-05.
- Confirmation of each acceptance gate: boot, heartbeat at the test interval, SIGTERM exit code 0, Appwrite init success log, registry round-trip.
- Confirmation that the worker has no `web` dependency and never imports the browser Appwrite SDK.
- Any deviation from this spec and the reason.
