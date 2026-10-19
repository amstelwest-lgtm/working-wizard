/**
 * Outgoing Milonbot prompts. History, overview, and tool results are redacted
 * before they are sent back to the model.
 */
import {
  appendClientIdentity,
  applyRedaction,
  createRedactionSession,
  redactStructured,
  rehydrateWorkingContext,
  type IdentifierSubject,
  type RedactionSession,
} from "../_shared/redact-identifiers.ts";
import { scopeHistoryToAgent, type ChatAgent } from "../_shared/chat-reply.ts";
import { askAiAgentPersona } from "../ask-ai/prompt.ts";
import { productFactsBlock } from "../_shared/product-facts.ts";

export type BotChatTurn = {
  role: "user" | "assistant";
  content: string;
};

/** A history turn as the client sends it. `agent` names the thread it came from. */
export type BotHistoryTurn = BotChatTurn & { agent?: string | null };

/** Bot system prompt for one agent's chat. No agent keeps the plain Milōn Bot prompt. */
export function milonBotChatSystem(base: string, agent: ChatAgent | null, audience: string): string {
  const side = audience === "accountant" ? "accountant" : "owner";
  const withFacts = `${base}\n\n${productFactsBlock(side)}`;
  if (!agent) return withFacts;
  const persona = askAiAgentPersona(agent, side);
  return `${withFacts}\n\nThis chat: ${persona} Only this agent's own earlier turns are in this conversation. Do not refer to chats with the other agents.`;
}

export function buildMilonBotChatPayload(input: {
  system: string;
  overviewBlock?: string;
  history: BotHistoryTurn[];
  message: string;
  audience: string;
  subject?: IdentifierSubject;
  /** The agent this chat belongs to. Turns tagged with another agent are dropped. */
  agent?: ChatAgent | null;
}): {
  system: string;
  messages: BotChatTurn[];
  session: RedactionSession;
  /** Client name restored for local reasoning. Not sent to Anthropic. */
  workingContext: string;
} {
  const session = createRedactionSession(input.subject);
  const agent = input.agent ?? null;
  const baseSystem = milonBotChatSystem(input.system, agent, input.audience);
  const system = appendClientIdentity(
    applyRedaction(
      input.overviewBlock ? `${baseSystem}\n\n${input.overviewBlock}` : baseSystem,
      session,
    ),
    session,
  );
  const messages: BotChatTurn[] = [
    ...scopeHistoryToAgent(input.history, agent).map((turn) => ({
      role: turn.role,
      content: applyRedaction(turn.content, session),
    })),
    {
      role: "user",
      content: applyRedaction(
        `${
          input.overviewBlock?.trim() ? `${input.overviewBlock.trim()}\n\n` : ""
        }Audience: ${input.audience}. Client id is already scoped — do not ask for it.\n\n${input.message}`,
        session,
      ),
    },
  ];
  const outbound = [system, ...messages.map((turn) => turn.content)].join("\n");
  return { system, messages, session, workingContext: rehydrateWorkingContext(outbound, session) };
}

export function buildAgentTurnPayload(input: {
  system: string;
  overviewBlock?: string;
  user: string;
  subject?: IdentifierSubject;
  session?: RedactionSession;
}): {
  system: string;
  user: string;
  session: RedactionSession;
  /** Client name restored for local reasoning. Not sent to Anthropic. */
  workingContext: string;
} {
  const session = input.session ?? createRedactionSession(input.subject);
  const system = appendClientIdentity(
    applyRedaction(
      input.overviewBlock ? `${input.system}\n\n${input.overviewBlock}` : input.system,
      session,
    ),
    session,
  );
  const user = applyRedaction(input.user, session);
  return {
    system,
    user,
    session,
    workingContext: rehydrateWorkingContext(`${system}\n${user}`, session),
  };
}

/** Tool JSON fed back into the next model turn. Numeric amounts stay numbers. */
export function redactToolResult(payload: unknown, session: RedactionSession): string {
  return JSON.stringify(redactStructured(payload, session));
}
