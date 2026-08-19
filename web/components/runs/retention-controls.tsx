"use client";

import { useState } from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { purgeRunsNow, updateRunRetentionSetting } from "@/app/(protected)/admin/runs/actions";

type RetentionControlsProps = {
  retentionDays: number;
};

export function RetentionControls({ retentionDays }: RetentionControlsProps) {
  const [value, setValue] = useState(String(retentionDays));
  const [isSaving, startSaveTransition] = useTransition();
  const [isCleaning, startCleanTransition] = useTransition();

  return (
    <section
      className="mb-6 rounded-lg border border-border bg-card p-4"
      aria-label="Run retention settings"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="run-retention-days">Keep run history for</Label>
          <div className="flex items-center gap-2">
            <Input
              id="run-retention-days"
              type="number"
              min={1}
              max={365}
              step={1}
              inputMode="numeric"
              className="w-24"
              value={value}
              disabled={isSaving}
              onChange={(e) => setValue(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          onClick={() => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
              toast.error("Retention must be a whole number between 1 and 365.");
              return;
            }
            startSaveTransition(async () => {
              const result = await updateRunRetentionSetting(parsed);
              if (result.ok) {
                toast.success(`Run history kept for ${result.days} days`);
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isCleaning}
          onClick={() => {
            startCleanTransition(async () => {
              const result = await purgeRunsNow();
              if (result.ok) {
                if (result.errors > 0) {
                  toast.warning(
                    `Removed ${result.deleted} old run${result.deleted === 1 ? "" : "s"} (${result.errors} failed)`,
                  );
                } else {
                  toast.success(
                    result.deleted > 0
                      ? `Removed ${result.deleted} old run${result.deleted === 1 ? "" : "s"}`
                      : "No old runs to remove",
                  );
                }
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          {isCleaning ? "Cleaning…" : "Clean up now"}
        </Button>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Older runs are removed automatically. Each newsletter&apos;s latest three completed runs are
        always kept.
      </p>
    </section>
  );
}
