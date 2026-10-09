/**
 * Pre-card AI allowance: no card under and at the limit, a card firm is
 * unaffected, and the counter moves only after a successful answer.
 * Run: pnpm test:precard-cap
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrecardCapCard } from "../src/components/precard-cap-card";
import { parseAskAiBody } from "../src/lib/ask-ai-response";
import {
  EMPTY_PRECARD_USAGE,
  PRECARD_BOT_LIMIT,
  PRECARD_CAP_CODE,
  PRECARD_CAP_MESSAGE,
  PRECARD_EMAIL_LIMIT,
  PRECARD_PACK_LIMIT,
  decidePrecardAllowance,
  finishPrecardAttempt,
  isPrecardCapFailure,
  normalizePrecardTurnId,
  precardBotRemainingLabel,
  precardCapApplies,
  precardCapError,
  precardCapReason,
  type PrecardLimitKind,
  type PrecardUsage,
} from "../src/lib/precard-cap";
import {
  precardMessagesLeft,
  readPrecardGate,
  recordPrecardUse,
} from "../supabase/functions/_shared/precard-cap-gate.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function usage(partial: Partial<PrecardUsage>): PrecardUsage {
  return { ...EMPTY_PRECARD_USAGE, ...partial };
}

assert(precardCapApplies({ stripeConfigured: false, phase: "none" }) === false, "no Stripe key does not invent a cap");
assert(precardCapApplies({ stripeConfigured: true, phase: "none" }) === true, "no card applies the cap");
assert(precardCapApplies({ stripeConfigured: true, phase: "trialing" }) === false, "a trial card is not capped");
assert(precardCapApplies({ stripeConfigured: true, phase: "active" }) === false, "a paid card is not capped");

for (const kind of ["pack", "email", "bot"] as const) {
  const under = decidePrecardAllowance({ applies: true, kind, usage: EMPTY_PRECARD_USAGE });
  assert(under.allowed && under.applies, `${kind} under the limit is allowed`);
  const at = decidePrecardAllowance({
    applies: true,
    kind,
    usage: usage({
      packGenerations: PRECARD_PACK_LIMIT,
      emailDrafts: PRECARD_EMAIL_LIMIT,
      botMessages: PRECARD_BOT_LIMIT,
    }),
  });
  assert(!at.allowed && at.limit === kind && at.code === PRECARD_CAP_CODE, `${kind} at the limit is blocked`);
  assert(at.message === PRECARD_CAP_MESSAGE, `${kind} uses the card sentence`);
}

const nine = decidePrecardAllowance({
  applies: true,
  kind: "bot",
  usage: usage({ botMessages: PRECARD_BOT_LIMIT - 1 }),
});
assert(nine.allowed && nine.applies && nine.remaining === 1, "the 10th Bot message is still open");

const cardFirm = decidePrecardAllowance({
  applies: false,
  kind: "bot",
  usage: usage({ botMessages: 40, packGenerations: 4, emailDrafts: 4 }),
});
assert(cardFirm.allowed && cardFirm.applies === false, "a card firm is unaffected by the counters");

let writes = 0;
const open = decidePrecardAllowance({ applies: true, kind: "email", usage: EMPTY_PRECARD_USAGE });
assert(
  (await finishPrecardAttempt({
    decision: open,
    succeeded: false,
    record: async () => {
      writes += 1;
    },
  })) === "skipped" && writes === 0,
  "a failed draft does not increment",
);
assert(
  (await finishPrecardAttempt({
    decision: open,
    succeeded: true,
    record: async () => {
      writes += 1;
    },
  })) === "recorded" && writes === 1,
  "a successful draft increments once",
);
assert(
  (await finishPrecardAttempt({
    decision: cardFirm,
    succeeded: true,
    record: async () => {
      writes += 1;
    },
  })) === "skipped" && writes === 1,
  "a card firm success does not increment",
);
const blocked = decidePrecardAllowance({
  applies: true,
  kind: "pack",
  usage: usage({ packGenerations: 1 }),
});
assert(
  (await finishPrecardAttempt({
    decision: blocked,
    succeeded: true,
    record: async () => {
      writes += 1;
    },
  })) === "blocked" && writes === 1,
  "a blocked pack does not increment",
);

assert(precardBotRemainingLabel(3) === "3 Bot messages left before trial", "plural remaining copy");
assert(precardBotRemainingLabel(2) === "2 Bot messages left before trial", "two left still counts");
assert(
  precardBotRemainingLabel(1) === "This is your last free Bot question.",
  "one left is the last-question hint",
);
assert(precardBotRemainingLabel(0) === null, "zero remaining stays quiet");
assert(precardBotRemainingLabel(0.4) === null, "a fraction under 1 stays quiet");
for (let used = 0; used < PRECARD_BOT_LIMIT; used += 1) {
  const left = precardMessagesLeft(used, PRECARD_BOT_LIMIT - used + 1);
  assert(left === PRECARD_BOT_LIMIT - used, `after ${used} answers, ${PRECARD_BOT_LIMIT - used} remain`);
  assert(precardBotRemainingLabel(left!) != null, `counter stays visible at ${left}`);
}
assert(precardMessagesLeft(9, 2) === 1, "after question 9, one question is left");
assert(
  precardBotRemainingLabel(precardMessagesLeft(9, 2)!) === "This is your last free Bot question.",
  "the ninth answer shows the last-question line",
);
assert(precardMessagesLeft(null, 2) === 1, "a missing counter still shows the last question");
assert(precardMessagesLeft(PRECARD_BOT_LIMIT, 1) === null, "the used-up allowance is not a counter");
assert(precardMessagesLeft(null, 1) === null, "the answer that spends the last question does not invent a zero");
assert(isPrecardCapFailure(precardCapError("pack")), "the thrown cap is recognised");
assert(isPrecardCapFailure(new Error(PRECARD_CAP_MESSAGE)), "the sentence is recognised");
assert(!isPrecardCapFailure(new Error("Could not draft advisory")), "other errors are not the cap");

type Row = Record<string, unknown>;

function fakeDb(rows: Record<string, { data: Row | null; error: string | null }>, rpc?: (kind: string) => number) {
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
    async rpc(_fn: string, args: { p_kind: string }) {
      if (!rpc) return { data: null, error: { message: "missing rpc" } };
      return { data: rpc(args.p_kind), error: null };
    },
  };
}

const noCard = await readPrecardGate({
  db: fakeDb({
    clients: { data: { firm_id: "firm_new" }, error: null },
    firms: {
      data: {
        precard_cap_applies: true,
        precard_pack_generations: 0,
        precard_email_drafts: 0,
        precard_bot_messages: 9,
      },
      error: null,
    },
  }),
  clientId: "client_1",
  kind: "bot",
});
assert(noCard.allowed && noCard.applies && noCard.remaining === 1, "edge allows the last Bot message");

const capped = await readPrecardGate({
  db: fakeDb({
    clients: { data: { firm_id: "firm_new" }, error: null },
    firms: {
      data: {
        precard_cap_applies: true,
        precard_pack_generations: 1,
        precard_email_drafts: 0,
        precard_bot_messages: 0,
      },
      error: null,
    },
  }),
  clientId: "client_1",
  kind: "pack",
});
assert(!capped.allowed && capped.limit === "pack", "edge blocks the second pack");

for (const kind of ["email", "bot"] as PrecardLimitKind[]) {
  const other = await readPrecardGate({
    db: fakeDb({
      clients: { data: { firm_id: "firm_new" }, error: null },
      firms: {
        data: {
          precard_cap_applies: true,
          precard_pack_generations: 1,
          precard_email_drafts: 0,
          precard_bot_messages: 0,
        },
        error: null,
      },
    }),
    clientId: "client_1",
    kind,
  });
  assert(other.allowed, `a used pack does not block ${kind}`);
}

const paying = await readPrecardGate({
  db: fakeDb({
    clients: { data: { firm_id: "firm_paid" }, error: null },
    firms: {
      data: {
        precard_cap_applies: false,
        precard_pack_generations: 9,
        precard_email_drafts: 9,
        precard_bot_messages: 90,
      },
      error: null,
    },
  }),
  clientId: "client_1",
  kind: "bot",
});
assert(paying.allowed && paying.applies === false, "a card firm mirror is not capped");

const unsynced = await readPrecardGate({
  db: fakeDb({
    clients: { data: { firm_id: "firm_paid" }, error: null },
    firms: { data: { precard_cap_applies: null, precard_bot_messages: 90 }, error: null },
  }),
  clientId: "client_1",
  kind: "bot",
});
assert(unsynced.allowed && unsynced.applies === false, "an unsynced mirror fails open");

const missing = await readPrecardGate({
  db: fakeDb({
    clients: { data: { firm_id: "firm_paid" }, error: null },
    firms: { data: null, error: "column precard_cap_applies does not exist" },
  }),
  clientId: "client_1",
  kind: "bot",
});
assert(missing.allowed, "a missing column fails open");

let recordedKind = "";
const db = fakeDb(
  {
    clients: { data: { firm_id: "firm_new" }, error: null },
    firms: { data: { precard_cap_applies: true, precard_bot_messages: 0 }, error: null },
  },
  (kind) => {
    recordedKind = kind;
    return 1;
  },
);
const gate = await readPrecardGate({ db, clientId: "client_1", kind: "bot" });
assert(
  (await finishPrecardAttempt({
    decision: gate,
    succeeded: false,
    record: async () => {
      await recordPrecardUse(db, gate.firmId ?? "", "bot");
    },
  })) === "skipped" && recordedKind === "",
  "edge does not increment a failed Bot answer",
);
assert(
  (await finishPrecardAttempt({
    decision: gate,
    succeeded: true,
    record: async () => {
      await recordPrecardUse(db, gate.firmId ?? "", "bot");
    },
  })) === "recorded" && recordedKind === "bot",
  "edge increments a successful Bot answer",
);

const boundClient = {
  rest: { ok: true },
  async rpc(this: { rest?: { ok: boolean } }, _fn: string, _args: Record<string, unknown>) {
    if (!this?.rest) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    return { data: 4, error: null };
  },
};
assert(
  (await recordPrecardUse(boundClient, "firm_new", "bot")) === 4,
  "recordPrecardUse keeps rpc bound and returns the counter",
);

const throwingClient = {
  async rpc(_fn: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    throw new TypeError("Cannot read properties of undefined (reading 'rest')");
  },
};
assert(
  (await recordPrecardUse(throwingClient, "firm_new", "bot")) === null,
  "a throwing rpc returns null",
);

const bubble = parseAskAiBody(
  403,
  { error: PRECARD_CAP_MESSAGE, code: PRECARD_CAP_CODE, limit: "bot" },
  false,
);
assert(bubble.ok && bubble.precardCap?.limit === "bot", "a capped Bot reply is not an error turn");
assert(bubble.ok && bubble.answer === PRECARD_CAP_MESSAGE, "the Bot bubble uses the card sentence");
const ordinary = parseAskAiBody(403, { error: "Client not accessible" }, false);
assert(!ordinary.ok, "a normal 403 stays an error");

const html = renderToStaticMarkup(createElement(PrecardCapCard));
assert(html.includes(PRECARD_CAP_MESSAGE), "the card shows the trial sentence");
assert(html.includes("Add a card"), "the card has one primary action");
assert(html.includes("/billing/start?"), "the button uses the existing Checkout path");
assert(!/claude/i.test(html), "the card does not name a model vendor");
assert(!html.includes("ZAR") && !html.includes("50%"), "the card does not show rand or the SA discount");

const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
assert(widget.includes("precard-cap-card"), "the Bot paints the cap as a reply bubble");
assert(widget.includes("precardCap"), "the Bot keeps the cap off the error path");
assert(widget.includes("precardCapReason"), "the cap reason uses the shared helper");
assert(!widget.includes("You've used your 10"), "the Bot widget does not hardcode the allowance");
const reasonSrc = readFileSync(resolve("src/lib/precard-cap.ts"), "utf8");
const reasonFn = reasonSrc.slice(
  reasonSrc.indexOf("export function precardCapReason"),
  reasonSrc.indexOf("export function normalizePrecardTurnId"),
);
assert(reasonFn.includes("precardLimitFor"), "the reason count comes from the configured cap");
assert(!reasonFn.includes("You've used your 10"), "the reason helper does not hardcode 10");
assert(
  precardCapReason("bot") === `You've used your ${PRECARD_BOT_LIMIT} free Bot questions.`,
  "bot reason follows the Bot limit",
);
assert(normalizePrecardTurnId("turn-1234-abcd") === "turn-1234-abcd", "a retry token is kept");
assert(normalizePrecardTurnId("no") === null, "a short token is not an idempotency key");
assert(
  normalizePrecardTurnId("11111111-2222-4333-8444-555555555555") ===
    "11111111-2222-4333-8444-555555555555",
  "a uuid turn id is kept",
);

let charges = 0;
const seen = new Set<string>();
const idempotent = {
  async rpc(fn: string, args: { p_turn_id?: string }) {
    if (fn === "increment_precard_usage_once") {
      const token = String(args.p_turn_id ?? "");
      if (seen.has(token)) return { data: charges, error: null };
      seen.add(token);
      charges += 1;
      return { data: charges, error: null };
    }
    charges += 1;
    return { data: charges, error: null };
  },
};
assert(
  (await recordPrecardUse(idempotent, "firm_new", "bot", "11111111-2222-4333-8444-555555555555")) === 1,
  "the first successful answer charges once",
);
assert(
  (await recordPrecardUse(idempotent, "firm_new", "bot", "11111111-2222-4333-8444-555555555555")) === 1,
  "a retry of the same turn does not charge again",
);
assert(charges === 1, "the counter moved once");

let plainCharges = 0;
const missingOnce = {
  async rpc(fn: string) {
    if (fn === "increment_precard_usage_once") {
      return {
        data: null,
        error: { message: "Could not find the function public.increment_precard_usage_once in the schema cache" },
      };
    }
    plainCharges += 1;
    return { data: plainCharges, error: null };
  },
};
assert(
  (await recordPrecardUse(missingOnce, "firm_new", "bot", "22222222-2222-4333-8444-555555555555")) === 1,
  "a missing idempotent rpc still records the successful answer",
);

const ask = readFileSync(resolve("supabase/functions/ask-ai/index.ts"), "utf8");
assert(ask.includes("normalizePrecardTurnId"), "ask-ai keys the charge to the client turn");
assert(
  ask.includes("precard.firmId && answer.trim()"),
  "ask-ai charges only after a non-empty answer",
);
const bot = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
assert(bot.includes("modelAnswer"), "milon-bot does not charge the failure fallback");
assert(bot.includes("normalizePrecardTurnId"), "milon-bot keys the charge to the client turn");
const idempotentSql = readFileSync(
  resolve("supabase/migrations/20261008223000_precard_turn_idempotency.sql"),
  "utf8",
);
assert(idempotentSql.includes("ON CONFLICT (firm_id, turn_id) DO NOTHING"), "a repeated turn id does not insert twice");
assert(idempotentSql.includes("service_role"), "only the service role records a turn");
const migration = readFileSync(
  resolve("supabase/migrations/20261008170000_firm_precard_ai_usage.sql"),
  "utf8",
);
assert(migration.includes("auth.role() IS DISTINCT FROM 'authenticated'"), "signed-in users cannot reset the counters");
assert(migration.includes("service_role"), "only the service role increments");

console.log("precard-cap-test: ok");
