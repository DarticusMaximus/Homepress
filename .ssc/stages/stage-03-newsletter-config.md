# Stage 03: Newsletter Config

## Intent

Make newsletter definitions and their RSS sources manageable without YAML. The operator maintains a first-class **feed library** with a pre-use qualification gate (reachable feed + scrapeable article content), then builds **newsletters** that only attach feeds that have proven `ok`. That is the first operator-facing domain capability: configure *what* to generate before runs, schedules, or delivery exist. It replaces hand-edited config and the old pattern of discovering dead or blocked sources only by digging through run logs.

## Goal

A running app where the operator can:

1. Manage RSS feeds on their own page (create, edit, list, delete), independent of any newsletter.
2. Run a one-shot **Test feed** that confirms (a) the feed is reachable and returns items and (b) at least one item’s article body can be retrieved — then records `ok` or `failed` with a visible reason.
3. Create and edit newsletters with name, topics, disliked topics, audience (free-text writing-style / needs brief), item count, and date-range lookback.
4. Attach feeds to newsletters with **enforced attach-only-if-ok**, and share the same feed across multiple newsletters (e.g. general tech, AI, and IT security with overlapping sources).

No generation, scheduling, or prompt/model editing is required for this stage to be useful: the operator leaves with durable, GUI-managed definitions ready for Stage 04 runs.

## Features

1. **Feeds + newsletters schema** — Domain collections for feeds, newsletters, and many-to-many attachment, declared in the existing schema-as-code module and provisioned idempotently on worker boot. Establishes the data contract every later data-bearing stage depends on for “which newsletter” and “which sources.”
2. **Feed library page** — Dedicated Feeds page (not nested only under a newsletter) with create, edit, list, and delete for feed entities (name, URL, optional notes; status driven by testing). Supports feeds as first-class entities so sources can be shared and qualified once.
3. **Feed qualification test** — Operator-triggered “Test feed” action: one-shot fetch of the RSS feed (must return items), then retrieve content for **one** article. Success → status `ok`; failure → status `failed` with a visible reason in the UI (no log-diving). Reuses the Stage 01 RSS fetcher and article scraper; does not reimplement scraping.
4. **Newsletter list + definition form** — List, create, edit, and delete newsletters. Definition fields: name; topics and disliked topics (chip-lists); audience as free-text (short sentence or two for voice and reader needs — any preferred style, not presets); item count; date-range lookback for fetch. All fields persist and reload correctly.
5. **Attach feeds to newsletter** — On the newsletter form, attach/detach feeds from the library. **Only feeds with status `ok` may be attached** (enforced in UI and on the server). The same feed may attach to multiple newsletters; detaching does not delete the feed.
6. **Responsive list layout** — On narrow viewports, the Feeds list switches from a desktop table to stacked cards with the same data and actions; on wider viewports the table remains. Establishes the shared table-desktop / cards-phone list convention that Features 04–05 and later list pages must reuse (not a Feeds-only one-off).

## Acceptance criteria

- [ ] On a clean Appwrite project, starting the worker provisions the feed, newsletter, and attachment collections with their declared attributes, idempotently — re-running does not error and does not duplicate.
- [ ] The operator can create, edit, list, and delete a feed from a dedicated Feeds page entirely through the GUI.
- [ ] “Test feed” on a known-good feed reaches status `ok`; on a bad URL or blocked/unscrapeable case, status is `failed` and a human-readable reason is visible in the UI without inspecting logs.
- [ ] A newsletter cannot attach a feed that is not `ok` — both the UI and the write path reject non-`ok` attachments.
- [ ] The operator can create a newsletter with name, topics, disliked topics, audience (free-text), item count, and date-range lookback; attach one or more `ok` feeds; edit and save; and see the same data after a full page reload.
- [ ] One `ok` feed can be attached to two different newsletters at the same time.
- [ ] No YAML or file editing is required for any of the above.
- [ ] On a phone-width viewport, the Feeds list is usable without horizontal scrolling: each feed appears as a card (or equivalent stacked layout) exposing the same fields and actions as the desktop table (name, URL, status, notes, updated, Edit/Delete/Test).
- [ ] On a desktop-width viewport, the Feeds list still uses the table layout (no regression to desktop density).
- [ ] The responsive list pattern is shared (not page-local only) so Feature 04 newsletter list and later list surfaces can adopt it without reinventing breakpoints or card structure.
- [ ] This stage does not add on-demand run trigger, schedule, model/prompt editing, delivery, or ongoing feed-health-from-runs (those belong to later stages).

## Dependencies

- Stage 02 complete: schema-as-code provisioner pattern, GUI shell + nav placeholders, shared form/table/modal/toast components and visual language, auth gate.
- Stage 01 complete: shared RSS fetcher and article scraper available for the qualification test path.

## Out of scope

- On-demand or scheduled generation, run records, resume-from-phase (Stage 04).
- Ongoing feed health derived from production runs (Stage 04) — Stage 03 owns pre-attach qualification only.
- Cross-run topic deduplication and its lookback (Stage 05) — distinct from the per-newsletter fetch date-range lookback stored here.
- In-app issue reader and pipeline inspection (Stage 06).
- Prompt template editing and per-newsletter model overrides (Stage 07).
- Scheduling (Stage 08) and delivery (Stage 09).
- YAML import or migration from the legacy Python setup (product non-goal: fresh start).
- Audience presets or structured political/style picklists — free-text only.
- Manual curation (pin/drop/reorder) and interest-learning thumbs (future directions).

## Open questions

- Default **item count** and **date-range lookback** for new newsletters — resolved in feature 01 toward pipeline parity (`newsItems` default 16, `dateRange` default `"yesterday"`); confirm or override when feature 04 specs the form.
- ~~Delete a feed that is still attached~~ — **resolved (feature 02):** block until detached; no cascade.
- ~~Exact status labels~~ — **resolved:** `untested` | `ok` | `failed`.
- ~~Re-test / promotion~~ — **resolved (feature 03):** re-test anytime; success → `ok` automatically; failure → `failed` (may demote prior `ok`); no extra confirmation.
- ~~**Feeds list mobile layout**~~ — **resolved (feature 06):** table on wide viewports, stacked cards on narrow; shared list convention for Features 04–05 and later stages. See Plan.md Carry-forward pins and AGENTS.md Project GUI conventions.

## Pins carried forward

- **Responsive lists (feature 06).** Domain list pages use table layout on desktop/tablet widths and stacked cards on phone widths. Same fields and actions in both presentations. Prefer a shared pattern over page-local CSS. Features 04–05 and later list UIs must follow this; do not ship new desktop-only tables without the narrow breakpoint.
- **Feeds are first-class; newsletters only attach.** Later stages must not reintroduce “URL typed only on the newsletter” as the primary model. Feed health (Stage 04) and runs operate on library feeds and their attachments.
- **Attach-only-if-ok is a product rule.** Stage 04 run trigger should continue to treat non-`ok` or missing attachments as invalid configuration, not silently skip the gate.
- **Demotion does not detach (feature 03).** Re-testing an attached feed to `failed` leaves `newsletter_feeds` rows in place. **Stage 04** must treat “attached but not `ok`” as invalid configuration at run trigger (and surface it clearly) — do not silently skip those feeds or assume Stage 03 cleaned them up.
- **Audience is free-text voice/needs brief**, injected into drafting in later stages — not a subscriber list and not presets.
- **Qualification test ≠ ongoing health.** Stage 03 proves a source once (or on demand); Stage 04 watches feeds across real runs for silent death/staleness.
- **Qualification pass requires scraped `extracted` content** (feature 03) — RSS-body fallback alone is not enough to mark a feed `ok`.
- **Schema-as-code and shared GUI contracts from Stage 02 still bind.** New collections go in the provisioner module; new UI uses the shared component baseline.
