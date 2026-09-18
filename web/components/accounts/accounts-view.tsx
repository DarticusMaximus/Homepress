"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  setAccountBlockedAction,
  type AccountActionResult,
} from "@/app/(protected)/admin/accounts/actions";
import { CreateAccountDialog } from "@/components/accounts/create-account-dialog";
import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog";
import { ResetPasswordDialog } from "@/components/accounts/reset-password-dialog";
import { DomainListCard, DomainListField, ResponsiveList } from "@/components/domain-list";
import { formatOperatorDate } from "@/lib/format-operator-datetime";
import type { AccountRecord, AccountRole, AccountStatus } from "@/lib/accounts/account-admin";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/lib/toast";

type AccountsViewProps = {
  accounts: AccountRecord[];
  currentOperatorId: string;
};

const ROLE_BADGE: Record<AccountRole, "default" | "secondary"> = {
  operator: "default",
  reader: "secondary",
};

const STATUS_BADGE: Record<AccountStatus, "default" | "destructive"> = {
  active: "default",
  blocked: "destructive",
};

function displayName(account: AccountRecord): string {
  return account.name.trim() !== "" ? account.name : account.email;
}

function isProtectedAccount(account: AccountRecord, currentOperatorId: string): boolean {
  return account.role === "operator" || account.id === currentOperatorId;
}

type RowActionHandlers = {
  onToggleBlock: (account: AccountRecord) => void;
  onResetPassword: (account: AccountRecord) => void;
  onDelete: (account: AccountRecord) => void;
};

function AccountRowActions({
  account,
  currentOperatorId,
  onToggleBlock,
  onResetPassword,
  onDelete,
}: {
  account: AccountRecord;
  currentOperatorId: string;
} & RowActionHandlers) {
  if (isProtectedAccount(account, currentOperatorId)) {
    return null;
  }

  const name = displayName(account);
  const blockLabel = account.status === "blocked" ? "Unblock" : "Block";

  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onToggleBlock(account)}
        aria-label={`${blockLabel} ${name}`}
      >
        {blockLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onResetPassword(account)}
        aria-label={`Reset password for ${name}`}
      >
        Reset password
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onDelete(account)}
        aria-label={`Delete ${name}`}
      >
        Delete
      </Button>
    </div>
  );
}

function SetAccountBlockedDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AccountRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState<AccountActionResult | null, FormData>(
    setAccountBlockedAction,
    null,
  );
  const blocking = account?.status !== "blocked";

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success(blocking ? "Reader blocked" : "Reader unblocked");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange, blocking]);

  if (!account) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{blocking ? "Block reader" : "Unblock reader"}</DialogTitle>
          <DialogDescription>
            {blocking ? (
              <>Block &ldquo;{displayName(account)}&rdquo;? Their access ends immediately.</>
            ) : (
              <>Unblock &ldquo;{displayName(account)}&rdquo;? They will be able to sign in again.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <input type="hidden" name="userId" value={account.id} />
          <input type="hidden" name="blocked" value={blocking ? "true" : "false"} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={blocking ? "destructive" : "default"}
              disabled={isPending}
            >
              {isPending
                ? blocking
                  ? "Blocking…"
                  : "Unblocking…"
                : blocking
                  ? "Block reader"
                  : "Unblock reader"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsView({ accounts, currentOperatorId }: AccountsViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<AccountRecord | null>(null);
  const [resetTarget, setResetTarget] = useState<AccountRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountRecord | null>(null);
  const total = accounts.length;

  const handlers: RowActionHandlers = {
    onToggleBlock: (account) => setBlockTarget(account),
    onResetPassword: (account) => setResetTarget(account),
    onDelete: (account) => setDeleteTarget(account),
  };

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Household readers you create in-app. Factory access stays operator-only.
        </p>
      </div>
      <Button type="button" onClick={() => setCreateOpen(true)}>
        <Plus />
        Create reader
      </Button>
    </div>
  );

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name / email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Registered</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell className="font-medium">
              <div className="flex flex-col gap-0.5">
                <span className="block truncate" title={displayName(account)}>
                  {displayName(account)}
                </span>
                {account.name.trim() !== "" ? (
                  <span
                    className="block truncate text-sm font-normal text-muted-foreground"
                    title={account.email}
                  >
                    {account.email}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={ROLE_BADGE[account.role]}>{account.role}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_BADGE[account.status]}>{account.status}</Badge>
            </TableCell>
            <TableCell>{formatOperatorDate(account.registered)}</TableCell>
            <TableCell className="text-right">
              <AccountRowActions
                account={account}
                currentOperatorId={currentOperatorId}
                {...handlers}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {accounts.map((account) => {
        const protectedRow = isProtectedAccount(account, currentOperatorId);
        return (
          <DomainListCard
            key={account.id}
            title={displayName(account)}
            description={account.name.trim() !== "" ? account.email : undefined}
            badges={
              <>
                <Badge variant={ROLE_BADGE[account.role]}>{account.role}</Badge>
                <Badge variant={STATUS_BADGE[account.status]}>{account.status}</Badge>
              </>
            }
            actions={
              protectedRow ? undefined : (
                <AccountRowActions
                  account={account}
                  currentOperatorId={currentOperatorId}
                  {...handlers}
                />
              )
            }
          >
            <DomainListField label="Registered">
              <span>{formatOperatorDate(account.registered)}</span>
            </DomainListField>
          </DomainListCard>
        );
      })}
    </>
  );

  const dialogs = (
    <>
      {createOpen && <CreateAccountDialog open onOpenChange={setCreateOpen} />}
      {blockTarget && (
        <SetAccountBlockedDialog
          key={blockTarget.id}
          account={blockTarget}
          open
          onOpenChange={(open) => {
            if (!open) setBlockTarget(null);
          }}
        />
      )}
      {resetTarget && (
        <ResetPasswordDialog
          key={resetTarget.id}
          account={resetTarget}
          open
          onOpenChange={(open) => {
            if (!open) setResetTarget(null);
          }}
        />
      )}
      {deleteTarget && (
        <DeleteAccountDialog
          key={deleteTarget.id}
          account={deleteTarget}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      )}
    </>
  );

  if (total === 0) {
    return (
      <>
        {header}

        <section
          aria-label="Accounts list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">
            No accounts yet. Create a household reader to get started.
          </p>
          <Button type="button" className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus />
            Create reader
          </Button>
        </section>

        {dialogs}
      </>
    );
  }

  return (
    <>
      {header}

      <section aria-label="Accounts list" className="mt-8">
        <ResponsiveList table={table} cards={cards} />
      </section>

      {dialogs}
    </>
  );
}
