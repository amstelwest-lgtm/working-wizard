/**
 * Accountant marketplace — pure module (P3).
 *
 * Owners without a firm find a listed firm and ask it to review their pack;
 * the firm accepts and becomes `clients.firm_id`. Matching is a small,
 * explainable score (mirrored in `marketplace_match_firms` SQL, test-guarded)
 * — this is a shortlist, not a ranking engine.
 */

export const REQUEST_STATUSES = ["open", "accepted", "declined", "withdrawn", "expired"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type FirmListing = {
  firm_id: string;
  is_listed: boolean;
  accepting: boolean;
  headline: string | null;
  bio: string | null;
  industries: string[];
  regions: string[];
  services: string[];
  contact_email: string | null;
};

export type FirmMatch = {
  firm_id: string;
  name: string;
  headline: string | null;
  bio: string | null;
  industries: string[];
  regions: string[];
  services: string[];
  accepting: boolean;
  score: number;
  reasons: string[];
  request_status: RequestStatus | null;
};

export type AccountantRequest = {
  id: string;
  client_id: string;
  firm_id: string;
  status: RequestStatus;
  message: string | null;
  pack_id: string | null;
  match_score: number | null;
  created_by: string | null;
  created_at: string;
  responded_by: string | null;
  responded_at: string | null;
  response_note: string | null;
  /** Joined for the firm inbox. */
  client_name?: string | null;
  firm_name?: string | null;
};

/** Tags are stored lower-cased and trimmed; empty entries dropped. */
export function normaliseTags(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,\n]/);
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return Array.from(seen);
}

/** TS mirror of the SQL score; used by tests and for previews. */
export function scoreFirm(
  client: { businessType: string | null; country: string | null; regionCode: string | null },
  listing: Pick<FirmListing, "industries" | "regions" | "accepting">,
): { score: number; reasons: string[] } {
  const type = (client.businessType ?? "").toLowerCase();
  const country = (client.country ?? "").toLowerCase();
  const region = (client.regionCode ?? "").toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  if (type && listing.industries.includes(type)) {
    score += 3;
    reasons.push(`Works with ${type} businesses`);
  }
  if (
    (country && listing.regions.includes(country)) ||
    (region && listing.regions.includes(region))
  ) {
    score += 2;
    reasons.push("Serves your region");
  }
  if (listing.accepting) {
    score += 1;
    reasons.push("Taking new clients");
  }
  return { score, reasons };
}

export function requestStatusLabel(s: RequestStatus, audience: "owner" | "accountant"): string {
  switch (s) {
    case "open":
      return audience === "owner" ? "Waiting for a reply" : "New request";
    case "accepted":
      return audience === "owner" ? "Your accountant" : "Accepted";
    case "declined":
      return "Declined";
    case "withdrawn":
      return "Withdrawn";
    case "expired":
      return audience === "owner" ? "No longer needed" : "Taken by another firm";
  }
}

export function isMissingMarketplaceRelation(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  return (
    /firm_listings|accountant_request|marketplace_match_firms/.test(msg) &&
    /does not exist|schema cache|could not find/i.test(msg)
  );
}

/** Copy the owner sees at the moment the offer makes sense. */
export function inviteMoment(f: {
  packStatus: string | null;
  hasFirm: boolean;
  openRequests: number;
}): {
  show: boolean;
  title: string;
  reason: string;
} {
  if (f.hasFirm) return { show: false, title: "", reason: "" };
  if (f.openRequests > 0) {
    return {
      show: true,
      title: "Your request is with the firm",
      reason:
        "They see your advisory pack, not your raw figures. You'll hear back here and by email.",
    };
  }
  if (f.packStatus === "draft" || f.packStatus === "approved") {
    return {
      show: true,
      title: "Have an accountant check this pack",
      reason:
        "You've been running MILŌN on your own. A listed firm can review the pack, sign it off, and keep an eye on the numbers with you — one request, no commitment.",
    };
  }
  return {
    show: true,
    title: "Want an accountant in the loop?",
    reason:
      "MILŌN works without one. If you want a professional to review what it produces, pick a firm below.",
  };
}
