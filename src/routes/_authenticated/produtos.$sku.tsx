import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { listMyCompanies } from "@/lib/companies.functions";
import { useSelectedCompany } from "@/hooks/use-selected-company";
import { getProductBySku, updateProduct } from "@/lib/products-tools.functions";
import { getProductAuditResults } from "@/lib/audit.functions";
import { AlternativeSuppliersCard } from "@/components/alternative-suppliers-card";
import { useAccess } from "@/hooks/use-access";

export const Route = createFileRoute("/_authenticated/produtos/$sku")({
  head: () => ({ meta: [{"title": "Detalhes do produto | Ajusta-Ê"}, {"name": "description", "content": "Consulte os atributos, fornecedores e resultados de auditoria do produto."}, {"property": "og:title", "content": "Detalhes do produto | Ajusta-Ê"}, {"property": "og:description", "content": "Consulte os atributos, fornecedores e resultados de auditoria do produto."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }), component: EditProduct });

const NUMERIC_FIELDS = new Set([
  "preco","preco_custo","preco_compra","estoque","estoque_minimo","estoque_maximo",
  "peso_liquido","peso_bruto","largura","altura","profundidade","volumes","itens_caixa",
  "valor_ipi_fixo","icms_st_base","icms_st_retencao","icms_proprio_substituto",
]);

const SECTIONS: { title: string; fields: { key: string; label: string; textarea?: boolean }[] }[] = [
  {
    title: "Identificação",
    fields: [
      { key: "codigo", label: "SKU (Código)" },
      { key: "nome", label: "Nome / Descrição" },
      { key: "marca", label: "Marca" },
      { key: "categoria_produto", label: "Categoria" },
      { key: "gtin", label: "GTIN/EAN" },
      { key: "gtin_embalagem", label: "GTIN Embalagem" },
      { key: "situacao", label: "Situação (A/I)" },
      { key: "tipo_item", label: "Tipo do item" },
      { key: "tipo_producao", label: "Tipo Produção" },
      { key: "produto_variacao", label: "Produto Variação" },
      { key: "codigo_pai", label: "Código Pai" },
      { key: "codigo_integracao", label: "Código Integração" },
      { key: "grupo_produtos", label: "Grupo de produtos" },
      { key: "grupo_tags", label: "Grupo de Tags/Tags" },
      { key: "departamento", label: "Departamento" },
    ],
  },
  {
    title: "Descrições",
    fields: [
      { key: "descricao_curta", label: "Descrição curta", textarea: true },
      { key: "descricao_complementar", label: "Descrição complementar", textarea: true },
      { key: "observacoes", label: "Observações", textarea: true },
      { key: "informacoes_adicionais", label: "Informações adicionais", textarea: true },
      { key: "descricao_fornecedor", label: "Descrição do produto no fornecedor", textarea: true },
    ],
  },
  {
    title: "Preços & Estoque",
    fields: [
      { key: "preco", label: "Preço" },
      { key: "preco_custo", label: "Preço de custo" },
      { key: "preco_compra", label: "Preço de compra" },
      { key: "estoque", label: "Estoque" },
      { key: "estoque_minimo", label: "Estoque mínimo" },
      { key: "estoque_maximo", label: "Estoque máximo" },
    ],
  },
  {
    title: "Dimensões & Peso",
    fields: [
      { key: "peso_liquido", label: "Peso líquido (Kg)" },
      { key: "peso_bruto", label: "Peso bruto (Kg)" },
      { key: "largura", label: "Largura (cm)" },
      { key: "altura", label: "Altura (cm)" },
      { key: "profundidade", label: "Profundidade (cm)" },
      { key: "volumes", label: "Volumes" },
      { key: "itens_caixa", label: "Itens por caixa" },
      { key: "unidade", label: "Unidade" },
      { key: "unidade_medida", label: "Unidade de medida" },
    ],
  },
  {
    title: "Fornecedor & Fiscal",
    fields: [
      { key: "fornecedor", label: "Fornecedor" },
      { key: "cod_fornecedor", label: "Código no fornecedor" },
      { key: "ncm", label: "NCM" },
      { key: "origem_fiscal", label: "Origem fiscal" },
      { key: "localizacao", label: "Localização" },
      { key: "cest", label: "CEST" },
      { key: "classe_ipi", label: "Classe de enquadramento do IPI" },
      { key: "codigo_lista_servicos", label: "Código na Lista de Serviços" },
      { key: "tributos", label: "Tributos" },
      { key: "numero_fci", label: "Número FCI" },
      { key: "valor_ipi_fixo", label: "Valor IPI fixo" },
      { key: "icms_st_base", label: "Valor base ICMS ST para retenção" },
      { key: "icms_st_retencao", label: "Valor ICMS ST para retenção" },
      { key: "icms_proprio_substituto", label: "Valor ICMS próprio do substituto" },
    ],
  },
  {
    title: "Atributos Comerciais",
    fields: [
      { key: "condicao_produto", label: "Condição do produto" },
      { key: "frete_gratis", label: "Frete grátis" },
      { key: "cross_docking", label: "Cross-Docking" },
      { key: "clonar_dados_pai", label: "Clonar dados do pai" },
      { key: "meses_garantia_fornecedor", label: "Meses de garantia no fornecedor" },
      { key: "data_validade", label: "Data de validade (AAAA-MM-DD)" },
    ],
  },
  {
    title: "Imagens & Links",
    fields: [
      { key: "url_imagens_externas", label: "URLs de imagens externas (separadas por vírgula)", textarea: true },
      { key: "link_externo", label: "Link externo" },
      { key: "video", label: "Vídeo" },
    ],
  },
];

function EditProduct() {
  const { sku } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listMyCompanies);
  const fnGet = useServerFn(getProductBySku);
  const { access } = useAccess();
  const readOnly = access.company_restricted;
  const fnUpdate = useServerFn(updateProduct);
  const fnAudit = useServerFn(getProductAuditResults);

  const companies = useQuery({ queryKey: ["companies"], queryFn: () => fetchCompanies() });
  const [companyId, setCompanyId] = useSelectedCompany();
  useEffect(() => { if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id); }, [companies.data, companyId]);

  const product = useQuery({
    queryKey: ["product", companyId, sku],
    queryFn: () => fnGet({ data: { company_id: companyId!, sku } }),
    enabled: !!companyId,
  });

  const auditResults = useQuery({
    queryKey: ["product-audit", product.data?.id],
    queryFn: () => fnAudit({ data: { product_id: product.data!.id } }),
    enabled: !!product.data?.id,
  });

  const [form, setForm] = useState<Record<string, any>>({});
  useEffect(() => { if (product.data) setForm(product.data); }, [product.data]);

  async function handleSave() {
    if (readOnly || !product.data || !companyId) return;
    const patch: Record<string, any> = {};
    for (const s of SECTIONS) for (const f of s.fields) {
      let v = form[f.key];
      if (v === "" || v === undefined) v = null;
      if (v != null && NUMERIC_FIELDS.has(f.key)) {
        const n = Number(String(v).replace(",", "."));
        v = Number.isFinite(n) ? n : null;
      }
      patch[f.key] = v;
    }
    try {
      await fnUpdate({ data: { product_id: product.data.id, company_id: companyId, patch } });
      toast.success("Produto salvo (localmente, sem sincronizar com o Bling).");
      qc.invalidateQueries({ queryKey: ["product", companyId, sku] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  if (product.isLoading) return <div className="p-8">Carregando...</div>;
  if (!product.data) return (
    <div className="p-8 space-y-4">
      <Link to="/produtos" className="text-sm underline"><ArrowLeft className="inline h-4 w-4 mr-1" /> Voltar</Link>
      <p>Produto não encontrado.</p>
    </div>
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/produtos" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{product.data.nome ?? "(sem nome)"}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">SKU: {product.data.codigo}</span>
            {product.data.dirty && <Badge variant="secondary">Alterado</Badge>}
            {product.data.source && <Badge variant="outline">{product.data.source}</Badge>}
          </div>
        </div>
        <div className="w-56">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {companies.data?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <AlternativeSuppliersCard sku={product.data.codigo} ean={form.gtin ?? product.data.gtin} nome={product.data.nome} productId={product.data.id} precoVenda={Number(form.preco ?? product.data.preco) || null} />

      {auditResults.data && auditResults.data.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Resultados da auditoria</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              {auditResults.data.map((r: any) => (
                <div key={r.id} className="flex items-start gap-2">
                  <Badge variant={r.status === "pass" ? "secondary" : r.status === "warning" ? "outline" : "destructive"}>
                    {r.status}
                  </Badge>
                  <div>
                    <span className="font-medium">{r.rule_slug}</span>
                    {r.message && <span className="ml-2 text-muted-foreground">{r.message}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {SECTIONS.map((sec) => (
        <Card key={sec.title}>
          <CardHeader><CardTitle>{sec.title}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sec.fields.map((f) => (
              <div key={f.key} className={f.textarea ? "md:col-span-2" : ""}>
                <Label className="text-xs">{f.label}</Label>
                {f.textarea ? (
                  <Textarea
                    readOnly={readOnly}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    rows={4}
                  />
                ) : (
                  <Input
                    readOnly={readOnly}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/80 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => navigate({ to: "/produtos" })}>Cancelar</Button>
        {!readOnly && <Button onClick={handleSave}><Save className="mr-2 h-4 w-4" /> Salvar</Button>}
      </div>
      {!readOnly && <CardDescription className="text-center">
        As alterações são salvas apenas neste sistema. A sincronização de volta com o Bling ainda não está ativa.
      </CardDescription>}
    </div>
  );
}
