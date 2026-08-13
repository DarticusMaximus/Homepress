# Feature 04: Issue listen

## Intent

Let the operator listen to a loaded issue on the Issues reader with play / pause / stop and a simple speed control, using the device’s preferred TTS engine — so a digest can be heard in the installed app after Edge Read Aloud disappears in standalone.

## Spec

On a **successfully loaded** issue (`/issues/[runId]`), a listen bar is **fixed to the bottom of the viewport** (always under a thumb; CSS `position: fixed`, not `position: sticky`). It offers **Play / Pause**, **Stop**, and five rates. Playback uses `window.speechSynthesis` with the utterance **voice left unset**, so Android’s preferred engine (Supertronic or any other) speaks. No named-engine detection, no cloud audio, no Edge Read Aloud.

**Operator-visible done line (PM-confirmed):** Open an issue → bottom bar → Play reads the issue as prose (no markdown noise, no raw URLs). Pause silences and remembers the current chunk; Play resumes that chunk. Stop (or leaving the page) returns to the start. Rate 0.75×–2× is remembered on this device. Tiny breaths at sentence-pack boundaries are acceptable; multi-second gaps are not.

### Auto-pinned decisions (grill + research)

| Topic | Pin | Why |
|-------|-----|-----|
| Surface | Issues reader success path only | Stage out of scope: Settings, Inspect, lists, error/empty states. |
| Engine | Web Speech; `utterance.voice` unset | Plan pin: system preferred TTS. Do not call `getVoices()` to pick Supertronic or any name. |
| Extras | No skip-by-heading, no voice picker, no sentence highlight, no Media Session / lock-screen / headset skip | PM: play/pause/stop + rate only. Boundary events are not portable. |
| Rate | `0.75`, `1`, `1.25`, `1.5`, `2` (default `1`). Labels `0.75×` `1×` `1.25×` `1.5×` `2×`. | PM-confirmed. Cap at 2 — Chromium can stall above 2.0. |
| Rate storage | `localStorage` key `homepress.issue-listen.rate` | Device-local; not Settings/Appwrite. Invalid/missing → `1`. |
| Rate while playing | Cancel and restart **current chunk** at the new rate | Rate is per-utterance (MDN `SpeechSynthesisUtterance.rate`). |
| Spoken text | Draft markdown → prose. Strip markers. `[label](url)` → label only. Bare/`<url>` URLs dropped. Images dropped (no alt). Do not speak page chrome (Back, Inspect, Send, Publish, newsletter · date). Title is spoken once as the first heading in the draft. | PM: URLs currently waste time; skip them. |
| Chunking | Pack **complete sentences** until the next would exceed **200 words**. Never split mid-sentence. One sentence longer than 200 words is its own chunk. | PM: long issues; not one-sentence-at-a-time. Chromium stalls on huge utterances (~200–300 words). |
| Queue | Keep **one chunk ahead** in the `speechSynthesis` queue (current + next). No extra delay we add. | MDN `speak()` queues. Tiny gaps OK; seconds-long waits are not. |
| Pause / resume | **Do not** call `speechSynthesis.pause()` / `resume()`. Pause = `cancel()` + remember chunk index. Resume = `speak` from that chunk (start of chunk, not exact word) + lookahead. | Chrome/Edge Android: `pause()` often ends the utterance so `resume()` is a no-op ([MDN BCD #4500](https://github.com/mdn/browser-compat-data/issues/4500)). |
| Stop | `cancel()`, index `0`, idle. Next Play is from the start. | PM-confirmed. |
| End of issue | Last chunk `end` with nothing left to enqueue → `status = "idle"`, `chunkIndex = 0`. Next Play starts from the beginning. | PM-confirmed. Must be in the player, not only this table. |
| Leave page | `cancel()` on unmount (Back, another issue, any nav). No resume-later. | PM-confirmed. |
| Gesture | First `speak()` runs **synchronously** inside `play()` (before `play()` returns). No `setTimeout`/`queueMicrotask` before that first `speak()`. | Autoplay: speech needs a user gesture. |
| Missing API | Bar **absent** (not disabled) if `speechSynthesis` is missing. After mount only — no SSR flash of a fake bar. | Same “no fake control” rule as Feature 02 Install. |
| TTS error | Locked copy on the bar: `Couldn’t start listening.` (curly apostrophe). No toast. Real utterance error → cancel leftovers, idle, `chunkIndex = 0`. Next `play()` or `stop()` clears `error` to `null`. | PM-confirmed. |
| Keep-alive timer | **Do not** `pause()`/`resume()` on an interval | Desktop Chrome ~15s cutoff is not the Android proving target; that trick fights cancel-based pause. |
| New deps | None for markdown-to-text or TTS | Small functions in `web/lib/`. Existing `Button`. |

### Spoken-text contract (exact)

Create `web/lib/issue-listen-text.ts` exporting:

- `ISSUE_LISTEN_WORD_BUDGET = 200`
- `toSpeakableText(markdown: string): string` — input is the issue draft. Output is plain text for TTS:
  - ATX/setext headings → heading text only (no `#`).
  - `**` `*` `__` `_` `~~` stripped; inner text kept.
  - Inline `` `code` `` → code text; fenced blocks → inner text (drop the language tag line).
  - `[label](url)` and `[label][ref]` → `label` only (never the URL).
  - Bare `http://` / `https://` URLs and autolinks `<http…>` removed.
  - Images `![alt](url)` removed entirely (do not speak alt).
  - List markers (`-`, `*`, `1.`) stripped; item text kept.
  - Blockquote `>` stripped; table pipes/separators stripped (cell text kept, spaces between cells).
  - HTML tags stripped.
  - Collapse runs of whitespace to single spaces; trim.
- `packUtterances(text: string, wordBudget = ISSUE_LISTEN_WORD_BUDGET): string[]` — split `text` into sentences (end of sentence = `.` `?` `!` followed by whitespace or end, or a newline boundary after stripping). Pack consecutive sentences while `wordCount(chunk + next) ≤ wordBudget`. `wordCount` = `trim` + split on whitespace (empty text → `[]`). An oversized single sentence is one chunk.

### Player contract (exact)

Create `web/lib/issue-listen-player.ts` — a **plain module** (no React) so tests do not need `renderHook`.

Export `createIssueListenPlayer(options)`:

- `options.synth` — the SpeechSynthesis-like object (`speak`, `cancel`). Tests inject a fake; production passes `window.speechSynthesis`.
- `options.utteranceCtor` — `typeof SpeechSynthesisUtterance` (tests inject a fake class).
- `options.onState` — called whenever UI-relevant state changes.
- `options.onError` — called on utterance `error` (except treat a cancel-driven stop as non-error: if we initiated `cancel()`, do not surface `Couldn’t start listening.`).

State the player reports:

- `status`: `"idle" | "playing" | "paused"`
- `chunkIndex`: number (0 when idle/stopped)
- `rate`: number (one of the five rates)

Methods:

- `play(chunks: string[])` — if `status === "paused"`, resume from `chunkIndex` (ignore new chunks **or** use the same array the pause used; production always passes the same packed list). If idle, start at `0`. If `chunks.length === 0`, stay idle (no-op). Set `utterance.rate` from current rate. `voice` unset. Enqueue chunk `i` and, if present, chunk `i+1`. The first `synth.speak(...)` must run **before `play()` returns** (no `setTimeout` / `queueMicrotask` / `Promise.then` before that call). On `end` of chunk `i`, enqueue `i+2` if it exists (always one ahead, never the whole issue at once). When the **last** chunk ends and nothing remains to enqueue → `status = "idle"`, `chunkIndex = 0`, `onState`.
- `pause()` — `synth.cancel()`; `status = "paused"`; keep `chunkIndex` at the chunk that was speaking (the one whose `start` fired last, or `0` if none started).
- `stop()` — `synth.cancel()`; `status = "idle"`; `chunkIndex = 0`.
- `setRate(rate)` — persist is the hook’s job. Player stores rate. If `playing`, `cancel()` then `play` from current `chunkIndex` at the new rate (lookahead again). If paused/idle, only store rate.
- `dispose()` — `cancel()`; no further `onState` / `onError` after dispose.

On a **real** utterance `error` (not a cancel we initiated): `synth.cancel()` leftovers; `status = "idle"`; `chunkIndex = 0`; call `onError` then `onState`. Do **not** use `synth.pause` or `synth.resume`.

### Hook + bar contract (exact)

Create `web/hooks/use-issue-listen.ts` (`"use client"`):

- Read/write `localStorage` key `homepress.issue-listen.rate`. Allowed values: `0.75`, `1`, `1.25`, `1.5`, `2` (JSON number or string both OK; coerce to those five). Missing/invalid → `1`. Guard `window`/`localStorage` so SSR/tests without storage do not throw.
- `supported`: `typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function"`.
- On `supported`, construct the player with `window.speechSynthesis` and `SpeechSynthesisUtterance`. `dispose()` on unmount.
- `play()` packs `toSpeakableText(markdown)` then `player.play(chunks)`. A successful `play()` (idle or paused → playing) sets `error` to `null` **before** calling the player. `stop()` also sets `error` to `null`.
- On player `onError`, set `error` to `ISSUE_LISTEN_ERROR_COPY` (status/idle come from `onState`).
- Expose `{ supported, status, rate, error, play, pause, stop, setRate }` where `error` is `null` or the locked error copy.

Create `web/components/issues/issue-listen-bar.tsx` (`"use client"`):

Locked copy (export constants):

- `ISSUE_LISTEN_REGION_LABEL = "Listen to issue"`
- `ISSUE_LISTEN_PLAY_LABEL = "Play"`
- `ISSUE_LISTEN_PAUSE_LABEL = "Pause"`
- `ISSUE_LISTEN_STOP_LABEL = "Stop"`
- `ISSUE_LISTEN_ERROR_COPY = "Couldn’t start listening."`
- `ISSUE_LISTEN_RATES = [0.75, 1, 1.25, 1.5, 2] as const`
- Rate button accessible name: the label with `×` (e.g. `1×`).

UI:

- If `!supported`, render `null`.
- `role="region"` `aria-label={ISSUE_LISTEN_REGION_LABEL}`.
- **Play/Pause** — one `Button`: label **Pause** when `status === "playing"`, else **Play**. Click → `pause()` when playing, else `play()`.
- **Stop** — `Button`; `disabled` when `status === "idle"`; click → `stop()`.
- Five rate `Button`s; selected has `aria-pressed="true"`; click → `setRate`.
- When `error` is set, show it as visible text in the region (not a toast, not `role="alert"` required).
- Use existing `@/components/ui/button` (`size="sm"`). No new shadcn components.
- **Fixed bar:** `fixed inset-x-0 bottom-0 z-40` with `border-t bg-background` and `padding-bottom: env(safe-area-inset-bottom, 0px)` so Feature 03 body padding does not apply to `position: fixed`. Include an in-flow **spacer** (same component) so the last markdown is not hidden under the bar (`h-16` or equivalent plus safe-area). `z-40` is below Dialog/Sheet.

### IssueReader wiring (exact)

`web/components/issues/issue-reader.tsx` stays a **server** component. On the success path only (`loadError` is false), render `<IssueListenBar markdown={markdown ?? ""} />` **inside** the existing `readerColumnClassName` column, after the markdown body. Do **not** mount it from `IssueReaderNotAvailable`, `IssueReaderLoadErrorBare`, or the `loadError` branch of `IssueReader`.

Do not change `web/components/issues/issue-markdown.tsx` (article links stay `target="_blank"`).

## Dependencies

- Builds on: Stage 06 Issues reader (`web/components/issues/issue-reader.tsx`, `web/app/(protected)/issues/[runId]/page.tsx`, draft markdown).
- Does not depend on Stage 13 Features 01–03 to function (listen works in a tab too). Must not break Feature 03 article-link `target="_blank"` or Feature 02 Settings Install.
- Patterns: client children on the reader (`send-issue-button.tsx`); `web/hooks/use-mobile.ts`; `Button` `size="sm"`.

## Constraints

- Do not set `utterance.voice` or special-case Supertronic / any engine name.
- Do not use cloud / OpenRouter / any audio API; do not use Edge Read Aloud.
- Do not call `speechSynthesis.pause` / `resume`.
- Do not add listen to Settings, Inspect, Issues list, or error/empty reader states.
- Do not add skip-by-heading, voice picker, highlighting, Media Session, or a keep-alive pause/resume timer.
- Do not add markdown-to-text or TTS npm dependencies.
- Do not change Settings schema, PWA manifest, service worker, or login/session.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] A loaded issue shows a bottom listen bar with Play/Pause, Stop, and rates `0.75×` `1×` `1.25×` `1.5×` `2×`; the bar is absent on not-available / load-error and when `speechSynthesis` is missing.
- [ ] Play speaks speakable prose from the draft (no markdown markers, no raw URLs, no images); chrome labels are not spoken.
- [ ] Long issues are packed into ≤200-word sentence chunks with one chunk queued ahead; Play is a user-gesture `speak()`.
- [ ] Pause remembers the current chunk and resumes from the start of that chunk; Stop, leaving the page, and **finishing the last chunk** reset to idle at the start.
- [ ] Rate applies to utterances, is capped at 2, persists in `localStorage`, and mid-play change restarts the current chunk.
- [ ] TTS `error` shows `Couldn’t start listening.` on the bar (not a toast), returns to idle, and clears on the next Play or Stop. Voice is unset.

## Files

- Create: `web/lib/issue-listen-text.ts`
- Create: `web/lib/issue-listen-player.ts`
- Create: `web/hooks/use-issue-listen.ts`
- Create: `web/components/issues/issue-listen-bar.tsx`
- Create: `web/src/__tests__/issue-listen-text.test.ts`
- Create: `web/src/__tests__/issue-listen-player.test.ts`
- Create: `web/src/__tests__/issue-listen-bar.test.tsx`
- Modify: `web/components/issues/issue-reader.tsx` — mount `IssueListenBar` on success only
- Regression: `web/src/__tests__/issue-reader.test.tsx` must still pass (bar hidden in jsdom without `speechSynthesis`)

## Testing approach

Test-first. jsdom has no real TTS — fake `speak`/`cancel` and a stub `SpeechSynthesisUtterance` that records `text` / `rate` / `voice` and exposes `onend` / `onerror` / `onstart` the test can fire. Do **not** require Android in CI; operator smoke / stage finalize on Edge+Brave Android.

### `issue-listen-text.test.ts`

1. **Headings and emphasis** — `# Hello **world**` → speakable contains `Hello` and `world`, not `#` or `*`.
2. **Link label not URL** — `[OpenAI](https://openai.com/about)` → contains `OpenAI`, does not contain `openai.com` or `https`.
3. **Bare URL dropped** — `See https://example.com/path for more.` → no `https`, no `example.com`; still contains `See` and `for more`.
4. **Image dropped** — `![Chart](https://cdn.example/a.png)\n\nAfter` → no `Chart` required (alt skipped), no URL; contains `After`.
5. **Pack under budget** — two short sentences pack into one chunk when combined word count ≤ 200.
6. **Pack splits at budget** — enough sentences that the second batch would exceed 200 → two (or more) chunks; no chunk splits a sentence (each chunk, split on whitespace, does not start with a lowercase continuation of a mid-sentence cut — assert by joining a known sentence that would be split if packing ignored boundaries).
7. **Oversized sentence** — a single sentence with >200 words is one chunk.
8. **Empty** — `""` → `[]`.

### `issue-listen-player.test.ts`

Fake synth: `speak` pushes utterances onto a queue; `cancel` clears queue and marks cancelled. Tests fire `onstart` / `onend` / `onerror`.

1. **Play enqueues current + next** — three chunks; after `play`, `speak` called with chunk0 and chunk1 only (not chunk2).
2. **First speak is synchronous** — after `play()` returns, `speak` has already been invoked at least once (no deferred first `speak`).
3. **End enqueues lookahead** — after chunk0 `end`, chunk2 is spoken (chunk1 already queued).
4. **Last chunk end → idle** — one chunk; `play`; `onstart`; `onend`; reported `status === "idle"` and `chunkIndex === 0`.
5. **Pause cancel + resume from chunk** — start chunk0; `onstart`; `pause()` calls `cancel`; `play` again speaks from chunk0 (not later chunks only).
6. **Stop resets** — after playing, `stop()` then `play` speaks chunk0 first.
7. **Empty chunks no-op** — `play([])` does not call `speak`; status idle.
8. **Rate on utterance** — `setRate(1.5)` then `play` → utterance `rate === 1.5` and `voice` is `null`/`undefined`.
9. **Rate while playing restarts chunk** — playing chunk1 (`onstart` on second utterance); `setRate(2)` → `cancel` then speak from chunk1 at rate `2`.
10. **Dispose cancels** — `dispose()` calls `cancel`; later `onend` does not throw / does not call `onState`.
11. **Utterance error → idle** — `onerror` → `onError` fired; `status === "idle"`; `chunkIndex === 0`. After `pause()`/`stop()`/`dispose()`, a subsequent error from cancel must **not** call `onError` (ignore errors once cancel was requested).

### `issue-listen-bar.test.tsx`

Stub `speechSynthesis` + `SpeechSynthesisUtterance` on `window` in `beforeEach` when the case needs the bar; `afterEach` restore. Existing `issue-reader.test.tsx` must keep passing **without** that stub (bar absent).

1. **Hidden without API** — render `IssueListenBar` with no `speechSynthesis`; no region `Listen to issue`.
2. **Success reader shows bar** — stub API; render `IssueReader` with markdown; region present; Play, Stop, `1×` (and other rates) visible.
3. **Load-error hides bar** — stub API; `IssueReader` `loadError`; no listen region. Same for `IssueReaderNotAvailable`.
4. **Play label toggles** — stub player via the real hook + fake synth: click Play → Pause label; click Pause → Play label.
5. **Stop disabled when idle** — Stop `disabled` initially; enabled while playing.
6. **Error copy + idle + clear** — fire utterance `onerror` after Play; `Couldn’t start listening.` visible; Play/Pause label is **Play** (idle, not stuck on Pause). Click Play again (fake synth does not error); error copy gone. Do not import toast in the bar.
7. **Rate pressed + storage** — click `1.5×` → `aria-pressed="true"` on that button; `localStorage` key `homepress.issue-listen.rate` holds `1.5`.
8. **Fixed + safe-area (class/style)** — the bar container class includes `fixed` and `bottom-0`; style or class includes `safe-area-inset-bottom`.
9. **Source-read IssueReader** — `readFileSync` `issue-reader.tsx`: `IssueListenBar` imported; rendered in the success branch; **not** in `IssueReaderNotAvailable` / `IssueReaderLoadErrorBare` function bodies.

**Not required in CI:** real Android TTS, Supertronic, audible gap timing, lock-screen controls.

**Regression:** `issue-reader.test.tsx`, `issue-markdown.test.tsx`.

## Tasks

### Task 1: Failing tests for speakable text and packing

- **Action**: Create `web/src/__tests__/issue-listen-text.test.ts` with the eight cases above (import names from `web/lib/issue-listen-text.ts`). Run vitest; confirm failures for missing module/exports (not harness blow-ups).
- **Expected result**: Test file exists; failures are missing `toSpeakableText` / `packUtterances`.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-text.test.ts` fails on missing implementation.
- **Depends on**: none.

### Task 2: Implement speakable text and packing

- **Action**: Create `web/lib/issue-listen-text.ts` per the **Spoken-text contract**. No new dependencies.
- **Expected result**: All eight text tests pass.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-text.test.ts` passes; `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 1.

### Task 3: Failing tests for the listen player

- **Action**: Create `web/src/__tests__/issue-listen-player.test.ts` with the eleven cases above against `createIssueListenPlayer`. Confirm failures for missing module.
- **Expected result**: Test file exists; failures are missing player.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-player.test.ts` fails on missing implementation.
- **Depends on**: Task 2.

### Task 4: Implement the listen player

- **Action**: Create `web/lib/issue-listen-player.ts` per the **Player contract**. Do not call `pause`/`resume` on the synth object.
- **Expected result**: All eleven player tests pass.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-player.test.ts` passes. Grep `web/lib/issue-listen-player.ts` for `synth.pause`, `synth.resume`, `speechSynthesis.pause`, and `speechSynthesis.resume` — **no matches**. Do **not** grep for a bare `.pause()` (that is this module’s own `pause()` method).
- **Depends on**: Task 3.

### Task 5: Failing tests for the listen bar and reader wiring

- **Action**: Create `web/src/__tests__/issue-listen-bar.test.tsx` with the nine cases above. Confirm failures for missing bar/hook.
- **Expected result**: Test file exists; failures are missing UI/wiring.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-bar.test.tsx` fails on missing `IssueListenBar` / hook / reader mount.
- **Depends on**: Task 4.

### Task 6: Implement hook, bar, and IssueReader mount

- **Action**: Create `web/hooks/use-issue-listen.ts` and `web/components/issues/issue-listen-bar.tsx` per the **Hook + bar contract**. Modify `web/components/issues/issue-reader.tsx` per **IssueReader wiring**. Do not add toast. Do not mount on error/empty paths.
- **Expected result**: Bar tests pass; `issue-reader.test.tsx` still passes without a TTS stub.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-listen-bar.test.tsx web/src/__tests__/issue-reader.test.tsx` passes; `pnpm typecheck` and `pnpm lint` pass.
- **Depends on**: Task 5.

### Task 7: Feature verification gate

- **Action**: Run the full feature verification command set; fix gaps without expanding scope.
- **Expected result**: All Feature 04 tests green; reader/markdown regression green; typecheck/lint green; handoff notes ready.
- **Verify**: Commands in **Feature verification** succeed.
- **Depends on**: Task 6.

## Feature verification

- Run: `pnpm exec vitest run web/src/__tests__/issue-listen-text.test.ts web/src/__tests__/issue-listen-player.test.ts web/src/__tests__/issue-listen-bar.test.tsx web/src/__tests__/issue-reader.test.tsx web/src/__tests__/issue-markdown.test.tsx`
- Run: `pnpm typecheck`
- Run: `pnpm lint`
- Expected: All listed tests pass; typecheck clean; lint clean (ignore known benign `pages/` eslint-config-next warning). Success-path issue reader shows a fixed bottom listen bar; speakable text skips URLs/markdown; player chunks with lookahead and cancel-based pause; last chunk and TTS error return to idle; first `speak()` is synchronous; rate persists; no `synth.pause`/`synth.resume`; voice unset.

## Handoff

Builder reports: files created/modified; confirmation voice is unset and pause uses `cancel` not `synth.pause`/`synth.resume`; confirmation last-chunk `end` and real TTS error return to idle; confirmation error copy clears on next Play/Stop; confirmation first `speak()` is synchronous; confirmation bar is success-path only and hidden without `speechSynthesis`; confirmation `localStorage` key and rate set; test + typecheck + lint results; any deviation and why.

## Research note

- **API**: MDN `SpeechSynthesis` / `SpeechSynthesisUtterance.rate` (rate 0.1–10, default 1; engines may clamp). `speak()` queues utterances (`pending`).
- **Android**: Chromium uses the system TTS engine; switching Android’s preferred engine changes output without app-side names. `pause`/`resume` historically broken on Chrome Android (pause ends the utterance).
- **Length**: Practical utterance ceiling ~200–300 words (silent stall). Desktop Chrome ~15s cutoff is a different bug (often Google network voices); not the proving target — do not add pause/resume keep-alive.
- **Autoplay**: first `speak()` needs a user gesture.
- **Codebase**: `IssueReader` is a server component; client children already exist (`SendIssueButton`). jsdom has no `speechSynthesis` — existing reader tests stay green if the bar self-hides.
- **PM grill (2026-08-12)**: play/pause/stop + five rates; sentence packing ~200 words with one-ahead queue; tiny gaps OK; skip URLs; sticky-bottom = always-visible fixed bar; pause = this chunk not this word; leave page = stop; no Media Session / highlight / voice picker.
