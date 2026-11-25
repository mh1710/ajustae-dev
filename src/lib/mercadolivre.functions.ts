import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCompanyCatalogStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.from("company_users")
      .select("ativo").eq("company_id", data.company_id).eq("user_id", context.userId).maybeSingle();
    if (error || !member?.ativo) throw new Error("Sem acesso a esta empresa.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [ml, mapping, supplier, refresh] = await Promise.all([
      db.from("ml_integration").select("status").eq("singleton", true).maybeSingle(),
      db.from("ml_map_jobs").select("status, processed, total, company_id, company_ids")
        .or(`company_id.eq.${data.company_id},company_ids.cs.{${data.company_id}}`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("bling_supplier_sync_jobs").select("status, links_found, pages_done, details_checked, details_total, last_error")
        .eq("company_id", data.company_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("ml_refresh_state").select("last_finished_at").eq("singleton", true).maybeSingle(),
    ]);
    if ([ml, mapping, supplier, refresh].some(result => result.error)) throw new Error("Não foi possível consultar as sincronizações.");
    // Return status only: no integration tokens, account identifiers or other-company IDs.
    return {
      ml: { status: (ml.data?.status ?? "desconectada") as string },
      mapping: mapping.data ? { status: mapping.data.status as string, processed: Number(mapping.data.processed), total: Number(mapping.data.total) } : null,
      supplier: supplier.data as { status: string; links_found: number; pages_done: number; details_checked: number; details_total: number; last_error: string | null } | null,
      refresh: { last_finished_at: (refresh.data?.last_finished_at ?? null) as string | null },
    };
  });

export const getMlStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ml_integration")
      .select("status, ml_nickname, ml_user_id, token_expires_at, last_error, updated_at")
      .eq("singleton", true)
      .maybeSingle();
    return {
      status: data?.status ?? "desconectada",
      nickname: data?.ml_nickname ?? null,
      userId: data?.ml_user_id ?? null,
      lastError: data?.last_error ?? null,
      updatedAt: data?.updated_at ?? null,
    };
  });

export const getMlAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!process.env.MERCADOLIVRE_CLIENT_ID || !process.env.MERCADOLIVRE_CLIENT_SECRET) {
      throw new Error("Credenciais do Mercado Livre não configuradas.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mlAuthorizeUrl } = await import("@/lib/mercadolivre.server");
    const state = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("ml_oauth_states").insert({
      state,
      user_id: context.userId,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(error.message);
    return { url: mlAuthorizeUrl(state) };
  });

export const disconnectMl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("ml_integration")
      .update({
        status: "desconectada",
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("singleton", true);
    return { ok: true };
  });

/** Empresas da conta do usuário (o Mercado Livre é um fornecedor da conta inteira). */
async function accountCompanyIds(
  ctx: { supabase: { from: (t: string) => any }; userId: string },
): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", ctx.userId)
    .eq("ativo", true);
  if (error) throw new Error(error.message);
  return Array.from(new Set(((data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id)));
}

export const startMlMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        only_pending: z.boolean().optional(),
        zip_code: z.string().trim().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const companyIds = await accountCompanyIds(context);
    if (companyIds.length === 0) throw new Error("Nenhuma empresa disponível na conta.");

    const { data: running } = await supabaseAdmin
      .from("ml_map_jobs")
      .select("id")
      .in("status", ["pendente", "processando"])
      .limit(1)
      .maybeSingle();
    if (running?.id) return { job_id: running.id, already_running: true };

    const { data: totalSkus } = await (supabaseAdmin.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: number | null }>)("ml_account_sku_total", { _company_ids: companyIds });

    // Nova varredura: o controle de SKUs já checados recomeça do zero.
    await (supabaseAdmin as unknown as { from: (t: string) => any })
      .from("ml_sku_checks")
      .delete()
      .neq("sku", "\u0000");

    const { data: job, error } = await supabaseAdmin
      .from("ml_map_jobs")
      .insert({
        company_id: data.company_id,
        company_ids: companyIds,
        status: "pendente",
        scope: "conta",
        zip_code: (await import("@/lib/mercadolivre.server")).normalizeZip(data.zip_code),
        total: Number(totalSkus ?? 0),
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const base = (process.env.APP_PUBLIC_URL ?? "https://blingauditor.lovable.app").replace(/\/$/, "");
    const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
    await supabaseAdmin.rpc("enqueue_http_job", {
      _url: `${base}/api/public/mercadolivre/map-tick`,
      _secret: secret,
      _body: { job_id: job.id } as never,
    } as never);

    return { job_id: job.id, already_running: false };
  });

export const searchCompanyProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ company_id: z.string().uuid(), search: z.string().trim().min(1) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const s = data.search.replace(/[%_]/g, "");
    const { data: rows, error } = await context.supabase
      .from("bling_products")
      .select("id, codigo, nome, gtin")
      .eq("company_id", data.company_id)
      .or(`codigo.ilike.%${s}%,nome.ilike.%${s}%,gtin.ilike.%${s}%`)
      .order("codigo", { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const mapSingleProductOnMl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_id: z.string(),
        zip_code: z.string().trim().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getMlAccessToken, mapProductOnMl } = await import("@/lib/mercadolivre.server");

    const { data: p, error: pe } = await supabaseAdmin
      .from("bling_products")
      .select("id, codigo, nome, gtin")
      .eq("company_id", data.company_id)
      .eq("id", data.product_id)
      .maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!p) throw new Error("Produto não encontrado.");

    const zip = (await import("@/lib/mercadolivre.server")).normalizeZip(data.zip_code);
    const token = await getMlAccessToken();

    const row = {
      company_id: data.company_id,
      product_id: p.id,
      sku: p.codigo,
      nome: p.nome,
      ean: p.gtin,
      found: false,
      has_full: false,
      full_offers: 0,
      total_offers: 0,
      min_price: null as number | null,
      min_full_price: null as number | null,
      permalink: null as string | null,
      match_by: null as string | null,
      best_item_id: null as string | null,
      best_price: null as number | null,
      best_shipping_cost: null as number | null,
      best_total_price: null as number | null,
      best_is_full: false,
      available_quantity: null as number | null,
      has_stock: false,
      qualifies: false,
      top_offers: [] as unknown as never,
      zip_code: zip,
      error: null as string | null,
      checked_at: new Date().toISOString(),
    };

    let final = row;
    try {
      const outcome = await mapProductOnMl(token, { ean: p.gtin, nome: p.nome, zip });
      const { alt_offers: _alt, ...rest } = outcome;
      final = { ...row, ...rest } as unknown as typeof row;
    } catch (e) {
      final = { ...row, error: e instanceof Error ? e.message : String(e) };
    }

    // Falha na consulta do ML não remove o vínculo já conhecido.
    if (final.error) {
      return { found: false, has_full: false, qualifies: false, sku: p.codigo, error: final.error };
    }

    if (final.qualifies) {
      const { error } = await supabaseAdmin
        .from("ml_product_matches")
        .upsert([final], { onConflict: "product_id" });
      if (error) throw new Error(error.message);
    } else {
      await supabaseAdmin.from("ml_product_matches").delete().eq("product_id", p.id);
    }

    return {
      found: final.found,
      has_full: final.has_full,
      qualifies: final.qualifies,
      sku: p.codigo,
      error: final.error,
    };
  });

export const cancelMlMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ job_id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("ml_map_jobs")
      .update({ cancel_requested: true, status: "cancelado", finished_at: now, updated_at: now })
      .eq("id", data.job_id);
    return { ok: true };
  });

export const getMlMapJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ context }) => {
    const { data: job } = await context.supabase
      .from("ml_map_jobs")
      .select("*")
      // o mapeamento é da conta inteira: mostra a última execução, de qualquer empresa

      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return job ?? null;
  });

export const getMlStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ context }) => {
    const base = () =>
      context.supabase
        .from("ml_product_matches")
        .select("id", { count: "exact", head: true });


    const [total, found, full, stock] = await Promise.all([
      base(),
      base().eq("found", true),
      base().eq("has_full", true),
      base().eq("has_stock", true),
    ]);

    return {
      mapeados: total.count ?? 0,
      encontrados: found.count ?? 0,
      comFull: full.count ?? 0,
      comEstoque: stock.count ?? 0,
    };
  });

export const listMlMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        filter: z
          .enum(["todos", "full", "sem_full", "nao_encontrado", "com_estoque", "sem_estoque"])
          .optional(),
        search: z.string().trim().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const page = data.page ?? 1;
    const size = data.page_size ?? 50;
    let q = context.supabase
      .from("ml_product_matches")
      .select("*", { count: "exact" });


    if (data.filter === "full") q = q.eq("has_full", true);
    if (data.filter === "sem_full") q = q.eq("found", true).eq("has_full", false);
    if (data.filter === "nao_encontrado") q = q.eq("found", false);
    if (data.filter === "com_estoque") q = q.eq("has_stock", true);
    if (data.filter === "sem_estoque") q = q.eq("found", true).eq("has_stock", false);
    if (data.search) q = q.or(`sku.ilike.%${data.search}%,nome.ilike.%${data.search}%,ean.ilike.%${data.search}%`);

    const { data: rows, count, error } = await q
      .order("checked_at", { ascending: false })
      .range((page - 1) * size, page * size - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, page, page_size: size };
  });

type MlStoredOffer = {
  item_id: string;
  price: number;
  shipping_cost: number;
  total_price: number;
  permalink: string | null;
  available_quantity: number;
  is_full: boolean;
};

/** Cotação no Mercado Livre usando o casamento já salvo no mapeamento (sem nova consulta à API). */
export const getMlSupplierQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        product_id: z.string().uuid().nullable().optional(),
        sku: z.string().trim().nullable().optional(),
        ean: z.string().trim().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const empty = {
      zip: null as string | null,
      checked_at: null as string | null,
      match_by: null as string | null,
      offers: [] as MlStoredOffer[],
      mapped: false,
      error: null as string | null,
    };

    const { data: roles, error: accessError } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (accessError) throw new Error("Não foi possível conferir seu acesso.");
    const restricted = (roles ?? []).some(role => String(role.role) === "company_viewer");
    // Restricted readers must identify a real product visible through their company RLS.
    // The shared catalog may supply offers, never another company's product details.
    let lookup = data;
    if (restricted) {
      if (!data.product_id) throw new Error("Selecione um produto da sua empresa.");
      const { data: product, error } = await context.supabase.from("bling_products")
        .select("id, codigo, gtin").eq("id", data.product_id).maybeSingle();
      if (error || !product) throw new Error("Sem acesso a este produto.");
      lookup = { product_id: product.id, sku: product.codigo, ean: product.gtin };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reader = restricted ? supabaseAdmin : context.supabase;

    // O casamento é da conta: procura pelo produto e, se não houver,
    // reaproveita o casamento do mesmo SKU/EAN de qualquer empresa.
    const tries: Array<[string, string]> = [];
    if (lookup.product_id) tries.push(["product_id", lookup.product_id]);
    if (lookup.sku) tries.push(["sku", lookup.sku]);
    if (lookup.ean) tries.push(["ean", lookup.ean]);
    if (tries.length === 0) return empty;

    let row: { top_offers: unknown; match_by: string | null; zip_code: string | null; checked_at: string | null; error: string | null } | undefined;
    for (const [col, value] of tries) {
      const { data: rows, error } = await reader
        .from("ml_product_matches")
        .select("top_offers, match_by, zip_code, checked_at, error")
        .eq(col, value)
        .order("checked_at", { ascending: false })
        .limit(1);
      if (error) return { ...empty, error: error.message };
      if (rows?.[0]) {
        row = rows[0] as typeof row;
        break;
      }
    }
    if (!row) return empty;


    const raw = Array.isArray(row.top_offers) ? (row.top_offers as unknown as MlStoredOffer[]) : [];
    const offers = raw.filter((o) => o && o.is_full === true).slice(0, 3);

    return {
      zip: row.zip_code ?? null,
      checked_at: row.checked_at ?? null,
      match_by: row.match_by ?? null,
      offers,
      mapped: true,
      error: row.error ?? null,
    };
  });


export const refreshMlSupplierQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        product_id: z.string().uuid().nullable().optional(),
        sku: z.string().trim().nullable().optional(),
        ean: z.string().trim().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const empty = {
      zip: null as string | null,
      checked_at: null as string | null,
      match_by: null as string | null,
      offers: [] as MlStoredOffer[],
      mapped: false,
      error: null as string | null,
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getMlAccessToken, mapProductOnMl, normalizeZip } = await import("@/lib/mercadolivre.server");

    const tries: Array<[string, string]> = [];
    if (data.product_id) tries.push(["product_id", data.product_id]);
    if (data.sku) tries.push(["sku", data.sku]);
    if (data.ean) tries.push(["ean", data.ean]);
    if (tries.length === 0) return empty;

    let prev:
      | { company_id: string; product_id: string; sku: string | null; nome: string | null; ean: string | null; zip_code: string | null }
      | undefined;
    for (const [col, value] of tries) {
      const { data: matches, error: me } = await supabaseAdmin
        .from("ml_product_matches")
        .select("company_id, product_id, sku, nome, ean, zip_code")
        .eq(col, value)
        .order("checked_at", { ascending: false })
        .limit(1);
      if (me) return { ...empty, error: me.message };
      if (matches?.[0]) {
        prev = matches[0] as typeof prev;
        break;
      }
    }
    if (!prev) return empty;


    const zip = normalizeZip(prev.zip_code ?? undefined);
    const token = await getMlAccessToken();

    const base = {
      company_id: prev.company_id,
      product_id: prev.product_id,
      sku: prev.sku,
      nome: prev.nome,
      ean: prev.ean,
      found: false,
      has_full: false,
      full_offers: 0,
      total_offers: 0,
      min_price: null as number | null,
      min_full_price: null as number | null,
      permalink: null as string | null,
      match_by: null as string | null,
      best_item_id: null as string | null,
      best_price: null as number | null,
      best_shipping_cost: null as number | null,
      best_total_price: null as number | null,
      best_is_full: false,
      available_quantity: null as number | null,
      has_stock: false,
      qualifies: false,
      top_offers: [] as unknown as never,
      zip_code: zip,
      error: null as string | null,
      checked_at: new Date().toISOString(),
    };

    let final = base;
    try {
      const outcome = await mapProductOnMl(token, { ean: prev.ean, nome: prev.nome, zip });
      const { alt_offers: _alt, ...rest } = outcome;
      final = { ...base, ...rest } as unknown as typeof base;
    } catch (e) {
      return { ...empty, mapped: true, error: e instanceof Error ? e.message : String(e) };
    }

    if (final.qualifies) {
      await supabaseAdmin.from("ml_product_matches").upsert([final], { onConflict: "product_id" });
    } else {
      await supabaseAdmin.from("ml_product_matches").delete().eq("product_id", prev.product_id);
    }

    const raw = Array.isArray(final.top_offers)
      ? (final.top_offers as unknown as MlStoredOffer[])
      : [];

    return {
      zip,
      checked_at: final.checked_at,
      match_by: final.match_by,
      offers: raw.filter((o) => o && o.is_full === true).slice(0, 3),
      mapped: true,
      error: final.error,
    };
  });
