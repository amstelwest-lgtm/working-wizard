/**
 * Owner door answers, presence, and motion clocks.
 * Empty books never invent a figure. Run: pnpm test:owner-door
 */
import { readFileSync } from "node:fs";
import { avatarRhythm } from "../src/components/owner-door/owner-rhythm.ts";
import { agentShortName } from "../src/lib/milon-team.ts";
import { emptyAgentActivity, type AgentActivitySnapshot } from "../src/lib/milon-team-activity.ts";
import {
  ownerAmount,
  ownerAnswerTiles,
  ownerTileLabel,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import type { AgentKey } from "../src/lib/milon-team-feed.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const usd = { currency: "USD" as const, locale: "en-US" };

function books(patch: Partial<OwnerBooks> = {}): OwnerBooks {
  return {
    hasBooks: false,
    ledger: null,
    revenue: null,
    priorRevenue: null,
    cogs: null,
    receivables: null,
    cashflow: null,
    openAction: null,
    actionsReady: true,
    signedBy: null,
    signedOn: null,
    market: usd,
    ...patch,
  };
}

const empty = ownerAnswerTiles(books());
for (const tile of empty) {
  assert(!/\$\s?\d/.test(tile.sentence), `empty tile has a figure: ${tile.sentence}`);
  assert(tile.signed === false, "an empty door is not signed off");
}
assert(
  empty.find((tile) => tile.id === "signed")?.sentence === "Invite your accountant to sign off.",
  "missing sign-off invites the accountant",
);
assert(
  empty.every((tile) => !/\bsigned off\b/i.test(tile.sentence)),
  "unsigned tiles do not say signed off",
);
assert(
  empty.find((tile) => tile.id === "cash")?.sentence === "Connect QuickBooks or Xero.",
  "cash asks to connect",
);

const filled = ownerAnswerTiles(
  books({
    hasBooks: true,
    ledger: "QuickBooks",
    revenue: 120000,
    priorRevenue: 100000,
    cogs: 48000,
    priorCogs: 40000,
    receivables: 18000,
    openAction: "Approve the payroll run.",
    actionsReady: true,
    signedBy: "Alex Morgan",
    signedOn: "2 Oct 2026",
    cashflow: {
      openingBalance: "80000",
      revenue: [{ amount: "5000", frequency: "recurring-weekly", startWeek: 1 }],
      expenses: [{ amount: "3000", frequency: "recurring-weekly", startWeek: 1 }],
    },
  }),
);
const cash = filled.find((tile) => tile.id === "cash");
assert(
  cash && !cash.empty && /\$\d/.test(cash.sentence.replace(/,/g, "")),
  `cash uses a real forecast (${cash?.sentence})`,
);
assert(ownerAmount(720000, ZA_MARKET).includes("\u00a0"), "grouped rand amounts do not break");
assert(
  filled.find((tile) => tile.id === "owes")?.sentence.startsWith("Customers owe"),
  "debtors come from the books",
);
assert(
  /Gross profit is/.test(filled.find((tile) => tile.id === "profit")?.sentence ?? ""),
  "profit is gross profit",
);
assert(
  filled.find((tile) => tile.id === "answer")?.sentence === "Approve the payroll run.",
  "the open action is the sentence",
);
const signed = filled.find((tile) => tile.id === "signed");
assert(
  signed?.signed === true && signed.sentence.startsWith("Alex Morgan signed off"),
  "only a named sign-off says so",
);
assert(ownerTileLabel(cash!, agentShortName).startsWith("Ask "), "ask labels use the short name");

const quiet = ownerPresence(emptyAgentActivity());
assert(
  quiet.agents.every((agent) => agent.motion === "idle"),
  "no run is idle",
);
assert(quiet.handoff === null, "no hand-off beam without a message");

function activity(patch: Partial<AgentActivitySnapshot>): AgentActivitySnapshot {
  return { ...emptyAgentActivity(), ...patch };
}

const working = ownerPresence(
  activity({
    runs: [
      {
        id: "run-1",
        agent: "analyst",
        client_id: "c",
        status: "running",
        queued_at: "2026-10-01T00:00:00.000Z",
        started_at: "2026-10-01T00:00:01.000Z",
        finished_at: null,
      },
    ],
  }),
);
assert(
  working.agents.find((agent) => agent.agent === "analyst")?.motion === "working",
  "a running job is working",
);
assert(
  working.agents.find((agent) => agent.agent === "analyst")?.sentence === "Working…",
  "working copy",
);

const found = ownerPresence(
  activity({
    runs: [
      {
        id: "run-2",
        agent: "advisor",
        client_id: "c",
        status: "succeeded",
        queued_at: "2026-10-01T00:00:00.000Z",
        started_at: "2026-10-01T00:00:01.000Z",
        finished_at: "2026-10-01T00:05:00.000Z",
      },
    ],
    findings: [
      {
        id: "find-1",
        agent: "advisor",
        client_id: "c",
        title: "Two moves are ready.",
        detail: null,
        evidence: {},
        as_of: null,
        created_at: "2026-10-01T00:04:00.000Z",
      },
    ],
  }),
);
assert(
  found.agents.find((agent) => agent.agent === "advisor")?.motion === "found",
  "a finished finding is found",
);

const handoff = ownerPresence(
  activity({
    messages: [
      {
        id: "msg-1",
        client_id: "c",
        from_agent: "analyst",
        to_agent: "advisor",
        type: "handoff",
        payload: { text: "September made less." },
        created_at: "2026-10-02T00:00:00.000Z",
      },
    ],
  }),
);
assert(
  handoff.handoff?.from === "analyst" && handoff.handoff.to === "advisor",
  "hand-off keeps both ends",
);
assert(
  handoff.agents.find((agent) => agent.agent === "analyst")?.lookAt === "advisor",
  "the sender looks across",
);

const speaking = ownerPresence(emptyAgentActivity(), {
  agent: "financial_manager",
  mode: "speaking",
});
assert(
  speaking.agents.find((agent) => agent.agent === "financial_manager")?.motion === "speaking",
  "chat can speak",
);

const clocks = (
  ["financial_manager", "analyst", "advisor"] as const satisfies readonly AgentKey[]
).map((agent) => avatarRhythm(agent));
const breathes = clocks.map((clock) => clock.breathe);
assert(new Set(breathes).size === 3, "each agent breathes on its own clock");
for (const value of breathes) {
  const seconds = Number(value.replace("s", ""));
  assert(seconds >= 4 && seconds <= 6, `breathe stays in 4–6s (${value})`);
}

const css = readFileSync("src/components/owner-door/owner-door.css", "utf8");
assert(css.includes("prefers-reduced-motion"), "reduced motion has a still pose");
assert(css.includes("tabular-nums"), "amounts use tabular numerals");
assert(css.includes("min-height: 44px"), "ask buttons meet the tap target");
const home = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(home.includes('className="owner-ask"'), "ask entry is a button");
assert(!home.includes("Milōn Financial Manager"), "the view does not hardcode a display name");
const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(!door.includes("Dana"), "the door does not use a retired name");
const prompt = readFileSync("supabase/functions/ask-ai/prompt.ts", "utf8");
assert(prompt.includes("askAiAgentPersona"), "ask-ai keeps an agent persona");
assert(!prompt.includes("Milōn Financial Manager"), "the persona does not hardcode a display name");

console.log("owner-door tests passed");
