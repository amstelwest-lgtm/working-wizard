/**
 * Practice Tax Specialist home: the client book plus the same agent page sections
 * as a single client file. Loaded only for a ZA firm through practice-agent-thread.
 */
import { Link } from "@tanstack/react-router";
import { AgentSection } from "@/components/milon-team/agent-section";
import { accountantClientRouteSearch } from "@/lib/client-route-search";
import {
  TAX_FORM_GALLERY,
  TAX_FORM_STATUS_LABEL,
  portfolioReadyForms,
} from "@/lib/tax-specialist/forms/gallery";
import {
  TaxSpecialistPage,
  type TaxPageClient,
} from "@/components/tax-specialist/tax-specialist-slot";
import type { PracticeTaxPageClient } from "@/lib/tax-specialist/practice-tax-client";
import "./za-tax-specialist-page.css";
import "./za-tax-practice-page.css";

const READY_FORMS = portfolioReadyForms(TAX_FORM_GALLERY);

function readyFormsSummary(): string {
  if (READY_FORMS.length === 0) return "No forms are ready to prepare yet.";
  const names = READY_FORMS.map((form) => form.label).join(", ");
  return `${READY_FORMS.length} ready to prepare — ${names}.`;
}

export function ZaTaxPracticePage({
  clients,
  selectedClientId,
  onSelectClient,
  marketCountry,
  audience = "accountant",
}: {
  clients: readonly PracticeTaxPageClient[];
  selectedClientId: string;
  onSelectClient: (clientId: string) => void;
  marketCountry: string | null;
  audience?: "owner" | "accountant";
}) {
  const selected =
    clients.find((row) => row.id === selectedClientId) ?? (clients[0] ?? null);
  const summary = readyFormsSummary();

  return (
    <div className="tax-practice" data-tax-practice="true">
      <AgentSection section="portfolio" data-tax-section="portfolio">
        {clients.length === 0 ? (
          <p className="agent-section-empty" role="status">
            No South African clients on the book yet. Add a ZA client to prepare SARS forms here.
          </p>
        ) : (
          <>
            <p className="tax-practice-summary" data-tax-form-summary="">
              {summary}
            </p>
            <ul className="tax-practice-clients">
              {clients.map((row) => {
                const picked = row.id === (selected?.id ?? "");
                return (
                  <li key={row.id} data-tax-practice-client={row.id}>
                    <button
                      type="button"
                      className={picked ? "tax-practice-pick is-on" : "tax-practice-pick"}
                      aria-pressed={picked}
                      onClick={() => onSelectClient(row.id)}
                    >
                      <span className="tax-practice-name">{row.name}</span>
                      <span className="tax-practice-ready">
                        {READY_FORMS.map((form) => (
                          <span
                            key={form.galleryId}
                            className="tax-practice-form-tag"
                            data-tax-form-code={form.code}
                          >
                            {form.label} · {TAX_FORM_STATUS_LABEL.ready}
                          </span>
                        ))}
                      </span>
                    </button>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: row.id }}
                      search={accountantClientRouteSearch({ tab: "home", agent: "tax_specialist" })}
                      className="tax-practice-open"
                      data-tax-practice-open=""
                    >
                      Open on client file
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </AgentSection>
      {selected ? (
        <TaxSpecialistPage
          country={marketCountry}
          client={selected as TaxPageClient}
          audience={audience}
        />
      ) : clients.length > 0 ? (
        <p className="agent-section-empty" role="status">
          Pick a client above to prepare forms.
        </p>
      ) : null}
    </div>
  );
}
