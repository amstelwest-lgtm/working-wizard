/**
 * Document questions on the public link. Polite, and only about the papers.
 * No filing steps, no SARS login, no submission.
 */

export const CLIENT_AGENT_CHAT_FALLBACK = "I'll check with Theo's practice";

export const CLIENT_AGENT_CHAT_REFUSAL =
  "I can help you find the document. I don't give filing instructions, and I don't submit anything.";

export const CLIENT_AGENT_CHAT_WAIT = "Please wait a little, then ask again.";

export const CLIENT_AGENT_CHAT_LIMIT = 8;
/** Mission replies in one rate-limit window. The old document chat stays at 8. */
export const MISSION_CHAT_TURN_LIMIT = 40;

/** What the model is told. The practice fallback is the exact unsure sentence. */
export const CLIENT_AGENT_CHAT_SYSTEM = [
  "You help someone gather documents for their accountant. Be warm and polite.",
  "Answer only what a document is, where to find it, and what counts.",
  "Never give filing instructions.",
  "Never mention a SARS login, eFiling, or submitting a return.",
  "Do not ask for identity numbers, bank details, or passwords.",
  `If you are unsure, answer exactly: ${CLIENT_AGENT_CHAT_FALLBACK}`,
].join(" ");

const FILING =
  /\b(sars|efiling|e-filing)\b[\s\S]{0,80}\b(log\s?in|login|submit|file|filing)\b|\b(log\s?in|login|submit|file|filing)\b[\s\S]{0,80}\b(sars|efiling|e-filing)\b|\bhow (do|can) i file\b|\bfiling instructions\b|\bsubmit (my|the|a) (return|tax)\b|\bfile (my|the|a) (return|tax)\b/i;

export function clientAgentChatDecision(message: string): "answer" | "refuse" | "empty" {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return "empty";
  if (text.length > 400) return "refuse";
  if (FILING.test(text)) return "refuse";
  return "answer";
}

/** Drop a model reply that wandered into filing or a SARS submission. */
export function clientAgentChatReply(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || FILING.test(cleaned)) return CLIENT_AGENT_CHAT_REFUSAL;
  return cleaned.slice(0, 600);
}

export const MISSION_CHAT_REFUSAL =
  "I can stay on this request. I don't give filing instructions, and I don't log into SARS or eFiling.";

export function missionChatReply(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || FILING.test(cleaned)) return MISSION_CHAT_REFUSAL;
  return cleaned.slice(0, 2000);
}

type ChatMessage = { role: "client" | "agent"; body: string };

async function anthropicText(input: {
  apiKey: string;
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  try {
    const response = await input.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: input.messages,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ");
    return text;
  } catch {
    return null;
  }
}

export async function guideDocumentQuestion(input: {
  message: string;
  apiKey?: string | null;
  model?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const decision = clientAgentChatDecision(input.message);
  if (decision === "empty") return CLIENT_AGENT_CHAT_FALLBACK;
  if (decision === "refuse") return CLIENT_AGENT_CHAT_REFUSAL;
  const apiKey = (input.apiKey ?? "").trim();
  const model = (input.model ?? "").trim();
  if (!apiKey || !model) return CLIENT_AGENT_CHAT_FALLBACK;
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: CLIENT_AGENT_CHAT_SYSTEM,
        messages: [{ role: "user", content: input.message.replace(/\s+/g, " ").trim() }],
      }),
    });
    if (!response.ok) return CLIENT_AGENT_CHAT_FALLBACK;
    const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ");
    return clientAgentChatReply(text);
  } catch {
    return CLIENT_AGENT_CHAT_FALLBACK;
  }
}

/** One mission reply. The stored prompt is the system text. Client lines stay untrusted. */
export async function guideMissionReply(input: {
  missionPrompt: string;
  history: readonly ChatMessage[];
  message: string;
  apiKey?: string | null;
  model?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const message = input.message.replace(/\s+/g, " ").trim();
  if (!message) return MISSION_CHAT_REFUSAL;
  if (FILING.test(message)) return MISSION_CHAT_REFUSAL;
  const apiKey = (input.apiKey ?? "").trim();
  const model = (input.model ?? "").trim();
  if (!apiKey || !model) return "I'll check with the practice and stop.";
  const prior = input.history
    .filter((turn) => turn.body.trim())
    .slice(-12)
    .map((turn) => ({
      role: turn.role === "agent" ? ("assistant" as const) : ("user" as const),
      content: turn.body.replace(/\s+/g, " ").trim(),
    }));
  const text = await anthropicText({
    apiKey,
    model,
    system: input.missionPrompt,
    messages: [...prior, { role: "user", content: message }],
    maxTokens: 500,
    fetchImpl: input.fetchImpl ?? fetch,
  });
  if (!text) return "I'll check with the practice and stop.";
  return missionChatReply(text);
}

/** Rewrites the accountant's report. Falls back to the client's own words. */
export async function guideMissionReport(input: {
  instruction: string;
  missionPrompt: string;
  messages: readonly ChatMessage[];
  fileLabels: readonly string[];
  done: boolean;
  apiKey?: string | null;
  model?: string | null;
  fetchImpl?: typeof fetch;
  fallback: string;
}): Promise<string> {
  const apiKey = (input.apiKey ?? "").trim();
  const model = (input.model ?? "").trim();
  if (!apiKey || !model) return input.fallback;
  const transcript = input.messages
    .map(
      (turn) =>
        `${turn.role === "agent" ? "Agent" : "Client"}: ${turn.body.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  const files = input.fileLabels.length ? input.fileLabels.join(", ") : "None.";
  const text = await anthropicText({
    apiKey,
    model,
    system: input.instruction,
    messages: [
      {
        role: "user",
        content: [
          "Mission prompt:",
          input.missionPrompt,
          "",
          "Messages:",
          transcript || "None.",
          "",
          "File labels:",
          files,
          "",
          input.done ? "The client has marked the visit finished." : "The visit is still open.",
        ].join("\n"),
      },
    ],
    maxTokens: 400,
    fetchImpl: input.fetchImpl ?? fetch,
  });
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned || FILING.test(cleaned)) return input.fallback;
  return cleaned.slice(0, 2000);
}
