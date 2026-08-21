"use client";

import type { EmailDeliveryStatus, RssDeliveryStatus } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Locked copy — Feature 04 Task 4 (curly apostrophe in “issue’s”). */
export const REGENERATE_DRAFT_BODY =
  "Replace this issue’s draft with a new one from the same selected articles? Fetch, tags, scores, and selection will not run again.";

export const REGENERATE_DRAFT_DELIVERY_WARNING =
  "Email and RSS already delivered will not be updated. Send or Publish again if you want the new draft delivered.";

export function showRegenerateDeliveryWarning(
  emailDeliveryStatus: EmailDeliveryStatus,
  rssDeliveryStatus: RssDeliveryStatus,
): boolean {
  return emailDeliveryStatus === "sent" || rssDeliveryStatus === "published";
}

type RegenerateDraftDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
  emailDeliveryStatus: EmailDeliveryStatus;
  rssDeliveryStatus: RssDeliveryStatus;
};

export function RegenerateDraftDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
  emailDeliveryStatus,
  rssDeliveryStatus,
}: RegenerateDraftDialogProps) {
  const deliveryWarning = showRegenerateDeliveryWarning(emailDeliveryStatus, rssDeliveryStatus);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate draft</DialogTitle>
          <DialogDescription>{REGENERATE_DRAFT_BODY}</DialogDescription>
        </DialogHeader>

        {deliveryWarning ? (
          <p className="text-sm text-muted-foreground">{REGENERATE_DRAFT_DELIVERY_WARNING}</p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Regenerating…" : "Regenerate draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
