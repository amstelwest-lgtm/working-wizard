import type { BrainReviewQueueItem } from "./milon-brain-review.ts";

type ReviewResponse =
  | { ok: true; items: BrainReviewQueueItem[] }
  | { ok: true; groupsMatched: number; created: number; skippedExisting: number }
  | { ok: true; id: string; status: string }
  | { ok: false; error: string };

async function postReview(
  token: string,
  body: Record<string, unknown>,
): Promise<ReviewResponse> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const res = await fetch(`${base}/functions/v1/milon-brain-review`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ReviewResponse;
  if (!res.ok && data && typeof data === "object" && "error" in data) {
    return data;
  }
  return data;
}

export async function listMilonBrainReviewQueue(token: string) {
  return postReview(token, { action: "list" });
}

export async function runMilonBrainReview(token: string, days?: number) {
  return postReview(token, { action: "run_review", ...(days ? { days } : {}) });
}

export async function approveMilonBrainReviewRow(token: string, id: string) {
  return postReview(token, { action: "approve", id });
}

export async function rejectMilonBrainReviewRow(token: string, id: string) {
  return postReview(token, { action: "reject", id });
}
