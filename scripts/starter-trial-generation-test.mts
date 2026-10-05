/**
 * Ended-Starter gating: which generation entry points refuse work,
 * the shared upgrade card, and the edge-function twin of the check.
 * Run: pnpm test:starter-trial-generation
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrialEndedPlanCard } from "../src/components/trial-ended-plan-block";
import { SA_FIRM_DISCOUNT_NOTE } from "../src/lib/firm-sa-market";
import { STARTER_TRIAL_ENDED_MESSAGE } from "../src/lib/firm-starter-trial";
import { attentionCountPhrase, portfolioSummaryLine } from "../src/lib/portfolio-dashboard";
import {
  GENERATION_ENTRIES,
  isStarterTrialEndedMessage,
  messageFromUnknown,
  starterTrialBlocksGeneration,
} from "../src/lib/starter-trial-generation";
import {
  paidGenerationTrialBlock,
  trialBannerFromStripeList,
} from "../supabase/functions/_shared/starter-trial-gate.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const paid = GENERATION_ENTRIES.filter((entry) => entry.paid).map((entry) => entry.id);
const open = GENERATION_ENTRIES.filter((entry) => !entry.paid).map((entry) => entry.id);

assert(paid.length > 0 && open.length > 0, "the catalog has both paid and open entries");
assert(new Set(GENERATION_ENTRIES.map((entry) => entry.id)).size === GENERATION_ENTRIES.length, "entry ids are unique");

for (const id of paid) {
  assert(starterTrialBlocksGeneration(id, true), `${id} is blocked after the trial ends`);
  assert(!starterTrialBlocksGeneration(id, false), `${id} is allowed while the trial is open`);
}
for (const id of open) {
  assert(!starterTrialBlocksGeneration(id, true), `${id} stays open after the trial ends`);
  assert(!starterTrialBlocksGeneration(id, false), `${id} stays open during the trial`);
}
assert(
  open.includes("milon_bot_qa") && open.includes("ask_ai"),
  "Milōn Bot Q&A and Ask AI stay ungated",
);
assert(
  paid.includes("brain_propose") &&
    paid.includes("draft_advisory_client_email") &&
    paid.includes("brain_deliverable_draft") &&
    paid.includes("generate_advisory_pack") &&
    paid.includes("milon_bot_create"),
  "the leaked generation paths are paid",
);

assert(attentionCountPhrase(1) === "1 client needs attention.", "one client needs attention");
assert(attentionCountPhrase(2) === "2 clients need attention.", "two clients need attention");
assert(attentionCountPhrase(0) === "0 clients need attention.", "zero uses the plural");
assert(
  portfolioSummaryLine({ clientCount: 4, needAttention: 1, avgHealth: 70 }) ===
    "1 client needs attention.",
  "the dashboard line pluralises a single client",
);
assert(
  portfolioSummaryLine({ clientCount: 4, needAttention: 3, avgHealth: 70 }) ===
    "3 clients need attention.",
  "the dashboard line pluralises several clients",
);

assert(messageFromUnknown(new Error("plain")) === "plain", "Error messages pass through");
assert(messageFromUnknown({ message: "wrapped" }) === "wrapped", "object messages pass through");
assert(messageFromUnknown({ error: "edge" }) === "edge", "edge error strings pass through");
assert(
  messageFromUnknown({ cause: { message: STARTER_TRIAL_ENDED_MESSAGE } }) ===
    STARTER_TRIAL_ENDED_MESSAGE,
  "nested causes are unwrapped",
);
assert(isStarterTrialEndedMessage(STARTER_TRIAL_ENDED_MESSAGE), "the ended sentence is recognised");
assert(isStarterTrialEndedMessage("blocked: starter_trial_ended"), "the ended code is recognised");
assert(!isStarterTrialEndedMessage("Could not draft advisory"), "other errors are not the trial");

const now = new Date("2026-10-05T12:00:00.000Z");
const started = Math.floor(Date.parse("2026-09-01T12:00:00.000Z") / 1000);
const trialEnd = Math.floor(Date.parse("2026-09-15T12:00:00.000Z") / 1000);

function price(lookup: string) {
  return {
    id: `price_${lookup}`,
    lookup_key: lookup,
    unit_amount: lookup.includes("starter") ? 0 : 9900,
    currency: "usd",
    recurring: { interval: "month" },
  };
}

function subscription(id: string, lookup: string, status: string) {
  return {
    id,
    status,
    created: started,
    start_date: started,
    trial_end: lookup.includes("starter") ? trialEnd : null,
    metadata: { milon_plan: lookup.includes("starter") ? "starter" : "solo" },
    items: { data: [{ id: `si_${id}`, price: price(lookup) }] },
  };
}

const expired = trialBannerFromStripeList({
  enforced: true,
  subscriptions: [subscription("sub_starter", "milon_starter_monthly", "active")],
  now,
});
assert(expired.expired, "an enforced Starter past trial_end is expired");
const paidBand = trialBannerFromStripeList({
  enforced: true,
  subscriptions: [subscription("sub_solo", "milon_solo_monthly", "active")],
  now,
});
assert(!paidBand.expired, "a paid band is not an ended Starter trial");
const exempt = trialBannerFromStripeList({
  enforced: false,
  subscriptions: [subscription("sub_starter", "milon_starter_monthly", "active")],
  now,
});
assert(!exempt.expired, "an exempt firm is not expired");

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
                  return {
                    data: row.data,
                    error: row.error ? { message: row.error } : null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

const calls: string[] = [];
const fetchImpl = (async (url: string) => {
  calls.push(url);
  if (String(url).includes("/customers?")) {
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "cus_qa" }] }) };
  }
  if (String(url).includes("/subscriptions?")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [subscription("sub_starter", "milon_starter_monthly", "active")],
      }),
    };
  }
  return { ok: false, status: 500, json: async () => ({ error: { message: "nope" } }) };
}) as typeof fetch;

const enforcedFirm = fakeDb({
  clients: { data: { firm_id: "firm_qa" }, error: null },
  firms: {
    data: { id: "firm_qa", owner_user_id: "user_1", starter_trial_enforced: true },
    error: null,
  },
});

const blocked = await paidGenerationTrialBlock({
  db: enforcedFirm,
  userId: "user_1",
  email: "owner@qa.test",
  clientId: "client_1",
  now,
  stripeSecret: "sk_test_gate",
  fetchImpl,
});
assert(blocked?.code === "starter_trial_ended", "the edge gate blocks an ended enforced trial");
assert(blocked?.message === STARTER_TRIAL_ENDED_MESSAGE, "the edge gate uses the ended sentence");
assert(calls.length === 2, "the edge gate looks up the customer and the subscriptions");

calls.length = 0;
const openFirm = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_old" }, error: null },
    firms: {
      data: { id: "firm_old", owner_user_id: "user_1", starter_trial_enforced: false },
      error: null,
    },
  }),
  userId: "user_1",
  email: "owner@qa.test",
  clientId: "client_1",
  now,
  stripeSecret: "sk_test_gate",
  fetchImpl,
});
assert(openFirm == null, "an exempt firm is not blocked");
assert(calls.length === 0, "an exempt firm does not call billing");

const noSecret = await paidGenerationTrialBlock({
  db: enforcedFirm,
  userId: "user_1",
  email: "owner@qa.test",
  clientId: "client_1",
  now,
  stripeSecret: "",
  fetchImpl,
});
assert(noSecret == null, "a missing billing secret fails open");

let threw = false;
try {
  await paidGenerationTrialBlock({
    db: enforcedFirm,
    userId: "user_1",
    email: "owner@qa.test",
    clientId: "client_1",
    now,
    stripeSecret: "sk_test_gate",
    fetchImpl: (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "billing down" } }),
    })) as typeof fetch,
  });
} catch (err) {
  threw = messageFromUnknown(err).includes("billing down");
}
assert(threw, "a failed billing lookup does not generate");

const missingColumn = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_qa" }, error: null },
    firms: { data: null, error: "column starter_trial_enforced does not exist" },
  }),
  userId: "user_1",
  email: "owner@qa.test",
  clientId: "client_1",
  now,
  stripeSecret: "sk_test_gate",
  fetchImpl,
});
assert(missingColumn == null, "a missing trial column fails open");

function read(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const gates: Array<[string, string]> = [
  ["src/lib/advisory.functions.ts", "assertStarterTrialAllowsNewWork"],
  ["src/lib/advisory-pack.functions.ts", "assertStarterTrialAllowsNewWork"],
  ["src/lib/client-briefing.functions.ts", "assertStarterTrialAllowsNewWork"],
  ["supabase/functions/brain-propose/index.ts", "paidGenerationTrialBlock"],
  ["supabase/functions/brain-deliverable-draft/index.ts", "paidGenerationTrialBlock"],
  ["supabase/functions/milon-bot/persist.ts", "paidGenerationTrialBlock"],
];
for (const [path, needle] of gates) {
  assert(read(path).includes(needle), `${path} gates paid generation`);
}
for (const path of [
  "supabase/functions/brain-propose/index.ts",
  "supabase/functions/brain-deliverable-draft/index.ts",
  "supabase/functions/milon-bot/index.ts",
  "src/components/client-brain-summary.tsx",
  "src/routes/_authenticated/clients.$clientId.tsx",
]) {
  assert(!read(path).toLowerCase().includes("stripe"), `${path} does not name billing`);
}
assert(
  !read("supabase/functions/milon-bot/index.ts").includes("paidGenerationTrialBlock"),
  "the bot entry file stays free of the billing gate import",
);
assert(
  !read("supabase/functions/ask-ai/index.ts").includes("paidGenerationTrialBlock") &&
    !read("supabase/functions/ask-ai/index.ts").includes("assertStarterTrialAllowsNewWork"),
  "Ask AI Q&A is not gated",
);
assert(
  read("src/components/client-brain-summary.tsx").includes("TrialEndedActionNotice"),
  "Client Brain surfaces the trial block",
);
assert(
  read("src/components/recommendations-panel.tsx").includes("TrialEndedActionNotice"),
  "Propose from brain surfaces the trial block",
);
assert(
  read("src/components/advisory-pack-panel.tsx").includes('label === "generate"') &&
    read("src/components/advisory-pack-panel.tsx").includes("TrialEndedActionNotice"),
  "Generate pack surfaces the trial block",
);
assert(
  read("src/components/advisory-drafter.tsx").includes("TrialEndedActionNotice"),
  "the advisory drafter surfaces the trial block",
);
assert(
  read("src/lib/ask-ai.js").includes("milon-starter-trial-ended"),
  "Milōn Bot create tells the page to open the plan picker",
);
assert(
  !read("src/routes/_authenticated/settings.index.tsx").includes("SA_FIRM_DISCOUNT_NOTE"),
  "Settings → Plan does not repeat the South Africa note",
);

const upgrade = {
  band: "starter" as const,
  interval: "month" as const,
  priceCurrency: "USD" as const,
  canUpgrade: true,
  clientCount: 1,
  saDiscount: false,
};
const usCard = renderToStaticMarkup(createElement(TrialEndedPlanCard, { upgrade, onUpgrade: () => undefined }));
assert(usCard.includes(STARTER_TRIAL_ENDED_MESSAGE), "the card states that the trial has ended");
assert(
  (usCard.match(/trial-ended-title/g) ?? []).length === 1,
  "the ended title is shown once",
);
assert(!usCard.includes(SA_FIRM_DISCOUNT_NOTE), "a US card has no South Africa note");
assert(!usCard.includes("50% off"), "a US card has no discount text");
const saCard = renderToStaticMarkup(
  createElement(TrialEndedPlanCard, {
    upgrade: { ...upgrade, saDiscount: true },
    onUpgrade: () => undefined,
  }),
);
assert(
  saCard.split(SA_FIRM_DISCOUNT_NOTE).length - 1 === 1,
  "an SA card shows the South Africa note once",
);
assert(
  (saCard.match(/trial-ended-title/g) ?? []).length === 1,
  "an SA card still shows the ended title once",
);

console.log("starter-trial-generation ok");
