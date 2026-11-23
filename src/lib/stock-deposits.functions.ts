import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StockDepositMode = "completo" | "sem_ml" | "nao_atualizar";

export interface StockDepositRow {
  bling_deposit_id: string;
  descricao: string | null;
  padrao: boolean;
  ativo: boolean;
  modo: StockDepositMode;
  zerar_fornecedores: string[];
  synced_at: string | null;
}

async function assertMember(context: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await context.supabase
    .from("company_users")
    .select("ativo")
    .eq("company_id", companyId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ativo) throw new Error("Sem acesso a esta empresa.");
}

export const listStockDeposits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const [deps, sups] = await Promise.all([
      context.supabase
        .from("bling_stock_deposits")
        .select("bling_deposit_id, descricao, padrao, ativo, modo, zerar_fornecedores, synced_at")
        .eq("company_id", data.company_id)
        .order("padrao", { ascending: false })
        .order("descricao"),
      context.supabase
        .from("fornecedores")
        .select("codigo, nome, company_id")
        .or(`company_id.is.null,company_id.eq.${data.company_id}`)
        .neq("codigo", "mercadolivre")
        .order("nome"),
    ]);
    if (deps.error) throw new Error(deps.error.message);
    if (sups.error) throw new Error(sups.error.message);
    const seen = new Set<string>();
    const suppliers = ((sups.data ?? []) as { codigo: string; nome: string }[])
      .filter((s) => s.codigo && !seen.has(s.codigo) && seen.add(s.codigo))
      .map((s) => ({ codigo: s.codigo, nome: s.nome }));
    return { deposits: (deps.data ?? []) as StockDepositRow[], suppliers };
  });

/** Busca os depósitos (estoques) da empresa no Bling; novos entram como "completo". */
export const syncStockDeposits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: integ } = await context.supabase
      .from("bling_integrations")
      .select("id")
      .eq("company_id", data.company_id)
      .eq("status", "conectada")
      .maybeSingle();
    if (!integ) throw new Error("Nenhuma integração Bling conectada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: full } = await supabaseAdmin
      .from("bling_integrations")
      .select("id, company_id, access_token, refresh_token, token_expires_at, status, default_deposito_id")
      .eq("id", (integ as { id: string }).id)
      .maybeSingle();
    if (!full) throw new Error("Integração não encontrada.");
    const { blingApiGet } = await import("./bling.server");
    const res = await blingApiGet<{ data?: any[] }>(full as never, `/depositos?pagina=1&limite=100`);
    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? "O Bling recusou o acesso aos depósitos. Marque as permissões de Estoques e Depósitos no aplicativo desta empresa e reconecte."
          : res.errorMessage ?? `Bling respondeu HTTP ${res.status}`,
      );
    }
    const rows = (res.data?.data ?? []).filter((d) => d?.id != null);
    if (rows.length === 0) throw new Error("O Bling não retornou nenhum depósito para esta empresa.");
    const now = new Date().toISOString();
    const defaultId = (full as { default_deposito_id?: string | null }).default_deposito_id ?? null;
    const payload = rows.map((d) => ({
      company_id: data.company_id,
      bling_deposit_id: String(d.id),
      descricao: d.descricao ? String(d.descricao) : null,
      padrao: d.padrao === true || String(d.id) === defaultId,
      ativo: d.situacao === undefined || d.situacao === null || Number(d.situacao) === 1 || d.situacao === "A",
      synced_at: now,
      updated_at: now,
    }));
    // Upsert sem tocar em modo/fornecedores zerados de depósitos já configurados.
    const { error } = await context.supabase
      .from("bling_stock_deposits")
      .upsert(payload, { onConflict: "company_id,bling_deposit_id" });
    if (error) throw new Error(error.message);
    const ids = payload.map((p) => p.bling_deposit_id);
    const { error: offErr } = await context.supabase
      .from("bling_stock_deposits")
      .update({ ativo: false, updated_at: now })
      .eq("company_id", data.company_id)
      .not("bling_deposit_id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
    if (offErr) throw new Error(offErr.message);
    return { total: rows.length, ativos: payload.filter((p) => p.ativo).length };
  });

export const saveStockDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      bling_deposit_id: z.string().min(1),
      modo: z.enum(["completo", "sem_ml", "nao_atualizar"]),
      zerar_fornecedores: z.array(z.string().min(1)).max(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: row, error } = await context.supabase
      .from("bling_stock_deposits")
      .update({
        modo: data.modo,
        zerar_fornecedores: Array.from(new Set(data.zerar_fornecedores)),
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", data.company_id)
      .eq("bling_deposit_id", data.bling_deposit_id)
      .select("bling_deposit_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Depósito não encontrado. Busque os estoques do Bling novamente.");
    return { ok: true };
  });
