import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPasswordPolicy, passwordExpired } from "./password-policy";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso restrito a administradores.");
}

export type AdminUser = {
  id: string;
  nome: string | null;
  email: string;
  telefone: string | null;
  created_at: string;
  is_admin: boolean;
  can_download_sheets: boolean;
  can_push_bling: boolean;
  can_use_ai: boolean;
  active: boolean;
  access_expires_at: string | null;
  companies: number;
  mfa_email: string | null;
  password_changed_at: string | null;
  password_expired: boolean;
};

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: authList }, { data: profiles }, { data: perms }, { data: roles }, { data: links }, { data: security }] =
      await Promise.all([
        supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        supabaseAdmin.from("profiles").select("id, nome, email, telefone, created_at"),
        supabaseAdmin
          .from("user_permissions")
          .select("user_id, can_download_sheets, can_push_bling, can_use_ai, active, access_expires_at"),
        supabaseAdmin.from("user_roles").select("user_id, role"),
        supabaseAdmin.from("company_users").select("user_id").eq("ativo", true),
        (supabaseAdmin as any).from("account_security").select("user_id, mfa_email, password_changed_at"),
      ]);
    const securityMap = new Map(((security ?? []) as Array<{ user_id: string; mfa_email: string | null; password_changed_at: string | null }>).map((r) => [r.user_id, r]));

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const permMap = new Map((perms ?? []).map((p: any) => [p.user_id, p]));
    const adminSet = new Set((roles ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.user_id));
    const companyCount = new Map<string, number>();
    for (const l of (links ?? []) as Array<{ user_id: string }>) {
      companyCount.set(l.user_id, (companyCount.get(l.user_id) ?? 0) + 1);
    }

    const base = (authList?.users ?? []).map((u: any) => ({
      id: u.id,
      nome: profileMap.get(u.id)?.nome ?? u.user_metadata?.nome ?? null,
      email: u.email ?? profileMap.get(u.id)?.email ?? "",
      telefone: profileMap.get(u.id)?.telefone ?? null,
      created_at: profileMap.get(u.id)?.created_at ?? u.created_at,
    }));
    for (const p of (profiles ?? []) as any[]) {
      if (!base.some((b) => b.id === p.id)) base.push(p);
    }

    return base

      .map((p) => {
        const perm = permMap.get(p.id) as any;
        return {
          id: p.id,
          nome: p.nome,
          email: p.email,
          telefone: p.telefone,
          created_at: p.created_at,
          is_admin: adminSet.has(p.id),
          can_download_sheets: !!perm?.can_download_sheets,
          can_push_bling: !!perm?.can_push_bling,
          can_use_ai: !!perm?.can_use_ai,
          active: perm?.active ?? true,
          access_expires_at: perm?.access_expires_at ?? null,
          companies: companyCount.get(p.id) ?? 0,
          mfa_email: securityMap.get(p.id)?.mfa_email ?? null,
          password_changed_at: securityMap.get(p.id)?.password_changed_at ?? null,
          password_expired: passwordExpired(securityMap.get(p.id)?.password_changed_at ?? null),
        };
      })
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        password: z.string().max(72),
        nome: z.string().trim().max(120).optional(),
        is_admin: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    assertPasswordPolicy(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: grant, error: grantError } = await supabaseAdmin.rpc("authorize_account_creation" as any, { _email: data.email } as any);
    if (grantError || !grant) throw new Error("Falha ao autorizar criação de conta.");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome ?? "", account_creation_grant: grant },
      app_metadata: { provisioned_by_admin: true },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Falha ao criar usuário");

    // Senha validada aqui pela política: vale por 365 dias.
    await (supabaseAdmin as any).from("account_security").upsert(
      { user_id: created.user.id, password_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

    // Novos usuários já nascem com todas as permissões desativadas (trigger),
    // mas garantimos a linha caso o gatilho não tenha rodado.
    await supabaseAdmin
      .from("user_permissions")
      .upsert({ user_id: created.user.id }, { onConflict: "user_id" });

    if (data.is_admin) {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: created.user.id, role: "admin" }, { onConflict: "user_id,role" });
    }

    return { id: created.user.id, email: created.user.email };
  });

export const adminUpdatePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        can_download_sheets: z.boolean().optional(),
        can_push_bling: z.boolean().optional(),
        can_use_ai: z.boolean().optional(),
        active: z.boolean().optional(),
        access_expires_at: z.string().datetime().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { user_id, ...patch } = data;
    const { error } = await supabaseAdmin
      .from("user_permissions")
      .upsert({ user_id, ...patch }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid(), is_admin: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId && !data.is_admin) {
      throw new Error("Você não pode remover o seu próprio acesso de administrador.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.is_admin) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: "admin" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid(), password: z.string().max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    assertPasswordPolicy(data.password);
    const { setPasswordWithGrant } = await import("./account-security.server");
    await setPasswordWithGrant(data.user_id, data.password);
    return { ok: true };
  });

export const adminSetMfaEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid(), mfa_email: z.string().trim().email().max(254).nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("account_security").upsert(
      { user_id: data.user_id, mfa_email: data.mfa_email ? data.mfa_email.toLowerCase() : null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir a si mesmo.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
