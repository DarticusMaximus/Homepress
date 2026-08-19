# Stage 14: Reader-first GUI

## Intent

Fourteen stages built a working press and left the factory floor as the front door: nine-item ops nav, a Dashboard that says configure/run/deliver, and an issue reader whose chrome is Inspect / Send / Publish. Daily use is already Goal 1 — open the app, pick a digest, read or listen — but the GUI still looks like newsletter publication. This stage inverts the IA so Homepress reads as a content app. Publication stays real; it lives under Admin, not on the reading surface. That serves the north star’s digest-you-have-time-to-read, and leaves a reader vs factory split a later household-roles stage can wear.

## Goal

The operator opens Homepress onto a Home of issue cards, reads an issue without factory chrome, listens from a compact player, and reaches the factory in one tap via Admin. Once in Admin, factory pages are a real menu in the existing sidebar/sandwich — not a dump of links at the bottom of the hub. Newsletters in the reader nav are channels (recent issues), not config forms.

## Features

1. **Reader / Admin shell** — Reader nav is Home, Newsletters, Admin. Admin is a hub that shows today’s factory Dashboard (health, recent runs). Factory pages live under Admin; existing factory addresses still reach them. Phone/narrow viewports get a sticky header with the page title and the nav (sandwich) control so it does not scroll away. Feature 06 owns how factory destinations appear as a menu.
2. **Home card inbox** — Home is a blog-index of issues: title, newsletter name, date, and a short dek (first lines of the existing draft — same fetch already used for titles). Tap a card to open the full issue. Cards at all widths — not the Admin domain-list table/card split. No separate top-level Issues nav item.
3. **Newsletter as channel** — Reader Newsletters is a list of channels; a channel page shows recent issues for that newsletter. Create/edit/generate and other config stay in Admin.
4. **Issue reader chrome** — One issue page, not a rebuild. From Home or a channel, the ops bar is off (Inspect pipeline, Markdown, HTML, Send, Publish, email/RSS status). From Admin/Runs, the ops bar is on. The issue body column is wider than the Stage 13 narrow prose measure.
5. **Compact listen** — Listen starts as a small control. After Play, three controls: Play/Pause, Stop, and the current rate. Tap the rate to expand the other rates. Same Issues-reader-only, system-TTS contract as Stage 13.
6. **Admin factory nav** — When the path is Admin or an Admin factory page, the existing sidebar (desktop) and sandwich sheet (mobile) show factory destinations: Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, Settings, with the current page marked active. Home and reader Newsletters stay three-item. The Admin hub keeps Needs attention / Recent runs / Health and drops the bottom Factory link list; the menu is the directory. Jumping factory pages does not require returning to the hub. No second hamburger and no second header row of factory tabs.

## Acceptance criteria

- [ ] Reader nav shows Home, Newsletters, and Admin — not Feeds, Runs, Schedules, Prompts, Delivery, or Settings as top-level items.
- [ ] Opening the app at Home shows issue cards with title, newsletter, date, and a short dek; tapping a card opens that issue.
- [ ] An issue opened from Home or a newsletter channel does not show Inspect, Markdown, HTML, Send, Publish, or email/RSS status.
- [ ] An issue opened from Admin/Runs does show those factory actions.
- [ ] Admin hub shows factory health (database / feeds) and recent runs.
- [ ] On Admin and Admin factory pages, the existing sidebar (desktop) and sandwich sheet (mobile) list Feeds, Newsletters, Issues, Runs, Schedules, Prompts, Delivery, and Settings, with the current page marked active.
- [ ] On Home and reader Newsletters, those factory destinations are not in the nav.
- [ ] The Admin hub has no bottom list of factory links; jumping from one factory page to another does not require returning to the hub.
- [ ] No second hamburger and no second header row of factory tabs.
- [ ] Reader Newsletters lists channels; a channel page lists that newsletter’s recent issues (config/edit is not the reader page).
- [ ] On a phone-width issue view, after scrolling down, the nav control and a page title remain visible (no scroll-to-top to open the menu).
- [ ] On tablet/desktop, the issue body is wider than the Stage 13 narrow prose column.
- [ ] Listen is a small control until Play; while playing, Play/Pause, Stop, and current rate are the visible controls (other rates behind a tap on the current rate).
- [ ] Existing factory bookmarks still reach the same factory pages (via Admin).

## Dependencies

- Stage 13 (pwa-and-listen) must be complete — standalone shell and Issues-reader listen are the reading surface this stage re-chromes.

## Out of scope

- A separate LLM title or summary call (first heading + first-lines dek stay; Stage 15).
- Regenerating a draft on a “completed” run (Stage 15).
- User vs admin accounts, roles, or a second login (Stage 16). Multi-tenant / public sign-up remains a PRODUCT non-goal.
- Renaming Issues or Newsletters as domain words.
- Listen on any surface other than the issue reader.
- Offline reading, push, or a native app.
- Factory destinations always visible on reader Home / Newsletters (nested under Admin or otherwise). Stage 16 still needs factory off the reader surfaces.
- A second nav chrome (extra hamburger, factory tab bar under the header).

## Open questions

- Dek length: first paragraph vs a fixed character budget (ssc-spec).
- How much wider the issue column should be (ssc-spec).
- Ops-bar on: query flag vs Admin-prefixed issue URL (same page either way; ssc-spec picks the durable option).
- Factory nav: flat eight destinations vs grouped (e.g. content / ops / tuning) — ssc-spec.
