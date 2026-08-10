# Feature 04: Download export

## Intent

Let the operator download a completed issue as markdown and as HTML (HTML matching the email HTML body) from the Issues UI, so a finished digest can leave the app on demand without auto-export or a remote archive.

## Spec

Implement **on-demand MD + HTML download** for an eligible issue: load the completed draft, build file bodies, and serve them as browser attachments from an authenticated export route. Markdown is the draft source; HTML is the same string Feature 02’s email path uses (`draftMarkdownToEmailHtml`). This feature does **not** auto-export after runs, write to remote storage, persist delivery status (Feature 06), send email, or publish RSS — but it **does** own the shared export preparation helpers and the Issues chrome download links.

### Export formats (locked)

| Format | Query value | Body | Content-Type |
|--------|-------------|------|--------------|
| Markdown | `md` | `draftMarkdownToEmailText(markdown)` — draft markdown with `\r\n` → `\n` (same as email plain part) | `text/markdown; charset=utf-8` |
| HTML | `html` | **Exact** `draftMarkdownToEmailHtml(markdown)` — byte-for-byte equal to the email HTML body (fragment OK; **no** extra document wrapper that would diverge from email) | `text/html; charset=utf-8` |

Any other `format` (missing, empty, unknown) → **400** with stable plain-text body: `Invalid export format`.

### Filename (locked)

Pure helper `buildIssueExportFilename({ newsletterName, dateIso, format })`:

1. Slugify `newsletterName`: lowercase; replace runs of non-`[a-z0-9]` with a single `-`; trim leading/trailing `-`; if empty after slugify → `newsletter`. Cap slug length at **48** chars.
2. Date portion = UTC calendar date from `dateIso`: `YYYY-MM-DD` (use the ISO string’s date when it is already `YYYY-MM-DD…`, otherwise `new Date(dateIso)` → UTC `YYYY-MM-DD`).
3. Extension: `.md` for `md`, `.html` for `html`.
4. Result: `{slug}-{YYYY-MM-DD}.{ext}` (e.g. `tech-digest-2026-07-17.md`).

`dateIso` for filenames = `run.endedAt ?? run.startedAt` (same fallback as Issues display title date).

### Shared export preparation (locked)

```ts
prepareIssueExport(client, runId, format: "md" | "html"): Promise<IssueExportPayload>
```

`IssueExportPayload`: `{ body: string; contentType: string; filename: string }`.

Orchestration:

1. `loadIssueDraft(client, runId)` — on `IssueLoadError` → throw/map to export failure (route returns **404**). Operator-facing message for non-attachment responses: `Couldn’t load this issue for export`.
2. Empty or whitespace-only `markdown` → do not build a file; error `Issue draft is empty` (route **400**).
3. `dateIso = run.endedAt ?? run.startedAt`. Filename uses **`run.newsletterName`** from that same load result (denormalized on `Run` — same as Issues chrome). **Do not** call `getNewsletter` for the export name.
4. `filename = buildIssueExportFilename({ newsletterName: run.newsletterName, dateIso, format })`.
5. Body/contentType per format table above (reuse Feature 02 helpers — **do not** reimplement marked conversion).
6. Return payload.

No Appwrite writes. No SMTP. No RSS.

### Authenticated export route (locked)

| Item | Contract |
|------|----------|
| Path | `GET /api/issues/[runId]/export?format=md\|html` |
| Auth | **Not** public — middleware session cookie required (same as other app routes). Do **not** add to `PUBLIC_ROUTES` / `isPublicRoute`. |
| Success | **200** with body bytes = UTF-8 payload; headers: `Content-Type` as above; `Content-Disposition: attachment; filename="<filename>"` (ASCII filename from helper — no need for `filename*` unless already used elsewhere). |
| Failures | Invalid format → **400**; load failure / not eligible → **404**; empty draft → **400** with `Issue draft is empty`; unexpected → **500** with `Failed to export issue`. Response bodies for errors: `text/plain; charset=utf-8` with the locked message (no HTML chrome, no secrets). |

Implementation file: `web/app/api/issues/[runId]/export/route.ts`. Use `getServerAppwrite()` + `prepareIssueExport`. `dynamic = "force-dynamic"` (or equivalent) so responses are not statically cached.

### Manual Download UI (locked)

- Surface: issue detail **success path only** (`IssueReader` when markdown loaded — not list, not load-error / not-available).
- Controls: two links in the chrome flex row with Back / Inspect / Send / Publish (whatever Feature 02/03 already placed):
  - Visible labels (locked): `Markdown` and `HTML`
  - `aria-label` (locked): `Download Markdown` and `Download HTML`
  - `href`: `/api/issues/${runId}/export?format=md` and `...format=html`
  - Style: same quiet link class as Back / Inspect (`text-sm text-muted-foreground hover:text-foreground hover:underline`) — native navigation download via `Content-Disposition`; **no** client blob fetch required; **no** confirmation dialog; **no** toast on success (browser handles the save).
- Preferred split: `web/components/issues/issue-download-links.tsx` (server-friendly anchors) wired into `IssueChrome` / `IssueReader` success path, receiving `runId`.
- Reachable on phone widths (flex-wrap already on chrome row).

### Out of scope

- Auto-export / archive-to-elsewhere after run success.
- ZIP, PDF, or other formats.
- Public unauthenticated download URLs.
- Delivery-status badges or run-schema fields (Feature 06).
- Changing email/RSS orchestration beyond reusing body helpers.
- Draft editing.

## Dependencies

- **Hard execute prerequisite:** **feature-02-email-delivery** must be `verified` before this feature is executed (needs `draftMarkdownToEmailHtml` and `draftMarkdownToEmailText` in `shared/src/delivery/`). Feature 01 is already a hard prerequisite of Feature 02.
- Builds on: Stage 06 Issues surface (`loadIssueDraft`, `IssueReader` chrome).
- Soft: Feature 03 Publish chrome may already be present when this lands — place download links in the same chrome row without depending on RSS code.
- Soft consumers: none required; Feature 05 explicitly has **no** auto-export.

## Constraints

- Do not start `ssc-execute` for this feature until Feature 02 is verified.
- HTML download body must equal `draftMarkdownToEmailHtml` output (acceptance parity with email).
- Markdown download body must equal `draftMarkdownToEmailText` output.
- Export route must remain authenticated (middleware); never list under public routes.
- No new Appwrite collections or run delivery-status attributes.
- Server-only draft load via API-key client (`getServerAppwrite`); do not expose checkpoints to the browser beyond the export response.
- `pnpm typecheck` and `pnpm lint` must pass.
- Secrets / env dumps must not appear in logs or error bodies.

## Acceptance criteria

- [ ] Shared `prepareIssueExport` + `buildIssueExportFilename` produce MD/HTML payloads; HTML body equals `draftMarkdownToEmailHtml`; MD body equals `draftMarkdownToEmailText`; filenames use `run.newsletterName` (no `getNewsletter`).
- [ ] Unit tests cover filename slug/date/extension, **filename wiring through `prepareIssueExport` (case 4b)**, HTML/MD parity with Feature 02 helpers, empty draft / load failure (no bogus success payload), and invalid format handling at the route.
- [ ] `GET /api/issues/[runId]/export?format=md|html` returns 200 + `Content-Disposition: attachment` with the locked Content-Type; invalid format → 400; unloadable issue → 404; empty draft → 400.
- [ ] Route is **not** public (`isPublicRoute` still false for `/api/issues/...`).
- [ ] Issue detail success UI shows `Markdown` and `HTML` download links with locked aria-labels and correct hrefs; load-error / not-available paths do not.
- [ ] No auto-export, remote archive, ZIP/PDF, or delivery-status schema in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Create: `shared/src/delivery/issue-export.ts` (`buildIssueExportFilename`, `prepareIssueExport`, types)
- Modify: `shared/src/delivery/index.ts` (re-exports)
- Create: `shared/src/delivery/__tests__/issue-export.test.ts`
- Create: `web/app/api/issues/[runId]/export/route.ts`
- Create: `web/src/__tests__/issue-export-route.test.ts`
- Create: `web/components/issues/issue-download-links.tsx`
- Modify: `web/components/issues/issue-reader.tsx` (wire download links on success chrome)
- Create: `web/src/__tests__/issue-download-links.test.tsx`
- Modify as needed: `web/src/__tests__/issue-reader.test.tsx` (assert links on success / absent on error paths)
- Modify as needed: `web/src/__tests__/routes.test.ts` only if a regression case for `/api/issues/` remaining private is useful (optional; route auth covered by not adding to `PUBLIC_ROUTES`)

## Testing approach

Test-first. Mock `loadIssueDraft` / Appwrite; no live network.

### `issue-export.test.ts`

1. **Filename happy** — name `Tech Digest`, date `2026-07-17T12:00:00.000Z`, format `md` → `tech-digest-2026-07-17.md`.
2. **Filename slug edge** — punctuation/spaces collapsed; empty/symbol-only name → `newsletter-…`; length cap respected.
3. **HTML parity** — given markdown, `prepareIssueExport(..., "html").body === draftMarkdownToEmailHtml(markdown)` and contentType is `text/html; charset=utf-8`.
4. **MD parity** — body === `draftMarkdownToEmailText(markdown)`; contentType `text/markdown; charset=utf-8`.
4b. **Filename wiring** — mocked `loadIssueDraft` returns a run with known `newsletterName` + `endedAt`/`startedAt` → `payload.filename === buildIssueExportFilename({ newsletterName: run.newsletterName, dateIso: run.endedAt ?? run.startedAt, format })` for both `md` and `html`. Orchestration must not hardcode a generic name.
5. **Empty draft** — whitespace-only markdown → error `Issue draft is empty` (no success payload).
6. **Load failure** — `IssueLoadError` propagates / maps so the caller can 404 (assert no invented body).

### `issue-export-route.test.ts`

7. **200 md** — mocked prepare/load → 200, Content-Disposition includes `.md`, Content-Type markdown.
8. **200 html** — Disposition `.html`, Content-Type html; body equals mocked HTML string.
9. **Invalid format** — `format=pdf` or missing → 400 + `Invalid export format`.
10. **404 load** — load failure → 404 + `Couldn’t load this issue for export`.
11. **400 empty** — empty draft → 400 + `Issue draft is empty`.

### UI

12. **Success path** — IssueReader/download links show `Markdown` and `HTML` with correct hrefs and aria-labels.
13. **Error paths** — load-error / not-available do not render download links.

## Tasks

### Task 1: Failing tests for filename + export preparation

- **Action**: Add `shared/src/delivery/__tests__/issue-export.test.ts` covering cases 1–6 including **4b** (modules may not exist — fail red for missing exports). Assume Feature 02 helpers already exist in the tree when this feature executes.
- **Expected result**: New tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new issue-export assertions failing (not infra errors).
- **Depends on**: none (execute only after Feature 02 verified).

### Task 2: Implement `buildIssueExportFilename` + `prepareIssueExport`

- **Action**: Create `shared/src/delivery/issue-export.ts`; reuse `draftMarkdownToEmailHtml` / `draftMarkdownToEmailText`; wire filename from `run.newsletterName` + `endedAt ?? startedAt` (no `getNewsletter`); export from `delivery/index.ts`. Make cases 1–6 including **4b** green.
- **Expected result**: Shared export preparation ready for the route; HTML/MD parity locked by tests.
- **Verify**: `pnpm --filter @newsletter/shared test` — `issue-export.test.ts` green.
- **Depends on**: Task 1.

### Task 3: Failing route + UI tests

- **Action**: Add `issue-export-route.test.ts` (cases 7–11) and `issue-download-links.test.tsx` (+ issue-reader cases 12–13) failing red for missing route/links.
- **Expected result**: Web tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/web test` shows the new export/UI assertions failing (not infra errors).
- **Depends on**: Task 2.

### Task 4: Export route handler

- **Action**: Implement `web/app/api/issues/[runId]/export/route.ts` per Spec (auth via middleware only; map errors to locked status codes/messages; set Content-Disposition). Make cases 7–11 green.
- **Expected result**: Authenticated GET returns downloadable MD/HTML attachments.
- **Verify**: `pnpm --filter @newsletter/web test` — route tests green.
- **Depends on**: Task 3.

### Task 5: Issues chrome download links + monorepo gates

- **Action**: Add `issue-download-links.tsx`; wire into success-path Issue chrome beside existing actions; make cases 12–13 green; run `pnpm typecheck && pnpm lint` and fix fallout.
- **Expected result**: Operator can download MD and HTML from `/issues/[runId]` success path; typecheck + lint clean.
- **Verify**: `pnpm --filter @newsletter/web test` — download link / reader cases green; `pnpm typecheck && pnpm lint` pass; shared issue-export tests still green.
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm --filter @newsletter/web test && pnpm typecheck && pnpm lint`
- Expected: All tests pass including issue-export parity/filename cases, export route 200/400/404 cases, and success-path download links; typecheck and lint clean. Optional smoke: open a completed issue while logged in, click Markdown / HTML, confirm files save with expected names and HTML matches a Send email body’s HTML — not required for verifier automation.

## Handoff

Builder reports: files changed; confirmation Feature 02 was verified before execute; confirmation HTML download body equals `draftMarkdownToEmailHtml` and MD equals `draftMarkdownToEmailText`; confirmation filenames use `run.newsletterName` (no `getNewsletter`) and case 4b gates wiring; sample filenames; confirmation export route is authenticated (not in `PUBLIC_ROUTES`); confirmation no auto-export / no new delivery-status schema; any deviation (e.g. `text/plain` vs `text/markdown` for MD — prefer locked `text/markdown`) and why. Note for Feature 05: **do not** auto-export; Feature 06: downloads need no status field unless PM later asks.

## Research notes

- **Auto draft (2026-07-17)** — Stage 09 Feature 04: on-demand MD + HTML only; HTML parity with Feature 02 email helper; authenticated App Router route + `Content-Disposition: attachment` (Next.js route-handler pattern / context7 streaming download headers); quiet chrome links (not blob-fetch); Feature 02 hard prerequisite.
- **Grizzled Senior (2026-07-17)** — Applied: pin `run.newsletterName` (no `getNewsletter`); case 4b asserts filename wiring through `prepareIssueExport`.
- **codegraph_explore** — current `IssueReader` / `IssueChrome` (Back + Inspect only until Features 02–03 land); `loadIssueDraft`; middleware protects non-public routes; Features 02–03 specs pin Send/Publish in the same chrome row.
- **Feature 02/03 specs** — reuse `draftMarkdownToEmailHtml` / text helper; no delivery-status in this feature; no auto-export (Plan.md Decision 2026-07-16).
- **searxng / Next.js docs** — App Router `Response` + `Content-Disposition: attachment; filename="…"` for downloads.
