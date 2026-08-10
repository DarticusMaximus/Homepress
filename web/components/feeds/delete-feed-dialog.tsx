"use client";

import { useActionState, useEffect } from "react";
import type { Feed } from "@newsletter/shared";
import { deleteFeedAction, type FeedActionResult } from "@/app/(protected)/feeds/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

type DeleteFeedDialogProps = {
  feed: Feed | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteFeedDialog({ feed, open, onOpenChange }: DeleteFeedDialogProps) {
  const [state, formAction, isPending] = useActionState<FeedActionResult | null, FormData>(
    deleteFeedAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Feed deleted");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange]);

  if (!feed) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete feed</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{feed.name}&rdquo;? This cannot be undone. Feeds attached to newsletters
            must be detached first.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <input type="hidden" name="feedId" value={feed.$id} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Deleting…" : "Delete feed"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
