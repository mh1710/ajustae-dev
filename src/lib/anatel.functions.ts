import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MISSING = "COLUNA NAO EXISTENTE NA BASE DE DADOS ANATEL IMPORTADA";

const RowSchema = z.object({
  codigo: z.string().min(1),
  titulo: z.string().nullable().optional(),
  descricao_comercial: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  ean: z.string().nullable().optional(),
  ncm: z.string().nullable().optional(),
  codigo_anatel: z.string().nullable().optional(),
});

export const importAnatelBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ rows: z.array(RowSchema).min(1).max(500) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const payload = data.rows.map((r) => ({
      company_id: null,
      codigo: r.codigo.trim(),
      titulo: (r.titulo?.toString().trim() || MISSING),
      descricao_comercial: (r.descricao_comercial?.toString().trim() || MISSING),
      marca: (r.marca?.toString().trim() || MISSING),
      ean: (r.ean?.toString().trim() || MISSING),
      ncm: (r.ncm?.toString().trim() || MISSING),
      codigo_anatel: (r.codigo_anatel?.toString().trim() || MISSING),
      imported_at: now,
      updated_at: now,
    }));
    const { error, count } = await supabaseAdmin
      .from("anatel_products")
      .upsert(payload as any, { onConflict: "codigo", count: "exact" });
    if (error) throw new Error(error.message);
    return { upserted: count ?? payload.length };
  });

export const listAnatelProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const from = (data.page - 1) * data.page_size;
    const to = from + data.page_size - 1;
    let q = context.supabase
      .from("anatel_products")
      .select("id, codigo, titulo, marca, ean, ncm, codigo_anatel, imported_at", { count: "exact" })
      .order("codigo", { ascending: true })
      .range(from, to);
    if (data.search && data.search.trim()) {
      const s = data.search.trim().replace(/[%_]/g, (m) => `\\${m}`);
      q = q.or(
        `codigo.ilike.%${s}%,titulo.ilike.%${s}%,ean.ilike.%${s}%,codigo_anatel.ilike.%${s}%,marca.ilike.%${s}%`,
      );
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const clearAnatelProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabaseAdmin
      .from("anatel_products")
      .delete({ count: "exact" })
      .not("id", "is", null);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

export const getAnatelStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error } = await context.supabase
      .from("anatel_products")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    const { data: last } = await context.supabase
      .from("anatel_products")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { total: count ?? 0, last_import_at: last?.imported_at ?? null };
  });

export const getAnatelOfficialStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error } = await context.supabase
      .from("anatel_homologacoes" as any)
      .select("numero", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    const { data: last } = await context.supabase
      .from("anatel_homologacoes" as any)
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { total: count ?? 0, imported_at: (last as any)?.imported_at ?? null };
  });

export type AnatelOfficialSuggestion = {
  product_id: string;
  codigo: string;
  nome: string | null;
  marca: string | null;
  gtin: string | null;
  codigo_atual: string | null;
  numero: string;
  fabricante: string | null;
  modelo: string | null;
  nome_comercial: string | null;
  tipo: string | null;
};

export const suggestAnatelOfficial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("anatel_official_suggestions", {
      _company_id: data.company_id,
      _limit: 5000,
    });
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as AnatelOfficialSuggestion[] };
  });

export const applyAnatelOfficial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              codigo: z.string().min(1),
              codigo_anatel: z.string().min(1),
              nome: z.string().nullable().optional(),
              marca: z.string().nullable().optional(),
              gtin: z.string().nullable().optional(),
            }),
          )
          .min(1)
          .max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const map = new Map<string, any>();
    for (const r of data.items) {
      map.set(r.codigo.trim(), {
        company_id: null,
        codigo: r.codigo.trim(),
        titulo: r.nome?.trim() || MISSING,
        descricao_comercial: MISSING,
        marca: r.marca?.trim() || MISSING,
        ean: r.gtin?.trim() || MISSING,
        ncm: MISSING,
        codigo_anatel: r.codigo_anatel.trim(),
        imported_at: now,
        updated_at: now,
      });
    }
    const payload = [...map.values()];
    let saved = 0;
    for (let i = 0; i < payload.length; i += 500) {
      const raw = payload.slice(i, i + 500);
      const { data: ex, error: exErr } = await supabaseAdmin
        .from("anatel_products").select("codigo").in("codigo", raw.map((r) => r.codigo));
      if (exErr) throw new Error(exErr.message);
      const existing = new Set((ex ?? []).map((r: any) => r.codigo));
      const upd = raw.filter((r) => existing.has(r.codigo))
        .map((r) => ({ codigo: r.codigo, codigo_anatel: r.codigo_anatel, imported_at: now, updated_at: now }));
      const ins = raw.filter((r) => !existing.has(r.codigo));
      for (const part of [upd, ins]) {
        if (!part.length) continue;
        const { error } = await supabaseAdmin.from("anatel_products").upsert(part as any, { onConflict: "codigo" });
        if (error) throw new Error(error.message);
      }
      saved += raw.length;
    }
    return { saved };
  });
