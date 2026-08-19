"use client";

import { useState, useTransition } from "react";
import type { SettingsDiagnosticActionResult } from "@/app/(protected)/admin/settings/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

export type ConnectionDiagnosticButtonProps = {
  label: string;
  pendingLabel: string;
  run: () => Promise<SettingsDiagnosticActionResult>;
  disabled?: boolean;
};

function statusLabel(status: SettingsDiagnosticActionResult["status"]): string {
  if (status === "pass") return "Pass";
  if (status === "fail") return "Fail";
  return "Warn";
}

/**
 * One Connections diagnostic control: pending label, toast, ephemeral inline status.
 * Results are UI-only — not persisted.
 */
export function ConnectionDiagnosticButton({
  label,
  pendingLabel,
  run,
  disabled = false,
}: ConnectionDiagnosticButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SettingsDiagnosticActionResult | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || isPending}
        onClick={() => {
          startTransition(async () => {
            const outcome = await run();
            setResult(outcome);
            if (outcome.status === "pass") {
              toast.success(outcome.message);
            } else if (outcome.status === "fail") {
              toast.error(outcome.message);
            } else {
              toast.warning(outcome.message);
            }
          });
        }}
      >
        {isPending ? pendingLabel : label}
      </Button>
      {result ? (
        <p className="text-sm text-muted-foreground" data-testid="connection-diagnostic-status">
          <span className="font-medium">{statusLabel(result.status)}</span>
          {": "}
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
