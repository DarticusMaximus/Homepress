# Feature 05: Installed-app updates

## Intent

After a deploy, let the operator move the already-installed Homepress window (or a normal tab) to the new version with a Reload tap — without deleting and reinstalling the home-screen icon.

## Spec

Feature 01’s service worker is network-passthrough and often **byte-identical across deploys**, so the browser can miss a new web image. This feature compares a **build stamp** this window booted with against a public stamp URL. When they differ, a slim **in-flow top bar** offers Reload. Tap reloads the current URL. No dismiss. No auto-reload (would cut off Feature 04 listen).

**Operator-visible done line (PM-confirmed):** Deploy a new web image. The installed app or a tab (including login) is already open, or you come back to it. Top bar: `A new version is ready.` **Reload**. Tap → same screen, new version, icon still there. No X. Listen stops because the page reloads — expected.

### Auto-pinned decisions (grill + research)

| Topic | Pin | Why |
|-------|-----|-----|
| Trigger | Operator taps **Reload** — never auto-reload, never `controllerchange` → `location.reload()` | PM: most apps; auto-reload cuts listen. |
| Placement | In-flow top of **root** layout (login + signed-in + tabs). Pushes content down. **Not** `position: fixed`. Not Settings-only. Not a toast. | PM: top of page; Feature 03 `body` safe-area padding keeps it out of the status bar; Feature 04 listen owns the bottom. |
| Copy | Line `A new version is ready.` Button **Reload** | PM-confirmed. |
| Dismiss | None — bar stays until Reload | PM: dismiss would leave a stale window. |
| When | Check on mount, when `document.visibilityState` becomes `"visible"`, and every **60 minutes** while mounted | PM: open / come back / ~1 hour if sitting. |
| Detection | Next.js `.next/BUILD_ID` via public `GET /build-id`, compared to `bootId` from root layout | Passthrough `sw.js` often does not change; SW `updatefound` alone would miss deploys. |
| Reload | `window.location.reload()` on the current URL | Full document load picks up new JS. Not `router.refresh()`. |
| Failures | Silent — no toast, no bar from a failed check | Same as Feature 01 registration. Keep last “update available” state if a later check fails. |
| Dev | If `process.env.NODE_ENV === "development"`, do not poll and do not show the bar | `next dev` stamps churn. Vitest is `test`; production bundle is `production`. |
| SW takeover | `skipWaiting` on `install`; `clients.claim` on `activate`. Keep passthrough `fetch`. No Cache Storage. | Feature 01 deferred this. Do **not** reload on `controllerchange`. |
| SW check | After `register`, call `registration.update()` on the same schedule (mount / visible / 60 min). Swallow errors. | Browser may wait 24h otherwise in a long-lived PWA. |
| Public files in image | `web/Dockerfile` copies `web/public` into the standalone runner | Next.js standalone omits `public/`; without this, `/sw.js` and `/icons/*` never ship. Stage 11 forbade inventing this until `public/` existed — Feature 01 adds `sw.js`. |
| Proving target | Android Edge (primary) and Brave | Same as Features 01–03. iOS out of stage scope. |

### Build-stamp contract (exact)

Create `web/lib/build-id.ts` (server-only — do not import from client components):

- Export `readWebBuildId(cwd = process.cwd()): string`.
- Read UTF-8, `trim()`. Try in order: `join(cwd, ".next", "BUILD_ID")`, then `join(cwd, "web", ".next", "BUILD_ID")`. Missing/unreadable → `""`.
- First path covers `next start` from `web/`; second covers the compose image (`WORKDIR /app`, `node web/server.js`).

Create `web/app/build-id/route.ts`:

- `export const dynamic = "force-dynamic"`.
- `GET` returns `readWebBuildId()` as `text/plain; charset=utf-8` with `Cache-Control: no-cache, no-store, must-revalidate`. Status **200** even when the body is empty (missing file is not an outage).
- Do not require a session.

Modify `web/lib/auth/routes.ts`: add `"/build-id"` to `PUBLIC_ROUTES` (alongside `/login` and `/health`).

Modify `web/src/__tests__/routes.test.ts` so `/build-id` (and `/build-id/`) is public; `/build-id/details` is not.

### Monitor contract (exact)

Create `web/lib/pwa-update.ts` — a **plain module** (no React).

Export `PWA_UPDATE_CHECK_MS = 60 * 60 * 1000`.

Export `createPwaUpdateMonitor(options)`:

- `options.bootId: string`
- `options.fetchBuildId: () => Promise<string>`
- `options.onUpdateAvailable: () => void` — called when a successful check finds a **non-empty** fetched id that **differs** from trimmed `bootId`. May be called more than once; the UI is idempotent.
- `options.addVisibilityListener: (handler: () => void) => () => void` — subscribe; return unsubscribe. The **host** must only invoke `handler` when the document became visible (the monitor does not read `document` itself).
- `options.intervalMs` optional, default `PWA_UPDATE_CHECK_MS`.
- `options.setIntervalFn` / `options.clearIntervalFn` optional (tests inject).

Methods:

- `start()` — if trimmed `bootId` is `""`, no-op (no timer, no fetch). Else `checkNow()`, subscribe visibility (each handler call → `checkNow()`), start interval.
- `stop()` — clear interval, unsubscribe, no further `onUpdateAvailable`.
- `checkNow(): Promise<void>` — `await fetchBuildId()`, trim. Empty or throw → return (no `onUpdateAvailable`). Non-empty and `!==` trimmed `bootId` → `onUpdateAvailable()`.

Do not compare in development — that gate lives in the React host, which must not call `start()` when `process.env.NODE_ENV === "development"`.

### Bar + host contract (exact)

Create `web/components/pwa-update-bar.tsx` (`"use client"`):

- Props: `{ bootId: string }`.
- If `process.env.NODE_ENV === "development"` or trimmed `bootId` is `""`, render `null` and do not start a monitor.
- Else on mount, `createPwaUpdateMonitor` with `fetchBuildId` that:
  1. `const response = await fetch("/build-id", { cache: "no-store" })`
  2. If `!response.ok`, **throw** (do **not** call `text()` as success — a 401/302 login HTML body must not count as a new stamp)
  3. Else `return response.text()`
  Network throw or this throw → monitor stays silent. `addVisibilityListener` binds `document.visibilitychange` and calls the handler only when `document.visibilityState === "visible"`. `stop()` on unmount.
- State `updateAvailable` starts `false`. `onUpdateAvailable` sets it `true`.
- When `updateAvailable` is false, render `null`.
- When true, render an in-flow bar (no `fixed` / `sticky`):
  - `data-testid="pwa-update-bar"`
  - `aria-label="App update"`
  - classes include `border-b` (and existing tokens, e.g. `border-border bg-card`)
  - text node exactly `A new version is ready.`
  - `Button` `type="button"` `size="sm"` label **Reload**, `id="pwa-update-reload"`
  - Reload click: `window.location.reload()`
- No X, no toast, no “later”.

Mount from **root** `web/app/layout.tsx` (server): `bootId={readWebBuildId()}` on `<PwaUpdateBar />`, **inside** `ThemeProvider`, **before** `{children}` (top of the page). Login included. Sibling of Feature 01/02 wrappers is fine.

### Service worker + register contract (exact)

Modify `web/public/sw.js` (Feature 01 file):

- Keep the passthrough `fetch` handler. Still **no** Cache Storage, push, or background sync.
- Add `install` listener that calls `self.skipWaiting()`.
- Add `activate` listener that `event.waitUntil(self.clients.claim())`.

Modify `web/components/pwa-register.tsx`:

- Keep Feature 01 register (`/sw.js`, `scope: "/"`, `updateViaCache: "none"`, silent catch, render `null`).
- After a successful `register`, keep the `ServiceWorkerRegistration`. Call `registration.update()` (swallow errors) once after register, on `document.visibilitychange` when visible, and on an interval of `PWA_UPDATE_CHECK_MS` (import from `web/lib/pwa-update.ts`). Clear the interval and visibility listener on unmount.
- Do **not** listen for `controllerchange` to reload.

### Docker contract (exact)

Modify `web/Dockerfile` **runner** stage, **before** `chown` / `USER node`:

```
COPY --from=builder /app/web/public ./web/public
```

Do not change the web build command or inject `NEXT_PUBLIC_*` at build time.

## Dependencies

- Builds on: Feature 01 (`web/public/sw.js`, `web/components/pwa-register.tsx`, `/sw.js` no-cache headers, root-layout register). Execute Feature 01 before this feature.
- Consumes: Feature 03 `body` safe-area padding (in-flow bar sits in it). Feature 04 listen is not imported; Reload is a full page load.
- Patterns: root-layout client wrappers; source-read `layout.tsx` (do not `import` it — Stage 12 pin); `PUBLIC_ROUTES` in `web/lib/auth/routes.ts`; `web/app/health/route.ts` for a public `force-dynamic` GET.

## Constraints

- Do not auto-reload. Do not reload on `controllerchange`.
- Do not add a dismiss control, toast, Settings row, or nav item for updates.
- Do not add offline cache, Workbox, Serwist, `next-pwa`, push, or background sync.
- Do not change manifest, icons, Install UI (Feature 02), standalone chrome (Feature 03), or listen (Feature 04).
- Do not put `/build-id` behind auth. Do not 401/302 it.
- Do not use `router.refresh()` as Reload.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] When this window’s boot stamp differs from `GET /build-id`, every page including `/login` shows the top bar with the exact copy and **Reload**; no X.
- [ ] **Reload** calls `window.location.reload()` (same URL). The home-screen icon is not removed.
- [ ] Matching stamps, empty boot stamp, `next dev`, or a failed check → no bar (failed check does not toast).
- [ ] Checks run on mount, when the document becomes visible, and every 60 minutes.
- [ ] `GET /build-id` is public, `force-dynamic`, no-store, `text/plain`.
- [ ] `sw.js` still passthrough-fetches with no Cache Storage, and now `skipWaiting` + `clients.claim`. `PwaRegister` calls `registration.update()` on the same schedule.
- [ ] The web image copies `web/public` into the standalone runner.

## Files

- Create: `web/lib/build-id.ts`
- Create: `web/app/build-id/route.ts`
- Create: `web/lib/pwa-update.ts`
- Create: `web/components/pwa-update-bar.tsx`
- Create: `web/src/__tests__/pwa-installed-app-updates.test.ts` (and `.tsx` if the bar cases live in a sibling file — one or two files is fine)
- Modify: `web/lib/auth/routes.ts` — `PUBLIC_ROUTES` includes `/build-id`
- Modify: `web/src/__tests__/routes.test.ts` — `/build-id` public
- Modify: `web/app/layout.tsx` — pass `readWebBuildId()` into `PwaUpdateBar` before `{children}`
- Modify: `web/public/sw.js` — `skipWaiting` + `clients.claim`; keep passthrough fetch
- Modify: `web/components/pwa-register.tsx` — `registration.update()` on the check schedule
- Modify: `web/Dockerfile` — `COPY` `web/public` in the runner stage before `chown`
- Do not modify: `web/app/manifest.ts`, Settings pages, issue listen files
- Regression: `web/src/__tests__/pwa-chromium-installability.test.ts`, `pwa-install-shell.test.ts`, `routes.test.ts`

## Testing approach

Test-first for stamp, monitor, bar, SW takeover, public route, and Dockerfile copy. Real Edge/Brave “deploy then Reload” is operator smoke / stage finalize.

Do **not** `import` `web/app/layout.tsx` in vitest (Stage 12 pin). Source-read it.

### Test cases

**`web/src/__tests__/pwa-installed-app-updates.test.ts` (monitor + stamp + SW + Docker + layout source-read):**

1. **`readWebBuildId`** — temp dir with `.next/BUILD_ID` `abc` → `"abc"`. Nested `web/.next/BUILD_ID` `def` when the first path is missing → `"def"`. Neither file → `""`. Trims whitespace.
2. **Monitor no bootId** — `bootId: ""`; `start()`; `fetchBuildId` never called.
3. **Monitor mismatch** — boot `aaa`, fetch `bbb` → `onUpdateAvailable` called. Same `aaa`/`aaa` → not called. Fetch `""` or reject → not called.
4. **Monitor schedule** — fake interval + visibility subscribe; `start()` checks immediately; invoking the visibility handler checks again; interval callback checks again; `stop()` unsubscribes and clears interval (further ticks do not fetch).
5. **SW source** — `web/public/sw.js` contains `skipWaiting`, `clients.claim`, a `fetch` `respondWith`/`fetch(`, and must **not** match `caches.open` / `cache.put` / `cache.addAll`.
6. **Register source** — `pwa-register.tsx` still registers `/sw.js` with `scope: "/"` and `updateViaCache: "none"`, and contains `registration.update` (or `.update(`) plus `PWA_UPDATE_CHECK_MS`.
7. **Layout source-read** — `layout.tsx` imports `PwaUpdateBar` and `readWebBuildId`, renders `PwaUpdateBar` with `bootId=`, and that JSX appears before `{children}`.
8. **Dockerfile** — `web/Dockerfile` contains `COPY --from=builder /app/web/public ./web/public` (whitespace-flexible) in the runner stage (after `AS runner`, before `USER node`).
9. **Route `GET` behavior** — `import { GET, dynamic } from "../../app/build-id/route"` (or equivalent). Assert `dynamic === "force-dynamic"`. `vi.mock` `web/lib/build-id.ts` `readWebBuildId`:
   - mock returns `"stamp-1"` → `await GET()` status **200**, `Content-Type` is `text/plain; charset=utf-8`, `Cache-Control` includes `no-cache`, `no-store`, and `must-revalidate`, body text `"stamp-1"`
   - mock returns `""` → still status **200**, body `""` (empty is not an outage)

**Bar UI (`web/src/__tests__/pwa-update-bar.test.tsx` — or the same file if the runner allows JSX):**

10. **Hidden until mismatch** — mock `fetch` resolving boot-equal text; render with that `bootId`; no `pwa-update-bar`.
11. **Mismatch shows copy** — mock `fetch` resolving a different non-empty id; bar + exact `A new version is ready.` + **Reload**; no dismiss button / no `aria-label` close.
12. **Reload** — stub `window.location.reload`; click **Reload**; called once.
13. **No `fixed`/`sticky`** — bar container class string does not include `fixed` or `sticky`.
14. **Non-OK fetch is silent** — mock `fetch` resolving `{ ok: false, status: 401, text: async () => "<html>login</html>" }`; render with a non-empty `bootId`; no `pwa-update-bar` (`text()` must not be treated as a stamp).

**`web/src/__tests__/routes.test.ts`:** `/build-id` and `/build-id/` public; `/build-id/details` not.

**Not required in CI:** Android, a real compose deploy, audible listen interruption, pixel checks.

**Regression:** Feature 01 installability tests still pass (passthrough fetch, no Cache Storage, register path). `pwa-install-shell.test.ts` and `routes.test.ts` still pass.

## Tasks

### Task 1: Failing tests for update contract

- **Action**: Add the test cases above (stamp/monitor/SW/Docker/layout + bar + routes). Point at the final paths. Run vitest; confirm failures for missing modules/COPY/bar (not harness blow-ups).
- **Expected result**: Tests exist and fail for the right reasons.
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-installed-app-updates.test.ts web/src/__tests__/pwa-update-bar.test.tsx web/src/__tests__/routes.test.ts` fails on missing stamp/monitor/bar/`/build-id` public (or a single combined test file if the builder keeps bar cases there — then run that file + `routes.test.ts`).
- **Depends on**: none.

### Task 2: Build stamp, public route, and monitor

- **Action**: Create `web/lib/build-id.ts`, `web/app/build-id/route.ts`, `web/lib/pwa-update.ts` per those contracts. Add `"/build-id"` to `PUBLIC_ROUTES`. Make routes tests pass.
- **Expected result**: Cases 1–4 and 9 plus `routes.test.ts` pass. No UI yet.
- **Verify**: Those tests pass; `curl`-level not required. `pnpm typecheck` and `pnpm lint` pass if the tree typechecks without the bar.
- **Depends on**: Task 1.

### Task 3: Top bar, root layout, Reload

- **Action**: Create `web/components/pwa-update-bar.tsx` per the bar contract. Mount it from `web/app/layout.tsx` with `bootId={readWebBuildId()}` before `{children}` inside `ThemeProvider`.
- **Expected result**: Bar cases 10–14 and layout source-read (case 7) pass.
- **Verify**: Bar + layout tests pass; grep of the bar component has no `fixed`/`sticky` and no dismiss control; case 14 proves `!response.ok` does not show the bar.
- **Depends on**: Task 2.

### Task 4: SW takeover, register.update, copy public into the image

- **Action**: Modify `web/public/sw.js` and `web/components/pwa-register.tsx` per the SW/register contracts. Add the Dockerfile `COPY` of `web/public` before `chown`/`USER node`.
- **Expected result**: Cases 5, 6, 8 pass. Feature 01 tests still pass.
- **Verify**: `pnpm exec vitest run web/src/__tests__/pwa-chromium-installability.test.ts` passes; SW grep shows passthrough fetch and no `caches.open`; Dockerfile has the public COPY.
- **Depends on**: Task 3.

### Task 5: Feature verification gate

- **Action**: Run the full feature verification command set; fix gaps without expanding scope.
- **Expected result**: All Feature 05 tests green; Feature 01 + routes + PWA shell regression green; typecheck/lint green; handoff notes ready.
- **Verify**: Commands in **Feature verification** succeed.
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/pwa-installed-app-updates.test.ts web/src/__tests__/pwa-update-bar.test.tsx web/src/__tests__/routes.test.ts web/src/__tests__/pwa-chromium-installability.test.ts web/src/__tests__/pwa-install-shell.test.ts`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Listed tests pass (if bar cases were folded into `pwa-installed-app-updates.test.tsx`, run that file instead of a missing `pwa-update-bar.test.tsx`). Typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning). Mismatched stamps show the top Reload bar; Reload is `location.reload`; `/build-id` is public; SW skipWaiting/claim without cache; image copies `public/`.

## Handoff

Builder reports: files created/modified; confirmation no auto-reload / no `controllerchange` reload / no dismiss; confirmation `/build-id` is public no-store; confirmation bar is in-flow before `{children}` in **root** layout; confirmation `skipWaiting` + `clients.claim` with passthrough fetch; confirmation Dockerfile copies `web/public`; test + typecheck + lint results; any deviation and why.

## Research note

- **Why not SW-only:** Feature 01 `sw.js` is static passthrough; Chromium skips the update algorithm when the worker **bytes** are unchanged ([web.dev service-worker-lifecycle](https://web.dev/articles/service-worker-lifecycle)). Build-id poll is the deploy signal; `registration.update()` + `skipWaiting`/`clients.claim` still keep the worker from sitting in `waiting` ([MDN skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting), web.dev Learn PWA Update).
- **Reload:** `location.reload()` loads new HTML/JS; `router.refresh()` does not replace the client bundle. Do not reload on `controllerchange` (that is auto-reload).
- **Standalone image:** Next.js `output: "standalone"` does not include `public/`; official Docker sample copies it. Stage 11 Feature 05 packaging deferred that COPY until a real `public/` tree existed.
- **Codebase:** `PUBLIC_ROUTES` + `web/app/health/route.ts`; do not import `layout.tsx` in vitest. Feature 01 tests must keep passing (no Cache Storage).
- **PM grill (2026-08-12):** Reload button, not auto; top in-flow bar; no dismiss; all windows including login; copy `A new version is ready.` / **Reload**; check on open, return, and 60 min; same-URL reload; silent failures; no bar in `next dev`.
- **Spec review (2026-08-12):** Case 9 must invoke `GET` (headers/body/200-on-empty), not only assert the file exists. Bar `fetchBuildId` must throw on `!response.ok` so login HTML cannot fake a stamp.
