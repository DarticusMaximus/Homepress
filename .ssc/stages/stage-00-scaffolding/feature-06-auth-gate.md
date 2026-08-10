# Feature 06: Auth gate

## Intent
Make the app safe to expose and reach on the go — a minimal single-operator login (Appwrite email/password session) that gates every app route — so every later stage can assume a logged-in operator without each feature re-implementing access control.

## Spec
A single `/login` route renders a minimal email/password form (client component) that calls the Appwrite browser SDK's `Account.createEmailPasswordSession` against the operator account that already exists in the shared Appwrite instance (credentials are typed by the operator; never stored in the repo or `.env`). On success the Appwrite session cookie is set and the user is redirected to `/`. Next.js middleware gates every route except an explicit public set (`/login`, `/health`, and Next.js static assets): requests without an Appwrite session cookie are redirected to `/login`. A protected server-side layout authoritatively re-validates the session via the server SDK (`account.get()`-equivalent) so a forged/empty cookie cannot grant access on its own. A logout action (`Account.deleteSession("current")`) destroys the session and redirects to `/login`. No user-management UI, no roles, no sign-up, no password reset — just the gate.

## Dependencies
- Builds on: feature-01 (workspace), feature-02 (browser Appwrite client factory `getBrowserAppwrite` and server client `getServerAppwrite`), feature-04 (test runner, for unit-testing the route matcher).

## Constraints
- Operator credentials must never appear in code, `.env`, or the repo. They are typed at the login screen against the pre-existing Appwrite user account.
- Use the **browser** Appwrite SDK (`appwrite`) for login/logout (session creation is a client-side flow that sets the cookie); use the **server** SDK (`node-appwrite`) only for authoritative session validation in server components — never expose the API key to the browser.
- `/login`, `/health`, and Next.js internal static/asset routes must be public. Everything else must require a session.
- No sign-up, password reset, role/permission, or multi-user functionality.
- Middleware must be fast: cookie-presence check only. The expensive authoritative check (`account.get`) runs in the protected layout, not in middleware on every request.
- Do not define Appwrite users, teams, or memberships programmatically — the operator account already exists.

## Acceptance criteria
- [ ] Visiting any protected route (e.g. `/`) while logged out redirects to `/login`.
- [ ] `/login` and `/health` are reachable while logged out (no redirect).
- [ ] Logging in with the valid operator credentials creates a session, redirects to `/`, and the home page renders.
- [ ] The session persists across a full page reload (cookie-based).
- [ ] Logging out destroys the session and redirects to `/login`; subsequently visiting `/` redirects to `/login`.
- [ ] Logging in with invalid credentials fails, shows an error, and creates no session.
- [ ] A protected server layout authoritatively rejects a request whose cookie is present but invalid/expired (redirects to `/login`), proving the gate is not cookie-presence-only.
- [ ] No user-management, sign-up, role, or password-reset UI exists.

## Files
- Create: `web/middleware.ts` (route gate, cookie-presence check, public-route matcher)
- Create: `web/lib/auth/routes.ts` (public-routes config + `isPublicRoute` helper) — unit-tested
- Create: `web/app/login/page.tsx` (client component login form)
- Create: `web/app/login/actions.ts` (optional server action wrapper) OR handle login client-side (browser SDK)
- Create: `web/app/(protected)/layout.tsx` (authoritative server-side session validation)
- Create: `web/app/(protected)/page.tsx` OR move existing `web/app/page.tsx` into the protected route group so `/` is gated
- Create: `web/app/logout/route.ts` OR a logout server action calling `Account.deleteSession`
- Create: `web/src/__tests__/routes.test.ts` (unit test for the public-route matcher)
- Modify: `web/app/page.tsx` placement (move into `(protected)` route group) so the home page is gated

## Testing approach
Partially test-first: the **public-route matcher** (`isPublicRoute`) is pure logic and gets a real Vitest unit test (the runner exists as of feature-04). The core auth flow (login/logout/session/gate) is integration-level against the live Appwrite instance and is verified by executable evidence, not in-tree tests.

- **Unit gate (in-tree):** `routes.test.ts` asserts `/login` and `/health` are public, `/` and arbitrary other paths are protected, and the matcher handles trailing slashes consistently.
- **Integration gate:** manual/scripted checks against the running app: logged-out redirect to `/login`; valid login → home; reload keeps session; logout → redirect; invalid creds → error, no session; forged cookie → protected layout rejects.

## Tasks

### Task 1: Public-route matcher + middleware gate (with unit test)
- **Action:** Create `web/lib/auth/routes.ts` exporting `PUBLIC_ROUTES` (e.g. `["/login", "/health"]`) and `isPublicRoute(pathname: string): boolean` (normalizing trailing slashes). Create `web/middleware.ts` that reads the Appwrite session cookie (cookie name per the Appwrite SDK, e.g. `a_session_<project-id>` — confirm against the actual SDK version) and redirects to `/login` when absent on non-public routes; `export const config` matcher excludes `_next/static`, `_next/image`, and favicon. Write `web/src/__tests__/routes.test.ts` (or `web/__tests__/...`) covering the matcher.
- **Expected result:** Middleware gates all non-public routes by cookie presence; the matcher is unit-tested.
- **Verify:** `pnpm test` — the routes unit tests pass (including a forced-failure check: flip an expectation, confirm non-zero exit, revert). `pnpm --filter web build` succeeds. Manually: with no cookie, `curl -s -o /dev/null -w "%{http_code}" localhost:3000/` returns a 307/redirect toward `/login`; `curl localhost:3000/health` returns 200.
- **Depends on:** features 01–04 complete.

### Task 2: Login page and logout action
- **Action:** Create `web/app/login/page.tsx` as a client component (`"use client"`) with an email/password form. On submit, call `getBrowserAppwrite()` then `account.createEmailPasswordSession(email, password)`; on success `router.push("/")`, on failure set an error state and clear the password field. Create `web/app/logout/route.ts` (or a server action) that calls `account.deleteSession("current")` via the browser client and redirects to `/login`. Ensure the form is minimal (email, password, submit, error text) — no styling polish required.
- **Expected result:** A working login screen and a logout path.
- **Verify:** `pnpm --filter web build` succeeds. Running app: navigate to `/login`, enter the valid operator credentials → redirects to `/` showing the home page; enter wrong credentials → error shown, stays on `/login`. Trigger logout → redirected to `/login`; visiting `/` again redirects to `/login`.
- **Depends on:** Task 1.

### Task 3: Authoritative server-side validation in protected layout + end-to-end
- **Action:** Move the existing home page (`web/app/page.tsx`) into a `(protected)` route group: `web/app/(protected)/page.tsx` rendering "Newsletter Generator" as before. Create `web/app/(protected)/layout.tsx` as a server component that reads the session cookie and calls the server Appwrite client to validate the session (e.g. get the current account); if invalid/expired, redirect to `/login`. This makes the gate authoritative, not just cookie-presence. Re-run the full stack (including podman from feature-05) and verify every acceptance criterion.
- **Expected result:** Every protected route is gated authoritatively server-side; the whole stage-00 auth story works end-to-end.
- **Verify:** Logged-out `/` → redirect to `/login`. Valid login → `/` renders. Reload → still authenticated. Logout → `/` redirects to `/login`. Manually set a malformed session cookie (e.g. via browser devtools or `curl` with a bogus cookie) and visit `/` → redirected to `/login` by the protected layout (authoritative rejection). `/login` and `/health` remain reachable while logged out. `pnpm test`, `pnpm lint`, and `podman compose up` all behave correctly.
- **Depends on:** Task 2.

## Feature verification
- Run: `podman compose up -d` (or `pnpm dev`), then scripted browser/curl checks
- Expected: Logged-out visits to `/` redirect to `/login`; `/login` and `/health` are public. Valid operator credentials log in and reach `/`; the session survives a reload. Logout returns to `/login`. Invalid credentials fail with no session. A forged cookie is rejected by the protected layout. No sign-up, user-management, role, or password-reset UI exists. `pnpm test` is green (routes matcher unit test), `pnpm lint` is clean, and the podman stack still reaches `Up (healthy)`.

## Handoff
When complete, the builder reports to the manager:
- Files created/modified (middleware, routes helper + unit test, login page, logout route, `(protected)` layout and relocated home page).
- The exact Appwrite session cookie name relied upon and the SDK methods used (`createEmailPasswordSession`, `deleteSession`, and the server-side validation call).
- Confirmation of each acceptance gate: logged-out redirect, public routes, valid login, session persistence, logout, invalid-creds failure, forged-cookie rejection.
- Confirmation that operator credentials are never stored in code/`.env`/repo (typed at the screen only).
- Confirmation that `pnpm test`, `pnpm lint`, and `podman compose up` all succeed with the gate in place.
- Any deviation from this spec and the reason (e.g. cookie name differing across Appwrite SDK versions).
