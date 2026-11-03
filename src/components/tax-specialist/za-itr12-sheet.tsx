/**
 * ITR12 preparation sheet. Same review pattern as IRP6: sections, sources,
 * accountant approval, then a PDF and CSV capture sheet.
 * The owner cannot approve. Nothing is emailed and nothing is filed.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  TAX_FORM_DRAFT_STATUS_LABEL,
  currentApprover,
  draftDayLabel,
  type TaxFormDraft,
  type TaxFormDraftStatus,
} from "@/lib/tax-specialist/forms/drafts";
import { parseRandsToCents, validTaxReference } from "@/lib/tax-specialist/forms/irp6";
import {
  ITR12_FOOTER,
  ITR12_SECTIONS,
  computeItr12,
  emptyItr12Inputs,
  findItr12Draft,
  itr12ApproveBlock,
  itr12CanDownload,
  itr12Csv,
  itr12DraftFields,
  itr12FieldSources,
  itr12FileName,
  itr12InputsFromDraft,
  itr12MissingSentence,
  itr12MoneyField,
  itr12YearChoices,
  itr12YearOfAssessment,
  type Itr12ApproverRole,
  type Itr12Cited,
  type Itr12Inputs,
  type Itr12MoneyFieldId,
  type Itr12SectionId,
  type Itr12SheetLine,
} from "@/lib/tax-specialist/forms/itr12";
import { saveCatalogDraft } from "@/lib/tax-specialist/forms/pipeline";
import "./za-irp6-sheet.css";

type Approvals = Partial<Record<Itr12SectionId, boolean>>;

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
    // Follow a draft reload, not each keystroke.
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

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function nextLineId(fieldId: string): string {
  return `typed-${fieldId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ZaItr12Sheet({
  client,
  today,
  drafts,
  onSaved,
  onBack,
  backLabel = "Tax drafts",
  initialYear,
  seed = null,
  approverRole = "accountant",
}: {
  client: { id: string; name: string };
  today: string;
  drafts: TaxFormDraft[];
  onSaved: (draft: TaxFormDraft) => void;
  onBack: () => void;
  backLabel?: string;
  initialYear?: number;
  /** Used when this year has no saved draft yet. */
  seed?: Itr12Inputs | null;
  approverRole?: Itr12ApproverRole;
}) {
  const startYear = initialYear ?? itr12YearOfAssessment(today);
  const [year, setYear] = useState(startYear);
  const savedAtStart = findItr12Draft(drafts, startYear);
  const [inputs, setInputs] = useState<Itr12Inputs>(() =>
    savedAtStart ? itr12InputsFromDraft(savedAtStart) : (seed ?? emptyItr12Inputs()),
  );
  const [approvals, setApprovals] = useState<Approvals>(() => savedAtStart?.approvals ?? {});
  const [status, setStatus] = useState<TaxFormDraftStatus>(savedAtStart?.status ?? "draft");
  const [approvedBy, setApprovedBy] = useState<{
    id: string | null;
    name: string | null;
    at: string | null;
  }>({
    id: savedAtStart?.approved_by ?? null,
    name: savedAtStart?.approved_by_name ?? null,
    at: savedAtStart?.approved_at ?? null,
  });
  const [busy, setBusy] = useState<null | "save" | "pdf" | "csv">(null);
  const [error, setError] = useState<string | null>(null);

  const saved = findItr12Draft(drafts, year);
  const years = useMemo(() => itr12YearChoices(today, year), [today, year]);
  const sheet = useMemo(
    () => computeItr12({ clientName: client.name, yearOfAssessment: year, inputs }),
    [client.name, year, inputs],
  );
  const locked = approverRole === "owner";
  const canDownload = itr12CanDownload(sheet, approvals, approverRole);
  const approvedCount = ITR12_SECTIONS.filter((section) => approvals[section.id]).length;
  const openQueries = inputs.queries.filter((query) => !query.resolved);

  const loadYear = (nextYear: number) => {
    const row = findItr12Draft(drafts, nextYear);
    setYear(nextYear);
    setInputs(row ? itr12InputsFromDraft(row) : emptyItr12Inputs());
    setApprovals(row?.approvals ?? {});
    setStatus(row?.status ?? "draft");
    setApprovedBy({
      id: row?.approved_by ?? null,
      name: row?.approved_by_name ?? null,
      at: row?.approved_at ?? null,
    });
    setError(null);
  };

  const edit = (sections: Itr12SectionId[], next: Itr12Inputs) => {
    setInputs(next);
    setApprovals((prev) => {
      const cleared = { ...prev };
      for (const section of [...sections, "result" as const]) delete cleared[section];
      return cleared;
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
    const row = await saveCatalogDraft({
      client_id: client.id,
      form_code: "ITR12",
      tax_year: year,
      period: null,
      subject: null,
      fields: itr12DraftFields(sheet, inputs),
      approvals: nextApprovals,
      status: nextStatus,
      approved_by: approver.id,
      approved_by_name: approver.name,
      approved_at: approver.at,
      downloaded_at: downloadedAt ?? saved?.downloaded_at ?? null,
      field_sources: itr12FieldSources(inputs),
    });
    onSaved(row);
    return row;
  };

  const toggleApprove = async (section: Itr12SectionId) => {
    if (approverRole === "owner") return;
    const blocked = itr12ApproveBlock({ role: approverRole, section, sheet });
    if (!approvals[section] && blocked) return;
    const next = { ...approvals, [section]: !approvals[section] };
    if (!next[section]) delete next[section];
    setApprovals(next);
    const all = ITR12_SECTIONS.every((item) => next[item.id]);
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
    if (!canDownload) return;
    setBusy("pdf");
    setError(null);
    try {
      const [{ pdf }, { Itr12PDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./za-itr12-pdf"),
      ]);
      const blob = await pdf(
        Itr12PDF({
          clientName: client.name,
          sheet,
          approvedByName: approvedBy.name,
          approvedAt: approvedBy.at,
          preparedOn: today,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      download(blob, itr12FileName(client.name, year, "pdf"));
      await markDownloaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const downloadCsv = async () => {
    if (!canDownload) return;
    setBusy("csv");
    setError(null);
    try {
      const blob = new Blob([itr12Csv(sheet)], { type: "text/csv;charset=utf-8" });
      download(blob, itr12FileName(client.name, year, "csv"));
      await markDownloaded();
    } finally {
      setBusy(null);
    }
  };

  const setLineAmount = (id: string, cents: number | null) => {
    edit(
      [itr12MoneyField(inputs.lines.find((line) => line.id === id)?.fieldId ?? "employmentIncome").section],
      {
        ...inputs,
        lines: inputs.lines.map((line) => (line.id === id ? { ...line, amountCents: cents } : line)),
      },
    );
  };

  const addTypedLine = (fieldId: Itr12MoneyFieldId) => {
    const field = itr12MoneyField(fieldId);
    const line: Itr12Cited = {
      id: nextLineId(fieldId),
      fieldId,
      label: field.label,
      amountCents: null,
      fileId: null,
      source: "accountant",
      note: null,
    };
    edit([field.section], { ...inputs, lines: [...inputs.lines, line] });
  };

  const removeLine = (line: Itr12Cited) => {
    edit(
      [itr12MoneyField(line.fieldId).section],
      { ...inputs, lines: inputs.lines.filter((item) => item.id !== line.id) },
    );
  };

  const resolveQuery = (id: string, resolved: boolean) => {
    edit(["queries"], {
      ...inputs,
      queries: inputs.queries.map((query) => (query.id === id ? { ...query, resolved } : query)),
    });
  };

  const refInvalid = Boolean(inputs.taxReference.trim()) && !validTaxReference(inputs.taxReference);
  const sectionPurpose = Object.fromEntries(ITR12_SECTIONS.map((section) => [section.id, section]));

  const approve = (section: Itr12SectionId) => {
    const blocked = itr12ApproveBlock({ role: approverRole, section, sheet });
    const approved = Boolean(approvals[section]);
    return (
      <button
        type="button"
        className={approved ? "irp6-approve is-approved" : "irp6-approve"}
        data-itr12-approve={section}
        data-itr12-approve-blocked={blocked ?? undefined}
        aria-pressed={approved}
        disabled={approverRole === "owner" || (!approved && blocked != null)}
        title={blocked ?? undefined}
        onClick={() => void toggleApprove(section)}
      >
        <span className="irp6-approve-box">{approved ? <TickIcon /> : null}</span>
        {approved ? "Approved" : "Approve"}
      </button>
    );
  };

  const fieldRow = (line: Itr12SheetLine, children?: ReactNode) => (
    <tr key={line.id} data-itr12-field={line.id} data-itr12-missing={line.missing ? "true" : undefined}>
      <th scope="row">
        <span className="irp6-label">{line.label}</span>
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

  const moneyBlock = (fieldId: Itr12MoneyFieldId) => {
    const field = itr12MoneyField(fieldId);
    const total = sheet.lines.find((line) => line.id === fieldId);
    const details = inputs.lines.filter((line) => line.fieldId === fieldId);
    const only = details.length === 1 ? details[0] : null;
    const typedOnly = only?.source === "accountant" ? only : null;
    return (
      <div data-itr12-money={fieldId}>
        <table className="irp6-table">
          <tbody>
            {total
              ? fieldRow(
                  total,
                  typedOnly && !locked ? (
                    <AmountInput
                      id={`itr12-input-${typedOnly.id}`}
                      label={field.label}
                      value={typedOnly.amountCents}
                      onChange={(cents) => setLineAmount(typedOnly.id, cents)}
                    />
                  ) : undefined,
                )
              : null}
            {details.length > 1
              ? details.map((line) => {
                  const part = sheet.lines.find((row) => row.id === line.id);
                  return (
                    <tr key={line.id} data-itr12-line={line.id}>
                      <th scope="row">
                        <span className="irp6-label">{line.label}</span>
                        {line.note ? <span className="irp6-note">{line.note}</span> : null}
                      </th>
                      <td className="irp6-value">
                        {line.source === "accountant" && !locked ? (
                          <AmountInput
                            id={`itr12-input-${line.id}`}
                            label={line.label}
                            value={line.amountCents}
                            onChange={(cents) => setLineAmount(line.id, cents)}
                          />
                        ) : (
                          part?.display || "—"
                        )}
                      </td>
                      <td className="irp6-source">
                        <span
                          className={`irp6-source-tag is-${line.source === "accountant" ? "input" : "file"}`}
                        >
                          {line.source === "accountant"
                            ? "Typed by the accountant"
                            : `File ${line.fileId}`}
                        </span>
                        {locked ? null : (
                          <button type="button" className="irp6-back" onClick={() => removeLine(line)}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
        {locked ? null : (
          <>
            {only ? (
              <button type="button" className="irp6-back" onClick={() => removeLine(only)}>
                Remove
              </button>
            ) : null}
            <button
              type="button"
              className="irp6-back"
              data-itr12-add={fieldId}
              onClick={() => addTypedLine(fieldId)}
            >
              Add a figure I typed
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="irp6" data-itr12-sheet="true" data-itr12-status={status} data-itr12-role={approverRole}>
      <header className="irp6-head">
        <button type="button" className="irp6-back" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="irp6-title-row">
          <h2 className="irp6-title">ITR12 preparation sheet</h2>
          <span className={`irp6-status is-${status}`} data-itr12-status-label="true">
            {TAX_FORM_DRAFT_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="irp6-purpose">
          Individual income tax for {client.name}, prepared for you to check and capture on eFiling.
        </p>
        <div className="irp6-picks">
          <label className="irp6-pick">
            Year of assessment
            <select
              className="irp6-input"
              value={year}
              data-itr12-year="true"
              onChange={(event) => loadYear(Number(event.target.value))}
            >
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="irp6-gate" role="status" data-itr12-gate={canDownload ? "ready" : "blocked"}>
        {approverRole === "owner" ? (
          <p className="irp6-gate-line">The owner cannot approve a section.</p>
        ) : openQueries.length ? (
          <p className="irp6-gate-line" data-itr12-open-queries={openQueries.length}>
            {openQueries.length === 1
              ? "1 open query blocks Approve."
              : `${openQueries.length} open queries block Approve.`}
          </p>
        ) : sheet.missing.length ? (
          <p className="irp6-gate-line" data-itr12-missing-count={sheet.missing.length}>
            {itr12MissingSentence(sheet.missing.length)}
          </p>
        ) : approvedCount < ITR12_SECTIONS.length ? (
          <p className="irp6-gate-line">
            Approve each section to download. {approvedCount} of {ITR12_SECTIONS.length} approved.
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

      <section className="irp6-section" data-itr12-section="taxpayer">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.taxpayer.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.taxpayer.purpose}</p>
          </div>
          {approve("taxpayer")}
        </header>
        <table className="irp6-table">
          <tbody>
            {sheet.lines.filter((line) => line.id === "fullName" || line.id === "yearOfAssessment").map((line) => fieldRow(line))}
            {fieldRow(
              sheet.lines.find((line) => line.id === "taxReference")!,
              <>
                <input
                  id="itr12-input-taxReference"
                  className="irp6-input irp6-input--ref"
                  inputMode="numeric"
                  aria-label="Income tax reference number"
                  aria-invalid={refInvalid || undefined}
                  placeholder="10 digits"
                  value={inputs.taxReference}
                  disabled={locked}
                  onChange={(event) => edit(["taxpayer"], { ...inputs, taxReference: event.target.value })}
                />
                {refInvalid ? <span className="irp6-field-error">Should be 10 digits.</span> : null}
              </>,
            )}
          </tbody>
        </table>
      </section>

      {(
        [
          ["income", ["employmentIncome", "practiceIncome"]],
          ["deductions", ["practiceExpenses"]],
          ["medical", ["medicalContributions"]],
          ["ra", ["raContributions"]],
          ["travel", ["travelClaim"]],
          ["interest", ["localInterest"]],
        ] as const
      ).map(([section, fields]) => (
        <section key={section} className="irp6-section" data-itr12-section={section}>
          <header className="irp6-section-head">
            <div>
              <h3 className="irp6-section-title">{sectionPurpose[section].title}</h3>
              <p className="irp6-section-purpose">{sectionPurpose[section].purpose}</p>
            </div>
            {approve(section)}
          </header>
          {fields.map((fieldId) => (
            <div key={fieldId}>{moneyBlock(fieldId)}</div>
          ))}
        </section>
      ))}

      <section className="irp6-section" data-itr12-section="queries">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.queries.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.queries.purpose}</p>
          </div>
          {approve("queries")}
        </header>
        {inputs.queries.length === 0 ? (
          <p className="irp6-note">No queries on this draft.</p>
        ) : (
          <ul className="irp6-gate-list" data-itr12-queries="true">
            {inputs.queries.map((query) => (
              <li key={query.id} data-itr12-query={query.id} data-itr12-query-open={query.resolved ? "false" : "true"}>
                <span>{query.text}</span>
                <button
                  type="button"
                  className="irp6-back"
                  data-itr12-resolve={query.id}
                  disabled={locked}
                  onClick={() => resolveQuery(query.id, !query.resolved)}
                >
                  {query.resolved ? "Reopen" : "Resolve"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="irp6-section" data-itr12-section="result">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.result.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.result.purpose}</p>
          </div>
          {approve("result")}
        </header>
        <table className="irp6-table">
          <tbody>
            {sheet.lines
              .filter((line) => line.id === "incomeTotal" || line.id === "taxPayable")
              .map((line) => fieldRow(line))}
          </tbody>
        </table>
      </section>

      <p className="irp6-purpose">{ITR12_FOOTER}</p>
      {error ? (
        <p className="irp6-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="irp6-actions">
        <button type="button" className="irp6-save" data-itr12-save="true" disabled={locked || busy != null} onClick={() => void saveDraft()}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          className="irp6-download"
          data-itr12-download="pdf"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadPdf()}
        >
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className="irp6-download"
          data-itr12-download="csv"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadCsv()}
        >
          {busy === "csv" ? "Preparing CSV…" : "Download CSV"}
        </button>
      </div>
    </div>
  );
}
