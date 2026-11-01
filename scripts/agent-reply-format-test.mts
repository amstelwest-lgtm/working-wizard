/**
 * Shared agent reply card: schema, decision strip, and the collapsed how-line.
 * Run: pnpm test:agent-reply-format
 */
import { Window } from "happy-dom";
import { ADVISOR_TOOL_LABELS } from "../src/lib/agent-advisor.ts";
import { ANALYST_TOOL_LABELS } from "../src/lib/agent-analyst.ts";
import {
  agentReplyForStorage,
  howDetailLines,
  structureAgentReply,
  toolLabel,
} from "../src/lib/agent-reply.ts";
import { FM_TOOL_LABELS } from "../src/lib/agent-financial-manager.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";
import { botSystem } from "../supabase/functions/milon-bot/logic.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const SHAPED = [
  "Cash stays in the black through the next quarter.",
  "",
  "- Opening cash: R420,000",
  "- Low point: R180,000",
  "- Negative weeks: 0",
  "- Spare figure: 4",
  "",
  "**Next actions**",
  "1. Collect the two largest invoices.",
  "2. Hold the optional hire.",
  "3. Ask the accountant to review the floor.",
  "4. Ignore this extra action.",
  "5. And this one too.",
].join("\n");

const shaped = structureAgentReply(SHAPED, { agent: "advisor" });
assert(shaped.agent === "advisor", "the advisor card keeps its agent");
assert(shaped.headline.startsWith("Cash stays in the black"), "the headline is the first sentence");
assert(shaped.kpis.length === 3, `key figures stop at 3 (${shaped.kpis.length})`);
assert(shaped.kpis[0].label === "Opening cash" && shaped.kpis[0].value === "R420,000", "the first figure stays a key figure");
assert(shaped.bullets.length === 4, `points stop at 4 (${shaped.bullets.length})`);
assert(shaped.bullets[0] === "Collect the two largest invoices.", "the first point drops its number");
assert(!shaped.bullets.some((line) => line.includes("And this one")), "a fifth point is dropped");
assert(!shaped.bullets.some((line) => line.startsWith("Spare")), "a fourth figure is not promoted once there are two points");
assert(shaped.decision === null, "an ordinary answer has no decision strip");
assert(shaped.how === null, "an answer with no tools has no how-line");
assert(shaped.figures.length === 0, "prose figures are not turned into chips");

const readonlyProposal = structureAgentReply("A figure change is waiting for you.", {
  agent: "financial_manager",
  tools: [{ name: "propose_figure_adjustment", status: "ok" }],
  proposal: {
    id: "p-read",
    surface: "cash",
    note: "Week 1 net",
    patch: { netWeek: 1, netDelta: 100 },
    beforeValues: { netDelta: 0 },
    canDecide: false,
    status: "pending",
  },
});
assert(readonlyProposal.decision === null, "a person who cannot decide gets no strip");
assert(
  readonlyProposal.figures.length === 1 && readonlyProposal.figures[0].source === "proposal:cash",
  "the proposal patch is the chip",
);
assert(readonlyProposal.how?.summary.includes("Figure proposal"), "the how-line names the tool");
assert(!JSON.stringify(readonlyProposal).includes("trace"), "the card does not carry a trail");

const confirm = structureAgentReply("A figure change is waiting for you. Nothing is saved until you confirm.", {
  agent: "financial_manager",
  proposal: {
    id: "p-write",
    surface: "cash",
    note: "Week 1 net",
    patch: { netWeek: 1, netDelta: 100 },
    beforeValues: {},
    canDecide: true,
    status: "pending",
  },
});
assert(confirm.decision?.kind === "confirm_reject" && confirm.decision.id === "p-write", "a pending proposal asks for confirm or reject");
assert(confirm.figures[0]?.label.includes("Week 1"), "the chip uses the proposal line");

const decided = structureAgentReply("Saved.", {
  agent: "financial_manager",
  proposal: {
    id: "p-done",
    surface: "cash",
    patch: { netDelta: 1 },
    status: "decided",
  },
  draft: { id: "draft-1", prompt: "Approve the payroll draft." },
});
assert(decided.decision?.kind === "approve_dismiss" && decided.decision.id === "draft-1", "a decided proposal can still ask for a draft");

const draftOnly = structureAgentReply("Please take the payroll draft.", {
  agent: "financial_manager",
  draft: { id: "draft-2" },
});
assert(draftOnly.decision?.kind === "approve_dismiss", "a draft asks for approve or dismiss");
assert(draftOnly.decision?.prompt === "This draft is waiting for you.", "a draft without a prompt uses the short ask");

const overview = structureAgentReply("The pack is drafted.", {
  agent: "advisor",
  created: {
    overview: {
      facts: ["Health: 80 (Healthy)", "Cash on file: R 12 000", "Opening cash unknown"],
      health: 80,
    },
  },
});
assert(overview.figures.length === 2, "overview chips come from the facts already on the reply");
assert(overview.figures.every((chip) => chip.source === "overview"), "those chips are marked overview");
assert(!overview.figures.some((chip) => chip.label === "Opening cash unknown"), "a fact without a value is not a chip");

const traced = structureAgentReply("Health is 80.", {
  agent: "analyst",
  tools: [{ name: "get_health", status: "ok" }, { name: "get_ratios", status: "empty" }],
  howDetailId: "run-1",
  run: { outcomeLabel: "Done" },
});
assert(traced.how?.detailId === "run-1", "the card keeps an id for the trail");
assert(traced.how?.summary.includes("Health") && traced.how.summary.includes("nothing on file"), "the summary names the tools");
assert(traced.how.summary.includes("Done"), "a short outcome stays on the summary");
const trail = howDetailLines({
  objective: "see health",
  outcomeLabel: "Done",
  trace: [{ label: "Health", status: "ok", verified: true, detail: "score 80 from the snapshot" }],
});
assert(trail.some((line) => line.includes("score 80 from the snapshot")), "the trail reader keeps the stored step");
assert(!JSON.stringify(traced).includes("score 80 from the snapshot"), "the card does not include the trail");
assert(agentReplyForStorage(traced).how?.detailId === null, "storage drops the expand id");
assert(agentReplyForStorage(traced).how?.summary === traced.how?.summary, "storage keeps the short summary");

for (const map of [FM_TOOL_LABELS, ANALYST_TOOL_LABELS, ADVISOR_TOOL_LABELS]) {
  for (const [name, label] of Object.entries(map)) {
    assert(toolLabel(name) === label, `${name} uses the existing tool label`);
  }
}

const sentence = "Do not write a second account of how you reached the answer.";
assert(botSystem("za").includes(sentence) && botSystem("us").includes(sentence), "milon-bot keeps the how-line off the model reply");
const ctx = { copyPack: "za", ratios: [] } as unknown as AskAiContext;
for (const audience of ["owner", "accountant"] as const) {
  for (const agent of ["financial_manager", "analyst", "advisor", "tax_specialist"] as const) {
    const prompt = buildPrompt("How are we doing?", ctx, "none", audience, agent);
    assert(prompt.system.includes(sentence), `${audience} ${agent} uses the shared reply rules`);
  }
}

const window = new Window({
  url: "http://127.0.0.1:5000/app",
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MouseEvent", "Event"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });

const { createElement } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentReplyShell } = await import("../src/components/agent-reply/agent-reply-shell.tsx");

async function mount(props: Record<string, unknown>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(AgentReplyShell, props as never));
  });
  return host;
}

const plainHost = await mount({
  reply: shaped,
  onDecide: () => {},
});
assert(plainHost.querySelector("[data-agent-headline]")?.textContent?.includes("Cash stays"), "the shell shows the headline");
assert(plainHost.querySelectorAll("[data-agent-kpi]").length === 3, "the shell shows three key figures");
assert(plainHost.querySelectorAll("[data-agent-bullets] li").length === 4, "the shell shows four points");
assert(plainHost.querySelector("[data-agent-decision]") == null, "the shell has no decision strip");
assert(!plainHost.textContent?.includes("Confirm") && !plainHost.textContent?.includes("Approve"), "ordinary chrome has neither pair");
assert(plainHost.querySelector("[data-agent-how]") == null, "there is no how card without tools");

let decisions: string[] = [];
const confirmHost = await mount({
  reply: confirm,
  onDecide: (action: string) => {
    decisions.push(action);
  },
});
assert(confirmHost.querySelector("[data-agent-decision]")?.getAttribute("data-agent-decision") === "confirm_reject", "confirm/reject chrome");
assert(confirmHost.querySelector("[data-decision=confirm]")?.textContent === "Confirm", "the confirm label");
assert(confirmHost.querySelector("[data-decision=reject]")?.textContent === "Reject", "the reject label");
assert(!confirmHost.textContent?.includes("Approve"), "confirm/reject does not say approve");
confirmHost.querySelector<HTMLButtonElement>("[data-decision=confirm]")?.click();
await act(async () => {});
assert(decisions.join(",") === "confirm", "confirm calls the handler once");

const draftHost = await mount({
  reply: draftOnly,
  onDecide: () => {},
});
assert(draftHost.querySelector("[data-agent-decision]")?.getAttribute("data-agent-decision") === "approve_dismiss", "approve/dismiss chrome");
assert(draftHost.querySelector("[data-decision=approve]")?.textContent === "Approve", "the approve label");
assert(draftHost.querySelector("[data-decision=dismiss]")?.textContent === "Dismiss", "the dismiss label");
assert(!draftHost.textContent?.includes("Confirm"), "approve/dismiss does not say confirm");

let loads = 0;
const howHost = await mount({
  reply: traced,
  onLoadDetail: async (id: string) => {
    loads += 1;
    assert(id === "run-1", "expand asks for the stored id");
    return { lines: trail };
  },
});
assert(howHost.querySelector("[data-agent-how-summary]")?.textContent?.includes("Health"), "the short how-line is visible");
assert(howHost.querySelector("[data-agent-how-detail]") == null, "the trail is collapsed");
assert(!howHost.textContent?.includes("score 80"), "the trail text is not on the card");
assert(loads === 0, "opening the card does not fetch the trail");
const toggle = howHost.querySelector<HTMLButtonElement>("[data-agent-how-toggle]");
assert(toggle?.getAttribute("aria-expanded") === "false", "the how-line starts collapsed");
await act(async () => {
  toggle?.click();
});
assert(loads === 1, "expand fetches the trail once");
assert(howHost.querySelector("[data-agent-how-detail]")?.textContent?.includes("score 80"), "the trail shows after expand");
assert(howHost.querySelector("[data-agent-how-toggle]")?.getAttribute("aria-expanded") === "true", "the how-line is expanded");
await act(async () => {
  howHost.querySelector<HTMLButtonElement>("[data-agent-how-toggle]")?.click();
});
assert(loads === 1, "closing does not fetch again");
assert(howHost.querySelector("[data-agent-how-detail]") == null, "closing hides the trail");

console.log("agent-reply-format: ok");
