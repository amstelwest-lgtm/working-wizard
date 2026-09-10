import { supabase } from "@/integrations/supabase/client";

export type BrainDeliverableResult = {
  draftInserted: boolean;
  skippedReason?: "ai_not_configured" | "empty_context" | "similar_open" | "empty_draft";
};

type RawDeliverableBody = BrainDeliverableResult & {
  error?: string;
  smoke?: string;
  status?: string;
};

function parseDeliverableBody(raw: unknown): RawDeliverableBody {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as RawDeliverableBody;
  }
  return {};
}

/** Reject smoke stubs and other non-contract 200 responses before the UI treats them as "no draft". */
export function assertBrainDeliverableResponse(body: RawDeliverableBody): void {
  if (body.smoke === "smoke-bdd" || body.status === "smoke-bdd") {
    throw new Error(
      "Draft service is running a smoke stub — brain-deliverable-draft needs a full redeploy.",
    );
  }
  if (typeof body.draftInserted !== "boolean") {
    throw new Error(
      body.error ||
        "Draft service returned an unexpected response — brain-deliverable-draft may need redeploying.",
    );
  }
}

export async function invokeBrainDeliverableDraft(clientId: string): Promise<BrainDeliverableResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");

  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/brain-deliverable-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientId }),
    });
  } catch (e) {
    const msg = (e as Error).message || "Network error";
    throw new Error(
      /failed to fetch|network|load failed/i.test(msg)
        ? "Could not reach draft service — check connection or confirm brain-deliverable-draft is deployed."
        : msg,
    );
  }

  const body = parseDeliverableBody(await res.json().catch(() => null));
  if (!res.ok) {
    throw new Error(body.error || `Draft failed (${res.status})`);
  }

  assertBrainDeliverableResponse(body);
  return {
    draftInserted: body.draftInserted,
    skippedReason: body.skippedReason,
  };
}
