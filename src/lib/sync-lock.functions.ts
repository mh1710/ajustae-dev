import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Retorna a sincronização em andamento da empresa (ou null). */
export const getActiveSyncLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: member } = await context.supabase
      .from("company_users")
      .select("ativo")
      .eq("company_id", data.company_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member?.ativo) throw new Error("Sem acesso a esta empresa.");
    const { getActiveSync } = await import("@/lib/sync-lock.server");
    return await getActiveSync(data.company_id);
  });
