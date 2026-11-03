/**
 * Reads every runner shares: library, tax drafts and packs, the schema-2
 * Management Report, figure proposals, and Send-an-agent intakes.
 * Pure shaping only. The edge loader talks to the database.
 * Nothing here writes, confirms a proposal, or returns a token or a file password.
 */
import {
  figureDraftsFromLibraryRead,
  LIBRARY_READ_PROMPT,
  libraryHasReadableContent,
  readStoredLibrary,
  sourceExtractionHasBody,
  sourceLibraryStatement,
} from "./library-document-read.ts";

export { LIBRARY_READ_PROMPT };

export const SHARED_DELIVERABLE_READS = [
  "list_client_library",
  "get_client_library_doc",
  "list_tax_drafts",
  "get_tax_draft",
  "list_tax_packs",
  "get_tax_pack",
  "get_management_report",
  "list_figure_proposals",
  "list_client_sends",
] as const;

export type SharedDeliverableRead = (typeof SHARED_DELIVERABLE_READS)[number];

export const SHARED_DELIVERABLE_TOOL_LABELS: Record<SharedDeliverableRead, string> = {
  list_client_library: "Library",
  get_client_library_doc: "Library file",
  list_tax_drafts: "Tax drafts",
  get_tax_draft: "Tax draft",
  list_tax_packs: "Tax packs",
  get_tax_pack: "Tax pack",
  get_management_report: "Management report",
  list_figure_proposals: "Figure proposals",
  list_client_sends: "Client sends",
};

const SHARED_SET = new Set<string>(SHARED_DELIVERABLE_READS);

export function isSharedDeliverableRead(name: string): name is SharedDeliverableRead {
  return SHARED_SET.has(name);
}

const DROP_KEY =
  /password|token|secret|sha256|storage_path|vat_number|bank_fingerprint|recipient_email|^email$/i;

export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Drop secrets and cap strings. A library summary may stay. A password may not. */
export function redactDeliverable(value: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (value == null) return value;
  if (typeof value === "string") return value.length > 800 ? `${value.slice(0, 799)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.slice(0, 40).map((item) => redactDeliverable(item, depth + 1));
  if (typeof value !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEY.test(key)) continue;
    out[key] = redactDeliverable(item, depth + 1);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function libraryListItem(
  row: Record<string, unknown>,
  origin: "artifact" | "source",
): Record<string, unknown> {
  const meta = asRecord(row.meta) ?? {};
  const name =
    clipText(meta.file_name, 160) ??
    clipText(row.doc_type, 80) ??
    clipText(row.kind, 80) ??
    (origin === "source" ? "Source file" : "File");
  const read =
    origin === "artifact"
      ? libraryHasReadableContent(row.meta ?? meta)
      : row.read === true ||
        row.status === "extracted" ||
        row.status === "proposed" ||
        Boolean(clipText(row.doc_type, 80));
  return {
    id: row.id,
    origin,
    name,
    kind: clipText(row.kind, 80) ?? clipText(row.doc_type, 80),
    document_type: clipText(meta.document_type, 80),
    period_label: clipText(row.period_label, 80), // date-ok: stored label passed through, not reformatted
    status: clipText(row.status, 40) ?? clipText(row.visibility, 40),
    summary: clipText(meta.summary, 240) ?? clipText(row.supplier_name, 120),
    read,
    at: row.created_at ?? row.received_at ?? null,
  };
}

export function libraryDocBody(
  row: Record<string, unknown>,
  origin: "artifact" | "source",
): Record<string, unknown> {
  const meta = asRecord(row.meta) ?? {};
  const base = libraryListItem(row, origin);
  if (origin === "artifact") {
    const stored = readStoredLibrary(row.meta);
    const name = typeof base.name === "string" ? base.name : "File";
    return {
      ...base,
      source: clipText(meta.source, 40),
      account_label: clipText(meta.account_label, 120),
      summary: clipText(stored.summary, 500) ?? clipText(meta.summary, 2000),
      read: stored.status === "read",
      content: stored.status === "read" ? clipText(stored.text, 12000) : null,
      statement: stored.statement,
      figure_drafts: figureDraftsFromLibraryRead(stored, name),
    };
  }
  const extraction = row.extraction ?? null;
  const statement = sourceLibraryStatement(extraction);
  const read = sourceExtractionHasBody(extraction);
  return {
    ...base,
    read,
    mime: clipText(row.mime, 80),
    supplier_name: clipText(row.supplier_name, 160),
    statement,
    extraction: redactDeliverable(extraction),
  };
}

export function taxDraftListItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    form_code: row.form_code ?? null,
    tax_year: row.tax_year ?? null,
    period: row.period ?? null,
    subject: clipText(row.subject, 120),
    status: row.status ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function taxDraftBody(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...taxDraftListItem(row),
    fields: redactDeliverable(row.fields ?? {}),
    approvals: redactDeliverable(row.approvals ?? {}),
  };
}

export function taxPackListItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind ?? "tax_pack",
    status: row.status ?? null,
    updated_at: row.updated_at ?? null,
    preview: clipText(row.body, 240),
  };
}

export function taxPackBody(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind ?? "tax_pack",
    status: row.status ?? null,
    updated_at: row.updated_at ?? null,
    body: clipText(row.body, 6000),
    assumptions: redactDeliverable(row.assumption_checklist ?? null),
  };
}

function sectionLines(sections: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(sections)) return [];
  return sections.slice(0, 8).map((section) => {
    const row = asRecord(section) ?? {};
    const actions = Array.isArray(row.actions)
      ? row.actions
          .slice(0, 6)
          .map((line) => clipText(line, 300))
          .filter((line): line is string => Boolean(line))
      : [];
    return {
      key: clipText(row.key, 40),
      meaning: clipText(row.meaning, 600),
      verdict: clipText(row.verdict, 300),
      actions,
      approved: row.approved === true,
    };
  });
}

function slimForecast(value: unknown): unknown {
  const row = asRecord(value);
  if (!row) return null;
  const weeks = Array.isArray(row.weeks)
    ? row.weeks.slice(0, 13).map((week) => redactDeliverable(week))
    : [];
  return {
    floor: typeof row.floor === "number" ? row.floor : null,
    weeks,
  };
}

/** Schema 2 body. Older packs stay a status line so a bot does not invent the layout. */
export function shapeManagementReport(
  row: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!row) return { empty: true, schema: null, body: null };
  const content = asRecord(row.content);
  const schema = content && (content.schema === 1 || content.schema === 2) ? content.schema : null;
  const head = {
    empty: false,
    id: row.id ?? null,
    version: row.version ?? null,
    status: row.status ?? null,
    period_label: clipText(row.period_label, 80) ?? clipText(content?.periodLabel, 80), // date-ok: stored label passed through, not reformatted
    updated_at: row.updated_at ?? null,
    schema,
  };
  if (schema !== 2 || !content) {
    return {
      ...head,
      body: null,
      note: "The saved pack is not schema 2. The body is not included.",
    };
  }
  return {
    ...head,
    note: null,
    body: {
      clientName: clipText(content.clientName, 160),
      periodLabel: clipText(content.periodLabel, 80),
      priorPeriodLabel: clipText(content.priorPeriodLabel, 80),
      sections: sectionLines(content.sections),
      health: redactDeliverable(content.health),
      ratios: Array.isArray(content.ratios) ? redactDeliverable(content.ratios.slice(0, 12)) : [],
      dupont: redactDeliverable(content.dupont),
      forecast: slimForecast(content.forecast),
      profit: redactDeliverable(content.profit),
      cashCycle: redactDeliverable(content.cashCycle),
      recommendations: Array.isArray(content.recommendations)
        ? redactDeliverable(content.recommendations.slice(0, 8))
        : [],
      outcomes: Array.isArray(content.outcomes)
        ? redactDeliverable(content.outcomes.slice(0, 8))
        : [],
      dataGaps: Array.isArray(content.dataGaps)
        ? redactDeliverable(content.dataGaps.slice(0, 8))
        : [],
      assumptions: Array.isArray(content.assumptions)
        ? content.assumptions
            .slice(0, 12)
            .map((line) => clipText(line, 300))
            .filter(Boolean)
        : [],
    },
  };
}

export function figureProposalItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    surface: row.surface ?? null,
    status: row.status ?? null,
    patch: redactDeliverable(row.patch ?? {}),
    before_values: redactDeliverable(row.before_values ?? {}),
    note: clipText(row.note, 400),
    proposed_by: clipText(row.proposed_by, 40),
    created_at: row.created_at ?? null,
    decided_at: row.decided_at ?? null,
    applied_at: row.applied_at ?? null,
  };
}

export function clientSendItem(
  row: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const sendId = String(row.id ?? "");
  const mine = items.filter((item) => String(item.send_id ?? "") === sendId);
  const received = mine.filter((item) => item.status === "received").length;
  let state = "open";
  if (row.revoked_at) state = "revoked";
  else if (row.completed_at) state = "completed";
  else if (row.consent_at) state = "consented";
  return {
    id: row.id,
    agent: row.agent ?? null,
    checklist_key: row.checklist_key ?? null,
    mission_key: row.mission_key ?? null,
    state,
    created_at: row.created_at ?? null,
    completed_at: row.completed_at ?? null,
    reviewed_at: row.reviewed_at ?? null,
    items_received: received,
    items_total: mine.length,
    items: mine.slice(0, 20).map((item) => ({
      item_key: item.item_key ?? null,
      status: item.status ?? null,
      quality: item.quality ?? null,
    })),
    report_summary: clipText(row.report_summary, 500),
    firm_note: clipText(row.firm_note, 500),
  };
}

export type PeerContextInput = {
  library: Array<Record<string, unknown>>;
  taxDrafts: Array<Record<string, unknown>>;
  taxPacks: Array<Record<string, unknown>>;
  report: Record<string, unknown> | null;
  proposals: Array<Record<string, unknown>>;
  sends: Array<Record<string, unknown>>;
  findings: Array<Record<string, unknown>>;
};

function joinBits(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(", ");
}

/** Compact block for ask-ai and milon-bot. Runners still call the get tools for a full body. */
export function formatPeerContextBlock(input: PeerContextInput): string {
  const lines: string[] = [];
  if (input.library.length > 0) {
    const shown = input.library.slice(0, 8).map((file) => {
      const name = clipText(file.name, 80) ?? "File";
      const kind = clipText(file.kind, 40);
      const read = file.read === true ? "read" : file.read === false ? "not read yet" : null;
      const bits = [kind, read].filter((bit): bit is string => Boolean(bit));
      return bits.length ? `${name} (${bits.join(", ")})` : name;
    });
    lines.push(`Library (${input.library.length}): ${shown.join("; ")}`);
  }
  if (input.taxDrafts.length > 0) {
    const shown = input.taxDrafts
      .slice(0, 6)
      .map((row) =>
        joinBits([
          clipText(row.form_code, 12),
          row.tax_year != null ? String(row.tax_year) : null,
          row.period != null ? `period ${row.period}` : null,
          clipText(row.status, 20),
        ]),
      );
    lines.push(`Tax drafts: ${shown.join("; ")}`);
  }
  if (input.taxPacks.length > 0) {
    const shown = input.taxPacks
      .slice(0, 4)
      .map((row) => joinBits([clipText(row.status, 20), clipText(row.preview, 80)]));
    lines.push(`Tax packs: ${shown.join("; ")}`);
  }
  if (input.report && input.report.empty !== true) {
    const schema =
      input.report.schema === 2
        ? "schema 2"
        : input.report.schema != null
          ? `schema ${input.report.schema}`
          : "no schema";
    const summary = Array.isArray(asRecord(input.report.body)?.sections as unknown[] | undefined)
      ? clipText(asRecord((asRecord(input.report.body)?.sections as unknown[])?.[0])?.meaning, 180)
      : null;
    lines.push(
      `Management report: version ${input.report.version ?? "?"}, ${clipText(input.report.status, 40) ?? "unspecified"}, ${schema}${
        summary ? `. ${summary}` : ""
      }`,
    );
  }
  if (input.proposals.length > 0) {
    const shown = input.proposals
      .slice(0, 6)
      .map((row) => joinBits([clipText(row.surface, 20), clipText(row.status, 20)]));
    lines.push(`Figure proposals: ${shown.join("; ")}`);
  }
  if (input.sends.length > 0) {
    const shown = input.sends
      .slice(0, 6)
      .map((row) =>
        joinBits([
          clipText(row.agent, 40),
          clipText(row.state, 20),
          typeof row.items_total === "number"
            ? `${row.items_received ?? 0}/${row.items_total} items`
            : null,
        ]),
      );
    lines.push(`Send-an-agent: ${shown.join("; ")}`);
  }
  if (input.findings.length > 0) {
    const shown = input.findings
      .slice(0, 6)
      .map((row) =>
        joinBits([clipText(row.agent, 40), clipText(row.severity, 12), clipText(row.title, 140)]),
      );
    lines.push(`Team findings: ${shown.join("; ")}`);
  }
  if (lines.length === 0) return "";
  return ["CLIENT DELIVERABLES AND TEAM FINDINGS", ...lines.map((line) => `- ${line}`)].join("\n");
}

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

function readSchema(name: string, description: string) {
  return { name, description, input_schema: EMPTY_SCHEMA };
}

function idSchema(name: string, description: string, extra?: Record<string, unknown>) {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id from the matching list tool." },
        ...extra,
      },
      required: ["id"],
      additionalProperties: false,
    },
  };
}

export function sharedDeliverableToolSchemas() {
  return [
    readSchema(
      "list_client_library",
      "Files on this client: uploads and source documents. Names, types, and short summaries. No file bytes and no storage paths.",
    ),
    {
      name: "get_client_library_doc",
      description:
        "One library file by id. origin is artifact or source. Returns read true with the extracted text and, for a bank statement, transactions and balances. Quote that body. Do not say the file has not been read when read is true. figure_drafts are not saved. No file bytes, tokens, or passwords.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          origin: { type: "string", enum: ["artifact", "source"] },
        },
        required: ["id", "origin"],
        additionalProperties: false,
      },
    },
    readSchema(
      "list_tax_drafts",
      "IRP6 and IRP5 drafts on file: form, year, period, status. Does not include the field values.",
    ),
    idSchema(
      "get_tax_draft",
      "One tax form draft, including its saved fields. Quote those fields. Do not invent a tax figure.",
    ),
    readSchema(
      "list_tax_packs",
      "Draft tax packs (kind tax_pack) for this client. Status and a short preview.",
    ),
    idSchema(
      "get_tax_pack",
      "One tax pack body. Quote it. Do not file, submit, or invent figures that are not in the body.",
    ),
    readSchema(
      "get_management_report",
      "Latest advisory Management Report. When schema is 2, body is that report (sections, health, cash, profit). This is not the advisory position.",
    ),
    readSchema(
      "list_figure_proposals",
      "Cash, budget, and waterfall proposals already saved, including your own. Read-only. Does not confirm or apply them.",
    ),
    readSchema(
      "list_client_sends",
      "Send-an-agent intakes and completed sends: agent, state, item counts, firm note, report summary. No tokens and no file passwords.",
    ),
  ];
}

export const SHARED_READ_PROMPT =
  `Shared reads are list_client_library, get_client_library_doc, list_tax_drafts, get_tax_draft, list_tax_packs, get_tax_pack, get_management_report, list_figure_proposals, and list_client_sends. Every runner has them. They do not write, send, confirm, or file. ${LIBRARY_READ_PROMPT} get_management_report returns the Management Report body when the pack schema is 2. list_figure_proposals reads proposals already saved. list_client_sends never returns a token or a file password. No tax advice. Do not invent a tax figure. Quote a tax draft or tax pack only when a tool returned it.`;
