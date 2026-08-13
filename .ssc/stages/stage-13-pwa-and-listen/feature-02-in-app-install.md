# Feature 02: In-app install

## Intent

When Edge or Brave can install Homepress, the operator finishes that install from a clear control on Settings — no hunting the browser menu, and no fake button when install is not available.

## Spec

Feature 01 makes Chromium willing to offer **Install app**. This feature adds the in-app path: catch the browser’s `beforeinstallprompt` signal, and when it has fired, show a **Home screen** section at the bottom of Settings with **Install Homepress**. That button opens the **browser’s own** install sheet. If the browser never offers install, the section is absent.

**Operator-visible done line (PM-confirmed):** On Android Edge (primary) or Brave, with install available, Settings → Home screen → **Install Homepress** completes install. If install is not available (including already running as the installed app), that section is not on the page.

### Auto-pinned decisions (grill + research)

| Topic | Pin | Why |
|-------|-----|-----|
| Placement | Settings only — no banner, no nav item | One-time action; don’t nag on Issues. Settings is “operate this instance.” |
| Section | **Home screen**, after Pipeline & delivery knobs | PM-confirmed. |
| Copy | Helper: `Add Homepress to this device as an app.` Button: **Install Homepress** | PM-confirmed. |
| Visibility | Entire section **absent** unless a deferred `beforeinstallprompt` is held and the window is not standalone | No fake button; no “not available” lecture. iOS / Firefox / already-installed → nothing. |
| Capture | `preventDefault()` on `beforeinstallprompt`; hold the event in a **root-layout** provider | Required to call `prompt()` later ([MDN Trigger installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt)). Hides Chromium’s mini-infobar; **menu → Install app** still works. Event can fire before the operator opens Settings, so listening only on `/settings` would miss it. |
| Tap | `event.prompt()` — native sheet only | No custom dialog. `prompt()` is once-per-event. |
| After sheet | Hide section for this visit on **accepted or dismissed** | Event is spent. A later reload may show it again if the browser fires BIP. |
| Already installed | If `display-mode: standalone` (or `fullscreen`) at mount, ignore BIP and never show the section. Also hide on `appinstalled`. | Don’t offer Install inside the installed app. |
| Load error | Home screen still mounts when Connections/knobs fail to load | Install does not need Appwrite settings. |
| Failure | `toast.error` if `prompt()` throws; still clear the deferred event | Copy below. No success toast. |
| Not now | None | Section isn’t a banner; skip = don’t tap. |
| Manifest / SW | Unchanged | Feature 01 owns SW; Feature 03 owns chrome; Feature 05 owns updates. |
| Proving target | Android Edge + Brave | Desktop BIP is a bonus if it fires. iOS out of stage scope. |

### Provider contract (exact)

Create `web/components/pwa-install-provider.tsx` (`"use client"`):

- Export `PwaInstallProvider` and `usePwaInstall`.
- `usePwaInstall()` returns `{ canInstall: boolean; promptInstall: () => Promise<void> }` and **throws** if called outside the provider.
- On mount:
  - If `window.matchMedia("(display-mode: standalone)").matches` **or** `window.matchMedia("(display-mode: fullscreen)").matches`, treat as already installed: `canInstall` stays `false`; do not store BIP events.
  - Else listen on `window` for `beforeinstallprompt`: call `event.preventDefault()`, store the event, set `canInstall` true.
  - Listen on `window` for `appinstalled`: clear the stored event, set `canInstall` false.
- Remove both listeners on unmount.
- `promptInstall`:
  - If no stored event, return.
  - Call `stored.prompt()` (user-gesture path — invoke directly from the button click, not inside a `setTimeout`).
  - **Always** clear the stored event afterward (accepted, dismissed, or throw) so the button cannot be a no-op.
  - On throw: `toast.error("Couldn't open the install dialog. Try Install app in the browser menu.")` via `web/lib/toast.ts`.
- Define a local `BeforeInstallPromptEvent` type (`Event` + `prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>`). Do not add a types package.
- Render `{children}` only (no extra DOM).

Mount `PwaInstallProvider` from **root** `web/app/layout.tsx` inside `ThemeProvider`, wrapping `{children}` (so login and signed-in trees share one deferred prompt). Sibling of Feature 01’s `PwaRegister` is fine; do not put the listener only in the protected layout.

### Home screen section contract (exact)

Create `web/components/settings/home-screen-settings.tsx` (`"use client"`):

- Call `usePwaInstall()`. If `!canInstall`, return `null`.
- Otherwise render a section matching Connections / knobs chrome (`mb-6 rounded-lg border border-border bg-card p-4`):
  - `aria-label="Home screen"`
  - `data-testid="home-screen-settings"`
  - `h2` **Home screen** (`text-lg font-semibold`)
  - Helper `p`: `Add Homepress to this device as an app.` (`text-sm text-muted-foreground`)
  - `Button` `type="button"` `size="sm"` label **Install Homepress**, `id="settings-install-homepress"`, `disabled` while `promptInstall` is in flight (keep the same label).
- No Dismiss / Not now. No iOS Add-to-Home-Screen instructions.

### Settings page contract (exact)

Modify `web/app/(protected)/settings/page.tsx`:

- Import and render `<HomeScreenSettings />` **after** the Connections + knobs block, as a **sibling** of that block — **not** inside `{!loadError && data && (…)}`.
- When `loadError` is set, the page still shows the h1, the error alert, and Home screen (which self-hides if `canInstall` is false).

## Dependencies

- Builds on: Feature 01 Chromium installability (`web/public/sw.js` + `PwaRegister` in root layout) so real Edge/Brave will fire `beforeinstallprompt`. This UI still compiles if Feature 01 is present; execute Feature 01 before this feature.
- Builds on: Stage 12 Settings panel (`web/app/(protected)/settings/page.tsx`, Connections + knobs section chrome, `web/lib/toast.ts`).
- Patterns: root-layout client wrappers (`web/components/theme-provider.tsx`); Settings section markup in `web/components/settings/connections-settings.tsx`.

## Constraints

- Do not add a site-wide banner, nav item, or login-page Install button.
- Do not show an Install control unless a deferred BIP is held and the window is not standalone/fullscreen.
- Do not change `web/app/manifest.ts`, icons, `sw.js`, or Feature 01 registration besides mounting the new provider in `web/app/layout.tsx`.
- Do not add offline cache, Workbox/Serwist/`next-pwa`, push, or “new version available” UX (Feature 05).
- Do not change Settings schema, Connections, or knobs behavior.
- Do not add iOS A2HS copy or a named-engine / TTS path (Feature 04).
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] When `beforeinstallprompt` has fired and the app is not standalone, Settings shows a Home screen section with helper copy and **Install Homepress**.
- [ ] Tapping **Install Homepress** calls the deferred `prompt()` (browser install sheet). After accept, dismiss, or `prompt()` throw, the section is gone for that visit.
- [ ] When BIP has not fired, or the window is `display-mode: standalone` / `fullscreen`, or `appinstalled` has fired, the Home screen section is not in the document (no fake button).
- [ ] The deferred prompt is captured from root layout (survives navigating to Settings). Chromium mini-infobar is suppressed via `preventDefault`; browser menu Install is not removed by this feature.
- [ ] Home screen still mounts if Settings Appwrite load fails.
- [ ] Manifest, icons, and service worker are unchanged.

## Files

- Create: `web/components/pwa-install-provider.tsx`
- Create: `web/components/settings/home-screen-settings.tsx`
- Create: `web/src/__tests__/pwa-in-app-install.test.tsx`
- Modify: `web/app/layout.tsx` — wrap `{children}` with `PwaInstallProvider` inside `ThemeProvider`
- Modify: `web/app/(protected)/settings/page.tsx` — render `HomeScreenSettings` after knobs, outside the load-success gate
- Do not modify: `web/app/manifest.ts`, `web/public/sw.js`, `web/public/icons/*`, Settings actions/schema
- Regression: `web/src/__tests__/settings-panel.test.tsx` and `web/src/__tests__/pwa-install-shell.test.ts` must still pass; Feature 01 `web/src/__tests__/pwa-chromium-installability.test.ts` must still pass

## Testing approach

Test-first for the **in-app install contract**. Real Edge/Brave sheets cannot run in CI — operator smoke / stage finalize (same as Feature 01).

Stub `window.matchMedia` in tests. Dispatch a cancelable `Event("beforeinstallprompt")` with a mock `prompt` function. Wrap the section in `PwaInstallProvider`. Mock `web/lib/toast.ts` like `settings-panel.test.tsx`.

### Test cases (`web/src/__tests__/pwa-in-app-install.test.tsx`)

1. **Hidden by default** — render provider + `HomeScreenSettings`; no `home-screen-settings` / no **Install Homepress**.
2. **BIP reveals section** — dispatch BIP (cancelable); `preventDefault` was called; section + helper text + **Install Homepress** appear.
3. **Tap calls prompt and hides** — mock `prompt` resolving `{ outcome: "accepted" }`; click; `prompt` called once; section gone. Repeat-style case (same test or sibling): `outcome: "dismissed"` also hides.
4. **prompt throw** — `prompt` rejects; `toast.error` called with the exact copy above; section gone (event cleared).
5. **appinstalled hides** — after BIP shown, dispatch `appinstalled`; section gone.
6. **Standalone suppresses** — `matchMedia` reports standalone `matches: true`; dispatch BIP; section stays absent.
7. **Hook requires provider** — rendering `HomeScreenSettings` without provider throws (or the test documents the throw).
8. **Root layout mounts provider (source-read — do not import `layout.tsx`)** — `readFileSync` `web/app/layout.tsx`; assert it imports and renders `PwaInstallProvider` wrapping `{children}` inside `ThemeProvider`. **Do not** `import` the layout module (Stage 12 pin: `globals.css` / Tailwind).
9. **Settings page placement (source-read)** — `readFileSync` `web/app/(protected)/settings/page.tsx`; assert `HomeScreenSettings` is imported and rendered; assert it is **not** nested inside the `{!loadError && data && (` block (string/source check is enough).

**Not required in automated tests:** launching Android, real `BeforeInstallPromptEvent`, pixel checks, iOS.

**Regression:** `settings-panel.test.tsx`, `pwa-install-shell.test.ts`, `pwa-chromium-installability.test.ts` still pass.

## Tasks

### Task 1: Failing tests for in-app install contract

- **Action**: Create `web/src/__tests__/pwa-in-app-install.test.tsx` with the nine cases above. Run the web vitest target and confirm failures (missing provider / section / layout wiring).
- **Expected result**: Test file exists and fails for the right reasons (not import/syntax errors in the test itself).
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-in-app-install.test.tsx` shows failing assertions for missing provider/section/layout/page wiring (not CSS/harness blow-ups).
- **Depends on**: none.

### Task 2: Root-layout install provider

- **Action**: Create `web/components/pwa-install-provider.tsx` per the **Provider contract**. Mount it from `web/app/layout.tsx` per that contract. Do not add Settings UI yet beyond what tests need to import.
- **Expected result**: Tests 1, 5–8 can pass (hidden default, appinstalled, standalone, hook throw, layout source-read). Tests that need the Settings section may still fail.
- **Verify**: Relevant cases in `pwa-in-app-install.test.tsx` pass or fail only on missing `HomeScreenSettings`; `pnpm typecheck` and `pnpm lint` pass if the rest of the tree typechecks with the new provider.
- **Depends on**: Task 1.

### Task 3: Home screen Settings section

- **Action**: Create `web/components/settings/home-screen-settings.tsx` per the **Home screen section contract**. Modify `web/app/(protected)/settings/page.tsx` per the **Settings page contract**. Wire the button to `promptInstall`.
- **Expected result**: All nine test cases pass; Settings still shows Connections + knobs unchanged.
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-in-app-install.test.tsx web/src/__tests__/settings-panel.test.tsx` passes; grep of `web/` shows `beforeinstallprompt` only in the new provider (not a second listener); no banner/nav Install control.
- **Depends on**: Task 2.

### Task 4: Feature verification gate

- **Action**: Run the full feature verification command set; fix any remaining gaps without expanding scope.
- **Expected result**: Feature 02 tests green; Settings + PWA shell + Feature 01 tests still green; typecheck/lint green; handoff notes ready.
- **Verify**: Commands in **Feature verification** succeed.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/pwa-in-app-install.test.tsx web/src/__tests__/settings-panel.test.tsx web/src/__tests__/pwa-install-shell.test.ts web/src/__tests__/pwa-chromium-installability.test.ts`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: In-app install tests pass; Settings panel, Stage 12 PWA shell, and Feature 01 Chromium-installability tests still pass; typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning). Settings shows Home screen + **Install Homepress** only when BIP is deferred and not standalone; tap calls `prompt()`; no banner; SW/manifest untouched.

## Handoff

Builder reports: files created/modified; confirmation the provider is in **root** layout wrapping children; confirmation Settings Home screen is outside the load-success gate; confirmation `preventDefault` + once-per-event `prompt()` + hide on accept/dismiss/throw/`appinstalled`/standalone; confirmation no banner/nav/iOS copy; test + typecheck + lint results; any deviation and why.

## Research note

- **In-app install**: [MDN Trigger installation from your PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt) (Jun 2025) — `preventDefault`, store event, `prompt()`, hide on `appinstalled`; BIP is Chromium-only. [web.dev promote-install](https://web.dev/articles/promote-install) — don’t show UI until BIP; custom UI suppresses the Android mini-infobar.
- **Next.js**: Context7 `/vercel/next.js` PWA guide — detect standalone to hide install UI; no first-party `beforeinstallprompt` helper.
- **Codebase**: Settings sections in `web/components/settings/connections-settings.tsx`; toast via `web/lib/toast.ts`; do not import `layout.tsx` in vitest (Stage 12 Feature 05 pin). Feature 01 forbids BIP handling — this feature is the one that adds it.
- **PM grill (2026-08-12)**: Settings-only Home screen; native sheet; hide after accept or cancel; no Not now; no success toast; error toast on `prompt()` throw; section independent of Settings load.
