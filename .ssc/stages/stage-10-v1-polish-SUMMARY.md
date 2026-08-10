# Stage 10: V1 Polish — Summary

## What this stage delivered

Daily operator use is now pleasant enough to launch V1. Scheduling no longer needs an external cron cheat-sheet: you pick a cadence, time, and timezone in the app, and the system still stores a valid schedule under the hood. The newsletter edit surface is a real page with clear tabs (Basics, Advanced, Schedule, Delivery, Feeds) instead of one endless dialog scroll — create stays simple (Basics only), then lands you on that page.

Draft quality is more tunable: the drafter can use each newsletter’s audience brief, you can override the global drafter prompt per newsletter (or leave it blank to use the global one), and the shipped default asks for a newsletter title as the first heading so titles come from the draft itself. Inspect is scannable (collapsed sections, draft stacked under selected items). Phone chrome behaves: the sidebar closes after a tap, nested routes stay highlighted, and Back/Inspect controls are easy to hit. The home page earns its place — recent issues, a short recent-runs snapshot, and attention badges that deep-link into Feeds, Runs, and Delivery — and run-retention purge controls sit in a collapsed Advanced pocket on Runs so everyday scanning stays uncluttered.

A post-stage code review found and fixed launch-relevant gaps (session gates on newsletter mutators, dashboard failed-run undercount, safer edit redirects, and related polish). Those hardening fixes shipped as Feature 08 before this close.

## How it maps to the plan

- **Stage Intent:** Make daily operator use pleasant enough to launch V1 — scheduling without a cron cheat-sheet, a useful home page, less painful newsletter edit / inspect / mobile chrome, and drafter quality you can tune per newsletter — so the full configure → schedule → generate → deliver loop feels like a tool you want to open every day, not a stack of feature pages glued together.
- **Acceptance criteria met:**
  - [x] Operator can set a newsletter schedule using in-app cron/timezone helpers without pasting from an external cron builder; enabling a schedule still stores a valid 5-field cron and IANA timezone.
  - [x] Newsletter create/edit presents distinct sections/tabs; schedule, delivery, feeds, model overrides, and per-newsletter drafter (when present) are reachable without hunting through one undifferentiated scroll.
  - [x] Global and per-newsletter drafter templates may use `{audience}`; runs inject the newsletter’s audience; blank per-newsletter override uses the global drafter template; shipped default drafter is more generic and instructs a newsletter title as the first heading.
  - [x] Inspect shows collapsed accordions by default; expanding reveals content; draft appears below selected inputs (not a side-by-side that breaks the layout).
  - [x] On a phone-width viewport: choosing a sidebar nav item closes the menu; Back to Issues / Inspect pipeline / Back to Runs controls are easy to tap; Runs/Issues stay highlighted on their nested detail routes; `/design-system` is gone; status filters/labels use title case where shown to operators.
  - [x] Dashboard shows recent issues, a compact recent-runs summary, and attention signals with links into Feeds / Runs / Delivery / Issues as appropriate — not only DB + feed-health cards.
  - [x] Run retention (days + clean up now) lives under a collapsed-by-default Advanced section on Runs; behavior of retention itself is unchanged.
- **North star link:** Stages 00–09 delivered the full configure → schedule → generate → deliver loop; Stage 10 removes the remaining operator friction so that loop is something you actually want to open every day — the last gate before treating the product as launchable V1.

## What was built

- **Feature 01 — Schedule builder:** Guided cadence + time + searchable timezone on Schedule fields; raw cron remains an Advanced escape hatch; stored value stays valid 5-field cron + IANA timezone.
- **Feature 02 — Newsletter edit structure:** Dedicated edit page with tabs (Basics / Advanced / Schedule / Delivery / Feeds); create is Basics-only, then routes to the edit page.
- **Feature 03 — Drafter prompts:** `{audience}` in the drafter contract and runtime; generic shipped default with title-as-first-heading; optional per-newsletter override (blank = global).
- **Feature 04 — Inspect layout:** Pipeline sections collapsed by default; draft stacks under selected inputs instead of a cramped side-by-side.
- **Feature 05 — Mobile and shell polish:** Sidebar closes on nav tap; nested active highlight; larger Back/Inspect hit targets; `/design-system` removed; light loading/error UI; title-case status labels.
- **Feature 06 — Dashboard:** Home landing with attention badges, recent issues, compact recent-runs snapshot, and minimized health — with deep links into existing pages.
- **Feature 07 — Runs Advanced retention:** Retention days + Clean up now tucked under a collapsed-by-default Advanced section at the bottom of Runs; purge semantics unchanged.
- **Feature 08 — Hardening (review 2026-07-21):** Session gates on newsletter mutators; dedicated failed-run fetch for dashboard attention; safer `?edit=` redirects; real timezone-search coverage; parallelized/deduped dashboard fetches; redacted Appwrite error logs; unified failed-runs links via `buildRunsHref`.

## Decisions and deviations

- Create stays Basics-only; schedule/delivery/feeds/models/drafter are set on the post-create edit page (or Schedules) — by design, not an omission.
- Per-newsletter drafter override lives under the Advanced tab (with model overrides), not its own top-level tab — matches Features 02/03; operators scanning only tab labels can miss it.
- Live Appwrite drafter template documents are not auto-migrated to the new shipped body; operators use Reset / paste to pick up the Stage 10 default (feature pin).
- Code review ran before finalize; all seven accepted findings (2 High, 5 Medium) were addressed via Feature 08. No open Blockers at close.
- Delivery attention on the dashboard may still be windowed by the issues list used for that signal (review P1 follow-on); stage AC6 (signals + correct deep links) holds.

## Deferred and out of scope

- Separate LLM issue-title call (titles come from the drafter’s first heading).
- Nav regrouping / hiding rarely used items (flat eight-item nav stays).
- A Settings page (retention stays on Runs Advanced).
- List-page DRY / code simplification (dedicated future stage).
- Manual curation, interest signals, LLM-as-judge dedup (PRODUCT Future directions).
- Changing delivery, scheduling semantics, or pipeline phases beyond drafter prompt resolution and audience injection.

## Open questions for the next stage

- Whether a dedicated post-V1 cleanup stage should tackle list-page DRY / shared patterns (already deferred in Plan.md).
- Whether Delivery attention should eventually use a full delivery-issues query instead of the issues-windowed signal (noted during regression; not blocking AC6).
- Product roadmap after V1 launch: Future directions in PRODUCT.md (manual curation, interest signals) remain the primary candidates for a new stage via `ssc-plan`.
