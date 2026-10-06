/**
 * Lighthouse dry-run preflight. Presence only — secret values never reach the browser.
 * Mounted on /ops System. The client-brain counts now feed the founder activation funnel.
 */

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { getFunnelHealth, type FunnelHealthReport } from "@/lib/owner-ops.functions";

const PREFLIGHT_LABELS: Record<keyof FunnelHealthReport["preflight"], string> = {
  lighthouseDryRunOrAllowlist: "LIGHTHOUSE_DRY_RUN / allowlist",
  resendApiKey: "RESEND_API_KEY",
  resendFromEmail: "RESEND_FROM_EMAIL",
  resendWebhookSecret: "RESEND_WEBHOOK_SECRET",
  siteUrl: "SITE_URL / VITE_APP_URL",
};

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
      setErr(e instanceof Error ? e.message : "Could not load preflight");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (busy && !report) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-[var(--ops-ink-dim)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading preflight…
      </div>
    );
  }

  if (err && !report) {
    return (
      <div className="mb-4 rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-4 text-sm text-[var(--ops-danger-ink)]">
        {err}
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="mb-4 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
          Lighthouse dry-run preflight
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
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PREFLIGHT_LABELS) as Array<keyof typeof PREFLIGHT_LABELS>).map((key) => (
          <PreflightPill key={key} label={PREFLIGHT_LABELS[key]} ok={report.preflight[key]} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--ops-ink-dim)]">
        Presence only — secret values are never sent to the browser.
      </p>
    </div>
  );
}
