/**
 * Tax Specialist agent page sections. Loaded only after a ZA market check,
 * through TaxSpecialistPage in tax-specialist-slot.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  IRP6_PERIODS,
  irp6DefaultPick,
  irp6PeriodDates,
  irp6PeriodLabel,
  irp6YearEnd,
  zaToday,
} from "@/lib/tax-specialist/forms/irp6";
import {
  TAX_FORM_DRAFT_STATUS_LABEL,
  draftActivity,
  findIrp6Draft,
  loadTaxFormDrafts,
  type TaxFormDraft,
} from "@/lib/tax-specialist/forms/drafts";
import { ZaIrp6Sheet, type Irp6SheetClient } from "./za-irp6-sheet";
import "./za-tax-specialist-sample.css";
import "./za-tax-specialist-page.css";

export type TaxPageActivity = { id: string; text: string; at: string };

function ClientDeadlines({
  client,
  today,
  drafts,
}: {
  client: Irp6SheetClient;
  today: string;
  drafts: TaxFormDraft[];
}) {
  const year = irp6DefaultPick(today, client.fyStartMonth).yearOfAssessment;
  const yearEnd = irp6YearEnd(year, client.fyStartMonth);
  return (
    <div className="tax-sample-table">
      <table data-tax-deadlines="client">
        <caption className="tax-sample-kicker">IRP6, year of assessment {year}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Due</th>
            <th scope="col">Draft</th>
          </tr>
        </thead>
        <tbody>
          {IRP6_PERIODS.map((period) => {
            const due = irp6PeriodDates(yearEnd, period).due;
            const draft = findIrp6Draft(drafts, year, period);
            return (
              <tr key={period} data-tax-deadline={`irp6-${period}`}>
                <td>{irp6PeriodLabel(period)}</td>
                <td className={due < today ? "is-wait" : undefined}>
                  {formatSampleDate(due)}
                  {due < today ? ", passed" : ""}
                </td>
                <td data-tax-deadline-status={draft?.status ?? "none"}>
                  {draft ? TAX_FORM_DRAFT_STATUS_LABEL[draft.status] : "Not started"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
  client = null,
  today,
}: {
  activity?: TaxPageActivity[];
  onOpenForm?: (code: TaxFormCode) => void;
  /** The client the forms are prepared for. Without one, only the sample shows. */
  client?: Irp6SheetClient | null;
  /** YYYY-MM-DD in South Africa. Defaults to the clock. */
  today?: string;
}) {
  const day = today ?? zaToday();
  const clientId = client?.id ?? null;
  const [drafts, setDrafts] = useState<TaxFormDraft[] | null>(clientId ? null : []);
  const [open, setOpen] = useState<TaxFormCode | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    void loadTaxFormDrafts(clientId).then((rows) => {
      if (live) setDrafts(rows);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const onSaved = useCallback((row: TaxFormDraft) => {
    setDrafts((prev) => [
      row,
      ...(prev ?? []).filter(
        (r) =>
          r.id !== row.id &&
          !(
            r.form_code === row.form_code &&
            r.tax_year === row.tax_year &&
            r.period === row.period &&
            r.subject === row.subject
          ),
      ),
    ]);
  }, []);

  const openForm = (code: TaxFormCode) => {
    if (code === "IRP6" && client) {
      setOpen(code);
      document.querySelector("[data-tax-page]")?.scrollIntoView({ block: "start" });
    }
    onOpenForm?.(code);
  };

  const recent = useMemo(
    () =>
      [...activity, ...draftActivity(drafts ?? [])]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, ACTIVITY_CAP),
    [activity, drafts],
  );

  if (open === "IRP6" && client) {
    return (
      <div className="tax-page" data-tax-page="true" data-tax-open-form="IRP6">
        {drafts ? (
          <ZaIrp6Sheet
            client={client}
            today={day}
            drafts={drafts}
            onSaved={onSaved}
            onBack={() => setOpen(null)}
          />
        ) : (
          <p className="agent-section-empty" role="status">
            Loading saved drafts…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="tax-page" data-tax-page="true">
      <AgentSection section="forms" data-tax-section="forms">
        <FormGallery onOpen={client || onOpenForm ? openForm : undefined} />
      </AgentSection>
      <Workings />
      <AgentSection section="deadlines" data-tax-section="deadlines">
        {client ? (
          <ClientDeadlines client={client} today={day} drafts={drafts ?? []} />
        ) : (
          <>
            <div className="tax-page-meta">
              <SampleBadge />
              <span>As of {formatSampleDate(SAMPLE_COMPANY.asOf)}</span>
            </div>
            <SampleDeadlines />
          </>
        )}
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
