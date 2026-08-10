# Stage 07: Prompt And Model Management — Summary

## What this stage delivered

You can now tune how the AI tags, scores, and drafts newsletters—and which models it uses—entirely from the app. No source edits, no env-file digging, no redeploy. Open **Prompts**, edit the three reusable templates (tagger, scorer, drafter), set default models for all four roles (including the embedder used for diversity and cross-run dedup), and override models on a specific newsletter when one provider misbehaves. The next run picks up the new values automatically.

Each template shows the placeholders it accepts (for example `{title}`, `{topics}`, `{articles_json}`). Live article text is never pasted into the stored template; the system fills those slots only when a run actually runs. If an edit goes wrong, **Reset to default** puts that template back to the built-in text. Blank newsletter model fields mean “use the global default for that role,” so most newsletters stay on shared settings while one-offs stay flexible.

This closes the operability gap where prompt and model tuning required code or env changes. Scheduling and delivery still come later (stages 08–09).

## How it maps to the plan

- **Stage Intent:** Let the operator fine-tune the three reusable LLM prompts and the per-role models without touching code or redeploying — so newsletter quality and reliability can be adjusted from the GUI and take effect on the next run. This serves the product's prompt-editing and per-newsletter model goals, and closes the gap where tuning required digging through source or env files.
- **Acceptance criteria met:**
  - [x] Operator can view and edit tagger, scorer, and drafter templates in the GUI; changes persist and reload.
  - [x] Each template documents its allowed placeholders; per-run data (articles, tags, topics, etc.) is injected only via those placeholders at run time — not by pasting live run data into the stored template.
  - [x] Reset restores a template to the shipped default text.
  - [x] Operator can set global default model IDs for tagger, scorer, drafter, and embedder; values persist and reload.
  - [x] Operator can set per-newsletter overrides per role; blank falls back to the global default for that role.
  - [x] The next run after a prompt or model change uses the new values without a redeploy.
  - [x] There is no editor prompt template and no editor pipeline phase.
- **North star link:** Advances PRODUCT goals 5 and 7 — view/edit reusable prompt templates and configure models (global default + per-newsletter overrides) from the GUI so quality and reliability can be adjusted without redeploying.

## What was built

- **Feature 01 — Prompt template store:** Appwrite-backed store for the three global templates with a fixed placeholder contract, shipped defaults, validation (reject missing required; warn on unknown), and safe seed-on-first-use.
- **Feature 02 — Prompts editor:** Working `/prompts` editor with role tabs, placeholder chips, monospace editing, and save that persists to the store and reloads cleanly.
- **Feature 03 — Reset to shipped default:** Per-role confirm dialog that restores the built-in default text for the active template only, without losing drafts on other roles.
- **Feature 04 — Global model defaults:** Four free-text OpenRouter model fields (tagger, scorer, drafter, embedder) on the Prompts page; empty means fall through to env then built-in defaults (env is not copied into the database on first load).
- **Feature 05 — Per-newsletter model overrides:** Optional per-role model fields on create/edit newsletter; blank stays blank and means “use global for that role.”
- **Feature 06 — Run-time resolution:** At the start of each run claim, the worker loads saved templates and resolves each role’s model (newsletter → global → env → built-in), freezes those values for the claim, and injects them into tagger, scorer, drafter, and embedder paths.
- **Feature 07 — Hardening (review 2026-07-14):** Tightened model-ID validation against invisible Unicode, consolidated scorer value-prep so custom and shipped templates stay in lockstep, and added repository tests for create-race recovery and operator-safe error wrapping.

## Decisions and deviations

- **Editor role dropped for V1** (planned in stage definition): only tagger, scorer, and drafter templates; no editor pipeline phase. Matches stage out-of-scope and PRODUCT’s historical four-prompt list is treated as historical.
- **Precedence confirmed:** newsletter override → global GUI default → env → built-in. Empty GUI globals are not seeded from env.
- **Claim-time freeze:** values are resolved once per `executeRun` claim; mid-claim GUI edits do not affect that claim. A later resume claim re-resolves from current DB/env (no run-document snapshot of resolved models).
- **Code review (2026-07-14):** 0 Blockers / 0 Highs; four Medium findings accepted and closed via Feature 07 before finalize. No open review blockers at close.

## Deferred and out of scope

- Editor prompt template or editor pipeline phase (obsolete for V1).
- OpenRouter model catalog browser / automatic model listing.
- Per-newsletter prompt templates (prompts remain global reusable templates only).
- Changing prompts or models mid-run (in-flight claims keep claim-start values).
- Manual curation (pin / drop / reorder) or draft editing — Future directions.
- Scheduling (stage 08) and delivery (stage 09).

## Open questions for the next stage

- None for prompt/model management itself. Stage 08 (scheduling) should assume run-time resolution already freezes models and prompts at claim start; scheduled batch runs must go through the same `executeRun` path so GUI edits take effect on the next claim without special schedule wiring.
