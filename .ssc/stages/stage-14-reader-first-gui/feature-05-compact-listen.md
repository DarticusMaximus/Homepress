# Feature 05: Compact listen

## Intent

Let the operator listen from a small control that grows only after Play — Play/Pause, Stop, and the current rate — so the digest page is a reading surface, not a seven-button mixer.

## Spec

Chrome-only. Same Issues-reader listen as Stage 13: `window.speechSynthesis`, voice unset, cancel-based pause, speakable prose, 200-word chunks, `localStorage` rate, success-path only. Do **not** rebuild the player, hook, or markdown-to-text. Idle is one Play button. After Play (playing or paused), three controls: Play/Pause, Stop, current rate. Tap the current rate to reveal the other four rates. Stop, finishing the last chunk, or a TTS error returns to the idle Play button.

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| Idle | Play only. No Stop, no rate buttons. |
| After Play | `status === "playing" \|\| status === "paused"`: Play/Pause, Stop (enabled), current rate. |
| Pause | Still the three-control chrome (label **Play**). Not idle. |
| Collapse to idle | `stop()`, last-chunk `end`, or TTS error (`status === "idle"`). |
| Rate before Play | Hidden. Stored rate still applies on first Play (hook already reads `homepress.issue-listen.rate`). |
| Rate expand | Tap current rate → panel of the **other four** rates above the transport row. Current stays in the row. |
| Pick a rate | `setRate` + close panel. Tap current while open → close, no `setRate`. Idle forces the panel closed. |
| Panel | Absolutely positioned above the row (`absolute inset-x-0 bottom-full`) inside the region (`relative`). `bg-background border-t`. Not Popover / Select / DropdownMenu / new shadcn. Existing `Button` `size="sm"`. |
| Height | Spacer + inner `min-h-14` (one row). **Not** Stage 13 `min-h-28`. **Not** the pre-hardening `h-16` clamp. No `overflow-hidden` on the region (would clip the upward panel). |
| Inner width | Keep Feature 04: `max-w-3xl` (or `ISSUE_READER_COLUMN_CLASS`). No `max-w-prose`. |
| Labels | Unchanged: Play / Pause / Stop / `0.75×`…`2×` / region `Listen to issue` / error `Couldn’t start listening.` |
| Surface | Success-path issue reader only, both `/issues/[runId]` and `/admin/issues/[runId]`. |

### Chrome contract (`IssueListenBar`)

Local React state `ratesOpen` (default `false`). Not in the hook/player.

- `active = status === "playing" || status === "paused"`.
- If `!supported`, still `null`.
- Region: `role="region"` `aria-label={ISSUE_LISTEN_REGION_LABEL}` plus `relative` (for the panel). Keep `fixed inset-x-0 bottom-0 z-40 border-t bg-background` and `pb-[env(safe-area-inset-bottom,0px)]`.
- **Idle (`!active`):** one Play `Button`. Click → `play()`. Stop and every rate button are **not in the document**. If `error`, show it in the region (existing `<p>`).
- **Active:** Play/Pause (same toggle as Stage 13), Stop (enabled, click → `stop()`), current-rate `Button` with `aria-label` / visible text `{rate}×`, `aria-pressed="true"`, `aria-expanded={ratesOpen}`, `aria-controls="issue-listen-rates"`.
- **Panel (`ratesOpen && active`):** `id="issue-listen-rates"` `role="group"` `aria-label="Playback speed"`. Map `ISSUE_LISTEN_RATES.filter((r) => r !== rate)`. Each is a `Button` `aria-label="{n}×"`; click → `setRate(n)` and `ratesOpen = false`. Position: `absolute inset-x-0 bottom-full` with `border-t bg-background` and the same horizontal padding as the inner wrap. Do not include the current rate in the panel (it stays on the transport row).
- Current-rate click: `setRatesOpen((open) => !open)`. Do not call `setRate` for the already-current value.
- `useEffect`: when `status === "idle"`, set `ratesOpen` to `false`.
- Inner wrap: `mx-auto flex min-h-14 w-full max-w-3xl flex-row flex-wrap items-center gap-2 px-4 py-2` (one transport row). Drop `min-h-28` and the Stage 13 second rates row. Import `ISSUE_READER_COLUMN_CLASS` or keep a `max-w-3xl` class — Feature 04 already removed `max-w-prose`.
- Spacer: `aria-hidden`, `min-h-14 shrink-0`, safe-area padding as today. Same token as inner (`min-h-14`), not `min-h-28` / `h-16`.
- Error copy stays inside the region. No toast.

Do not change `use-issue-listen.ts`, `issue-listen-player.ts`, `issue-listen-text.ts`, or `issue-listen-constants.ts` except if a typecheck-only import path needs it (it should not).

## Dependencies

- Builds on: Stage 13 Feature 04 (listen contract) + Feature 06 (C2 cancel-as-error fix; U3 two-row bar this feature replaces). Stage 14 Feature 04 (inner `max-w-3xl`; listen on both reader and factory issue URLs).
- Unlocks: none in this stage (last Stage 14 feature).

**Execute Features 01–04 before this feature.**

## Constraints

- Do not change TTS engine, `utterance.voice`, chunking, pause=`cancel`, rate persistence, or spoken-text rules.
- Do not call `speechSynthesis.pause` / `resume`.
- Do not add listen to Home, channels, lists, Settings, Inspect, or error/empty reader states.
- Do not add skip-by-heading, voice picker, highlighting, Media Session, or cloud audio.
- Do not install Popover / DropdownMenu / Select for rates; do not add TTS npm deps.
- Do not reintroduce inner `h-16` + `overflow-hidden` (Stage 13 U3). Do not keep `min-h-28` as the idle floor.
- Do not revert Feature 04 `max-w-3xl` on the listen inner wrap.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] On a loaded issue, Listen is a small Play control until Play; Stop and the five rates are not visible while idle.
- [ ] While playing or paused, the visible controls are Play/Pause, Stop, and the current rate only.
- [ ] Tapping the current rate reveals the other rates; choosing one applies it (existing `setRate` / `localStorage`) and hides the others; tapping the current rate again hides them.
- [ ] Stop, finishing the issue, and TTS error return to the idle Play control (error copy still on the bar when set).
- [ ] Same Issues-reader-only, system-TTS contract as Stage 13 (voice unset; bar absent without `speechSynthesis` and on load-error / not-available).

## Files

- Modify: `web/components/issues/issue-listen-bar.tsx` — compact chrome
- Modify: `web/src/__tests__/issue-listen-bar.test.tsx` — idle / active / expander cases; drop two-row `min-h-28` assertions; **delete** the Stage 13 idle `1.5×` persistence test (rate persistence moves to cases 7–8)
- Test: `web/src/__tests__/issue-listen-player.test.ts`, `issue-listen-text.test.ts`, `issue-reader.test.tsx`, `issue-reader-chrome.test.tsx` (regression — do not rewrite player/text)
- Do not modify: player, hook, text, constants, IssueReader mount rules

## Testing approach

Test-first. Same jsdom SpeechSynthesis stub as Stage 13 (`installSpeechApi` in `issue-listen-bar.test.tsx`). Do not screenshot. Do not require Android. Do not change player/text tests except if a query for idle Stop/rates now fails — those live in the bar file.

### Test cases (`issue-listen-bar.test.tsx`)

Keep: hidden without API; load-error / not-available hide bar; Play↔Pause toggle; error copy + idle + clear on Play; fixed + safe-area; hook constants import; IssueReader success-only source-read; no toast import.

**Delete in Task 1** (do not keep, do not rewrite as an idle test): `"rate button sets aria-pressed and persists to localStorage"`. Idle chrome has no `1.5×`; persistence is cases 7–8 after Play. Leaving this test makes Task 2’s bar-suite gate fail.

Replace / add:

1. **Idle is Play only** — stub API; render bar (or success `IssueReader`). Region present. **Play** present. **Stop**, `0.75×`, `1×`, `1.25×`, `1.5×`, `2×` **not** in the document.
2. **After Play: three controls** — click Play. **Pause**, **Stop** (enabled), **1×** (`aria-pressed="true"`). `0.75×` / `1.25×` / `1.5×` / `2×` still absent.
3. **Paused stays three controls** — Play → Pause → Play label. Stop and `1×` still present. Other rates still absent.
4. **Stop returns to idle chrome** — Play, then Stop. Play only; Stop and `1×` gone.
5. **Last chunk end returns to idle chrome** — markdown that packs to **one chunk** (single short sentence, e.g. `A short sentence for playback.` — no second sentence, so Play does not lookahead-enqueue). Click Play; fire `onstart` then `onend` on `queue[0]` (the only utterance). Play only (no Pause, no Stop, no rates). Do not fire `onend` on `queue[0]` of a multi-chunk draft — that is not last-chunk end.
6. **Error returns to idle chrome** — existing error case plus: after `onerror`, Stop and rate buttons are absent; Play + error copy remain.
7. **Expand / collapse rates** — Play, then click `1×`: `aria-expanded="true"`; group `#issue-listen-rates` (or `getByRole("group", { name: "Playback speed" })`) contains `0.75×` `1.25×` `1.5×` `2×` and **not** a second `1×`. Click `1×` again: `aria-expanded="false"`; other rates gone; `localStorage` still default `1` (or unset).
8. **Pick rate applies and closes** — Play, expand, click `1.5×`: `localStorage` `homepress.issue-listen.rate` is `1.5`; transport shows `1.5×` `aria-pressed="true"`; group gone / `aria-expanded="false"`; `0.75×` absent.
9. **Layout** — spacer and inner match `/min-h-14/`; do **not** match `/min-h-28/` or a class token `h-16`. Region class includes `relative` and `fixed` `bottom-0`; no `overflow-hidden`. Inner wrap matches `/max-w-3xl/` and does **not** match `/max-w-prose/`.
10. **Panel placement (source-read)** — `issue-listen-bar.tsx` contains `absolute` and `bottom-full` (upward panel). Does not import `@/components/ui/popover`, `dropdown-menu`, or `select`.
11. **Idle closes expander for the next Play** — Play, click `1×` so the panel is open, then Stop (idle). Play again: **Pause**, **Stop**, **1×** with `aria-expanded="false"`; `0.75×` / `1.25×` / `1.5×` / `2×` absent. A builder who skips the idle `useEffect` and only hides the panel via `ratesOpen && active` will fail this on the second Play.

Existing “success IssueReader shows Play, Stop, and rates”, “Stop disabled when idle”, and “two-row min-h-28” tests **must be rewritten** to cases 1–2 and 9 — do not leave assertions that idle shows Stop + five rates.

**Regression:** `issue-listen-player.test.ts`, `issue-listen-text.test.ts`, `issue-reader.test.tsx`, Feature 04 `issue-reader-chrome.test.tsx` case 7 (region + Play on reader success). Player tests must still grep-free of `synth.pause` / `synth.resume` in `issue-listen-player.ts`.

## Tasks

### Task 1: Failing compact-chrome tests

- **Action**: Rewrite `web/src/__tests__/issue-listen-bar.test.tsx` for cases 1–6 and 9 (idle Play-only, active three controls, pause, Stop/end/error collapse, `min-h-14` / no `min-h-28` / no `h-16` / `max-w-3xl`). **Delete** the Stage 13 test `"rate button sets aria-pressed and persists to localStorage"` in this task (do not keep it; cases 7–8 replace it). Keep the surviving Stage 13 cases listed above. Do not implement chrome yet. Skip cases 7–8, 10, and 11 until Task 3. Case 5 markdown must be one chunk.
- **Expected result**: Tests fail because idle still shows Stop + five rates and `min-h-28`. Failures are assertion mismatches, not harness crashes.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-bar.test.tsx` fails on the new idle/layout cases.
- **Depends on**: none.

### Task 2: Idle vs active chrome

- **Action**: Update `web/components/issues/issue-listen-bar.tsx`: idle Play-only; active Play/Pause + Stop + current rate; spacer/inner `min-h-14`; keep Feature 04 `max-w-3xl`; drop the always-on five-rate row. Do not add the expander yet (current rate may be visible-but-inert for Task 1, or a no-op click). Do not touch player/hook/text.
- **Expected result**: Cases 1–6 and 9 pass. Cases 7–8, 10, and 11 are not in the file yet.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-bar.test.tsx web/src/__tests__/issue-reader.test.tsx` passes. `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: Rate expander

- **Action**: Add cases 7, 8, 10, and 11. Implement `ratesOpen`, `aria-expanded` / `aria-controls`, upward `absolute bottom-full` panel of the other four rates, close on idle / select / current-rate toggle. Close the panel in a `useEffect` when `status === "idle"` (case 11 fails if the panel only unmounts via `ratesOpen && active` and `ratesOpen` stays true).
- **Expected result**: Cases 1–11 pass. Mid-play `setRate` still goes through the existing hook (C2 must not regress — no player edits).
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-bar.test.tsx web/src/__tests__/issue-listen-player.test.ts` passes.
- **Depends on**: Task 2.

### Task 4: Gates

- **Action**: Full suite + typecheck + lint. Confirm no leftover idle Stop/five-rates assertions, no `min-h-28` on the bar, no `max-w-prose` on the listen inner wrap, no player/hook/text edits.
- **Expected result**: Gates green. TTS contract unchanged.
- **Verify**: `pnpm test`, `pnpm typecheck`, `pnpm lint` (ignore benign `pages/` eslint-config-next warning). `git diff -- web/lib/issue-listen-player.ts web/lib/issue-listen-text.ts web/hooks/use-issue-listen.ts web/lib/issue-listen-constants.ts` is empty (or whitespace-only).
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm test`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: Full vitest suite green. Idle listen is Play only; playing/paused shows three controls; rate panel is opt-in and closes after pick; Stop/end/error collapse to Play; player/text/hook untouched; typecheck clean; lint clean (ignore known `pages/` warning).

## Handoff

Builder reports: files changed; confirmation player/hook/text/constants were not edited; confirmation idle is Play-only and active is three controls; confirmation rate panel is upward `absolute` of the other four rates (no new shadcn); confirmation `min-h-14` replaced `min-h-28` and `max-w-3xl` stayed; `pnpm test` + typecheck + lint results; any deviation and why.

## Research note

- **Codebase (codegraph `IssueListenBar` / `useIssueListen`):** bar is two rows, `min-h-28`, all five rates always visible, inner still `max-w-prose` until Feature 04. Hook/player already expose `status` / `setRate` / error copy. Feature 04 will swap inner width to `max-w-3xl` and leave the seven-button chrome for this feature.
- **Stage 13 Feature 06 U3:** two-row `min-h-28` was a phone-overflow patch for seven always-on buttons. Compact listen is the product fix (Darticus, plan grill 2026-08-14: “just a little button till we hit play… 7 buttons always visible to three”). Do not keep `min-h-28` as the idle floor; do not bring back `h-16`+`overflow-hidden`.
- **Stage 13 C2:** mid-play rate tap must not flash `Couldn’t start listening.` Player already ignores `canceled`/`interrupted` and yields before re-speak. This feature must not edit the player.
- **MDN (Context7 `/mdn/content` `SpeechSynthesisUtterance.rate`):** rate is per-utterance; Stage 13 `setRate` while playing already cancel-restarts the chunk. UI only needs to call the existing hook.
- **shadcn:** Popover is not installed; Select/Collapsible exist. Auto-picked Buttons + absolute panel so jsdom tests stay click-simple and the panel grows up (U3), not a new overlay primitive.
- **Open questions closed (auto, 2026-08-14):** idle = Play only (not Play+current rate); paused stays expanded-to-three; rate panel = other four above the row, not inline wrap of seven.
- **Grizzled Senior (2026-08-14):** delete the idle `1.5×` persistence test in Task 1; case 5 is one-chunk + `queue[0]` `onend`; case 11 Play→expand→Stop→Play-again so leftover `ratesOpen` cannot reopen the panel.
