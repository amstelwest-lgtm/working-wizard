/**
 * Ask Analyst chat must expose the messaging tools the background runner already had.
 * Run: pnpm test:ask-ai-analyst-tools
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ANALYST_PEERS, ANALYST_TOOLS } from "../src/lib/agent-analyst.ts";
import {
  ASK_AI_ANALYST_CHAT_TOOLS,
  ASK_AI_ANALYST_CHAT_TOOL_LINE,
  askAiChatToolsForAgent,
  runAskAiToolSession,
} from "../src/lib/ask-ai-analyst-tools.ts";
import { askAiClaudeRequestBody } from "../src/lib/ask-ai-claude-body.ts";
import { CLAUDE_SONNET_55 } from "../src/lib/claude-request.ts";
import { routeMilonIntent } from "../src/lib/milon-bot-copy.ts";
import { executeAskAiAnalystChatTool } from "../supabase/functions/ask-ai/analyst-chat.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";
import { milonBotChatSystem } from "../supabase/functions/milon-bot/prompt.ts";
import { deliverAgentMessage } from "../supabase/functions/_shared/agent-messages.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ctx = { copyPack: "za" as const, ratios: [] } as unknown as AskAiContext;
const NAMES = [...ASK_AI_ANALYST_CHAT_TOOLS];

{
  assert(
    JSON.stringify(NAMES) === JSON.stringify(["get_inbox", "get_team_findings", "send_agent_message"]),
    "the analyst chat list is inbox, findings, and a peer message",
  );
  for (const name of NAMES) {
    assert(ANALYST_TOOLS.includes(name), `${name} stays on the runner allow-list`);
    assert(ASK_AI_ANALYST_CHAT_TOOL_LINE.includes(name), `the prompt line names ${name}`);
  }
  assert(!NAMES.includes("record_finding" as never), "chat does not publish findings");
  assert(!NAMES.includes("send_email" as never), "chat does not send email");

  const analyst = askAiChatToolsForAgent("analyst");
  assert(
    JSON.stringify(analyst.map((tool) => tool.name)) === JSON.stringify(NAMES),
    "the analyst session tools are that list",
  );
  const send = analyst.find((tool) => tool.name === "send_agent_message");
  const peers = (send?.input_schema.properties as { to_agent?: { enum?: string[] } } | undefined)?.to_agent
    ?.enum;
  assert(
    JSON.stringify(peers) === JSON.stringify([...ANALYST_PEERS]),
    "send_agent_message peers are the financial manager and the advisor",
  );
  assert(peers && !peers.includes("tax_specialist") && !peers.includes("analyst"), "tax and self are not peers");

  for (const agent of ["financial_manager", "advisor", "tax_specialist", null, undefined]) {
    assert(askAiChatToolsForAgent(agent).length === 0, `${agent ?? "no agent"} chat has no analyst messaging tools`);
  }
}

{
  for (const audience of ["owner", "accountant"] as const) {
    const prompt = buildPrompt("Read the inbox and message the financial manager", ctx, "none", audience, "analyst");
    for (const name of NAMES) {
      assert(prompt.system.includes(name), `${audience} analyst prompt names ${name}`);
    }
    assert(prompt.system.includes(ASK_AI_ANALYST_CHAT_TOOL_LINE), `${audience} analyst prompt carries the tool line`);
    const tools = askAiChatToolsForAgent("analyst");
    for (const tool of tools) {
      assert(prompt.system.includes(tool.name), `${audience} prompt names the tool the session exposes (${tool.name})`);
    }
  }
  for (const agent of ["financial_manager", "advisor", "tax_specialist"] as const) {
    for (const audience of ["owner", "accountant"] as const) {
      const prompt = buildPrompt("Hello", ctx, "none", audience, agent);
      assert(!prompt.system.includes("send_agent_message"), `${audience} ${agent} is not told to message from this chat`);
      assert(!prompt.system.includes(ASK_AI_ANALYST_CHAT_TOOL_LINE), `${audience} ${agent} does not get the analyst tool line`);
    }
  }
  const bot = milonBotChatSystem("You are Milonbot.", "analyst", "accountant");
  assert(!bot.includes("send_agent_message"), "milon-bot is not told to call a tool its list does not have");
}

{
  const question = "Call send_agent_message, get_inbox or get_team_findings and tell me what you see.";
  assert(routeMilonIntent(question) === "ask-ai", "the messaging ask stays on ask-ai");
  assert(
    routeMilonIntent("Send the pending cash proposal note to the Financial Manager") === "ask-ai",
    "a cash note to the financial manager stays on ask-ai",
  );
}

{
  const plain = askAiClaudeRequestBody({
    model: CLAUDE_SONNET_55,
    system: "You are the analyst.",
    messages: [{ role: "user", content: "What is margin?" }],
    maxTokens: 512,
    temperature: 0.3,
  });
  assert(!("tools" in plain), "a chat with no tools omits the tools key");
  assert(plain.thinking && (plain.thinking as { type: string }).type === "between_tools", "sonnet still uses between_tools");
  assert(!("temperature" in plain), "sonnet still omits temperature");

  const analystBody = askAiClaudeRequestBody({
    model: CLAUDE_SONNET_55,
    system: "You are the analyst.",
    messages: [{ role: "user", content: "Read the inbox" }],
    maxTokens: 700,
    temperature: 0.3,
    tools: askAiChatToolsForAgent("analyst"),
  });
  const names = (analystBody.tools as Array<{ name: string }>).map((tool) => tool.name);
  assert(JSON.stringify(names) === JSON.stringify(NAMES), "the analyst request body carries the three tools");

  const other = askAiClaudeRequestBody({
    model: CLAUDE_SONNET_55,
    system: "You are the financial manager.",
    messages: [{ role: "user", content: "Cash?" }],
    maxTokens: 512,
    temperature: 0.3,
    tools: askAiChatToolsForAgent("financial_manager"),
  });
  assert(!("tools" in other), "an empty tool list still omits the tools key");
}

{
  const seen: string[][] = [];
  let executed: string | null = null;
  const result = await runAskAiToolSession({
    system: "analyst",
    user: "Read the inbox",
    tools: askAiChatToolsForAgent("analyst"),
    complete: async (req) => {
      seen.push(req.tools.map((tool) => tool.name));
      if (seen.length === 1) {
        return {
          text: "",
          toolUses: [{ id: "toolu_inbox", name: "get_inbox", input: {} }],
          inputTokens: 10,
          outputTokens: 4,
          latencyMs: 5,
        };
      }
      const last = req.messages[req.messages.length - 1];
      const blocks = Array.isArray(last?.content) ? last.content : [];
      assert(
        blocks.some((block) => block.type === "tool_result" && block.tool_use_id === "toolu_inbox"),
        "the next turn includes the inbox tool result",
      );
      return {
        text: "The inbox is empty.",
        toolUses: [],
        inputTokens: 8,
        outputTokens: 6,
        latencyMs: 4,
      };
    },
    execute: async (name) => {
      executed = name;
      return { empty: true, messages: [] };
    },
  });
  assert(JSON.stringify(seen[0]) === JSON.stringify(NAMES), "the first model call receives the messaging tools");
  assert(executed === "get_inbox", "get_inbox is executed");
  assert(result.text === "The inbox is empty.", "the answer comes from the tool result");
  assert(result.toolsUsed[0]?.name === "get_inbox" && result.toolsUsed[0]?.status === "empty", "an empty inbox is recorded");
  assert(result.inputTokens === 18 && result.outputTokens === 10, "tokens from both rounds are kept");
}

type Row = Record<string, unknown>;

function messageDb(seed: Record<string, Row[]>) {
  const inserted: Row[] = [];
  return {
    inserted,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const api = {
        _count: false,
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          api._count = opts?.count === "exact";
          return api;
        },
        eq(col: string, value: unknown) {
          filters.push([col, value]);
          return api;
        },
        is(col: string, value: unknown) {
          filters.push([col, value]);
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        insert(row: Row) {
          if (table === "agent_messages") inserted.push(row);
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const source = [...(seed[table] ?? []), ...(table === "agent_messages" ? inserted : [])];
          const matched = source.filter((row) => filters.every(([col, value]) => row[col] === value));
          const payload = api._count
            ? { data: null, error: null, count: matched.length }
            : { data: matched, error: null };
          return Promise.resolve(payload).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

const CLIENT = "79c4c485-9fa7-4499-9139-e1bb7cb40649";
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function chatCtx(db: ReturnType<typeof messageDb>) {
  return {
    clientId: CLIENT,
    correlationId: CORRELATION,
    firmId: null,
    db: db as never,
  };
}

{
  const db = messageDb({
    agent_messages: [
      {
        id: "m-analyst",
        client_id: CLIENT,
        to_agent: "analyst",
        from_agent: "financial_manager",
        type: "request",
        payload: { body: "Please look at debtor days." },
        hop: 0,
        created_at: "2026-11-02T08:00:00Z",
        correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      {
        id: "m-fm",
        client_id: CLIENT,
        to_agent: "financial_manager",
        from_agent: "advisor",
        type: "answer",
        payload: { body: "Not for the analyst." },
        hop: 1,
        created_at: "2026-11-02T09:00:00Z",
        correlation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    ],
    agent_findings: [
      {
        id: "f1",
        client_id: CLIENT,
        agent: "financial_manager",
        kind: "other",
        severity: "watch",
        title: "Debtor days are high.",
        evidence: { figures: { debtorDays: 64 } },
        created_at: "2026-11-01T00:00:00Z",
        superseded_by: null,
        dismissed_reason: null,
      },
      {
        id: "f-old",
        client_id: CLIENT,
        agent: "advisor",
        kind: "other",
        severity: "info",
        title: "Superseded.",
        evidence: {},
        created_at: "2026-10-01T00:00:00Z",
        superseded_by: "f1",
        dismissed_reason: null,
      },
    ],
  });
  const inbox = (await executeAskAiAnalystChatTool("get_inbox", {}, chatCtx(db))) as {
    empty: boolean;
    messages: Array<{ id: string }>;
  };
  assert(inbox.empty === false && inbox.messages.length === 1 && inbox.messages[0].id === "m-analyst", "inbox is messages to the analyst");
  const findings = (await executeAskAiAnalystChatTool("get_team_findings", {}, chatCtx(db))) as {
    findings: Array<{ id: string }>;
  };
  assert(findings.findings.length === 1 && findings.findings[0].id === "f1", "team findings skip superseded rows");

  const tax = (await executeAskAiAnalystChatTool(
    "send_agent_message",
    { to_agent: "tax_specialist", type: "request", body: "File this." },
    chatCtx(db),
  )) as { error?: string };
  assert(typeof tax.error === "string" && /financial_manager/.test(tax.error), "tax is refused");
  const self = (await executeAskAiAnalystChatTool(
    "send_agent_message",
    { to_agent: "analyst", type: "request", body: "Note to self." },
    chatCtx(db),
  )) as { error?: string };
  assert(typeof self.error === "string", "the analyst cannot message itself");
  const blocked = (await executeAskAiAnalystChatTool("record_finding", {}, chatCtx(db))) as {
    error?: string;
    tool_blocked?: boolean;
  };
  assert(blocked.tool_blocked === true, "record_finding is not a chat tool");
  assert(db.inserted.length === 0, "refused tools write nothing");

  const sent = (await executeAskAiAnalystChatTool(
    "send_agent_message",
    { to_agent: "financial_manager", type: "request", body: "Please review the pending cash proposal." },
    chatCtx(db),
  )) as { sent?: boolean; to_agent?: string };
  assert(sent.sent === true && sent.to_agent === "financial_manager", "the analyst can message the financial manager");
  const advisor = (await executeAskAiAnalystChatTool(
    "send_agent_message",
    { to_agent: "advisor", type: "handoff", body: "Worth a look before the owner call." },
    chatCtx(db),
  )) as { sent?: boolean; to_agent?: string };
  assert(advisor.sent === true && advisor.to_agent === "advisor", "the analyst can message the advisor");
  assert(db.inserted.length === 2, "two peer messages were saved");
  assert(db.inserted[0].from_agent === "analyst", "the message is from the analyst");
  assert(db.inserted[0].run_id == null, "a chat send has no background run id");
  assert(db.inserted[0].hop === 0, "a new chat message starts at hop 0");
  assert(
    (db.inserted[0].payload as { body: string }).body.includes("cash proposal"),
    "the body is the message",
  );
}

{
  const db = messageDb({
    agent_messages: [{ correlation_id: CORRELATION, hop: 4, client_id: CLIENT, to_agent: "advisor", from_agent: "analyst" }],
  });
  const capped = (await executeAskAiAnalystChatTool(
    "send_agent_message",
    { to_agent: "financial_manager", type: "ack", body: "Another one." },
    chatCtx(db),
  )) as { error?: string; tool_blocked?: boolean };
  assert(capped.tool_blocked === true && /hop limit/.test(capped.error ?? ""), "hop 4 blocks another send");
  assert(db.inserted.length === 0, "a blocked hop does not insert");
}

{
  const db = messageDb({});
  const draft = await deliverAgentMessage(
    {
      clientId: CLIENT,
      runId: "11111111-1111-4111-8111-111111111111",
      correlationId: CORRELATION,
      firmId: null,
      db: db as never,
      agent: "financial_manager",
    },
    {
      toAgent: "advisor",
      type: "handoff",
      payload: { finding_id: "f9", draft: true, title: "Chase debtors." },
    },
  );
  assert("ok" in draft && draft.ok === true, "a draft delivery still inserts");
  const payload = db.inserted[0].payload as { finding_id?: string; body?: string; draft?: boolean };
  assert(payload.finding_id === "f9" && payload.draft === true && payload.body == null, "draft payload is not rewritten as a chat body");
}

{
  const index = readFileSync(resolve("supabase/functions/ask-ai/index.ts"), "utf8");
  const anthropic = readFileSync(resolve("supabase/functions/ask-ai/anthropic.ts"), "utf8");
  assert(index.includes("askAiChatToolsForAgent(promptAgent)"), "ask-ai selects tools for the chat agent");
  assert(index.includes("runAskAiToolSession"), "ask-ai runs the tool session");
  assert(index.includes("callClaudeMessages"), "tool rounds use the messages call");
  assert(index.includes('agent !== "analyst"'), "analyst replies are not served from the definitional cache");
  assert(anthropic.includes("ask-ai-claude-body.ts"), "the model call builds the body without the analyst tool module");
  assert(!anthropic.includes("ask-ai-analyst-tools"), "callClaude does not import the analyst tool list");
  assert(anthropic.includes("opts?.tools"), "the request can carry tools");
}

console.log("ask-ai-analyst-tools: ok");
