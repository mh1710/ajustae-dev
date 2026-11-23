import { Outlet, useRouterState } from '@tanstack/react-router';
import { useAccess } from '@/hooks/use-access';
import { isCompanyRouteAllowed } from '@/lib/company-access-policy';
import { Button } from '@/components/ui/button';
import { Link } from '@tanstack/react-router';
export function CompanyAccessBoundary() {
  const { access, isLoading } = useAccess();
  const pathname = useRouterState({ select: state => state.location.pathname });
  if (isLoading) return <div className="p-8 text-muted-foreground">Conferindo acesso…</div>;
  if (access.company_restricted && !isCompanyRouteAllowed(pathname)) return <div className="p-8 space-y-4"><h1 className="text-xl font-semibold">Acesso restrito</h1><Button asChild><Link to="/produtos">Ver produtos</Link></Button></div>;
  return <Outlet />;
}