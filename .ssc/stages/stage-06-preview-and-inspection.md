# Stage 06: Preview And Inspection

## Intent

Let the operator read completed drafts in-app as the everyday consumption surface, and audit how a run chose its items — replacing the Obsidian/Nextcloud path and making pipeline decisions inspectable for tuning. This serves the product's preview-and-inspect goals and makes retained run checkpoints useful for both reading and diagnosis.

## Goal

Browse and read finished issues (well-rendered markdown, filterable by newsletter); open a read-only per-run inspect view from Runs (and from an issue) that walks fetched → draft, including selection and suppress outcomes.

## Features

1. **Issues list** — Top-level nav destination listing only runs with a completed draft. Each row shows display title, newsletter name, and date. Operator can filter by newsletter. Responsive table on wide viewports / stacked cards on phone (Stage 03 convention).
2. **Issue reader** — Open an issue and read its draft as well-rendered markdown suitable for daily consumption.
3. **Display title** — Prefer the draft's first markdown heading when present; otherwise fall back to `{newsletter} — {date}`. No LLM title-generation step.
4. **Inspect entry** — Open Inspect from a run on the Runs page; optional "Inspect pipeline" link from the issue reader for that run. Inspect is not a top-level nav item.
5. **Phase article lists** — Read-only Inspect sections for fetched, scraped, tagged, and scored candidates, showing the fields useful for tuning.
6. **Selection & suppress audit** — In Inspect: what was selected, what MMR dropped, and what cross-run suppress removed (with prior-issue match context when available).
7. **Draft inspect** — In Inspect: view the produced draft alongside the selected items that fed it.

## Acceptance criteria

- [ ] Issues appears in top-level nav; only runs with a completed draft appear there.
- [ ] Issues list shows display title, newsletter name, and date; the operator can filter by newsletter; layout follows the table/cards responsive convention.
- [ ] Opening an issue renders its draft as readable markdown.
- [ ] Display title uses the draft's first markdown heading when present, otherwise newsletter name + date.
- [ ] From Runs, the operator can open Inspect for a run; from an open issue, they can reach Inspect for that run.
- [ ] Inspect shows read-only phase lists for fetched, scraped, tagged, and scored articles.
- [ ] Inspect shows selected items, MMR drops, and cross-run suppressions (with prior-issue match when available).
- [ ] Inspect shows the draft alongside the selected items that produced it.
- [ ] No editing of draft or selection in this stage.

## Dependencies

- Stage 04: Runs And History must be complete (phase checkpoints and completed drafts).
- Consumes Stage 05 `suppressSummary` when present (Stage 05 is already complete).

## Out of scope

- LLM-generated issue titles (display title from heading / fallback only).
- Manual curation (pin / drop / reorder) or draft editing — deferred Future directions.
- Email, RSS publication, or downloadable export — Stage 09.
- Prompt or model management GUI — Stage 07.
- A separate Issues Appwrite collection — completed-run drafts remain the source of truth.
- Inspect as a top-level nav item.

## Open questions

- Exact per-phase fields shown on Inspect (pin in `ssc-spec`).
- Markdown renderer choice for the issue reader (pin in `ssc-spec`).
- Empty-state copy when no completed drafts exist yet (pin in `ssc-spec`).

## Pins carried forward

- **`loadPhaseCheckpoint` must accept already-parsed JSON from `getFileDownload` (feature 02 production bug, 2026-07-14).** Checkpoint files in the `run_checkpoints` bucket are stored as `application/json`. Live `node-appwrite` (`Client.call`) prefers JSON parsing whenever the response `Content-Type` is `application/json` — **even for `storage.getFileDownload`**, which is requested as `arrayBuffer`. The SDK therefore returns a plain object (`{ markdown, … }` for draft, article arrays for other phases), not an `ArrayBuffer`. Assuming bytes + `TextDecoder.decode` throws and surfaces as “Couldn’t load this issue” / `checkpoint_missing` while the file is fine in the Appwrite console. Fixed via `parseCheckpointDownload` in `shared/src/runs/repository.ts` (object | ArrayBuffer | TypedArray | string). **Features 05–07** (and any later checkpoint consumer) must keep using `loadPhaseCheckpoint` / the shared parse path — do not reintroduce a bytes-only decode. Regression covered in `shared/src/runs/__tests__/repository.test.ts`. Mirrored in `Plan.md` → Carry-forward pins.
