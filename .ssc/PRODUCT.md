# PRODUCT.md

## Product name
**Homepress** — a self-hosted press for curating and reading a personal digest from the open web.

## Intent
A self-hosted webapp that filters RSS sources into a short, relevant digest the operator actually has time to read — and can also deliver that digest as a newsletter (email, RSS, download). Publications are still configured, scheduled, and generated in the GUI; reading the digest is the daily product, publication is a delivery path.

## Problem
There is too much tech information produced each day for any one person to keep up with. Staying current means doom-scrolling aggregators, watching hours of YouTube, or wading through the hundreds of low-value articles sites now generate. The existing Python pipeline was built to solve this — filtering and condensing RSS sources down to the few items that matter — but it was unreliable and hard to manage: configuring feeds, topics, and models meant editing YAML by hand and re-running blindly. There is no visibility into runs, no way to preview before sending, no audit of what was scored or rejected, no way to tune generation prompts without digging through source code, and scheduling requires external cron plus a shell. The result is friction: newsletters get generated less often than intended, mistakes are hard to spot, and tuning one newsletter risks breaking another. The core filtering problem is solved; the operability problem is not.

## Audience
A single operator (the author) who runs several newsletters for personal use and a small set of RSS-reader subscribers. The operator is technical, comfortable self-hosting, and wants control over content, models, and prompts without the overhead of editing config files or babysitting a CLI. Subscribers consume finished newsletters via email or their preferred RSS reader; they never touch the app.

## Goals
1. **Condense and filter.** Each newsletter must meaningfully reduce a large set of RSS sources down to a small, relevant, diverse set of items the operator can read in minutes — the core value the product exists to deliver.
2. **Manage all newsletter definitions** (feeds, topics, disliked topics, audience, item count) through a GUI — no YAML editing required.
3. **Generate newsletters on a per-newsletter schedule AND on demand** from a button, with a visible run history and per-run status.
4. **Preview generated newsletters in-app before delivery**, and inspect intermediate pipeline state (fetched articles, scores assigned, items selected by diversity, draft produced).
5. **View and edit the LLM prompt templates** (drafter, editor, scorer, tagger) through the GUI — the reusable templates only, not the per-run data — so prompts can be fine-tuned without touching code.
6. **Deliver finished newsletters via email, as a published RSS feed** (so RSS readers can subscribe), **and as downloadable export.**
7. **Configure LLM models per newsletter through the GUI**, with a global default and per-newsletter overrides — because model choice affects both quality and reliability (e.g. some providers censor certain news inputs and cause generation to fail).
8. **Avoid topic repetition across consecutive issues** ("temporal diversity") — the system must retain run history and suppress the same *topic* (not just the same article) from recurring in recent issues, over a configurable per-newsletter lookback window. The legacy system retained nothing, so the same subject surfaced day after day.
9. **Surface feed health** — detect and alert when an RSS feed goes stale or dead, so silent data loss (a feed quietly 404ing) doesn't go unnoticed for weeks.

## Non-goals
- Multi-tenant access or public sign-up. This is a single-user system; auth is a gate to the app, not a user-management feature. Household admin/reader roles are a future direction, not this product’s tenancy model.
- A mobile application. Responsive web is sufficient.
- Marketing pages or a public product site. Reader surfaces (Home, issue, listen) are daily-use chrome, not a marketing site; factory/admin stays internal-tool quality.
- Keeping or wrapping the existing Python codebase. The pipeline is fully rewritten in TypeScript.
- Real-time or push-based article ingestion. Runs are batch jobs on a schedule or manual trigger.
- A built-in email server. Email delivery uses a configured external SMTP/transactional service.
- Migration of data from the existing Python setup. Fresh start; newsletters are reconfigured in the new GUI.

## Future directions (explicitly deferred, not V1)
- **Manual curation step** — an interactive pin/drop/reorder pass between selection and drafting (or an editable draft before sending), letting the operator apply judgment on top of the LLM's output.
- **Interest signal** — a lightweight thumbs-up/down mechanism to tune curation beyond static interest/disinterest lists, without full ML personalization.
- **Issue title + summary** — a cheap-model pass after draft that stores a real issue title and dek (today’s display title is the first markdown heading, usually the lead story).
- **Regenerate draft** — re-run only the drafter on a completed run, because a truncated digest still counts as success if any draft bytes returned.
- **Household roles** — an admin account (factory) and a reader account (Home / issues / listen only). Not multi-tenant, not public sign-up.

## Constraints
- **Self-hosted on a single Linux box**, delivered as a podman compose stack the operator controls. No managed SaaS dependencies except the OpenRouter LLM gateway.
- **Appwrite is already running** as a shared instance used by other projects. The newsletter app provisions its own database/collections within that existing instance rather than spinning up a new one.
- **Stack fixed:** Next.js frontend, Appwrite backend, TypeScript end-to-end. No Python runtime in the deployed system.
- **LLM access via OpenRouter only.** Models are configurable per newsletter, but the gateway is fixed.
- **Appwrite connection details and project config live in the project-root `.env`** (project ID, name, endpoint already present).

## Success criteria
- A new newsletter can be created, configured, and generated entirely through the GUI without touching files or a shell.
- Scheduled newsletters generate reliably at their configured times on the self-hosted box, with failures surfaced in the run history.
- Opening the app lands on Home: issue cards the operator can pick and read without factory chrome.
- A generated issue can be previewed in-app, then delivered via email, published to its RSS feed, and exported — all from the UI (factory / Admin).
- A run's intermediate state (articles fetched, scores assigned, items selected by diversity, draft produced) is inspectable for tuning.
- LLM prompt templates (drafter, editor, scorer, tagger) can be viewed and edited in the GUI and take effect on the next run without a redeploy.
- Per-newsletter model overrides can be set in the GUI; the global default covers the rest.
- Newsletter output quality matches or exceeds the current Python pipeline on the same inputs.
- The whole system runs as a single `podman compose up` on the self-hosted box with no manual steps beyond initial env config.
