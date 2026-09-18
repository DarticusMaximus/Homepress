import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { isOperator } from "@/lib/auth/require-operator";

// Factory UI talks to Appwrite via runtime env. Never prerender these routes
// at image build time (CI has no Appwrite credentials).
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user || !isOperator(user)) {
    redirect("/");
  }

  return children;
}
