# Feature 02: Dead code & consistency sweep

## Intent

Remove unused leftovers and collapse cheap GUI/helper drift so the V1 codebase no longer reads as vibecode scrap — with one deliberate datetime-style unify — so maintenance and later features stay tractable before packaging.

## Spec

Execute a **delete + cheap align** sweep (PM-approved Option 2). No new product capabilities. No operator-visible behavior, copy, layout, or URL changes **except** the explicit Prompts "Last saved" datetime style unify in Spec §B (PM-approved).

### A. Delete bucket (known leftovers)

| Item | Path / symbol | Action |
|------|----------------|--------|
| Probe test | `shared/src/newsletters/__tests__/_c1-restart-hole.probe.test.ts` | Delete the file (header already says probe-only). |
| Dead Inspect placeholder | `INSPECT_PLACEHOLDER_COPY` in `web/components/runs/inspect-shell.tsx` | Remove the export/constant. Update `web/src/__tests__/inspect-entry.test.tsx` to drop import + the assertion that only guards its absence (or replace with a stable "success Inspect body is present / placeholder string not hardcoded" check that does not re-introduce the constant). |
| Unused class wrapper | `PipelineOrchestrator` in `shared/src/pipeline/orchestrator.ts` | Remove the class. Stop exporting it from `shared/src/pipeline/index.ts`. Keep `runPipeline` unchanged. |
| Stray re-export | `export { buildRunsHref }` in `web/components/runs/runs-pagination.tsx` | Remove the re-export; callers already use `@/lib/runs-url`. |

**Do not delete:** `newsletters.yaml` (PM still needs it as a reference while recreating newsletters in the app), Stage 01 parity harness (`worker/src/parity-run.ts`, sample JSON, scripts), intentional dual URL-safety modules (`shared/src/feeds/ssrf.ts` vs `shared/src/pipeline/fetch-safety.ts`).

### B. Cheap align — operator date/time formatters

Create a single canonical module:

- **Create:** `web/lib/format-operator-datetime.ts`
  - `formatOperatorDateTime(iso: string): string` — `new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })`
  - `formatOperatorDate(iso: string): string` — `new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" })`

Migrate all **web** production call sites listed below onto these two helpers (inventory may shrink after Feature 01 if some already share a helper — still promote to this lib).

**DateTime — migrate onto `formatOperatorDateTime`:**

| Site | Notes |
|------|--------|
| Feeds/Newsletters `formatUpdatedAt` (table + card, or Feature 01's shared helper) | Same short+short options today. |
| `web/components/runs/run-display.ts` (`formatRunDateTime`) | Prefer thin re-export/wrapper. |
| `web/components/schedules/format-schedule-next-fire.ts` (`formatScheduleNextFireAt`) | Keep null → `"—"`; datetime branch calls `formatOperatorDateTime`. |
| `web/components/prompts/prompts-editor.tsx` ("Last saved" helper) | **Intentional unify (PM):** today uses `dateStyle: "medium"` + `timeStyle: "short"`. Migrate onto `formatOperatorDateTime` (`short`+`short`) so Prompts matches the rest of the app. Keep empty → `"—"` and invalid-ISO passthrough guards in the local wrapper; only the locale style changes. |

**Date only — migrate onto `formatOperatorDate`:**

| Site | Notes |
|------|--------|
| `web/components/delivery/delivery-display.ts` (`formatDeliveryIssueDate`) | Prefer thin re-export/wrapper. |
| `web/components/issues/issues-table.tsx` | Local `formatIssueDate(iso)`. |
| `web/components/issues/issue-list-card.tsx` | Local date helper. |
| `web/components/issues/issue-reader.tsx` | Local date helper. |
| `web/components/dashboard/recent-issues.tsx` | Local date helper. |
| `web/components/runs/inspect-shell.tsx` (`formatInspectDate`) | Local `iso` → short date. |
| `web/components/runs/inspect-article-list.tsx` (`formatPhasePublished(date: Date)`) | Keep the `Date` signature. Implement as a thin wrapper via `formatOperatorDate(date.toISOString())` — do **not** silently change the exported signature. |

**Feature 01 resolution:** If Feature 01 already introduced `web/components/domain-list/format-list-datetime.ts` (or similar), **promote** to `web/lib/format-operator-datetime.ts` as the single home — delete or re-export-thin the Feature 01 path so there is exactly one implementation. Do not leave two shared datetime modules.

**Allowed thin re-exports:** Domain modules may keep exported names (`formatRunDateTime`, `formatDeliveryIssueDate`, `formatScheduleNextFireAt`, `formatPhasePublished`) as wrappers/re-exports over the lib helpers so existing tests keep importing the same paths — but locale option objects must not be duplicated in `web/components`.

**Out of scope for date consolidation:** `formatIssueFallbackTitle` in `shared/src/runs/issues.ts` (shared-package title semantics; leave alone). Canonical helpers always use `undefined` locale + the pinned short styles above.

### C. Cheap align — shared list pagination chrome

Feature 01 does **not** own pagination. Introduce a shared shell and migrate the six domain pagination components onto it.

- **Create:** `web/components/domain-list/domain-list-pagination.tsx` (export from `web/components/domain-list/index.ts` alongside `ResponsiveList` / Feature 01 exports).

**Pinned `DomainListPagination` API:**

| Prop | Type | Role |
|------|------|------|
| `ariaLabel` | `string` | `nav` `aria-label` (e.g. `"Feeds pagination"`). |
| `page` | `number` | Current page (1-based). |
| `totalPages` | `number` | Total pages. |
| `total` | `number` | Total item count. |
| `noun` | `string` | Plural noun in the status line (e.g. `"feeds"`, `"runs"`) so copy stays `Page {page} of {totalPages} ({total} {noun})`. |
| `buildPageHref` | `(page: number) => string` | Href for a given page number (domain owns filter query params). |
| `pageSizeThreshold` | `number` (optional, default **20**) | Hide entire nav when `total <= pageSizeThreshold` (matches today's behavior). |

**Pinned chrome (must match today's markup intent):** outer `nav` with `className="mt-4 flex items-center justify-between gap-4"`; status `<p className="text-sm text-muted-foreground">`; Prev/Next `Button variant="outline" size="sm"` with `ChevronLeft`/`ChevronRight` from `lucide-react`; disabled buttons when no prev/next; `Link` + `asChild` when enabled.

**Migrate (thin domain wrappers keep their exported component names):**

- `web/components/feeds/feeds-pagination.tsx`
- `web/components/newsletters/newsletters-pagination.tsx`
- `web/components/runs/runs-pagination.tsx`
- `web/components/schedules/schedules-pagination.tsx`
- `web/components/issues/issues-pagination.tsx`
- `web/components/delivery/delivery-pagination.tsx`

Each domain keeps its filter-aware href builder (`buildFeedsHref`, `buildRunsHref`, etc.). Newsletters may introduce a small `buildNewslettersHref` (or inline equivalent inside its `buildPageHref`) so page `1` omits `?page=` consistently — **same href strings as today**.

**Skip rule:** If Feature 01 somehow already introduced an equivalent shared pagination shell, do not invent a second one — migrate onto Feature 01's shell instead and document that in the handoff.

### D. One-shot knip pass

1. Run once from repo root via `pnpm dlx knip` or `npx knip` (prefer `pnpm dlx` in this pnpm monorepo). Research note: Knip monorepo/unused-exports docs (knip.dev, 2026) — use `--include exports` (and files if useful) for a focused report; do **not** blindly `--fix`.
2. Triage results: delete or stop exporting only **clear unused** symbols/files that fit this feature's spirit (leftover exports, orphan helpers). Skip ambiguous hits, framework false positives, intentional public Stage 01 APIs (`draftNewsletter`, parity harness), `newsletters.yaml`, and anything that would change operator-visible behavior (beyond the Prompts unify already pinned).
3. **Do not** add knip as a permanent CI script, root `package.json` script, or required gate for Feature 04. Optional: leave a one-line note in the handoff of what was fixed vs deferred. DevDependency install of `knip` is allowed only if `pnpm dlx` is insufficient; prefer ephemeral `dlx` so the lockfile stays clean when possible. If a lockfile change is required, remove knip again before handoff unless the PM later asks to keep it — default is **no permanent knip dep**.

### E. Explicitly deferred (do not touch in this feature)

- Auth/session gate alignment across server actions.
- Consolidating `wrapAppwriteError` / repository error factories.
- Merging domain `mock-client.ts` test frameworks.
- Moving all `*-url.ts` into `web/lib/` as a rename tour.
- Env var renames (`NEXT_PUBLIC_*` vs MCP names).
- Feature 01 list card/table DRY (already owned elsewhere).
- Pipeline phase semantics / Stages 01–09 behavior.

## Dependencies

- Builds on: **feature-01-shared-list-ui-dry** — shared `domain-list/` home and any Feeds/Newsletters datetime consolidation; Feature 02 extends datetime + owns pagination if Feature 01 left it alone.
- Stage 10 complete (polish shipped; this is cleanup only).

## Constraints

- **No operator-visible behavior change except** Prompts "Last saved" datetime style: `medium`+`short` → shared `short`+`short` (PM-approved unify). Elsewhere: same labels, actions, hrefs, empty states, pagination thresholds, and short date/datetime options.
- Do not delete `newsletters.yaml`.
- Do not rewrite pipeline phases or change Stage 01–09 semantics.
- Do not add permanent knip CI.
- Do not alter auth gates or Appwrite repository error type contracts beyond removing unused exports.
- Preserve Stage 03 responsive list convention (Feature 01); this feature must not regress `ResponsiveList` or domain list pages.

## Acceptance criteria

- [ ] Probe test file `_c1-restart-hole.probe.test.ts` is gone from `shared/src/newsletters/__tests__/`.
- [ ] `INSPECT_PLACEHOLDER_COPY` no longer exists; Inspect success path still renders without that placeholder string.
- [ ] `PipelineOrchestrator` is removed from orchestrator source and package exports; `runPipeline` remains the supported entry.
- [ ] `runs-pagination.tsx` does not re-export `buildRunsHref`.
- [ ] `web/lib/format-operator-datetime.ts` is the single implementation of short date and short datetime formatting for web GUI call sites listed in Spec §B (domain wrappers may re-export only).
- [ ] Prompts editor "Last saved" uses `formatOperatorDateTime` (no local `dateStyle: "medium"`).
- [ ] Six domain list pagination components compose one shared `DomainListPagination` (or Feature 01's equivalent); Prev/Next + "Page X of Y" chrome is not copy-pasted six ways.
- [ ] One-shot knip was run; clear unused hits in scope were fixed; knip is not a permanent CI/package gate.
- [ ] `newsletters.yaml` still present.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass; existing responsive-list / pagination / Inspect tests still pass (updated only where symbols moved or Prompts style unify requires assertion updates).

## Files

- Create: `web/lib/format-operator-datetime.ts`
- Create: `web/components/domain-list/domain-list-pagination.tsx`
- Modify: `web/components/domain-list/index.ts` (re-export pagination)
- Modify: `shared/src/pipeline/orchestrator.ts` (remove class)
- Modify: `shared/src/pipeline/index.ts` (drop `PipelineOrchestrator` export)
- Delete: `shared/src/newsletters/__tests__/_c1-restart-hole.probe.test.ts`
- Modify: `web/components/runs/inspect-shell.tsx`
- Modify: `web/src/__tests__/inspect-entry.test.tsx`
- Modify: `web/components/runs/runs-pagination.tsx` (+ the other five `*-pagination.tsx` files)
- Modify: datetime call sites under `web/components/**` and related thin wrappers (`run-display.ts`, `delivery-display.ts`, `format-schedule-next-fire.ts`, prompts editor, issues/dashboard helpers) as needed after Feature 01
- Test: `web/src/__tests__/format-operator-datetime.test.ts` (new)
- Test: `web/src/__tests__/domain-list-pagination.test.tsx` (new)
- Optional touch: existing responsive-list / feeds-health-pagination / inspect tests only if imports break

## Testing approach

Test-first for the new shared helpers; deletes and knip are verified by absence + suite green.

1. **`format-operator-datetime.test.ts`** — Assert `formatOperatorDateTime` / `formatOperatorDate` use the pinned options (compare to direct `toLocaleString` / `toLocaleDateString` with the same args on a fixed ISO). Assert domain wrappers (if kept) delegate equivalently for a sample ISO. Include `formatPhasePublished(new Date(iso))` equivalence to `formatOperatorDate(iso)` when that wrapper is kept.
2. **`domain-list-pagination.test.tsx`** — When `total <= 20`, render null. When `total > 20`, show status text with noun, enabled/disabled Prev/Next, and `buildPageHref` used for links. Smoke: one domain wrapper (e.g. Feeds or Runs) still composes the shell with the same aria-label pattern.
3. **Delete gates** — After implementation: file absence of probe test; `rg PipelineOrchestrator` only absent (or only historical docs, not source); `rg INSPECT_PLACEHOLDER_COPY` empty in `web/`; `rg "export \{ buildRunsHref \}" web/components/runs/runs-pagination.tsx` empty.
4. **Regression** — Existing Feeds/Runs/Schedules/Issues responsive-list tests, feeds-health-pagination, inspect-entry, and dashboard widget datetime assertions still pass (update imports only if required; Prompts tests may need expected-string updates for the style unify).
5. **Knip** — Document in handoff that knip was run; suite green after any removals. No new permanent knip script required for "done."

Edge cases: pagination hidden at `total === 20`; schedule next-fire null still `"—"`; Prompts empty/invalid ISO guards still `"—"` / passthrough; page 1 hrefs omit `page` query where they already did.

## Tasks

### Task 1: Failing tests for shared datetime + pagination

- **Action**: Add `web/src/__tests__/format-operator-datetime.test.ts` and `web/src/__tests__/domain-list-pagination.test.tsx` describing Spec §B/§C behavior (pinned options, threshold hide, Prev/Next href wiring). Tests should fail until Tasks 3–4 implement the modules.
- **Expected result**: New tests exist and fail for missing modules/API.
- **Verify**: `pnpm exec vitest run web/src/__tests__/format-operator-datetime.test.ts web/src/__tests__/domain-list-pagination.test.tsx` fails on missing exports/implementation.
- **Depends on**: none (assumes Feature 01 already verified; if Feature 01 added a datetime helper path, tests may import the eventual `web/lib/` API and still fail until promotion).

### Task 2: Delete known leftovers

- **Action**: Delete `_c1-restart-hole.probe.test.ts`. Remove `INSPECT_PLACEHOLDER_COPY` and update `inspect-entry.test.tsx`. Remove `PipelineOrchestrator` class + export. Remove `buildRunsHref` re-export from `runs-pagination.tsx`. Do not touch `newsletters.yaml`.
- **Expected result**: Known leftovers gone; Inspect/pipeline suites adjusted.
- **Verify**: `test -f shared/src/newsletters/__tests__/_c1-restart-hole.probe.test.ts` fails; `rg -n "INSPECT_PLACEHOLDER_COPY|PipelineOrchestrator" shared/src web/components web/src --glob '!**/node_modules/**'` shows no production hits; `pnpm exec vitest run web/src/__tests__/inspect-entry.test.tsx shared/src/pipeline/__tests__/orchestrator.test.ts` passes.
- **Depends on**: none (can run parallel to Task 1).

### Task 3: Canonical datetime helpers + migrate web call sites

- **Action**: Create `web/lib/format-operator-datetime.ts`. Migrate every Spec §B production site onto it (including Prompts style unify); promote/remove any Feature 01 duplicate helper. Keep null → `"—"` in `formatScheduleNextFireAt` and Prompts empty/invalid guards. Prefer thin re-exports for `formatRunDateTime` / `formatDeliveryIssueDate` / `formatPhasePublished` if that preserves test imports. Do not change `formatPhasePublished`'s `Date` signature.
- **Expected result**: One implementation of short date/datetime in web; Prompts "Last saved" uses short+short; other sites' strings unchanged for a given locale.
- **Verify**: Task 1 datetime tests pass; then:
  1. `rg -n "dateStyle: \"short\",\\s*timeStyle: \"short\"" web/components web/lib --glob '!**/node_modules/**'` — options object appears only in `web/lib/format-operator-datetime.ts` (wrappers call the lib; no local option objects).
  2. `rg -n "dateStyle: \"short\"" web/components --glob '!**/node_modules/**'` — no production re-inline of date-only options outside allowed one-line wrappers that only call `formatOperatorDate` / `formatOperatorDateTime` (zero local `{ dateStyle: "short" }` option literals in `web/components`).
  3. `rg -n "dateStyle: \"medium\"" web/components/prompts` empty.
  4. `pnpm exec vitest run web/src/__tests__/format-operator-datetime.test.ts web/src/__tests__/feeds-responsive-list.test.tsx web/src/__tests__/runs-responsive-list.test.tsx web/src/__tests__/schedules-responsive-list.test.tsx web/src/__tests__/dashboard-widgets.test.tsx` passes.
- **Depends on**: Task 1.

### Task 4: Shared DomainListPagination + migrate six domains

- **Action**: Create `domain-list-pagination.tsx`, export from `domain-list/index.ts`, rewrite the six `*-pagination.tsx` files as thin composers. Preserve aria-labels, nouns, href builders, and threshold 20. Remove any leftover duplicate markup.
- **Expected result**: One shared pagination chrome; domain wrappers remain the public imports pages use today.
- **Verify**: Task 1 pagination tests pass; `pnpm exec vitest run web/src/__tests__/domain-list-pagination.test.tsx web/src/__tests__/feeds-health-pagination.test.tsx` passes (update test only if it asserted copy-pasted structure incorrectly); all-six compose gate:
  ```bash
  for f in \
    web/components/feeds/feeds-pagination.tsx \
    web/components/newsletters/newsletters-pagination.tsx \
    web/components/runs/runs-pagination.tsx \
    web/components/schedules/schedules-pagination.tsx \
    web/components/issues/issues-pagination.tsx \
    web/components/delivery/delivery-pagination.tsx
  do
    rg -q "DomainListPagination" "$f" || { echo "FAIL: $f missing DomainListPagination"; exit 1; }
  done
  ```
  (If Feature 01 already shipped an equivalently named shared shell, substitute that import name in the loop and note it in the handoff.)
- **Depends on**: Task 1.

### Task 5: One-shot knip triage

- **Action**: Run `pnpm dlx knip --include exports` (add files category only if helpful). Fix only clear unused exports/files in spirit of this feature. Do not delete `newsletters.yaml`, parity harness, or ambiguous public APIs. Do not add permanent knip CI/scripts; avoid leaving knip in package.json/lockfile unless dlx forced a transient install — prefer no permanent dep.
- **Expected result**: Extra clear dead exports removed; knip not a ship gate.
- **Verify**: Handoff lists knip command + what was fixed vs skipped; `pnpm typecheck` and `pnpm lint` still pass after removals.
- **Depends on**: Tasks 2–4 (so knip doesn't flag symbols about to be deleted/moved anyway).

### Task 6: Full quality gate

- **Action**: Run monorepo typecheck, lint, and tests; fix any breakage from the sweep without expanding scope into deferred items.
- **Expected result**: Green gates; acceptance criteria met.
- **Verify**: `pnpm typecheck` && `pnpm lint` && `pnpm test` all succeed (ignore benign eslint `pages/` warning per AGENTS.md).
- **Depends on**: Tasks 2–5.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test`
- Expected: All three succeed. Additionally:
  - Probe test file absent.
  - `rg -n "INSPECT_PLACEHOLDER_COPY|class PipelineOrchestrator" web shared --glob '!**/node_modules/**'` empty for those symbols.
  - `web/lib/format-operator-datetime.ts` exists and is imported by migrated sites / wrappers.
  - `rg -n "dateStyle: \"medium\"" web/components/prompts` empty.
  - All-six pagination compose gate (same `for` loop as Task 4 Verify) succeeds.
  - `newsletters.yaml` still exists at repo root.
  - No new permanent knip script in root `package.json`.

## Handoff

Builder reports: files created/deleted/modified; whether Feature 01 datetime helper was promoted vs created fresh; knip command + fixed vs deferred findings; note the intentional Prompts datetime style unify (`medium`→`short`); confirmation that all other operator-visible behavior was unchanged; any deviations (e.g. Feature 01 already shipped pagination) and why.
