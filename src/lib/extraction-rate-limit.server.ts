/**
 * Per-user hourly cap on Claude document extraction. Server-only.
 *
 * Calls extraction_record_request with the user's own JWT (auth.uid() is the
 * caller). If the RPC is missing — migration not applied yet — the limiter
 * fails open with a warning rather than blocking every upload.
 */

export const EXTRACTION_HOURLY_LIMIT = 20;

export type ExtractionKind = "statement-pdf" | "owner-pdf" | "bank-pnl" | "bank-cash";

export const EXTRACTION_LIMIT_MESSAGE =
  `You've reached the hourly limit for document uploads (${EXTRACTION_HOURLY_LIMIT} an hour). ` +
  `Figures you've already extracted are safe — try the next upload in a little while.`;

type RpcClient = {
  rpc(
    fn: "extraction_record_request",
    args: { p_kind: string; p_files: number; p_bytes: number; p_limit: number },
  ): PromiseLike<{ data: boolean | null; error: { message: string; code?: string } | null }>;
};

export async function assertExtractionAllowed(
  supabase: RpcClient,
  kind: ExtractionKind,
  files: number,
  bytes: number,
): Promise<void> {
  const { data, error } = await supabase.rpc("extraction_record_request", {
    p_kind: kind,
    p_files: files,
    p_bytes: bytes,
    p_limit: EXTRACTION_HOURLY_LIMIT,
  });
  if (error) {
    // 42883 = function does not exist (migration not applied). Fail open.
    console.warn(`[extraction-rate-limit] not enforced: ${error.message}`);
    return;
  }
  if (data === false) throw new Error(EXTRACTION_LIMIT_MESSAGE);
}
