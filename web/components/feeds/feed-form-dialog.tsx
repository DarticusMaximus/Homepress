"use client";

import { useActionState, useEffect } from "react";
import type { Feed, FeedStatus } from "@newsletter/shared";
import {
  createFeedAction,
  updateFeedAction,
  type FeedActionResult,
} from "@/app/(protected)/admin/feeds/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { formatFeedStatusLabel } from "@/lib/status-labels";

const STATUS_BADGE: Record<FeedStatus, "default" | "secondary" | "destructive"> = {
  untested: "secondary",
  ok: "default",
  failed: "destructive",
};

type FeedFormDialogProps = {
  mode: "create" | "edit";
  feed?: Feed;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FeedFormDialog({ mode, feed, open, onOpenChange }: FeedFormDialogProps) {
  const action = mode === "create" ? createFeedAction : updateFeedAction;
  const [state, formAction, isPending] = useActionState<FeedActionResult | null, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success(mode === "create" ? "Feed created" : "Feed updated");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, mode, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add feed" : "Edit feed"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Add a shared RSS source to qualify before attaching to newsletters."
              : "Update name, URL, or notes. Changing the URL resets qualification status."}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {mode === "edit" && feed && (
            <>
              <input type="hidden" name="feedId" value={feed.$id} />
              <div className="flex flex-col gap-2">
                <Label>Status</Label>
                <div>
                  <Badge variant={STATUS_BADGE[feed.status]}>
                    {formatFeedStatusLabel(feed.status)}
                  </Badge>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${mode}-name`}>Name</Label>
            <Input
              id={`${mode}-name`}
              name="name"
              defaultValue={feed?.name ?? ""}
              required
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${mode}-url`}>URL</Label>
            <Input
              id={`${mode}-url`}
              name="url"
              type="url"
              defaultValue={feed?.url ?? ""}
              required
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${mode}-notes`}>Notes</Label>
            <Textarea
              id={`${mode}-notes`}
              name="notes"
              defaultValue={feed?.notes ?? ""}
              disabled={isPending}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : mode === "create" ? "Add feed" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
