# Stage 07: Prompt And Model Management

## Intent

Let the operator fine-tune the three reusable LLM prompts and the per-role models without touching code or redeploying — so newsletter quality and reliability can be adjusted from the GUI and take effect on the next run. This serves the product's prompt-editing and per-newsletter model goals, and closes the gap where tuning required digging through source or env files.

## Goal

Editable global prompt templates (tagger, scorer, drafter) with a documented placeholder contract; global default models for all four roles (tagger, scorer, drafter, embedder); per-newsletter model overrides; the run pipeline resolves and applies those values at run start.

## Features

1. **Prompt template store** — Persist the three reusable templates (tagger, scorer, drafter) with a fixed named-placeholder contract; seed from shipped code defaults on first use.
2. **Prompts editor** — On the existing Prompts page: view and edit each template, and see which placeholders that template accepts; a save takes effect on the next run (no redeploy).
3. **Reset to shipped default** — Per-template action that restores the built-in default text so a bad edit is recoverable without a code change.
4. **Global model defaults** — GUI to set free-text OpenRouter model IDs for tagger, scorer, drafter, and embedder. GUI becomes the day-to-day source; env vars remain bootstrap/fallback only.
5. **Per-newsletter model overrides** — On the newsletter definition: optional override per role; blank means use the global default for that role.
6. **Run-time resolution** — At run start, the worker loads the saved prompt templates and resolves each role's model (newsletter override → global → env → built-in default), then uses those values for that run.

## Acceptance criteria

- [ ] Operator can view and edit tagger, scorer, and drafter templates in the GUI; changes persist and reload.
- [ ] Each template documents its allowed placeholders; per-run data (articles, tags, topics, etc.) is injected only via those placeholders at run time — not by pasting live run data into the stored template.
- [ ] Reset restores a template to the shipped default text.
- [ ] Operator can set global default model IDs for tagger, scorer, drafter, and embedder; values persist and reload.
- [ ] Operator can set per-newsletter overrides per role; blank falls back to the global default for that role.
- [ ] The next run after a prompt or model change uses the new values without a redeploy.
- [ ] There is no editor prompt template and no editor pipeline phase.

## Dependencies

- Stage 03: Newsletter Config must be complete (newsletter definitions for per-newsletter overrides; Prompts nav stub already exists).
- Consumes the existing run pipeline from Stages 01 and 04 (resolution applies at run start).

## Out of scope

- Editor prompt template or editor pipeline phase (obsolete for V1; no current plan to implement).
- OpenRouter model catalog browser / automatic model listing.
- Per-newsletter prompt templates (prompts are global reusable templates only).
- Changing prompts or models mid-run (in-flight runs keep the values resolved at start).
- Manual curation (pin / drop / reorder) or draft editing — deferred Future directions.
- Scheduling or delivery — Stages 08 and 09.

## Open questions

- Exact placeholder names and required slots per template (pin in `ssc-spec`).
- Validation rule when a required placeholder is missing on save (reject vs warn — pin in `ssc-spec`).
- Where global model defaults live in the GUI (Prompts page vs adjacent settings surface — pin in `ssc-spec`).
- Precedence details when both env and GUI global are set (confirm newsletter → global → env → built-in — pin in `ssc-spec`).
