/**
 * Interruptor global das funções de IA do sistema.
 *
 * Enquanto for `false`, todos os botões/opções que consomem o gateway de IA
 * ficam desabilitados na interface (nenhuma requisição é enviada).
 * Para reativar, basta trocar para `true`.
 */
export const AI_FEATURES_ENABLED = true;


/** Regras de auditoria cuja correção automática depende de IA. */
export const AI_FIX_RULE_SLUGS = new Set([
  "descricao-curta-minima",
  "garantia-duplicada-desc-curta",
  "titulo-maximo",
]);

export const AI_DISABLED_MESSAGE = "Funções de IA temporariamente desativadas.";
