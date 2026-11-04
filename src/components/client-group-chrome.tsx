import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ClientGroupPanel } from "@/components/client-group-panel";
import { companyCountBanner, groupChromeVisible } from "@/lib/client-groups";
import { loadClientGroupNav, loadRailGroups, type GroupNav } from "@/lib/client-group-client";

function CountChip({ count }: { count: number }) {
  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-200">
      {count}
    </span>
  );
}

export function GroupStatusDialog({
  groupId,
  onClose,
  onOpenCompany,
}: {
  groupId: string;
  onClose: () => void;
  onOpenCompany?: (clientId: string) => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#102A43]/45 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Group status"
        className="mt-8 w-full max-w-3xl rounded-2xl border border-[#DBEAFE] bg-white p-5 shadow-[0_24px_60px_rgba(16,42,67,0.18)] dark:border-slate-700 dark:bg-[#0f172a]"
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-[#EEF4FF] pb-3 dark:border-white/10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#486581] dark:text-slate-400">
              Group status
            </p>
            <p className="mt-1 text-sm text-[#486581] dark:text-slate-400">
              Connection, sync, and access — plus an optional combined figures preview.
            </p>
          </div>
          <button type="button" className="btn ghost mini shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <ClientGroupPanel
          groupId={groupId}
          onOpenCompany={(clientId) => {
            onOpenCompany?.(clientId);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

/** Firm or owner rail. Hidden when every group the person can see has one company. */
export function CompanyGroupRail({
  clientIds,
  activeClientId,
  linkCompanies,
  onOpenCompany,
}: {
  /** Limit the read to these companies. Omit to use every company this login can see. */
  clientIds?: readonly string[];
  activeClientId?: string | null;
  /** Accountant links. Owner passes a switch callback instead. */
  linkCompanies: boolean;
  onOpenCompany?: (clientId: string) => void;
}) {
  const [groups, setGroups] = useState<GroupNav[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const scope = clientIds?.join(",") ?? "*";

  useEffect(() => {
    if (clientIds && clientIds.length < 2) {
      setGroups([]);
      return;
    }
    let cancel = false;
    void loadRailGroups(clientIds).then((next) => {
      if (!cancel) setGroups(next);
    });
    return () => {
      cancel = true;
    };
    // scope is the stable identity of clientIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  if (groups.length === 0) return null;

  return (
    <div className="nav-heading is-open" data-company-groups="">
      <span className="rail-kicker">Groups</span>
      {groups.map((group) => {
        const open = openId === group.id;
        return (
          <div key={group.id}>
            <button
              type="button"
              className="nav-sub-link flex w-full items-center justify-between"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : group.id)}
            >
              <span>{group.name}</span>
              <CountChip count={group.companies.length} />
            </button>
            {open ? (
              <ul className="nav-sub">
                {group.companies.map((company) => (
                  <li key={company.id}>
                    {linkCompanies ? (
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: company.id }}
                        className="nav-sub-link"
                        aria-current={company.id === activeClientId ? "page" : undefined}
                      >
                        {company.name}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="nav-sub-link"
                        aria-current={company.id === activeClientId ? "true" : undefined}
                        onClick={() => onOpenCompany?.(company.id)}
                      >
                        {company.name}
                      </button>
                    )}
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="nav-sub-link"
                    onClick={() => setStatusId(group.id)}
                  >
                    Status
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
        );
      })}
      {statusId ? (
        <GroupStatusDialog
          groupId={statusId}
          onClose={() => setStatusId(null)}
          onOpenCompany={onOpenCompany}
        />
      ) : null}
    </div>
  );
}

/** Switcher and plan banner for multi-company groups; Group status for groups of one too. */
export function ClientGroupChrome({
  clientId,
  linkCompanies,
  onOpenCompany,
}: {
  clientId: string | null;
  linkCompanies: boolean;
  onOpenCompany?: (clientId: string) => void;
}) {
  const [group, setGroup] = useState<GroupNav | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setGroup(null);
      return;
    }
    let cancel = false;
    void loadClientGroupNav(clientId).then((next) => {
      if (!cancel) setGroup(next);
    });
    return () => {
      cancel = true;
    };
  }, [clientId]);

  const navigate = useNavigate();
  if (!group) return null;
  const multi = groupChromeVisible(group.companies.length);
  const banner = companyCountBanner(group.billable);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-company-switcher="">
      {multi ? (
        <label className="text-xs text-slate-500">
          Company
          {linkCompanies ? (
            <select
              className="ml-2 rounded border bg-transparent px-2 py-1 text-sm text-inherit"
              value={clientId ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                if (next && next !== clientId) {
                  void navigate({ to: "/clients/$clientId", params: { clientId: next } });
                }
              }}
            >
              {group.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="ml-2 rounded border bg-transparent px-2 py-1 text-sm text-inherit"
              value={clientId ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                if (next && next !== clientId) onOpenCompany?.(next);
              }}
            >
              {group.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          )}
        </label>
      ) : null}
      {multi ? <CountChip count={group.companies.length} /> : null}
      <button type="button" className="btn ghost mini" onClick={() => setStatusId(group.id)}>
        Group status
      </button>
      {banner ? (
        <p
          className="basis-full text-xs text-amber-800 dark:text-amber-200"
          data-company-count-banner=""
          role="status"
        >
          {banner}
        </p>
      ) : null}
      {statusId ? (
        <GroupStatusDialog
          groupId={statusId}
          onClose={() => setStatusId(null)}
          onOpenCompany={onOpenCompany}
        />
      ) : null}
    </div>
  );
}
