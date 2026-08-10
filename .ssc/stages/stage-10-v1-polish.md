# Stage 10: V1 Polish

## Intent

Make daily operator use pleasant enough to launch V1 — scheduling without a cron cheat-sheet, a useful home page, less painful newsletter edit / inspect / mobile chrome, and drafter quality you can tune per newsletter — so the full configure → schedule → generate → deliver loop feels like a tool you want to open every day, not a stack of feature pages glued together.

## Goal

Operator-facing friction from Stages 02–09 is addressed: cron is buildable in-app, the newsletter edit surface stays navigable as it grows, drafter prompts use audience and can be overridden per newsletter, Inspect and mobile chrome are usable, retention sits in a sensible Advanced pocket, and the dashboard earns its place as the landing page. No new product capabilities beyond polish and the drafter/audience gaps needed for good titles via the draft itself.

## Features

1. **Schedule builder** — GUI layer on top of cron + timezone (presets / helpers) so the operator does not need an external cron tool; stored value remains a valid 5-field cron + IANA timezone.
2. **Newsletter edit structure** — Reorganize the newsletter create/edit dialog into clear sections or tabs so core config, models, schedule, delivery, feeds, and (feature 03) per-newsletter drafter stay reachable without an endless scroll of undifferentiated fields.
3. **Drafter prompts** — Wire `{audience}` into the drafter placeholder contract and runtime injection; ship a more generic default drafter template (including asking for a newsletter title as the first heading — no separate LLM title call); allow an optional per-newsletter drafter prompt override (blank = global template).
4. **Inspect layout** — On the Runs inspect (detail) page: phase/section items are accordions, collapsed until opened; draft output sits under selected inputs, not beside them.
5. **Mobile and shell polish** — Sidebar closes after choosing a nav item on mobile; enlarge Back / Inspect hit targets on issue and inspect detail; fix nav active highlight for nested routes (e.g. Inspect under Runs); remove the unused `/design-system` page; add light route `loading` / `error` UI where cheap; humanize list/filter status labels (`Pending` not `pending`).
6. **Dashboard** — Replace the thin health-only home with a useful landing: recent issues, a short recent-runs snapshot (e.g. last week), attention badges (unhealthy feeds, failed runs/delivery), and sensible deep links into existing pages.
7. **Runs Advanced retention** — Move run-retention controls into a collapsible **Advanced** section on the Runs page (not a new Settings page in V1).

## Acceptance criteria

- [ ] Operator can set a newsletter schedule using in-app cron/timezone helpers without pasting from an external cron builder; enabling a schedule still stores a valid 5-field cron and IANA timezone.
- [ ] Newsletter create/edit presents distinct sections/tabs; schedule, delivery, feeds, model overrides, and per-newsletter drafter (when present) are reachable without hunting through one undifferentiated scroll.
- [ ] Global and per-newsletter drafter templates may use `{audience}`; runs inject the newsletter’s audience; blank per-newsletter override uses the global drafter template; shipped default drafter is more generic and instructs a newsletter title as the first heading.
- [ ] Inspect shows collapsed accordions by default; expanding reveals content; draft appears below selected inputs (not a side-by-side that breaks the layout).
- [ ] On a phone-width viewport: choosing a sidebar nav item closes the menu; Back to Issues / Inspect pipeline / Back to Runs controls are easy to tap; Runs/Issues stay highlighted on their nested detail routes; `/design-system` is gone; status filters/labels use title case where shown to operators.
- [ ] Dashboard shows recent issues, a compact recent-runs summary, and attention signals with links into Feeds / Runs / Delivery / Issues as appropriate — not only DB + feed-health cards.
- [ ] Run retention (days + clean up now) lives under a collapsed-by-default Advanced section on Runs; behavior of retention itself is unchanged.

## Dependencies

- Stage 09 (Delivery) must be complete — full V1 capability surface exists to polish.
- Stage 07 (prompts/models) and Stage 08 (scheduling) surfaces are the primary edit targets for features 01–03.
- Stage 06 Inspect / Issues detail are the targets for features 04–05.

## Out of scope

- LLM-generated issue titles as a separate post-draft call (titles come from the drafter’s first heading via the updated template).
- Nav regrouping / hiding rarely used items (flat eight-item nav stays).
- A Settings page (deferred beyond V1; retention stays on Runs Advanced).
- Code deduplication / simplification across list pages (dedicated future stage).
- Manual curation, interest signals, LLM-as-judge dedup (PRODUCT Future directions).
- Changing delivery, scheduling semantics, or pipeline phases beyond drafter prompt resolution and audience injection.

## Open questions

- Schedule builder UX details (which presets, free-text still available?) — grill in `ssc-spec` for feature 01.
- Exact dashboard widgets and “last week” vs “last N runs” — grill in `ssc-spec` for feature 06.
- Newsletter edit: tabs vs accordion sections — grill in `ssc-spec` for feature 02.
