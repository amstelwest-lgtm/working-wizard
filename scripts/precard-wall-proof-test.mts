/**
 * No-plan firm wall: first value, the AI and client caps, and trial end.
 * Run: pnpm test:precard-wall-proof
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { restoreLastFirmSuccess } from "../src/lib/billing-check-failure.ts";
import { decideFirmClientCreate } from "../src/lib/firm-client-cap.ts";
import { surfaceAfterEntitlementFailure } from "../src/lib/firm-gate-access.ts";
import { noPlanTrialClock } from "../src/lib/firm-starter-trial.ts";
import {
  EMPTY_PRECARD_USAGE,
  PRECARD_BOT_LIMIT,
  PRECARD_EMAIL_LIMIT,
  PRECARD_PACK_LIMIT,
  decidePrecardAllowance,
  precardCapApplies,
} from "../src/lib/precard-cap.ts";
import { GENERATION_ENTRIES, starterTrialBlocksGeneration } from "../src/lib/starter-trial-generation.ts";
import {
  decideFirmBillingEntitlement,
  decideFirmBillingPathGate,
  decidePostLoginBillingResume,
} from "../src/lib/stripe-entitlement.ts";
import { cardlessTrialAiBlock } from "../supabase/functions/_shared/starter-trial-gate.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = new Date("2026-10-20T12:00:00.000Z");
const firm = {
  isAccountantFirmUser: true,
  isMilonItMember: false,
  entitled: false,
} as const;
const first = "11111111-1111-4111-8111-111111111111";
const later = "22222222-2222-4222-8222-222222222222";

const entitlement = decideFirmBillingEntitlement({
  stripeConfigured: true,
  hasEntitlingSubscription: false,
  ownsFirm: true,
  isFirmMember: false,
});
assert(
  entitlement.entitled === false && entitlement.reason === "no_active_subscription",
  "a no-plan firm is not entitled",
);

assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: true,
    ownsFirm: true,
    resumeFirmBilling: true,
    insightSeen: false,
  }) === "workspace",
  "before an insight, signup stays in the workspace",
);
assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: true,
    ownsFirm: true,
    resumeFirmBilling: true,
    insightSeen: true,
  }) === "billing_start",
  "after the first insight, checkout is the next step",
);

assert(
  decideFirmBillingPathGate({
    ...firm,
    pathname: "/practice",
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: first,
  }) === "allow",
  "practice stays open so the first result can be seen",
);
assert(
  decideFirmBillingPathGate({
    ...firm,
    pathname: `/clients/${first}`,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: first,
  }) === "allow",
  "the first client file stays open",
);
assert(
  decideFirmBillingPathGate({
    ...firm,
    pathname: "/reports",
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: first,
  }) === "require_billing",
  "reports wall a no-plan firm after the insight",
);
assert(
  decideFirmBillingPathGate({
    ...firm,
    pathname: `/clients/${later}`,
    insightSeen: true,
    firmClientCount: 2,
    firstClientId: first,
  }) === "require_billing",
  "a later client file is the client-cap wall",
);
assert(
  surfaceAfterEntitlementFailure({
    known: "unpaid",
    pathname: `/clients/${later}`,
    firmClientCount: 2,
    firstClientId: first,
  }) === "wall",
  "a known no-plan firm on a later client sees the wall",
);

assert(precardCapApplies({ stripeConfigured: true, phase: "none" }), "phase none applies the pre-card cap");
assert(!precardCapApplies({ stripeConfigured: true, phase: "trialing" }), "a trialing plan is not pre-card capped");
assert(!precardCapApplies({ stripeConfigured: true, phase: "active" }), "a paid plan is not pre-card capped");
assert(
  decidePrecardAllowance({ applies: true, kind: "bot", usage: EMPTY_PRECARD_USAGE }).allowed,
  "the first Bot question is allowed",
);
assert(
  !decidePrecardAllowance({
    applies: true,
    kind: "bot",
    usage: { ...EMPTY_PRECARD_USAGE, botMessages: PRECARD_BOT_LIMIT },
  }).allowed,
  "the Bot cap walls a no-plan firm",
);
assert(
  !decidePrecardAllowance({
    applies: true,
    kind: "pack",
    usage: { ...EMPTY_PRECARD_USAGE, packGenerations: PRECARD_PACK_LIMIT },
  }).allowed,
  "the pack cap walls a no-plan firm",
);
assert(
  !decidePrecardAllowance({
    applies: true,
    kind: "email",
    usage: { ...EMPTY_PRECARD_USAGE, emailDrafts: PRECARD_EMAIL_LIMIT },
  }).allowed,
  "the email cap walls a no-plan firm",
);

const inside = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: "2026-10-17T12:00:00.000Z",
  now,
});
assert(!inside.expired, "a no-plan firm inside 14 days is not at trial end");
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "none",
    band: null,
    clientCount: 1,
    starterTrialExpired: inside.expired,
  }).allowed,
  "inside the trial a no-plan firm can still add a client",
);

const ended = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: "2026-10-01T12:00:00.000Z",
  now,
});
assert(ended.expired, "a no-plan firm past day 14 is at trial end");
const endedCreate = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 1,
  starterTrialExpired: ended.expired,
});
assert(
  !endedCreate.allowed && endedCreate.code === "starter_trial_ended",
  "trial end blocks another client for a no-plan firm",
);
assert(
  !noPlanTrialClock({
    enforced: false,
    noPlan: true,
    startedAt: "2026-09-01T12:00:00.000Z",
    now,
  }).expired,
  "an exempt firm does not expire",
);
assert(
  !noPlanTrialClock({
    enforced: true,
    noPlan: false,
    startedAt: "2026-09-01T12:00:00.000Z",
    now,
  }).expired,
  "a firm with a plan is not on the no-plan clock",
);

const paidAgents = GENERATION_ENTRIES.filter((entry) => entry.paid);
assert(paidAgents.length > 0, "agents that create work are listed");
for (const entry of paidAgents) {
  assert(starterTrialBlocksGeneration(entry.id, true), `${entry.id} is blocked after the trial`);
}
assert(!starterTrialBlocksGeneration("ask_ai", true), "Ask AI is not on the paid-generation list");
assert(!starterTrialBlocksGeneration("milon_bot_qa", true), "Bot Q&A is not on the paid-generation list");

const restored = restoreLastFirmSuccess({
  requestedFirmId: "firm-cardless",
  storedFirmId: "firm-cardless",
  prior: { entitled: false, reason: "no_active_subscription", introTrialEligible: true },
});
assert(restored?.entitled === false, "last success never entitles a firm with no plan");
assert(
  restoreLastFirmSuccess({
    requestedFirmId: "firm-cardless",
    storedFirmId: "firm-other",
    prior: { entitled: true, reason: "active_subscription" },
  }) == null,
  "an entitled last success is only for that firm id",
);

type Row = Record<string, unknown>;
function fakeDb(rows: Record<string, { data: Row | null; error: string | null }>) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  const row = rows[table] ?? { data: null, error: null };
                  return { data: row.data, error: row.error ? { message: row.error } : null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const blocked = await cardlessTrialAiBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-cardless" }, error: null },
    firms: {
      data: { precard_cap_applies: true, starter_trial_generation_blocked: true },
      error: null,
    },
  }),
  clientId: "client-1",
});
assert(blocked?.code === "starter_trial_ended", "AI is blocked after the trial without a card");

const during = await cardlessTrialAiBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-cardless" }, error: null },
    firms: {
      data: { precard_cap_applies: true, starter_trial_generation_blocked: false },
      error: null,
    },
  }),
  clientId: "client-1",
});
assert(during == null, "AI stays available during the no-plan trial");

const cardOnFile = await cardlessTrialAiBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-paid" }, error: null },
    firms: {
      data: { precard_cap_applies: false, starter_trial_generation_blocked: true },
      error: null,
    },
  }),
  clientId: "client-1",
});
assert(cardOnFile == null, "a firm that is not pre-card is not stopped by this gate");

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const capServer = read("src/lib/firm-client-cap.server.ts");
assert(capServer.includes("noPlanTrialClock"), "the live trial banner uses the no-plan clock");
assert(
  capServer.includes("created_at"),
  "the no-plan clock reads the firm row start",
);
const clientFile = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(
  clientFile.includes("hasFigures") && clientFile.includes("CheckoutAfterInsight"),
  "the client file asks for a card once figures are on screen",
);
const practice = read("src/components/practice-board.tsx");
assert(
  practice.includes("scoredRows.length > 0") && practice.includes("CheckoutAfterInsight"),
  "Health on the practice board asks for a card once a client is scored",
);
assert(read("supabase/functions/ask-ai/index.ts").includes("cardlessTrialAiBlock"), "Ask AI calls the cardless trial gate");
assert(
  read("supabase/functions/milon-bot/index.ts").includes("cardlessTrialAiBlock"),
  "Milōn Bot calls the cardless trial gate",
);
for (const path of ["supabase/functions/brain-propose/index.ts", "supabase/functions/brain-deliverable-draft/index.ts", "supabase/functions/milon-bot/persist.ts"]) {
  assert(read(path).includes("paidGenerationTrialBlock"), `${path} blocks agent work after the trial`);
}

console.log("precard-wall-proof ok");
