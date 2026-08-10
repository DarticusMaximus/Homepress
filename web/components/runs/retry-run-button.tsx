"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { retryFailedRun } from "@/app/(protected)/runs/actions";

type RetryRunButtonProps = {
  runId: string;
  newsletterName: string;
};

export function RetryRunButton({ runId, newsletterName }: RetryRunButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Retry ${newsletterName}`}
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await retryFailedRun(runId);
          if (result.ok) {
            toast.success("Retry started");
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      {isPending ? "Retrying…" : "Retry"}
    </Button>
  );
}
