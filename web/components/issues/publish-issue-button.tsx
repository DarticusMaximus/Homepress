"use client";

import { useTransition } from "react";
import { publishIssueToRssAction } from "@/app/(protected)/issues/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

type PublishIssueButtonProps = {
  runId: string;
};

export function PublishIssueButton({ runId }: PublishIssueButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await publishIssueToRssAction(runId);
          if (result.ok) {
            toast.success("Published to RSS");
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      Publish
    </Button>
  );
}
