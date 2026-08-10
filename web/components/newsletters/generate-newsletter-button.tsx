"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { startNewsletterRun } from "@/app/(protected)/newsletters/actions";

export type ActiveRunState = {
  runId: string;
  status: "pending" | "running";
};

type GenerateNewsletterButtonProps = {
  newsletterId: string;
  newsletterName: string;
  activeRun?: ActiveRunState;
};

export function GenerateNewsletterButton({
  newsletterId,
  newsletterName,
  activeRun,
}: GenerateNewsletterButtonProps) {
  const [isPending, startTransition] = useTransition();
  const generating = Boolean(activeRun) || isPending;

  return (
    <Button
      type="button"
      size="sm"
      aria-label={`Generate ${newsletterName}`}
      disabled={generating}
      onClick={() => {
        startTransition(async () => {
          const result = await startNewsletterRun(newsletterId);
          if (result.ok) {
            toast.success("Run started");
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      {generating ? "Generating…" : "Generate"}
    </Button>
  );
}
