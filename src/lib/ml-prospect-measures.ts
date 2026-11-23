export type ProspectMeasures = { weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null };
export type MeasureDonor = { ean: string | null; source: string; measures: ProspectMeasures };
export const measureKeys = ["weight_kg", "length_cm", "width_cm", "height_cm"] as const;
export function completeMeasures(measures: ProspectMeasures) {
  return measureKeys.every(key => Number(measures[key]) > 0);
}
/** Missing fields only; conflicting exact-EAN donors do not authorize a value. */
export function mergeExactMeasures(base: ProspectMeasures, ean: string, donors: MeasureDonor[]) {
  const measures = { ...base };
  const sources: Partial<Record<keyof ProspectMeasures, string[]>> = {};
  for (const key of measureKeys) {
    if (Number(base[key]) > 0) continue;
    const matches = donors.filter(d => d.ean === ean && Number(d.measures[key]) > 0);
    const values = [...new Set(matches.map(d => d.measures[key]))];
    measures[key] = values.length === 1 ? values[0] ?? null : null;
    if (Number(measures[key]) > 0) sources[key] = matches.map(d => d.source);
  }
  return { measures, sources };
}