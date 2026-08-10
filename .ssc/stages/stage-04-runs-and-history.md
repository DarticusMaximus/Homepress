# Stage 04: Runs And History

## Intent

Make newsletter generation observable and safely recoverable, so the operator can diagnose failures, retry without repeating completed network or LLM work, and notice feeds that have become unreliable. This makes the proven pipeline practical to operate through the GUI and serves the product's goal of reliable on-demand generation.

## Goal

The operator can start a newsletter run, follow its outcome in history, retry a failed phase using durable prior results, and identify feeds that repeatedly fail.

## Features

1. **Run checkpoints** - Persist a run record and the full result of each completed pipeline phase: fetch, scrape, tag, score, selection, and draft.
2. **On-demand runs** - Let the operator start a run from a newsletter while preventing more than one active run for that newsletter.
3. **Run history** - Present operational run history with newsletter, start and end time, status, completed or failed phase, failure message, and retry action.
4. **Failed-run retry** - Resume a failed run from its failed phase, preserving completed phases so retries do not refetch websites or repeat LLM calls.
5. **Feed health** - Track consecutive feed-fetch failures, reset the count after success, and surface unhealthy feeds in feed management, affected runs, and the dashboard.
6. **Run retention** - Let the operator configure run-history retention, defaulting to 30 days while preserving each newsletter's latest three completed runs.

## Acceptance criteria

- [ ] Starting a manual run creates a visible run record; a newsletter cannot have two active runs simultaneously.
- [ ] Every successful pipeline phase leaves a durable checkpoint containing the full result required by later phases and a retry.
- [ ] A completed run and a failed run are distinguishable in history; failed runs show the phase and failure message.
- [ ] Retrying a failed run starts at its failed phase and does not repeat any completed phase's website requests or LLM calls.
- [ ] A feed becomes unhealthy after three consecutive failed fetches and becomes healthy again after a successful fetch.
- [ ] Feed management and affected run records identify unhealthy feeds; the dashboard shows a green feeds indicator when all are healthy, otherwise a red indicator with the unhealthy-feed count that links to feed management.
- [ ] The retention setting defaults to 30 days, removes eligible old run records, and never removes a newsletter's three latest completed runs.

## Dependencies

- Stage 01: Pipeline Engine must be complete.
- Stage 03: Newsletter Config must be complete.

## Out of scope

- Scheduled or batched execution and cross-newsletter concurrency policy.
- Cancelling an in-progress run.
- Detailed per-article and model-decision inspection, which belongs to Stage 06.
- Cross-run topic deduplication, which belongs to Stage 05.

## Open questions

- None.
