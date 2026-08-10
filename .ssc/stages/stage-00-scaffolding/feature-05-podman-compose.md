# Feature 05: podman compose stack

## Intent
Make the app run the way it will in production on the self-hosted box — a single `podman compose up` that brings up the web and worker containers talking to the already-running external Appwrite instance — so the operator's deployment story is proven end-to-end and there are no manual runtime steps beyond initial `.env` config.

## Spec
A root `compose.yaml` defines exactly two services: `web` (the Next.js app) and `worker` (the background process). Each service has its own multi-stage `Dockerfile` built from source on a `node:22-alpine` base. The web image uses Next.js `output: "standalone"` for a minimal production build served by Node on port 3000; the worker image compiles its TypeScript to `dist/` and runs `node dist/index.js`. The compose file loads the project-root `.env` (via `env_file`) and passes the relevant variables into each container — `NEXT_PUBLIC_APPWRITE_*` and `APPWRITE_API_KEY` to `web`, `APPWRITE_API_KEY` and `WORKER_HEARTBEAT_MS` to `worker`. Appwrite and the mail server are **not** spawned by this stack; they are external services referenced only through the env vars. Each service has a healthcheck (`web` curls its own `/health` route from feature-02; `worker` checks process liveness via `kill -0 1`) and `restart: unless-stopped`. Per-package `.dockerignore` files keep build contexts lean.

## Dependencies
- Builds on: feature-01 (workspace + packages), feature-02 (`/health` route used as web healthcheck), feature-03 (worker runs as a long-running process), feature-04 (lint/test gates the code being containerized).

## Constraints
- The compose stack must contain **only** `web` and `worker`. Appwrite and the mail server must never appear as services — they are external.
- No `depends_on` on external services (they are not in the stack); the app must tolerate an unavailable Appwrite at boot and report it via `/health` rather than crash-looping. (The worker already exits non-zero on Appwrite init failure per feature-03 — that is acceptable; `restart: unless-stopped` will retry.)
- Base image must be `node:22-alpine` (matching the `.nvmrc` Node 22 LTS decision in feature-01).
- `APPWRITE_API_KEY` must never be baked into an image; it is supplied only at runtime via `env_file`/`environment`.
- The web image must not leak the API key into the browser bundle (feature-02's secret-safety guarantee holds in the container too).
- Do not configure CI, image registries, or watch mode/hot-reload in the production compose file (a separate `compose.override.yaml` for dev is optional and out of scope unless trivial).
- Images build from source (no prebuilt images pulled from a registry).

## Acceptance criteria
- [ ] `podman compose build` builds the `web` and `worker` images with no errors.
- [ ] `podman compose up -d` starts both services; both reach a healthy state (`podman compose ps` shows status `Up (healthy)`).
- [ ] The web container is reachable on the host (default port 3000) and serves the placeholder home page ("Newsletter Generator").
- [ ] `curl <host>:<port>/health` from outside the container returns 200 with `authenticated: true` against the real external Appwrite instance.
- [ ] The worker container stays running, emits heartbeat log lines visible via `podman compose logs worker`, and shuts down cleanly on `podman compose stop` (exit code 0).
- [ ] `compose.yaml` contains exactly two services (`web`, `worker`) and no Appwrite/mail service.
- [ ] No `APPWRITE_API_KEY` value appears in either built image's filesystem layers (runtime-supplied only).
- [ ] `podman compose down` removes the containers cleanly.

## Files
- Create: `compose.yaml` (repo root)
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`
- Create: `worker/Dockerfile`
- Create: `worker/.dockerignore`
- Modify: `web/next.config.mjs` (enable `output: "standalone"`)
- Modify: `worker/package.json` (add `build` script emitting `dist/`, and a production `start` script running `node dist/index.js`)
- Modify: `worker/tsconfig.json` (ensure `outDir`/emit settings produce `dist/`)

## Testing approach
This feature is **not test-first** — it is containerization/infrastructure, and the behavior is integration-level: do the images build and do the containers run and talk to the real external Appwrite. Per SSC this is stated explicitly. The verifier confirms correctness through executable evidence:

- **Build gate:** `podman compose build` succeeds for both images.
- **Runtime gate:** `podman compose up -d`, then `podman compose ps` shows both `Up (healthy)`.
- **Functional gate:** browser/curl to the web port shows the placeholder page; `/health` returns 200/`authenticated: true`.
- **Worker gate:** `podman compose logs worker` shows heartbeat lines; `podman compose stop worker` exits cleanly.
- **Scope gate:** `grep` / visual confirmation the compose file has exactly two services and no Appwrite/mail.
- **Secret gate:** inspecting the built image filesystem (`podman run --rm <image> env` must not list the key, and `find` of the image layer must not contain it).

## Tasks

### Task 1: Production build outputs for both packages
- **Action:** Enable Next.js standalone output in `web/next.config.mjs` (`output: "standalone"`). Add a `build` script to `worker/package.json` that compiles TS to `dist/` (via `tsc -p tsconfig.json` with emit enabled — a separate `tsconfig.build.json` is acceptable if the dev config uses `noEmit`), and a production `start` script running `node dist/index.js`. Ensure the worker's compiled output runs without `tsx` (verify `pnpm --filter worker build && pnpm --filter worker start` boots the worker from `dist/`).
- **Expected result:** Both packages produce runnable production artifacts from a plain `build` step.
- **Verify:** `pnpm --filter web build` produces a `.next/standalone` server entry. `pnpm --filter worker build` produces `worker/dist/index.js`. `rm -rf node_modules && pnpm install && pnpm --filter worker build && (cd worker && APPWRITE_API_KEY=dummy NEXT_PUBLIC_APPWRITE_ENDPOINT=x NEXT_PUBLIC_APPWRITE_PROJECT_ID=y WORKER_HEARTBEAT_MS=1000 node dist/index.js)` boots and heartbeats — proving it runs from compiled JS without tsx. (Send SIGTERM to exit.)
- **Depends on:** features 01–04 complete.

### Task 2: Web Dockerfile
- **Action:** Create `web/Dockerfile` as a multi-stage build on `node:22-alpine`: a `deps` stage installing pnpm and workspace deps, a `builder` stage copying source and running `pnpm --filter web build` (producing the standalone output + `.next/static`), and a final `runner` stage copying only the standalone server, static assets, and `public/` into a minimal image that runs `node server.js`. Expose port 3000. Create `web/.dockerignore` excluding `node_modules`, `.next`, `.env`, tests, and `.ssc`.
- **Expected result:** A lean web image that serves the Next.js standalone server.
- **Verify:** `podman build -t newsletter-web web/` (with build context at repo root as needed) succeeds. `podman run --rm -p 3000:3000 -e APPWRITE_API_KEY=... -e NEXT_PUBLIC_APPWRITE_ENDPOINT=... -e NEXT_PUBLIC_APPWRITE_PROJECT_ID=... newsletter-web` serves the placeholder page and `/health` returns 200.
- **Depends on:** Task 1.

### Task 3: Worker Dockerfile
- **Action:** Create `worker/Dockerfile` as a multi-stage build on `node:22-alpine`: a `builder` stage that installs deps and runs `pnpm --filter worker build` (emitting `dist/`), and a final `runner` stage copying only `dist/` and the production deps into a minimal image that runs `node dist/index.js`. Create `worker/.dockerignore` excluding `node_modules`, `dist`, `.env`, tests, and `.ssc`.
- **Expected result:** A lean worker image that runs the compiled worker.
- **Verify:** `podman build -t newsletter-worker worker/` (context at root as needed) succeeds. `podman run --rm -e APPWRITE_API_KEY=... -e NEXT_PUBLIC_APPWRITE_ENDPOINT=... -e NEXT_PUBLIC_APPWRITE_PROJECT_ID=... -e WORKER_HEARTBEAT_MS=1000 newsletter-worker` boots, heartbeats (visible in logs), and exits 0 on `podman stop`.
- **Depends on:** Task 1.

### Task 4: compose.yaml wiring + end-to-end
- **Action:** Create `compose.yaml` at the repo root with exactly two services — `web` (builds `web/`, maps port 3000, `env_file: .env`, healthcheck `curl -f http://localhost:3000/health`, `restart: unless-stopped`) and `worker` (builds `worker/`, `env_file: .env`, healthcheck `kill -0 1`, `restart: unless-stopped`). Do not add Appwrite or mail services. Add `restart_policy`-style behavior via `restart: unless-stopped`. Optionally set explicit `environment:` keys to document which vars each service consumes. Run the full stack from clean.
- **Expected result:** A single command brings up the whole app the way it runs in production.
- **Verify:** `podman compose build` succeeds for both. `podman compose up -d`, then `podman compose ps` shows both `Up (healthy)` within the healthcheck window. `curl localhost:3000` shows "Newsletter Generator"; `curl localhost:3000/health` returns 200/`authenticated: true`. `podman compose logs worker` shows heartbeat lines. `podman compose stop` exits cleanly. `podman run --rm newsletter-web env | grep APPWRITE_API_KEY` returns nothing (key not baked into the image). `podman compose down` cleans up.
- **Depends on:** Tasks 2 and 3.

## Feature verification
- Run: `podman compose build && podman compose up -d` (then `podman compose ps`, `curl localhost:3000/health`, `podman compose logs worker`, `podman compose down`)
- Expected: Both images build; both services reach `Up (healthy)`; the web port serves the placeholder page and `/health` returns 200 with `authenticated: true` against the real external Appwrite; the worker logs heartbeat lines and stops cleanly; the compose file contains exactly two services with no Appwrite/mail; the API key is absent from the built image filesystems. A single `podman compose up` is the only command needed beyond initial `.env` config.

## Handoff
When complete, the builder reports to the manager:
- Files created/modified (`compose.yaml`, both Dockerfiles, both `.dockerignore`, `next.config.mjs` standalone flag, worker `build`/`start` scripts and tsconfig emit settings).
- The exact `node:22-alpine` image digest pinned.
- Confirmation of each acceptance gate: both images build, both services healthy, `/health` 200/authenticated, worker heartbeat logs + clean stop, two-service scope, no key in images.
- Any Next.js standalone caveat encountered (e.g. static asset path handling) and how it was resolved.
- The host port mapping chosen (default 3000) and whether any compose-level env knobs were added.
- Any deviation from this spec and the reason.
