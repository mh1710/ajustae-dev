import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RULE_REGISTRY } from "@/lib/validation-rules/registry";
import type { AuditProduct } from "@/lib/validation-rules/types";

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

/** Lista todas as regras globais. */
export const listValidationRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ company_id: z.string().uuid().optional() }).optional().parse(d ?? {}),
  )
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("validation_rules")
      .select("*")
      .is("company_id", null)
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Cria/atualiza uma regra global. */
export const upsertValidationRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        company_id: z.string().uuid().optional().nullable(),
        slug: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        category: z.string().min(1),
        severity: z.enum(["error", "warning"]),
        active: z.boolean().default(true),
        config: z.record(z.string(), z.any()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("validation_rules")
        .update({
          name: data.name,
          description: data.description ?? null,
          category: data.category,
          severity: data.severity,
          active: data.active,
          config: data.config,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("validation_rules")
      .insert({
        company_id: null,
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        category: data.category,
        severity: data.severity,
        active: data.active,
        config: data.config,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao criar regra");
    return { id: row.id };
  });

export const toggleValidationRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("validation_rules")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteValidationRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("validation_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Cria um audit run. Se product_ids vazio → todos os produtos da empresa. */
export const startAuditRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_ids: z.array(z.string().uuid()).default([]),
        rule_ids: z.array(z.string().uuid()).default([]),
        /** true = considera apenas produtos com situação Ativo. */
        only_active: z.boolean().default(false),
        /** true = auditoria rápida, sem a varredura de fotos. */
        skip_images: z.boolean().default(false),
        corrected_only: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    if (data.corrected_only) {
      const { data: result, error } = await (context.supabase as any).rpc("start_corrected_audit", { _company_id: data.company_id });
      if (error) throw new Error(error.message);
      if (!result?.run_id) {
        throw new Error(`Nada a auditar: ${result?.removed_inactive ?? 0} produto(s) corrigido(s) foram inativados e saíram da auditoria, que considera só ativos.`);
      }
      return result as { run_id: string; total: number };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Impede duas auditorias ao mesmo tempo na mesma empresa: uma execução
    // concorrente mais antiga poderia apagar os resultados da mais nova.
    const { data: running, error: runningError } = await supabaseAdmin
      .from("audit_runs")
      .select("id")
      .eq("company_id", data.company_id)
      .eq("status", "processando")
      .limit(1);
    if (runningError) throw new Error(runningError.message);
    if (running?.length) {
      throw new Error("Já existe uma auditoria em andamento nesta empresa. Aguarde terminar ou cancele a atual antes de iniciar outra.");
    }

    let productIds = data.product_ids;
    if (productIds.length) {
      let selectedQuery = context.supabase.from('bling_products').select('id,situacao').eq('company_id', data.company_id).in('id', productIds);
      const { data: owned, error: ownedError } = await selectedQuery;
      if (ownedError) throw new Error(ownedError.message);
      if (owned?.length !== new Set(productIds).size) throw new Error('A seleção contém produtos sem acesso.');
      productIds = owned.filter(product => !data.only_active || ["A", "Ativo", "ativo", "ATIVO"].includes(product.situacao ?? "")).map(product => product.id);
      if (!productIds.length) throw new Error("Nenhum produto ativo na seleção para auditar.");
    }
    let totalProducts = productIds.length;
    if (productIds.length === 0) {
      let q = supabaseAdmin
        .from("bling_products")
        .select("id", { count: "exact", head: true })
        .eq("company_id", data.company_id);
      if (data.only_active) q = q.in("situacao", ["A", "Ativo", "ativo", "ATIVO"]);
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      totalProducts = count ?? 0;
    }

    let ruleIds = data.rule_ids;
    if (ruleIds.length === 0) {
      const { data: r } = await supabaseAdmin
        .from("validation_rules")
        .select("id")
        .or(`company_id.is.null,company_id.eq.${data.company_id}`)
        .eq("active", true);
      ruleIds = (r ?? []).map((x: { id: string }) => x.id);
    }
    if (data.skip_images && ruleIds.length) {
      const { data: imageRules } = await supabaseAdmin.from("validation_rules").select("id").in("id", ruleIds).eq("slug", "imagem-placeholder");
      const skip = new Set((imageRules ?? []).map((x: { id: string }) => x.id));
      ruleIds = ruleIds.filter((id) => !skip.has(id));
    }

    const { data: run, error } = await supabaseAdmin
      .from("audit_runs")
      .insert({
        company_id: data.company_id,
        user_id: context.userId,
        status: "processando",
        product_ids: productIds,
        rule_ids: ruleIds,
        total_products: totalProducts,
        only_active: data.only_active,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !run) throw new Error(error?.message ?? "Falha ao criar auditoria");
    return { run_id: run.id, total: totalProducts };
  });

/** Executa TODA a auditoria em uma única chamada SQL (função run_audit_sql).
 *  Mantemos o mesmo formato de retorno do fluxo antigo para não quebrar a UI. */
export const runAuditBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ run_id: z.string().uuid(), batch_size: z.number().int().min(1).max(250).default(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: run, error } = await supabaseAdmin
      .from("audit_runs")
      .select("*")
      .eq("id", data.run_id)
      .single();
    if (error || !run) throw new Error(error?.message ?? "Auditoria não encontrada");
    await assertMember(context, run.company_id);

    if (run.status === "concluida" || run.status === "cancelada") {
      return {
        done: true,
        cancelled: run.status === "cancelada",
        processed: run.processed_products,
        total: run.total_products,
        errors: run.errors_count ?? 0,
        warnings: run.warnings_count ?? 0,
        passed: run.passed_count ?? 0,
      };
    }

    const { data: imageRules } = await supabaseAdmin.from("validation_rules").select("id").in("id", run.rule_ids ?? []).eq("slug", "imagem-placeholder").eq("active", true);
    if ((imageRules ?? []).length) {
      const db = supabaseAdmin as any;
      const { error: startError } = await db.from("audit_runs").update({ image_scan_started: true }).eq("id", data.run_id).neq("status", "cancelada");
      if (startError) throw new Error(startError.message);
      const { scanImageAuditRun } = await import("@/lib/image-fingerprint.server");
      const scan = await scanImageAuditRun(data.run_id, 15_000);
      if (!scan.done) {
        const secret = process.env.BLING_WORKER_SECRET;
        const base = process.env.APP_PUBLIC_URL;
        const { IMAGE_AUDIT_SHARDS } = await import("@/lib/image-audit-batch");
        if (secret && base) for (let i = 0; i < IMAGE_AUDIT_SHARDS; i++) await db.rpc("enqueue_http_job", { _url: `${base.replace(/\/$/, "")}/api/public/bling/image-audit-tick`, _secret: secret, _body: { job_id: data.run_id } });
        return { done: false, cancelled: false, phase: "imagens", processed: scan.checked, total: run.total_products, errors: 0, warnings: 0, passed: 0 };
      }
    }

    // Um navegador aqui presente finaliza na hora: tira a corrida da fila do cron
    // do banco para o término agendado não disputar a mesma auditoria.
    await (supabaseAdmin as any).rpc("unschedule_audit_finish", { _run_id: data.run_id });
    // Executa TODA a auditoria em uma única transação SQL.
    const { data: rpcResult, error: rpcError } = await context.supabase.rpc(
      "run_audit_sql",
      { _run_id: data.run_id },
    );
    if (rpcError) throw new Error(rpcError.message);
    const r = { ...((rpcResult ?? {}) as Record<string, unknown>) };
    if (!r.cancelled) {
      // Regras adicionais (peso/dimensões e crossdocking) avaliadas após o motor principal.
      const { data: extra, error: extraError } = await (context.supabase as any).rpc(
        "run_audit_extra_rules",
        { _run_id: data.run_id },
      );
      if (extraError) throw new Error(extraError.message);
      const e = (extra ?? {}) as Record<string, unknown>;
      if (e.done) {
        r.errors = e.errors;
        r.warnings = e.warnings;
        r.passed = e.passed;
      }
    }
    if (r.cancelled) {
      return {
        done: true,
        cancelled: true,
        processed: run.processed_products ?? 0,
        total: run.total_products ?? 0,
        errors: run.errors_count ?? 0,
        warnings: run.warnings_count ?? 0,
        passed: run.passed_count ?? 0,
      };
    }
    return {
      done: true,
      cancelled: false,
      processed: Number(r.processed ?? 0),
      total: Number(r.total ?? 0),
      errors: Number(r.errors ?? 0),
      warnings: Number(r.warnings ?? 0),
      passed: Number(r.passed ?? 0),
    };
  });

export const cancelAuditRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: run, error: findError } = await supabaseAdmin
      .from("audit_runs")
      .select("id, company_id, status")
      .eq("id", data.run_id)
      .single();
    if (findError || !run) throw new Error(findError?.message ?? "Auditoria não encontrada");
    await assertMember(context, run.company_id);
    if (run.status !== "processando") return { ok: true };
    // Marca como cancelada e interrompe o backend rodando run_audit_sql.
    const { error } = await context.supabase.rpc("cancel_audit_run_hard", { _run_id: run.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAuditRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase.from("audit_runs").select("*").eq("id", data.run_id).single();
    if (error) throw new Error(error.message);
    await assertMember(context, run.company_id);
    return run;
  });

export const listAuditRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { data: runs, error } = await context.supabase
      .from("audit_runs")
      .select("*")
      .eq("company_id", data.company_id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return runs ?? [];
  });

export const getProductAuditResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: product, error: productError } = await context.supabase.from("bling_products")
      .select("company_id").eq("id", data.product_id).maybeSingle();
    if (productError || !product) throw new Error("Produto não encontrado.");
    await assertMember(context, product.company_id);
    // Retorna apenas os resultados da auditoria mais recente deste produto.
    const { data: latest, error: latestError } = await context.supabase
      .from("audit_results")
      .select("run_id, created_at")
      .eq("product_id", data.product_id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (latestError) throw new Error(latestError.message);
    const runId = latest?.[0]?.run_id;
    if (!runId) return [];
    const { data: rows, error } = await context.supabase
      .from("audit_results")
      .select("id, rule_slug, category, severity, status, message, details, created_at")
      .eq("product_id", data.product_id)
      .eq("run_id", runId)
      .order("severity", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });


/**
 * Lista os tipos de erros/avisos encontrados na auditoria mais recente
 * da empresa (última run concluída), agregados por regra.
 */
export const listAuditIssueTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("list_audit_issue_types_fast", {
      _company_id: data.company_id,
    });
    if (error) throw new Error(error.message);
    const payload = (result ?? {}) as {
      run_id: string | null;
      issues: Array<{ rule_slug: string; name: string; category: string; error_count: number; warning_count: number }>;
    };
    return { run_id: payload.run_id ?? null, issues: payload.issues ?? [] };
  });

/** Revalida imediatamente um único produto com todas as regras ativas.
 *  Se `product_override` for informado, valida esses valores (o que o usuário
 *  tem no formulário) em vez do que está salvo no banco — útil pra saber se
 *  já está tudo certo pra salvar. */
export const auditSingleProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        product_id: z.string().uuid(),
        product_override: z.record(z.string(), z.any()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context, data.company_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: dbProduct, error: productError }, { data: rules, error: rulesError }] =
      await Promise.all([
        supabaseAdmin
          .from("bling_products")
          .select(
            "id, codigo, nome, marca, preco, preco_custo, estoque, descricao_complementar, descricao_curta, peso_liquido, peso_bruto, largura, altura, profundidade, url_imagens_externas, imagem_principal_url, gtin, situacao, unidade_medida, cross_docking, condicao_produto, tipo_producao, fornecedor_id",
          )
          .eq("id", data.product_id)
          .eq("company_id", data.company_id)
          .maybeSingle(),
        supabaseAdmin
          .from("validation_rules")
          .select("id, slug, category, severity, config")
          .or(`company_id.is.null,company_id.eq.${data.company_id}`)
          .eq("active", true),
      ]);
    if (productError) throw new Error(productError.message);
    if (rulesError) throw new Error(rulesError.message);
    if (!dbProduct) throw new Error("Produto não encontrado.");
    // Aplica valores do formulário por cima do produto salvo (mantém id/company_id).
    const { data: roles } = await context.supabase.from('user_roles').select('role').eq('user_id', context.userId);
    const restricted = (roles ?? []).some(role => String(role.role) === 'company_viewer');
    const product = !restricted && data.product_override
      ? { ...dbProduct, ...data.product_override, id: dbProduct.id }
      : dbProduct;


    const prepared = new Map<string, unknown>();
    for (const rule of rules ?? []) {
      const mod = RULE_REGISTRY[rule.slug];
      if (!mod?.prepare) continue;
      try {
        prepared.set(
          rule.id,
          await mod.prepare(
            { companyId: data.company_id, supabaseAdmin, products: [product as AuditProduct] },
            (rule.config ?? {}) as Record<string, unknown>,
          ),
        );
      } catch (error) {
        prepared.set(rule.id, { __error: error instanceof Error ? error.message : String(error) });
      }
    }

    const now = new Date().toISOString();
    const { data: run, error: runError } = await supabaseAdmin
      .from("audit_runs")
      .insert({
        company_id: data.company_id,
        user_id: context.userId,
        status: "concluida",
        product_ids: [data.product_id],
        rule_ids: (rules ?? []).map((rule) => rule.id),
        total_products: 1,
        processed_products: 1,
        started_at: now,
        finished_at: now,
      })
      .select("id")
      .single();
    if (runError || !run) throw new Error(runError?.message ?? "Falha ao criar auditoria.");

    let passed = 0;
    let errors = 0;
    let warnings = 0;
    const results: Record<string, unknown>[] = [];
    for (const rule of rules ?? []) {
      const mod = RULE_REGISTRY[rule.slug];
      if (!mod) continue;
      let evaluated;
      try {
        evaluated = await mod.evaluate(
          product as AuditProduct,
          (rule.config ?? {}) as Record<string, unknown>,
          prepared.get(rule.id),
        );
      } catch (error) {
        evaluated = { status: "error" as const, message: error instanceof Error ? error.message : "Erro na regra" };
      }
      const status =
        evaluated.status === "pass"
          ? "pass"
          : evaluated.status === "warning" || rule.severity === "warning"
            ? "warning"
            : "error";
      if (status === "pass") passed++;
      else if (status === "warning") warnings++;
      else errors++;
      results.push({
        run_id: run.id,
        company_id: data.company_id,
        product_id: data.product_id,
        rule_id: rule.id,
        rule_slug: rule.slug,
        category: rule.category,
        severity: rule.severity,
        status,
        message: evaluated.message ?? null,
        details: evaluated.details ?? null,
      });
    }

    // Mantém apenas a auditoria mais recente por produto: apaga resultados antigos.
    await supabaseAdmin
      .from("audit_results")
      .delete()
      .eq("product_id", data.product_id)
      .neq("run_id", run.id);

    if (results.length > 0) {
      const { error } = await supabaseAdmin.from("audit_results").insert(results as any);
      if (error) throw new Error(error.message);
    }

    const [{ error: productUpdateError }, { error: runUpdateError }] = await Promise.all([
      supabaseAdmin
        .from("bling_products")
        .update({
          last_audit_at: now,
          last_audit_passed: passed,
          last_audit_errors: errors,
          last_audit_warnings: warnings,
        })
        .eq("id", data.product_id)
        .eq("company_id", data.company_id),
      supabaseAdmin
        .from("audit_runs")
        .update({
          passed_count: errors === 0 && warnings === 0 ? 1 : 0,
          errors_count: errors > 0 ? 1 : 0,
          warnings_count: errors === 0 && warnings > 0 ? 1 : 0,
          duration_ms: Math.max(0, Date.now() - new Date(now).getTime()),
        })
        .eq("id", run.id),
    ]);
    if (productUpdateError) throw new Error(productUpdateError.message);
    if (runUpdateError) throw new Error(runUpdateError.message);
    return { passed, errors, warnings };
  });

/**
 * Lista os problemas (erros e avisos) de uma execução de auditoria,
 * paginado, já com código e nome do produto — usado na exportação do
 * relatório em Excel/PDF.
 */
export const listAuditRunResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        run_id: z.string().uuid(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(1000).default(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: run, error: runError } = await context.supabase
      .from("audit_runs")
      .select("id, company_id")
      .eq("id", data.run_id)
      .single();
    if (runError || !run) throw new Error(runError?.message ?? "Auditoria não encontrada");
    await assertMember(context, run.company_id);

    const { data: rows, error } = await context.supabase
      .from("audit_results")
      .select("id, product_id, rule_slug, category, severity, status, message")
      .eq("run_id", data.run_id)
      .in("status", ["error", "warning"])
      .order("severity", { ascending: true })
      .order("product_id", { ascending: true })
      .order("id", { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);
    const results = (rows ?? []) as any[];
    if (results.length === 0) return { items: [] as any[], count: 0 };

    const productIds = [...new Set(results.map((r) => r.product_id).filter(Boolean))];
    const productMap = new Map<string, { codigo: string | null; nome: string | null }>();
    for (let i = 0; i < productIds.length; i += 500) {
      const { data: prods, error: prodError } = await context.supabase
        .from("bling_products")
        .select("id, codigo, nome")
        .in("id", productIds.slice(i, i + 500));
      if (prodError) throw new Error(prodError.message);
      for (const p of prods ?? []) productMap.set(p.id, p as any);
    }

    return {
      count: results.length,
      items: results.map((r) => ({
        codigo: productMap.get(r.product_id)?.codigo ?? "",
        produto: productMap.get(r.product_id)?.nome ?? "",
        regra: r.rule_slug,
        categoria: r.category,
        severidade: r.severity,
        mensagem: r.message ?? "",
      })),
    };
  });

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ company_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("dashboard_stats", {
      _company_id: data.company_id,
    });
    if (error) throw new Error(error.message);
    const s = (result ?? {}) as {
      totalProducts?: number; totalRules?: number; totalRuns?: number;
      comErro?: number; comAviso?: number; semErro?: number; naoAuditados?: number;
      categorias?: Array<{ name: string; value: number }>;
    };
    return {
      totalProducts: s.totalProducts ?? 0,
      totalRules: s.totalRules ?? 0,
      totalRuns: s.totalRuns ?? 0,
      comErro: s.comErro ?? 0,
      comAviso: s.comAviso ?? 0,
      semErro: s.semErro ?? 0,
      naoAuditados: s.naoAuditados ?? 0,
      categorias: s.categorias ?? [],
    };
  });