/**
 * Tax Specialist deliverables for a ZA individual / sole practitioner,
 * drafted from the documents a client sent on a finished link.
 *
 * Pure rules only — no database, no model call, no file bytes. The server
 * side lives in tax-deliverable.functions.ts. Everything here enforces the
 * two hard lines of the product:
 *
 * 1. No figure is invented. Every amount must cite one of the client's
 *    files by id, or it is dropped and becomes a query.
 * 2. Milōn never computes a tax liability and never files. The worksheet
 *    is preparation for the accountant, who submits via eFiling.
 */

export const TAX_PACK_KIND = "tax_pack" as const;

/** One per send. A second draft for the same send is refused while one is open. */
export function taxPackDedupeTag(sendId: string): string {
  return `[send:${sendId}]`;
}

export type TaxPackConfidence = "stated" | "uncertain";

export type TaxPackSourceFile = {
  fileId: string;
  itemKey: string;
  displayName: string | null;
};

export type CitedFigure = {
  label: string;
  amountCents: number;
  fileId: string;
  confidence: TaxPackConfidence;
  note: string | null;
};

export type TaxPackDraft = {
  periodLabel: string | null;
  income: CitedFigure[];
  expenses: CitedFigure[];
  medicalAid: CitedFigure[];
  retirementAnnuity: CitedFigure[];
  worksheet: CitedFigure[];
  queries: string[];
};

export const TAX_PACK_LIMITS = {
  label: 160,
  note: 300,
  rowsPerSection: 40,
  queries: 30,
  query: 300,
} as const;

/** "R 12 345.67" — SARS-style spacing, cents always shown. */
export function formatRandsFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const part = (abs % 100).toString().padStart(2, "0");
  return `${sign}R ${whole}.${part}`;
}

export function taxPackSystemPrompt(): string {
  return [
    "You prepare a DRAFT tax pack for a South African individual who runs a practice as a sole practitioner. An accountant will check every line before anything is used.",
    "Return ONLY valid JSON, no markdown, no prose. Schema:",
    '{"year_of_assessment":"2026 year of assessment or null","income":[{"label":"","amount_cents":0,"file_id":"","confidence":"stated|uncertain","note":""}],"expenses":[],"medical_aid":[],"retirement_annuity":[],"worksheet":[],"queries":[""]}',
    "Rules:",
    "- Use only the documents provided, named FILE <file_id>. Every figure MUST carry the file_id of the document where that amount is printed.",
    "- Never invent, estimate, or extrapolate an amount. If an amount is not printed, or a document is unreadable, leave the figure out and add a query instead.",
    "- Never add amounts together to make a total unless the document itself prints that total.",
    "- amount_cents is an integer in cents (ZAR).",
    '- confidence is "stated" only when the amount is printed clearly next to its label. Anything less is "uncertain", with a note saying why.',
    "- worksheet lines are ITR12 preparation entries (for example practice turnover, practice expenses, medical scheme contributions, retirement annuity contributions, employment income per IRP5, local interest per IT3(b)). Each must trace to a file like every other figure.",
    "- Never compute tax payable, a refund, or a liability. Never mention logging into SARS or submitting. The accountant files via eFiling.",
    "- queries list what is missing or needs the client's confirmation. Short, one sentence each.",
    "- If the documents support nothing, return the schema with empty arrays and the queries that explain why.",
  ].join("\n");
}

/** The lines that introduce the client's files to the model. */
export function taxPackFileIntro(files: readonly TaxPackSourceFile[]): string {
  const lines = files.map(
    (file) => `FILE ${file.fileId} — item ${file.itemKey} — ${file.displayName ?? "no file name"}`,
  );
  return ["The client sent these documents:", ...lines].join("\n");
}

function asTrimmed(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function figureFrom(
  raw: unknown,
  fileIds: ReadonlySet<string>,
): { ok: true; figure: CitedFigure } | { ok: false; droppedLabel: string | null } {
  if (!raw || typeof raw !== "object") return { ok: false, droppedLabel: null };
  const o = raw as Record<string, unknown>;
  const label = asTrimmed(o.label, TAX_PACK_LIMITS.label);
  const fileId = asTrimmed(o.file_id, 80);
  const amount = o.amount_cents;
  if (!label) return { ok: false, droppedLabel: null };
  if (!fileIds.has(fileId)) return { ok: false, droppedLabel: label };
  if (typeof amount !== "number" || !Number.isInteger(amount) || Math.abs(amount) > 1e13) {
    return { ok: false, droppedLabel: label };
  }
  const note = asTrimmed(o.note, TAX_PACK_LIMITS.note);
  return {
    ok: true,
    figure: {
      label,
      amountCents: amount,
      fileId,
      confidence: o.confidence === "stated" ? "stated" : "uncertain",
      note: note || null,
    },
  };
}

function sectionFrom(raw: unknown, fileIds: ReadonlySet<string>, dropped: string[]): CitedFigure[] {
  if (!Array.isArray(raw)) return [];
  const out: CitedFigure[] = [];
  for (const item of raw) {
    if (out.length >= TAX_PACK_LIMITS.rowsPerSection) break;
    const parsed = figureFrom(item, fileIds);
    if (parsed.ok) out.push(parsed.figure);
    else if (parsed.droppedLabel) dropped.push(parsed.droppedLabel);
  }
  return out;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

/**
 * Parses the model's JSON. A figure that does not cite a provided file, or
 * has no printed integer amount, is dropped and recorded as a query — never
 * kept. Returns null only when the text is not the expected shape at all.
 */
export function parseTaxPackPayload(
  raw: string,
  files: readonly TaxPackSourceFile[],
): TaxPackDraft | null {
  const o = extractJsonObject(raw);
  if (!o) return null;
  const fileIds = new Set(files.map((file) => file.fileId));
  const dropped: string[] = [];
  const draft: TaxPackDraft = {
    periodLabel: asTrimmed(o.year_of_assessment, 80) || null,
    income: sectionFrom(o.income, fileIds, dropped),
    expenses: sectionFrom(o.expenses, fileIds, dropped),
    medicalAid: sectionFrom(o.medical_aid, fileIds, dropped),
    retirementAnnuity: sectionFrom(o.retirement_annuity, fileIds, dropped),
    worksheet: sectionFrom(o.worksheet, fileIds, dropped),
    queries: [],
  };
  const queries = Array.isArray(o.queries) ? o.queries : [];
  for (const q of queries) {
    if (draft.queries.length >= TAX_PACK_LIMITS.queries) break;
    const text = asTrimmed(q, TAX_PACK_LIMITS.query);
    if (text) draft.queries.push(text);
  }
  for (const label of dropped) {
    if (draft.queries.length >= TAX_PACK_LIMITS.queries) break;
    draft.queries.push(
      `${label}: the figure could not be traced to a sent document, so it was left out. Please confirm it with the client.`,
    );
  }
  return draft;
}

export function taxPackIsEmpty(draft: TaxPackDraft): boolean {
  return (
    draft.income.length === 0 &&
    draft.expenses.length === 0 &&
    draft.medicalAid.length === 0 &&
    draft.retirementAnnuity.length === 0 &&
    draft.worksheet.length === 0
  );
}

function fileName(files: readonly TaxPackSourceFile[], fileId: string): string {
  const file = files.find((row) => row.fileId === fileId);
  return file?.displayName ?? file?.itemKey ?? "sent document";
}

function figureLines(
  figures: readonly CitedFigure[],
  files: readonly TaxPackSourceFile[],
): string[] {
  return figures.map((figure) => {
    const check = figure.confidence === "uncertain" ? " (check)" : "";
    const note = figure.note ? ` Note: ${figure.note}` : "";
    return `- ${figure.label}: ${formatRandsFromCents(figure.amountCents)}${check} — source: ${fileName(files, figure.fileId)}.${note}`;
  });
}

export const TAX_PACK_HEADER_NOTE =
  "Every figure below is traced to a document the client sent. Nothing is estimated, and no total is added up for you. Milōn does not log into SARS and does not submit anything — you file via eFiling once you have checked this.";

export const TAX_PACK_WORKSHEET_NOTE =
  "Tax payable is not computed here. The worksheet carries only figures traced to the client's documents; the calculation and the return are yours.";

/** The deliverable body the accountant reviews. Plain text, one draft. */
export function renderTaxPackBody(input: {
  draft: TaxPackDraft;
  files: readonly TaxPackSourceFile[];
  clientName: string;
  sendId: string;
}): string {
  const { draft, files } = input;
  const section = (title: string, lines: string[], empty: string): string[] => [
    "",
    title,
    ...(lines.length > 0 ? lines : [`- ${empty}`]),
  ];
  const out: string[] = [
    `DRAFT tax pack — ${input.clientName}${draft.periodLabel ? ` — ${draft.periodLabel}` : ""}`,
    TAX_PACK_HEADER_NOTE,
    ...section(
      "1. Practice income and expenses",
      [
        ...(draft.income.length > 0 ? ["Income"] : []),
        ...figureLines(draft.income, files),
        ...(draft.expenses.length > 0 ? ["Expenses"] : []),
        ...figureLines(draft.expenses, files),
      ],
      "No practice figures could be traced to the sent documents.",
    ),
    ...section(
      "2. Medical aid and retirement annuity deductions",
      [
        ...(draft.medicalAid.length > 0 ? ["Medical aid (totals only)"] : []),
        ...figureLines(draft.medicalAid, files),
        ...(draft.retirementAnnuity.length > 0 ? ["Retirement annuity"] : []),
        ...figureLines(draft.retirementAnnuity, files),
      ],
      "No certificate totals could be traced to the sent documents.",
    ),
    ...section(
      "3. ITR12 preparation worksheet",
      [...figureLines(draft.worksheet, files), TAX_PACK_WORKSHEET_NOTE],
      "No worksheet lines could be traced.",
    ),
    ...section(
      "4. Missing items and queries",
      draft.queries.map((query) => `- ${query}`),
      "Nothing outstanding was noted. Check that against the document list yourself.",
    ),
    "",
    taxPackDedupeTag(input.sendId),
  ];
  return out.join("\n");
}

/**
 * What the accountant must tick before this leaves the practice: every
 * uncertain figure and every query. Capped so the checklist stays usable.
 */
export function taxPackAssumptions(
  draft: TaxPackDraft,
  files: readonly TaxPackSourceFile[],
): Array<{ id: string; text: string; checked: boolean }> {
  const texts: string[] = [];
  const sections = [
    draft.income,
    draft.expenses,
    draft.medicalAid,
    draft.retirementAnnuity,
    draft.worksheet,
  ];
  for (const figures of sections) {
    for (const figure of figures) {
      if (figure.confidence !== "uncertain") continue;
      texts.push(
        `Confirm ${figure.label} (${formatRandsFromCents(figure.amountCents)}) against ${fileName(files, figure.fileId)}.`,
      );
    }
  }
  for (const query of draft.queries) texts.push(query);
  return texts.slice(0, 12).map((text, index) => ({ id: `t-${index}`, text, checked: false }));
}

/** A file the server could not read becomes a query, never a guessed figure. */
export function unreadableFileQuery(
  file: TaxPackSourceFile,
  reason: "password" | "format" | "parse" | "oversized",
): string {
  const name = file.displayName ?? `the ${file.itemKey} document`;
  if (reason === "password") {
    return `${name} is password-protected and no password is saved for it. Save the file's password on this page, then draft again.`;
  }
  if (reason === "format") {
    return `${name} is in a format that could not be read. Ask the client for a PDF.`;
  }
  if (reason === "oversized") {
    return `${name} is too large to read into this pack. Open it yourself before relying on this pack.`;
  }
  return `${name} could not be read. Open it yourself before relying on this pack.`;
}

/** A checklist line the client marked missing becomes a query with their words. */
export function missingItemQuery(label: string, explanation: string | null): string {
  const said = explanation?.trim();
  return said ? `${label} was not sent — the client said: ${said}` : `${label} was not sent.`;
}

export function withExtraQueries(draft: TaxPackDraft, extra: readonly string[]): TaxPackDraft {
  const queries = [...draft.queries];
  for (const text of extra) {
    const trimmed = text.replace(/\s+/g, " ").trim().slice(0, TAX_PACK_LIMITS.query);
    if (!trimmed || queries.includes(trimmed)) continue;
    if (queries.length >= TAX_PACK_LIMITS.queries) break;
    queries.push(trimmed);
  }
  return { ...draft, queries };
}

/** True when an open tax pack for this send already exists — one draft per send. */
export function taxPackAlreadyOpen(
  existing: ReadonlyArray<{ kind: string | null; body: string | null; status: string }>,
  sendId: string,
): boolean {
  const tag = taxPackDedupeTag(sendId);
  return existing.some(
    (row) =>
      (row.status === "draft" || row.status === "ready") &&
      row.kind === TAX_PACK_KIND &&
      typeof row.body === "string" &&
      row.body.includes(tag),
  );
}
