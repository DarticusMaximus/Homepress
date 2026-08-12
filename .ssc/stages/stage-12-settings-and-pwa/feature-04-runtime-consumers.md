# Feature 04: Runtime consumers

## Intent

Wire pipeline, delivery, and RSS (and other production readers of Stage 12 knobs) to Feature 01’s resolved settings so a Settings change is used on the **next** run, send, or request — without `.env` edits, container recreate, or mid-job live reload.

## Spec

Replace env-only / hard-coded reads of Stage 12 settings with `resolveOperatorSettings` (Feature 01) at the production entry points below. This feature owns **consumer wiring + freeze timing + tests**. It does **not** change Settings schema/UI (Features 01–02), diagnostics (Feature 03), or PWA (Feature 05).

### Timing (auto-pinned — mirrors Plan.md + Feature 01/02 copy)

| Surface | When settings are read | Mid-flight |
|---------|------------------------|------------|
| **Run** (`executeRun`) | **Once** near claim start, after newsletter/LLM resolution succeeds — freeze that snapshot for the whole run (all phases, including resume of later phases in the same `executeRun` call) | Do **not** re-resolve between phases or mid-LLM call |
| **Email send** (`sendIssueEmail`) | Once at the start of that send | N/A |
| **RSS publish / trim** (`publishIssueToRss` → trim) | Once at that publish | N/A |
| **Public RSS GET** (`web/app/rss/...`) | Once per HTTP request | N/A |
| **Newsletter edit public URL display** | Once per page load | N/A |

Changing Settings while a run is already executing does **not** affect that run. The **next** `executeRun` / send / request picks up the new values.

### Consumer inventory (must all be wired)

| Setting | Current production read | Wire to |
|---------|-------------------------|---------|
| OpenRouter API key | `LLMClient` ctor → `process.env.OPENROUTER_API_KEY` (tagger/scorer/selector/drafter/suppress default `new LLMClient()`) | Resolve once in `executeRun`; if `openRouterApiKey.source === "none"`, fail the run early with an operator-readable message (same spirit as LLM-resolution failure — no phase work that needs the key). Else construct **one** `LLMClient({ apiKey: value })` and inject it into the default tagger / scorer / selector / drafter / suppress paths for that run. |
| Score threshold | `MMRSelector` defaults `minScore` to `DEFAULT_SCORE_THRESHOLD` (executeRun selector currently omits `minScore`) | Pass `minScore: resolved.scoreThreshold.value` into `selectDiverse` from the run snapshot. |
| Cross-run similarity | `getCrossRunSimilarityThreshold()` in `executeRun` selection | Use `resolved.crossRunSimilarityThreshold.value` from the run snapshot (do not call the env-only getter on the production path). |
| Drafter reasoning effort + max completion tokens | Hard-coded `DRAFTER_REASONING_EFFORT` / `DRAFTER_MAX_COMPLETION_TOKENS` inside `NewsletterDrafter.draft` | Extend `NewsletterDrafterOptions` with optional `reasoningEffort` and `maxCompletionTokens`; defaults remain the existing constants. `executeRun` passes the snapshot values into `new NewsletterDrafter({ ... })`. |
| SMTP | `resolveSmtpConfig()` (env-only) inside `sendIssueEmail` | At send start, `resolveOperatorSettings(client)`. If `smtp.source === "none"` / `value === null`, return `{ ok: false, error: … }` with a clear operator message (password never included). Else use `smtp.value` for the transport. Env-only `resolveSmtpConfig` may remain for unit tests of env parsing; **production send must not depend on it alone**. |
| Public URL | `resolveAppPublicUrl()` (env-only) in `web/app/rss/[newsletterId]/route.ts` and `web/app/(protected)/newsletters/[id]/page.tsx` | Resolve via `resolveOperatorSettings`. If `appPublicUrl.source === "none"` / missing value → same operator-visible failure as today for RSS (500 with clear message) / `null` for edit-page display helper. Prefer a small shared helper (e.g. `resolveEffectiveAppPublicUrl(client)`) that wraps the Stage 12 resolver and preserves `AppPublicUrlError` (or equivalent) for missing URL — so callers stay thin. |
| RSS last-N | `RSS_FEED_MAX_ITEMS` (const `10`) as default in `listRssPublications` and hard-coded in `trimRssPublications` | Resolve `rssFeedMaxItems` per list/trim operation. Pass `limit` into `listRssPublications`. Add a `maxItems` (or `limit`) parameter to `trimRssPublications` (default may remain the const for back-compat in tests). `publishIssueToRss` and the public RSS route must pass the resolved value. Keep `RSS_FEED_MAX_ITEMS` as the **code default** constant Feature 01 cascade already documents. |

### Run wiring detail (pinned)

In `shared/src/runs/execute-run.ts`, after successful `loadRunLlmResolution` (reuse that Appwrite client):

1. Call `resolveOperatorSettings(client)` **once**.
2. If OpenRouter key is unset (`source: "none"`), `markFailed` with a clear message (e.g. “OpenRouter API key is not set”) and return — do not start phases that need LLM.
3. Build `const llm = new LLMClient({ apiKey })` and inject `{ client: llm }` into default tagger / scorer / selector / drafter / suppress factories (alongside existing model/prompt injection).
4. Pass `minScore` from `scoreThreshold`, suppress `threshold` from `crossRunSimilarityThreshold`, and drafter effort/token options from the same snapshot.
5. Log non-secret resolution metadata only (sources / numeric knobs). **Never** log API key or SMTP password.

Injectable test seams: prefer mocking `resolveOperatorSettings` and/or passing overrides through existing `ExecuteRunOptions` / phase injectables — do not require live Appwrite for unit tests.

### Delivery / RSS wiring detail (pinned)

- **`sendIssueEmail`**: resolve SMTP from operator settings; keep existing nodemailer / BCC / To=From behavior; keep `{ ok: false }` business-failure shape.
- **`publishIssueToRss`**: resolve RSS max items once; pass into `trimRssPublications`.
- **RSS route**: resolve public URL + RSS max items; `listRssPublications(client, id, { limit })`; build feed URLs from resolved base.
- **Newsletter edit page**: resolve public URL for `appPublicUrl` prop (null when unset).

### What must NOT change

- Feature 01 cascade / SMTP all-or-nothing / schema / `updateOperatorSettings` contract.
- Settings panel or diagnostics behavior (Features 02–03 already call the resolver for display/probes).
- Mid-job live reload (explicitly out of stage scope).
- Appwrite / `TZ` / worker poll intervals staying `.env`-only.
- MMR λ, protected-run count, scraper min-extract (still code defaults).
- `LLMClient` may still fall back to `process.env.OPENROUTER_API_KEY` when `apiKey` is omitted (harnesses/tests). Production `executeRun` **must** inject the resolved key (or fail early if none).

## Dependencies

- Builds on: **feature-01-settings-store-and-resolution** (`resolveOperatorSettings`, `ResolvedOperatorSettings`, SMTP all-or-nothing, try-parse env helpers).
- Assumes Features 02–03 may be pending/unbuilt; this feature does not require Settings UI or diagnostics to exist — only Feature 01’s resolver API.
- Patterns: claim-time freeze of models/prompts via `loadRunLlmResolution`; injectable `client` on pipeline stages; `listRssPublications` already accepts `opts.limit`.

## Constraints

- Never log or put OpenRouter key / SMTP password in failure messages, checkpoints, or stdout.
- Do not re-resolve operator settings mid-run.
- Do not invent a second cascade — production readers use Feature 01’s resolver (or a thin wrapper over it).
- Do not move retention, Appwrite connection, `TZ`, or worker poll intervals into Settings.
- Do not add PWA work.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] A GUI (or env) OpenRouter key change is used by the **next** `executeRun` LLM phases without editing `.env` or recreating containers; missing key fails the run clearly before LLM work.
- [ ] Resolved score threshold is passed as `minScore` on selection for that run; resolved cross-run similarity is used for suppress; resolved drafter reasoning effort and max completion tokens are used on draft.
- [ ] `sendIssueEmail` uses resolved SMTP (GUI complete bundle → else env); missing SMTP yields `{ ok: false }` with a clear message and never leaks the password.
- [ ] Public RSS feed and newsletter edit URL display use resolved public URL; RSS list + trim honor resolved last-N.
- [ ] An in-flight run does not pick up Settings changes mid-execution (resolve-once freeze).
- [ ] Env-only helpers may remain for tests, but production paths above do not rely on them alone for Stage 12 values.
- [ ] Unit tests cover the wired behaviors; `pnpm typecheck` and `pnpm lint` pass.

## Files

- Modify: `shared/src/runs/execute-run.ts`
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` (and/or a focused new test module if cleaner)
- Modify: `shared/src/pipeline/drafter.ts` (options for effort/tokens)
- Modify: `shared/src/pipeline/__tests__/drafter.test.ts` (assert options override constants)
- Modify: `shared/src/delivery/send-issue-email.ts`
- Modify: `shared/src/delivery/__tests__/send-issue-email.test.ts`
- Modify: `shared/src/delivery/publish-issue-to-rss.ts`
- Modify: `shared/src/delivery/rss-publications.ts` (`trimRssPublications` max-items param)
- Modify: `shared/src/delivery/__tests__/rss-publications.test.ts`
- Modify: `shared/src/delivery/__tests__/publish-issue-to-rss.test.ts` (if present / as needed)
- Create or modify: `shared/src/delivery/app-public-url.ts` (and/or small `resolve-effective-app-public-url.ts`) — effective URL via operator resolver
- Modify: `shared/src/delivery/__tests__/app-public-url.test.ts` (or sibling tests for the effective helper)
- Modify: `web/app/rss/[newsletterId]/route.ts`
- Modify: `web/app/(protected)/newsletters/[id]/page.tsx`
- Modify: `web/src/__tests__/rss-feed-route.test.ts` (and newsletter edit URL tests if they assert env-only resolution)
- Optional: extend `shared/src/settings/index.ts` re-exports if a thin wrapper lives under settings/

## Testing approach

Test-first. Verify **behavior under Intent** (next job/request uses resolved values; freeze; no secret leakage) — not incidental refactors.

1. **executeRun OpenRouter** — mock `resolveOperatorSettings` with GUI key → injected LLM client receives that key (or factory called with it); `source: "none"` → markFailed / early return, no tag/score LLM calls.
2. **executeRun knobs** — GUI/env-resolved `scoreThreshold` → `selectDiverse` called with that `minScore`; `crossRunSimilarityThreshold` → suppress `threshold`; drafter constructed with resolved effort/tokens (spy constructor or draft chat `extraBody`).
3. **Freeze** — assert `resolveOperatorSettings` is invoked **once** per successful `executeRun` start (not per phase). Optional: mutate mock return between phases and prove later phases still use the first snapshot (only if easy with existing injectables).
4. **sendIssueEmail** — GUI SMTP bundle used over env; incomplete/absent → `{ ok: false }` clear error; password absent from error strings.
5. **RSS last-N** — `trimRssPublications` / `listRssPublications` honor passed limit from resolved value; publish path passes resolved max.
6. **Public URL** — effective resolver returns GUI URL over env; unset → error/`null` per caller contract; RSS route + edit page updated tests.
7. **Drafter unit** — optional options override constants in `extraBody`; omitted options keep default constants.
8. **Secrets** — spot-check failure/log paths never include raw key/password.

Prefer mocking `resolveOperatorSettings` rather than standing up full Appwrite. Existing execute-run / send-email / RSS tests should be updated so they still pass when the new resolve call is required (inject a default resolved snapshot in tests).

## Tasks

### Task 1: Drafter options + RSS trim limit API (red → green)

- **Action**: Add failing unit tests, then implement: extend `NewsletterDrafterOptions` / draft `extraBody` to honor optional `reasoningEffort` and `maxCompletionTokens` (defaults = existing constants); add `maxItems`/`limit` param to `trimRssPublications` (keep const as default). Cover override vs default in `shared/src/pipeline/__tests__/drafter.test.ts` and limit behavior in `shared/src/delivery/__tests__/rss-publications.test.ts`.
- **Expected result**: Lower-level APIs accept overrides Feature 04 entry points will pass; those unit tests green.
- **Verify**: `pnpm --filter @newsletter/shared test` — drafter + rss-publications suites green for new options/params.
- **Depends on**: none.

### Task 2: Effective public URL + SMTP send path (red → green)

- **Action**: Add failing tests, then implement thin effective public-URL helper over `resolveOperatorSettings` (preserve missing-URL error semantics). Wire `sendIssueEmail` to resolved SMTP (GUI complete bundle → else env; none → `{ ok: false }` clear message). Update `shared/src/delivery/__tests__/send-issue-email.test.ts` and app-public-url/effective helper tests. Keep env-only `resolveSmtpConfig` / `resolveAppPublicUrl` for legacy/unit env tests unless a cleaner deprecation path is obvious — production paths must use the Stage 12 resolver.
- **Expected result**: Send + public URL resolution use Feature 01 cascade.
- **Verify**: send-issue-email + effective public-URL helper tests green; password absent from failure strings.
- **Depends on**: Task 1.

### Task 3: executeRun claim-time operator snapshot (red → green)

- **Action**: Add/extend failing execute-run tests for: GUI OpenRouter key injected into shared `LLMClient`; `source: "none"` → early `markFailed`; `minScore` / suppress `threshold` / drafter effort+tokens from snapshot; `resolveOperatorSettings` called **once** per run. Then implement in `shared/src/runs/execute-run.ts` (resolve once after LLM resolution; inject client; pass knobs; never log secrets). Update existing execute-run mocks so the new resolve call is stubbed with a default snapshot.
- **Expected result**: Next run uses Settings; in-run freeze holds.
- **Verify**: execute-run tests green for key / knob / freeze / missing-key cases.
- **Depends on**: Task 2.

### Task 4: RSS route, publish trim, newsletter edit page (red → green)

- **Action**: Add/extend failing tests, then wire `publishIssueToRss` trim limit, public RSS GET (URL + list limit), and newsletter edit `appPublicUrl` to the effective resolver / resolved last-N. Update `web/src/__tests__/rss-feed-route.test.ts`. For the edit page (`web/app/(protected)/newsletters/[id]/page.tsx`): add a small web/shared test of the helper the page calls **or** a focused page/module test that proves it uses the Stage 12 effective helper / `resolveOperatorSettings`, **not** env-only `resolveAppPublicUrl` alone — do not leave this to an untested code glance.
- **Expected result**: Next RSS request / publish / edit-page load uses resolved URL and last-N.
- **Verify**: (1) RSS route tests green for resolved URL + list limit; (2) publish/rss trim tests green for resolved max items; (3) newsletter-edit public-URL path covered by an explicit test asserting Stage 12 effective resolution (not env-only).
- **Depends on**: Task 3.

### Task 5: Monorepo gates

- **Action**: Run touched shared/web suites plus `pnpm typecheck` and `pnpm lint`; fix fallout only as needed for this feature.
- **Expected result**: Gates clean; Stage 12 runtime consumers complete without PWA or Settings UI changes beyond what’s required for URL display.
- **Verify**: `pnpm typecheck` and `pnpm lint` pass; relevant tests green.
- **Depends on**: Task 4.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test` (execute-run, drafter, send-issue-email, rss-publications, app-public-url / effective helper suites) && `pnpm --filter web test` (rss-feed-route + newsletter-edit public-URL coverage) && `pnpm typecheck` && `pnpm lint`
- Expected: Production run/send/RSS/edit readers use `resolveOperatorSettings` (or thin wrappers); freeze-once on runs; secrets never logged; typecheck and lint clean.

## Handoff

Builder reports: files changed; exact helper names (effective public URL, any SMTP bridge); confirmation executeRun resolves once and injects one LLMClient; confirmation score/similarity/drafter knobs passed from that snapshot; confirmation send/RSS/edit use resolved SMTP/URL/last-N; confirmation env-only helpers are no longer the sole production path for Stage 12 values; confirmation secrets never logged; any deviation (file split, test inject shape) and why. Note for Feature 05: runtime operability for Settings knobs is complete — PWA is independent.

### Research note

- Codebase (codegraph + rg): `execute-run.ts` claim-time `loadRunLlmResolution` + `getCrossRunSimilarityThreshold()` at selection; selector omits `minScore` (defaults to `DEFAULT_SCORE_THRESHOLD`); `NewsletterDrafter` hard-codes effort/tokens; `LLMClient` reads `OPENROUTER_API_KEY`; `sendIssueEmail` → `resolveSmtpConfig()`; RSS route + newsletter edit → `resolveAppPublicUrl()`; `listRssPublications` already has `opts.limit`, `trimRssPublications` hard-codes `RSS_FEED_MAX_ITEMS`.
- Feature 01 pins `resolveOperatorSettings` + cascade; Plan.md 2026-08-10 pins next run/send/request (not mid-job).
- Auto mode 2026-08-11: freeze-once at executeRun; inject shared LLMClient; extend drafter options; trim accepts max items; thin effective public-URL helper.
- Grizzled Senior review 2026-08-11: folded red→green per surface (no mega Task 1); Task 4 Verify requires explicit newsletter-edit public-URL test (not env-only).
