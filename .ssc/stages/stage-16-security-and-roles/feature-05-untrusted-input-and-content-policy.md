# Feature 05: Untrusted input and content policy

## Intent

Untrusted input — anonymous HTTP requests, feed-derived article content, and model output — is validated at every trust boundary (public route, repository, drafter prompt, persisted draft, rendering channels) so it cannot probe internal paths, blow up token spend, or make subscriber devices fetch attacker-chosen URLs — closing audit findings S3, S9, C1, S12, S14, P1, A1, N5.

## Spec

### 1. Shared ID/limit guards (S9 primitives)

- New `shared/src/util/document-id.ts`:
  - `APWRITE_DOCUMENT_ID_MAX = 36` (Appwrite's max custom-id length; `ID.unique()` ids are 26 chars).
  - `isValidAppwriteDocumentId(id: string): boolean` — `/^[A-Za-z0-9_-]{1,36}$/` (same charset as `web/lib/newsletter-id.ts`; rejects `/`, `.`, `?`, empty, over-length).
  - `LIST_LIMIT_MAX = 500`.
  - `clampListLimit(value: number | undefined, fallback: number): number` — `undefined` → `fallback`; else `Math.min(Math.max(1, Math.floor(value)), 500)`.

### 2. Repository wiring (S9) + deleteFeed guard (C1)

- Gate the six audit-named get/delete functions with `isValidAppwriteDocumentId` **before any SDK call**: `getRun`, `deleteRun` (`shared/src/runs/repository.ts`); `getNewsletter`, `deleteNewsletter` (`shared/src/newsletters/repository.ts`); `getFeed`, `deleteFeed` (`shared/src/feeds/repository.ts`). A malformed id throws the repository's existing domain `not_found` error with the existing message ("Run not found" / "Newsletter not found" / "Feed not found") — indistinguishable from a missing document, no new error shapes.
- Clamp caller-supplied limits in `listRuns`, `listPendingRuns`, and `listAllRuns` (`pageSize`) via `clampListLimit` (`listRuns`/`listPendingRuns` fallback 100; `listAllRuns` fallback 100). `listIssues` and the RSS route flow through these and need no own clamp (`rssFeedMaxItems` is validated at the settings layer — out of scope).
- `deleteFeed` attached-guard (`shared/src/feeds/repository.ts:219-253`): replace the single-page `Query.limit(FEED_LIST_LIMIT)` list + in-memory `some()` with a server-side filtered existence check — `Query.equal("feedId", feedId)` + `Query.limit(1)`; any returned document → existing `"attached"` `FeedRepositoryError`. No index on `feedId` exists (same as today); `Query.equal` works unindexed and household scale makes the scan trivial. `FEED_LIST_LIMIT` stays for `listFeeds`.

### 3. Public RSS route hardening (S3)

`web/app/rss/[newsletterId]/route.ts`:

- First statement after `await params`: `if (!isSafeNewsletterId(newsletterId) || newsletterId.length > 36) return 404` (import from `web/lib/newsletter-id`; the length bound mirrors `APWRITE_DOCUMENT_ID_MAX` — `isSafeNewsletterId` is charset-only, so without it a 600-char alphanumeric id would reach the client) — no Appwrite client is constructed or called for malformed ids.
- `AppPublicUrlError` catch (currently `:44-46` returns `err.message`): log the detail server-side via `console.error` with `sanitizeAppwriteMessageForLog(err.message)`, then return **500 with a fixed generic body** ("RSS feed is temporarily unavailable.") — no deployment/config detail to anonymous clients.
- Headers: 200 → `Cache-Control: public, max-age=300`; both 404 paths → `Cache-Control: no-store`. `Content-Type` unchanged.
- Unexpected errors keep rethrowing (Next handles 500).

### 4. Drafter prompt cap (P1) + interface arity (A1)

- `shared/src/pipeline/drafter.ts` payload build (`:144-151`): cap each article's content — `content` becomes `a.content.length > DEFAULT_MAX_CONTENT_LENGTH ? a.content.slice(0, DEFAULT_MAX_CONTENT_LENGTH) + " […truncated]" : a.content` (import `DEFAULT_MAX_CONTENT_LENGTH` from `./config`; 70k, tagger parity). Per-PM: per-article cap only, no total-payload budget.
- `shared/src/pipeline/orchestrator.ts`: `PipelineOptions.drafter.draft` (`:45-52`) gains the fifth parameter `audience: string` — the interface now matches the real 5-arg call at `:278-284` and the concrete `NewsletterDrafter.draft`. Fix the stale "no options bags are forwarded" comment (`:26-28`) to state that `audience` is forwarded as a natural arg.

### 5. Persisted-draft normalization (S12 — loose, per PM)

- New `shared/src/pipeline/draft-normalize.ts`:
  - `ISSUE_DRAFT_MAX_CHARS = 1_000_000` (PM-chosen generous backstop; the model's output-token limit is the effective bound).
  - `normalizeDraftMarkdown(md: string): string`, steps in order:
    1. `\r\n` → `\n`, then lone `\r` → `\n`.
    2. Strip `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]` (control + null + DEL; keep `\t` and `\n`).
    3. Scheme scrub over markdown link syntax — **inline code spans and fenced code blocks pass through untouched** (a tech digest quoting `[x](javascript:alert(1))` inside code legitimately must survive byte-identical). Outside those regions, a destination is "bad" iff it matches `^[a-zA-Z][a-zA-Z0-9+.-]*:` (scheme compared **case-insensitively**) with a scheme other than `http`, `https`, `mailto` (relative/fragment destinations pass):
       - inline link `[text](bad:…)` → keep `text` only;
       - inline image `![alt](…)` → dropped entirely unless the destination scheme is `http`/`https`;
       - angle autolink `<bad:…>` → dropped;
       - link definition line `[ref]: bad:…` → dropped.
    4. Slice to `ISSUE_DRAFT_MAX_CHARS`.
  - No HTML stripping, no other rewriting — benign drafts come through byte-identical.
- Applied at `NewsletterDrafter.draft()` success return (`drafter.ts` step 8): `markdown: normalizeDraftMarkdown(content)`. Empty/`empty-after-retry` paths unchanged (empty stays empty). This single point covers execute-run, regenerate-draft, checkpoint persistence, and all downstream readers (title/dek extraction, Inspect, delivery) — existing stored drafts are NOT rewritten.

### 6. Remote-content policy (S14 — strip everywhere, per PM)

- `shared/src/delivery/email-body.ts`: remove `"img"` from `allowedTags` and delete the now-dead `img` entries in `allowedAttributes` / `allowedSchemesByTag`; add `transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noreferrer" }) }` **and add `rel` to `allowedAttributes.a`** (sanitize-html filters `transformTags` output against the attribute allowlist — without it the injected `rel` is stripped). Because email, RSS `htmlBody`, and HTML export all call `draftMarkdownToEmailHtml`, the three static channels stay byte-equal and now emit no `<img>` and hardened `<a>`. Update the file's doc comments to state the policy.
- `web/components/issues/issue-markdown.tsx`: add `img: () => null` to `markdownComponents` (reader + Inspect render no images); upgrade the anchor override's `rel` to `"noopener noreferrer nofollow"`.
- `SECURITY.md`: new short "Remote content policy" section — no remote images in any channel (email, RSS, HTML export, reader/Inspect); emitted links carry `rel="nofollow noreferrer"`; policy enforced at render time (stored drafts keep source markdown); rationale: no hot-linking scraped assets, no tracking pixels / device fingerprinting, phishing hardening. The raw `.md` export is operator-authenticated and unchanged.
- Listen (TTS) and the plain-text email part are unaffected (images are not fetched there).

### 7. Delivery catch logging (N5) + bookkeeping

- `shared/src/delivery/send-issue-email.ts:94-100` and `shared/src/delivery/publish-issue-to-rss.ts:92-97`: before returning the generic failure in each `getNewsletter` catch, emit a structured sanitized log matching the sibling style — `console.error({ phase: "send-issue-email-load-newsletter" | "publish-issue-to-rss-load-newsletter", runId, errorType, message: sanitizeAppwriteMessageForLog(...) })`. Operator-facing messages unchanged.
- Tick `S3-20260917`, `S9-20260917`, `C1-20260917`, `S12-20260917`, `S14-20260917`, `P1-20260917`, `A1-20260917`, `N5-20260917` in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings (Plan.md carry-forward pin).

## Dependencies

- None code-wise — independent of Features 01–04 (may run before or after). Stage 15 complete (stage-level dependency satisfied).
- Overlap notes: Feature 04 also edits `feeds/repository.ts` (recordFeedTestResult redaction, describeError hoist) and hoists `describeError` into `util/log-redact.ts` — different functions than §2/§7 touch; whichever runs second rebases trivially. Feature 01 gates action modules; this spec touches no `actions.ts`.

## Constraints

- **No schema changes** — `schema/declarations.ts` is untouched.
- Well-formed ids, sane limits, benign drafts, and clean markdown behave byte-identically to today — this feature must be invisible to legitimate use.
- Stored drafts remain the canonical model output (modulo §5 normalization); renderers keep their own sanitizers — §6 is a channel policy at render time, not a storage rewrite, and no existing draft document is rewritten.
- The three static channels (email HTML, RSS `htmlBody`, HTML export) must remain byte-equal for the same markdown via the shared `draftMarkdownToEmailHtml`.
- The `.md` export path (`/api/issues/[runId]/export?format=md`) is unchanged.
- `FEED_LIST_LIMIT` stays in use by `listFeeds`; only the deleteFeed guard changes.
- No total drafter-payload budget (PM decision) — per-article cap only.
- `listRssPublications` limit handling is untouched (knob validated at the settings layer).

## Acceptance criteria

- [ ] The RSS route returns 404 for malformed ids (`..`, `a/b`, 600-char, URL-encoded `%2F`) without constructing/calling the Appwrite client; `AppPublicUrlError` yields a 500 with the fixed generic body and the detail only in the server log; 200 responses carry `Cache-Control: public, max-age=300` and 404s `no-store`. (S3)
- [ ] Every gated get/delete rejects malformed ids with the domain `not_found` error before any SDK call (mock asserts zero Databases calls); `listRuns`/`listPendingRuns`/`listAllRuns` clamp limits to [1, 500]; `deleteFeed` throws `attached` whenever any junction references the feed — including a junction that a first-page-of-100 list would miss — verified by a test asserting the `Query.equal("feedId", …)` server-side filter. (S9, C1)
- [ ] A 200k-char article yields drafter payload content of 70k chars + the `[…truncated]` marker; sub-cap content appears byte-identical in the captured prompt. (P1)
- [ ] `PipelineOptions.drafter.draft` declares five parameters including `audience: string`; `pnpm typecheck` passes; the existing orchestrator 5-arg assertion stays green against an interface-typed mock. (A1)
- [ ] Drafter-returned markdown from a hostile mock (control/null bytes, `\r`, `[x](javascript:alert(1))`, `![p](data:image/gif;base64,…)`, `[r]: vbscript:x`) comes back with control bytes gone, bad links reduced to their text, bad images/definitions dropped; a benign draft fixture passes through byte-identical; a >1M-char draft is capped at `ISSUE_DRAFT_MAX_CHARS`. (S12)
- [ ] `draftMarkdownToEmailHtml` output contains no `<img` tag for any image markdown and every `<a>` carries `rel="nofollow noreferrer"`; `IssueMarkdown` renders no `img` element and its anchors carry `noopener noreferrer nofollow`; policy documented in `SECURITY.md`. (S14)
- [ ] A rejecting `getNewsletter` in the email-send and RSS-publish paths produces both `{ok:false}` with the existing generic message AND a sanitized structured `console.error` (spy-asserted). (N5)
- [ ] All eight finding checkboxes are `[x]` in the audit report; `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.

## Files

- Create: `shared/src/util/document-id.ts`, `shared/src/util/__tests__/document-id.test.ts`
- Create: `shared/src/pipeline/draft-normalize.ts`, `shared/src/pipeline/__tests__/draft-normalize.test.ts`
- Modify: `shared/src/runs/repository.ts` (§2), `shared/src/runs/__tests__/repository.test.ts`
- Modify: `shared/src/newsletters/repository.ts` (§2), `shared/src/newsletters/__tests__/repository.test.ts`
- Modify: `shared/src/feeds/repository.ts` (§2), `shared/src/feeds/__tests__/repository.test.ts`
- Modify: `web/app/rss/[newsletterId]/route.ts` (§3), `web/src/__tests__/rss-feed-route.test.ts`
- Modify: `shared/src/pipeline/drafter.ts` (§4, §5), `shared/src/pipeline/__tests__/drafter.test.ts`
- Modify: `shared/src/pipeline/orchestrator.ts` (§4), `shared/src/pipeline/__tests__/orchestrator.test.ts`
- Modify: `shared/src/delivery/email-body.ts` (§6), `shared/src/delivery/__tests__/email-body.test.ts`, `shared/src/delivery/__tests__/issue-export.test.ts` (only if fixtures contain `<img>`)
- Modify: `web/components/issues/issue-markdown.tsx` (§6), `web/src/__tests__/issue-markdown.test.tsx`
- Modify: `shared/src/delivery/send-issue-email.ts` (§7), `shared/src/delivery/__tests__/send-issue-email.test.ts`
- Modify: `shared/src/delivery/publish-issue-to-rss.ts` (§7), `shared/src/delivery/__tests__/publish-issue-to-rss.test.ts`
- Modify: `SECURITY.md` (§6)
- Modify: `.ssc/reviews/review-app-public-exposure-2026-09-17.md` (tick S3, S9, C1, S12, S14, P1, A1, N5)

## Testing approach

Test-first throughout, hermetic (existing fake-Client/mock-Databases patterns; no live Appwrite). Red runs are captured before each implementation.

- **document-id.test.ts (§1):** valid ids pass (ULID-ish, 36-char, `_`/`-`); reject `""`, `a/b`, `..`, `?x`, 37+ chars, whitespace, `%2F`. `clampListLimit`: `undefined`→fallback, `0`/`-5`→1, `5000`→500, `250`→250.
- **Repository tests (§2):** each gated function — malformed id → domain `not_found` thrown and the mock Databases' `getDocument`/`deleteDocument` never called; valid id → existing behavior unchanged. `listRuns` limit `5000` → captured query contains `limit(500)`. Feeds: fake Databases returning one matching junction for `Query.equal("feedId", …)` → `attached` thrown and `deleteDocument` (feed) never called; zero matches → feed deleted; the test asserts the queries array contains the `feedId` equality filter (the "page 2" junction scenario is impossible by construction).
- **rss-feed-route.test.ts (§3):** malformed-id matrix → 404 + `no-store` + `getServerAppwrite` never invoked; `AppPublicUrlError` fixture → 500 + fixed body + sanitized server log (spy) + no config detail in body; happy path → 200 + `Cache-Control: public, max-age=300` + unchanged XML.
- **drafter.test.ts (§4/§5):** fake LLM client capturing the prompt — 200k content → payload `content` is exactly 70k slice + marker; short content byte-equal. Hostile-output mock (§5 cases) → returned `markdown` normalized per rule; benign draft fixture byte-identical; 1M+ output capped.
- **draft-normalize.test.ts (§5):** one case per rule (CRLF/CR, each control byte class, each bad-scheme form incl. definition + autolink, allowed schemes/relative/fragment pass through, `HTTPS://`/mixed-case link passes, cap); benign fixture byte-identical **including a fenced code block and inline code span that contain `javascript:` / `data:` examples** (code regions untouched — regression guard for "invisible to legitimate use").
- **orchestrator.test.ts (§4):** a mock drafter typed exactly as `NonNullable<PipelineOptions["drafter"]>` receives `audience` (runtime assert; the interface arity is compiler-enforced).
- **email-body.test.ts / issue-export.test.ts (§6):** image markdown → no `<img` in output; links carry `rel="nofollow noreferrer"`; headings/lists/code/tables unchanged; export snapshots stay consistent (update fixtures only if they embed images).
- **issue-markdown.test.tsx (§6):** markdown with a remote image renders zero `img` elements; anchors carry the hardened rel.
- **send-issue-email.test.ts / publish-issue-to-rss.test.ts (§7):** `getNewsletter` rejecting (fake client throwing 500) → `{ok:false}` with the existing generic message AND console.error spy fired with a sanitized structured record.

## Tasks

### Task 1: shared ID/limit guards — red then green

- **Action**: Create `shared/src/util/__tests__/document-id.test.ts` per Testing approach (red — module absent). Then implement `shared/src/util/document-id.ts` (Spec §1).
- **Expected result**: Predicates + clamp exist, tested in isolation; nothing imports them yet.
- **Verify**: `pnpm vitest run shared/src/util/__tests__/document-id.test.ts` passes.
- **Depends on**: none.

### Task 2: repository wiring + deleteFeed guard (S9, C1) — red then green

- **Action**: Add red cases to `runs/__tests__/repository.test.ts`, `newsletters/__tests__/repository.test.ts`, `feeds/__tests__/repository.test.ts` (malformed-id matrix + zero-SDK-call asserts, limit clamps, feedId-filtered attached guard). Then wire Spec §2 into the three repositories.
- **Expected result**: Six get/delete functions gated; three list functions clamped; deleteFeed uses the server-side `Query.equal("feedId", …)` existence check.
- **Verify**: `pnpm vitest run shared/src/runs/__tests__/repository.test.ts shared/src/newsletters/__tests__/repository.test.ts shared/src/feeds/__tests__/repository.test.ts` passes; `pnpm typecheck` passes.
- **Depends on**: Task 1.

### Task 3: RSS route hardening (S3) — red then green

- **Action**: Add red cases to `web/src/__tests__/rss-feed-route.test.ts` (malformed-id matrix, AppPublicUrlError fixed body + sanitized log, Cache-Control assertions). Then implement Spec §3 in `web/app/rss/[newsletterId]/route.ts`.
- **Expected result**: Route validates ids before any Appwrite work, emits only fixed error bodies, sets cache headers.
- **Verify**: `pnpm vitest run web/src/__tests__/rss-feed-route.test.ts` passes.
- **Depends on**: none (runs after Task 2 in practice; no code coupling).

### Task 4: drafter cap + interface arity (P1, A1) — red then green

- **Action**: Add red cases to `drafter.test.ts` (200k article → capped payload + marker; short article byte-equal) and `orchestrator.test.ts` (interface-typed mock receives `audience`). Then implement Spec §4 in `drafter.ts` and `orchestrator.ts`.
- **Expected result**: Payload caps content at 70k with marker; interface matches the 5-arg call; stale comment fixed.
- **Verify**: `pnpm vitest run shared/src/pipeline/__tests__/drafter.test.ts shared/src/pipeline/__tests__/orchestrator.test.ts` passes; `pnpm typecheck` passes.
- **Depends on**: none.

### Task 5: draft normalization (S12) — red then green

- **Action**: Create `shared/src/pipeline/__tests__/draft-normalize.test.ts` (red), add hostile-output cases to `drafter.test.ts` (red). Then implement `draft-normalize.ts` and apply it at the drafter success return (Spec §5).
- **Expected result**: All drafter-returned markdown is normalized; benign drafts byte-identical.
- **Verify**: `pnpm vitest run shared/src/pipeline/__tests__/draft-normalize.test.ts shared/src/pipeline/__tests__/drafter.test.ts` passes.
- **Depends on**: Task 4 (same file, ordered to avoid churn).

### Task 6: remote-content policy (S14) — red then green

- **Action**: Add red cases to `email-body.test.ts` (no `<img`, hardened `rel`) and `issue-markdown.test.tsx` (no img element). Then implement Spec §6 in `email-body.ts` and `issue-markdown.tsx`; check/adjust `issue-export.test.ts` fixtures; write the `SECURITY.md` section.
- **Expected result**: No channel renders remote images; emitted links hardened; policy documented.
- **Verify**: `pnpm vitest run shared/src/delivery web/src/__tests__/issue-markdown.test.tsx` passes.
- **Depends on**: none.

### Task 7: N5 logging, audit ticks, full gates

- **Action**: Add log-spy cases to `send-issue-email.test.ts` / `publish-issue-to-rss.test.ts` (red), implement Spec §7 logs. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all green). Tick the eight finding checkboxes in the audit report.
- **Expected result**: Swallowed catches log sanitized structured errors; report reflects all eight findings remediated; gates green.
- **Verify**: Three commands exit zero; the report shows `[x]` for S3, S9, C1, S12, S14, P1, A1, N5.
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test`
- Expected: All exit zero. Within `pnpm test`: RSS-route matrix (404-no-Appwrite, fixed 500 body, cache headers), repository gates (zero SDK calls on malformed ids, clamped limits, feedId-filtered attached guard), drafter cap + normalization (70k slice + marker, hostile-output scrub, benign byte-identical, 1M cap), channel policy (no `<img` anywhere, hardened `rel`), N5 log spies. Supporting probes: `rg -n '"img"' shared/src/delivery/email-body.ts` → no match; `rg -n "nofollow noreferrer" shared/src/delivery/email-body.ts web/components/issues/issue-markdown.tsx SECURITY.md` → hits all three; `rg -n "Remote content policy" SECURITY.md` → hit; audit report shows `[x]` for all eight IDs.

## Handoff

Report to the manager: files created/modified; red-run evidence for Tasks 1–6 (which assertions failed pre-implementation); confirmation that benign-content regression fixtures (draft fixture, email-body structure, RSS XML) passed byte-identical; whether `issue-export.test.ts` fixtures needed image removal; any deviations from this spec and why (e.g. sanitize-html transform behavior, react-markdown component typing — the strip-everywhere policy must not weaken).

## Research note

- Codebase reads (2026-09-17): `web/app/rss/[newsletterId]/route.ts` (full — unchecked id at :23, `err.message` 500 at :45, no Cache-Control on 200), `web/lib/newsletter-id.ts` (charset regex), `shared/src/runs/repository.ts` (getRun :179-194, deleteRun :1152, listRuns :275-343 limit forwarded at :284/:313, listPendingRuns, listAllRuns :1204 pageSize), `shared/src/newsletters/repository.ts` (getNewsletter :159, deleteNewsletter :403 paginated cascade counterexample), `shared/src/feeds/repository.ts` (deleteFeed :219-253 first-page guard, getFeed :255, FEED_LIST_LIMIT :23), `shared/src/pipeline/drafter.ts` (payload :144-151 verbatim `content`, success return :225-232), `shared/src/pipeline/orchestrator.ts` (PipelineOptions :30-53 4-param draft, stale comment :26-28), `shared/src/pipeline/config.ts` (DEFAULT_MAX_CONTENT_LENGTH=70000 :32, tagger-only consumer), `shared/src/delivery/email-body.ts` (allowlist incl. img :15-59, shared by email/RSS/export :73-76), `web/components/issues/issue-markdown.tsx` (anchor hardening present, images pass), `shared/src/delivery/send-issue-email.ts` (silent getNewsletter catch :94-100; sibling logging style :143-153), `shared/src/delivery/publish-issue-to-rss.ts` (silent catch :92-97; sibling style :120-129), `shared/src/runs/issues.ts` (loadIssueDraft/listIssues title-dek consumers of normalized markdown), test layout (`web/src/__tests__/rss-feed-route.test.ts`, `email-body.test.ts`, `issue-markdown.test.tsx`, per-repo tests with mock-client fixtures). Audit findings S3/S9/C1/S12/S14/P1/A1/N5 in `.ssc/reviews/review-app-public-exposure-2026-09-17.md`.
- PM decisions this session (grill mode): S14 — strip remote images in **all** channels including reader GUI (newsletters don't reuse scraped visuals; hot-linking is bad practice), links hardened, storage stays loose; S12 — 1,000,000-char cap; P1 — per-article 70k slice only, no total budget; S9 — malformed ids throw the domain `not_found` error.
- Grizzled Senior review (advisory, PM-approved): route guard gains the ≤36 length bound (charset-only `isSafeNewsletterId` would pass a 600-char id); §5 scrub exempts inline code spans/fenced blocks and compares schemes case-insensitively; §6 pre-authorizes `rel` in `allowedAttributes.a`.
