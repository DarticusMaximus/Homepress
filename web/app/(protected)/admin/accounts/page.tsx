import { Users } from "node-appwrite";
import { getServerAppwrite } from "@newsletter/shared";
import { AccountsView } from "@/components/accounts/accounts-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AccountAdminError, listAccounts, type AccountRecord } from "@/lib/accounts/account-admin";
import { getAuthenticatedUser } from "@/lib/auth/session";

export default async function AccountsPage() {
  const user = await getAuthenticatedUser();
  let accounts: AccountRecord[] = [];
  let loadError: string | null = null;

  try {
    accounts = await listAccounts(new Users(getServerAppwrite()));
  } catch (err) {
    loadError =
      err instanceof AccountAdminError
        ? err.message
        : "Something went wrong while loading accounts. Please try again.";
    console.error("[accounts/page]", err);
  }

  return (
    <main>
      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <AccountsView accounts={accounts} currentOperatorId={user?.$id ?? ""} />
    </main>
  );
}
