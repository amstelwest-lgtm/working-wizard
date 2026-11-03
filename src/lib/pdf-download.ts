/**
 * Prepared-for label and download filename for owner and accountant PDFs.
 *
 * "Your Business" is the empty-name placeholder. A real client or entity
 * name replaces it. The file slug keeps the client and the period only —
 * the ", pro-rated from your … statement" clause stays on the page, not
 * in the filename.
 */

const PLACEHOLDER_CLIENT = "your business";

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function isPdfPlaceholderClient(name: string | null | undefined): boolean {
  return clean(name).toLowerCase() === PLACEHOLDER_CLIENT;
}

export function pdfPreparedForName(input: {
  clientName?: string | null;
  businessName?: string | null;
  entityName?: string | null;
}): string {
  const candidates = [input.clientName, input.businessName, input.entityName]
    .map(clean)
    .filter(Boolean);
  const real = candidates.find((name) => !isPdfPlaceholderClient(name));
  return real ?? candidates[0] ?? "Client";
}

/** Period text for a filename. Drops the pro-rated-from clause. */
export function pdfPeriodFileLabel(label: string | null | undefined): string {
  const raw = clean(label);
  if (!raw) return "";
  const cut = raw.search(/,\s*pro-rated from your\b/i);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

export function pdfFileSlug(value: string): string {
  return value
    .replace(/[–—]/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/_*-_*/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

export function pdfDownloadFilename(input: {
  clientName?: string | null;
  businessName?: string | null;
  entityName?: string | null;
  periodLabel?: string | null;
  reportName: string;
  extension?: string;
}): string {
  const client =
    pdfFileSlug(
      pdfPreparedForName({
        clientName: input.clientName,
        businessName: input.businessName,
        entityName: input.entityName,
      }),
    ) || "Client";
  const period = pdfFileSlug(pdfPeriodFileLabel(input.periodLabel));
  const report = pdfFileSlug(input.reportName.replace(/\.pdf$/i, "")) || "Report";
  const stem = [client, period, report].filter(Boolean).join("_");
  const extension = (input.extension ?? "pdf").replace(/^\./, "") || "pdf";
  return `${stem}.${extension}`;
}
