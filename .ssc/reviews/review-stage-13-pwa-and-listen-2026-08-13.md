# SSC Code Review Report

**Date:** 2026-08-13
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-13-pwa-and-listen (stage)
**Profile:** full — severity floor: Medium (Low/Nit: note only, per PM; anti-cheat still surfaced)
**Feature spec anchor:** `.ssc/stages/stage-13-pwa-and-listen/feature-0{1–5}-*.md`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 2 | Low 1 surfaced (anti-cheat) | Nit 0 surfaced
- **Overall rationale:** Stage 13 Intent is delivered for install, in-app Install, standalone shell, and Reload-on-deploy. The two Confirmed Medium findings sit on listen: a mid-play rate change can treat Chromium’s cancel as a TTS failure, and the fixed phone-width bar can wrap rates and error copy off-screen. Validator rejected the install BIP-timing claim as spec-required on-mount capture. No Blockers; address the listen cluster before finalize if the proving tablet is the gate.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** stage-13-pwa-and-listen (all five verified features)
- **Base reference:** n/a (SSC-native scope)
- **Profile / floor:** full / Medium; PM asked Low and below to be noted only (anti-cheat still surfaced). Reviewers: Grok 4.6 high.
- **Batches:** B1 (Features 01–03 install/shell), B2 (Feature 04 listen), B3 (Feature 05 updates); then one validator pass
- **Files reviewed:** 36 text paths
  - `web/public/sw.js`, `web/components/pwa-register.tsx`, `web/components/pwa-install-provider.tsx`, `web/components/settings/home-screen-settings.tsx`, `web/components/pwa-theme-color.tsx`, `web/components/pwa-update-bar.tsx`
  - `web/app/layout.tsx`, `web/app/globals.css`, `web/app/manifest.ts`, `web/app/build-id/route.ts`, `web/app/(protected)/settings/page.tsx`, `web/app/login/page.tsx`, `web/app/login/actions.ts`
  - `web/next.config.mjs`, `web/middleware.ts`, `web/Dockerfile`
  - `web/lib/issue-listen-text.ts`, `web/lib/issue-listen-player.ts`, `web/lib/pwa-update.ts`, `web/lib/build-id.ts`, `web/lib/auth/routes.ts`
  - `web/hooks/use-issue-listen.ts`, `web/components/issues/issue-listen-bar.tsx`, `web/components/issues/issue-reader.tsx`, `web/components/issues/issue-markdown.tsx`
  - Tests: `pwa-chromium-installability`, `pwa-in-app-install`, `pwa-standalone-shell`, `pwa-install-shell`, `issue-listen-text`, `issue-listen-player`, `issue-listen-bar`, `issue-reader`, `pwa-installed-app-updates`, `pwa-update-bar`, `routes`
- **Files skipped:**
  - Binary PNG/ICO contents — presence/contract only
  - Unmodified Stage 12 `settings-panel.test.tsx` / `issue-markdown.test.tsx` (regression-only, not in this stage’s create/modify set)
  - Live Android Edge/Brave install / TTS / deploy smoke (stage-level operator check, not CI)
- **Assumptions and unknowns:**
  - Production HTTPS for PWA install assumed
  - Chromium `beforeinstallprompt` typically fires after `load`; validator treated on-mount capture as spec-required, not a miss
  - Mid-play rate/TTS cancel race depends on the engine attaching `canceled`/`interrupted` to the *new* utterance (old generation is already ignored)
  - Low/Nit notes below floor are listed at the end of Detailed Findings; they are not triage items unless the PM promotes them

---

## SSC Intent Check

- **Stage Intent:** Homepress as a home-screen app on Android (Edge primary, Brave too) that opens fullscreen, stays signed in, and lets the operator listen to an issue in-app using the device’s preferred TTS — still a web app, not a native one.
- **Feature Intent lines:**
  1. Real Chromium **Install app** (not a bookmark tab) via passthrough SW + registration
  2. Settings **Install Homepress** only when the browser can install; no fake button
  3. Standalone window with working sign-in/session; theme-color + safe-area
  4. Issues-reader listen: play / pause / stop + rate, system preferred engine
  5. After deploy, Reload in the already-installed window without deleting the icon
- **Intent served?** Partially — install / Settings install / standalone / updates hold after validation. Listen Intent is present but Confirmed Medium findings mean rate-while-playing and phone-width controls can fail on the proving device.
- **Notes:** Validator rejected BIP-before-hydration, public `/build-id`, and `skipWaiting`/`clients.claim` as spec-required. See C2, U3, N1.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity then category. Track completion only via these checkboxes.

### [x] C2-20260813: Mid-play rate change can treat cancel as TTS failure

| Field | Value |
|---|---|
| **ID** | `C2-20260813` |
| **Severity** | Medium (reviewer High → validator Medium) |
| **Category** | Correctness & Reliability |
| **Location** | `web/lib/issue-listen-player.ts:91-156` |
| **Description** | `setRate` while playing calls `cancel()` then `speak()` in the same turn. Utterance `onerror` ignores `SpeechSynthesisErrorEvent.error` and treats any current-generation error as fatal. Chromium often fires `canceled`/`interrupted` asynchronously on utterances queued right after `cancel`, including the restarted current + lookahead chunks. A mid-play rate tap can idle the player and show `Couldn’t start listening.` |
| **Risk / Impact** | Spec’d mid-play rate restart can silence playback on Android Chromium (the proving target). Play retries; not complete listen breakage. Old-utterance cancel errors are already filtered by generation. |
| **Evidence** | Playing `setRate` runs `bumpGenerationAndCancel()` then `startFrom(chunkIndex)` with no yield. `onerror` is `() => { if (disposed \|\| gen !== generation) return; … onError(); }` and never reads `error === "canceled" \| "interrupted"`. |
| **Recommendation** | Ignore utterance errors whose `error` is `canceled` or `interrupted` (cancel-driven, per spec). After a playing `setRate` cancel, re-enqueue current+lookahead only after those cancel events flush. Do not use `synth.pause` / `synth.resume`. |
| **Effort** | M |
| **Confidence** | High |
| **Suggested Tests** | Fake synth that on `cancel()` asynchronously fires `onerror { error: "interrupted" }` on every utterance in queue, including those spoken after cancel in the same turn. `setRate(2)` while playing chunk 1 must not call `onError` and must restart chunk 1 at rate 2. A `synthesis-failed` error must still `onError` + idle + `chunkIndex` 0. |
| **Acceptance Criteria** | Changing rate while speaking restarts the current chunk at the new rate without showing `ISSUE_LISTEN_ERROR_COPY`. Real synthesis failures still cancel leftovers, idle, `chunkIndex` 0, `onError` then `onState`. No `synth.pause` or `synth.resume`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Code matches: generation only filters *old* utterances; a canceled/interrupted error on the *restarted* chunk would idle and surface the error copy. Downgraded from High because Play retries and impact depends on the engine attaching cancel to the new utterance. |

---

### [x] U3-20260813: Phone-width listen bar overflows off-screen

| Field | Value |
|---|---|
| **ID** | `U3-20260813` |
| **Severity** | Medium |
| **Category** | UX / i18n / Accessibility |
| **Location** | `web/components/issues/issue-listen-bar.tsx:38-86` |
| **Description** | The fixed bar’s inner row is `h-16` with `flex-wrap`. Play, Stop, and five `whitespace-nowrap` `sm` rate buttons overflow a phone-width viewport. The error line is `w-full`, so it wraps to another row. Overflow is visible and the region is `bottom: 0`, so wrapped rates and `Couldn’t start listening.` extend off the bottom of the screen rather than growing the bar upward. The in-flow spacer is also `h-16`, so overflow is not reserved. |
| **Risk / Impact** | On the installed-app Android proving target, rate controls are hard to tap and the locked TTS error copy can sit below the viewport — failing “error visible on the bar” even when tests find the text in the DOM. |
| **Evidence** | Spacer and inner flex both `h-16`. Rate `Button`s use `size="sm"` plus Button CVA `whitespace-nowrap`. Error is `<p className="w-full text-sm text-destructive">`. Region is `fixed inset-x-0 bottom-0`. |
| **Recommendation** | Drop the inner `h-16` clamp (keep the spacer in sync with actual bar height). Allow the bar to grow with wrapped controls and error text (`padding-bottom` safe-area still on the region). Keep Play/Stop on the first row; put rates on a second row on narrow widths instead of overflowing the viewport. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Render at ~360px width and assert every rate button and the error copy have a non-zero intersection with the viewport (or that the region’s bounding box includes them). After firing `onerror`, the error text must not sit below the region’s bottom edge. |
| **Acceptance Criteria** | At phone width, Play, Stop, all five rate labels, and the error copy are visible inside the fixed bar (above the home indicator / safe-area). Last markdown remains unhidden via a spacer that matches the bar’s real height. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Layout matches the claim; Stage 13 proving includes Android phone. Play+Stop+five rates exceed ~360px; a second wrapped row cannot fit in 64px. |

---

### [x] N1-20260813: Cache Storage negative test vacuously passes without sw.js

| Field | Value |
|---|---|
| **ID** | `N1-20260813` |
| **Severity** | Low (anti-cheat — always surfaced) |
| **Category** | Anti-cheat |
| **Location** | `web/src/__tests__/pwa-chromium-installability.test.ts:28-33` |
| **Description** | The Cache Storage negative test returns early when `web/public/sw.js` is missing, so that isolated case cannot fail. A missing worker vacuously passes “does not use `caches.open` / `cache.put` / `cache.addAll` / `cache.add(`”. |
| **Risk / Impact** | If this test is run alone (or the existence test is deleted), a missing SW looks like a green no-cache result. The suite’s earlier existence test still fails when the full file runs. Not a production shortcut. |
| **Evidence** | `if (!existsSync(swPath)) { return; }` before the `not.toMatch` assertions. Comment acknowledges a vacuous pass. |
| **Recommendation** | Fail when `sw.js` is missing (same as the fetch-handler test) instead of returning. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | With `sw.js` absent, this test must fail; with a file containing `caches.open`, it must fail; passthrough-only source must pass. |
| **Acceptance Criteria** | The no-Cache-Storage case fails if `sw.js` does not exist, and still fails if the file uses `caches.open` / `cache.put` / `cache.addAll` / `cache.add(`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | This case uniquely early-returns when the file is missing; sibling cases assert `existsSync`. Isolated-run hole, not a production cheat. Keep Low. |

---

### Below-floor notes (Low / Nit — not triage items unless promoted)

PM asked Low and below noted only. Validator Confirmed these; they are not in the merge-block path.

| ID | Sev | Category | Location | Note |
|---|---|---|---|---|
| [x] T1-20260813 | Low | Testing | `pwa-in-app-install.test.tsx:248-261` | Standalone BIP case asserts absence without `waitFor`; a regression that still stores BIP can pass. |
| [x] T2-20260813 | Low | Testing | `pwa-in-app-install.test.tsx:248-262` | Fullscreen `display-mode` suppression is untested (only standalone). |
| [x] M1-20260813 | Low | Maintainability | `home-screen-settings.tsx:13-39` | `isPrompting` never paints; section unmounts as soon as the deferred event is cleared. |
| [x] C4-20260813 | Low | Correctness | `issue-listen-text.ts:63-64` | Global leftover `[*_~]` wipe mangles `snake_case` / `2 * 3` after paired-emphasis strip. |
| [x] M3-20260813 | Low | Maintainability | `use-issue-listen.ts:11-14` | Hook duplicates error copy and rate list instead of `ISSUE_LISTEN_ERROR_COPY` / `ISSUE_LISTEN_RATES`. |
| [x] C6-20260813 | Low | Correctness | `pwa-update-bar.tsx:26-31` | `fetch` follows redirects; 302→login HTML could become a stamp. Latent: `/build-id` is public today. Validator downgraded from Medium. |
| [x] T7-20260813 | Low | Testing | `pwa-update-bar.test.tsx:30-131` | Bar tests never assert `/build-id` URL, `cache: "no-store"`, or HTML-200 silent. |
| [x] T8-20260813 | Low | Testing | `pwa-installed-app-updates.test.ts:283-331` | Untested: `NODE_ENV===development` gate, no `controllerchange` reload, Dockerfile COPY before `chown`. |
| [x] U5-20260813 | Low | UX / a11y | `pwa-update-bar.tsx:64-67` | `aria-label` on a role-less `div` is not in the a11y tree; add `role="status"` or `region`. |
| [x] T6-20260813 | Nit | Testing | `issue-listen-bar.test.tsx:329-333` | Dead `existsSync` around the no-toast grep. |

**Rejected by validator (not defects):** BIP-before-`useEffect` (spec on-mount capture); in-flight Install disable (native sheet); login `min-h-screen` (Feature 03 forbids editing login); Install focus restore; bare `toThrow()`; Settings gate formatting; `play()` while already playing (bar maps to pause); `play([])` from paused; extra listen test cases beyond spec; duplicate safe-area padding; in-flight `stop()` vs root-layout lifetime; public `/build-id`; `skipWaiting`/`clients.claim`; non-idempotent `start()`; `nosniff` on `/build-id`.

---

## Dependencies and Licensing

- Vulnerabilities: none identified in this stage’s surface (no new TTS/markdown/PWA npm packages)
- Outdated critical packages: none in scope (vanilla `sw.js`, Web Speech, no Workbox/Serwist/`next-pwa`)
- License concerns: none

---

## Quality Signals

- Lint/config signals: not re-run in this pass; features were verified with `pnpm typecheck` / `pnpm lint` at execute time
- Test/coverage signals: Feature 04/05 suites lock the spec cases they named; gaps Confirmed as Low notes (standalone `waitFor`, fullscreen, fetch URL/`no-store`, dev gate, `controllerchange`, COPY-before-chown). Anti-cheat N1 is an isolated vacuous pass, not over-mocking of production logic
- Complexity/churn signals: listen player (cancel-based pause + lookahead + generation) is the densest new module; PWA wrappers are small root-layout clients

---

## Risk Assessment

- **Overall risk:** Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Live Android Edge/Brave Install / TTS / deploy-Reload smoke; iOS; offline cache; push; named TTS engines; Edge Read Aloud
- **Why Medium, not High:** No Blocker or remaining High. Listen still plays/pauses/stops; the Medium pair is rate-while-playing plus phone chrome. Install and Reload paths survived validation as matching Intent.

---

## PM Triage

Filled 2026-08-13. Hardening spec: `.ssc/stages/stage-13-pwa-and-listen/feature-06-hardening-review-2026-08-13.md`.

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| C2-20260813 | Medium | Address now | Mid-play rate → false TTS error on Chromium cancel |
| U3-20260813 | Medium | Address now | Phone listen bar overflow / error off-screen |
| N1-20260813 | Low (anti-cheat) | Address now | Vacuous no-cache test if `sw.js` missing |
| T1-20260813, T2-20260813 | Low | Address now | Cheap install-test locks; PM sweep of Low pile |
| M1-20260813 | Low | Address now | Dead `isPrompting`; remove only (no in-flight disable) |
| C4-20260813 | Low | Address now | Speakable-text wipe of `snake_case` / leftover `*` |
| M3-20260813 | Low | Address now | Share listen rates + error copy |
| C6-20260813, T7-20260813 | Low | Address now | Redirect/HTML stamp residual + fetch contract tests |
| U5-20260813 | Low | Address now | Update bar needs a real `role` |
| T8-20260813 | Low | Address now | Dev gate / no `controllerchange` / COPY-before-chown |
| T6-20260813 | Nit | Address now | Folded into U3 bar-test task (dead `existsSync`) |

Rejected findings stay out (not defects). PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
