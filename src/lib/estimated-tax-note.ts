/** (Pty) companies with tax left at zero have not had company tax estimated. */
export function estimatedTaxNote(input: {
  clientName?: string | null;
  tax: number;
  operatingProfit: number;
}): string | null {
  if (input.tax !== 0) return null;
  if (!(input.operatingProfit > 0)) return null;
  if (!/\(pty\)/i.test(input.clientName ?? "")) return null;
  return "estimated tax not included";
}
