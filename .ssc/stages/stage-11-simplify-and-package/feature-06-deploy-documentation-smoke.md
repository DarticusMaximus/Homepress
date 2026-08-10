# Feature 06: Deploy documentation & smoke

## Intent

Give a public-repo stranger enough in-repo documentation to clone the code, fill `.env`, bring up web + worker with podman compose against their own Appwrite, and verify the stack is alive — so V1 self-host deploy does not depend on tribal knowledge.

## Spec

Author operator-facing deploy documentation and a documented post-up smoke check on top of Feature 05’s packaging. No new product capabilities; no Appwrite-in-compose; no `/health` semantic changes.

### Documentation shape

1. **`README.md` — short Deploy section** (GitHub landing skim):
   - Prerequisites in one short list (Linux box or equivalent; Podman; reachable Appwrite project; OpenRouter key; operator Auth user).
   - Happy-path commands: copy `.env.example` → `.env`, fill required keys, `podman compose up -d`, wait for healthy, curl smoke.
   - Link to `docs/DEPLOY.md` for the full walkthrough.
   - One-line note that the same `compose.yaml` often works with `docker compose`, but **only podman is the committed verified path**.
   - Keep the existing contributor/`pnpm` content; do not delete the threshold docs already asserted by other tests.

2. **`docs/DEPLOY.md` — full stranger walkthrough**:
   - **What this stack is:** web + worker only; Appwrite and SMTP are external.
   - **Prerequisites checklist** (enough for hosted Appwrite users; no Appwrite install tutorial):
     - Running Appwrite the host can reach (hosted or self-hosted — link official Appwrite docs for install).
     - Appwrite project + `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`.
     - Server API key (`APPWRITE_API_KEY`) with database + storage scope sufficient for this app.
     - One operator user in Appwrite Auth (email/password) for `/login` — no in-app signup.
     - `OPENROUTER_API_KEY`.
     - Podman (primary); optional Docker Engine note as above.
   - **Configure:** `cp .env.example .env`; point at required vs optional groups (SMTP / `APP_PUBLIC_URL` needed when using email or public RSS absolute URLs — **not** required for first smoke).
   - **Bring up:** `podman compose up -d` (and `ps` / logs pointers).
   - **Smoke (both):**
     1. Compose web healthcheck (already probes `http://localhost:3000/health`; 200 = Appwrite handshake OK).
     2. Explicit curl: `curl -sf http://localhost:3000/health` expecting JSON with top-level `"status":"ok"` and **nested** `appwrite.authenticated === true` (not a top-level `authenticated` field — match `web/app/health/route.ts`).
   - **Human confirmation:** open `http://localhost:3000`, log in with the Appwrite operator user, land on the dashboard.
   - **Schema note:** worker provisions the app database/collections on boot — no manual schema step.
   - **Common failures:** wrong/missing Appwrite env → 503 / unhealthy; worker down → schema not provisioned / dashboard health unhappy; no Auth user → login fails; blank SMTP → fine until email send.

### Smoke contract (machine vs human)

| Step | Gate |
|------|------|
| `podman compose up -d` + both services running; web reaches healthy when Appwrite is correct | Documented; Feature 05 owns packaging/runtime |
| `curl -sf http://localhost:3000/health` → `"status":"ok"` and `appwrite.authenticated === true` (nested) | Documented smoke (Feature 06) |
| Browser login → dashboard | Documented human confirmation only — not CI-automated |

### Out of scope

- Changing `compose.yaml`, Dockerfiles, `.env.example`, or `/health` response semantics (Feature 05 / existing Stage 00 route).
- Appwrite install guide beyond a link to official docs.
- Spawning Appwrite or SMTP in compose; registry publish; changelog; marketing pages.
- New product behavior, auth signup, or schema changes.
- Docker-first troubleshooting chapter.

### Research note (2026-07-27)

- Feature 05 packages compose + `.env.example` and keeps web healthcheck → `/health` HTTP 200; Feature 06 owns the stranger narrative and curl smoke docs.
- `web/app/health/route.ts`: 200 + nested `appwrite.authenticated: true` on `databases.list()` success; 503 degraded otherwise. `/health` is a public route.
- Worker boot runs `provisionDatabase` automatically (`worker/src/index.ts`).
- Login is Appwrite email/password session only — no in-app registration (`web/app/login/actions.ts`).
- Current `README.md` is contributor-focused; no `docs/DEPLOY.md` yet.
- Tools: codegraph (`/health`, worker provision, login); live read of `README.md`, `compose.yaml`, `.env.example`, Feature 05 spec.

## Dependencies

- Builds on: **feature-05-production-packaging** (compose, Dockerfiles, `.env.example`, `/health` healthcheck — the surface the docs describe).
- Soft: Stage 00 `/health` route and Stage 02 schema provisioner (behavior documented, not reimplemented).

## Constraints

- Do not change `/health` semantics, compose service set, or Feature 05 packaging files unless a doc-only typo in comments is required — prefer fixing docs to match code.
- Do not commit a real `.env` or live secrets.
- Do not author an Appwrite install tutorial.
- Preserve existing README contributor sections and threshold documentation required by other contract tests.
- Docs must stay honest: primary verified path is **podman**; docker is a compatibility note only.

## Acceptance criteria

- [ ] `docs/DEPLOY.md` exists and covers prerequisites → `.env` → compose up → healthcheck + curl smoke → login/dashboard → common failures.
- [ ] `README.md` has a Deploy section with a short happy path and a link to `docs/DEPLOY.md`.
- [ ] Deploy docs state Appwrite/SMTP are external; SMTP/`APP_PUBLIC_URL` optional for first smoke; schema auto-provisions via worker.
- [ ] Deploy docs document both compose healthcheck and `curl` to `/health` expecting `"status":"ok"` and nested `appwrite.authenticated === true`.
- [ ] Deploy docs include a docker-compose compatibility note without claiming Docker as the verified path.
- [ ] Deploy-docs contract tests pass.
- [ ] No Feature 05 packaging files or `/health` semantics changed as part of this feature (unless a critical factual correction in comments — record in handoff).

## Files

- Create: `docs/DEPLOY.md`
- Create: `shared/src/pipeline/__tests__/deploy-documentation-smoke.test.ts`
- Modify: `README.md` (add Deploy section; keep contributor/`pnpm`/threshold content)
- Do **not** modify (expected): `compose.yaml`, `web/Dockerfile`, `worker/Dockerfile`, `.env.example`, `web/app/health/route.ts`

## Testing approach

**Test-first contract suite (required).** Same repo-root walk-up as `cross-run-threshold-env-docs.test.ts` / `production-packaging-docs.test.ts` (locate `pnpm-workspace.yaml` from `import.meta.url`; do not use bare `process.cwd()`).

Cases:

1. **`docs/DEPLOY.md` exists** and is non-empty.
2. **Happy-path markers in `docs/DEPLOY.md`** — contains each of (substring match is enough):
   - `podman compose`
   - `.env.example`
   - `/health`
   - Nested health JSON markers: both `appwrite` and `authenticated` (docs must not imply a top-level-only `authenticated` field; asserting both substrings + Task 4 narrative check is the nesting gate)
   - `NEXT_PUBLIC_APPWRITE_ENDPOINT`
   - `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
   - `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`
   - `OPENROUTER_API_KEY`
   - `APPWRITE_API_KEY`
   - mention of external Appwrite (e.g. `external` near Appwrite, or explicit “Appwrite” + “not”/“external” — assert both `Appwrite` and a phrase like `external` or `not started by`)
   - operator/Auth login guidance (e.g. `login` and `Auth` or `email`)
   - schema provision / worker boot note (e.g. `provision` or `schema` and `worker`)
   - SMTP optional for first smoke (e.g. `SMTP` and `optional` or “not required”)
   - docker compatibility note (`docker compose`)
   - common failures / troubleshooting heading or section
3. **`README.md` Deploy section** — contains a Deploy heading (`## Deploy` or equivalent), links to `docs/DEPLOY.md`, and mentions `podman compose`.
4. **README still documents threshold** — still contains `CROSS_RUN_SIMILARITY_THRESHOLD` (do not regress existing threshold docs).

Do **not** require live Appwrite, podman, or network inside Vitest. Live compose/curl verification is operator-side evidence described in the docs, not a Vitest gate for this feature.

## Tasks

### Task 1: Failing deploy-docs contract tests

- **Action**: Create `shared/src/pipeline/__tests__/deploy-documentation-smoke.test.ts` covering Testing approach cases 1–4 against current tree (expect failures for missing `docs/DEPLOY.md` / missing README Deploy section).
- **Expected result**: `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/deploy-documentation-smoke` exits non-zero for the right reasons (missing deploy docs), not path/cwd errors.
- **Verify**: Run the test file; observe failures citing missing `docs/DEPLOY.md` and/or README Deploy link — not `findRepoRoot` errors.
- **Depends on**: none.

### Task 2: Write `docs/DEPLOY.md`

- **Action**: Create `docs/DEPLOY.md` per Spec § Documentation shape (2) — prerequisites checklist, env fill, compose up, dual smoke, login/dashboard, schema note, common failures, docker note, no Appwrite install tutorial.
- **Expected result**: Contract cases targeting `docs/DEPLOY.md` pass.
- **Verify**: Re-run deploy-docs tests; cases 1–2 green (case 3 may still fail until Task 3).
- **Depends on**: Task 1.

### Task 3: README Deploy section

- **Action**: Add a short Deploy section to `README.md` per Spec § Documentation shape (1). Preserve contributor scripts, Environment, and `CROSS_RUN_SIMILARITY_THRESHOLD` documentation. Link to `docs/DEPLOY.md`.
- **Expected result**: All deploy-docs contract cases 1–4 pass; existing threshold README tests still pass.
- **Verify**: `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/deploy-documentation-smoke` exit 0; also re-run `src/pipeline/__tests__/cross-run-threshold-env-docs` to confirm no README regression.
- **Depends on**: Task 2.

### Task 4: Narrative ↔ packaging consistency check

- **Action**: Read Feature 05’s compose healthcheck and `web/app/health/route.ts`. Confirm docs’ curl expectations match real `/health` JSON fields (`status`, `appwrite.authenticated`). Fix **docs only** if wording drifts. Do not change route or compose unless a factual bug is found — if so, stop and escalate rather than silently redesigning health.
- **Expected result**: Docs and live `/health` contract agree; packaging files untouched (or escalation noted).
- **Verify**: Grep/read confirmation in handoff that documented fields match `web/app/health/route.ts`; `git diff` shows no unintended packaging/`health` edits.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/deploy-documentation-smoke` and `pnpm --filter @newsletter/shared test -- src/pipeline/__tests__/cross-run-threshold-env-docs`
- Expected: Both suites exit 0; `docs/DEPLOY.md` + README Deploy section present; stranger path (env → compose → dual smoke → login) is documented without Appwrite install steps or packaging-file drift.

## Handoff

Builder reports: files created/changed; contract test path; confirmation packaging/`/health` were not modified (or escalation if they were); summary of Deploy doc sections; any wording deviations from this spec and why.
