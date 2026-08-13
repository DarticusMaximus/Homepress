# Feature 01: Chromium installability

## Intent

Make Homepress meet what Edge and Brave on Android still require to offer a real **Install app** (home-screen icon), not a bookmark that opens as a browser tab — so the operator can live in Homepress on the tablet they already use.

## Spec

Stage 12 shipped a valid web app manifest, icons, and `display: "standalone"`, and **deliberately omitted a service worker** (Chrome 108+/112+ menu Install no longer requires one). In practice Edge and Brave on Android still treat Homepress as a website you can shortcut. This feature supplies the missing install criterion: a **registered service worker with a real `fetch` handler**.

**Operator-visible done line (PM-confirmed):** In Edge or Brave on Android, the browser menu offers **Install app** (not only Add to home screen / Create shortcut), and completing it puts a **Homepress** icon on the home screen. A small Edge badge on that icon is expected and acceptable. This feature does **not** add an in-app Install control (Feature 02), does **not** change post-install chrome/session (Feature 03), and does **not** implement deploy-update UX (Feature 05).

### Auto-pinned decisions (grill + research)

| Topic | Pin | Why |
|-------|-----|-----|
| Missing criterion | Service worker with a **non-empty** `fetch` handler | Chrome dropped SW for *menu* Install ([update-install-criteria](https://developer.chrome.com/blog/update-install-criteria)); empty fetch handlers are ignored (Chrome 112+). Edge/Brave still commonly require a real `fetch` for **Install app** vs shortcut. PM smoke failed on Install, not offline. |
| Fetch behavior | Network pass-through only: `event.respondWith(fetch(event.request))` | Stage 13 out of scope: offline reading / issue cache. Must actually call `fetch` so Chromium does not treat the handler as a no-op. |
| SW file | `web/public/sw.js` served at `/sw.js`, register with `scope: "/"` | Origin-root SW can control `start_url` `/`. Vanilla file — no Workbox, Serwist, `next-pwa`. |
| Registration | Client component in **root** `web/app/layout.tsx` | Login lives at `web/app/login/` (root layout, not `(protected)`). PM: helper must start on the **login screen**, not only after sign-in. |
| Failure UX | Silent — no toast, banner, or Settings row | Feature 01 is invisible plumbing. Feature 02 owns “you can / can’t install.” |
| SW HTTP cache | `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js` | Next.js PWA guide; leaves Feature 05 able to pick up a new worker after deploy. |
| Manifest / icons | **Unchanged** (`web/app/manifest.ts`, Stage 12 icon set, `display: "standalone"`) | Stage 12 shell stays; Feature 03 owns fullscreen chrome. |
| Proving target | Android **Edge** (primary) and **Brave** | Desktop Install is a bonus, not a gate. iOS is out of stage scope. |
| Auth | `/sw.js` must load **without** login | `web/middleware.ts` matcher already excludes `*.js`; do not narrow that. |

### Service worker contract (exact)

`web/public/sw.js` must:

- Register a `fetch` listener that calls `event.respondWith(fetch(event.request))` (equivalent spelling OK: same request object passed to `fetch`).
- **Not** use the Cache Storage API (`caches.open`, `cache.put`, `cache.addAll`, etc.).
- **Not** be an empty/`fetch` no-op (listener with no `respondWith`, or `respondWith` of a non-fetch dummy).
- Stay free of push, background sync, and notification handlers (stage out of scope).
- Leave update takeover (`skipWaiting` / `clients.claim` UX) to Feature 05 — do not invent an update prompt here.

### Registration contract (exact)

Create `web/components/pwa-register.tsx`:

- `"use client"`.
- On mount (`useEffect`), if `navigator.serviceWorker` exists, call `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`.
- Catch registration failure and **swallow it** (no `console.error` required; no operator UI).
- Render `null` (no DOM).
- Mount from **root** `web/app/layout.tsx` (same tree as `ThemeProvider`) so `/login` and signed-in pages both register.

### Headers contract (exact)

Extend `web/next.config.mjs` `headers()` so `/sw.js` is served with:

- `Content-Type: application/javascript; charset=utf-8`
- `Cache-Control: no-cache, no-store, must-revalidate`

Do not add a marketing page, install button, or `beforeinstallprompt` handler.

## Dependencies

- Builds on: Stage 12 Feature 05 PWA install shell (`web/app/manifest.ts`, icons, `display: "standalone"`, public icon/manifest auth exclusions).
- Does not depend on Stage 13 Features 02–05; those consume this worker.
- Patterns: root layout client components (`web/components/theme-provider.tsx`); existing `web/middleware.ts` static-extension exclusions.

## Constraints

- Do not add offline caching, push, background sync, or Workbox/Serwist/`next-pwa`.
- Do not add in-app Install UI or handle `beforeinstallprompt` (Feature 02).
- Do not change `display`, `start_url`, `scope`, names, or icon set in `web/app/manifest.ts` (Feature 03 owns chrome).
- Do not implement “new version available” / skipWaiting UX (Feature 05).
- Do not put `/sw.js` behind auth; do not remove `js` from the middleware matcher’s static-extension group.
- Do not change Settings schema, nav, or login/session behavior.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] `web/public/sw.js` exists, is reachable without login, and implements a non-empty network-passthrough `fetch` handler (no Cache Storage).
- [ ] Root layout registers `/sw.js` with scope `/` on every page including `/login`; registration failures are silent.
- [ ] `/sw.js` is served with no-store/no-cache so a later deploy can replace the worker.
- [ ] Stage 12 manifest + icons are unchanged; no install button / `beforeinstallprompt` / offline cache introduced.
- [ ] On Android Edge and Brave (operator smoke / stage finalize): menu offers **Install app** and completing it places a Homepress icon on the home screen (Edge badge OK). Automated tests cover the SW + registration contract, not the device menu.

## Files

- Create: `web/public/sw.js`
- Create: `web/components/pwa-register.tsx`
- Create: `web/src/__tests__/pwa-chromium-installability.test.ts`
- Modify: `web/app/layout.tsx` — mount `PwaRegister` in the root tree
- Modify: `web/next.config.mjs` — `/sw.js` headers
- Modify only if a regression appears: `web/middleware.ts` — keep `js` in the static-extension exclusion
- Do not modify: `web/app/manifest.ts`, `web/public/icons/*`
- Regression: `web/src/__tests__/pwa-install-shell.test.ts` must still pass

## Testing approach

Test-first for the **service worker + registration contract**. Real Edge/Brave **Install app** cannot run in CI — that remains a stage-level / operator smoke check (same pattern as Stage 12 Feature 05).

### Test cases (`web/src/__tests__/pwa-chromium-installability.test.ts`)

1. **SW file exists and is non-empty JS** — `web/public/sw.js` exists; file is non-empty.
2. **Real fetch handler** — source contains a `fetch` event listener and `respondWith` wrapping `fetch(` of the request (e.g. `fetch(event.request)`). Fail if the fetch listener is missing or has no `respondWith`.
3. **No offline cache** — `sw.js` source must **not** match `caches.open`, `cache.put`, `cache.addAll`, or `cache.add(` (guards against shipping an offline product in this feature).
4. **Registration module** — `web/components/pwa-register.tsx` exists, is `"use client"`, and source includes `navigator.serviceWorker.register` with `"/sw.js"` and `scope: "/"`. Assert `updateViaCache` is `"none"`.
5. **Root layout mounts registrar (source-read — do not import `layout.tsx`)** — `readFileSync` `web/app/layout.tsx` and assert it imports and renders `PwaRegister` (or the chosen export name). **Do not** `import` the layout module in vitest — it pulls `./globals.css` / Tailwind (Stage 12 pin).
6. **SW is public** — `web/middleware.ts` `config.matcher` still excludes the `js` static-extension group (covers `/sw.js`). Optionally also assert `sw.js` is not a required-session path.
7. **SW headers** — `web/next.config.mjs` source includes a `/sw.js` header rule with `Cache-Control` containing `no-cache` (and `no-store` or `must-revalidate`).

**Not required in automated tests:** launching Android, firing `beforeinstallprompt`, registering a worker in jsdom, pixel checks.

**Regression:** existing `web/src/__tests__/pwa-install-shell.test.ts` still passes (manifest/icons/auth exclusions unchanged).

## Tasks

### Task 1: Failing tests for Chromium installability contract

- **Action**: Create `web/src/__tests__/pwa-chromium-installability.test.ts` with the seven cases above targeting the final paths/contracts. Run the web vitest target and confirm failures (missing `sw.js` / registrar / headers).
- **Expected result**: Test file exists and fails for the right reasons (not import/syntax errors in the test itself).
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-chromium-installability.test.ts` shows failing assertions for missing SW/registrar/headers (not CSS/harness blow-ups).
- **Depends on**: none.

### Task 2: Network-passthrough service worker

- **Action**: Create `web/public/sw.js` per the **Service worker contract**. No Cache Storage, no push, no update prompt.
- **Expected result**: `/sw.js` exists on disk and satisfies tests 1–3.
- **Verify**: Tests 1–3 pass; grep of `web/public/sw.js` shows `fetch` + `respondWith` and no `caches.open`.
- **Depends on**: Task 1.

### Task 3: Register on every page including login + SW headers

- **Action**: Create `web/components/pwa-register.tsx` per the **Registration contract**. Mount it from `web/app/layout.tsx` (root, not `(protected)/layout.tsx`). Add `/sw.js` headers in `web/next.config.mjs` per the **Headers contract**. Confirm middleware still allows unauthenticated `/sw.js`; adjust only if a regression appears.
- **Expected result**: Login and signed-in trees both include the registrar; `/sw.js` is public and no-cache; no install UI; no `beforeinstallprompt`.
- **Verify**: Tests 4–7 pass; `pnpm exec vitest run web/src/__tests__/pwa-install-shell.test.ts` still passes; `pnpm typecheck` and `pnpm lint` pass; grep of `web/` shows no `beforeinstallprompt` and no Workbox/Serwist/`next-pwa` additions.
- **Depends on**: Task 2.

### Task 4: Feature verification gate

- **Action**: Run the full feature verification command set; fix any remaining gaps without expanding scope.
- **Expected result**: Feature 01 tests green; Stage 12 PWA shell tests still green; typecheck/lint green; handoff notes ready.
- **Verify**: Commands in **Feature verification** succeed.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/pwa-chromium-installability.test.ts web/src/__tests__/pwa-install-shell.test.ts`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Chromium-installability tests pass; Stage 12 PWA shell tests still pass; typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning). `/sw.js` is a passthrough fetch worker; root layout registers it on login and in-app; no install button, no offline cache.

## Handoff

Builder reports: files created/modified; confirmation that `sw.js` is network-passthrough only (no Cache Storage); confirmation registration is in **root** layout (login included) and failures are silent; confirmation `/sw.js` headers are no-cache; confirmation manifest/icons untouched and no `beforeinstallprompt`; test + typecheck + lint results; any deviation and why.

## Research note

- **Install criteria**: [web.dev install-criteria](https://web.dev/articles/install-criteria) (manifest + HTTPS; SW not listed for current Chrome menu Install). [Chrome update-install-criteria](https://developer.chrome.com/blog/update-install-criteria) — menu Install dropped SW (Chrome 108 mobile / 112 desktop); **empty fetch handlers ignored**; `beforeinstallprompt` still historically wanted a `fetch` handler. [MDN Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
- **Next.js**: Context7 `/vercel/next.js` PWA guide — `navigator.serviceWorker.register`; `/sw.js` `Cache-Control: no-cache, no-store, must-revalidate`.
- **Codebase**: Stage 12 Feature 05 forbade a SW; this feature supersedes that for Stage 13. `web/middleware.ts` already excludes `*.js`. Login is under root layout (`web/app/login/`), not `(protected)`.
- **PM grill (2026-08-12)**: Done = Install app in Edge/Brave menu + Homepress home-screen icon; Edge badge OK; invisible plumbing; register on login; no offline; Android proving target.
