# Feature 05: Auto-deliver after success

## Intent

When a run completes with a draft, honor that newsletter’s independent auto-email and/or auto-RSS toggles without a manual click — so tuned newsletters close the loop from generate → deliver for family inboxes and RSS readers.

## Spec

Wire **automatic delivery** into the shared run-completion path. After a run is successfully marked `completed` (non-empty draft already checkpointed), load that newsletter’s Feature 01 delivery flags and, for each enabled channel, call the same shared orchestration Feature 02 / Feature 03 already own (`sendIssueEmail`, `publishIssueToRss`). Manual Send / Publish remain available; this feature only removes the click when the toggles are on. There is **no** auto-export (Feature 04 stays on-demand). Delivery-status persistence and GUI badges are **Feature 06** — this feature attempts delivery and logs outcomes; it does not add run schema fields.

### Trigger (locked)

| Item | Contract |
|------|----------|
| Hook site | `executeRun` in `shared/src/runs/execute-run.ts`, **after** `markCompleted` succeeds (including the one-shot retry path), on the same success path that logs `action: "run-completed"`. |
| When | Run status is (or was just set to) `completed` with a draft checkpoint already saved. Empty-draft / failed runs never reach this hook (they `markFailed` and return earlier). |
| Who | Every successful execute — manual Generate and scheduled claims alike — because the worker already calls `executeRun`. Do **not** add a separate worker-only hook. |
| Skip | If `markCompleted` ultimately fails and the run is marked failed for finalize, do **not** auto-deliver. |

### Shared orchestrator (locked)

```ts
autoDeliverAfterSuccess(client, runId, options?: AutoDeliverOptions): Promise<AutoDeliverResult>
```

Place in `shared/src/delivery/auto-deliver.ts` (re-export from `shared/src/delivery/index.ts`).

**`AutoDeliverOptions` (locked):** injectable deps for tests — at minimum:

- `getNewsletter` (default: repository `getNewsletter`)
- `getRun` (default: repository `getRun`) — needed to resolve `newsletterId`
- `sendIssueEmail` (default: Feature 02 entry point)
- `publishIssueToRss` (default: Feature 03 entry point)

**Orchestration order (locked):**

1. `getRun(client, runId)` → `newsletterId`. On failure → log sanitized; return result with neither channel attempted; **never throw**.
2. `getNewsletter(client, newsletterId)` → read `autoEmail` / `autoRss` (coerce missing to `false` via Feature 01 read path). On failure → log; return with neither channel attempted; **never throw**.
3. If **both** toggles are false → return immediately (`email.attempted: false`, `rss.attempted: false`). Do **not** call send or publish.
4. If `autoEmail === true` → call `sendIssueEmail(client, runId)` (same path as manual Send). Record success or failure on the result; on failure log sanitized operator-facing / error message (never SMTP password). Do **not** throw out of the orchestrator.
5. If `autoRss === true` → call `publishIssueToRss(client, runId)` **after** the email attempt (or immediately if email was skipped). Independent of email outcome — email failure must **not** skip RSS. Record + log the same way; never throw.
6. Return `AutoDeliverResult` summarizing what was attempted and whether each succeeded.

**Channel independence (locked):** Email and RSS are independent. One channel’s failure never blocks the other. Sequential order is **email then RSS** when both are on (deterministic tests; not parallel).

**Run integrity (locked):** `autoDeliverAfterSuccess` must **never** throw. `executeRun` must **never** call `markFailed` because delivery failed. A completed run stays `completed` even if SMTP is down or RSS upsert fails. Outer `executeRun` try/catch must not treat delivery errors as pipeline failures — wrap the auto-deliver call in its own try/catch as belt-and-suspenders even though the orchestrator swallows errors.

**Re-delivery (locked):** Every successful `markCompleted` path invokes auto-deliver when toggles are on. There is no “already emailed / already published” gate (Feature 02/03 already allow re-send / republish; Feature 06 owns lasting status). A resume that successfully completes draft → markCompleted will auto-deliver again if toggles remain on.

**No auto-export (locked):** Do not call `prepareIssueExport` or write files/archives.

### Result shape (locked)

```ts
type AutoDeliverChannelResult = {
  attempted: boolean;
  ok: boolean;
  /** Present when attempted && !ok — operator-facing or sanitized error string; never secrets. */
  error?: string;
};

type AutoDeliverResult = {
  email: AutoDeliverChannelResult;
  rss: AutoDeliverChannelResult;
};
```

When a channel is not enabled: `{ attempted: false, ok: false }` (or `ok: true` with `attempted: false` — **locked:** use `attempted: false`, `ok: false`, no `error`). When enabled and success: `{ attempted: true, ok: true }`. When enabled and failure: `{ attempted: true, ok: false, error: "<message>" }`.

Map shared send/publish failures consistently:

- If the Feature 02/03 function **resolves** to `{ ok: false, error }` (business failure — the normal Feature 02/03 contract) → set channel `{ attempted: true, ok: false, error }` from that string. **Required** — do not only handle throws.
- If it **throws**/rejects → catch and set `error` from the message (sanitize).
- Prefer the locked Feature 02/03 operator-facing strings when available.

### `executeRun` wiring (locked)

Extend `ExecuteRunOptions` with an optional override:

```ts
autoDeliver?: typeof autoDeliverAfterSuccess; // default: real autoDeliverAfterSuccess
```

After successful `markCompleted` (both first try and successful retry), call:

```ts
const deliver = options?.autoDeliver ?? autoDeliverAfterSuccess;
try {
  await deliver(client, runId);
} catch (deliveryErr) {
  // Must not happen if orchestrator contract holds — log and continue.
  console.error({ phase: "auto-deliver", runId, message: sanitize... });
}
```

Do **not** pass newsletter object from earlier in `executeRun` as the sole source of truth for toggles — re-read via `getNewsletter` inside auto-deliver so a mid-run toggle change is honored at completion time (and tests stay unit-simple). Using the in-memory `newsletter` from pipeline config is **not** allowed for toggle reads (it may be stale relative to Delivery saves; also keeps the orchestrator self-contained).

### Logging (locked)

Structured logs (same style as existing `action` / `phase` logs):

- Skip both: optional debug-level or a single `action: "auto-deliver-skip"` with `reason: "toggles-off"` (or omit — tests must not require noisy skip logs; prefer one concise skip log).
- Per channel start/success/failure: `action: "auto-deliver-email"` / `auto-deliver-rss` with `ok: true|false` and sanitized `message` on failure.
- Never log `SMTP_PASSWORD`, full auth objects, or raw env dumps (reuse `sanitizeAppwriteMessageForLog` / existing redact helpers).

### Out of scope

- Delivery-status schema, badges, or failure reason on Issues/run UI (Feature 06).
- Auto-export / archive.
- Changing Feature 02/03 send/publish body, BCC, or RSS snapshot semantics.
- Confirmation dialogs or operator toasts for auto-deliver (worker has no UI; Issues still use manual Send/Publish toasts only).
- Public signup / unsubscribe.
- Disabling auto-deliver for `trigger: "manual"` vs `"scheduled"` — both honor toggles equally.

## Dependencies

- **Hard execute prerequisites (all must be `verified` before this feature executes):**
  - **feature-01-newsletter-delivery-config** — `autoEmail` / `autoRss` / `recipientEmails` on `Newsletter`.
  - **feature-02-email-delivery** — `sendIssueEmail`.
  - **feature-03-rss-publication** — `publishIssueToRss`.
- **Not required:** feature-04-download-export (explicitly no auto-export).
- Builds on: Stage 04 `executeRun` / `markCompleted` success path (already complete).
- Soft consumer: Feature 06 will record outcomes for GUI visibility — ideally by wrapping or observing the same channel entry points; this feature only invokes them.

## Constraints

- Do not start `ssc-execute` for this feature until Features 01, 02, and 03 are verified.
- Auto-deliver must not flip a completed run to failed.
- `autoDeliverAfterSuccess` never throws.
- Channels are independent; email-then-RSS order when both on.
- No new Appwrite collections or run delivery-status attributes.
- No auto-export.
- Secrets must not appear in logs or result `error` strings.
- Server/worker-only (shared module called from `executeRun`); no new web UI.
- `pnpm typecheck` and `pnpm lint` must pass.

## Acceptance criteria

- [ ] After `markCompleted` succeeds in `executeRun`, `autoDeliverAfterSuccess` runs (overridable via `ExecuteRunOptions.autoDeliver`).
- [ ] Both toggles off → neither `sendIssueEmail` nor `publishIssueToRss` is called.
- [ ] `autoEmail` only → email called, RSS not; `autoRss` only → RSS called, email not; both on → both called (email then RSS).
- [ ] Email failure does not skip RSS when `autoRss` is on; neither failure marks the run failed or throws out of `executeRun`.
- [ ] Newsletter / run load failures inside auto-deliver are swallowed (logged); run remains completed.
- [ ] Unit tests cover toggle matrix, channel independence, never-throw, and `executeRun` wiring (injectable auto-deliver / channel deps).
- [ ] No auto-export; no delivery-status schema or Issues UI changes in this feature.
- [ ] `pnpm typecheck` and `pnpm lint` pass; tests in Testing approach pass.

## Files

- Create: `shared/src/delivery/auto-deliver.ts`
- Modify: `shared/src/delivery/index.ts` (re-export)
- Create: `shared/src/delivery/__tests__/auto-deliver.test.ts`
- Modify: `shared/src/runs/execute-run.ts` (hook after `markCompleted`; extend `ExecuteRunOptions`)
- Modify: `shared/src/runs/__tests__/execute-run.test.ts` (wiring cases — inject stub `autoDeliver`)
- Modify as needed: `shared/src/index.ts` if delivery re-exports are rooted there

## Testing approach

Test-first. Mock `getRun` / `getNewsletter` / `sendIssueEmail` / `publishIssueToRss`. No live SMTP or Appwrite.

### `auto-deliver.test.ts`

1. **Both off** — newsletter `autoEmail: false`, `autoRss: false` → neither send nor publish called; result both `attempted: false`.
2. **Email only** — `autoEmail: true`, `autoRss: false` → `sendIssueEmail` once with `runId`; publish not called; email `attempted: true, ok: true`.
3. **RSS only** — inverse of case 2.
4. **Both on success** — both called; email invoked before publish (assert call order).
5. **Email soft-fail, RSS still runs** — `sendIssueEmail` **resolves** to `{ ok: false, error: "Failed to send email" }` (no throw) → email `{ attempted: true, ok: false, error }` with that message; `publishIssueToRss` still called and can succeed. (Do **not** satisfy this case with a throw-only mock — Feature 02 business failures return `{ ok: false }`.)
5b. **Email throws, RSS still runs** — `sendIssueEmail` **rejects**/throws → same email failure shape (error from message); RSS still attempted when `autoRss` is on.
6. **RSS soft-fail after email success** — `publishIssueToRss` **resolves** to `{ ok: false, error: "Failed to publish to RSS" }` (no throw) → email `ok: true`; rss `{ attempted: true, ok: false, error }`; orchestrator still resolves (does not throw).
6b. **RSS throws after email success** — `publishIssueToRss` throws → rss `ok: false`; orchestrator still resolves.
7. **getNewsletter failure** — neither channel attempted; orchestrator resolves (does not throw).
8. **getRun failure** — same as 7.
9. **Never throw** — even if both channel deps throw, `autoDeliverAfterSuccess` resolves with both `ok: false`.

### `execute-run.test.ts` (extend)

10. **Hook on success** — stub pipeline phases through successful draft + `markCompleted`; inject `autoDeliver` mock → called once with `(client, runId)` after completion.
11. **No hook on failure** — run fails before/at draft → `autoDeliver` not called.
12. **Delivery throw isolation** — injected `autoDeliver` throws → `executeRun` still completes without `markFailed` from that throw (run stays completed / does not rethrow as pipeline failure). Prefer asserting status remains completed via mocks.

## Tasks

### Task 1: Failing tests for auto-deliver orchestration

- **Action**: Add `shared/src/delivery/__tests__/auto-deliver.test.ts` covering cases 1–9 **including 5b and 6b** (module may not exist — fail red for missing exports). Soft-fail cases 5 and 6 must use resolved `{ ok: false, error }` mocks, not throws. Assume Feature 02/03 entry points exist when this feature executes (hard prerequisites).
- **Expected result**: New tests exist and fail for the right reasons.
- **Verify**: `pnpm --filter @newsletter/shared test` shows the new auto-deliver assertions failing (not infra errors).
- **Depends on**: none (execute only after Features 01–03 verified).

### Task 2: Implement `autoDeliverAfterSuccess`

- **Action**: Create `shared/src/delivery/auto-deliver.ts` per Spec (getRun → getNewsletter → toggle gate → email then RSS; never throw; injectable deps). Re-export from `delivery/index.ts`. Make cases 1–9 green.
- **Expected result**: Shared auto-deliver orchestrator ready for `executeRun` wiring.
- **Verify**: `pnpm --filter @newsletter/shared test` — `auto-deliver.test.ts` green.
- **Depends on**: Task 1.

### Task 3: Wire into `executeRun` + isolation tests

- **Action**: After successful `markCompleted` in `executeRun`, call default `autoDeliverAfterSuccess` (overridable via `ExecuteRunOptions.autoDeliver`); belt-and-suspenders try/catch. Extend `execute-run.test.ts` with cases 10–12. Make green.
- **Expected result**: Every successful run completion honors toggles; delivery failures cannot fail the run.
- **Verify**: `pnpm --filter @newsletter/shared test` — auto-deliver + extended execute-run tests green.
- **Depends on**: Task 2.

### Task 4: Monorepo gates

- **Action**: Run `pnpm typecheck && pnpm lint`; fix export/type/lint fallout only (no UI, no schema).
- **Expected result**: Typecheck + lint clean; shared delivery/execute-run tests still green.
- **Verify**: `pnpm typecheck && pnpm lint` pass; `pnpm --filter @newsletter/shared test` still green for auto-deliver + execute-run cases.
- **Depends on**: Task 3.

## Feature verification

- Run: `pnpm --filter @newsletter/shared test && pnpm typecheck && pnpm lint`
- Expected: All shared tests pass including auto-deliver toggle matrix / independence / never-throw and execute-run hook isolation cases; typecheck and lint clean. Optional smoke (not required for verifier): with `autoEmail` and/or `autoRss` on, complete a run and confirm email/RSS fired without manual Send/Publish — and that a deliberate SMTP failure still leaves the run `completed`.

## Handoff

Builder reports: files changed; confirmation Features 01–03 were verified before execute; confirmation hook is after successful `markCompleted` only; confirmation both-off is a no-op; confirmation email-then-RSS order and channel independence; confirmation delivery failures never mark the run failed / never throw from the orchestrator; confirmation no auto-export and no delivery-status schema; any deviation (e.g. exact `SendIssueEmailResult` shape mapping) and why. Note for Feature 06: record email/RSS attempt outcomes for GUI — auto path already calls the same `sendIssueEmail` / `publishIssueToRss` entry points as manual actions.

## Research notes

- **Auto draft (2026-07-17)** — Stage 09 Feature 05: post-`markCompleted` hook in shared `executeRun` (covers worker manual + scheduled); reuse Feature 02/03 orchestration; independent toggles; never fail the run; no status schema (Feature 06); no auto-export (Plan.md Decision 2026-07-16).
- **Grizzled Senior (2026-07-17)** — Applied: pin soft-fail `{ ok: false, error }` return-shape tests (cases 5/6) separate from throw paths (5b/6b/9) so builders cannot game verification by only catching throws.
- **codegraph_explore** — `executeRun` success path ends at `markCompleted` then `action: "run-completed"` (`shared/src/runs/execute-run.ts`); worker `RunPoller` → `executeJob` → `executeRun`; empty draft already `markFailed` before completion; Feature 01–04 specs pin channel contracts and explicitly defer auto-deliver here.
- **Stage 09 / Plan.md** — acceptance: auto-email and auto-RSS independent after successful draft; defaults off while tuning.
