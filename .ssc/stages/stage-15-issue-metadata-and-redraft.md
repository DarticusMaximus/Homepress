# Stage 15: Issue metadata and redraft

## Intent

Stage 14 made reading the daily product: Home is a card inbox, issues open without factory chrome. Those cards still name an issue after the draft’s first heading — usually the lead story — and steal the dek from the first paragraph. A truncated digest still counts as success if the drafter returned any bytes, with no way to redo only the prose. This stage gives each issue a real title and dek from a cheap post-draft pass, and a factory action to regenerate the draft on a completed run — so the digest you actually have time to read is labeled honestly, and a short “success” is recoverable without re-running the whole pipeline.

## Goal

After a successful draft, every new issue has a stored title and dek that Home, channels, issue chrome, email, and RSS use. If that cheap pass fails, the issue still completes and display falls back to first-heading / first-paragraph (or newsletter-and-date). From Admin, the operator can regenerate only the draft on a completed run; title and dek then refresh from the new prose.

## Features

1. **Persist title and dek** — Store an issue title and dek on the completed run so readers do not have to re-parse the draft every time. First-heading title and first-paragraph dek remain the fallback when stored values are missing (older issues; failed cheap pass). No batch backfill job.
2. **Cheap-model title and dek** — After a successful draft, a cheap-model pass produces a real issue title and dek from that draft. Reusable prompt the operator can view and edit like the other generation prompts. Cheap model configurable the same way as other generation roles (global default, optional per-newsletter override). Failure of this pass must not fail the run.
3. **Surfaces use stored metadata** — Home cards, newsletter channel cards, factory issue lists, issue page chrome, email subject, and RSS item title use the stored title (and dek where those surfaces already show a dek) when present; otherwise the existing extraction fallback. Already-published RSS snapshots refresh on the next publish of that issue, not via a historical rewrite job.
4. **Regenerate draft** — On a completed run, from factory surfaces only (Admin issue and Runs — not the reader issue page), re-run the drafter on the existing selected items. Do not re-fetch, re-tag, re-score, or re-select. After a new draft, run the title/dek pass again. The new draft replaces the previous one on that same run.

## Acceptance criteria

- [ ] After a successful draft, a new issue has a stored title and dek (not only extracted at read time).
- [ ] Home cards and newsletter channel cards show the stored title and dek when present.
- [ ] Factory issue lists, issue page chrome, email subject, and RSS item title use the stored title when present.
- [ ] If the title/dek pass fails or is skipped, the run still completes as success; display falls back to first-heading title, first-paragraph dek, or newsletter-and-date.
- [ ] Issues with no stored title/dek (older runs) still display via the existing extraction fallback — no backfill required.
- [ ] From Admin issue or Runs, the operator can regenerate the draft of a completed run without re-fetching, re-tagging, re-scoring, or re-selecting.
- [ ] After regenerate, the new draft replaces the previous one on that run, and title/dek refresh from the new prose (cheap pass, then fallback).
- [ ] Regenerating draft is not available on the reader issue page (Home or channel).
- [ ] The title/dek prompt can be viewed and edited in the GUI and takes effect on the next pass without a redeploy.
- [ ] The cheap title/dek model has a global default and optional per-newsletter override.

## Dependencies

- Stage 14 (reader-first-gui) must be complete — Home cards, channel cards, and path-conditional issue chrome are the surfaces this stage labels honestly.

## Out of scope

- Manual pin/drop/reorder of selected items (still deferred).
- Hand-editing the draft in the GUI.
- Failing a run because the title/dek pass failed.
- Batch backfill of historical issues.
- Regenerating any phase other than the drafter (plus the title/dek pass).
- Regenerating from the reader issue page.
- Household roles / a second login (Stage 16).
- Interest signal / thumbs.
- Rewriting already-sent email or already-published RSS except on the next explicit publish of that issue.

## Open questions

- Default cheap-model id (ssc-spec).
- Title/dek prompt placement: fourth Prompts role vs elsewhere (Goal 5 suggests Prompts).
- Issue body still starts with the drafter’s first heading — chrome title replace, hide a duplicate heading, or leave both? (ssc-spec)
- Regenerating after auto-email / auto-RSS already fired: leave prior deliveries; operator resends / republishes? (ssc-spec)
- Listen: speak the stored title, or only the draft body as today? (ssc-spec)
