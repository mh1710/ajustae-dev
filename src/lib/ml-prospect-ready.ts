import { normalizeAnatel, normalizeNcm } from "./ml-prospect-prepare";

export type PreparedProspect = { row: Record<string, any>; blockers: string[]; notes?: string[]; error?: string };

export type Draft = {
  titulo: string; marca: string; ncm: string; anatel: string; descricao: string;
  weight_kg: string; length_cm: string; width_cm: string; height_cm: string;
  status: "pendente" | "importando" | "importado" | "bloqueado"; message: string | null;
};

export const MEASURES = [
  { key: "weight_kg", label: "Peso (kg)" }, { key: "length_cm", label: "Comprimento (cm)" },
  { key: "width_cm", label: "Largura (cm)" }, { key: "height_cm", label: "Altura (cm)" },
] as const;

export function toDraft(p: PreparedProspect): Draft {
  const r = p.row; const review = r.raw?.review ?? {};
  const num = (v: unknown) => (Number(v) > 0 ? String(Number(v)) : "");
  return {
    titulo: review.titulo ?? r.titulo ?? "", marca: r.marca ?? "", ncm: r.ncm ?? "", anatel: review.anatel ?? "",
    descricao: review.descricao_curta ?? "", weight_kg: num(r.weight_kg), length_cm: num(r.length_cm), width_cm: num(r.width_cm), height_cm: num(r.height_cm),
    status: p.error ? "bloqueado" : "pendente", message: p.error ?? null,
  };
}

export function draftMissing(d: Draft): string[] {
  const missing: string[] = [];
  if (!d.titulo.trim() || d.titulo.length > 60) missing.push("título até 60 caracteres");
  if (!d.marca.trim()) missing.push("marca");
  if (!normalizeNcm(d.ncm)) missing.push("NCM de 8 dígitos");
  if (!normalizeAnatel(d.anatel)) missing.push("Anatel");
  for (const m of MEASURES) if (!(Number(d[m.key].replace(",", ".")) > 0)) missing.push(m.label.toLowerCase());
  if (d.descricao.replace(/<[^>]+>/g, "").trim().length < 150) missing.push("descrição com 150 caracteres");
  return missing;
}

/** Everything preparation left unresolved; a product is imported only when this list is empty (100%). */
export function preparedIssues(p: PreparedProspect): string[] {
  const issues: string[] = [];
  if (p.error) issues.push(p.error);
  const note = p.row.raw?.prepared?.identity_note;
  if (note) issues.push(`EAN pode ser de outra variação: ${note}`);
  const missing = draftMissing(toDraft(p));
  if (missing.length) issues.push(`Falta: ${missing.join(", ")}`);
  return [...issues, ...p.blockers];
}

