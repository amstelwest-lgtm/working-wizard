import { useEffect, useState } from "react";
import {
  ENTITY_TYPES,
  accessConfirmLines,
  billableCompanyCount,
  companyCountBanner,
  connectionHealth,
  countsTowardCompanySlot,
  entityLabel,
  membershipsAfterMove,
  openWorkLabel,
  yearEndLabel,
  type EntityType,
} from "@/lib/client-groups";
import {
  callGroupRpc,
  companiesToNav,
  loadCompanies,
  loadGroupAudit,
  loadGroupMembers,
  loadGroupNames,
  loadOwnershipEdges,
  loadSyncRows,
  type GroupAuditRow,
  type GroupCompany,
  type OwnershipEdgeRow,
} from "@/lib/client-group-client";

type StatusRow = {
  company: GroupCompany;
  health: string;
  lastSync: string;
  counts: boolean;
};

function formatWhen(value: string | null): string {
  if (!value) return "Never";
  const day = value.slice(0, 10);
  return day || "Never";
}

/**
 * Status-only group view. Connection, last sync, year-end, and open work.
 * No money, no totals, no KPIs.
 */
export function ClientGroupPanel({
  groupId,
  onOpenCompany,
}: {
  groupId: string;
  onOpenCompany?: (clientId: string) => void;
}) {
  const [companies, setCompanies] = useState<GroupCompany[]>([]);
  const [groupName, setGroupName] = useState("Group");
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [edges, setEdges] = useState<OwnershipEdgeRow[]>([]);
  const [audit, setAudit] = useState<GroupAuditRow[]>([]);
  const [members, setMembers] = useState<{ userId: string }[]>([]);
  const [destinations, setDestinations] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const loaded = await loadCompanies();
    const inGroup = (loaded ?? []).filter((company) => company.groupId === groupId);
    setCompanies(inGroup);
    const names = await loadGroupNames([groupId]);
    setGroupName(names.get(groupId) ?? inGroup[0]?.name ?? "Group");
    const sync = await loadSyncRows(inGroup.map((company) => company.id));
    setRows(
      inGroup.map((company) => {
        const health = connectionHealth(sync.get(company.id) ?? []);
        const connected = (sync.get(company.id) ?? []).length > 0;
        return {
          company,
          health: health.label,
          lastSync: formatWhen(health.lastSync),
          counts: countsTowardCompanySlot({ ...company, connected }),
        };
      }),
    );
    setEdges(await loadOwnershipEdges(groupId));
    setAudit(await loadGroupAudit(groupId));
    setMembers(await loadGroupMembers(groupId));
    const allNames = await loadGroupNames([
      ...new Set((loaded ?? []).map((company) => company.groupId)),
    ]);
    setDestinations(
      companiesToNav(loaded ?? [], allNames, { includeSingles: true })
        .filter((group) => group.id !== groupId)
        .map((group) => ({ id: group.id, name: group.name })),
    );
    setSelected((current) => current ?? inGroup[0]?.id ?? null);
  }

  useEffect(() => {
    let cancel = false;
    void reload().catch(() => {
      if (!cancel) setMessage("Group status could not be loaded.");
    });
    return () => {
      cancel = true;
    };
    // reload closes over groupId only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const banner = companyCountBanner(rows.filter((row) => row.counts).length);
  const active = companies.find((company) => company.id === selected) ?? null;
  const names = new Map(companies.map((company) => [company.id, company.name]));

  async function runConfirmed(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    const result = await callGroupRpc(fn, args);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage(ok);
    await reload();
  }

  return (
    <div className="space-y-5 text-[#102A43] dark:text-slate-100" data-group-panel={groupId}>
      <header className="border-b border-[#EEF4FF] pb-4 dark:border-white/10">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#486581] dark:text-slate-400">
          Group
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#102A43] dark:text-slate-50">
          {groupName}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#486581] dark:text-slate-400">
          Status only. Figures stay on each company. This page does not add them up.
        </p>
      </header>

      {banner ? (
        <p
          className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          data-company-count-banner=""
          role="status"
        >
          {banner}
        </p>
      ) : null}

      {message ? (
        <p
          className="rounded-xl border border-[#DBEAFE] bg-[#F4F8FF] px-4 py-3 text-sm text-[#102A43] dark:border-slate-600 dark:bg-slate-800"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[#DBEAFE] dark:border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="bg-[#F4F8FF] text-[11px] uppercase tracking-[0.12em] text-[#486581] dark:bg-slate-900 dark:text-slate-400">
              <th className="px-3 py-2.5 font-bold">Company</th>
              <th className="px-3 py-2.5 font-bold">Type</th>
              <th className="px-3 py-2.5 font-bold">Connection</th>
              <th className="px-3 py-2.5 font-bold">Last sync</th>
              <th className="px-3 py-2.5 font-bold">Year-end</th>
              <th className="px-3 py-2.5 font-bold">Open work</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.company.id}
                className="border-t border-[#EEF4FF] dark:border-white/10"
              >
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    className="font-semibold text-[#0B5FFF] underline-offset-2 hover:underline"
                    onClick={() => {
                      setSelected(row.company.id);
                      onOpenCompany?.(row.company.id);
                    }}
                  >
                    {row.company.name}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-[#486581] dark:text-slate-300">
                  {entityLabel(row.company.entityType)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex rounded-full bg-[#EEF4FF] px-2.5 py-0.5 text-xs font-semibold text-[#102A43] dark:bg-white/10 dark:text-slate-100">
                    {row.health}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-[#486581] dark:text-slate-300">
                  {row.lastSync}
                </td>
                <td className="px-3 py-2.5 text-[#486581] dark:text-slate-300">
                  {yearEndLabel(row.company.yearEndMonth)}
                </td>
                <td className="px-3 py-2.5">{openWorkLabel(row.company.openQueries)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active ? (
        <EntityForm
          company={active}
          busy={busy}
          onSave={(args) =>
            void runConfirmed("update_company_entity", args, "Entity details saved.")
          }
        />
      ) : null}

      <section className="space-y-2 rounded-xl border border-[#DBEAFE] p-4 dark:border-white/10">
        <h3 className="text-sm font-bold text-[#102A43] dark:text-slate-50">Ownership</h3>
        <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
          Who holds whom. Stored for later reporting. Not consolidated.
        </p>
        {edges.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No ownership recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {edges.map((edge) => (
              <li key={edge.id} className="flex items-center justify-between gap-2">
                <span>
                  {names.get(edge.holderClientId) ?? "Holder"} holds{" "}
                  {names.get(edge.heldClientId) ?? "company"}
                  {edge.ownershipPct != null ? ` · ${edge.ownershipPct}%` : ""} ·{" "}
                  {edge.classification}
                  {edge.effectiveFrom ? ` · from ${edge.effectiveFrom}` : ""}
                  {edge.effectiveTo ? ` to ${edge.effectiveTo}` : ""}
                </span>
                <button
                  type="button"
                  className="btn ghost mini"
                  disabled={busy}
                  onClick={() =>
                    void runConfirmed(
                      "delete_ownership_edge",
                      { p_edge_id: edge.id },
                      "Ownership removed.",
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <EdgeForm
          companies={companies}
          busy={busy}
          onSave={(args) => void runConfirmed("upsert_ownership_edge", args, "Ownership saved.")}
        />
      </section>

      <GroupActions
        groupId={groupId}
        companies={companies}
        members={members}
        destinations={destinations}
        busy={busy}
        onRun={runConfirmed}
      />

      {audit.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Access log</h3>
          <ul className="mt-1 space-y-1 text-xs text-slate-500">
            {audit.map((row) => (
              <li key={row.id}>
                {row.action.replace(/_/g, " ")}
                {row.createdAt ? ` · ${formatWhen(row.createdAt)}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EntityForm({
  company,
  busy,
  onSave,
}: {
  company: GroupCompany;
  busy: boolean;
  onSave: (args: Record<string, unknown>) => void;
}) {
  const [entityType, setEntityType] = useState<EntityType>(company.entityType);
  const [yearEnd, setYearEnd] = useState(company.yearEndMonth ? String(company.yearEndMonth) : "");
  const [currency, setCurrency] = useState(company.currency ?? "");
  const [registration, setRegistration] = useState(company.registrationNumber ?? "");
  const [tax, setTax] = useState(company.taxNumber ?? "");
  const [vat, setVat] = useState(company.vatNumber ?? "");
  const [person, setPerson] = useState(company.personUserId ?? "");

  useEffect(() => {
    setEntityType(company.entityType);
    setYearEnd(company.yearEndMonth ? String(company.yearEndMonth) : "");
    setCurrency(company.currency ?? "");
    setRegistration(company.registrationNumber ?? "");
    setTax(company.taxNumber ?? "");
    setVat(company.vatNumber ?? "");
    setPerson(company.personUserId ?? "");
  }, [company]);

  return (
    <form
      className="grid gap-3 rounded-xl border border-[#DBEAFE] bg-[#F8FBFF] p-4 dark:border-white/10 dark:bg-slate-900/40"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          p_company_id: company.id,
          p_entity_type: entityType,
          p_year_end_month: yearEnd ? Number(yearEnd) : null,
          p_currency: currency,
          p_registration_number: registration,
          p_tax_number: tax,
          p_vat_number: vat,
          p_person_user_id: person.trim() || null,
        });
      }}
    >
      <h3 className="text-sm font-semibold">Entity details · {company.name}</h3>
      <label className="text-xs">
        Type
        <select
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={entityType}
          onChange={(event) => setEntityType(event.target.value as EntityType)}
        >
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {entityLabel(type)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Year-end month
        <select
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={yearEnd}
          onChange={(event) => setYearEnd(event.target.value)}
        >
          <option value="">Not set</option>
          {Array.from({ length: 12 }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {yearEndLabel(index + 1)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Currency
        <input
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={currency}
          maxLength={8}
          onChange={(event) => setCurrency(event.target.value)}
        />
      </label>
      <label className="text-xs">
        Registration number
        <input
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={registration}
          onChange={(event) => setRegistration(event.target.value)}
        />
      </label>
      <label className="text-xs">
        Tax number
        <input
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={tax}
          onChange={(event) => setTax(event.target.value)}
        />
      </label>
      <label className="text-xs">
        VAT number
        <input
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={vat}
          onChange={(event) => setVat(event.target.value)}
        />
      </label>
      {entityType === "individual" ? (
        <label className="text-xs">
          Person (user id)
          <input
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            required
          />
        </label>
      ) : null}
      <button type="submit" className="btn gold mini justify-self-start" disabled={busy}>
        Save entity
      </button>
    </form>
  );
}

function EdgeForm({
  companies,
  busy,
  onSave,
}: {
  companies: GroupCompany[];
  busy: boolean;
  onSave: (args: Record<string, unknown>) => void;
}) {
  const [holder, setHolder] = useState(companies[0]?.id ?? "");
  const [held, setHeld] = useState(companies[1]?.id ?? companies[0]?.id ?? "");
  const [pct, setPct] = useState("");
  const [classification, setClassification] = useState("subsidiary");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    setHolder(companies[0]?.id ?? "");
    setHeld(companies[1]?.id ?? companies[0]?.id ?? "");
  }, [companies]);

  if (companies.length < 2) return null;

  return (
    <form
      className="mt-2 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const groupId = companies[0]?.groupId;
        if (!groupId) return;
        onSave({
          p_group_id: groupId,
          p_holder_client_id: holder,
          p_held_client_id: held,
          p_ownership_pct: pct.trim() ? Number(pct) : null,
          p_effective_from: from || null,
          p_effective_to: to || null,
          p_classification: classification,
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Holder
          <select
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Held
          <select
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={held}
            onChange={(e) => setHeld(e.target.value)}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs">
          Percent
          <input
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Class
          <select
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          >
            <option value="subsidiary">subsidiary</option>
            <option value="associate">associate</option>
            <option value="joint_venture">joint venture</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="text-xs">
          From
          <input
            type="date"
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs">
          To
          <input
            type="date"
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="btn ghost mini justify-self-start" disabled={busy}>
        Add ownership
      </button>
    </form>
  );
}

function GroupActions({
  groupId,
  companies,
  members,
  destinations,
  busy,
  onRun,
}: {
  groupId: string;
  companies: GroupCompany[];
  members: { userId: string }[];
  destinations: { id: string; name: string }[];
  busy: boolean;
  onRun: (fn: string, args: Record<string, unknown>, ok: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [person, setPerson] = useState("");
  const [moveCompany, setMoveCompany] = useState(companies[0]?.id ?? "");
  const [moveGroup, setMoveGroup] = useState(destinations[0]?.id ?? "");
  const [splitCompany, setSplitCompany] = useState(companies[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<{ gains: string[]; losses: string[] } | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [pendingFn, setPendingFn] = useState<string | null>(null);

  useEffect(() => {
    setMoveCompany(companies[0]?.id ?? "");
    setSplitCompany(companies[0]?.id ?? "");
  }, [companies]);
  useEffect(() => {
    setMoveGroup(destinations[0]?.id ?? "");
  }, [destinations]);

  function stage(
    fn: string,
    args: Record<string, unknown>,
    lines: { gains: string[]; losses: string[] },
  ) {
    setPendingFn(fn);
    setPending(args);
    setPreview(lines);
    setConfirmed(false);
  }

  function dismissAccessConfirm() {
    setPreview(null);
    setPending(null);
    setPendingFn(null);
    setConfirmed(false);
  }

  const owners = members.map((member) => member.userId);

  return (
    <section className="space-y-4 rounded-xl border border-[#EEF4FF] p-4 dark:border-white/10">
      <h3 className="text-sm font-bold text-[#102A43] dark:text-slate-50">Companies</h3>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const plan = membershipsAfterMove({
            fromOwnerIds: [],
            toOwnerIds: owners,
            personUserId: person.trim() || null,
            entityType,
          });
          stage(
            "add_company_to_group",
            {
              p_group_id: groupId,
              p_name: name,
              p_entity_type: entityType,
              p_person_user_id: person.trim() || null,
              p_confirm: true,
            },
            accessConfirmLines({
              companyName: name,
              gains: plan.grant.map((userId) => ({ userId })),
              losses: [],
              firmKeepsAccess: true,
            }),
          );
        }}
      >
        <p className="text-xs text-slate-500">
          Add a company to this group. It stays a placeholder until books or an upload.
        </p>
        <input
          className="rounded border px-2 py-1 text-sm"
          placeholder="Company name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <select
          className="rounded border px-2 py-1 text-sm"
          value={entityType}
          onChange={(event) => setEntityType(event.target.value as EntityType)}
        >
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {entityLabel(type)}
            </option>
          ))}
        </select>
        {entityType === "individual" ? (
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="Person user id"
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            required
          />
        ) : null}
        <button type="submit" className="btn ghost mini justify-self-start" disabled={busy}>
          Review add
        </button>
      </form>

      {destinations.length > 0 ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const company = companies.find((row) => row.id === moveCompany);
            const plan = membershipsAfterMove({
              fromOwnerIds: owners,
              toOwnerIds: [],
              personUserId: company?.personUserId ?? null,
              entityType: company?.entityType ?? "company",
            });
            stage(
              "move_company_to_group",
              { p_company_id: moveCompany, p_group_id: moveGroup, p_confirm: true },
              accessConfirmLines({
                companyName: company?.name ?? "Company",
                gains: [{ userId: "destination", label: "Destination group owners" }],
                losses: plan.revoke.map((userId) => ({ userId })),
                firmKeepsAccess: true,
              }),
            );
          }}
        >
          <p className="text-xs text-slate-500">
            Move a company into another group. A company stays in one group.
          </p>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={moveCompany}
            onChange={(e) => setMoveCompany(e.target.value)}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={moveGroup}
            onChange={(e) => setMoveGroup(e.target.value)}
          >
            {destinations.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn ghost mini justify-self-start"
            disabled={busy || !moveGroup}
          >
            Review move
          </button>
        </form>
      ) : null}

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const company = companies.find((row) => row.id === splitCompany);
          const plan = membershipsAfterMove({
            fromOwnerIds: owners,
            toOwnerIds: [],
            personUserId: company?.personUserId ?? null,
            entityType: company?.entityType ?? "company",
          });
          stage(
            "split_company_from_group",
            { p_company_id: splitCompany, p_confirm: true },
            accessConfirmLines({
              companyName: company?.name ?? "Company",
              gains: [],
              losses: plan.revoke.map((userId) => ({ userId })),
              firmKeepsAccess: true,
            }),
          );
        }}
      >
        <p className="text-xs text-slate-500">
          Split a company into its own group. The previous owner login loses it.
        </p>
        <select
          className="rounded border px-2 py-1 text-sm"
          value={splitCompany}
          onChange={(e) => setSplitCompany(e.target.value)}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="btn ghost mini justify-self-start"
          disabled={busy || !splitCompany}
        >
          Review split
        </button>
      </form>

      {preview && pending && pendingFn ? (
        <div
          className="rounded-xl border border-[#DBEAFE] bg-white p-4 text-sm shadow-sm dark:border-white/15 dark:bg-slate-900/50"
          data-access-confirm=""
        >
          <p className="font-bold text-[#102A43] dark:text-slate-50">Who this changes</p>
          <ul className="mt-1 list-disc pl-4">
            {preview.gains.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {preview.losses.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I confirm this access change
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn gold mini"
              disabled={!confirmed || busy}
              onClick={() => {
                const fn = pendingFn;
                const args = pending;
                dismissAccessConfirm();
                void onRun(fn, args, "Group updated.");
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="btn ghost mini"
              disabled={busy}
              onClick={dismissAccessConfirm}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <p className="text-[11px] text-slate-400">
        Plan count {billableCompanyCount(companies)} of companies that count. Individuals are
        excluded.
      </p>
    </section>
  );
}
