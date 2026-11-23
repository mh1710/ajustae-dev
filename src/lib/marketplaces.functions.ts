import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Marketplace = {
  id: string;
  nome: string;
  taxa_percent: number;
  created_at: string;
  updated_at: string;
};

export const listMarketplaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data: input, context }): Promise<Marketplace[]> => {
    await ensureMember(context.supabase, input.company_id, context.userId);
    const { data: fees, error: feeError } = await (context.supabase as any)
      .from("company_marketplace_fees").select("marketplace_id, taxa_percent").eq("company_id", input.company_id);
    if (feeError) throw new Error(feeError.message);
    const feeMap = new Map<string, number>((fees ?? []).map((f: any) => [f.marketplace_id, Number(f.taxa_percent)]));
    const { data, error } = await context.supabase
      .from("marketplaces")
      .select("*")
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      taxa_percent: feeMap.get(r.id) ?? Number(r.taxa_percent),
    }));
  });

export const upsertMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        company_id: z.string().uuid(),
        id: z.string().uuid().optional(),
        nome: z.string().trim().min(1, "Nome obrigatório"),
        taxa_percent: z.number().min(0).max(100),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await ensureMember(context.supabase, data.company_id, context.userId);
    const { error } = await (context.supabase as any).rpc("save_company_marketplace", {
      _company_id: data.company_id, _marketplace_id: data.id ?? null,
      _nome: data.nome, _taxa_percent: data.taxa_percent,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function ensureMember(supabase: import("@supabase/supabase-js").SupabaseClient, companyId: string, userId: string) {
  const { data, error } = await supabase.from("company_users").select("ativo")
    .eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ativo) throw new Error("Sem acesso à empresa selecionada.");
}

export const deleteMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("marketplaces")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
