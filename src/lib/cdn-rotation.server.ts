/* eslint-disable @typescript-eslint/no-explicit-any -- temporary until the new migration is applied and Supabase types are regenerated */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, blingApiRequest, type BlingIntegrationRow } from "@/lib/bling.server";
import {
  blingImagesMatch,
  blingMediaState,
  blingNonMediaFieldsMatch,
  buildBlingMediaPatch,
  mergeLastSentMedia,
  nextRotationAt,
} from "@/lib/cdn-rotation";
import { parseCdnUrl, splitImageUrls } from "@/lib/cdn-url";
import {
  activateLegacyCdnSignature,
  assertCdnPurgeConfigured,
  createCdnKeyVersion,
  deactivateLegacyCdnSignature,
  probeCdnUrl,
  purgeCdnPublicId,
  setCdnKeyVersionStatus,
  signCdnObjectUrls,
} from "@/lib/cdn-worker.server";

const db = supabaseAdmin as any;
const LEASE_MS = 90_000;
const STABILIZE_MS = 2 * 60_000;
const ACTIVE_STATUSES = [
  "planned",
  "activating",
  "stabilizing",
  "preparing",
  "pushing",
  "verifying",
  "grace",
  "revoking",
  "rolling_back",
];

function checked<T extends { error?: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(result.error.message);
  return result;
}

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function reserveRotationBlingSlot(job: any) {
  const requestsPerSecond = Math.min(
    2,
    Math.max(0.1, Number(job.settings_snapshot?.max_bling_requests_per_second ?? 2)),
  );
  const intervalMs = Math.ceil(1000 / requestsPerSecond);
  const { data, error } = await db.rpc("take_cdn_rotation_bling_slot", {
    _company_id: job.company_id,
    _interval_ms: intervalMs,
  });
  if (error) throw new Error("Não foi possível reservar a cadência da rotação no Bling.");
  const wait = Number(data);
  if (!Number.isFinite(wait) || wait < 0)
    throw new Error("Cadência da rotação Bling indisponível.");
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function audit(
  jobId: string,
  action: string,
  details: Record<string, unknown> = {},
  actorId?: string | null,
) {
  await db.from("cdn_key_rotation_audit").insert({
    job_id: jobId,
    actor_id: actorId ?? null,
    action,
    details,
  });
}

export async function enqueueCdnRotationTick(jobId?: string) {
  const base = (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
  const secret = (process.env.BLING_WORKER_SECRET ?? "").trim();
  if (!base || !secret)
    throw new Error("Configure APP_PUBLIC_URL e BLING_WORKER_SECRET para executar rotações CDN.");
  checked(
    await db.rpc("enqueue_http_job", {
      _url: `${base}/api/public/cdn-rotation/tick`,
      _secret: secret,
      _body: jobId ? { job_id: jobId } : {},
    }),
  );
}

async function loadIntegration(id: string): Promise<
  | (BlingIntegrationRow & {
      cdn_signature?: string | null;
      cdn_signature_active?: boolean | null;
      cdn_key_version_id?: string | null;
    })
  | null
> {
  const { data, error } = await db
    .from("bling_integrations")
    .select(
      "id,company_id,access_token,refresh_token,token_expires_at,status,cdn_signature,cdn_signature_active,cdn_key_version_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function loadVersion(id: string | null | undefined) {
  if (!id) return null;
  return checked(await db.from("cdn_key_versions").select("*").eq("id", id).maybeSingle()).data;
}

async function ensureLegacyVersion(
  integration: Awaited<ReturnType<typeof loadIntegration>>,
  actorId?: string | null,
  allowReactivate = true,
) {
  if (!integration?.cdn_signature) return null;
  if (!integration.cdn_signature_active) {
    if (!allowReactivate) return null;
    await activateLegacyCdnSignature(integration.cdn_signature);
    checked(
      await db
        .from("bling_integrations")
        .update({ cdn_signature_active: true, cdn_signature_updated_at: nowIso() })
        .eq("id", integration.id),
    );
    integration.cdn_signature_active = true;
  }
  const active = checked(
    await db
      .from("cdn_key_versions")
      .select("*")
      .eq("integration_id", integration.id)
      .eq("status", "active")
      .maybeSingle(),
  ).data;
  if (active) return active;
  const existing = checked(
    await db
      .from("cdn_key_versions")
      .select("*")
      .eq("integration_id", integration.id)
      .eq("public_id", integration.cdn_signature)
      .maybeSingle(),
  ).data;
  if (existing) return existing;
  const latest = checked(
    await db
      .from("cdn_key_versions")
      .select("generation")
      .eq("integration_id", integration.id)
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ).data;
  return checked(
    await db
      .from("cdn_key_versions")
      .insert({
        company_id: integration.company_id,
        integration_id: integration.id,
        public_id: integration.cdn_signature,
        format: "v1",
        generation: Number(latest?.generation ?? 0) + 1,
        status: "active",
        activated_at: nowIso(),
        cloudflare_confirmed_at: nowIso(),
        created_by: actorId ?? null,
      })
      .select("*")
      .single(),
  ).data;
}

async function createNewVersion(
  job: any,
  integration: NonNullable<Awaited<ReturnType<typeof loadIntegration>>>,
) {
  const current =
    (await loadVersion(integration.cdn_key_version_id)) ??
    (await ensureLegacyVersion(integration, job.created_by, job.trigger_type !== "dry_run"));
  const latest = checked(
    await db
      .from("cdn_key_versions")
      .select("generation")
      .eq("integration_id", integration.id)
      .order("generation", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ).data;
  const workerVersion = await createCdnKeyVersion(integration.id);
  const inserted = checked(
    await db
      .from("cdn_key_versions")
      .insert({
        company_id: job.company_id,
        integration_id: integration.id,
        public_id: workerVersion.key_id,
        format: "v2",
        generation: Number(latest?.generation ?? 0) + 1,
        status: "pending",
        master_key_id: workerVersion.master_key_id,
        cloudflare_confirmed_at: nowIso(),
        created_by: job.created_by ?? null,
      })
      .select("*")
      .single(),
  ).data;
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        old_key_version_id: current?.id ?? null,
        new_key_version_id: inserted.id,
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );
  return { oldVersion: current, newVersion: inserted };
}

async function activateJob(job: any) {
  const integration = await loadIntegration(job.integration_id);
  if (!integration || integration.status !== "conectada")
    throw new Error("Integração Bling não está conectada.");
  let oldVersion = await loadVersion(job.old_key_version_id);
  let newVersion = await loadVersion(job.new_key_version_id);
  if (!newVersion) {
    const created = await createNewVersion(job, integration);
    oldVersion = created.oldVersion;
    newVersion = created.newVersion;
  }
  if (job.trigger_type === "dry_run") {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ status: "preparing", next_tick_at: nowIso(), updated_at: nowIso() })
        .eq("id", job.id),
    );
    await audit(
      job.id,
      "dry_run_key_prepared",
      { new_key_version_id: newVersion.id },
      job.created_by,
    );
    return { done: false, phase: "preparing" };
  }

  await setCdnKeyVersionStatus(newVersion.public_id, "activate");
  if (oldVersion?.format === "v2") await setCdnKeyVersionStatus(oldVersion.public_id, "grace");
  if (oldVersion) {
    checked(
      await db
        .from("cdn_key_versions")
        .update({
          status: "grace",
          retire_after: new Date(
            Date.now() + Number(job.settings_snapshot?.grace_days ?? 7) * 86_400_000,
          ).toISOString(),
          updated_at: nowIso(),
        })
        .eq("id", oldVersion.id),
    );
  }
  checked(
    await db
      .from("cdn_key_versions")
      .update({ status: "active", activated_at: nowIso(), updated_at: nowIso() })
      .eq("id", newVersion.id),
  );
  checked(
    await db
      .from("bling_integrations")
      .update({ cdn_key_version_id: newVersion.id })
      .eq("id", integration.id)
      .eq("company_id", integration.company_id),
  );
  const stabilizeUntil = new Date(Date.now() + STABILIZE_MS).toISOString();
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        status: "stabilizing",
        stabilize_until: stabilizeUntil,
        next_tick_at: stabilizeUntil,
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );
  await audit(job.id, "key_activated", {
    old: oldVersion?.public_id ?? null,
    new: newVersion.public_id,
  });
  return { done: false, phase: "stabilizing" };
}

async function listRotationProducts(job: any) {
  const selected = Array.isArray(job.selected_product_ids) ? job.selected_product_ids : [];
  const prepared =
    checked(
      await db
        .from("cdn_key_rotation_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id),
    ).count ?? 0;
  const remaining = job.product_limit ? Math.max(0, Number(job.product_limit) - prepared) : 50;
  if (remaining === 0) return [];
  const limit = Math.min(50, remaining);
  let query = db
    .from("bling_products")
    .select(
      "id,company_id,integration_id,bling_product_id,codigo,url_imagens_externas,imagem_principal_url,bling_last_sent_payload,updated_at",
    )
    .eq("integration_id", job.integration_id)
    .order("id")
    .limit(limit);
  if (job.prepare_cursor) query = query.gt("id", job.prepare_cursor);
  if (selected.length) query = query.in("id", selected);
  return checked(await query).data ?? [];
}

async function prepareItems(job: any) {
  const oldVersion = await loadVersion(job.old_key_version_id);
  const newVersion = await loadVersion(job.new_key_version_id);
  if (!newVersion) throw new Error("Versão nova não encontrada.");
  const base = (process.env.CDN_BASE_URL ?? "").trim().replace(/\/$/, "");
  const bucket = (
    process.env.R2_BUCKET_NAME ??
    process.env.CLOUDFLARE_R2_BUCKET ??
    "ajustae"
  ).trim();
  if (!base) throw new Error("CDN_BASE_URL não configurado.");
  const products = await listRotationProducts(job);
  const existingRows = products.length
    ? (checked(
        await db
          .from("cdn_key_rotation_items")
          .select("product_id")
          .eq("job_id", job.id)
          .in(
            "product_id",
            products.map((product: any) => product.id),
          ),
      ).data ?? [])
    : [];
  const existingProducts = new Set(existingRows.map((row: any) => row.product_id));
  for (const product of products) {
    if (existingProducts.has(product.id)) continue;
    const current = splitImageUrls(product.url_imagens_externas);
    if (!current.length) current.push(...splitImageUrls(product.imagem_principal_url));
    const parsed = current.map((url) => parseCdnUrl(url, base, bucket));
    const indexes = parsed
      .map((item, index) =>
        item && oldVersion && item.publicId === oldVersion.public_id ? index : -1,
      )
      .filter((index) => index >= 0);
    const common = {
      job_id: job.id,
      company_id: job.company_id,
      integration_id: job.integration_id,
      product_id: product.id,
      bling_product_id: product.bling_product_id,
      old_urls: current,
      product_updated_at_snapshot: product.updated_at,
    };
    if (!indexes.length) {
      checked(
        await db.from("cdn_key_rotation_items").upsert(
          {
            ...common,
            status: "skipped",
            error: oldVersion
              ? "Produto não usa a versão antiga."
              : "Integração não possuía versão anterior.",
            finished_at: nowIso(),
          },
          { onConflict: "job_id,product_id" },
        ),
      );
      continue;
    }
    if (indexes.some((index) => !parsed[index])) {
      checked(
        await db.from("cdn_key_rotation_items").upsert(
          {
            ...common,
            status: "error",
            error: "URL CDN antiga não pôde ser canonicalizada.",
            finished_at: nowIso(),
          },
          { onConflict: "job_id,product_id" },
        ),
      );
      continue;
    }
    const keys = indexes.map((index) => parsed[index]!.objectKey);
    try {
      const signed = await signCdnObjectUrls(job.integration_id, newVersion.public_id, keys);
      const newUrls = [...current];
      indexes.forEach((index, keyIndex) => {
        const replacement = signed.get(keys[keyIndex]);
        if (!replacement) throw new Error(`Objeto ${keys[keyIndex]} não foi assinado.`);
        newUrls[index] = replacement;
      });
      checked(
        await db.from("cdn_key_rotation_items").upsert(
          {
            ...common,
            status: "cdn_validated",
            new_urls: newUrls,
            object_keys: keys,
            error: null,
            finished_at: null,
          },
          { onConflict: "job_id,product_id" },
        ),
      );
    } catch (error) {
      checked(
        await db.from("cdn_key_rotation_items").upsert(
          {
            ...common,
            status: "error",
            object_keys: keys,
            error: errorMessage(error),
            finished_at: nowIso(),
          },
          { onConflict: "job_id,product_id" },
        ),
      );
    }
  }
  if (products.length) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          prepare_cursor: products[products.length - 1].id,
          next_tick_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    const summary = checked(await db.rpc("refresh_cdn_rotation_job", { _job_id: job.id })).data;
    return { done: false, phase: "preparing", summary };
  }
  const summary = checked(await db.rpc("refresh_cdn_rotation_job", { _job_id: job.id })).data;
  if (job.trigger_type === "dry_run") {
    await setCdnKeyVersionStatus(newVersion.public_id, "revoke");
    checked(
      await db
        .from("cdn_key_versions")
        .update({ status: "revoked", revoked_at: nowIso() })
        .eq("id", newVersion.id),
    );
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ status: "completed", finished_at: nowIso(), updated_at: nowIso() })
        .eq("id", job.id),
    );
    await audit(job.id, "dry_run_completed", { summary });
    return { done: true, phase: "completed", summary };
  }
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({ status: "pushing", next_tick_at: nowIso(), updated_at: nowIso() })
      .eq("id", job.id),
  );
  await audit(job.id, "items_prepared", { summary });
  return { done: false, phase: "pushing", summary };
}

async function updateItemFromBling(job: any, integration: BlingIntegrationRow, item: any) {
  if (!item.bling_product_id) {
    checked(
      await db
        .from("cdn_key_rotation_items")
        .update({
          status: "error",
          error: "Produto sem ID no Bling.",
          finished_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", item.id),
    );
    return;
  }
  const path = `/produtos/${encodeURIComponent(item.bling_product_id)}`;
  await reserveRotationBlingSlot(job);
  const before = await blingApiGet(integration, path);
  if (!before.ok) {
    await handleBlingFailure(
      job,
      item,
      before.status,
      before.errorMessage ?? "Falha ao ler produto no Bling.",
    );
    return;
  }
  const oldUrls = Array.isArray(item.old_urls) ? item.old_urls.map(String) : [];
  const newUrls = Array.isArray(item.new_urls) ? item.new_urls.map(String) : [];
  const currentImages = blingMediaState(before.data).imageUrls;
  if (blingImagesMatch(before.data, newUrls)) {
    await commitLocalProduct(
      job,
      item,
      newUrls,
      buildBlingMediaPatch(before.data, newUrls),
      before.data,
      before.data,
    );
    return;
  }
  if (
    currentImages.length !== oldUrls.length ||
    currentImages.some((url, index) => url !== oldUrls[index])
  ) {
    checked(
      await db
        .from("cdn_key_rotation_items")
        .update({
          status: "conflict",
          bling_before: before.data,
          error: "As imagens no Bling mudaram depois do snapshot; nenhuma sobrescrita foi feita.",
          finished_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", item.id),
    );
    return;
  }
  const mediaPatch = buildBlingMediaPatch(before.data, newUrls);
  await reserveRotationBlingSlot(job);
  const sent = await blingApiRequest(integration, "PATCH", path, mediaPatch);
  if (!sent.ok) {
    await handleBlingFailure(
      job,
      item,
      sent.status,
      sent.errorMessage ?? "Falha ao atualizar mídia no Bling.",
    );
    return;
  }
  checked(
    await db
      .from("cdn_key_rotation_items")
      .update({
        status: "bling_sent",
        last_http_status: sent.status,
        bling_before: before.data,
        updated_at: nowIso(),
      })
      .eq("id", item.id),
  );
  await reserveRotationBlingSlot(job);
  const after = await blingApiGet(integration, path);
  if (!after.ok) {
    await handleBlingFailure(
      job,
      item,
      after.status,
      after.errorMessage ?? "Falha ao confirmar mídia no Bling.",
    );
    return;
  }
  const videoPreserved =
    blingMediaState(before.data).videoUrl === blingMediaState(after.data).videoUrl;
  if (
    !blingImagesMatch(after.data, newUrls) ||
    !blingNonMediaFieldsMatch(before.data, after.data) ||
    !videoPreserved
  ) {
    checked(
      await db
        .from("cdn_key_rotation_items")
        .update({
          status: "error",
          last_http_status: after.status,
          bling_after: after.data,
          error: "O GET de confirmação não preservou mídia/campos conforme o snapshot.",
          finished_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", item.id),
    );
    return;
  }
  await commitLocalProduct(job, item, newUrls, mediaPatch, before.data, after.data);
}

async function handleBlingFailure(job: any, item: any, status: number, message: string) {
  if ([401, 403].includes(status)) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: "pushing",
          last_error: `Bling HTTP ${status}: ${message}`,
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
  }
  const retryable = status === 0 || status === 429 || status >= 500;
  checked(
    await db
      .from("cdn_key_rotation_items")
      .update({
        status: retryable && Number(item.attempts ?? 0) < 5 ? "cdn_validated" : "error",
        next_retry_at: retryable ? new Date(Date.now() + 5 * 60_000).toISOString() : nowIso(),
        last_http_status: status,
        error: message.slice(0, 1000),
        finished_at: retryable ? null : nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", item.id),
  );
}

async function commitLocalProduct(
  job: any,
  item: any,
  newUrls: string[],
  mediaPatch: ReturnType<typeof buildBlingMediaPatch>,
  before: unknown,
  after: unknown,
) {
  const product = checked(
    await db
      .from("bling_products")
      .select("bling_last_sent_payload,updated_at")
      .eq("id", item.product_id)
      .maybeSingle(),
  ).data;
  if (!product || product.updated_at !== item.product_updated_at_snapshot) {
    checked(
      await db
        .from("cdn_key_rotation_items")
        .update({
          status: "conflict",
          bling_before: before,
          bling_after: after,
          error:
            "Produto local mudou após o snapshot; Bling confirmado, banco aguardando reconciliação.",
          finished_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", item.id),
    );
    return;
  }
  const updated = checked(
    await db
      .from("bling_products")
      .update({
        url_imagens_externas: newUrls.join("|"),
        imagem_principal_url: newUrls[0] ?? null,
        bling_last_sent_payload: mergeLastSentMedia(product.bling_last_sent_payload, mediaPatch),
      })
      .eq("id", item.product_id)
      .eq("company_id", job.company_id)
      .eq("updated_at", item.product_updated_at_snapshot)
      .select("id")
      .maybeSingle(),
  ).data;
  checked(
    await db
      .from("cdn_key_rotation_items")
      .update(
        updated
          ? {
              status: "db_committed",
              bling_before: before,
              bling_after: after,
              error: null,
              finished_at: nowIso(),
              updated_at: nowIso(),
            }
          : {
              status: "conflict",
              bling_before: before,
              bling_after: after,
              error: "Conflito otimista ao gravar o banco.",
              finished_at: nowIso(),
              updated_at: nowIso(),
            },
      )
      .eq("id", item.id),
  );
}

async function processPushing(job: any) {
  checked(
    await db
      .from("cdn_key_rotation_items")
      .update({ status: "cdn_validated", updated_at: nowIso() })
      .eq("job_id", job.id)
      .eq("status", "processing")
      .lt("updated_at", new Date(Date.now() - LEASE_MS * 2).toISOString()),
  );
  const integration = await loadIntegration(job.integration_id);
  if (!integration || integration.status !== "conectada")
    throw new Error("Integração Bling indisponível.");
  const dailyLimit = Math.max(1, Number(job.settings_snapshot?.max_products_per_day ?? 1000));
  const { count: processedLast24h, error: budgetError } = await db
    .from("cdn_key_rotation_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id)
    .in("status", ["db_committed", "skipped", "conflict", "error", "rolled_back"])
    .gte("finished_at", new Date(Date.now() - 86_400_000).toISOString());
  if (budgetError) throw new Error(budgetError.message);
  const remainingBudget = dailyLimit - Number(processedLast24h ?? 0);
  if (remainingBudget <= 0) {
    const nextTick = new Date(Date.now() + 60 * 60_000).toISOString();
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ next_tick_at: nextTick, updated_at: nowIso() })
        .eq("id", job.id),
    );
    return { done: false, phase: "pushing", budget: "daily_limit", next_tick_at: nextTick };
  }
  const items =
    checked(
      await db.rpc("claim_cdn_rotation_items", {
        _job_id: job.id,
        _limit: Math.min(2, remainingBudget),
      }),
    ).data ?? [];
  for (const item of items) await updateItemFromBling(job, integration, item);
  const summary = checked(await db.rpc("refresh_cdn_rotation_job", { _job_id: job.id })).data;
  if (Number(summary.outstanding ?? 0) > 0) {
    const next = checked(
      await db
        .from("cdn_key_rotation_items")
        .select("next_retry_at")
        .eq("job_id", job.id)
        .in("status", ["cdn_validated", "processing", "bling_sent", "bling_verified"])
        .order("next_retry_at")
        .limit(1)
        .maybeSingle(),
    ).data;
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ next_tick_at: next?.next_retry_at ?? nowIso(), updated_at: nowIso() })
        .eq("id", job.id),
    );
    return { done: false, phase: "pushing", summary };
  }
  if (Number(summary.errors ?? 0) || Number(summary.conflicts ?? 0)) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: "pushing",
          last_error: "A revogação foi bloqueada por itens com erro ou conflito.",
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    return { done: true, phase: "paused", summary };
  }
  if (!job.old_key_version_id) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "completed",
          last_error: null,
          finished_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    await audit(job.id, "initial_key_established", { summary });
    return { done: true, phase: "completed", summary };
  }
  const graceUntil = new Date(
    Date.now() + Number(job.settings_snapshot?.grace_days ?? 7) * 86_400_000,
  ).toISOString();
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        status: "grace",
        grace_until: graceUntil,
        next_tick_at: graceUntil,
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );
  await audit(job.id, "bling_and_database_confirmed", { summary });
  return { done: false, phase: "grace", summary };
}

async function oldUrlCount(job: any, oldVersion: any) {
  if (!oldVersion) return 0;
  const base = (process.env.CDN_BASE_URL ?? "").trim().replace(/\/$/, "");
  const bucket = (
    process.env.R2_BUCKET_NAME ??
    process.env.CLOUDFLARE_R2_BUCKET ??
    "ajustae"
  ).trim();
  if (!base) throw new Error("CDN_BASE_URL não configurado.");
  let count = 0;
  const pageSize = 1000;
  for (let from = 0; from < 40_000; from += pageSize) {
    const page =
      checked(
        await db
          .from("bling_products")
          .select("url_imagens_externas,imagem_principal_url")
          .eq("integration_id", job.integration_id)
          .order("id")
          .range(from, from + pageSize - 1),
      ).data ?? [];
    for (const product of page) {
      const urls = splitImageUrls(product.url_imagens_externas);
      if (!urls.length) urls.push(...splitImageUrls(product.imagem_principal_url));
      if (urls.some((url) => parseCdnUrl(url, base, bucket)?.publicId === oldVersion.public_id))
        count += 1;
    }
    if (page.length < pageSize) break;
  }
  return count;
}

async function advanceGrace(job: any) {
  if (job.grace_until && new Date(job.grace_until).getTime() > Date.now()) {
    return { done: false, phase: "grace", until: job.grace_until };
  }
  const oldVersion = await loadVersion(job.old_key_version_id);
  const residual = await oldUrlCount(job, oldVersion);
  if (residual > 0) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: "grace",
          last_error: `${residual} produto(s) ainda apontam para a versão antiga. Execute outro lote antes de revogar.`,
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    return { done: true, phase: "paused", residual };
  }
  if (!job.external_consumers_confirmed_at) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: "grace",
          last_error: "Consumidores externos não foram confirmados.",
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    return { done: true, phase: "paused", externalConsumers: "unconfirmed" };
  }
  const approvalRequired = job.settings_snapshot?.require_revoke_approval !== false;
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        status: approvalRequired && !job.revoke_approved_at ? "awaiting_revoke" : "revoking",
        next_tick_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );
  return {
    done: approvalRequired && !job.revoke_approved_at,
    phase: approvalRequired ? "awaiting_revoke" : "revoking",
  };
}

async function revokeOldVersion(job: any) {
  assertCdnPurgeConfigured();
  const oldVersion = await loadVersion(job.old_key_version_id);
  const newVersion = await loadVersion(job.new_key_version_id);
  if (!oldVersion || !newVersion) throw new Error("Versões da rotação não encontradas.");
  if ((await oldUrlCount(job, oldVersion)) > 0)
    throw new Error("Ainda existem URLs antigas no banco.");
  if (!job.external_consumers_confirmed_at)
    throw new Error("Consumidores externos não confirmados.");

  if (oldVersion.format === "v2") await setCdnKeyVersionStatus(oldVersion.public_id, "revoking");
  else await deactivateLegacyCdnSignature(oldVersion.public_id);
  checked(
    await db
      .from("cdn_key_versions")
      .update({ status: "revoking", updated_at: nowIso() })
      .eq("id", oldVersion.id),
  );
  const purge = await purgeCdnPublicId(oldVersion.public_id, oldVersion.format);
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        purge_request_id: purge.requestId,
        purge_prefix: purge.prefix,
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );

  const canaries =
    checked(
      await db
        .from("cdn_key_rotation_items")
        .select("old_urls,new_urls")
        .eq("job_id", job.id)
        .eq("status", "db_committed")
        .limit(3),
    ).data ?? [];
  const oldUrls = canaries
    .flatMap((item: any) => (Array.isArray(item.old_urls) ? item.old_urls : []))
    .filter((url: string) => url.includes(oldVersion.public_id))
    .slice(0, 3);
  const newUrls = canaries
    .flatMap((item: any) => (Array.isArray(item.new_urls) ? item.new_urls : []))
    .filter((url: string) => url.includes(newVersion.public_id))
    .slice(0, 3);
  const [oldProbes, newProbes] = await Promise.all([
    Promise.all(oldUrls.map(probeCdnUrl)),
    Promise.all(newUrls.map(probeCdnUrl)),
  ]);
  const oldFailedClosed =
    oldProbes.length > 0 &&
    oldProbes.every((probe) => [403, 404].includes(probe.status) && probe.cacheStatus !== "HIT");
  const newHealthy = newProbes.length > 0 && newProbes.every((probe) => probe.status === 200);
  if (!oldFailedClosed || !newHealthy) {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "revoking",
          next_tick_at: new Date(Date.now() + 60_000).toISOString(),
          last_error:
            "Purge aceito, mas os canários ainda não comprovaram revogação global e disponibilidade nova.",
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    return { done: false, phase: "revoking", oldProbes, newProbes };
  }
  if (oldVersion.format === "v2") await setCdnKeyVersionStatus(oldVersion.public_id, "revoke");
  await purgeCdnPublicId(oldVersion.public_id, oldVersion.format);
  checked(
    await db
      .from("cdn_key_versions")
      .update({ status: "revoked", revoked_at: nowIso(), updated_at: nowIso() })
      .eq("id", oldVersion.id),
  );
  if (oldVersion.format === "v1") {
    checked(
      await db
        .from("bling_integrations")
        .update({ cdn_signature_active: false, cdn_signature_updated_at: nowIso() })
        .eq("id", job.integration_id),
    );
  }
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        status: "completed",
        last_error: null,
        finished_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );
  await audit(job.id, "old_key_revoked", {
    purge_request_id: purge.requestId,
    oldProbes,
    newProbes,
  });
  return { done: true, phase: "completed" };
}

async function processRollback(job: any) {
  const integration = await loadIntegration(job.integration_id);
  if (!integration || integration.status !== "conectada")
    throw new Error("Integração Bling indisponível para rollback.");
  const item = checked(
    await db
      .from("cdn_key_rotation_items")
      .select("*")
      .eq("job_id", job.id)
      .eq("status", "db_committed")
      .order("id")
      .limit(1)
      .maybeSingle(),
  ).data;
  if (item) {
    const oldUrls = Array.isArray(item.old_urls) ? item.old_urls.map(String) : [];
    const newUrls = Array.isArray(item.new_urls) ? item.new_urls.map(String) : [];
    const path = `/produtos/${encodeURIComponent(item.bling_product_id)}`;
    await reserveRotationBlingSlot(job);
    const before = await blingApiGet(integration, path);
    if (!before.ok) throw new Error(before.errorMessage ?? "Falha ao ler produto no rollback.");
    if (!blingImagesMatch(before.data, oldUrls)) {
      if (!blingImagesMatch(before.data, newUrls)) {
        checked(
          await db
            .from("cdn_key_rotation_items")
            .update({
              status: "conflict",
              error: "As imagens mudaram depois da rotação; rollback não sobrescreveu o produto.",
              updated_at: nowIso(),
            })
            .eq("id", item.id),
        );
        throw new Error("Rollback pausado por conflito de imagens no Bling.");
      }
      const patch = buildBlingMediaPatch(before.data, oldUrls);
      await reserveRotationBlingSlot(job);
      const sent = await blingApiRequest(integration, "PATCH", path, patch);
      if (!sent.ok) throw new Error(sent.errorMessage ?? "Falha no PATCH de rollback.");
      await reserveRotationBlingSlot(job);
      const after = await blingApiGet(integration, path);
      if (
        !after.ok ||
        !blingImagesMatch(after.data, oldUrls) ||
        !blingNonMediaFieldsMatch(before.data, after.data)
      ) {
        throw new Error("O Bling não confirmou o rollback preservando os demais campos.");
      }
    }
    const product = checked(
      await db
        .from("bling_products")
        .select("url_imagens_externas,imagem_principal_url,bling_last_sent_payload")
        .eq("id", item.product_id)
        .maybeSingle(),
    ).data;
    const currentLocal = splitImageUrls(product?.url_imagens_externas);
    if (!currentLocal.length) currentLocal.push(...splitImageUrls(product?.imagem_principal_url));
    const localIsOld =
      currentLocal.length === oldUrls.length &&
      currentLocal.every((url, index) => url === oldUrls[index]);
    const localIsNew =
      currentLocal.length === newUrls.length &&
      currentLocal.every((url, index) => url === newUrls[index]);
    if (!localIsOld && !localIsNew) {
      throw new Error("O produto local mudou; rollback do banco foi bloqueado.");
    }
    if (localIsNew) {
      const oldPatch = buildBlingMediaPatch(before.data, oldUrls);
      checked(
        await db
          .from("bling_products")
          .update({
            url_imagens_externas: oldUrls.join("|"),
            imagem_principal_url: oldUrls[0] ?? null,
            bling_last_sent_payload: mergeLastSentMedia(product?.bling_last_sent_payload, oldPatch),
          })
          .eq("id", item.product_id)
          .eq("company_id", job.company_id),
      );
    }
    checked(
      await db
        .from("cdn_key_rotation_items")
        .update({ status: "rolled_back", error: null, finished_at: nowIso(), updated_at: nowIso() })
        .eq("id", item.id),
    );
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ next_tick_at: nowIso(), updated_at: nowIso() })
        .eq("id", job.id),
    );
    return { done: false, phase: "rolling_back", product_id: item.product_id };
  }

  const oldVersion = await loadVersion(job.old_key_version_id);
  const newVersion = await loadVersion(job.new_key_version_id);
  if (!oldVersion || !newVersion)
    throw new Error("Versões da rotação não encontradas para finalizar rollback.");
  if (oldVersion.format === "v2") await setCdnKeyVersionStatus(oldVersion.public_id, "activate");
  else await activateLegacyCdnSignature(oldVersion.public_id);
  await setCdnKeyVersionStatus(newVersion.public_id, "grace");
  // Libera o índice de versão ativa antes de reativar a anterior.
  checked(
    await db
      .from("cdn_key_versions")
      .update({ status: "grace", retire_after: null, updated_at: nowIso() })
      .eq("id", newVersion.id),
  );
  checked(
    await db
      .from("cdn_key_versions")
      .update({ status: "active", retire_after: null, updated_at: nowIso() })
      .eq("id", oldVersion.id),
  );
  checked(
    await db
      .from("bling_integrations")
      .update({
        cdn_key_version_id: oldVersion.format === "v2" ? oldVersion.id : null,
        ...(oldVersion.format === "v1"
          ? {
              cdn_signature: oldVersion.public_id,
              cdn_signature_active: true,
              cdn_signature_updated_at: nowIso(),
            }
          : {}),
      })
      .eq("id", job.integration_id),
  );
  checked(
    await db
      .from("cdn_key_rotation_jobs")
      .update({
        status: "rolled_back",
        last_error: null,
        finished_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", job.id),
  );
  await audit(job.id, "rollback_completed", { restored: oldVersion.public_id });
  return { done: true, phase: "rolled_back" };
}

async function runJob(job: any) {
  if (job.status === "planned") {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "activating",
          started_at: job.started_at ?? nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", job.id),
    );
    return activateJob({ ...job, status: "activating" });
  }
  if (job.status === "activating") return activateJob(job);
  if (job.status === "stabilizing") {
    if (job.stabilize_until && new Date(job.stabilize_until).getTime() > Date.now()) {
      return { done: false, phase: "stabilizing", until: job.stabilize_until };
    }
    const version = await loadVersion(job.new_key_version_id);
    if (!version) throw new Error("Versão nova não encontrada durante estabilização.");
    await setCdnKeyVersionStatus(version.public_id, "activate");
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ status: "preparing", next_tick_at: nowIso(), updated_at: nowIso() })
        .eq("id", job.id),
    );
    return { done: false, phase: "preparing" };
  }
  if (job.status === "preparing") return prepareItems(job);
  if (job.status === "pushing" || job.status === "verifying") return processPushing(job);
  if (job.status === "grace") return advanceGrace(job);
  if (job.status === "revoking") return revokeOldVersion(job);
  if (job.status === "rolling_back") return processRollback(job);
  return { done: true, phase: job.status };
}

export async function processCdnRotationTick(requestedJobId?: string) {
  const now = new Date();
  const token = crypto.randomUUID();
  let query = db
    .from("cdn_key_rotation_jobs")
    .select("*")
    .in("status", ACTIVE_STATUSES)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .order("next_tick_at")
    .limit(1);
  if (requestedJobId) query = query.eq("id", requestedJobId);
  else query = query.lte("next_tick_at", now.toISOString());
  const candidate = checked(await query.maybeSingle()).data;
  if (!candidate) return { done: true };
  let claim = db
    .from("cdn_key_rotation_jobs")
    .update({
      lease_token: token,
      lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
      heartbeat_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", candidate.id)
    .in("status", ACTIVE_STATUSES)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`);
  if (!requestedJobId) claim = claim.lte("next_tick_at", now.toISOString());
  const job = checked(await claim.select("*").maybeSingle()).data;
  if (!job) return { done: false, busy: true };
  let result: any;
  try {
    result = await runJob(job);
  } catch (error) {
    const message = errorMessage(error);
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: job.status,
          last_error: message.slice(0, 1000),
          updated_at: nowIso(),
        })
        .eq("id", job.id)
        .eq("lease_token", token),
    );
    await audit(job.id, "job_paused", { error: message.slice(0, 500) });
    result = { done: true, phase: "paused", error: message };
  } finally {
    checked(
      await db
        .from("cdn_key_rotation_jobs")
        .update({ lease_token: null, lease_until: null })
        .eq("id", job.id)
        .eq("lease_token", token),
    );
  }
  const current = checked(
    await db.from("cdn_key_rotation_jobs").select("status,next_tick_at").eq("id", job.id).single(),
  ).data;
  if (
    ACTIVE_STATUSES.includes(current.status) &&
    new Date(current.next_tick_at).getTime() <= Date.now() + 1000
  ) {
    await enqueueCdnRotationTick(job.id).catch(async (error) => {
      await db
        .from("cdn_key_rotation_jobs")
        .update({
          status: "paused",
          resume_status: current.status,
          last_error: errorMessage(error).slice(0, 1000),
          updated_at: nowIso(),
        })
        .eq("id", job.id);
    });
  }
  return result;
}

export async function planDueCdnRotations() {
  const settings = checked(
    await db.from("cdn_rotation_settings").select("*").eq("singleton", true).maybeSingle(),
  ).data;
  if (!settings?.enabled || settings.mode !== "periodic") return { planned: 0 };
  if (settings.next_run_at && new Date(settings.next_run_at).getTime() > Date.now())
    return { planned: 0 };
  const integrations =
    checked(
      await db
        .from("bling_integrations")
        .select("id,company_id,cdn_key_version_id")
        .eq("status", "conectada")
        .not("cdn_key_version_id", "is", null),
    ).data ?? [];
  let planned = 0;
  for (const integration of integrations) {
    const version = await loadVersion(integration.cdn_key_version_id);
    if (!version?.activated_at) continue;
    const ageDays = (Date.now() - new Date(version.activated_at).getTime()) / 86_400_000;
    if (ageDays < Number(settings.interval_days)) continue;
    const { data, error } = await db
      .from("cdn_key_rotation_jobs")
      .insert({
        company_id: integration.company_id,
        integration_id: integration.id,
        trigger_type: "periodic",
        settings_snapshot: settings,
        product_limit: null,
      })
      .select("id")
      .maybeSingle();
    if (!error && data) {
      planned += 1;
      await enqueueCdnRotationTick(data.id).catch(() => undefined);
    }
  }
  const next = nextRotationAt(
    new Date(),
    Number(settings.interval_days),
    Number(settings.start_hour),
    String(settings.timezone),
  ).toISOString();
  checked(
    await db
      .from("cdn_rotation_settings")
      .update({ next_run_at: next, updated_at: nowIso() })
      .eq("singleton", true),
  );
  return { planned };
}
