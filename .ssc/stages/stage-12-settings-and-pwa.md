# Stage 12: Settings and PWA

## Intent

The V1 product loop is deployed and usable, but day-to-day operator tuning still means editing `.env` and recreating containers — the same friction Homepress was meant to escape after YAML. This stage makes the personally deployed instance feel like a product you live in: secrets and the few curation knobs worth trialing live in a Settings panel, connections can be proven from the GUI, and the app installs to a phone or tablet home screen as an icon (installable web, not a native app). That keeps the north star’s operability promise after first deploy, not only before it.

## Goal

An operator can change OpenRouter, SMTP, public URL, and selected pipeline/delivery knobs in Settings and have the next run, send, or request use them without touching `.env` or redeploying; can diagnose those connections from the same panel; and can install Homepress to iOS/Android home screens for an app-like shell.

## Features

1. **Settings store and resolution** — Persist operator overrides (OpenRouter key, SMTP fields, public URL, score threshold, cross-run similarity, RSS last-N, drafter reasoning effort and max completion tokens) in Appwrite. Resolve each value as GUI override → `.env` bootstrap → code default. Appwrite connection details, container timezone, and worker poll intervals remain `.env`-only.
2. **Settings panel** — A first-class Settings surface to view and edit those values (secrets masked). Clear enough that the operator does not hunt env files or Advanced pockets for this stage’s knobs.
3. **Connection diagnostics** — From Settings, prove OpenRouter, SMTP (e.g. test email), and public URL sufficiently to trust delivery/RSS links — pass/fail with an operator-readable reason.
4. **Runtime consumers** — Pipeline, delivery, and RSS (and any other readers of these values) use the resolved settings so the next run, send, or request picks up changes without rebuild or mid-job reload.
5. **PWA install shell** — Web app manifest, favicon, install icons, and the minimal install support needed for Add to Home Screen on iOS and Android. Standalone-ish presentation only — no native device APIs / service worker / custom install banner.

## Acceptance criteria

- [ ] OpenRouter key, SMTP settings, and public URL can be changed in Settings and are used on the next run or send without editing `.env` or recreating containers.
- [ ] Score threshold, cross-run similarity threshold, RSS last-N, and drafter reasoning effort / max completion tokens are editable in Settings and affect subsequent runs or feeds as appropriate.
- [ ] Blank or cleared GUI overrides fall back to `.env`, then to code defaults; invalid overrides do not silently brick resolution (operator sees a clear failure or safe fallback).
- [ ] Settings diagnostics report pass/fail for OpenRouter and SMTP, plus a clear public-URL check, from the Settings UI.
- [ ] Homepress can be installed to the home screen on iOS and Android with the product name and icon, opening in a standalone-ish shell; browser tabs show the Homepress favicon.
- [ ] Appwrite endpoint/project/API key, container timezone, and worker poll intervals remain deploy-time `.env` configuration (not Settings).

## Dependencies

- Stage 11 (simplify-and-package) must be complete — deployed compose baseline and existing Appwrite-backed settings patterns (e.g. retention / global models) are the foundation this stage extends.

## Out of scope

- MMR λ, protected completed-runs count, scraper min-extract length, and other magic numbers left at code defaults after the Stage 12 knob triage.
- Mid-job live reload of settings on an in-flight run.
- Hold-for-review before auto-email; manual curation / draft edit.
- Definition backup/export and out-of-band ops alerts (banked for a later stage).
- Native mobile application or device APIs (push, background fetch, etc.).
- Moving Appwrite connection, `TZ`, or worker poll intervals into the Settings GUI.

## Open questions

- None remaining for Stage 12 planning — Feature 02 grill (2026-08-11) pinned Settings IA + secrets UX; Feature 03 grill (2026-08-11) pinned OpenRouter key GET, SMTP test-to-self, public URL warn-on-unreachable, saved-settings-only probes, toast + ephemeral inline status.
