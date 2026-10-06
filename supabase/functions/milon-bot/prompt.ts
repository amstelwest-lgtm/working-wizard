/**
 * Outgoing Milonbot prompts. History, overview, and tool results are redacted
 * before they are sent back to the model.
 */
import {
  applyRedaction,
  createRedactionSession,
  redactStructured,
  type IdentifierSubject,
  type RedactionSession,
} from "../_shared/redact-identifiers.ts";

export type BotChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export function buildMilonBotChatPayload(input: {
  system: string;
  overviewBlock?: string;
  history: BotChatTurn[];
  message: string;
  audience: string;
  subject?: IdentifierSubject;
}): { system: string; messages: BotChatTurn[]; session: RedactionSession } {
  const session = createRedactionSession(input.subject);
  const system = applyRedaction(
    input.overviewBlock ? `${input.system}\n\n${input.overviewBlock}` : input.system,
    session,
  );
  const messages: BotChatTurn[] = [
    ...input.history.map((turn) => ({
      role: turn.role,
      content: applyRedaction(turn.content, session),
    })),
    {
      role: "user",
      content: applyRedaction(
        `Audience: ${input.audience}. Client id is already scoped — do not ask for it.\n\n${input.message}`,
        session,
      ),
    },
  ];
  return { system, messages, session };
}

export function buildAgentTurnPayload(input: {
  system: string;
  overviewBlock?: string;
  user: string;
  subject?: IdentifierSubject;
  session?: RedactionSession;
}): { system: string; user: string; session: RedactionSession } {
  const session = input.session ?? createRedactionSession(input.subject);
  const system = applyRedaction(
    input.overviewBlock ? `${input.system}\n\n${input.overviewBlock}` : input.system,
    session,
  );
  return { system, user: applyRedaction(input.user, session), session };
}

/** Tool JSON fed back into the next model turn. Numeric amounts stay numbers. */
export function redactToolResult(payload: unknown, session: RedactionSession): string {
  return JSON.stringify(redactStructured(payload, session));
}
