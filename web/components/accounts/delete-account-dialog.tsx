"use client";

import { useActionState, useEffect } from "react";
import {
  deleteReaderAccountAction,
  type AccountActionResult,
} from "@/app/(protected)/admin/accounts/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AccountRecord } from "@/lib/accounts/account-admin";
import { toast } from "@/lib/toast";

type DeleteAccountDialogProps = {
  account: AccountRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function displayName(account: AccountRecord): string {
  return account.name.trim() !== "" ? account.name : account.email;
}

export function DeleteAccountDialog({ account, open, onOpenChange }: DeleteAccountDialogProps) {
  const [state, formAction, isPending] = useActionState<AccountActionResult | null, FormData>(
    deleteReaderAccountAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Reader deleted");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange]);

  if (!account) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete reader</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{displayName(account)}&rdquo;? This cannot be undone. They will lose
            access immediately.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <input type="hidden" name="userId" value={account.id} />
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
              {isPending ? "Deleting…" : "Delete reader"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
