# Stage 00: Scaffolding — Summary

## What this stage delivered

Stage 00 laid the foundation the entire Newsletter Generator is built on. Before this stage there was no project at all — just a product vision and an old Python pipeline kept in a quarantined folder for reference. Now there is a runnable, tested, containerized TypeScript application that an operator can bring up with a single command and safely reach from a browser.

Concretely, the app now exists as a three-part TypeScript workspace: a Next.js web app (the GUI the operator interacts with), a separate background worker process (the future home of slow jobs like fetching RSS and generating newsletters), and a shared code package that both can use so nothing has to be written twice. The project enforces strict typing throughout, runs a test suite (25 tests passing), and passes lint cleanly — so every later stage can be built test-first against gates that already work.

The app is proven to talk to the already-running external Appwrite instance (the shared backend): a `/health` endpoint performs a real authenticated check and reports whether the connection is live. The whole thing runs the way it will in production via a single `podman compose up` that brings up the web and worker containers only — Appwrite and the mail server stay external, referenced through the project's `.env`. Both containers run as a non-root user for safety, and their base images are pinned to an exact version for reproducible builds.

Finally, the app is gated behind a single-operator login so it is safe to expose and reach on the go. Every route except the login page and the health check requires an active Appwrite session, validated authoritatively on the server (not just by the presence of a cookie). With this in place, every later stage can simply assume a logged-in operator.

Nothing newsletter-specific exists yet — no feeds, runs, prompts, or data models. That is intentional; this stage was purely about making the project real and runnable.

## How it maps to the plan

- **Stage Intent:** "Lay the foundation every later stage stands on — a runnable TypeScript project, a test runner, linting, the Appwrite connection proven, and a podman compose stack that brings up the app the way it will run in production. Without this, nothing else can be built or verified reliably. This stage exists so that from stage 01 onward, the only question is 'does the feature work,' never 'does the project even run.'"
- **Acceptance criteria met:**
  - [x] `podman compose up` starts the web app and worker with no manual steps beyond initial `.env` config.
  - [x] The web app is reachable in a browser and shows a placeholder home page.
  - [x] Appwrite connection succeeds: a health-check route/log confirms a successful handshake against the external instance using `.env` values.
  - [x] The worker process boots and stays running as its own container, separate from the web app.
  - [x] `npm test` (or equivalent) runs Vitest and exits green.
  - [x] `npm run lint` (or equivalent) passes with zero errors on the skeleton.
  - [x] Visiting any app route while logged out redirects to login; logging in (Appwrite session) grants access.
  - [x] No newsletter-specific code, collections, or data exists yet.
- **North star link:** This stage is the "make the project real" prerequisite for the entire product. The north star is a self-hosted, GUI-driven newsletter generator that replaces a fragile Python CLI. Stage 00 delivered the runnable, tested, containerized, authenticated home that every subsequent capability (the filtering engine, newsletter config, run history, scheduling, delivery) will be built into. None of those can be built or verified without what this stage established.

## What was built

- **Feature 01 — Project skeleton:** A pnpm TypeScript workspace with three packages (`web`, `worker`, `shared`), strict typing enforced everywhere, and Node 22 LTS pinned. The web app boots and serves a placeholder home page; cross-package imports are proven.
- **Feature 02 — Appwrite connection:** Wiring to the external Appwrite instance via the project `.env`, with a server-side client (used by web and worker) and a `/health` endpoint that performs a real authenticated round-trip and reports connection status. The API key stays server-side only and never reaches the browser bundle.
- **Feature 03 — Worker skeleton:** A standalone long-running background process with a startup log, a periodic heartbeat, graceful shutdown on stop, and an empty job-handler registry that later stages will fill with real jobs. The worker is fully separate from the web app.
- **Feature 04 — Test runner + lint:** Vitest configured across the workspace with a passing smoke test, plus ESLint (flat config) and Prettier set up so they don't conflict. `pnpm test`, `pnpm lint`, and `pnpm format` all work as consistent quality gates.
- **Feature 05 — Podman compose stack:** A single `podman compose up` brings up the web and worker containers (only those two) against the external Appwrite. Each service has its own multi-stage image built from source, a healthcheck, and auto-restart.
- **Feature 06 — Auth gate:** A minimal single-operator login that gates every app route except login and health. Sessions are validated authoritatively on the server, so a forged or expired cookie cannot grant access.
- **Feature 07 — Hardening review:** A quality pass that removed an unused and potentially confusing piece of auth code, hardened both containers to run as a non-root user, pinned the base images to an exact version for reproducible builds, and made login error messages safe (no backend details leaked to the screen; real errors kept in server logs only).

## Decisions and deviations

- **Login flow changed from browser SDK to server actions (documented rescue).** Feature 06 was originally specced to log in through the browser Appwrite SDK, but during execution that approach hit a cross-domain cookie bug: the browser SDK sets the session cookie on the Appwrite server's domain, which the app's own domain never receives, so the operator would be silently redirected back to the login page forever. The feature was rescued mid-execution by switching login/logout to Next.js server actions using the server Appwrite client and manually setting a first-party `HttpOnly` cookie on the app domain. This is the authoritative path now; it is recorded as an escalation in the project state, not hidden.
- **Browser Appwrite SDK removed entirely (hardening).** Following a code review, feature 07 deleted the now-dead browser client factory and removed the browser SDK dependency, recording the convention that *all* Appwrite access in this project is server-side. The project is cleaner and a future maintainer can't accidentally reintroduce the cross-domain cookie bug. If a later stage genuinely needs browser-side Appwrite (e.g. realtime updates), it should be re-added deliberately with server-minted session credentials.
- **Login error messages changed (hardening).** Feature 07 replaced raw Appwrite SDK error text in the login UI with a small set of fixed, safe messages ("Invalid email or password" / "Login failed. Please try again."), with the real detail preserved only in server logs. This is the only user-visible behavior change introduced by hardening.
- Otherwise the stage was built as specced.

## Deferred and out of scope

- **Appwrite collection/schema definitions** — deferred to the stages that need them (newsletter config, runs, prompts, etc.).
- **Any pipeline logic** (RSS fetching, scraping, tagging, scoring, drafting) — that is stage 01.
- **Newsletter, run, or prompt data models** — later stages.
- **A user-management UI, roles, or multi-user support** — non-goal for the whole product (single-operator).
- **Spawning Appwrite or a mail server inside the compose stack** — both remain external by design.
- **CI pipeline configuration** — can be added when the PM wants it; not required for this stage.
- **Login rate-limiting / brute-force protection** — acceptable for single-operator scope (Appwrite has server-side auth limits); revisit if the app is ever exposed more broadly.

## Open questions for the next stage

- **Cleanup of a dead middleware cookie check.** `web/middleware.ts` still checks an `a_session_<projectId>_legacy` cookie variant that, under the server-action auth architecture, nothing ever sets. It is harmless — the authoritative session check in the protected layout reads only the correct cookie and rejects any forged `_legacy` cookie — but it is dead code and a small source of confusion in the auth boundary. A future stage or hardening pass should either drop the `_legacy` check or, if retained deliberately, read it in the session module too and document why.
- **Minor dependency version skew** noted in the code review (the Next.js lint plugin sits a major version ahead of the framework itself; the Node type definitions trail the runtime). Neither breaks anything today, but aligning them when convenient will keep the toolchain honest as the codebase grows.
