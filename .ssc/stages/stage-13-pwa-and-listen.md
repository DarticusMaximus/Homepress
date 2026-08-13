# Stage 13: PWA and Listen

## Intent

Stage 12 made Homepress *look* installable (name, icon, standalone display) but left Chromium short of a real Install, and a standalone window hides Edge’s Read Aloud — the reason the operator uses Edge on the tablet. This stage makes Homepress a home-screen app on Android (Edge primary, Brave too) that opens fullscreen, stays signed in, and lets the operator **listen to an issue in-app** using the device’s preferred text-to-speech engine. That serves the north star’s “digest you actually have time to read” on the device they already live on — still a web app, not a native one.

## Goal

The operator can install Homepress from Edge or Brave on an Android phone or tablet, open it as a fullscreen app, stay signed in, play / pause / stop spoken playback of an issue via system TTS, and pick up a new deploy without deleting the icon.

## Features

1. **Chromium installability** — Homepress meets what Edge and Brave on Android need to offer a real Install (not a bookmark that still opens as a browser tab). Stage 12’s manifest and icons stay; this feature supplies the missing install criteria.
2. **In-app install** — When the browser can install, the operator sees a clear Install control in the app and can finish install from it, without hunting the browser menu. If the browser cannot install, the control is absent or explains why — no fake button.
3. **Standalone shell** — The installed icon opens fullscreen (no browser chrome). Sign-in and session still work in that window; the operator is not bounced into a tab they cannot use.
4. **Issue listen** — On the Issues reader only: play, pause, and stop spoken playback of the current issue via the Web Speech / Android TTS path. Homepress uses the **system preferred engine** (Supertronic or any other engine the operator selected in Android settings). No named-engine detection, no cloud / OpenRouter audio, no Edge Read Aloud.
5. **Installed-app updates** — After a deploy, the installed app can move to the new version without deleting and reinstalling the home-screen icon.

## Acceptance criteria

- [ ] From Microsoft Edge on Android, Homepress can be installed to the home screen and opens in a standalone (fullscreen) window with the product name and icon.
- [ ] From Brave on Android, Homepress can be installed to the home screen and opens in a standalone window with the product name and icon.
- [ ] When the browser reports that install is available, the operator can complete install from an in-app control (not only the browser menu).
- [ ] Sign-in / session works in the installed standalone window.
- [ ] On the Issues reader, the operator can play, pause, and stop spoken playback of the issue using the device’s system TTS (whatever engine Android has set as preferred).
- [ ] Homepress does not require a named third-party TTS app; changing Android’s preferred engine changes what listen uses.
- [ ] After a new deploy, the installed app can update to the new version without deleting and reinstalling the icon.

## Dependencies

- Stage 12 (settings-and-pwa) must be complete — existing manifest, icons, and standalone display are the shell this stage turns into a real installable app.

## Out of scope

- Offline reading or an offline-first cache of issues.
- Push notifications, background sync, or other native device APIs beyond Web Speech.
- iOS as a proving target for this stage (Stage 12 already shipped Add to Home Screen metadata).
- Edge Read Aloud (unavailable in standalone; not a requirement).
- Cloud / OpenRouter / any third-party audio API.
- Detecting, bundling, or special-casing Supertronic or any other named TTS engine.
- Listen on Settings, Inspect, list pages, or any surface other than the Issues reader.
- A native mobile application (PRODUCT non-goal unchanged).

## Open questions

- Listen UX beyond play / pause / stop: playback rate, skip-by-heading, and whether to offer a voice picker when the browser actually returns a voice list (vs always using the engine default).
- Where the in-app Install control lives (banner, nav, Settings) when the browser can install.
