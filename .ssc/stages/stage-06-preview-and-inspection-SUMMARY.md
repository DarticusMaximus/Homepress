# Stage 06: Preview And Inspection — Summary

## What this stage delivered

You can now read finished newsletters inside the app instead of exporting them to Obsidian or Nextcloud. **Issues** is a top-level destination that lists only runs that actually produced a completed draft. Each row shows a human title (taken from the draft’s first heading when the draft has one, otherwise newsletter name and date), which newsletter it belongs to, and when it was generated. You can filter the list by newsletter, and the layout switches between a table on wider screens and stacked cards on a phone.

Opening an issue shows the full draft as readable formatted markdown — headings, lists, links, and the usual everyday constructs — so daily reading happens in-app.

Separately, you can audit how a run chose its items. From any run on the Runs page (or via **Inspect pipeline** on an open issue), Inspect walks the pipeline read-only: what was fetched, scraped, tagged, and scored; what was selected; what selection dropped; what cross-run suppress removed (including which earlier issue it matched, when that is known); and the produced draft beside the selected items that fed it. Nothing on Issues or Inspect lets you edit the draft or change selection — that stays deferred.

## How it maps to the plan

- **Stage Intent:** Let the operator read completed drafts in-app as the everyday consumption surface, and audit how a run chose its items — replacing the Obsidian/Nextcloud path and making pipeline decisions inspectable for tuning. This serves the product's preview-and-inspect goals and makes retained run checkpoints useful for both reading and diagnosis.
- **Acceptance criteria met:**
  - [x] Issues appears in top-level nav; only runs with a completed draft appear there.
  - [x] Issues list shows display title, newsletter name, and date; the operator can filter by newsletter; layout follows the table/cards responsive convention.
  - [x] Opening an issue renders its draft as readable markdown.
  - [x] Display title uses the draft's first markdown heading when present, otherwise newsletter name + date.
  - [x] From Runs, the operator can open Inspect for a run; from an open issue, they can reach Inspect for that run.
  - [x] Inspect shows read-only phase lists for fetched, scraped, tagged, and scored articles.
  - [x] Inspect shows selected items, MMR drops, and cross-run suppressions (with prior-issue match when available).
  - [x] Inspect shows the draft alongside the selected items that produced it.
  - [x] No editing of draft or selection in this stage.
- **North star link:** This stage delivers PRODUCT.md goals 4 (preview in-app before delivery) and the inspect half of run observability — completed drafts are readable in the GUI, and intermediate pipeline state is auditable for tuning without leaving the app.

## What was built

- **Feature 01 — Issues list:** Top-level `/issues` listing only completed runs with a draft checkpoint; newsletter filter; responsive table/cards; fallback titles.
- **Feature 02 — Issue reader:** Opens a completed draft and renders full GFM markdown for daily reading.
- **Feature 03 — Display title:** Prefer the draft’s first markdown heading; fall back to `{newsletter} — {date}` on both list and reader.
- **Feature 04 — Inspect entry:** Inspect reachable from every Runs row/card and via **Inspect pipeline** on a readable issue; route `/runs/[runId]/inspect`; not in top-level nav.
- **Feature 05 — Phase article lists:** Read-only Fetched → Scraped → Tagged → Scored sections with per-phase missing/empty/error handling.
- **Feature 06 — Selection & suppress audit:** Selected items, selection drops (including persisted MMR/threshold failures), and suppressions with prior-issue match labels when available.
- **Feature 07 — Draft inspect:** Two-pane Draft section (selected inputs beside draft output) under the suppress audit.
- **Feature 08 — Hardening (review 2026-07-14):** Safe HTTP(S)-only Inspect external links; redacted selection-failure detail at persist and display; empty-selection retry keeps `completedPhase: "score"`; malformed draft checkpoints rejected at revive.

## Decisions and deviations

- Completed-run draft checkpoints remain the source of truth — no separate Issues Appwrite collection (as planned).
- Display titles come from the draft heading or a simple fallback; no LLM title step (as planned).
- A production checkpoint-download quirk was pinned mid-stage: Appwrite may return already-parsed JSON for `application/json` Storage downloads; all checkpoint consumers share one parse path that accepts objects as well as bytes.
- Code review findings (0 Blockers; 1 High + 3 Medium accepted) were addressed via Feature 08 before finalize; no open Blockers remain.

## Deferred and out of scope

- LLM-generated issue titles.
- Manual curation (pin / drop / reorder) or draft editing — Future directions.
- Email, RSS publication, and downloadable export — Stage 09.
- Prompt or model management GUI — Stage 07.
- Inspect as a top-level nav item.

## Open questions for the next stage

- None blocking Stage 07. Delivery (Stage 09) will hang off the completed-draft Issues surface built here.
