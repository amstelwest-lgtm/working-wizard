import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Shield, Trash2, UserPlus } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { PageHeader, SectionCard } from "@/components/primitives";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import { SettingsShell } from "@/components/settings-shell";
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
    <SettingsShell width="lg">
      <BackLink onClick={() => navigate({ to: "/settings" })} className="mb-3">
        Back to settings
      </BackLink>
      <PageHeader
        compact
        className="mb-8"
        eyebrow="Practice"
        title="Team & access"
        subtitle={`Allocate practice roles and grant each person access to specific clients. Maximum ${PRACTICE_CLIENT_ACCESS_CAP} accountants per client. New file access needs both a practice approver and the business owner via email link.`}
        meta={<ThemeToggle />}
      />

      {busy && !board ? (
        <p className="flex items-center gap-2 text-sm text-[var(--ink-dim)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--gold)]" /> Loading…
        </p>
      ) : null}
      {err ? <div className="settings-danger mb-4 text-sm">{err}</div> : null}
      {board?.migrationHint ? (
        <div className="mb-4 rounded-xl border border-[var(--warn)]/40 bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-4 py-3 text-sm text-[var(--ink)]">
          {board.migrationHint}
        </div>
      ) : null}

      {board && !board.firmId && !board.migrationHint ? (
        <p className="text-sm text-[var(--ink-dim)]">No practice firm on this login.</p>
      ) : null}

      {board?.firmId ? (
        <>
          <SectionCard
            className="mb-6"
            eyebrow={
              <span className="inline-flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                {board.firmName} · team
              </span>
            }
          >
            {board.canManage ? (
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="settings-label">Name</Label>
                  <Input
                    className="mt-1"
                    value={invName}
                    onChange={(e) => setInvName(e.target.value)}
                    placeholder="Thandi Mokoena"
                  />
                </div>
                <div>
                  <Label className="settings-label">Email</Label>
                  <Input
                    className="mt-1"
                    type="email"
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                    placeholder="thandi@practice.co.za"
                  />
                </div>
                <div>
                  <Label className="settings-label">Practice role</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                    value={invRole}
                    onChange={(e) => setInvRole(e.target.value as "admin" | "member")}
                  >
                    <option value="member">Team member (assigned clients only)</option>
                    <option value="admin">Firm admin (can assign others)</option>
                  </select>
                </div>
                <div>
                  <Label className="settings-label">Classification</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
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
                  className="settings-gold sm:col-span-2"
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
              <p className="mb-4 text-xs text-[var(--ink-dim)]">
                You can see your own client assignments. Ask a firm admin to change roles.
              </p>
            )}

            <ul className="space-y-2">
              {board.members.map((m) => (
                <li key={m.userId} className="settings-member">
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-[var(--ink-dim)]">{m.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {board.canManage && !m.isFirmOwner ? (
                      <>
                        <select
                          className="h-9 rounded-md border px-2 text-xs"
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
                          className="h-9 rounded-md border px-2 text-xs"
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
                          className="rounded p-1.5 text-[var(--ink-faint)] hover:text-[var(--risk)]"
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
                      <span className="text-xs text-[var(--ink-dim)]">
                        {MEMBERSHIP_LABELS[m.membershipRole as MembershipRole]} ·{" "}
                        {CLASSIFICATION_LABELS[m.classification]}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {board.invites.length > 0 && (
              <div className="mt-4 text-xs text-[var(--ink-dim)]">
                Pending invites: {board.invites.map((i) => i.email).join(", ")}
              </div>
            )}
          </SectionCard>

          <SectionCard
            className="mb-6"
            eyebrow={
              <span className="inline-flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Per-client access
              </span>
            }
          >
            {board.canManage ? (
              <div className="mb-5 grid gap-3 sm:grid-cols-4">
                <select
                  className="h-10 rounded-md border px-3 text-sm sm:col-span-1"
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
                  className="h-10 rounded-md border px-3 text-sm sm:col-span-1"
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
                  className="h-10 rounded-md border px-3 text-sm"
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
                  className="settings-gold"
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

            <ScrollableTable cardRows>
              <table className="milon-data-table w-full min-w-[640px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-dim)]">
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
                      <tr
                        key={`${client.id}-${m.userId}`}
                        className="border-t border-[var(--line-soft)]"
                      >
                        <td className="py-2 pr-3">{client.name}</td>
                        <td data-label="Person" className="py-2 pr-3 text-[var(--ink)]">
                          {m.name}
                        </td>
                        <td data-label="Class" className="py-2 pr-3 text-[var(--ink-dim)]">
                          {a ? CLASSIFICATION_LABELS[a.classification] : "—"}
                        </td>
                        <td data-label="Status" className="py-2 pr-3 text-xs text-[var(--ink-dim)]">
                          {a?.status}
                          {a?.status === "pending"
                            ? ` · acct ${a.accountantApproved ? "yes" : "no"} · owner ${a.ownerApproved ? "yes" : "no"}`
                            : ""}
                        </td>
                        <td data-label="" className="py-2 text-right">
                          {board.canManage &&
                          a &&
                          (a.status === "active" || a.status === "pending") ? (
                            <button
                              type="button"
                              className="text-xs text-[var(--risk)] hover:underline"
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
            </ScrollableTable>
          </SectionCard>
        </>
      ) : null}

      <BackLink to="/dashboard">Back to firm dashboard</BackLink>
    </SettingsShell>
  );
}
