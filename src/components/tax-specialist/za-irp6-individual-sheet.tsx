/**
 * Individual IRP6 on the company preparation sheet.
 * The accountant checks each section, then downloads a PDF and CSV.
 * The owner cannot approve. Nothing is emailed and nothing is filed.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatSampleCents, formatSampleDate } from "@/lib/tax-specialist/sample-compute";
import {
  currentApprover,
  draftDayLabel,
  type TaxFormDraft,
  type TaxFormDraftStatus,
  TAX_FORM_DRAFT_STATUS_LABEL,
} from "@/lib/tax-specialist/forms/drafts";
import {
  irp6PeriodLabel,
  parseRandsToCents,
  validTaxReference,
  type Irp6Client,
  type Irp6Period,
  type Irp6SectionId,
} from "@/lib/tax-specialist/forms/irp6";
import {
  IRP6_INDIVIDUAL_FOOTER,
  IRP6_INDIVIDUAL_SECTIONS,
  IRP6_INDIVIDUAL_SUBJECT,
  computeIrp6Individual,
  emptyIrp6IndividualInputs,
  findIrp6IndividualDraft,
  irp6IndividualApproveBlock,
  irp6IndividualCanDownload,
  irp6IndividualCsv,
  irp6IndividualDraftFields,
  irp6IndividualFieldSources,
  irp6IndividualFileName,
  irp6IndividualInputsFromDraft,
  irp6IndividualMoney,
  irp6IndividualYearOptions,
  type Irp6AgeBand,
  type Irp6IndLine,
  type Irp6IndMoneyId,
  type Irp6IndividualApproverRole,
  type Irp6IndividualInputs,
  type Irp6IndividualLine,
} from "@/lib/tax-specialist/forms/irp6-individual";
import { saveCatalogDraft } from "@/lib/tax-specialist/forms/pipeline";
import "./za-irp6-sheet.css";

type IndividualClient = Irp6Client & { id: string };

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
}: {
  id: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState(centsText(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (parseRandsToCents(text) !== value) setText(centsText(value));
    // Follow a period change. Typing is local until the value itself changes.
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
        aria-invalid={bad || undefined}
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

export function ZaIrp6IndividualSheet({
  client,
  today,
  drafts,
  onSaved,
  onBack,
  backLabel = "Tax drafts",
  initialYear,
  initialPeriod,
  seed = null,
  approverRole = "accountant",
}: {
  client: IndividualClient;
  today: string;
  drafts: TaxFormDraft[];
  onSaved: (draft: TaxFormDraft) => void;
  onBack: () => void;
  backLabel?: string;
  initialYear: number;
  initialPeriod: Irp6Period;
  seed?: Irp6IndividualInputs | null;
  approverRole?: Irp6IndividualApproverRole;
}) {
  const years = useMemo(() => irp6IndividualYearOptions(today), [today]);
  const [year, setYear] = useState(initialYear);
  const [period, setPeriod] = useState<Irp6Period>(initialPeriod);
  const saved = findIrp6IndividualDraft(drafts, year, period);
  const [inputs, setInputs] = useState<Irp6IndividualInputs>(() =>
    saved ? irp6IndividualInputsFromDraft(saved) : (seed ?? emptyIrp6IndividualInputs()),
  );
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
  const locked = approverRole === "owner";

  const loadReturn = (nextYear: number, nextPeriod: Irp6Period) => {
    const row = findIrp6IndividualDraft(drafts, nextYear, nextPeriod);
    setYear(nextYear);
    setPeriod(nextPeriod);
    setInputs(row ? irp6IndividualInputsFromDraft(row) : emptyIrp6IndividualInputs());
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
    () => computeIrp6Individual({ client, yearOfAssessment: year, period, inputs }),
    [client, year, period, inputs],
  );
  const canDownload = irp6IndividualCanDownload(sheet, approvals, approverRole);
  const approvedCount = IRP6_INDIVIDUAL_SECTIONS.filter((section) => approvals[section.id]).length;
  const openQueries = sheet.queries.filter((query) => !query.resolved);

  const edit = (patch: Irp6IndividualInputs) => {
    setInputs(patch);
    setApprovals({});
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
    const row = await saveCatalogDraft({
      client_id: client.id,
      form_code: "IRP6",
      tax_year: year,
      period,
      subject: IRP6_INDIVIDUAL_SUBJECT,
      fields: irp6IndividualDraftFields(sheet, inputs),
      field_sources: irp6IndividualFieldSources(inputs),
      approvals: nextApprovals,
      status: nextStatus,
      approved_by: approver.id,
      approved_by_name: approver.name,
      approved_at: approver.at,
      downloaded_at: downloadedAt ?? saved?.downloaded_at ?? null,
      rules_year: sheet.rulesYear,
    });
    setSavedAt(row.updated_at);
    onSaved(row);
    return row;
  };

  const toggleApprove = async (section: Irp6SectionId) => {
    if (locked) return;
    if (irp6IndividualApproveBlock({ role: approverRole, section, sheet })) return;
    const next = { ...approvals, [section]: !approvals[section] };
    if (!next[section]) delete next[section];
    setApprovals(next);
    const all = IRP6_INDIVIDUAL_SECTIONS.every((item) => next[item.id]);
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

  const setAccountantLine = (
    fieldId: Irp6IndMoneyId,
    lineId: string | null,
    cents: number | null,
  ) => {
    const kept = inputs.lines.filter((line) => {
      if (lineId) return line.id !== lineId;
      return !(line.fieldId === fieldId && line.source === "accountant");
    });
    const next: Irp6IndLine = {
      id: lineId ?? `typed-${fieldId}`,
      fieldId,
      label: irp6IndividualMoney(fieldId).label,
      amountCents: cents,
      fileId: null,
      source: "accountant",
      note: null,
    };
    edit({ ...inputs, lines: [...kept, next] });
  };

  const removeLine = (id: string) => {
    edit({ ...inputs, lines: inputs.lines.filter((line) => line.id !== id) });
  };

  const addTyped = (fieldId: Irp6IndMoneyId) => {
    const line: Irp6IndLine = {
      id: `typed-${fieldId}-${Date.now().toString(36)}`,
      fieldId,
      label: irp6IndividualMoney(fieldId).label,
      amountCents: null,
      fileId: null,
      source: "accountant",
      note: null,
    };
    edit({ ...inputs, lines: [...inputs.lines, line] });
  };

  const resolveQuery = (id: string, resolved: boolean) => {
    edit({
      ...inputs,
      queries: inputs.queries.map((query) => (query.id === id ? { ...query, resolved } : query)),
    });
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
      const [{ pdf }, { Irp6IndividualPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./za-irp6-pdf"),
      ]);
      const blob = await pdf(
        Irp6IndividualPDF({
          clientName: client.name,
          sheet,
          approvedByName: approvedBy.name,
          approvedAt: approvedBy.at,
          preparedOn: today,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      download(blob, irp6IndividualFileName(client.name, year, period, "pdf"));
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
      const blob = new Blob([irp6IndividualCsv(sheet)], { type: "text/csv;charset=utf-8" });
      download(blob, irp6IndividualFileName(client.name, year, period, "csv"));
      await markDownloaded();
    } finally {
      setBusy(null);
    }
  };

  const refInvalid = Boolean(inputs.taxReference.trim()) && !validTaxReference(inputs.taxReference);

  const approve = (section: Irp6SectionId) => {
    const blocked = irp6IndividualApproveBlock({ role: approverRole, section, sheet });
    const approved = Boolean(approvals[section]);
    return (
      <button
        type="button"
        className={approved ? "irp6-approve is-approved" : "irp6-approve"}
        data-irp6-approve={section}
        data-irp6-approve-blocked={blocked ?? undefined}
        aria-pressed={approved}
        disabled={locked || (!approved && blocked != null)}
        title={blocked ?? undefined}
        onClick={() => void toggleApprove(section)}
      >
        <span className="irp6-approve-box">{approved ? <TickIcon /> : null}</span>
        {approved ? "Approved" : "Approve"}
      </button>
    );
  };

  const fieldRow = (line: Irp6IndividualLine, children?: ReactNode) => (
    <tr
      key={line.id}
      data-irp6-field={line.id}
      data-irp6-missing={line.missing ? "true" : undefined}
    >
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

  const moneyBlock = (fieldId: Irp6IndMoneyId) => {
    const total = sheet.lines.find((line) => line.id === fieldId);
    if (!total) return null;
    const details = inputs.lines.filter((line) => line.fieldId === fieldId);
    const cited = details.filter((line) => line.source !== "accountant");
    const typed = details.filter((line) => line.source === "accountant");
    const soleTyped = cited.length === 0 && typed.length <= 1 ? (typed[0] ?? null) : null;
    return (
      <div data-irp6-money={fieldId}>
        <table className="irp6-table">
          <tbody>
            {fieldRow(
              total,
              !locked && soleTyped !== undefined && cited.length === 0 ? (
                <AmountInput
                  id={`irp6-input-${fieldId}`}
                  label={total.label}
                  value={soleTyped?.amountCents ?? null}
                  onChange={(cents) => setAccountantLine(fieldId, soleTyped?.id ?? null, cents)}
                />
              ) : undefined,
            )}
            {cited.length > 0 || typed.length > 1
              ? details.map((line) => (
                  <tr key={line.id} data-irp6-line={line.id}>
                    <th scope="row">
                      <span className="irp6-label">{line.label}</span>
                    </th>
                    <td className="irp6-value">
                      {line.source === "accountant" && !locked ? (
                        <AmountInput
                          id={`irp6-input-${line.id}`}
                          label={line.label}
                          value={line.amountCents}
                          onChange={(cents) => setAccountantLine(fieldId, line.id, cents)}
                        />
                      ) : line.amountCents == null ? (
                        "—"
                      ) : (
                        formatSampleCents(line.amountCents)
                      )}
                      {line.source !== "accountant" && line.fileId ? (
                        <span>{` File ${line.fileId}`}</span>
                      ) : null}
                    </td>
                    <td className="irp6-source">
                      {locked ? null : (
                        <button
                          type="button"
                          className="irp6-back"
                          onClick={() => removeLine(line.id)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        {locked ? null : (
          <button
            type="button"
            className="irp6-back"
            data-irp6-add={fieldId}
            onClick={() => addTyped(fieldId)}
          >
            Add a figure I typed
          </button>
        )}
      </div>
    );
  };

  const sectionPurpose = Object.fromEntries(
    IRP6_INDIVIDUAL_SECTIONS.map((section) => [section.id, section]),
  );
  const show = (id: string) => sheet.lines.find((line) => line.id === id);

  return (
    <div
      className="irp6"
      data-irp6-sheet="individual"
      data-irp6-individual="true"
      data-irp6-status={status}
      data-irp6-role={approverRole}
      data-irp6-rules-year={sheet.rulesYear ?? ""}
    >
      <header className="irp6-head">
        <button type="button" className="irp6-back" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="irp6-title-row">
          <h2 className="irp6-title">IRP6 preparation sheet</h2>
          <span className={`irp6-status is-${status}`} data-irp6-status-label="true">
            {TAX_FORM_DRAFT_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="irp6-purpose">
          Provisional tax for {client.name}, an individual, prepared for you to check and capture on
          eFiling. {IRP6_INDIVIDUAL_FOOTER}
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
              {(years.includes(year) ? years : [...years, year].sort((a, b) => a - b)).map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ),
              )}
            </select>
          </label>
          <div className="irp6-pick" role="group" aria-label="Period">
            Period
            <div className="irp6-periods">
              {([1, 2, 3] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === period ? "irp6-period is-on" : "irp6-period"}
                  aria-pressed={item === period}
                  data-irp6-period={item}
                  onClick={() => loadReturn(year, item)}
                >
                  {item === 3 ? "Top-up" : `P${item}`}
                </button>
              ))}
            </div>
          </div>
          <div className="irp6-due" data-irp6-due={sheet.due}>
            <span className="irp6-due-label">Due</span>
            <span className="irp6-due-date">
              {weekdayOf(sheet.due)} {formatSampleDate(sheet.due)}
            </span>
          </div>
        </div>
      </header>

      <div className="irp6-gate" role="status" data-irp6-gate={canDownload ? "ready" : "blocked"}>
        {locked ? (
          <p className="irp6-gate-line">The owner cannot approve a section.</p>
        ) : openQueries.length ? (
          <p className="irp6-gate-line">Resolve the open queries first.</p>
        ) : sheet.missing.length ? (
          <p className="irp6-gate-line" data-irp6-missing-count={sheet.missing.length}>
            {sheet.missing.length === 1
              ? "1 field needs a cited file, the books, or a figure you type before you can download."
              : `${sheet.missing.length} fields need a cited file, the books, or a figure you type before you can download.`}
          </p>
        ) : approvedCount < IRP6_INDIVIDUAL_SECTIONS.length ? (
          <p className="irp6-gate-line">
            Approve each section to download. {approvedCount} of {IRP6_INDIVIDUAL_SECTIONS.length}{" "}
            approved.
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

      <section
        className="irp6-section"
        data-irp6-section="taxpayer"
        aria-labelledby="irp6-individual-taxpayer"
      >
        <header className="irp6-section-head">
          <div>
            <h3 id="irp6-individual-taxpayer" className="irp6-section-title">
              {sectionPurpose.taxpayer.title}
            </h3>
            <p className="irp6-section-purpose">{sectionPurpose.taxpayer.purpose}</p>
          </div>
          {approve("taxpayer")}
        </header>
        <table className="irp6-table">
          <tbody>
            {show("fullName") ? fieldRow(show("fullName")!) : null}
            {show("taxReference")
              ? fieldRow(
                  show("taxReference")!,
                  locked ? undefined : (
                    <>
                      <input
                        id="irp6-input-taxReference"
                        className="irp6-input irp6-input--ref"
                        inputMode="numeric"
                        aria-label="Income tax reference number"
                        aria-invalid={refInvalid || undefined}
                        placeholder="10 digits"
                        value={inputs.taxReference}
                        onChange={(event) => edit({ ...inputs, taxReference: event.target.value })}
                      />
                      {refInvalid ? (
                        <span className="irp6-field-error">Should be 10 digits.</span>
                      ) : null}
                    </>
                  ),
                )
              : null}
            {show("yearOfAssessment") ? fieldRow(show("yearOfAssessment")!) : null}
            {show("period") ? fieldRow(show("period")!, irp6PeriodLabel(period)) : null}
            {show("periodEnd") ? fieldRow(show("periodEnd")!) : null}
            {show("ageBand")
              ? fieldRow(
                  show("ageBand")!,
                  locked ? undefined : (
                    <select
                      className="irp6-input"
                      aria-label="Age band"
                      data-irp6-age="true"
                      value={inputs.ageBand ?? ""}
                      onChange={(event) =>
                        edit({
                          ...inputs,
                          ageBand: (event.target.value || null) as Irp6AgeBand | null,
                        })
                      }
                    >
                      <option value="">Not supplied</option>
                      <option value="under-65">Under 65</option>
                      <option value="65">65 to 74</option>
                      <option value="75">75 or older</option>
                    </select>
                  ),
                )
              : null}
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-irp6-section="estimate">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.estimate.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.estimate.purpose}</p>
          </div>
          {approve("estimate")}
        </header>
        {moneyBlock("employmentIncome")}
        {moneyBlock("practiceIncome")}
        {moneyBlock("localInterest")}
        {moneyBlock("basicAmount")}
        <table className="irp6-table">
          <tbody>
            {show("estimatedTaxableIncome") ? fieldRow(show("estimatedTaxableIncome")!) : null}
            <tr data-irp6-field="estimateOverride">
              <th scope="row">
                <span className="irp6-label">Estimate to file, if different</span>
                <span className="irp6-note">Leave empty to file the worked figure.</span>
              </th>
              <td className="irp6-value">
                {locked ? (
                  inputs.estimateOverrideCents == null ? (
                    "—"
                  ) : (
                    formatSampleCents(inputs.estimateOverrideCents)
                  )
                ) : (
                  <AmountInput
                    id="irp6-input-estimateOverride"
                    label="Estimate to file, if different"
                    value={inputs.estimateOverrideCents}
                    onChange={(cents) => edit({ ...inputs, estimateOverrideCents: cents })}
                  />
                )}
              </td>
              <td className="irp6-source">
                <span className="irp6-source-tag is-input">Optional</span>
              </td>
            </tr>
            {show("estimatedTax") ? fieldRow(show("estimatedTax")!) : null}
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-irp6-section="adjustments">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.adjustments.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.adjustments.purpose}</p>
          </div>
          {approve("adjustments")}
        </header>
        {moneyBlock("practiceExpenses")}
        {moneyBlock("travelClaim")}
        {moneyBlock("medicalContributions")}
        {moneyBlock("raContributions")}
      </section>

      <section className="irp6-section" data-irp6-section="credits">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.credits.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.credits.purpose}</p>
          </div>
          {approve("credits")}
        </header>
        {moneyBlock("payeWithheld")}
        {moneyBlock("paymentsMade")}
      </section>

      <section className="irp6-section" data-irp6-section="result">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.result.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.result.purpose}</p>
          </div>
          {approve("result")}
        </header>
        <table className="irp6-table">
          <tbody>
            {show("taxForPeriod") ? fieldRow(show("taxForPeriod")!) : null}
            {show("taxPayable") ? fieldRow(show("taxPayable")!) : null}
            {show("eightyOfWorked") ? fieldRow(show("eightyOfWorked")!) : null}
            {show("estimateAgainstActual") ? fieldRow(show("estimateAgainstActual")!) : null}
          </tbody>
        </table>
        {openQueries.length || sheet.queries.length ? (
          <ul className="irp6-checks" aria-label="Open queries">
            {sheet.queries.map((query) => (
              <li
                key={query.id}
                data-irp6-query={query.id}
                data-irp6-query-open={query.resolved ? "false" : "true"}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={query.resolved}
                    disabled={locked}
                    onChange={(event) => resolveQuery(query.id, event.target.checked)}
                  />{" "}
                  {query.resolved ? "Resolved. " : ""}
                  {query.text}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
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
      </section>

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
          disabled={busy != null || locked}
          onClick={() => void saveDraft()}
        >
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <span
          className="irp6-saved"
          data-irp6-saved={savedAt ?? undefined}
          data-irp6-version={saved?.version}
        >
          {savedAt
            ? `Saved ${draftDayLabel(savedAt)}${saved?.version ? `, version ${saved.version}` : ""}`
            : "Not saved yet"}
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
