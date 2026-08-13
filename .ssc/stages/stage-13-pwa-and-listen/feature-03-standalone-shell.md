# Feature 03: Standalone shell

## Intent

Make the installed Homepress icon open as a real app window (no browser chrome) where sign-in and session keep working — so the operator is not dumped into an Edge/Brave tab they cannot use.

## Spec

Stage 12 already set `display: "standalone"`, `start_url: "/"`, and `scope: "/"`. Feature 01 left those fields to this feature. This feature makes that shell usable: keep **standalone** (Android status bar stays; no URL bar/tabs), keep login **inside** that window, and make the status-bar / theme chrome follow light and dark — including the in-app sun/moon toggle.

**Operator-visible done line (PM-confirmed):** Tap the Homepress icon → window with no URL bar or tabs. Signed in → dashboard. Not signed in → login form in that same window; after Log in, stay in the app. Session survives close/reopen. Article links in an issue still open in the browser. Status bar color matches the live theme (`#ffffff` light / `#0a0a0a` dark). Content is not hidden under the status bar or notch.

### Auto-pinned decisions (grill + research)

| Topic | Pin | Why |
|-------|-----|-----|
| Display | Keep `display: "standalone"`. Do **not** set `fullscreen` or `display_override` to fullscreen. | PM: “fullscreen” in the stage file means no browser chrome, not hiding the clock/battery. MDN `display` / Create a standalone app. |
| `start_url` / `scope` | Unchanged: `"/"` / `"/"` | Stage 12; Feature 01 SW scope `/` already matches. |
| Auth | No rewrite. Existing first-party email/password + `a_session_*` cookie (`path: "/"`, `sameSite: "lax"`). Same-origin `/login` redirect. | Login is already in-app (no OAuth hop). PM: same session as the installing browser; no separate PWA account. |
| Out-of-app links | In-app nav stays in the window. Issue markdown links stay `target="_blank"`. No link capturing / `scope_extensions`. | PM-confirmed. Articles belong in the browser. |
| Live theme-color | Follow **resolved** next-themes theme (toggle included), not OS-only. Light `#ffffff`, dark `#0a0a0a` (`oklch(0.145 0 0)`). | PM: match dark/light now, do not bank it. |
| First paint | Next.js `viewport.themeColor` media queries for `prefers-color-scheme`. Then a client helper overrides with a media-less `theme-color` meta. | Viewport API: Context7 `/vercel/next.js` generate-viewport. Toggle can disagree with OS. |
| Splash | Manifest `theme_color` and `background_color` stay `#ffffff` | Pre-JS splash; Stage 12 icon/splash contract. Live chrome is the meta tag. |
| Safe area | `viewportFit: "cover"` + `env(safe-area-inset-*)` padding on `body` (login and signed-in). | PM: content must not sit under status bar/notch. MDN `env()` + `viewport-fit=cover`. |
| Proving target | Android Edge (primary) and Brave | Same as Features 01–02. iOS not a proving target; safe-area still applies globally. |

### Viewport contract (exact)

In `web/app/layout.tsx`, **remove** `themeColor` from the `metadata` object (it moves here). Add:

```ts
import type { Viewport } from "next";

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};
```

Keep existing `metadata` fields (`title`, `applicationName`, `appleWebApp`). Do not change `appleWebApp.statusBarStyle`.

### Theme-color helper contract (exact)

Create `web/components/pwa-theme-color.tsx` (`"use client"`):

- Use `useTheme()` from `next-themes`.
- When `resolvedTheme` is `"dark"`, set theme-color to `#0a0a0a`. When `"light"`, set `#ffffff`. When `resolvedTheme` is undefined (hydration), do **not** write a media-less meta.
- Upsert a `<meta name="theme-color">` **without** a `media` attribute (create in `document.head` if missing) and set `content` to that hex so it wins over the first-paint media metas.
- Re-run when `resolvedTheme` changes (sun/moon toggle). Depend the effect on `resolvedTheme` (not `[]`) so a post-mount toggle updates the meta.
- Render `null`.
- Mount from **root** `web/app/layout.tsx` **inside** `ThemeProvider` (needs `useTheme`). Sibling of Feature 01/02 wrappers is fine.

Export hex constants from this module so tests do not duplicate magic strings:

- `PWA_THEME_COLOR_LIGHT = "#ffffff"`
- `PWA_THEME_COLOR_DARK = "#0a0a0a"`

### Safe-area CSS contract (exact)

In `web/app/globals.css` `@layer base` `body` rule (keep `bg-background text-foreground`), add:

- `padding-top: env(safe-area-inset-top, 0px);`
- `padding-right: env(safe-area-inset-right, 0px);`
- `padding-bottom: env(safe-area-inset-bottom, 0px);`
- `padding-left: env(safe-area-inset-left, 0px);`

Do not wrap only `(display-mode: standalone)` — padding is zero in a normal tab.

### Session-in-window contract (exact)

Do **not** change login/session architecture. Verify and keep:

- `web/app/login/page.tsx` — no `target="_blank"`, no `window.open`. Success still `router.replace("/")`.
- `web/app/login/actions.ts` — session cookie still `httpOnly`, `sameSite: "lax"`, `path: "/"`.
- `web/middleware.ts` — unauthenticated redirect still clones `request.nextUrl` and sets `pathname` to `"/login"` (same origin, stays in the PWA window).
- `web/components/issues/issue-markdown.tsx` — external `<a>` still `target="_blank"` `rel="noopener noreferrer"`.

### Manifest contract (exact)

`web/app/manifest.ts` stays `display: "standalone"`, `start_url: "/"`, `scope: "/"`, `theme_color: "#ffffff"`, `background_color: "#ffffff"`. Names and icons unchanged. Do not add `fullscreen` or a `display_override` chain.

## Dependencies

- Builds on: Stage 12 Feature 05 PWA install shell (`web/app/manifest.ts`, icons, `display: "standalone"`, root `appleWebApp` metadata).
- Builds on: Stage 02 login/session (`web/app/login/page.tsx`, `web/app/login/actions.ts`, `web/middleware.ts`, `web/lib/auth/session.ts`).
- Consumes: Feature 01 SW registration and Feature 02 `PwaInstallProvider` (standalone detection). This feature must not break Feature 02’s “hide Install when `display-mode: standalone`”.
- Patterns: root-layout client wrappers (`web/components/theme-provider.tsx`); source-read layout tests (do not `import` `layout.tsx` — Stage 12 pin); `next-themes` mock in `web/src/__tests__/shell-polish.test.tsx`.

## Constraints

- Do not set `display` to `fullscreen` or add `display_override` fullscreen.
- Do not change cookie name, `sameSite`, OAuth, or introduce the browser Appwrite SDK.
- Do not add link capturing, `scope_extensions`, or change issue-markdown `target="_blank"`.
- Do not add offline cache, Workbox/Serwist/`next-pwa`, push, Install UI, or “new version available” (Features 01, 02, 05).
- Do not add listen / Web Speech (Feature 04).
- Do not put `/manifest.webmanifest` or icons behind auth.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] Installed icon opens with `display: "standalone"` (no browser URL bar/tabs; Android status bar remains).
- [ ] Sign-in and session work in that window: login form is same-origin; success navigates in-app; cookie remains first-party `path=/` `SameSite=lax`; middleware `/login` redirect is same-origin.
- [ ] Issue article links still open in the browser (`target="_blank"`). In-app nav does not.
- [ ] Status bar / `theme-color` is `#ffffff` in light and `#0a0a0a` in dark, including after the in-app theme toggle.
- [ ] `viewport-fit: cover` is set; `body` uses `env(safe-area-inset-*)` padding so content is not under the notch/status bar.
- [ ] Manifest splash colors, names, icons, `start_url`, and `scope` are unchanged from Stage 12 besides remaining `standalone`.

## Files

- Create: `web/components/pwa-theme-color.tsx`
- Create: `web/src/__tests__/pwa-standalone-shell.test.tsx`
- Modify: `web/app/layout.tsx` — `viewport` export; remove `metadata.themeColor`; mount `PwaThemeColor` inside `ThemeProvider`
- Modify: `web/app/globals.css` — safe-area padding on `body`
- Modify: `web/src/__tests__/pwa-install-shell.test.ts` — stop asserting `metadata.themeColor: "#ffffff"`; assert `appleWebApp` still present; theme-color live contract lives in the new test file. Manifest `theme_color` `#ffffff` assertion **stays**.
- Do not modify: `web/app/manifest.ts` (unless a test proves `display`/`start_url`/`scope` drifted — then restore, do not expand), `web/app/login/page.tsx`, `web/app/login/actions.ts`, `web/middleware.ts`, `web/components/issues/issue-markdown.tsx` (read-only keep)
- Regression: `web/src/__tests__/pwa-install-shell.test.ts` (updated as above), Feature 01 `pwa-chromium-installability.test.ts`, Feature 02 `pwa-in-app-install.test.tsx` if present

## Testing approach

Test-first for the **standalone shell contract**. Real Edge/Brave standalone windows cannot run in CI — operator smoke / stage finalize (same as Features 01–02).

Do **not** `import` `web/app/layout.tsx` in vitest (Stage 12 pin: `globals.css` / Tailwind). Source-read that file. Mock `next-themes` `useTheme` like `shell-polish.test.tsx`, but drive `resolvedTheme` (a `vi.fn()` or stateful mock so a later case can change it after mount).

**Head isolation (required):** `beforeEach` (or equivalent per helper case) must remove every `meta[name="theme-color"]` from `document.head` so cases 4–7 are not order-dependent.

### Test cases (`web/src/__tests__/pwa-standalone-shell.test.tsx`)

1. **Manifest stays standalone** — import `web/app/manifest.ts` the same way `pwa-install-shell.test.ts` does (`pathToFileURL` + `@vite-ignore`). Assert `display === "standalone"`, `start_url === "/"`, `scope === "/"`, `theme_color === "#ffffff"`, `background_color === "#ffffff"`. Fail if `display === "fullscreen"` or `display_override` is present.
2. **Viewport contract (source-read `layout.tsx`)** — file exports `viewport` with `viewportFit: "cover"` (or `"cover"` next to `viewportFit`). `themeColor` array includes light `#ffffff` and dark `#0a0a0a` with `prefers-color-scheme` media strings. `metadata` object must **not** contain `themeColor`. `appleWebApp` / `applicationName` still present.
3. **Layout mounts helper (source-read)** — `layout.tsx` imports and renders `PwaThemeColor` (or the chosen export name) inside `ThemeProvider`.
4. **Light theme-color** — mock `useTheme` `{ resolvedTheme: "light" }`; render helper; `document.head` has `meta[name="theme-color"]:not([media])` with `content` `#ffffff`.
5. **Dark theme-color** — `{ resolvedTheme: "dark" }` → that meta `content` is `#0a0a0a`.
6. **Toggle after mount** — render with `resolvedTheme: "light"` (meta `#ffffff`); then change the mock to `"dark"` and rerender; the same media-less meta `content` becomes `#0a0a0a`. (A mount-only `useEffect([])` must fail this case.)
7. **Hydration skip** — `{ resolvedTheme: undefined }` → no media-less `theme-color` meta written by the helper.
8. **Safe-area CSS (source-read `globals.css`)** — `body` rule includes `safe-area-inset-top`, `-right`, `-bottom`, and `-left` (via `env(`).
9. **Login stays in-window (source-read)** — `web/app/login/page.tsx` has no `target="_blank"` and no `window.open`; contains `router.replace`. `web/app/login/actions.ts` cookie `set` includes `sameSite: "lax"` and `path: "/"`. `web/middleware.ts` still assigns `pathname` `"/login"` on a cloned `nextUrl`.
10. **Article links still leave (source-read)** — `web/components/issues/issue-markdown.tsx` still has `target="_blank"`.

**Not required in automated tests:** launching Android, pixel checks, real cookie jars, `matchMedia("display-mode: standalone")` in a device.

**Regression:** updated `pwa-install-shell.test.ts` still passes (manifest splash `#ffffff`, appleWebApp, icons, auth exclusions). Chromium-installability and in-app-install tests still pass if those files exist.

## Tasks

### Task 1: Failing tests for standalone shell contract

- **Action**: Create `web/src/__tests__/pwa-standalone-shell.test.tsx` with the ten cases above (including head cleanup in `beforeEach` and the toggle-after-mount case). Update `web/src/__tests__/pwa-install-shell.test.ts` so it no longer requires `themeColor: "#ffffff"` inside `metadata` (keep `appleWebApp` + manifest splash assertions). Run the web vitest target and confirm the new file fails for missing viewport / helper / safe-area (not harness blow-ups).
- **Expected result**: New test file exists; failures are missing contracts. Stage 12 PWA shell tests still pass after the metadata assertion move.
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-standalone-shell.test.tsx` fails on missing viewport/helper/CSS. `pnpm exec vitest run web/src/__tests__/pwa-install-shell.test.ts` passes.
- **Depends on**: none.

### Task 2: Viewport, safe-area, and live theme-color helper

- **Action**: Add the **Viewport contract** to `web/app/layout.tsx` and remove `metadata.themeColor`. Add the **Safe-area CSS contract** to `web/app/globals.css`. Create `web/components/pwa-theme-color.tsx` per the **Theme-color helper contract** and mount it inside `ThemeProvider`. Do not change login, middleware, manifest, or issue-markdown unless a test proves drift — then restore the session-in-window / article-link contracts.
- **Expected result**: All ten new test cases pass; Feature 02 standalone hide-install behavior is untouched.
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-standalone-shell.test.tsx web/src/__tests__/pwa-install-shell.test.ts` passes; `pnpm typecheck` and `pnpm lint` pass; grep of `web/app/manifest.ts` shows `display: "standalone"` and no `fullscreen`.
- **Depends on**: Task 1.

### Task 3: Feature verification gate

- **Action**: Run the full feature verification command set; fix any remaining gaps without expanding scope.
- **Expected result**: Feature 03 tests green; Stage 12 PWA shell tests green; Feature 01/02 tests green if present; typecheck/lint green; handoff notes ready.
- **Verify**: Commands in **Feature verification** succeed.
- **Depends on**: Task 2.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/pwa-standalone-shell.test.tsx web/src/__tests__/pwa-install-shell.test.ts`
- Also run if present: `pnpm exec vitest run web/src/__tests__/pwa-chromium-installability.test.ts web/src/__tests__/pwa-in-app-install.test.tsx`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Standalone-shell tests pass; Stage 12 PWA shell tests pass; Feature 01/02 tests pass if those files exist; typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning). Manifest remains `standalone` at `/`; viewport is `cover` with light/dark theme-color; helper updates media-less meta from resolved theme; body has safe-area padding; login stays same-origin; issue links stay `target="_blank"`.

## Handoff

Builder reports: files created/modified; confirmation `display` is still `standalone` (not fullscreen); confirmation `metadata.themeColor` moved to `viewport` with light/dark; confirmation `PwaThemeColor` is inside `ThemeProvider` and uses `resolvedTheme`; confirmation body safe-area padding; confirmation login/middleware/issue-markdown were left as session-in-window / article-leave; test + typecheck + lint results; any deviation and why.

## Research note

- **Standalone**: [MDN Create a standalone app](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Create_a_standalone_app) (May 2025) — `display: standalone`; `display-mode` media; do not use `fullscreen` unless hiding OS chrome.
- **theme-color**: Context7 `/vercel/next.js` `generate-viewport` — `themeColor` array + `viewportFit`. MDN `theme-color` media queries. Live override via media-less meta so next-themes toggle wins.
- **Safe area**: MDN `env(safe-area-inset-*)` requires `viewport-fit=cover`.
- **Codebase**: Login is server-action email/password + httpOnly cookie (no OAuth). Issue markdown already `target="_blank"`. Stage 12 tests asserted `metadata.themeColor`; this feature relocates that to `viewport` and updates the shell test.
- **PM grill (2026-08-12)**: standalone not fullscreen; in-app nav stays, articles leave; same browser session; live light/dark theme-color now (`#ffffff` / `#0a0a0a`); splash stays white; safe-area on the whole app.
