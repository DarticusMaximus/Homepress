# Stage 00: Scaffolding

## Intent
Lay the foundation every later stage stands on — a runnable TypeScript project, a test runner, linting, the Appwrite connection proven, and a podman compose stack that brings up the app the way it will run in production. Without this, nothing else can be built or verified reliably. This stage exists so that from stage 01 onward, the only question is "does the feature work," never "does the project even run."

## Goal
A single `podman compose up` brings up the Next.js web app and a background worker process, both talking to the already-running external Appwrite instance; tests run green; lint passes; and the operator can open the app in a browser and hit a single auth gate. Nothing newsletter-specific exists yet.

## Features
1. **Next.js + TypeScript project skeleton** — app boots, serves a placeholder home page, TypeScript strict mode on, project layout established (web app and worker as separable packages/modules within one repo).
2. **Appwrite client connection** — client reads connection details from the project-root `.env`, connects to the external Appwrite instance, and a health-check confirms the handshake works (e.g. successfully reads project metadata). No collections are defined yet.
3. **Worker process skeleton** — a separate background process (its own container) that boots, stays alive, and is wired to share code/config with the web app. It does no real work yet — it just exists so stage 03+ can hand it long-running jobs instead of the web app blocking on them.
4. **Test runner + lint** — Vitest configured and running a trivial passing test; ESLint + Prettier configured and passing on the skeleton.
5. **podman compose stack** — a compose file that brings up the web app container and the worker container only. Appwrite and the mail server are external (already running elsewhere) and are NOT spawned by this stack; they're referenced via `.env`.
6. **Auth gate** — a minimal single-operator login (Appwrite session) that gates every app route. No user-management UI, no roles, no sign-up — just a gate so the app is safe to expose and reach on the go. Every later stage assumes a logged-in operator.

## Acceptance criteria
- [ ] `podman compose up` starts the web app and worker with no manual steps beyond initial `.env` config.
- [ ] The web app is reachable in a browser and shows a placeholder home page.
- [ ] Appwrite connection succeeds: a health-check route/log confirms a successful handshake against the external instance using `.env` values.
- [ ] The worker process boots and stays running as its own container, separate from the web app.
- [ ] `npm test` (or equivalent) runs Vitest and exits green.
- [ ] `npm run lint` (or equivalent) passes with zero errors on the skeleton.
- [ ] Visiting any app route while logged out redirects to login; logging in (Appwrite session) grants access.
- [ ] No newsletter-specific code, collections, or data exists yet.

## Dependencies
- None. This is the first stage.

## Out of scope
- Appwrite collection/schema definitions (deferred to the stages that need them).
- Any pipeline logic (RSS, LLM, scraping) — that is stage 01.
- Any newsletter, run, or prompt data models.
- A user-management UI, roles, or multi-user support.
- Spawning Appwrite or a mail server inside the compose stack — both are external.
- CI pipeline configuration (can be added when the PM wants it; not required for this stage).

## Open questions
- **Appwrite auth mechanism**: does the operator log in via an Appwrite user account already created in the shared instance, or should stage 00 create one operator user as part of setup? (Likely: a pre-existing operator account; confirm at spec time.)
- **Repo layout**: monorepo with separate `web/` and `worker/` packages sharing a common module, or a single Next.js app with a worker entrypoint? (Recommendation to finalize at spec time: shared workspace so pipeline code is written once and used by both.)
- **Health-check surface**: should the Appwrite handshake check be a visible UI element, a log line, or a dedicated status route? (Recommendation: a `/health` route returning JSON — reusable by later stages and podman healthchecks.)
