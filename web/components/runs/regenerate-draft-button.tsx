"use client";

import { useState, useTransition } from "react";
import type { EmailDeliveryStatus, RssDeliveryStatus } from "@newsletter/shared";
import { regenerateDraft } from "@/app/(protected)/admin/runs/actions";
import { Button } from "@/components/ui/button";
import { RegenerateDraftDialog } from "@/components/runs/regenerate-draft-dialog";
import { toast } from "@/lib/toast";

export type RegenerateDraftButtonProps = {
  runId: string;
  newsletterName: string;
  emailDeliveryStatus: EmailDeliveryStatus;
  rssDeliveryStatus: RssDeliveryStatus;
};

export function RegenerateDraftButton({
  runId,
  newsletterName,
  emailDeliveryStatus,
  rssDeliveryStatus,
}: RegenerateDraftButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Regenerate draft for ${newsletterName}`}
        disabled={isPending}
        onClick={() => setOpen(true)}
      >
        {isPending ? "Regenerating…" : "Regenerate draft"}
      </Button>
      <RegenerateDraftDialog
        open={open}
        onOpenChange={setOpen}
        isPending={isPending}
        emailDeliveryStatus={emailDeliveryStatus}
        rssDeliveryStatus={rssDeliveryStatus}
        onConfirm={() => {
          startTransition(async () => {
            const result = await regenerateDraft(runId);
            if (result.ok) {
              toast.success("Draft regeneration started");
              setOpen(false);
            } else {
              toast.error(result.error);
            }
          });
        }}
      />
    </>
  );
}
