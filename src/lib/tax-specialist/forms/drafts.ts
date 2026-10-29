/**
 * Saved tax form drafts on public.tax_form_drafts. Until that table exists the
 * drafts live in this browser, so applying the migration late is safe.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  IRP6_EMPTY_INPUTS,
  parseRandsToCents,
  type Irp6Adjustment,
  type Irp6Inputs,
  type Irp6Period,
  type Irp6SectionId,
  type Irp6Sheet,
  type Irp6SourceKind,
  zaToday,
} from "./irp6.ts";
import { formatSampleDate } from "../sample-compute.ts";

export type TaxFormDraftStatus = "draft" | "approved" | "downloaded";

export const TAX_FORM_DRAFT_STATUS_LABEL: Record<TaxFormDraftStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  downloaded: "Downloaded",
};

export type TaxFormDraftField = { value: string | Irp6Adjustment[]; source: Irp6SourceKind };

export type TaxFormDraft = {
  id: string;
  client_id: string;
  form_code: "IRP6" | "IRP5";
  tax_year: number;
  period: number | null;
  subject: string | null;
  fields: Record<string, TaxFormDraftField>;
  approvals: Partial<Record<Irp6SectionId, boolean>>;
  status: TaxFormDraftStatus;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  downloaded_at: string | null;
  created_at: string;
  updated_at: string;
};

const MISSING_TABLE = /tax_form_drafts|42P01|PGRST205|schema cache/;
const LOCAL_KEY = "milon.taxFormDrafts.";

function localRead(clientId: string): TaxFormDraft[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY + clientId);
    const rows = raw ? (JSON.parse(raw) as TaxFormDraft[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function localWrite(clientId: string, rows: TaxFormDraft[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY + clientId, JSON.stringify(rows));
  } catch {
    /* storage full or blocked; the draft stays in memory */
  }
}

function sameReturn(
  a: TaxFormDraft,
  b: Pick<TaxFormDraft, "form_code" | "tax_year" | "period" | "subject">,
): boolean {
  return (
    a.form_code === b.form_code &&
    a.tax_year === b.tax_year &&
    (a.period ?? null) === (b.period ?? null) &&
    (a.subject ?? null) === (b.subject ?? null)
  );
}

function asDraft(row: Record<string, unknown>): TaxFormDraft {
  return {
    ...(row as unknown as TaxFormDraft),
    fields: (row.fields ?? {}) as TaxFormDraft["fields"],
    approvals: (row.approvals ?? {}) as TaxFormDraft["approvals"],
  };
}

export async function loadTaxFormDrafts(clientId: string): Promise<TaxFormDraft[]> {
  if (!clientId.trim()) return [];
  const local = localRead(clientId);
  const { data, error } = await supabase
    .from("tax_form_drafts")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (!MISSING_TABLE.test(error.message ?? ""))
      console.warn("tax_form_drafts load:", error.message);
    return local;
  }
  const server = Array.isArray(data)
    ? data.map((row) => asDraft(row as Record<string, unknown>))
    : [];
  const extra = local.filter((row) => !server.some((s) => sameReturn(s, row)));
  return [...server, ...extra].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export type TaxFormDraftSave = Omit<TaxFormDraft, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Upsert one return. Returns the saved row, from the server when it answered. */
export async function saveTaxFormDraft(draft: TaxFormDraftSave): Promise<TaxFormDraft> {
  const now = new Date().toISOString();
  const local: TaxFormDraft = {
    ...draft,
    id: draft.id ?? newId(),
    created_at: draft.created_at ?? now,
    updated_at: now,
  };
  const { id: _id, created_at: _created, ...payload } = local;
  const { data, error } = await supabase
    .from("tax_form_drafts")
    .upsert(
      {
        ...payload,
        fields: payload.fields as unknown as Json,
        approvals: payload.approvals as unknown as Json,
      },
      { onConflict: "client_id,form_code,tax_year,period,subject" },
    )
    .select("*")
    .single();
  if (error || !data) {
    if (error && !MISSING_TABLE.test(error.message ?? ""))
      console.warn("tax_form_drafts save:", error.message);
    const rows = localRead(draft.client_id).filter((row) => !sameReturn(row, local));
    localWrite(draft.client_id, [local, ...rows]);
    return local;
  }
  return asDraft(data as Record<string, unknown>);
}

export async function currentApprover(): Promise<{ id: string | null; name: string }> {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = String(meta.full_name ?? meta.name ?? user?.email ?? "").trim();
  return { id: user?.id ?? null, name: name || "You" };
}

/** fields jsonb for an IRP6 sheet: every line's plain value and source, plus the adjustment rows. */
export function irp6DraftFields(
  sheet: Irp6Sheet,
  inputs: Irp6Inputs,
): Record<string, TaxFormDraftField> {
  const out: Record<string, TaxFormDraftField> = {};
  for (const line of sheet.lines) {
    if (line.id === "taxReference")
      out[line.id] = { value: inputs.taxReference, source: line.source };
    else out[line.id] = { value: line.plain, source: line.source };
  }
  out.adjustments = { value: inputs.adjustments, source: "input" };
  return out;
}

function centsOf(field: TaxFormDraftField | undefined): number | null {
  return typeof field?.value === "string" ? parseRandsToCents(field.value) : null;
}

/** The typed inputs back out of a saved IRP6 draft. */
export function irp6InputsFromDraft(draft: TaxFormDraft | null | undefined): Irp6Inputs {
  if (!draft) return { ...IRP6_EMPTY_INPUTS, adjustments: [] };
  const f = draft.fields;
  const typed = (id: string) => (f[id]?.source === "input" ? centsOf(f[id]) : null);
  const adjustments = Array.isArray(f.adjustments?.value)
    ? (f.adjustments.value as Irp6Adjustment[])
    : [];
  return {
    taxReference: typeof f.taxReference?.value === "string" ? f.taxReference.value : "",
    profitBeforeTaxCents: typed("profitBeforeTax"),
    adjustments,
    estimateOverrideCents: typed("estimatedTaxableIncome"),
    basicAmountCents: typed("basicAmount"),
    employeesTaxCents: f.employeesTax ? typed("employeesTax") : IRP6_EMPTY_INPUTS.employeesTaxCents,
    provisionalPaidCents: typed("provisionalPaid"),
  };
}

export function findIrp6Draft(
  drafts: TaxFormDraft[],
  yearOfAssessment: number,
  period: Irp6Period,
): TaxFormDraft | undefined {
  return drafts.find(
    (row) => row.form_code === "IRP6" && row.tax_year === yearOfAssessment && row.period === period,
  );
}

/** A saved timestamp as the day in South Africa. */
export function draftDayLabel(timestamp: string): string {
  const at = new Date(timestamp);
  return formatSampleDate(Number.isNaN(at.getTime()) ? timestamp.slice(0, 10) : zaToday(at));
}

/** One Recent activity line per saved return. */
export function draftActivity(
  drafts: TaxFormDraft[],
): Array<{ id: string; text: string; at: string }> {
  return drafts
    .filter((row) => row.form_code === "IRP6")
    .map((row) => {
      const what = `IRP6 ${row.tax_year}, period ${row.period ?? 1}`;
      const approved =
        row.approved_by_name && row.approved_at
          ? ` Approved by ${row.approved_by_name} on ${draftDayLabel(row.approved_at)}.`
          : "";
      const text =
        row.status === "downloaded"
          ? `${what} downloaded on ${draftDayLabel(row.downloaded_at ?? row.updated_at)}.${approved}`
          : row.status === "approved"
            ? `${what} approved.${approved}`
            : `${what} saved as a draft on ${draftDayLabel(row.updated_at)}.`;
      return { id: `tax-draft-${row.id}`, text, at: row.updated_at };
    });
}
