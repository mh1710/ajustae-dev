import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável ausente: ${name}`);
  return value;
}

function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result;
}

function imageUrls(value) {
  return String(value ?? "")
    .split(/[|\n\r]+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 18);
}

function snapshotUrls(payload) {
  const rows = payload?.midia?.imagens?.imagensURL;
  return Array.isArray(rows)
    ? rows
        .map((row) => String(row?.link ?? "").trim())
        .filter(Boolean)
        .slice(0, 18)
    : [];
}

function sameUrls(left, right) {
  return left.length === right.length && left.every((url, index) => url === right[index]);
}

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const timeout = () => AbortSignal.timeout(20_000);
const productSelect =
  "id,company_id,codigo,nome,bling_product_id,url_imagens_externas,imagem_principal_url,bling_last_sent_payload,dirty,updated_at";

const [dirtyCount, cdnCount, localNewCount, dirtyRows, cdnRows, localNewRows, companyRows] =
  await Promise.all([
    supabase
      .from("bling_products")
      .select("id", { count: "exact", head: true })
      .eq("dirty", true)
      .not("bling_product_id", "is", null)
      .or("url_imagens_externas.not.is.null,imagem_principal_url.not.is.null")
      .abortSignal(timeout()),
    supabase
      .from("bling_products")
      .select("id", { count: "exact", head: true })
      .not("bling_product_id", "is", null)
      .like("url_imagens_externas", "%/v2/%")
      .abortSignal(timeout()),
    supabase
      .from("bling_products")
      .select("id", { count: "exact", head: true })
      .is("bling_product_id", null)
      .or("url_imagens_externas.not.is.null,imagem_principal_url.not.is.null")
      .abortSignal(timeout()),
    supabase
      .from("bling_products")
      .select(productSelect)
      .eq("dirty", true)
      .not("bling_product_id", "is", null)
      .or("url_imagens_externas.not.is.null,imagem_principal_url.not.is.null")
      .order("updated_at", { ascending: false })
      .limit(100)
      .abortSignal(timeout()),
    supabase
      .from("bling_products")
      .select(productSelect)
      .not("bling_product_id", "is", null)
      .like("url_imagens_externas", "%/v2/%")
      .order("updated_at", { ascending: false })
      .limit(100)
      .abortSignal(timeout()),
    supabase
      .from("bling_products")
      .select(productSelect)
      .is("bling_product_id", null)
      .or("url_imagens_externas.not.is.null,imagem_principal_url.not.is.null")
      .order("updated_at", { ascending: false })
      .limit(100)
      .abortSignal(timeout()),
    supabase.from("companies").select("id,nome").order("id").limit(1000).abortSignal(timeout()),
  ]);

const dirtyProducts = checked(dirtyRows).data ?? [];
const cdnProducts = checked(cdnRows).data ?? [];
const localNewProducts = checked(localNewRows).data ?? [];
const companies = checked(companyRows).data ?? [];
const products = [
  ...new Map(
    [...dirtyProducts, ...cdnProducts, ...localNewProducts].map((product) => [product.id, product]),
  ).values(),
];
const productIds = products.map((product) => product.id);
const queueRows = productIds.length
  ? (checked(
      await supabase
        .from("bling_push_queue")
        .select("product_id,status,tipo,erro,updated_at")
        .in("status", ["pendente", "processando", "pausado", "erro"])
        .in("tipo", ["produto", "criar"])
        .in("product_id", productIds)
        .order("updated_at", { ascending: false })
        .limit(1000)
        .abortSignal(timeout()),
    ).data ?? [])
  : [];

const companyNames = new Map(companies.map((row) => [row.id, row.nome]));
const queueByProduct = new Map();
for (const row of queueRows) {
  if (row.product_id && !queueByProduct.has(row.product_id))
    queueByProduct.set(row.product_id, row);
}

const summary = {
  candidate_products_sampled: products.length,
  dirty_candidates: checked(dirtyCount).count ?? 0,
  cdn_candidates: checked(cdnCount).count ?? 0,
  local_new_candidates: checked(localNewCount).count ?? 0,
  sampled_with_local_images: 0,
  sampled_confirmed_by_last_successful_send: 0,
  sampled_divergent_from_last_successful_send: 0,
  sampled_divergent_without_queue: 0,
  sampled_dirty_without_snapshot: 0,
  sampled_dirty_without_snapshot_and_queue: 0,
  sampled_local_images_without_bling_id: 0,
  sampled_no_snapshot_not_dirty: 0,
};
const samples = [];

for (const product of products) {
  const current = imageUrls(product.url_imagens_externas);
  if (!current.length) current.push(...imageUrls(product.imagem_principal_url));
  if (!current.length) continue;
  summary.sampled_with_local_images += 1;
  const queue = queueByProduct.get(product.id) ?? null;
  const safe = {
    product_id: product.id,
    company: companyNames.get(product.company_id) ?? product.company_id,
    sku: product.codigo,
    name: product.nome,
    queue_status: queue?.status ?? null,
    queue_type: queue?.tipo ?? null,
    queue_error: queue?.erro ? String(queue.erro).slice(0, 240) : null,
    updated_at: product.updated_at,
  };
  if (!product.bling_product_id) {
    summary.sampled_local_images_without_bling_id += 1;
    if (samples.length < 50) samples.push({ ...safe, classification: "local_sem_id_bling" });
    continue;
  }
  const sent = snapshotUrls(product.bling_last_sent_payload);
  if (sent.length) {
    if (sameUrls(current, sent)) summary.sampled_confirmed_by_last_successful_send += 1;
    else {
      summary.sampled_divergent_from_last_successful_send += 1;
      if (!queue) summary.sampled_divergent_without_queue += 1;
      if (samples.length < 50)
        samples.push({
          ...safe,
          classification: queue ? "divergente_com_fila" : "divergente_sem_fila",
          local_image_count: current.length,
          last_sent_image_count: sent.length,
        });
    }
  } else if (product.dirty) {
    summary.sampled_dirty_without_snapshot += 1;
    if (!queue) summary.sampled_dirty_without_snapshot_and_queue += 1;
    if (samples.length < 50)
      samples.push({
        ...safe,
        classification: queue ? "alterado_sem_snapshot_com_fila" : "alterado_sem_snapshot_sem_fila",
      });
  } else summary.sampled_no_snapshot_not_dirty += 1;
}

console.log(JSON.stringify({ generated_at: new Date().toISOString(), summary, samples }, null, 2));
