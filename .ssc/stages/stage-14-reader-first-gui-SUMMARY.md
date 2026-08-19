# Stage 14: Reader-first GUI — Summary

## What this stage delivered

Homepress now opens as a reading app, not a factory floor. The operator lands on **Home**: a stack of issue cards (title, which newsletter, date, and a short preview of the draft). Tap a card, read the digest. Factory chrome — Inspect, Send, Publish, download, delivery status — stays off that path. Newsletters in the reader nav are channels: pick a digest, see its recent issues as the same kind of cards. Config, generate, and edit live under Admin.

The factory is still there, one tap away. **Admin** is the health/runs hub. Once you are on an Admin page, the existing sidebar (desktop) and sandwich menu (phone) list Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, and Settings. Jumping Feeds → Runs does not mean bouncing back to a dump of links at the bottom of the hub. On Home and reader Newsletters, those factory destinations stay out of the nav — the split a later household-roles stage can wear.

On a phone, the header (page title + menu) stays on screen while you scroll an issue; you do not have to scroll back to the top to open the menu. The issue column is wider than the old narrow measure. Listen starts as a Play button; after Play it is Play/Pause, Stop, and the current speed, with the other speeds behind a tap.

## How it maps to the plan

- **Stage Intent:** Fourteen stages built a working press and left the factory floor as the front door: nine-item ops nav, a Dashboard that says configure/run/deliver, and an issue reader whose chrome is Inspect / Send / Publish. Daily use is already Goal 1 — open the app, pick a digest, read or listen — but the GUI still looks like newsletter publication. This stage inverts the IA so Homepress reads as a content app. Publication stays real; it lives under Admin, not on the reading surface. That serves the north star’s digest-you-have-time-to-read, and leaves a reader vs factory split a later household-roles stage can wear.
- **Acceptance criteria met:**
  - [x] Reader nav shows Home, Newsletters, and Admin — not Feeds, Runs, Schedules, Prompts, Delivery, or Settings as top-level items.
  - [x] Opening the app at Home shows issue cards with title, newsletter, date, and a short dek; tapping a card opens that issue.
  - [x] An issue opened from Home or a newsletter channel does not show Inspect, Markdown, HTML, Send, Publish, or email/RSS status.
  - [x] An issue opened from Admin/Runs does show those factory actions.
  - [x] Admin hub shows factory health (database / feeds) and recent runs.
  - [x] On Admin and Admin factory pages, the existing sidebar (desktop) and sandwich sheet (mobile) list Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, and Settings, with the current page marked active.
  - [x] On Home and reader Newsletters, those factory destinations are not in the nav.
  - [x] The Admin hub has no bottom list of factory links; jumping from one factory page to another does not require returning to the hub.
  - [x] No second hamburger and no second header row of factory tabs.
  - [x] Reader Newsletters lists channels; a channel page lists that newsletter’s recent issues (config/edit is not the reader page).
  - [x] On a phone-width issue view, after scrolling down, the nav control and a page title remain visible (no scroll-to-top to open the menu).
  - [x] On tablet/desktop, the issue body is wider than the Stage 13 narrow prose column.
  - [x] Listen is a small control until Play; while playing, Play/Pause, Stop, and current rate are the visible controls (other rates behind a tap on the current rate).
  - [x] Existing factory bookmarks still reach the same factory pages (via Admin).
- **North star link:** Reading the digest is now the daily product in the GUI, not only in PRODUCT.md. Publication is still real — it lives under Admin as a delivery path, which is what Goal 1 asked for.

## What was built

- **Feature 01 — Reader / Admin shell:** Nav is Home / Newsletters / Admin. Factory pages moved under `/admin/*`. `/` is Home (not the old Dashboard). `/admin` is the factory hub. Phone header is sticky with a page title and the existing sandwich control.
- **Feature 02 — Home card inbox:** Home is a blog-style stack of issue cards at every width (title, newsletter, date, short dek from the existing draft — no extra model call). Tap opens that issue. Admin Issues stays the factory archive.
- **Feature 03 — Newsletter as channel:** Reader Newsletters is a list of channel names. A channel page shows that newsletter’s recent issues as the same cards. Create / Edit / Generate stay in Admin.
- **Feature 04 — Issue reader chrome:** One issue reader, two URLs. From Home or a channel (`/issues/…`) the ops bar is off. From Admin Issues or Delivery (`/admin/issues/…`) it is on. The body column is wider (`max-w-3xl`). Runs still go to Inspect, not a second “open issue” button.
- **Feature 05 — Compact listen:** Idle is Play only. After Play: Play/Pause, Stop, and the current speed. Other speeds sit behind a tap on the current rate. Same system TTS contract as Stage 13.
- **Feature 06 — Admin factory nav:** On Admin paths only, the existing sidebar/sandwich lists the eight factory destinations under a Factory group. The hub drops the bottom link dump. Reader Home / Newsletters stay three-item. No second hamburger or header tab row.
- **Feature 07 — Hardening (review 2026-08-19):** Digest body actually fills the wider column (typography’s default 65ch was pinning the text); hub tests fail a renamed factory dump; factory Newsletters is distinguishable to assistive tech without renaming the visible word; compact listen keeps keyboard focus when Stop / a speed button unmounts.

## Decisions and deviations

- Old unprefixed factory URLs (`/feeds`, `/runs`, …) 404 by design (alpha; no compatibility redirects). Factory bookmarks work **via Admin** (`/admin/feeds`, …).
- Stage AC “from Admin/Runs” is the factory issue URL (`/admin/issues/…` from Admin Issues and Delivery). Runs still open Inspect only — no extra View-issue button (grill pin in Feature 04).
- Stage-file open questions were closed in spec, not left hanging: dek is the first prose paragraph clamped to 160 characters; column is `max-w-3xl` (plus a later `max-w-none` on the prose body so 65ch does not win); ops chrome is path (`/admin/issues/…`), not a query flag; factory nav is a labeled Factory group, not eleven unlabeled siblings.
- After Features 01–06 verified, `ssc-code-review` found 0 Blocker / 0 High / 4 Medium (body width, hub dump tests, Newsletters accessible name, listen focus). PM accepted C1/T1/U1/U2; Feature 07 hardened them. Validator-rejected leftover stub tests (N1) stayed out. Stage finalize treated hardening as part of the delivered stage.
- Regression pass is contract + test composition, not a live phone session. Device smoke (Home cards, channel → issue without ops, Admin factory menu, sticky header while scrolling, compact listen) remains an operator check.
- Non-blocking composition notes: a leftover `NewslettersStub` unit still exists (live `/newsletters` uses the channel list); Home cards hardcode `/issues/{id}` instead of the shared helper — same destination, not an Acceptance-criterion miss.

## Deferred and out of scope

- A separate LLM title or summary call (first heading + first-lines dek stay; Stage 15).
- Regenerating a draft on a “completed” run (Stage 15).
- User vs admin accounts, roles, or a second login (Stage 16). Factory destinations stay off reader Home / Newsletters so that split is still available.
- Renaming Issues or Newsletters as domain words (visible factory Newsletters is still “Newsletters”).
- Listen on any surface other than the issue reader.
- Offline reading, push, or a native app.
- A second nav chrome (extra hamburger, factory tab bar under the header) — not built; Feature 06 used the existing sidebar/sandwich.

## Open questions for the next stage

- Stage 15 is next in the index: cheap-model issue title + dek, and regenerate-draft on a truncated “successful” run.
- Stage 16: household admin vs reader accounts — reader surfaces already hide the factory menu; accounts are the remaining gate.
- Whether to delete the leftover `NewslettersStub` (dead code; not on the live route).
- Banked durability/ops from Stage 12: definition backup/export, out-of-band alerts, and the Settings secrets security pass — unchanged.
