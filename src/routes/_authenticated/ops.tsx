/**
 * Secret Milōn platform-owner console.
 * Route: /ops — gated by allowlisted email + prior passphrase unlock.
 */

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  FlaskConical,
  Loader2,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  OPS_UNLOCK_KEY,
  addOpsLead,
  addOpsPayment,
  getOwnerOpsDashboard,
  upsertOpsFeatureFlags,
  upsertOpsPilotNotes,
  type OpsDashboard,
} from "@/lib/owner-ops.functions";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/_authenticated/ops")({
  component: OwnerOpsPage,
  head: () => ({ meta: [{ title: "Ops — Milōn" }] }),
});

const FLAG_LABELS: Record<string, string> = {
  maintenance_mode: "Maintenance mode (soft gate)",
  signup_open: "Public signup open",
  ask_ai_enabled: "Ask AI enabled",
  qbo_enabled: "QuickBooks Online",
  landing_waitlist_orbit: "Orbit waitlist (landing)",
  show_pricing: "Show pricing on landing",
};

function OwnerOpsPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const loadDash = useServerFn(getOwnerOpsDashboard);
  const saveFlags = useServerFn(upsertOpsFeatureFlags);
  const saveNotes = useServerFn(upsertOpsPilotNotes);
  const createPayment = useServerFn(addOpsPayment);
  const createLead = useServerFn(addOpsLead);

  const [unlocked, setUnlocked] = useState(false);
  const [dash, setDash] = useState<OpsDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payPayer, setPayPayer] = useState("");
  const [payPlan, setPayPlan] = useState("manual");
  const [payStatus, setPayStatus] = useState<"received" | "pending" | "refunded">("received");
  const [payNote, setPayNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);

  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadCompany, setLeadCompany] = useState("");
  const [leadNotes, setLeadNotes] = useState("");
  const [leadBusy, setLeadBusy] = useState(false);

  useEffect(() => {
    try {
      setUnlocked(sessionStorage.getItem(OPS_UNLOCK_KEY) === "1");
    } catch {
      setUnlocked(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const data = await loadDash();
      setDash(data);
      setNotes(data.settings.pilotNotes);
      setFlags({ ...data.settings.featureFlags });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load ops";
      setErr(msg);
      setDash(null);
    } finally {
      setBusy(false);
    }
  }, [loadDash]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/auth", search: { next: "/ops" } });
      return;
    }
    if (!unlocked) return;
    void refresh();
  }, [authLoading, user, unlocked, navigate, refresh]);

  const flagEntries = useMemo(() => Object.entries(flags), [flags]);

  if (authLoading || (unlocked && busy && !dash && !err)) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#07070c] text-slate-400">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> Loading ops…
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#07070c] px-4 text-slate-200">
        <div className="w-full max-w-md rounded-2xl border border-amber-500/20 bg-[#0e0e16] p-6 shadow-2xl">
          <div className="mb-3 flex items-center gap-2 text-amber-400">
            <Lock className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Locked</span>
          </div>
          <h1 className="font-serif text-2xl text-slate-50">Operator console</h1>
          <p className="mt-2 text-sm text-slate-400">
            Unlock from the landing page first (secret username <span className="text-amber-300">forge</span>{" "}
            in Sign in, or 7× logo tap + passphrase), then return here signed in as the platform owner.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amber-300 hover:bg-amber-500/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Landing
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (err && !dash) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#07070c] px-4 text-slate-200">
        <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-[#140c0c] p-6">
          <h1 className="text-lg font-semibold text-red-300">Access denied</h1>
          <p className="mt-2 text-sm text-slate-400">{err}</p>
          <button
            type="button"
            className="mt-4 text-xs font-semibold uppercase tracking-wider text-amber-300"
            onClick={() => navigate({ to: "/dashboard" })}
          >
            Leave
          </button>
        </div>
      </div>
    );
  }

  if (!dash) return null;

  return (
    <div className="min-h-screen bg-[#07070c] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,55,0.12),_transparent_55%)]" />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-amber-400">
              <Shield className="h-3.5 w-3.5" /> Platform owner
            </div>
            <h1 className="mt-1 font-serif text-3xl tracking-tight text-slate-50">Milōn Forge</h1>
            <p className="mt-1 text-xs text-slate-500">{dash.me.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:border-amber-400/40 hover:text-amber-200"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={() =>
                signOut().then(() => {
                  try {
                    sessionStorage.removeItem(OPS_UNLOCK_KEY);
                  } catch {
                    /* ignore */
                  }
                  window.location.href = "/";
                })
              }
              className="inline-flex h-9 items-center rounded-full border border-white/15 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
            >
              Sign out
            </button>
          </div>
        </header>

        {dash.migrationHint && (
          <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {dash.migrationHint}
          </div>
        )}

        {/* Signups */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            <Users className="h-3.5 w-3.5 text-amber-400" /> Signups
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total users" value={String(dash.signups.totalUsers)} />
            <Stat label="Accountants" value={String(dash.signups.accountants)} hint="firm_admin + accountant" />
            <Stat label="Business owners" value={String(dash.signups.businessOwners)} hint="client_owner" />
            <Stat label="Staff members" value={String(dash.signups.clientMembers)} />
            <Stat label="Firms" value={String(dash.signups.firms)} />
            <Stat label="Clients" value={String(dash.signups.clients)} />
            <Stat label="Owned clients" value={String(dash.signups.clientsWithOwner)} />
            <Stat
              label="New (7d)"
              value={dash.signups.last7dUsersApprox == null ? "—" : String(dash.signups.last7dUsersApprox)}
            />
          </div>
        </section>

        {/* Revenue */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            <Wallet className="h-3.5 w-3.5 text-amber-400" /> Revenue & payments
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label={`Received · ${dash.revenue.monthKey}`}
              value={dash.revenue.receivedThisMonthLabel}
              gold
            />
            <Stat label="Pending this month" value={dash.revenue.pendingThisMonthLabel} />
            <Stat label="YTD received" value={dash.revenue.receivedYtdLabel} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            All-time received: {dash.revenue.allTimeReceivedLabel}. Billing isn’t live yet — log
            cash here manually until Stripe/PayFast lands.
          </p>

          <form
            className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-6"
            onSubmit={async (e) => {
              e.preventDefault();
              const amountZar = Number(payAmount);
              if (!Number.isFinite(amountZar) || amountZar <= 0) {
                toast.error("Enter a valid amount in ZAR");
                return;
              }
              setPayBusy(true);
              try {
                await createPayment({
                  data: {
                    amountZar,
                    paidAt: payDate,
                    payerLabel: payPayer || undefined,
                    planCode: payPlan || undefined,
                    status: payStatus,
                    note: payNote || undefined,
                  },
                });
                toast.success("Payment logged");
                setPayAmount("");
                setPayPayer("");
                setPayNote("");
                await refresh();
              } catch (ex) {
                toast.error(ex instanceof Error ? ex.message : "Could not save payment");
              } finally {
                setPayBusy(false);
              }
            }}
          >
            <input
              className={inputCls}
              placeholder="Amount ZAR"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              inputMode="decimal"
            />
            <input
              className={inputCls}
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder="Payer"
              value={payPayer}
              onChange={(e) => setPayPayer(e.target.value)}
            />
            <select
              className={inputCls}
              value={payPlan}
              onChange={(e) => setPayPlan(e.target.value)}
            >
              <option value="manual">manual</option>
              <option value="spark">spark</option>
              <option value="orbit">orbit</option>
              <option value="constellation">constellation</option>
            </select>
            <select
              className={inputCls}
              value={payStatus}
              onChange={(e) => setPayStatus(e.target.value as typeof payStatus)}
            >
              <option value="received">received</option>
              <option value="pending">pending</option>
              <option value="refunded">refunded</option>
            </select>
            <button
              type="submit"
              disabled={payBusy}
              className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-60"
            >
              {payBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Log
            </button>
            <input
              className={`${inputCls} sm:col-span-6`}
              placeholder="Note (optional)"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />
          </form>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Payer</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {dash.payments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                      No payments logged yet.
                    </td>
                  </tr>
                ) : (
                  dash.payments.map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="px-3 py-2 tabular-nums text-slate-300">{p.paidAt}</td>
                      <td className="px-3 py-2 font-semibold text-amber-200">{p.amountLabel}</td>
                      <td className="px-3 py-2 text-slate-300">{p.payerLabel ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400">{p.planCode ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400">{p.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Dev settings */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            <FlaskConical className="h-3.5 w-3.5 text-amber-400" /> Dev / pilot knobs
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="mb-3 text-xs text-slate-500">
                Stored in <code className="text-amber-200/80">milon_ops_settings</code>. Wire these
                into product gates next — toggles save immediately.
              </p>
              <div className="space-y-2">
                {flagEntries.map(([key, on]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/5 px-3 py-2.5 hover:border-amber-500/20"
                  >
                    <span className="text-sm text-slate-200">
                      {FLAG_LABELS[key] ?? key.replaceAll("_", " ")}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        on ? "bg-amber-500" : "bg-slate-700"
                      }`}
                      onClick={async () => {
                        const next = { ...flags, [key]: !on };
                        setFlags(next);
                        try {
                          await saveFlags({ data: { flags: { [key]: !on } } });
                          toast.success("Saved");
                        } catch (ex) {
                          setFlags(flags);
                          toast.error(ex instanceof Error ? ex.message : "Save failed");
                        }
                      }}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                          on ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Pilot notes
              </label>
              <textarea
                className={`${inputCls} mt-2 min-h-[160px] resize-y`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button
                type="button"
                className="mt-2 inline-flex h-9 items-center rounded-full border border-amber-500/40 px-4 text-xs font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-500/10"
                onClick={async () => {
                  try {
                    await saveNotes({ data: { text: notes } });
                    toast.success("Notes saved");
                  } catch (ex) {
                    toast.error(ex instanceof Error ? ex.message : "Save failed");
                  }
                }}
              >
                Save notes
              </button>
            </div>
          </div>
        </section>

        {/* Sales / email AI placeholder */}
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" /> {dash.salesPlaceholder.title}
          </h2>
          <div className="rounded-2xl border border-dashed border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent p-5">
            <p className="max-w-2xl text-sm text-slate-300">{dash.salesPlaceholder.blurb}</p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-2">
              {dash.salesPlaceholder.phases.map((p, i) => (
                <li
                  key={p.id}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-300">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{p.label}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      {p.status}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                <Mail className="h-3.5 w-3.5" /> Seed leads (CRM stub)
              </div>
              <form
                className="grid gap-2 sm:grid-cols-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLeadBusy(true);
                  try {
                    await createLead({
                      data: {
                        name: leadName || undefined,
                        email: leadEmail || undefined,
                        company: leadCompany || undefined,
                        notes: leadNotes || undefined,
                        source: "ops_manual",
                      },
                    });
                    toast.success("Lead added");
                    setLeadName("");
                    setLeadEmail("");
                    setLeadCompany("");
                    setLeadNotes("");
                    await refresh();
                  } catch (ex) {
                    toast.error(ex instanceof Error ? ex.message : "Could not add lead");
                  } finally {
                    setLeadBusy(false);
                  }
                }}
              >
                <input
                  className={inputCls}
                  placeholder="Name"
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Email"
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Company"
                  value={leadCompany}
                  onChange={(e) => setLeadCompany(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={leadBusy}
                  className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-amber-500/40 text-xs font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/10 disabled:opacity-60"
                >
                  {leadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add lead
                </button>
                <input
                  className={`${inputCls} sm:col-span-4`}
                  placeholder="Notes"
                  value={leadNotes}
                  onChange={(e) => setLeadNotes(e.target.value)}
                />
              </form>

              <ul className="mt-3 space-y-2">
                {dash.leads.length === 0 ? (
                  <li className="text-sm text-slate-500">No leads yet — park prospects here.</li>
                ) : (
                  dash.leads.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-white/5 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-200">
                        {l.name || l.email || "Untitled"}{" "}
                        <span className="text-slate-500">
                          {l.company ? `· ${l.company}` : ""}
                          {l.email ? ` · ${l.email}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
                        {l.status}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>

        <p className="pb-8 text-center text-[10px] uppercase tracking-[0.2em] text-slate-600">
          Hidden console · not linked in product nav
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  gold,
}: {
  label: string;
  value: string;
  hint?: string;
  gold?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${gold ? "text-amber-300" : "text-slate-50"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-600">{hint}</div>}
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-amber-500/50";
