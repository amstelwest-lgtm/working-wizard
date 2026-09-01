/**
 * Lighthouse — Access: every profile that can enter Milōn
 * (accountants, firm admins, business owners, client staff, IT).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, Shield, X } from "lucide-react";
import {
  getLighthouseAccessBoard,
  lighthouseSetClientMembership,
  lighthouseSetFirmMembership,
  lighthouseSetUserRole,
  PORTAL_ROLES,
  type LighthouseAccessBoard,
  type LighthouseAccessUser,
  type PortalRole,
} from "@/lib/lighthouse-access.functions";

const ROLE_LABEL: Record<PortalRole, string> = {
  accountant: "Accountant",
  firm_admin: "Firm admin",
  client_owner: "Business owner",
  client_member: "Business staff",
};

type Crowd = "all" | "practice" | "business" | "it" | "none";

function crowdOf(u: LighthouseAccessUser): Crowd[] {
  const out: Crowd[] = [];
  if (u.itMember) out.push("it");
  if (u.roles.includes("accountant") || u.roles.includes("firm_admin") || u.firms.length > 0) {
    out.push("practice");
  }
  if (u.roles.includes("client_owner") || u.roles.includes("client_member") || u.ownedClients.length > 0 || u.clientMemberships.length > 0) {
    out.push("business");
  }
  if (out.length === 0 && u.roles.length === 0) out.push("none");
  return out;
}

export function LighthouseAccessPanel() {
  const load = useServerFn(getLighthouseAccessBoard);
  const setRole = useServerFn(lighthouseSetUserRole);
  const setFirm = useServerFn(lighthouseSetFirmMembership);
  const setClient = useServerFn(lighthouseSetClientMembership);

  const [board, setBoard] = useState<LighthouseAccessBoard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [crowd, setCrowd] = useState<Crowd>("all");
  const [firmUser, setFirmUser] = useState("");
  const [firmId, setFirmId] = useState("");
  const [clientUser, setClientUser] = useState("");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setBoard(await load());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load access");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const users = useMemo(() => {
    if (!board) return [];
    const needle = q.trim().toLowerCase();
    return board.users.filter((u) => {
      if (crowd !== "all" && !crowdOf(u).includes(crowd)) return false;
      if (!needle) return true;
      const hay = [
        u.email,
        u.name,
        ...u.roles,
        ...u.firms.map((f) => f.name),
        ...u.ownedClients.map((c) => c.name),
        ...u.clientMemberships.map((c) => c.clientName),
        u.itMember ? "it lighthouse" : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [board, q, crowd]);

  if (busy && !board) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--ops-ink-dim)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading access…
      </div>
    );
  }
  if (err && !board) {
    return (
      <div className="rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-5 text-sm text-[var(--ops-danger-ink)]">
        {err}
      </div>
    );
  }
  if (!board) return null;

  const toggleRole = async (user: LighthouseAccessUser, role: PortalRole) => {
    const enabled = !user.roles.includes(role);
    setSaving(true);
    try {
      await setRole({ data: { userId: user.id, role, enabled } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-amber)]">
          <Shield className="mr-1 inline h-3.5 w-3.5" />
          Access · {board.users.length} profiles
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-amber)]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      <p className="mb-4 text-[12px] text-[var(--ops-ink-dim)]">
        Every person who can sign in — practice accountants, business owners, and staff on a
        client file. Portal roles control which door they use. Firm and file grants control what
        they see. IT master access is listed here; the roster lives on the IT queries tab.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(
          [
            ["all", "Everyone"],
            ["practice", "Practice"],
            ["business", "Business"],
            ["it", "Milōn IT"],
            ["none", "No roles"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setCrowd(k)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
              crowd === k
                ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-input)] px-3">
        <Search className="h-3.5 w-3.5 text-[var(--ops-ink-dim)]" />
        <input
          className="h-10 w-full bg-transparent text-sm text-[var(--ops-ink)] outline-none"
          placeholder="Search name, email, firm, client, role"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-ink-dim)]">
            Add to a practice firm
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select className="ops-input" value={firmUser} onChange={(e) => setFirmUser(e.target.value)}>
              <option value="">Profile…</option>
              {board.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            <select className="ops-input" value={firmId} onChange={(e) => setFirmId(e.target.value)}>
              <option value="">Firm…</option>
              {board.firms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!firmUser || !firmId || saving}
              onClick={() =>
                void setFirm({ data: { userId: firmUser, firmId, enabled: true } })
                  .then(() => {
                    toast.success("Added to practice firm");
                    setFirmUser("");
                    setFirmId("");
                    return refresh();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not add to firm"))
              }
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-3 text-[11px] font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
            >
              Grant
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-ink-dim)]">
            Add to a business file
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select className="ops-input" value={clientUser} onChange={(e) => setClientUser(e.target.value)}>
              <option value="">Profile…</option>
              {board.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            <select className="ops-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Client…</option>
              {board.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.firmName ? ` · ${c.firmName}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!clientUser || !clientId || saving}
              onClick={() =>
                void setClient({ data: { userId: clientUser, clientId, enabled: true } })
                  .then(() => {
                    toast.success("Added to business file");
                    setClientUser("");
                    setClientId("");
                    return refresh();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not add to client"))
              }
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-3 text-[11px] font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
            >
              Grant
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {users.length === 0 && (
          <p className="text-sm text-[var(--ops-ink-dim)]">No profiles match this filter.</p>
        )}
        {users.map((u) => (
          <article key={u.id} className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--ops-ink)]">
                  {u.name}
                  {u.itMember ? (
                    <span className="ml-2 rounded-full bg-[var(--ops-amber-soft)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ops-amber)]">
                      IT
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-[var(--ops-ink-dim)]">{u.email}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {PORTAL_ROLES.map((role) => {
                  const on = u.roles.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      disabled={saving}
                      onClick={() => void toggleRole(u, role)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        on
                          ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                          : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)]"
                      }`}
                    >
                      {ROLE_LABEL[role]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2 text-[11px] text-[var(--ops-ink-dim)] sm:grid-cols-3">
              <div>
                <div className="mb-1 font-bold uppercase tracking-wider">Practice</div>
                {u.firms.length === 0 && <span>No firm</span>}
                {u.firms.map((f) => (
                  <div key={`${f.id}-${f.membershipId ?? "owner"}`} className="flex items-center gap-1">
                    <span className="text-[var(--ops-ink-soft)]">
                      {f.name} · {f.role}
                    </span>
                    {f.membershipId ? (
                      <button
                        type="button"
                        title="Remove from firm"
                        onClick={() =>
                          void setFirm({ data: { userId: u.id, firmId: f.id, enabled: false } })
                            .then(() => refresh())
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Remove failed"))
                        }
                        className="rounded p-0.5 hover:text-[var(--ops-danger-ink)]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="text-[9px] uppercase">owner</span>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 font-bold uppercase tracking-wider">Owns</div>
                {u.ownedClients.length === 0 && <span>No business file</span>}
                {u.ownedClients.map((c) => (
                  <div key={c.id} className="text-[var(--ops-ink-soft)]">
                    {c.name}
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 font-bold uppercase tracking-wider">Business team</div>
                {u.clientMemberships.length === 0 && <span>No staff files</span>}
                {u.clientMemberships.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <span className="text-[var(--ops-ink-soft)]">
                      {c.clientName} · {c.role}
                    </span>
                    <button
                      type="button"
                      title="Remove from file"
                      onClick={() =>
                        void setClient({ data: { userId: u.id, clientId: c.clientId, enabled: false } })
                          .then(() => refresh())
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Remove failed"))
                      }
                      className="rounded p-0.5 hover:text-[var(--ops-danger-ink)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
