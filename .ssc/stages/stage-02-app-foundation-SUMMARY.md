# Stage 02: App Foundation — Summary

## What this stage delivered

The two things every later stage will sit on top of now exist for real and have proven they work together. The worker no longer assumes the Appwrite database is shaped by hand — it now creates the database and the one proving collection (`health_check`) from a TypeScript module in the repo on every boot, idempotently. A new environment can be brought up to a working state with nothing more than `podman compose up` and an environment file with the Appwrite connection details; no console-clicking, no out-of-band scripts.

The web app now has a real layout. Logging in lands on a dashboard that fills the screen with a sidebar on the left (app brand + theme toggle, six nav links in a fixed order, the user's email and a logout button in the footer) and a content area on the right. The dashboard also serves as the stage's proving artifact: a "Database health" widget that creates, reads, and deletes a test document in the proving collection on every page load, displaying a three-step result. When something fails, the card surfaces the Appwrite error, marks the step red, and tells you whether the worker has been started yet — no 500 page, no guesswork. A "Re-run" button redoes the check on demand.

The visual language is now defined in one place — `web/app/globals.css` — and every UI building block the later stages will need (buttons, form inputs, textarea, select, dialog, table, card, badge, alerts, sidebar, toast notifications) is installed from that single source. From here on, domain stages reuse these primitives; they don't reinvent styling.

## How it maps to the plan

- **Stage Intent:** Lay the two foundations every later stage builds on but none had explicitly accounted for: an Appwrite database provisioned from schema-as-code in the repo, and a GUI shell with a real layout, navigation, shared component baseline, and visual language.
- **Acceptance criteria met:**
  - [x] On a clean Appwrite project, starting the worker provisions the project's database and the health-check collection with its declared attributes, idempotently — re-running does not error and does not duplicate.
  - [x] The schema module is the sole source of DB structure; no manual console-only setup is required to bring a fresh environment to a working state.
  - [x] The web app, behind the existing auth gate, renders a layout with sidebar navigation and a content area; navigating to each nav section routes without error.
  - [x] The dashboard page renders a DB health card that successfully creates, reads, and deletes a document in the health-check collection and displays the result.
  - [x] The shared components (form inputs, table, modal, toast) and the theme/appearance language are defined in one place and used by the dashboard and shell.
  - [x] A later stage's developer (or the PM) can add a new collection by adding a declaration to the schema module and restarting the worker; no other steps required.
- **North star link:** This stage does not deliver any newsletter functionality yet — but without it, every data-bearing feature and every GUI page from stage 03 onward would have reinvented persistence and UI scaffolding ad hoc. The self-hosted webapp vision depends on a cohesive shell that grows stage by stage; this is the foundation for that growth, and the dashboard health card is the first live proof that schema code, worker boot, Appwrite client, and GUI compose end to end. The PM's "configure, run, deliver — all in one place" experience now has the frame around it.

## What was built

- **Feature 01 — Schema-as-code provisioner:** a `shared/src/schema/` module declaring the database (`newsletter_db`) and one proving collection (`health_check`, with two attributes) as pure data, plus a provisioner function called by the worker on every boot that creates what's missing, swallows 409 conflicts as benign races, warns on attribute drift (type or size mismatch) without altering the live attribute, and never logs secrets. The provisioner handles all four declared attribute types (string, datetime, number, boolean) with `default` values honored.

- **Feature 02 — GUI shell + layout:** a responsive sidebar layout rendered behind the existing auth gate. The shell is built on Tailwind CSS v4 + shadcn/ui, themed via `next-themes` with a system-default + light/dark handling. Sidebar has six pinned nav sections (Dashboard, Newsletters, Runs, Schedules, Prompts, Delivery) in fixed order, a theme toggle, user email, and logout button. The login page is restyled to match.

- **Feature 03 — Shared component baseline + visual language:** the reusable building blocks every later GUI stage will import — buttons, inputs (text/password/number/disabled/error), textarea, select, dialog, table, card, badge, alerts — plus a global toast stack wired into the root layout. A hidden `/design-system` page exercises every primitive. One integration test covers the toast stack; the rest are visual.

- **Feature 04 — Dashboard DB health card:** a "Database health" widget on the dashboard home that runs a three-step round-trip (create → read → delete) through the `health_check` collection on every page load, displays a stepper with per-phase timings, a green "Healthy" or red "Unhealthy" badge, and a destructive Alert when a step fails — including an operator-actionable hint that the worker may not have run yet. A "Re-run" button redoes the check.

- **Feature 05 — Hardening — review-stage-02-app-foundation-2026-07-01:** eight review findings closed (lint dead-stores, worker bundle externalization, single-source `APP_NAME`, missing-size drift detection on string attributes, health-check cleanup on read failure, collapsed toast API, login `noValidate` for an actually-reachable Alert, dead-filter removal in the health card).

- **Feature 06 — Remediation:** the earlier cross-feature regression's three findings closed (provisioner now handles all four declared `AttributeType` members including `number` and `boolean`, `default` values are now passed through to Appwrite via `xdefault`, the Appwrite API-key scope doc was updated to require write scopes for the new operations).

## Decisions and deviations

- **Worker build externalization form:** the worker build script uses per-package `--external:jsdom --external:node-appwrite --external:feedsmith --external:turndown --external:@mozilla/readability` rather than the spec's `--packages=external` shorthand. Same effect — runtime-resolved dependencies stay out of the bundled worker output — but spelled out per package. This deviation was made when implementing the feature and the resulting bundle is small (67 KB).

- **Stage-00 API-key scope doc drift:** stage-00's feature-02 spec historically claimed the Appwrite API key needed only `databases.read`. Stage-02's provisioner performs database/collection/attribute writes, so the feature-01 spec (in this stage) was amended to require `databases.write` as well. The stage-00 spec is the historical record and was deliberately not edited; a reader following only stage-00 alone will be misled. A small follow-up cross-reference would close that loop in a future pass.

- **`HEALTH_CHECK_COLLECTION_ID` is a hand-maintained sibling of `COLLECTIONS[0].id`** by design (per feature-04 spec). No compile-time guard exists to keep them in sync; a passing unit test asserts the literal value matches the constant.

- **Orphan `health_check` documents are intentionally allowed** on partial-pipeline failures (e.g. read fails after create succeeds). The collection is a proving artifact, not a domain store; a best-effort cleanup delete runs on the read-failure path, but a failure of that cleanup is swallowed. Cleaning them out belongs to a future hardening pass.

- **No PM manual re-check is required for stage-close** — the per-feature verifications already captured PM manual gates (Stage B) for the dashboard health card and the shell, both of which the PM confirmed during feature verification. The cross-feature regression pass is satisfied by automated evidence (342 tests passing, build/lint/typecheck green on three packages, 11 routes built, end-to-end code traces).

## Deferred and out of scope

These were deliberately deferred per the stage file's "Out of scope" and surfaced as latent concerns during the cross-feature regression pass:

- **Per-newsletter and per-user data segregation** beyond the existing single-user auth gate. Stages 03+ will define the domain collections using the same schema module; cross-tenant isolation is not needed for the single-operator use case.
- **Schema migrations and rollback tooling.** The provisioner is create-if-absent only; destructive changes (rename, retype, drop) are explicitly out of scope for V1.
- **`SchemaAttribute.array?` field is declared but the provisioner never honors it.** This becomes important the moment stage 03 declares a multi-valued attribute (e.g. `topics` or `dislikedTopics`), at which point a developer would have to extend the provisioner — contradicting the "no other steps required" contract. A future hardening feature should add `array` support to all four `create<Type>Attribute` call sites.
- **`attributeMatches` ignores `required` and `default` for drift detection.** If a future stage changes a declared attribute from `required: true` to `required: false`, the change is silently treated as a match. The implications are V1-acceptable (no current attributes exhibit this) but should be revisited before destructive schema edits become a real possibility.
- **Per-stage API-key scope drift.** Future stages that touch a non-database Appwrite service (storage, functions, users) will widen the scope again; the stage-02 scope doc should be revisited then.

## Open questions for the next stage

- **Array attribute wiring (stage 03 will hit this):** if stage 03 (newsletter-config) declares `topics` or `dislikedTopics` as arrays, the provisioner will need an `array` patch feature before it can honor that contract. The cleanest approach is a small hardening feature ahead of stage 03's first spec — flag this during `ssc-plan` for stage 03.

- **Database region / project placement:** the Appwrite connection details live in `.env`; as the schema grows across many stages, the natural next step is a one-time operator check (or a CLI smoke) that confirms the Appwrite project they're hitting is the intended one. Not a stage-02 deliverable but worth flagging.

- **Next-stage planning:** the next stage per the plan is `stage-03-newsletter-config`. A new `ssc-plan` session should pick it up from here.
