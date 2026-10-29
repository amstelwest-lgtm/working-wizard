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
import {
  TAX_FORM_GALLERY,
  TAX_FORM_STATUS_LABEL,
  type TaxFormCode,
} from "@/lib/tax-specialist/forms/gallery";
import "./za-tax-specialist-sample.css";
import "./za-tax-specialist-page.css";

export type TaxPageActivity = { id: string; text: string; at: string };

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

function FormGallery({ onOpen }: { onOpen?: (code: TaxFormCode) => void }) {
  return (
    <ul className="tax-page-forms">
      {TAX_FORM_GALLERY.map((form) => {
        const ready = form.status === "ready" && onOpen != null;
        const body = (
          <>
            <span className="tax-page-form-code">{form.label}</span>
            <span className="tax-page-form-name">{form.name}</span>
            <span className="tax-page-form-when">{form.frequency}</span>
            {form.note ? <span className="tax-page-form-when">{form.note}</span> : null}
            <span className={`tax-page-form-status is-${form.status}`}>
              {TAX_FORM_STATUS_LABEL[form.status]}
            </span>
          </>
        );
        return (
          <li key={form.code} data-tax-form={form.code} data-tax-form-status={form.status}>
            {ready ? (
              <button
                type="button"
                className="tax-page-form is-open"
                onClick={() => onOpen?.(form.code)}
              >
                {body}
              </button>
            ) : (
              <div className="tax-page-form">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ZaTaxSpecialistPage({
  activity = [],
  onOpenForm,
}: {
  activity?: TaxPageActivity[];
  onOpenForm?: (code: TaxFormCode) => void;
}) {
  const recent = [...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_CAP);
  return (
    <div className="tax-page" data-tax-page="true">
      <AgentSection section="forms" data-tax-section="forms">
        <FormGallery onOpen={onOpenForm} />
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
