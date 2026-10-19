/**
 * Local stand-in so the harness does not load the TanStack Start server runtime.
 * Known practice reads return sample rows. Everything else still rejects with
 * "harness-local" so existing harness toasts stay quiet.
 */

import { formatFirmPlanStatus } from "@/lib/firm-client-cap";

const FIRM_ID = "11111111-1111-4111-8111-111111111111";

const TEAM_BOARD = {
  firmId: FIRM_ID,
  firmName: "Harbour & Co",
  canManage: true,
  membershipRole: "admin",
  myClassification: "partner",
  actorIsPartner: true,
  cap: 5,
  members: [
    {
      userId: "harness-local-user",
      email: "ada@harbour.example",
      name: "Ada Mbeki",
      membershipRole: "admin",
      classification: "partner",
      isFirmOwner: true,
    },
    {
      userId: "harness-staff",
      email: "leo@harbour.example",
      name: "Leo Naidoo",
      membershipRole: "member",
      classification: "staff",
      isFirmOwner: false,
    },
  ],
  clients: [
    {
      id: "harness-client",
      name: "Harbour Glass",
      code: "HG",
      ownerEmail: "owner@harbourglass.example",
      ownerUserId: "harness-owner",
      assignedCount: 2,
    },
    {
      id: "harness-client-north",
      name: "North Quay Studio",
      code: "NQ",
      ownerEmail: "owner@northquay.example",
      ownerUserId: "harness-owner-2",
      assignedCount: 1,
    },
  ],
  assignments: [
    {
      id: "asg-1",
      clientId: "harness-client",
      userId: "harness-local-user",
      classification: "partner",
      status: "active",
      accountantApproved: true,
      ownerApproved: true,
      grantedAt: "2026-06-12T00:00:00.000Z",
    },
    {
      id: "asg-2",
      clientId: "harness-client",
      userId: "harness-staff",
      classification: "staff",
      status: "active",
      accountantApproved: true,
      ownerApproved: true,
      grantedAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "asg-3",
      clientId: "harness-client-north",
      userId: "harness-local-user",
      classification: "partner",
      status: "active",
      accountantApproved: true,
      ownerApproved: true,
      grantedAt: "2026-08-02T00:00:00.000Z",
    },
  ],
  invites: [
    {
      id: "invite-1",
      email: "sam@harbour.example",
      name: "Sam Okonkwo",
      membershipRole: "member",
      classification: "bookkeeper",
      createdAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  migrationHint: null,
};

const INBOX = {
  migrated: true,
  requests: [
    {
      id: "req-harbour-1",
      client_id: "harness-client-north",
      firm_id: FIRM_ID,
      status: "open",
      message: "Please review the September pack before we send it to the board.",
      pack_id: null,
      match_score: 8,
      created_by: "harness-owner-2",
      created_at: "2026-10-09T09:00:00.000Z",
      responded_by: null,
      responded_at: null,
      response_note: null,
      client_name: "North Quay Studio",
    },
  ],
};

const LISTING = {
  migrated: true,
  listing: {
    firm_id: FIRM_ID,
    is_listed: true,
    accepting: true,
    headline: "Cash-flow specialists for owner-run businesses",
    bio: "We review the pack Milōn prepares.",
    industries: ["professional_services", "retail"],
    regions: ["za"],
    services: ["management accounts", "cash forecast"],
    contact_email: "ada@harbour.example",
  },
};

const PLAN = {
  configured: true,
  phase: "active",
  band: "small",
  headline: "Small",
  detail: "Up to 15 clients",
  clientCount: 2,
  clientLimit: 15,
  usageLabel: "2 of 15 clients",
  canUpgrade: true,
  priceCurrency: "zar",
  interval: "month",
  zarByBand: {},
  starterTrial: {
    enforced: false,
    expired: false,
    showCountdown: false,
    dayOfTrial: null,
    daysLeft: null,
  },
  saDiscount: true,
  zaLabels: null,
  zaPriceLabel: null,
};

function fixtureFor(id: string): Promise<unknown> {
  if (id.includes("sageCredentialsConfigured")) return Promise.resolve({ configured: false });
  if (id.includes("sage_connections")) return Promise.resolve(null);
  if (id.includes("loadPracticeAccess")) return Promise.resolve(TEAM_BOARD);
  if (id.includes('from("accountant_requests")') || id.includes("accountant_requests")) {
    return Promise.resolve(INBOX);
  }
  if (id.includes('from("firm_listings")') || id.includes("firm_listings")) {
    return Promise.resolve(LISTING);
  }
  if (id.includes("loadFirmPlanDisplay")) {
    if (typeof location !== "undefined" && location.search.includes("band=starter")) {
      return Promise.resolve({
        ...PLAN,
        phase: "active",
        band: "starter",
        headline: "Starter",
        detail: "Up to 5 active clients",
        clientLimit: 5,
        usageLabel: "2 of 5 clients",
      });
    }
    if (typeof location !== "undefined" && location.search.includes("walkthrough=trial")) {
      const now = new Date();
      const end = new Date(now.getTime() + 9 * 86_400_000);
      const copy = formatFirmPlanStatus({
        phase: "trialing",
        band: "solo",
        trialEndIso: end.toISOString(),
        now,
      });
      return Promise.resolve({
        ...PLAN,
        ...copy,
        clientLimit: 3,
        usageLabel: "2 active clients · trial limit 3",
      });
    }
    return Promise.resolve(PLAN);
  }
  return Promise.reject(new Error("harness-local"));
}

function tagged(id: string) {
  const call = (..._args: unknown[]) => fixtureFor(id);
  return new Proxy(call, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === "__harnessId") return id;
      if (prop === "handler") {
        return (real: unknown) => {
          const src = typeof real === "function" ? Function.prototype.toString.call(real) : id;
          return tagged(src);
        };
      }
      return () => tagged(id);
    },
  });
}

export function createServerFn() {
  return tagged("unmatched");
}

const serverFnCache = new Map<string, (payload?: { data?: { scope?: string } }) => Promise<unknown>>();

export function useServerFn(fn?: { __harnessId?: string }) {
  const id = fn?.__harnessId ?? "";
  const cached = serverFnCache.get(id);
  if (cached) return cached;
  const call = (payload?: { data?: { scope?: string } }) => {
    // Landing proof shots: the action plan is ready for a named person to review.
    if (
      typeof location !== "undefined" &&
      location.pathname === "/proof-landing" &&
      id.includes("loadDeliverableState")
    ) {
      return Promise.resolve({
        status: "ready_for_review",
        changeComment: null,
        canSubmit: false,
        canReview: true,
        canSignOff: true,
      });
    }
    // Staff cycle on the action plan: submit, without the partner sign-off.
    if (id.includes("loadDeliverableState") && payload?.data?.scope === "action_plan") {
      return Promise.resolve({
        status: "draft",
        changeComment: null,
        canSubmit: true,
        canReview: false,
        canSignOff: false,
      });
    }
    return fixtureFor(id || String(payload));
  };
  serverFnCache.set(id, call);
  return call;
}

export function createMiddleware() {
  return tagged("middleware");
}

export function getRequest() {
  return new Request("http://127.0.0.1/");
}

export function createStartHandler() {
  return () => new Response("harness-local", { status: 404 });
}
