# Stage 01: Pipeline Engine

## Intent
Prove the riskiest assumption in the whole project: that a TypeScript pipeline can match the legacy Python pipeline's filtering quality end-to-end. Every later stage (GUI config, run history, scheduling, delivery) is wasted scaffolding around an engine that doesn't work — so the engine is proven headless, via a test harness, before any UI is built. If this stage fails, the project pivots; if it succeeds, the core value (condense the firehose to a relevant digest) is real and the rest of the product is just operability on top of it.

## Goal
A headless TypeScript library that takes a newsletter definition (feeds, topics, disliked topics, audience, item count) and produces a finished newsletter draft, running the full chain fetch→scrape→tag→score→MMR-select→draft. It is runnable end-to-end through a test harness with a single command, against real RSS feeds and the real OpenRouter gateway, and its output is judged comparable in quality to the legacy Python pipeline on the same inputs.

## Features
1. **Pipeline types & config model** — the shared TypeScript vocabulary (article, scored article, newsletter config, tagged/scoring/draft phase results) every other feature imports. Defines the shape stage 02 later persists to Appwrite; defined here first so the engine is self-describing without a UI.
2. **RSS fetcher** — concurrent fetch of a feed list, parse RSS/Atom, date-range filter (legacy default: yesterday), per-feed error isolation (one dead feed doesn't sink the run), structured failure reporting per feed for stage 03's health monitoring to consume.
3. **Article scraper (Mozilla Readability, pure TypeScript)** — extract article main content as markdown from a URL, falling back to the RSS summary when extraction fails, then clean (strip URLs, collapse whitespace, remove emoji). Uses Mozilla Readability + jsdom + turndown as an in-process pure-TypeScript extractor — no Python sidecar, no second container. The extractor engine differs from the legacy trafilatura, so the claim is comparable-purpose extraction, not byte-identical parity; the cleaning step is a faithful port of the legacy `_clean_content`. Acceptable: porting to a different language means the result is similar, not exactly the same — the end-result quality is what the stage's operator-judged parity check validates.
4. **Tagger** — call the tagger LLM (legacy default: nemotron) per article to produce up to 10 broad SEO-style tags, with retry + exponential backoff and a consecutive-error halt (legacy threshold: 3) that fails the phase loudly rather than silently degrading.
5. **Scorer** — call the scorer LLM per tagged article to produce a 0–10 relevance score against the newsletter's topics and disliked topics, parse+clamp the numeric response, with the same retry/backoff and consecutive-error-halt contract as the tagger.
6. **MMR diversity selection** — embed the title+content snippet of each score-passing article via the embedding model (legacy default: gemini-embedding-001 through OpenRouter), then select the top-N using Maximal Marginal Relevance (λ=0.5) so the final set is both relevant and topically diverse — not just the N highest-scored.
7. **Drafter + orchestrator + harness** — call the drafter LLM (legacy default: gemini-3-flash, high reasoning effort, large token budget) on the diverse selection to produce the final markdown newsletter; wire all six phases into a single runnable orchestrator; and provide a test harness command that runs the full chain against a real newsletter definition and emits the draft, so parity with the Python pipeline can be judged side-by-side.

## Acceptance criteria
- [ ] The pipeline runs end-to-end from a newsletter definition to a finished markdown draft via a single test-harness command, with no GUI and no manual phase stepping.
- [ ] Fetch phase: all feeds in the definition are attempted; a dead/unreachable feed is reported as a per-feed failure and does not abort the run; articles outside the configured date range are excluded.
- [ ] Scrape phase: for a sampled set of real article URLs, extracted content is non-empty and reads as the article's main body (not boilerplate/nav); when extraction fails or returns nothing, the RSS summary is used as fallback.
- [ ] Tag phase: every article that reaches tagging comes out with a tag list (possibly empty on per-article failure); 3 consecutive tagging failures halt the phase with a clear error, not silent degradation.
- [ ] Score phase: every tagged article receives a numeric score in [0, 10]; 3 consecutive scoring failures halt the phase with a clear error.
- [ ] MMR phase: given a fixture set of scored articles with known embeddings, the selection returns exactly the configured item count (or fewer if the candidate pool is smaller) and is observably more topically diverse than a naive top-N-by-score selection on the same inputs.
- [ ] Draft phase: the drafter produces a non-empty markdown newsletter containing the configured number of items (or fewer, with a logged reason), with a distinct featured item and per-item links.
- [ ] **Parity check (the stage's defining criterion):** on the same newsletter definition and the same day's feeds, the TS pipeline's output is judged by the operator to be comparable in relevance, diversity, and readability to the legacy Python pipeline's output for that newsletter.
- [ ] All LLM-calling phases route through OpenRouter using `.env` credentials and per-component model names (overridable via env, with legacy defaults preserved).
- [ ] No persistence, no run records, no Appwrite writes — the engine is pure compute that takes a config and returns a draft string.

## Dependencies
- Stage 00 complete: runnable TS workspace, Vitest, the worker process (the engine is library code the worker will later host), and `.env` with OpenRouter + Appwrite config in place.

## Out of scope
- Appwrite persistence of any kind — run records, intermediate phase state, newsletter definitions. All stage 03.
- Resume-from-checkpoint / resume-from-last-phase. Stage 03.
- Cross-run topic deduplication (temporal diversity). Stage 04.
- GUI, run triggers, run history, scheduling. Stages 02–07.
- Email / RSS-feed / export delivery. Stage 08.
- Prompt template editing — the legacy prompts are ported verbatim as constants here; making them editable is stage 06.
- Per-newsletter model overrides through a UI — defaults + env overrides only here; GUI overrides are stage 06.

## Open questions
- **Trafilatura sidecar packaging** — RESOLVED: dropped the sidecar in favor of a pure-TypeScript extractor (Mozilla Readability + jsdom + turndown). No Python in the deployed system; extraction runs in-process. The engine differs from the legacy trafilatura, so the claim is comparable-purpose extraction, not byte-identical parity — validated by the stage's operator-judged parity check.
- **Prompt fidelity** — port the four legacy prompts (tagger, scorer, drafter, and any embedder prompt) verbatim, or modernize them while porting? Recommendation: port verbatim for the parity check, then tune in stage 06 where editing is the actual feature.
- **Date-range semantics** — the legacy default is "yesterday"; is that the right default for the TS pipeline, and is it a per-newsletter config field or a fixed engine constant? (Stage 02 will make it per-newsletter; here it just needs a sane default.)
- **Test-harness shape** — a Vitest integration test, a standalone CLI script, or both? Recommendation: a standalone script (the parity check is a human-judgment call, not an automated assertion) plus unit tests with mocked LLMs for each phase's contract.
- **Model defaults** — keep the legacy defaults (nemotron tagger/scorer, gemini-3-flash drafter, gemini-embedding-001 embedder) or revisit for the TS rewrite? Recommendation: keep verbatim for parity, revisit during stage 06.

## Pins carried forward

- **`SelectionResult.failures` invariant vs. `target < candidateCount` (from feature-06 verification, 2026-06-30).** The feature-06 acceptance criterion `selectedArticles.length + failures.length === totalArticles` only holds when `target ≥ candidateCount`. The `SelectionResult.failures` field has only two `reason` categories — `below-threshold` and `embedding-failed` — so passed-threshold-but-not-selected articles are neither in `selectedArticles` nor in `failures` when `target < candidateCount`. **Feature 07 (drafter-orchestrator-harness)** must handle this: either assert `target ≥ candidateCount` at the `selectDiverse` call site, or treat the non-selected-above-threshold articles explicitly (they are silently dropped today, which is acceptable for the parity run since production `target = 16 ≥ typical candidateCount`). **Stage 03 (runs-and-history)** should consider adding a third telemetry category (e.g. `not-selected`) to `SelectionFailure.reason` so run records can account for every input article — the invariant `selectedArticles.length + failures.length === totalArticles` cannot otherwise hold universally without it.