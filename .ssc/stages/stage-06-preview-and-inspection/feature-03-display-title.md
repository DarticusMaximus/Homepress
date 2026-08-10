# Feature 03: Display title

## Intent

Show each issue under a human title taken from the draft’s first markdown heading when present, otherwise `{newsletter} — {date}`, so the Issues list and reader name issues the way the draft does — without an LLM title step.

## Spec

Upgrade Feature 01/02’s fallback-only titles. Completed-run draft markdown remains the source of truth. No new Issues collection, no LLM title generation, no draft editing.

### Pure helpers (shared)

Extend the Issues module from Features 01–02 (`shared/src/runs/issues.ts` or equivalent — one Issues home):

```ts
extractFirstMarkdownHeading(markdown: string): string | null

resolveIssueDisplayTitle(opts: {
  markdown: string | null | undefined;
  newsletterName: string;
  dateIso: string;
}): string
// → extractFirstMarkdownHeading(markdown) when non-null/non-empty after rules below;
//   else formatIssueFallbackTitle(newsletterName, dateIso)
```

Keep `formatIssueFallbackTitle` exported and unchanged — it remains the fallback.

### Heading extraction rules (locked)

Implement a small line-oriented scanner (no new markdown-parser dependency in `shared`):

1. Normalize newlines (`\r\n` / `\r` → `\n`).
2. Walk lines top-to-bottom. Skip content inside fenced code blocks (` ``` ` open/close, including `~~~` fences if trivial to support — ATX inside fences must not count).
3. **ATX** (primary — drafter prompt uses `##` headers): first line matching  
   `/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/`  
   → capture group 1, then trim. Levels `#`–`######` all qualify; first wins.
4. **Setext** (secondary): a non-blank content line followed immediately by a line that is only `=` or `-` underline (`/^=+[ \t]*$/` or `/^-+[ \t]*$/`) → use the content line (trimmed). Only consider outside fences. ATX checked per line before setext on that pair.
5. **Inline cleanup** on the captured title text (order locked):
   - Links: `[label](url)` → `label`; bare reference-style not required in V1
   - Bold/italic markers: strip surrounding `**`, `__`, `*`, `_` pairs when they wrap the whole segment or simple inner spans — minimum bar: remove `**` / `__` and unpaired leftover emphasis markers that wrap the title
   - Inline code: `` `code` `` → `code`
   - Trim; collapse internal whitespace runs to a single space
6. If the result is empty → treat as **no heading** (`null`).
7. Headings that are only punctuation/whitespace after cleanup → `null`.

Do **not** invent a title from the first paragraph. Do **not** call an LLM.

### Reader (`/issues/[runId]`)

Where Feature 02 shows the display title via `formatIssueFallbackTitle(...)`, switch to:

`resolveIssueDisplayTitle({ markdown, newsletterName, dateIso: endedAt ?? startedAt })`

with the same `markdown` already loaded for the body. Meta line (`{newsletterName} · {date}`) is unchanged.

**Chrome + body duplication is intentional:** the page title/chrome uses the resolved display title; the markdown body still renders the heading in place. Do **not** strip the first heading from the body in this feature.

Load-error / not-an-issue paths: if markdown is unavailable, use fallback title when run metadata exists (same as Feature 02 chrome on load failure); not-an-issue path stays as Feature 02 (no title requirement).

### Issues list (`/issues`)

Feature 01 forbade draft Storage downloads on the list. This feature **intentionally** loads draft checkpoints for the **current page only** (after pagination, ≤ 20 rows) so list titles match the reader without a new Run attribute or Issues collection.

Wire order (locked):

1. `listIssues` as today (eligibility + sort; still no titles).
2. Paginate to the current page (20/page — Feature 01).
3. For **that page’s runs only**, load each draft via existing `loadPhaseCheckpoint(client, runId, "draft")` or `loadIssueDraft` / a thin batch helper — prefer `Promise.all` so loads are concurrent.
4. Per run: `resolveIssueDisplayTitle({ markdown, newsletterName, dateIso: endedAt ?? startedAt })`.
5. If an individual draft load fails: that row uses `formatIssueFallbackTitle` only; do **not** fail the whole page. Log server-side without secrets (sanitize like Runs).

Suggested helper (name flexible, behavior locked):

```ts
async function resolveIssueDisplayTitlesForRuns(
  client: Client,
  runs: Run[],
): Promise<Map<string, string>> // runId → display title
```

List Title column/card field uses the map (fallback if missing). Truncation / `title` attribute rules from Feature 01 still apply (full resolved title in `title` when truncated).

Do **not** download drafts for off-page runs. Do **not** add a `displayTitle` schema attribute in this feature (page-scoped load is the pinned V1 approach).

### Out of scope

- LLM-generated titles.
- Persisting `displayTitle` on the Run document / schema changes.
- Stripping or rewriting draft body headings.
- Inspect, edit, delivery.
- Changing eligibility, nav, pagination size, or markdown renderer stack.
- Backfilling titles for runs whose draft files are missing (fallback only).

## Dependencies

- Builds on: **feature-01-issues-list** — `listIssues`, `formatIssueFallbackTitle`, Issues list UI, pagination 20/page.
- Builds on: **feature-02-issue-reader** — reader chrome title slot, draft markdown already loaded, `loadIssueDraft` / eligibility helpers.
- Builds on: Stage 04 — `loadPhaseCheckpoint` / `DraftCheckpointPayload.markdown`.

## Constraints

- **No LLM** title generation.
- **No new Issues collection**; no new Run schema attributes in this feature.
- **Draft markdown is source of truth** for heading-based titles.
- List draft loads: **current page only** (≤ 20); per-row load failure → fallback, page still renders.
- **Do not** strip the first heading from rendered body markdown.
- **Server-only** Appwrite via `getServerAppwrite()`.
- **Secrets:** never log API keys; sanitize Appwrite errors like Runs.
- Keep `formatIssueFallbackTitle` as the single fallback formatter (em dash `—`, short locale date).

## Acceptance criteria

- [ ] `extractFirstMarkdownHeading` returns the first ATX/setext heading text per Spec rules; ignores headings inside fenced code; returns `null` when none / empty after cleanup.
- [ ] `resolveIssueDisplayTitle` prefers a non-null extracted heading; otherwise equals `formatIssueFallbackTitle(...)`.
- [ ] Issue reader chrome title uses `resolveIssueDisplayTitle` with the loaded draft markdown; body still includes the heading.
- [ ] Issues list Title column/cards use heading-based titles for the current page when drafts load; newsletter filter/pagination unchanged.
- [ ] List does not load drafts for runs outside the current page; a single failed draft load does not blank the list.
- [ ] No LLM title step; no new Appwrite collection/attribute for titles.
- [ ] Automated tests cover extraction edge cases + resolve fallback; `pnpm --filter @newsletter/shared test`, `pnpm --filter web build`, `pnpm typecheck`, and `pnpm test` pass.

## Files

- Modify: `shared/src/runs/issues.ts` (or Feature 01/02 Issues module) — `extractFirstMarkdownHeading`, `resolveIssueDisplayTitle`, optional `resolveIssueDisplayTitlesForRuns`
- Modify: `shared/src/runs/__tests__/issues.test.ts` — extraction + resolve (+ batch helper if present)
- Modify: `shared/src/runs/index.ts` (and `shared/src/index.ts` if needed) — exports
- Modify: `web/app/(protected)/issues/page.tsx` and/or `web/components/issues/issues-view.tsx` / `issues-table.tsx` — page-scoped title enrichment
- Modify: `web/app/(protected)/issues/[runId]/page.tsx` and/or `web/components/issues/issue-reader.tsx` — chrome title via `resolveIssueDisplayTitle`
- Test: extend `web/src/__tests__/issue-reader.test.tsx` or add a focused display-title test if reader chrome is unit-tested; shared tests are the primary gate

## Testing approach

Test-first for pure extraction/resolve helpers. List/reader wiring verified via build + light component/page tests where practical; optional PM spot-check with a real draft that starts with `## …`.

1. **ATX first heading:** `# Hello` / `## Hello` / `### Hello` → `"Hello"`; later headings ignored.
2. **Closing hashes:** `## Hello ##` → `"Hello"`.
3. **Leading blanks:** blank lines then `## Title` → `"Title"`.
4. **Fence skip:** opening ` ``` ` … `## Not a title` … closing fence, then `## Real` → `"Real"`.
5. **Setext:** `Title\n===` → `"Title"` when no earlier ATX.
6. **Inline cleanup:** `## **Bold** title` / `## [Label](https://x.test)` → cleaned plain text.
7. **Empty / no heading:** `""`, paragraph-only markdown, heading with empty text → `null` / resolve → fallback.
8. **resolveIssueDisplayTitle:** with heading markdown → heading; with `null`/undefined/no-heading markdown → `formatIssueFallbackTitle` result (structure assert like Feature 01).
9. **List enrichment (if helper tested):** given mocked load success/failure map, success ids get heading titles and failed ids get fallback; helper does not throw on one failure.
10. **Reader (optional):** chrome text uses heading when markdown has `## …`.

## Tasks

### Task 1: Extraction + resolve helpers + tests

- **Action:** Add failing tests in `shared/src/runs/__tests__/issues.test.ts` for the cases above; implement `extractFirstMarkdownHeading` and `resolveIssueDisplayTitle` in the Issues module; export from the runs barrel / shared index. Keep `formatIssueFallbackTitle` as fallback.
- **Expected result:** Pure, deterministic title resolution with no Appwrite calls.
- **Verify:** New shared tests pass under `pnpm --filter @newsletter/shared test`.
- **Depends on:** none (requires Feature 01’s `formatIssueFallbackTitle` to exist when executed in order).

### Task 2: Reader chrome uses resolved title

- **Action:** Update the issue reader page/chrome to call `resolveIssueDisplayTitle` with loaded markdown + newsletter name + `endedAt ?? startedAt`. Leave body markdown unstripped. Keep Feature 02 error-path behavior (fallback when markdown missing but run meta exists).
- **Expected result:** Opening an issue whose draft starts with a heading shows that heading as the display title above the body.
- **Verify:** `pnpm --filter web build` and `pnpm typecheck` succeed; optional reader test asserts chrome title string for a fixture markdown.
- **Depends on:** Task 1 (and Feature 02 reader existing).

### Task 3: Issues list — page-scoped draft title enrichment

- **Action:** After pagination on `/issues`, resolve titles for the current page’s runs via concurrent draft loads + `resolveIssueDisplayTitle` (helper optional but preferred). Wire Title column/cards to the resolved strings. Per-row load failure → fallback; do not fail the page. Do not load off-page drafts.
- **Expected result:** List titles match reader titles for the same issue when the draft has a first heading; page stays usable if one checkpoint is missing.
- **Verify:** Build/typecheck green; shared batch-helper tests if implemented; spot-check that enrichment runs only on the sliced page array.
- **Depends on:** Task 1 (and Feature 01 list existing).

### Task 4: Feature verification pass

- **Action:** Re-read Spec vs implementation; confirm no schema attribute, no LLM, no body stripping, page-only loads; run full gates; fix gaps.
- **Expected result:** Acceptance criteria satisfied within scope.
- **Verify:** `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test` exit 0.
- **Depends on:** Tasks 1–3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter web build && pnpm typecheck && pnpm test`
- Expected: all green. Optional PM: open Issues — a completed draft that starts with `## Some Story` lists and reads as **Some Story**; a draft with no heading still shows `{newsletter} — {date}`; body still shows the heading in the rendered markdown.

## Handoff

Builder reports: files changed; confirmation that titles come from first-heading extraction + Feature 01 fallback; list uses page-scoped draft loads only (no new Run attribute); reader chrome upgraded without stripping body headings; any deviations and why.

**Research note:** Codegraph — `DRAFTER_PROMPT_TEMPLATE` requires `##` headers and “Start with Featured News Item”; `DraftCheckpointPayload.markdown`; Feature 01 constraint deferred N+1 to this feature; Feature 02 chrome title slot; `Run` has no title field (18 attrs). Stage 06 pins: no LLM title; heading or `{newsletter} — {date}`. Auto decision: **page-scoped Storage loads after pagination** over a denormalized `displayTitle` attribute — keeps drafts as source of truth, avoids schema/provisioner churn in Stage 06, caps at 20 downloads/page. Extraction: line scanner + ATX/setext (CommonMark-shaped), not a full mdast dependency in `shared`.
