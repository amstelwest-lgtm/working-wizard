/** Shown when the app cannot reach Milōn. Never include a host name. */
export const MILON_UNREACHABLE = "Couldn't reach Milōn. Check your connection and try again.";

const NETWORK =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|the internet connection appears to be offline|err_internet_disconnected|err_name_not_resolved/i;

const HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Network failures become one sentence. Any other message has hosts removed. */
export function friendlyReachMessage(error: unknown, fallback = MILON_UNREACHABLE): string {
  const text = messageOf(error).replace(/^TypeError:\s*/i, "").trim();
  if (!text) return fallback;
  if (NETWORK.test(text)) return MILON_UNREACHABLE;
  const stripped = text.replace(HOST, "").replace(/[()]/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!stripped || NETWORK.test(stripped)) return MILON_UNREACHABLE;
  return stripped;
}

export function budgetSaveErrorMessage(error: unknown): string {
  const friendly = friendlyReachMessage(error);
  return friendly === MILON_UNREACHABLE ? friendly : `Budget save failed: ${friendly}`;
}
