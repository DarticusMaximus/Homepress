# Stage 15: Issue metadata and redraft — Summary

## What this stage delivered

Issues now have a real name. After a digest is drafted, a cheap extra pass writes a title and a short summary (dek) onto that issue — naming the digest as a whole, not the lead story. Home cards, newsletter channels, the issue heading, factory lists, email subject, and RSS item title all use those stored labels when they exist. Older issues with nothing stored still show the first heading and first paragraph, or the newsletter name and date, same as before.

If that cheap pass hiccups, the run still counts as success. You get the extracted heading/paragraph instead of a failed generation. You can also view and edit the title and dek prompts on the Prompts page, and pick the cheap model globally or per newsletter, without a redeploy.

A truncated “success” is recoverable. From Admin (the issue page or a completed Runs row), you can regenerate only the prose on the same selected articles — no re-fetch, no re-tag, no re-score, no re-select. The new draft replaces the old one on that run, and the title/dek refresh from the new text. Already-sent email and already-published RSS stay put until you Send or Publish again. The reader issue page (Home or a channel) does not offer this.

## How it maps to the plan

- **Stage Intent:** Stage 14 made reading the daily product: Home is a card inbox, issues open without factory chrome. Those cards still name an issue after the draft’s first heading — usually the lead story — and steal the dek from the first paragraph. A truncated digest still counts as success if the drafter returned any bytes, with no way to redo only the prose. This stage gives each issue a real title and dek from a cheap post-draft pass, and a factory action to regenerate the draft on a completed run — so the digest you actually have time to read is labeled honestly, and a short “success” is recoverable without re-running the whole pipeline.
- **Acceptance criteria met:**
  - [x] After a successful draft, a new issue has a stored title and dek (not only extracted at read time).
  - [x] Home cards and newsletter channel cards show the stored title and dek when present.
  - [x] Factory issue lists, issue page chrome, email subject, and RSS item title use the stored title when present.
  - [x] If the title/dek pass fails or is skipped, the run still completes as success; display falls back to first-heading title, first-paragraph dek, or newsletter-and-date.
  - [x] Issues with no stored title/dek (older runs) still display via the existing extraction fallback — no backfill required.
  - [x] From Admin issue or Runs, the operator can regenerate the draft of a completed run without re-fetching, re-tagging, re-scoring, or re-selecting.
  - [x] After regenerate, the new draft replaces the previous one on that run, and title/dek refresh from the new prose (cheap pass, then fallback).
  - [x] Regenerating draft is not available on the reader issue page (Home or channel).
  - [x] The title/dek prompt can be viewed and edited in the GUI and takes effect on the next pass without a redeploy.
  - [x] The cheap title/dek model has a global default and optional per-newsletter override.
- **North star link:** Goal 1 is a digest you can actually read in minutes. This stage makes that digest honestly labeled, and gives a way to redo a short “success” without burning the whole pipeline — reading stays the daily product; factory recovery stays under Admin.

## What was built

- **Feature 01 — Persist title and dek:** Each completed run stores an issue title and dek extracted from the draft (first heading, first paragraph). Empty extracts store blank. Older runs with no fields still read as blank so later surfaces can fall back.
- **Feature 02 — Cheap-model title and dek:** After extract, two sequential cheap-model calls (title, then dek) overlay honest labels onto those stored fields. Failure never fails the run. Prompts page gained Title and Dek tabs; one shared **Title & dek** model (global default plus optional per-newsletter override). Built-in default is `nvidia/nemotron-3-nano-30b-a3b`.
- **Feature 03 — Surfaces use stored metadata:** Home and channel cards, factory issue lists, issue chrome, email subject, and RSS item title prefer stored fields when present. Missing fields still extract from the draft. The draft body (including its first heading) is left as written. Listen still speaks the draft only.
- **Feature 04 — Regenerate draft:** From Admin issue or a completed Runs row, confirm and requeue the same run at draft on the existing selection. New prose replaces the old checkpoint; title/dek refresh; auto-email/RSS do not fire; the original date stays. If the redo aborts before a new draft is saved, the issue snaps back to completed with the old draft — it is not marked failed. Reader issue pages have no control.
- **Feature 05 — Hardening (review 2026-08-20):** Prompt/model saves require a real session; regenerator tests fail if the title/dek overlay is skipped; abort logs a sanitized reason for why a redo snapped back.

## Decisions and deviations

- Two prompts (Title, Dek) share one cheap-model slot (`titleDek`). That is a deliberate 2:1 exception to Stage 07’s one-prompt-one-model mapping — not a cheap/expensive architecture.
- Chrome title and the drafter’s first heading both show (“leave both”). Listen does not speak the stored title.
- Regenerating after email/RSS already fired leaves those deliveries; you Send or Publish again if you want the new draft delivered.
- Title/dek pass is not a checkpointed pipeline phase and has no Inspect UI.
- After Features 01–04 verified, `ssc-code-review` found 0 Blocker / 0 High / 3 Medium (prompts session gate, regenerator overlay test hole, abort log missing a reason). PM accepted all three; Feature 05 hardened them.
- Regression pass is contract + test composition, not a live OpenRouter run. Operator smoke (a real generate, Home card labels, Admin regenerate, reader page stays clean) remains an operator check.

## Deferred and out of scope

- Manual pin/drop/reorder of selected items.
- Hand-editing the draft in the GUI.
- Failing a run because the title/dek pass failed (explicitly refused).
- Batch backfill of historical issues.
- Regenerating any phase other than the drafter (plus the title/dek pass).
- Regenerating from the reader issue page.
- Household roles / a second login (Stage 16).
- Interest signal / thumbs.
- Rewriting already-sent email or already-published RSS except on the next explicit publish of that issue.

## Open questions for the next stage

- Stage 16 is next in the index: household admin vs reader accounts. Reader surfaces already hide factory tools; accounts are the remaining gate. Feature 05 left feeds/settings/retry/regenerate without action-level session checks on purpose — that is Stage 16-shaped, not leftover Stage 15 work.
- Whether Listen should ever speak the stored title (pinned no for this stage).
- Banked durability/ops from Stage 12: definition backup/export, out-of-band alerts, and the Settings secrets security pass — unchanged.
