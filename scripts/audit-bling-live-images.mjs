import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável ausente: ${name}`);
  return value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urls = (value) =>
  String(value ?? "")
    .split(/[|\n\r]+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 18);
const same = (left, right) =>
  left.length === right.length && left.every((url, index) => url === right[index]);
const remoteUrls = (payload) => {
  const product = payload?.data ?? payload ?? {};
  const images = product?.midia?.imagens ?? {};
  const rows = [
    ...(Array.isArray(images?.externas) ? images.externas : []),
    ...(Array.isArray(images?.internas) ? images.internas : []),
  ];
  return rows
    .map((row) => String(row?.link ?? row?.url ?? row?.imagemURL ?? "").trim())
    .filter(Boolean);
};

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [{ data: integrations, error: integrationError }, { data: companies, error: companyError }] =
  await Promise.all([
    supabase
      .from("bling_integrations")
      .select("id,company_id,access_token,token_expires_at,status")
      .eq("status", "conectada"),
    supabase.from("companies").select("id,nome"),
  ]);
if (integrationError || companyError) throw new Error((integrationError ?? companyError).message);
const companyNames = new Map((companies ?? []).map((company) => [company.id, company.nome]));
const results = [];

for (const integration of integrations ?? []) {
  if (
    !integration.access_token ||
    Date.parse(integration.token_expires_at ?? "") <= Date.now() + 60_000
  ) {
    results.push({
      company: companyNames.get(integration.company_id),
      status: "token_expirado_ou_ausente",
    });
    continue;
  }
  const { data: products, error } = await supabase
    .from("bling_products")
    .select("id,codigo,nome,bling_product_id,url_imagens_externas,imagem_principal_url")
    .eq("company_id", integration.company_id)
    .eq("dirty", true)
    .not("bling_product_id", "is", null)
    .or("url_imagens_externas.not.is.null,imagem_principal_url.not.is.null")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const product = products?.[0];
  if (!product) {
    results.push({ company: companyNames.get(integration.company_id), status: "sem_candidato" });
    continue;
  }
  const response = await fetch(
    `https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(product.bling_product_id)}`,
    {
      headers: {
        Authorization: `Bearer ${integration.access_token}`,
        Accept: "application/json",
        "enable-jwt": "1",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    results.push({
      company: companyNames.get(integration.company_id),
      sku: product.codigo,
      status: `http_${response.status}`,
    });
    await sleep(650);
    continue;
  }
  const local = urls(product.url_imagens_externas || product.imagem_principal_url);
  const remote = remoteUrls(await response.json());
  results.push({
    company: companyNames.get(integration.company_id),
    sku: product.codigo,
    name: product.nome,
    status: "consultado",
    local_image_count: local.length,
    remote_image_count: remote.length,
    exact_url_match: same(local, remote),
  });
  await sleep(650);
}

console.log(JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
