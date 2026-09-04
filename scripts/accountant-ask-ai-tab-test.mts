/**
 * Accountant studio — Ask AI is the first tab and a large studio widget.
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
const cssSrc = readFileSync(resolve("public/ask-ai.css"), "utf8");
const tourSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
const indexSrc = readFileSync(resolve("supabase/functions/ask-ai/index.ts"), "utf8");

assert(clientSrc.includes('| "ask"'), "Ask AI is an accountant studio tab");
assert(
  /const ACCOUNTANT_TABS[\s\S]*?"ask"[\s\S]*?"ratios"/.test(clientSrc),
  "Ask AI is the first accountant tab",
);
assert(clientSrc.includes('useState<ActiveTab>("ask")'), "studio lands on Ask AI");
assert(clientSrc.includes('{ id: "ask", label: "Ask AI"'), "Ask AI appears in the tab strip");
assert(clientSrc.includes('id="pane-ask"'), "Ask AI pane exists");
assert(clientSrc.includes('id="ask-ai-accountant"'), "studio still mounts the same widget");
assert(clientSrc.includes('variant: "studio"'), "accountant widget uses the large studio variant");
assert(clientSrc.includes('audience: "accountant"'), "accountant questions send accountant audience");
assert(
  clientSrc.includes("activeTab === \"ask\" ? \"none\""),
  "simple/complex toggle is hidden on Ask AI",
);
assert(
  !/id="pane-ratios"[\s\S]{0,400}id="ask-ai-accountant"/.test(clientSrc),
  "Ask AI no longer lives as a cramped card on Health",
);
assert(clientSrc.includes("ask-ai-studio-shell"), "studio shell is the big hero box");

assert(widgetSrc.includes('variant === "studio"'), "widget supports studio variant");
assert(widgetSrc.includes("ACCOUNTANT_CHIPS"), "accountant suggestion chips");
assert(widgetSrc.includes('audience: "accountant"'), "studio POST includes audience");

assert(cssSrc.includes(".ask-ai-studio .ask-ai-textarea"), "studio textarea is oversized");
assert(cssSrc.includes(".ask-ai-studio-shell"), "studio shell styles exist");
assert(cssSrc.includes("min-height: 168px"), "studio box is tall");

assert(tourSrc.includes('tab: "ask"'), "client tour opens the Ask AI tab");
assert(indexSrc.includes('audience === "accountant"'), "edge function accepts accountant audience");

console.log("accountant-ask-ai-tab-test: all assertions passed");
