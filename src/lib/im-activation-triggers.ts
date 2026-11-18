/**
 * When an activation routine step may enqueue a first run — pure rules only.
 */
export type ImBooksContext = {
  hasLedger: boolean;
  hasUpload: boolean;
};

export function imActivationTriggerMet(trigger: string, books: ImBooksContext): boolean {
  if (trigger === "calendar_month_end") return books.hasLedger || books.hasUpload;
  if (trigger === "month_end_pack_missing") return books.hasLedger;
  if (trigger === "missing_source_docs") return books.hasUpload || books.hasLedger;
  return false;
}

export function botOwnerToAgentKey(
  botOwner: string,
): "financial_manager" | "analyst" | "advisor" | null {
  const label = botOwner.toLowerCase();
  if (label.includes("tax")) return null;
  if (label.includes("analyst")) return "analyst";
  if (label.includes("advisor")) return "advisor";
  return "financial_manager";
}