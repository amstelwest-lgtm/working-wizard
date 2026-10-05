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
import { paidGenerationTrialBlock } from "../supabase/functions/_shared/starter-trial-gate.ts";

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

const blocked = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_qa" }, error: null },
    firms: {
      data: {
        id: "firm_qa",
        starter_trial_enforced: true,
        starter_trial_generation_blocked: true,
      },
      error: null,
    },
  }),
  userId: "user_1",
  email: "owner@qa.test",
  clientId: "client_1",
});
assert(blocked?.code === "starter_trial_ended", "the edge gate blocks when the mirror says the trial ended");
assert(blocked?.message === STARTER_TRIAL_ENDED_MESSAGE, "the edge gate uses the ended sentence");

const unsynced = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_qa" }, error: null },
    firms: {
      data: {
        id: "firm_qa",
        starter_trial_enforced: true,
        starter_trial_generation_blocked: null,
      },
      error: null,
    },
  }),
  userId: "user_1",
  clientId: "client_1",
});
assert(unsynced == null, "a mirror that has never been written fails open");

const paying = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_paid" }, error: null },
    firms: {
      data: {
        id: "firm_paid",
        starter_trial_enforced: true,
        starter_trial_generation_blocked: false,
      },
      error: null,
    },
  }),
  userId: "user_1",
  clientId: "client_1",
});
assert(paying == null, "a synced paying firm is not blocked");

const exempt = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_old" }, error: null },
    firms: {
      data: {
        id: "firm_old",
        starter_trial_enforced: false,
        starter_trial_generation_blocked: true,
      },
      error: null,
    },
  }),
  userId: "user_1",
  clientId: "client_1",
});
assert(exempt == null, "an exempt firm is not blocked");

let threw = false;
try {
  await paidGenerationTrialBlock({
    db: fakeDb({
      clients: { data: null, error: "database unavailable" },
      firms: { data: null, error: null },
    }),
    userId: "user_1",
    clientId: "client_1",
  });
} catch (err) {
  threw = messageFromUnknown(err).includes("database unavailable");
}
assert(threw, "a failed firm read does not generate");

const missingColumn = await paidGenerationTrialBlock({
  db: fakeDb({
    clients: { data: { firm_id: "firm_qa" }, error: null },
    firms: { data: null, error: "column starter_trial_generation_blocked does not exist" },
  }),
  userId: "user_1",
  clientId: "client_1",
});
assert(missingColumn == null, "a missing mirror column fails open");

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
const gateSrc = read("supabase/functions/_shared/starter-trial-gate.ts");
assert(!gateSrc.toLowerCase().includes("stripe"), "the edge gate does not call billing");
assert(
  gateSrc.includes("starter_trial_generation_blocked"),
  "the edge gate reads the generation mirror",
);
assert(
  read("src/lib/stripe-checkout.functions.ts").includes("syncStarterTrialMirrorForActor"),
  "entitlement resolve writes the mirror",
);
assert(
  read("src/lib/stripe-billing-sync.server.ts").includes("syncStarterTrialMirrorForActor"),
  "checkout return and the webhook write the mirror",
);
assert(
  read("src/lib/firm-client-cap.server.ts").includes("writeStarterTrialGenerationBlock"),
  "the live Stripe check also writes the mirror",
);
assert(
  read("src/lib/advisory.functions.ts").includes("assertStarterTrialAllowsNewWork"),
  "server-side drafter keeps the Stripe check",
);
const mirrorMigration = read(
  "supabase/migrations/20261005213000_firm_starter_trial_generation_blocked.sql",
);
assert(
  mirrorMigration.includes("starter_trial_generation_blocked"),
  "migration adds the generation mirror",
);
assert(!/UPDATE\s+public\.firms/i.test(mirrorMigration), "the mirror is not backfilled");

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
assert(usCard.includes("bg-card"), "the card uses the card surface token");
assert(usCard.includes("text-foreground"), "the card title and prices use foreground text");
assert(usCard.includes("text-muted-foreground"), "the limit lines use muted text");
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
