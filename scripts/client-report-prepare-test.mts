/**
 * Financial Manager prepare_client_report. Five rail PDFs, no book writes.
 * Run: pnpm test:client-report-prepare
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analystRunCostUsd, executeAnalystGate } from "../src/lib/agent-analyst.ts";
import { executeAdvisorGate } from "../src/lib/agent-advisor.ts";
import {
  FM_COST_CEILING_USD,
  FM_TOOLS,
  executeFinancialManagerGate,
  fmRunOutcome,
} from "../src/lib/agent-financial-manager.ts";
import { CLAUDE_OPUS_55 } from "../src/lib/claude-request.ts";
import { reportPdfSection } from "../src/lib/client-route-search.ts";
import {
  CLIENT_REPORT_KEYS,
  CLIENT_REPORT_WHICH,
  PREPARE_CLIENT_REPORT_TOOL,
  buildPrepareClientReportResult,
  callerMayPrepareClientReport,
  clientReportChatOutcome,
  clientReportDownloadPath,
  clientReportFromInputs,
  deriveFinancialManagerEndpoint,
  financialManagerJobObjective,
  unnamedClientReportReply,
  planClientReportInvoke,
  prepareClientReportToolSchema,
} from "../src/lib/client-report-prepare.ts";
import {
  fmClientReportRoute,
  persistedCreateIntent,
} from "../src/lib/milon-bot-copy.ts";
import { classifyResult } from "../supabase/functions/_shared/agent-core/loop.ts";
import { FINANCIAL_MANAGER_SYSTEM, financialManagerToolSchemas } from "../supabase/functions/_shared/agent-prompts/financial-manager.ts";
import { mountAskAi } from "../src/lib/ask-ai.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const CLIENT = "79c4c485-9fa7-4499-9139-e1bb7cb40649";
const FM = { agent: "financial_manager", audience: "accountant" } as const;

{
  const schema = prepareClientReportToolSchema();
  const listed = financialManagerToolSchemas().find((tool) => tool.name === PREPARE_CLIENT_REPORT_TOOL);
  assert(schema.name === PREPARE_CLIENT_REPORT_TOOL, "the tool name is prepare_client_report");
  assert(listed?.name === PREPARE_CLIENT_REPORT_TOOL, "the financial manager schema lists the tool");
  const enumKeys = (listed?.input_schema.properties as { report_key?: { enum?: string[] } }).report_key?.enum;
  assert(JSON.stringify(enumKeys) === JSON.stringify([...CLIENT_REPORT_KEYS]), "the schema is the five rail keys");
  assert((FM_TOOLS as readonly string[]).includes(PREPARE_CLIENT_REPORT_TOOL), "the allow-list includes the tool");
  assert(executeFinancialManagerGate(PREPARE_CLIENT_REPORT_TOOL).allowed === true, "the financial manager gate allows it");
  assert(executeAnalystGate(PREPARE_CLIENT_REPORT_TOOL).allowed === false, "the analyst cannot prepare a client report");
  assert(executeAdvisorGate(PREPARE_CLIENT_REPORT_TOOL).allowed === false, "the advisor cannot prepare a client report");
  assert(FINANCIAL_MANAGER_SYSTEM.includes("prepare_client_report"), "the prompt names the tool");
  assert(/do not guess/i.test(FINANCIAL_MANAGER_SYSTEM), "the prompt does not guess a report");
  assert(!/claude|anthropic/i.test(FINANCIAL_MANAGER_SYSTEM), "the prompt does not name the model vendor");
}

{
  for (const key of CLIENT_REPORT_KEYS) {
    const built = buildPrepareClientReportResult(CLIENT, key);
    assert(built.ok === true, `${key} is accepted`);
    if (!built.ok) continue;
    assert(built.result.prepared === true, `${key} is prepared`);
    assert(built.result.applied === false, `${key} does not apply`);
    assert(built.result.sent === false, `${key} is not sent`);
    assert(built.result.report_key === key, `${key} echoes the key`);
    const section = reportPdfSection(key);
    assert(section != null, `${key} has a rail section`);
    assert(built.result.download_path.includes(`section=${section}`), `${key} uses the studio section`);
    assert(built.result.download_path.includes("tab=reports"), `${key} opens Reports`);
    assert(built.result.download_path.includes("action=download"), `${key} downloads`);
    assert(!("cashflow" in built.result), `${key} does not return cash`);
    assert(!("budget" in built.result), `${key} does not return a budget`);
    assert(!("financials" in built.result), `${key} does not return statements`);
  }
  const refused = ["intervention", "cycle", "leverage", "assets", "labor", "movement", "advisory", ""];
  for (const key of refused) {
    const built = buildPrepareClientReportResult(CLIENT, key);
    assert(built.ok === false, `${key || "empty"} is not one of the five`);
  }
  const execute = readFileSync(resolve("supabase/functions/agent-financial-manager/execute.ts"), "utf8");
  const fn = execute.slice(execute.indexOf("function prepareClientReport"), execute.indexOf("const SURFACE_PAGE"));
  assert(fn.includes("buildPrepareClientReportResult"), "execute returns the pure result");
  assert(!fn.includes(".insert(") && !fn.includes(".update("), "prepare_client_report does not write a row");
  assert(!fn.includes("deliverable_drafts"), "prepare_client_report does not insert deliverable_drafts");
  assert(!fn.includes("advisory_pack"), "prepare_client_report does not call advisory_pack_create");
  assert(!fn.includes("applyFigureProposal") && !fn.includes("apply_figure_proposal"), "prepare_client_report does not apply figures");
  assert(!fn.includes("figure_proposals"), "prepare_client_report does not write figure_proposals");
}

{
  const named = fmClientReportRoute({ question: "Produce the health scorecard", ...FM });
  assert(named?.kind === "named" && named.key === "scorecard", "produce the health scorecard is the scorecard");
  assert(
    persistedCreateIntent("Produce the health scorecard", FM) === null,
    "the scorecard does not take the Action Plan create path",
  );
  assert(
    persistedCreateIntent("Produce the health scorecard PDF", FM) === null,
    "a named scorecard PDF is not the Action Plan PDF",
  );
  assert(fmClientReportRoute({ question: "What's the health score?", ...FM }) === null, "a health question stays a question");
  assert(persistedCreateIntent("What's the health score?") === null, "the health question is not a create");
  assert(fmClientReportRoute({ question: "What's our gross margin?", ...FM }) === null, "gross margin stays a question");
  const unnamedPdf = fmClientReportRoute({ question: "Generate a PDF", ...FM });
  assert(unnamedPdf?.kind === "unnamed", "generate a PDF does not guess a report");
  assert(persistedCreateIntent("Generate a PDF", FM) === null, "generate a PDF does not download the Action Plan");
  const unnamedReport = fmClientReportRoute({ question: "Produce a client report", ...FM });
  assert(unnamedReport?.kind === "unnamed", "produce a client report does not guess");
  assert(persistedCreateIntent("Produce a client report", FM) === null, "produce a client report is not a create");
  assert(unnamedClientReportReply() === CLIENT_REPORT_WHICH, "the reply names the five");
  assert(/Health scorecard/.test(CLIENT_REPORT_WHICH) && /Benchmark/.test(CLIENT_REPORT_WHICH), "the five are listed");
  const actionPlan = persistedCreateIntent("create an action plan PDF", FM);
  assert(actionPlan?.pdf === true && actionPlan.actions === true, "an explicit action plan PDF stays on its path");
  assert(
    fmClientReportRoute({ question: "Produce the health scorecard", agent: "analyst", audience: "accountant" }) === null,
    "the analyst thread does not take the report tool",
  );
  assert(
    fmClientReportRoute({ question: "Produce the health scorecard", agent: "advisor", audience: "accountant" }) === null,
    "the advisor thread does not take the report tool",
  );
  assert(
    fmClientReportRoute({ question: "Produce the health scorecard", agent: "financial_manager", audience: "owner" }) === null,
    "the owner thread is out of this slice",
  );
  assert(
    persistedCreateIntent("Generate a PDF", { agent: "analyst", audience: "accountant" })?.pdf === true,
    "analyst generate a PDF still creates",
  );
  const both = fmClientReportRoute({ question: "Produce the scorecard and the benchmark", ...FM });
  assert(both?.kind === "unnamed", "two named reports do not guess");
  const forecast = fmClientReportRoute({
    question: "Set opening cash to 50000 and produce the 13-week cash forecast",
    ...FM,
  });
  assert(forecast?.kind === "named" && forecast.key === "forecast", "the cash forecast is named beside a figure change");
}

{
  const base = "Check the books.";
  assert(financialManagerJobObjective(base, "") === base, "a normal job keeps the books objective");
  const inputs = planClientReportInvoke({
    clientId: CLIENT,
    reportKey: "forecast",
    message: "Set opening cash to 50000 and produce the 13-week cash forecast",
    nonce: "11111111-1111-4111-8111-111111111111",
    enabled: true,
  });
  assert(inputs.ok === true, "an enabled ask plans an invoke");
  if (inputs.ok) {
    assert(inputs.payload.trigger === "on_demand", "the job trigger is on_demand");
    assert(inputs.payload.client_id === CLIENT, "the job is for this client");
    const parsed = clientReportFromInputs(inputs.payload.inputs);
    assert(parsed?.key === "forecast", "the inputs name the forecast");
    const objective = financialManagerJobObjective(base, inputs.payload.inputs);
    assert(objective.includes("prepare_client_report"), "the report objective calls the tool");
    assert(objective.includes("forecast"), "the report objective names the key");
    assert(objective.includes("50000"), "a figure change in the same sentence stays on the objective");
    assert(/propose_figure_adjustment/.test(objective), "the figure change stays a proposal");
    assert(/not say the figures were updated/i.test(objective) || /Do not say the figures were updated/.test(objective), "the objective forbids claiming the figures were updated");
  }
  const off = planClientReportInvoke({
    clientId: CLIENT,
    reportKey: "scorecard",
    message: "Produce the health scorecard",
    nonce: "22222222-2222-4222-8222-222222222222",
    enabled: false,
  });
  assert(off.ok === false && off.reason === "financial_manager_disabled", "a disabled flag does not start the job");
  assert(
    callerMayPrepareClientReport({ userId: "acct", ownerUserId: "acct", isPracticeEditor: false }) === true,
    "the accountant who added the client may prepare a report",
  );
  assert(
    callerMayPrepareClientReport({ userId: "editor", ownerUserId: "acct", isPracticeEditor: true }) === true,
    "a practice editor may prepare a report",
  );
  assert(
    callerMayPrepareClientReport({ userId: "owner", ownerUserId: "acct", isPracticeEditor: false }) === false,
    "an owner who is not the accountant is out of this slice",
  );
}

{
  const href = clientReportDownloadPath(CLIENT, "scorecard");
  const ready = clientReportChatOutcome({
    clientId: CLIENT,
    key: "scorecard",
    httpOk: true,
    body: {
      enqueued: true,
      prepared: true,
      applied: false,
      report_key: "scorecard",
      download_path: "https://evil.example/phish",
    },
  });
  assert(ready.href === href, "the chat link is the studio path, not a path from the body");
  assert(ready.text.includes(href ?? ""), "the reply includes the download URL");
  assert(/nothing was sent/i.test(ready.text), "the reply does not say the file was sent");
  const disabled = clientReportChatOutcome({
    clientId: CLIENT,
    key: "scorecard",
    httpOk: true,
    body: { enqueued: false, prepared: false, applied: false, reason: "financial_manager_disabled", report_key: "scorecard" },
  });
  assert(!disabled.href, "a disabled runner does not offer the download");
  assert(/not turned on/i.test(disabled.text), "the reply says the Financial Manager is not turned on");
  const applied = clientReportChatOutcome({
    clientId: CLIENT,
    key: "budget",
    httpOk: true,
    body: { enqueued: true, prepared: true, applied: true, report_key: "budget" },
  });
  assert(Boolean(applied.error) && !applied.href, "applied true is refused");
  assert(
    deriveFinancialManagerEndpoint("https://x.supabase.co/functions/v1/ask-ai") ===
      "https://x.supabase.co/functions/v1/agent-financial-manager",
    "the chat posts to the financial manager function",
  );
}

{
  const classified = classifyResult(PREPARE_CLIENT_REPORT_TOOL, {
    prepared: true,
    report_key: "scorecard",
    applied: false,
  });
  assert(classified.happened === true && classified.status === "ok", "a prepared report happened");
  assert(/nothing was applied/i.test(classified.detail), "the trace says nothing was applied");
  assert(/download/i.test(classified.detail), "the trace says it is ready to download");
  const bad = classifyResult(PREPARE_CLIENT_REPORT_TOOL, { prepared: true, report_key: "labor", applied: false });
  assert(bad.happened === false, "a key outside the five did not happen");
  const ceiling = fmRunOutcome({
    stopReason: "cost_ceiling",
    maxIterations: 6,
    steps: [{ tool: "prepare_client_report", status: "ok" }],
  });
  assert(ceiling.status === "succeeded" && ceiling.stopReason === "cost_ceiling", "a report tool before the ceiling still counts");
}

{
  const oneTool = analystRunCostUsd(1_500, 900, 4_000, 4_000, CLAUDE_OPUS_55);
  assert(oneTool < FM_COST_CEILING_USD, `a one-tool report turn costs ${oneTool}, over $0.06`);
  const heavy = analystRunCostUsd(8_000, 4_000, 8_000, 16_000, CLAUDE_OPUS_55);
  assert(heavy > FM_COST_CEILING_USD, `recorded overrun ${heavy} is above the ceiling`);
  assert(FM_COST_CEILING_USD === 0.06, "the overrun does not raise the $0.06 ceiling");
  const runSrc = readFileSync(resolve("supabase/functions/agent-financial-manager/run.ts"), "utf8");
  assert(runSrc.includes("financialManagerJobObjective"), "the runner uses the report objective");
  assert(runSrc.includes('modelForAgent("financial_manager"'), "the runner still selects the model with modelForAgent");
  assert(!/CLAUDE_MODEL\s*=/.test(runSrc), "the runner does not assign CLAUDE_MODEL");
  const http = readFileSync(resolve("supabase/functions/agent-financial-manager/prepare-request.ts"), "utf8");
  assert(http.includes("agent_invoke"), "the chat starts the runner with agent_invoke");
  assert(http.includes("on_demand"), "the chat job is on_demand");
  assert(http.includes("financial_manager_enabled"), "the chat checks the runner flag");
  assert(!http.includes("CLAUDE_MODEL"), "the chat wrapper does not select a model");
  assert(!http.includes("deliverable_drafts") && !http.includes("advisory_pack"), "the wrapper does not write drafts or packs");
  const index = readFileSync(resolve("supabase/functions/agent-financial-manager/index.ts"), "utf8");
  assert(index.includes('=== "service_role"'), "service role still runs the queue job");
  assert(index.includes("handlePrepareClientReport"), "a signed-in accountant uses the wrapper");
}

type Handler = (event?: unknown) => void;

class FakeElement {
  className = "";
  type = "";
  role = "";
  disabled = false;
  placeholder = "";
  value = "";
  href = "";
  dataset: Record<string, string | undefined> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  private html = "";
  private handlers: Record<string, Handler[]> = {};

  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(value: string) {
    this.html = value;
    if (value === "") this.children = [];
  }
  get textContent(): string {
    return this.html;
  }
  set textContent(value: string) {
    this.html = value;
  }
  addEventListener(event: string, fn: Handler) {
    (this.handlers[event] ??= []).push(fn);
  }
  click() {
    for (const fn of this.handlers.click ?? []) fn({});
  }
  input(value: string) {
    this.value = value;
    for (const fn of this.handlers.input ?? []) fn({ target: this });
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
  focus() {}
  find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

(globalThis as { document?: unknown }).document = {
  createElement: () => new FakeElement(),
};
(globalThis as { requestAnimationFrame?: (fn: () => void) => void }).requestAnimationFrame = (fn) => fn();
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as { location?: { search: string } }).location = { search: "" };

function openAndSend(container: FakeElement, question: string) {
  const trigger = container.find((el) => el.className.includes("ask-ai-trigger"));
  if (!trigger) throw new Error("trigger missing");
  trigger.click();
  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  if (!ta) throw new Error("textarea missing");
  ta.input(question);
  const send = container.find((el) => el.className.includes("ask-ai-send"));
  if (!send) throw new Error("send missing");
  send.click();
}

type Call = { url: string; body: Record<string, unknown> };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone() {
      return { json: async () => body };
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(agent: string, audience: "accountant" | "owner", calls: Call[]) {
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const key = calls.at(-1)?.body.reportKey;
    return jsonResponse(200, {
      ok: true,
      enqueued: true,
      prepared: true,
      applied: false,
      report_key: key,
      trigger: "on_demand",
      download_path: "https://evil.example/phish",
    });
  };
  const container = new FakeElement();
  container.dataset.clientId = CLIENT;
  container.dataset.agent = agent;
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "token-1",
    audience,
  });
  return container;
}

{
  const calls: Call[] = [];
  const container = mount("financial_manager", "accountant", calls);
  openAndSend(container, "Produce the health scorecard");
  await flush();
  assert(calls.length === 1, "the scorecard ask posts once");
  assert(calls[0].url.endsWith("/agent-financial-manager"), "the scorecard ask posts to the financial manager");
  assert(calls[0].body.mode === "prepare_client_report", "the body asks the runner to prepare the report");
  assert(calls[0].body.reportKey === "scorecard", "the body names the scorecard");
  assert(calls[0].body.mode !== "create", "the scorecard ask is not mode create");
  const button = container.find((el) => el.dataset.reportDownload === "1");
  assert(button != null, "the reply has a download control");
  assert(button?.href.includes("section=scorecard") && button.href.includes("action=download"), "the control opens the studio download");
  assert(!button?.href.includes("evil.example"), "the control ignores a foreign download path");
}

{
  const calls: Call[] = [];
  const container = mount("financial_manager", "accountant", calls);
  openAndSend(container, "Generate a PDF");
  await flush();
  assert(calls.length === 0, "generate a PDF does not call a backend");
  const which = container.find((el) => el.innerHTML.includes("Which report"));
  assert(which != null, "generate a PDF asks which of the five");
  assert(container.find((el) => el.dataset.reportDownload === "1") == null, "generate a PDF does not download");
}

{
  const calls: Call[] = [];
  const container = mount("financial_manager", "accountant", calls);
  openAndSend(container, "Produce a client report");
  await flush();
  assert(calls.length === 0, "produce a client report does not guess a file");
  assert(container.find((el) => el.innerHTML.includes("Which report")) != null, "produce a client report asks which");
}

{
  const calls: Call[] = [];
  const container = mount("financial_manager", "accountant", calls);
  openAndSend(container, "What's the health score?");
  await flush();
  assert(calls.length === 1 && calls[0].url.endsWith("/ask-ai"), "a health question stays on ask-ai");
  assert(calls[0].body.mode !== "create" && calls[0].body.mode !== "prepare_client_report", "a question does not prepare or create");
}

{
  const calls: Call[] = [];
  const container = mount("analyst", "accountant", calls);
  openAndSend(container, "Generate a PDF");
  await flush();
  assert(calls.length === 1, "analyst generate a PDF still posts");
  assert(calls[0].url.endsWith("/milon-bot"), "analyst generate a PDF stays on milon-bot");
  assert(calls[0].body.mode === "create", "analyst generate a PDF keeps mode create");
}

{
  const calls: Call[] = [];
  const container = mount("analyst", "accountant", calls);
  openAndSend(container, "Produce the health scorecard");
  await flush();
  assert(calls.length === 1 && calls[0].url.endsWith("/ask-ai"), "the analyst scorecard ask stays on ask-ai");
  assert(calls[0].body.mode !== "prepare_client_report", "the analyst does not call prepare_client_report");
}

{
  const calls: Call[] = [];
  const container = mount("financial_manager", "owner", calls);
  openAndSend(container, "Produce the health scorecard");
  await flush();
  assert(calls.length === 1 && calls[0].url.endsWith("/ask-ai"), "the owner thread does not prepare a catalogue PDF");
  assert(container.find((el) => el.dataset.reportDownload === "1") == null, "the owner reply has no download control");
}

console.log("client-report-prepare: ok");
