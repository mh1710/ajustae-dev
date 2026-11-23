import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const scope = z.object({ company_id: z.string().uuid(), product_ids: z.array(z.string().uuid()).min(1).max(100) });

async function assertMember(context: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await context.supabase.from("company_users").select("id")
    .eq("company_id", companyId).eq("user_id", context.userId).eq("ativo", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

export type NcmSuggestion = {
  id: string;
  sku: string;
  nome: string;
  ncm: string | null;
  fornecedor: string | null;
  error?: string;
};

export const suggestNcmBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scope.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { rows, error } = await context.supabase.from("bling_products")
      .select("id,codigo,nome,ncm").eq("company_id", data.company_id).in("id", data.product_ids)
      .then((r: any) => ({ rows: r.data, error: r.error }));
    if (error) throw new Error(error.message);
    const { data: matches, error: matchError } = await context.supabase.rpc("suggest_supplier_ncm" as never, {
      _company_id: data.company_id, _product_ids: data.product_ids,
    } as never);
    if (matchError) throw new Error(matchError.message);
    const byId = new Map<string, { ncm: string; nome: string; fornecedor_nome: string }[]>();
    for (const match of (matches ?? []) as { product_id: string; ncm: string; nome: string; fornecedor_nome: string }[]) {
      const current = byId.get(match.product_id) ?? [];
      current.push(match);
      byId.set(match.product_id, current);
    }
    const items: NcmSuggestion[] = (rows ?? []).map((p: { id: string; codigo: string; nome: string; ncm: string | null }) => {
      const candidates = byId.get(p.id) ?? [];
      const distinct = [...new Set(candidates.map((c) => c.ncm))];
      return {
        id: p.id, sku: p.codigo, nome: candidates[0]?.nome || p.nome, fornecedor: candidates[0]?.fornecedor_nome ?? null,
        ncm: p.ncm?.trim() ? null : distinct.length === 1 ? distinct[0] : null,
        error: p.ncm?.trim() ? "NCM já preenchido." : distinct.length > 1 ? "NCMs diferentes no fornecedor; confira manualmente." : distinct.length === 0 ? "NCM não encontrado no fornecedor." : undefined,
      };
    });
    return { items };
  });

export const applyNcmSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid(), items: z.array(z.object({ id: z.string().uuid(), ncm: z.string().regex(/^\d{8}$/) })).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: matches, error: matchError } = await context.supabase.rpc("suggest_supplier_ncm" as never, {
      _company_id: data.company_id, _product_ids: data.items.map((item) => item.id),
    } as never);
    if (matchError) throw new Error(matchError.message);
    const valid = new Map<string, Set<string>>();
    for (const row of (matches ?? []) as { product_id: string; ncm: string }[]) {
      const values = valid.get(row.product_id) ?? new Set<string>();
      values.add(row.ncm);
      valid.set(row.product_id, values);
    }
    let updated = 0;
    for (const item of data.items) {
      const options = valid.get(item.id);
      if (options?.size !== 1 || !options.has(item.ncm)) continue;
      const { data: changed, error } = await supabaseAdmin.from("bling_products")
        .update({ ncm: item.ncm, dirty: true })
        .eq("company_id", data.company_id).eq("id", item.id).or("ncm.is.null,ncm.eq.")
        .select("id");
      if (error) throw new Error(error.message);
      updated += changed?.length ?? 0;
    }
    return { updated };
  });