/**
 * Tools on the Ask Analyst chat (ask-ai), for the owner and the accountant.
 * The background runner already had these. The chat request did not, so the
 * model reported they were missing from the session.
 * Tax Specialist stays off this list. Financial Manager and Advisor chat
 * keep their own paths.
 */
import { ANALYST_PEERS } from "./agent-analyst.ts";
import { sharedDeliverableToolSchemas } from "./agent-shared-reads.ts";
import { readToolSchema, sendMessageToolSchema } from "./agent-draft.ts";
import { type AskAiModelMessage } from "./ask-ai-claude-body.ts";
import { proposeFigureToolSchema } from "./figure-proposal.ts";
import { LIBRARY_READ_PROMPT } from "./library-document-read.ts";

export const ASK_AI_ANALYST_CHAT_TOOLS = [
  "get_inbox",
  "get_team_findings",
  "send_agent_message",
] as const;

export type AskAiAnalystChatTool = (typeof ASK_AI_ANALYST_CHAT_TOOLS)[number];

export const ASK_AI_ANALYST_CHAT_TOOL_LINE =
  "In this chat you can call get_inbox, get_team_findings, and send_agent_message. get_inbox is messages addressed to you. get_team_findings is recent findings from any bot. send_agent_message tells the Financial Manager or the Advisor about this client. You cannot message yourself, and you cannot message the Tax Specialist. Name the deliverable in the body. Do not send email. When they ask you to read the live inbox or team findings, or to message the Financial Manager or the Advisor, call that tool and answer from its result.";

export type AskAiToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export function askAiAnalystChatToolSchemas(): AskAiToolSchema[] {
  return [
    readToolSchema("get_inbox", "Messages addressed to you for this client. No email addresses."),
    readToolSchema("get_team_findings", "Recent findings on file for this client, from any bot."),
    sendMessageToolSchema(ANALYST_PEERS),
  ];
}

/** Analyst chat gets the three messaging tools. Every other agent gets none. */
export function askAiChatToolsForAgent(agent: string | null | undefined): AskAiToolSchema[] {
  if (agent !== "analyst") return [];
  return askAiAnalystChatToolSchemas();
}

const LIBRARY_CHAT_TOOL_NAMES = new Set(["list_client_library", "get_client_library_doc"]);

export function askAiLibraryToolSchemas(): AskAiToolSchema[] {
  return sharedDeliverableToolSchemas().filter((tool) => LIBRARY_CHAT_TOOL_NAMES.has(tool.name));
}

/**
 * Tools for one ask-ai chat. Tax Specialist stays off this list.
 * The Analyst keeps the messaging tools and can also read the library.
 * The Financial Manager can read the library and propose a figure. The proposal stays pending.
 */
export function askAiSessionTools(agent: string | null | undefined): AskAiToolSchema[] {
  if (agent === "tax_specialist") return [];
  const library = askAiLibraryToolSchemas();
  if (agent === "analyst") return [...askAiAnalystChatToolSchemas(), ...library];
  if (agent === "financial_manager") return [...library, proposeFigureToolSchema()];
  return library;
}

export const LIBRARY_CHAT_PROMPT = LIBRARY_READ_PROMPT;

export function questionAsksAboutLibrary(question: string): boolean {
  return /\b(library|statements?|uploaded|upload|spreadsheet|transactions?|csv|excel|pdf)\b/i.test(question);
}

export function isAskAiAnalystChatTool(name: string): name is AskAiAnalystChatTool {
  return (ASK_AI_ANALYST_CHAT_TOOLS as readonly string[]).includes(name);
}

export type AskAiToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AskAiToolRound = {
  text: string;
  toolUses: AskAiToolUse[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type AskAiToolStatus = "ok" | "empty" | "error";

export const ASK_AI_ANALYST_TOOL_ROUNDS = 4;

export function askAiToolResultStatus(payload: unknown): AskAiToolStatus {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return "error";
  }
  if (payload && typeof payload === "object" && (payload as { empty?: boolean }).empty === true) {
    return "empty";
  }
  return "ok";
}

function fallbackAnswer(toolsUsed: Array<{ name: string; status: AskAiToolStatus }>): string {
  if (toolsUsed.length === 0) return "";
  if (toolsUsed.every((tool) => tool.status === "error"))
    return "I could not complete that tool call.";
  if (toolsUsed.some((tool) => tool.name === "send_agent_message" && tool.status === "ok")) {
    return "The message is with that bot. Nothing was emailed.";
  }
  return "I checked the inbox and the findings on file.";
}

/**
 * One analyst chat turn. The tools array is what the model is allowed to call.
 * An empty list is a single completion with no tools key on later requests.
 */
export async function runAskAiToolSession(input: {
  system: string;
  user: string;
  tools: AskAiToolSchema[];
  complete: (req: {
    system: string;
    messages: AskAiModelMessage[];
    tools: AskAiToolSchema[];
  }) => Promise<AskAiToolRound>;
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  redact?: (payload: unknown) => unknown;
}): Promise<{
  text: string;
  toolsUsed: Array<{ name: string; status: AskAiToolStatus }>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const messages: AskAiModelMessage[] = [{ role: "user", content: input.user }];
  const toolsUsed: Array<{ name: string; status: AskAiToolStatus }> = [];
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  const rounds = input.tools.length === 0 ? 1 : ASK_AI_ANALYST_TOOL_ROUNDS;

  for (let round = 0; round < rounds; round++) {
    const result = await input.complete({
      system: input.system,
      messages,
      tools: input.tools,
    });
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    latencyMs += result.latencyMs;
    text = result.text;
    if (result.toolUses.length === 0 || input.tools.length === 0 || round === rounds - 1) break;

    const assistant: Array<Record<string, unknown>> = [];
    if (result.text.trim()) assistant.push({ type: "text", text: result.text });
    for (const use of result.toolUses) {
      assistant.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
    }
    messages.push({ role: "assistant", content: assistant });

    const results: Array<Record<string, unknown>> = [];
    for (const use of result.toolUses) {
      let payload: unknown;
      try {
        payload = await input.execute(use.name, use.input);
      } catch (err) {
        payload = { error: err instanceof Error && err.message ? err.message : "Tool failed" };
      }
      const status = askAiToolResultStatus(payload);
      toolsUsed.push({ name: use.name, status });
      const shown = input.redact ? input.redact(payload) : payload;
      const content = JSON.stringify(shown ?? null);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: content.length > 12000 ? `${content.slice(0, 12000)}…` : content,
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!text.trim()) text = fallbackAnswer(toolsUsed);
  return { text, toolsUsed, inputTokens, outputTokens, latencyMs };
}
