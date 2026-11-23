import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type PrefixRow = { prefix: string; supplier_codigo: string };

export const listPrefixMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (context.supabase as any)
      .from("supplier_prefix_map")
      .select("prefix, supplier_codigo")
      .order("prefix", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: sups, error: e2 } = await context.supabase
      .from("fornecedores")
      .select("codigo, nome")
      .order("nome", { ascending: true });
    if (e2) throw new Error(e2.message);
    return { map: (data ?? []) as PrefixRow[], suppliers: sups ?? [] };
  });

export const upsertPrefixMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ prefix: z.string().trim().min(1), supplier_codigo: z.string().trim().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const prefix = data.prefix.toUpperCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any)
      .from("supplier_prefix_map")
      .upsert({ prefix, supplier_codigo: data.supplier_codigo });
    if (error) throw new Error(error.message);
    return { ok: true, prefix };
  });

export const deletePrefixMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ prefix: z.string().trim().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any)
      .from("supplier_prefix_map")
      .delete()
      .eq("prefix", data.prefix.toUpperCase());
    if (error) throw new Error(error.message);
    return { ok: true };
  });
