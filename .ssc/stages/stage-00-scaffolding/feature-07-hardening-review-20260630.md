# Feature 07: Harden stage-00 against code review findings

## Intent
Harden stage-00-scaffolding against findings from `review-stage-00-scaffolding-2026-06-30`: run containers as non-root, pin base images by digest, remove the orphaned browser Appwrite SDK, and stop leaking raw backend errors through the login UI — without changing any user-visible behavior except the login error wording.

## Spec
Four accepted findings, grouped into three tasks:

1. **Remove the unused browser Appwrite SDK and record the architecture decision (M1-20260630).** Delete `web/lib/appwrite-client.ts` and remove the `appwrite` browser-SDK dependency from `web/package.json`. Nothing imports `getBrowserAppwrite` after the feature-06 server-action rescue; it is dead code and a latent footgun (the feature-06 spec text still describes the browser-SDK login flow). Record the project convention — *all Appwrite access is server-side via `node-appwrite` (server components / server actions); the browser SDK is intentionally absent* — as a comment at the top of `web/app/login/actions.ts` (the auth entry point a future maintainer would read first). If realtime or resumable uploads become a real need in a later stage, re-introduce the browser SDK deliberately at that point, authenticating via an in-memory `setSession(secret)` minted by the server (the session secret already lives in the first-party `a_session_<projectId>` cookie); see the review report's "Cross-domain browser-SDK resolution" discussion. Do not reintroduce it now.

2. **Dockerfile hardening: non-root user + digest-pinned base image (X1-20260630, D1-20260630).** In the `runner` stage of both `web/Dockerfile` and `worker/Dockerfile`, switch the process to the non-root `node` user (uid 1000, provided by `node:22-alpine`) via `USER node`, ensuring `WORKDIR /app` is writable by that user. Pin **all** `FROM node:22-alpine` references (six total: three per Dockerfile — `deps`, `builder`, `runner`) to the same digest (`node:22-alpine@sha256:<digest>`) so builds are reproducible and the base image cannot be silently retagged upstream. Resolve the current digest by pulling `node:22-alpine` and reading its sha256 (`podman image inspect --format '{{.Digest}}' node:22-alpine` or `docker image inspect`), and record the resolved digest in the handoff.

3. **Safe login error messages (S1-20260630).** Stop returning the raw Appwrite SDK `err.message` to the client from `web/app/login/actions.ts`. Extract a pure, unit-tested `mapLoginError(err): string` helper into `web/lib/auth/` that maps an Appwrite credentials failure (HTTP 401 / `user_invalid_credentials`) to `"Invalid email or password"` and every other error to a generic `"Login failed. Please try again."`. The action logs the real error server-side (`console.error`) and returns only the mapped safe string. No API key or endpoint detail reaches the client. This is the one user-visible behavior change this feature makes (the wording of login errors).

## Dependencies
- Builds on: feature-02 (browser client factory being removed; `/health`), feature-05 (`web/Dockerfile`, `worker/Dockerfile`, `compose.yaml`), feature-06 (`web/app/login/actions.ts`). All are `verified` in stage 00.
- Feature spec under review: `.ssc/reviews/review-stage-00-scaffolding-2026-06-30.md`.

## Constraints
- **Do not change the auth architecture.** Login/logout remain Next.js server actions over `node-appwrite`. This feature explicitly does NOT reintroduce the browser Appwrite SDK.
- **Do not change user-visible behavior except the login error wording** (Task 3). The auth gate, session cookie handling, middleware, `/health` response shape, compose service definitions, ports, and env wiring all stay as-is.
- **Do not regress** any stage-00 Acceptance criterion or the acceptance criteria of features 02, 05, 06.
- TypeScript `strict: true` continues to pass; no package may relax it.
- The Dockerfile changes must keep `podman compose build` / `podman compose up -d` reaching `Up (healthy)` for both services.

## Acceptance criteria
- [ ] `web/lib/appwrite-client.ts` no longer exists; `appwrite` is absent from `web/package.json` dependencies.
- [ ] A comment at the top of `web/app/login/actions.ts` records the "all Appwrite access is server-side; browser SDK intentionally removed" convention and references the review.
- [ ] `grep -rn "getBrowserAppwrite\|from ['\"]appwrite['\"]" web/ shared/ worker/` returns nothing.
- [ ] Both Dockerfiles' `runner` stages run as a non-root user (`USER node`); `podman run --rm <web-image> id -u` prints `1000`, same for the worker image.
- [ ] Every `FROM` line in `web/Dockerfile` and `worker/Dockerfile` pins `node:22-alpine@sha256:<digest>` (6 total), all to the same digest, recorded in the handoff.
- [ ] Login with invalid credentials shows a clear, fixed message (not a raw SDK string); a network/server error shows the generic message; neither ever contains the Appwrite endpoint host or API key; the real error is logged server-side.
- [ ] A unit test for `mapLoginError` exists and passes: credentials error → credentials message; other error → generic message.
- [ ] `pnpm install && pnpm typecheck && pnpm build && pnpm lint && pnpm test` all pass from a clean state.
- [ ] `podman compose build && podman compose up -d` brings both services to `Up (healthy)`; `curl localhost:3000/health` returns 200 / `authenticated: true`; the login + logout flow still works end-to-end.

## Files
- Delete: `web/lib/appwrite-client.ts`
- Modify: `web/package.json` (remove `appwrite` dependency; run `pnpm install` to update lockfile)
- Modify: `web/app/login/actions.ts` (architecture-decision comment + use `mapLoginError`; log raw error server-side)
- Create: `web/lib/auth/login-errors.ts` (pure `mapLoginError(err): string`)
- Create: `web/src/__tests__/login-errors.test.ts` (unit test for `mapLoginError`)
- Modify: `web/Dockerfile` (`USER node` in runner; digest-pin all `FROM`)
- Modify: `worker/Dockerfile` (`USER node` in runner; digest-pin all `FROM`)

## Testing approach
- **Task 1 (remove browser SDK):** not test-first — it is a deletion. Verified by the build/typecheck/lint gates staying green and a grep proving the SDK is gone.
- **Task 2 (Dockerfile hardening):** not test-first — it is container config. Verified by image builds, `id -u` == 1000 in each container, and the compose stack reaching healthy (re-running feature-05's runtime gates).
- **Task 3 (safe login errors):** **test-first.** `mapLoginError` is pure logic — write `login-errors.test.ts` first (credentials error → fixed message; any other error → generic message; non-Error inputs handled), watch it fail against a stub, then implement `mapLoginError` and wire it into the action. The integration check (real invalid creds → safe wording; endpoint/key absent from the response) is the executable evidence on top.

## Tasks

### Task 1: Remove browser Appwrite SDK + record the architecture decision
- **Action:** Delete `web/lib/appwrite-client.ts`. Remove the `"appwrite"` entry from `web/package.json` `dependencies` and run `pnpm install` to update `pnpm-lock.yaml`. Add a concise comment block at the top of `web/app/login/actions.ts` stating: all Appwrite access in this project is server-side via `node-appwrite` (server components / server actions); the browser Appwrite SDK was intentionally removed (see `review-stage-00-scaffolding-2026-06-30`, finding M1); if a future stage needs realtime or resumable uploads, reintroduce it deliberately with an in-memory `setSession(secret)` minted server-side from the first-party session cookie — never wire login through it.
- **Expected result:** No code references the browser SDK; the lockfile no longer resolves `appwrite`; the convention is documented in-code at the auth entry point.
- **Verify:** `grep -rn "getBrowserAppwrite\|from ['\"]appwrite['\"]" web/ shared/ worker/` returns nothing. `pnpm install && pnpm typecheck && pnpm build && pnpm lint && pnpm test` all pass. `cat web/app/login/actions.ts | head -20` shows the convention comment.
- **Depends on:** none (feature-06 already verified; this only removes dead code).

### Task 2: Dockerfile hardening (non-root user + digest-pinned base image)
- **Action:** In `web/Dockerfile` and `worker/Dockerfile`: resolve the current `node:22-alpine` digest (`podman pull node:22-alpine && podman image inspect --format '{{.Digest}}' node:22-alpine`) and replace **all** `FROM node:22-alpine` lines with `FROM node:22-alpine@sha256:<that-digest>` (6 lines total, identical digest). In each `runner` stage, ensure `/app` is owned by the `node` user (`chown -R node:node /app` after the `WORKDIR`/copy steps, or create `WORKDIR` owned by `node`) and add `USER node` before the `CMD`. Do not change ports, env, healthcheck, or the compose service definitions.
- **Expected result:** Both images build from a pinned, reproducible base and run their process as uid 1000.
- **Verify:** `grep -c "@sha256" web/Dockerfile` → 3 and `grep -c "@sha256" worker/Dockerfile` → 3. `podman compose build` succeeds. `podman run --rm newsletter-generator-web:compose id -u` → `1000`; same for the worker image. `podman compose up -d`, then `podman compose ps` shows both `Up (healthy)`; `curl -s localhost:3000/health` returns 200 with `authenticated: true`; `podman compose down` cleans up. Record the resolved digest in the handoff.
- **Depends on:** none (independent of Task 1/3; touches only Dockerfiles).

### Task 3: Safe login error messages (test-first)
- **Action:** Create `web/lib/auth/login-errors.ts` exporting a pure `mapLoginError(err: unknown): string` that returns `"Invalid email or password"` for an Appwrite credentials failure (detect by `err.code === 401` or message including `user_invalid_credentials` / `invalid credentials`) and `"Login failed. Please try again."` for everything else, never throwing. Write `web/src/__tests__/login-errors.test.ts` first covering: a credentials-failure-shaped error → credentials message; a network error / generic Error / non-Error value → generic message; the function never returns undefined and never throws. Then implement, then update `web/app/login/actions.ts` login catch to `console.error("[login] failed:", err)` server-side and `return { error: mapLoginError(err) }`. Keep the existing "no email/password" early-return message as-is (it is already a safe, fixed string).
- **Expected result:** A unit-tested pure helper plus a login action that never leaks raw SDK messages; the real error is preserved in server logs only.
- **Verify:** `pnpm test` — `login-errors.test.ts` passes. `pnpm typecheck && pnpm build && pnpm lint` pass. Integration: with the app running, submit a wrong password → UI shows "Invalid email or password" and the response contains no Appwrite endpoint host or key; simulate an Appwrite outage (invalid `APPWRITE_API_KEY`) and attempt login → UI shows the generic message with no host/key; server log (`podman compose logs web` or terminal) contains the real error detail.
- **Depends on:** none (independent; Task 1's comment lands in the same file, so if both run, coordinate the edit — Task 1 adds the header comment, Task 3 changes the catch block).

## Feature verification
- Run: `rm -rf node_modules && pnpm install && pnpm typecheck && pnpm build && pnpm lint && pnpm test`, then `podman compose build && podman compose up -d`
- Expected: All build/test/lint gates green. Both services `Up (healthy)`. `/health` returns 200 / `authenticated: true`. Login/logout work; invalid credentials show the fixed credentials message; a backend error shows the generic message with no host/key leaked; the real error appears only in server logs. `grep -rn "getBrowserAppwrite\|from ['\"]appwrite['\"]" web/ shared/ worker/` returns nothing. Both containers run as uid 1000. All Dockerfile `FROM` lines pin the same `node:22-alpine@sha256:<digest>`. No stage-00 Acceptance criterion regresses.

## Handoff
When complete, the builder reports to the manager:
- Files deleted (`web/lib/appwrite-client.ts`), created (`web/lib/auth/login-errors.ts`, `web/src/__tests__/login-errors.test.ts`), and modified (`web/package.json`, `web/app/login/actions.ts`, `web/Dockerfile`, `worker/Dockerfile`, `pnpm-lock.yaml`).
- The resolved `node:22-alpine@sha256:<digest>` used and the command used to obtain it.
- Confirmation of each acceptance gate: SDK gone (grep empty), `id -u` == 1000 in both containers, both services healthy, `/health` 200, login/logout intact, invalid-creds and backend-error both show safe wording with no host/key, unit test green, all build/test/lint/typecheck pass.
- The `mapLoginError` test cases added.
- Confirmation that no stage-00 / feature-02 / feature-05 / feature-06 acceptance criterion regressed.
- Any deviation from this spec and the reason.
- Reference: full evidence and rationale in `.ssc/reviews/review-stage-00-scaffolding-2026-06-30.md`.
