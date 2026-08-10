# Feature 07: Hardening — review-stage-03-newsletter-config-2026-07-09

## Intent

Harden `stage-03-newsletter-config` against the 4 accepted Medium findings from `review-stage-03-newsletter-config-2026-07-09`: close the SSRF surface in the Test-feed path, redact raw Appwrite error messages before they reach server logs (feeds + newsletters domains), restore the spec-mandated `Query.equal` URL-uniqueness check that currently fails open beyond 100 feeds, and eliminate the N+1 redundant `listFeeds` round-trips on the Newsletters page by wiring the already-implemented `listAttachmentCountsByNewsletter` helper.

## Dependencies

- Builds on / hardens code from:
  - `feature-01-feeds-and-newsletters-schema` — `shared/src/schema/declarations.ts` (only if an index proves necessary for N1; see Spec).
  - `feature-02-feed-library-page` — `shared/src/feeds/repository.ts` (N1 URL-uniqueness; S2 log redaction), `shared/src/feeds/validation.ts` (S1 SSRF guard).
  - `feature-03-feed-qualification-test` — `shared/src/feeds/qualify.ts` (S1 SSRF guard), `web/app/(protected)/feeds/actions.ts` (S1 qualify path).
  - `feature-04-newsletter-list-and-definition-form` — `shared/src/newsletters/repository.ts` (S2 log redaction).
  - `feature-05-attach-feeds-to-newsletter` — `shared/src/newsletters/attachments.ts` (S2 log redaction; P1 count helper wiring), `web/app/(protected)/newsletters/page.tsx` (P1 N+1), `web/components/newsletters/newsletters-table.tsx` (P1 count source).
  - carry-over: `shared/src/health/check.ts` shares the `wrapAppwriteError` pattern (S2) — a shared redaction helper should cover it too where trivial; out of scope to refactor Stage 02 code unless the helper is extracted.

## Constraints

- **Do not alter user-visible behavior** of any hardened feature unless a finding explicitly requires it:
  - S1 (SSRF): rejection of private/loopback/link-local/cloud-metadata destinations is new behavior by design. Legitimate public-feed Test/create flows must remain unaffected.
  - S2 (log redaction): server logs change only in that raw error strings are sanitized before writing; thrown user-facing messages, codes, and the `{ phase, code, message }` log shape are unchanged (only `message` is sanitized).
  - N1 (URL uniqueness): the operator-facing duplicate-URL error message and code (`duplicate_url`) are unchanged; the check just becomes correct beyond 100 feeds.
  - P1 (N+1): the Newsletters list renders identically (same Feeds counts, same edit-dialog data); only the number of Appwrite round-trips drops.
- **Do not modify** the schema declaration shape (`COLLECTIONS`, attribute sets, `read: []/write: []` perms), the provisioner's create-if-absent/409-swallow/drift-skip semantics, the attach-only-if-ok server gate, the demotion-does-not-detach rule, the `extracted`-only qualification contract, or the `dateRange: "all"` / no-`limitPerFeed` rule.
- **Do not add** new collections, new dependencies, new routes, new nav items, or worker jobs.
- **Server-only DB access** is preserved everywhere (`getServerAppwrite()`); no browser SDK / session-client writes.
- Preserve the no-secrets rule everywhere; S2's redaction must not log the document body, API key, or session secret.
- All stage-03 Acceptance criteria must still hold after hardening (re-verified in Feature verification). This feature does **not** reopen any original feature — the originals stay `verified`; this hardens on top.

## Spec

Four findings, one task per finding:

### S1 — SSRF surface in Test-feed path (no private/loopback/cloud-metadata block)
`shared/src/feeds/validation.ts:18-36` (`validateFeedUrl`) only enforces the `http:`/`https:` scheme. `shared/src/feeds/qualify.ts:16,62` issues server-side `fetchFeeds` + `scrapeArticle` against the raw operator URL via `web/app/(protected)/feeds/actions.ts:90-91`. Add a shared SSRF guard that resolves the URL hostname and rejects loopback (`127.0.0.0/8`, IPv6 `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, incl. cloud metadata `169.254.169.254`), and other reserved/non-routable ranges (RFC 5717/6890). Apply it on **both** the feed write path (`validateFeedUrl`, used by create/update) and the qualify path (before `fetchFeeds`) so internal addresses cannot be stored or fetched. Prefer DNS-resolution-aware checking: reject also when a public-looking hostname resolves into a blocked range.

### S2 — Raw Appwrite errors logged verbatim (feeds + newsletters)
`shared/src/feeds/repository.ts:28-45`, `shared/src/newsletters/repository.ts:27-44`, and `shared/src/newsletters/attachments.ts:31-48` each log the raw `e.message` via `console.error({ phase, code, message })` before throwing the sanitized `APPWRITE_SAFE_MESSAGE`. Extract one shared log-redaction helper (e.g. `sanitizeAppwriteMessageForLog(raw, maxLen)`), apply it in every domain's `wrapAppwriteError` before logging — cap length and redact token-like patterns (API-key / `sk-` / bearer). Keep the thrown user-facing message, codes, and the `{ phase, code, message }` log shape unchanged; only `message` is sanitized. Add a `console.error` spy test in each domain that injects a secret-bearing error and asserts the captured log excludes the secret.

### N1 — URL-uniqueness deviates from spec (fails open >100 feeds on a false premise)
`shared/src/feeds/repository.ts:61-92` uses `Query.limit(FEED_LIST_LIMIT)` (100) + in-memory `.find()` instead of the spec-mandated `Query.equal("url", trimmedUrl)` + `Query.limit(1)`. The deviation comment (`:62-65`) claims Appwrite rejects equality on unindexed attributes — contradicted by `attachments.ts:88-89,148-149` (uses `Query.equal` on equally-index-less junction attrs) and the feature-02 research note (only `orderDesc` needs indexes). Restore the spec implementation: `queries: [Query.equal("url", trimmedUrl), Query.limit(1)]`, then implement the update-path exclusion by checking the returned doc's `$id !== excludeId`. Remove the false-constraint deviation comment. If — and only if — a live Appwrite run genuinely rejects equality on this unindexed attribute (verify first via the count test in Verify), fall back to provisioning an index on `feeds.url` in feature-01's `declarations.ts` rather than keeping the capped scan; record the live outcome in the handoff.

### P1 — N+1 redundant `listFeeds` on Newsletters page; dead-code count helper
`web/app/(protected)/newsletters/page.tsx:31-55,91` calls `listAttachmentsForNewsletter` per newsletter (up to 20), each of which internally calls `listFeeds` (`attachments.ts:201`), while the page already loads the full library once (`page.tsx:91`). `listAttachmentCountsByNewsletter` (`attachments.ts:248-271`) exists precisely to avoid this but has zero callers. Either **(a)** call `listAttachmentCountsByNewsletter(client, newsletterIds)` once for the count column and load full `listAttachmentsForNewsletter` lazily when an edit dialog opens (spec allows "once per open-edit"), or **(b)** keep preloading but pass the already-loaded `libraryFeeds` map into the resolve step (`listAttachmentsForNewsletter(client, newsletterId, { feedsById })` overload) so `listFeeds` is not re-issued 20 times. Approach (a) also exercises the existing helper and removes the dead code. Whichever is chosen, the page must issue at most **one** `listFeeds` round-trip per load.

## Tasks

### Task 1: SSRF guard on feed URL validation + qualify path (S1)

- **Action:** Add a shared SSRF validation helper under `shared/src/feeds/` (e.g. `isPubliclyRoutableUrl(url)` or extend `validation.ts`) that: parses the URL; rejects non-`http:`/`https:` schemes (existing rule); resolves the hostname; rejects loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, incl. `169.254.169.254`), and reserved/non-routable ranges; rejects when DNS resolves a public hostname into a blocked range. Wire it into `validateFeedUrl` (covers create/update) and into `qualifyFeed` before the `fetchFeeds` call (or a shared pre-check invoked by `testFeed` in `actions.ts`). Reuse a single helper — do not duplicate the logic across write + qualify paths.
- **Expected result:** Private/loopback/link-local/cloud-metadata destinations are rejected on both create/update and Test-feed, with no server-side fetch issued; legitimate public feeds behave exactly as before.
- **Verify:** New unit tests in `shared/src/feeds/__tests__/validation.test.ts` (and/or qualify) asserting `http://127.0.0.1/`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/`, `http://[::1]/`, and a public-hostname-resolving-to-private case are all rejected with a clear validation error and no network call. Extend qualify tests to assert the SSRF guard runs before `fetchFeeds` is invoked. `pnpm --filter @newsletter/shared test` green; `pnpm typecheck` zero errors. Confirm a normal `https://example.com/feed.xml` still passes (acceptance: S1 AC).
- **Depends on:** none.

### Task 2: Shared log-redaction helper across feeds + newsletters wrapAppwriteError (S2)

- **Action:** Extract a shared `sanitizeAppwriteMessageForLog(raw: string, maxLen = 160): string` (e.g. in `shared/src/feeds/` or a small shared util imported by both domains) that truncates and redacts token-like patterns (API-key / `sk-` / `Bearer ...` / long alphanumerics resembling keys). Apply it to the `message` field of the `console.error({ phase, code, message })` call in `shared/src/feeds/repository.ts:43`, `shared/src/newsletters/repository.ts:42-43`, and `shared/src/newsletters/attachments.ts:45-46`. Do not change the thrown `APPWRITE_SAFE_MESSAGE` or the `{ phase, code, message }` log shape — only sanitize `message`. If `shared/src/health/check.ts` can adopt the same helper with a trivial one-line change, do so for consistency; otherwise leave a TODO note (do not refactor Stage 02 behavior).
- **Expected result:** No raw Appwrite error message reaches server logs verbatim; thrown messages and codes unchanged; logs retain phase/code for debugging.
- **Verify:** In each domain's `__tests__/` "wraps Appwrite failures" test, add a `vi.spyOn(console, "error")`, inject an error whose message contains a sentinel secret (e.g. `SECRET_API_KEY` / `sk-leak`), trigger a wrapping path (e.g. `listFeeds`/`listNewsletters`), and assert the captured log's `message` field does **not** contain the secret while `phase` and `code` remain present. `pnpm --filter @newsletter/shared test` green; `pnpm typecheck` zero errors. Confirm the thrown user-facing message is still `APPWRITE_SAFE_MESSAGE` (no behavior regression).
- **Depends on:** none.

### Task 3: Restore `Query.equal` URL-uniqueness check (N1)

- **Action:** In `shared/src/feeds/repository.ts:61-92`, replace the capped in-memory `.find()` with `queries: [Query.equal("url", trimmedUrl), Query.limit(1)]`. Implement the update-path exclusion by checking the returned document's `$id !== excludeId` (drop any in-query exclude filter in favor of this post-check). Remove the false-constraint deviation comment at `:62-65`. Mirror the same `Query.equal`+`limit(1)` shape on both create and update paths.
- **Expected result:** Duplicate-URL detection works regardless of feed count; the deviation premise is removed.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/feeds` — extend the duplicate tests: (a) seed >100 documents and assert a duplicate beyond position 100 is still rejected with code `duplicate_url`; (b) assert the `listDocuments` call carries `Query.equal("url", <trimmedUrl>)` + `Query.limit(1)`. **Live check:** run a quick manual/documented verification that `Query.equal` on the unindexed `feeds.url` attribute does not throw against a real provisioned project (the in-stage counter-evidence in `attachments.ts` strongly indicates it will not). If it does throw, fall back to provisioning an index on `feeds.url` in `declarations.ts` (record the outcome in the handoff). `pnpm typecheck` zero errors. Confirm the update-path exclusion still blocks only the *other* owner of the URL (acceptance: N1 AC).
- **Depends on:** none.

### Task 4: Eliminate N+1 `listFeeds` on Newsletters page — wire the count helper (P1)

- **Action:** In `web/app/(protected)/newsletters/page.tsx`, stop calling `listAttachmentsForNewsletter` per newsletter for the count column. Preferred approach (a): call `listAttachmentCountsByNewsletter(client, newsletterIds)` once (single `listDocuments` + TS grouping) to drive the Feeds count column; load full `listAttachmentsForNewsletter` data **lazily** when an edit dialog actually opens (server action or route-segment fetch keyed by newsletter `$id`). Alternative approach (b): keep eager preload but add a `listAttachmentsForNewsletter(client, newsletterId, { feedsById })` overload that accepts the already-loaded `libraryFeeds` map so `listFeeds` is not re-issued per newsletter. Either way: ensure at most **one** `listFeeds` call per page load, and either wire `listAttachmentCountsByNewsletter` into the page or remove it if (b) is chosen. Update `web/components/newsletters/newsletters-table.tsx` count source accordingly. Confirm the edit dialog still receives real `attachedFeeds` + `eligibleFeeds` (no empty-stub Select regression).
- **Expected result:** Newsletters page load issues one `listFeeds` round-trip regardless of newsletter count; counts render correctly for 0/1/many attachments; edit dialog still loads real attachment + feed data on open.
- **Verify:** Add a web-layer test asserting that rendering `/newsletters` with N newsletters triggers exactly one `listFeeds` call (mock `Databases`, count `listDocuments` calls on the feeds collection). Add/confirm a unit test for `listAttachmentCountsByNewsletter` covering grouping, cross-newsletter sharing, and orphan omission. `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint` exit zero. Manual: open a newsletter edit dialog → attached list + attach Select still populate from real data.
- **Depends on:** none.

### Task 5: Regression + product_spec note

- **Action:** Run the full suite. Update `product_spec.md` only if a note is warranted (hardening is behavior-preserving except S1's new SSRF rejection — add a one-line note if helpful). Confirm no schema declaration changes (unless N1 required an index, recorded in handoff), no attach-gate changes, no auto-detach logic, no qualification-contract changes.
- **Expected result:** Full suite green; stage-03 Acceptance criteria still hold.
- **Verify:** `pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint` — all zero. Diff review: SSRF guard present on write + qualify paths; log redaction applied in all three `wrapAppwriteError` sites with spy tests; URL uniqueness uses `Query.equal`+`limit(1)`; Newsletters page makes one `listFeeds` call; no regression to attach-only-if-ok, demotion-does-not-detach, or `extracted`-only pass.
- **Depends on:** Tasks 1–4.

## Feature verification

### Stage A — Automated

- Run: `pnpm --filter @newsletter/shared test -- src/feeds src/newsletters && pnpm test && pnpm --filter web build && pnpm typecheck && pnpm lint`
- Expected: SSRF tests reject loopback/private/link-local/cloud-metadata on both validation and qualify paths; log-redaction spy tests prove no secret in `console.error` output across feeds + newsletters; URL-uniqueness test seeds 101 docs and confirms a duplicate beyond position 100 is rejected; Newsletters page test asserts exactly one `listFeeds` call; all prior stage-03 tests remain green; typecheck/lint/build clean.

### Stage B — PM manual gate

- With worker provisioned: Test a public feed → still `ok`; attempt to add/Test a `http://127.0.0.1` or `http://169.254.169.254` URL → rejected with a clear message. Create duplicate URLs beyond the 100-doc window (if feasible via fixtures) → blocked. Open `/newsletters` → counts correct; open an edit dialog → attached + eligible feeds load. No behavior regression on attach-only-if-ok or demotion.

## Handoff

When complete, the builder reports to the manager:

- Files modified under `shared/src/feeds/`, `shared/src/newsletters/`, `web/app/(protected)/newsletters/`, `web/components/newsletters/` (+ any shared util extracted for S1/S2).
- Confirmation of test/build/typecheck/lint commands and results.
- For S1: the SSRF guard's location, the host classes blocked, and confirmation it runs on both write and qualify paths.
- For S2: the shared redaction helper's location and confirmation it is applied in all three `wrapAppwriteError` sites with spy tests.
- For N1: the live outcome of `Query.equal` on unindexed `feeds.url` (worked / required an index) — recorded explicitly.
- For P1: which approach (a) or (b) was chosen and that the page makes exactly one `listFeeds` call.
- Confirmation that all stage-03 Acceptance criteria still hold and that no original feature was reopened.
- Review report reference: `.ssc/reviews/review-stage-03-newsletter-config-2026-07-09.md`.

## Notes

- This is a **hardening** feature built on top of `verified` originals — it does not reopen feature-01 through feature-06. The originals stay `verified`; their trail is preserved (rebuild the originals first, then this hardening).
- Per the SSC flow, after `ssc-execute` verifies this feature, `ssc-finalize` can close stage 03 (it will warn-but-not-block on any review findings until the hardening feature is verified, then the review record's `hardening_feature` field is already set to this id).
