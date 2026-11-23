import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Plug,
  Settings,
  Package,
  Upload,
  ShieldCheck,
  Download,
  Sliders,
  Truck,
  Radio,
  Store,
  ShoppingBag,
  Calculator,
  BarChart3,
  ShieldPlus,
  Zap,
  ListChecks,
  FolderTree,
  Mail,
} from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { isCompanyRouteAllowed } from "@/lib/company-access-policy";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import logo from "@/assets/ajusta-e-logo-menu.svg.asset.json";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/empresas", label: "Empresas", icon: Building2 },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/categorias", label: "Categorias", icon: FolderTree },
  { to: "/campos-customizados", label: "Campos customizados", icon: ListChecks },
  { to: "/multilojas", label: "Multilojas", icon: Store },
  { to: "/importacoes", label: "Importações", icon: Upload },
  { to: "/fornecedores", label: "Fornecedores", icon: Truck },
  { to: "/marketplaces", label: "Marketplaces", icon: ShoppingBag },
  { to: "/precificacao", label: "Preço e Estoque", icon: Calculator },
  { to: "/bi", label: "BI & DRE", icon: BarChart3 },
  { to: "/automacoes", label: "Automações", icon: Zap },
  { to: "/anatel", label: "ANATEL", icon: Radio },
  { to: "/regras-validacao", label: "Regras", icon: Sliders },
  { to: "/auditoria", label: "Auditoria", icon: ShieldCheck },
  { to: "/exportacoes", label: "Exportações", icon: Download },
  { to: "/integracoes", label: "Integrações", icon: Plug },
  { to: "/codigos-email", label: "Códigos de e-mail", icon: Mail },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const { access } = useAccess();
  const items = access.is_admin
    ? [...nav, { to: "/admin", label: "Admin", icon: ShieldPlus } as const]
    : access.company_restricted
      ? nav.filter((item) => isCompanyRouteAllowed(item.to))
      : nav;

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border bg-sidebar p-0">
        <div
          className={`flex items-center justify-center bg-sidebar transition-all ${
            collapsed ? "h-14 px-2" : "h-16 px-4"
          }`}
        >
          <img
            src={logo.url}
            alt="Ajusta-Ê"
            className={`object-contain transition-all ${collapsed ? "h-8 w-8" : "h-11 w-auto"}`}
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-hidden bg-sidebar">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="h-8 text-sidebar-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    >
                      <Link to={item.to} onClick={() => isMobile && setOpenMobile(false)}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
