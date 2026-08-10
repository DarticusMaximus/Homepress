# Homepress — Product Spec

Living tracker of product goals, stack, and implemented capabilities. Update as features land.

## Intent

**Homepress** — generate and manage curated newsletter publications via a pnpm monorepo (`web`, `worker`, `shared`), with SSC (Stupid Simple Coding) as the agent workflow framework.

## Tech stack

- **Monorepo:** pnpm workspaces (`web` Next.js, `worker` Node/tsx, `shared`)
- **Quality:** ESLint, Prettier, Vitest, TypeScript
- **Backend / data:** Appwrite (via MCP)
- **UI components:** shadcn/ui (via MCP)
- **Agent framework:** SSC under `.ssc/` (public blueprint + history). Local IDE skill/MCP mirrors (`.cursor/`, `.opencode/`, etc.) stay gitignored.

## Agent tooling (local, not committed)

| Item        | Location             | Notes                                                                                   |
| ----------- | -------------------- | --------------------------------------------------------------------------------------- |
| SSC artifacts | `.ssc/`            | Product blueprint, stage/feature specs, reviews, state — **committed**                  |
| Agent rules | `AGENTS.md`          | SSC framework + MCP usage notes                                                         |
| Local skills / MCP | `.cursor/`, `.opencode/`, `opencode.json` | Gitignored; use `opencode.json.example` for MCP shape                           |

## Implemented features

- SSC framework artifacts under `.ssc/` (stages 00–11)
- **Stage 00–02:** scaffolding, pipeline engine, app foundation (schema provisioner + GUI shell) — complete
- **Stage 03 / feature 01 — Feeds + newsletters schema:** Appwrite collections `feeds`, `newsletters`, `newsletter_feeds` declared in schema-as-code; provisioner honors `SchemaAttribute.array`; exports `FEEDS_COLLECTION_ID`, `NEWSLETTERS_COLLECTION_ID`, `NEWSLETTER_FEEDS_COLLECTION_ID`, `FeedStatus` / `FEED_STATUSES`, `NewsletterDateRange`
- **Stage 03 / feature 02 — Feed library page:** `/feeds` route with sidebar nav, shared feed repository (CRUD), and GUI for list/create/edit/delete with read-only status display (no Test feed action)
- **Stage 03 / feature 03 — Feed qualification test:** one-shot "Test feed" server action on `/feeds`; reuses Stage 01 `fetchFeeds` + `scrapeArticle` (pass requires `extracted`); persists `ok`/`failed` + `lastTestError` (cleared on ok); per-row Test button with Testing… state, toasts, and reason column/line; demotion does not detach attachments
- **Stage 03 / feature 04 — Newsletter list + definition form:** `/newsletters` route with shared newsletter repository (CRUD) and GUI for list/create/edit/delete; chip inputs for topics/disliked topics (strict JSON parse, both keys always submit), create defaults 16 items / yesterday; in-memory sort (no `Query.orderDesc`), 20/page pagination (`?page=`), responsive table/cards, toasts + close on success; no attach UI
- **Stage 03 / feature 05 — Attach feeds to newsletters:** edit-only Feeds section on newsletters with attach/detach server actions via the `newsletter_feeds` junction; attach limited to `ok` feeds (attach-only-if-ok), cross-newsletter sharing allowed, Feeds count column on the list (table + card); demotion does not auto-detach (stage 04 owns that)
- **Stage 03 / feature 06 — Responsive domain lists:** shared `ResponsiveList` (table `md+` / cards below `md`); Feeds is first consumer
- **Stage 03 / feature 07 — Security & correctness hardening:** feed URLs are now SSRF-checked (private/loopback/link-local/cloud-metadata rejected on create/update + Test-feed) before any fetch; internal hardening adds Appwrite-error log redaction, correct URL-uniqueness for >100 feeds, and N+1 elimination on the attachments read path
- **Stage 04 / feature 04 — Feed operational health:** feeds track `operationalHealth` (`healthy`/`unhealthy`) via consecutive fetch-failure counting in the run pipeline; dashboard `FeedsHealthCard` surfaces unhealthy count with a link to `/feeds?health=unhealthy`, and the Runs page shows failed-feed resolution + unhealthy badges
- **Stage 04 / feature 06 — Run retention:** configurable retention window (default 30 days) with automatic purge; preserves each newsletter's latest three completed runs; `/runs` page has Save + Clean up now controls; worker runs purge on boot + 24h interval
- **Stage 05 / feature 01 — Lookback config:** per-newsletter `lookback` field (integer 0..10 inclusive, default 3, 0 disables cross-run topic suppression) on the newsletters collection with form control; schema/persistence/validation only (no pipeline wiring yet)
- **Stage 05 / feature 02 — Lookback topic load:** shared loader (`loadLookbackTopics`) returning parsed `topicSummary` topics from a newsletter's latest N completed runs (same-newsletter, completed-only, ordered by `endedAt||startedAt` desc matching retention); `lookback <= 0` is a no-op skipping Appwrite; malformed summaries degrade to `[]`; pure helpers `parseRunTopicSummary` + `selectLookbackCompletedRuns` exported for testing
- **Stage 05 / feature 03 — Pre-MMR semantic suppress:** cross-run topic suppression applied before MMR selection, comparing candidate title+tags embeddings against lookback topics over a cosine threshold; items at/above the threshold are hard-dropped, and the run persists a `suppressSummary` (count + items) for downstream consumption
- **Stage 05 / feature 04 — Suppress visibility:** suppression count, suppressed titles, and matched prior issue shown on the Runs list (table + cards)
- **Stage 05 / feature 05 — Threshold env config:** documented operator `.env` variable `CROSS_RUN_SIMILARITY_THRESHOLD` (default 0.85, clamp `[0,1]`, `>=` hard-drops before MMR) with a committed `.env.example` template + README Environment section and contract-guard tests pinning key/default/parse against feature 03 exports; worker restart required to apply changes, no GUI
- **Stage 05 hardening — review 2026-07-13 (P1/T1/T2/U1)**
- **Stage 06 / feature 01 — Issues list:** top-level Issues nav (`/issues` after Newsletters, before Runs); `listIssues` filters completed runs with non-empty `checkpointDraftId`; fallback display title + newsletter + date; newsletter filter; 20/page pagination; ResponsiveList table+cards with Open → `/issues/[runId]`
- **Stage 06 / feature 02 — Issue reader:** `/issues/[runId]` loads draft checkpoint markdown via `loadIssueDraft`; GFM render (`react-markdown` + `remark-gfm` + typography `prose` 65ch); chrome = Back to Issues + newsletter·date + fallback title; locked not-available / load-error copy; new-tab links; no TOC/Inspect/heading title
- **Stage 06 / feature 03 — Display title:** `extractFirstMarkdownHeading` + `resolveIssueDisplayTitle` (ATX/setext, fence-aware); reader chrome uses heading when present else `{newsletter} — {date}`; Issues list enriches titles for current page only via concurrent draft loads (`resolveIssueDisplayTitlesForRuns`); per-row load failure → fallback; no schema attribute, no LLM, body heading unstripped
- **Stage 06 / feature 04 — Inspect entry:** route `/runs/[runId]/inspect` (not top-level nav); `inspectRunHref` helper; Inspect link on all Runs table/card statuses (Retry failed-only unchanged); issue-reader success chrome **Inspect pipeline**; shell via `getRun` (Back to Runs, meta, phase hint; not-available / safe load-error); no Issues-list Inspect
- **Stage 06 / feature 05 — Phase article lists:** Inspect success body shows Fetched → Scraped → Tagged → Scored via `loadPhaseCheckpointFromRun` (parallel, no per-phase `getRun`); ResponsiveList tables/cards; scrape summary + score-desc sort; missing/empty/error locked copy; optional Failed feeds under Fetched; Feature 04 placeholder removed
- **Stage 06 / feature 06 — Selection & suppress audit:** Inspect appends Selected → Selection drops → Suppressed below Scored; selection via `loadPhaseCheckpointFromRun(..., "selection")`; suppress from `parseSuppressSummary(run.suppressSummary)`; best-effort prior-run `getRun` for Prior issue labels (short-id fallback); no draft section; no top-level Inspect nav
- **Stage 06 / feature 07 — Draft inspect (Task 3 wiring):** Inspect loads draft via `loadInspectDraft` / FromRun `"draft"`; `InspectDraftSection` appended below Suppressed; selection `PhaseLoadResult` loaded once and shared with Feature 06 audit + Draft left pane (no double-download)
- **Stage 06 / feature 08 hardening — review 2026-07-14 (S1/S2/C1/C2):** safe Inspect HTTP(S)-only links (`InspectExternalLink`); selection-failure errors redacted+bounded before checkpoint save and Inspect display; empty-selection `markFailed` local retry preserves `completedPhase: "score"`; draft revive validates payload shape → `checkpoint_missing` on malformed
- **Stage 07:** prompt + model management — complete (templates, global defaults, per-newsletter overrides)
- **Stage 08 / feature 01 — Per-newsletter schedule:** schema + persistence for `scheduleEnabled` / `scheduleCron` (5-field) / `scheduleTimezone` (IANA); `updateNewsletterSchedule` is the only schedule write path (definition update omits schedule keys); `toNewsletterScheduleView` computes `nextFireAt` via `cron-parser` (no stored next-fire); no Schedules UI or worker due-check yet
- **Stage 08 / feature 02 — Schedules page:** `/schedules` lists every newsletter schedule (enable Badge, cron, timezone, next fire) on `ResponsiveList`; Edit schedule dialog persists via `updateNewsletterSchedule`; Edit newsletter deep-links to `/newsletters?edit=<id>`; no newsletter-form schedule fields or worker due-check yet
- **Stage 08 / feature 03 — Newsletter edit schedule and scroll:** Schedule section on edit-mode `NewsletterFormDialog` (shared `ScheduleFields` with Feature 02); save via `updateNewsletterSchedule` then `updateNewsletter`; dialog `DialogContent` scrolls (`max-h` + `overflow-y-auto`); create mode unchanged; no worker due-check yet

## Operational notes

- **Drafter LLM timeout:** `DRAFTER_TIMEOUT_MS` is 180s (3 min) — longer than the shared 60s tagger/scorer timeout, since a full-newsletter draft with high reasoning can exceed one minute.

## Open / next

- **Stage 08** in progress — next: `ssc-execute` on `feature-04-due-trigger` (new session), or `ssc-status`
- Reload Cursor window after MCP changes so servers appear under Available Tools
