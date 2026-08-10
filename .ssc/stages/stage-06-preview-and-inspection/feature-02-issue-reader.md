# Feature 02: Issue reader

## Intent

Let the operator open a completed draft and read it as well-rendered markdown — the everyday in-app consumption surface that replaces the Obsidian/Nextcloud path.

## Spec

Replace Feature 01’s placeholder at `/issues/[runId]` with a content-first issue reader. Load the run’s draft checkpoint markdown and render the full common Markdown set (GFM) so the operator sees headings, lists, links, and other everyday constructs as formatted content — not raw source. Desktop and phone are both first-class. No TOC, no Inspect entry, no draft editing, no display-title-from-heading (Feature 03).

### Eligibility

Same rule as Feature 01 — a run is an issue when **both** are true:

1. `status === "completed"`
2. `checkpointDraftId` is a non-empty string (`trim() !== ""`)

If `getRun` fails with not-found, or the run exists but is not eligible → **not-an-issue** UI (below). Do not attempt draft download for ineligible runs.

### Data loading

On the server page for `/issues/[runId]`:

1. `getRun(getServerAppwrite(), runId)`.
2. If missing / not eligible → not-an-issue state; stop.
3. `loadPhaseCheckpoint(client, runId, "draft")` → expect `DraftCheckpointPayload`.
4. Use `payload.markdown` as the body string. (Completed issues always have a non-empty draft under normal ops; still handle load failures per Error states.)
5. Do **not** invent a new Issues collection or Storage path — completed-run draft checkpoints remain the source of truth.

Prefer a small shared (or web) helper so eligibility + draft load stay testable without duplicating Feature 01’s rule, e.g.:

```ts
isEligibleIssue(run: Run): boolean
// status === "completed" && checkpointDraftId.trim() !== ""

loadIssueDraft(client: Client, runId: string): Promise<{ run: Run; markdown: string }>
// getRun → eligibility check → loadPhaseCheckpoint("draft") → markdown
// throws / returns typed error for not_found | not_eligible | checkpoint_missing | appwrite
```

Exact home: prefer `shared/src/runs/issues.ts` alongside Feature 01’s `listIssues` / `formatIssueFallbackTitle`, exported from the runs barrel. If Feature 01 placed helpers elsewhere, extend that same module — one Issues home.

### Page chrome (locked)

Above the rendered body, in order:

1. **Back to Issues** — `Link` to `/issues` (label locked).
2. Quiet meta line: **`{newsletterName} · {date}`** where date is locale short date from `endedAt ?? startedAt` (`dateStyle: "short"` only — same basis as Feature 01 list).
3. **Display title** — Feature 01 fallback only: `formatIssueFallbackTitle(newsletterName, endedAt ?? startedAt)`. Feature 03 will upgrade this later; do not extract the first markdown heading in this feature.
4. Then the rendered markdown body.

No action bar. No Inspect link (Feature 04). No raw-markdown toggle. No prev/next issue navigation. No TOC / in-page heading jump nav.

Layout: chrome + body share one centered column. Body uses Tailwind Typography’s default **`prose` measure (`65ch`)** — do **not** override with a custom max-width. On phone, the column is full width of the main pane with normal page padding (already from protected layout). Center with `mx-auto` / equivalent so large monitors keep a readable column.

### Markdown rendering (locked)

Add to the `web` workspace:

| Package | Role |
|---------|------|
| `react-markdown` | Safe Markdown → React elements (no raw HTML execution by default) |
| `remark-gfm` | GFM: tables, strikethrough, task lists, autolinks |
| `@tailwindcss/typography` | `prose` / `dark:prose-invert` readable defaults |

Wire `@plugin "@tailwindcss/typography";` in `web/app/globals.css` (Tailwind v4).

**Reader body component** (suggested: `web/components/issues/issue-markdown.tsx`):

- Client or server-safe as required by `react-markdown` version — if the package needs client hooks, mark `"use client"` and pass `markdown` as a prop from the server page.
- `remarkPlugins={[remarkGfm]}`.
- Custom `components.a`: every anchor opens in a **new tab** with `target="_blank"` and `rel="noopener noreferrer"`. Apply to markdown links and GFM autolinks alike.
- Wrap output in an element with classes at least: `prose dark:prose-invert` (and `w-full` as needed). Rely on Typography’s default max-width (`65ch`); do not add `max-w-[75ch]` or similar.
- High contrast: use theme-aware prose (`dark:prose-invert`) so body text tracks `--foreground` / invert in dark mode — no low-contrast muted body for the article itself. Meta line above may stay `text-muted-foreground`.
- Images (if present in draft): render with `prose` defaults; constrain with `prose-img:max-w-full` (or equivalent) so phone layouts don’t overflow horizontally.
- No syntax-highlighter dependency required in V1 — fenced code blocks render as styled `<pre><code>` via prose.

**Must render correctly (acceptance focus):** headings (`#`–`######`, especially `##` used by the drafter), unordered/ordered lists, links (including bare URLs via GFM). Also render the rest of the common GFM set: emphasis, blockquotes, fenced code, tables, strikethrough, task lists, images when present.

### Error states (locked copy)

| Condition | UI |
|-----------|-----|
| Run missing, or present but not eligible | Heading or title area optional; body: locked message **`This isn’t an available issue.`** plus **Back to Issues** link to `/issues`. Do not show partial run ops fields. |
| Eligible run but draft load fails (`checkpoint_missing`, corrupt JSON, Appwrite error) | Keep Back + meta + fallback title when run metadata is available; show destructive `Alert` with locked message **`Couldn’t load this issue.`** No raw markdown dump. Log server-side without secrets (sanitize like Runs). |

### Out of scope

- TOC / heading navigation.
- Inspect entry (Feature 04).
- First-heading display title (Feature 03).
- Draft editing, pin/drop, delivery actions.
- New Appwrite collection or schema.
- Changing Issues list behavior beyond Open already linking here.
- Changing Runs page.

### Suggested file layout

- `shared/src/runs/issues.ts` — extend with `isEligibleIssue` / `loadIssueDraft` (or equivalent names)
- `shared/src/runs/__tests__/issues.test.ts` — extend coverage
- `web/app/(protected)/issues/[runId]/page.tsx` — real reader (replace placeholder)
- `web/components/issues/issue-reader.tsx` — chrome + error wiring (optional extract)
- `web/components/issues/issue-markdown.tsx` — react-markdown + GFM + link override
- `web/app/globals.css` — `@plugin "@tailwindcss/typography"`
- `web/package.json` — add the three dependencies
- Test: `web/src/__tests__/issue-markdown.test.tsx` (and/or `issue-reader.test.tsx`)

## Dependencies

- Builds on: **feature-01-issues-list** — `/issues` list, Open → `/issues/[runId]`, `formatIssueFallbackTitle`, placeholder route to replace, eligibility definition.
- Builds on: Stage 04 run repository — `getRun`, `loadPhaseCheckpoint`, `DraftCheckpointPayload.markdown`.
- Builds on: Stage 02 GUI shell — protected layout, theme (light/dark).
- Consumed later by: **feature-03-display-title** (upgrade title), **feature-04-inspect-entry** (optional Inspect link from reader).

## Constraints

- **No new Issues collection** — draft Storage checkpoints only.
- **Do not** extract heading-based titles (Feature 03).
- **Do not** add Inspect, TOC, edit, or delivery affordances.
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- **Measure:** Typography default `65ch` — do not widen.
- **Links:** always new tab + `noopener noreferrer`.
- Responsive: readable on desktop and smartphone; no horizontal overflow from images/tables (tables may scroll inside the column if needed — prefer `overflow-x-auto` wrapper on tables via custom `table` component or prose overflow utilities).

## Acceptance criteria

- [ ] Opening an eligible issue at `/issues/[runId]` shows Back to Issues, newsletter · date meta, fallback display title, and rendered draft body.
- [ ] Draft markdown is loaded via `loadPhaseCheckpoint(..., "draft")` (or the shared `loadIssueDraft` helper); no separate Issues store.
- [ ] Headings, lists, and links render as HTML (not raw markdown); GFM common set is enabled via `remark-gfm`.
- [ ] All links open in a new tab with `rel="noopener noreferrer"`.
- [ ] Reader column uses Typography `prose` default max-width (`65ch`); layout works on phone without horizontal page overflow.
- [ ] Missing / ineligible runs show locked not-an-issue copy + Back link; draft load failures show locked “Couldn’t load this issue.” alert.
- [ ] No TOC, Inspect, edit, or heading-based title in this feature.
- [ ] Automated tests cover eligibility/load helper and markdown link/heading/list rendering; `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/runs/issues.ts` (or Feature 01’s Issues module) — `isEligibleIssue` / `loadIssueDraft`
- Modify: `shared/src/runs/__tests__/issues.test.ts`
- Modify: `shared/src/runs/index.ts` (and `shared/src/index.ts` if needed) — exports
- Modify: `web/package.json` — `react-markdown`, `remark-gfm`, `@tailwindcss/typography`
- Modify: `web/app/globals.css` — typography plugin
- Modify: `web/app/(protected)/issues/[runId]/page.tsx` — replace placeholder
- Create: `web/components/issues/issue-markdown.tsx`
- Create: `web/components/issues/issue-reader.tsx` (optional if page stays thin)
- Test: `web/src/__tests__/issue-markdown.test.tsx`

## Testing approach

Test-first for shared load/eligibility helpers. Component tests for markdown rendering behavior (Intent: readable rendered content, new-tab links). GUI build gate; optional PM manual read of a real completed draft on desktop + phone width.

1. **isEligibleIssue:** completed + non-empty draft id → true; empty draft id / pending / running / failed → false.
2. **loadIssueDraft:** happy path returns `{ run, markdown }` from draft checkpoint; not-found / not-eligible do not download; checkpoint_missing / appwrite surface distinct failure the page can map to the load-error Alert.
3. **issue-markdown:** given markdown with `## Heading`, a bullet list, and a `[text](url)` link — renders an `h2`, a `li`, and an `a` with `target="_blank"` and `rel` containing `noopener`.
4. **issue-markdown GFM smoke:** a bare URL or table row renders as a link / table structure (not leftover pipe characters as the only representation).
5. **Page / reader (build + light test):** not-an-issue copy present for ineligible fixture; load-error path renders locked alert string when draft load fails (mock).

## Tasks

### Task 1: Eligibility + draft load helper + tests

- **Action:** Extend Feature 01’s Issues module (`shared/src/runs/issues.ts` or equivalent) with `isEligibleIssue` and `loadIssueDraft` (names may vary if clearer, but behavior locked). Add failing tests in `shared/src/runs/__tests__/issues.test.ts`, then implement. Export from the runs barrel / shared index.
- **Expected result:** Callers can decide eligibility and load draft markdown without duplicating checkpoint logic; errors are distinguishable for the page.
- **Verify:** New/extended shared tests pass under `pnpm --filter @newsletter/shared test`.
- **Depends on:** Feature 01 Issues module existing (or create the module if executing Feature 01+02 in order — Feature 01 owns `listIssues` / `formatIssueFallbackTitle` first).

### Task 2: Markdown dependencies + `IssueMarkdown` component + tests

- **Action:** Add `react-markdown`, `remark-gfm`, and `@tailwindcss/typography` to `web`. Enable the typography plugin in `web/app/globals.css`. Create `web/components/issues/issue-markdown.tsx` with GFM, new-tab links, `prose dark:prose-invert` (default 65ch). Add `web/src/__tests__/issue-markdown.test.tsx` for headings, lists, links (and a GFM smoke case).
- **Expected result:** A reusable renderer that turns draft markdown into readable HTML with correct link behavior.
- **Verify:** New web/component tests pass; `pnpm --filter web build` and `pnpm typecheck` succeed.
- **Depends on:** none (can parallelize with Task 1 conceptually; execute after Task 1 in the loop for simpler sequencing).

### Task 3: Reader page — chrome, body, error states

- **Action:** Replace `web/app/(protected)/issues/[runId]/page.tsx` placeholder. Load via helper from Task 1; render Back / meta / fallback title / `IssueMarkdown`. Implement not-an-issue and load-failure UIs with locked copy. Optional `issue-reader.tsx` extract. Ensure tables/images don’t blow out phone width.
- **Expected result:** Open from Issues list lands on a readable issue; bad ids fail safely.
- **Verify:** Build/typecheck green; optional reader test for error copy; spot-check Open from list still hits this route.
- **Depends on:** Tasks 1–2.

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no TOC/Inspect/heading-title creep; measure remains Typography default; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 1–3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: open a real completed draft on desktop and a phone-width viewport — headings/lists/links look correct; links open in a new tab; column stays ~65ch on a wide monitor; Back returns to Issues.

## Handoff

Builder reports: files created/modified; packages added; confirmation that reader uses draft checkpoint markdown only; chrome matches Spec; Typography default measure (no custom widen); new-tab links; Feature 01 placeholder removed; any deviations and why.

**Research note:** Grill with PM (2026-07-14): content-first reader; GFM full common set; no TOC in V1; chrome = Back + newsletter·date + fallback title; links always new tab; measure pinned to Typography default **65ch** after reviewing Oregon State line-length guidance (50–75 band, sweet spot ~66) and `@tailwindcss/typography` docs (default max-width 65ch). Stack: Context7 `/remarkjs/react-markdown` + `remark-gfm`; `/tailwindlabs/tailwindcss-typography` v4 `@plugin`. Codebase: `DraftCheckpointPayload.markdown`, `loadPhaseCheckpoint`, Feature 01 route/eligibility handoff. Stage 06 open question “Markdown renderer choice” pinned here.
