/**
 * Lighthouse — Access: every profile, role, firm, and client assignment.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Shield, Search } from "lucide-react";
import {
  getLighthouseAccessBoard,
  lighthouseGrantClientAccess,
  lighthouseRevokeClientAccess,
  lighthouseSetUserRole,
  type LighthouseAccessBoard,
  type LighthouseAccessUser,
} from "@/lib/lighthouse-access.functions";
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATIONS,
  type PracticeClassification,
} from "@/lib/practice-access";

const ROLE_OPTIONS = ["accountant", "firm_admin", "client_owner", "client_member"] as const;

export function LighthouseAccessPanel() {
  const load = useServerFn(getLighthouseAccessBoard);
  const grant = useServerFn(lighthouseGrantClientAccess);
  const revoke = useServerFn(lighthouseRevokeClientAccess);
  const setRole = useServerFn(lighthouseSetUserRole);

  const [board, setBoard] = useState<LighthouseAccessBoard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [grantUser, setGrantUser] = useState("");
  const [grantClient, setGrantClient] = useState("");
  const [grantClass, setGrantClass] = useState<PracticeClassification>("staff");

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
    if (!needle) return board.users;
    return board.users.filter(
      (u) =>
        u.email.toLowerCase().includes(needle) ||
        u.name.toLowerCase().includes(needle) ||
        u.roles.some((r) => r.includes(needle)),
    );
  }, [board, q]);

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

  const toggleRole = async (user: LighthouseAccessUser, role: (typeof ROLE_OPTIONS)[number]) => {
    const enabled = !user.roles.includes(role);
    try {
      await setRole({ data: { userId: user.id, role, enabled } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update role");
    }
  };

  return (
    <div>
      {board.migrationHint && (
        <div className="mb-4 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
          {board.migrationHint}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-amber)]">
          <Shield className="mr-1 inline h-3.5 w-3.5" />
          Access · {board.users.length} profiles · cap {board.cap} per client
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
        Platform override for accountants and business owners. Day-to-day grants still go through
        practice Settings → Team & access (dual email approval). This tab can activate or revoke
        immediately.
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-input)] px-3">
        <Search className="h-3.5 w-3.5 text-[var(--ops-ink-dim)]" />
        <input
          className="h-10 w-full bg-transparent text-sm text-[var(--ops-ink)] outline-none"
          placeholder="Search name, email, role"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="mb-6 grid gap-2 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4 sm:grid-cols-4">
        <select
          className="ops-input"
          value={grantUser}
          onChange={(e) => setGrantUser(e.target.value)}
        >
          <option value="">Profile…</option>
          {board.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        <select
          className="ops-input"
          value={grantClient}
          onChange={(e) => setGrantClient(e.target.value)}
        >
          <option value="">Client file…</option>
          {board.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.firmName ? ` · ${c.firmName}` : ""}
            </option>
          ))}
        </select>
        <select
          className="ops-input"
          value={grantClass}
          onChange={(e) => setGrantClass(e.target.value as PracticeClassification)}
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!grantUser || !grantClient}
          onClick={() =>
            void grant({
              data: { userId: grantUser, clientId: grantClient, classification: grantClass },
            })
              .then(() => {
                toast.success("Access granted (platform override)");
                setGrantUser("");
                setGrantClient("");
                return refresh();
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : "Grant failed"))
          }
          className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-3 text-[11px] font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
        >
          Grant now
        </button>
      </div>

      <div className="space-y-3">
        {users.map((u) => (
          <article
            key={u.id}
            className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--ops-ink)]">{u.name}</div>
                <div className="text-[11px] text-[var(--ops-ink-dim)]">{u.email}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {ROLE_OPTIONS.map((role) => {
                  const on = u.roles.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => void toggleRole(u, role)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                        on
                          ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                          : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)]"
                      }`}
                    >
                      {role.replace("_", " ")}
                    </button>
                  );
                })}
              </div>
            </div>
            {u.firms.length > 0 && (
              <p className="mb-1 text-[11px] text-[var(--ops-ink-dim)]">
                Firms: {u.firms.map((f) => `${f.name} (${f.role})`).join(" · ")}
              </p>
            )}
            {u.ownedClients.length > 0 && (
              <p className="mb-1 text-[11px] text-[var(--ops-ink-dim)]">
                Owns: {u.ownedClients.map((c) => c.name).join(", ")}
              </p>
            )}
            {u.clientAccess.length > 0 && (
              <ul className="mt-2 space-y-1">
                {u.clientAccess.map((a) => (
                  <li
                    key={a.accessId}
                    className="flex items-center justify-between gap-2 text-[12px] text-[var(--ops-ink-soft)]"
                  >
                    <span>
                      {a.clientName} · {CLASSIFICATION_LABELS[a.classification]} · {a.status}
                    </span>
                    {a.status !== "revoked" && a.status !== "declined" ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ops-danger-ink)]"
                        onClick={() =>
                          void revoke({ data: { accessId: a.accessId } })
                            .then(() => refresh())
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Revoke failed"))
                        }
                      >
                        Revoke
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
