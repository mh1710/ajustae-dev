// Worker helpers for pushing preço/estoque back to Bling.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, blingApiRequest, type BlingIntegrationRow, type BlingCallResult } from "./bling.server";
import { diffProductPayload } from "./product-payload-diff";
import { importSupplierPayload, type ImportSupplier } from "./import-product-supplier";
import { supplierLinkWrite } from "./supplier-link-write";

/** Grava o último estado completo do produto enviado ao Bling. */
async function saveProductSnapshot(productId: string, payload: Record<string, unknown>): Promise<void> {
  await supabaseAdmin
    .from("bling_products")
    .update({ bling_last_sent_payload: payload } as never)
    .eq("id", productId);
}


async function findBlingIdByCodigo(integ: BlingIntegrationRow, codigo: string): Promise<string | null> {
  const res = await blingApiGet<{ data?: Array<{ id?: number | string; codigo?: string }> }>(
    integ,
    `/produtos?codigo=${encodeURIComponent(codigo)}`,
  );
  if (!res.ok || !res.data) return null;
  const list = ((res.data as any).data ?? []) as Array<{ id?: number | string; codigo?: string }>;
  const match = Array.isArray(list)
    ? list.find((r) => String(r?.codigo ?? "").trim() === codigo.trim()) ?? list[0]
    : null;
  const id = match?.id;
  return id != null ? String(id) : null;
}

function isDuplicateCodeError(bodySafe: string | undefined): boolean {
  if (!bodySafe) return false;
  const s = bodySafe.toLowerCase();
  return s.includes("já foi cadastrado") || s.includes("ja foi cadastrado") || s.includes("j\\u00e1 foi cadastrado");
}

async function getProductCodigo(productId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("bling_products")
    .select("codigo")
    .eq("id", productId)
    .maybeSingle();
  const codigo = (data as { codigo?: string } | null)?.codigo;
  return codigo && codigo.trim() !== "" ? codigo : null;
}

function extractBlingErrorMessage(bodySafe: string | undefined): string {
  if (!bodySafe) return "";
  try {
    const parsed = JSON.parse(bodySafe) as any;
    const error = parsed?.error ?? parsed;
    const description = error?.description ?? error?.message ?? parsed?.message;
    const fields = Array.isArray(error?.fields)
      ? error.fields.map((f: any) => `${f?.element ?? f?.field ?? "campo"}: ${f?.msg ?? f?.message ?? "inválido"}`).join("; ")
      : "";
    return [description, fields].filter(Boolean).join(" — ");
  } catch {
    return bodySafe;
  }
}

function isAlreadyLinkedError(bodySafe: string | undefined): boolean {
  const s = extractBlingErrorMessage(bodySafe).toLowerCase();
  return (
    s.includes("já") && s.includes("vinculad")
  ) || (
    s.includes("ja") && s.includes("vinculad")
  ) || (
    s.includes("already") && s.includes("link")
  ) || (
    s.includes("duplic") && s.includes("loja")
  );
}

async function findProductStoreLink(
  integ: BlingIntegrationRow,
  blingProductId: string,
  blingStoreId: number,
): Promise<{ id: string; codigo?: string | null; preco?: number | null; precoPromocional?: number | null } | null> {
  const params = new URLSearchParams({
    idProduto: String(blingProductId),
    idLoja: String(blingStoreId),
    limite: "100",
  });
  const res = await blingApiGet<{ data?: Array<any> }>(integ, `/produtos/lojas?${params.toString()}`);
  if (!res.ok) return null;
  const rows = Array.isArray((res.data as any)?.data) ? (res.data as any).data as any[] : [];
  const match = rows.find((r) => String(r?.produto?.id ?? r?.idProduto ?? "") === String(blingProductId)) ?? rows[0];
  const id = match?.id;
  if (id == null) return null;
  return {
    id: String(id),
    codigo: match?.codigo ?? null,
    preco: toNum(match?.preco) ?? null,
    precoPromocional: toNum(match?.precoPromocional) ?? null,
  };
}

interface PushItem {
  id: string;
  integration_id: string;
  company_id: string;
  product_id: string;
  bling_product_id: string;
  bling_deposit_id: string | null;
  tipo: "preco" | "estoque" | "produto" | "criar" | "excluir" | "inativar" | "preco_loja" | "estoque_loja" | "vincular_loja" | "desvincular_loja" | "codigo_loja" | "codigo_loja_planilha" | "fornecedor_vinculo" | "fornecedor_custo";
  valor_novo: number;
  tentativas: number;
  bling_product_store_id: string | null;
  payload: Record<string, unknown> | null;
}

const MAX_ATTEMPTS = 5;

async function loadIntegration(integrationId: string): Promise<BlingIntegrationRow | null> {
  const { data } = await supabaseAdmin
    .from("bling_integrations")
    .select("id, company_id, access_token, refresh_token, token_expires_at, status")
    .eq("id", integrationId)
    .maybeSingle();
  return (data as BlingIntegrationRow) ?? null;
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v);
  return s.trim() === "" ? undefined : s;
}

function normalizeBlingSituacao(v: unknown): "A" | "I" | undefined {
  const s = toStr(v)?.toUpperCase();
  if (!s) return undefined;
  if (s === "A" || s.startsWith("ATIVO")) return "A";
  if (s === "I" || s.startsWith("INATIVO")) return "I";
  return undefined;
}

function extractImageUrls(v: unknown): string[] {
  if (v == null) return [];
  return String(v)
    .split(/[|\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/** "Própria"/"Terceiros" → P/T (campo tipoProducao da API v3). */
function mapTipoProducao(v: unknown): "P" | "T" | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return undefined;
  if (s.startsWith("P")) return "P";
  if (s.startsWith("T")) return "T";
  return undefined;
}
/** Condição: 0 = não especificado, 1 = novo, 2 = usado. */
function mapCondicao(v: unknown): 0 | 1 | 2 | undefined {
  const s = String(v ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (!s) return undefined;
  if (s.startsWith("NOVO") || s === "1") return 1;
  if (s.startsWith("USADO") || s === "2") return 2;
  return 0;
}
function mapBool(v: unknown): boolean | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return undefined;
  return ["S", "SIM", "TRUE", "1", "Y"].includes(s);
}

export async function buildFullProductPayload(productId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from("bling_products")
    .select("company_id, source, nome, codigo, preco, preco_custo, descricao_curta, descricao_complementar, gtin, gtin_embalagem, unidade, situacao, formato, tipo, marca, ncm, cest, garantia, observacoes, peso_liquido, peso_bruto, largura, altura, profundidade, estoque_minimo, estoque_maximo, itens_caixa, volumes, url_imagens_externas, imagem_principal_url, cross_docking, localizacao, origem_fiscal, numero_fci, codigo_lista_servicos, tipo_item, tributos, classe_ipi, valor_ipi_fixo, tipo_producao, condicao_produto, frete_gratis, link_externo, video, categoria_id")
    .eq("id", productId)
    .maybeSingle();
  if (!data) return null;
  const p: any = data;
  const payload: Record<string, unknown> = {};
  const nome = toStr(p.nome); if (nome) payload.nome = nome;
  const codigo = toStr(p.codigo); if (codigo) payload.codigo = codigo;
  if (p.source === "copia_empresa" || p.source === "garimpo_ml") {
    const { data: supplier, error } = await supabaseAdmin.rpc("resolve_import_product_supplier" as never, {
      _company_id:p.company_id, _sku:p.codigo, _fallback_cost:p.preco_custo, _fallback_name:p.nome,
    } as never);
    if (error) throw new Error(error.message);
    if (!supplier) throw new Error(`SKU ${codigo ?? "?"}: fornecedor de destino ou custo positivo não encontrado; cadastro não enviado.`);
    payload.fornecedor = importSupplierPayload(supplier as unknown as ImportSupplier);
  }
  const preco = toNum(p.preco); if (preco !== undefined) payload.preco = preco;
  const gtin = toStr(p.gtin); if (gtin) payload.gtin = gtin;
  // EAN tributário (gtinEmbalagem no Bling) é sempre igual ao EAN do produto
  const gtinEmb = gtin || toStr(p.gtin_embalagem); if (gtinEmb) payload.gtinEmbalagem = gtinEmb;
  if (gtin && toStr(p.gtin_embalagem) !== gtin) {
    // Mantém o Ajusta-e igual ao que vai para o Bling
    await supabaseAdmin.from("bling_products").update({ gtin_embalagem: gtin } as never).eq("id", productId);
  }
  const unidade = toStr(p.unidade); if (unidade) payload.unidade = unidade;
  payload.situacao = normalizeBlingSituacao(p.situacao) ?? "A";
  payload.formato = toStr(p.formato) ?? "S";
  payload.tipo = toStr(p.tipo) ?? "P";
  const marca = toStr(p.marca); if (marca) payload.marca = marca;
  const descCurta = toStr(p.descricao_curta);
  if (descCurta) payload.descricaoCurta = descCurta;
  const descComp = toStr(p.descricao_complementar);
  if (descComp) payload.descricaoComplementar = descComp;
  const obs = toStr(p.observacoes); if (obs) payload.observacoes = obs;
  const tp = mapTipoProducao(p.tipo_producao); if (tp) payload.tipoProducao = tp;
  const cond = mapCondicao(p.condicao_produto); if (cond !== undefined) payload.condicao = cond;
  const fg = mapBool(p.frete_gratis); if (fg !== undefined) payload.freteGratis = fg;
  const link = toStr(p.link_externo); if (link) payload.linkExterno = link;
  const cat = toStr(p.categoria_id); if (cat && /^\d+$/.test(cat)) payload.categoria = { id: Number(cat) };

  // Na API v3 volumes e itensPorCaixa ficam no nível principal (não em dimensoes).
  const volumes = toNum(p.volumes); if (volumes !== undefined) payload.volumes = volumes;
  const itensCaixa = toNum(p.itens_caixa); if (itensCaixa !== undefined) payload.itensPorCaixa = itensCaixa;

  const dimensoes: Record<string, unknown> = {};
  const largura = toNum(p.largura); if (largura !== undefined) dimensoes.largura = largura;
  const altura = toNum(p.altura); if (altura !== undefined) dimensoes.altura = altura;
  const profundidade = toNum(p.profundidade); if (profundidade !== undefined) dimensoes.profundidade = profundidade;
  // Base em centímetros. Código da API v3: 0 = metros, 1 = centímetros, 2 = milímetros.
  if (largura !== undefined || altura !== undefined || profundidade !== undefined) {
    dimensoes.unidadeMedida = 1;
  }
  if (Object.keys(dimensoes).length > 0) payload.dimensoes = dimensoes;

  // Na API v3 os dois pesos ficam no nível principal.
  const pl = toNum(p.peso_liquido); if (pl !== undefined) payload.pesoLiquido = pl;
  const pb = toNum(p.peso_bruto); if (pb !== undefined) payload.pesoBruto = pb;

  const estoque: Record<string, unknown> = {};
  const emin = toNum(p.estoque_minimo); if (emin !== undefined) estoque.minimo = emin;
  const emax = toNum(p.estoque_maximo); if (emax !== undefined) estoque.maximo = emax;
  const cdMatch = String(p.cross_docking ?? "").match(/\d+/);
  if (cdMatch) estoque.crossdocking = Number(cdMatch[0]);
  const loc = toStr(p.localizacao); if (loc) estoque.localizacao = loc;
  if (Object.keys(estoque).length > 0) payload.estoque = estoque;

  const tributacao: Record<string, unknown> = {};
  const ncm = toStr(p.ncm); if (ncm) tributacao.ncm = ncm;
  const cest = toStr(p.cest); if (cest) tributacao.cest = cest;
  const origem = String(p.origem_fiscal ?? "").match(/^\s*(\d)/);
  if (origem) tributacao.origem = Number(origem[1]);
  const fci = toStr(p.numero_fci); if (fci) tributacao.nFCI = fci;
  const cls = toStr(p.codigo_lista_servicos); if (cls) tributacao.codigoListaServicos = cls;
  const sped = toStr(p.tipo_item); if (sped) tributacao.spedTipoItem = sped;
  const pt = toNum(p.tributos); if (pt !== undefined) tributacao.percentualTributos = pt;
  const cIpi = toStr(p.classe_ipi); if (cIpi) tributacao.classeEnquadramentoIpi = cIpi;
  const ipiFixo = toNum(p.valor_ipi_fixo); if (ipiFixo !== undefined) tributacao.valorIpiFixo = ipiFixo;
  // Preço de custo NÃO é campo de tributação (valorBase era ignorado pelo Bling);
  // no Bling ele pertence ao vínculo produto-fornecedor.
  if (Object.keys(tributacao).length > 0) payload.tributacao = tributacao;

  const midia: Record<string, unknown> = {};
  const video = toStr(p.video); if (video) midia.video = { url: video };
  const imgs = extractImageUrls(p.url_imagens_externas);
  if (imgs.length === 0) {
    const principal = extractImageUrls(p.imagem_principal_url);
    if (principal.length > 0) imgs.push(...principal);
  }
  if (imgs.length > 0) {
    midia.imagens = { imagensURL: imgs.slice(0, 18).map((link) => ({ link })) };
  }
  if (Object.keys(midia).length > 0) payload.midia = midia;

  return payload;
}

// "Descrição no fornecedor": nome do produto na lista do fornecedor (fornecedor_produtos.titulo,
// achado pelo código sem prefixo); se não achar, usa o nome do produto no sistema.
async function supplierDescricao(
  productId: string | null | undefined,
  payload: Record<string, unknown>,
  companyId?: string | null,
  blingSupplierId?: string | number | null,
): Promise<string | undefined> {
  const fromPayload = typeof payload.descricao === "string" ? payload.descricao.trim() : "";
  if (fromPayload) return fromPayload.slice(0, 120);
  const codigo = String(payload.codigo ?? "").trim().replace(/^0+/, "");
  if (companyId && blingSupplierId != null && codigo) {
    const { data: map } = await supabaseAdmin.from("bling_supplier_map" as never)
      .select("supplier_codigo").eq("company_id", companyId).eq("bling_supplier_id", String(blingSupplierId)).maybeSingle();
    const supCod = (map as { supplier_codigo?: string | null } | null)?.supplier_codigo;
    if (supCod) {
      const { data: forns } = await supabaseAdmin.from("fornecedores").select("id").eq("codigo", supCod);
      const ids = ((forns ?? []) as { id: string }[]).map((f) => f.id);
      if (ids.length) {
        const variants = Array.from(new Set([codigo, String(payload.codigo ?? "").trim()])).filter(Boolean);
        const { data: fps } = await supabaseAdmin.from("fornecedor_produtos")
          .select("codigo,titulo,nome_nota").in("fornecedor_id", ids).in("codigo", variants).eq("ativo", true).limit(5);
        let hit = ((fps ?? []) as { titulo?: string | null; nome_nota?: string | null }[])
          .find((r) => (r.titulo ?? r.nome_nota ?? "").trim());
        if (!hit) {
          const { data: fps2 } = await supabaseAdmin.from("fornecedor_produtos")
            .select("codigo,titulo,nome_nota").in("fornecedor_id", ids).like("codigo", `%${codigo}`).eq("ativo", true).limit(20);
          hit = ((fps2 ?? []) as { codigo: string; titulo?: string | null; nome_nota?: string | null }[])
            .find((r) => r.codigo.replace(/^0+/, "") === codigo && (r.titulo ?? r.nome_nota ?? "").trim());
        }
        const t = (hit?.titulo ?? hit?.nome_nota ?? "").trim();
        if (t) return t.slice(0, 120);
      }
    }
  }
  if (!productId) return undefined;
  const { data } = await supabaseAdmin.from("bling_products").select("nome").eq("id", productId).maybeSingle();
  const nome = ((data as { nome?: string | null } | null)?.nome ?? "").trim();
  return nome ? nome.slice(0, 120) : undefined;
}

async function createProductWithSupplier(integ: BlingIntegrationRow, item: PushItem, payload: Record<string, unknown>, reuseLocalId = true) {
  const supplier = payload.fornecedor as ReturnType<typeof importSupplierPayload> | undefined;
  const { data: local } = supplier && reuseLocalId
    ? await supabaseAdmin.from("bling_products").select("bling_product_id").eq("company_id",item.company_id).eq("id",item.product_id).maybeSingle()
    : { data:null };
  // Companies with mapped custom fields get the automatic values in the creation itself.
  let customFields: { cf: string; bid: number; valor: string }[] = [];
  if (!local?.bling_product_id) {
    try {
      const { creationCustomFields } = await import("./bling-custom-fields.server");
      customFields = await creationCustomFields(item.company_id, item.product_id);
    } catch { customFields = []; }
  }
  const postBody = customFields.length
    ? { ...payload, camposCustomizados: customFields.map((v) => ({ idCampoCustomizado: v.bid, valor: v.valor })) }
    : payload;
  let res: BlingCallResult<{data?:{id?:number|string};id?:number|string}> = local?.bling_product_id
    ? { ok:true, status:200, data:{data:{id:local.bling_product_id}}, responseBodySafe:undefined, retries:0 }
    : await blingApiRequest<{data?:{id?:number|string}}>(integ,"POST","/produtos",postBody);
  if (customFields.length && !res.ok && res.status === 400 && !isDuplicateCodeError(res.responseBodySafe)) {
    // A field Bling refuses must not block the product; the automatic update can fill it later.
    customFields = [];
    res = await blingApiRequest<{data?:{id?:number|string}}>(integ,"POST","/produtos",payload);
  }
  if (res.ok && customFields.length) {
    try {
      const { saveCreatedCustomFields } = await import("./bling-custom-fields.server");
      await saveCreatedCustomFields(item.company_id, item.product_id, customFields);
    } catch { /* local snapshot is auxiliary; a later automatic run rechecks */ }
  }
  if (supplier && !res.ok && res.status === 400 && isDuplicateCodeError(res.responseBodySafe)) {
    const existingId = await findBlingIdByCodigo(integ,String(payload.codigo ?? ""));
    if (existingId) res = { ...res,ok:true,status:200,data:{data:{id:existingId}} };
  }
  if (!res.ok) return res;
  const id = res.data?.data?.id ?? res.data?.id;
  if (supplier && id != null) {
    // Save identity first: a retry after a failed read/link never creates again.
    const { error } = await supabaseAdmin.from("bling_products").update({bling_product_id:String(id)})
      .eq("company_id",item.company_id).eq("id",item.product_id);
    if (error) throw new Error(error.message);
    const { supplierFromDetail,saveSupplierLinks } = await import("./bling-suppliers.server");
    let confirmation = await supplierFromDetail(integ,String(id));
    if (!confirmation.ok) return { ...res,ok:false,status:confirmation.status,errorMessage:"Não foi possível confirmar o fornecedor no Bling; será tentado novamente." };
    if (!confirmation.row || String(confirmation.row.fornecedor.id) !== String(supplier.contato.id)) {
      const write = supplierLinkWrite(confirmation.linkId, {
        produto:{id:Number(id)},fornecedor:{id:supplier.contato.id},padrao:true,
        codigo:supplier.codigo,precoCusto:supplier.precoCusto,descricao:supplier.descricao,
      }, confirmation.purchasePrice);
      const link = await blingApiRequest(integ, write.method, write.path, write.body);
      if (!link.ok) return { ...res,ok:false,status:link.status,errorMessage:link.errorMessage ?? "Falha ao vincular fornecedor.",responseBodySafe:link.responseBodySafe };
      confirmation = await supplierFromDetail(integ,String(id));
    }
    if (!confirmation.row || String(confirmation.row.fornecedor.id) !== String(supplier.contato.id)) {
      return { ...res,ok:false,status:409,errorCode:"fornecedor_nao_confirmado",errorMessage:"O Bling não confirmou o fornecedor de destino; cadastro permanece pendente." };
    }
    await saveSupplierLinks(item.company_id,[confirmation.row],null);
    const { error: updateError } = await supabaseAdmin.from("bling_products").update({
      fornecedor_id:String(supplier.contato.id),cod_fornecedor:supplier.codigo,
      preco_custo:supplier.precoCusto,descricao_fornecedor:supplier.descricao ?? null,
    }).eq("company_id",item.company_id).eq("id",item.product_id);
    if (updateError) throw new Error(updateError.message);
  }
  await saveProductSnapshot(item.product_id,payload);
  return res;
}

export async function processItem(integ: BlingIntegrationRow, item: PushItem) {
  if (item.tipo === "excluir") {
    const res = await blingApiRequest(integ, "DELETE", `/produtos/${encodeURIComponent(item.bling_product_id)}`);
    // If Bling responds 404, the product is already gone — treat as success
    // so we still remove the local row.
    if (!res.ok && res.status === 404) {
      return { ok: true, status: 404, responseBodySafe: res.responseBodySafe, retries: res.retries } as typeof res;
    }
    return res;
  }
  if (item.tipo === "inativar") {
    const res = await blingApiRequest(integ, "PATCH", `/produtos/${encodeURIComponent(item.bling_product_id)}`, {
      situacao: "I",
    });
    return res;
  }
  if (item.tipo === "preco") {
    const res = await blingApiRequest(integ, "PATCH", `/produtos/${encodeURIComponent(item.bling_product_id)}`, {
      preco: Number(item.valor_novo),
    });
    return res;
  }
  if (item.tipo === "produto" || item.tipo === "criar") {
    const payload = await buildFullProductPayload(item.product_id);
    if (!payload || Object.keys(payload).length === 0) {
      return { ok: false, status: 0, errorCode: "sem_dados", errorMessage: "Produto sem dados para enviar.", responseBodySafe: undefined, retries: 0 } as const;
    }
    if (item.tipo === "criar") {
      return createProductWithSupplier(integ,item,payload);
    }
    // Envia somente os campos que mudaram desde o último envio.
    const { data: prod } = await supabaseAdmin
      .from("bling_products")
      .select("bling_last_sent_payload" as never)
      .eq("id", item.product_id)
      .maybeSingle();
    const lastSent = (prod as { bling_last_sent_payload?: Record<string, unknown> | null } | null)
      ?.bling_last_sent_payload ?? null;
    const changed = diffProductPayload(payload, lastSent);
    if (Object.keys(changed).length === 0) {
      // Nada mudou: conclui sem chamar o Bling.
      return { ok: true, status: 0, responseBodySafe: undefined, retries: 0 } as const;
    }
    const res = await blingApiRequest(
      integ, "PATCH", `/produtos/${encodeURIComponent(item.bling_product_id)}`, changed,
    );
    if (res.ok) await saveProductSnapshot(item.product_id, payload);
    return res;
  }


  if (item.tipo === "preco_loja") {
    if (!item.bling_product_store_id) {
      return { ok: false, status: 0, errorCode: "sem_loja", errorMessage: "Item de multilojas sem bling_product_store_id.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const storeId = toNum(item.payload?.bling_store_id);
    const promoLoja = toNum((item.payload as Record<string, unknown> | undefined)?.preco_promocional);
    let actualLinkId = item.bling_product_store_id;
    if (storeId !== undefined) {
      const existing = await findProductStoreLink(integ, item.bling_product_id, storeId);
      if (existing?.id) actualLinkId = existing.id;
    }
    const body: Record<string, unknown> = {
      // ID interno do vínculo exigido pelo Bling. Não é o campo "ID na loja"
      // (codigo), que permanece intocado.
      idProdutoLoja: Number(actualLinkId),
      preco: Number(item.valor_novo),
      produto: { id: Number(item.bling_product_id) },
    };
    if (promoLoja !== undefined && promoLoja > 0 && promoLoja < Number(item.valor_novo)) body.precoPromocional = promoLoja;
    if (storeId !== undefined) body.loja = { id: storeId };
    const res = await blingApiRequest(
      integ,
      "PUT",
      `/produtos/lojas/${encodeURIComponent(actualLinkId)}`,
      body,
    );
    if (res.ok && actualLinkId !== item.bling_product_store_id) {
      await supabaseAdmin
        .from("bling_product_stores")
        .update({ bling_product_store_id: actualLinkId })
        .eq("company_id", item.company_id)
        .eq("internal_product_id", item.product_id)
        .eq("bling_product_store_id", item.bling_product_store_id);
    }
    return res;
  }

  if (item.tipo === "estoque_loja") {
    // Bling replica automaticamente o estoque do produto pai para as lojas.
    // Este item existe apenas para dar visibilidade — considera concluído.
    return { ok: true, status: 200, responseBodySafe: undefined, retries: 0 } as const;
  }

  if (item.tipo === "fornecedor_custo") {
    const p = (item.payload ?? {}) as Record<string, unknown>;
    const linkId = toStr(p.bling_link_id);
    const fornId = toNum(p.bling_supplier_id);
    const custo = toNum(p.preco_custo);
    if (!linkId || fornId === undefined || custo === undefined || custo <= 0) {
      return { ok: false, status: 0, errorCode: "sem_dados", errorMessage: "Vínculo ou preço de custo ausente.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const body: Record<string, unknown> = {
      produto: { id: Number(item.bling_product_id) },
      fornecedor: { id: fornId },
      padrao: true,
      precoCusto: custo,
    };
    const codigo = toStr(p.codigo); if (codigo) body.codigo = codigo;
    const descricao = await supplierDescricao(item.product_id, p); if (descricao) body.descricao = descricao;
    const res = await blingApiRequest(integ, "PUT", `/produtos/fornecedores/${encodeURIComponent(linkId)}`, body);
    if (res.ok) {
      await supabaseAdmin.from("bling_product_suppliers" as never)
        .update({ preco_custo: custo, updated_at: new Date().toISOString() } as never)
        .eq("company_id", item.company_id).eq("bling_link_id", linkId);
    }
    return res;
  }

  if (item.tipo === "fornecedor_vinculo") {
    const p = (item.payload ?? {}) as Record<string, unknown>;
    const fornId = toNum(p.bling_supplier_id);
    if (fornId === undefined) {
      return { ok: false, status: 0, errorCode: "sem_dados", errorMessage: "Vínculo sem fornecedor.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const body: Record<string, unknown> = {
      produto: { id: Number(item.bling_product_id) },
      fornecedor: { id: fornId },
      padrao: true,
    };
    const codigo = toStr(p.codigo); if (codigo) body.codigo = codigo;
    const custo = toNum(p.preco_custo); if (custo !== undefined && custo > 0) body.precoCusto = custo;
    const descricao = await supplierDescricao(item.product_id, p); if (descricao) body.descricao = descricao;
    const { supplierFromDetail, saveSupplierLinks } = await import("./bling-suppliers.server");
    const before = await supplierFromDetail(integ, item.bling_product_id);
    if (!before.ok) {
      return { ok: false, status: before.status, errorCode: "fornecedor_leitura", errorMessage: "Não foi possível consultar o vínculo do fornecedor; será tentado novamente.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const write = supplierLinkWrite(before.linkId, body, before.purchasePrice);
    let res = await blingApiRequest(integ, write.method, write.path, write.body);
    const duplicated = !res.ok && res.status === 400 && /duplicad/i.test(String(res.responseBodySafe ?? ""));
    if (res.ok || duplicated) {
      // Só marca como vinculado depois de reler o fornecedor na ficha do produto.
      const d = await supplierFromDetail(integ, item.bling_product_id);
      if (!d.ok || !d.row || String(d.row.fornecedor.id) !== String(fornId)) {
        return { ok: false, status: 409, errorCode: "fornecedor_nao_confirmado", errorMessage: "O Bling não confirmou o vínculo do fornecedor.", responseBodySafe: undefined, retries: res.retries } as const;
      }
      await saveSupplierLinks(item.company_id, [d.row], null);
      // "Registro duplicado": o produto já tinha fornecedor no Bling; agora está registrado aqui.
      if (duplicated) res = { ...res, ok: true, status: 200 } as typeof res;
    }
    return res;
  }

  if (item.tipo === "codigo_loja") {
    // Desativado: alterar o "ID na loja" (campo codigo do produto Loja) é proibido.
    return { ok: false, status: 0, errorCode: "desativado", errorMessage: "Alteração do ID na loja está desativada.", responseBodySafe: undefined, retries: 0 } as const;
  }

  // Caminhos permitidos para alterar o "ID na loja": planilha confirmada ou
  // transformação explícita de marketplace, ambos com prévia e confirmação.
  if (item.tipo === "codigo_loja_planilha") {
    if (!item.bling_product_store_id) {
      return { ok: false, status: 0, errorCode: "sem_loja", errorMessage: "Vínculo sem ID no Bling.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const p = (item.payload ?? {}) as Record<string, unknown>;
    const blingStoreId = toNum(p.bling_store_id);
    const preco = toNum(p.preco);
    const codigo = toStr(p.codigo);
    const promo = toNum(p.preco_promocional);
    if (blingStoreId === undefined || preco === undefined || !codigo) {
      return { ok: false, status: 0, errorCode: "sem_dados", errorMessage: "Linha sem loja, preço ou novo ID na loja.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const body: Record<string, unknown> = {
      // O ID interno do vínculo pertence somente à URL. O valor editável
      // "ID na loja" é exclusivamente o campo `codigo` vindo da planilha.
      codigo,
      preco,
      produto: { id: Number(item.bling_product_id) },
      loja: { id: blingStoreId },
    };
    if (promo !== undefined && promo > 0 && promo < preco) body.precoPromocional = promo;
    let targetLinkId = item.bling_product_store_id;
    let res = await blingApiRequest(
      integ,
      "PUT",
      `/produtos/lojas/${encodeURIComponent(targetLinkId)}`,
      body,
    );
    if (!res.ok && (res.status === 400 || res.status === 409) && isAlreadyLinkedError(res.responseBodySafe)) {
      const existing = await findProductStoreLink(integ, item.bling_product_id, blingStoreId);
      if (existing?.id && String(existing.id) !== String(item.bling_product_store_id)) {
        targetLinkId = existing.id;
        res = await blingApiRequest(
          integ,
          "PUT",
          `/produtos/lojas/${encodeURIComponent(targetLinkId)}`,
          body,
        );
      } else if (existing?.id && String(existing.codigo ?? "") === codigo) {
        targetLinkId = existing.id;
        res = { ok: true, status: 200, responseBodySafe: undefined, retries: 0 } as typeof res;
      }
    }
    if (res.ok) {
      // Não confiar apenas no HTTP 200: o Bling pode aceitar o vínculo sem
      // persistir o código esperado. Só concluímos após reler o campo correto.
      let confirmed: Awaited<ReturnType<typeof findProductStoreLink>> = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        confirmed = await findProductStoreLink(integ, item.bling_product_id, blingStoreId);
        if (confirmed && String(confirmed.codigo ?? "").trim() === codigo.trim()) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!confirmed || String(confirmed.codigo ?? "").trim() !== codigo.trim()) {
        return {
          ok: false,
          status: 409,
          errorCode: "codigo_loja_divergente",
          errorMessage: `O Bling não confirmou o ID na loja esperado (${codigo}).`,
          responseBodySafe: confirmed
            ? `ID na loja retornado pelo Bling: ${String(confirmed.codigo ?? "vazio")}`
            : "O vínculo não foi localizado após a atualização.",
          retries: res.retries,
        } as const;
      }
      targetLinkId = confirmed.id;
      const { error: localError } = await supabaseAdmin
        .from("bling_product_stores")
        .update({
          bling_product_store_id: targetLinkId,
          store_product_code: codigo,
          last_imported_at: new Date().toISOString(),
        })
        .eq("company_id", item.company_id)
        .eq("internal_product_id", item.product_id)
        .eq("bling_store_id", String(blingStoreId));
      if (localError) throw new Error(localError.message);
    }
    return res;
  }

  if (item.tipo === "vincular_loja") {
    const p = (item.payload ?? {}) as Record<string, unknown>;
    const blingStoreId = toNum(p.bling_store_id);
    const preco = toNum(p.preco);
    const promo = toNum(p.preco_promocional);
    if (blingStoreId === undefined || preco === undefined) {
      return { ok: false, status: 0, errorCode: "sem_dados", errorMessage: "vincular_loja sem loja/preço.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const body: Record<string, unknown> = {
      // NUNCA enviamos "codigo" (ID na loja): o Bling define/preserva esse valor.
      preco,
      produto: { id: Number(item.bling_product_id) },
      loja: { id: blingStoreId },
    };
    if (promo !== undefined && promo > 0 && promo < preco) body.precoPromocional = promo;


    let res = await blingApiRequest<{ data?: { id?: number | string } } | { id?: number | string }>(
      integ, "POST", `/produtos/lojas`, body,
    );
    let linkedId: string | null = null;
    if (!res.ok && (res.status === 400 || res.status === 409) && isAlreadyLinkedError(res.responseBodySafe)) {
      const existing = await findProductStoreLink(integ, item.bling_product_id, blingStoreId);
      if (existing?.id) {
        linkedId = existing.id;
        // Vínculo já existe: atualiza somente preço, nunca o "ID na loja".
        res = await blingApiRequest(
          integ,
          "PUT",
          `/produtos/lojas/${encodeURIComponent(existing.id)}`,
          { ...body, idProdutoLoja: Number(existing.id) },
        );
      }
    }
    if (res.ok) {
      const anyData = (res as { data?: unknown }).data as any;
      const newId = anyData?.data?.id ?? anyData?.id ?? linkedId;
      if (newId != null) {
        await supabaseAdmin.from("bling_product_stores").upsert({
          company_id: item.company_id,
          integration_id: item.integration_id,
          internal_product_id: item.product_id,
          bling_product_id: item.bling_product_id,
          bling_store_id: String(blingStoreId),
          bling_product_store_id: String(newId),
          current_price: preco,
          current_promotional_price: promo ?? null,
          is_linked: true,
          last_imported_at: new Date().toISOString(),
        } as any, { onConflict: "company_id,internal_product_id,bling_store_id" });
      }
    }
    return res;
  }

  if (item.tipo === "desvincular_loja") {
    if (!item.bling_product_store_id) {
      return { ok: false, status: 0, errorCode: "sem_loja", errorMessage: "desvincular_loja sem bling_product_store_id.", responseBodySafe: undefined, retries: 0 } as const;
    }
    const res = await blingApiRequest(
      integ, "DELETE",
      `/produtos/lojas/${encodeURIComponent(item.bling_product_store_id)}`,
    );
    if (res.ok || res.status === 404) {
      await supabaseAdmin
        .from("bling_product_stores")
        .update({ is_linked: false })
        .eq("company_id", item.company_id)
        .eq("bling_product_store_id", item.bling_product_store_id);
      if (res.status === 404) {
        return { ok: true, status: 404, responseBodySafe: res.responseBodySafe, retries: res.retries } as typeof res;
      }
    }
    return res;
  }

  if (item.tipo === "estoque") {
    const perDeposit = await pushDepositStocks(integ, item);
    if (perDeposit) return perDeposit;
  }

  if (!item.bling_deposit_id) {
    return { ok: false, status: 0, errorCode: "sem_deposito", errorMessage: "Produto sem depósito configurado.", responseBodySafe: undefined, retries: 0 } as const;
  }
  const res = await blingApiRequest(integ, "POST", `/estoques`, {
    operacao: "B",
    quantidade: Number(item.valor_novo),
    produto: { id: Number(item.bling_product_id) },
    deposito: { id: Number(item.bling_deposit_id) },
    observacoes: "Sincronização automática pelo Meu Bling Correto",
  });
  return res;
}

/**
 * Empresas com depósitos configurados: envia um balanço por depósito pendente,
 * com o valor calculado pela regra daquele depósito. Retorna null quando a
 * empresa ainda não buscou seus depósitos (mantém o envio único de antes).
 */
async function pushDepositStocks(integ: BlingIntegrationRow, item: PushItem): Promise<BlingCallResult<unknown> | null> {
  const { data: deposits } = await supabaseAdmin
    .from("bling_stock_deposits")
    .select("bling_deposit_id, descricao")
    .eq("company_id", item.company_id)
    .eq("ativo", true);
  if (!deposits || deposits.length === 0) return null;
  const names = new Map((deposits as { bling_deposit_id: string; descricao: string | null }[])
    .map((d) => [d.bling_deposit_id, d.descricao]));
  const { data: rows, error } = await supabaseAdmin
    .from("bling_product_deposit_stock")
    .select("bling_deposit_id, estoque_alvo, ultimo_estoque_sincronizado")
    .eq("product_id", item.product_id)
    .eq("pendente", true);
  if (error) throw new Error(error.message);
  const pending = ((rows ?? []) as { bling_deposit_id: string; estoque_alvo: number; ultimo_estoque_sincronizado: number | null }[])
    .filter((r) => names.has(r.bling_deposit_id));
  let last: BlingCallResult<unknown> | null = null;
  for (const row of pending) {
    const valor = Number(row.estoque_alvo);
    const startedAt = Date.now();
    const res = await blingApiRequest(integ, "POST", `/estoques`, {
      operacao: "B",
      quantidade: valor,
      produto: { id: Number(item.bling_product_id) },
      deposito: { id: Number(row.bling_deposit_id) },
      observacoes: "Sincronização automática pelo Meu Bling Correto",
    });
    // Uma requisição real por depósito: conta no progresso e aparece nos Logs com o nome do estoque.
    await supabaseAdmin.rpc("log_bling_push_deposit" as never, {
      _item_id: item.id,
      _deposit_id: row.bling_deposit_id,
      _descricao: names.get(row.bling_deposit_id) ?? null,
      _anterior: row.ultimo_estoque_sincronizado,
      _valor: valor,
      _ok: res.ok,
      _status: res.status || null,
      _ms: Date.now() - startedAt,
    } as never);
    if (!res.ok) return res;
    await supabaseAdmin.rpc("finish_deposit_stock_sent" as never, {
      _product_id: item.product_id, _deposit_id: row.bling_deposit_id, _valor: valor,
    } as never);
    last = res;
  }
  // Nenhum depósito com diferença: conclui sem chamar o Bling.
  return last ?? { ok: true, status: 200, retries: 0 };
}



function retryDelayFor(status: number, attempts: number): number | null {
  if (status === 429 || status >= 500 || status === 0) {
    // exponential backoff with jitter, in seconds
    const base = Math.min(60, 5 * Math.pow(2, Math.max(0, attempts - 1)));
    return base + Math.floor(Math.random() * 3);
  }
  return null; // final
}

// One worker per integration is enforced by the lease key itself.
// This is the *global* ceiling of integrations pushing at the same time.
// Configurable so it can grow with the Cloud instance size.
const MAX_CONCURRENT_PUSH_WORKERS = Math.max(
  1,
  Number(process.env["BLING_MAX_CONCURRENT_PUSH_WORKERS"] ?? 100) || 100,
);
const LEASE_TTL_SECONDS = 120;

/**
 * Concurrency guard: at most MAX_CONCURRENT_PUSH_WORKERS integrations are
 * pushed at the same time, and only one worker per integration. Prevents the
 * statement timeouts seen when several companies sync simultaneously.
 */
export async function processPushBatch(integrationId: string | null, limit = 5): Promise<{ processed: number; ok: number; failed: number; remaining: number; integration_id: string | null }> {
  // release work abandoned by a crashed/timed-out worker
  // throttled globally (at most once per minute) so 100 concurrent workers
  // don't each run a sweep over the queue
  try {
    await supabaseAdmin.rpc("reclaim_stuck_workers_throttled", { _minutes: 10, _every_seconds: 60 } as never);
  } catch { /* best-effort */ }

  const leaseKey = `push:${integrationId ?? "any"}`;
  const holder = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: acquired } = await supabaseAdmin.rpc("acquire_worker_lease", {
    _pool: "bling_push",
    _key: leaseKey,
    _holder: holder,
    _ttl_seconds: LEASE_TTL_SECONDS,
    _max_concurrent: MAX_CONCURRENT_PUSH_WORKERS,
  } as never);
  if (!acquired) {
    let q = supabaseAdmin
      .from("bling_push_queue")
      .select("id", { count: "planned", head: true })
      .eq("status", "pendente");
    if (integrationId) q = q.eq("integration_id", integrationId);
    const { count } = await q;
    return { processed: 0, ok: 0, failed: 0, remaining: count ?? 0, integration_id: integrationId };
  }
  try {
    return await processPushBatchInner(integrationId, limit);
  } finally {
    try {
      await supabaseAdmin.rpc("release_worker_lease", { _key: leaseKey, _holder: holder } as never);
    } catch { /* best-effort */ }
  }
}

/**
 * Executa VÁRIOS lotes sob uma ÚNICA reserva de worker.
 *
 * Antes, cada lote de 10 itens chamava reclaim + acquire_worker_lease +
 * release, e o acquire usa um lock global por pool — isso serializava todos
 * os workers e sozinho respondia pela maior parte da CPU do banco
 * (milhões de chamadas). Agora essas chamadas acontecem uma vez por ciclo.
 */
export async function processPushTick(
  integrationId: string | null,
  deadline: number,
  batchSize = 25,
): Promise<{ processed: number; ok: number; failed: number; remaining: number; integration_id: string | null }> {
  try {
    await supabaseAdmin.rpc("reclaim_stuck_workers_throttled", { _minutes: 10, _every_seconds: 60 } as never);
  } catch { /* best-effort */ }

  const leaseKey = `push:${integrationId ?? "any"}`;
  const holder = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: acquired } = await supabaseAdmin.rpc("acquire_worker_lease", {
    _pool: "bling_push",
    _key: leaseKey,
    _holder: holder,
    _ttl_seconds: LEASE_TTL_SECONDS,
    _max_concurrent: MAX_CONCURRENT_PUSH_WORKERS,
  } as never);
  if (!acquired) {
    return { processed: 0, ok: 0, failed: 0, remaining: 1, integration_id: integrationId };
  }

  let processed = 0, ok = 0, failed = 0;
  let current = integrationId;
  let remaining = 0;
  try {
    for (;;) {
      const r = await processPushBatchInner(current, batchSize);
      processed += r.processed; ok += r.ok; failed += r.failed;
      remaining = r.remaining;
      current = current ?? r.integration_id;
      if (r.processed === 0 || r.remaining <= 0) break;
      if (Date.now() >= deadline) break;
    }
  } finally {
    try {
      await supabaseAdmin.rpc("release_worker_lease", { _key: leaseKey, _holder: holder } as never);
    } catch { /* best-effort */ }
  }
  return { processed, ok, failed, remaining, integration_id: current };
}


async function processPushBatchInner(integrationId: string | null, limit = 5): Promise<{ processed: number; ok: number; failed: number; remaining: number; integration_id: string | null }> {

  const { data: claimed, error } = await supabaseAdmin.rpc("claim_next_push_batch", {
    _integration_id: integrationId ?? undefined,
    _limit: limit,
  });
  if (error) throw new Error(error.message);
  const items = (claimed ?? []) as PushItem[];
  if (items.length === 0) {
    const { count: rem } = await supabaseAdmin
      .from("bling_push_queue")
      .select("id", { count: "planned", head: true })
      .eq("status", "pendente");
    return { processed: 0, ok: 0, failed: 0, remaining: rem ?? 0, integration_id: integrationId };
  }
  const integ = await loadIntegration(items[0].integration_id);
  if (!integ || integ.status !== "conectada") {
    for (const it of items) {
      await supabaseAdmin.rpc("finish_bling_push_error", {
        _item_id: it.id, _erro: "Integração não está conectada.", _status_code: undefined,
        _body_safe: undefined, _retry_in_seconds: undefined, _max_attempts: MAX_ATTEMPTS,
      });
    }
    return { processed: items.length, ok: 0, failed: items.length, remaining: 0, integration_id: items[0].integration_id };
  }
  let ok = 0, failed = 0;
  // Processa em paralelo respeitando o limite do Bling (3 req/s por integração).
  const CONCURRENCY = 3;
  let cursor = 0;
  const runItem = async (it: PushItem) => {
    try {
      let res = await processItem(integ, it);
      let createdFallback = false;

      // Fallback: if the product no longer exists on Bling (404 on
      // update/patch/estoque), create it instead so the sync self-heals.
      if (
        !res.ok &&
        res.status === 404 &&
        it.tipo !== "criar" &&
        it.tipo !== "excluir" &&
        it.tipo !== "preco_loja" &&
        it.tipo !== "estoque_loja" &&
        it.tipo !== "vincular_loja" &&
        it.tipo !== "desvincular_loja" &&
        it.tipo !== "codigo_loja" &&
        it.tipo !== "codigo_loja_planilha" &&
        it.tipo !== "fornecedor_vinculo" &&
        it.tipo !== "fornecedor_custo"
      ) {
        const payload = await buildFullProductPayload(it.product_id);
        if (payload && Object.keys(payload).length > 0) {
          res = await createProductWithSupplier(integ,it,payload,false);
          createdFallback = res.ok;
        }
      }

      if (res.ok) {
        if (it.tipo === "criar" || createdFallback) {
          const anyData = (res as { data?: unknown }).data as any;
          const newId = anyData?.data?.id ?? anyData?.id ?? null;
          if (newId != null) {
            await supabaseAdmin.rpc("finish_bling_push_created", {
              _item_id: it.id, _bling_id: String(newId),
            });
          } else {
            await supabaseAdmin.rpc("finish_bling_push_error", {
              _item_id: it.id,
              _erro: "Bling não retornou o ID do produto criado.",
              _status_code: res.status || undefined,
              _body_safe: res.responseBodySafe ?? undefined,
              _retry_in_seconds: undefined,
              _max_attempts: MAX_ATTEMPTS,
            });
            failed++;
            return;
          }
        } else {
          if (it.tipo === "codigo_loja" && it.bling_product_store_id) {
            const codigo = toStr(it.payload?.codigo);
            if (!codigo) throw new Error("Código da multiloja ausente após o envio.");
            const { error: storeUpdateError } = await supabaseAdmin
              .from("bling_product_stores")
              .update({ store_product_code: codigo, last_imported_at: new Date().toISOString() })
              .eq("company_id", it.company_id)
              .eq("bling_product_store_id", it.bling_product_store_id);
            if (storeUpdateError) throw new Error(storeUpdateError.message);
          }
          await supabaseAdmin.rpc("finish_bling_push_success", { _item_id: it.id });
        }
        ok++;
      } else if (
        (it.tipo === "criar" || createdFallback === false) &&
        res.status === 400 &&
        isDuplicateCodeError(res.responseBodySafe)
      ) {
        // O código já existe no Bling — recupera o ID real e salva localmente.
        const codigo = await getProductCodigo(it.product_id);
        const existingId = codigo ? await findBlingIdByCodigo(integ, codigo) : null;
        if (existingId) {
          await supabaseAdmin.rpc("finish_bling_push_created", {
            _item_id: it.id, _bling_id: existingId,
          });
          ok++;
        } else {
          await supabaseAdmin.rpc("finish_bling_push_error", {
            _item_id: it.id,
            _erro: `Código já cadastrado no Bling, mas o ID não foi localizado (código ${codigo ?? "?"}).`,
            _status_code: res.status || undefined,
            _body_safe: res.responseBodySafe ?? undefined,
            _retry_in_seconds: undefined,
            _max_attempts: MAX_ATTEMPTS,
          });
          failed++;
        }
      } else {
        const retry = res.errorCode === "fornecedor_nao_confirmado" ? 10 : retryDelayFor(res.status, it.tentativas);
        await supabaseAdmin.rpc("finish_bling_push_error", {
          _item_id: it.id,
          _erro: res.errorMessage ?? `HTTP ${res.status}`,
          _status_code: res.status || undefined,
          _body_safe: res.responseBodySafe ?? undefined,
          _retry_in_seconds: retry ?? undefined,

          _max_attempts: MAX_ATTEMPTS,
        });
        failed++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro_inesperado";
      await supabaseAdmin.rpc("finish_bling_push_error", {
        _item_id: it.id, _erro: msg, _status_code: undefined, _body_safe: undefined,
        _retry_in_seconds: 10, _max_attempts: MAX_ATTEMPTS,
      });
      failed++;
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const it = items[cursor++];
      if (it) await runItem(it);
    }
  });
  await Promise.all(workers);
  const { count } = await supabaseAdmin
    .from("bling_push_queue")
    .select("id", { count: "planned", head: true })
    .eq("integration_id", integ.id)
    .eq("status", "pendente");
  return { processed: items.length, ok, failed, remaining: count ?? 0, integration_id: integ.id };
}
