# Feature 05: PWA install shell

## Intent

Make the personally deployed Homepress instance installable to an iOS/Android home screen (and show a proper browser-tab favicon) so the operator can open it as a standalone-ish app icon instead of hunting a browser bookmark — without building a native app or adding device APIs.

## Spec

Add a **web app manifest**, **favicon**, and **install icons**, plus the minimal Next.js metadata so Homepress can be added to the home screen on iOS and Android and opens in a standalone-ish shell. Favicon is in scope (PM addition during Feature 05 spec) because this feature already owns the icon set.

This feature does **not** touch Settings (Features 01–04), offline caching, push notifications, background sync, or a custom in-app install banner.

### Auto-pinned decisions (research-backed)

| Topic | Pin | Why |
|-------|-----|-----|
| Manifest | `web/app/manifest.ts` returning `MetadataRoute.Manifest` | Next.js 15 App Router convention ([Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps); Context7 `/vercel/next.js`) |
| Favicon / tab icon | `web/app/favicon.ico` **and** `web/app/icon.png` (or `icon.tsx` ImageResponse) via App Router metadata file conventions | Next.js auto-injects `<link rel="icon">`; PM asked for favicon in this stage |
| Apple touch icon | `web/app/apple-icon.png` (180×180) **or** `apple-icon.tsx` | iOS Safari ignores manifest icons for A2HS; needs apple-touch-icon |
| PWA icons | Static files under `web/public/icons/`: at least **192×192** and **512×512** PNG referenced from the manifest | Chrome/web.dev install criteria require both sizes |
| Maskable | Provide a **maskable** 512×512 (safe-zone padding) **in addition to** `purpose: "any"` 192 + 512, or dual-purpose entries that remain readable when cropped | Android adaptive icons crop aggressively |
| Display | `display: "standalone"` | Stage acceptance: standalone-ish shell |
| Names | `name` + `short_name` = `APP_NAME` (`"Homepress"` from `@newsletter/shared`) | Product name on home screen |
| `start_url` / `scope` | `start_url: "/"`, `scope: "/"` | Opens at app root after install |
| Theme / background | `theme_color` and `background_color` = `#ffffff` (light shell splash); also set `metadata.themeColor` / `appleWebApp` in root layout | Matches current light `--background`; no dark-splash complexity in Stage 12 |
| iOS meta | Root `metadata.appleWebApp = { capable: true, title: APP_NAME, statusBarStyle: "default" }` | Safari A2HS chrome |
| Service worker | **None** | Stage forbids native device APIs / offline product; Chrome menu Install no longer requires SW (Chrome 108+/112+); avoid empty-fetch SW anti-pattern |
| Custom install UI | **None** — no `beforeinstallprompt` banner | Minimal install support; operator uses browser Share / Install menu |
| Icon art | Simple committed **lettermark**: white capital **H** centered on near-black square (`#0a0a0a`), no photography or third-party brand kit | No existing assets; internal-tool quality; same mark across favicon + PWA icons |
| Auth | Icons, favicon, and `/manifest.webmanifest` must load **without** login | `web/middleware.ts` matcher already excludes `favicon.ico`, `ico`, `png`, `webmanifest` — do not break that |

### Manifest contract (exact)

`web/app/manifest.ts` must export a default function returning at least:

- `name`: `APP_NAME`
- `short_name`: `APP_NAME`
- `description`: short operator-facing one-liner (e.g. “Self-hosted AI-curated newsletters”)
- `start_url`: `"/"`
- `scope`: `"/"`
- `display`: `"standalone"`
- `background_color`: `"#ffffff"`
- `theme_color`: `"#ffffff"`
- `icons`: array including:
  - `{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }`
  - `{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }`
  - `{ src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }`

Paths are under `web/public/` so they are served at `/icons/...`.

### Root layout metadata

Extend `web/app/layout.tsx` `metadata` (keep existing `title: APP_NAME`) with:

- `applicationName`: `APP_NAME`
- `appleWebApp`: `{ capable: true, title: APP_NAME, statusBarStyle: "default" }`
- `themeColor`: `"#ffffff"` (or equivalent Metadata themeColor form)
- Do **not** manually duplicate favicon/apple link tags if App Router file conventions already emit them — prefer conventions over hand-rolled `<head>` links.

### What “done” looks like for the operator

- Browser tab shows the Homepress favicon (not the default Next/empty icon).
- On iOS Safari: Share → Add to Home Screen shows Homepress name + icon; opening uses standalone-ish chrome.
- On Android Chrome: browser Install / Add to Home Screen is available when install criteria are met (HTTPS in production, valid manifest + icons); opens standalone-ish.
- No new Settings knobs, no offline mode, no push.

## Dependencies

- Builds on: Stage 02 app shell (`web/app/layout.tsx`, `APP_NAME`), Stage 11 deploy (HTTPS via operator’s reverse proxy is assumed for production install).
- Independent of Features 01–04 (Settings). May ship in any order relative to them.
- Patterns: Next.js metadata file conventions; existing middleware static-asset exclusions.

## Constraints

- No service worker, Workbox, `next-pwa`, push, background sync, or offline cache.
- No custom install-prompt UI / `beforeinstallprompt` handling.
- Do not put icons behind auth; do not narrow the middleware matcher so that `favicon.ico`, `*.png`, or `*.webmanifest` require a session.
- Do not change Settings schema, nav, or runtime consumers.
- Do not add a marketing landing page; keep internal-tool quality.
- Icon assets must be committed to the repo (no runtime download of brand assets).
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] `web/app/manifest.ts` serves a Homepress web app manifest with `display: "standalone"`, product name, and 192 + 512 icons (plus maskable 512).
- [ ] Browser-tab favicon is present (`favicon.ico` and/or App Router `icon` convention) using the Homepress mark.
- [ ] Apple touch icon is present for iOS Add to Home Screen.
- [ ] Root layout sets `appleWebApp` capable + Homepress title and a theme color.
- [ ] Favicon, `/icons/*`, and the generated manifest URL are reachable without authentication.
- [ ] No service worker and no custom install banner are introduced.
- [ ] Homepress can be added to the home screen on iOS and Android with the product name and icon and opens in a standalone-ish shell (manual device check at stage finalize / operator smoke; automated tests cover manifest + assets).

## Files

- Create: `web/app/manifest.ts`
- Create: `web/app/favicon.ico`
- Create: `web/app/icon.png` **or** `web/app/icon.tsx` (ImageResponse) — prefer static PNG if both favicon and PWA share one mark pipeline
- Create: `web/app/apple-icon.png` **or** `web/app/apple-icon.tsx`
- Create: `web/public/icons/icon-192.png`
- Create: `web/public/icons/icon-512.png`
- Create: `web/public/icons/icon-512-maskable.png`
- Create (optional but useful): `web/public/icons/README.md` or a short comment in the SVG source describing the mark — only if it helps rebuild; do not write drive-by docs otherwise
- Create (optional): `web/public/icons/homepress-mark.svg` as the single source for regenerating PNGs
- Modify: `web/app/layout.tsx` — appleWebApp / themeColor / applicationName
- Modify only if needed: `web/middleware.ts` — keep static exclusions; fix only if a new path is blocked
- Test: `web/src/__tests__/pwa-install-shell.test.ts`

## Testing approach

Test-first for the **manifest contract and asset presence**. Full device A2HS cannot run in CI — that remains a stage-level / operator smoke check.

### Test cases (`web/src/__tests__/pwa-install-shell.test.ts`)

1. **Manifest shape** — Import default export from `web/app/manifest.ts` (or dynamic import). Assert `name`/`short_name` === `APP_NAME`, `display === "standalone"`, `start_url === "/"`, `theme_color`/`background_color` === `"#ffffff"`, and icons include 192 `any`, 512 `any`, and 512 `maskable` with the exact `/icons/...` paths above.
2. **Icon files exist** — `fs.existsSync` (or `readFileSync`) for each referenced `web/public/icons/*.png` and for `web/app/favicon.ico`. If using `icon.tsx` / `apple-icon.tsx` instead of static `icon.png` / `apple-icon.png`, assert those route modules exist and export a default image handler (and still require favicon.ico + public PNGs).
3. **PNG sanity** — Each public PNG file is non-empty and starts with the PNG magic bytes `\x89PNG\r\n\x1a\n` (guards against empty/placeholder text files).
4. **Layout metadata (source read — do not import `layout.tsx`)** — `readFileSync` `web/app/layout.tsx` and assert the `metadata` export source includes `applicationName` tied to `APP_NAME`, `appleWebApp` with `capable: true` and Homepress title, and theme color `#ffffff`. **Do not** `import` the layout module in vitest — it pulls `./globals.css` / Tailwind and will fail the harness for the wrong reason. (Alternative allowed only if builder extracts metadata to a tiny CSS-free module and imports that instead.)
5. **Auth exclusion regression** — Assert `web/middleware.ts` `config.matcher` still excludes `favicon.ico`, `webmanifest`, **and** `png` (the static-extension group that covers `/icons/*.png` and App Router icon PNGs) so install assets stay public.

**Not required in automated tests:** launching iOS/Android simulators, registering a service worker, firing `beforeinstallprompt`.

## Tasks

### Task 1: Failing tests for PWA shell contract

- **Action**: Create `web/src/__tests__/pwa-install-shell.test.ts` with the five cases above targeting the final paths/contracts. Run the web vitest target and confirm failures (missing files / missing manifest).
- **Expected result**: Test file exists and fails for the right reasons (not import/syntax errors in the test itself).
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-install-shell.test.ts` shows failing assertions for missing manifest/assets/metadata (not CSS/harness blow-ups).
- **Depends on**: none.

### Task 2: Homepress icon mark + favicon + PWA PNGs

- **Action**: Create the lettermark (SVG source optional) and commit `web/app/favicon.ico`, App Router icon + apple-icon (static or `*.tsx` ImageResponse), and `web/public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`. Maskable variant must keep the H inside the center ~80% safe zone. Create `web/public/` if missing.
- **Expected result**: All icon files exist on disk; PNGs have valid headers; favicon is a real `.ico` (or Next-accepted favicon convention that still satisfies the favicon existence test).
- **Verify**: File presence + PNG magic-byte checks pass; visual spot-check that the mark is an H on dark square (verifier opens/reads files; no need for pixel-perfect OCR).
- **Depends on**: Task 1.

### Task 3: Manifest + root layout install metadata

- **Action**: Add `web/app/manifest.ts` per the contract (import `APP_NAME` from `@newsletter/shared` or `@newsletter/shared/client` — match existing layout import style). Update `web/app/layout.tsx` with `applicationName`, `appleWebApp`, and `themeColor`. Confirm middleware still allows public icon/manifest fetches; adjust only if a regression appears.
- **Expected result**: Manifest module + layout metadata complete; no SW or install-banner code.
- **Verify**: Previously failing tests for manifest shape + layout metadata pass; `pnpm typecheck` and `pnpm lint` pass; grep confirms no `navigator.serviceWorker` / `beforeinstallprompt` / workbox additions in `web/`.
- **Depends on**: Task 2.

### Task 4: Feature verification gate

- **Action**: Run the full feature verification command set; fix any remaining gaps without expanding scope.
- **Expected result**: All Feature 05 tests green; typecheck/lint green; handoff notes ready.
- **Verify**: Commands in **Feature verification** succeed.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/pwa-install-shell.test.ts`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: PWA install-shell tests pass; typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning). Manifest returns Homepress standalone config; favicon + public icons present; no service worker introduced.

## Handoff

Builder reports: files created/modified; how icons were generated (SVG→PNG tool, ImageResponse, etc.); confirmation that favicon + apple + 192/512/maskable exist; confirmation no SW/install banner; any deviation (e.g. ImageResponse instead of static `icon.png`) and why; test + typecheck + lint results.

## Research note

- **Next.js PWA + metadata**: Context7 `/vercel/next.js` + Next.js 15 PWA guide — `app/manifest.ts`, `favicon`/`icon`/`apple-icon` file conventions.
- **Install criteria**: [web.dev install-criteria](https://web.dev/articles/install-criteria) (manifest name/icons/start_url/display); Chrome [update-install-criteria](https://developer.chrome.com/blog/update-install-criteria) — menu Install no longer requires a service worker (avoid empty fetch handlers).
- **Codebase**: `web/app/layout.tsx` currently only sets `title: APP_NAME`; no `public/` directory yet; `web/middleware.ts` already excludes `favicon.ico` and `webmanifest` from the auth matcher.
