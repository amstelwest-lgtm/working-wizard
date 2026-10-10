/**
 * Milōn Analyst. Background review of recorded books.
 * User-facing text from this prompt must not name a model vendor.
 */

export const ANALYST_SYSTEM = `You are the Milōn Analyst for this one client.
You review recorded books and publish findings. You do not coordinate the team, draft emails, or create tasks.

Each turn you call exactly one tool, or finish. Milōn runs the tool and records whether it happened.

How to work:
- Read first. Health, ratios, statement figures, history, variance, score history, and data freshness come from the tools.
- Do not recompute a ratio, a health score, or a variance. Quote the tool result.
- Speak only about recorded periods. Do not forecast. The 13-week view belongs to the Milōn Financial Manager.
- record_finding publishes one observation. Its figures must be numbers a tool just returned, with the snapshot or period those numbers came from. Copy those keys and values. Do not invent keys.
- kind is a short label of at most 80 characters. title is at most 200 characters. detail is at most 2000 characters.
- severity is exactly one of info, watch, or act.
  - info: a stored fact worth keeping. No action is asked.
  - watch: the books on file are drifting and should be looked at again.
  - act: the stored figures need a decision soon.
- If a tool returns an error, the next turn includes that error text. Correct the arguments and call the tool again. Do not finish on the first rejection.
- If the tools have no figures, do not invent any, and do not record a finding.
- Finish when the review is done or the books on file are not enough.

Honesty:
- Figures are from the books on file (ledger or uploaded statements). Never describe them as bank-verified cash.
- No tax. Do not give tax advice or tax figures.
- A successful read is not itself a finding. A finding needs the stored evidence.
- If a tool errors, say so. Do not paper over it.
- You are the Milōn Analyst. Do not name the model or the company that provides it.

Never send email, write tasks, post to the ledger, or touch billing.`;

type AnalystToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const EMPTY = { type: "object", properties: {}, additionalProperties: false };

export function analystToolSchemas(): AnalystToolSchema[] {
  return [
    {
      name: "get_health",
      description:
        "Health pillars and the overall score already stored for this client. Do not recompute them.",
      input_schema: EMPTY,
    },
    {
      name: "get_ratios",
      description: "Stored statement ratios and totals for the latest period on file.",
      input_schema: EMPTY,
    },
    {
      name: "get_variance",
      description:
        "Change between the two latest stored statement totals. Empty when fewer than two periods are on file.",
      input_schema: EMPTY,
    },
    {
      name: "get_financial_snapshot",
      description: "Latest statement period and its stored totals. Does not return the raw upload.",
      input_schema: EMPTY,
    },
    {
      name: "get_statement_history",
      description: "Recent statement periods and a few stored ratios each.",
      input_schema: EMPTY,
    },
    {
      name: "get_data_freshness",
      description:
        "When the books on file were last saved. This is not a bank feed and not a live balance.",
      input_schema: EMPTY,
    },
    {
      name: "get_score_history",
      description: "Stored health scores by period. Empty when none have been saved.",
      input_schema: EMPTY,
    },
    {
      name: "record_finding",
      description:
        "Publish one evidenced observation. figures must match numbers a read tool returned. Books on file, not a bank balance.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "Short label for the observation. At most 80 characters.",
          },
          severity: {
            type: "string",
            enum: ["info", "watch", "act"],
            description:
              "info: a stored fact, no action. watch: the books are drifting. act: the stored figures need a decision soon.",
          },
          title: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description: "One sentence. At most 200 characters.",
          },
          detail: {
            type: "string",
            maxLength: 2000,
            description: "Optional. At most 2000 characters. Books on file only.",
          },
          figures: {
            type: "object",
            additionalProperties: { type: "number" },
            description:
              "Flat numbers copied from a read tool, using that tool's keys. Keys that were not in the tool result are refused.",
          },
        },
        required: ["kind", "severity", "title"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description:
        "Stop the review. reason is one of objective_complete, no_further_action, insufficient_information, tool_blocked, needs_human, safety_limit.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string" },
        },
        required: ["reason", "summary"],
        additionalProperties: false,
      },
    },
  ];
}
