# Stage 05: Cross-Run Deduplication

## Intent

Stop the same topic recurring across consecutive issues by suppressing lookback-similar candidates before within-run diversity selection — so each issue feels fresh even when the day's firehose keeps repeating the same story. This serves the product's temporal-diversity goal and makes retained run history actively useful, not just an audit trail.

## Goal

A new run for a newsletter excludes candidates that are semantically too close to topics from that newsletter's recent completed issues; the operator can set lookback per newsletter (including off), tune the similarity threshold via env, and see what was suppressed on the run summary.

## Features

1. **Lookback config** — Per-newsletter lookback count of recent completed issues to suppress against (default 3). `0` disables cross-run suppression for that newsletter. Editable on the newsletter definition; persists and reloads.
2. **Lookback topic load** — Load `topicSummary` from that newsletter's latest N completed runs (N = lookback). Empty history or lookback `0` is a no-op (selection behaves as today).
3. **Pre-MMR semantic suppress** — Embed candidates against lookback topics (reuse the Stage 01 embedding path). Hard-drop candidates above the configured similarity threshold, then run existing MMR on the remainder. Fill toward the newsletter's target count from remaining candidates; short issue only if the pool is exhausted. Never fail the run solely because of suppression.
4. **Suppress visibility** — On the run summary: suppression count, suppressed titles, and which prior issue each matched — enough to trust the filter without Stage 06's full inspect UI.
5. **Threshold env config** — Documented project-root `.env` variable for the similarity threshold (no GUI). Changing it affects the next run without a code change.
6. **Formatting maintenance** — Restore the repository-wide Prettier gate by formatting maintained files and excluding generated or legacy artifacts that are intentionally not maintained as application source.

## Acceptance criteria

- [ ] Lookback defaults to 3 on new newsletters; the operator can change it per newsletter (including `0` = off); the value persists and reloads.
- [ ] With lookback ≥ 1 and at least one completed prior issue in range, a candidate whose embedding similarity to a lookback topic exceeds the env threshold is hard-dropped before MMR.
- [ ] With lookback `0`, or with no completed prior issues in range, selection behaves as it did before this stage (no suppressions).
- [ ] After suppression, MMR still fills toward the newsletter's target item count from remaining candidates; the run completes with a shorter selection only when the remaining pool is exhausted.
- [ ] A completed run's summary shows the suppression count, each suppressed title, and which prior issue it matched.
- [ ] The similarity threshold is read from a documented `.env` variable; changing it takes effect on the next run without editing application code.
- [ ] `pnpm format:check` exits zero without reporting maintained source, configuration, or documentation files.

## Dependencies

- Stage 04: Runs And History must be complete (retained completed runs, protected floor of recent completed runs, and `topicSummary` on completed runs).

## Out of scope

- LLM-as-judge for topic sameness (deferred until cost/latency improve; recorded as a future direction).
- GUI control for the similarity threshold (env-only in V1).
- Soft / score-penalty mode (hard drop only).
- Cross-newsletter suppression (lookback is same-newsletter only).
- Stage 06 full per-article / pipeline-decision inspection.
- Changing Stage 04 retention policy (this stage consumes the existing floor and `topicSummary`).

## Open questions

- None — threshold numeric default and lookback min/max bounds to be pinned in `ssc-spec` when features are detailed.
