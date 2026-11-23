import { streamResponse, GatewayError } from "@lovable.dev/ai-gateway";
import type { ProspectResearch } from "./ml-prospect-prepare";

const MODEL = "openai/gpt-6-astra";

const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "title_60", "description", "identity_note", "ncm", "anatel", "measures"],
  properties: {
    brand: nullableString,
    title_60: nullableString,
    description: nullableString,
    identity_note: nullableString,
    ncm: {
      type: "object", additionalProperties: false, required: ["code", "basis", "source_url"],
      properties: { code: nullableString, basis: { type: ["string", "null"], enum: ["ean", "classificacao", null] }, source_url: nullableString },
    },
    anatel: {
      type: "object", additionalProperties: false, required: ["status", "code", "source_url"],
      properties: { status: { type: "string", enum: ["codigo", "nao_se_aplica", "nao_encontrado"] }, code: nullableString, source_url: nullableString },
    },
    measures: {
      type: "object", additionalProperties: false, required: ["weight_kg", "length_cm", "width_cm", "height_cm", "kind", "source_url"],
      properties: {
        weight_kg: nullableNumber, length_cm: nullableNumber, width_cm: nullableNumber, height_cm: nullableNumber,
        kind: { type: ["string", "null"], enum: ["embalagem", "produto", null] }, source_url: nullableString,
      },
    },
  },
} as const;

const INSTRUCTIONS =
  "Você completa o cadastro fiscal e logístico de um produto para venda no Brasil, pesquisando na internet. " +
  "Use o EAN, a marca e o modelo informados para achar o MESMO produto (fabricante, lojas, Receita Federal, Anatel SCH). " +
  "Regras: nunca estime nem invente números; só preencha medidas e peso que aparecem numa fonte sobre este mesmo produto, convertendo para kg e cm; " +
  "prefira medidas da embalagem e informe kind. Se não achar, use null. " +
  "NCM: 8 dígitos. basis='ean' quando uma fonte associa o NCM a este EAN/modelo; basis='classificacao' quando vem da classificação oficial do tipo exato de produto (cite a fonte). " +
  "Para o NCM procure primeiro o EAN em bases de produtos (por exemplo cosmos.bluesoft.com.br/produtos/EAN) e notas/fichas de lojas; se não houver, classifique o tipo exato de produto pela TIPI/NCM oficial e cite a página da posição. Só use null se o tipo de produto for ambíguo. " +
  "Anatel: status 'codigo' com o código no formato NNNNN-NN-NNNNN de certificado deste modelo; 'nao_se_aplica' somente se o produto não tem rádio/transmissor (sem Bluetooth, Wi-Fi, celular, NFC, RF, carregamento sem fio); caso contrário 'nao_encontrado'. " +
  "title_60: título em português com no máximo 60 caracteres, começando pelo tipo do produto, seguido de marca, modelo e especificações essenciais, sem inventar. " +
  "description: 300 a 700 caracteres em português, factual, só com características confirmadas; sem links, citações, avisos ou observações; não mencione garantia, preço, frete ou loja. " +
  "identity_note: se o EAN pertencer a outro modelo, cor ou variação diferente do título, explique em uma frase; senão null. " +
  "Responda somente com o JSON do esquema.";

export type ResearchInput = {
  ean: string; title: string; brand: string | null; attributes: string[];
  missing: string[];
  focus?: "medidas";
};

/** Web-grounded research; every value stays a suggestion that the user confirms per product. */
export async function researchProspect(input: ResearchInput, signal?: AbortSignal): Promise<ProspectResearch | null> {
  const prompt = [
    "Responda em JSON.",
    `EAN: ${input.ean}`,
    `Título no Mercado Livre: ${input.title}`,
    `Marca: ${input.brand ?? "não informada"}`,
    `Campos que faltam: ${input.missing.join(", ")}`,
    ...(input.focus === "medidas" ? ["Foco: encontre peso e dimensões (embalagem ou produto) deste mesmo modelo em fichas técnicas do fabricante, manuais, lojas ou marketplaces (Magazine Luiza, Amazon, Americanas, Casas Bahia, Kabum costumam trazer peso e dimensões da embalagem); procure também pelo EAN. Os demais campos podem ficar null."] : []),
    "Atributos do catálogo do Mercado Livre:",
    ...input.attributes.slice(0, 60),
  ].join("\n");
  let text = "";
  try {
    const stream = await streamResponse({
      model: MODEL,
      instructions: INSTRUCTIONS,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      tools: [{ type: "web_search" }],
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "prospect_research", strict: true, schema: SCHEMA as unknown as Record<string, unknown> } },
    }, { signal });
    for await (const event of stream as AsyncIterable<{ type?: string; text?: string; response?: { error?: { message?: string } } }>) {
      if (event.type === "response.output_text.done" && typeof event.text === "string") text = event.text;
      if (event.type === "response.failed" || event.type === "error") throw new Error(event.response?.error?.message ?? "A pesquisa na internet falhou.");
    }
  } catch (e) {
    if (e instanceof GatewayError) throw new Error(`Pesquisa na internet indisponível agora (${e.code ?? e.httpStatus ?? "erro"}).`);
    throw e;
  }
  if (!text) return null;
  try { return JSON.parse(text) as ProspectResearch; } catch { return null; }
}
