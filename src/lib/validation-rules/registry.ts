import type { RuleModule } from "./types";
import { tituloMaxRule } from "./modules/titulo-max";
import { descricaoCurtaMinRule } from "./modules/descricao-curta-min";
import { descricaoComplementarIgualNomeRule } from "./modules/descricao-complementar-igual-nome";
import { eanObrigatorioRule } from "./modules/ean-obrigatorio";
import { produtoEmFornecedorRule } from "./modules/produto-em-fornecedor";
import { garantiaAnatelRule } from "./modules/garantia-anatel";
import { garantiaDuplicadaRule } from "./modules/garantia-duplicada";
import { imagensMinRule } from "./modules/imagens-min";
import { imagensMaxRule } from "./modules/imagens-max";
import { imagensExtensaoRule } from "./modules/imagens-extensao";
import { margemMinimaRule } from "./modules/margem-minima";
import { dimensoesPesoRule } from "./modules/dimensoes-peso";
import { crossdockingMinimoRule } from "./modules/crossdocking-minimo";
import { unidadeMedidaCentimetrosRule } from "./modules/unidade-medida-centimetros";
import { condicaoNovoRule } from "./modules/condicao-novo";
import { producaoTerceirosRule } from "./modules/producao-terceiros";
import { fornecedorVinculadoRule } from "./modules/fornecedor-vinculado";
import { ncmObrigatorioRule } from "./modules/ncm-obrigatorio";
import { marcaObrigatoriaRule } from "./modules/marca-obrigatoria";
import { imagemPlaceholderRule } from "./modules/imagem-placeholder";

export const RULE_REGISTRY: Record<string, RuleModule> = {
  [imagemPlaceholderRule.slug]: imagemPlaceholderRule,
  [ncmObrigatorioRule.slug]: ncmObrigatorioRule,
  [marcaObrigatoriaRule.slug]: marcaObrigatoriaRule,
  [tituloMaxRule.slug]: tituloMaxRule,
  [descricaoCurtaMinRule.slug]: descricaoCurtaMinRule,
  [descricaoComplementarIgualNomeRule.slug]: descricaoComplementarIgualNomeRule,
  [eanObrigatorioRule.slug]: eanObrigatorioRule,
  [produtoEmFornecedorRule.slug]: produtoEmFornecedorRule,
  [garantiaAnatelRule.slug]: garantiaAnatelRule,
  [garantiaDuplicadaRule.slug]: garantiaDuplicadaRule,
  [imagensMinRule.slug]: imagensMinRule,
  [imagensMaxRule.slug]: imagensMaxRule,
  [imagensExtensaoRule.slug]: imagensExtensaoRule,
  [margemMinimaRule.slug]: margemMinimaRule,
  [dimensoesPesoRule.slug]: dimensoesPesoRule,
  [crossdockingMinimoRule.slug]: crossdockingMinimoRule,
  [unidadeMedidaCentimetrosRule.slug]: unidadeMedidaCentimetrosRule,
  [condicaoNovoRule.slug]: condicaoNovoRule,
  [producaoTerceirosRule.slug]: producaoTerceirosRule,
  [fornecedorVinculadoRule.slug]: fornecedorVinculadoRule,
};

export type { RuleModule } from "./types";