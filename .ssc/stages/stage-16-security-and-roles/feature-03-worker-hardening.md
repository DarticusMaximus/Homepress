# Feature 03: Worker hardening

## Intent

The worker must refuse to fetch internal/LAN/metadata targets an attacker-controlled feed points it at (including DNS-rebinding tricks), and one hard worker kill must never permanently halt a newsletter — plus two code-hygiene findings — closing audit findings S10, S11, C2, N2, N4.

## Spec

### 1. Routability gate hardening — `shared/src/feeds/ssrf.ts` (S11)

- `isPubliclyRoutableUrl` **fails closed** on resolver errors: the `catch` around `resolve(host)` returns `{ ok: false, reason: "URL host could not be resolved" }` (new const `REASON_UNRESOLVABLE`) instead of `{ ok: true }`. Behavior change: feed create/update/test now rejects hostnames that do not resolve (correct — they cannot be fetched anyway).
- `isBlockedIpv6` gains two embedded-IPv4 decodings **before** the existing mapped-form check:
  - **NAT64** `64:ff9b::/96`: embedded IPv4 = low 32 bits → blocked iff `isBlockedIpv4(value & 0xffffffffn)`.
  - **6to4** `2002::/16`: embedded IPv4 = bits 80–111 → blocked iff `isBlockedIpv4((value >> 80n) & 0xffffffffn)`.
  - Both stay **allowed** when the embedded IPv4 is public (e.g. `64:ff9b::5db8:d822`, `2002:5db8:d822::`) — only blocked-range encodings are refused.
- Export `isBlockedAddress(address: string): boolean` for reuse by the fetch-time guard (Task 2). `ssrf.ts` imports only `node:dns/promises`, so `pipeline → feeds/ssrf` adds no import cycle (`feeds/qualify.ts → pipeline` barrel is unaffected).

### 2. Fetch-time SSRF guard — `shared/src/pipeline/fetch-safety.ts` (S10 core)

Add `undici` (caret, current 7.x) to `shared/package.json` dependencies; it bundles fine under the worker's esbuild config (externals list unchanged — undici is pure JS).

- New error `BlockedTargetError extends UnsafeUrlError` carrying `reason: "blocked-range" | "unresolvable"`. Existing classification flows on unchanged: `classifyFetchError` already maps `UnsafeUrlError` → `BlockedError` feed failure; the scraper already degrades fetch errors to fallback content.
- `FetchWithSizeLimitOptions` gains `allowPrivateTarget?: boolean` (default `false`) and `resolver?: DnsResolver` (type imported from `../feeds/ssrf`; default = real `dns.lookup { all: true }`).
- When `allowPrivateTarget` is false, `fetchWithSizeLimit` enforces a **pre-flight check** plus a **pinned connection**:
  - Pre-flight: strip `[]` from the hostname; literal IPv4/IPv6 → `isBlockedAddress` (no DNS). Hostname → resolve via the resolver: throw/error/empty → `BlockedTargetError("unresolvable")`; any resolved address blocked → `BlockedTargetError("blocked-range")`.
  - Pinning: fetch with `dispatcher: new Agent({ connect: { lookup: createPinnedLookup(resolver) } })`. `createPinnedLookup` is exported for direct unit testing: it resolves via the same resolver, filters addresses through `isBlockedAddress`, picks the first safe address honoring `options.family` when set, and errors when none remain — handling both the default single-address callback form and the `options.all` array form of undici's connect-lookup contract. Its return type is bound at the `new Agent({ connect: { lookup } })` site against undici's lookup type — **no cast there**, so TypeScript enforces the `(hostname, options, callback)` signature; only the `fetch` init keeps a cast for `dispatcher` (`RequestInit` types lack it). The validated address returned by the lookup IS the address undici connects to — closing the resolve-then-fetch TOCTOU (DNS rebinding).
  - When `allowPrivateTarget` is true: skip both — plain fetch, exactly today's behavior.
- Update the file-top comment: the feature-08 "private IPs intentionally NOT blocked" decision is superseded by this feature; blocking is per-fetch opt-out (per-feed flag, Task 4), not global.
- This guard covers every feed and article fetch in **both** worker (runs) and web (feed qualification) because both funnel through `fetchWithSizeLimit`. Redirects stay fully blocked (`redirect: "error"` — unchanged, the one mitigation the audit confirmed holds).

### 3. Per-feed trust threading through the pipeline (S10)

Policy (PM-confirmed): a feed flagged internal is fully trusted — **its own URL and its articles' links** may resolve to private targets. All other fetch targets must be publicly routable.

- `Article` (`shared/src/pipeline/types.ts`) gains optional `feedUrl?: string` — the machine join key article→feed. `source` (feed title) stays unchanged for display/drafter prompt.
- `RSSFetcherOptions` gains `privateFeedUrls?: ReadonlySet<string>`. `fetchOneFeed` computes `allowPrivateTarget = options.privateFeedUrls?.has(feedUrl) ?? false`, passes it to `fetchWithSizeLimit`, and stamps every collected article with `feedUrl` (thread through `createArticle`, which gains the optional field).
- Scraper: `scrapeAll`/`RSSScraper.scrape`/`scrapeArticle` inputs gain `allowPrivateTarget?: boolean` (new optional third/options param on `scrapeArticle(url, fallbackContent, opts?)`), forwarded to `fetchWithSizeLimit`. A blocked target is a normal scrape failure → fallback content with a short `"blocked"` error token, run continues.
- Run config: `buildPipelineConfigForNewsletter` (`shared/src/runs/start.ts`) returns `privateFeedUrls: string[]` — the URLs of attached feeds with `allowPrivateNetwork === true` (it already loads the attached feed documents).
- `executeRun` (`shared/src/runs/execute-run.ts`): fetch phase passes `privateFeedUrls: new Set(config.privateFeedUrls)` into the fetcher; scrape phase maps each article to `{ url, fallbackContent, allowPrivateTarget: config.privateFeedUrls.includes(a.feedUrl ?? "") }`. Orchestrator option types (`PipelineOptions.fetcher`/`.scraper`) updated to match.
- Checkpoint resume: `ArticleJson` (`shared/src/runs/types.ts`, ~line 68) and `CheckpointArticle` (~line 169) gain `feedUrl?`, and the checkpoint save/parse mapping in `shared/src/runs/repository.ts` (the `reviveArticleDate` path, ~lines 844/849) carries it, so a scrape-phase resume keeps per-article permissions. Old checkpoints without the field resume as public-only — the safe direction.

### 4. Feed flag end-to-end (S10 opt-out)

- Schema: Feeds collection attributes (`shared/src/schema/declarations.ts`, after `notes`) gain `{ key: "allowPrivateNetwork", type: "boolean", required: false, default: false }`. Provisioner applies it on next boot; existing documents default false.
- `Feed` type: `allowPrivateNetwork: boolean` (coerced `Boolean(...)` in `documentToFeed`); `CreateFeedInput`/`UpdateFeedInput` gain optional `allowPrivateNetwork?: boolean`; repository persists it.
- Validation (`shared/src/feeds/validation.ts`): `validateFeedUrl` gains `allowPrivate?: boolean` — when true, skip the routability check (length/format checks stay). create/update pass the input's flag through.
- Qualification (`shared/src/feeds/qualify.ts`): `qualifyFeed(url, { allowPrivate })` — skips the routability pre-check and threads `allowPrivateTarget` into its `fetchFeeds`/`scrapeArticle` calls so a flagged feed's test actually fetches the internal URL.
- GUI: `feed-form-dialog.tsx` gains a checkbox ("Internal feed — may fetch private/LAN addresses", default off) included in create, update, and test payloads; `feeds-table.tsx` and `feed-list-card.tsx` show an "Internal" badge when set (both presentations — responsive domain-list pin). `web/app/(protected)/admin/feeds/actions.ts`: `createFeedAction`/`updateFeedAction` accept and forward the flag; `testFeed` forwards it to `qualifyFeed`.

### 5. Stale-run reaper (C2)

- Schema: Runs attributes gain `{ key: "lastHeartbeatAt", type: "datetime", required: false }` (after `endedAt`). `Run` type + `documentToRun` map it (`string | null`, missing → null).
- `executeRun` writes a heartbeat: after the first `markRunning` call, perform an **immediate** `touchRunHeartbeat` write, then `setInterval(HEARTBEAT_RUN_MS = 30_000)` calling `touchRunHeartbeat` (`shared/src/runs/repository.ts` — `updateDocument` of `lastHeartbeatAt` only); failures are caught, logged via `sanitizeAppwriteMessageForLog`, never fatal. The interval is cleared in the function's outer `finally`. The immediate write is required: `startedAt` is stamped at run **creation** (pending), not claim — a run that sat queued longer than `staleMs` would otherwise be reap-able for up to 30s after claim (null heartbeat + already-stale `startedAt` fallback) until the first tick.
- New `shared/src/runs/stale-run-reaper.ts`: `sweepStaleRuns(client, opts?)` — default `staleMs = 300_000`; injectable `{ staleMs, now, listRuns, markFailed, onLog }`. Lists runs `{ status: "running", limit: 100 }`; for each, `lastBeat = Date.parse(run.lastHeartbeatAt ?? run.startedAt)`; when `now - lastBeat > staleMs` → `markFailed` with `failedPhase = run.currentPhase || "fetch"` (the **true persisted in-flight phase**) and message `Run marked failed by stale-run reaper: heartbeat lost during "<phase>" phase (worker crash or heartbeat stall)`. Per-run errors are logged and isolated; returns `{ swept }`.
- Worker wiring (`worker/src/index.ts`): run `sweepStaleRuns` once at boot **before** `poller.start()` (a zombie must not block the first claim), then on every existing heartbeat tick (`WORKER_HEARTBEAT_MS`, default 30s) alongside the log line. New env `WORKER_STALE_RUN_MS` (default 300000, floor 60000, parsed with the `parseSchedulePollMs` fallback/clamp/log pattern); `.env.example` gains a commented `# WORKER_STALE_RUN_MS=300000` after `WORKER_RETENTION_POLL_MS`.
- Graceful shutdown (`worker/src/run-poller.ts`): `PollerDeps` gains `getRun`; `shutdown()` reads the run's persisted `currentPhase` (fallback `"fetch"`) instead of the hardcoded `"fetch"` at line 125. `worker/src/index.ts` passes `getRun`; docs comment: the sweep is for the ungraceful case only.

Policy (PM-confirmed): a reaped run is marked failed, **not** auto-retried — the operator sees the failure; the newsletter's next scheduled/manual run proceeds unblocked because `shouldClaim` no longer sees a `running` sibling.

### 6. Worker hygiene (N2, N4)

- `shared/src/newsletters/due-check.ts`: delete `resetConsumedScheduleFiresForTests` (lines 65–68). The module-level `defaultConsumedFires` Set stays (it is the intended process-lifetime consume ledger); tests now inject a fresh ledger per case via the existing `opts.consumedFires` seam. No `*ForTests` export remains in `shared/src`.
- `worker/src/index.ts`: delete the smoke-placeholder block (lines 23–58) and the `pipeline smoke:` log (lines 94–96), plus every import that becomes unused (`Article` type, `getModelName`, `sanitizeUrlForLog`, `scrapeArticle`, `ArticleTagger`/`LLMClient`/`ArticleScorer`/`MMRSelector` types, `runPipeline`, `NewsletterDrafter`). Startup log keeps only true statements.

### 7. Audit bookkeeping

Tick the `S10-20260917`, `S11-20260917`, `C2-20260917`, `N2-20260917`, `N4-20260917` checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings (Plan.md carry-forward pin).

## Dependencies

- None code-wise — independent of Features 01/02 (may run before or after). Stage 15 complete (stage-level dependency satisfied).

## Constraints

- Single-worker deployment assumption stands (audit C3 deferred by Plan pin) — the reaper does not introduce multi-worker safety.
- Per-feed flag is the **only** opt-out — no global env bypass (PM decision replacing the audit's `ALLOW_PRIVATE_FEED_FETCH` suggestion).
- `redirect: "error"` stays — redirects remain fully blocked.
- Blocking is never run-fatal: a blocked feed becomes a `BlockedError` `FeedFailure`; a blocked article becomes fallback content (existing error-isolation invariants).
- `Article.source` semantics (feed title) unchanged; `feedUrl` is additive/optional.
- Old checkpoints lacking `feedUrl` resume as public-only (safe direction). Old runs lacking `lastHeartbeatAt` fall back to `startedAt`; the immediate claim-time heartbeat write prevents a false-positive reap of a freshly claimed run that sat pending past the timeout.
- Drafter/LLM fetch path (`api.openrouter.ai`) is operator-configured and untouched — the guard lives only in `fetchWithSizeLimit`.
- Worker esbuild externals list unchanged; `undici` bundles (pure JS).
- No GUI changes beyond the feed form checkbox + badge; responsive table/card convention respected.

## Acceptance criteria

- [ ] Feed or article fetch of any URL whose effective connection target resolves to private/loopback/link-local/metadata space is refused with a structured `BlockedTargetError` — across IPv4, IPv6, mapped (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`), and DNS-rebinding sequences — unless the feed is flagged `allowPrivateNetwork`; the guarded path demonstrably passes a `dispatcher` to `fetch` (wiring asserted; `createPinnedLookup` typed against undici's contract at the Agent binding, no cast). (S10, S11)
- [ ] `isPubliclyRoutableUrl` returns `ok:false` (unresolvable) when DNS resolution throws; public-embedded NAT64/6to4 addresses stay allowed. (S11)
- [ ] A feed flagged internal: passes create/update/test validation, its URL fetches private targets, and its articles' links fetch private targets; unflagged feeds/articles cannot — all asserted with hermetic resolver-injected tests. (S10)
- [ ] A run left `running` with a stale heartbeat auto-fails within one sweep interval, records the true persisted `currentPhase`, and that newsletter's next run executes without manual intervention (mocked repository). (C2)
- [ ] Graceful shutdown marks the failed run with the persisted phase, not hardcoded `"fetch"`. (C2)
- [ ] No `*ForTests` export exists in `shared/src`; no "pipeline smoke" log or placeholder constants remain in `worker/src/index.ts`. (N2, N4)
- [ ] S10, S11, C2, N2, N4 checkboxes ticked in the audit report.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.

## Files

- Create: `shared/src/feeds/__tests__/ssrf.test.ts`
- Create: `shared/src/runs/stale-run-reaper.ts`
- Create: `shared/src/runs/__tests__/stale-run-reaper.test.ts`
- Create: `web/src/__tests__/feed-form-dialog.test.tsx`
- Modify: `shared/package.json` (+`undici`)
- Modify: `shared/src/feeds/ssrf.ts`
- Modify: `shared/src/feeds/types.ts`
- Modify: `shared/src/feeds/repository.ts`
- Modify: `shared/src/feeds/validation.ts`
- Modify: `shared/src/feeds/qualify.ts`
- Modify: `shared/src/feeds/__tests__/{validation,qualify}.test.ts`
- Modify: `shared/src/pipeline/types.ts`
- Modify: `shared/src/pipeline/fetch-safety.ts`
- Modify: `shared/src/pipeline/__tests__/fetch-safety.test.ts`
- Modify: `shared/src/pipeline/rss-fetcher.ts`
- Modify: `shared/src/pipeline/__tests__/rss-fetcher.test.ts`
- Modify: `shared/src/pipeline/scraper.ts` (+ its test file)
- Modify: `shared/src/pipeline/orchestrator.ts` (option types only)
- Modify: `shared/src/runs/types.ts`
- Modify: `shared/src/runs/repository.ts`
- Modify: `shared/src/runs/start.ts`
- Modify: `shared/src/runs/execute-run.ts` (+ `execute-run.test.ts`)
- Modify: `shared/src/newsletters/due-check.ts` (+ `due-check.test.ts`)
- Modify: `shared/src/schema/declarations.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/run-poller.ts` (+ `run-poller.test.ts`)
- Modify: `web/app/(protected)/admin/feeds/actions.ts`
- Modify: `web/components/feeds/{feed-form-dialog,feeds-table,feed-list-card}.tsx`
- Modify: `.env.example`
- Modify: `.ssc/reviews/review-app-public-exposure-2026-09-17.md` (tick S10, S11, C2, N2, N4)

## Testing approach

Test-first throughout (all hermetic via the `DnsResolver` injection seam — no real DNS, no real sockets):

- **`ssrf.test.ts` (S11):** resolver-throws → `ok:false` unresolvable; `64:ff9b::7f00:1`/`64:ff9b::a00:5`/`2002:a00:5::`/`2002:7f00:1::` → blocked; public-embedded `64:ff9b::5db8:d822`/`2002:5db8:d822::` → allowed; every existing blocked family sample (`127.0.0.1`, `10.x`, `169.254.169.254`, `[::1]`, `[::ffff:10.0.0.5]`, …) via `isPubliclyRoutableUrl`; mixed public+private resolver answer → blocked; literal metadata hostname `metadata.google.internal` → blocked via existing literal path.
- **`fetch-safety.test.ts` (S10):** existing cases keep passing with an injected public resolver (`async () => ["93.184.216.34"]`). New: literal-IP URLs (`http://127.0.0.1:8080/x`, `http://10.0.0.5/y`, `http://[::1]/z`, `http://[::ffff:10.0.0.5]/z`, `http://169.254.169.254/latest/meta-data`) throw `BlockedTargetError` with no resolver call; hostname resolving (via mock) to each blocked form → `blocked-range`; resolver throwing → `unresolvable`; `allowPrivateTarget: true` bypasses (mock fetch called normally); **wiring assertions** — the guarded path's mocked `fetch` receives an init carrying a `dispatcher`, and the `allowPrivateTarget` path receives none (a mocked fetch silently ignoring the dispatcher is exactly the failure mode these guard against); `createPinnedLookup` unit tests — rebinding sequence (first lookup public, second private) errors on the second; family preference honored; all-blocked → error.
- **`rss-fetcher.test.ts`:** feed URL in `privateFeedUrls` set + private resolver answer → fetch proceeds (mock fetch invoked); not in set + private answer → `BlockedError` feed failure with sanitized message; collected articles carry `feedUrl`.
- **Scraper tests:** `allowPrivateTarget` forwarded (blocked target → fallback + `"blocked"` error token; allowed → extracted).
- **`execute-run.test.ts`:** injected fetcher receives `privateFeedUrls`; injected scraper receives per-article `allowPrivateTarget` derived from `article.feedUrl`; a heartbeat write fires **immediately at claim** and then on the interval (fake timers or injected interval fn — follow the file's existing timer patterns); outer finally clears it.
- **`stale-run-reaper.test.ts` (C2):** fresh `lastHeartbeatAt` → not swept; stale `lastHeartbeatAt` → `markFailed` with persisted `currentPhase` (e.g. `"draft"`) and reaper message; null `lastHeartbeatAt` + recent `startedAt` → not swept; null + old `startedAt` → swept (pre-upgrade zombie); `markFailed` throwing → isolated, other runs still swept.
- **`run-poller.test.ts`:** shutdown mid-run marks failed with the run's persisted phase (mock `getRun`), not `"fetch"`.
- **`validation.test.ts` / `qualify.test.ts`:** `allowPrivate` skips routability rejection; qualify threads `allowPrivateTarget` into fetch/scrape deps (assert via injected spies).
- **`feed-form-dialog.test.tsx`:** checkbox unchecked by default; checked state submits `allowPrivateNetwork: true` on create/update/test.
- **`due-check.test.ts`:** all cases pass with per-case injected `new Set()` ledgers; `rg -n "ForTests" shared/src` returns nothing.

## Tasks

### Task 1: ssrf.ts fail-closed + NAT64/6to4 (S11) — red then green

- **Action**: Create `shared/src/feeds/__tests__/ssrf.test.ts` per Testing approach; run it (resolver-throws and NAT64/6to4 cases fail today). Then edit `shared/src/feeds/ssrf.ts`: fail-closed catch with `REASON_UNRESOLVABLE`, NAT64/6to4 decoding in `isBlockedIpv6`, export `isBlockedAddress`.
- **Expected result**: All `ssrf.test.ts` cases green; existing `qualify.test.ts`/`validation.test.ts` still green (note: any existing case asserting fail-open DNS behavior is updated to the new fail-closed contract, with a handoff note).
- **Verify**: `pnpm vitest run shared/src/feeds/__tests__/ssrf.test.ts shared/src/feeds/__tests__` passes.
- **Depends on**: none.

### Task 2: fetch-time guard + pinned lookup (S10 core) — red then green

- **Action**: Add `undici` to `shared/package.json` (+ lockfile via pnpm). Extend `shared/src/pipeline/__tests__/fetch-safety.test.ts` with the S10 matrix (blocklist literals, resolver-driven blocks, unresolvable, opt-out bypass, `createPinnedLookup` units) and convert existing cases to the injected public resolver — red run first. Then implement Spec §2 in `shared/src/pipeline/fetch-safety.ts` (`BlockedTargetError`, options, pre-flight, `createPinnedLookup`, dispatcher cast, updated file-top comment).
- **Expected result**: Guard active by default on every `fetchWithSizeLimit` call; opt-out flag exists; all fetch-safety tests green.
- **Verify**: `pnpm vitest run shared/src/pipeline/__tests__/fetch-safety.test.ts` passes; `pnpm -r exec tsc --noEmit -p shared` (or `pnpm typecheck`) passes with the dispatcher cast.
- **Depends on**: Task 1 (exports `isBlockedAddress`).

### Task 3: pipeline trust threading — red then green

- **Action**: Extend `rss-fetcher.test.ts`, scraper tests, and `execute-run.test.ts` with the propagation cases (red — fields/options don't exist). Then implement Spec §3: `Article.feedUrl`, `RSSFetcherOptions.privateFeedUrls`, `createArticle` passthrough, scraper input flag + `scrapeArticle` opts param, `config.privateFeedUrls` in `start.ts`, `executeRun` wiring, orchestrator option types, `ArticleJson`/`CheckpointArticle` + checkpoint save/parse `feedUrl`.
- **Expected result**: Flagged-feed URLs and their articles fetch private targets; everything else is guarded; resume keeps permissions.
- **Verify**: `pnpm vitest run shared/src/pipeline shared/src/runs/__tests__/execute-run.test.ts` passes.
- **Depends on**: Task 2.

### Task 4: feed flag schema + GUI — red then green

- **Action**: Extend `validation.test.ts`, `qualify.test.ts`, and create `web/src/__tests__/feed-form-dialog.test.tsx` (red). Then implement Spec §4: declarations attribute, `Feed` type + repository persist/coerce, `validateFeedUrl` allowPrivate skip, `qualifyFeed` allowPrivate threading, web actions forwarding, form checkbox, table + card badge.
- **Expected result**: An operator can create, test, and edit an internal feed end-to-end; the flag is visible in both list presentations.
- **Verify**: `pnpm vitest run shared/src/feeds web/src/__tests__/feed-form-dialog.test.tsx` passes; `rg -n "allowPrivateNetwork" shared/src/schema/declarations.ts shared/src/feeds/types.ts web/components/feeds` hits all surfaces.
- **Depends on**: Task 3 (qualify threads into pipeline options).

### Task 5: stale-run reaper (C2) — red then green

- **Action**: Create `shared/src/runs/__tests__/stale-run-reaper.test.ts` (red). Then implement Spec §5: declarations `lastHeartbeatAt`, `Run` type + `documentToRun`, `touchRunHeartbeat`, `executeRun` immediate-at-claim + interval heartbeat writes with finally clear, `stale-run-reaper.ts`, worker boot + heartbeat-tick wiring with `WORKER_STALE_RUN_MS` parsing (floor 60000) and `.env.example` entry, `run-poller.ts` shutdown true-phase via `getRun` dep (+ `index.ts` wiring, `run-poller.test.ts` update).
- **Expected result**: Zombies auto-fail with the true phase; next run claims cleanly; shutdown records the real phase.
- **Verify**: `pnpm vitest run shared/src/runs/__tests__/stale-run-reaper.test.ts worker/src/__tests__/run-poller.test.ts` passes; `rg -n "lastHeartbeatAt" shared/src/schema/declarations.ts shared/src/runs` hits schema/type/repo/execute-run; `rg -n "WORKER_STALE_RUN_MS" .env.example worker/src/index.ts` hits both.
- **Depends on**: none (ordered after Task 4 for a linear chain).

### Task 6: hygiene (N2 + N4)

- **Action**: Update `due-check.test.ts` to per-case injected ledgers; delete `resetConsumedScheduleFiresForTests` from `shared/src/newsletters/due-check.ts`. Delete the worker smoke block, smoke log, and newly unused imports in `worker/src/index.ts`.
- **Expected result**: No test seam exports; startup log truthful; no dead imports.
- **Verify**: `rg -n "ForTests" shared/src` → no matches; `rg -n "pipeline smoke" worker/src` → no matches; `pnpm vitest run shared/src/newsletters` passes; `pnpm typecheck` passes (proves no dangling imports).
- **Depends on**: none.

### Task 7: full gates + audit ticks

- **Action**: Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all must pass). Tick the S10-20260917, S11-20260917, C2-20260917, N2-20260917, N4-20260917 checkboxes in `.ssc/reviews/review-app-public-exposure-2026-09-17.md` → Detailed Findings.
- **Expected result**: All gates green; audit report reflects the five findings remediated.
- **Verify**: Three commands exit zero; the report shows `[x]` for all five IDs.
- **Depends on**: Tasks 1–6.

## Feature verification

- Run: `pnpm typecheck && pnpm lint && pnpm test`
- Expected: All exit zero. Within `pnpm test`: `ssrf.test.ts` proves fail-closed DNS + NAT64/6to4 encodings; `fetch-safety.test.ts` proves the blocklist matrix, rebinding refusal, and opt-out; rss-fetcher/scraper/execute-run tests prove per-feed + per-article trust propagation including resume; `stale-run-reaper.test.ts` proves zombies auto-fail with the true phase; `run-poller.test.ts` proves shutdown records the persisted phase; `rg -n "ForTests" shared/src` and `rg -n "pipeline smoke" worker/src` return nothing. Supporting probes: `rg -n "allowPrivateNetwork" shared/src/schema/declarations.ts web/components/feeds` (schema + form + badges); `rg -n "WORKER_STALE_RUN_MS" .env.example worker/src/index.ts`.

## Handoff

Report to the manager: files created/modified; red-run evidence for Tasks 1–5 (which assertions failed pre-implementation); the undici version added; result of a **one-time loopback smoke of the real fetch + dispatcher path** (throwaway script fetching a real loopback URL, expecting `BlockedTargetError` — mocked fetch cannot prove Node's global fetch honors an npm-undici dispatcher, the silent-ignore failure mode; delete the script after); any existing tests whose DNS-behavior expectations changed to the fail-closed contract; confirmation that blocked fetches degrade per error-isolation invariants (feed → `BlockedError` failure, article → fallback); any deviations from this spec and why (e.g. Appwrite boolean default handling, dispatcher typing workarounds — guard semantics must not weaken).

## Research note

- Codebase reads (2026-09-17): `fetch-safety.ts` (guard insertion point + superseded feature-08 comment), `ssrf.ts` (fail-open catch at 236–239; blocklists at 95–120; no NAT64/6to4), `rss-fetcher.ts` (`fetchOneFeed` 107–130; `article.source = feed.title ?? feedUrl` at 159/176 — drove the `Article.feedUrl` join-key decision), `scraper.ts` (scrape/scrapeArticle signatures; single `fetchWithSizeLimit` call path), `execute-run.ts` (`markRunning` before each phase at 404/453/484/554/622/705 — persisted `currentPhase` is accurate per phase boundary; fetcher/scraper call sites at 405/456–460), `run-poller.ts` (shouldClaim 21–34, hardcoded shutdown phase 125), `worker/index.ts` (log-only heartbeat 177–184; smoke block 23–58), `due-check.ts` (module ledger + `opts.consumedFires` seam), `start.ts` (`buildPipelineConfigForNewsletter` loads attached feeds), declarations (Feeds attrs 122–136; Runs attrs incl. no heartbeat field), `Run` type (no `$updatedAt` — hence `startedAt` fallback).
- DNS-pinning pattern verified against current practice (web search 2026-09-17: nodejs/undici#2019, vercel-labs/guarded-fetch, UniAuth "DNS-rebinding-safe HTTP client" 2026-02): `Agent({ connect: { lookup } })` passed as fetch `dispatcher` is the established pattern; validating inside the lookup makes validated address = connected address (no TOCTOU). PM decisions: per-feed flag (over global env), full article-link propagation, 5-min default timeout + `WORKER_STALE_RUN_MS`, reaped runs fail without auto-retry.
