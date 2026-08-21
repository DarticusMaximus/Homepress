# Feature 01: Persist title and dek

## Intent

Store an issue title and dek on the completed run (extracted from the draft at complete time) so later features can label issues without re-parsing markdown, while older runs and empty extracts still fall back to first-heading / first-paragraph / newsletter-and-date.

## Spec

Add optional `issueTitle` and `issueDek` attributes on the existing Appwrite `runs` collection. After a **successful** draft checkpoint, extract title and dek from that draft with the **existing** Stage 14 helpers (`extractFirstMarkdownHeading`, `extractIssueDek`) and persist them on the same `markCompleted` write. Do **not** persist `formatIssueFallbackTitle` — that string is display-only when stored fields are empty. Do **not** change Home, channel cards, factory lists, issue chrome, email subject, or RSS item title in this feature (Feature 03). Do **not** call an LLM (Feature 02). No backfill job.

### Auto-pinned decisions

| Topic | Pin |
|---|---|
| Attribute keys | `issueTitle`, `issueDek` on `runs` (not a new collection). |
| Write source | Extract from `draftResult.markdown` after the draft checkpoint saves; pass into `markCompleted`. |
| Empty extract | Persist `""`. Missing heading → empty title; missing first paragraph → empty dek. |
| Fallback string | Never write `{newsletter} — {date}` into `issueTitle`. |
| Surfaces | Unchanged. `resolveIssueDisplayTitle` / `resolveIssueCardMetaForRuns` still parse the draft. |
| Historical runs | Missing / null / non-string / whitespace-only attributes map to `""` on read. |
| Title-pass / cheap model | Out of scope (Feature 02). Extraction is local and must not fail the run. |
| Extract vs complete retry | Run extract in its **own** try/catch **before** the existing `markCompleted` try / one-retry. Extract throw must not enter the `mark-completed-retry` catch or consume that retry. |
| Provisioner | Create-if-absent only. No drop / rename / retype / migrate. |

### Field contract (pinned)

| Persisted attribute | Type | Size | Required | Default |
|---------------------|------|------|----------|---------|
| `issueTitle` | string | **512** (`ISSUE_TITLE_ATTR_SIZE`) | false | none (omit `default`) |
| `issueDek` | string | **512** (`ISSUE_DEK_ATTR_SIZE`) | false | none |

**Why those sizes:** RSS item titles already use `RSS_TITLE_ATTR_SIZE = 512`. Extract-fallback dek display stays clamped to `ISSUE_DEK_MAX_CHARS` (160) plus `…`. Persist is **512** so Feature 02’s 25-word LLM dek is not sliced mid-sentence. Do not change `ISSUE_DEK_MAX_CHARS`.

**Read coerce** (`documentToRun`): missing / `null` / non-string → `""`. Same defensive pattern as `failureMessage` / `emailDeliveryError`.

**Present vs missing** (for Feature 03; export now):

```ts
storedIssueTitle(run: Pick<Run, "issueTitle">): string | null
storedIssueDek(run: Pick<Run, "issueDek">): string | null
```

Return the trimmed string when it contains at least one letter or number (`!isEmptyOrPunctuationOnly` — reuse the existing private helper in `issues.ts`, or share it in that file). Otherwise `null`. Whitespace-only and `""` are missing.

### Extract-and-clamp for persist (pinned)

Add `buildIssueMetadataFromMarkdown(markdown: string): { issueTitle: string; issueDek: string }` in `shared/src/runs/issues.ts` (re-exported via the existing `runs` barrel).

1. `issueTitle` = `extractFirstMarkdownHeading(markdown) ?? ""`. If longer than `ISSUE_TITLE_ATTR_SIZE` (512), **hard-slice** at 512 (no ellipsis). Do not invent a second heading parser.
2. `issueDek` = `extractIssueDek(markdown) ?? ""` (already word-bounded to 160 + `…`). Do not re-implement dek.
3. Pure function; does not I/O. Empty / heading-only / punctuation-only drafts yield `""` for the missing side.

### Write paths (pinned)

**`Run`** (`shared/src/runs/types.ts`): add required strings `issueTitle` and `issueDek` (always present in memory, like delivery error fields).

**`createRun`**: persist `issueTitle: ""`, `issueDek: ""` with the other empty optionals.

**`MarkCompletedInput`**: add required `issueTitle: string` and `issueDek: string`. `markCompleted` includes both keys in the Appwrite `updateDocument` payload alongside `status`, `topicSummary`, `endedAt`, and cleared failure fields. Clamp on write: slice title to 512; if `issueDek.length > ISSUE_DEK_ATTR_SIZE`, slice to 512 (defensive; the Feature 01 extractor should already be ≤ 161; Feature 02 LLM dek may be longer, still ≤ 512). Do **not** re-validate topicSummary rules.

**`executeRun`** (`shared/src/runs/execute-run.ts`): after a non-empty draft checkpoint is saved, compute metadata **before** the existing `markCompleted` try / one-retry:

```ts
let issueTitle = "";
let issueDek = "";
try {
  const meta = buildIssueMetadataFromMarkdown(draftResult.markdown);
  issueTitle = meta.issueTitle;
  issueDek = meta.issueDek;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error({
    phase: "persist-issue-metadata",
    runId,
    message: sanitizeAppwriteMessageForLog(message),
  });
}
await markCompleted(/* … topicSummary, issueTitle, issueDek */);
```

Pass the same `issueTitle` / `issueDek` locals into **both** `markCompleted` attempts (success path and the existing Appwrite one-retry). Extraction failure must **not** skip complete, must **not** call `markFailed`, and must **not** log `phase: "mark-completed-retry"`.

Empty-draft fatal path (`draftResult.empty`) still `markFailed` and does **not** write issue metadata.

### Fixtures

Every local `makeRun` / `mockRunDocument` that constructs a full `Run` (or run document) must default `issueTitle: ""` and `issueDek: ""`. Do **not** add a shared test factory in this feature.

## Dependencies

- Builds on: Stage 14 Feature 02 (`extractFirstMarkdownHeading`, `extractIssueDek`, `ISSUE_DEK_MAX_CHARS`, `resolveIssueDisplayTitle` — leave display helpers’ behavior unchanged).
- Unlocks: Feature 02 (cheap-model overwrite of the same fields), Feature 03 (surfaces prefer stored), Feature 04 (regenerate re-persists after a new draft).

## Constraints

- Do not add a title/dek LLM call, prompt role, or model override.
- Do not change Home, `/newsletters/[id]`, `/admin/issues`, issue reader chrome, email subject, or RSS item title.
- Do not change `resolveIssueDisplayTitle` or `resolveIssueCardMetaForRuns` to skip draft loads or prefer stored fields.
- Do not fail a run because metadata extract failed or stored fields are empty.
- Do not backfill historical runs.
- Do not drop, rename, or retype existing `runs` attributes.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Acceptance criteria

- [ ] `runs` schema declares optional `issueTitle` (string, size 512) and `issueDek` (string, size 512).
- [ ] A successful `executeRun` that produces a non-empty draft writes extracted title and dek onto that run via `markCompleted`.
- [ ] Heading-only draft → stored title set, stored dek `""`.
- [ ] Draft with no heading and no prose → both stored fields `""` (run still completes).
- [ ] Missing attributes on old documents read as `""`; `storedIssueTitle` / `storedIssueDek` return `null`.
- [ ] Home / lists / email / RSS still resolve titles from draft markdown (no surface wiring).
- [ ] Extract throw during complete still `markCompleted` once with empty metadata (run not failed; complete retry unused).

## Files

- Modify: `shared/src/schema/declarations.ts` — `ISSUE_TITLE_ATTR_SIZE`, `ISSUE_DEK_ATTR_SIZE`; append the two `runs` attributes
- Modify: `shared/src/schema/__tests__/declarations.test.ts` — attribute count 25 → 27; assert keys/sizes
- Modify: `shared/src/runs/types.ts` — `Run`, `MarkCompletedInput`
- Modify: `shared/src/runs/repository.ts` — `documentToRun`, `createRun`, `markCompleted`
- Modify: `shared/src/runs/__tests__/repository.test.ts` — create/map/complete payload
- Modify: `shared/src/runs/__tests__/mock-client.ts` — `mockRunDocument` defaults
- Modify: `shared/src/runs/issues.ts` — `buildIssueMetadataFromMarkdown`, `storedIssueTitle`, `storedIssueDek`
- Modify: `shared/src/runs/__tests__/issues.test.ts` — new helper cases
- Modify: `shared/src/runs/execute-run.ts` — pass metadata into `markCompleted`
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` — assert `markCompleted` metadata
- Modify: every other `makeRun` default object that returns `Run` (web/worker/shared tests listed by current typecheck errors)

## Testing approach

Test-first. Unit tests only; no live Appwrite; no screenshots. Tests verify **stored fields on the run**, not GUI copy.

### Test cases

**Schema (`declarations.test.ts`)**

1. `runs` has `issueTitle`: string, size 512, required false, not array, no default.
2. `runs` has `issueDek`: string, size 512, required false, not array, no default.
3. `runs.attributes` length is **27**; sorted key list includes the two new keys. Constants `ISSUE_TITLE_ATTR_SIZE === 512` and `ISSUE_DEK_ATTR_SIZE === 512`.

**Repository (`repository.test.ts`)**

4. `createRun` payload includes `issueTitle: ""` and `issueDek: ""`.
5. `documentToRun` maps stored strings through; missing/null/non-string → `""`.
6. `markCompleted` payload includes caller-supplied `issueTitle` and `issueDek` (happy path: non-empty both).
7. `markCompleted` still validates `topicSummary` and does not update when validation fails.

**Extract helper (`issues.test.ts`)**

8. `# Who Vets AI’s Code?\n\nLabs are racing to ship agents.` → `{ issueTitle: "Who Vets AI’s Code?", issueDek: "Labs are racing to ship agents." }`.
9. `# Title` only → `{ issueTitle: "Title", issueDek: "" }`.
10. `Just a lede. No heading.` → `{ issueTitle: "", issueDek: "Just a lede. No heading." }`.
11. Empty / whitespace markdown → both `""`.
12. Title longer than 512 chars → sliced to length 512.
13. `storedIssueTitle` / `storedIssueDek`: non-empty → that string; `""` / `"   "` / punctuation-only → `null`.

**executeRun (`execute-run.test.ts`)**

14. Happy path (existing mock markdown `# Test Newsletter\n\nArticle content here.`): `markCompleted` called **once** with `issueTitle: "Test Newsletter"`, `issueDek: "Article content here."`.
15. Empty-draft fatal: `markCompleted` not called (existing empty-draft tests still hold).
16. Extract stubbed to throw (mock `buildIssueMetadataFromMarkdown` or the same module-mock style already used for repository fns): `markCompleted` called **once** with both fields `""`; `markFailed` not called; error log `phase` is `"persist-issue-metadata"` (not `"mark-completed-retry"`).
17. Existing C5 retry (transient `markCompleted` failure, success on second attempt): **both** payloads include the **same** extracted `issueTitle` / `issueDek` (happy-path strings from test 14).

Existing `resolveIssueDisplayTitle` / `resolveIssueCardMetaForRuns` tests must still pass without stored-field preference.

## Tasks

### Task 1: Schema attributes and constants

- **Action**: Write failing `declarations.test.ts` cases 1–3. Then append `ISSUE_TITLE_ATTR_SIZE = 512`, `ISSUE_DEK_ATTR_SIZE = 512`, and the two optional string attributes on the `runs` collection in `shared/src/schema/declarations.ts`. Update the existing “25 attributes / sorted keys” assertion. Provisioner is create-if-absent — no provisioner code change unless a test proves otherwise.
- **Expected result**: Live provisioner will add the two attributes on next provision; declaration tests pass.
- **Verify**: `pnpm exec vitest run shared/src/schema/__tests__/declarations.test.ts`
- **Depends on**: none.

### Task 2: Run type, map, create, complete

- **Action**: Write failing repository tests 4–7. Extend `Run` and `MarkCompletedInput`. Update `documentToRun`, `createRun`, and `markCompleted` in `shared/src/runs/repository.ts`. Pass `issueTitle: ""` and `issueDek: ""` at **both** existing `markCompleted` call sites in `shared/src/runs/execute-run.ts` (typecheck placeholders — Task 4 replaces them with extract). Update every `markCompleted(...)` caller in `shared/src/runs/__tests__/repository.test.ts` with the new required fields. Default `issueTitle`/`issueDek` on `mockRunDocument` and every `makeRun` that must satisfy `Run` so `pnpm typecheck` passes.
- **Expected result**: New runs persist empty metadata; complete writes caller strings; old docs read as `""`; `execute-run.ts` still compiles (empty metadata until Task 4).
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/repository.test.ts` and `pnpm typecheck`
- **Depends on**: Task 1.

### Task 3: Extract helper and stored-presence helpers

- **Action**: Write failing `issues.test.ts` cases 8–13. Implement `buildIssueMetadataFromMarkdown`, `storedIssueTitle`, and `storedIssueDek` in `shared/src/runs/issues.ts`. Reuse `extractFirstMarkdownHeading` / `extractIssueDek`; do not change those functions’ public behavior. Export via existing barrel (already `export * from "./issues"`).
- **Expected result**: Pure helpers match the examples; presence helpers treat blank as missing.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/issues.test.ts`
- **Depends on**: Task 2.

### Task 4: Persist on executeRun complete

- **Action**: Write failing execute-run tests 14–17. In `shared/src/runs/execute-run.ts`, **replace** Task 2’s empty placeholders: after a successful draft checkpoint and **before** the existing `markCompleted` try / one-retry, call `buildIssueMetadataFromMarkdown(draftResult.markdown)` in its own try/catch (as pinned under Write paths) and pass those locals into **both** `markCompleted` calls. Do not nest extract inside the `mark-completed-retry` catch. Do not change empty-draft `markFailed` or auto-deliver ordering.
- **Expected result**: Completing a run stores extracted metadata; extract throw still completes once with empty strings and does not consume the Appwrite retry; C5 retry sends the same extracted strings twice.
- **Verify**: `pnpm exec vitest run shared/src/runs/__tests__/execute-run.test.ts` then `pnpm typecheck` and `pnpm lint`
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm exec vitest run shared/src/schema/__tests__/declarations.test.ts shared/src/runs/__tests__/repository.test.ts shared/src/runs/__tests__/issues.test.ts shared/src/runs/__tests__/execute-run.test.ts` then `pnpm typecheck` and `pnpm lint`
- Expected: all listed tests pass; typecheck clean; lint clean (ignore the leftover `pages/` warning). A completed run document has `issueTitle`/`issueDek` filled from the draft extract, or `""` when extract finds nothing / throws. GUI titles still come from draft parse.

## Handoff

Report files changed, the two attribute sizes, and that `markCompleted` now requires metadata. Note any extra `makeRun` files touched for typecheck. Confirm GUI resolvers were **not** switched to stored fields (Feature 03) and no LLM was added (Feature 02). If extract was inlined instead of `buildIssueMetadataFromMarkdown`, say so — Feature 02/04 need a single write helper.

### Research notes

- Codegraph + `shared/src/runs/{types,repository,issues,execute-run}.ts`: runs have 25 attributes today; `documentToRun` coerces optionals to `""`; complete is `markCompleted` after draft checkpoint; Home dek/title already live in `extractIssueDek` / `extractFirstMarkdownHeading` (`ISSUE_DEK_MAX_CHARS = 160`).
- Happy-path execute-run mock draft is `# Test Newsletter\n\nArticle content here.` — test 14 pins that extract.
- Provisioner (`shared/src/schema/provisioner.ts`) is create-if-absent; optional strings without `default` match `emailDeliveryError` (Appwrite empty-string defaults are easy to get wrong — omit them).
- Stage 09 Feature 01 / Stage 12 Feature 01 pattern: this feature owns schema + persist; later features consume.
