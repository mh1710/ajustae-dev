import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPasswordPolicy } from "./password-policy";
import {
  CODE_MAX_ATTEMPTS, CODE_MAX_PER_HOUR, CODE_RESEND_SECONDS, CODE_TTL_MINUTES,
  generateCode, hashCode, loadSecurityState, recentAuthMethod, sameHash, sessionIdFromClaims,
  setPasswordWithGrant, verifyCurrentPassword, type SecurityState,
} from "./account-security.server";

// Estas funções rodam antes da sessão estar liberada; usam o cliente de serviço só depois de validar o token.

export const getMySecurityState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SecurityState> => {
    const { mfa_email_full: _hidden, ...state } = await loadSecurityState(context.userId, sessionIdFromClaims(context.claims));
    return state;
  });

export const sendLoginCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sessionId = sessionIdFromClaims(context.claims);
    const state = await loadSecurityState(context.userId, sessionId);
    if (state.mfa_verified) return { sent: false, already_verified: true, code_email: state.code_email };
    if (!state.mfa_email_full) throw new Error("Esta conta não tem e-mail para receber o código. Fale com o administrador.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const recent = await db.from("account_mfa_challenges").select("created_at").eq("user_id", context.userId)
      .gte("created_at", since).order("created_at", { ascending: false });
    if (recent.error) throw new Error("Não foi possível gerar o código.");
    const rows = (recent.data ?? []) as Array<{ created_at: string }>;
    const last = rows[0] ? new Date(rows[0].created_at).getTime() : 0;
    if (Date.now() - last < CODE_RESEND_SECONDS * 1000) {
      throw new Error(`Aguarde ${CODE_RESEND_SECONDS} segundos para pedir outro código.`);
    }
    if (rows.length >= CODE_MAX_PER_HOUR) throw new Error("Muitos códigos pedidos na última hora. Tente mais tarde.");

    const id = crypto.randomUUID();
    const code = generateCode();
    // Um novo código invalida os anteriores desta sessão.
    await db.from("account_mfa_challenges").update({ consumed_at: new Date().toISOString() })
      .eq("session_id", sessionId).is("consumed_at", null);
    const ins = await db.from("account_mfa_challenges").insert({
      id, user_id: context.userId, session_id: sessionId, code_hash: await hashCode(id, code),
      sent_to: state.mfa_email_full, expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    });
    if (ins.error) throw new Error("Não foi possível gerar o código.");
    try {
      const { sendLoginCodeEmail } = await import("./login-code-email.server");
      await sendLoginCodeEmail(state.mfa_email_full, code, `login-code-${id}`);
    } catch (error) {
      await db.from("account_mfa_challenges").delete().eq("id", id);
      throw new Error(error instanceof Error ? `Não foi possível enviar o código: ${error.message}` : "Não foi possível enviar o código.");
    }
    return { sent: true, already_verified: false, code_email: state.code_email };
  });

export const verifyLoginCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().trim().regex(/^\d{6}$/, "Digite os 6 números do código.") }).parse(d))
  .handler(async ({ data, context }) => {
    const sessionId = sessionIdFromClaims(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const found = await db.from("account_mfa_challenges").select("id, code_hash, attempts, expires_at")
      .eq("session_id", sessionId).eq("user_id", context.userId).is("consumed_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (found.error) throw new Error("Não foi possível conferir o código.");
    const challenge = found.data as { id: string; code_hash: string; attempts: number; expires_at: string } | null;
    if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) {
      throw new Error("O código expirou. Peça um novo código.");
    }
    if (challenge.attempts >= CODE_MAX_ATTEMPTS) throw new Error("Muitas tentativas erradas. Peça um novo código.");
    const ok = sameHash(await hashCode(challenge.id, data.code), challenge.code_hash);
    if (!ok) {
      await db.from("account_mfa_challenges").update({ attempts: challenge.attempts + 1 }).eq("id", challenge.id);
      const left = CODE_MAX_ATTEMPTS - challenge.attempts - 1;
      throw new Error(left > 0 ? `Código incorreto. Restam ${left} tentativa(s).` : "Código incorreto. Peça um novo código.");
    }
    const consumed = await db.from("account_mfa_challenges").update({ consumed_at: new Date().toISOString() })
      .eq("id", challenge.id).is("consumed_at", null).select("id");
    if (consumed.error || !(consumed.data ?? []).length) throw new Error("Este código já foi usado. Peça um novo código.");
    const session = await db.from("account_mfa_sessions")
      .upsert({ session_id: sessionId, user_id: context.userId, verified_at: new Date().toISOString() }, { onConflict: "session_id" });
    if (session.error) throw new Error("Não foi possível liberar o acesso.");
    const { mfa_email_full: _hidden, ...state } = await loadSecurityState(context.userId, sessionId);
    return state;
  });

export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ new_password: z.string().max(72), current_password: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertPasswordPolicy(data.new_password);
    const sessionId = sessionIdFromClaims(context.claims);
    const state = await loadSecurityState(context.userId, sessionId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = user.user?.email;
    if (!email) throw new Error("Conta sem e-mail de login.");

    // Sem a senha atual só quando a pessoa acabou de entrar (senha + código) ou veio pelo link de recuperação.
    const fresh = (state.mfa_verified || !state.enforced) && recentAuthMethod(context.claims, ["password"], 30 * 60);
    const recovery = recentAuthMethod(context.claims, ["recovery", "otp", "magiclink"], 30 * 60);
    if (data.current_password) {
      if (data.current_password === data.new_password) throw new Error("Escolha uma senha diferente da atual.");
      if (!(await verifyCurrentPassword(email, data.current_password))) throw new Error("A senha atual está incorreta.");
    } else if (!fresh && !recovery) {
      throw new Error("Informe a senha atual.");
    }
    await setPasswordWithGrant(context.userId, data.new_password);
    // A troca encerra todas as sessões. Se esta já estava verificada, a próxima entrada com a senha nova
    // (feita pelo próprio app em seguida) herda a verificação, uma vez, por 2 minutos.
    if (state.mfa_verified) {
      await (supabaseAdmin as any).from("account_security")
        .update({ mfa_carry_until: new Date(Date.now() + 2 * 60_000).toISOString(), updated_at: new Date().toISOString() })
        .eq("user_id", context.userId);
    }
    return { email, carry: state.mfa_verified };
  });

export const claimPasswordChangeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SecurityState> => {
    const sessionId = sessionIdFromClaims(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (recentAuthMethod(context.claims, ["password"], 120)) {
      const claimed = await db.from("account_security").update({ mfa_carry_until: null, updated_at: new Date().toISOString() })
        .eq("user_id", context.userId).gt("mfa_carry_until", new Date().toISOString()).select("user_id");
      if (!claimed.error && (claimed.data ?? []).length) {
        await db.from("account_mfa_sessions")
          .upsert({ session_id: sessionId, user_id: context.userId, verified_at: new Date().toISOString() }, { onConflict: "session_id" });
      }
    }
    const { mfa_email_full: _hidden, ...state } = await loadSecurityState(context.userId, sessionId);
    return state;
  });

export type { SecurityState };
