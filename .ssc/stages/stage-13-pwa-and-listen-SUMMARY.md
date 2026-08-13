# Stage 13: PWA and Listen — Summary

## What this stage delivered

Homepress is now a real home-screen app on Android, not a bookmark that still opens as a browser tab. From Edge (primary) or Brave, the operator can install it with the Homepress name and icon, open it as a fullscreen-feeling window (no URL bar or tabs; the Android status bar stays), and stay signed in in that window. Settings shows **Install Homepress** when the browser can install, and hides that control when it cannot — including when already running as the installed app.

The installed app can be *used* as a reading device. On a loaded issue, a bottom listen bar offers Play, Pause, Stop, and five speeds. Playback uses the phone or tablet’s own text-to-speech — whatever engine Android has set as preferred. There is no Supertronic (or any other engine) special case, and no cloud audio. After a deploy, an already-open installed window (or tab, including login) can pick up the new version with a top **Reload** bar instead of deleting and reinstalling the icon.

## How it maps to the plan

- **Stage Intent:** Stage 12 made Homepress *look* installable (name, icon, standalone display) but left Chromium short of a real Install, and a standalone window hides Edge’s Read Aloud — the reason the operator uses Edge on the tablet. This stage makes Homepress a home-screen app on Android (Edge primary, Brave too) that opens fullscreen, stays signed in, and lets the operator **listen to an issue in-app** using the device’s preferred text-to-speech engine. That serves the north star’s “digest you actually have time to read” on the device they already live on — still a web app, not a native one.
- **Acceptance criteria met:**
  - [x] From Microsoft Edge on Android, Homepress can be installed to the home screen and opens in a standalone (fullscreen) window with the product name and icon.
  - [x] From Brave on Android, Homepress can be installed to the home screen and opens in a standalone window with the product name and icon.
  - [x] When the browser reports that install is available, the operator can complete install from an in-app control (not only the browser menu).
  - [x] Sign-in / session works in the installed standalone window.
  - [x] On the Issues reader, the operator can play, pause, and stop spoken playback of the issue using the device’s system TTS (whatever engine Android has set as preferred).
  - [x] Homepress does not require a named third-party TTS app; changing Android’s preferred engine changes what listen uses.
  - [x] After a new deploy, the installed app can update to the new version without deleting and reinstalling the icon.
- **North star link:** The digest you actually have time to read now works on the tablet the operator already lives on — install it, stay signed in, listen with the device’s own voice, and take a new deploy without tearing the icon off the home screen.

## What was built

- **Feature 01 — Chromium installability:** A public network-passthrough service worker (`/sw.js`) registered on every page including login, so Edge and Brave on Android can offer a real **Install app** instead of a shortcut. No offline cache.
- **Feature 02 — In-app install:** When the browser says install is available, Settings gains a Home screen section with **Install Homepress** that opens the browser’s own install sheet. The section is absent when install is not available or the app is already installed.
- **Feature 03 — Standalone shell:** The icon opens as `standalone` (status bar stays; no URL bar/tabs). Login and session stay in that window. Status-bar color follows light/dark, including the in-app theme toggle. Content is padded off the notch. Article links still leave the app; in-app navigation does not.
- **Feature 04 — Issue listen:** On a loaded issue only: Play / Pause / Stop and speeds 0.75×–2×, using the system preferred TTS engine (voice left unset). Pause remembers the current chunk; Stop or leaving the page returns to the start. Rate is remembered on the device.
- **Feature 05 — Installed-app updates:** After a deploy, a top in-flow bar — `A new version is ready.` **Reload** — appears when this window’s build stamp differs from the live one. Tap reloads the same URL. No dismiss, no auto-reload (that would cut listen). The web image now copies `public/` so `/sw.js` and icons actually ship.
- **Feature 06 — Hardening (review 2026-08-13):** Fixed mid-play speed change treating a cancel as a TTS failure; grew the listen bar to two rows so phone-width controls stay on screen; kept leftover `*` / `_` in spoken text; locked the cheap test and update-fetch holes from the review.

## Decisions and deviations

- Stage 12 deliberately omitted a service worker; Edge/Brave on Android still needed a real fetch handler for **Install app**. Stage 13 added a passthrough worker only — still no offline reading.
- “Fullscreen” in the stage file means no browser chrome, not hiding the clock/battery. Manifest stays `display: "standalone"`, not `fullscreen`.
- Listen pause uses cancel-and-remember-chunk, not the browser’s pause/resume APIs, because those are unreliable on Chrome/Edge Android.
- Two stage-file open questions were resolved during spec, not left hanging: playback rate shipped in Feature 04 (five speeds, cap 2×); the in-app Install control lives on Settings, not a banner or nav item.
- After Features 01–05 verified, `ssc-code-review` found 0 Blocker / 0 High / 2 Medium (listen rate-cancel flash; phone-width bar overflow) plus Low anti-cheat/test locks. PM accepted the triage; Feature 06 hardened them. Stage finalize treated hardening as part of the delivered stage.
- Regression pass is contract + test composition, not a live Android session. Device smoke (Edge/Brave Install, standalone login, listen with the preferred engine, Reload after deploy) remains an operator check on the proving tablet.
- Non-blocking composition note: on a wide signed-in desktop layout, the Reload bar sits at the root of the page while the sidebar is fixed, so the left of the bar can tuck under the sidebar. Phone and login (the proving path) have no fixed sidebar. Not an Acceptance-criterion fail.

## Deferred and out of scope

- Offline reading or an offline-first cache of issues.
- Push notifications, background sync, or other native device APIs beyond Web Speech.
- iOS as a proving target (Stage 12 already shipped Add to Home Screen metadata).
- Edge Read Aloud (unavailable in standalone; not a requirement).
- Cloud / OpenRouter / any third-party audio API.
- Detecting, bundling, or special-casing Supertronic or any other named TTS engine.
- Listen on Settings, Inspect, list pages, or any surface other than the Issues reader.
- A native mobile application (PRODUCT non-goal unchanged).
- Skip-by-heading, sentence highlight, Media Session / lock-screen controls, and a voice picker (even if the browser returns a voice list).
- Settings secrets encryption-at-rest (Stage 12 carry-forward; unchanged).

## Open questions for the next stage

- Whether a later `ssc-plan` picks up skip-by-heading or a voice picker now that play / pause / stop / rate exist.
- Whether the wide-layout Reload bar vs fixed sidebar is worth a polish pass (phone proving path is already clean).
- Banked durability/ops from Stage 12: definition backup/export, out-of-band alerts, and the Settings secrets security pass.
- PRODUCT.md Future directions (manual curation, interest signals) remain available if a later add-stage picks them up.
