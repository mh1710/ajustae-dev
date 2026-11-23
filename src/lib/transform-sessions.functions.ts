import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export const listTransformSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: rows, error } = await context.supabase
      .from("transform_sessions")
      .select("id, name, status, started_at, finished_at")
      .eq("company_id", data.company_id)
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string; name: string; status: "active" | "finished" | "cancelled";
      started_at: string; finished_at: string | null;
    }>;
  });

export const startTransformSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid(), name: z.string().min(1).max(120).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: existing } = await context.supabase
      .from("transform_sessions")
      .select("id")
      .eq("company_id", data.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (existing) throw new Error("Já existe uma transformação assistida em andamento. Finalize antes de iniciar outra.");
    const name = data.name ?? `Transformação de ${new Date().toLocaleString("pt-BR")}`;
    const { data: row, error } = await context.supabase
      .from("transform_sessions")
      .insert({ company_id: data.company_id, user_id: context.userId, name })
      .select("id, name, status, started_at, finished_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const finishTransformSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ session_id: z.string().uuid(), status: z.enum(["finished", "cancelled"]).default("finished") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("transform_sessions")
      .update({ status: data.status, finished_at: new Date().toISOString() })
      .eq("id", data.session_id)
      .eq("user_id", context.userId)
      .select("id, name, status, started_at, finished_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTransformSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("transform_sessions")
      .delete()
      .eq("id", data.session_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTransformSessionProductIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc(
      "transform_session_product_ids",
      { _session_id: data.session_id },
    );
    if (error) throw new Error(error.message);
    const ids = (Array.isArray(result) ? result : []) as string[];
    return { ids, count: ids.length };
  });

export const listTransformSessionProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc(
      "transform_session_products",
      { _session_id: data.session_id },
    );
    if (error) throw new Error(error.message);
    return (Array.isArray(result) ? result : []) as Array<{
      id: string; codigo: string | null; nome: string | null;
      preco: number | null; estoque: number | null;
      situacao: string | null; updated_at: string;
      lojas_alteradas?: number | null;
    }>;
  });
