import { exactSupplierNcm } from "./ml-prospect-fiscal";

export async function lookupProspectNcm(ean: string | null) {
  if (!ean || !/^\d{8,14}$/.test(ean)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as { from: (table: string) => any };
  const { data, error } = await db.from("fornecedor_produtos").select("ncm,codigo")
    .eq("codigobarras", ean).eq("ativo", true).not("ncm", "is", null).limit(100);
  if (error) throw new Error("Não foi possível conferir o NCM no fornecedor.");
  return exactSupplierNcm(data ?? []);
}
/** Supplier photos only from the exact same barcode. */
export async function completeProspectPictures(ean: string | null, pictures: unknown) {
  const { mergeProspectPictures } = await import("./ml-prospect-photos");
  const current = mergeProspectPictures(pictures, []);
  if (current.length >= 3 || !ean || !/^\d{8,14}$/.test(ean)) return { pictures: current, added: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as { from: (table: string) => any };
  const { data, error } = await db.from("fornecedor_produtos").select("foto")
    .eq("codigobarras", ean).eq("ativo", true).not("foto", "is", null).limit(20);
  if (error) throw new Error("Não foi possível consultar fotos do fornecedor.");
  const merged = mergeProspectPictures(current, (data ?? []).map((r: { foto: string | null }) => r.foto));
  return { pictures: merged, added: merged.length - current.length };
}
