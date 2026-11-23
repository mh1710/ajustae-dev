import { createOpenAI } from '@ai-sdk/openai';
import { Output, jsonSchema, streamText, APICallError } from 'ai';
import { createLovableAiGatewayRunIdFetch } from './run-id.ts';

export const CATEGORY_MODEL = 'openai/gpt-6-astra';
export class CategoryAiError extends Error {
  constructor(message: string, public status: number, public reason: string, public retryAfter = 60) { super(message); }
}
import { officialCategory, categoryChildren, categoryRoots } from "./taxonomy.server";
/** Navigate the entire official tree; category IDs can only come from displayed options. */
export async function classifyOfficialCategory(title: string, signal: AbortSignal, apiKey: string) {
  const run = createLovableAiGatewayRunIdFetch();
  let lastHttpError: CategoryAiError | undefined;
  const provider = createOpenAI({
    baseURL: 'https://ai.gateway.lovable.dev/v1', apiKey,
    headers: { 'Lovable-API-Key': apiKey, 'X-Lovable-AIG-SDK': 'vercel-ai-sdk' },
    fetch: async (input, init) => {
      const response = await run.fetch(input, init);
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null) as any;
        const message = body?.message ?? body?.error?.message ?? `Falha na IA (HTTP ${response.status}).`;
        const type = body?.type ?? body?.error?.type ?? '';
        const reason = response.status === 402 ? 'credits' : response.status === 403
          ? (/credit|limit|disabled|policy/.test(type + ' ' + message) ? 'policy' : 'access')
          : response.status === 429 ? 'rate' : response.status >= 500 ? 'transient' : 'configuration';
        lastHttpError = new CategoryAiError(message, response.status, reason, Number(response.headers.get('retry-after')) || 60);
      }
      return response;
    },
  });
  let options: { id: string; path: string }[] = categoryRoots;
  for (let depth = 0; depth < 8; depth++) {
    const result = streamText({
      model: provider.responses(CATEGORY_MODEL), maxRetries: 0, abortSignal: signal,
      instructions: 'Classifique um produto no Mercado Livre Brasil. O nome é o fornecido pelo catálogo do fornecedor. ' +
        'Escolha SOMENTE um ID da lista oficial fornecida. Se houver categorias mais específicas, escolha o ramo correspondente. ' +
        'Nunca invente características. Se não conseguir identificar o tipo, use id null. Resposta curta, apenas o objeto solicitado.',
      messages: [{ role: 'user', content: `Produto: ${title}\nCategorias oficiais disponíveis:\n${options.map(c => `${c.id}: ${c.path}`).join('\n')}` }],
      output: Output.object({ schema: jsonSchema<{ id: string | null }>({ type: 'object', properties: { id: { type: ['string', 'null'] } }, required: ['id'], additionalProperties: false }) }),
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: 'low', reasoningSummary: 'auto', store: false, include: ['reasoning.encrypted_content'] } },
    });
    let choice: { id: string | null };
    try { choice = await result.output; }
    catch (e) {
      if (signal.aborted) throw e;
      if (lastHttpError) throw lastHttpError;
      if (APICallError.isInstance(e)) throw new CategoryAiError('A IA não conseguiu concluir a classificação.', e.statusCode ?? 500, 'configuration');
      const reason = await Promise.resolve(result.finishReason).catch(() => undefined);
      if (reason === 'content-filter') throw new CategoryAiError('A IA recusou a classificação deste produto.', 200, 'refusal');
      throw new CategoryAiError('A IA não retornou uma classificação válida.', 200, 'refusal');
    }
    if (choice.id === null) return null;
    const selected = options.find(c => c.id === choice.id);
    if (!selected) throw new CategoryAiError('A IA retornou uma categoria fora da lista oficial.', 400, 'configuration');
    const node = officialCategory(selected.id);
    if (node?.leaf) return { category_id: node.id, category_path: node.path };
    options = categoryChildren(selected.path).filter(c => c.id !== selected.id);
    if (!options.length) return null;
  }
  return null;
}
