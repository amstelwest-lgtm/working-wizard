import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Shield, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPracticeAccessBoard,
  inviteFirmStaff,
  removeFirmMember,
  requestClientAccess,
  revokeClientAccess,
  updateFirmMember,
  type PracticeAccessBoard,
} from "@/lib/practice-access.functions";
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATIONS,
  MEMBERSHIP_LABELS,
  PRACTICE_CLIENT_ACCESS_CAP,
  type MembershipRole,
  type PracticeClassification,
} from "@/lib/practice-access";

export const Route = createFileRoute("/_authenticated/settings/team")({
  component: TeamAccessPage,
  head: () => ({ meta: [{ title: "Team & access — Milōn" }] }),
});

function TeamAccessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const load = useServerFn(getPracticeAccessBoard);
  const invite = useServerFn(inviteFirmStaff);
  const updateMember = useServerFn(updateFirmMember);
  const removeMember = useServerFn(removeFirmMember);
  const requestAccess = useServerFn(requestClientAccess);
  const revokeAccess = useServerFn(revokeClientAccess);

  const [board, setBoard] = useState<PracticeAccessBoard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<"admin" | "member">("member");
  const [invClass, setInvClass] = useState<PracticeClassification>("staff");
  const [saving, setSaving] = useState(false);

  const [grantUser, setGrantUser] = useState("");
  const [grantClient, setGrantClient] = useState("");
  const [grantClass, setGrantClass] = useState<PracticeClassification>("staff");

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setBoard(await load());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load team access");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  const statusBy = useMemo(() => {
    const map = new Map<string, PracticeAccessBoard["assignments"][number]>();
    for (const a of board?.assignments ?? []) map.set(`${a.clientId}:${a.userId}`, a);
    return map;
  }, [board]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate({ to: "/settings" })}
              className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#d4a550]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Settings
            </button>
            <h1 className="text-2xl font-semibold tracking-tight">Team & access</h1>
            <p className="mt-1 text-sm text-slate-400">
              Allocate practice roles and grant each person access to specific clients. Maximum{" "}
              {PRACTICE_CLIENT_ACCESS_CAP} accountants per client. New file access needs both a
              practice approver and the business owner via email link.
            </p>
          </div>
          <ThemeToggle />
        </div>

        {busy && !board ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-[#d4a550]" /> Loading…
          </p>
        ) : null}
        {err ? (
          <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            {err}
          </div>
        ) : null}
        {board?.migrationHint ? (
          <div className="mb-4 rounded-xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {board.migrationHint}
          </div>
        ) : null}

        {board && !board.firmId && !board.migrationHint ? (
          <p className="text-sm text-slate-400">No practice firm on this login.</p>
        ) : null}

        {board?.firmId ? (
          <>
            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#d4a550]" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
                  {board.firmName} · team
                </h2>
              </div>
              {board.canManage ? (
                <div className="mb-5 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs text-slate-400">Name</Label>
                    <Input
                      className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                      value={invName}
                      onChange={(e) => setInvName(e.target.value)}
                      placeholder="Thandi Mokoena"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Email</Label>
                    <Input
                      className="mt-1 border-slate-700 bg-slate-950 text-slate-100"
                      type="email"
                      value={invEmail}
                      onChange={(e) => setInvEmail(e.target.value)}
                      placeholder="thandi@practice.co.za"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Practice role</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                      value={invRole}
                      onChange={(e) => setInvRole(e.target.value as "admin" | "member")}
                    >
                      <option value="member">Team member (assigned clients only)</option>
                      <option value="admin">Firm admin (can assign others)</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Classification</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                      value={invClass}
                      onChange={(e) => setInvClass(e.target.value as PracticeClassification)}
                    >
                      {CLASSIFICATIONS.map((c) => (
                        <option key={c} value={c}>
                          {CLASSIFICATION_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    className="sm:col-span-2 bg-[#d4a550] text-slate-950 hover:bg-[#e0b45e]"
                    disabled={saving || !invEmail.trim()}
                    onClick={() => {
                      setSaving(true);
                      void invite({
                        data: {
                          email: invEmail.trim(),
                          name: invName.trim() || undefined,
                          membershipRole: invRole,
                          classification: invClass,
                        },
                      })
                        .then((r) => {
                          toast.success(
                            r.addedExisting
                              ? "Team member added — assign them to client files below"
                              : r.emailed
                                ? "Invite emailed"
                                : "Invite saved — email was not sent (check Resend)",
                          );
                          setInvEmail("");
                          setInvName("");
                          return refresh();
                        })
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Invite failed"))
                        .finally(() => setSaving(false));
                    }}
                  >
                    {saving ? "Sending…" : "Invite team member"}
                  </Button>
                </div>
              ) : (
                <p className="mb-4 text-xs text-slate-500">
                  You can see your own client assignments. Ask a firm admin to change roles.
                </p>
              )}

              <ul className="space-y-2">
                {board.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 px-3 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-slate-500">{m.email}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {board.canManage && !m.isFirmOwner ? (
                        <>
                          <select
                            className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs"
                            value={m.membershipRole === "owner" ? "admin" : m.membershipRole}
                            onChange={(e) =>
                              void updateMember({
                                data: {
                                  userId: m.userId,
                                  membershipRole: e.target.value as "admin" | "member",
                                },
                              })
                                .then(() => refresh())
                                .catch((err) =>
                                  toast.error(err instanceof Error ? err.message : "Update failed"),
                                )
                            }
                          >
                            <option value="member">Team member</option>
                            <option value="admin">Firm admin</option>
                          </select>
                          <select
                            className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs"
                            value={m.classification}
                            onChange={(e) =>
                              void updateMember({
                                data: {
                                  userId: m.userId,
                                  classification: e.target.value as PracticeClassification,
                                },
                              })
                                .then(() => refresh())
                                .catch((err) =>
                                  toast.error(err instanceof Error ? err.message : "Update failed"),
                                )
                            }
                          >
                            {CLASSIFICATIONS.map((c) => (
                              <option key={c} value={c}>
                                {CLASSIFICATION_LABELS[c]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            title="Remove from practice"
                            className="rounded p-1.5 text-slate-500 hover:text-rose-300"
                            onClick={() =>
                              void removeMember({ data: { userId: m.userId } })
                                .then(() => refresh())
                                .catch((err) =>
                                  toast.error(err instanceof Error ? err.message : "Remove failed"),
                                )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {MEMBERSHIP_LABELS[m.membershipRole as MembershipRole]} ·{" "}
                          {CLASSIFICATION_LABELS[m.classification]}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {board.invites.length > 0 && (
                <div className="mt-4 text-xs text-slate-500">
                  Pending invites: {board.invites.map((i) => i.email).join(", ")}
                </div>
              )}
            </section>

            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <Shield className="h-4 w-4 text-[#d4a550]" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
                  Per-client access
                </h2>
              </div>
              {board.canManage ? (
                <div className="mb-5 grid gap-3 sm:grid-cols-4">
                  <select
                    className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm sm:col-span-1"
                    value={grantUser}
                    onChange={(e) => setGrantUser(e.target.value)}
                  >
                    <option value="">Team member…</option>
                    {board.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm sm:col-span-1"
                    value={grantClient}
                    onChange={(e) => setGrantClient(e.target.value)}
                  >
                    <option value="">Client…</option>
                    {board.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.assignedCount}/{board.cap})
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                    value={grantClass}
                    onChange={(e) => setGrantClass(e.target.value as PracticeClassification)}
                  >
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>
                        {CLASSIFICATION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <Button
                    className="bg-[#d4a550] text-slate-950 hover:bg-[#e0b45e]"
                    disabled={!grantUser || !grantClient}
                    onClick={() =>
                      void requestAccess({
                        data: {
                          clientId: grantClient,
                          userId: grantUser,
                          classification: grantClass,
                        },
                      })
                        .then((r) => {
                          toast.success(
                            r.status === "active"
                              ? "Access is active"
                              : r.emailedOwner
                                ? "Requested — waiting for owner approval by email"
                                : "Requested — waiting for the other approver",
                          );
                          return refresh();
                        })
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Request failed"))
                    }
                  >
                    Request access
                  </Button>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="pb-2 pr-3 font-semibold">Client</th>
                      <th className="pb-2 pr-3 font-semibold">Person</th>
                      <th className="pb-2 pr-3 font-semibold">Class</th>
                      <th className="pb-2 pr-3 font-semibold">Status</th>
                      <th className="pb-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {board.clients.flatMap((c) => {
                      const rows = board.members
                        .map((m) => ({ c, m, a: statusBy.get(`${c.id}:${m.userId}`) }))
                        .filter((row) => row.a);
                      return rows.map(({ c: client, m, a }) => (
                        <tr key={`${client.id}-${m.userId}`} className="border-t border-slate-800">
                          <td className="py-2 pr-3">{client.name}</td>
                          <td className="py-2 pr-3 text-slate-300">{m.name}</td>
                          <td className="py-2 pr-3 text-slate-400">
                            {a ? CLASSIFICATION_LABELS[a.classification] : "—"}
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate-400">
                            {a?.status}
                            {a?.status === "pending"
                              ? ` · acct ${a.accountantApproved ? "yes" : "no"} · owner ${a.ownerApproved ? "yes" : "no"}`
                              : ""}
                          </td>
                          <td className="py-2 text-right">
                            {board.canManage && a && (a.status === "active" || a.status === "pending") ? (
                              <button
                                type="button"
                                className="text-xs text-rose-300 hover:underline"
                                onClick={() =>
                                  void revokeAccess({ data: { accessId: a.id } })
                                    .then(() => refresh())
                                    .catch((e) =>
                                      toast.error(e instanceof Error ? e.message : "Revoke failed"),
                                    )
                                }
                              >
                                Revoke
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        <Link to="/dashboard" className="text-xs text-slate-500 hover:text-[#d4a550]">
          Back to firm dashboard
        </Link>
      </div>
    </div>
  );
}
