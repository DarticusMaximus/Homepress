"use client";

import type { PromptRole } from "@newsletter/shared/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLE_LABELS: Record<PromptRole, string> = {
  tagger: "Tagger",
  scorer: "Scorer",
  drafter: "Drafter",
};

type ResetPromptDialogProps = {
  role: PromptRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
};

export function ResetPromptDialog({
  role,
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: ResetPromptDialogProps) {
  const roleLabel = ROLE_LABELS[role];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset to shipped default</DialogTitle>
          <DialogDescription>
            The {roleLabel} template will be replaced with the built-in shipped default. Unsaved
            edits for this role will be discarded. The change applies on the next run.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Resetting…" : "Reset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
