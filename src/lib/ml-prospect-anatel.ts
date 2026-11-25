/**
 * Decides when a garimpo product clearly has no radio/transmitter, so Anatel is "Não se aplica"
 * without web research. Anything that may transmit (or charge phones) keeps requiring a real code.
 */
const RADIO_TERMS = [
  "bluetooth", "wi-?fi", "wireless", "\\bnfc\\b", "\\brfid\\b", "\\bradio\\b", "transmissor", "receptor",
  "celular", "smartphone", "telefone", "smart ?watch", "relogio inteligente", "smartband", "pulseira inteligente",
  "roteador", "modem", "repetidor", "\\bdrone", "walkie", "controle remoto", 
  "zigbee", "\\bgps\\b", "rastreador", "antena", "\\bfone", "headset", "headphone", "earbud", "airpod",
  "caixa de som", "alto-?falante", "microfone", "mouse", "teclado", "campainha", "interfone", "baba eletronica",
  "camera", "webcam", "alarme", "tablet", "notebook", "computador", "\\btv\\b", "televis", "chromecast",
  "tv box", "console", "videogame", "\\b[345]g\\b", "\\blte\\b", "\\d+(?:[.,]\\d+)? ?[gm]hz",
  "power ?bank", "\\bwifi\\b", "\\bwlan\\b",
];
const RADIO = new RegExp(RADIO_TERMS.join("|"), "i");
/** Chargers need Anatel only when they charge phones/tablets (car battery chargers do not). */
const PHONE_CHARGER = /(carregador|fonte|cabo)[^|]{0,60}(celular|iphone|smartphone|samsung|xiaomi|motorola|tablet|ipad|usb-?c|tipo c|turbo)|(celular|iphone|smartphone)[^|]{0,40}carregador/i;

/** Category words that always need an Anatel check, even when the title looks harmless. */
const RADIO_CATEGORIES = /celulares|telefon|informatica|eletronicos, audio|audio e video|games|cameras|casa inteligente|seguranca para casa|acessorios para celular/i;

function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

type Attr = { name?: unknown; id?: unknown; value_name?: unknown };

export function prospectMayHaveRadio(input: { title?: unknown; categoryPath?: unknown; domainId?: unknown; attributes?: unknown }): boolean {
  const attrs = Array.isArray(input.attributes) ? (input.attributes as Attr[]) : [];
  // "Com Bluetooth: Não" must not count as Bluetooth.
  const attrText = attrs
    .filter(a => a && a.value_name != null && !/^n[aã]o$/i.test(String(a.value_name).trim()))
    // "Usos recomendados: teclados" or compatibility lists describe other products, not this one.
    .filter(a => !/usos? recomendad|compat[ií]ve|indicado para/i.test(String(a.name ?? "")))
    .map(a => `${String(a.name ?? a.id ?? "")} ${String(a.value_name)}`)
    .join(" | ");
  const category = plain(String(input.categoryPath ?? ""));
  if (RADIO_CATEGORIES.test(category)) return true;
  const domain = plain(String(input.domainId ?? "")).replace(/[_-]/g, " ");
  const text = plain([input.title, domain, category, attrText].map(v => String(v ?? "")).join(" | "));
  return RADIO.test(text) || PHONE_CHARGER.test(text);
}

/** The same barcode written with or without leading zeros (EAN-13, GTIN-14, UPC-12). */
export function eanVariants(ean: string): string[] {
  const core = ean.replace(/^0+/, "");
  if (!/^\d{6,14}$/.test(core)) return [];
  return [...new Set([ean, core, ...[12, 13, 14].filter(n => n >= core.length).map(n => core.padStart(n, "0"))])];
}

const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Model codes (letters + digits, 4+ chars) from the ML sheet and title, normalized like the official base. */
export function anatelModelTokens(attributes: unknown, title: unknown): string[] {
  const attrs = Array.isArray(attributes) ? (attributes as Attr[]) : [];
  const fromAttrs = attrs.filter(a => /^(ALPHANUMERIC_MODEL|MODEL)$/.test(String(a?.id ?? ""))).map(a => norm(a.value_name));
  const fromWords = [...attrs.filter(a => /^(ALPHANUMERIC_MODEL|MODEL)$/.test(String(a?.id ?? ""))).map(a => String(a.value_name ?? "")), String(title ?? "")]
    .flatMap(text => text.split(/\s+/)).map(norm);
  return [...new Set([...fromAttrs, ...fromWords])].filter(t => t.length >= 4 && /[A-Z]/.test(t) && /\d/.test(t));
}

/** First word of the brand, letters and digits only (same key the official suggestions use). */
export function anatelBrandKey(brand: unknown): string {
  return norm(String(brand ?? "").trim().replace(/-/g, "").split(" ")[0]);
}

export type OfficialAnatelHit = { numero: string; fabricante?: string | null; solicitante?: string | null; nome_comercial?: string | null };

/** Official homologation by exact model code, accepted only when the brand matches and one number remains. */
export function pickOfficialAnatel(hits: OfficialAnatelHit[], brand: unknown): string | null {
  const key = anatelBrandKey(brand);
  if (key.length < 2) return null;
  const numbers = new Set(hits
    .filter(h => norm(`${h.fabricante ?? ""}${h.solicitante ?? ""}${h.nome_comercial ?? ""}`).includes(key))
    .map(h => String(h.numero ?? "").replace(/\D/g, ""))
    .filter(n => n.length === 12));
  if (numbers.size !== 1) return null;
  const n = [...numbers][0]!;
  return `${n.slice(0, 5)}-${n.slice(5, 7)}-${n.slice(7)}`;
}
