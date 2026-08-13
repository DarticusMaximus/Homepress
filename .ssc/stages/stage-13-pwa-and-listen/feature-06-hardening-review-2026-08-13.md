# Feature 06: Harden stage-13 against review findings (2026-08-13)

## Intent

Harden `stage-13-pwa-and-listen` against findings from `review-stage-13-pwa-and-listen-2026-08-13`: mid-play listen rate must not flash a fake TTS error, the listen bar must stay usable on a phone, speakable text must keep content underscores, and the cheap test/a11y locks from that review must actually fail when those contracts regress — without reopening features 01–05.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–05 stay `verified`. Distilled work — not a copy of the report.

**PM triage (2026-08-13):** Address now on C2, U3, N1, and the Confirmed Low notes (T1, T2, M1, C4, M3, C6, T7, T8, U5). Fold Nit T6 into the bar task. Leave validator-Rejected items out.

**Spec-review pins (2026-08-13):** Grizzled Senior pass — five verification locks applied below (C2 no same-turn speak; U3 two-row `min-h-28`; M3 hook source-read; C4 leftover `*` must survive; T7 redirect + `text/plain` required in CI).

### C2 (Medium) — ignore cancel-driven TTS errors on rate change (cluster A)

Today `setRate` while playing calls `bumpGenerationAndCancel()` then `startFrom(chunkIndex)` in the same turn. `utterance.onerror` ignores the event payload and treats any current-generation error as fatal. Chromium often fires `canceled` / `interrupted` on utterances queued immediately after `cancel()`, including the restarted chunk — so a rate tap can idle the player and show `Couldn’t start listening.` Same-turn restart utterances also share the new generation, so a leftover `onend` can idle (last chunk) or enqueue `index+2` (skip).

**Fix (required):**

1. In `web/lib/issue-listen-player.ts` `onerror`, read `SpeechSynthesisErrorEvent.error` (or `event.error` on a duck-typed payload). If it is `"canceled"` or `"interrupted"`, return without `onError()`, without idling.
2. Keep generation filtering for *old* utterances after `pause` / `stop` / `dispose` / a *real* error.
3. Playing `setRate` must **not** `speak()` in the same turn as that `cancel()`. Sequence: bump generation + `cancel()`; then **one** `startFrom(chunkIndex)` after cancel events can flush (`queueMicrotask` allowed **only** on this rate-restart path). That bump makes leftover `end`/`error` from the cancelled generation stale, so they cannot idle the player or skip a chunk. Feature 04’s “first `speak()` synchronous inside `play()`” still holds. Do **not** use `synth.pause` / `synth.resume`.
4. Real failures (`synthesis-failed` or any error other than canceled/interrupted) still: cancel leftovers, `status = "idle"`, `chunkIndex = 0`, `onError` then `onState`.
5. The existing Feature 04 case that expects an immediate post-`setRate` `speak()` must flush the microtask (e.g. `await Promise.resolve()`) instead of asserting `speak` before `setRate` returns. Do not “fix” that red by putting `speak()` back on the cancel turn.

### U3 (Medium) + T6 (Nit, folded) — phone-width listen bar (cluster B)

The inner row is `h-16` + `flex-wrap`. Play, Stop, and five nowrap `sm` rate buttons overflow ~360px; the error line is `w-full` and paints below the viewport. The spacer is also `h-16`, so overflow is not reserved.

**Fix (required):**

1. Drop the inner `h-16` **clamp** (fixed height that clips wrapped rows). The control stack grows upward with a **two-row floor**: `min-h-28` (or one shared class/token equivalent to two `h-16` rows). `min-h-16` alone is **not** enough.
2. Keep Play/Stop on the first row; put the five rate buttons on their own wrapping row (`w-full` or equivalent). Error copy stays **inside** the region, on its own row below the controls, still visible (not `overflow-hidden` clipped).
3. Spacer and region inner must use the **same** two-row floor token (`min-h-28` or shared class). A spacer of `min-h-16` still tucks the last markdown under a two-row bar. Always reserve the two control rows (error may sit inside that floor or add to it). Safe-area `padding-bottom: env(safe-area-inset-bottom, 0px)` stays on the fixed region. One padding source is enough (drop the duplicate class+style if both set the same property).
4. **T6:** in `issue-listen-bar.test.tsx`, drop the inner `if (existsSync(barPath))` around the no-toast grep; always read the bar source.
5. jsdom cannot prove pixels. Lock **structure/class** in tests, not bounding boxes. Operator smoke remains stage finalize.

### C4 (Low) — do not wipe leftover `* _ ~` (cluster C)

After paired-emphasis replaces, `toSpeakableText` runs `text.replace(/[*_~]/g, "")`, so `max_tokens` becomes `maxtokens` and `2 * 3` loses the asterisk.

**Fix (required):** Remove that global leftover wipe. Keep the paired `**` `*` `__` `_` `~~` strips. Existing heading/link/URL/image/pack tests must still pass. `toSpeakableText("2 * 3 is six.")` **must still contain `*`** — asserting only that `2` and `3` remain is already green under today’s wipe (`2 3 is six.`).

### M3 (Low) — one source for rates + error copy (cluster A/B shared)

`use-issue-listen.ts` duplicates `ALLOWED_RATES` and `ERROR_COPY` instead of `ISSUE_LISTEN_RATES` / `ISSUE_LISTEN_ERROR_COPY`.

**Fix (required):** Create `web/lib/issue-listen-constants.ts` exporting `ISSUE_LISTEN_RATES` and `ISSUE_LISTEN_ERROR_COPY` (curly apostrophe U+2019). Hook and bar import from there. Bar may re-export the same names so existing test imports keep working. Hook `onError` must set that same `ISSUE_LISTEN_ERROR_COPY` constant.

**Test lock:** `issue-listen-bar.test.tsx` (or a sibling source-read in that file) must `readFileSync` `web/hooks/use-issue-listen.ts` and assert it imports `ISSUE_LISTEN_RATES` and `ISSUE_LISTEN_ERROR_COPY` from `@/lib/issue-listen-constants` (or the relative equivalent of `web/lib/issue-listen-constants.ts`), and that the hook file does **not** declare its own rate array or error-copy string. A bar-only import-equality assert is not enough.

### N1 (Low, anti-cheat) + T1 + T2 + M1 — install tests and dead `isPrompting` (cluster D)

**N1:** The Cache Storage negative test in `pwa-chromium-installability.test.ts` `return`s when `sw.js` is missing. Fail instead (same `existsSync` assert as the fetch-handler case).

**T1:** Standalone BIP case must `waitFor` (or equivalent flush) until a stored BIP *would* have rendered Home screen, then assert it is still absent.

**T2:** Add a sibling case: `fullscreen: true`, `standalone: false`; dispatch BIP; after flush, section still absent.

**M1:** Remove dead `isPrompting` state from `home-screen-settings.tsx`. Do **not** re-implement in-flight disable (validator rejected N2: native sheet covers the button). Hide-on-clear of the deferred event stays.

### C6 + T7 + U5 + T8 — update stamp fetch, a11y, missing locks (cluster E)

**C6:** `fetch("/build-id", { cache: "no-store" })` follows redirects, so a 302→login HTML 200 can become a stamp. Pass `redirect: "error"` (or `"manual"` and treat opaqueredirect as failure). After `ok`, throw unless `Content-Type` starts with `text/plain` (case-insensitive, ignore parameters). Do not call `text()` as success on HTML. A missing `Content-Type` is a throw, not a stamp.

**T7:** Bar tests **must** assert `fetch` was called with `"/build-id"`, `cache: "no-store"`, **and** `redirect: "error"` (or `"manual"` if that is the implementation). Redirect mode is required in CI, not optional. Add a silent case: `ok: true`, `content-type: text/html`, body login HTML → no `pwa-update-bar`. Keep the 401 `!ok` case. Existing **ok** mismatch/match mocks **must** send `Content-Type: text/plain` (otherwise they throw after C6 and Feature 05 cases go red for the wrong reason, or a builder skips the header check).

**U5:** On the update bar root, keep `aria-label="App update"` and add `role="status"` (or `role="region"`). Still no dismiss. Still in-flow (no `fixed`/`sticky`).

**T8:**

1. `pwa-register.tsx` source must **not** match `controllerchange`.
2. Dockerfile: `COPY --from=builder /app/web/public ./web/public` index must be before **both** `chown` and `USER node`.
3. Render `PwaUpdateBar` with `NODE_ENV === "development"` and a non-empty `bootId`: no bar, `fetch` not called.

## Dependencies

- Builds on: **features 01–05 of this stage** (already `verified`).
- Anchor: `.ssc/reviews/review-stage-13-pwa-and-listen-2026-08-13.md`.
- Listen: `web/lib/issue-listen-player.ts`, `web/lib/issue-listen-text.ts`, `web/hooks/use-issue-listen.ts`, `web/components/issues/issue-listen-bar.tsx`.
- PWA: `web/src/__tests__/pwa-chromium-installability.test.ts`, `pwa-in-app-install.test.tsx`, `home-screen-settings.tsx`, `pwa-update-bar.tsx`, `pwa-register.tsx`, `web/Dockerfile`.

## Constraints

- **Do not reopen** features 01–05 status; this is additive hardening.
- **Keep** Feature 04: voice unset; no `synth.pause` / `synth.resume`; first `play()` `speak()` still synchronous; cancel-based pause; system preferred engine; no Media Session.
- **Keep** Feature 02: Home screen absent unless deferred BIP and not standalone/fullscreen; native `prompt()`; no banner.
- **Keep** Feature 05: no auto-reload; no `controllerchange` → `location.reload()`; `/build-id` public; passthrough SW; no Cache Storage; no dismiss on the update bar.
- **Do not** put `/build-id` behind auth.
- **Do not** add Workbox / Serwist / `next-pwa` / offline cache.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [x] Changing rate while speaking restarts the current chunk at the new rate without `ISSUE_LISTEN_ERROR_COPY`. `canceled`/`interrupted` never call `onError`. Same-turn leftover `onend` after that cancel does not idle or skip. Real synthesis failures still idle + `onError`. No `synth.pause` / `synth.resume` (C2).
- [x] Spacer and region inner share a two-row floor (`min-h-28` or equivalent, not `min-h-16`); no inner `h-16` clamp; Play/Stop and rates on separate rows; error inside the region (U3).
- [x] `toSpeakableText("use max_tokens here")` contains `max_tokens`; `toSpeakableText("2 * 3 is six.")` contains `*`; paired emphasis still strips (C4).
- [x] Hook source imports `ISSUE_LISTEN_RATES` and `ISSUE_LISTEN_ERROR_COPY` from `web/lib/issue-listen-constants.ts` and does not declare its own copies (M3).
- [x] Cache Storage negative test fails if `sw.js` is missing (N1).
- [x] Standalone and fullscreen BIP cases wait for a flush then still hide Home screen (T1, T2). Dead `isPrompting` is gone (M1).
- [x] HTML / redirected `/build-id` bodies never show the update bar; fetch is asserted with `cache: "no-store"` **and** `redirect: "error"` (or `"manual"`); ok stamps are `text/plain`; bar has `role="status"` or `region` and `aria-label="App update"` (C6, T7, U5).
- [x] CI fails if `controllerchange` reload is added, if public COPY moves after `chown`, or if the bar polls in development (T8).
- [x] `pnpm typecheck` and `pnpm lint` pass; touched web suites green.

## Files

- Create: `web/lib/issue-listen-constants.ts` — shared rates + error copy (M3)
- Modify: `web/lib/issue-listen-player.ts` — canceled/interrupted ignore + deferred rate restart (C2)
- Modify: `web/src/__tests__/issue-listen-player.test.ts` — C2 cases + microtask flush on existing setRate-while-playing test
- Modify: `web/hooks/use-issue-listen.ts` — import shared constants (M3)
- Modify: `web/components/issues/issue-listen-bar.tsx` — layout (U3) + import/re-export constants (M3)
- Modify: `web/src/__tests__/issue-listen-bar.test.tsx` — structure/class + hook source-read (M3) + T6 no-toast grep
- Modify: `web/lib/issue-listen-text.ts` — remove leftover `[*_~]` wipe (C4)
- Modify: `web/src/__tests__/issue-listen-text.test.ts` — `max_tokens` + leftover `*` cases (C4)
- Modify: `web/src/__tests__/pwa-chromium-installability.test.ts` — N1 fail if missing SW
- Modify: `web/src/__tests__/pwa-in-app-install.test.tsx` — T1 waitFor + T2 fullscreen
- Modify: `web/components/settings/home-screen-settings.tsx` — remove `isPrompting` (M1)
- Modify: `web/components/pwa-update-bar.tsx` — redirect/content-type (C6) + `role` (U5)
- Modify: `web/src/__tests__/pwa-update-bar.test.tsx` — T7 fetch asserts including redirect + `text/plain` ok mocks + HTML silent + U5 role + T8 dev gate
- Modify: `web/src/__tests__/pwa-installed-app-updates.test.ts` — T8 controllerchange grep + COPY before chown
- Modify: `web/components/pwa-register.tsx` — only if a test proves `controllerchange` drifted; then **remove** it, do not add reload

## Testing approach

Test-first where practical: add failing cases per cluster, then implement. jsdom does not do visual overflow — U3 is class/structure.

1. **C2** — Fake synth: `cancel()` asynchronously fires `onerror { error: "interrupted" }` **and** `onend` on every utterance currently queued **and** those spoken in the same turn as cancel. `setRate(2)` while playing chunk 1: flush the microtask; must not call `onError`; must speak from chunk 1 at rate 2; must **not** be idle; must **not** have skipped to chunk 3. `error: "synthesis-failed"` still `onError` + idle + `chunkIndex` 0. Pause/stop still must not `onError` from cancel. Existing Feature 04 “rate while playing restarts chunk” case flushes the microtask before asserting `speak`. Grep player: no `synth.pause` / `synth.resume`.
2. **U3/T6** — Inner control wrapper has no `h-16` clamp. Spacer **and** region inner both include `min-h-28` (or the same shared two-row token — not `min-h-16`). Rates are in a distinct full-width group; error node is inside the region. Unconditional no-toast grep.
3. **C4** — `toSpeakableText("use max_tokens here")` includes `max_tokens`. `toSpeakableText("2 * 3 is six.")` **contains `*`**. `# Hello **world**` still strips `#` and `*`.
4. **M3** — Source-read `use-issue-listen.ts`: imports `ISSUE_LISTEN_RATES` and `ISSUE_LISTEN_ERROR_COPY` from the constants module; no local rate array / error-copy string. Bar may re-export those names.
5. **N1** — Missing `sw.js` fails the Cache Storage case (`expect(existsSync).toBe(true)` before read, same as the fetch-handler test). File-with-`caches.open` still fails; passthrough still passes.
6. **T1/T2** — After BIP in standalone and in fullscreen, `waitFor` a tick then `queryByTestId("home-screen-settings")` null.
7. **C6/T7/U5/T8** — `toHaveBeenCalledWith("/build-id", expect.objectContaining({ cache: "no-store", redirect: "error" }))` (or `"manual"`). Ok mocks include `Content-Type: text/plain`. HTML 200 silent. `role` + `aria-label`. `NODE_ENV=development` no fetch. Register source `not.toMatch(/controllerchange/)`. Dockerfile `copyIdx < chownIdx` and `copyIdx < userIdx`.

Anti-cheat: do not `.skip` these gates; do not “fix” C2 by dropping mid-play rate restart or by speaking in the cancel turn; do not “fix” N1 by deleting the Cache Storage test; do not “fix” C4 by asserting only `2` and `3` remain.

## Tasks

### Task 1: C2 rate-change cancel errors (red → green)

- **Action**: Add failing player tests: interrupted **and** `onend` after `setRate` (no `onError`, still chunk 1 at rate 2, not idle, not skipped to chunk 3); `synthesis-failed` still fatal. Update the existing Feature 04 rate-while-playing test to flush a microtask before asserting `speak`. Implement: ignore canceled/interrupted; playing `setRate` bumps generation, `cancel()`s, and `startFrom`s **once** on a microtask — never `speak()` in the cancel turn. Keep first `play()` speak synchronous.
- **Expected result**: C2 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/issue-listen-player.test.ts`
- **Depends on**: none.

### Task 2: U3 + M3 + T6 listen bar layout and shared constants (red → green)

- **Action**: Add failing bar structure/class tests (`min-h-28` on spacer **and** inner; no inner `h-16` clamp; rates on their own row) and a hook source-read for constants imports. Create `web/lib/issue-listen-constants.ts`; wire hook + bar; grow the bar. Drop dead `existsSync` around the toast grep.
- **Expected result**: U3, M3, T6 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/issue-listen-bar.test.tsx`
- **Depends on**: none (can parallel in spirit with Task 1; sequential execute).

### Task 3: C4 leftover marker wipe (red → green)

- **Action**: Add failing cases: `max_tokens` preserved; `toSpeakableText("2 * 3 is six.")` contains `*`. Remove `replace(/[*_~]/g, "")` from `web/lib/issue-listen-text.ts`. Keep paired-emphasis strips.
- **Expected result**: C4 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/issue-listen-text.test.ts`
- **Depends on**: none.

### Task 4: N1 + T1 + T2 + M1 install tests and dead state (red → green)

- **Action**: Make the Cache Storage case fail when `sw.js` is missing. Add `waitFor` to standalone BIP absence; add fullscreen sibling. Remove `isPrompting` from `home-screen-settings.tsx` (hide-on-clear stays).
- **Expected result**: N1, T1, T2, M1 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/pwa-chromium-installability.test.ts src/__tests__/pwa-in-app-install.test.tsx`
- **Depends on**: none.

### Task 5: C6 + T7 + U5 + T8 update fetch and locks (red → green)

- **Action**: Add failing bar tests (HTML 200 silent; fetch URL + `no-store` + **required** `redirect`; ok mocks `text/plain`; `role`; development no-fetch). Harden `fetchBuildId` in `pwa-update-bar.tsx`; add `role="status"` (or `region`). Lock register `controllerchange` absence and Dockerfile COPY before `chown` and `USER node`.
- **Expected result**: C6, T7, U5, T8 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/pwa-update-bar.test.tsx src/__tests__/pwa-installed-app-updates.test.ts`
- **Depends on**: none.

### Task 6: Feature gate

- **Action**: Re-read this spec vs implementation; run typecheck/lint and the touched suites; fix gaps only as needed for this feature. Do not change features 01–05 status. Optionally tick Detailed Findings checkboxes in the review report when AC are met.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**:
  ```bash
  pnpm typecheck && pnpm lint && \
  pnpm --filter web exec vitest run \
    src/__tests__/issue-listen-player.test.ts \
    src/__tests__/issue-listen-bar.test.tsx \
    src/__tests__/issue-listen-text.test.ts \
    src/__tests__/pwa-chromium-installability.test.ts \
    src/__tests__/pwa-in-app-install.test.tsx \
    src/__tests__/pwa-update-bar.test.tsx \
    src/__tests__/pwa-installed-app-updates.test.ts \
    src/__tests__/pwa-install-shell.test.ts \
    src/__tests__/routes.test.ts
  ```
- **Depends on**: Tasks 1–5.

## Feature verification

- Run: the Task 6 verify matrix.
- Expected: All green. Rate-while-playing does not fake a TTS error or skip on leftover `onend`; phone bar spacer matches two-row floor; leftover `*`/`_` wipe gone; hook imports shared constants; install/update tests lock the review holes including required `redirect` + `text/plain`. Features 01–05 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; how canceled/interrupted are detected; confirmation rate-restart used a microtask (no same-turn `speak`); bar two-row token chosen; confirmation leftover wipe is gone and `*` survives; confirmation `/build-id` fetch uses redirect error/manual + text/plain; any deviation and why. Reference report: `.ssc/reviews/review-stage-13-pwa-and-listen-2026-08-13.md`.

## Research notes

- Review + validator (2026-08-13): C2 High→Medium Confirmed; U3 Medium Confirmed; N1 Low anti-cheat Confirmed; listed Lows Confirmed; BIP-before-effect, public BUILD_ID, skipWaiting, in-flight Install disable, `play()`-while-playing, `play([])` paused, extra listen tests, in-flight monitor `stop()`, `nosniff` **Rejected** — out of this spec.
- Spec review (2026-08-13): five pins — no same-turn speak after cancel (leftover `onend`); `min-h-28` not `min-h-16` on spacer+inner; hook source-read for M3; leftover `*` required in C4; T7 redirect + `text/plain` required.
- Feature 04: Chrome Android `pause()`/`resume()` broken; cancel-based pause stays. First `speak()` in `play()` must remain synchronous (autoplay). Rate restart is a different path and **must** yield.
- Feature 05: `/build-id` stays public; do not 401 it. `redirect: "error"` + `text/plain` is the residual guard if `PUBLIC_ROUTES` regresses.
- U3 CI: class/structure only — no jsdom pixel audit.
