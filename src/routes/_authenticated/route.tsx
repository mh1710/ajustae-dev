import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SelectedCompanyBadge } from "@/components/selected-company-badge";
import { AiJobsBadge } from "@/components/ai-jobs-badge";
import { AuditJobsBadge } from "@/components/audit-jobs-badge";
import { CompanyAccessBoundary } from "@/components/company-access-boundary";
import { setSelectedCompanyId } from "@/hooks/use-selected-company";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    setSelectedCompanyId(undefined);
    // Local scope: leaving on one device must not end other people's sessions on the same login.
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-muted/30">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col bg-transparent">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
            <SidebarTrigger />
            <span className="truncate text-sm font-medium text-foreground/80">Ajusta-Ê</span>
            <div className="ml-auto flex items-center gap-1">
              {user.email && (
                <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:inline">
                  {user.email}
                </span>
              )}
              <ThemeToggle iconOnly className="px-2" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                aria-label="Sair"
                className="px-2"
              >
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-auto">
            <CompanyAccessBoundary />
          </main>
          <SelectedCompanyBadge />
          <AiJobsBadge />
          <AuditJobsBadge />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
