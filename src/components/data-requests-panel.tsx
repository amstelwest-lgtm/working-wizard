/**
 * Data requests panel (P0.6) — the tracked asks sitting under the Next Step.
 *
 * Owner: each request says what to send and why it matters, with Upload /
 * Enter balance shortcuts, "I've sent this" and "Not applicable".
 * Accountant: the same list plus "Email the owner" and a small form to ask
 * for a document by hand. Renders nothing for an owner with no open asks.
 *
 * The panel never navigates; the host wires `onUpload` / `onOpenForecast`
 * to its own dialogs and tabs, exactly like the Next Step card.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, FileUp, Loader2, Mail, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useTrack } from "@/hooks/use-track";
import {
  DATA_REQUEST_KINDS,
  DATA_REQUEST_KIND_LABELS,
  severityLabel,
  type DataRequest,
  type DataRequestKind,
} from "@/lib/data-requests";
import {
  createDataRequest,
  listDataRequests,
  resolveDataRequest,
  sendDataRequestEmail,
} from "@/lib/data-requests.functions";

type Props = {
  clientId: string | null;
  audience: "owner" | "accountant";
  /** Open the statements upload flow. */
  onUpload?: () => void;
  /** Open the cash forecast (bank balance lives there). */
  onOpenForecast?: () => void;
  /** Fired after any write so the host can refresh the Next Step card. */
  onChanged?: () => void;
  /** Change to refetch (e.g. after the Next Step card synced). */
  refreshKey?: string | number;
  className?: string;
};

const UPLOAD_KINDS: ReadonlySet<DataRequestKind> = new Set([
  "bank_statement",
  "management_accounts",
  "aged_debtors",
  "aged_creditors",
  "payroll",
  "other",
]);

const SEVERITY_CLASS = {
  critical: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  important: "border-[#b7872a]/45 bg-[#d4a550]/15 text-[#7a5a0e] dark:text-[#f1d28b]",
  nice_to_have:
    "border-slate-300/70 bg-slate-500/10 text-slate-600 dark:border-white/15 dark:text-slate-300",
} as const;

export function DataRequestsPanel({
  clientId,
  audience,
  onUpload,
  onOpenForecast,
  onChanged,
  refreshKey,
  className,
}: Props) {
  const track = useTrack();
  const list = useServerFn(listDataRequests);
  const resolveReq = useServerFn(resolveDataRequest);
  const createReq = useServerFn(createDataRequest);
  const sendEmail = useServerFn(sendDataRequestEmail);

  const [rows, setRows] = useState<DataRequest[]>([]);
  const [migrated, setMigrated] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askKind, setAskKind] = useState<DataRequestKind>("aged_debtors");
  const [askNote, setAskNote] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!clientId) return;
    const mine = ++seq.current;
    try {
      const res = await list({ data: { clientId } });
      if (mine !== seq.current) return;
      setRows(res.requests);
      setMigrated(res.migrated);
    } catch {
      if (mine !== seq.current) return;
      setRows([]);
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [clientId, list]);

  useEffect(() => {
    if (!clientId) return;
    void load();
    // refreshKey is intentionally a dependency: hosts bump it after writes.
  }, [clientId, refreshKey, load]);

  const afterWrite = async () => {
    await load();
    onChanged?.();
  };

  const resolve = async (r: DataRequest, resolution: "fulfilled" | "waived") => {
    if (!clientId || busyId) return;
    setBusyId(r.id);
    try {
      await resolveReq({ data: { clientId, requestId: r.id, resolution } });
      track("data_request_resolved", {
        clientId,
        audience,
        kind: r.kind,
        resolution,
        ruleKey: r.rule_key,
      });
      toast.success(resolution === "fulfilled" ? "Marked as provided" : "Request waived");
      await afterWrite();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not update the request.");
    } finally {
      setBusyId(null);
    }
  };

  const email = async () => {
    if (!clientId || sending) return;
    setSending(true);
    try {
      const res = await sendEmail({ data: { clientId } });
      if (res.ok) {
        track("data_request_emailed", { clientId, count: res.count });
        toast.success(`Emailed ${res.to} about ${res.count} ${res.count === 1 ? "item" : "items"}`);
        await afterWrite();
      } else if (res.reason === "not_configured") {
        toast.message("Email isn't configured on this workspace yet.");
      } else if (res.reason === "no_recipient") {
        toast.message("The owner has no email on file.");
      } else if (res.reason === "self") {
        toast.message("You're the owner — the requests are already on your board.");
      } else {
        toast.message("Nothing open to send.");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not send the email.");
    } finally {
      setSending(false);
    }
  };

  const ask = async () => {
    if (!clientId || askBusy) return;
    setAskBusy(true);
    try {
      const res = await createReq({
        data: { clientId, kind: askKind, reason: askNote.trim() || undefined },
      });
      if (!res.ok) {
        toast.message("Data requests aren't enabled on this workspace yet.");
        return;
      }
      track("data_request_created", { clientId, audience, kind: askKind });
      toast.success("Request added");
      setAskNote("");
      setAsking(false);
      await afterWrite();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not add the request.");
    } finally {
      setAskBusy(false);
    }
  };

  if (!clientId || !loaded || !migrated) return null;
  if (rows.length === 0 && audience === "owner") return null;

  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shell} id="data-requests" data-audience={audience} data-count={rows.length}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
            {audience === "owner" ? "MILŌN needs" : "Data requests"}
          </span>
          <h3 className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
            {rows.length === 0
              ? "Nothing outstanding"
              : rows.length === 1
                ? "One thing before the next step"
                : `${rows.length} things before the next step`}
          </h3>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/80">
            {audience === "owner"
              ? "Without these, the diagnosis and forecast are weaker than they look. Each one says exactly what to send."
              : "Tracked asks. System rules open and close these on their own; anything you add by hand stays until you close it."}
          </p>
        </div>
        {audience === "accountant" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAsking((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#b7872a]/40 px-2.5 py-1.5 text-[12px] font-semibold text-[#7a5a0e] dark:text-[#f1d28b]"
              data-ask-toggle
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Ask for a document
            </button>
            {rows.length > 0 ? (
              <button
                type="button"
                onClick={() => void email()}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
                data-email-owner
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                )}
                Email the owner
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {asking ? (
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[#b7872a]/35 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Document
            <select
              value={askKind}
              onChange={(e) => setAskKind(e.target.value as DataRequestKind)}
              className="rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
            >
              {DATA_REQUEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DATA_REQUEST_KIND_LABELS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Why (shown to the owner)
            <input
              value={askNote}
              onChange={(e) => setAskNote(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Need the June ageing to explain the debtor days jump"
              className="rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={askBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-3 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
          >
            {askBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Add request
          </button>
        </form>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((r) => {
            const busy = busyId === r.id;
            const kind = DATA_REQUEST_KIND_LABELS[r.kind];
            return (
              <li
                key={r.id}
                data-kind={r.kind}
                data-severity={r.severity}
                className="rounded-xl border border-[#b7872a]/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full border px-2 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.12em] ${SEVERITY_CLASS[r.severity]}`}
                      >
                        {severityLabel(r.severity)}
                      </span>
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                        {kind.label}
                      </span>
                      {r.status === "sent" && r.sent_at ? (
                        <span className="text-[10.5px] text-slate-500 dark:text-slate-400">
                          · emailed {new Date(r.sent_at).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[14px] font-semibold leading-snug text-slate-900 dark:text-[#f4e7c2]">
                      {r.title}
                    </p>
                    {r.reason ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700 dark:text-slate-200/85">
                        {r.reason}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400/85">
                      What to send: {kind.whatToSend}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {r.kind === "bank_balance" && onOpenForecast ? (
                      <button
                        type="button"
                        onClick={onOpenForecast}
                        className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300]"
                        data-open-forecast
                      >
                        Enter balance
                      </button>
                    ) : UPLOAD_KINDS.has(r.kind) && onUpload ? (
                      <button
                        type="button"
                        onClick={onUpload}
                        className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300]"
                        data-upload
                      >
                        <FileUp className="h-3.5 w-3.5" aria-hidden /> Upload
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resolve(r, "fulfilled")}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
                      data-resolve="fulfilled"
                      title="Close this request because the data has been provided another way"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {audience === "owner" ? "I've sent this" : "Provided"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resolve(r, "waived")}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300/70 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-300"
                      data-resolve="waived"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden /> Not applicable
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
