"use client";

import { useActionState, useEffect } from "react";
import {
  createReaderAccountAction,
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
import { toast } from "@/lib/toast";

const MIN_PASSWORD_LENGTH = 8;

type CreateAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
  const [state, formAction, isPending] = useActionState<AccountActionResult | null, FormData>(
    createReaderAccountAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Reader created");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create reader</DialogTitle>
          <DialogDescription>
            Add a household reader. They can sign in and read issues — they cannot reach the
            factory.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4" autoComplete="off">
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-reader-name">Name</Label>
            <Input id="create-reader-name" name="name" disabled={isPending} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-reader-email">Email</Label>
            <Input
              id="create-reader-email"
              name="email"
              type="email"
              required
              disabled={isPending}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-reader-password">Password</Label>
            <Input
              id="create-reader-password"
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
              {isPending ? "Creating…" : "Create reader"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
