import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Importação de produtos 100% aprovados na auditoria de outra empresa da conta.
 *
 * "100% correto" = produto já auditado (last_audit_at preenchido) sem nenhum
 * erro e sem nenhum aviso na última auditoria. Só entram na lista SKUs que
 * ainda não existem na empresa de destino.
 */

/** Colunas que NÃO são copiadas: identidade, vínculo com o Bling e dados de sincronização. */
const SKIP_COLUMNS = new Set([
  "id",
  "company_id",
  "created_at",
  "updated_at",
  "integration_id",
  "bling_product_id",
  "bling_created_at",
  "bling_updated_at",
  "bling_deposit_id",
  "categoria_id",
  "last_seen_sync_job_id",
  "last_imported_at",
  "last_audit_at",
  "last_audit_errors",
  "last_audit_warnings",
  "last_audit_passed",
  "detail_sync_error",
  "detail_synced",
  "detail_synced_at",
  "sincronizacao_erro",
  "sincronizacao_status",
  "sincronizado_em",
  "ultimo_estoque_sincronizado",
  "ultimo_preco_sincronizado",
  "dirty",
  "source",
  "bling_last_sent_payload",
  "dados_completos_json",
  "dados_resumidos_json",
  "fornecedor_id",
  "fornecedor",
  "cod_fornecedor",
  "descricao_fornecedor",
]);

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

async function myCompanyIds(ctx: { supabase: any; userId: string }): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", ctx.userId)
    .eq("ativo", true);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r: { company_id: string }) => r.company_id))] as string[];
}

type Candidate = {
  id: string;
  company_id: string;
  company_nome: string;
  codigo: string;
  nome: string | null;
  marca: string | null;
  preco: number | null;
  gtin: string | null;
  audited_at: string | null;
};

/** Prefixo alfabético do SKU (ex.: "EV266421" → "EV"). */
function skuPrefix(codigo: string): string | null {
  const m = codigo.trim().match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Prefixos cujo fornecedor existe no Bling da empresa de destino: só esses
 * SKUs podem ser importados, porque chegam já ligáveis a um fornecedor local.
 * Fonte: bling_supplier_map (fornecedores sincronizados do Bling da empresa),
 * cruzado com o mapa central supplier_prefix_map.
 */
async function loadImportablePrefixes(supabaseAdmin: any, targetCompanyId: string): Promise<Set<string>> {
  const [{ data: mapRows }, { data: blingRows }] = await Promise.all([
    supabaseAdmin.from("supplier_prefix_map" as never).select("prefix, supplier_codigo"),
    supabaseAdmin
      .from("bling_supplier_map" as never)
      .select("supplier_codigo")
      .eq("company_id", targetCompanyId)
      .not("supplier_codigo", "is", null),
  ]);
  const suppliers = new Set(
    ((blingRows ?? []) as unknown as { supplier_codigo: string | null }[])
      .map((f) => f.supplier_codigo)
      .filter((c): c is string => !!c),
  );
  const prefixes = new Set<string>();
  for (const m of (mapRows ?? []) as unknown as { prefix: string; supplier_codigo: string }[]) {
    if (m?.prefix && suppliers.has(m.supplier_codigo)) prefixes.add(m.prefix.toUpperCase());
  }
  return prefixes;
}

const listSchema = z.object({
  company_id: z.string().uuid(),
  search: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(), // último código já retornado
});

/** Lista produtos aprovados em todas as regras nas outras empresas e ausentes nesta. */
export const listCrossCompanyImportCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const others = (await myCompanyIds(context)).filter((id) => id !== data.company_id);
    if (others.length === 0) {
      return { items: [] as Candidate[], next_cursor: null as string | null, approved_total: 0 };
    }

    const { data: companyRows } = await supabaseAdmin
      .from("companies")
      .select("id, nome")
      .in("id", others);
    const companyNames = new Map<string, string>(
      ((companyRows ?? []) as { id: string; nome: string | null }[]).map((c) => [c.id, c.nome ?? "Empresa"]),
    );

    const baseFilter = (q: any) => {
      let out = q
        .in("company_id", others)
        .eq("last_audit_errors", 0)
        .eq("last_audit_warnings", 0)
        .not("last_audit_at", "is", null)
        .not("codigo", "is", null)
        .ilike("situacao", "A%")
        // Regras de conteúdo obrigatórias (auditorias antigas não checavam "Anvisa")
        .ilike("descricao_curta", "%garantia%")
        .ilike("descricao_curta", "%anatel%")
        .ilike("descricao_curta", "%anvisa%");
      if (data.search) out = out.or(`codigo.ilike.%${data.search}%,nome.ilike.%${data.search}%`);
      return out;
    };

    // Conta SKUs ÚNICOS, ativos e ainda inexistentes na empresa de destino.
    const { data: approvedTotal } = await supabaseAdmin.rpc(
      "count_cross_company_import_candidates" as never,
      {
        _target_company: data.company_id,
        _other_companies: others,
        _search: data.search ?? null,
      } as never,
    );

    const items: Candidate[] = [];
    const seenCodes = new Set<string>();
    let cursor = data.cursor ?? null;
    let nextCursor: string | null = null;
    const importablePrefixes = await loadImportablePrefixes(supabaseAdmin, data.company_id);

    // Percorre em páginas até juntar `limit` SKUs inéditos na empresa de destino.
    for (let page = 0; page < 20 && items.length < data.limit; page++) {
      let q = baseFilter(
        supabaseAdmin
          .from("bling_products")
          .select("id, company_id, codigo, nome, marca, preco, gtin, last_audit_at"),
      )
        .order("codigo", { ascending: true })
        .limit(500);
      if (cursor) q = q.gt("codigo", cursor);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      const batch = (rows ?? []) as any[];
      if (batch.length === 0) break;
      cursor = String(batch[batch.length - 1].codigo);

      const codes = [...new Set(batch.map((r) => String(r.codigo).trim()).filter(Boolean))];
      const existing = new Set<string>();
      for (let i = 0; i < codes.length; i += 300) {
        const { data: ex } = await supabaseAdmin
          .from("bling_products")
          .select("codigo")
          .eq("company_id", data.company_id)
          .in("codigo", codes.slice(i, i + 300));
        for (const r of (ex ?? []) as { codigo: string }[]) existing.add(String(r.codigo).trim());
      }

      for (const r of batch) {
        const codigo = String(r.codigo ?? "").trim();
        if (!codigo || existing.has(codigo) || seenCodes.has(codigo)) continue;
        const pfx = skuPrefix(codigo);
        if (!pfx || !importablePrefixes.has(pfx)) continue;
        seenCodes.add(codigo);
        items.push({
          id: r.id,
          company_id: r.company_id,
          company_nome: companyNames.get(r.company_id) ?? "Outra empresa",
          codigo,
          nome: r.nome ?? null,
          marca: r.marca ?? null,
          preco: r.preco ?? null,
          gtin: r.gtin ?? null,
          audited_at: r.last_audit_at ?? null,
        });
        if (items.length >= data.limit) break;
      }
      nextCursor = cursor;
      if (batch.length < 500) { nextCursor = null; break; }
    }

    return { items, next_cursor: nextCursor, approved_total: Number(approvedTotal ?? 0) };
  });

const importSchema = z.object({
  company_id: z.string().uuid(),
  source_product_ids: z.array(z.string().uuid()).min(1).max(2000),
  zero_stock: z.boolean().default(true),
});

/** Copia os produtos escolhidos para a empresa atual (sem vínculo com o Bling). */
export const importCrossCompanyProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => importSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const allowed = await myCompanyIds(context);
    const { data: rows, error } = await supabaseAdmin
      .from("bling_products")
      .select("*")
      .in("id", data.source_product_ids);
    if (error) throw new Error(error.message);

    const importablePrefixes = await loadImportablePrefixes(supabaseAdmin, data.company_id);
    const sources = ((rows ?? []) as Record<string, any>[]).filter(
      (r) =>
        allowed.includes(String(r.company_id)) &&
        String(r.company_id) !== data.company_id &&
        String(r.situacao ?? "").toUpperCase().startsWith("A") &&
        /garantia/i.test(String(r.descricao_curta ?? "")) &&
        /anatel/i.test(String(r.descricao_curta ?? "")) &&
        /anvisa/i.test(String(r.descricao_curta ?? "")) &&
        Number(r.last_audit_errors ?? 1) === 0 &&
        Number(r.last_audit_warnings ?? 1) === 0 &&
        r.last_audit_at != null &&
        (() => {
          const pfx = skuPrefix(String(r.codigo ?? ""));
          return pfx !== null && importablePrefixes.has(pfx);
        })(),
    );
    if (sources.length === 0) return { inserted: 0, skipped: 0, ids: [] as string[] };

    // Não duplica SKU já existente na empresa de destino.
    const codes = [...new Set(sources.map((r) => String(r.codigo ?? "").trim()).filter(Boolean))];
    const existing = new Set<string>();
    for (let i = 0; i < codes.length; i += 300) {
      const { data: ex } = await supabaseAdmin
        .from("bling_products")
        .select("codigo")
        .eq("company_id", data.company_id)
        .in("codigo", codes.slice(i, i + 300));
      for (const r of (ex ?? []) as { codigo: string }[]) existing.add(String(r.codigo).trim());
    }

    const seen = new Set<string>();
    const payload: Record<string, any>[] = [];
    for (const src of sources) {
      const codigo = String(src.codigo ?? "").trim();
      if (!codigo || existing.has(codigo) || seen.has(codigo)) continue;
      seen.add(codigo);
      const row: Record<string, any> = {};
      for (const [k, v] of Object.entries(src)) {
        if (SKIP_COLUMNS.has(k)) continue;
        row[k] = v;
      }
      row.company_id = data.company_id;
      row.source = "copia_empresa";
      row.dirty = true;
      row.detail_synced = false;
      if (data.zero_stock) row.estoque = 0;
      // Preço de venda vem das regras da empresa de destino, nunca da origem.
      row.preco = 0;
      payload.push(row);
    }

    const insertedIds: string[] = [];
    for (let i = 0; i < payload.length; i += 200) {
      const { data: ins, error: insErr } = await supabaseAdmin
        .from("bling_products")
        .upsert(payload.slice(i, i + 200) as any, {
          onConflict: "company_id,codigo",
          ignoreDuplicates: true,
        })
        .select("id");
      if (insErr) throw new Error(insErr.message);
      for (const r of (ins ?? []) as { id: string }[]) insertedIds.push(r.id);
    }

    // Precifica pelas regras da empresa de destino; o que não tiver preço calculável não fica.
    let noPrice = 0;
    let keptIds = insertedIds;
    if (insertedIds.length) {
      const { error: priceErr } = await supabaseAdmin.rpc("transform_update_price_stock" as never, {
        _company_id: data.company_id, _product_ids: insertedIds, _include_stores: false,
        _run_id: null, _only_stock: false, _only_price: true,
      } as never);
      if (priceErr) {
        await supabaseAdmin.from("bling_products").delete().in("id", insertedIds).eq("source", "copia_empresa");
        throw new Error(`Não foi possível precificar os produtos: ${priceErr.message}`);
      }
      const priced = await fetchAll<{ id: string; preco: number | null }>((a, b) =>
        supabaseAdmin.from("bling_products").select("id, preco").in("id", insertedIds).order("id").range(a, b),
      );
      const unpriced = priced.filter((r) => !(Number(r.preco) > 0)).map((r) => r.id);
      for (let i = 0; i < unpriced.length; i += 200) {
        await supabaseAdmin.from("bling_products").delete().in("id", unpriced.slice(i, i + 200))
          .eq("source", "copia_empresa").is("bling_product_id", null);
      }
      noPrice = unpriced.length;
      const drop = new Set(unpriced);
      keptIds = insertedIds.filter((id) => !drop.has(id));
    }

    return {
      inserted: keptIds.length,
      skipped: sources.length - insertedIds.length,
      no_price: noPrice,
      ids: keptIds,
    };
  });

/** Lê todas as linhas de uma consulta paginando de 1000 em 1000. */
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Produtos aprovados (por empresa de origem) que ainda faltam na empresa de destino. */
async function computeMissing(context: { supabase: any; userId: string }, target: string, onlySource?: string) {
  await assertMember(context, target);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let others = (await myCompanyIds(context)).filter((id) => id !== target);
  if (onlySource) others = others.filter((id) => id === onlySource);
  const result = new Map<string, { id: string; codigo: string }[]>();
  if (others.length === 0) return { result, names: new Map<string, string>() };

  const { data: companyRows } = await supabaseAdmin.from("companies").select("id, nome").in("id", others);
  const names = new Map<string, string>(
    ((companyRows ?? []) as { id: string; nome: string | null }[]).map((c) => [c.id, c.nome ?? "Empresa"]),
  );

  const targetCodes = new Set(
    (
      await fetchAll<{ codigo: string | null }>((a, b) =>
        supabaseAdmin.from("bling_products").select("codigo").eq("company_id", target).order("id").range(a, b),
      )
    ).map((r) => String(r.codigo ?? "").trim()),
  );
  const importablePrefixes = await loadImportablePrefixes(supabaseAdmin, target);

  for (const cid of others) {
    const rows = await fetchAll<{ id: string; codigo: string | null }>((a, b) =>
      supabaseAdmin
        .from("bling_products")
        .select("id, codigo")
        .eq("company_id", cid)
        .eq("last_audit_errors", 0)
        .eq("last_audit_warnings", 0)
        .not("last_audit_at", "is", null)
        .not("codigo", "is", null)
        .ilike("situacao", "A%")
        .ilike("descricao_curta", "%garantia%")
        .ilike("descricao_curta", "%anatel%")
        .ilike("descricao_curta", "%anvisa%")
        .order("id")
        .range(a, b),
    );
    const seen = new Set<string>();
    const list: { id: string; codigo: string }[] = [];
    for (const r of rows) {
      const codigo = String(r.codigo ?? "").trim();
      if (!codigo || targetCodes.has(codigo) || seen.has(codigo)) continue;
      const pfx = skuPrefix(codigo);
      if (!pfx || !importablePrefixes.has(pfx)) continue;
      seen.add(codigo);
      list.push({ id: r.id, codigo });
    }
    result.set(cid, list);
  }
  return { result, names };
}

/** Resumo por empresa de origem: quantos aprovados faltam na empresa atual. */
export const summarizeCrossCompanyMissing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const others = (await myCompanyIds(context)).filter((id) => id !== data.company_id);
    if (others.length === 0) return { companies: [], unique_total: 0 };
    const [{ data: rows, error }, { data: companyRows }] = await Promise.all([
      supabaseAdmin.rpc("summarize_cross_company_missing" as never, {
        _target_company: data.company_id,
        _other_companies: others,
      } as never),
      supabaseAdmin.from("companies").select("id, nome").in("id", others),
    ]);
    if (error) throw new Error((error as { message: string }).message);
    const names = new Map(
      ((companyRows ?? []) as { id: string; nome: string | null }[]).map((c) => [c.id, c.nome ?? "Empresa"]),
    );
    const counts = new Map(
      ((rows ?? []) as { company_id: string; missing: number; unique_total: number }[]).map((r) => [r.company_id, r]),
    );
    const companies = others.map((id) => ({
      company_id: id,
      company_nome: names.get(id) ?? "Empresa",
      missing: counts.get(id)?.missing ?? 0,
    }));
    companies.sort((a, b) => b.missing - a.missing);
    const unique_total = ((rows ?? []) as { unique_total: number }[])[0]?.unique_total ?? 0;
    return { companies, unique_total };
  });

/** IDs de origem para "importar todos" (de uma empresa ou de todas, sem repetir SKU). */
export const listCrossCompanyMissingIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), source_company_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { result } = await computeMissing(context, data.company_id, data.source_company_id);
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const list of result.values())
      for (const x of list) {
        if (seen.has(x.codigo)) continue;
        seen.add(x.codigo);
        ids.push(x.id);
      }
    return { ids };
  });
