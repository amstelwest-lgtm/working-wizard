/**
 * Accountant studio — Overview, then Client Brain, then Milōn Bot as a large studio widget.
 * Run: pnpm test:accountant-ask-ai-tab
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const clientSrc = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
const widgetSrc = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
const copySrc = readFileSync(resolve("src/lib/milon-bot-copy.ts"), "utf8");
const cssSrc = readFileSync(resolve("public/ask-ai.css"), "utf8");
const tourSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
const indexSrc = readFileSync(resolve("supabase/functions/ask-ai/index.ts"), "utf8");

assert(/type ActiveTab =[\s\S]{0,80}"ask"/.test(clientSrc), "Milōn Bot is an accountant studio tab");
assert(
  clientSrc.includes('{ id: "overview", label: "Overview" }') &&
    clientSrc.indexOf('{ id: "overview", label: "Overview" }') <
      clientSrc.indexOf('{ id: "summary", label: "Client Brain" }') &&
    clientSrc.indexOf('{ id: "summary", label: "Client Brain" }') <
      clientSrc.indexOf('{ id: "ask", label: "Milōn Bot"'),
  "Overview sits above Client Brain, above Milōn Bot",
);
assert(clientSrc.includes('useState<ActiveTab>("overview")'), "studio lands on Overview");
assert(
  clientSrc.includes('setActiveTab("overview")'),
  "opening a client without a deep link lands on Overview",
);
assert(
  clientSrc.includes('id="pane-overview"') &&
    clientSrc.indexOf('id="pane-overview"') < clientSrc.indexOf("<ClientBriefing") &&
    clientSrc.indexOf("<ClientBriefing") < clientSrc.indexOf('id="pane-summary"'),
  "the client briefing lives only in the Overview pane",
);
assert(clientSrc.includes('id="first-figures-card"'), "empty studio shows the first-figures card");
assert(clientSrc.includes('{ id: "ask", label: "Milōn Bot"'), "Milōn Bot appears in the deliverable list");
assert(clientSrc.includes('className="deliverable-rail"'), "deliverables are a left stacked rail");
assert(!clientSrc.includes('className="tabs"'), "horizontal mid-page tab strip is gone");
assert(
  clientSrc.indexOf('className="deliverable-rail"') < clientSrc.indexOf("<NextStepCard"),
  "the rail sits at the top of the client workspace, beside the header",
);
assert(clientSrc.includes('id="pane-ask"'), "Milōn Bot pane exists");
assert(clientSrc.includes('id="ask-ai-accountant"'), "studio still mounts the same widget");
assert(clientSrc.includes('variant: "studio"'), "accountant widget uses the large studio variant");
assert(clientSrc.includes('audience: "accountant"'), "accountant questions send accountant audience");
assert(clientSrc.includes("functions/v1/milon-bot"), "studio widget can call brain tools");
assert(
  /activeTab === "overview"[\s\S]{0,700}"none"/.test(clientSrc) &&
    /activeTab === "ask"[\s\S]{0,700}"none"/.test(clientSrc),
  "simple/complex toggle is hidden on Overview and Milōn Bot",
);
assert(
  clientSrc.includes('activeTab === "cash"'),
  "simple/complex toggle is also hidden on Cash",
);
assert(
  clientSrc.includes('activeTab === "plan"'),
  "simple/complex toggle is also hidden on Action Plan",
);
assert(
  clientSrc.includes('activeTab === "reports"'),
  "simple/complex toggle is also hidden on Reports",
);
assert(
  !/id="pane-ratios"[\s\S]{0,400}id="ask-ai-accountant"/.test(clientSrc),
  "Milōn Bot no longer lives as a cramped card on Health",
);
assert(clientSrc.includes("ask-ai-studio-shell"), "studio shell is the big hero box");
assert(!clientSrc.includes('label: "Ask AI"'), "Ask AI chrome is gone from the tab strip");

assert(widgetSrc.includes('variant === "studio"'), "widget supports studio variant");
assert(widgetSrc.includes("MILON_BOT_ACCOUNTANT_CHIPS"), "accountant suggestion chips");
assert(widgetSrc.includes('audience: "accountant"'), "studio POST includes audience");
assert(widgetSrc.includes("Milōn Bot"), "widget brands as Milōn Bot");
assert(copySrc.includes("powered by Claude"), "subtitle copy");
assert(copySrc.includes("won't invent figures"), "blurb keeps the no-invention promise");

assert(cssSrc.includes(".ask-ai-studio .ask-ai-textarea"), "studio textarea is oversized");
assert(cssSrc.includes(".ask-ai-studio-shell"), "studio shell styles exist");
assert(cssSrc.includes("min-height: 168px"), "studio box is tall");
assert(cssSrc.includes(".ask-ai-subtitle"), "powered-by-Claude subtitle style");
assert(cssSrc.includes(".ask-ai-blurb"), "product blurb style");

assert(tourSrc.includes('tab: "ask"'), "client tour opens the Milōn Bot tab");
assert(tourSrc.includes("Start with Milōn Bot"), "tour names Milōn Bot");
assert(indexSrc.includes('audience === "accountant"'), "edge function accepts accountant audience");

console.log("accountant-ask-ai-tab-test: all assertions passed");
