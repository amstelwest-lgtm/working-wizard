/**
 * ITR14 preparation sheet. Same review pattern as IRP6 and ITR12:
 * sections, sources, accountant approval, then a PDF and CSV capture sheet.
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
import {
  parseRandsToCents,
  validTaxReference,
  type Irp6Client,
} from "@/lib/tax-specialist/forms/irp6";
import {
  ITR14_FOOTER,
  ITR14_SECTIONS,
  computeItr14,
  emptyItr14Inputs,
  findItr14Draft,
  itr14ApproveBlock,
  itr14CanDownload,
  itr14ClassLabel,
  itr14Csv,
  itr14DefaultYear,
  itr14DraftFields,
  itr14FileName,
  itr14InputsFromDraft,
  itr14MissingSentence,
  itr14OpenQueries,
  itr14YearChoices,
  type Itr14Adjustment,
  type Itr14ApproverRole,
  type Itr14CompanyClass,
  type Itr14Inputs,
  type Itr14Line,
  type Itr14Query,
  type Itr14SectionId,
} from "@/lib/tax-specialist/forms/itr14";
import { saveCatalogDraft } from "@/lib/tax-specialist/forms/pipeline";
import { formatSampleDate } from "@/lib/tax-specialist/sample-compute";
import "./za-irp6-sheet.css";

type Approvals = Partial<Record<Itr14SectionId, boolean>>;

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
  disabled,
}: {
  id: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  label: string;
  disabled?: boolean;
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
        disabled={disabled}
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

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const CLASSES: Array<{ value: Itr14CompanyClass; label: string }> = [
  { value: "", label: "Not confirmed" },
  { value: "standard", label: "Standard company" },
  { value: "sbc", label: "Small business corporation" },
  { value: "other", label: "Other" },
];

export function ZaItr14Sheet({
  client,
  today,
  drafts,
  onSaved,
  onBack,
  backLabel = "Tax drafts",
  initialYear,
  approverRole = "accountant",
}: {
  client: Irp6Client & { id: string };
  today: string;
  drafts: TaxFormDraft[];
  onSaved: (draft: TaxFormDraft) => void;
  onBack: () => void;
  backLabel?: string;
  initialYear?: number;
  approverRole?: Itr14ApproverRole;
}) {
  const startYear = initialYear ?? itr14DefaultYear(today, client.fyStartMonth);
  const [year, setYear] = useState(startYear);
  const savedAtStart = findItr14Draft(drafts, startYear);
  const [inputs, setInputs] = useState<Itr14Inputs>(() =>
    savedAtStart ? itr14InputsFromDraft(savedAtStart) : emptyItr14Inputs(),
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
  const [queryText, setQueryText] = useState("");

  const saved = findItr14Draft(drafts, year);
  const years = useMemo(
    () => itr14YearChoices(today, client.fyStartMonth, year),
    [today, client.fyStartMonth, year],
  );
  const sheet = useMemo(
    () => computeItr14({ client, yearOfAssessment: year, inputs }),
    [client, year, inputs],
  );
  const locked = approverRole === "owner";
  const canDownload = itr14CanDownload(sheet, approvals, approverRole);
  const approvedCount = ITR14_SECTIONS.filter((section) => approvals[section.id]).length;
  const openQueries = itr14OpenQueries(sheet);

  const loadYear = (nextYear: number) => {
    const row = findItr14Draft(drafts, nextYear);
    setYear(nextYear);
    setInputs(row ? itr14InputsFromDraft(row) : emptyItr14Inputs());
    setApprovals(row?.approvals ?? {});
    setStatus(row?.status ?? "draft");
    setApprovedBy({
      id: row?.approved_by ?? null,
      name: row?.approved_by_name ?? null,
      at: row?.approved_at ?? null,
    });
    setError(null);
  };

  const edit = (sections: Itr14SectionId[], next: Itr14Inputs) => {
    setInputs(next);
    setApprovals((prev) => {
      const cleared = { ...prev };
      for (const section of [...sections, "result" as const, "queries" as const])
        delete cleared[section];
      return cleared;
    });
    if (status !== "draft") {
      setStatus("draft");
      setApprovedBy({ id: null, name: null, at: null });
    }
  };

  const patch = (sections: Itr14SectionId[], partial: Partial<Itr14Inputs>) => {
    edit(sections, { ...inputs, ...partial });
  };

  const persist = async (
    nextStatus: TaxFormDraftStatus,
    nextApprovals: Approvals,
    approver: { id: string | null; name: string | null; at: string | null },
    downloadedAt?: string,
  ) => {
    const row = await saveCatalogDraft({
      client_id: client.id,
      form_code: "ITR14",
      tax_year: year,
      period: null,
      subject: null,
      fields: itr14DraftFields(sheet, inputs),
      approvals: nextApprovals,
      status: nextStatus,
      approved_by: approver.id,
      approved_by_name: approver.name,
      approved_at: approver.at,
      downloaded_at: downloadedAt ?? saved?.downloaded_at ?? null,
      rules_year: sheet.rulesYear,
    });
    onSaved(row);
    return row;
  };

  const toggleApprove = async (section: Itr14SectionId) => {
    if (approverRole === "owner") return;
    const blocked = itr14ApproveBlock({ role: approverRole, section, sheet });
    if (!approvals[section] && blocked) return;
    const next = { ...approvals, [section]: !approvals[section] };
    if (!next[section]) delete next[section];
    setApprovals(next);
    const all = ITR14_SECTIONS.every((item) => next[item.id]);
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
      const [{ pdf }, { Itr14PDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./za-itr14-pdf"),
      ]);
      const blob = await pdf(
        Itr14PDF({
          clientName: client.name,
          sheet,
          approvedByName: approvedBy.name,
          approvedAt: approvedBy.at,
          preparedOn: today,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      download(blob, itr14FileName(client.name, year, "pdf"));
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
      const blob = new Blob([itr14Csv(sheet)], { type: "text/csv;charset=utf-8" });
      download(blob, itr14FileName(client.name, year, "csv"));
      await markDownloaded();
    } finally {
      setBusy(null);
    }
  };

  const lineOf = (id: Itr14Line["id"]) => sheet.lines.find((line) => line.id === id);
  const refInvalid = Boolean(inputs.taxReference.trim()) && !validTaxReference(inputs.taxReference);

  const approve = (section: Itr14SectionId) => {
    const blocked = itr14ApproveBlock({ role: approverRole, section, sheet });
    const approved = Boolean(approvals[section]);
    return (
      <button
        type="button"
        className={approved ? "irp6-approve is-approved" : "irp6-approve"}
        data-itr14-approve={section}
        data-itr14-approve-blocked={blocked ?? undefined}
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

  const fieldRow = (line: Itr14Line | undefined, children?: ReactNode) => {
    if (!line) return null;
    return (
      <tr data-itr14-field={line.id} data-itr14-missing={line.missing ? "true" : undefined}>
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
  };

  const money = (
    id: Itr14Line["id"],
    label: string,
    value: number | null,
    section: Itr14SectionId,
    key: keyof Itr14Inputs,
  ) => {
    const line = lineOf(id);
    const editable =
      !locked &&
      line &&
      line.source !== "books" &&
      line.source !== "worked" &&
      line.source !== "nil";
    return fieldRow(
      line,
      editable ? (
        <AmountInput
          id={`itr14-input-${id}`}
          label={label}
          value={value}
          disabled={locked}
          onChange={(cents) => patch([section], { [key]: cents })}
        />
      ) : undefined,
    );
  };

  const updateAdjustment = (index: number, partial: Partial<Itr14Adjustment>) => {
    patch(["adjustments"], {
      adjustments: inputs.adjustments.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    });
  };

  const ack = (query: Itr14Query): ReactNode => {
    if (locked) return null;
    if (query.id === "gap-tb") {
      return (
        <label>
          <input
            type="checkbox"
            data-itr14-ack="trial-balance"
            checked={inputs.accountTbAcknowledged}
            onChange={(event) => patch(["it14sd"], { accountTbAcknowledged: event.target.checked })}
          />{" "}
          I filled the adjustments without an account-level trial balance
        </label>
      );
    }
    if (query.id === "gap-assets") {
      return (
        <label>
          <input
            type="checkbox"
            data-itr14-ack="fixed-assets"
            checked={inputs.fixedAssetRegisterAcknowledged}
            onChange={(event) =>
              patch(["it14sd"], { fixedAssetRegisterAcknowledged: event.target.checked })
            }
          />{" "}
          The wear-and-tear line is enough
        </label>
      );
    }
    if (query.id === "gap-bs" && !query.text.startsWith("Type total")) {
      return (
        <label>
          <input
            type="checkbox"
            data-itr14-ack="balance-sheet"
            checked={inputs.balanceSheetAcknowledged}
            onChange={(event) =>
              patch(["it14sd"], { balanceSheetAcknowledged: event.target.checked })
            }
          />{" "}
          Confirm this reconciliation
        </label>
      );
    }
    return null;
  };

  const sectionHead = (id: Itr14SectionId) => {
    const section = ITR14_SECTIONS.find((row) => row.id === id)!;
    return (
      <header className="irp6-section-head">
        <div>
          <h3 className="irp6-section-title">{section.title}</h3>
          <p className="irp6-section-purpose">{section.purpose}</p>
        </div>
        {approve(id)}
      </header>
    );
  };

  return (
    <div
      className="irp6"
      data-itr14-sheet="true"
      data-itr14-status={status}
      data-itr14-role={approverRole}
      data-itr14-tax={sheet.taxCents ?? ""}
      data-itr14-class={sheet.companyClass || "unset"}
    >
      <header className="irp6-head">
        <button type="button" className="irp6-back" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="irp6-title-row">
          <h2 className="irp6-title">ITR14 preparation sheet</h2>
          <span className={`irp6-status is-${status}`} data-itr14-status-label="true">
            {TAX_FORM_DRAFT_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="irp6-purpose">
          Company income tax for {client.name}, prepared for you to check and capture on eFiling.
          Due {formatSampleDate(sheet.due)}.
        </p>
        <div className="irp6-picks">
          <label className="irp6-pick">
            Year of assessment
            <select
              className="irp6-input"
              value={year}
              data-itr14-year="true"
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

      <div className="irp6-gate" role="status" data-itr14-gate={canDownload ? "ready" : "blocked"}>
        {approverRole === "owner" ? (
          <p className="irp6-gate-line">The owner cannot approve a section.</p>
        ) : !sheet.yearFinal ? (
          <p className="irp6-gate-line" data-itr14-year-final="blocked">
            Mark the year final before you approve a section.
          </p>
        ) : openQueries.length ? (
          <p className="irp6-gate-line" data-itr14-open-queries={openQueries.length}>
            {openQueries.length === 1
              ? "1 open query blocks Approve."
              : `${openQueries.length} open queries block Approve.`}
          </p>
        ) : sheet.missing.length ? (
          <p className="irp6-gate-line" data-itr14-missing-count={sheet.missing.length}>
            {itr14MissingSentence(sheet.missing.length)}
          </p>
        ) : approvedCount < ITR14_SECTIONS.length ? (
          <p className="irp6-gate-line">
            Approve each section to download. {approvedCount} of {ITR14_SECTIONS.length} approved.
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

      <section className="irp6-section" data-itr14-section="taxpayer">
        {sectionHead("taxpayer")}
        <table className="irp6-table">
          <tbody>
            {fieldRow(lineOf("registeredName"))}
            {fieldRow(
              lineOf("registrationNumber"),
              <input
                className="irp6-input"
                aria-label="Company registration number"
                data-itr14-registration="true"
                value={inputs.registrationNumber}
                disabled={locked}
                onChange={(event) =>
                  patch(["taxpayer"], { registrationNumber: event.target.value })
                }
              />,
            )}
            {fieldRow(
              lineOf("taxReference"),
              <>
                <input
                  className="irp6-input"
                  aria-label="Income tax reference number"
                  inputMode="numeric"
                  value={inputs.taxReference}
                  disabled={locked}
                  onChange={(event) => patch(["taxpayer"], { taxReference: event.target.value })}
                />
                {refInvalid ? <span className="irp6-field-error">Should be 10 digits.</span> : null}
              </>,
            )}
            {fieldRow(
              lineOf("companyClass"),
              <select
                className="irp6-input"
                aria-label="Company class"
                data-itr14-company-class="true"
                value={inputs.companyClass}
                disabled={locked}
                onChange={(event) =>
                  patch(["taxpayer", "result"], {
                    companyClass: event.target.value as Itr14CompanyClass,
                  })
                }
              >
                {CLASSES.map((option) => (
                  <option key={option.value || "unset"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>,
            )}
            {fieldRow(lineOf("yearOfAssessment"))}
            {fieldRow(lineOf("yearEnd"))}
            {fieldRow(
              lineOf("yearFinal"),
              <label>
                <input
                  type="checkbox"
                  data-itr14-year-final="true"
                  checked={inputs.yearFinal}
                  disabled={locked}
                  onChange={(event) =>
                    patch(["taxpayer", "result"], { yearFinal: event.target.checked })
                  }
                />{" "}
                {inputs.yearFinal ? "This year is final" : "Mark this year final"}
              </label>,
            )}
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-itr14-section="profit">
        {sectionHead("profit")}
        <table className="irp6-table">
          <tbody>
            {fieldRow(lineOf("grossIncome"))}
            {money(
              "accountingProfit",
              "Accounting profit",
              inputs.accountingProfitCents,
              "profit",
              "accountingProfitCents",
            )}
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-itr14-section="adjustments">
        {sectionHead("adjustments")}
        <table className="irp6-table">
          <tbody>
            {money(
              "depreciationAddBack",
              "Depreciation add-back",
              inputs.depreciationAddBackCents,
              "adjustments",
              "depreciationAddBackCents",
            )}
            {lineOf("depreciationAddBack")?.source === "books" && !locked ? (
              <tr>
                <th scope="row">
                  <span className="irp6-label">Different depreciation add-back</span>
                  <span className="irp6-note">Leave empty to keep the books figure.</span>
                </th>
                <td className="irp6-value">
                  <AmountInput
                    id="itr14-input-depreciation-override"
                    label="Different depreciation add-back"
                    value={inputs.depreciationAddBackCents}
                    onChange={(cents) =>
                      patch(["adjustments"], { depreciationAddBackCents: cents })
                    }
                  />
                </td>
                <td className="irp6-source">
                  <span className="irp6-source-tag is-input">Optional</span>
                </td>
              </tr>
            ) : null}
            {money(
              "finesAddBack",
              "Fines and penalties add-back",
              inputs.finesAddBackCents,
              "adjustments",
              "finesAddBackCents",
            )}
            {money(
              "wearAndTear",
              "Wear-and-tear allowance",
              inputs.wearAndTearCents,
              "adjustments",
              "wearAndTearCents",
            )}
            {money(
              "exemptDividends",
              "Exempt dividends",
              inputs.exemptDividendsCents,
              "adjustments",
              "exemptDividendsCents",
            )}
            {money(
              "assessedLossBroughtForward",
              "Assessed loss brought forward",
              inputs.assessedLossBroughtForwardCents,
              "adjustments",
              "assessedLossBroughtForwardCents",
            )}
            {money("donation", "Donation", inputs.donationCents, "adjustments", "donationCents")}
            {fieldRow(lineOf("otherAdjustmentsNet"))}
            {fieldRow(lineOf("taxableBeforeDonation"))}
            {fieldRow(lineOf("donationLimit"))}
            {fieldRow(lineOf("donationAllowed"))}
            {fieldRow(lineOf("donationDisallowed"))}
          </tbody>
        </table>
        <div className="irp6-adj-scroll">
          <table className="irp6-adj" data-itr14-adjustments="true">
            <thead>
              <tr>
                <th scope="col">Other adjustment</th>
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
              {inputs.adjustments.map((row, index) => (
                <tr key={row.id} data-itr14-adjustment={row.id}>
                  <td>
                    <input
                      className="irp6-input"
                      aria-label={`Adjustment ${index + 1} description`}
                      value={row.description}
                      disabled={locked}
                      onChange={(event) =>
                        updateAdjustment(index, { description: event.target.value })
                      }
                    />
                  </td>
                  <td className="irp6-num">
                    <AmountInput
                      id={`itr14-adj-${row.id}`}
                      label={`Adjustment ${index + 1} amount`}
                      value={row.amountCents}
                      disabled={locked}
                      onChange={(cents) => updateAdjustment(index, { amountCents: cents })}
                    />
                  </td>
                  <td>
                    <select
                      className="irp6-input"
                      aria-label={`Adjustment ${index + 1} added or deducted`}
                      value={row.direction}
                      disabled={locked}
                      onChange={(event) =>
                        updateAdjustment(index, {
                          direction: event.target.value as Itr14Adjustment["direction"],
                        })
                      }
                    >
                      <option value="add">Added</option>
                      <option value="deduct">Deducted</option>
                    </select>
                  </td>
                  <td className="irp6-remove-cell">
                    {locked ? null : (
                      <button
                        type="button"
                        className="irp6-remove"
                        aria-label={`Remove adjustment ${index + 1}`}
                        onClick={() =>
                          patch(["adjustments"], {
                            adjustments: inputs.adjustments.filter((_, i) => i !== index),
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {locked ? null : (
                <tr>
                  <td colSpan={4}>
                    <button
                      type="button"
                      className="irp6-add"
                      data-itr14-add-adjustment="true"
                      onClick={() =>
                        patch(["adjustments"], {
                          adjustments: [
                            ...inputs.adjustments,
                            {
                              id: nextId("adj"),
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
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="irp6-section" data-itr14-section="it14sd">
        {sectionHead("it14sd")}
        <table className="irp6-table">
          <tbody>
            {money("turnover", "Turnover", inputs.turnoverCents, "it14sd", "turnoverCents")}
            {lineOf("turnover")?.source === "books" && !locked
              ? fieldRow(
                  {
                    ...lineOf("turnover")!,
                    id: "turnover",
                    label: "Different turnover",
                    note: "Leave empty to keep the books figure.",
                    missing: false,
                  },
                  <AmountInput
                    id="itr14-input-turnover-override"
                    label="Different turnover"
                    value={inputs.turnoverCents}
                    onChange={(cents) => patch(["it14sd"], { turnoverCents: cents })}
                  />,
                )
              : null}
            {money(
              "costOfSales",
              "Cost of sales",
              inputs.costOfSalesCents,
              "it14sd",
              "costOfSalesCents",
            )}
            {money(
              "totalAssets",
              "Total assets",
              inputs.totalAssetsCents,
              "it14sd",
              "totalAssetsCents",
            )}
            {money("equity", "Equity", inputs.equityCents, "it14sd", "equityCents")}
            {money(
              "liabilities",
              "Liabilities",
              inputs.liabilitiesCents,
              "it14sd",
              "liabilitiesCents",
            )}
            {fieldRow(lineOf("balanceSheetDifference"))}
            {money(
              "fixedAssets",
              "Fixed assets, carrying amount",
              inputs.fixedAssetsCents,
              "it14sd",
              "fixedAssetsCents",
            )}
            {fieldRow(lineOf("accountTrialBalance"))}
            {money(
              "priorAssessment",
              "Prior assessed taxable income",
              inputs.priorAssessmentCents,
              "it14sd",
              "priorAssessmentCents",
            )}
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-itr14-section="credits">
        {sectionHead("credits")}
        <table className="irp6-table">
          <tbody>
            {money(
              "provisionalPeriod1",
              "Provisional tax, period 1",
              inputs.provisionalPeriod1Cents,
              "credits",
              "provisionalPeriod1Cents",
            )}
            {money(
              "provisionalPeriod2",
              "Provisional tax, period 2",
              inputs.provisionalPeriod2Cents,
              "credits",
              "provisionalPeriod2Cents",
            )}
            {money(
              "provisionalTopUp",
              "Provisional tax, top-up",
              inputs.provisionalTopUpCents,
              "credits",
              "provisionalTopUpCents",
            )}
            {fieldRow(lineOf("foreignTaxCredits"))}
            {fieldRow(lineOf("creditsTotal"))}
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-itr14-section="queries">
        {sectionHead("queries")}
        <ul className="irp6-checks" data-itr14-queries="true">
          {sheet.queries.length === 0 ? <li>No queries.</li> : null}
          {sheet.queries.map((query) => (
            <li
              key={query.id}
              data-itr14-query={query.id}
              data-itr14-query-open={query.resolved ? "false" : "true"}
            >
              <p>{query.text}</p>
              {ack(query)}
              {query.id.startsWith("gap-") || locked ? null : (
                <label>
                  <input
                    type="checkbox"
                    checked={query.resolved}
                    onChange={(event) =>
                      patch(["queries"], {
                        queries: inputs.queries.map((row) =>
                          row.id === query.id ? { ...row, resolved: event.target.checked } : row,
                        ),
                      })
                    }
                  />{" "}
                  Resolved
                </label>
              )}
            </li>
          ))}
        </ul>
        {locked ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const text = queryText.trim();
              if (!text) return;
              patch(["queries"], {
                queries: [...inputs.queries, { id: nextId("q"), text, resolved: false }],
              });
              setQueryText("");
            }}
          >
            <label>
              Add a query
              <input
                className="irp6-input"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
              />
            </label>
            <button type="submit" className="irp6-add">
              Add query
            </button>
          </form>
        )}
      </section>

      <section className="irp6-section" data-itr14-section="result">
        {sectionHead("result")}
        <table className="irp6-table">
          <tbody>
            {fieldRow(lineOf("taxableIncome"))}
            {fieldRow(lineOf("normalTax"))}
            {fieldRow(lineOf("balance"))}
            {fieldRow(lineOf("assessedLossCarried"))}
          </tbody>
        </table>
        {sheet.checks.length ? (
          <ul className="irp6-checks" aria-label="Checks">
            {sheet.checks.map((check) => (
              <li
                key={check.id}
                className={`irp6-check is-${check.level}`}
                data-itr14-check={check.id}
              >
                {check.text}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="irp6-note">
          {itr14ClassLabel(sheet.companyClass) || "Company class not confirmed"}
        </p>
      </section>

      <footer className="irp6-actions">
        <button
          type="button"
          className="irp6-button is-primary"
          data-itr14-download="pdf"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadPdf()}
        >
          {busy === "pdf" ? "Building PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className="irp6-button"
          data-itr14-download="csv"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadCsv()}
        >
          Download CSV
        </button>
        <button
          type="button"
          className="irp6-button"
          data-itr14-save="true"
          disabled={busy != null || locked}
          onClick={() => void saveDraft()}
        >
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <span className="irp6-saved" data-itr14-version={saved?.version ?? undefined}>
          {saved
            ? `Saved ${draftDayLabel(saved.updated_at)}, version ${saved.version}`
            : "Not saved yet"}
        </span>
        {error ? (
          <p className="irp6-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </footer>
      <p className="irp6-purpose">{ITR14_FOOTER}</p>
    </div>
  );
}
