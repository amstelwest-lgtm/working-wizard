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
import { ownerPlanFreeLine, ownerPlanLine } from "../src/lib/owner-plan.ts";
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
assert(!/#[0-9a-fA-F]{3,8}\b/.test(css), "owner door colours come from theme tokens");
assert(css.includes("var(--gold-grad)"), "ask and accents use the metallic gold gradient");
assert(css.includes("font-size: 16px"), "body text is at least 16px");
assert(css.includes("font-size: 14px"), "secondary text is at least 14px");
assert(css.includes("--owner-edge: color-mix(in srgb, var(--ink) 55%, var(--bg))"), "borders mix ink into the background");
assert(css.includes('--owner-sans: "Noto Sans", sans-serif'), "the owner shell uses the accountant sans");
assert(!css.includes("Inter"), "the owner shell does not force Inter");
const home = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(home.includes('className="btn gold owner-ask"'), "ask entry uses the metallic gold button");
assert(/\.owner-tile p \{[^}]*color: var\(--ink\)/.test(css), "tile sentences use the foreground colour");
const shell = readFileSync("src/components/owner-door/owner-shell.tsx", "utf8");
assert(shell.includes("<ThemeToggle />"), "the owner shell uses the shared theme toggle");
assert(shell.split("<ThemeToggle />").length >= 3, "the toggle sits in the header and in the menu");
assert(shell.includes('label: "Health"'), "health is on the rail");
assert(shell.includes('label: "Cash flow"'), "cash flow is on the rail");
assert(shell.includes('label: "Budget"'), "budget is on the rail");
assert(shell.includes('label: "Profit"'), "profit stays reachable");
assert(shell.includes('label: "Next moves"'), "next moves stay reachable");
assert(!shell.includes('label: "Action plan"'), "action plan is not a separate rail item");
assert(!shell.includes('label: "Actions"'), "actions is not a separate rail item");
const railLabels = [...shell.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
assert(
  railLabels.join(" | ") ===
    "Home | Health | Cash flow | Profit | Budget | Next moves | Accountant | Deliverables",
  `rail order is ${railLabels.join(" | ")}`,
);
const app = readFileSync("src/routes/app.tsx", "utf8");
assert(app.includes("<SphereHero"), "home and health reuse the health orb");
assert(app.includes("readOnly"), "cash flow and budget can be shown without editing");
assert(app.includes("Your accountant sets this up"), "an unconfigured view tells the owner who sets it up");

function channel(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const [r, g, b] = channel(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}
function mix(ink: string, bg: string, amount: number): string {
  const [ir, ig, ib] = channel(ink);
  const [br, bgc, bb] = channel(bg);
  const blend = (a: number, b: number) => Math.round(a * amount + b * (1 - amount));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(blend(ir, br))}${hex(blend(ig, bgc))}${hex(blend(ib, bb))}`;
}
function token(source: string, name: string): string {
  const found = source.match(new RegExp(`${name}:(#[0-9a-fA-F]{6})`));
  if (!found) throw new Error(`missing ${name}`);
  return found[1];
}
const portal = readFileSync("src/styles/accountant-portal.css", "utf8");
const darkBlock = portal.slice(portal.indexOf(":root{"), portal.indexOf("html[data-theme=\"light\"]"));
const lightBlock = portal.slice(portal.indexOf("html[data-theme=\"light\"]"), portal.indexOf(".accountant-portal{"));
for (const block of [darkBlock, lightBlock]) {
  const bg = token(block, "--bg");
  const ink = token(block, "--ink");
  const dim = token(block, "--ink-dim");
  assert(contrast(ink, bg) >= 4.5, `body ink on background is ${contrast(ink, bg).toFixed(2)}`);
  assert(contrast(dim, bg) >= 4.5, `secondary ink on background is ${contrast(dim, bg).toFixed(2)}`);
  const edge = mix(ink, bg, 0.55);
  assert(contrast(edge, bg) >= 3, `owner edge on background is ${contrast(edge, bg).toFixed(2)}`);
}
const goldDeep = token(darkBlock, "--gold-deep");
const gold = token(darkBlock, "--gold");
const goldBright = token(darkBlock, "--gold-bright");
const buttonInk = "#1b1300";
assert(portal.includes(`color:${buttonInk}`), "the metallic button keeps its dark label");
for (const stop of [goldDeep, gold, goldBright]) {
  assert(contrast(buttonInk, stop) >= 4.5, `gold button text on ${stop} is ${contrast(buttonInk, stop).toFixed(2)}`);
}
const goldInk = token(lightBlock, "--gold-ink");
const pillarCard = token(lightBlock, "--bg-2");
const landing = readFileSync("src/styles/landing.css", "utf8");
const landingLight = landing.slice(landing.indexOf('html[data-landing="1"][data-theme="light"]'));
assert(goldInk === token(landingLight, "--gold-ink"), "portal light mode uses the landing dark-gold ink");
assert(
  contrast(goldInk, pillarCard) >= 4.5,
  `dark-gold ink on the white pillar card is ${contrast(goldInk, pillarCard).toFixed(2)}`,
);
assert(
  css.includes('html[data-theme="light"] .owner-door .owner-pillar-score.text-amber-400') &&
    css.includes("color: var(--gold-ink)"),
  "light watch scores use the dark-gold ink token",
);
const sphere = readFileSync("src/components/sphere-hero.tsx", "utf8");
assert(sphere.includes("owner-pillar-score"), "pillar numbers opt into the dark-gold ink");
assert(sphere.includes("bg-white"), "the pillar card is white");
assert(shell.includes('className="brand"'), "the owner wordmark uses the accountant brand size");
assert(shell.includes('className="gold-text">MILŌN'), "the owner wordmark uses the accountant gold colour");
assert(!shell.includes("milon-wordmark.png"), "the tiny image wordmark is gone");
assert(!home.includes("Milōn Financial Manager"), "the view does not hardcode a display name");
const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(door.includes('setScreen("moves")'), "what needs an answer opens Next moves");
assert(!door.includes('setScreen("actions")'), "the separate actions screen is gone");
assert(!door.includes('setScreen("tasks")'), "the separate action plan screen is gone");
const plan = readFileSync("src/components/action-plan.tsx", "utf8");
assert(plan.includes("ownerView"), "the owner rail uses a compact action plan");
assert(plan.includes("Hand to {agentDisplayName(agent)}"), "handing off names the bot");
assert(plan.includes("data-bot-handoff"), "the hand-off controls are in the action row");
assert(plan.includes("Handed to "), "a hand-off writes a request note");
assert(plan.includes("does not enqueue agent_runs"), "the hand-off does not pretend to start a run");
assert(app.includes("ownerView"), "Next moves renders the owner action list");
assert(!door.includes("Dana"), "the door does not use a retired name");
const prompt = readFileSync("supabase/functions/ask-ai/prompt.ts", "utf8");
assert(prompt.includes("askAiAgentPersona"), "ask-ai keeps an agent persona");
assert(!prompt.includes("Milōn Financial Manager"), "the persona does not hardcode a display name");

assert(ownerPlanLine({ visitor: "za", accountantOnMilon: false, firmName: null }) === "Owner plan · R299/mo", "SA visitors see the rand price");
assert(!ownerPlanLine({ visitor: "za", accountantOnMilon: false, firmName: null }).includes("$39"), "SA plan hides the dollar price");
assert(ownerPlanLine({ visitor: "us", accountantOnMilon: false, firmName: null }) === "Owner plan · $39/mo", "US visitors see the dollar price");
assert(!ownerPlanLine({ visitor: "us", accountantOnMilon: false, firmName: null }).includes("R299"), "US plan hides the rand price");
assert(
  ownerPlanLine({ visitor: "za", accountantOnMilon: true, firmName: "Northline" }) ===
    "Owner plan · included — Northline is on Milōn",
  "a linked accountant replaces the price",
);
assert(!ownerPlanLine({ visitor: null, accountantOnMilon: false, firmName: null }).match(/R299|\$39/), "no price before the visitor is known");
assert(ownerPlanFreeLine() === "Free when your accountant is on Milōn.", "the free line has no price");
const homeSrc = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(!homeSrc.includes("R299") && !homeSrc.includes("$39"), "home does not show a price");
const pagesSrc = readFileSync("src/components/owner-door/owner-pages.tsx", "utf8");
assert(pagesSrc.includes("ownerPlanLine"), "the plan view is where the price lives");
assert(pagesSrc.includes("ownerPlanFreeLine"), "the free line is on the invite surfaces");

console.log("owner-door tests passed");
