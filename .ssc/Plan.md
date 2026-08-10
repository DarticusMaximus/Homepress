# Plan: Homepress

## North star
**Homepress** — a self-hosted webapp that generates personalized, AI-curated newsletters from RSS sources — condensing the overwhelming daily firehose of news into a short, relevant digest the operator actually has time to read, and replacing a fragile Python CLI with a GUI where publications are configured, scheduled, generated, and delivered.

## Stage index
| Stage | Name | Intent (one line) | Key deliverable | Depends on |
|-------|------|-------------------|-----------------|------------|
| 00 | scaffolding | Enable all later stages to be built and tested. | Runnable TS project skeleton + test runner + podman compose + Appwrite client wired. | — |
| 01 | pipeline-engine | Prove the riskiest assumption: TS filtering engine matches Python pipeline quality. | Headless library (fetch→scrape→tag→score→MMR→draft) runnable via a test harness. | 00 |
| 02 | app-foundation | Provision the Appwrite database and the GUI shell every later stage builds on. | Schema-as-code provisioner + GUI layout/nav/shared-component baseline + dashboard with DB health card. | 00 |
| 03 | newsletter-config | Make newsletter definitions manageable without YAML. | Appwrite CRUD for newsletter definitions (name, feeds, topics, disliked topics, audience, item count, date range) + reusable feed library. | 02 |
| 04 | runs-and-history | Make runs observable and recoverable, and feeds trustworthy. | Checkpointed on-demand runs, resumable history, and feed-health alerts. | 01, 03 |
| 05 | cross-run-deduplication | Stop the same topic recurring across consecutive issues. | Semantic topic suppression over a configurable lookback window (default: last 3 issues) of retained run history. | 04 |
| 06 | preview-and-inspection | Let the operator read issues in-app and audit pipeline decisions. | In-app issue reader (replaces Obsidian/Nextcloud path) + inspectable fetched/scored/selected/draft state per run. | 04 |
| 07 | prompt-and-model-management | Let the operator fine-tune prompts and models without code. | GUI for the three reusable prompt templates (tagger, scorer, drafter) + global default and per-newsletter model overrides (incl. embedder). | 03 |
| 08 | scheduling | Make generation reliable and automatic on the box. | Per-newsletter schedule, reliable batch execution, failures surfaced in run history. | 04 |
| 09 | delivery | Get finished issues to family inboxes, RSS readers, and on-demand download. | Email (SMTP + multipart) + public RSS (last 10) + MD/HTML download; per-newsletter auto-email / auto-RSS. | 06 |
| 10 | v1-polish | Make daily operator use pleasant enough to launch V1. | Schedule builder, usable newsletter edit, drafter/audience + per-newsletter override, Inspect/mobile/dashboard polish. | 09 |
| 11 | simplify-and-package | Make the codebase shippable: simplify drift, diagnosable pipeline failures, final quality gates, documented podman compose deploy on existing Appwrite. | DRY lists + cleanup + phase-failure observability + green gates + compose/.env.example + deploy docs/smoke. | 10 |

## Constraints reminder
- Self-hosted on a single Linux box as a podman compose stack; no managed SaaS except OpenRouter.
- Appwrite already running as a shared instance — the app provisions its own DB/collections within it.
- Stack fixed: Next.js frontend, Appwrite backend, TypeScript end-to-end. No Python in the deployed system.
- LLM access via OpenRouter only; models configurable per newsletter.
- Appwrite connection details + project config live in the project-root `.env`.

## Non-goals reminder
- Multi-tenant access or public sign-up — single-user system.
- A mobile application — responsive web is sufficient.
- Customer-facing polish or marketing pages — internal-tool quality.
- Keeping or wrapping the existing Python codebase — full TS rewrite.
- Real-time or push-based article ingestion — runs are batch jobs.
- A built-in email server — uses a configured external SMTP/transactional service.
- Migration of data from the existing Python setup — fresh start.

## Decision log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-26 | Engine (stage 01) proven headless before any GUI. | Quality parity with the Python pipeline is the riskiest unknown; don't build a UI around an engine that may not work. PM confirmed. |
| 2026-06-26 | Cross-run topic dedup added as stage 04 ("temporal diversity"). | Legacy system retained no run data, so the same topic recurred across consecutive issues. Requires retained run history (stage 03) to suppress semantically similar topics over a lookback window. |
| 2026-06-26 | Lookback default set to last 3 issues, configurable per newsletter. | PM-specified default. |
| 2026-06-26 | Resume-from-last-phase made an explicit feature in stage 03. | Cheap tagger models can be unreliable; the PM wants both failure visibility and the ability to resume without re-running completed phases. |
| 2026-06-26 | Nextcloud output dropped. | Was only a dumping ground to reach Obsidian. The in-app reader (stage 05) replaces that path. |
| 2026-06-26 | Feed health monitoring included in V1, folded into stage 03. | PM lost a dead feed silently in the legacy system for weeks. Run records are the natural source of feed-health signal. |
| 2026-06-26 | Manual curation (interactive pin/drop/reorder) deferred to a future stage. | Valuable but out of V1 scope per PM. Recorded in PRODUCT.md Future directions so it is not lost. |
| 2026-06-26 | Interest-learning (thumbs up/down) deferred. | PM wants to avoid ML complexity in V1. Recorded in PRODUCT.md Future directions. |
| 2026-06-26 | Prompt/model management (stage 06) positioned after runs + dedup. | Current prompts are decent; editing is fine-tuning, not foundational. PM confirmed positioning. |
| 2026-06-26 | Article scraper uses trafilatura as a Python sidecar HTTP service (stage 01). | No faithful TypeScript port of trafilatura exists; ML-based main-content extraction has no JS equivalent. `@mozilla/readability` is a noticeably weaker heuristic. PM chose fidelity-over-purity for V1 to unblock the parity proof, and will research modern alternatives separately. Bounded, isolated compromise on the "no Python in the deployed system" rule — one sidecar container, called over HTTP; the worker and pipeline remain fully TS. |
| 2026-07-01 | Scraper sidecar replaced with pure-TypeScript Readability + jsdom + turndown. | Stage 01 verification showed the Python sidecar wasn't justified; pure-TS extraction is comparable-purpose and keeps the deployed system Python-free. Original trafilatura-sidecar decision superseded. |
| 2026-07-01 | Insert stage 02 (app-foundation); renumber stages 03–08 → 03–09. | The original stage 02 bundled three concerns (DB provisioning, GUI shell, newsletter-config domain). DB provisioning and the GUI shell are foundational — every later data-bearing stage silently assumed both would exist. Surfacing them as one combined stage gives each a proving ground (DB health card in the dashboard) and avoids an artificially thin DB-only or GUI-only stage. PM confirmed combined stage over two split stages. No features specced or built on old 02–08, so the renumber is a pure re-index with no broken dependencies. |
| 2026-07-09 | Stage 03 file written: feeds as first-class library with qualification test; attach-only-if-ok; free-text audience. | Feeds live on their own page so sources can be shared across tech/AI/security newsletters and tested before use (RSS reachable + one article body scrapeable). Newsletters may only attach `ok` feeds. Audience is a short free-text voice/needs brief (no presets). Stage 03 owns pre-attach qualification; Stage 04 still owns ongoing feed health from runs. PM confirmed. |
| 2026-07-09 | Stage 03 Feature 06: responsive list layout (table desktop / cards phone); shared GUI convention. | Feature 02’s Feeds table is unusable on smartphones. PM chose stacked cards on narrow viewports and a shared pattern for all later list pages (not Feeds-only). PRODUCT.md left unchanged (already “responsive web is sufficient”); convention pinned in Plan.md + AGENTS.md so every agent session sees it. Execute Feature 06 before Feature 04 so newsletter lists adopt the pattern from the start. |
| 2026-07-10 | Stage 04 defined: phase checkpoints, same-newsletter exclusion, three-failure feed health, and protected retention. | Retries must avoid repeated website requests and LLM calls; transient provider and feed outages are expected. History defaults to 30 days but preserves the latest three completed runs per newsletter for Stage 05 deduplication. PM confirmed. |
| 2026-07-13 | Stage 05 defined: pre-MMR embedding suppress, lookback `0` = off, env threshold, run-summary visibility. | Suppress as a hard filter before MMR (not inside selection). Embedding similarity now; LLM-as-judge deferred. Hard-drop above threshold; fill from remainder; short issue only if pool exhausted. Lookback default 3, `0` disables. Threshold tuned via `.env` (no GUI). Run summary shows count + suppressed titles + matched prior issue. PM confirmed. |
| 2026-07-14 | Stage 06 defined: Issues reader + Run inspect as two destinations; completed-draft source of truth. | Issues is top-level daily reading (completed drafts only; display title + newsletter + date; filter by newsletter; markdown render). Inspect is ops drill-down from Runs / issue reader (not top-level nav): read-only phases fetched→scored, selection/MMR drops, suppress audit, draft beside selected items. No separate Issues collection; no LLM title (heading or `{newsletter} — {date}` fallback); no draft edit / pin-drop. PM confirmed. |
| 2026-07-14 | Stage 07 defined: three prompts + per-role models; editor dropped for V1. | Templates: tagger, scorer, drafter only — editor obsolete with newer models; no V1 plan to add it (PRODUCT still lists four historically). Named placeholders inject per-run data at run time. Global model defaults for tagger/scorer/drafter/embedder in GUI (env = bootstrap/fallback). Per-newsletter per-role overrides (blank = global). Free-text OpenRouter model IDs (no catalog). Reset-to-shipped-default per template. PM confirmed. |
| 2026-07-16 | Stage 08 defined: worker due-check (not OS cron); cron + IANA TZ; Schedules page + newsletter edit; serial concurrency; skip missed fires. | Container-friendly in-worker due check creates Stage 04 pending runs via the same execute path. Skip if that newsletter is already active; serial across newsletters; no catch-up backlog after downtime. Schedule editable from both Schedules list and newsletter edit; edit-page scroll fix included. PM confirmed. |
| 2026-07-16 | Stage 09 defined: manual + auto delivery; two auto toggles; no auto-export; multipart email; public RSS last 10. | Auto-email and auto-RSS are independent per-newsletter switches (default off while tuning). Email is multipart HTML+plain via `.env` SMTP (operator’s own mail server). Recipients are a simple per-newsletter address list (family-scale; no signup/unsubscribe). RSS is one public URL per newsletter, last 10 issues. Download is on-demand MD + HTML only — auto-export deferred (archive destination spirals). Delivery status visible in GUI. PM confirmed. |
| 2026-07-17 | Stage 09 Feature 06: `/delivery` is the primary delivery hub (not Issues/run-only). | Stage 02 reserved `/delivery`; Stages 01–05 put config on newsletter edit and actions on Issues. Feature 06 fills the nav page as a Runs-like list (one row per issue with ≥1 attempt; last-write-wins status on the run; failure reasons; compact badges on Issues). Features 01–05 action surfaces unchanged. PM confirmed. |
| 2026-07-17 | Stage 10 (v1-polish) added after delivery. | Stages 00–09 complete; polish stage prepares operator UX for V1 launch (not new product capabilities). PM confirmed Add-stage pathway. |
| 2026-07-17 | No separate LLM issue-title call in V1. | Titles via drafter template (first heading); avoids extra model calls and Stage 06 display-title changes. PM deferred post-draft title LLM. |
| 2026-07-17 | Run retention stays on Runs as collapsible Advanced. | Settings page deferred beyond V1; cheapest placement that de-emphasizes purge controls. PM confirmed. |
| 2026-07-17 | Flat eight-item nav kept; `/design-system` removed in Stage 10. | PM prefers not hiding nav items; design-system page forgotten and unused for operators. |
| 2026-07-17 | List-page DRY / code simplification deferred to a future stage. | Stage 10 is operator polish only; PM will dedicate a later stage to dedup and best practices. |
| 2026-07-21 | Stage 11 (simplify-and-package) added after V1 polish. | Release gate: code simplification + final checks + documented `podman compose up` against existing Appwrite via `.env`. No image registry/changelog; success = clone → fill `.env` → compose up (web + worker). PM confirmed. |
| 2026-07-28 | Stage 11 Feature 03: phase failure observability (tier B); renumber gates/packaging/docs → 04–06. | Tag halt surfaced only `reason: 'Tagging halted'` while the pipeline already had rich `TagResult` detail. Enrich stdout + failure message, persist summary, show on Inspect (not a log stream). Insert before quality gates. PM confirmed. |

## Carry-forward pins

Cross-stage notes that must not be lost between sessions. Expand this section as features surface latent findings.

- **Responsive domain lists (stage 03 feature 06, 2026-07-09).** Operator list pages must work on phone browsers as well as desktop/tablet: **table on wide viewports, stacked cards on narrow**, same fields and actions. Shared pattern — not one-off page CSS. Applies to Feeds (proving surface), newsletter lists, runs, and any later domain list. Mirrored in `AGENTS.md` → Project GUI conventions.
- **`SelectionResult.failures` invariant (from stage-01 feature-06 verification, 2026-06-30).** The `selectedArticles.length + failures.length === totalArticles` invariant only holds when `target ≥ candidateCount`; passed-threshold-but-not-selected articles are silently dropped otherwise. **Stage 01 feature 07** must assert/handle this at the `selectDiverse` call site; **stage 03** should consider adding a `not-selected` telemetry category to `SelectionFailure.reason` when run records are designed. Full detail in `stage-01-pipeline-engine.md` → "Pins carried forward".
- **`getFileDownload` may return parsed JSON, not bytes (stage 06 feature 02, 2026-07-14).** Checkpoint files are `application/json`; live `node-appwrite` auto-parses that content-type even on download calls. `loadPhaseCheckpoint` must accept plain objects as well as ArrayBuffer/TypedArray. Do not add new byte-only decode paths for checkpoints. Full detail in `stage-06-preview-and-inspection.md` → "Pins carried forward".
- **Newsletter edit page does not scroll (stage 08, 2026-07-16).** On `/newsletters` → Edit, the detail/edit page overflows its viewport and cannot scroll, so lower sections are unreachable. Stage 08 Feature 03 must fix scroll while adding schedule fields on that surface. Do not ship schedule UI without restoring full-page reachability.
- **List-page DRY / code simplification (stage 10 deferral → stage 11, 2026-07-21).** Stage 10 left list-page dedup and broader cleanup to Stage 11 (`stage-11-simplify-and-package`). Feature 01 owns the shared table/card pattern; Feature 02 owns dead-code/consistency sweep.
- **Phase failure observability (stage 11 feature 03, 2026-07-28).** Pipeline halt/empty-fatal outcomes must carry structured detail (halt reason, consecutive errors, short failure sample) in stdout, run `failureMessage`, and Inspect — not one-liners. Not an append-only log product. Features 04–06 are the renumbered former 03–05 (gates / packaging / deploy docs).
