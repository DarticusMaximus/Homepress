"use client";

import { useTransition } from "react";
import { sendIssueEmailAction } from "@/app/(protected)/issues/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

type SendIssueButtonProps = {
  runId: string;
};

function successToastMessage(recipientCount: number): string {
  return recipientCount === 1
    ? "Sent to 1 recipient"
    : `Sent to ${recipientCount} recipients`;
}

export function SendIssueButton({ runId }: SendIssueButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await sendIssueEmailAction(runId);
          if (result.ok) {
            toast.success(successToastMessage(result.recipientCount));
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      Send
    </Button>
  );
}
