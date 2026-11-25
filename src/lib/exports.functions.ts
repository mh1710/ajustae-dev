import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { serializeBlingCsv } from "@/lib/sheet-mapping";

async function assertMember(ctx: { supabase: any; userId: string }, companyId: string) {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", ctx.userId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sem acesso a esta empresa.");
}

function exportId(row: Record<string, unknown>): string {
  const blingId = row.bling_product_id == null ? "" : String(row.bling_product_id).trim();
  if (blingId) return blingId;
  // Bases copiadas de outra empresa não possuem um vínculo próprio com o
  // Bling. Quando o ID original estiver ausente, mantém a primeira coluna
  // preenchida com a identidade persistente do produto.
  return row.id == null ? "" : String(row.id);
}

/**
 * Exporta produtos como CSV(s) no layout do Bling.
 * `filter`:
 *  - 'all'            → todos os produtos da empresa
 *  - 'selected'       → precisa `product_ids`
 *  - 'with_errors'    → produtos com last_audit_errors > 0
 *  - 'without_errors' → produtos com last_audit_errors = 0 e algum resultado
 *  - 'dirty'          → produtos modificados (dirty = true)
 * Retorna array de arquivos (nome + conteúdo base64). Se >1 arquivo, também um ZIP.
 */
/**
 * Exporta uma página de produtos como CSV (layout do Bling). O cliente
 * pagina em blocos de até 1000 e monta o arquivo único (ou o ZIP com vários
 * arquivos de 1000) no navegador — assim não estouramos memória/timeout do
 * Worker mesmo com dezenas de milhares de produtos.
 */
export const exportProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        filter: z.enum(["all", "selected", "with_errors", "without_errors", "dirty"]),
        // Seleções grandes são enviadas pelo cliente em blocos para não
        // ultrapassar o limite do corpo da requisição do servidor.
        product_ids: z.array(z.string().uuid()).max(100).default([]),
        // Em exportações selecionadas grandes, cada chamada recebe apenas o
        // bloco atual, mas estes valores preservam o progresso global.
        total_override: z.number().int().min(0).optional(),
        next_offset_override: z.number().int().min(0).nullable().optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(500),
        include_header: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let rows: Record<string, unknown>[] = [];
    let total = 0;

    if (data.filter === "selected") {
      total = data.total_override ?? data.product_ids.length;
      if (total === 0) return { csv: "", count: 0, total: 0, next_offset: null as number | null };
      const slice = data.product_ids.slice(0, data.limit);
      if (slice.length === 0) {
        return { csv: "", count: 0, total, next_offset: null as number | null };
      }
      const { data: r, error } = await supabaseAdmin
        .from("bling_products")
        .select("*")
        .eq("company_id", data.company_id)
        .in("id", slice)
        .order("codigo", { ascending: true });
      if (error) throw new Error(error.message);
      rows = (r ?? []) as Record<string, unknown>[];
    } else {
      let q = supabaseAdmin
        .from("bling_products")
        .select("*", { count: "exact" })
        .eq("company_id", data.company_id)
        .order("codigo", { ascending: true })
        .range(data.offset, data.offset + data.limit - 1);
      if (data.filter === "with_errors") q = q.gt("last_audit_errors", 0);
      else if (data.filter === "without_errors")
        q = q.eq("last_audit_errors", 0).not("last_audit_at", "is", null);
      else if (data.filter === "dirty") q = q.eq("dirty", true);
      const { data: r, error, count } = await q;
      if (error) throw new Error(error.message);
      rows = (r ?? []) as Record<string, unknown>[];
      total = count ?? 0;
    }

    const csv = serializeBlingCsv(
      rows.map((row) => ({ ...row, bling_product_id: exportId(row) })),
      { includeHeader: data.include_header },
    );
    const advanced = data.offset + rows.length;
    const hasMore = rows.length > 0 && rows.length === data.limit && advanced < total;
    const nextOffset = data.filter === "selected"
      ? (data.next_offset_override ?? null)
      : hasMore ? advanced : null;
    return { csv, count: rows.length, total, next_offset: nextOffset as number | null };
  });
/**
 * Uma página (até 1000 produtos) da planilha de vínculo multiloja. O preço
 * vem da política de precificação com a taxa do marketplace da multiloja;
 * sem custo de fornecedor, usa o preço atual na loja ou o do produto.
 */
export const exportMultistorePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        bling_store_id: z.string().min(1).max(40),
        scope: z.enum(["linked", "all"]),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(1000).default(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await (supabaseAdmin as any).rpc("multistore_export_page", {
      _company_id: data.company_id,
      _bling_store_id: data.bling_store_id,
      _scope: data.scope,
      _offset: data.offset,
      _limit: data.limit,
    });
    if (error) throw new Error(error.message);
    const r = res as {
      total: number;
      store_id: string;
      store_name: string;
      rows: { bling_product_id: string; nome: string | null; codigo: string | null; preco: number | null; fonte: string | null }[];
    };
    const rows = r.rows ?? [];
    const advanced = data.offset + rows.length;
    return {
      total: r.total ?? 0,
      store_id: r.store_id,
      store_name: r.store_name,
      rows: rows.map((x) => ({ ...x, preco: x.preco == null ? null : Number(x.preco) })),
      next_offset: rows.length > 0 && advanced < (r.total ?? 0) ? advanced : null,
    };
  });
