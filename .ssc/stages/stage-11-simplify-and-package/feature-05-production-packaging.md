# Feature 05: Production packaging

## Intent

Harden the Stage 00 compose/Docker/`.env.example` baseline so a clean checkout with a filled `.env` can `podman compose up`, build images, and start web + worker against an existing external Appwrite — making the self-hosted deploy path real packaging, not tribal memory.

## Spec

Harden (do not rewrite from scratch) the production packaging surface so **clone → fill `.env` → `podman compose up`** builds and starts exactly two services: `web` (Next.js standalone) and `worker` (esbuild CJS bundle). Appwrite and SMTP/mail remain **external** — never spawned by this stack; connection details and secrets come only from the project-root `.env`.

### In scope

1. **`compose.yaml`** — Exactly `web` + `worker`. Root-context builds (`dockerfile: web/Dockerfile` / `worker/Dockerfile`). `env_file: .env` on both. Web publishes host `3000:3000`. Web healthcheck probes `http://localhost:3000/health` (existing Stage 00 route). Worker healthcheck is process liveness (`kill -0 1`). `restart: unless-stopped`. Web `build.args` pass the three `NEXT_PUBLIC_APPWRITE_*` values (inlined at Next build time). No Appwrite, mail, DB, or registry services. Comment block documents required vs optional env (see `.env.example`).
2. **Dockerfiles** — Keep multi-stage `node:22-alpine` (digest-pinned) + pnpm `11.9.0` matching `packageManager`. Web: `NEXT_PUBLIC_*` as `ARG`/`ENV` in builder only; **never** `APPWRITE_API_KEY` / `OPENROUTER_API_KEY` / SMTP secrets as build args. Worker: runtime-only secrets. Non-root `USER node` in runners. Root `.dockerignore` remains the authority for root-context builds (package-local `.dockerignore` files are inert when context is `.`).
3. **`.env.example`** — Complete operator template (no live secrets). Must document every key the V1 operator is expected to set for a working deploy, grouped with short comments:
   - **Required:** `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `NEXT_PUBLIC_APPWRITE_PROJECT_NAME` (preserve Stage 00 trio even if app code currently reads only endpoint/projectId/apiKey), `APPWRITE_API_KEY`, `OPENROUTER_API_KEY`
   - **Required for delivery features when used:** `APP_PUBLIC_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` (plus optional `SMTP_FROM`, `SMTP_SECURE`)
   - **Optional documented knobs:** `CROSS_RUN_SIMILARITY_THRESHOLD=0.85`, commented model overrides (`TAGGER_MODEL`, `SCORER_MODEL`, `DRAFTER_MODEL`, `EMBED_MODEL`), commented worker poll/heartbeat knobs (`WORKER_HEARTBEAT_MS`, `WORKER_RUN_POLL_MS`, `WORKER_SCHEDULE_POLL_MS`, `WORKER_RETENTION_POLL_MS`), commented scraper knobs (`SCRAPER_TIMEOUT_MS`, `SCRAPER_MIN_EXTRACTED_LENGTH`), optional `TZ`
4. **Packaging contract tests** — Repo-root file assertions (walk up from `import.meta.url` to `pnpm-workspace.yaml`, same pattern as `shared/src/pipeline/__tests__/cross-run-threshold-env-docs.test.ts`) so a builder cannot “finish” by omitting keys or adding Appwrite as a compose service.

### Out of scope (Feature 06 / non-goals)

- Operator deploy narrative README / dedicated deploy doc beyond what contract tests already require for existing threshold docs.
- Post-up smoke checklist / curl walkthrough / compose healthcheck redesign for “liveness vs Appwrite readiness” — Feature 06 owns verifiable “stack is alive” documentation. This feature keeps the existing `/health` → HTTP 200 healthcheck.
- Image registry publish, version tags, changelog.
- Spawning Appwrite or SMTP in compose.
- New product behavior, schema, pipeline semantics, or auth changes.
- Mass Prettier / knip / CI workflow authoring.

### Research note (2026-07-27)

- Baseline already exists from Stage 00 Feature 05: `compose.yaml`, `web/Dockerfile`, `worker/Dockerfile`, root + package `.dockerignore`, `.env.example`, `output: "standalone"` in `web/next.config.mjs`.
- Web `/health` (`web/app/health/route.ts`) returns 200 + `authenticated: true` on Appwrite handshake success, else 503 degraded — compose web healthcheck requires 200.
- `NEXT_PUBLIC_*` must be build args (Next inlines them); runtime `env_file` alone does not update the client bundle — confirmed via current Next.js Docker/standalone guidance (web search + Context7/Next docs patterns, 2026).
- No `web/public/` directory today; do not invent a `COPY public` unless a `public/` tree is added for a real asset.
- Tools: live file read of compose/Dockerfiles/`.env.example`; codegraph for `getAppwriteConfig`, `/health`, worker boot env; `rg` for `process.env.*` inventory.

## Dependencies

- Builds on: **feature-04-final-quality-gates** (ship gates green before packaging is an honest release surface).
- Soft: Stage 00 Feature 05 podman compose baseline (files already present — harden in place).
- Feature 06 (deploy docs & smoke) consumes this packaging; do not implement Feature 06 here.
- **Task 4 / Feature verification runtime deps (not committed):** `podman` available on the builder machine, plus a **local, gitignored** project-root `.env` (copy from `.env.example`; never commit — `.gitignore` already excludes `.env` / `.env.*` with `!.env.example`). That local file must supply at least the three `NEXT_PUBLIC_APPWRITE_*` values so compose can interpolate web `build.args`; other keys needed to actually talk to Appwrite/OpenRouter/SMTP stay in the same uncommitted `.env`. Do **not** invent a committed secrets file.

## Constraints

- Exactly two compose services: `web`, `worker`. Never add Appwrite, mail, or other infra services.
- Secrets (`APPWRITE_API_KEY`, `OPENROUTER_API_KEY`, SMTP password, etc.) are runtime-only via `env_file` / process env — never Dockerfile `ARG`/`ENV` bake-ins.
- Preserve `NEXT_PUBLIC_APPWRITE_{ENDPOINT,PROJECT_ID,PROJECT_NAME}` naming (Stage 00 pin).
- Base image remains digest-pinned `node:22-alpine`; pnpm `11.9.0` via corepack. Refresh digests only if the pinned digest fails to pull/build — do not churn digests without cause.
- Do not commit a real `.env` or put live secrets in `.env.example`.
- Do not author Feature 06 deploy docs or change `/health` semantics.
- No product/pipeline/schema changes.

## Acceptance criteria

- [ ] `compose.yaml` defines exactly services `web` and `worker`; no Appwrite/mail/DB service names or images.
- [ ] Web build args include the three `NEXT_PUBLIC_APPWRITE_*` keys; Dockerfiles do not declare `ARG`/`ENV` for `APPWRITE_API_KEY` or `OPENROUTER_API_KEY`.
- [ ] `.env.example` documents all Required keys listed in Spec §3 (non-empty key names present; values may be blank) plus `CROSS_RUN_SIMILARITY_THRESHOLD=0.85`, and commented optional worker/scraper/model/`TZ` knobs named in Spec §3.
- [ ] Packaging contract tests pass (see Testing approach).
- [ ] `podman compose build` succeeds for both images from repo root with a **local gitignored** `.env` available for compose interpolation of build args (never committed).
- [ ] `podman compose up -d` starts both containers (`podman compose ps` shows them **running**). That running state is the Feature 05 pass gate. Healthy / `curl /health` → 200 is handoff evidence when Appwrite is reachable — **not** a Feature 05 failure when Appwrite is unreachable (web may be `Up (unhealthy)`). Full handshake narrative remains Feature 06.
- [ ] `podman compose down` cleans up. No Feature 06 deploy-doc file is introduced under this feature id. No real `.env` is committed.

## Files

- Modify: `compose.yaml`
- Modify: `web/Dockerfile` (only if contract/build gaps require it)
- Modify: `worker/Dockerfile` (only if contract/build gaps require it)
- Modify: `.dockerignore` (only if build-context gaps require it)
- Modify: `.env.example`
- Create: `shared/src/pipeline/__tests__/production-packaging-docs.test.ts` (canonical path — sibling of `cross-run-threshold-env-docs.test.ts`; do not put this under `shared/src/__tests__/`)
- Do **not** create: deploy README sections owned by Feature 06, registry configs, extra compose services
- Do **not** commit: project-root `.env` (gitignored secrets). Only `.env.example` is the committed template.

## Testing approach

**Hybrid.**

### A. Test-first contract suite (required)

Create packaging docs/contract tests that fail until files match Spec. Resolve repo root by walking up from `import.meta.url` to `pnpm-workspace.yaml` (same helper pattern as `cross-run-threshold-env-docs.test.ts` — may import/share a tiny helper or duplicate the walk-up; do not use bare `process.cwd()`).

Cases:

1. **`.env.example` required keys** — File exists; contains each of: `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`, `APPWRITE_API_KEY`, `OPENROUTER_API_KEY`, `APP_PUBLIC_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `CROSS_RUN_SIMILARITY_THRESHOLD`, and the substring `0.85`.
2. **`.env.example` optional knobs named** — Contains commented or uncommented mentions of: `TAGGER_MODEL`, `SCORER_MODEL`, `DRAFTER_MODEL`, `EMBED_MODEL`, `WORKER_HEARTBEAT_MS`, `WORKER_RUN_POLL_MS`, `WORKER_SCHEDULE_POLL_MS`, `WORKER_RETENTION_POLL_MS`, `SCRAPER_TIMEOUT_MS`, `SCRAPER_MIN_EXTRACTED_LENGTH`, `TZ`.
3. **`compose.yaml` two-service scope** — File exists; contains `services:`; top-level service keys include `web` and `worker`; does **not** match a service entry for appwrite/mail/smtp/postgres/mysql (assert absence of lines like `appwrite:` / `mail:` / `smtp:` as service keys — string/regex on file text is enough; do not add a YAML dependency).
4. **Web build-args + secret safety in Dockerfiles** — `compose.yaml` passes the three `NEXT_PUBLIC_APPWRITE_*` under `web.build.args`. `web/Dockerfile` declares those three as `ARG`. Neither Dockerfile contains `ARG APPWRITE_API_KEY` or `ARG OPENROUTER_API_KEY` (or `ENV APPWRITE_API_KEY=` / `ENV OPENROUTER_API_KEY=` bake patterns).
5. **Root `.dockerignore` ignores secrets** — `.dockerignore` exists and lists `.env` (so the real secrets file is not copied into build context).

Do **not** require live Appwrite or `podman` inside Vitest.

### B. Integration (not test-first — stated explicitly)

Containerization is verified by executable evidence outside Vitest:

- `podman compose build`
- `podman compose up -d` then `podman compose ps`
- Optional sanity: `curl -sf http://localhost:3000/health` when Appwrite env is valid (success strengthens handoff; Feature 06 owns the documented smoke). If Appwrite is unreachable, web may be `Up (unhealthy)` while still “started” — note that in handoff; do not fail Feature 05 solely on handshake if both containers are running and build succeeded.
- `podman compose down`

## Tasks

### Task 1: Failing packaging contract tests

- **Action**: Create **`shared/src/pipeline/__tests__/production-packaging-docs.test.ts`** (this path only) covering Testing approach cases 1–5 with repo-root walk-up. Assert against current files so any missing optional knobs / incomplete comments fail for the right reason.
- **Expected result**: `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/production-packaging-docs` exits non-zero (or specific cases fail) until Task 2 lands the missing `.env.example` / compose documentation.
- **Verify**: Run the test file; observe failures citing missing optional knob names and/or incomplete compose documentation — not path/cwd errors.
- **Depends on**: none.

### Task 2: Harden `.env.example` + `compose.yaml` comments/wiring

- **Action**: Update `.env.example` to satisfy Spec §3 (required keys + optional commented knobs). Update `compose.yaml` header comments to list required Appwrite/OpenRouter keys and point at `.env.example` for SMTP/`APP_PUBLIC_URL`/optional worker knobs. Keep exactly two services, existing healthchecks, build args, `env_file`, ports, and restart policy unless a contract failure proves a wiring bug — then fix the minimal gap.
- **Expected result**: Contract cases 1–3 and compose portions of case 4 pass.
- **Verify**: Re-run packaging contract tests; cases 1–3 green. `compose.yaml` still has only `web` + `worker`.
- **Depends on**: Task 1.

### Task 3: Dockerfile / `.dockerignore` gap fix (only as needed)

- **Action**: Fix any remaining contract case 4–5 failures. Confirm web Dockerfile still wires `NEXT_PUBLIC_*` ARG→ENV for the builder; secrets remain runtime-only; runners stay non-root; digests unchanged unless pull/build forces a refresh (document if refreshed). Do not add a fake `public/` copy.
- **Expected result**: All packaging contract tests green; Dockerfiles remain multi-stage and secret-safe.
- **Verify**: Full packaging test file green; spot-check Dockerfiles for no `ARG APPWRITE_API_KEY`.
- **Depends on**: Task 2.

### Task 4: Podman build + start verification

- **Action**: From repo root, ensure a **local gitignored** `.env` exists (from `.env.example`; never `git add` it) with at least the three `NEXT_PUBLIC_APPWRITE_*` values for build-arg interpolation. With `podman` available, run `podman compose build` then `podman compose up -d`. Confirm both containers appear as **running** in `podman compose ps`. If Appwrite is reachable, optionally note `/health` 200 in the handoff; if not, note unhealthy-but-running — do not fail the task for handshake alone. Run `podman compose down`. Confirm `git status` does not stage `.env`.
- **Expected result**: Both images build; both services start (running); stack tears down cleanly; `.env` remains untracked/ignored.
- **Verify**: Build exit 0; `ps` shows `web` + `worker` **running** after up (Healthy optional); down succeeds; `git check-ignore -v .env` (or equivalent) confirms ignore; no `.env` in staged files. Capture command transcripts in handoff.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/production-packaging-docs` then (with local gitignored `.env` present) `podman compose build && podman compose up -d && podman compose ps && podman compose down`
- Expected: Contract suite exit 0; both images build; both containers **running**; compose file remains two-service; `.env.example` documents required + optional knobs; no Appwrite/mail services; secrets not Dockerfile build args; real `.env` never committed.

## Handoff

Builder reports: files changed; whether Dockerfiles/digests needed edits; contract test path (`shared/src/pipeline/__tests__/production-packaging-docs.test.ts`); podman build/up/ps/down evidence (running vs healthy); whether `/health` was 200 or web was unhealthy due to Appwrite; confirmation `.env` stayed gitignored/uncommitted and Feature 06 docs were not authored; any deviations and why.
