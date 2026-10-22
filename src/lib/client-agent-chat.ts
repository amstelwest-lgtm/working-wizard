/**
 * Document questions on the public link. Polite, and only about the papers.
 * No filing steps, no SARS login, no submission.
 */

export const CLIENT_AGENT_CHAT_FALLBACK = "I'll check with Theo's practice";

export const CLIENT_AGENT_CHAT_REFUSAL =
  "I can help you find the document. I don't give filing instructions, and I don't submit anything.";

export const CLIENT_AGENT_CHAT_WAIT = "Please wait a little, then ask again.";

export const CLIENT_AGENT_CHAT_LIMIT = 8;

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
