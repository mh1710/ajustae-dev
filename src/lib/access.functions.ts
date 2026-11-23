import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MyAccess = {
  user_id: string;
  is_admin: boolean;
  company_restricted: boolean;
  can_download_sheets: boolean;
  can_push_bling: boolean;
  can_use_ai: boolean;
  active: boolean;
  access_expires_at: string | null;
  expired: boolean;
};

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyAccess> => {
    const [{ data: perms }, { data: roles }] = await Promise.all([
      context.supabase
        .from("user_permissions")
        .select("can_download_sheets, can_push_bling, can_use_ai, active, access_expires_at")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
    ]);

    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    const expiresAt = (perms?.access_expires_at ?? null) as string | null;
    const expired = !!expiresAt && new Date(expiresAt).getTime() < Date.now();
    const active = (perms?.active ?? true) && !expired;

    return {
      user_id: context.userId,
      is_admin: isAdmin,
      company_restricted: (roles ?? []).some((r: { role: string }) => String(r.role) === 'company_viewer'),
      can_download_sheets: isAdmin || (active && !!perms?.can_download_sheets),
      can_push_bling: isAdmin || (active && !!perms?.can_push_bling),
      can_use_ai: isAdmin || (active && !!perms?.can_use_ai),
      active,
      access_expires_at: expiresAt,
      expired,
    };
  });
