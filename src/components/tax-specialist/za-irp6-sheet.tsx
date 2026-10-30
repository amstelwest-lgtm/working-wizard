/**
 * Milōn IRP6 preparation sheet. Loaded with the ZA tax page chunk only.
 * The accountant fills what the books cannot, approves each section, then
 * downloads a PDF and CSV to capture on SARS eFiling.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  IRP6_PERIODS,
  IRP6_SECTIONS,
  computeIrp6,
  irp6CanDownload,
  irp6Csv,
  irp6DefaultPick,
  irp6FileName,
  irp6MissingSentence,
  irp6PeriodLabel,
  irp6YearOptions,
  parseRandsToCents,
  validTaxReference,
  type Irp6Adjustment,
  type Irp6Client,
  type Irp6Inputs,
  type Irp6Line,
  type Irp6Period,
  type Irp6SectionId,
} from "@/lib/tax-specialist/forms/irp6";
import {
  TAX_FORM_DRAFT_STATUS_LABEL,
  currentApprover,
  draftDayLabel,
  findIrp6Draft,
  irp6DraftFields,
  irp6InputsFromDraft,
  saveTaxFormDraft,
  type TaxFormDraft,
  type TaxFormDraftStatus,
} from "@/lib/tax-specialist/forms/drafts";
import { formatSampleCents, formatSampleDate } from "@/lib/tax-specialist/sample-compute";
import "./za-irp6-sheet.css";

export type Irp6SheetClient = Irp6Client & { id: string };

type Approvals = Partial<Record<Irp6SectionId, boolean>>;

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function centsText(cents: number | null): string {
  if (cents == null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${rands}${rem ? `.${String(rem).padStart(2, "0")}` : ""}`;
}

function AmountInput({
  id,
  value,
  onChange,
  label,
  invalid,
}: {
  id: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  label: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(centsText(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (parseRandsToCents(text) !== value) setText(centsText(value));
    // Only follow outside changes, such as switching period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="irp6-amount">
      <span aria-hidden="true">R</span>
      <input
        id={id}
        className="irp6-input irp6-input--num"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad || invalid ? true : undefined}
        value={text}
        placeholder="0.00"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const cents = parseRandsToCents(next);
          setBad(next.trim() !== "" && cents == null);
          onChange(next.trim() === "" ? null : cents);
        }}
      />
    </span>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ApproveTick({
  section,
  approved,
  blocked,
  onToggle,
}: {
  section: Irp6SectionId;
  approved: boolean;
  blocked: string | null;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={approved ? "irp6-approve is-approved" : "irp6-approve"}
      data-irp6-approve={section}
      aria-pressed={approved}
      disabled={!approved && blocked != null}
      title={!approved && blocked ? blocked : undefined}
      onClick={onToggle}
    >
      <span className="irp6-approve-box">{approved ? <TickIcon /> : null}</span>
      {approved ? "Approved" : "Approve"}
    </button>
  );
}

function Section({
  id,
  title,
  purpose,
  approve,
  children,
}: {
  id: Irp6SectionId;
  title: string;
  purpose: string;
  approve: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="irp6-section" data-irp6-section={id} aria-labelledby={`irp6-${id}`}>
      <header className="irp6-section-head">
        <div>
          <h3 id={`irp6-${id}`} className="irp6-section-title">
            {title}
          </h3>
          <p className="irp6-section-purpose">{purpose}</p>
        </div>
        {approve}
      </header>
      {children}
    </section>
  );
}

function FieldRow({ line, children }: { line: Irp6Line; children?: ReactNode }) {
  return (
    <tr data-irp6-field={line.id} data-irp6-missing={line.missing ? "true" : undefined}>
      <th scope="row">
        <span className="irp6-label">{line.label}</span>
        {line.efiling ? <span className="irp6-efiling">eFiling: {line.efiling}</span> : null}
        {line.note ? <span className="irp6-note">{line.note}</span> : null}
      </th>
      <td className="irp6-value">{children ?? (line.display || "—")}</td>
      <td className="irp6-source">
        <span
          className={
            line.missing ? "irp6-source-tag is-missing" : `irp6-source-tag is-${line.source}`
          }
        >
          {line.sourceLabel}
        </span>
      </td>
    </tr>
  );
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function nextAdjustmentId(): string {
  return `adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ZaIrp6Sheet({
  client,
  today,
  drafts,
  onSaved,
  onBack,
}: {
  client: Irp6SheetClient;
  today: string;
  drafts: TaxFormDraft[];
  onSaved: (draft: TaxFormDraft) => void;
  onBack: () => void;
}) {
  const initial = useMemo(
    () => irp6DefaultPick(today, client.fyStartMonth),
    [today, client.fyStartMonth],
  );
  const years = useMemo(
    () => irp6YearOptions(today, client.fyStartMonth),
    [today, client.fyStartMonth],
  );
  const [year, setYear] = useState(initial.yearOfAssessment);
  const [period, setPeriod] = useState<Irp6Period>(initial.period);
  const saved = findIrp6Draft(drafts, year, period);
  const [inputs, setInputs] = useState<Irp6Inputs>(() => irp6InputsFromDraft(saved));
  const [approvals, setApprovals] = useState<Approvals>(() => saved?.approvals ?? {});
  const [status, setStatus] = useState<TaxFormDraftStatus>(saved?.status ?? "draft");
  const [approvedBy, setApprovedBy] = useState<{
    id: string | null;
    name: string | null;
    at: string | null;
  }>({
    id: saved?.approved_by ?? null,
    name: saved?.approved_by_name ?? null,
    at: saved?.approved_at ?? null,
  });
  const [savedAt, setSavedAt] = useState<string | null>(saved?.updated_at ?? null);
  const [busy, setBusy] = useState<null | "save" | "pdf" | "csv">(null);
  const [error, setError] = useState<string | null>(null);

  const loadReturn = (nextYear: number, nextPeriod: Irp6Period) => {
    const row = findIrp6Draft(drafts, nextYear, nextPeriod);
    setYear(nextYear);
    setPeriod(nextPeriod);
    setInputs(irp6InputsFromDraft(row));
    setApprovals(row?.approvals ?? {});
    setStatus(row?.status ?? "draft");
    setApprovedBy({
      id: row?.approved_by ?? null,
      name: row?.approved_by_name ?? null,
      at: row?.approved_at ?? null,
    });
    setSavedAt(row?.updated_at ?? null);
    setError(null);
  };

  const sheet = useMemo(
    () => computeIrp6({ client, yearOfAssessment: year, period, inputs }),
    [client, year, period, inputs],
  );
  const lines = useMemo(() => new Map(sheet.lines.map((line) => [line.id, line])), [sheet.lines]);
  const errors = sheet.checks.filter((check) => check.level === "error");
  const canDownload = irp6CanDownload(sheet, approvals);
  const approvedCount = IRP6_SECTIONS.filter((section) => approvals[section.id]).length;

  const blockedReason = (section: Irp6SectionId): string | null => {
    if (sheet.missing.some((line) => line.section === section)) return "Fill this section first.";
    if (section === "adjustments" && errors.some((check) => check.id.startsWith("adjustment-")))
      return "Finish or remove the empty adjustment.";
    if (section === "taxpayer" && errors.some((check) => check.id === "tax-reference"))
      return "Fix the reference number first.";
    return null;
  };

  const edit = (sections: Irp6SectionId[], patch: Partial<Irp6Inputs>) => {
    setInputs((prev) => ({ ...prev, ...patch }));
    setApprovals((prev) => {
      const next = { ...prev };
      for (const section of [...sections, "result" as const]) delete next[section];
      return next;
    });
    if (status !== "draft") {
      setStatus("draft");
      setApprovedBy({ id: null, name: null, at: null });
    }
  };

  const persist = async (
    nextStatus: TaxFormDraftStatus,
    nextApprovals: Approvals,
    approver: { id: string | null; name: string | null; at: string | null },
    downloadedAt?: string,
  ) => {
    const row = await saveTaxFormDraft({
      id: saved?.id,
      created_at: saved?.created_at,
      client_id: client.id,
      form_code: "IRP6",
      tax_year: year,
      period,
      subject: null,
      fields: irp6DraftFields(sheet, inputs),
      approvals: nextApprovals,
      status: nextStatus,
      approved_by: approver.id,
      approved_by_name: approver.name,
      approved_at: approver.at,
      downloaded_at: downloadedAt ?? saved?.downloaded_at ?? null,
    });
    setSavedAt(row.updated_at);
    onSaved(row);
    return row;
  };

  const toggleApprove = async (section: Irp6SectionId) => {
    const next = { ...approvals, [section]: !approvals[section] };
    if (!next[section]) delete next[section];
    setApprovals(next);
    const all = IRP6_SECTIONS.every((s) => next[s.id]);
    if (all && status === "draft") {
      const who = await currentApprover();
      const approver = { id: who.id, name: who.name, at: new Date().toISOString() };
      setApprovedBy(approver);
      setStatus("approved");
      await persist("approved", next, approver);
    } else if (!all && status !== "draft") {
      const cleared = { id: null, name: null, at: null };
      setApprovedBy(cleared);
      setStatus("draft");
      await persist("draft", next, cleared);
    }
  };

  const saveDraft = async () => {
    setBusy("save");
    setError(null);
    try {
      await persist(status, approvals, approvedBy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(null);
    }
  };

  const markDownloaded = async () => {
    const at = new Date().toISOString();
    setStatus("downloaded");
    await persist("downloaded", approvals, approvedBy, at);
  };

  const downloadPdf = async () => {
    setBusy("pdf");
    setError(null);
    try {
      const [{ pdf }, { Irp6PDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./za-irp6-pdf"),
      ]);
      const blob = await pdf(
        Irp6PDF({
          clientName: client.name,
          sheet,
          adjustments: inputs.adjustments,
          approvedByName: approvedBy.name,
          approvedAt: approvedBy.at,
          preparedOn: today,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      download(blob, irp6FileName(client.name, year, period, "pdf"));
      await markDownloaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const downloadCsv = async () => {
    setBusy("csv");
    setError(null);
    try {
      const blob = new Blob([irp6Csv(sheet, inputs.adjustments)], {
        type: "text/csv;charset=utf-8",
      });
      download(blob, irp6FileName(client.name, year, period, "csv"));
      await markDownloaded();
    } finally {
      setBusy(null);
    }
  };

  const approve = (section: Irp6SectionId) => (
    <ApproveTick
      section={section}
      approved={Boolean(approvals[section])}
      blocked={blockedReason(section)}
      onToggle={() => void toggleApprove(section)}
    />
  );

  const row = (id: Parameters<typeof lines.get>[0], children?: ReactNode) => {
    const line = lines.get(id);
    return line ? (
      <FieldRow key={id} line={line}>
        {children}
      </FieldRow>
    ) : null;
  };

  const sectionPurpose = Object.fromEntries(IRP6_SECTIONS.map((s) => [s.id, s]));
  const refInvalid = Boolean(inputs.taxReference.trim()) && !validTaxReference(inputs.taxReference);
  const profitTyped = lines.get("profitBeforeTax")?.source === "input";

  const updateAdjustment = (index: number, patch: Partial<Irp6Adjustment>) => {
    const next = inputs.adjustments.map((adj, i) => (i === index ? { ...adj, ...patch } : adj));
    edit(["adjustments", "estimate"], { adjustments: next });
  };

  return (
    <div className="irp6" data-irp6-sheet="true" data-irp6-status={status}>
      <header className="irp6-head">
        <button type="button" className="irp6-back" onClick={onBack}>
          ← All SARS forms
        </button>
        <div className="irp6-title-row">
          <h2 className="irp6-title">IRP6 preparation sheet</h2>
          <span className={`irp6-status is-${status}`} data-irp6-status-label="true">
            {TAX_FORM_DRAFT_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="irp6-purpose">
          Provisional tax for {client.name}, prepared for you to check and capture on eFiling.
        </p>
        <div className="irp6-picks">
          <label className="irp6-pick">
            Year of assessment
            <select
              className="irp6-input"
              value={year}
              data-irp6-year="true"
              onChange={(event) => loadReturn(Number(event.target.value), period)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <div className="irp6-pick" role="group" aria-label="Period">
            Period
            <div className="irp6-periods">
              {IRP6_PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === period ? "irp6-period is-on" : "irp6-period"}
                  aria-pressed={p === period}
                  data-irp6-period={p}
                  onClick={() => loadReturn(year, p)}
                >
                  {p === 3 ? "Top-up" : `P${p}`}
                </button>
              ))}
            </div>
          </div>
          <div className="irp6-due" data-irp6-due={sheet.due}>
            <span className="irp6-due-label">Due</span>
            <span className="irp6-due-date">
              {weekdayOf(sheet.due)} {formatSampleDate(sheet.due)}
            </span>
            {sheet.due !== sheet.statutoryDue ? (
              <span className="irp6-due-note">
                {formatSampleDate(sheet.statutoryDue)} is not a working day.
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="irp6-gate" role="status" data-irp6-gate={canDownload ? "ready" : "blocked"}>
        {sheet.missing.length ? (
          <>
            <p className="irp6-gate-line" data-irp6-missing-count={sheet.missing.length}>
              {irp6MissingSentence(sheet.missing.length)}
            </p>
            <ul className="irp6-gate-list">
              {sheet.missing.map((line) => (
                <li key={line.id}>
                  <button
                    type="button"
                    className="irp6-gate-link"
                    onClick={() => document.getElementById(`irp6-input-${line.id}`)?.focus()}
                  >
                    {line.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : errors.length ? (
          <p className="irp6-gate-line">{errors[0].text}</p>
        ) : approvedCount < IRP6_SECTIONS.length ? (
          <p className="irp6-gate-line">
            Approve each section to download. {approvedCount} of {IRP6_SECTIONS.length} approved.
          </p>
        ) : (
          <p className="irp6-gate-line is-ready">
            Ready to download.
            {approvedBy.name && approvedBy.at
              ? ` Approved by ${approvedBy.name} on ${draftDayLabel(approvedBy.at)}.`
              : ""}
          </p>
        )}
      </div>

      <Section {...sectionPurpose.taxpayer} approve={approve("taxpayer")}>
        <table className="irp6-table">
          <tbody>
            {row("registeredName")}
            {row(
              "taxReference",
              <>
                <input
                  id="irp6-input-taxReference"
                  className="irp6-input irp6-input--ref"
                  inputMode="numeric"
                  aria-label="Income tax reference number"
                  aria-invalid={refInvalid || undefined}
                  placeholder="10 digits"
                  value={inputs.taxReference}
                  onChange={(event) => edit(["taxpayer"], { taxReference: event.target.value })}
                />
                {refInvalid ? <span className="irp6-field-error">Should be 10 digits.</span> : null}
              </>,
            )}
            {row("yearOfAssessment")}
            {row("period", irp6PeriodLabel(period))}
            {row("periodEnd")}
          </tbody>
        </table>
      </Section>

      <Section {...sectionPurpose.estimate} approve={approve("estimate")}>
        <table className="irp6-table">
          <tbody>
            {row("grossIncome")}
            {row(
              "profitBeforeTax",
              profitTyped ? (
                <AmountInput
                  id="irp6-input-profitBeforeTax"
                  label="Profit before tax for the full year"
                  value={inputs.profitBeforeTaxCents}
                  onChange={(cents) => edit(["estimate"], { profitBeforeTaxCents: cents })}
                />
              ) : undefined,
            )}
            {row("fullYearProfit")}
            {row("netAdjustments")}
            {row("estimatedTaxableIncome")}
            <tr data-irp6-field="estimateOverride">
              <th scope="row">
                <span className="irp6-label">Estimate to file, if different</span>
                <span className="irp6-note">Leave empty to file the figure above.</span>
              </th>
              <td className="irp6-value">
                <AmountInput
                  id="irp6-input-estimateOverride"
                  label="Estimate to file, if different"
                  value={inputs.estimateOverrideCents}
                  onChange={(cents) => edit(["estimate"], { estimateOverrideCents: cents })}
                />
              </td>
              <td className="irp6-source">
                <span className="irp6-source-tag is-input">Optional</span>
              </td>
            </tr>
            {sheet.basicAmountRequired || inputs.basicAmountCents != null
              ? row(
                  "basicAmount",
                  <AmountInput
                    id="irp6-input-basicAmount"
                    label="Basic amount"
                    value={inputs.basicAmountCents}
                    onChange={(cents) => edit(["estimate"], { basicAmountCents: cents })}
                  />,
                )
              : null}
            {row("estimatedTax")}
          </tbody>
        </table>
      </Section>

      <Section {...sectionPurpose.adjustments} approve={approve("adjustments")}>
        <div className="irp6-adj-scroll">
          <table className="irp6-adj" data-irp6-adjustments="true">
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className="irp6-num">
                  Amount
                </th>
                <th scope="col">Added or deducted</th>
                <th scope="col" className="irp6-remove-cell">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {inputs.adjustments.map((adj, index) => (
                <tr key={adj.id} data-irp6-adjustment={adj.id}>
                  <td>
                    <input
                      className="irp6-input"
                      aria-label={`Adjustment ${index + 1} description`}
                      value={adj.description}
                      placeholder="For example, fines and penalties"
                      onChange={(event) =>
                        updateAdjustment(index, { description: event.target.value })
                      }
                    />
                  </td>
                  <td className="irp6-num">
                    <AmountInput
                      id={`irp6-adj-${adj.id}`}
                      label={`Adjustment ${index + 1} amount`}
                      value={adj.amountCents}
                      onChange={(cents) =>
                        updateAdjustment(index, {
                          amountCents: cents == null ? null : Math.abs(cents),
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="irp6-input"
                      aria-label={`Adjustment ${index + 1} added or deducted`}
                      value={adj.direction}
                      onChange={(event) =>
                        updateAdjustment(index, {
                          direction: event.target.value as Irp6Adjustment["direction"],
                        })
                      }
                    >
                      <option value="add">Added</option>
                      <option value="deduct">Deducted</option>
                    </select>
                  </td>
                  <td className="irp6-remove-cell">
                    <button
                      type="button"
                      className="irp6-remove"
                      aria-label={`Remove adjustment ${index + 1}`}
                      onClick={() =>
                        edit(["adjustments", "estimate"], {
                          adjustments: inputs.adjustments.filter((_, i) => i !== index),
                        })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="irp6-adj-add-row">
                <td colSpan={4}>
                  <button
                    type="button"
                    className="irp6-add"
                    data-irp6-add-adjustment="true"
                    onClick={() =>
                      edit(["adjustments", "estimate"], {
                        adjustments: [
                          ...inputs.adjustments,
                          {
                            id: nextAdjustmentId(),
                            description: "",
                            amountCents: null,
                            direction: "add",
                          },
                        ],
                      })
                    }
                  >
                    + Add adjustment
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Net</th>
                <td className="irp6-num">{formatSampleCents(sheet.netAdjustmentsCents)}</td>
                <td colSpan={2}>
                  {formatSampleCents(sheet.addedCents)} added,{" "}
                  {formatSampleCents(sheet.deductedCents)} deducted
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section {...sectionPurpose.credits} approve={approve("credits")}>
        <table className="irp6-table">
          <tbody>
            {row(
              "employeesTax",
              <AmountInput
                id="irp6-input-employeesTax"
                label="Employees' tax"
                value={inputs.employeesTaxCents}
                onChange={(cents) => edit(["credits"], { employeesTaxCents: cents })}
              />,
            )}
            {row("foreignTaxCredits")}
            {row(
              "provisionalPaid",
              <AmountInput
                id="irp6-input-provisionalPaid"
                label="Provisional tax already paid"
                value={inputs.provisionalPaidCents}
                onChange={(cents) => edit(["credits"], { provisionalPaidCents: cents })}
              />,
            )}
          </tbody>
        </table>
      </Section>

      <Section {...sectionPurpose.result} approve={approve("result")}>
        <table className="irp6-table">
          <tbody>
            {row("taxForPeriod")}
            {row("taxPayable")}
            {row("estimateAgainstActual")}
          </tbody>
        </table>
        {sheet.checks.length ? (
          <ul className="irp6-checks" aria-label="Checks">
            {sheet.checks.map((check) => (
              <li
                key={check.id}
                className={`irp6-check is-${check.level}`}
                data-irp6-check={check.id}
              >
                {check.text}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <footer className="irp6-actions">
        <button
          type="button"
          className="irp6-button is-primary"
          data-irp6-download="pdf"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadPdf()}
        >
          {busy === "pdf" ? "Building PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className="irp6-button"
          data-irp6-download="csv"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadCsv()}
        >
          Download CSV
        </button>
        <button
          type="button"
          className="irp6-button"
          data-irp6-save="true"
          disabled={busy != null}
          onClick={() => void saveDraft()}
        >
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <span className="irp6-saved" data-irp6-saved={savedAt ?? undefined}>
          {savedAt ? `Saved ${draftDayLabel(savedAt)}` : "Not saved yet"}
        </span>
        {error ? (
          <p className="irp6-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
