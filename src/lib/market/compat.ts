/**
 * Live DB may not have the market column / RPC args until the SQL editor
 * migration is applied. Callers should fall back to ZA behaviour.
 */

export function isMissingMarketSupport(
  error:
    | {
        message?: string;
        code?: string;
      }
    | null
    | undefined,
): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  const code = error.code ?? "";
  return (
    code === "42883" ||
    code === "42703" ||
    code === "PGRST202" ||
    /p_market/i.test(msg) ||
    /column ["']?market["']?/i.test(msg)
  );
}

export async function withMarketRpcFallback<T>(
  withMarket: () => Promise<{ data: T; error: { message?: string; code?: string } | null }>,
  withoutMarket: () => Promise<{ data: T; error: { message?: string; code?: string } | null }>,
): Promise<{ data: T; error: { message?: string; code?: string } | null }> {
  const first = await withMarket();
  if (first.error && isMissingMarketSupport(first.error)) {
    return withoutMarket();
  }
  return first;
}
