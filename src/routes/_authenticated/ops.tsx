/**
 * Milōn Lighthouse — platform-owner and Milōn IT console.
 * Route: /ops — signed-in owners and IT members skip the passphrase lock.
 */

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  FlaskConical,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
  Wallet,
  Activity,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  OPS_UNLOCK_KEY,
  addOpsPayment,
  getOpsAccess,
  getOwnerOpsDashboard,
  getOwnerOpsEnvStatus,
  unlockOwnerOps,
  upsertOpsFeatureFlags,
  upsertOpsPilotNotes,
  type OpsAccess,
  type OpsDashboard,
} from "@/lib/owner-ops.functions";
import { ThemeToggle } from "@/components/theme-toggle";
import { LighthousePanel, parseLighthouseTab } from "@/components/lighthouse-panel";
import { LighthouseItPanel } from "@/components/lighthouse-it";
import { LighthouseAccessPanel } from "@/components/lighthouse-access";
import { LighthouseUsagePanel } from "@/components/lighthouse-usage";
import { LIGHTHOUSE_IT_INBOX_PATH } from "@/lib/client-note-link";
import "@/styles/ops-console.css";

export const Route = createFileRoute("/_authenticated/ops")({
  component: OwnerOpsPage,
  validateSearch: (search: Record<string, unknown>): { tab?: string } => {
    const tab = parseOpsSearchTab(search.tab);
    return tab ? { tab } : {};
  },
  head: () => ({ meta: [{ title: "Lighthouse — Milōn" }] }),
});

const OPS_CONSOLE_TABS = ["it", "access", "pilot", "usage"] as const;
const OPS_IT_PANES = ["it", "access", "pilot"] as const;

function parseOpsSearchTab(raw: unknown): string | undefined {
  if (typeof raw === "string" && (OPS_CONSOLE_TABS as readonly string[]).includes(raw)) return raw;
  return parseLighthouseTab(raw);
}

function isOpsItPane(raw: string | undefined): raw is (typeof OPS_IT_PANES)[number] {
  return Boolean(raw && (OPS_IT_PANES as readonly string[]).includes(raw));
}

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
  const { tab: tabSearch } = Route.useSearch();
  const loadDash = useServerFn(getOwnerOpsDashboard);
  const loadAccess = useServerFn(getOpsAccess);
  const saveFlags = useServerFn(upsertOpsFeatureFlags);
  const saveNotes = useServerFn(upsertOpsPilotNotes);
  const createPayment = useServerFn(addOpsPayment);
  const [unlocked, setUnlocked] = useState(false);
  const [access, setAccess] = useState<OpsAccess | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [dash, setDash] = useState<OpsDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  const doUnlock = useServerFn(unlockOwnerOps);
  const loadEnvStatus = useServerFn(getOwnerOpsEnvStatus);
  const [unlockPass, setUnlockPass] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  const [envDiag, setEnvDiag] = useState<{
    urlPresent: boolean;
    serviceRolePresent: boolean;
    urlFrom: string | null;
    serviceRoleFrom: string | null;
    hint: string;
    anthropic: boolean;
    resend: boolean;
    resendWebhook: boolean;
    siteUrl: boolean;
  } | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payPayer, setPayPayer] = useState("");
  const [payPlan, setPayPlan] = useState("manual");
  const [payStatus, setPayStatus] = useState<"received" | "pending" | "refunded">("received");
  const [payNote, setPayNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);

  useEffect(() => {
    try {
      setUnlocked(sessionStorage.getItem(OPS_UNLOCK_KEY) === "1");
    } catch {
      setUnlocked(false);
    }
  }, []);

  const markUnlocked = useCallback(() => {
    try {
      sessionStorage.setItem(OPS_UNLOCK_KEY, "1");
    } catch {
      /* ignore */
    }
    setUnlocked(true);
  }, []);

  const authNext =
    tabSearch === "it"
      ? LIGHTHOUSE_IT_INBOX_PATH
      : tabSearch === "access" || tabSearch === "pilot"
        ? `/ops?tab=${tabSearch}`
        : tabSearch === "usage"
          ? "/ops?tab=usage"
          : "/ops";

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    void loadAccess()
      .then((a) => {
        if (cancelled) return;
        setAccess(a);
        if (a.allowed) markUnlocked();
      })
      .catch(() => {
        if (!cancelled) setAccess(null);
      })
      .finally(() => {
        if (!cancelled) setAccessChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, loadAccess, markUnlocked]);

  const submitUnlock = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setUnlockErr("");
      setUnlockBusy(true);
      try {
        await doUnlock({ data: { username: "lighthouse", passphrase: unlockPass } });
        markUnlocked();
        setUnlockPass("");
        toast.success("Lighthouse unlocked");
      } catch (ex) {
        setUnlockErr(ex instanceof Error ? ex.message : "Unlock failed");
      } finally {
        setUnlockBusy(false);
      }
    },
    [doUnlock, unlockPass, markUnlocked],
  );

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
      navigate({ to: "/auth", search: { next: authNext } });
      return;
    }
    if (!unlocked) return;
    if (access?.isItMember && !access?.isOwner) return;
    void refresh();
  }, [authLoading, user, unlocked, access, navigate, refresh]);

  useEffect(() => {
    if (authLoading || !user || !unlocked || !err) return;
    void loadEnvStatus()
      .then(setEnvDiag)
      .catch(() => setEnvDiag(null));
  }, [authLoading, user, unlocked, err, loadEnvStatus]);

  const flagEntries = useMemo(() => Object.entries(flags), [flags]);
  const itOnly = Boolean(access?.isItMember && !access?.isOwner);
  const itSection = itOnly || isOpsItPane(tabSearch);
  const view: "lighthouse" | "it" | "platform" = itSection
    ? "it"
    : tabSearch === "usage"
      ? "platform"
      : "lighthouse";
  const lighthouseTab = parseLighthouseTab(tabSearch) ?? "pipeline";
  const itPane: (typeof OPS_IT_PANES)[number] =
    itOnly && tabSearch === "pilot" ? "it" : isOpsItPane(tabSearch) ? tabSearch : "it";
  const skipDash = itOnly || (view === "it" && itPane !== "pilot");

  useEffect(() => {
    if (!itOnly) return;
    if (isOpsItPane(tabSearch) && tabSearch !== "pilot") return;
    void navigate({ to: "/ops", search: { tab: "it" }, replace: true });
  }, [itOnly, tabSearch, navigate]);

  const openSection = (key: "lighthouse" | "it" | "platform") => {
    if (key === "it") {
      void navigate({ to: "/ops", search: { tab: "it" } });
      return;
    }
    if (key === "platform") {
      void navigate({ to: "/ops", search: { tab: "usage" } });
      return;
    }
    void navigate({ to: "/ops", search: {} });
  };

  if (
    authLoading ||
    (user && !accessChecked && !unlocked) ||
    (unlocked && busy && !dash && !err && !skipDash)
  ) {
    return (
      <div className="milon-ops grid min-h-screen place-items-center text-[var(--ops-ink-dim)]">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading ops…
        </div>
      </div>
    );
  }

  if (accessChecked && access && !access.allowed && !unlocked) {
    return (
      <div className="milon-ops grid min-h-screen place-items-center px-4 text-[var(--ops-ink-soft)]">
        <div className="w-full max-w-md rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-bg-elevated)] p-6">
          <div className="mb-3 flex items-center gap-2 text-[var(--ops-amber)]">
            <Lock className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Restricted</span>
          </div>
          <h1 className="font-serif text-2xl text-[var(--ops-ink)]">Lighthouse</h1>
          <p className="mt-2 text-sm text-[var(--ops-ink-dim)]">
            This console is for the platform owner and Milōn IT. Sign in with an IT team email to
            open the Milōn IT section.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--ops-line)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Firm dashboard
            </Link>
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--ops-line)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
            >
              Business board
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="milon-ops grid min-h-screen place-items-center px-4 text-[var(--ops-ink-soft)]">
        <div className="w-full max-w-md rounded-2xl border border-[var(--ops-amber-border)] bg-[var(--ops-bg-elevated)] p-6 shadow-2xl">
          <div className="mb-3 flex items-center gap-2 text-[var(--ops-amber)]">
            <Lock className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Locked</span>
          </div>
          <h1 className="font-serif text-2xl text-[var(--ops-ink)]">Lighthouse</h1>
          <p className="mt-2 text-sm text-[var(--ops-ink-dim)]">
            You are signed in as the platform owner. Enter the operator passphrase to open the
            console — no trip back to the landing page needed.
          </p>
          <form className="mt-5 space-y-3" onSubmit={(e) => void submitUnlock(e)}>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
                Passphrase
              </label>
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={unlockPass}
                onChange={(e) => setUnlockPass(e.target.value)}
                placeholder="Operator passphrase"
                className="h-11 w-full rounded-xl border border-[var(--ops-line)] bg-[var(--ops-input)] px-3 text-sm text-[var(--ops-ink)] outline-none placeholder:text-[var(--ops-ink-faint)] focus:border-amber-500/50"
              />
            </div>
            {unlockErr && <p className="text-sm text-[var(--ops-danger-ink)]">{unlockErr}</p>}
            <button
              type="submit"
              disabled={unlockBusy || !unlockPass.trim()}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
            >
              {unlockBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Shield className="h-3.5 w-3.5" />
              )}
              Unlock
            </button>
          </form>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--ops-line)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to app
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (err && !dash && !skipDash) {
    return (
      <div className="milon-ops grid min-h-screen place-items-center px-4 text-[var(--ops-ink-soft)]">
        <div className="w-full max-w-lg rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-6">
          <h1 className="text-lg font-semibold text-[var(--ops-danger-ink)]">
            Console cannot load
          </h1>
          <p className="mt-2 text-sm text-[var(--ops-ink-soft)] whitespace-pre-wrap">{err}</p>
          {envDiag && (
            <div className="mt-4 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-input)] p-3 text-[12px] text-[var(--ops-ink-dim)]">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
                What the server can see
              </div>
              <ul className="space-y-1 font-mono">
                <li>
                  SUPABASE_URL:{" "}
                  <span
                    className={
                      envDiag.urlPresent
                        ? "text-[var(--ops-ok-ink)]"
                        : "text-[var(--ops-danger-ink)]"
                    }
                  >
                    {envDiag.urlPresent ? `yes (${envDiag.urlFrom})` : "MISSING"}
                  </span>
                </li>
                <li>
                  SERVICE_ROLE:{" "}
                  <span
                    className={
                      envDiag.serviceRolePresent
                        ? "text-[var(--ops-ok-ink)]"
                        : "text-[var(--ops-danger-ink)]"
                    }
                  >
                    {envDiag.serviceRolePresent ? `yes (${envDiag.serviceRoleFrom})` : "MISSING"}
                  </span>
                </li>
                <li>
                  ANTHROPIC:{" "}
                  <span
                    className={
                      envDiag.anthropic ? "text-[var(--ops-ok-ink)]" : "text-[var(--ops-amber)]"
                    }
                  >
                    {envDiag.anthropic ? "yes" : "no"}
                  </span>
                </li>
                <li>
                  RESEND:{" "}
                  <span
                    className={
                      envDiag.resend ? "text-[var(--ops-ok-ink)]" : "text-[var(--ops-amber)]"
                    }
                  >
                    {envDiag.resend ? "yes" : "no"}
                  </span>
                </li>
                <li>
                  RESEND_WEBHOOK:{" "}
                  <span
                    className={
                      envDiag.resendWebhook ? "text-[var(--ops-ok-ink)]" : "text-[var(--ops-amber)]"
                    }
                  >
                    {envDiag.resendWebhook ? "yes" : "no"}
                  </span>
                </li>
                <li>
                  SITE_URL:{" "}
                  <span
                    className={
                      envDiag.siteUrl ? "text-[var(--ops-ok-ink)]" : "text-[var(--ops-amber)]"
                    }
                  >
                    {envDiag.siteUrl ? "yes" : "no"}
                  </span>
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-[var(--ops-ink-dim)]">{envDiag.hint}</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--ops-amber)]"
              onClick={() => void refresh()}
            >
              Retry
            </button>
            <button
              type="button"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]"
              onClick={() => navigate({ to: "/app" })}
            >
              Leave
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!dash && !skipDash) return null;

  return (
    <div className="milon-ops">
      <div className="ops-glow" />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ops-line)] pb-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--ops-amber)]">
              <Shield className="h-3.5 w-3.5" /> {itOnly ? "Milōn IT" : "Platform owner"}
            </div>
            <h1 className="mt-1 font-serif text-3xl tracking-tight text-[var(--ops-ink)]">
              Milōn Lighthouse
            </h1>
            <p className="mt-1 text-xs text-[var(--ops-ink-dim)]">
              {dash?.me.email ?? user?.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            {!itOnly ? (
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)] hover:text-[var(--ops-amber)]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
              </button>
            ) : null}
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
              className="inline-flex h-9 items-center rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
            >
              Sign out
            </button>
          </div>
        </header>

        {itOnly ? null : (
          <div className="mb-6 flex gap-2 border-b border-[var(--ops-line)]">
            {(
              [
                ["lighthouse", "Lighthouse — sales"],
                ["it", "Milōn IT"],
                ["platform", "Platform — metrics"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => openSection(key)}
                className={`-mb-px border-b-2 px-1 pb-2.5 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
                  view === key
                    ? "border-amber-400 text-[var(--ops-amber)]"
                    : "border-transparent text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {view === "lighthouse" && <LighthousePanel initialTab={lighthouseTab} />}
        {view === "it" && (
          <>
            <div className="mb-5 flex flex-wrap gap-2">
              {(
                [
                  ["it", "Queries"],
                  ["access", "Access"],
                  ...(itOnly ? [] : ([["pilot", "Pilot knobs"]] as const)),
                ] as ReadonlyArray<readonly ["it" | "access" | "pilot", string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void navigate({ to: "/ops", search: { tab: key } })}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                    itPane === key
                      ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                      : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {itPane === "access" ? (
              <LighthouseAccessPanel />
            ) : itPane === "pilot" && !itOnly ? (
              dash ? (
                <PilotKnobs
                  flags={flags}
                  flagEntries={flagEntries}
                  notes={notes}
                  setFlags={setFlags}
                  setNotes={setNotes}
                  saveFlags={saveFlags}
                  saveNotes={saveNotes}
                />
              ) : (
                <div className="flex items-center gap-2 py-16 text-sm text-[var(--ops-ink-dim)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading
                  knobs…
                </div>
              )
            ) : (
              <LighthouseItPanel />
            )}
          </>
        )}

        {view === "platform" && dash && (
          <>
            {dash.migrationHint && (
              <div className="mb-5 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
                {dash.migrationHint}
              </div>
            )}

            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ops-ink-dim)]">
                <Activity className="h-3.5 w-3.5 text-[var(--ops-amber)]" /> Product usage
              </h2>
              <LighthouseUsagePanel />
            </section>

            {/* Signups */}
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ops-ink-dim)]">
                <Users className="h-3.5 w-3.5 text-[var(--ops-amber)]" /> Signups
              </h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Total users" value={String(dash.signups.totalUsers)} />
                <Stat
                  label="Accountants"
                  value={String(dash.signups.accountants)}
                  hint="firm_admin + accountant"
                />
                <Stat
                  label="Business owners"
                  value={String(dash.signups.businessOwners)}
                  hint="client_owner"
                />
                <Stat label="Staff members" value={String(dash.signups.clientMembers)} />
                <Stat label="Firms" value={String(dash.signups.firms)} />
                <Stat label="Clients" value={String(dash.signups.clients)} />
                <Stat label="Owned clients" value={String(dash.signups.clientsWithOwner)} />
                <Stat
                  label="New (7d)"
                  value={
                    dash.signups.last7dUsersApprox == null
                      ? "—"
                      : String(dash.signups.last7dUsersApprox)
                  }
                />
              </div>
            </section>

            {/* Revenue */}
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ops-ink-dim)]">
                <Wallet className="h-3.5 w-3.5 text-[var(--ops-amber)]" /> Revenue & payments
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
              <p className="mt-2 text-[11px] text-[var(--ops-ink-dim)]">
                All-time received: {dash.revenue.allTimeReceivedLabel}. Billing isn’t live yet — log
                cash here manually until Stripe/PayFast lands.
              </p>

              <form
                className="mt-4 grid gap-2 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4 sm:grid-cols-6"
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
                  {payBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Log
                </button>
                <input
                  className={`${inputCls} sm:col-span-6`}
                  placeholder="Note (optional)"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                />
              </form>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--ops-line)]">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-[var(--ops-card)] text-[10px] uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
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
                        <td colSpan={5} className="px-3 py-6 text-center text-[var(--ops-ink-dim)]">
                          No payments logged yet.
                        </td>
                      </tr>
                    ) : (
                      dash.payments.map((p) => (
                        <tr
                          key={p.id}
                          className="border-t"
                          style={{ borderColor: "var(--ops-line)" }}
                        >
                          <td className="px-3 py-2 tabular-nums text-[var(--ops-ink-soft)]">
                            {p.paidAt}
                          </td>
                          <td className="px-3 py-2 font-semibold text-[var(--ops-amber)]">
                            {p.amountLabel}
                          </td>
                          <td className="px-3 py-2 text-[var(--ops-ink-soft)]">
                            {p.payerLabel ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-[var(--ops-ink-dim)]">
                            {p.planCode ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-[var(--ops-ink-dim)]">{p.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-10 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-5">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ops-ink-dim)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--ops-amber)]" /> Sales engine
              </h2>
              <p className="max-w-2xl text-sm text-[var(--ops-ink-dim)]">
                Lead generation, AI-drafted sequences, and the tracked free-trial funnel now live in
                the Lighthouse — sales section above.
              </p>
              <button
                type="button"
                onClick={() => openSection("lighthouse")}
                className="mt-3 inline-flex h-9 items-center rounded-full border border-amber-500/40 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-amber-500/10"
              >
                Open Lighthouse
              </button>
            </section>
          </>
        )}

        <p className="pb-8 text-center text-[10px] uppercase tracking-[0.2em] text-slate-600">
          Hidden console · not linked in product nav
        </p>
      </div>
    </div>
  );
}

function PilotKnobs({
  flags,
  flagEntries,
  notes,
  setFlags,
  setNotes,
  saveFlags,
  saveNotes,
}: {
  flags: Record<string, boolean>;
  flagEntries: Array<[string, boolean]>;
  notes: string;
  setFlags: (next: Record<string, boolean>) => void;
  setNotes: (text: string) => void;
  saveFlags: (args: { data: { flags: Record<string, boolean> } }) => Promise<unknown>;
  saveNotes: (args: { data: { text: string } }) => Promise<unknown>;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ops-ink-dim)]">
        <FlaskConical className="h-3.5 w-3.5 text-[var(--ops-amber)]" /> Dev / pilot knobs
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <p className="mb-3 text-xs text-[var(--ops-ink-dim)]">
            Stored in <code className="text-[var(--ops-amber)]/80">milon_ops_settings</code>. Wire
            these into product gates next — toggles save immediately.
          </p>
          <div className="space-y-2">
            {flagEntries.map(([key, on]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 hover:border-amber-500/40"
                style={{ borderColor: "var(--ops-line)" }}
              >
                <span className="text-sm text-[var(--ops-ink-soft)]">
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
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <label className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
            Pilot notes
          </label>
          <textarea
            className={`${inputCls} mt-2 min-h-[160px] resize-y`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            type="button"
            className="mt-2 inline-flex h-9 items-center rounded-full border border-amber-500/40 px-4 text-xs font-semibold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-amber-500/10"
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
    <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${gold ? "text-[var(--ops-amber)]" : "text-[var(--ops-ink)]"}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-600">{hint}</div>}
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-[var(--ops-line)] bg-[var(--ops-input)] px-3 text-sm text-[var(--ops-ink)] outline-none placeholder:text-[var(--ops-ink-faint)] focus:border-amber-500/50";
