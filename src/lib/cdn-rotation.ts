type JsonRecord = Record<string, unknown>;

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zoneOffset(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    date.getTime()
  );
}

export function nextRotationAt(
  from: Date,
  intervalDays: number,
  startHour: number,
  timeZone: string,
) {
  const local = zonedParts(from, timeZone);
  const calendar = new Date(
    Date.UTC(local.year, local.month - 1, local.day + intervalDays, startHour),
  );
  let target = new Date(calendar.getTime() - zoneOffset(calendar, timeZone));
  // Recalcula uma vez para cobrir mudança de offset/DST entre a aproximação e o alvo.
  target = new Date(calendar.getTime() - zoneOffset(target, timeZone));
  return target;
}

export function unwrapBlingProduct(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as JsonRecord;
  return record;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function blingMediaState(value: unknown) {
  const product = unwrapBlingProduct(value);
  const media = record(product?.midia);
  const video = record(media.video);
  const images = record(media.imagens);
  const external = Array.isArray(images.externas) ? images.externas : [];
  return {
    videoUrl: typeof video.url === "string" ? video.url : "",
    imageUrls: external
      .map((item) => record(item).link)
      .filter((link): link is string => typeof link === "string" && /^https?:\/\//i.test(link)),
  };
}

export function buildBlingMediaPatch(currentProduct: unknown, newUrls: string[]) {
  const safeUrls = newUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, 18);
  if (!safeUrls.length || safeUrls.length !== newUrls.length) {
    throw new Error("A mídia planejada contém URL inválida ou excede o limite de 18 imagens.");
  }
  const { videoUrl } = blingMediaState(currentProduct);
  return {
    midia: {
      video: { url: videoUrl },
      imagens: { imagensURL: safeUrls.map((link) => ({ link })) },
    },
  };
}

export function blingImagesMatch(value: unknown, expectedUrls: string[]) {
  const actual = blingMediaState(value).imageUrls;
  return (
    actual.length === expectedUrls.length &&
    actual.every((url, index) => url === expectedUrls[index])
  );
}

const GUARDED_PRODUCT_FIELDS = [
  "id",
  "codigo",
  "nome",
  "preco",
  "situacao",
  "tipo",
  "formato",
  "marca",
  "gtin",
  "gtinEmbalagem",
  "descricaoCurta",
  "descricaoComplementar",
] as const;

export function blingProductGuard(value: unknown) {
  const product = unwrapBlingProduct(value) ?? {};
  return Object.fromEntries(GUARDED_PRODUCT_FIELDS.map((field) => [field, product[field] ?? null]));
}

export function blingNonMediaFieldsMatch(before: unknown, after: unknown) {
  return JSON.stringify(blingProductGuard(before)) === JSON.stringify(blingProductGuard(after));
}

export function mergeLastSentMedia(
  value: unknown,
  mediaPatch: ReturnType<typeof buildBlingMediaPatch>,
) {
  const current =
    value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
  return { ...current, midia: mediaPatch.midia };
}
