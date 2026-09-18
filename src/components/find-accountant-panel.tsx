/**
 * Find an accountant (P3) — owner side.
 *
 * Shown only to owners with no firm attached. Lists matched firms with the
 * reasons they matched, lets the owner send one request per firm (the firm
 * sees the pack, not raw figures), shows the state of open requests, and lets
 * them withdraw. Disappears the moment a firm is attached — the rest of the
 * spine takes over from there. Never navigates.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Check, Loader2, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useTrack } from "@/hooks/use-track";
import { inviteMoment, requestStatusLabel, type FirmMatch } from "@/lib/marketplace";
import {
  createAccountantRequest,
  listFirmMatches,
  withdrawAccountantRequest,
  type FirmMatchesResult,
} from "@/lib/marketplace.functions";

type Props = {
  clientId: string | null;
  hasFirm: boolean;
  packStatus: string | null;
  onChanged?: () => void;
  refreshKey?: string | number;
  className?: string;
};

export function FindAccountantPanel({
  clientId,
  hasFirm,
  packStatus,
  onChanged,
  refreshKey,
  className,
}: Props) {
  const track = useTrack();
  const fetchMatches = useServerFn(listFirmMatches);
  const create = useServerFn(createAccountantRequest);
  const withdraw = useServerFn(withdrawAccountantRequest);

  const [data, setData] = useState<FirmMatchesResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [askingId, setAskingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!clientId || hasFirm) return;
    const mine = ++seq.current;
    try {
      const res = await fetchMatches({ data: { clientId } });
      if (mine !== seq.current) return;
      setData(res);
    } catch {
      if (mine !== seq.current) return;
      setData(null);
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [clientId, hasFirm, fetchMatches]);

  useEffect(() => {
    if (!clientId || hasFirm) return;
    void load();
    // refreshKey is intentionally a dependency.
  }, [clientId, hasFirm, refreshKey, load]);

  if (!clientId || hasFirm || !loaded || !data || !data.migrated || data.matches === null)
    return null;
  if (data.matches.length === 0 && data.requests.length === 0) return null;

  const open = data.requests.filter((r) => r.status === "open");
  const moment = inviteMoment({ packStatus, hasFirm, openRequests: open.length });
  const visible = showAll ? data.matches : data.matches.slice(0, 3);

  const ask = async (firm: FirmMatch) => {
    if (busy) return;
    setBusy(firm.firm_id);
    try {
      await create({
        data: { clientId, firmId: firm.firm_id, message: message.trim() || undefined },
      });
      track("accountant_request_sent", { clientId, firmId: firm.firm_id, score: firm.score });
      toast.success(`Request sent to ${firm.name}`);
      setAskingId(null);
      setMessage("");
      await load();
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(null);
    }
  };

  const pull = async (requestId: string) => {
    if (busy) return;
    setBusy(requestId);
    try {
      await withdraw({ data: { requestId } });
      toast.success("Request withdrawn");
      await load();
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not withdraw.");
    } finally {
      setBusy(null);
    }
  };

  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shell} id="find-accountant" data-open-requests={open.length}>
      <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
        Accountant
      </span>
      <h3 className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
        {moment.title}
      </h3>
      <p className="mt-1 max-w-[64ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300/80">
        {moment.reason}
      </p>

      {data.requests.length > 0 ? (
        <ul className="mt-3 space-y-1.5" data-requests>
          {data.requests.slice(0, 5).map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#b7872a]/20 bg-white/60 px-3 py-2 text-[12.5px] dark:border-white/10 dark:bg-white/[0.03]"
              data-request-status={r.status}
            >
              <span className="text-slate-800 dark:text-slate-100">
                <span className="font-semibold">{r.firm_name ?? "Firm"}</span> ·{" "}
                {requestStatusLabel(r.status, "owner")}
                {r.response_note ? (
                  <span className="text-slate-500"> — {r.response_note}</span>
                ) : null}
              </span>
              {r.status === "open" ? (
                <button
                  type="button"
                  onClick={() => void pull(r.id)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400"
                  data-withdraw
                >
                  <Undo2 className="h-3 w-3" aria-hidden /> Withdraw
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {open.length === 0 && visible.length > 0 ? (
        <ul className="mt-3 space-y-2" data-matches>
          {visible.map((f) => {
            const asking = askingId === f.firm_id;
            const already = f.request_status === "open";
            return (
              <li
                key={f.firm_id}
                data-firm={f.firm_id}
                data-score={f.score}
                className="rounded-xl border border-[#b7872a]/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900 dark:text-[#f4e7c2]">
                      <Building2 className="h-3.5 w-3.5 text-[#b7872a]" aria-hidden /> {f.name}
                    </p>
                    {f.headline ? (
                      <p className="mt-0.5 text-[12.5px] text-slate-700 dark:text-slate-200/85">
                        {f.headline}
                      </p>
                    ) : null}
                    {f.reasons.length ? (
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {f.reasons.join(" · ")}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Listed firm; no specific match on your profile.
                      </p>
                    )}
                  </div>
                  {!asking ? (
                    <button
                      type="button"
                      disabled={already || !f.accepting || busy !== null}
                      onClick={() => setAskingId(f.firm_id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
                      data-ask
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      {already ? "Requested" : f.accepting ? "Ask to review" : "Not taking clients"}
                    </button>
                  ) : null}
                </div>
                {asking ? (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ask(f);
                    }}
                  >
                    <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      A line for them (optional)
                      <input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        maxLength={1000}
                        placeholder="e.g. Cash has been tight since June; I'd value a second pair of eyes."
                        className="rounded-md border border-slate-300/70 bg-white px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-100"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-3 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50"
                    >
                      {busy === f.firm_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Send request
                    </button>
                    <button
                      type="button"
                      onClick={() => setAskingId(null)}
                      className="text-[12px] font-semibold text-slate-500"
                    >
                      Cancel
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {open.length === 0 && data.matches.length > 3 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400"
        >
          {showAll ? "Show fewer" : `Show all ${data.matches.length} firms`}
        </button>
      ) : null}
      <p className="mt-3 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        The firm sees your advisory pack — diagnosis, forecast and proposed moves — not your
        statements. You can withdraw any time before they accept.
      </p>
    </section>
  );
}
