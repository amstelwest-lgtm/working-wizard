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
  type TaxFormEntry,
} from "@/lib/tax-specialist/forms/gallery";
import {
  IRP6_PERIODS,
  irp6DefaultPick,
  irp6PeriodDates,
  irp6PeriodLabel,
  irp6YearEnd,
  zaToday,
  type Irp6Period,
} from "@/lib/tax-specialist/forms/irp6";
import {
  TAX_FORM_DRAFT_STATUS_LABEL,
  applySavedDraft,
  draftActivity,
  findIrp6Draft,
  loadTaxFormDrafts,
  type TaxFormDraft,
} from "@/lib/tax-specialist/forms/drafts";
import { loadItr12Open } from "@/lib/tax-specialist/forms/itr12-load";
import type { Itr12Inputs } from "@/lib/tax-specialist/forms/itr12";
import { loadIrp6IndividualOpen } from "@/lib/tax-specialist/forms/irp6-individual-load";
import type { Irp6IndividualInputs } from "@/lib/tax-specialist/forms/irp6-individual";
import { ZaIrp6IndividualSheet } from "./za-irp6-individual-sheet";
import { ZaIrp6Sheet, type Irp6SheetClient } from "./za-irp6-sheet";
import { ZaItr12Sheet } from "./za-itr12-sheet";
import { ZaItr14Sheet } from "./za-itr14-sheet";
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

function FormGallery({ onOpen }: { onOpen?: (form: TaxFormEntry) => void }) {
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
          <li
            key={form.galleryId}
            data-tax-form={form.galleryId}
            data-tax-form-code={form.code}
            data-tax-form-entity={form.entity}
            data-tax-form-status={form.status}
          >
            {ready ? (
              <button
                type="button"
                className="tax-page-form is-open"
                onClick={() => onOpen?.(form)}
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
  audience = "accountant",
}: {
  activity?: TaxPageActivity[];
  onOpenForm?: (code: TaxFormCode) => void;
  /** The client the forms are prepared for. Without one, only the sample shows. */
  client?: Irp6SheetClient | null;
  /** YYYY-MM-DD in South Africa. Defaults to the clock. */
  today?: string;
  /** Owners can read a sheet. They cannot approve a section. */
  audience?: "owner" | "accountant";
}) {
  const day = today ?? zaToday();
  const clientId = client?.id ?? null;
  const [drafts, setDrafts] = useState<TaxFormDraft[] | null>(clientId ? null : []);
  const [open, setOpen] = useState<TaxFormCode | null>(null);
  const [itr12, setItr12] = useState<{ year: number; seed: Itr12Inputs | null } | null>(null);
  const [individual, setIndividual] = useState<{
    year: number;
    period: Irp6Period;
    seed: Irp6IndividualInputs | null;
  } | null>(null);

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
    setDrafts((prev) => applySavedDraft(prev ?? [], row));
  }, []);

  const openForm = (form: TaxFormEntry) => {
    if (form.galleryId === "IRP6-individual" && client && drafts) {
      void loadIrp6IndividualOpen(client.id, drafts, day).then((next) => {
        setIndividual(next);
        setItr12(null);
        setOpen(null);
        document.querySelector("[data-tax-page]")?.scrollIntoView({ block: "start" });
      });
    } else if (form.code === "IRP6" && client) {
      setIndividual(null);
      setOpen("IRP6");
      document.querySelector("[data-tax-page]")?.scrollIntoView({ block: "start" });
    }
    if (form.code === "ITR12" && client && drafts) {
      void loadItr12Open(client.id, drafts, day).then((next) => {
        setIndividual(null);
        setItr12(next);
        setOpen("ITR12");
        document.querySelector("[data-tax-page]")?.scrollIntoView({ block: "start" });
      });
    }
    if (form.code === "ITR14" && client) {
      setIndividual(null);
      setItr12(null);
      setOpen("ITR14");
      document.querySelector("[data-tax-page]")?.scrollIntoView({ block: "start" });
    }
    onOpenForm?.(form.code);
  };

  const recent = useMemo(
    () =>
      [...activity, ...draftActivity(drafts ?? [])]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, ACTIVITY_CAP),
    [activity, drafts],
  );

  if (individual && client && drafts) {
    return (
      <div className="tax-page" data-tax-page="true" data-tax-open-form="IRP6-individual">
        <ZaIrp6IndividualSheet
          key={`${individual.year}-${individual.period}`}
          client={client}
          today={day}
          drafts={drafts}
          initialYear={individual.year}
          initialPeriod={individual.period}
          seed={individual.seed}
          approverRole={audience === "owner" ? "owner" : "accountant"}
          backLabel="All SARS forms"
          onSaved={onSaved}
          onBack={() => setIndividual(null)}
        />
      </div>
    );
  }

  if (open === "ITR12" && client && itr12 && drafts) {
    return (
      <div className="tax-page" data-tax-page="true" data-tax-open-form="ITR12">
        <ZaItr12Sheet
          key={itr12.year}
          client={{ id: client.id, name: client.name }}
          today={day}
          drafts={drafts}
          initialYear={itr12.year}
          seed={itr12.seed}
          approverRole={audience === "owner" ? "owner" : "accountant"}
          backLabel="All SARS forms"
          onSaved={onSaved}
          onBack={() => setOpen(null)}
        />
      </div>
    );
  }

  if (open === "ITR14" && client) {
    return (
      <div className="tax-page" data-tax-page="true" data-tax-open-form="ITR14">
        {drafts ? (
          <ZaItr14Sheet
            client={client}
            today={day}
            drafts={drafts}
            approverRole={audience === "owner" ? "owner" : "accountant"}
            backLabel="All SARS forms"
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
