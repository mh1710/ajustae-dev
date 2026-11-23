import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("companies")
      .select("id, nome, nome_fantasia, cnpj, status, owner_user_id, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createCompanySchema = z.object({
  nome: z.string().trim().min(1).max(200),
  nome_fantasia: z.string().trim().max(200).optional().nullable(),
  cnpj: z.string().trim().max(20).optional().nullable(),
});

export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createCompanySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .insert({
        owner_user_id: context.userId,
        nome: data.nome,
        nome_fantasia: data.nome_fantasia ?? null,
        cnpj: data.cnpj ?? null,
        status: "ativa",
      })
      .select("id, nome")
      .single();
    if (error || !company) throw new Error(error?.message ?? "Falha ao criar empresa");

    const { error: linkError } = await supabaseAdmin.from("company_users").insert({
      company_id: company.id,
      user_id: context.userId,
      role: "admin",
      ativo: true,
    });
    if (linkError) throw new Error(linkError.message);

    // Empty bling integration row (desconectada)
    await supabaseAdmin
      .from("bling_integrations")
      .insert({ company_id: company.id, status: "desconectada" });

    return company;
  });

export const deleteCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ company_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("company_users")
      .select("role, ativo")
      .eq("company_id", data.company_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership || !membership.ativo || membership.role !== "admin") {
      throw new Error("Somente administradores podem excluir empresas.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cancel any active sync jobs first so a running worker doesn't clash
    await supabaseAdmin
      .from("bling_sync_jobs")
      .update({
        cancel_requested: true,
        status: "cancelada",
        finished_at: new Date().toISOString(),
        worker_finished_at: new Date().toISOString(),
        worker_last_status: "company_deleted",
        worker_last_error: null,
        last_activity_at: new Date().toISOString(),
      })
      .eq("company_id", data.company_id)
      .in("status", ["pendente", "catalogando", "processando", "retomando", "pausada_por_limite", "cancelando"]);

    // Use the SQL delete_company function which bulk-deletes child rows without timeout.
    const { error } = await context.supabase.rpc("delete_company", { _company_id: data.company_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


const updateCompanySchema = z.object({
  company_id: z.string().uuid(),
  nome: z.string().trim().min(1).max(200),
  nome_fantasia: z.string().trim().max(200).optional().nullable(),
  cnpj: z.string().trim().max(20).optional().nullable(),
});

export const updateCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateCompanySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("companies")
      .update({
        nome: data.nome,
        nome_fantasia: data.nome_fantasia ?? null,
        cnpj: data.cnpj ?? null,
      })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });