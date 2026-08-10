# Stage 11: Simplify and Package

## Intent

Make the codebase shippable for initial V1 release — collapse the GUI and code drift that accumulated across Stages 02–10, make failed pipeline runs diagnosable without guessing, run a final quality pass so a sober ship call is honest, and leave a documented podman compose path that brings up web + worker on a Linux box against an existing Appwrite instance using only `.env` for connection and secrets. This stage serves the north star’s self-hosted constraint: the operator should be able to deploy and operate without tribal knowledge or undocumented steps.

## Goal

After this stage, a clean checkout with a filled `.env` can `podman compose up` (images build; web and worker start), talk to external Appwrite, and pass typecheck/lint/tests; duplicated list/UI plumbing and obvious dead leftovers are cleaned up; a halted or empty-fatal run is diagnosable from stdout, the run failure message, and Inspect. No new end-user product capabilities beyond this ops observability.

## Features

1. **Shared list/UI DRY** — Collapse duplicated table/card list patterns and obvious repeated GUI plumbing deferred from Stage 10 into a shared pattern that still follows the Stage 03 responsive convention (table on wide, cards on narrow).
2. **Dead code & consistency sweep** — Remove unused leftovers; align drifted naming and patterns where cheap and safe, without changing operator-visible behavior.
3. **Phase failure observability** — When a run dies mid-pipeline, stdout and the run’s failure message carry the detail the pipeline already computed (halt reason, consecutive errors, short sample of per-article/LLM errors) instead of a one-liner; persist that summary and show it on Inspect for the failed phase (same idea as selection drops — not a log viewer or live tail).
4. **Final quality gates** — `pnpm typecheck`, `pnpm lint`, and the test suite green; fix anything that would block an honest “ship it” call (no new product behavior beyond Feature 03).
5. **Production packaging** — Compose file, Dockerfiles, and `.env.example` good enough that a filled `.env` builds and starts web + worker against external Appwrite (Appwrite and mail are not spawned by this stack).
6. **Deploy documentation & smoke** — Short in-repo operator doc for Linux/podman deploy; after compose up, a clear “stack is alive” check (e.g. health/handshake) so a successful deploy is verifiable, not guessed.

## Acceptance criteria

- [ ] Domain list pages that used copy-pasted table/card plumbing share one pattern; wide = table, narrow = cards, same fields and actions (Stage 03 convention preserved).
- [ ] A halted tag or score run (and other terse empty-fatal exits) is diagnosable from the run failure message and Inspect without guessing; stdout includes the same structured detail.
- [ ] Typecheck, lint, and tests pass with no known ship-blocking failures.
- [ ] From a clean checkout with a filled `.env`, `podman compose up` builds and starts web + worker; Appwrite is referenced only via env (not started by compose).
- [ ] In-repo docs describe Linux/podman deploy (env fill → compose up) without undocumented tribal steps.
- [ ] After compose up, a health/handshake signal confirms the stack reached Appwrite, or fails loudly.

## Dependencies

- Stage 10 (V1 polish) must be complete — operator UX is launch-ready; this stage packages, cleans, and hardens ops visibility, it does not invent subscriber-facing product surfaces.
- Stage 00’s compose/Dockerfile/.env baseline is the starting point to harden, not rebuild from scratch.
- Stage 04/06 run + Inspect surfaces are the home for failure summaries — extend them; do not invent a separate Logs product.

## Out of scope

- Publishing container images to a registry; version tags or changelog as a release product.
- Spawning Appwrite or an SMTP server inside the compose stack.
- Append-only per-run log streams, live log tail, or a dedicated Logs page.
- New end-user product features (manual curation, interest signals, Settings page, nav regrouping, etc.).
- Rewriting the pipeline or changing Stages 01–09 semantics beyond richer failure capture/display.
- Customer-facing marketing or public docs beyond operator self-host instructions.

## Open questions

- Exact scope of which list pages get DRY’d in Feature 01 vs left alone if already thin — grill in `ssc-spec` for feature 01.
- Whether the post-up smoke is an automated compose healthcheck, a documented curl to `/health`, or both — grill in `ssc-spec` for feature 06.
- How aggressive the consistency sweep may be (rename-heavy vs delete-only) — grill in `ssc-spec` for feature 02.
- How much of the per-article failure list is persisted vs truncated in the failure message / Inspect — grill in `ssc-spec` for feature 03.
