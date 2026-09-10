/**
 * Accountant studio — Milōn Bot is the first tab and a large studio widget.
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

assert(/type ActiveTab =[\s\S]{0,40}"ask"/.test(clientSrc), "Milōn Bot is an accountant studio tab");
assert(
  /const ACCOUNTANT_TABS[\s\S]*?"ask"[\s\S]*?"ratios"/.test(clientSrc),
  "Milōn Bot is the first accountant tab",
);
assert(clientSrc.includes('useState<ActiveTab>("ask")'), "studio lands on Milōn Bot");
assert(
  clientSrc.includes('setActiveTab(figures ? "ask" : "ratios")'),
  "before any figures the studio lands on Health & Ratios, where the inputs are",
);
assert(clientSrc.includes('id="first-figures-card"'), "empty studio shows the first-figures card");
assert(clientSrc.includes('{ id: "ask", label: "Milōn Bot"'), "Milōn Bot appears in the tab strip");
assert(clientSrc.includes('id="pane-ask"'), "Milōn Bot pane exists");
assert(clientSrc.includes('id="ask-ai-accountant"'), "studio still mounts the same widget");
assert(clientSrc.includes('variant: "studio"'), "accountant widget uses the large studio variant");
assert(clientSrc.includes('audience: "accountant"'), "accountant questions send accountant audience");
assert(clientSrc.includes("functions/v1/milon-bot"), "studio widget can call brain tools");
assert(
  /activeTab === "ask"[\s\S]{0,40}"none"/.test(clientSrc),
  "simple/complex toggle is hidden on Milōn Bot",
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
