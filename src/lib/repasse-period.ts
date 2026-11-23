export function includeRepasseDate(from: string, to: string, savedDate: string) {
  return { from: savedDate < from ? savedDate : from, to: savedDate > to ? savedDate : to };
}