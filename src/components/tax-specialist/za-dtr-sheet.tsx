/**
 * Dividends tax draft pack. DTR01 is the dividend the company declared.
 * DTR02 lists each beneficial owner. PDF and CSV are for the accountant.
 * Nothing is filed.
 */
import { useMemo, useState } from "react";
import {
  DTR_RATES_NOTE,
  DTR_TITLE,
  computeDtr,
  dtrCsv,
  dtrFileName,
  dtrMoney,
  emptyDtrInputs,
  emptyDtrOwner,
  type DtrInputs,
  type DtrKind,
  type DtrOwnerInput,
  type DtrTreatment,
} from "@/lib/tax-specialist/forms/dtr";
import { parseRandsToCents, zaToday } from "@/lib/tax-specialist/forms/irp6";
import { AssetDateInput } from "./asset-date-input";
import { formatSampleDate } from "@/lib/tax-specialist/sample-compute";
import "./za-irp6-sheet.css";

function centsText(cents: number | null): string {
  if (cents == null) return "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100);
  const rem = abs % 100;
  return rem ? `${rands}.${String(rem).padStart(2, "0")}` : String(rands);
}

function AmountInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (cents: number | null) => void;
}) {
  const [text, setText] = useState(centsText(value));
  const [bad, setBad] = useState(false);
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

function YmdInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      className="irp6-input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      placeholder="YYYY-MM-DD"
      aria-label={label}
      maxLength={10}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
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

function showDate(iso: string | null): string {
  return iso ? formatSampleDate(iso) : "";
}

export function ZaDtrSheet({
  client,
  onBack,
  backLabel = "Tax drafts",
}: {
  client: { id: string; name: string };
  onBack: () => void;
  backLabel?: string;
}) {
  const [inputs, setInputs] = useState<DtrInputs>(() => ({
    ...emptyDtrInputs(),
    owners: [emptyDtrOwner("owner-1")],
  }));
  const [busy, setBusy] = useState<null | "pdf" | "csv">(null);
  const [error, setError] = useState<string | null>(null);
  const sheet = useMemo(() => computeDtr(inputs), [inputs]);

  const patch = (partial: Partial<DtrInputs>) => {
    setInputs((prev) => ({ ...prev, ...partial }));
  };

  const patchOwner = (id: string, partial: Partial<DtrOwnerInput>) => {
    setInputs((prev) => ({
      ...prev,
      owners: prev.owners.map((row) => (row.id === id ? { ...row, ...partial } : row)),
    }));
  };

  const addOwner = () => {
    setInputs((prev) => ({
      ...prev,
      owners: [
        ...prev.owners,
        emptyDtrOwner(`owner-${prev.owners.length + 1}-${Math.random().toString(36).slice(2, 6)}`),
      ],
    }));
  };

  const removeOwner = (id: string) => {
    setInputs((prev) => ({ ...prev, owners: prev.owners.filter((row) => row.id !== id) }));
  };

  const downloadPdf = async () => {
    setBusy("pdf");
    setError(null);
    try {
      const [{ pdf }, { DtrPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./za-dtr-pdf"),
      ]);
      const blob = await pdf(
        DtrPDF({
          clientName: client.name,
          sheet,
          preparedOn: zaToday(),
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      download(blob, dtrFileName(client.name, "pdf"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const downloadCsv = () => {
    setBusy("csv");
    setError(null);
    try {
      const blob = new Blob([dtrCsv(sheet)], { type: "text/csv;charset=utf-8" });
      download(blob, dtrFileName(client.name, "csv"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="irp6" data-dtr-sheet="true" data-dtr-client={client.id}>
      <header className="irp6-head">
        <button type="button" className="irp6-back" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="irp6-title-row">
          <h2 className="irp6-title">{DTR_TITLE}</h2>
        </div>
        <p className="irp6-purpose">
          DTR01 and DTR02 for {client.name}. Nothing is filed, and nothing is sent to the client.
        </p>
        <p className="irp6-note" data-dtr-rates-note="true">
          {DTR_RATES_NOTE}
        </p>
      </header>

      <div
        className="irp6-gate"
        role="status"
        data-dtr-gate={sheet.messages.length ? "missing" : "ready"}
      >
        {sheet.messages.length ? (
          <ul>
            {sheet.messages.map((message) => (
              <li key={message} data-dtr-message="true">
                {message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="irp6-gate-line is-ready">Ready to download.</p>
        )}
      </div>

      <section className="irp6-section" data-dtr-section="DTR01">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">DTR01</h3>
            <p className="irp6-section-purpose">The dividend the company declared.</p>
          </div>
        </header>
        <table className="irp6-table">
          <tbody>
            <tr>
              <th scope="row">Declaration date</th>
              <td>
                <AssetDateInput
                  id="dtr-declaration-date"
                  label="Declaration date"
                  showLabel={false}
                  value={inputs.declarationDate}
                  onCommit={(declarationDate) => patch({ declarationDate })}
                />
              </td>
            </tr>
            <tr>
              <th scope="row">Payment date</th>
              <td>
                <YmdInput
                  id="dtr-payment-date"
                  label="Payment date"
                  value={inputs.paymentDate}
                  onChange={(paymentDate) => patch({ paymentDate })}
                />
              </td>
            </tr>
            <tr>
              <th scope="row">Dividend amount</th>
              <td>
                <AmountInput
                  id="dtr-amount"
                  label="Dividend amount"
                  value={inputs.amountCents}
                  onChange={(amountCents) => patch({ amountCents })}
                />
              </td>
            </tr>
            <tr>
              <th scope="row">Cash or in specie</th>
              <td>
                <select
                  id="dtr-kind"
                  className="irp6-input"
                  aria-label="Cash or in specie"
                  value={inputs.kind}
                  onChange={(event) => patch({ kind: event.target.value as DtrKind })}
                >
                  <option value="">Not entered</option>
                  <option value="cash">Cash</option>
                  <option value="in-specie">In specie</option>
                </select>
                {sheet.inSpecieNote ? (
                  <span className="irp6-note">{sheet.inSpecieNote}</span>
                ) : null}
              </td>
            </tr>
            <tr data-dtr-due={sheet.dueDate ?? ""}>
              <th scope="row">Due date</th>
              <td>{showDate(sheet.dueDate)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="irp6-section" data-dtr-section="DTR02">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">DTR02</h3>
            <p className="irp6-section-purpose">
              Each beneficial owner. A regulated intermediary lists the owners it paid. An exempt
              owner needs a reason. A treaty rate is typed, not assumed.
            </p>
          </div>
        </header>
        {inputs.owners.map((owner, index) => {
          const line = sheet.owners[index];
          return (
            <div key={owner.id} data-dtr-owner={owner.id} style={{ marginTop: 12 }}>
              <table className="irp6-table">
                <tbody>
                  <tr>
                    <th scope="row">Beneficial owner</th>
                    <td>
                      <input
                        className="irp6-input"
                        aria-label={`Beneficial owner ${index + 1} name`}
                        value={owner.name}
                        onChange={(event) => patchOwner(owner.id, { name: event.target.value })}
                      />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Amount</th>
                    <td>
                      <AmountInput
                        id={`dtr-owner-amount-${owner.id}`}
                        label={`Amount for ${line?.label ?? "beneficial owner"}`}
                        value={owner.amountCents}
                        onChange={(amountCents) => patchOwner(owner.id, { amountCents })}
                      />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Treatment</th>
                    <td>
                      <select
                        className="irp6-input"
                        aria-label={`Treatment for ${line?.label ?? "beneficial owner"}`}
                        value={owner.treatment}
                        onChange={(event) =>
                          patchOwner(owner.id, { treatment: event.target.value as DtrTreatment })
                        }
                      >
                        <option value="">Not entered</option>
                        <option value="standard">Standard rate</option>
                        <option value="exempt">Exempt</option>
                        <option value="dta">Reduced DTA rate</option>
                      </select>
                    </td>
                  </tr>
                  {owner.treatment === "exempt" ? (
                    <tr>
                      <th scope="row">Exemption reason</th>
                      <td>
                        <input
                          className="irp6-input"
                          aria-label={`Exemption reason for ${line?.label ?? "beneficial owner"}`}
                          value={owner.exemptionReason}
                          onChange={(event) =>
                            patchOwner(owner.id, { exemptionReason: event.target.value })
                          }
                        />
                      </td>
                    </tr>
                  ) : null}
                  {owner.treatment === "dta" ? (
                    <tr>
                      <th scope="row">DTA rate</th>
                      <td>
                        <input
                          className="irp6-input irp6-input--num"
                          inputMode="decimal"
                          aria-label={`DTA rate for ${line?.label ?? "beneficial owner"}`}
                          value={owner.dtaRateText}
                          onChange={(event) =>
                            patchOwner(owner.id, { dtaRateText: event.target.value })
                          }
                        />
                      </td>
                    </tr>
                  ) : null}
                  <tr data-dtr-withholding={line?.withholdingCents ?? ""}>
                    <th scope="row">Withholding</th>
                    <td>
                      {line?.withholdingLabel ?? ""}
                      {line?.note ? <span className="irp6-note">{line.note}</span> : null}
                    </td>
                  </tr>
                </tbody>
              </table>
              <button type="button" className="irp6-button" onClick={() => removeOwner(owner.id)}>
                Remove {line?.label ?? "owner"}
              </button>
            </div>
          );
        })}
        <p style={{ marginTop: 12 }}>
          <button type="button" className="irp6-button" onClick={addOwner}>
            Add beneficial owner
          </button>
        </p>
        <table className="irp6-table">
          <tbody>
            <tr data-dtr-total={sheet.totalWithheldCents ?? ""}>
              <th scope="row">Total withheld</th>
              <td>{dtrMoney(sheet.totalWithheldCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {error ? (
        <p className="irp6-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="irp6-actions">
        <button
          type="button"
          className="irp6-button is-primary"
          data-dtr-download="pdf"
          disabled={busy != null}
          onClick={() => void downloadPdf()}
        >
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className="irp6-button"
          data-dtr-download="csv"
          disabled={busy != null}
          onClick={downloadCsv}
        >
          {busy === "csv" ? "Preparing CSV…" : "Download CSV"}
        </button>
      </div>
    </div>
  );
}
