/**
 * Tax Specialist agent page sections. Loaded only after a ZA market check,
 * through TaxSpecialistPage in tax-specialist-slot.
 */
import { AgentSection } from "@/components/milon-team/agent-section";
import { ACTIVITY_CAP } from "@/lib/agent-section-copy";
import {
  SAMPLE_COMPANY,
  formatSampleDate,
  sampleCompanyTax,
  yearOfAssessmentStart,
} from "@/lib/tax-specialist/sample-compute";
import {
  SampleDeadlines,
  Worksheet,
  computationRows,
  irp6Rows,
  itr14Rows,
} from "./za-tax-specialist-sample";
import "./za-tax-specialist-sample.css";
import "./za-tax-specialist-page.css";

export type TaxPageActivity = { id: string; text: string; at: string };

export const TAX_FORMS = [
  { id: "irp5", name: "IRP5 / IT3(a)", what: "Employee tax certificates for the year." },
  { id: "emp201", name: "EMP201", what: "Monthly PAYE, UIF and SDL declaration." },
  { id: "emp501", name: "EMP501", what: "Payroll reconciliation, twice a year." },
  { id: "irp6", name: "IRP6", what: "Provisional tax for the company." },
  { id: "itr14", name: "ITR14", what: "The company's income tax return." },
  { id: "vat201", name: "VAT201", what: "VAT return for the period." },
  { id: "itr12", name: "ITR12", what: "Personal income tax return for an owner." },
] as const;

function SampleBadge() {
  return (
    <span className="tax-page-sample" data-tax-sample-label="true">
      Sample
    </span>
  );
}

function Workings() {
  const result = sampleCompanyTax();
  const yearStart = yearOfAssessmentStart(SAMPLE_COMPANY.yearEnd);
  return (
    <AgentSection section="workings" data-tax-section="workings">
      <div className="tax-page-meta">
        <SampleBadge />
        <span>{SAMPLE_COMPANY.legalName}</span>
        <span>
          {formatSampleDate(yearStart)} – {formatSampleDate(SAMPLE_COMPANY.yearEnd)}
        </span>
      </div>
      <Worksheet caption="Company income tax" rows={computationRows(result)} />
      <details className="tax-page-more">
        <summary>ITR14 and IRP6 lines</summary>
        <Worksheet caption="ITR14" rows={itr14Rows(result)} />
        <Worksheet caption="IRP6" rows={irp6Rows(result)} />
      </details>
    </AgentSection>
  );
}

export function ZaTaxSpecialistPage({ activity = [] }: { activity?: TaxPageActivity[] }) {
  const recent = [...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_CAP);
  return (
    <div className="tax-page" data-tax-page="true">
      <AgentSection section="forms" data-tax-section="forms">
        <ul className="tax-page-forms">
          {TAX_FORMS.map((form) => (
            <li key={form.id} className="tax-page-form" data-tax-form={form.id}>
              <span className="tax-page-form-name">{form.name}</span>
              <span className="tax-page-form-what">{form.what}</span>
            </li>
          ))}
        </ul>
      </AgentSection>
      <Workings />
      <AgentSection section="deadlines" data-tax-section="deadlines">
        <div className="tax-page-meta">
          <SampleBadge />
          <span>As of {formatSampleDate(SAMPLE_COMPANY.asOf)}</span>
        </div>
        <SampleDeadlines />
      </AgentSection>
      <AgentSection section="activity" data-tax-section="activity">
        {recent.length ? (
          <ul className="tax-page-activity">
            {recent.map((row) => (
              <li key={row.id}>{row.text}</li>
            ))}
          </ul>
        ) : (
          <p className="agent-section-empty">Nothing yet. Drafts you save show here.</p>
        )}
      </AgentSection>
    </div>
  );
}
