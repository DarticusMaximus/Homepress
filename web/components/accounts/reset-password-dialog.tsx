"use client";

import { useActionState, useEffect } from "react";
import {
  resetReaderPasswordAction,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountRecord } from "@/lib/accounts/account-admin";
import { toast } from "@/lib/toast";

const MIN_PASSWORD_LENGTH = 8;

type ResetPasswordDialogProps = {
  account: AccountRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function displayName(account: AccountRecord): string {
  return account.name.trim() !== "" ? account.name : account.email;
}

export function ResetPasswordDialog({ account, open, onOpenChange }: ResetPasswordDialogProps) {
  const [state, formAction, isPending] = useActionState<AccountActionResult | null, FormData>(
    resetReaderPasswordAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Password reset");
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
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for &ldquo;{displayName(account)}&rdquo;. They will use it the next
            time they sign in.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4" autoComplete="off">
          <input type="hidden" name="userId" value={account.id} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-reader-password">New password</Label>
            <Input
              id="reset-reader-password"
              name="password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={isPending}
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
              {isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
