# Feature 07: Harden stage-14 against review findings (2026-08-19)

## Intent

Harden `stage-14-reader-first-gui` against findings from `review-stage-14-reader-first-gui-2026-08-19`: the issue body must actually read wider than Stage 13’s 65ch, Admin hub tests must fail a renamed factory dump, factory Newsletters must be distinguishable to assistive tech, and compact listen must not dump keyboard focus — without reopening features 01–06.

## Spec

This is a **hardening feature** produced by `ssc-code-review`. Features 01–06 stay `verified`. Distilled work — not a copy of the report.

**PM triage (2026-08-19):** Address now on C1, T1, U1, and U2. Validator-Rejected N1 (NewslettersStub leftover) stays out.

**Spec-review pin (2026-08-19):** Grizzled Senior — U2 last-chunk/error tests must `.focus()` a control that **unmounts on idle** (Stop or current-rate), then fire `onend`/`onerror`. Play → Pause → `onend` is not a gate (Pause stays mounted). Drop “if it dumped to body.”

### C1 (Medium) — digest body fills the 3xl column

`IssueReader` wraps success chrome in `ISSUE_READER_COLUMN_CLASS` (`max-w-3xl`). The body still mounts `<IssueMarkdown markdown={…} />` with no `className`. `IssueMarkdown` applies Tailwind Typography `prose`, whose default `max-width` is `65ch`. Title/ops can grow; the digest text does not. Inspect already passes `className="max-w-none"` into the same component (`inspect-draft-section.tsx`).

**Fix (required):**

1. On the success-path call in `web/components/issues/issue-reader.tsx`, pass `className="max-w-none"` into `IssueMarkdown` (same prop Inspect uses). Do **not** rebuild `IssueMarkdown`. Do **not** drop `prose`.
2. Outer column stays `ISSUE_READER_COLUMN_CLASS` (`max-w-3xl`). Do not put `max-w-prose` back on the reader or listen inner wrap.
3. Load-error / not-available paths have no body; leave them alone.

### T1 (Medium) — hub tests catch a dump that is not named Factory

`DashboardView` is already dump-free (Needs attention → Recent runs → Health strip). Tests only assert `queryByRole(region|group, { name: "Factory" })` is null and that `dashboard-view.tsx` source does not contain `FACTORY_DIRECTORY` (split string). A `QuietNavLink` list of the eight factory roots under another accessible name stays green.

**Fix (required):**

1. In `web/src/__tests__/reader-admin-shell.test.tsx` hub composition case, keep the Factory region/group null + `FACTORY_DIRECTORY` source-read.
2. Add href locks for destinations the hub **does not** use as widgets. After render, these query-less root hrefs must be **absent** from `DashboardView`: `/admin/newsletters`, `/admin/issues`, `/admin/schedules`, `/admin/prompts`, `/admin/settings`.
3. **Allowed** (do not forbid): `/admin/feeds` (FeedsHealthCard / attention), `/admin/runs` (Recent runs View all / inspect / attention), `/admin/delivery` (attention). Query strings on those (`?health=unhealthy`) stay allowed.
4. Do **not** `querySelector('a[href="/admin/feeds"]')` on the whole hub and expect null — that false-fails current widgets.
5. `dashboard-page.test.tsx` / `dashboard-home-load.test.tsx` may keep Factory-name null; the five-href lock lives in `reader-admin-shell.test.tsx` so it is one proving surface.

### U1 (Medium) — factory Newsletters has a distinct accessible name

On Admin paths, reader nav and Factory both expose a link whose accessible name is “Newsletters” (`/newsletters` vs `/admin/newsletters`). Visible labels stay **Newsletters** (Feature 06 pin: distinguisher is the Factory group, not a rename). The group `aria-label="Factory"` is not enough for AT that does not announce the parent group on link focus.

**Fix (required):**

1. Keep `factoryNavItems` title **Newsletters** and the visible `<span>` text **Newsletters**.
2. On the **factory** Newsletters `Link` only (`href="/admin/newsletters"`), set `aria-label="Newsletters (Factory)"`. Reader Newsletters keeps accessible name **Newsletters**.
3. Do not rename the domain word. Do not add `aria-label` to the other seven factory items unless a test forces it (out of scope).
4. Rewrite `admin-factory-nav.test.tsx` case “two Newsletters links”: `getAllByRole("link", { name: "Newsletters" })` is **length 1** (reader, href `/newsletters`). Factory link is `getByRole("link", { name: "Newsletters (Factory)" })` (or `/Newsletters.*Factory/`) with href `/admin/newsletters`, still inside the Factory group. Do not leave the old length-2 same-name assertion.

### U2 (Medium) — compact listen keeps keyboard focus

Idle Play-only unmounts Stop; picking a panel rate unmounts that button. Focus goes to `<body>`. Play and the current-rate control remain mounted. Feature 05 chrome (idle Play-only, panel of the other four) stays.

**Fix (required):**

1. After **Stop**, last-chunk **end**, or TTS **error** collapse to idle: if focus is inside the listen region **or** is `document.body` (unmount dump), move focus to the remaining **Play** button. If focus is in the issue body, leave it (do not yank a reading caret to Play when TTS finishes). Last-chunk/error restore is **status-driven** in `issue-listen-bar.tsx` (idle transition), not only the Stop `onClick`. Click-handler-only restore fails the last-chunk/error tests below.
2. After choosing a non-current rate in the panel: move focus to the transport **current-rate** button (the one that stays in the row, now showing e.g. `1.5×`).
3. Idle DOM stays Play-only: Stop and the five rates are **not** in the document. Do not “fix” focus by remounting Stop when idle.
4. Do not edit `use-issue-listen.ts`, `issue-listen-player.ts`, `issue-listen-text.ts`, or `issue-listen-constants.ts`.

## Dependencies

- Builds on: **features 01–06 of this stage** (already `verified`).
- Anchor: `.ssc/reviews/review-stage-14-reader-first-gui-2026-08-19.md`.
- C1: `web/components/issues/issue-reader.tsx`, `IssueMarkdown` (`className` already exists).
- T1: `web/src/__tests__/reader-admin-shell.test.tsx`, `web/components/dashboard/dashboard-view.tsx` (no production dump to add).
- U1: `web/components/app-sidebar.tsx`, `web/src/__tests__/admin-factory-nav.test.tsx`.
- U2: `web/components/issues/issue-listen-bar.tsx`, `web/src/__tests__/issue-listen-bar.test.tsx`.

## Constraints

- **Do not reopen** features 01–06 status; this is additive hardening.
- **Keep** Feature 04: path-conditional `showOps`; dual routes; `ISSUE_READER_COLUMN_CLASS`; no query/referrer chrome; Home/channel still `/issues/{id}`.
- **Keep** Feature 05: idle Play-only; active three controls; rate panel other four, `absolute` `bottom-full`; `min-h-14`; no `min-h-28` / `h-16` / `overflow-hidden`; no player/hook edits; no Popover/Select.
- **Keep** Feature 06: `navItems` length 3; factory group Admin-path-only; visible factory Newsletters label is still **Newsletters**; no hub Factory directory; no second hamburger.
- **Do not** add `max-w-none` by deleting `prose`.
- **Do not** delete `NewslettersStub` tests as a substitute for U1 (Rejected N1 is out of scope).
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [x] Success-path `IssueReader` passes `className="max-w-none"` into `IssueMarkdown`. The rendered `.prose` root’s `className` matches `/max-w-none/`. Outer column remains `max-w-3xl` (no `max-w-prose`). `IssueMarkdown` is still the renderer (C1).
- [x] Hub `DashboardView` tests fail if `/admin/newsletters`, `/admin/issues`, `/admin/schedules`, `/admin/prompts`, or `/admin/settings` appear as links. Current dump-free hub with FeedsHealthCard / Recent runs / attention deep links still passes (T1).
- [x] Visible factory label is still Newsletters. Reader Newsletters accessible name is Newsletters (`/newsletters`). Factory Newsletters accessible name includes Factory (`/admin/newsletters`). Factory group `role="group"` `aria-label="Factory"` remains (U1).
- [x] Clicking Stop moves focus to Play. Choosing a panel rate moves focus to the transport current-rate button. Idle chrome stays Play-only. Last-chunk `onend` and TTS `onerror`, with focus on Stop or the current-rate control (nodes that unmount on idle), move focus to Play. Focus on a heading outside the listen region stays there when TTS ends (U2).
- [x] `pnpm typecheck` and `pnpm lint` pass; touched web suites green.

## Files

- Modify: `web/components/issues/issue-reader.tsx` — `IssueMarkdown` `className="max-w-none"` (C1)
- Modify: `web/src/__tests__/issue-reader-chrome.test.tsx` — rendered `.prose` has `max-w-none` (C1)
- Modify: `web/src/__tests__/reader-admin-shell.test.tsx` — five non-widget factory hrefs absent (T1)
- Modify: `web/components/app-sidebar.tsx` — factory Newsletters `aria-label="Newsletters (Factory)"` (U1)
- Modify: `web/src/__tests__/admin-factory-nav.test.tsx` — distinct accessible names (U1)
- Modify: `web/components/issues/issue-listen-bar.tsx` — focus move on idle collapse / rate pick (U2)
- Modify: `web/src/__tests__/issue-listen-bar.test.tsx` — `document.activeElement` cases (U2)

## Testing approach

Test-first. jsdom. Do not screenshot. Do not require a screen reader.

1. **C1** — Render success `IssueReader` (existing chrome fixture). `container.querySelector(".prose")` `className` matches `/max-w-none/`. Keep existing outer-column `/max-w-3xl/` and not `/max-w-prose/`. A source-read of `issue-reader.tsx` that only greps the string `max-w-none` in a comment is **not** enough — the rendered prose node is required.
2. **T1** — Existing hub render in `reader-admin-shell.test.tsx`: for each of `/admin/newsletters`, `/admin/issues`, `/admin/schedules`, `/admin/prompts`, `/admin/settings`, `container.querySelector(\`a[href="${href}"]\`)` is null. Factory region/group still null. `FACTORY_DIRECTORY` source-read stays. Do not assert `/admin/feeds` or `/admin/runs` absent.
3. **U1** — Pathname `/admin/newsletters`: one link named `Newsletters` href `/newsletters`; one link named `Newsletters (Factory)` href `/admin/newsletters` inside the Factory group. Visible Factory group label still `Factory`. Source of `app-sidebar.tsx` still maps `item.title` into a `<span>` (visible word unchanged).
4. **U2** — Play → Stop: idle Play-only **and** `document.activeElement` is the Play button. Play → expand → click `1.5×`: group gone, transport shows `1.5×`, that button is `document.activeElement`. **Last-chunk / error (required, not optional):** Play so Stop (or the transport current-rate) is mounted; call `.focus()` on that control (`fireEvent.click` does **not** move focus in jsdom); fire last-chunk `onend` / TTS `onerror`; expect Play is `document.activeElement` and Stop/rates are gone. Do **not** use Play → Pause → `onend` as the gate — Pause stays mounted and the case stays green without restore. **Negative:** mount success `IssueReader` (has a heading); `.focus()` that heading; fire last-chunk `onend`; heading remains `document.activeElement` (do not yank reading focus to Play).

Anti-cheat: do not `.skip` these gates; do not “fix” C1 by widening only the outer wrapper; do not “fix” T1 by renaming a dump `Operations`; do not “fix” U1 by changing the visible factory title; do not “fix” U2 by keeping Stop mounted when idle or by using Play → Pause → `onend` as the last-chunk gate.

## Tasks

### Task 1: C1 issue body `max-w-none` (red → green)

- **Action**: Add the failing `.prose` `/max-w-none/` assertion to `web/src/__tests__/issue-reader-chrome.test.tsx` (success `IssueReader`). Pass `className="max-w-none"` on `IssueMarkdown` in `web/components/issues/issue-reader.tsx`.
- **Expected result**: C1 Acceptance Criteria met.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/issue-reader-chrome.test.tsx src/__tests__/issue-reader.test.tsx`
- **Depends on**: none.

### Task 2: T1 hub dump href lock (red → green)

- **Action**: Extend `web/src/__tests__/reader-admin-shell.test.tsx` hub case with the five absent query-less hrefs. Do not change `dashboard-view.tsx` unless a test proves a dump slipped back — the live hub is already dump-free.
- **Expected result**: T1 Acceptance Criteria met. Current hub still green.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/reader-admin-shell.test.tsx src/__tests__/dashboard-page.test.tsx`
- **Depends on**: none.

### Task 3: U1 factory Newsletters accessible name (red → green)

- **Action**: Rewrite the two-Newsletters case in `web/src/__tests__/admin-factory-nav.test.tsx` so same-name length 2 **fails**. Set `aria-label="Newsletters (Factory)"` on the factory Newsletters `Link` in `web/components/app-sidebar.tsx`. Keep visible `<span>{item.title}</span>`.
- **Expected result**: U1 Acceptance Criteria met. `within(group).getByRole("link", { name: "Newsletters" })` is no longer the factory assertion — use the Factory accessible name.
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/admin-factory-nav.test.tsx src/__tests__/admin-path.test.ts src/__tests__/feeds-nav.test.ts`
- **Depends on**: none.

### Task 4: U2 listen focus restore (red → green)

- **Action**: Add failing `document.activeElement` cases to `web/src/__tests__/issue-listen-bar.test.tsx`: Stop → Play; pick `1.5×` → current-rate; last-chunk and error with `.focus()` on Stop or current-rate then `onend`/`onerror` (not Pause); negative heading outside the region. Implement **status-driven** focus move in `web/components/issues/issue-listen-bar.tsx` only — Stop `onClick` alone is not enough. Player/hook/constants untouched.
- **Expected result**: U2 Acceptance Criteria met. Idle still Play-only (`min-h-14`, no `min-h-28`).
- **Verify**: `pnpm --filter web exec vitest run src/__tests__/issue-listen-bar.test.tsx src/__tests__/issue-listen-player.test.ts`
- **Depends on**: none.

### Task 5: Feature gate

- **Action**: Re-read this spec vs implementation; run typecheck/lint and the touched suites; fix gaps only as needed for this feature. Do not change features 01–06 status. Tick Detailed Findings checkboxes in the review report when AC are met.
- **Expected result**: All Acceptance criteria checked; hardening complete.
- **Verify**:
  ```bash
  pnpm typecheck && pnpm lint && \
  pnpm --filter web exec vitest run \
    src/__tests__/issue-reader-chrome.test.tsx \
    src/__tests__/issue-reader.test.tsx \
    src/__tests__/reader-admin-shell.test.tsx \
    src/__tests__/dashboard-page.test.tsx \
    src/__tests__/admin-factory-nav.test.tsx \
    src/__tests__/admin-path.test.ts \
    src/__tests__/issue-listen-bar.test.tsx
  ```
- **Depends on**: Tasks 1–4.

## Feature verification

- Run: the Task 5 verify matrix.
- Expected: All green. Digest `.prose` has `max-w-none`; hub tests fail a five-root dump; factory Newsletters accessible name includes Factory; Stop/rate-pick keep keyboard focus; idle listen stays Play-only. Features 01–06 remain `verified` (unchanged status).

## Handoff

Builder reports: files changed; confirmation `IssueMarkdown` still used with `prose` + `max-w-none`; confirmation hub widgets still link `/admin/feeds` and `/admin/runs`; confirmation visible factory title is still Newsletters; confirmation player/hook were not edited; any deviation and why. Reference report: `.ssc/reviews/review-stage-14-reader-first-gui-2026-08-19.md`.

## Research notes

- Review + validator (2026-08-19): C1/T1/U1/U2 Medium Confirmed. N1 Anti-cheat Rejected (stale stub tests; Feature 03 already locks the live route) — out of this spec.
- `@tailwindcss/typography` 0.5.20 `prose` DEFAULT `maxWidth` is `65ch`; `w-full` does not override it. Inspect’s `max-w-none` is the existing escape hatch.
- Feature 06 pin: two visible “Newsletters” words; distinguisher is the Factory group. This feature only diverges **accessible** names.
- Feature 05 pin: idle Play-only. Focus restore must not remount Stop. Last-chunk focus steal from the article would fight reading — only restore when focus was in the bar or dumped to `body`.
- Spec review (2026-08-19): U2 last-chunk/error must `.focus()` Stop or current-rate (unmounts on idle) then fire `onend`/`onerror`. Play → Pause → `onend` is not a gate. Forces status-driven restore, not click-handler-only.
