/**
 * Starting cash for the 13-week forecast after a Xero sync.
 * Pure — safe for the cash-forecast screen and the server sync.
 *
 * Bank-summary closing balances (or the balance-sheet cash line) fill an
 * empty opening. A figure the accountant typed is left alone. Openings this
 * module wrote are marked `openingBalanceSource: "xero"` and refresh on the
 * next sync.
 */

export function applyXeroOpeningCash(
  existing: unknown,
  cash: number,
  startDate: string,
): { cashflow: Record<string, unknown>; changed: boolean } {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (!Number.isFinite(cash)) return { cashflow: base, changed: false };

  const currentRaw = base.openingBalance;
  const current = typeof currentRaw === "number" ? currentRaw : parseFloat(String(currentRaw ?? ""));
  const empty = currentRaw == null || currentRaw === "" || !Number.isFinite(current) || current === 0;
  const xeroOwned = base.openingBalanceSource === "xero";
  // A zero bank reading must not invent an opening, and must not wipe one we
  // did not write. A later sync can still move an opening we own to zero.
  if (cash === 0 && !xeroOwned) return { cashflow: base, changed: false };
  if (!empty && !xeroOwned) return { cashflow: base, changed: false };

  const next = String(Math.round(cash * 100) / 100);
  if (String(currentRaw ?? "") === next && xeroOwned && typeof base.startDate === "string" && base.startDate) {
    return { cashflow: base, changed: false };
  }
  base.openingBalance = next;
  base.openingBalanceSource = "xero";
  if (typeof base.startDate !== "string" || !base.startDate) base.startDate = startDate;
  return { cashflow: base, changed: true };
}

/**
 * When the saved forecast opening is still empty, use the cash figure already
 * on the financials blob (Xero sync or a statement upload).
 * Returns null when the forecast already has its own opening.
 */
export function forecastOpeningFromStored(
  openingBalance: string | number | null | undefined,
  financialsCash: string | number | null | undefined,
): string | null {
  const opening =
    typeof openingBalance === "number" ? openingBalance : parseFloat(String(openingBalance ?? ""));
  if (Number.isFinite(opening) && opening !== 0) return null;
  const cash =
    typeof financialsCash === "number" ? financialsCash : parseFloat(String(financialsCash ?? ""));
  if (!Number.isFinite(cash) || cash === 0) return null;
  return String(Math.round(cash * 100) / 100);
}
