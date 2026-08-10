# Feature 01: Pipeline types & config model

## Intent
Establish the shared TypeScript vocabulary every stage-01 pipeline feature imports — article, tagged article, scored article, selected article, newsletter config, per-phase results, plus the config helpers (model defaults, date-range, score threshold) — so that fetcher, scraper, tagger, scorer, MMR, and drafter features build against one fixed shape instead of each redefining it. Defined in `shared/` (the engine's home) before any phase logic exists, making the engine self-describing without a UI or persistence layer.

## Spec
A `shared/src/pipeline/` module containing two files: `types.ts` (the domain types and factory/guard functions) and `config.ts` (defaults + helpers). The types mirror the legacy Python pipeline's data shapes faithfully — `Article` (title, link, published, content, source), `TaggedArticle` (Article + tags), `ScoredArticle` (TaggedArticle + score + optional embedding), `SelectedArticle` (ScoredArticle chosen by MMR), `NewsletterConfig` (name, topics, dislikedTopics, audience, newsItems, feeds, dateRange, interPhaseDelaySeconds — the fields stage 02 will later persist to Appwrite), and one `PhaseResult` interface per phase (`FetchResult`, `TagResult`, `ScoreResult`, `SelectionResult`, `DraftResult`) carrying both the successes and the structured per-item/per-feed failures that stage 03's run records will consume. The config module ports `DEFAULT_MODELS` (tagger/scorer = `nvidia/nemotron-3-nano-30b-a3b`, drafter = `google/gemini-3-flash-preview`, embedder = `google/gemini-embedding-001`), `DEFAULT_TIMEOUT_MS` (60000), `DEFAULT_MAX_RETRIES` (3), `DEFAULT_MAX_CONTENT_LENGTH` (70000), `DEFAULT_SCORE_THRESHOLD` (7.0), `getModelName(component)` with env-var overrides (`TAGGER_MODEL`/`SCORER_MODEL`/`DRAFTER_MODEL`/`EMBED_MODEL`), `getDateFilter(range)` returning `{ start: Date; end: Date | null }` for `yesterday` | `last_3_days` | `last_week` | `all`, and `parseScoreThreshold(value)` clamping to `[0, 10]` with a 7.0 fallback on invalid input. All exported from `@newsletter/shared` via `shared/src/index.ts`.

## Dependencies
- Builds on: stage-00 `@newsletter/shared` workspace package (provides the package shell, `src/index.ts`, and `tsconfig.json` extending the strict base). If stage 00 is not yet verified, this feature cannot be executed — only specced.

## Constraints
- TypeScript `strict: true` — no `any` in exported signatures; use `unknown` + guards where the legacy used untyped dicts.
- Shapes must match the legacy Python pipeline's field names (snake_case → camelCase is fine, but the set of fields and their semantics must not drift) so the parity check in feature 07 is valid.
- No runtime LLM calls, no network, no Appwrite, no persistence — this is pure types + pure config helpers.
- No newsletter-specific business logic (no fetching, no scoring algorithm) — only the data shapes and the config-lookup helpers.
- `getDateFilter` must be timezone-aware via the `TZ` env var (mirroring legacy `config/settings.get_timezone`); default UTC when unset or when `Intl` cannot resolve the zone.
- Model defaults must be byte-identical to the legacy `DEFAULT_MODELS` dict — parity depends on it.
- Do not introduce fields the legacy pipeline did not have (e.g. per-newsletter model overrides, lookback windows) — those belong to later stages and would prematurely lock the shape.

## Acceptance criteria
- [ ] `shared/src/pipeline/types.ts` exports `Article`, `TaggedArticle`, `ScoredArticle`, `SelectedArticle`, `NewsletterConfig`, `FetchResult`, `TagResult`, `ScoreResult`, `SelectionResult`, `DraftResult`, `FeedFailure`, and `PhaseName` types, plus factory functions (`createArticle`, `createNewsletterConfig`) and type guards (`isTaggedArticle`, `isScoredArticle`).
- [ ] `shared/src/pipeline/config.ts` exports `DEFAULT_MODELS`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES`, `DEFAULT_MAX_CONTENT_LENGTH`, `DEFAULT_SCORE_THRESHOLD`, `getModelName`, `getDateFilter`, `parseScoreThreshold`, and the `DateRange` literal type.
- [ ] `DEFAULT_MODELS` values are byte-identical to the legacy Python `DEFAULT_MODELS` dict.
- [ ] `getModelName('tagger')` returns the default when no env var is set, and returns the env value when `TAGGER_MODEL` is set (same for scorer/drafter/embedder).
- [ ] `getDateFilter('yesterday')` returns a range spanning the prior calendar day (00:00:00 to 23:59:59.999 in the resolved tz); `getDateFilter('all')` returns `end: null`.
- [ ] `parseScoreThreshold('7.0')` returns 7.0; `parseScoreThreshold('15')` clamps to 10; `parseScoreThreshold('notanumber')` returns 7.0; `parseScoreThreshold('-2')` clamps to 0.
- [ ] `createNewsletterConfig` rejects (throws) a config missing `feeds` or `topics`, mirroring the legacy `ConfigurationError` guard.
- [ ] `pnpm --filter @newsletter/shared exec tsc --noEmit` passes with zero errors under strict mode.
- [ ] `pnpm --filter @newsletter/shared test` passes — all config + factory unit tests green.
- [ ] A smoke import from `worker/src/index.ts` of at least one type and one helper from `@newsletter/shared` compiles (proves the package exports resolve).

## Files
- Create: `shared/src/pipeline/types.ts`
- Create: `shared/src/pipeline/config.ts`
- Create: `shared/src/pipeline/index.ts` (re-exports `types` + `config`)
- Modify: `shared/src/index.ts` (re-export `./pipeline`)
- Create: `shared/src/pipeline/__tests__/types.test.ts`
- Create: `shared/src/pipeline/__tests__/config.test.ts`
- Modify: `shared/package.json` (add Vitest devDep + `test` script, if stage 00 did not already add it)
- Modify: `worker/src/index.ts` (add a smoke import of one type + one helper from `@newsletter/shared`, referenced so it compiles)

## Testing approach
Test-first. Unit tests exist and fail before implementation, verifying behavior described in the Intent (the config helpers and factories behave like the legacy pipeline's; the types are the shared contract).

`shared/src/pipeline/__tests__/config.test.ts`:
- `getModelName` returns each component's default when its env var is unset.
- `getModelName` returns the env value when the env var is set (use `vi.stubEnv` / `process.env` override in the test, restore after).
- `DEFAULT_MODELS` deep-equals the legacy dict literal (assert exact string values).
- `getDateFilter('yesterday')`: `start` is prior day 00:00:00, `end` is prior day 23:59:59.999, both in the resolved tz; `start <= end`.
- `getDateFilter('last_3_days')`: `start` ≈ now−3d, `end` ≈ now.
- `getDateFilter('last_week')`: `start` ≈ now−7d, `end` ≈ now.
- `getDateFilter('all')`: `end` is `null`.
- `getDateFilter(unknown value)` falls back to the `yesterday` range.
- `parseScoreThreshold` cases: `'7.0'`→7, `'15'`→10 (clamp), `'-2'`→0 (clamp), `'notanumber'`→7 (fallback), `''`→7 (fallback).

`shared/src/pipeline/__tests__/types.test.ts`:
- `createArticle` produces an `Article` with all required fields; rejects on missing `title`/`link` (the legacy always had these, defaulting to `''` — assert the chosen behavior explicitly: the spec says factories reject missing required fields, so `title` and `link` must be present strings).
- `createNewsletterConfig` throws when `feeds` is empty or missing; throws when `topics` is empty or missing; accepts a minimal valid config and fills defaults (`dislikedTopics: []`, `audience: ''`, `newsItems: 16`, `dateRange: 'yesterday'`, `interPhaseDelaySeconds: 3`) matching legacy defaults.
- `isTaggedArticle` narrows an `Article`-shaped object that has `tags: string[]` and rejects one without.
- `isScoredArticle` narrows a `TaggedArticle`-shaped object that has `score: number` and rejects one without.
- Compile-time: a `ScoredArticle` is assignable to `TaggedArticle` is assignable to `Article` (structural progression) — expressed as a type-level test (`const _check: Article = scoredArticle;` in a `.test-d.ts` or inline `// @ts-expect-error` assertions).

Edge cases covered: env-var override isolation (one component's env var doesn't bleed into another), timezone fallback when `TZ` is unset, score-threshold clamp at both bounds, factory default-filling, structural assignability of the article-progression types.

## Tasks

### Task 1: Write failing config + types tests
- **Action:** Add Vitest to `shared/package.json` if not already present (devDep + `"test": "vitest run"` script). Create `shared/src/pipeline/__tests__/config.test.ts` and `shared/src/pipeline/__tests__/types.test.ts` with all the cases listed in the Testing approach, importing from `../config` and `../types` (which do not exist yet). Create empty placeholder `shared/src/pipeline/config.ts` and `shared/src/pipeline/types.ts` so the test files' imports resolve at the module level but every assertion fails (export nothing yet).
- **Expected result:** A test suite that compiles far enough to run and fails on every behavioral assertion, proving the contract is captured before any implementation.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — exits non-zero with assertion failures (not module-resolution errors). Confirm `shared/package.json` has a `test` script and Vitest as a devDep.
- **Depends on:** none.

### Task 2: Implement `config.ts`
- **Action:** Implement `shared/src/pipeline/config.ts`: export `DEFAULT_MODELS` (byte-identical to legacy), `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES`, `DEFAULT_MAX_CONTENT_LENGTH`, `DEFAULT_SCORE_THRESHOLD`, the `DateRange` literal type (`'yesterday' | 'last_3_days' | 'last_week' | 'all'`), `getModelName(component)` reading env vars (`TAGGER_MODEL`/`SCORER_MODEL`/`DRAFTER_MODEL`/`EMBED_MODEL`) with defaults, `getDateFilter(range)` resolving `TZ` via `Intl.DateTimeFormat` (fallback UTC) and returning `{ start: Date; end: Date | null }`, and `parseScoreThreshold(value)` clamping to `[0, 10]` with 7.0 fallback. Match legacy semantics exactly.
- **Expected result:** All config tests pass.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- __tests__/config.test.ts` (or the equivalent filter) — all config tests green. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors.
- **Depends on:** Task 1.

### Task 3: Implement `types.ts`
- **Action:** Implement `shared/src/pipeline/types.ts`: export the `Article`, `TaggedArticle`, `ScoredArticle`, `SelectedArticle` interfaces (structural progression — each extends the prior), `NewsletterConfig`, `FeedFailure`, `PhaseName`, and the five `PhaseResult` interfaces (`FetchResult`, `TagResult`, `ScoreResult`, `SelectionResult`, `DraftResult`). Implement `createArticle` (rejects missing `title`/`link`), `createNewsletterConfig` (rejects empty/missing `feeds`/`topics`, fills legacy defaults), and the type guards `isTaggedArticle` / `isScoredArticle`. No runtime LLM/network/persistence code.
- **Expected result:** All types tests pass; the article-progression is structurally sound.
- **Verify:** Run `pnpm --filter @newsletter/shared test -- __tests__/types.test.ts` — all types tests green. Run `pnpm --filter @newsletter/shared exec tsc --noEmit` — zero errors. Confirm a `ScoredArticle` value type-checks as both `TaggedArticle` and `Article` (via the type-level test).
- **Depends on:** Task 2.

### Task 4: Wire exports and smoke-verify cross-package resolution
- **Action:** Create `shared/src/pipeline/index.ts` re-exporting `./types` and `./config`. Modify `shared/src/index.ts` to re-export `./pipeline`. Modify `worker/src/index.ts` to add a referenced import of one type (e.g. `Article`) and one helper (e.g. `getModelName`) from `@newsletter/shared` so the import is exercised at compile time (do not start a process).
- **Expected result:** The full pipeline module is reachable as `@newsletter/shared`, and `worker` consumes it.
- **Verify:** Run `pnpm --filter @newsletter/shared test` — all tests green. Run `pnpm typecheck` — zero errors across `shared` and `worker`. Confirm `worker/src/index.ts` imports from `@newsletter/shared` and compiles.
- **Depends on:** Task 3.

## Feature verification
- Run: `pnpm install && pnpm --filter @newsletter/shared test && pnpm typecheck`
- Expected: Install resolves cleanly; the full Vitest suite in `shared` passes (config helpers behave like the legacy pipeline's; type factories and guards enforce the contract); `tsc --noEmit` passes with zero errors across `shared` and `worker` under strict mode; `worker/src/index.ts` successfully imports a type and a helper from `@newsletter/shared`. No LLM, network, Appwrite, or persistence code exists anywhere in `shared/src/pipeline/`.

## Handoff
When complete, the builder reports to the manager:
- The list of files created/modified (`shared/src/pipeline/{types,config,index}.ts`, `shared/src/pipeline/__tests__/{config,types}.test.ts`, `shared/src/index.ts`, `shared/package.json`, `worker/src/index.ts`).
- Confirmation that `pnpm --filter @newsletter/shared test` and `pnpm typecheck` both pass.
- The exact exported symbol names (types, factories, guards, config helpers) so features 02–07 can import them consistently.
- The legacy defaults ported (`DEFAULT_MODELS`, thresholds, date ranges) and confirmation they are byte-identical to the Python `DEFAULT_MODELS`.
- The chosen factory behavior for `createArticle` (which fields are required vs defaulted) and `createNewsletterConfig` (which fields are required vs defaulted), since later features depend on these contracts.
- Any deviation from this spec and the reason (e.g. a `Intl.DateTimeFormat` timezone edge case the legacy `pytz` path handled differently).