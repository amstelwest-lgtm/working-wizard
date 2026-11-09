/**
 * Database side of the shared deliverable reads.
 * Selects names and bodies. Never selects a token hash or a file password.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  clientSendItem,
  figureProposalItem,
  formatPeerContextBlock,
  isSharedDeliverableRead,
  libraryDocBody,
  libraryListItem,
  listManagementRulesPayload,
  shapeManagementReport,
  taxDraftBody,
  taxDraftListItem,
  taxPackBody,
  taxPackListItem,
  type SharedDeliverableRead,
} from "../../../src/lib/agent-shared-reads.ts";
import { parseManagementHabitRuleArtifact } from "../../../src/lib/client-management-habits-rules.ts";
import { libraryReadPending } from "../../../src/lib/library-document-read.ts";
import {
  dedupeMilonBrainRules,
  formatMilonBrainRulesPromptBlock,
  MILON_BRAIN_RULES_PROMPT_LIMIT,
  milonBrainRulesPromptLines,
  orderMilonBrainRulesNewestFirst,
  type MilonBrainRuleRow,
} from "../../../src/lib/milon-brain-rules.ts";
import {
  applyRedaction,
  createRedactionSession,
  type IdentifierSubject,
} from "./redact-identifiers.ts";

type Row = Record<string, unknown>;

type QueryError = { message?: string; code?: string } | null;

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, value: readonly unknown[]) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  limit: (count: number) => Query;
  is: (column: string, value: null) => Query;
  maybeSingle: () => Promise<{ data: unknown; error: QueryError }>;
  then: (
    resolve: (value: { data: unknown; error: QueryError }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

export type ReadDb = {
  from: (table: string) => Query;
};

function dbOf(db: SupabaseClient): ReadDb {
  return db as unknown as ReadDb;
}

function asRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Row => Boolean(row) && typeof row === "object");
}

function asRow(data: unknown): Row | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Row;
}

function missingRelation(error: QueryError): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(message)
  );
}

async function readList(
  db: ReadDb,
  table: string,
  columns: string,
  clientId: string,
  limit: number,
  extraEq?: [string, string],
): Promise<{ rows: Row[]; error: string | null }> {
  let query = db.from(table).select(columns).eq("client_id", clientId);
  if (extraEq) query = query.eq(extraEq[0], extraEq[1]);
  const { data, error } = (await query.order("created_at", { ascending: false }).limit(limit)) as {
    data: unknown;
    error: QueryError;
  };
  if (missingRelation(error)) return { rows: [], error: null };
  if (error) return { rows: [], error: error.message ?? "The read failed." };
  return { rows: asRows(data), error: null };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function listLibrary(db: ReadDb, clientId: string): Promise<unknown> {
  const [artifacts, sources] = await Promise.all([
    readList(
      db,
      "client_artifacts",
      "id, kind, period_label, meta, visibility, created_at",
      clientId,
      24,
    ),
    db
      .from("source_documents")
      .select("id, mime, status, received_at")
      .eq("client_id", clientId)
      .order("received_at", { ascending: false })
      .limit(12),
  ]);
  if (artifacts.error) return { error: artifacts.error };
  const sourceResult = (await sources) as { data: unknown; error: QueryError };
  if (sourceResult.error && !missingRelation(sourceResult.error))
    return { error: sourceResult.error.message };
  const sourceRows = missingRelation(sourceResult.error) ? [] : asRows(sourceResult.data);
  const ids = sourceRows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  let extractions: Row[] = [];
  if (ids.length > 0) {
    const extracted = (await db
      .from("document_extractions")
      .select("document_id, doc_type, supplier_name")
      .in("document_id", ids)
      .limit(24)) as { data: unknown; error: QueryError };
    if (extracted.error && !missingRelation(extracted.error))
      return { error: extracted.error.message };
    extractions = missingRelation(extracted.error) ? [] : asRows(extracted.data);
  }
  const byDoc = new Map<string, Row>();
  for (const row of extractions) {
    const id = typeof row.document_id === "string" ? row.document_id : "";
    if (id && !byDoc.has(id)) byDoc.set(id, row);
  }
  const files = [
    ...artifacts.rows.map((row) => libraryListItem(row, "artifact")),
    ...sourceRows.map((row) => {
      const extra = byDoc.get(String(row.id ?? "")) ?? {};
      return libraryListItem(
        { ...row, doc_type: extra.doc_type, supplier_name: extra.supplier_name },
        "source",
      );
    }),
  ];
  if (files.length === 0) return { empty: true, files: [] };
  return { empty: false, files };
}

async function loadArtifact(
  db: ReadDb,
  clientId: string,
  id: string,
): Promise<{ row: Row | null; error: string | null; missing: boolean }> {
  const { data, error } = await db
    .from("client_artifacts")
    .select("id, kind, period_label, meta, visibility, created_at")
    .eq("client_id", clientId)
    .eq("id", id)
    .maybeSingle();
  if (missingRelation(error)) return { row: null, error: null, missing: true };
  if (error) return { row: null, error: error.message ?? "The read failed.", missing: false };
  return { row: asRow(data), error: null, missing: false };
}

async function getLibraryDoc(
  db: ReadDb,
  clientId: string,
  args: Record<string, unknown>,
  prepare?: (artifactId: string) => Promise<void>,
): Promise<unknown> {
  if (!isUuid(args.id)) return { error: "id must be the id from list_client_library." };
  const origin =
    args.origin === "source" ? "source" : args.origin === "artifact" ? "artifact" : null;
  if (!origin) return { error: "origin must be artifact or source." };
  if (origin === "artifact") {
    let loaded = await loadArtifact(db, clientId, args.id);
    if (loaded.missing) return { empty: true };
    if (loaded.error) return { error: loaded.error };
    if (!loaded.row) return { empty: true };
    if (prepare && libraryReadPending(loaded.row.meta)) {
      try {
        await prepare(args.id);
        loaded = await loadArtifact(db, clientId, args.id);
        if (loaded.error) return { error: loaded.error };
      } catch (err) {
        console.warn("library ingest failed", err instanceof Error ? err.message : err);
      }
    }
    if (!loaded.row) return { empty: true };
    return { empty: false, file: libraryDocBody(loaded.row, "artifact") };
  }
  const { data, error } = await db
    .from("source_documents")
    .select("id, mime, status, received_at")
    .eq("client_id", clientId)
    .eq("id", args.id)
    .maybeSingle();
  if (missingRelation(error)) return { empty: true };
  if (error) return { error: error.message ?? "The read failed." };
  const row = asRow(data);
  if (!row) return { empty: true };
  const extracted = (await db
    .from("document_extractions")
    .select("doc_type, supplier_name, fields, line_items, totals_check")
    .eq("document_id", args.id)
    .limit(1)) as { data: unknown; error: QueryError };
  if (extracted.error && !missingRelation(extracted.error))
    return { error: extracted.error.message };
  const extraction = missingRelation(extracted.error) ? null : (asRows(extracted.data)[0] ?? null);
  return {
    empty: false,
    file: libraryDocBody(
      {
        ...row,
        doc_type: extraction?.doc_type,
        supplier_name: extraction?.supplier_name,
        extraction,
      },
      "source",
    ),
  };
}

async function listTaxDrafts(db: ReadDb, clientId: string): Promise<unknown> {
  const { data, error } = (await db
    .from("tax_form_drafts")
    .select("id, form_code, tax_year, period, subject, status, updated_at")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(12)) as { data: unknown; error: QueryError };
  if (missingRelation(error)) return { empty: true, drafts: [] };
  if (error) return { error: error.message ?? "The read failed." };
  const drafts = asRows(data).map(taxDraftListItem);
  if (drafts.length === 0) return { empty: true, drafts: [] };
  return { empty: false, drafts };
}

async function getTaxDraft(
  db: ReadDb,
  clientId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!isUuid(args.id)) return { error: "id must be the id from list_tax_drafts." };
  const { data, error } = await db
    .from("tax_form_drafts")
    .select("id, form_code, tax_year, period, subject, status, updated_at, fields, approvals")
    .eq("client_id", clientId)
    .eq("id", args.id)
    .maybeSingle();
  if (missingRelation(error)) return { empty: true };
  if (error) return { error: error.message ?? "The read failed." };
  const row = asRow(data);
  if (!row) return { empty: true };
  return { empty: false, draft: taxDraftBody(row) };
}

async function listTaxPacks(db: ReadDb, clientId: string): Promise<unknown> {
  const listed = await readList(
    db,
    "deliverable_drafts",
    "id, kind, status, updated_at, body",
    clientId,
    8,
    ["kind", "tax_pack"],
  );
  if (listed.error) return { error: listed.error };
  const packs = listed.rows.map(taxPackListItem);
  if (packs.length === 0) return { empty: true, packs: [] };
  return { empty: false, packs };
}

async function getTaxPack(
  db: ReadDb,
  clientId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!isUuid(args.id)) return { error: "id must be the id from list_tax_packs." };
  const { data, error } = await db
    .from("deliverable_drafts")
    .select("id, kind, status, updated_at, body, assumption_checklist")
    .eq("client_id", clientId)
    .eq("id", args.id)
    .maybeSingle();
  if (missingRelation(error)) return { empty: true };
  if (error) return { error: error.message ?? "The read failed." };
  const row = asRow(data);
  if (!row || row.kind !== "tax_pack") return { empty: true };
  return { empty: false, pack: taxPackBody(row) };
}

async function getManagementReport(db: ReadDb, clientId: string): Promise<unknown> {
  const { data, error } = (await db
    .from("advisory_packs")
    .select("id, version, status, period_label, content, updated_at")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1)) as { data: unknown; error: QueryError };
  if (missingRelation(error)) return { empty: true, schema: null, body: null };
  if (error) return { error: error.message ?? "The read failed." };
  return shapeManagementReport(asRows(data)[0] ?? null);
}

async function listFigureProposals(db: ReadDb, clientId: string): Promise<unknown> {
  const listed = await readList(
    db,
    "figure_proposals",
    "id, surface, status, patch, before_values, note, proposed_by, created_at, decided_at, applied_at",
    clientId,
    12,
  );
  if (listed.error) return { error: listed.error };
  const proposals = listed.rows.map(figureProposalItem);
  if (proposals.length === 0) return { empty: true, proposals: [] };
  return { empty: false, proposals };
}

const SEND_COLUMNS_FULL =
  "id, agent, checklist_key, mission_key, created_at, consent_at, completed_at, reviewed_at, revoked_at, report_summary, firm_note";
const SEND_COLUMNS_BASE =
  "id, agent, checklist_key, created_at, consent_at, completed_at, reviewed_at, revoked_at";

async function listClientSends(db: ReadDb, clientId: string): Promise<unknown> {
  let result = (await db
    .from("client_agent_sends")
    .select(SEND_COLUMNS_FULL)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(8)) as { data: unknown; error: QueryError };
  if (result.error && result.error.code === "42703") {
    result = (await db
      .from("client_agent_sends")
      .select(SEND_COLUMNS_BASE)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(8)) as { data: unknown; error: QueryError };
  }
  if (missingRelation(result.error)) return { empty: true, sends: [] };
  if (result.error) return { error: result.error.message ?? "The read failed." };
  const sends = asRows(result.data);
  if (sends.length === 0) return { empty: true, sends: [] };
  const ids = sends.map((row) => row.id).filter((id): id is string => typeof id === "string");
  const itemsResult = (await db
    .from("client_agent_send_items")
    .select("send_id, item_key, status, quality")
    .in("send_id", ids)
    .limit(80)) as { data: unknown; error: QueryError };
  if (itemsResult.error && !missingRelation(itemsResult.error))
    return { error: itemsResult.error.message };
  const items = missingRelation(itemsResult.error) ? [] : asRows(itemsResult.data);
  return { empty: false, sends: sends.map((row) => clientSendItem(row, items)) };
}

async function listManagementRules(db: ReadDb, clientId: string): Promise<unknown> {
  const { rows, error } = await readList(
    db,
    "client_artifacts",
    "id, client_id, meta, created_by, created_at, visibility, kind",
    clientId,
    80,
    ["kind", "note"],
  );
  if (error) return { error };
  const rules = rows
    .filter((row) => row.visibility === "shared")
    .map((row) =>
      parseManagementHabitRuleArtifact({
        id: String(row.id ?? ""),
        client_id: String(row.client_id ?? clientId),
        meta: row.meta as never,
        created_by: (row.created_by as string | null) ?? null,
        created_at: (row.created_at as string | null) ?? null,
      }),
    )
    .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule));
  if (rules.length === 0) return { empty: true, rules: [] };
  return { empty: false, ...listManagementRulesPayload(rules) };
}

export async function executeSharedDeliverableRead(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    db: SupabaseClient;
    clientId: string;
    /** Fills extracted text on an upload that has not been read yet. */
    prepareLibraryArtifact?: (artifactId: string) => Promise<void>;
  },
): Promise<unknown> {
  if (!isSharedDeliverableRead(name)) return { error: "That read is not shared." };
  const db = dbOf(ctx.db);
  const tool: SharedDeliverableRead = name;
  if (tool === "list_client_library") return listLibrary(db, ctx.clientId);
  if (tool === "get_client_library_doc")
    return getLibraryDoc(db, ctx.clientId, args, ctx.prepareLibraryArtifact);
  if (tool === "list_client_management_rules") return listManagementRules(db, ctx.clientId);
  if (tool === "list_tax_drafts") return listTaxDrafts(db, ctx.clientId);
  if (tool === "get_tax_draft") return getTaxDraft(db, ctx.clientId, args);
  if (tool === "list_tax_packs") return listTaxPacks(db, ctx.clientId);
  if (tool === "get_tax_pack") return getTaxPack(db, ctx.clientId, args);
  if (tool === "get_management_report") return getManagementReport(db, ctx.clientId);
  if (tool === "list_figure_proposals") return listFigureProposals(db, ctx.clientId);
  return listClientSends(db, ctx.clientId);
}

/** Same lists the chat prompt shows. A missing table is an empty section, not a failed turn. */
export async function loadPeerContextBlock(db: SupabaseClient, clientId: string): Promise<string> {
  const read = dbOf(db);
  const [library, managementRules, drafts, packs, report, proposals, sends, findings] = await Promise.all([
    listLibrary(read, clientId),
    listManagementRules(read, clientId),
    listTaxDrafts(read, clientId),
    listTaxPacks(read, clientId),
    getManagementReport(read, clientId),
    listFigureProposals(read, clientId),
    listClientSends(read, clientId),
    (async () => {
      const { data, error } = (await read
        .from("agent_findings")
        .select("agent, kind, severity, title, created_at")
        .eq("client_id", clientId)
        .is("superseded_by", null)
        .is("dismissed_reason", null)
        .order("created_at", { ascending: false })
        .limit(8)) as { data: unknown; error: QueryError };
      if (missingRelation(error)) return { rows: [] as Row[], error: null };
      if (error) return { rows: [] as Row[], error: error.message ?? "The read failed." };
      return { rows: asRows(data), error: null };
    })(),
  ]);
  const libraryRows = asRecordList(library, "files");
  const managementPayload = asRow(managementRules);
  const managementRows = Array.isArray(managementPayload?.rules) ? asRows(managementPayload.rules) : [];
  const draftRows = asRecordList(drafts, "drafts");
  const packRows = asRecordList(packs, "packs");
  const proposalRows = asRecordList(proposals, "proposals");
  const sendRows = asRecordList(sends, "sends");
  const reportRow = asRow(report);
  return formatPeerContextBlock({
    library: libraryRows,
    managementRules: managementRows,
    taxDrafts: draftRows,
    taxPacks: packRows,
    report: reportRow && reportRow.empty === true ? null : reportRow,
    proposals: proposalRows,
    sends: sendRows,
    findings: findings.error ? [] : findings.rows,
  });
}

function asRecordList(payload: unknown, key: string): Row[] {
  const row = asRow(payload);
  if (!row || !Array.isArray(row[key])) return [];
  return asRows(row[key]);
}

function parseMilonBrainRuleRow(row: Row): MilonBrainRuleRow | null {
  const firmId = typeof row.firm_id === "string" ? row.firm_id : "";
  const taskType = typeof row.task_type === "string" ? row.task_type : "";
  const ruleText = typeof row.rule_text === "string" ? row.rule_text : "";
  const decision = row.decision;
  if (!firmId || !taskType || !ruleText) return null;
  if (decision !== "approved" && decision !== "dismissed" && decision !== "corrected") return null;
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    firm_id: firmId,
    client_id: (row.client_id as string | null) ?? null,
    task_type: taskType,
    source_event: typeof row.source_event === "string" ? row.source_event : "",
    source_row_id: (row.source_row_id as string | null) ?? null,
    decision,
    rule_text: ruleText,
    approver_id: (row.approver_id as string | null) ?? null,
    layer: typeof row.layer === "string" ? row.layer : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
  };
}

/** Active private rules for one firm/client/task set. Missing table → empty (no failed turn). */
export async function loadMilonBrainRulesPromptBlock(
  db: SupabaseClient,
  input: {
    firmId: string | null;
    clientId: string;
    taskTypes: readonly string[];
    subject?: IdentifierSubject;
  },
): Promise<string> {
  if (!input.firmId || input.taskTypes.length === 0) return "";
  const read = dbOf(db);
  const taskList = [...input.taskTypes];
  const { data, error } = (await read
    .from("milon_brain_rules")
    .select(
      "id, firm_id, client_id, task_type, source_event, source_row_id, decision, rule_text, approver_id, layer, status, created_at",
    )
    .eq("firm_id", input.firmId)
    .eq("status", "active")
    .eq("layer", "private")
    .in("task_type", taskList)
    .order("created_at", { ascending: false })
    .limit(MILON_BRAIN_RULES_PROMPT_LIMIT * 2)) as { data: unknown; error: QueryError };
  if (missingRelation(error)) return "";
  if (error) {
    console.error("milon_brain_rules_load_failed", error.message ?? error);
    return "";
  }
  const parsed = asRows(data)
    .map(parseMilonBrainRuleRow)
    .filter((row): row is MilonBrainRuleRow => Boolean(row))
    .filter(
      (row) => row.client_id == null || row.client_id === input.clientId,
    );
  const ordered = orderMilonBrainRulesNewestFirst(parsed);
  const deduped = dedupeMilonBrainRules(ordered).slice(0, MILON_BRAIN_RULES_PROMPT_LIMIT);
  if (deduped.length === 0) return "";
  const lines = milonBrainRulesPromptLines(deduped);
  const block = formatMilonBrainRulesPromptBlock(lines);
  const session = createRedactionSession(input.subject);
  return applyRedaction(block, session);
}
