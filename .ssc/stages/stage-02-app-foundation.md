# Stage 02: App Foundation

## Intent
Lay the two foundations every later stage builds on but none had explicitly accounted for: an Appwrite database provisioned from schema-as-code in the repo, and a GUI shell with a real layout, navigation, shared component baseline, and visual language. Without these, stages 03 onward would each reinvent persistence and UI scaffolding ad hoc, or silently assume they already exist. This stage makes them real and proves them together — a dashboard page that round-trips a trivial collection through the provisioned DB confirms the full stack works end-to-end before any domain feature is built on top.

## Goal
A running app where: (a) the worker provisions the project's Appwrite database and collections idempotently on boot from a TS schema module in the repo, so the DB structure is versioned alongside the code and grows stage by stage; (b) the web app presents a real layout (sidebar nav + content area), a dashboard/home page that renders a DB-connected health card, and a shared component baseline (form inputs, table, modal, toast) plus a theme/appearance language that later GUI stages follow. Auth from stage 00 gates the whole shell.

## Features
1. **Schema-as-code provisioner** — a TS module declaring the Appwrite database + collections/attributes the app needs, run idempotently by the worker on startup (create-if-absent for database, collections, attributes; safe to re-run). This stage ships the pattern plus one trivial proving collection (the health-check entity); later stages add their own domain collections to the same module. The repo, not the console, is the source of truth for DB shape.
2. **GUI shell + layout** — a real app layout (sidebar nav + content area), routed pages behind the existing auth middleware, a dashboard/home page as the default landing, and the navigation structure (sections for newsletters, runs, prompts, etc.) that later stages fill in. Empty/nav-placeholder pages are acceptable for sections whose features live in later stages.
3. **Shared component baseline + visual language** — form inputs (text, textarea, number, chip-list, select), table, modal/dialog, toast/notification, and a core theme/appearance (colors, typography, spacing scale, light/dark handling) that the rest of the GUI development follows. Established as the default here so every later stage inherits it rather than re-deciding.
4. **Dashboard DB health card** — the stage's proving artifact: a dashboard widget that round-trips a document through the health-check collection (create, read, delete) and shows DB connectivity/status. Demonstrates, end-to-end, that schema provisioning, the Appwrite client, the worker boot path, and the GUI shell all compose.

## Acceptance criteria
- [ ] On a clean Appwrite project, starting the worker provisions the project's database and the health-check collection with its declared attributes, idempotently — re-running does not error and does not duplicate.
- [ ] The schema module is the sole source of DB structure; no manual console-only setup is required to bring a fresh environment to a working state.
- [ ] The web app, behind the existing auth gate, renders a layout with sidebar navigation and a content area; navigating to each nav section routes without error (placeholder content is acceptable where the section's real features live in a later stage).
- [ ] The dashboard page renders a DB health card that successfully creates, reads, and deletes a document in the health-check collection and displays the result — proving the full stack (provisioner → worker → Appwrite client → GUI) composes.
- [ ] The shared components (form inputs, table, modal, toast) and the theme/appearance language are defined in one place and used by the dashboard and shell — no ad hoc styling or one-off components in this stage's pages.
- [ ] A later stage's developer (or the PM) can add a new collection by adding a declaration to the schema module and restarting the worker; no other steps required.

## Dependencies
- Stage 00 complete: runnable TS workspace, Appwrite client wired, auth gate in place, worker process, podman compose, `.env` with Appwrite config.

## Out of scope
- Newsletter, feed, run, prompt, schedule, or delivery domain entities — stages 03, 04, 07, 08, 09 respectively. The schema module establishes the pattern with only the health-check collection this stage.
- Real domain pages beyond nav placeholders — each later stage builds its own.
- Per-newsletter or per-user data segregation beyond the single-user auth gate already in place.
- Migrations/rollback tooling — idempotent create-if-absent is sufficient for V1; explicit migrations are a future concern if the schema ever needs destructive changes.
- Re-provisioning or migrating data from any existing system (non-goal, fresh start).

## Open questions
- **Schema declaration style** — declarative object literals (one TS object per collection describing its attributes) vs. an imperative builder (fluent API calls). Recommendation: declarative literals — easiest to scan and diff as the schema grows stage by stage.
- **Provisioner run trigger** — on every worker boot, on a CLI flag only, or on a separate `provision` script? Recommendation: every boot (idempotent, cheap), so environments self-heal.
- **Theme approach** — Tailwind primitives + a small design-token layer, or a ready-made component library (shadcn/ui, etc.)? This is a feature-internal decision for `ssc-spec` to grill out, but the stage should pin the choice so later stages inherit it.
- **Nav structure** — flat (Newsletters, Runs, Prompts, Schedules, Delivery) or grouped by concern? Recommendation: flat for a single-user internal tool; revisit if it grows.
- **Light/dark in V1** — both, or just one? Recommendation: both, since the token layer is being defined now anyway.

## Pins carried forward

- **Schema-as-code is the contract for all later data-bearing stages.** Stages 03 (newsletter-config), 04 (runs-and-history), 07 (prompt-and-model-management), 08 (scheduling), 09 (delivery) each add their own collections to the schema module established here — they do not provision collections out-of-band or via the console. The provisioner pattern, the declaration style, and the run trigger chosen by this stage's feature spec are binding on later stages.
- **Shared components and visual language are the GUI contract.** Later GUI stages use the components and theme established here; they do not introduce a second component library or an alternate styling approach. If a later stage needs a component this stage didn't baseline, it extends the shared set, not a one-off.