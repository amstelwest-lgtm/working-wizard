/**
 * Financial Manager client-report slice.
 * Names one of the five rail PDFs and points at the Reports studio
 * download that already exists. It does not write books, drafts, or packs.
 */

export const PREPARE_CLIENT_REPORT_TOOL = "prepare_client_report";

export const CLIENT_REPORT_KEYS = [
  "scorecard",
  "forecast",
  "waterfall",
  "budget",
  "benchmark",
] as const;

export type ClientReportKey = (typeof CLIENT_REPORT_KEYS)[number];

export const CLIENT_REPORT_LABELS: Record<ClientReportKey, string> = {
  scorecard: "Health scorecard",
  forecast: "13-week cash forecast",
  waterfall: "Profitability waterfall",
  budget: "Budget & variance",
  benchmark: "Benchmark",
};

/** Reports rail section. Budget must not reuse the Budget tab's section. */
const CLIENT_REPORT_SECTION: Record<ClientReportKey, string> = {
  scorecard: "scorecard",
  forecast: "forecast",
  waterfall: "waterfall",
  budget: "budget-pdf",
  benchmark: "benchmark",
};

const CLIENT_REPORT_KEY_SET = new Set<string>(CLIENT_REPORT_KEYS);

export function isClientReportKey(value: unknown): value is ClientReportKey {
  return typeof value === "string" && CLIENT_REPORT_KEY_SET.has(value);
}

export function normalizeReportAsk(question: string): string {
  return question
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Catalogue names in the sentence. More than one means the ask did not pick. */
export function clientReportKeysInQuestion(question: string): ClientReportKey[] {
  const q = normalizeReportAsk(question);
  if (!q) return [];
  const keys = new Set<ClientReportKey>();
  if (/\b(health scorecard|scorecard)\b/.test(q)) keys.add("scorecard");
  if (
    /\b(13 week cash forecast|13 week cash flow forecast|cash flow forecast|cash forecast|13 week forecast)\b/.test(
      q,
    )
  ) {
    keys.add("forecast");
  }
  if (/\b(profitability waterfall|waterfall)\b/.test(q)) keys.add("waterfall");
  if (/\b(industry benchmark|benchmark)\b/.test(q)) keys.add("benchmark");
  if (/\b(budget and variance|budget variance|budget pdf|budget report)\b/.test(q))
    keys.add("budget");
  if (/\b(produce|generate|prepare|create|make|build|draft|write) (the |a |an )?budget\b/.test(q)) {
    keys.add("budget");
  }
  return CLIENT_REPORT_KEYS.filter((key) => keys.has(key));
}

/**
 * An imperative that asks for a PDF or a client report and names none of the five.
 * An action-plan or advisory-pack sentence is left on its existing path.
 */
export function isUnnamedClientReportAsk(question: string): boolean {
  const q = normalizeReportAsk(question);
  if (!q) return false;
  if (/\baction plan\b/.test(q)) return false;
  if (/\b(advisory|deliverable|pack)\b/.test(q)) return false;
  if (/\bpdf\b/.test(q)) return true;
  if (/\bclient report\b/.test(q)) return true;
  if (/\b(a|the) report\b/.test(q)) return true;
  return false;
}

export function clientReportDownloadPath(clientId: string, key: ClientReportKey): string | null {
  const id = clientId.trim();
  if (!id || /[/?#\\\s]/.test(id)) return null;
  const section = CLIENT_REPORT_SECTION[key];
  return `/clients/${encodeURIComponent(id)}?tab=reports&section=${section}&action=download`;
}

export const CLIENT_REPORT_WHICH =
  "Which report should I prepare? Health scorecard, 13-week cash forecast, Profitability waterfall, Budget & variance, or Benchmark.";

export function unnamedClientReportReply(): string {
  return CLIENT_REPORT_WHICH;
}

export function clientReportDisabledReply(key: ClientReportKey): string {
  return `${CLIENT_REPORT_LABELS[key]} was not prepared. The Financial Manager is not turned on for this practice, so the download was not started. Nothing was sent.`;
}

export function clientReportReadyReply(key: ClientReportKey, path: string): string {
  return `${CLIENT_REPORT_LABELS[key]} is ready in Reports. Open ${path} to download the PDF on that page. Nothing was sent. The saved books were not changed.`;
}

export type PrepareClientReportResult = {
  prepared: true;
  report_key: ClientReportKey;
  applied: false;
  download_path: string;
  sent: false;
};

/**
 * The tool result. applied is always false. There is no insert, no pack,
 * and no path into applyFigureProposal.
 */
export function buildPrepareClientReportResult(
  clientId: string,
  reportKey: unknown,
): { ok: true; result: PrepareClientReportResult } | { ok: false; error: string } {
  if (!isClientReportKey(reportKey)) {
    return {
      ok: false,
      error: `report_key must be one of ${CLIENT_REPORT_KEYS.join(", ")}.`,
    };
  }
  const download_path = clientReportDownloadPath(clientId, reportKey);
  if (!download_path) return { ok: false, error: "client_id is not a client page." };
  return {
    ok: true,
    result: {
      prepared: true,
      report_key: reportKey,
      applied: false,
      download_path,
      sent: false,
    },
  };
}

export function prepareClientReportToolSchema() {
  return {
    name: PREPARE_CLIENT_REPORT_TOOL,
    description:
      "Name one existing client PDF so the accountant can download it from Reports. report_key is scorecard, forecast, waterfall, budget, or benchmark. Does not write books, send the file, or sign it off. applied is false. The download_path is the existing Reports page.",
    input_schema: {
      type: "object",
      properties: {
        report_key: {
          type: "string",
          enum: [...CLIENT_REPORT_KEYS],
          description: CLIENT_REPORT_KEYS.join(", "),
        },
      },
      required: ["report_key"],
      additionalProperties: false,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientReportJobInputs(
  key: ClientReportKey,
  nonce: string,
  message: string,
): string {
  const id = nonce.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36) || "ask";
  const text = message.replace(/\s+/g, " ").trim().slice(0, 500);
  return `client_report:${key}:${id}:${text}`;
}

export function clientReportFromInputs(
  inputs: string,
): { key: ClientReportKey; message: string } | null {
  const match = /^client_report:(scorecard|forecast|waterfall|budget|benchmark):[^:]*:(.*)$/s.exec(
    inputs,
  );
  if (!match || !isClientReportKey(match[1])) return null;
  return { key: match[1], message: match[2] ?? "" };
}

/**
 * Background jobs keep their books check. A chat ask names the report and
 * the sentence, so a figure change in the same breath stays a proposal.
 */
export function financialManagerJobObjective(base: string, inputs: string): string {
  const parsed = clientReportFromInputs(inputs);
  if (!parsed) return base;
  return [
    `The accountant asked: ${parsed.message}`,
    `Call prepare_client_report with report_key ${parsed.key}.`,
    "Then finish. Put the tool download_path in the summary.",
    "The PDF is the existing Reports file. Nothing is sent or signed off. applied is false.",
    "If the same sentence changes a cash, budget, or waterfall number, the only write is propose_figure_adjustment. It stays pending. The PDF uses the saved books. Do not say the figures were updated.",
    "Do not email, and do not write a draft unless the books need a separate hand-off.",
  ].join(" ");
}

export type ClientReportInvokePlan =
  | { ok: false; reason: "client" | "report_key" | "financial_manager_disabled" }
  | {
      ok: true;
      payload: {
        client_id: string;
        trigger: "on_demand";
        inputs: string;
        attempt: 1;
        correlation_id: string;
      };
    };

/** The authenticated wrapper starts this payload. Opus stays in the runner. */
export function planClientReportInvoke(input: {
  clientId: string;
  reportKey: string;
  message: string;
  nonce: string;
  enabled: boolean;
}): ClientReportInvokePlan {
  if (!UUID_RE.test(input.clientId)) return { ok: false, reason: "client" };
  if (!isClientReportKey(input.reportKey)) return { ok: false, reason: "report_key" };
  if (!input.enabled) return { ok: false, reason: "financial_manager_disabled" };
  const correlation_id = UUID_RE.test(input.nonce) ? input.nonce : cryptoRandomId(input.nonce);
  return {
    ok: true,
    payload: {
      client_id: input.clientId,
      trigger: "on_demand",
      inputs: clientReportJobInputs(input.reportKey, input.nonce || correlation_id, input.message),
      attempt: 1,
      correlation_id,
    },
  };
}

function cryptoRandomId(seed: string): string {
  const hex = seed
    .replace(/[^a-f0-9]/gi, "")
    .padEnd(32, "0")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Accountant who can open the file: the person who added the client, or a
 * practice editor. A workspace member who is only the owner is out of this slice.
 */
export function callerMayPrepareClientReport(input: {
  userId: string;
  ownerUserId: string | null;
  isPracticeEditor: boolean;
}): boolean {
  if (!input.userId) return false;
  if (input.isPracticeEditor) return true;
  return input.userId === input.ownerUserId;
}

export function deriveFinancialManagerEndpoint(
  askAiEndpoint: string | undefined | null,
): string | null {
  if (!askAiEndpoint) return null;
  const swapped = askAiEndpoint.replace(
    /\/functions\/v1\/ask-ai\/?$/,
    "/functions/v1/agent-financial-manager",
  );
  return swapped === askAiEndpoint ? null : swapped;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export type ClientReportChatOutcome = {
  text: string;
  href?: string;
  label?: string;
  error?: string;
};

/** Chat copy from the wrapper response. The link is rebuilt here, not trusted from the body. */
export function clientReportChatOutcome(input: {
  clientId: string;
  key: ClientReportKey;
  httpOk: boolean;
  body: unknown;
}): ClientReportChatOutcome {
  const rec = asRecord(input.body);
  if (!input.httpOk) {
    const error =
      rec && typeof rec.error === "string" && rec.error.trim()
        ? rec.error.trim()
        : "The Financial Manager did not start.";
    return { text: "", error };
  }
  const label = CLIENT_REPORT_LABELS[input.key];
  if (rec?.reason === "financial_manager_disabled") {
    return { text: clientReportDisabledReply(input.key) };
  }
  if (
    rec?.enqueued !== true ||
    rec.applied === true ||
    rec.report_key !== input.key ||
    rec.prepared !== true
  ) {
    return { text: "", error: "The Financial Manager did not start the report." };
  }
  const href = clientReportDownloadPath(input.clientId, input.key);
  if (!href) return { text: "", error: "This client has no report link." };
  return {
    text: clientReportReadyReply(input.key, href),
    href,
    label: `Download ${label}`,
  };
}
