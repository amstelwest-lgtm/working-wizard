/**
 * Tax Specialist as a fourth agent page (ZA only): keys, route, stage,
 * sections, and the chat persona. Run: pnpm test:tax-specialist-agent
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStage } from "../src/components/milon-team/agent-stage";
import { ZaTaxSpecialistPage } from "../src/components/tax-specialist/za-tax-specialist-page";
import { ZaIrp6Sheet } from "../src/components/tax-specialist/za-irp6-sheet";
import { TAX_FORM_GALLERY } from "../src/lib/tax-specialist/forms/gallery";
import { draftActivity } from "../src/lib/tax-specialist/forms/drafts";
import { IRP6_DEMO_CLIENT, IRP6_DEMO_TODAY } from "../src/lib/tax-specialist/forms/irp6-demo";
import { askAgentFromHash, askHashForAgent } from "../src/lib/ask-agent";
import {
  accountantClientRouteSearch,
  clientNavSearch,
  clientRailSelection,
} from "../src/lib/client-route-search";
import {
  TAX_AGENT_ROLE,
  ZA_AGENT_KEYS,
  parseStageAgent,
  stageAgentDisplayName,
  stageAgentKeys,
} from "../src/lib/tax-specialist/agents";
import { chatAgentForMarket, parseChatAgent } from "../supabase/functions/_shared/chat-reply.ts";
import { askAiAgentPersona } from "../supabase/functions/ask-ai/prompt.ts";
import { TAX_SPECIALIST_CHAT_PERSONA } from "../supabase/functions/_shared/agent-prompts/tax-specialist.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected)
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

// Keys and gating
eq(ZA_AGENT_KEYS.join(","), "financial_manager,analyst,advisor,tax_specialist", "ZA agent keys");
eq(stageAgentKeys("ZA").includes("tax_specialist"), true, "ZA lists the Tax Specialist");
for (const country of ["US", null, undefined, "za"]) {
  eq(
    stageAgentKeys(country).includes("tax_specialist"),
    false,
    `${String(country)} has no tax page`,
  );
  eq(
    parseStageAgent("tax_specialist", country),
    null,
    `${String(country)} drops ?agent=tax_specialist`,
  );
}
eq(parseStageAgent("tax_specialist", "ZA"), "tax_specialist", "ZA keeps ?agent=tax_specialist");
eq(parseStageAgent("analyst", "US"), "analyst", "other agents stay on every market");
eq(parseStageAgent("nobody", "ZA"), null, "unknown agents are dropped");
eq(TAX_AGENT_ROLE, "Prepares SARS forms and tax workings for you to check and file.", "role line");
eq(stageAgentDisplayName("tax_specialist"), "Milōn Tax Specialist", "display name");

// Route search, rail, and hash
eq(
  accountantClientRouteSearch({ tab: "home", agent: "tax_specialist" }).agent,
  "tax_specialist",
  "the route keeps ?agent=tax_specialist; the page gates it by market",
);
eq(
  clientRailSelection({ tab: "home", agent: "tax_specialist" }).subId,
  "tax_specialist",
  "rail marks the tax page",
);
eq(
  (clientNavSearch({}, "home", "tax_specialist") as { agent?: string }).agent,
  "tax_specialist",
  "rail opens the tax page",
);
eq(askAgentFromHash("#ask-tax-specialist"), "tax_specialist", "hash opens the tax page");
eq(askHashForAgent("tax_specialist"), "ask-tax-specialist", "tax page hash");

// Stage: a real tab on ZA client pages, the sample opener elsewhere
const stage = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(AgentStage, {
      agent: "analyst",
      finding: null,
      onSelect: () => {},
      chat: createElement("div", { id: "chat" }),
      ...props,
    } as Parameters<typeof AgentStage>[0]),
  );
const zaTab = stage({ marketCountry: "ZA", taxTab: true });
assert(zaTab.includes('data-agent-open="tax_specialist"'), "ZA client pages show the tax tab");
assert(!zaTab.includes('data-agent-card="tax_specialist"'), "the tab replaces the sample opener");
const usTab = stage({ marketCountry: "US", taxTab: true });
assert(!usTab.includes("tax_specialist"), "US pages show no tax block");
const practice = stage({ marketCountry: "ZA" });
assert(
  !practice.includes('data-agent-open="tax_specialist"'),
  "practice pages keep the sample opener",
);

const taxStage = stage({ agent: "tax_specialist", marketCountry: "ZA", taxTab: true });
assert(taxStage.includes('data-agent-stage="tax_specialist"'), "tax stage renders");
assert(taxStage.includes("Milōn Tax Specialist"), "tax hero name");
assert(taxStage.includes(TAX_AGENT_ROLE), "tax hero role");
assert(taxStage.includes("Ask the Tax Specialist"), "tax chat title");
assert(
  taxStage.includes('aria-selected="true" data-agent-open="tax_specialist"'),
  "tax tab is selected",
);

// Page sections, in Theo's order
const page = renderToStaticMarkup(createElement(ZaTaxSpecialistPage, {}));
const order = ["forms", "workings", "deadlines", "activity"].map((key) =>
  page.indexOf(`data-agent-section="${key}"`),
);
assert(
  order.every((at) => at >= 0),
  "all four sections render",
);
assert(
  order.every((at, i) => i === 0 || at > order[i - 1]),
  "sections in order",
);
for (const title of ["SARS forms", "Tax workings", "Deadlines", "Recent activity"]) {
  assert(page.includes(`>${title}</h2>`), `${title} title`);
}
// Part 7b: the form gallery, in Theo's order, with code, name, frequency and status
eq(
  TAX_FORM_GALLERY.map((form) => form.code).join(","),
  "IRP5,EMP201,EMP501,IRP6,ITR14,VAT201,ITR12",
  "gallery order",
);
for (const form of TAX_FORM_GALLERY) {
  const at = page.indexOf(`data-tax-form="${form.code}"`);
  assert(at >= 0, `${form.code} block`);
  const block = page.slice(at, page.indexOf("</li>", at));
  assert(block.includes(form.name), `${form.code} plain name`);
  assert(block.includes(form.frequency.replace(/&/g, "&amp;")), `${form.code} frequency`);
  const status = form.code === "IRP6" ? "Ready to prepare" : "Coming soon";
  assert(block.includes(`>${status}<`), `${form.code} says ${status}`);
}
assert(
  !page.includes('class="tax-page-form is-open"'),
  "without a form sheet nothing is clickable",
);
const openable = renderToStaticMarkup(createElement(ZaTaxSpecialistPage, { onOpenForm: () => {} }));
eq(
  openable.split('class="tax-page-form is-open"').length - 1,
  1,
  "only the IRP6 block opens a sheet",
);
assert(
  /data-tax-form="ITR14"[^]*?The worksheet is under Tax workings\./.test(page),
  "ITR14 points at the worksheet",
);
assert(page.includes("Harbour"), "workings use the Harbour & Co sample");
assert(
  page.split('data-tax-sample-label="true"').length - 1 >= 2,
  "workings and deadlines are labelled Sample",
);
assert(page.includes("Nothing yet."), "empty activity says so");
const withActivity = renderToStaticMarkup(
  createElement(ZaTaxSpecialistPage, {
    activity: [
      { id: "a", text: "Older", at: "2026-10-01T00:00:00Z" },
      { id: "b", text: "Newer", at: "2026-10-02T00:00:00Z" },
    ],
  }),
);
assert(withActivity.indexOf("Newer") < withActivity.indexOf("Older"), "activity is newest first");

// Chat: persona wired, ZA only
eq(parseChatAgent("tax_specialist"), "tax_specialist", "chat accepts the tax agent");
eq(chatAgentForMarket("tax_specialist", "za"), "tax_specialist", "ZA chat keeps the persona");
eq(chatAgentForMarket("tax_specialist", "us"), null, "US chat drops the persona");
eq(chatAgentForMarket("analyst", "us"), "analyst", "other personas are untouched");
eq(
  askAiAgentPersona("tax_specialist", "accountant"),
  TAX_SPECIALIST_CHAT_PERSONA,
  "ask-ai persona",
);
assert(
  /do not log into SARS, file, submit, or eFile/i.test(TAX_SPECIALIST_CHAT_PERSONA),
  "never files",
);
assert(/Do not invent tax figures/.test(TAX_SPECIALIST_CHAT_PERSONA), "no invented figures");
assert(
  readFileSync("src/lib/ask-ai.js", "utf8").includes('"tax_specialist"'),
  "widget keeps a tax thread",
);

// Wiring
const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(
  route.includes("parseStageAgent(search.agent, clientGateCountry)"),
  "route gates the tax page by market",
);
assert(route.includes("marketCountry={clientGateCountry}"), "rail gets the market");
assert(
  route.includes('onOpenTaxAgent={() => openHomeAgent("tax_specialist")}'),
  "the home tax card opens the tax page",
);
const sample = readFileSync("src/components/tax-specialist/za-tax-specialist-sample.tsx", "utf8");
assert(
  sample.includes('data-tax-card="page"') &&
    sample.includes("if (onOpenPage) return <PageHomeCard"),
  "the loaded card opens the page when asked",
);
const pane = readFileSync("src/components/milon-team/milon-team-pane.tsx", "utf8");
assert(
  pane.includes(
    'onOpenTaxAgent={onSelectAgent ? () => onSelectAgent("tax_specialist") : undefined}',
  ),
  "the team desk tax chip opens the tax page",
);
assert(pane.includes("<TaxSpecialistPage"), "pane renders the tax page");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(path);
  }
  return out;
}
const formsImport = /from\s+["'][^"']*tax-specialist\/forms\//;
for (const path of walk("src")) {
  if (/tax-specialist\/(za-[^/]+\.tsx|forms\/[^/]+\.ts)$/.test(path)) continue;
  assert(!formsImport.test(readFileSync(path, "utf8")), `${path} imports a ZA form module`);
}

// Part 7c: the IRP6 block opens the sheet for a client; deadlines and activity follow drafts
const demoClient = { ...IRP6_DEMO_CLIENT, id: "c1" };
const withClient = renderToStaticMarkup(
  createElement(ZaTaxSpecialistPage, { client: demoClient, today: IRP6_DEMO_TODAY }),
);
eq(
  withClient.split('class="tax-page-form is-open"').length - 1,
  1,
  "with a client the IRP6 block opens the sheet",
);
assert(withClient.includes('data-tax-deadlines="client"'), "a client gets its own deadlines");
assert(withClient.includes("IRP6, year of assessment 2027"), "deadlines name the year");
assert(
  /data-tax-deadline="irp6-2"[^]*?26 Feb 2027[^]*?Not started/.test(withClient),
  "period 2 due date, shifted off the Sunday, with no draft yet",
);
const sheetMarkup = renderToStaticMarkup(
  createElement(ZaIrp6Sheet, {
    client: demoClient,
    today: IRP6_DEMO_TODAY,
    drafts: [],
    onSaved: () => {},
    onBack: () => {},
  }),
);
assert(sheetMarkup.includes("2 fields need input before you can download."), "missing line at the top");
for (const id of ["taxpayer", "estimate", "adjustments", "credits", "result"]) {
  assert(sheetMarkup.includes(`data-irp6-approve="${id}"`), `${id} has an Approve tick`);
}
assert(sheetMarkup.includes("From books sync, as of 1 Oct 2026"), "books source with its date");
assert(sheetMarkup.includes("From client record"), "client record source");
assert(sheetMarkup.includes("Needs input"), "needs input source");
assert(sheetMarkup.includes(">Friday 26 Feb 2027<"), "due date in the header");
assert(/data-irp6-download="pdf"[^>]*disabled/.test(sheetMarkup), "download waits for input");
const activityLines = draftActivity([
  {
    id: "d1",
    client_id: "c1",
    form_code: "IRP6",
    tax_year: 2027,
    period: 2,
    subject: null,
    fields: {},
    approvals: {},
    status: "downloaded",
    approved_by: "u1",
    approved_by_name: "Ada Mbeki",
    approved_at: "2026-10-29T08:00:00.000Z",
    downloaded_at: "2026-10-29T08:05:00.000Z",
    created_at: "2026-10-29T07:00:00.000Z",
    updated_at: "2026-10-29T08:05:00.000Z",
  },
]);
eq(
  activityLines[0]?.text,
  "IRP6 2027, period 2 downloaded on 29 Oct 2026. Approved by Ada Mbeki on 29 Oct 2026.",
  "a downloaded draft shows in Recent activity with who approved it",
);
assert(route.includes("taxClient={taxClient}"), "route passes the client to the tax page");
assert(pane.includes("client={taxClient}"), "pane passes the client on");
const slot = readFileSync("src/components/tax-specialist/tax-specialist-slot.tsx", "utf8");
assert(slot.includes("client={client}"), "slot passes the client to the loaded page");
const migration = readFileSync("supabase/migrations/20261029130000_tax_form_drafts.sql", "utf8");
assert(
  migration.includes("has_client_access(auth.uid(), client_id)") &&
    migration.includes("is_client_writer(auth.uid(), client_id)"),
  "drafts use the client-table RLS",
);
assert(!/sars\.gov\.za|efiling\.co\.za/i.test(sheetMarkup), "no SARS login or submission link");

const agents = readFileSync("src/lib/tax-specialist/agents.ts", "utf8");
assert(
  !/IRP6|ITR14|South Africa/.test(agents),
  "bundle-leak needles stay out of the static agent keys",
);

console.log("tax-specialist-agent ok");
