/**
 * SAMPLE Tax Specialist. Loaded only after a ZA market check.
 * Figures are fixed. Nothing here calls a model, SARS, or a ledger.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OwnerAvatar, type AvatarSize } from "@/components/owner-door/owner-avatar";
import { fmAvatarClip } from "@/lib/fm-avatar-state";
import {
  SAMPLE_COMPANY,
  companyTaxDeadlines,
  computeCompanyTax,
  deadlineStanding,
  formatSampleCents,
  formatSampleDate,
  sampleCompanyTax,
  yearOfAssessmentStart,
  type CompanyTaxResult,
  type TaxDeadline,
} from "@/lib/tax-specialist/sample-compute";
import "./za-tax-specialist-sample.css";

export type TaxSampleAudience = "owner" | "accountant";
export type TaxSampleVariant = "card" | "desk" | "stage" | "handoff" | "fm-handoff" | "host";

type OpenState = { open: boolean; fromFinancialManager: boolean };

let hostToken: symbol | null = null;
let openState: OpenState = { open: false, fromFinancialManager: false };
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function openTaxSample(fromFinancialManager: boolean): void {
  openState = { open: true, fromFinancialManager };
  publish();
}

function closeTaxSample(): void {
  openState = { open: false, fromFinancialManager: false };
  publish();
}

function useOpenState(): OpenState {
  const [state, setState] = useState(openState);
  useEffect(() => {
    const pull = () => setState(openState);
    listeners.add(pull);
    pull();
    return () => {
      listeners.delete(pull);
    };
  }, []);
  return state;
}

function useIsHost(): boolean {
  const token = useRef(Symbol("tax-sample-host"));
  const [isHost, setIsHost] = useState(false);
  useEffect(() => {
    if (hostToken == null) {
      hostToken = token.current;
      setIsHost(true);
    }
    return () => {
      if (hostToken === token.current) hostToken = null;
    };
  }, []);
  return isHost;
}

function TaxFace({
  size,
  place,
  handed = false,
}: {
  size: AvatarSize;
  place: "card" | "desk" | "menu" | "stage" | "sheet";
  handed?: boolean;
}) {
  const fmClip = fmAvatarClip(handed ? { handoff: { at: "2026-01-01T00:00:00.000Z" } } : {});
  return (
    <span className="tax-sample-face" data-face={place} data-tax-avatar="tax_specialist">
      <OwnerAvatar
        agent="tax_specialist"
        variant="character"
        size={size}
        motion="idle"
        fmClip={fmClip}
      />
    </span>
  );
}

function money(cents: number): string {
  return formatSampleCents(cents);
}

function Worksheet({
  caption,
  rows,
}: {
  caption: string;
  rows: Array<{ label: string; amount: string; note?: string; total?: boolean }>;
}) {
  return (
    <div className="tax-sample-table">
      <table>
        <caption className="tax-sample-kicker">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">SAMPLE amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.total ? "is-total" : undefined}>
              <td>
                {row.label}
                {row.note ? <div className="tax-sample-note">{row.note}</div> : null}
              </td>
              <td>{row.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function computationRows(result: CompanyTaxResult) {
  const input = SAMPLE_COMPANY.input;
  return [
    { label: "Accounting profit before tax", amount: money(input.accountingProfitCents) },
    { label: "Add back accounting depreciation", amount: money(input.depreciationAddBackCents) },
    {
      label: "Add back fines and penalties",
      amount: money(input.finesAddBackCents),
      note: "SAMPLE. Treated as non-deductible.",
    },
    {
      label: "Less wear-and-tear allowance",
      amount: money(-input.wearAndTearCents),
      note: "SAMPLE allowance. Not a wear-and-tear schedule.",
    },
    { label: "Less exempt dividends", amount: money(-input.exemptDividendsCents) },
    {
      label: "Less assessed loss brought forward",
      amount: money(-input.assessedLossBroughtForwardCents),
    },
    {
      label: "Taxable income before the donation limit",
      amount: money(result.taxableBeforeDonationCents),
      total: true,
    },
    {
      label: "Donation limit, 10% of that income",
      amount: money(result.donationLimitCents),
    },
    { label: "Donation allowed", amount: money(-result.donationAllowedCents) },
    { label: "Donation not allowed", amount: money(result.donationDisallowedCents) },
    { label: "Taxable income", amount: money(result.taxableIncomeCents), total: true },
    { label: "Normal tax at 27%", amount: money(result.taxCents), total: true },
  ];
}

function itr14Rows(result: CompanyTaxResult) {
  return [
    { label: "Taxable income", amount: money(result.taxableIncomeCents) },
    { label: "Normal tax at 27%", amount: money(result.taxCents), total: true },
    { label: "Less first provisional (IRP6)", amount: money(-result.period1Cents) },
    { label: "Less second provisional (IRP6)", amount: money(-result.period2Cents) },
    {
      label: "Balance on this sample",
      amount: money(result.balanceCents),
      total: true,
      note: "Not an assessment. Nothing has been submitted.",
    },
  ];
}

function irp6Rows(result: CompanyTaxResult) {
  const estimate = SAMPLE_COMPANY.input.provisionalEstimateCents;
  return [
    { label: "Estimated taxable income", amount: money(estimate) },
    { label: "Tax on that estimate at 27%", amount: money(result.estimateTaxCents), total: true },
    { label: "Period 1, half of the estimate", amount: money(result.period1Cents) },
    { label: "Period 2, the rest of the estimate", amount: money(result.period2Cents) },
    { label: "80% of the sample taxable income", amount: money(result.eightyPercentCents) },
    {
      label: "Estimate against that 80% line",
      amount: result.estimateClearsEightyPercent ? "Clears" : "Short",
      note: result.aboveBasicAmountHarbour
        ? "This sample is above R 1 000 000.00, so the basic-amount safe harbour is not the test. The estimate still clears 80%."
        : "The estimate clears 80% of the sample taxable income.",
    },
    {
      label: "Prior assessed taxable income, unadjusted",
      amount: money(SAMPLE_COMPANY.priorAssessedTaxableCents),
      note: "Typed sample figure. Not loaded from an assessment.",
    },
    { label: "Optional top-up to the sample tax", amount: money(result.topUpCents), total: true },
  ];
}

function SampleHomeCard({ onOpen }: { onOpen: () => void }) {
  const result = sampleCompanyTax();
  return (
    <div
      className="owner-agent"
      data-agent="tax_specialist"
      data-agent-card="tax_specialist"
      data-tax-card="sample"
    >
      <button
        type="button"
        className="owner-agent-open"
        data-tax-sample-open="card"
        onClick={onOpen}
      >
        <span className="owner-portrait">
          <span className="owner-portrait-chip" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4.2 2.2h5.2L12.2 5v8.6H4.2z" />
              <path d="M9.2 2.3V5h2.8" />
            </svg>
          </span>
          <TaxFace size="lg" place="card" />
        </span>
        <span className="owner-name">Milōn Tax Specialist</span>
        <span className="owner-status is-idle">SAMPLE</span>
        <span className="owner-lines">
          <span className="owner-voice">
            SAMPLE demo · Harbour & Co — see how company tax at 27% will work
          </span>
          <span className="owner-voice">Tax {money(result.taxCents)}.</span>
        </span>
      </button>
      <button type="button" className="owner-ask" data-tax-sample-open="ask" onClick={onOpen}>
        Open sample
      </button>
    </div>
  );
}

function PreviewHomeCard({ onHandOff, onSample }: { onHandOff: () => void; onSample: () => void }) {
  return (
    <div
      className="owner-agent"
      data-agent="tax_specialist"
      data-agent-card="tax_specialist"
      data-tax-card="preview"
    >
      <button
        type="button"
        className="owner-agent-open"
        data-tax-preview-action="handoff"
        onClick={onHandOff}
      >
        <span className="owner-portrait">
          <span className="owner-portrait-chip" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4.2 2.2h5.2L12.2 5v8.6H4.2z" />
              <path d="M9.2 2.3V5h2.8" />
            </svg>
          </span>
          <TaxFace size="lg" place="card" />
        </span>
        <span className="owner-name">Milōn Tax Specialist</span>
        <span className="owner-status is-idle">Preview</span>
        <span className="owner-lines">
          <span className="owner-voice">Prepares ITR14 and IRP6 workings for your sign-off.</span>
        </span>
      </button>
      <div className="tax-preview-actions">
        <button
          type="button"
          className="tax-sample-see"
          data-tax-preview-action="sample"
          onClick={onSample}
        >
          See a sample
        </button>
        <button
          type="button"
          className="owner-ask"
          data-tax-preview-action="handoff"
          onClick={onHandOff}
        >
          Hand to Tax Specialist
        </button>
      </div>
    </div>
  );
}

function standingLabel(due: string): string {
  const standing = deadlineStanding(due, SAMPLE_COMPANY.asOf);
  if (standing === "upcoming") return "Upcoming";
  if (standing === "due") return "Due today";
  return "Passed";
}

function paymentLabel(row: TaxDeadline): string {
  if (row.id === "irp6-1" || row.id === "irp6-2") return "SAMPLE marked paid";
  if (row.id === "irp6-3") return "Not paid in this sample";
  return "Not submitted";
}

function Workspace({
  audience,
  fromFinancialManager,
  onClose,
}: {
  audience: TaxSampleAudience;
  fromFinancialManager: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const result = sampleCompanyTax();
  const deadlines = companyTaxDeadlines(SAMPLE_COMPANY.yearEnd);
  const yearStart = yearOfAssessmentStart(SAMPLE_COMPANY.yearEnd);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const who =
    audience === "owner"
      ? "For the owner. Your accountant reviews this before anyone files."
      : "For the accountant. Review this before anyone files.";

  return (
    <div className="tax-sample-backdrop" data-tax-sample-backdrop="true" onClick={onClose}>
      <div
        className="tax-sample-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-tax-sample-sheet="true"
        data-tax-sample-from={fromFinancialManager ? "financial-manager" : "card"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tax-sample-head">
          <div className="tax-sample-who">
            <TaxFace size="md" place="sheet" handed={fromFinancialManager} />
            <div>
              <p className="tax-sample-kicker">SAMPLE · ZA · SARS</p>
              <h2 id={titleId}>Tax Specialist</h2>
            </div>
          </div>
          <button ref={closeRef} type="button" className="tax-sample-close" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="tax-sample-banner">
          <strong>SAMPLE.</strong> {who} No SARS sign-in, no SARS API, and no submission. Xero,
          QuickBooks, and Sage are not changed.
        </p>
        {fromFinancialManager ? (
          <p className="tax-sample-banner" data-tax-fm-banner="true">
            <strong>Hand to Tax Specialist.</strong> The Financial Manager handed this sample pack
            across. Nothing was filed.
          </p>
        ) : null}
        <div className="tax-sample-meta">
          <span>{SAMPLE_COMPANY.legalName}</span>
          <span>Registration {SAMPLE_COMPANY.registration}</span>
          <span>
            {formatSampleDate(yearStart)} – {formatSampleDate(SAMPLE_COMPANY.yearEnd)}
          </span>
          <span>As of {formatSampleDate(SAMPLE_COMPANY.asOf)}</span>
          <span>Standard company · 27%</span>
        </div>

        <h3>Company income tax</h3>
        <Worksheet caption="SAMPLE computation" rows={computationRows(result)} />

        <h3>ITR14 worksheet</h3>
        <p className="tax-sample-note">
          Company return lines for this sample. This is not the official form and it is not filed.
        </p>
        <Worksheet caption="SAMPLE ITR14" rows={itr14Rows(result)} />

        <h3>IRP6 worksheet</h3>
        <p className="tax-sample-note">
          Provisional tax for the same year. Period 1 and period 2 split the estimate. The third
          amount is optional.
        </p>
        <Worksheet caption="SAMPLE IRP6" rows={irp6Rows(result)} />

        <h3>Deadlines</h3>
        <p className="tax-sample-note">
          Statutory last day, before a weekend or public-holiday shift. Compared with{" "}
          {formatSampleDate(SAMPLE_COMPANY.asOf)}.
        </p>
        <div className="tax-sample-table">
          <table data-tax-deadlines="true">
            <caption className="tax-sample-kicker">SAMPLE deadlines</caption>
            <thead>
              <tr>
                <th scope="col">Form</th>
                <th scope="col">What</th>
                <th scope="col">Statutory due</th>
                <th scope="col">Standing</th>
                <th scope="col">Sample</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((row) => (
                <tr key={row.id} data-tax-deadline={row.id}>
                  <td>{row.form}</td>
                  <td>{row.label}</td>
                  <td>
                    {formatSampleDate(row.due)} ({row.weekday})
                  </td>
                  <td
                    className={
                      deadlineStanding(row.due, SAMPLE_COMPANY.asOf) === "upcoming"
                        ? "is-clear"
                        : "is-wait"
                    }
                  >
                    {standingLabel(row.due)}
                  </td>
                  <td>{paymentLabel(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tax-sample-actions">
          <button type="button" className="tax-sample-primary" onClick={() => openTaxSample(true)}>
            Hand to Tax Specialist
          </button>
        </div>
      </div>
    </div>
  );
}

export function ZaTaxSpecialistSample({
  variant,
  audience,
  onOpen,
  sampleClient = false,
}: {
  variant: TaxSampleVariant;
  audience: TaxSampleAudience;
  onOpen?: () => void;
  /** Demo clients keep the sample card. A real client gets the preview card. */
  sampleClient?: boolean;
}) {
  const isHost = useIsHost();
  const state = useOpenState();

  const openFromCard = () => {
    onOpen?.();
    openTaxSample(false);
  };
  const openFromManager = () => {
    onOpen?.();
    openTaxSample(true);
  };

  const workspace =
    isHost && state.open && typeof document !== "undefined"
      ? createPortal(
          <Workspace
            audience={audience}
            fromFinancialManager={state.fromFinancialManager}
            onClose={closeTaxSample}
          />,
          document.body,
        )
      : null;

  if (variant === "host") return workspace;

  if (variant === "handoff") {
    return (
      <>
        <button
          type="button"
          className="tax-sample-menu-btn"
          data-tax-handoff="true"
          onClick={openFromManager}
        >
          <TaxFace size="sm" place="menu" />
          Hand to Tax Specialist
        </button>
        {workspace}
      </>
    );
  }

  if (variant === "fm-handoff") {
    return (
      <>
        <div className="tax-sample-handoff" data-tax-fm-handoff="true">
          <TaxFace size="sm" place="menu" />
          <p>Financial Manager</p>
          <button type="button" onClick={openFromManager}>
            Hand to Tax Specialist
          </button>
        </div>
        {workspace}
      </>
    );
  }

  if (variant === "stage") {
    return (
      <>
        <button
          type="button"
          className="tax-sample-stage"
          data-agent="tax_specialist"
          data-agent-card="tax_specialist"
          data-tax-sample-open="stage"
          onClick={openFromCard}
        >
          <TaxFace size="sm" place="stage" />
          Tax Specialist
        </button>
        {workspace}
      </>
    );
  }

  if (variant === "desk") {
    return (
      <>
        <button
          type="button"
          className="milon-desk-agent"
          data-agent-card="tax_specialist"
          data-tax-card={sampleClient ? "sample" : "preview"}
          data-tax-sample-open="desk"
          onClick={sampleClient ? openFromCard : openFromManager}
        >
          <TaxFace size="sm" place="desk" />
          <span className="milon-desk-agent-copy">
            <strong className="milon-desk-agent-name">Milōn Tax Specialist</strong>
            <span className="milon-desk-agent-short">Tax Specialist</span>
            <span className="milon-desk-ran">{sampleClient ? "SAMPLE" : "Preview"}</span>
            <span className="milon-desk-status is-idle">
              <i />
              <span>{sampleClient ? "Company tax at 27%" : "ITR14 and IRP6 workings"}</span>
            </span>
          </span>
        </button>
        {workspace}
      </>
    );
  }

  if (!sampleClient) {
    return (
      <>
        <PreviewHomeCard onHandOff={openFromManager} onSample={openFromCard} />
        {workspace}
      </>
    );
  }

  return (
    <>
      <SampleHomeCard onOpen={openFromCard} />
      {workspace}
    </>
  );
}
