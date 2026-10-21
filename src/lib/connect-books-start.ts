/**
 * One click from the accountant Home starts the same OAuth the connect
 * cards use: getXeroAuthUrl / getQboAuthUrl, then the browser follows
 * authUrl. This file does not build a new authorize URL.
 */
export type LedgerConnectKind = "xero" | "qbo";

export type BeginLedgerConnectResult = "redirect" | "unconfigured";

export async function beginLedgerConnect(input: {
  configured: () => Promise<boolean>;
  authUrl: () => Promise<string>;
  go: (authUrl: string) => void;
}): Promise<BeginLedgerConnectResult> {
  const ready = await input.configured();
  if (!ready) return "unconfigured";
  const authUrl = await input.authUrl();
  input.go(authUrl);
  return "redirect";
}

export function unconfiguredLedgerMessage(kind: LedgerConnectKind): string {
  if (kind === "xero") {
    return "Xero sync isn't switched on for this workspace yet. Export a P&L and balance sheet and upload them.";
  }
  return "QuickBooks sync isn't switched on for this workspace yet. Export a P&L and balance sheet and upload them.";
}

export function ledgerConnectError(kind: LedgerConnectKind, err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return kind === "xero" ? "Failed to start Xero OAuth" : "Failed to start OAuth flow";
}
