/**
 * Open an individual IRP6 from Work → Tax. A current draft wins.
 * Otherwise the latest tax pack is mapped onto an unsaved seed.
 * Nothing is emailed.
 */
import { supabase } from "@/integrations/supabase/client";
import { TAX_PACK_FILE_MARK, TAX_PACK_KIND } from "@/lib/tax-deliverable";
import type { TaxFormDraft } from "./drafts.ts";
import { irp6DefaultPick, parseRandsToCents, type Irp6Period } from "./irp6.ts";
import {
  findIrp6IndividualDraft,
  irp6IndividualFieldFromPack,
  irp6IndividualFromCited,
  irp6IndividualYearOfAssessment,
  type Irp6IndividualInputs,
  type Irp6IndQuery,
  type Irp6PackCited,
} from "./irp6-individual.ts";
import { itr12FromTaxPackBody } from "./itr12.ts";

const FIGURE_LINE = /^- (.+): (-?R [\d\u00a0 ]+\.\d{2})(?: \(check\))? — source: (.+)$/;

function fileIdFromSource(tail: string): string | null {
  const noteAt = tail.indexOf(" Note: ");
  const main = (noteAt >= 0 ? tail.slice(0, noteAt) : tail).trim();
  const mark = main.lastIndexOf(TAX_PACK_FILE_MARK);
  if (mark < 0) return null;
  const fileId = main
    .slice(mark + TAX_PACK_FILE_MARK.length)
    .replace(/\.$/, "")
    .trim();
  return fileId || null;
}

/** Lines the ITR12 mapper drops because they are not ITR12 fields. */
function extraPackLines(body: string, already: ReadonlySet<string>): Irp6PackCited[] {
  const out: Irp6PackCited[] = [];
  let index = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const match = line.match(FIGURE_LINE);
    if (!match) continue;
    index += 1;
    const label = match[1].trim();
    if (already.has(label)) continue;
    const fieldId = irp6IndividualFieldFromPack("", label);
    if (fieldId !== "payeWithheld" && fieldId !== "basicAmount" && fieldId !== "paymentsMade")
      continue;
    const cents = parseRandsToCents(match[2]);
    const fileId = fileIdFromSource(match[3]);
    if (cents == null || !fileId) continue;
    out.push({
      id: `irp6-extra-${index}`,
      fieldId,
      label,
      amountCents: cents,
      fileId,
      source: "file",
      note: null,
    });
  }
  return out;
}

function dropStaleQueries(inputs: Irp6IndividualInputs): Irp6IndividualInputs {
  const labels = new Set(inputs.lines.map((line) => line.label));
  const queries: Irp6IndQuery[] = inputs.queries.filter((query) => {
    const label = query.text.split(":")[0]?.trim();
    return !(label && labels.has(label) && /left out/.test(query.text));
  });
  return { ...inputs, queries };
}

export function irp6IndividualSeedFromPack(body: string): {
  year: number | null;
  inputs: Irp6IndividualInputs;
} | null {
  const parsed = itr12FromTaxPackBody(body);
  if (!parsed) return null;
  const cited: Irp6PackCited[] = [
    ...parsed.inputs.lines.map((line) => ({
      id: line.id,
      fieldId: line.fieldId,
      label: line.label,
      amountCents: line.amountCents,
      fileId: line.fileId,
      source: line.source,
      note: line.note,
    })),
    ...extraPackLines(body, new Set(parsed.inputs.lines.map((line) => line.label))),
  ];
  return {
    year: parsed.year,
    inputs: dropStaleQueries(
      irp6IndividualFromCited({
        taxReference: parsed.inputs.taxReference,
        lines: cited,
        queries: parsed.inputs.queries,
      }),
    ),
  };
}

export async function loadIrp6IndividualOpen(
  clientId: string,
  drafts: readonly TaxFormDraft[],
  today: string,
): Promise<{ year: number; period: Irp6Period; seed: Irp6IndividualInputs | null }> {
  let body: string | null = null;
  if (clientId.trim()) {
    const { data, error } = await supabase
      .from("deliverable_drafts")
      .select("body, status")
      .eq("client_id", clientId)
      .eq("kind", TAX_PACK_KIND)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!error && Array.isArray(data)) {
      const row = data.find(
        (item) => item.status !== "discarded" && typeof item.body === "string" && item.body.trim(),
      );
      body = row && typeof row.body === "string" ? row.body : null;
    }
  }
  const parsed = body ? irp6IndividualSeedFromPack(body) : null;
  const year = parsed?.year ?? irp6IndividualYearOfAssessment(today);
  const period = irp6DefaultPick(today, 3).period;
  if (findIrp6IndividualDraft(drafts, year, period)) return { year, period, seed: null };
  return { year, period, seed: parsed?.inputs ?? null };
}
