import type { Client } from "node-appwrite";
import type {
  DraftCheckpointPayload,
  FetchCheckpoint,
  PhaseArticleListPhase,
  Run,
  ScrapeCheckpoint,
  ScoreCheckpoint,
  SelectionCheckpoint,
  SuppressSummary,
  TagCheckpoint,
} from "@newsletter/shared";
import {
  getRun,
  loadPhaseCheckpointFromRun,
  RunRepositoryError,
  sanitizeAppwriteMessageForLog,
} from "@newsletter/shared";
import type { PhaseLoadResult } from "@/components/runs/inspect-phase-section";
import type { RunLookup } from "@/components/runs/run-suppress-summary";

/** Checkpoint id fields for the four Inspect candidate phases. */
const PHASE_CHECKPOINT_ID: Record<PhaseArticleListPhase, keyof Run> = {
  fetch: "checkpointFetchId",
  scrape: "checkpointScrapeId",
  tag: "checkpointTagId",
  score: "checkpointScoreId",
};

const INSPECT_PHASES: readonly PhaseArticleListPhase[] = [
  "fetch",
  "scrape",
  "tag",
  "score",
];

export type InspectPhaseLoads = {
  fetch: PhaseLoadResult<FetchCheckpoint>;
  scrape: PhaseLoadResult<ScrapeCheckpoint>;
  tag: PhaseLoadResult<TagCheckpoint>;
  score: PhaseLoadResult<ScoreCheckpoint>;
};

function logPhaseLoadFailure(
  checkpointPhase: PhaseArticleListPhase | "selection" | "draft",
  err: unknown,
): void {
  if (err instanceof RunRepositoryError) {
    console.error({
      phase: "runs/[runId]/inspect/phase",
      checkpointPhase,
      code: err.code,
      message: sanitizeAppwriteMessageForLog(err.message),
    });
    return;
  }
  console.error({
    phase: "runs/[runId]/inspect/phase",
    checkpointPhase,
    message: sanitizeAppwriteMessageForLog(
      err instanceof Error ? err.message : String(err),
    ),
  });
}

function logPriorRunLookupFailure(matchedRunId: string, err: unknown): void {
  if (err instanceof RunRepositoryError && err.code === "not_found") {
    return;
  }
  if (err instanceof RunRepositoryError) {
    console.error({
      phase: "runs/[runId]/inspect/prior-run",
      matchedRunId,
      code: err.code,
      message: sanitizeAppwriteMessageForLog(err.message),
    });
    return;
  }
  console.error({
    phase: "runs/[runId]/inspect/prior-run",
    matchedRunId,
    message: sanitizeAppwriteMessageForLog(
      err instanceof Error ? err.message : String(err),
    ),
  });
}

/**
 * Map one phase load to UI status. Empty checkpoint id → missing (no Storage).
 * `checkpoint_missing` (incl. Storage 404 / corrupt JSON) → missing.
 * `appwrite` / unexpected → error (safe UI only).
 */
async function loadOneInspectPhase(
  client: Client,
  run: Run,
  phase: PhaseArticleListPhase,
): Promise<PhaseLoadResult<FetchCheckpoint | ScrapeCheckpoint | TagCheckpoint | ScoreCheckpoint>> {
  const fileId = run[PHASE_CHECKPOINT_ID[phase]];
  if (typeof fileId !== "string" || fileId.length === 0) {
    return { status: "missing" };
  }

  try {
    const data = await loadPhaseCheckpointFromRun(client, run, phase);
    return { status: "loaded", data };
  } catch (err) {
    if (err instanceof RunRepositoryError && err.code === "checkpoint_missing") {
      return { status: "missing" };
    }
    logPhaseLoadFailure(phase, err);
    return { status: "error" };
  }
}

/**
 * Load fetch/scrape/tag/score checkpoints in parallel from an in-memory `Run`
 * (no per-phase `getRun`). Does not load selection or draft.
 */
export async function loadInspectPhases(
  client: Client,
  run: Run,
): Promise<InspectPhaseLoads> {
  const settled = await Promise.allSettled(
    INSPECT_PHASES.map((phase) => loadOneInspectPhase(client, run, phase)),
  );

  const results = INSPECT_PHASES.map((phase, i) => {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      return outcome.value;
    }
    // loadOneInspectPhase should not reject — defensive
    logPhaseLoadFailure(phase, outcome.reason);
    return { status: "error" as const };
  });

  return {
    fetch: results[0] as PhaseLoadResult<FetchCheckpoint>,
    scrape: results[1] as PhaseLoadResult<ScrapeCheckpoint>,
    tag: results[2] as PhaseLoadResult<TagCheckpoint>,
    score: results[3] as PhaseLoadResult<ScoreCheckpoint>,
  };
}

/**
 * Load the selection checkpoint from an in-memory `Run` (no `getRun`).
 * Same missing / error mapping as Feature 05 phases. Does not load draft.
 */
export async function loadInspectSelection(
  client: Client,
  run: Run,
): Promise<PhaseLoadResult<SelectionCheckpoint>> {
  const fileId = run.checkpointSelectionId;
  if (typeof fileId !== "string" || fileId.length === 0) {
    return { status: "missing" };
  }

  try {
    const data = await loadPhaseCheckpointFromRun(client, run, "selection");
    return { status: "loaded", data };
  } catch (err) {
    if (err instanceof RunRepositoryError && err.code === "checkpoint_missing") {
      return { status: "missing" };
    }
    logPhaseLoadFailure("selection", err);
    return { status: "error" };
  }
}

/**
 * Load the draft checkpoint from an in-memory `Run` (no `getRun`).
 * Same missing / error mapping as Feature 05/06 phases.
 */
export async function loadInspectDraft(
  client: Client,
  run: Run,
): Promise<PhaseLoadResult<DraftCheckpointPayload>> {
  const fileId = run.checkpointDraftId;
  if (typeof fileId !== "string" || fileId.length === 0) {
    return { status: "missing" };
  }

  try {
    const data = await loadPhaseCheckpointFromRun(client, run, "draft");
    return { status: "loaded", data };
  } catch (err) {
    if (err instanceof RunRepositoryError && err.code === "checkpoint_missing") {
      return { status: "missing" };
    }
    logPhaseLoadFailure("draft", err);
    return { status: "error" };
  }
}

/**
 * Best-effort `getRun` for unique non-empty `matchedRunId`s in a suppress
 * summary. Failures (404 / Appwrite) omit that id so Stage 05 short-id
 * fallback applies — never fails the Inspect page.
 */
export async function loadPriorRunLookupForSuppress(
  client: Client,
  summary: SuppressSummary,
): Promise<RunLookup> {
  const ids = [
    ...new Set(
      summary.items
        .map((item) => item.matchedRunId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  if (ids.length === 0) {
    return {};
  }

  const lookup: RunLookup = {};
  const settled = await Promise.allSettled(
    ids.map(async (matchedRunId) => {
      const prior = await getRun(client, matchedRunId);
      return {
        matchedRunId,
        entry: { endedAt: prior.endedAt, startedAt: prior.startedAt },
      };
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const matchedRunId = ids[i];
    if (outcome.status === "fulfilled") {
      lookup[outcome.value.matchedRunId] = outcome.value.entry;
      continue;
    }
    logPriorRunLookupFailure(matchedRunId, outcome.reason);
  }

  return lookup;
}
