import { PLACEHOLDER_LUMA } from "./placeholder-image-reference";

export type PixelImage = { width: number; height: number; data: ArrayLike<number>; channels: number; depth?: number };

/** Area averaging, independent of URL, file encoding and resolution. */
export function imageLuminance(image: PixelImage): number[] {
  const { width, height, data, channels } = image;
  if (width < 1 || height < 1 || width * height > 12_000_000) throw new Error("Dimensões de imagem não suportadas.");
  const scale = image.depth === 16 ? 257 : 1;
  const output: number[] = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let sum = 0, count = 0;
    for (let py = Math.floor(y * height / 16); py < Math.max(Math.floor((y + 1) * height / 16), Math.floor(y * height / 16) + 1); py++) {
      for (let px = Math.floor(x * width / 16); px < Math.max(Math.floor((x + 1) * width / 16), Math.floor(x * width / 16) + 1); px++) {
        const i = (Math.min(py, height - 1) * width + Math.min(px, width - 1)) * channels;
        const luma = channels < 3 ? Number(data[i]) / scale : (.299 * Number(data[i]) + .587 * Number(data[i + 1]) + .114 * Number(data[i + 2])) / scale;
        const alpha = channels === 2 || channels === 4 ? Number(data[i + channels - 1]) / scale / 255 : 1;
        sum += luma * alpha + 255 * (1 - alpha); count++;
      }
    }
    output.push(sum / count);
  }
  return output;
}

export function matchesPlaceholderPixels(values: readonly number[]): boolean {
  if (values.length !== 256 || values.some((v) => !Number.isFinite(v))) return false;
  const mean = values.reduce((a, b) => a + b, 0) / 256;
  const refMean = PLACEHOLDER_LUMA.reduce((a, b) => a + b, 0) / 256;
  let dot = 0, variance = 0, refVariance = 0, error = 0;
  for (let i = 0; i < 256; i++) {
    const a = values[i] - mean, b = PLACEHOLDER_LUMA[i] - refMean;
    dot += a * b; variance += a * a; refVariance += b * b;
    error += (values[i] - PLACEHOLDER_LUMA[i]) ** 2;
  }
  const correlation = dot / Math.sqrt(variance * refVariance);
  // Require both shape and brightness: a blank/white product is not the logo.
  return correlation >= .94 && Math.sqrt(error / 256) <= 5 && Math.abs(mean - refMean) <= 4;
}

export function isSafeImageTarget(value: string): boolean {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443")
      && host.includes(".") && !host.includes(":") && !/^\d+(\.\d+){3}$/.test(host)
      && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);
  } catch { return false; }
}