# Feature 02: Lookback topic load

## Intent

Load prior-issue topic summaries for a newsletter’s lookback window so later Stage 05 features can suppress recurring topics without opening Storage checkpoints — and so empty history or lookback `0` stays a clean no-op.

## Spec

Add a **shared, testable lookback topic loader** in `shared/src/runs/` that, given a `newsletterId` and integer `lookback` N, returns the parsed `topicSummary` entries from that newsletter’s **latest N completed runs** (same newsletter only). This feature owns load + parse + ordering only. It does **not** embed, suppress, write run-summary UI, or read the similarity threshold.

### Behavior contract

| Input / case | Behavior |
|--------------|----------|
| `lookback <= 0` | Return empty result **without** calling Appwrite. |
| `lookback >= 1`, no completed runs | Return empty `issues` / `topics` (no-op for consumers). |
| `lookback >= 1`, fewer than N completed | Return all completed runs that exist (length `< N`). |
| `lookback >= 1`, more than N completed | Return exactly the N most recent completed (see ordering). |
| Completed run with empty / missing `topicSummary` | Still counts toward the N issues; contributes **zero** topic items. |
| Malformed `topicSummary` JSON | Treat that run’s topics as `[]` (do not throw; do not fail the caller). |
| Failed / pending / running runs | Never included. |
| Other newsletters’ runs | Never included. |

### Ordering (must match retention’s “most recent completed”)

Same sort key as `buildProtectedCompletedSet` in `shared/src/runs/retention.ts`:

1. `endedAt || startedAt` descending (ISO string `localeCompare`)
2. Tie-break: `$id` descending

Do **not** rely on Appwrite `Query.orderDesc` (Stage 04 deliberately avoids orderDesc index dependency on `listRuns`). Fetch via existing `listRuns`, then sort + slice in memory.

### Fetch strategy

```ts
listRuns(client, {
  newsletterId,
  status: "completed",
  limit: Math.max(lookback, 100),
});
```

Use the default-scale floor of **100** (same as `listRuns`’s default) so under-fetch is unlikely for a single newsletter’s completed history within retention. After map/sort/slice to `lookback`, build the result. Do **not** raise retention’s protected floor; do **not** add new indexes.

### Public API

Create `shared/src/runs/lookback-topics.ts` and export from `shared/src/runs/index.ts` (barrel already re-exported via `shared/src/index.ts`).

```ts
/** One selected topic from a prior completed issue. */
export type LookbackTopic = {
  title: string;
  tags: string[];
  /** Run document id of the prior completed issue. */
  runId: string;
  /** ISO endedAt of that run, or null if missing. */
  runEndedAt: string | null;
  /** ISO startedAt of that run (always present on Run). */
  runStartedAt: string;
};

/** One prior completed issue in the lookback window (most recent first). */
export type LookbackIssue = {
  runId: string;
  endedAt: string | null;
  startedAt: string;
  topics: { title: string; tags: string[] }[];
};

export type LookbackTopicLoadResult = {
  /** Echo of the requested lookback (clamped only by caller; loader treats <=0 as empty). */
  lookback: number;
  /** Up to `lookback` completed issues, most recent first. */
  issues: LookbackIssue[];
  /** Flattened topics across `issues` (stable: issue order, then topic order within each). */
  topics: LookbackTopic[];
};

/**
 * Load lookback topics for cross-run suppression.
 * Pure no-op when lookback <= 0.
 */
export async function loadLookbackTopics(
  client: Client,
  opts: { newsletterId: string; lookback: number },
): Promise<LookbackTopicLoadResult>;
```

Also export **pure helpers** (same file) so unit tests do not need Appwrite:

- `parseRunTopicSummary(raw: string): { title: string; tags: string[] }[]` — `""` / whitespace / invalid JSON / non-array → `[]`; items missing string `title` or non-`string[]` `tags` are skipped (keep valid siblings).
- `selectLookbackCompletedRuns(runs: Run[], lookback: number): Run[]` — filter `status === "completed"`, sort as above, `slice(0, lookback)`; if `lookback <= 0` return `[]`.

`loadLookbackTopics` composes: early empty → `listRuns` → `selectLookbackCompletedRuns` → parse each `topicSummary` → build `issues` + flattened `topics`.

### Out of scope

- Reading newsletter documents / validating `lookback` bounds (feature 01 owns validation; caller passes N).
- Embedding or similarity compare (feature 03).
- Wiring into `execute-run` / `NewsletterConfig` / selection phase (feature 03).
- Run-summary suppress UI (feature 04) — but the return shape **must** carry `runId` + timestamps so feature 04 can label “which prior issue”.
- Similarity threshold `.env` (feature 05).
- Changing retention, checkpoints, or `markCompleted` schema.
- GUI / web package changes.

## Dependencies

- Builds on: Stage 04 `runs` collection + `topicSummary` on completed runs (`markCompleted`), `listRuns`, `Run` type.
- Builds on: feature-01-lookback-config for the semantic meaning of N (caller supplies validated `lookback`); this feature’s loader is callable with any integer N and does not require feature 01 code to exist at compile time beyond the shared convention.
- Soft: features 03–04 consume this API; they are not required to verify this feature.

## Constraints

- **Reuse** `listRuns` — do not invent a parallel Appwrite query path that depends on `orderDesc` indexes.
- **Same-newsletter only** — always filter `newsletterId`.
- **Completed only** — never pending/running/failed.
- **Do not fail the caller** on empty or corrupt `topicSummary` strings; degrade to empty topics for that run.
- **Do not change** retention constants, purge behavior, checkpoint Storage, or pipeline selection.
- **Do not wire** into `execute-run` in this feature.
- **Server-only** Appwrite access via API key client (same as other runs helpers).
- **Secrets:** never log API keys or full env dumps; if logging parse skips, sanitize like other runs code.

## Acceptance criteria

- [ ] `lookback <= 0` returns `{ lookback, issues: [], topics: [] }` with no Appwrite list call.
- [ ] With N ≥ 1 and K completed prior runs for that newsletter, result includes `min(N, K)` issues in most-recent-completed order (`endedAt||startedAt` desc, `$id` desc).
- [ ] Each issue’s `topics` match that run’s stored `topicSummary` JSON (`{ title, tags }[]`); flattened `topics` preserve issue order and include `runId` / `runEndedAt` / `runStartedAt`.
- [ ] Empty or malformed `topicSummary` on a completed run yields `topics: []` for that issue and does not throw.
- [ ] Failed/pending/running runs and other newsletters’ runs are excluded.
- [ ] No execute-run / suppress / threshold / GUI changes in this feature.
- [ ] `pnpm --filter @newsletter/shared test` (lookback + runs regression), `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass.

## Files

- Create: `shared/src/runs/lookback-topics.ts`
- Create: `shared/src/runs/__tests__/lookback-topics.test.ts`
- Modify: `shared/src/runs/index.ts` (re-export)
- Modify: `product_spec.md` (one-line Implemented features entry at handoff)

## Testing approach

**Test-first.** Pure helpers + mocked `listRuns` / Databases for the async loader. No Playwright. No PM GUI gate (no UI in this feature).

### `lookback-topics.test.ts`

**`parseRunTopicSummary`**

- `""` → `[]`
- Valid JSON array of `{ title, tags }` → parsed items
- Invalid JSON → `[]`
- Non-array JSON → `[]`
- Mixed valid/invalid items → only valid items kept

**`selectLookbackCompletedRuns`**

- `lookback <= 0` → `[]` even if completed runs exist
- Filters to `completed` only
- Orders by `endedAt||startedAt` desc, then `$id` desc (fixture where startedAt order ≠ endedAt order)
- `slice` to N; when K < N returns K
- Ignores other statuses

**`loadLookbackTopics` (mock `listRuns` or MockRunsDatabases)**

- `lookback: 0` → empty; assert list was **not** called
- Happy path: three completed runs with summaries; `lookback: 2` → two most recent issues + flattened topics with correct `runId`
- Empty history → empty result
- Malformed summary on one run → that issue has `topics: []`; siblings still parse
- Passes `newsletterId` + `status: "completed"` into list; `limit === Math.max(lookback, 100)`

## Tasks

### Task 1: Failing tests for lookback topic load

- **Action:** Create `shared/src/runs/__tests__/lookback-topics.test.ts` covering all cases in Testing approach. Import the symbols from `../lookback-topics` that do not exist yet — tests must fail on missing module / missing exports.
- **Expected result:** `pnpm --filter @newsletter/shared test -- src/runs/lookback-topics` exits non-zero because the implementation is absent (not harness misconfig).
- **Verify:** Run that command; failures cite missing module or undefined exports.
- **Depends on:** none.

### Task 2: Implement lookback-topics module + export

- **Action:** Implement `shared/src/runs/lookback-topics.ts` with `parseRunTopicSummary`, `selectLookbackCompletedRuns`, and `loadLookbackTopics` per Spec. Re-export from `shared/src/runs/index.ts`. Reuse `listRuns` from `./repository` and `Run` from `./types`.
- **Expected result:** Lookback unit tests green; types exported from `@newsletter/shared`.
- **Verify:** `pnpm --filter @newsletter/shared test -- src/runs/lookback-topics` green; `pnpm --filter @newsletter/shared exec tsc --noEmit` zero errors.
- **Depends on:** Task 1.

### Task 3: Regression + product_spec note

- **Action:** Run full `pnpm test`, fix fallout. Update `product_spec.md` Implemented features with one line for Stage 05 feature 02 lookback topic load. Diff-check: no execute-run suppress wiring, no retention/schema changes, no web UI.
- **Expected result:** Full suite green; product_spec reflects the loader.
- **Verify:** `pnpm test && pnpm typecheck && pnpm lint` — all zero.
- **Depends on:** Task 2.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test -- src/runs/lookback-topics src/runs && pnpm test && pnpm typecheck && pnpm lint`
- Expected: Lookback tests pass (lookback 0 no-op, ordering, parse degrade, flatten with run provenance). Full suite green. No suppress / threshold / GUI code introduced.

## Handoff

When complete, the builder reports to the manager:

- Files created/modified under `shared/src/runs/` and `product_spec.md`.
- Confirmation of test/typecheck/lint commands and results.
- Confirmation that `lookback <= 0` skips Appwrite.
- Confirmation that ordering matches retention’s completed sort (`endedAt||startedAt` desc, `$id` desc).
- Confirmation that malformed summaries degrade to `[]` without throw.
- Confirmation that execute-run / selection / retention were untouched.
- **Research note:** Codegraph on `listRuns` / `markCompleted` / `topicSummary` / retention protected-set sort; Stage 04 stores `topicSummary` as JSON string of `{ title, tags }[]` on the run document (no Storage open). `listRuns` intentionally avoids `Query.orderDesc` (repository tests); loader uses in-memory sort + `limit: Math.max(lookback, 100)`. Feature 01 pins lookback `0..10` / default 3; this loader accepts any integer N from the caller. Embed text for lookback topics (title/tags vs candidate title+content) is deferred to feature 03.

## Locked decisions (auto mode 2026-07-13)

1. **Module:** `shared/src/runs/lookback-topics.ts` + barrel export.
2. **API:** `loadLookbackTopics(client, { newsletterId, lookback })` → `{ lookback, issues, topics }`.
3. **lookback <= 0:** empty result, no Appwrite call.
4. **Ordering:** match retention protected-completed sort (`endedAt||startedAt` desc, `$id` desc).
5. **Fetch:** `listRuns` with `status: "completed"`, `limit: Math.max(lookback, 100)`; no new indexes / no `orderDesc`.
6. **Corrupt summary:** degrade to `[]` for that run; do not throw.
7. **Empty summary issues still count** toward N completed issues in the window.
8. **No execute-run wiring** in this feature (feature 03).
9. **Provenance on flattened topics:** `runId`, `runEndedAt`, `runStartedAt` for feature 04 visibility.
