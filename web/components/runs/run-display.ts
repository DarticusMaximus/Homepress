import type { Run, RunStatus, RunTrigger } from "@newsletter/shared";
export { formatOperatorDateTime as formatRunDateTime } from "@/lib/format-operator-datetime";

export type RunBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const RUN_STATUS_BADGE: Record<RunStatus, RunBadgeVariant> = {
  pending: "secondary",
  running: "outline",
  completed: "default",
  failed: "destructive",
};

export function phaseFor(
  run: Pick<Run, "status" | "currentPhase" | "completedPhase" | "failedPhase">,
): string {
  switch (run.status) {
    case "pending":
      return "—";
    case "running":
      return run.currentPhase || "—";
    case "completed":
      return run.completedPhase || "—";
    case "failed":
      return run.failedPhase || "—";
  }
}

export function formatRunTriggerLabel(trigger: RunTrigger): string {
  return trigger === "scheduled" ? "Scheduled" : "Manual";
}
