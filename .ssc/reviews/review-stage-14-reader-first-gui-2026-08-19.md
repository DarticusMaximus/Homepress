# SSC Code Review Report

**Date:** 2026-08-19
**Review:** ssc-code-review (manager-orchestrated — sequential reviewer + validator sub-agents)
**Scope:** stage-14-reader-first-gui (stage)
**Profile:** full — severity floor: Medium
**Feature spec anchor:** `.ssc/stages/stage-14-reader-first-gui/feature-0{1–6}-*.md`

---

## Summary

- **Merge recommendation:** Approve with changes
- **Issues by severity:** Blocker 0 | High 0 | Medium 4 | Low 0 | Nit 0
- **Overall rationale:** Stage 14 Intent is delivered for the reader/Admin split, Home cards, newsletter channels, path-conditional ops chrome, compact listen, and Admin factory nav. The four Confirmed Medium findings are polish/regression holes, not a broken invert: digest body still measures at typography’s 65ch despite a `max-w-3xl` wrapper; compact listen dumps keyboard focus; two sidebar Newsletters links share one accessible name; hub tests would miss a renamed factory dump. Validator rejected a leftover-stub anti-cheat claim. No Blockers. Address C1 before finalize if the wider-column pin is the proving check; the rest can defer.

---

## Scope and Coverage

> Records what was and was not checked — the files-reviewed breadcrumb.

- **Target reviewed:** stage-14-reader-first-gui (all six verified features)
- **Base reference:** n/a (SSC-native scope)
- **Profile / floor:** full / Medium. Reviewers and validator: Grok 4.6 high.
- **Batches:** B1 (Features 01 + 06 shell/factory nav), B2 (Features 02 + 03 Home/channels — no findings), B3 (Features 04 + 05 issue chrome/listen); then one validator pass
- **Files reviewed:** 51 paths

  Shell / Admin nav (B1):
  - `web/lib/page-title.ts`, `web/lib/nav-items.ts`, `web/lib/nav-active.ts`, `web/lib/dashboard-data.ts`, `web/lib/runs-url.ts`
  - `web/app/(protected)/layout.tsx`, `web/app/(protected)/admin/page.tsx`
  - `web/components/header-page-title.tsx`, `web/components/app-sidebar.tsx`
  - `web/components/dashboard/dashboard-view.tsx`, `web/components/dashboard/recent-runs.tsx`
  - `web/components/feeds/feeds-url.ts`, `web/components/feeds-health-card/feeds-health-card.tsx`
  - `web/components/health-card/actions.ts`
  - `web/components/runs/inspect-url.ts`, `web/components/runs/inspect-shell.tsx`
  - `web/components/delivery/delivery-url.ts`, `web/components/issues/issues-url.ts`
  - `web/components/newsletters/newsletters-pagination.tsx`, `newsletters-table.tsx`, `newsletter-list-card.tsx`, `newsletter-edit-form.tsx`, `newsletter-form-dialog.tsx`
  - `web/components/schedules/schedules-table.tsx`, `schedule-list-card.tsx`, `schedule-edit-dialog.tsx`
  - Admin actions (URL/`revalidatePath` prefix only): `feeds`, `newsletters`, `prompts`, `runs`, `schedules`, `settings` `actions.ts`
  - Tests: `reader-admin-shell.test.tsx`, `page-title.test.ts`, `admin-factory-nav.test.tsx`, `admin-path.test.ts`, `nav-active.test.ts`

  Home / channels (B2):
  - `shared/src/runs/issues.ts` (`extractIssueDek`, `resolveIssueCardMetaForRuns`)
  - `web/lib/home-url.ts`, `web/lib/channel-url.ts`
  - `web/components/home/home-inbox.tsx`, `home-issue-card.tsx`
  - `web/components/newsletters/channel-list.tsx`
  - `web/app/(protected)/page.tsx`, `newsletters/page.tsx`, `newsletters/[id]/page.tsx`
  - Tests: `issues.test.ts` (dek/card-meta), `home-inbox.test.tsx`, `home-url.test.ts`, `channel-url.test.ts`, `channel-list.test.tsx`, `channel-page.test.tsx`

  Issue chrome / listen (B3):
  - `web/lib/issue-reader-layout.ts`, `web/components/issues/issue-url.ts`
  - `web/components/issues/issue-detail-view.tsx`, `issue-reader.tsx`, `issue-listen-bar.tsx`
  - `web/app/(protected)/issues/[runId]/page.tsx`, `admin/issues/[runId]/page.tsx`
  - `web/components/issues/issues-table.tsx`, `issue-list-card.tsx`
  - `web/components/delivery/delivery-table.tsx`, `delivery-list-card.tsx`
  - Tests: `issue-url.test.ts`, `issue-reader-chrome.test.tsx`, `issue-listen-bar.test.tsx`
  - Validator also opened `web/components/issues/issue-markdown.tsx` (C1 evidence)

- **Files skipped:**
  - TTS `use-issue-listen.ts`, `issue-listen-player.ts`, `issue-listen-text.ts`, `issue-listen-constants.ts` — Feature 05 forbids edits; not in this stage’s modify set
  - Factory list `page.tsx` bodies that only moved under `/admin/*` (feeds, issues list, runs, schedules, prompts, delivery, settings)
  - Pre-Stage-14 action business logic (newsletter generate, settings diagnostics, etc.) except path prefixes
  - Live phone scroll / SR walkthrough (not CI)
- **Assumptions and unknowns:**
  - Single signed-in operator; path-based Admin vs reader chrome is the spec, not an AuthZ hole (Stage 16)
  - Feature 01: no compatibility redirects from old unprefixed factory URLs
  - `@tailwindcss/typography` 0.5.20 `prose` DEFAULT `maxWidth` is `65ch` (validator)
  - HTML focus fixup on unmount sends focus to document/body (validator); not asserted in jsdom today
  - Rejected N1 (NewslettersStub leftover) is not in Detailed Findings

---

## SSC Intent Check

- **Stage Intent:** Invert the IA so Homepress reads as a content app. Publication stays real; it lives under Admin, not on the reading surface.
- **Feature Intent lines:**
  1. Three-item reader nav, factory under Admin, sticky phone header
  2. Home as issue-card inbox (title, newsletter, date, dek)
  3. Reader Newsletters as channels; config stays Admin
  4. Ops chrome off on `/issues/[runId]`, on on `/admin/issues/[runId]`; wider body than Stage 13
  5. Listen compact until Play — Play/Pause, Stop, current rate
  6. Factory destinations in the existing sidebar/sandwich on Admin paths; hub dump gone
- **Intent served?** Partially — reader/Admin split, Home cards, channels, ops-by-path, compact listen, and factory nav all landed. Feature 04’s wider **body** measure did not: the column token is `max-w-3xl` while `prose` still caps the digest at 65ch (C1).
- **Notes:** U1/U2 are a11y gaps on chrome the specs pinned (two Newsletters labels; idle Play-only unmount). T1 is a test hole on Feature 06’s hub-dump Intent, not a live dump. B2 had no findings.

---

## Detailed Findings

> Single source of truth — each finding listed exactly once, sorted by severity (Blocker→Nit) then category. Track completion only via these checkboxes.

### [x] C1-20260819: Issue body still capped at 65ch inside the 3xl column

| Field | Value |
|---|---|
| **ID** | `C1-20260819` |
| **Severity** | Medium |
| **Category** | Correctness & Reliability |
| **Location** | `web/components/issues/issue-reader.tsx:151-154` |
| **Description** | Feature 04 Intent requires a wider issue body than Stage 13’s `max-w-prose` (65ch). `IssueReader`’s outer wrapper correctly uses `ISSUE_READER_COLUMN_CLASS` (`max-w-3xl`), but it renders `IssueMarkdown` with no `max-w-none`. `IssueMarkdown` applies Tailwind Typography’s `prose` class, which still caps `max-width` at 65ch. Chrome (back, title, ops) can grow to 3xl while digest text stays on the old measure. Inspect already passes `className="max-w-none"` into the same component. Passing `max-w-none` is not a markdown-renderer rebuild. |
| **Risk / Impact** | On tablet/desktop the operator still reads at Stage 13 line length. The Feature 04 column change is visible on title/meta/ops but not on the body. |
| **Evidence** | Success body is `<IssueMarkdown markdown={markdown ?? ""} />` inside a `max-w-3xl` column. `IssueMarkdown` root is `prose dark:prose-invert w-full`. `@tailwindcss/typography` 0.5.20 DEFAULT sets `maxWidth` `65ch`; `w-full` does not override `max-width`. Chrome tests only assert the outer column `/max-w-3xl/` and not `/max-w-prose/`. |
| **Recommendation** | Pass `className="max-w-none"` on `IssueReader`’s `IssueMarkdown` (same prop Inspect already uses) so body text fills the `max-w-3xl` column. Do not replace `IssueMarkdown`. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | In `issue-reader-chrome.test.tsx` (or `issue-reader.test.tsx`), render success `IssueReader` and assert the prose root `className` matches `/max-w-none/`. Keep the existing outer-column `max-w-3xl` / no `max-w-prose` assertions. |
| **Acceptance Criteria** | Success-path `IssueReader` passes `max-w-none` (or equivalent) into `IssueMarkdown` so computed max-width of the digest body is not 65ch while the column remains `max-w-3xl`. `IssueMarkdown` is still the renderer. Existing `showOps` / back-link / column-class tests still pass. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Call site, `prose` 65ch default, Inspect’s `max-w-none`, and chrome tests that would stay green with a 65ch body all match current code. Not High/Blocker because ops chrome, dual routes, and the wrapper token did land. |

---

### [x] T1-20260819: Hub tests miss a renamed factory link dump

| Field | Value |
|---|---|
| **ID** | `T1-20260819` |
| **Severity** | Medium |
| **Category** | Testing |
| **Location** | `web/src/__tests__/reader-admin-shell.test.tsx:197-204` |
| **Description** | Feature 06 Intent is that the Admin hub drops the Feature 01 Factory link dump. Hub tests only assert `queryByRole` region/group name Factory is null and that `dashboard-view.tsx` source does not contain the identifier `FACTORY_DIRECTORY` (split as `"FACTORY" + "_DIRECTORY"`). They never assert the eight factory roots are absent from `DashboardView`. A `QuietNavLink`/anchor list of `/admin/feeds` … `/admin/settings` under a different accessible name (or no name) would stay green. |
| **Risk / Impact** | The hub dump can be reintroduced without failing this file, sending operators back to scrolling the hub for Feeds → Runs. |
| **Evidence** | `reader-admin-shell.test.tsx` lines 197–204: Factory region/group null; source-read of `FACTORY_DIRECTORY`. `dashboard-page.test.tsx` and `dashboard-home-load.test.tsx` overlap on section order / no Factory name only. Current `dashboard-view.tsx` has no Factory section. |
| **Recommendation** | Assert factory-directory links are absent from the hub **as a dump**, while still allowing widget deep links: FeedsHealthCard `/admin/feeds`, attention hrefs, Recent runs View all / inspect `/admin/runs`. Do not naively `querySelector('a[href="/admin/feeds"]')` on the whole hub — that false-fails current correct widgets. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Render `DashboardView`; no `aria-label="Factory"` directory of the eight roots. Allow `/admin/runs` only inside Recent runs (View all / empty-state) and `/admin/feeds` only inside health/attention widgets. |
| **Acceptance Criteria** | A hub-bottom list of the eight factory destinations fails hub tests even if it does not use the name Factory or the identifier `FACTORY_DIRECTORY`. Current dump-free `DashboardView` still passes, including health and Recent runs deep links. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | No overlapping test forbids the eight roots as a dump. Live hub is already dump-free; this is a regression hole, not a present dump. |

---

### [x] U1-20260819: Two Newsletters links share one accessible name

| Field | Value |
|---|---|
| **ID** | `U1-20260819` |
| **Severity** | Medium |
| **Category** | UX / i18n / Accessibility |
| **Location** | `web/components/app-sidebar.tsx:41-70` |
| **Description** | On Admin paths the sandwich/sidebar exposes two links whose accessible name is both “Newsletters”: reader nav `href="/newsletters"` and factory `href="/admin/newsletters"`. Visible labels match the Feature 06 pin (distinguisher is the Factory group, not a rename). Neither factory link adds `aria-label`/`aria-describedby`. Most AT does not announce a parent `role="group"` name when a link takes focus, so keyboard/SR users (and a hurried phone tap) can activate reader Newsletters and leave factory chrome. |
| **Risk / Impact** | Operator intending newsletter config lands on the reader channel list; Factory destinations disappear because `isAdminPath("/newsletters")` is false. Recovery is tap Admin. |
| **Evidence** | Both items render `<Link href={item.href}>` with title Newsletters. `SidebarGroup` has `role="group"` `aria-label="Factory"`. `admin-factory-nav.test.tsx` case 6 asserts `getAllByRole("link", { name: "Newsletters" })` length 2. Tooltips do not distinguish names on mobile / expanded sidebar. |
| **Recommendation** | Keep the visible label Newsletters (spec pin). On the factory Newsletters `Link` only, set `aria-label="Newsletters (Factory)"` (or `aria-describedby` pointing at the group label id) so accessible names diverge without renaming the domain word. |
| **Effort** | S |
| **Confidence** | Medium |
| **Suggested Tests** | On pathname `/admin/newsletters`, factory link accessible name includes Factory; reader link name stays Newsletters; hrefs remain `/newsletters` vs `/admin/newsletters`. |
| **Acceptance Criteria** | Visible factory label is still Newsletters. The two Newsletters anchors have distinct accessible names. Reader href is `/newsletters`; factory href is `/admin/newsletters`. Factory group still has `role="group"` and `aria-label="Factory"`. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Duplicate accessible names are in code. Feature 06 accepted two visible “Newsletters” words; it did not put the group name into each link’s accessible name. Keep Medium: sighted users still see Factory; bounce-out is recoverable. |

---

### [x] U2-20260819: Compact listen unmount drops keyboard focus

| Field | Value |
|---|---|
| **ID** | `U2-20260819` |
| **Severity** | Medium |
| **Category** | UX / i18n / Accessibility |
| **Location** | `web/components/issues/issue-listen-bar.tsx:74-117` |
| **Description** | Compact listen unmounts Stop and the rate panel when chrome returns to idle or a non-current rate is chosen. Feature 05 requires those nodes out of the document (idle Play-only). Click Stop → Stop unmounts; click a panel rate → that button unmounts. The browser sends focus to `<body>`. Play (and the current-rate control after a pick) remain in the tree and are the logical targets. Stage 13 kept Stop and all five rates mounted. |
| **Risk / Impact** | Keyboard and assistive-tech users who Stop or pick a speed are dumped to the document root on a long digest page and must tab back through reader chrome to reach Play again. Pointer users are unaffected. |
| **Evidence** | Active chrome is `{active ? (<> Stop; current-rate </>) : null}`. Panel rates are `{ratesOpen && active ? … setRate; setRatesOpen(false) : null}`. No `focus()` move to remaining Play / current-rate. Tests click Stop and assert idle chrome but do not assert `document.activeElement`. |
| **Recommendation** | After Stop (and after last-chunk/error collapse to idle), focus the Play button. After choosing a panel rate, focus the current-rate button that remains on the transport row. Keep idle DOM as Play-only. |
| **Effort** | S |
| **Confidence** | High |
| **Suggested Tests** | Play → Stop, then `expect(document.activeElement).toBe(screen.getByRole("button", { name: "Play" }))`. Play → expand → click `1.5×`, then expect the remaining `1.5×` current-rate button to be `document.activeElement`. |
| **Acceptance Criteria** | Clicking Stop moves focus to Play. Choosing a non-current rate moves focus to the transport current-rate button. Idle chrome stays Play-only (no Stop/rates in the document). Region label Listen to issue is unchanged. |
| **Validation Decision** | Confirmed |
| **Validation Rationale** | Unmount-on-idle/pick is spec-required; missing focus move is a real a11y gap Feature 05 did not mention. HTML focus fixup to body is the impact. Keep Medium. |

---

## Dependencies and Licensing

- Vulnerabilities: none identified in this stage’s change set (no new packages for Features 01–06)
- Outdated critical packages: none reviewed beyond noting `@tailwindcss/typography` 0.5.20 `prose` 65ch default (C1)
- License concerns: none

---

## Quality Signals

- Lint/config signals: not re-run this pass; Features 01–06 gated on `pnpm typecheck` / `pnpm lint` / `pnpm test` at verify
- Test/coverage signals: Stage 14 tests exist for nav, titles, dek, Home/channel source-read, `showOps` dual routes, compact listen, `isAdminPath`. Holes: hub dump by href (T1), Newsletters accessible names (U1 case 6 currently *locks* the collision), listen `activeElement` (U2), IssueMarkdown `max-w-none` (C1)
- Complexity/churn signals: Feature 01 URL-map move is the large blast radius; Features 05–06 are chrome-only. Dead `NewslettersStub` still imported only by `reader-admin-shell.test.tsx` (validator: stale maintainability, not anti-cheat — dropped as N1)
- Validator dropped N1 (Anti-cheat Low): leftover stub tests do not keep Feature 03 green; `channel-list` / `channel-page` already lock the live route

---

## Risk Assessment

- **Overall risk:** Medium
- **Merge decision:** Approve with changes
- **Out-of-scope areas:** Stage 15 LLM titles / redraft; Stage 16 roles; TTS player/hook (Feature 05 freeze); factory list-page bodies that only moved; live SR/phone walkthrough

No Blocker or High. The invert works. C1 is the only finding that under-delivers a Feature 04 Acceptance criterion (wider body than Stage 13). U1/U2 are keyboard/AT. T1 is a future-regression hole on a hub that is already dump-free.

---

## PM Triage

Filled 2026-08-19. PM accepted all four Confirmed Mediums. Hardening spec: `.ssc/stages/stage-14-reader-first-gui/feature-07-hardening-review-2026-08-19.md`. Validator-Rejected N1 was not triaged (already dropped).

| Finding ID(s) | Severity | PM Decision | Reason |
|---|---|---|---|
| C1-20260819 | Medium | Address now | Wider body is a Feature 04 AC |
| T1-20260819 | Medium | Address now | Hub dump regression hole |
| U1-20260819 | Medium | Address now | Duplicate Newsletters accessible names |
| U2-20260819 | Medium | Address now | Compact listen keyboard focus dump |

PM Decisions: `Address now` → included in hardening feature. `Defer` → recorded for a future stage. `Dismiss` → no action; PM accepts the tradeoff.

---

_Mark items complete in the Detailed Findings checkboxes as issues are resolved by the hardening feature._
