# Stage 12: Settings and PWA — Summary

## What this stage delivered

After first deploy, day-to-day tuning no longer means editing `.env` and recreating containers. The operator has a Settings page for OpenRouter, SMTP, public URL, and a short list of curation knobs (score threshold, cross-run similarity, RSS last-N, drafter reasoning effort and token budget). Changes apply on the next run, send, or request — no rebuild, no mid-job live reload.

From the same Connections section, the operator can prove OpenRouter (key check), SMTP (test mail to self), and the public URL (pass / fail / warn) before trusting delivery or RSS links. Homepress also installs to a phone or tablet home screen with the product name and icon, and browser tabs show the Homepress favicon — installable web, not a native app.

## How it maps to the plan

- **Stage Intent:** The V1 product loop is deployed and usable, but day-to-day operator tuning still means editing `.env` and recreating containers — the same friction Homepress was meant to escape after YAML. This stage makes the personally deployed instance feel like a product you live in: secrets and the few curation knobs worth trialing live in a Settings panel, connections can be proven from the GUI, and the app installs to a phone or tablet home screen as an icon (installable web, not a native app). That keeps the north star’s operability promise after first deploy, not only before it.
- **Acceptance criteria met:**
  - [x] OpenRouter key, SMTP settings, and public URL can be changed in Settings and are used on the next run or send without editing `.env` or recreating containers.
  - [x] Score threshold, cross-run similarity threshold, RSS last-N, and drafter reasoning effort / max completion tokens are editable in Settings and affect subsequent runs or feeds as appropriate.
  - [x] Blank or cleared GUI overrides fall back to `.env`, then to code defaults; invalid overrides do not silently brick resolution (operator sees a clear failure or safe fallback).
  - [x] Settings diagnostics report pass/fail for OpenRouter and SMTP, plus a clear public-URL check, from the Settings UI.
  - [x] Homepress can be installed to the home screen on iOS and Android with the product name and icon, opening in a standalone-ish shell; browser tabs show the Homepress favicon.
  - [x] Appwrite endpoint/project/API key, container timezone, and worker poll intervals remain deploy-time `.env` configuration (not Settings).
- **North star link:** This stage extends PRODUCT.md’s operability promise past first deploy — configure, diagnose, and live with Homepress from the GUI (and home screen) without returning to env files for the knobs that matter day to day.

## What was built

- **Feature 01 — Settings store and resolution:** Operator overrides persist on the Appwrite `app_settings` singleton; each value resolves GUI override → `.env` → code default (SMTP all-or-nothing).
- **Feature 02 — Settings panel:** Protected `/settings` with Connections + Pipeline & delivery knobs; secrets always masked; Settings nav after Delivery; per-section save and clear-override.
- **Feature 03 — Connection diagnostics:** Three saved-settings probes from Connections — OpenRouter key-info GET, SMTP test-to-self, public URL pass/fail/warn — with toast + ephemeral inline status.
- **Feature 04 — Runtime consumers:** Pipeline, email delivery, and RSS (plus related readers) use resolved settings on the next run/send/request, frozen once per job or request.
- **Feature 05 — PWA install shell:** Manifest, favicon, 192/512/maskable icons, and appleWebApp metadata for Add to Home Screen; no service worker or custom install banner.
- **Feature 06 — Hardening (review 2026-08-12):** Addressed eleven Medium findings from code review — public-URL probe redirect/SSRF hardening, secret-safe SMTP/Settings failure logs, honest incomplete/corrupt Appwrite reads, once-per-request RSS resolve, and no silent clear of knobs on invalid keystrokes.

## Decisions and deviations

- Settings secrets (OpenRouter key, SMTP password) are stored plaintext in Appwrite for the single-operator self-host trust model — same class as `.env` secrets; a later security pass is banked in Plan carry-forward.
- Knob triage kept only score threshold, cross-run similarity, RSS last-N, and drafter effort/tokens in Settings; MMR λ, protected-run count, and scraper min-extract stay code defaults.
- Public-URL diagnostic warns (does not fail) when the server cannot reach the URL (hairpin/NAT), so self-host setups are not falsely marked broken.
- After Features 01–05 verified, `ssc-code-review` found eleven Medium issues (0 Blocker / 0 High). PM accepted all; Feature 06 hardened them. Stage finalize regression treated hardening as part of the delivered stage.

## Deferred and out of scope

- MMR λ, protected completed-runs count, scraper min-extract length, and other magic numbers left at code defaults.
- Mid-job live reload of settings on an in-flight run.
- Hold-for-review before auto-email; manual curation / draft edit.
- Definition backup/export and out-of-band ops alerts (banked for a later stage).
- Native mobile application or device APIs (push, background fetch, etc.).
- Moving Appwrite connection, `TZ`, or worker poll intervals into the Settings GUI.
- Dedicated Settings secrets encryption-at-rest / tighter handling (Plan carry-forward).

## Open questions for the next stage

- Whether the next plan picks up banked durability/ops work (definition backup/export, out-of-band alerts) and/or the Settings secrets security pass.
- PRODUCT.md Future directions (manual curation, interest signals) remain available if a later `ssc-plan` add-stage picks them up.
