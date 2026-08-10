import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <AppSidebar userEmail={user?.email ?? null} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex-1 p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
