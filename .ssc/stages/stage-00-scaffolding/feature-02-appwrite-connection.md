# Feature 02: Appwrite client connection

## Intent
Prove the app can actually talk to the external Appwrite instance — wiring both the server and browser Appwrite SDKs against the project-root `.env`, and exposing a `/health` route that performs a real authenticated server-side call — so every later stage can assume a working, validated connection rather than discovering a misconfigured endpoint or bad key at runtime.

## Spec
A typed Appwrite configuration module in `shared/` reads connection details from the project-root `.env` (endpoint and project ID from the existing `NEXT_PUBLIC_APPWRITE_*` vars; API key from the new server-only `APPWRITE_API_KEY`) and validates their presence at call time with descriptive errors. A memoized server-client factory in `shared/` returns a `node-appwrite` Client usable by both `web` server code and `worker`. A separate browser-client factory in `web/` returns an `appwrite` (browser SDK) Client configured with endpoint and project ID only — never the API key. A Next.js route handler at `GET /health` calls the server factory, performs a real authenticated round-trip (`databases.list()`), and returns JSON reporting connection status; on failure it returns HTTP 503 with a non-secret error summary. No collections, databases, or auth/login are defined — only the connection is proven.

## Dependencies
- Builds on: feature-01 (provides the `web`, `worker`, `shared` workspace packages, strict TS config, and root scripts used here).

## Constraints
- `APPWRITE_API_KEY` is **server-only**: it must never carry a `NEXT_PUBLIC_` prefix and must never be imported into, or referenced by, any client component or browser bundle. A leak check is part of verification.
- Do not rename or restructure the existing `.env` public vars (`NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`, `NEXT_PUBLIC_APPWRITE_ENDPOINT`).
- Do not define Appwrite databases, collections, or schemas.
- Do not implement login, sessions, or any auth UI — that is feature-06. The browser client is created but not used for auth here.
- The Appwrite API key must have the `databases.read` scope so the `/health` handshake's `databases.list()` call succeeds.
- No secrets are logged or returned in response bodies. Error JSON reports status/reachability, never the key.

## Acceptance criteria
- [ ] `pnpm typecheck` passes across all packages with the new Appwrite modules.
- [ ] `pnpm build` succeeds for `web` and `shared`.
- [ ] `GET /health` returns HTTP 200 with a JSON body indicating Appwrite is reachable and authenticated (e.g. `{ "status": "ok", "appwrite": { "endpoint": "...", "project": "...", "reachable": true, "authenticated": true } }`).
- [ ] With the API key deliberately invalidated (e.g. wrong value), `GET /health` returns HTTP 503 and `authenticated: false`, without leaking the key.
- [ ] The server client factory is importable from both `web` (server runtime) and `worker` packages.
- [ ] The browser client factory configures endpoint + project ID only; grepping the production browser bundle for the API key value yields nothing.
- [ ] Missing any required env var at boot causes a descriptive thrown error naming the missing variable.
- [ ] No collections, schemas, login UI, or auth code exists.

## Files
- Create: `shared/src/appwrite/config.ts`
- Create: `shared/src/appwrite/server.ts`
- Modify: `shared/src/index.ts` (re-export appwrite modules)
- Modify: `shared/package.json` (add `node-appwrite` dependency)
- Create: `web/lib/appwrite-client.ts`
- Create: `web/app/health/route.ts`
- Modify: `web/package.json` (add `appwrite` browser SDK dependency)
- Modify: `.env` (already amended by PM — `APPWRITE_API_KEY` line present)
- Test: none in-tree (test runner arrives in feature-04); verification is via the live `/health` route and build/secret checks documented under Testing approach.

## Testing approach
This feature is **not test-first** for two stated reasons, per SSC: (1) the test runner (Vitest) does not exist yet — it is feature-04; and (2) the core behavior is a live authenticated round-trip against an external service, which is an integration concern rather than a unit-testable behavior. The verifier therefore confirms correctness through executable evidence instead of in-tree unit tests:

- **Build & type gate:** strict `tsc --noEmit` and `pnpm build` pass.
- **Integration handshake:** `GET /health` returns 200 with `reachable: true, authenticated: true` against the real instance.
- **Negative path:** invalidating the API key flips the response to 503 / `authenticated: false` (proving the 200 was a real authenticated call, not a stub).
- **Secret-safety:** grepping the built browser bundle (`.next/static`) for the API key returns nothing.
- **Config validation:** importing the config module with a required var unset throws an error naming that var (checked via a throwaway node one-liner during verification).

When feature-04 lands, the config-validation logic (`config.ts`) is the natural target for unit tests; that is recorded as a follow-up, not a gate for this feature.

## Tasks

### Task 1: Appwrite config module and server client factory in `shared/`
- **Action:** Create `shared/src/appwrite/config.ts` exporting `getAppwriteConfig()` that reads `process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT`, `process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID`, and `process.env.APPWRITE_API_KEY`, validates each is present (throwing a descriptive `Error` naming the missing var otherwise), and returns a typed `{ endpoint, projectId, apiKey }` object. Add `node-appwrite` to `shared/package.json`. Create `shared/src/appwrite/server.ts` exporting a memoized `getServerAppwrite()` that builds and caches a `node-appwrite` Client (setEndpoint/ setProject/ setKey) from `getAppwriteConfig()`. Re-export both from `shared/src/index.ts`.
- **Expected result:** A validated config source plus a server Appwrite client available to any workspace package that depends on `@newsletter/shared`.
- **Verify:** `pnpm --filter shared exec tsc --noEmit` passes. Run `node -e "process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT='x';process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID='y'; require('./shared/src')"` style check (or a tsx one-liner) confirming a missing `APPWRITE_API_KEY` throws an error mentioning `APPWRITE_API_KEY`; and that with all three set it returns the configured client without throwing.
- **Depends on:** feature-01 complete.

### Task 2: Browser client factory in `web/` (secret-safe)
- **Action:** Add the `appwrite` browser SDK to `web/package.json`. Create `web/lib/appwrite-client.ts` exporting a memoized `getBrowserAppwrite()` that builds an `appwrite` Client with `setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)` and `setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)` only. Do **not** import or reference `APPWRITE_API_KEY` anywhere in this file or any client component. Add a code comment-free module; ensure it is only imported from client contexts.
- **Expected result:** A browser-usable Appwrite client configured with public values only, ready for feature-06 auth.
- **Verify:** `pnpm --filter web build` succeeds. Confirm `web/lib/appwrite-client.ts` contains no reference to `APPWRITE_API_KEY`. After build, `rg -n "<the-api-key-prefix>" web/.next/static` (searching for a distinguishing prefix of the key) returns no matches — the key is absent from the browser bundle.
- **Depends on:** Task 1.

### Task 3: `GET /health` route with real authenticated handshake
- **Action:** Create `web/app/health/route.ts` exporting a Next.js App Router `GET` route handler (server runtime). It calls `getServerAppwrite()` from `@newsletter/shared`, then `client.databases.list()` (or the equivalent server-SDK call) inside a try/catch. On success return `Response.json({ status: "ok", appwrite: { endpoint, project, reachable: true, authenticated: true } })` (endpoint/project sourced from config; do not echo the key). On failure return HTTP 503 with `{ status: "degraded", appwrite: { reachable: <bool>, authenticated: false } }` plus a generic non-secret message. Mark the route `export const dynamic = "force-dynamic"` so it never caches.
- **Expected result:** A single endpoint that proves the live authenticated connection and reports status as JSON.
- **Verify:** `pnpm dev`, then `curl -s localhost:3000/health` returns 200 with `"authenticated": true`. Then temporarily set `APPWRITE_API_KEY` to a clearly invalid value, restart dev, and confirm the response is 503 with `"authenticated": false` and the real key value does not appear anywhere in the body. Restore the real key afterward.
- **Depends on:** Task 1 (server client) — and ideally Task 2 so the whole Appwrite wiring is in place, but strictly depends only on the server client.

### Task 4: End-to-end verification and secret-safety gate
- **Action:** Run the full workspace build and the live handshake from a clean install state. Confirm the server client is importable from `worker` (add a one-line import reference in `worker/src/index.ts` that imports — but does not call — `getServerAppwrite`, purely to prove worker can reach it; keep the worker non-running as in feature-01). Confirm no secret leakage anywhere in the built artifacts.
- **Expected result:** The connection feature is proven end-to-end: config validated, both clients wired, handshake live, worker able to use the server client, no secrets in the browser bundle.
- **Verify:** From clean state (`pnpm install && pnpm typecheck && pnpm build`): all green. `curl localhost:3000/health` → 200, `authenticated: true`. `rg -n "<api-key-prefix>" web/.next` → no matches. `pnpm --filter worker exec tsc --noEmit` → passes (proving worker imports `getServerAppwrite` successfully).
- **Depends on:** Task 3.

## Feature verification
- Run: `pnpm install && pnpm typecheck && pnpm build && pnpm dev` (then `curl -s localhost:3000/health` in another shell)
- Expected: Install/typecheck/build all green; `GET /health` returns HTTP 200 with JSON `{ "status": "ok", "appwrite": { "endpoint": "...", "project": "...", "reachable": true, "authenticated": true } }`. Invalidating `APPWRITE_API_KEY` flips it to 503 / `authenticated: false`. The API key value appears nowhere in `web/.next`. No collections, schemas, or login UI exist. The worker package imports the server client factory but still does not run as a process.

## Handoff
When complete, the builder reports to the manager:
- Files created/modified (config module, server client factory, browser client factory, `/health` route, package.json deps, `worker` import line).
- The exact `node-appwrite` and `appwrite` SDK versions installed.
- Confirmation that `GET /health` returns 200/`authenticated: true` against the real instance, and 503/`authenticated: false` with an invalid key.
- Confirmation that the API key is absent from the built browser bundle (the grep command used and its empty result).
- The env-var names relied upon (`NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`) and the required API-key scope (`databases.read`) so the PM can verify the Appwrite console key is configured correctly.
- Any deviation from this spec and the reason.
