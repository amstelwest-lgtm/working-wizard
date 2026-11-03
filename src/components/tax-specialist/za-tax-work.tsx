/**
 * Accountant Work → Tax. Lists the client's current form drafts and earlier
 * versions, and the ITR12 tax pack. Loaded only for a ZA client.
 * Opening a return is the review sheet. Nothing is emailed and nothing is filed.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ClientSubpageFrame } from "@/components/client-subpage";
import { EmptyState } from "@/components/primitives/empty-state";
import { TaxPackPanel } from "@/components/tax-pack-panel";
import { supabase } from "@/integrations/supabase/client";
import {
  TAX_FORM_DRAFT_STATUS_LABEL,
  applySavedDraft,
  currentTaxDrafts,
  draftDayLabel,
  loadTaxFormDrafts,
  taxDraftHistory,
  taxDraftTitle,
  type TaxFormDraft,
} from "@/lib/tax-specialist/forms/drafts";
import { loadItr12Open } from "@/lib/tax-specialist/forms/itr12-load";
import type { Itr12Inputs } from "@/lib/tax-specialist/forms/itr12";
import { loadIrp6IndividualOpen } from "@/lib/tax-specialist/forms/irp6-individual-load";
import {
  IRP6_INDIVIDUAL_SUBJECT,
  type Irp6IndividualInputs,
} from "@/lib/tax-specialist/forms/irp6-individual";
import { itr14DefaultYear } from "@/lib/tax-specialist/forms/itr14";
import { irp6DefaultPick, zaToday, type Irp6Period } from "@/lib/tax-specialist/forms/irp6";
import { ZaIrp6Sheet } from "./za-irp6-sheet";
import { ZaIrp6IndividualSheet } from "./za-irp6-individual-sheet";
import { ZaItr12Sheet } from "./za-itr12-sheet";
import { ZaItr14Sheet } from "./za-itr14-sheet";
import "./za-tax-work.css";

type TaxWorkClient = {
  id: string;
  name: string;
  fyStartMonth: number;
  financials: Record<string, unknown> | null;
  financialsAsOf: string | null;
};

type SendQuery = {
  from: (table: string) => {
    select: (columns: string) => SendFilter;
  };
};

type SendFilter = {
  eq: (column: string, value: string) => SendFilter;
  not: (column: string, operator: string, value: null) => SendFilter;
  order: (column: string, options: { ascending: boolean }) => SendFilter;
  limit: (count: number) => Promise<{
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  }>;
};

async function latestCompletedSend(clientId: string): Promise<string | null> {
  const { data, error } = await (supabase as unknown as SendQuery)
    .from("client_agent_sends")
    .select("id")
    .eq("client_id", clientId)
    .eq("agent", "tax-specialist")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const id = data?.[0]?.id;
  return typeof id === "string" ? id : null;
}

function asPeriod(period: number | null): Irp6Period {
  return period === 2 || period === 3 ? period : 1;
}

export function TaxWorkBoard({
  drafts,
  packs,
  onPrepareIrp6,
  onOpenIrp6,
  onPrepareIrp6Individual,
  onOpenIrp6Individual,
  onPrepareItr12,
  onOpenItr12,
  onPrepareItr14,
  onOpenItr14,
  preparingItr12 = false,
  preparingIrp6Individual = false,
}: {
  drafts: readonly TaxFormDraft[];
  packs: ReactNode;
  onPrepareIrp6: () => void;
  onOpenIrp6: (draft: TaxFormDraft) => void;
  onPrepareIrp6Individual: () => void;
  onOpenIrp6Individual: (draft: TaxFormDraft) => void;
  onPrepareItr12: () => void;
  onOpenItr12: (draft: TaxFormDraft) => void;
  onPrepareItr14: () => void;
  onOpenItr14: (draft: TaxFormDraft) => void;
  preparingItr12?: boolean;
  preparingIrp6Individual?: boolean;
}) {
  const current = currentTaxDrafts(drafts).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <div className="tax-work" data-tax-work="drafts">
      <section>
        <div className="tax-work-head">
          <p className="tax-work-kicker">Form drafts</p>
          <div className="tax-work-actions">
            <button
              type="button"
              className="tax-work-prepare"
              data-tax-work-prepare="IRP6"
              onClick={onPrepareIrp6}
            >
              Prepare IRP6
            </button>
            <button
              type="button"
              className="tax-work-prepare"
              data-tax-work-prepare="IRP6-individual"
              disabled={preparingIrp6Individual}
              onClick={onPrepareIrp6Individual}
            >
              {preparingIrp6Individual ? "Preparing individual IRP6…" : "Prepare individual IRP6"}
            </button>
            <button
              type="button"
              className="tax-work-prepare"
              data-tax-work-prepare="ITR14"
              onClick={onPrepareItr14}
            >
              Prepare ITR14
            </button>
            <button
              type="button"
              className="tax-work-prepare"
              data-tax-work-prepare="ITR12"
              disabled={preparingItr12}
              onClick={onPrepareItr12}
            >
              {preparingItr12 ? "Preparing ITR12…" : "Prepare ITR12"}
            </button>
          </div>
        </div>
        {current.length === 0 ? (
          <EmptyState
            id="tax-drafts-empty"
            dashed
            title="No tax form drafts yet"
            description="Prepare a company IRP6, an ITR14, an individual IRP6, or an ITR12 when you are ready. A new save keeps the earlier version."
          />
        ) : (
          <table className="tax-work-table">
            <thead>
              <tr>
                <th scope="col">Return</th>
                <th scope="col">Status</th>
                <th scope="col">Version</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {current.map((row) => {
                const history = taxDraftHistory(drafts, row);
                const who =
                  row.approved_by_name && row.approved_at
                    ? `Approved by ${row.approved_by_name} on ${draftDayLabel(row.approved_at)}`
                    : `Saved ${draftDayLabel(row.updated_at)}`;
                return (
                  <tr key={row.id} data-tax-work-draft={row.id} data-tax-draft-current="true">
                    <td>
                      <span className="tax-work-return">{taxDraftTitle(row)}</span>
                      <span className="tax-work-meta">{who}</span>
                      {history.length > 0 ? (
                        <details className="tax-work-history">
                          <summary>Earlier versions</summary>
                          <ul>
                            {history.map((old) => (
                              <li
                                key={old.id}
                                data-tax-draft-version={old.version}
                                data-tax-draft-readonly="true"
                              >
                                Version {old.version}, {TAX_FORM_DRAFT_STATUS_LABEL[old.status]},{" "}
                                {draftDayLabel(old.created_at)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td>{TAX_FORM_DRAFT_STATUS_LABEL[row.status]}</td>
                    <td data-tax-draft-version={row.version}>{row.version}</td>
                    <td>
                      {row.form_code === "IRP6" && row.subject === IRP6_INDIVIDUAL_SUBJECT ? (
                        <button
                          type="button"
                          className="tax-work-open"
                          data-tax-work-open="IRP6-individual"
                          onClick={() => onOpenIrp6Individual(row)}
                        >
                          Open
                        </button>
                      ) : row.form_code === "IRP6" ? (
                        <button
                          type="button"
                          className="tax-work-open"
                          data-tax-work-open="IRP6"
                          onClick={() => onOpenIrp6(row)}
                        >
                          Open
                        </button>
                      ) : row.form_code === "ITR14" ? (
                        <button
                          type="button"
                          className="tax-work-open"
                          data-tax-work-open="ITR14"
                          onClick={() => onOpenItr14(row)}
                        >
                          Open
                        </button>
                      ) : row.form_code === "ITR12" ? (
                        <button
                          type="button"
                          className="tax-work-open"
                          data-tax-work-open="ITR12"
                          onClick={() => onOpenItr12(row)}
                        >
                          Open
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="tax-work-note">
          The download is a capture sheet for you. It is not a SARS return, and it is not sent to
          the client.
        </p>
      </section>
      <section className="tax-work-packs" data-tax-work-packs="">
        {packs}
      </section>
    </div>
  );
}

export function ZaTaxWork({ client }: { client: TaxWorkClient }) {
  const [drafts, setDrafts] = useState<TaxFormDraft[] | null>(null);
  const [sendId, setSendId] = useState<string | null>(null);
  const [open, setOpen] = useState<{ year: number; period: Irp6Period } | null>(null);
  const [itr12, setItr12] = useState<{ year: number; seed: Itr12Inputs | null } | null>(null);
  const [individual, setIndividual] = useState<{
    year: number;
    period: Irp6Period;
    seed: Irp6IndividualInputs | null;
  } | null>(null);
  const [itr14Year, setItr14Year] = useState<number | null>(null);
  const [preparingItr12, setPreparingItr12] = useState(false);
  const [preparingIndividual, setPreparingIndividual] = useState(false);

  useEffect(() => {
    if (!client.id) return;
    let live = true;
    void loadTaxFormDrafts(client.id).then((rows) => {
      if (live) setDrafts(rows);
    });
    void latestCompletedSend(client.id).then((id) => {
      if (live) setSendId(id);
    });
    return () => {
      live = false;
    };
  }, [client.id]);

  const onSaved = useCallback((row: TaxFormDraft) => {
    setDrafts((prev) => applySavedDraft(prev ?? [], row));
  }, []);

  const prepareItr12 = () => {
    if (!drafts || preparingItr12) return;
    setPreparingItr12(true);
    void loadItr12Open(client.id, drafts, zaToday())
      .then((next) => setItr12(next))
      .finally(() => setPreparingItr12(false));
  };

  const prepareIndividual = () => {
    if (!drafts || preparingIndividual) return;
    setPreparingIndividual(true);
    void loadIrp6IndividualOpen(client.id, drafts, zaToday())
      .then((next) => setIndividual(next))
      .finally(() => setPreparingIndividual(false));
  };

  if (individual && drafts) {
    return (
      <ZaIrp6IndividualSheet
        key={`${individual.year}-${individual.period}`}
        client={client}
        today={zaToday()}
        drafts={drafts}
        initialYear={individual.year}
        initialPeriod={individual.period}
        seed={individual.seed}
        approverRole="accountant"
        backLabel="Tax drafts"
        onSaved={onSaved}
        onBack={() => setIndividual(null)}
      />
    );
  }

  if (itr14Year != null && drafts) {
    return (
      <ZaItr14Sheet
        key={itr14Year}
        client={client}
        today={zaToday()}
        drafts={drafts}
        initialYear={itr14Year}
        approverRole="accountant"
        backLabel="Tax drafts"
        onSaved={onSaved}
        onBack={() => setItr14Year(null)}
      />
    );
  }

  if (itr12 && drafts) {
    return (
      <ZaItr12Sheet
        key={itr12.year}
        client={{ id: client.id, name: client.name }}
        today={zaToday()}
        drafts={drafts}
        initialYear={itr12.year}
        seed={itr12.seed}
        approverRole="accountant"
        backLabel="Tax drafts"
        onSaved={onSaved}
        onBack={() => setItr12(null)}
      />
    );
  }

  if (open && drafts) {
    return (
      <ZaIrp6Sheet
        key={`${open.year}-${open.period}`}
        client={client}
        today={zaToday()}
        drafts={drafts}
        initialYear={open.year}
        initialPeriod={open.period}
        backLabel="Tax drafts"
        onSaved={onSaved}
        onBack={() => setOpen(null)}
      />
    );
  }

  return (
    <ClientSubpageFrame
      id="tax"
      eyebrow="Work"
      title="Tax"
      subtitle="Drafts for you to check. You file on SARS eFiling. Milōn does not log in, and a finished form is not sent to the client."
    >
      {drafts == null ? (
        <p role="status">Loading tax drafts…</p>
      ) : (
        <TaxWorkBoard
          drafts={drafts}
          onPrepareIrp6={() => {
            const pick = irp6DefaultPick(zaToday(), client.fyStartMonth);
            setOpen({ year: pick.yearOfAssessment, period: pick.period });
          }}
          onOpenIrp6={(row) => setOpen({ year: row.tax_year, period: asPeriod(row.period) })}
          onPrepareIrp6Individual={prepareIndividual}
          preparingIrp6Individual={preparingIndividual}
          onOpenIrp6Individual={(row) =>
            setIndividual({ year: row.tax_year, period: asPeriod(row.period), seed: null })
          }
          onPrepareItr12={prepareItr12}
          preparingItr12={preparingItr12}
          onOpenItr12={(row) => setItr12({ year: row.tax_year, seed: null })}
          onPrepareItr14={() => setItr14Year(itr14DefaultYear(zaToday(), client.fyStartMonth))}
          onOpenItr14={(row) => setItr14Year(row.tax_year)}
          packs={<TaxPackPanel clientId={client.id} sendId={sendId} showWhenEmpty />}
        />
      )}
    </ClientSubpageFrame>
  );
}
