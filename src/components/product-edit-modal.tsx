import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { getProduct, updateProduct } from "@/lib/products-tools.functions";
import { auditSingleProduct, getProductAuditResults } from "@/lib/audit.functions";
import { AlternativeSuppliersCard } from "@/components/alternative-suppliers-card";
import { useAccess } from "@/hooks/use-access";

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

interface Props {
  productId: string | null;
  companyId: string | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function ImageGallery({ main, raw }: { main: string | null | undefined; raw: string | null | undefined }) {
  const urls = Array.from(
    new Set(
      [main ?? "", raw ?? ""]
        .join("|")
        .split(/[|\n\r]+/)
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//i.test(s)),
    ),
  );
  if (urls.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Nenhuma imagem cadastrada.
      </div>
    );
  }
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-sm font-medium">Imagens ({urls.length})</div>
      <div className="flex flex-wrap gap-3">
        {urls.map((u) => {
          const src = u.replace(/\s/g, "%20");
          return (
          <a key={u} href={src} target="_blank" rel="noreferrer" className="group block">
            <img
              src={src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-24 w-24 rounded border object-cover transition group-hover:opacity-80"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.2"; }}
            />
            <div className="mt-1 max-w-[6rem] truncate text-[10px] text-muted-foreground">{u}</div>
          </a>
          );
        })}
      </div>
    </div>
  );
}

export function ProductEditModal({ productId, companyId, open, onOpenChange }: Props) {
  const { access } = useAccess();
  const readOnly = access.company_restricted;
  const qc = useQueryClient();
  const fnGet = useServerFn(getProduct);
  const fnUpdate = useServerFn(updateProduct);
  const fnAudit = useServerFn(getProductAuditResults);
  const fnAuditSingle = useServerFn(auditSingleProduct);

  const product = useQuery({
    queryKey: ["product-by-id", productId],
    queryFn: () => fnGet({ data: { product_id: productId! } }),
    enabled: !!productId && open,
  });

  const auditResults = useQuery({
    queryKey: ["product-audit", productId],
    queryFn: () => fnAudit({ data: { product_id: productId! } }),
    enabled: !!productId && open,
  });

  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [auditing, setAuditing] = useState(false);
  useEffect(() => { if (product.data) setForm(product.data); }, [product.data]);
  useEffect(() => { if (!open) { setForm({}); } }, [open]);

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
    setSaving(true);
    try {
      await fnUpdate({ data: { product_id: product.data.id, company_id: companyId, patch } });
      toast.success("Produto salvo.");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-by-id", productId] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAudit() {
    if (!product.data || !companyId) return;
    setAuditing(true);
    try {
      // Envia os valores atuais do formulário — assim o usuário audita o que
      // está prestes a salvar, não o que já está no banco.
      const override: Record<string, any> = {};
      for (const s of SECTIONS) for (const f of s.fields) {
        let v = form[f.key];
        if (v === "" || v === undefined) v = null;
        if (v != null && NUMERIC_FIELDS.has(f.key)) {
          const n = Number(String(v).replace(",", "."));
          v = Number.isFinite(n) ? n : null;
        }
        override[f.key] = v;
      }
      const result = await fnAuditSingle({
        data: { company_id: companyId, product_id: product.data.id, product_override: readOnly ? undefined : override },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["product-by-id", productId] }),
        qc.invalidateQueries({ queryKey: ["product-audit", productId] }),
      ]);
      if (result.errors === 0 && result.warnings === 0) {
        toast.success("Formulário auditado e aprovado sem erros.");
      } else {
        toast.warning(
          `Auditoria do formulário: ${result.errors} erro(s) e ${result.warnings} aviso(s).`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao auditar produto.");
    } finally {
      setAuditing(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {product.isLoading ? "Carregando..." : (product.data?.nome ?? "(sem nome)")}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {product.data && (
              <>
                <span className="font-mono text-xs">SKU: {product.data.codigo}</span>
                {product.data.dirty && <Badge variant="secondary">Alterado</Badge>}
                {product.data.source && <Badge variant="outline">{product.data.source}</Badge>}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {product.isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {product.data && (
          <div className="space-y-4">
            <ImageGallery
              main={product.data.imagem_principal_url}
              raw={form.url_imagens_externas ?? product.data.url_imagens_externas ?? ""}
            />
            <AlternativeSuppliersCard sku={product.data.codigo} ean={form.gtin ?? product.data.gtin} nome={product.data.nome} productId={product.data.id} precoVenda={Number(form.preco ?? product.data.preco) || null} />

            {auditResults.data && auditResults.data.length > 0 && (
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Resultados da auditoria</div>
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
              </div>
            )}

            {SECTIONS.map((sec) => (
              <div key={sec.title} className="rounded-md border p-4">
                <div className="mb-3 font-semibold">{sec.title}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                </div>
              </div>
            ))}

          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || auditing}>Cancelar</Button>
          <Button variant="outline" onClick={handleAudit} disabled={saving || auditing || !product.data}>
            {auditing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Auditar
          </Button>
          {!readOnly && <Button onClick={handleSave} disabled={saving || auditing || !product.data}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}