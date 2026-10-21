/**
 * No-plan firm wall: first value, the AI and client caps, and trial end.
 * Run: pnpm test:precard-wall-proof
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { restoreLastFirmSuccess } from "../src/lib/billing-check-failure.ts";
import { decideFirmClientCreate, showStarterTrialEndedCopy } from "../src/lib/firm-client-cap.ts";
import { decideFirmUpgradeRoute, upgradeButtonLabel } from "../src/lib/firm-band-upgrade.ts";
import { surfaceAfterEntitlementFailure } from "../src/lib/firm-gate-access.ts";
import { TRIAL_CLOCK_CUTOVER, noPlanTrialClock } from "../src/lib/firm-starter-trial.ts";
import {
  EMPTY_PRECARD_USAGE,
  PRECARD_BOT_LIMIT,
  PRECARD_EMAIL_LIMIT,
  PRECARD_PACK_LIMIT,
  decidePrecardAllowance,
  precardCapApplies,
} from "../src/lib/precard-cap.ts";
import { GENERATION_ENTRIES, starterTrialBlocksGeneration } from "../src/lib/starter-trial-generation.ts";
import { TrialEndedPlanCard } from "../src/components/trial-ended-plan-block.tsx";
import { BillingRequiredCard } from "../src/routes/billing.required.tsx";
import { FIRM_WALL_START_LABEL } from "../src/lib/billing-wall.ts";
import { billingStartPath } from "../src/lib/pending-checkout.ts";
import { firmSignupCheckoutIntent } from "../src/lib/stripe-plans.ts";
import {
  decideFirmBillingEntitlement,
  decideFirmBillingPathGate,
  decidePostLoginBillingResume,
} from "../src/lib/stripe-entitlement.ts";
import {
  cardlessTrialAiBlock,
  paidGenerationTrialBlock,
} from "../supabase/functions/_shared/starter-trial-gate.ts";

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

const cutoverMs = Date.parse(`${TRIAL_CLOCK_CUTOVER}T00:00:00.000Z`);
const day = 86_400_000;
const oldFirmCreated = new Date(cutoverMs - 30 * day).toISOString();
const dayAfterCutover = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: oldFirmCreated,
  now: new Date(cutoverMs + day),
});
assert(!dayAfterCutover.expired, "an old no-plan firm is still open the day after cutover");
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "none",
    band: null,
    clientCount: 1,
    starterTrialExpired: dayAfterCutover.expired,
  }).allowed,
  "an old no-plan firm can still add a client the day after cutover",
);
const fifteenAfter = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: oldFirmCreated,
  now: new Date(cutoverMs + 15 * day),
});
assert(fifteenAfter.expired, "an old no-plan firm is walled 15 days after cutover");
const walledCreate = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 1,
  starterTrialExpired: fifteenAfter.expired,
});
assert(
  !walledCreate.allowed && walledCreate.code === "starter_trial_ended",
  "trial end blocks another client 15 days after cutover",
);
assert(
  !noPlanTrialClock({
    enforced: false,
    noPlan: true,
    startedAt: oldFirmCreated,
    now: new Date(cutoverMs + 15 * day),
  }).expired,
  "an exempt firm stays open after cutover",
);
const signedUpAfter = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: new Date(cutoverMs + 2 * day).toISOString(),
  now: new Date(cutoverMs + 16 * day),
});
assert(signedUpAfter.expired, "a firm created after cutover expires 14 days after signup");
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

const qaNow = new Date(cutoverMs + day);
const overrideFifteen = new Date(qaNow.getTime() - 15 * day).toISOString();
const overridden = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: oldFirmCreated,
  startOverride: overrideFifteen,
  now: qaNow,
});
assert(overridden.expired && overridden.daysLeft === 0, "an override 15 days ago has no days left");
const overrideWall = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 1,
  starterTrialExpired: overridden.expired,
});
assert(
  !overrideWall.allowed && overrideWall.code === "starter_trial_ended",
  "an override 15 days ago shows the day-14 wall",
);
assert(
  showStarterTrialEndedCopy("none", overridden.expired),
  "an override 15 days ago shows the trial-ended copy",
);
assert(
  starterTrialBlocksGeneration("generate_advisory_pack", overridden.expired) &&
    starterTrialBlocksGeneration("brain_propose", overridden.expired) &&
    starterTrialBlocksGeneration("brain_deliverable_draft", overridden.expired),
  "an override 15 days ago blocks generation",
);
const nullOverride = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: oldFirmCreated,
  startOverride: null,
  now: qaNow,
});
assert(
  !nullOverride.expired && nullOverride.daysLeft === dayAfterCutover.daysLeft,
  "a null override keeps the cutover clock",
);
assert(
  !noPlanTrialClock({
    enforced: false,
    noPlan: true,
    startedAt: oldFirmCreated,
    startOverride: overrideFifteen,
    now: qaNow,
  }).expired,
  "an exempt firm stays open with an override",
);

const paidAgents = GENERATION_ENTRIES.filter((entry) => entry.paid);
assert(paidAgents.length > 0, "agents that create work are listed");
for (const entry of paidAgents) {
  assert(starterTrialBlocksGeneration(entry.id, true), `${entry.id} is blocked after the trial`);
}
assert(!starterTrialBlocksGeneration("ask_ai", true), "Ask AI is not on the paid-generation list");
assert(!starterTrialBlocksGeneration("milon_bot_qa", true), "Bot Q&A is not on the paid-generation list");

const pastDay14 = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: new Date(cutoverMs + 2 * day).toISOString(),
  now: new Date(cutoverMs + 17 * day),
});
assert(pastDay14.expired, "a cardless firm is past day 14");
const refusedCreate = decideFirmClientCreate({
  stripeConfigured: true,
  phase: "none",
  band: null,
  clientCount: 1,
  starterTrialExpired: pastDay14.expired,
});
assert(
  !refusedCreate.allowed && refusedCreate.code === "starter_trial_ended",
  "adding a new client is refused after day 14",
);
for (const entry of paidAgents) {
  assert(
    starterTrialBlocksGeneration(entry.id, pastDay14.expired),
    `${entry.id} is refused for a cardless firm past day 14`,
  );
}
const refusedAi = await cardlessTrialAiBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-cardless" }, error: null },
    firms: {
      data: { precard_cap_applies: true, starter_trial_generation_blocked: true },
      error: null,
    },
  }),
  clientId: "client-1",
});
assert(
  refusedAi?.code === "starter_trial_ended",
  "Ask AI and Milōn Bot are refused for a cardless firm past day 14",
);
assert(
  decideFirmUpgradeRoute({ hasEntitlingSubscription: false, hasPaymentMethod: false }) === "checkout",
  "a cardless firm past day 14 is sent to Checkout",
);
const checkout = firmSignupCheckoutIntent("us");
const wallHtml = renderToStaticMarkup(
  createElement(BillingRequiredCard, {
    planName: "Starter",
    priceLabel: "$39/mo",
    checkout,
    trialEnded: true,
  }),
);
assert(wallHtml.includes(FIRM_WALL_START_LABEL), "the billing wall shows the Checkout action");
const checkoutHref = billingStartPath(checkout).replaceAll("&", "&amp;");
assert(
  wallHtml.includes(`href="${checkoutHref}"`) && wallHtml.includes('data-billing-action="trial"'),
  "the Checkout action opens Checkout",
);
const endedHtml = renderToStaticMarkup(
  createElement(TrialEndedPlanCard, {
    upgrade: {
      band: null,
      interval: "month",
      priceCurrency: "USD",
      canUpgrade: true,
      clientCount: 1,
      phase: "none",
    },
    onUpgrade: () => undefined,
  }),
);
assert(endedHtml.includes(upgradeButtonLabel("starter")), "adding a client shows the Checkout button");

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

const qaOverride = new Date(Date.now() - 15 * 86_400_000).toISOString();
const qaFirm = {
  precard_cap_applies: true,
  starter_trial_generation_blocked: false,
  starter_trial_enforced: true,
  billing_plan_known: null,
  created_at: oldFirmCreated,
  trial_clock_start_override: qaOverride,
};
const qaBlocked = await cardlessTrialAiBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-qa" }, error: null },
    firms: { data: qaFirm, error: null },
  }),
  clientId: "client-1",
});
assert(qaBlocked?.code === "starter_trial_ended", "Ask AI blocks when the QA clock is 15 days ago");
const qaPaid = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-qa" }, error: null },
    firms: { data: qaFirm, error: null },
  }),
  userId: "user-1",
  clientId: "client-1",
});
assert(qaPaid?.code === "starter_trial_ended", "paid generation blocks when the QA clock is 15 days ago");
const qaNull = await cardlessTrialAiBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-qa" }, error: null },
    firms: {
      data: { ...qaFirm, trial_clock_start_override: null },
      error: null,
    },
  }),
  clientId: "client-1",
});
assert(qaNull == null, "a null override leaves the Q&A gate on the mirror");
const qaEntitled = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm-ben" }, error: null },
    firms: {
      data: { ...qaFirm, billing_plan_known: "entitled" },
      error: null,
    },
  }),
  userId: "user-1",
  clientId: "client-1",
});
assert(qaEntitled == null, "a stored entitled plan stays open when a QA override is set");

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const capServer = read("src/lib/firm-client-cap.server.ts");
assert(capServer.includes("noPlanTrialClock"), "the live trial banner uses the no-plan clock");
assert(
  capServer.includes("created_at"),
  "the no-plan clock reads the firm row start",
);
assert(
  capServer.includes("startOverride: firm.trialClockStartOverride"),
  "the live clock and the mirror sync use the QA start",
);
assert(
  capServer.includes("writeStarterTrialGenerationBlock"),
  "the mirror sync writes the generation flag from that clock",
);
const clockMigration = read("supabase/migrations/20261021180000_firm_trial_clock_start_override.sql");
assert(
  clockMigration.includes("ADD COLUMN IF NOT EXISTS trial_clock_start_override timestamptz"),
  "migration adds the nullable QA clock start",
);
assert(
  clockMigration.includes(
    "trial_clock_start_override is a QA-only tool: it is only ever set (by service role/SQL, with CoS approval) on AQA throwaway firms, never on real customer firms.",
  ),
  "the column comment limits the override to AQA throwaway firms",
);
assert(
  clockMigration.includes("NEW.trial_clock_start_override := NULL") &&
    clockMigration.includes("NEW.trial_clock_start_override := OLD.trial_clock_start_override"),
  "signed-in users cannot set the QA clock start",
);
assert(!/\bGRANT\b/i.test(clockMigration), "the migration grants nothing new");
assert(!/UPDATE\s+public\.firms/i.test(clockMigration), "the migration does not backfill firm rows");
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
assert(
  practice.includes('cap.code === "starter_trial_ended"') && practice.includes("TrialEndedPlanBlock"),
  "refusing a new client shows the plan card that opens Checkout",
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
