import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Shield, Trash2, UserPlus } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/primitives";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import { SettingsShell } from "@/components/settings-shell";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPracticeAccessBoard,
  getPracticeTeamRoster,
  inviteFirmStaff,
  removeFirmMember,
  revokeClientAccess,
  revokeFirmStaffInvite,
  rotateFirmStaffInvite,
  saveClientAssignments,
  updateFirmMember,
  type PracticeAccessBoard,
  type PracticeInviteRow,
} from "@/lib/practice-access.functions";
import {
  CLASSIFICATION_HELP,
  CLASSIFICATION_LABELS,
  CLASSIFICATIONS,
  CLASS_RANK,
  FIRM_PERMISSION_HELP,
  MEMBERSHIP_LABELS,
  PARTNER_ASSIGN_TOOLTIP,
  PRACTICE_CLIENT_ACCESS_CAP,
  classesAtOrBelow,
  type MembershipRole,
  type PracticeClassification,
} from "@/lib/practice-access";

export const Route = createFileRoute("/_authenticated/settings/team")({
  component: TeamAccessPage,
  head: () => ({
    meta: [{ title: "Team & access — Milōn" }],
  }),
});

function ClassificationSelect({
  value,
  onChange,
  actorIsPartner,
  ceiling,
  className,
}: {
  value: PracticeClassification;
  onChange: (c: PracticeClassification) => void;
  actorIsPartner: boolean;
  ceiling?: PracticeClassification;
  className?: string;
}) {
  return (
    <select
      className={className}
      value={value}
      title={!actorIsPartner ? PARTNER_ASSIGN_TOOLTIP : undefined}
      onChange={(e) => {
        const next = e.target.value as PracticeClassification;
        if (next === "partner" && !actorIsPartner) return;
        if (ceiling && CLASS_RANK[next] > CLASS_RANK[ceiling]) return;
        onChange(next);
      }}
    >
      {CLASSIFICATIONS.map((c) => {
        const overCeiling = Boolean(ceiling && CLASS_RANK[c] > CLASS_RANK[ceiling]);
        const partnerLocked = c === "partner" && !actorIsPartner;
        return (
          <option
            key={c}
            value={c}
            disabled={overCeiling || partnerLocked}
            title={partnerLocked ? PARTNER_ASSIGN_TOOLTIP : undefined}
          >
            {CLASSIFICATION_LABELS[c]}
          </option>
        );
      })}
    </select>
  );
}

function formatInviteExpiry(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(t));
  return t < Date.now() ? `Expired ${label}` : label;
}

const INVITE_EMAIL_FAILED =
  "Invite saved, but the email didn't send. Copy the link and send it yourself.";

function TeamAccessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const loadRoster = useServerFn(getPracticeTeamRoster);
  const loadBoard = useServerFn(getPracticeAccessBoard);
  const invite = useServerFn(inviteFirmStaff);
  const rotateInvite = useServerFn(rotateFirmStaffInvite);
  const revokeInvite = useServerFn(revokeFirmStaffInvite);
  const updateMember = useServerFn(updateFirmMember);
  const removeMember = useServerFn(removeFirmMember);
  const saveAssignments = useServerFn(saveClientAssignments);
  const revokeAccess = useServerFn(revokeClientAccess);

  const [roster, setRoster] = useState<PracticeAccessBoard | null>(null);
  const [board, setBoard] = useState<PracticeAccessBoard | null>(null);
  const [rosterBusy, setRosterBusy] = useState(true);
  const [accessBusy, setAccessBusy] = useState(true);
  const [err, setErr] = useState("");

  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<"admin" | "member">("member");
  const [invClass, setInvClass] = useState<PracticeClassification>("staff");
  const [saving, setSaving] = useState(false);
  const [unsentInvite, setUnsentInvite] = useState<{ url: string; email: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const [grantUser, setGrantUser] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [draftGrants, setDraftGrants] = useState<Record<string, PracticeClassification>>({});
  const [savingGrants, setSavingGrants] = useState(false);

  const refresh = useCallback(async () => {
    setRosterBusy(true);
    setAccessBusy(true);
    setErr("");
    const rosterTask = loadRoster()
      .then((next) => {
        setRoster(next);
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : "Could not load the team");
      })
      .finally(() => setRosterBusy(false));
    const boardTask = loadBoard()
      .then((next) => {
        setBoard(next);
        setErr("");
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : "Could not load client access");
      })
      .finally(() => setAccessBusy(false));
    await Promise.all([rosterTask, boardTask]);
  }, [loadRoster, loadBoard]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  const statusBy = useMemo(() => {
    const map = new Map<string, PracticeAccessBoard["assignments"][number]>();
    for (const a of board?.assignments ?? []) map.set(`${a.clientId}:${a.userId}`, a);
    return map;
  }, [board]);

  const view = board ?? roster;
  const selectedMember = board?.members.find((m) => m.userId === grantUser) ?? null;
  const teamCeiling = selectedMember?.classification ?? "staff";
  const actorIsPartner = Boolean(view?.actorIsPartner);

  useEffect(() => {
    if (!board || !grantUser) {
      setDraftGrants({});
      return;
    }
    const next: Record<string, PracticeClassification> = {};
    for (const a of board.assignments) {
      if (a.userId !== grantUser) continue;
      if (a.status !== "active" && a.status !== "pending") continue;
      next[a.clientId] = a.classification;
    }
    setDraftGrants(next);
    setClientSearch("");
  }, [board, grantUser]);

  const visibleClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const list = board?.clients ?? [];
    return (q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list).slice().sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [board, clientSearch]);

  const toggleClient = (clientId: string, checked: boolean) => {
    setDraftGrants((prev) => {
      const next = { ...prev };
      if (checked) next[clientId] = prev[clientId] ?? teamCeiling;
      else delete next[clientId];
      return next;
    });
  };

  const selectAllVisible = () => {
    setDraftGrants((prev) => {
      const next = { ...prev };
      for (const c of visibleClients) {
        const already = Boolean(next[c.id]);
        const atCap = c.assignedCount >= (board?.cap ?? PRACTICE_CLIENT_ACCESS_CAP);
        if (!already && atCap) continue;
        next[c.id] = next[c.id] ?? teamCeiling;
      }
      return next;
    });
  };

  const deselectAllVisible = () => {
    setDraftGrants((prev) => {
      const next = { ...prev };
      for (const c of visibleClients) delete next[c.id];
      return next;
    });
  };

  const copyText = async (url: string) => {
    await navigator.clipboard.writeText(url);
  };

  const copyBannerLink = async () => {
    if (!unsentInvite) return;
    try {
      await copyText(unsentInvite.url);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
      toast.error("Could not copy the link. Select it and copy it yourself.");
    }
  };

  const copyPendingLink = async (row: PracticeInviteRow) => {
    setBusyInvite(row.id);
    try {
      const result = await rotateInvite({ data: { inviteId: row.id, sendEmail: false } });
      setUnsentInvite((current) =>
        current?.email === row.email ? { url: result.inviteUrl, email: row.email } : current,
      );
      try {
        await copyText(result.inviteUrl);
        setCopiedInviteId(row.id);
      } catch {
        setUnsentInvite({ url: result.inviteUrl, email: row.email });
        setLinkCopied(false);
        toast.error("Could not copy the link. Select it and copy it yourself.");
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not copy the invite link");
    } finally {
      setBusyInvite(null);
    }
  };

  const resendPending = async (row: PracticeInviteRow) => {
    setBusyInvite(row.id);
    try {
      const result = await rotateInvite({ data: { inviteId: row.id, sendEmail: true } });
      if (result.emailed) {
        toast.success("Invite emailed", { id: `firm-invite-resend-${row.id}-${Date.now()}` });
        setUnsentInvite((current) => (current?.email === row.email ? null : current));
      } else {
        setUnsentInvite({ url: result.inviteUrl, email: row.email });
        setLinkCopied(false);
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resend the invite");
    } finally {
      setBusyInvite(null);
    }
  };

  const revokePending = async (row: PracticeInviteRow) => {
    setBusyInvite(row.id);
    try {
      await revokeInvite({ data: { inviteId: row.id } });
      setUnsentInvite((current) => (current?.email === row.email ? null : current));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke the invite");
    } finally {
      setBusyInvite(null);
    }
  };

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
        subtitle={`The business owner approves this practice once. After that you assign your own people to client files. Maximum ${PRACTICE_CLIENT_ACCESS_CAP} accountants per client. The owner can revoke anyone, or disconnect the firm, from their settings.`}
        meta={<ThemeToggle />}
      />

        {!view && (rosterBusy || accessBusy) ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-[#d4a550]" /> Loading…
          </p>
        ) : null}
        {err ? (
          <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            {err}
          </div>
        ) : null}
        {view?.migrationHint ? (
          <div className="mb-4 rounded-xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {view.migrationHint}
          </div>
        ) : null}

        {view && !view.firmId && !view.migrationHint ? (
          <p className="text-sm text-slate-400">No practice firm on this login.</p>
        ) : null}

        {view && view.firmId ? (
          <>
            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#d4a550]" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
                  {view.firmName} · team
                </h2>
              </div>
              {view.canManage ? (
                <div className="mb-5 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs text-slate-400">Name</Label>
                    <Input
                      className="mt-1 border-slate-700 bg-[var(--bg)] text-slate-100"
                      value={invName}
                      onChange={(e) => setInvName(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Email</Label>
                    <Input
                      className="mt-1 border-slate-700 bg-[var(--bg)] text-slate-100"
                      type="email"
                      value={invEmail}
                      onChange={(e) => setInvEmail(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Firm permissions</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-[var(--bg)] px-3 text-sm"
                      value={invRole}
                      onChange={(e) => setInvRole(e.target.value as "admin" | "member")}
                    >
                      <option value="member">
                        Team member — {FIRM_PERMISSION_HELP.member}
                      </option>
                      <option value="admin">Firm admin — {FIRM_PERMISSION_HELP.admin}</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Professional level</Label>
                    <ClassificationSelect
                      className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-[var(--bg)] px-3 text-sm"
                      value={invClass}
                      onChange={setInvClass}
                      actorIsPartner={actorIsPartner}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">{CLASSIFICATION_HELP}</p>
                  </div>
                  <Button
                    className="settings-gold sm:col-span-2 bg-[#d4a550] text-slate-950 hover:bg-[#e0b45e]"
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
                          const invitedEmail = invEmail.trim().toLowerCase();
                          if (r.emailed) {
                            toast.success(
                              r.addedExisting
                                ? "Team member added — assign them to client files below"
                                : "Invite emailed",
                              { id: `firm-invite-ok-${Date.now()}` },
                            );
                            setUnsentInvite(null);
                          } else if (r.inviteUrl) {
                            setLinkCopied(false);
                            setUnsentInvite({ url: r.inviteUrl, email: invitedEmail });
                          } else {
                            toast.error(r.error || "Invite saved, but the email didn't send.");
                          }
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
                  {unsentInvite ? (
                    <div
                      role="status"
                      className="sm:col-span-2 rounded-xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200"
                    >
                      <p>{INVITE_EMAIL_FAILED}</p>
                      <p className="mt-2 break-all text-xs">{unsentInvite.url}</p>
                      <button
                        type="button"
                        className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold"
                        onClick={() => void copyBannerLink()}
                      >
                        {linkCopied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mb-4 text-xs text-slate-500">
                  You can see your own client assignments. Ask a firm admin to change roles.
                </p>
              )}

              <ul className="space-y-2">
                {view.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 px-3 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-slate-500">{m.email}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {view.canManage && !m.isFirmOwner ? (
                        <>
                          <select
                            className="h-9 rounded-md border border-slate-700 bg-[var(--bg)] px-2 text-xs"
                            value={m.membershipRole === "owner" ? "admin" : m.membershipRole}
                            title="Firm permissions"
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
                          <ClassificationSelect
                            className="h-9 rounded-md border border-slate-700 bg-[var(--bg)] px-2 text-xs"
                            value={m.classification}
                            actorIsPartner={actorIsPartner}
                            onChange={(classification) =>
                              void updateMember({
                                data: { userId: m.userId, classification },
                              })
                                .then(() => refresh())
                                .catch((err) =>
                                  toast.error(err instanceof Error ? err.message : "Update failed"),
                                )
                            }
                          />
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
              {(board?.invites.length ?? 0) > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Pending invites
                  </p>
                  <ul className="space-y-2">
                    {board?.invites.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 px-3 py-3"
                      >
                        <div>
                          <div className="text-sm font-medium">{row.name || row.email}</div>
                          <div className="text-xs text-slate-500">{row.email}</div>
                          <div className="text-xs text-slate-400">
                            {MEMBERSHIP_LABELS[row.membershipRole]} ·{" "}
                            {CLASSIFICATION_LABELS[row.classification]} · Expires{" "}
                            {formatInviteExpiry(row.expiresAt)}
                          </div>
                        </div>
                        {view.canManage ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200"
                              disabled={busyInvite === row.id}
                              onClick={() => void copyPendingLink(row)}
                            >
                              {copiedInviteId === row.id ? "Copied" : "Copy invite link"}
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200"
                              disabled={busyInvite === row.id}
                              onClick={() => void resendPending(row)}
                            >
                              Resend
                            </button>
                            <button
                              type="button"
                              className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-rose-300"
                              disabled={busyInvite === row.id}
                              onClick={() => void revokePending(row)}
                            >
                              Revoke
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
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
              {!board ? (
                <p className="flex items-center gap-2 text-sm text-slate-400">
                  {accessBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-[#d4a550]" /> Loading client access…
                    </>
                  ) : (
                    "Client assignments could not be loaded."
                  )}
                </p>
              ) : board.canManage ? (
                <div className="mb-5 space-y-3">
                  <select
                    className="h-10 w-full rounded-md border border-slate-700 bg-[var(--bg)] px-3 text-sm"
                    value={grantUser}
                    onChange={(e) => setGrantUser(e.target.value)}
                  >
                    <option value="">Team member…</option>
                    {board.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} · {CLASSIFICATION_LABELS[m.classification]}
                      </option>
                    ))}
                  </select>

                  {grantUser ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="h-9 min-w-[180px] flex-1 border-slate-700 bg-[var(--bg)] text-slate-100"
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Search clients"
                        />
                        <Button type="button" variant="outline" size="sm" className="border-slate-700" onClick={selectAllVisible}>
                          Select all
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={deselectAllVisible}>
                          Deselect all
                        </Button>
                      </div>
                      <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-800 p-2">
                        {visibleClients.map((c) => {
                          const checked = Boolean(draftGrants[c.id]);
                          const atCap = c.assignedCount >= board.cap && !checked;
                          const allowed = classesAtOrBelow(teamCeiling);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm ${
                                atCap ? "opacity-50" : "hover:bg-slate-800/60"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[#d4a550]"
                                checked={checked}
                                disabled={atCap}
                                title={
                                  atCap
                                    ? `This file already has ${board.cap} practice users`
                                    : undefined
                                }
                                onChange={(e) => toggleClient(c.id, e.target.checked)}
                              />
                              <span className="min-w-0 flex-1 truncate">{c.name}</span>
                              <span className="text-[11px] text-slate-500">
                                {c.assignedCount}/{board.cap}
                              </span>
                              {checked ? (
                                <ClassificationSelect
                                  className="h-8 max-w-[140px] rounded-md border border-slate-700 bg-[var(--bg)] px-2 text-xs"
                                  value={
                                    allowed.includes(draftGrants[c.id])
                                      ? draftGrants[c.id]
                                      : teamCeiling
                                  }
                                  actorIsPartner={actorIsPartner}
                                  ceiling={teamCeiling}
                                  onChange={(classification) =>
                                    setDraftGrants((prev) => ({ ...prev, [c.id]: classification }))
                                  }
                                />
                              ) : null}
                            </label>
                          );
                        })}
                        {visibleClients.length === 0 ? (
                          <p className="px-2 py-3 text-xs text-slate-500">No clients match.</p>
                        ) : null}
                      </div>
                      <Button
                        className="bg-[#d4a550] text-slate-950 hover:bg-[#e0b45e]"
                        disabled={savingGrants}
                        onClick={() => {
                          setSavingGrants(true);
                          void saveAssignments({
                            data: {
                              userId: grantUser,
                              grants: Object.entries(draftGrants).map(([clientId, classification]) => ({
                                clientId,
                                classification,
                              })),
                            },
                          })
                            .then((r) => {
                              toast.success(
                                r.granted
                                  ? `Saved — ${r.granted} new assignment${r.granted === 1 ? "" : "s"}. Owner notified.`
                                  : "Saved assignments",
                              );
                              return refresh();
                            })
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Save failed"))
                            .finally(() => setSavingGrants(false));
                        }}
                      >
                        {savingGrants ? "Saving…" : "Save assignments"}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Choose a person to assign them to every connected client in one save.
                    </p>
                  )}
                </div>
              ) : null}

              {board ? (
              <ScrollableTable cardRows>
                <table className="milon-data-table w-full min-w-[640px] text-left text-sm">
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
                          <td data-label="Person" className="py-2 pr-3 text-slate-300">
                            {m.name}
                          </td>
                          <td data-label="Class" className="py-2 pr-3 text-slate-400">
                            {a ? CLASSIFICATION_LABELS[a.classification] : "—"}
                          </td>
                          <td data-label="Status" className="py-2 pr-3 text-xs text-slate-400">
                            {a?.status}
                          </td>
                          <td data-label="" className="py-2 text-right">
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
              </ScrollableTable>
              ) : null}
            </section>
          </>
        ) : null}

        <BackLink to="/dashboard">Back to firm dashboard</BackLink>
    </SettingsShell>
  );
}
