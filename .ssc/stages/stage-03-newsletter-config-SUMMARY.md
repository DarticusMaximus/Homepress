# Stage 03: Newsletter Config — Summary

## What this stage delivered

The operator can now manage every RSS source and every newsletter definition entirely through the web GUI — no more YAML, no more shell. There is a dedicated **Feeds** page at `/feeds` where sources are first-class entities: create, edit, list, delete, and run a one-shot **Test feed** action that proves the source is reachable and that at least one article body can actually be retrieved. Test results land on the feed as a visible status (`untested` / `ok` / `failed`) with a short human-readable reason on failure.

There is a **Newsletters** page at `/newsletters` where the operator defines each newsletter by name, topics, disliked topics, audience (free-text voice/needs brief), item count, and date-range lookback — with sensible defaults (16 items, yesterday) ready to go. Editing a newsletter opens a Feeds section where the operator can attach and detach feeds from the shared library. The attach UI only offers feeds that have already cleared the qualification gate, and the server enforces the same rule — there is no path that lets a broken source become part of a definition.

The list pages work on a phone too: the desktop table turns into stacked cards below the `md` breakpoint, with every field and every action still present (same edit, delete, test). This pattern is shared, not page-local, so the runs, schedules, and prompts pages coming in later stages will look the same.

Beneath the GUI, three Appwrite collections (`feeds`, `newsletters`, `newsletter_feeds`) are declared in schema-as-code and provisioned idempotently on worker boot — every later stage can import the collection-id constants and the data vocabulary without hardcoding strings.

## How it maps to the plan

- **Stage Intent:** Make newsletter definitions and their RSS sources manageable without YAML. The operator maintains a first-class feed library with a pre-use qualification gate, then builds newsletters that only attach feeds that have proven `ok`. That is the first operator-facing domain capability.
- **Acceptance criteria met:**
  - [x] On a clean Appwrite project, starting the worker provisions the feed, newsletter, and attachment collections with their declared attributes, idempotently.
  - [x] The operator can create, edit, list, and delete a feed from a dedicated Feeds page entirely through the GUI.
  - [x] "Test feed" on a known-good feed reaches status `ok`; on a bad URL or blocked/unscrapeable case, status is `failed` and a human-readable reason is visible without inspecting logs.
  - [x] A newsletter cannot attach a feed that is not `ok` — both the UI and the write path reject non-`ok` attachments.
  - [x] The operator can create a newsletter with name, topics, disliked topics, audience, item count, and date-range lookback; attach one or more `ok` feeds; edit and save; and see the same data after a full page reload.
  - [x] One `ok` feed can be attached to two different newsletters at the same time.
  - [x] No YAML or file editing is required for any of the above.
  - [x] On a phone-width viewport, the Feeds list is usable without horizontal scrolling: stacked cards with the same fields and actions as the desktop table.
  - [x] On a desktop-width viewport, the Feeds list still uses the table layout.
  - [x] The responsive list pattern is shared (not page-local only) so Feature 04 newsletter list and later list surfaces can adopt it.
  - [x] This stage does not add on-demand run trigger, schedule, model/prompt editing, delivery, or ongoing feed-health-from-runs.
- **North star link:** The product exists to replace a fragile CLI/YAML workflow with a GUI. Before this stage the operator could log in but had no way to configure *what* to generate — every definition lived in a file. Now sources and newsletters are first-class GUI objects, durably persisted, with a qualification gate that prevents the legacy "discover a dead feed weeks later by digging through logs" failure mode.

## What was built

- **Feature 01 — Feeds + newsletters schema:** Three new Appwrite collections (`feeds`, `newsletters`, `newsletter_feeds`) declared in the existing schema-as-code module and provisioned idempotently on worker boot. Provisioner now honors `SchemaAttribute.array` (which Stage 02 had declared but not wired). Exports `FEEDS_COLLECTION_ID`, `NEWSLETTERS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, `FeedStatus` / `FEED_STATUSES`, `NewsletterDateRange`. Default `newsItems: 16` and `dateRange: "yesterday"` chosen for pipeline parity with `createNewsletterConfig`.
- **Feature 02 — Feed library page:** Dedicated `/feeds` route with sidebar nav (Feeds between Dashboard and Newsletters), a shared feed repository under `shared/src/feeds/` (CRUD + validation + URL-uniqueness check), and a GUI for list/create/edit/delete with read-only status display. Status Badge map: `untested` → secondary, `ok` → default, `failed` → destructive. Delete is blocked while the feed is attached to any newsletter. List fetches up to 100 documents, sorts in-memory by `updatedAt` desc, paginates 20 per page with default page 1 and clamp on empty high pages.
- **Feature 03 — Feed qualification test:** One-shot "Test feed" server action reuses Stage 01's `fetchFeeds` (`dateRange: "all"`) and `scrapeArticle` (pass requires `source === "extracted"` — RSS-body fallback is explicitly not a pass). Reasons are short operator-facing strings (`"Could not fetch the RSS feed"` / `"Feed has no articles"` / `"Feed items have no article links"` / `"Could not retrieve article content"`); full diagnostics go to server logs only. Per-row Test button on both desktop table and phone cards with Testing… state, success/failure toasts, and a visible reason on failed rows. Demoting a feed to `failed` does **not** detach existing newsletter attachments — that's a Stage 04 run-time concern.
- **Feature 04 — Newsletter list + definition form:** `/newsletters` route with shared newsletter repository under `shared/src/newsletters/` (CRUD + validation + chip parsing). Create form defaults `newsItems: 16` / `dateRange: "yesterday"`. Topics and disliked topics are chip lists (trim, case-sensitive dedupe within list, max 50 per list, max 128 chars per chip). Chip payloads travel as `topicsJson` / `dislikedTopicsJson` FormData fields; malformed JSON returns `validation` with no write. Edit/save persists the full field set including empty arrays. Deleting a newsletter cascade-deletes only its own `newsletter_feeds` rows — feed library documents are never touched. List uses the same sort + pagination as Feeds. No attach UI yet (that's feature 05).
- **Feature 05 — Attach feeds to newsletter:** Edit-only Feeds section on the newsletter dialog. Attached list shows feed name + status Badge + Detach; Attach control uses a shadcn Select bound to `eligibleFeeds` (status `ok` AND not already attached). Server write path in `shared/src/newsletters/attachments.ts` enforces the same gate: not_ok → reject, duplicate (newsletterId, feedId) pair → reject. Junction rows are plain `(newsletterId, feedId, createdAt)` documents — no Appwrite relationship attributes, no global feed-uniqueness rule (sharing across newsletters is allowed). Demoted feeds still appear in the attached list with a failed Badge and can be detached manually. Newsletters list gets a Feeds count column.
- **Feature 06 — Responsive list layout:** Shared `ResponsiveList` shell in `web/components/domain-list/` takes `{ table, cards }` ReactNode slots with `data-slot` hooks and Tailwind `hidden md:block` / `md:hidden` wrappers. Both branches are always mounted (CSS visibility, not conditional render). Feeds is the proving surface; Newsletters adopted the same pattern. Convention is pinned in `AGENTS.md` Project GUI conventions, `Plan.md` Carry-forward pins, and `product_spec.md` Implemented features so later stages (Runs, Schedules, Prompts, Delivery) build on it instead of inventing page-local layouts.
- **Feature 07 — Security & correctness hardening:** Built on top of the verified features 01–06 to close the four Medium findings from `review-stage-03-newsletter-config-2026-07-09`:
  - **SSRF guard:** feed URLs are now resolved and rejected if they hit loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, incl. cloud metadata `169.254.169.254`), or reserved ranges. Applied on both write path (`validateFeedUrl`) and Test-feed path (`qualifyFeed`), so internal addresses cannot be stored or fetched. A public hostname resolving into a blocked range is also rejected (DNS-resolution-aware check).
  - **Log redaction:** Shared `sanitizeAppwriteMessageForLog` helper applied in all three `wrapAppwriteError` sites (`shared/src/feeds/repository.ts`, `shared/src/newsletters/repository.ts`, `shared/src/newsletters/attachments.ts`). Thrown user-facing messages and `{ phase, code, message }` log shape are unchanged — only the `message` value is sanitized. Spy tests prove injected secrets don't reach the log.
  - **URL uniqueness:** Restored the spec-mandated `Query.equal("url", ...)` + `Query.limit(1)` shape; the prior capped-scan workaround has been removed and its false-constraint comment deleted. Duplicate detection now works regardless of feed count.
  - **N+1 on Newsletters page:** The page now issues exactly one `listFeeds` round-trip per load by passing the already-loaded library as a `feedsById` map into `listAttachmentsForNewsletter`. Counts and edit-dialog data render identically.

## Decisions and deviations

None of the verified features deviated from their locked decisions. Two small notes worth recording:

- **Feature 06 was executed before Feature 04** per the Plan.md carry-forward pin. This means the Newsletters list adopted `ResponsiveList` from the start (not as a follow-up patch).
- **Feature 07 hardening approach (b) for P1:** The hardening spec offered two approaches for the Newsletters page N+1 fix — call `listAttachmentCountsByNewsletter` once, or pass the library `feedsById` map into `listAttachmentsForNewsletter`. Approach (b) was chosen: it's strictly less work (one helper signature change, no dead code), still issues exactly one `listFeeds` per page load, and `listAttachmentCountsByNewsletter` was not built (would have been dead code given the approach chosen). This is explicitly listed as an acceptable alternative in the feature-07 spec.

## Deferred and out of scope

Per the stage file, these remain for later stages:

- On-demand run trigger, schedules, run records, resume-from-phase → **Stage 04**
- Ongoing feed health derived from production runs → **Stage 04** (Stage 03 owns pre-attach qualification only)
- Cross-run topic deduplication and its lookback → **Stage 05** (distinct from the per-newsletter fetch date-range lookback stored here)
- In-app issue reader and pipeline inspection → **Stage 06**
- Prompt template editing and per-newsletter model overrides → **Stage 07**
- Scheduling → **Stage 08**
- Delivery (email, RSS publication, export) → **Stage 09**
- YAML import / migration from the legacy Python setup (product non-goal)
- Audience presets or structured style picklists — free-text only
- Manual curation (pin/drop/reorder) and interest-learning thumbs — future directions

The "Demotion does not detach" pin and the "Stage 04 must treat attached-but-not-`ok` as invalid configuration at run time" pin are carried forward in `.ssc/stages/stage-03-newsletter-config.md` so the Stage 04 planner sees them.

## Open questions for the next stage

None specific to Stage 03. The next stage (Stage 04 — runs and history) inherits the carry-forward pins recorded in the stage file: feeds are first-class, attach-only-if-ok is a product rule that the run trigger must continue to enforce, demotion-does-not-detach means the run-time invalid-config handling must treat attached-but-not-`ok` as a configuration error rather than silently skipping or assuming Stage 03 cleaned up.

When Stage 04 plans, it should also revisit the Plan.md pin about `SelectionResult.failures` (from Stage 01 feature-06) and consider whether to add a `not-selected` telemetry category to `SelectionFailure.reason` when run records are designed.