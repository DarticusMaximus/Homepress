"use client";

import { useActionState, useEffect } from "react";
import type { Newsletter } from "@newsletter/shared";
import {
  deleteNewsletterAction,
  type NewsletterActionResult,
} from "@/app/(protected)/newsletters/actions";
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

type DeleteNewsletterDialogProps = {
  newsletter: Newsletter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteNewsletterDialog({
  newsletter,
  open,
  onOpenChange,
}: DeleteNewsletterDialogProps) {
  const [state, formAction, isPending] = useActionState<NewsletterActionResult | null, FormData>(
    deleteNewsletterAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Newsletter deleted");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange]);

  if (!newsletter) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete newsletter</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{newsletter.name}&rdquo;? This cannot be undone. Any feeds attached to it
            will be detached.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <input type="hidden" name="newsletterId" value={newsletter.$id} />
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
              {isPending ? "Deleting…" : "Delete newsletter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
