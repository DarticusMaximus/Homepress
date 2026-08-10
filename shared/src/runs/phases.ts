import type { RunPhase } from "../schema/declarations";

export const PHASE_ORDER = ["fetch", "scrape", "tag", "score", "selection", "draft"] as const;

export function nextPhase(phase: RunPhase): RunPhase | null {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0 || idx === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

export function resumeStartPhase(completedPhase: RunPhase | null | ""): RunPhase | null {
  if (completedPhase === null || completedPhase === "") return "fetch";
  return nextPhase(completedPhase);
}
