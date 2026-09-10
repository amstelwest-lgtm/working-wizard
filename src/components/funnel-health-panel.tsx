/**
 * Funnel health — design-partner loop counts + Lighthouse dry-run preflight.
 * Owner-only via getFunnelHealth (Platform — metrics on /ops).
 */

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, RefreshCw, Target, X } from "lucide-react";
import { getFunnelHealth, type FunnelHealthReport } from "@/lib/owner-ops.functions";

const STEP_LABELS: Record<keyof FunnelHealthReport["counts"], string> = {
  "owner.invite.redeemed": "Invite redeemed",
  "seat.accepted": "Seat accepted",
  "brain.proposed": "Brain proposed",
  "brain.step.approved": "Step approved",
  "report.sent": "Report sent",
};

const PREFLIGHT_LABELS: Record<keyof FunnelHealthReport["preflight"], string> = {
  lighthouseDryRunOrAllowlist: "LIGHTHOUSE_DRY_RUN / allowlist",
  resendApiKey: "RESEND_API_KEY",
  resendFromEmail: "RESEND_FROM_EMAIL",
  resendWebhookSecret: "RESEND_WEBHOOK_SECRET",
  siteUrl: "SITE_URL / VITE_APP_URL",
};

function FunnelStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-[var(--ops-ink)]">{value}</div>
    </div>
  );
}

function PreflightPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${
        ok
          ? "border-[var(--ops-line)] bg-[var(--ops-ok-bg)] text-[var(--ops-ok-ink)]"
          : "border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
      }`}
    >
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}

export function FunnelHealthPanel() {
  const load = useServerFn(getFunnelHealth);
  const [report, setReport] = useState<FunnelHealthReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setReport(await load());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load funnel health");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (busy && !report) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[var(--ops-ink-dim)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading funnel health…
      </div>
    );
  }

  if (err && !report) {
    return (
      <div className="rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-5 text-sm text-[var(--ops-danger-ink)]">
        {err}
      </div>
    );
  }

  if (!report) return null;

  const acceptTotal =
    report.counts["owner.invite.redeemed"] + report.counts["seat.accepted"];

  return (
    <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-ink-dim)]">
          <Target className="h-3.5 w-3.5 text-[var(--ops-amber)]" />
          Client Brain funnel · last {report.windowDays}d
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-amber)]"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

      {report.migrationHint && (
        <div className="mb-4 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
          {report.migrationHint}
        </div>
      )}

      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(STEP_LABELS) as Array<keyof typeof STEP_LABELS>).map((key) => (
          <FunnelStat key={key} label={STEP_LABELS[key]} value={report.counts[key]} />
        ))}
      </div>

      <p className="mb-5 text-[11px] text-[var(--ops-ink-dim)]">
        Accept paths combined: {acceptTotal} · Counts need analytics triggers live (#142 on prod).
        Zeroes are normal until design partners move through invite → brain → sign-off.
      </p>

      <div className="border-t border-[var(--ops-line)] pt-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
          Lighthouse dry-run preflight
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PREFLIGHT_LABELS) as Array<keyof typeof PREFLIGHT_LABELS>).map((key) => (
            <PreflightPill
              key={key}
              label={PREFLIGHT_LABELS[key]}
              ok={report.preflight[key]}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--ops-ink-dim)]">
          Presence only — secret values are never sent to the browser.
        </p>
      </div>
    </div>
  );
}
