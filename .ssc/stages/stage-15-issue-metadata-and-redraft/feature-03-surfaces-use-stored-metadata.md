# Feature 03: Surfaces use stored metadata

## Intent

Home, channels, factory lists, issue chrome, email subject, and RSS item title label an issue from stored `issueTitle` / `issueDek` when present, so readers see the digest name (not the lead-story heading) without re-parsing the draft — and older issues still fall back to first-heading / first-paragraph / newsletter-and-date.

## Spec

Prefer Feature 01’s stored fields independently. `storedIssueTitle(run)` / `storedIssueDek(run)` non-null wins. Null → existing extract (`extractFirstMarkdownHeading` / `extractIssueDek`), then `formatIssueFallbackTitle` for title. Do **not** re-slice stored dek at `ISSUE_DEK_MAX_CHARS` (160); that clamp stays extract-fallback only. Cards already `line-clamp-2`.

Skip the draft checkpoint load when every field that helper needs is already stored: both title and dek for `resolveIssueCardMetaForRuns`; title only for `resolveIssueDisplayTitlesForRuns`. If either needed field is missing, load once and fill only the missing side from markdown. Checkpoint load failure must not drop a stored title or stored dek already in hand: keep each stored side; missing title → `formatIssueFallbackTitle`; missing dek → `null`.

Issue chrome `<h1>` uses stored title when present. **Leave the draft body as written** (including the drafter’s first heading). Do not hide or strip that heading in markdown, email HTML, RSS `htmlBody`, downloads, or Listen.

Listen still speaks `toSpeakableText(markdown)` only — no stored title/dek prepend.

Email subject and RSS item title use the same display-title helper at **send / publish** time. Already-sent mail is not rewritten. Already-published RSS snapshots update only on the next publish of that issue (`upsertRssPublication` already overwrites). Dek is not added to subject or RSS `<title>`.

### Grill-pinned decisions

| Topic | Pin |
|---|---|
| Duplicate heading | Leave both. Chrome = issue label; body = draft as written. |
| Listen | Draft body only. Do not prepend stored title or dek. |
| Mail / RSS | Next Send / next Publish. No historical RSS rewrite job. Dek off subject and RSS title. |
| Consume | Stored independently; skip checkpoint when needed stored fields are present. |
| Load-error chrome | Still show stored title if present (markdown omitted); else newsletter-and-date. |
| Out of this feature | Runs list (newsletter name), Inspect, download filenames, sticky header (`Issue`), unused Admin `RecentIssues` widget, regenerate-draft (Feature 04), persist/LLM (Features 01–02). |

### Helper contract (pinned)

Extend `resolveIssueDisplayTitle` in `shared/src/runs/issues.ts`:

```ts
export function resolveIssueDisplayTitle(opts: {
  markdown: string | null | undefined;
  newsletterName: string;
  dateIso: string;
  /** Raw `Run.issueTitle`. Presence via `storedIssueTitle`. */
  issueTitle?: string;
}): string
```

1. `storedIssueTitle({ issueTitle: opts.issueTitle ?? "" })` non-null → return that string.
2. Else existing extract-from-markdown / `formatIssueFallbackTitle`.

Do **not** change `extractFirstMarkdownHeading` or `extractIssueDek` public behavior.

**`resolveIssueDisplayTitlesForRuns`:** per run, if `storedIssueTitle(run)` is non-null, map that title and **do not** call `loadPhaseCheckpoint`. Else load draft and call `resolveIssueDisplayTitle` with `issueTitle: run.issueTitle` and the loaded markdown (so empty stored still extracts). Load throw → stored title if any, else `formatIssueFallbackTitle`. Existing per-row log `phase: "resolve-issue-display-title"` unchanged.

**`resolveIssueCardMetaForRuns`:** per run, if **both** `storedIssueTitle` and `storedIssueDek` are non-null, return `{ title, dek }` and **do not** load. Else load once. `title = resolveIssueDisplayTitle({ markdown, newsletterName, dateIso, issueTitle: run.issueTitle })`. `dek = storedIssueDek(run) ?? extractIssueDek(markdown)` (`null` when extract misses). Load throw → `{ title: storedTitle ?? fallback, dek: storedDek }` (`storedDek` may be `null`). Existing per-row log `phase: "resolve-issue-card-meta"` unchanged.

### Call sites (pinned)

| Surface | Change |
|---|---|
| Home `/` and channel `/newsletters/[id]` | Already call `resolveIssueCardMetaForRuns` — helper change is the wiring. |
| `/admin/issues` and `/admin/delivery` | Already call `resolveIssueDisplayTitlesForRuns` — helper change is the wiring. Title only; do not add dek. |
| `IssueChrome` in `web/components/issues/issue-reader.tsx` | Add `issueTitle` to `IssueRunChrome`. Pass `issueTitle: run.issueTitle` into `resolveIssueDisplayTitle`. On `loadError`, still pass `run.issueTitle`; omit markdown as today. Body: `IssueMarkdown` + `IssueListenBar` still get raw markdown. |
| `sendIssueEmail` | Pass `issueTitle: run.issueTitle` (keep `newsletterName: run.newsletterName`, `dateIso: run.endedAt ?? run.startedAt`). Body HTML/text unchanged. |
| `publishIssueToRss` | Pass `issueTitle: run.issueTitle` (keep `newsletterName: newsletter.name`, `dateIso: run.endedAt`). `htmlBody` still from draft markdown. |

## Dependencies

- Builds on: **feature-01-persist-title-and-dek** (`issueTitle` / `issueDek`, `storedIssueTitle` / `storedIssueDek`) and **feature-02-cheap-model-title-dek** (LLM overlay onto those fields). Features 01 and 02 must be executed first. Surfaces still work if 02’s pass failed — Feature 01 extract is stored.

## Constraints

- Do not hide, strip, or rewrite the draft’s first heading for display, email, RSS body, export, or Listen.
- Do not prepend stored title/dek to Listen TTS.
- Do not rewrite already-sent email or already-published RSS except on the next explicit publish of that issue.
- Do not add dek to factory lists, email subject, or RSS item title.
- Do not change `ISSUE_DEK_MAX_CHARS` or re-ellipsis stored dek at 160.
- Do not touch persist, title/dek LLM, Prompts, or regenerate-draft.
- Do not backfill historical runs.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] Home and newsletter channel cards show stored title and dek when both are present, without loading the draft checkpoint.
- [ ] Factory issue lists (`/admin/issues`, `/admin/delivery`) show stored title when present, without loading the draft checkpoint.
- [ ] Issue chrome `<h1>` uses stored title when present; the markdown body still includes the drafter’s first heading.
- [ ] Email subject and RSS item title use stored title when present, at send/publish time.
- [ ] Missing stored fields fall back to first-heading title, first-paragraph dek, or newsletter-and-date; older runs still display.
- [ ] Title-pass / empty stored does not fail any surface; checkpoint load failure keeps stored fields if present.
- [ ] Listen still speaks the draft body only.

## Files

- Modify: `shared/src/runs/issues.ts` — `resolveIssueDisplayTitle`, `resolveIssueDisplayTitlesForRuns`, `resolveIssueCardMetaForRuns`
- Modify: `shared/src/runs/__tests__/issues.test.ts`
- Modify: `web/components/issues/issue-reader.tsx` — `IssueRunChrome` + chrome call
- Modify: `web/src/__tests__/issue-reader.test.tsx`
- Modify: `web/src/__tests__/issue-reader-chrome.test.tsx`
- Modify: `shared/src/delivery/send-issue-email.ts`
- Modify: `shared/src/delivery/__tests__/send-issue-email.test.ts`
- Modify: `shared/src/delivery/publish-issue-to-rss.ts`
- Modify: `shared/src/delivery/__tests__/publish-issue-to-rss.test.ts`
- Modify: `web/src/__tests__/home-inbox.test.tsx` (source-read still names the card helper)
- Modify: `web/src/__tests__/channel-page.test.tsx` (same)
- Modify: `web/src/__tests__/issues-responsive-list.test.tsx` — source-read `/admin/issues` page still calls `resolveIssueDisplayTitlesForRuns`
- Modify: `web/src/__tests__/delivery-page.test.tsx` — source-read `/admin/delivery` page still calls `resolveIssueDisplayTitlesForRuns`
- Modify: `web/src/__tests__/issue-listen-bar.test.tsx` — source-read `IssueListenBar` props remain `markdown` only

## Testing approach

Test-first. Unit tests only; no live Appwrite; no screenshots. Tests verify **stored fields win on the named surfaces**, not LLM copy.

Existing extract-path tests (empty `issueTitle` / `issueDek` from Feature 01 `makeRun` defaults) must still pass and must still load checkpoints.

### Test cases

**`resolveIssueDisplayTitle` (`issues.test.ts`)**

1. `issueTitle: "Digest Name"` + markdown `# Lead Story\n\nBody` → `"Digest Name"` (not the heading).
2. Omit `issueTitle` / `""` / whitespace / punctuation-only → existing heading extract (current `"Draft Title"` case still holds).
3. Stored missing and no heading → `formatIssueFallbackTitle`.

**`resolveIssueDisplayTitlesForRuns`**

4. Run with `issueTitle: "Stored List Title"` → map that string; `loadPhaseCheckpoint` **not** called for that run.
5. Sibling with empty stored + heading markdown → extracted heading; that sibling **does** load.
6. Existing load-failure sibling case still falls back per row; a stored-title run whose load would throw is **not** loaded and still returns the stored title.

**`resolveIssueCardMetaForRuns`**

7. Both stored (`issueTitle` + `issueDek` non-empty) → those strings; **no** checkpoint load. Stored dek longer than 160 is returned as-is (no `…` clamp).
8. Stored title only (`issueDek: ""`) → loads once; title stays stored; dek from `extractIssueDek` (or `null`).
9. Stored dek only (`issueTitle: ""`) → loads once; title from heading/fallback; dek is stored.
10. Both empty → existing heading + paragraph extract; one load per run (current test still holds).
11. Load throw with stored title and empty dek → `{ title: stored, dek: null }` (not newsletter-and-date).
12. Load throw with stored dek only (`issueTitle: ""`, non-empty `issueDek`) → `{ title: formatIssueFallbackTitle(...), dek: stored }` (not `dek: null`).

**Issue chrome**

13. `issueTitle: "Digest Name"`, markdown `## Hello\n\nBody text.` → `<h1>` is Digest Name; body still has heading Hello and Body text. Listen bar still mounted with that markdown (existing listen cases unchanged).
14. Empty stored + same markdown → `<h1>` Hello and body Hello (today’s duplicate; keep the existing success test).
15. `loadError` + `issueTitle: "Stored"` → `<h1>` Stored (not newsletter-and-date).
16. `loadError` + empty stored → existing `formatIssueFallbackTitle` heading.

**Email / RSS**

17. `sendIssueEmail` calls `resolveIssueDisplayTitle` with `issueTitle: run.issueTitle` (and existing markdown / newsletterName / dateIso). Subject still the mock return in the existing success test.
18. `publishIssueToRss` same `issueTitle` passthrough; `upsertRssPublication` title is still the helper return; `htmlBody` still from markdown.

**List / card / Listen wiring (source-read)**

19. Home page and channel page still contain `resolveIssueCardMetaForRuns`.
20. `web/app/(protected)/admin/issues/page.tsx` and `web/app/(protected)/admin/delivery/page.tsx` still contain `resolveIssueDisplayTitlesForRuns`.
21. `IssueListenBar` component source still types props as `{ markdown: string }` only (no title/dek prop). `toSpeakableText` still strips ATX to heading text (do not prepend a stored title in `web/lib/issue-listen-text.ts`).

## Tasks

### Task 1: Display helpers prefer stored and skip loads

- **Action**: Write failing tests 1–12 in `shared/src/runs/__tests__/issues.test.ts`. Extend `resolveIssueDisplayTitle` / `resolveIssueDisplayTitlesForRuns` / `resolveIssueCardMetaForRuns` in `shared/src/runs/issues.ts` as pinned. Existing extract-path tests stay green (Feature 01 empty defaults).
- **Expected result**: Stored fields win; checkpoint loads skipped when the needed stored fields are present; mixed/old/failure paths match the contract.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/issues.test.ts`
- **Depends on**: none (code assumes Features 01–02 types/helpers already exist).

### Task 2: Issue chrome uses stored title; body unchanged

- **Action**: Write failing tests 13–16 in `web/src/__tests__/issue-reader.test.tsx` and `web/src/__tests__/issue-reader-chrome.test.tsx`. Add `issueTitle` to `IssueRunChrome` and pass it into `resolveIssueDisplayTitle` in `web/components/issues/issue-reader.tsx`. Do not change `IssueMarkdown` / `IssueListenBar` inputs.
- **Expected result**: Chrome `<h1>` follows stored → extract → fallback; draft heading remains in the body; load-error still shows stored title when present.
- **Verify**: `pnpm exec vitest run web/src/__tests__/issue-reader.test.tsx web/src/__tests__/issue-reader-chrome.test.tsx`
- **Depends on**: Task 1.

### Task 3: Email subject and RSS item title passthrough

- **Action**: Write failing tests 17–18. Pass `issueTitle: run.issueTitle` from `shared/src/delivery/send-issue-email.ts` and `shared/src/delivery/publish-issue-to-rss.ts`. Do not change body HTML/text or upsert `htmlBody`.
- **Expected result**: Send/publish resolve title with the stored field; republish still overwrites snapshot title via existing upsert.
- **Verify**: `pnpm exec vitest run shared/src/delivery/__tests__/send-issue-email.test.ts shared/src/delivery/__tests__/publish-issue-to-rss.test.ts`
- **Depends on**: Task 1.

### Task 4: List/card/Listen wiring assertions

- **Action**: Write failing tests 19–21 (extend existing source-read describes; do not invent new pages). Confirm Home/channel/admin issues/delivery still call the batch helpers. Confirm Listen bar is markdown-only and `toSpeakableText` is not prepended with stored metadata.
- **Expected result**: Surfaces stay on the shared helpers; Listen unchanged.
- **Verify**: `pnpm exec vitest run web/src/__tests__/home-inbox.test.tsx web/src/__tests__/channel-page.test.tsx web/src/__tests__/issues-responsive-list.test.tsx web/src/__tests__/delivery-page.test.tsx web/src/__tests__/issue-listen-bar.test.tsx` then `pnpm typecheck` and `pnpm lint`
- **Depends on**: Task 1.

## Feature verification

- Run: `pnpm exec vitest run shared/src/runs/__tests__/issues.test.ts web/src/__tests__/issue-reader.test.tsx web/src/__tests__/issue-reader-chrome.test.tsx shared/src/delivery/__tests__/send-issue-email.test.ts shared/src/delivery/__tests__/publish-issue-to-rss.test.ts web/src/__tests__/home-inbox.test.tsx web/src/__tests__/channel-page.test.tsx web/src/__tests__/issues-responsive-list.test.tsx web/src/__tests__/delivery-page.test.tsx web/src/__tests__/issue-listen-bar.test.tsx` then `pnpm typecheck` and `pnpm lint`
- Expected: listed tests pass; typecheck clean; lint clean (ignore leftover `pages/` warning). A run with stored title/dek labels Home/channel/factory lists/chrome/email/RSS from those fields; missing fields extract as today; draft body and Listen are unchanged.

## Handoff

Report files changed and that skip-load is in the two batch helpers (not in the pages). Confirm the first heading was **not** stripped, Listen was **not** prepended, and regenerate was **not** added. Note if email/RSS tests needed `issueTitle` on `makeRun` beyond Feature 01 defaults.

### Research notes

- Codegraph + grep: all live title resolution is `resolveIssueDisplayTitle` / the two batch helpers. Callers: Home `page.tsx`, channel `newsletters/[id]/page.tsx`, `admin/issues/page.tsx`, `admin/delivery/page.tsx`, `issue-reader.tsx` chrome, `send-issue-email.ts`, `publish-issue-to-rss.ts`. Admin hub no longer renders `RecentIssues`.
- Feature 01: `storedIssueTitle` / `storedIssueDek` treat blank/punctuation as missing. Feature 02: LLM dek may exceed 160 but is ≤ 512.
- RSS `upsertRssPublication` already updates `title` in place on republish (`shared/src/delivery/rss-publications.ts`). Email cannot rewrite a sent message.
- Grill (2026-08-20): leave both headings; Listen draft-only; mail/RSS on next send/publish; independent stored consume + skip-load.
