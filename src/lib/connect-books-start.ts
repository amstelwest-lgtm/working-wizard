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

/**
 * Browser Back from Xero or QuickBooks restores this document from the
 * back-forward cache. The connect click already set "opening", and that
 * React state comes back with the page, so the button stays on Opening
 * and the picker stays disabled.
 * pagehide marks the leave. A later pageshow, including a persisted
 * restore, returns the control to idle. The listener is removed on
 * unmount and after it fires once.
 */
export function armLedgerConnectReturn(
  release: () => void,
  target: EventTarget | null = typeof window === "undefined" ? null : window,
): () => void {
  if (!target) return () => undefined;
  let left = false;
  const onPageHide = () => {
    left = true;
  };
  const onPageShow = (event: Event) => {
    const persisted = (event as PageTransitionEvent).persisted === true;
    if (!left && !persisted) return;
    cleanup();
    release();
  };
  const cleanup = () => {
    target.removeEventListener("pagehide", onPageHide);
    target.removeEventListener("pageshow", onPageShow);
  };
  target.addEventListener("pagehide", onPageHide);
  target.addEventListener("pageshow", onPageShow);
  return cleanup;
}
