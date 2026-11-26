import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blingApiGet, blingApiRequest, type BlingIntegrationRow } from "@/lib/bling.server";

const db = supabaseAdmin as any;
const KINDS = {
  mercadolivre: { prefix: "ML", name: "Mercado Livre", named: /^mercado\s*livre$/i },
  amazon: { prefix: "AMZ", name: "Amazon", named: /^amazon(\.com\.br)?$/i },
} as const;
export type ProspectSupplierKind = keyof typeof KINDS;

/**
 * Garantees the company has the Bling supplier contact used by the ML prefix: reuses an active contact
 * coded ML or named Mercado Livre and only creates "Mercado Livre" (Código ML) when none exists.
 */
export async function ensureMlSupplier(companyId: string, options: { create: boolean } = { create: true }) {
  return ensureProspectSupplier(companyId, options, "mercadolivre");
}

/** Same as ensureMlSupplier for the Amazon garimpo: contact "Amazon" with Código AMZ. */
export async function ensureProspectSupplier(companyId: string, options: { create: boolean }, kind: ProspectSupplierKind) {
  const { prefix: PREFIX, name: NAME, named: NAMED } = KINDS[kind];
  const [{ data: prefix }, { data: mapped }] = await Promise.all([
    db.from("bling_supplier_prefix_contacts").select("bling_supplier_id").eq("company_id", companyId).eq("codigo", PREFIX).limit(1).maybeSingle(),
    db.from("bling_supplier_map").select("bling_supplier_id").eq("company_id", companyId).eq("supplier_codigo", kind).limit(1).maybeSingle(),
  ]);
  if (prefix?.bling_supplier_id || mapped?.bling_supplier_id) return { status: "existente" as const };

  const { data: integration } = await db.from("bling_integrations")
    .select("id, company_id, access_token, refresh_token, token_expires_at, status")
    .eq("company_id", companyId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!integration) throw new Error(`Empresa sem conexão com o Bling para cadastrar o fornecedor ${NAME}.`);
  const integ = integration as BlingIntegrationRow;

  const tipos = await blingApiGet<any>(integ, "/contatos/tipos");
  const tipo = ((tipos.data?.data ?? []) as any[]).find(t => /fornec/i.test(String(t?.descricao ?? "")));
  if (!tipos.ok || !tipo?.id) throw new Error("Não foi possível ler os tipos de contato do Bling.");

  const search = await blingApiGet<any>(integ, `/contatos?pesquisa=${encodeURIComponent(NAME)}&idTipoContato=${tipo.id}&limite=100`);
  if (!search.ok) throw new Error(`Não foi possível procurar o fornecedor ${NAME} no Bling.`);
  const contacts = ((search.data?.data ?? []) as any[]).filter(c => c?.id && String(c?.situacao ?? "A") === "A");
  const coded = contacts.find(c => String(c?.codigo ?? "").trim().toUpperCase() === PREFIX);
  const named = contacts.find(c => NAMED.test(String(c?.nome ?? "").trim()));
  const now = new Date().toISOString();
  if (coded) {
    await db.from("bling_supplier_prefix_contacts").upsert({ company_id: companyId, codigo: PREFIX, bling_supplier_id: String(coded.id), nome: coded.nome ?? NAME, updated_at: now }, { onConflict: "company_id,codigo" });
    return { status: "encontrado" as const };
  }
  if (named) {
    await db.from("bling_supplier_map").upsert({ company_id: companyId, bling_supplier_id: String(named.id), nome: named.nome ?? NAME, supplier_codigo: kind, updated_at: now }, { onConflict: "company_id,bling_supplier_id" });
    return { status: "encontrado" as const };
  }
  if (!options.create) return { status: "ausente" as const };

  const created = await blingApiRequest<any>(integ, "POST", "/contatos", {
    nome: NAME, codigo: PREFIX, situacao: "A", tipo: "J", indicadorIe: 9, tiposContato: [{ id: tipo.id }],
  });
  const id = created.data?.data?.id;
  if (!created.ok || !id) throw new Error(`O Bling recusou o cadastro do fornecedor ${NAME}: ${created.errorMessage ?? created.status}.`);
  await db.from("bling_supplier_prefix_contacts").upsert({ company_id: companyId, codigo: PREFIX, bling_supplier_id: String(id), nome: NAME, updated_at: now }, { onConflict: "company_id,codigo" });
  return { status: "criado" as const };
}
