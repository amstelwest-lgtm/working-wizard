import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

/**
 * Public tokenised task page — /t/:token
 * One task. One screen. Works on a phone in the parking lot.
 * No login, no account. GET loads read-only; only the Save button POSTs.
 */
export const Route = createFileRoute("/t/$token")({
  component: TaskPage,
  head: () => ({ meta: [{ title: "Your task — MILŌN" }] }),
});

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/task-link`;

type Payload = {
  item: {
    id: string;
    title: string;
    outcome_why: string | null;
    due_date: string | null;
    status: "not_started" | "in_progress" | "done" | "blocked";
    progress_pct: number;
    days_remaining: number | null;
    blocker_note: string | null;
    updated_at: string;
  };
  milestones: { id: string; week_no: number; label: string; is_done: boolean }[];
  plan: { outcome_goal: string; period_label: string } | null;
  assignee_name: string | null;
  business_name: string | null;
};

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "I'm blocked" },
] as const;

const GOLD = "#d4a550";

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function TaskPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<string>("not_started");
  const [progress, setProgress] = useState(0);
  const [milestones, setMilestones] = useState<Payload["milestones"]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ownerNotified, setOwnerNotified] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const intent = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("intent");
  }, []);

  // This page is always dark; force the dark class so global light-mode
  // overrides (e.g. html:not(.dark) h1 color) don't apply.
  useEffect(() => {
    const el = document.documentElement;
    const hadDark = el.classList.contains("dark");
    el.classList.add("dark");
    return () => {
      if (!hadDark) el.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${FN_BASE}/${token}`);
        const body = await res.json();
        if (!alive) return;
        if (!res.ok || body.error) {
          setErrorKind(body.error ?? "not_found");
        } else {
          const p = body as Payload;
          setData(p);
          // ?intent= pre-selects but NEVER saves. Mutation only on POST.
          const pre = intent && ["in_progress", "done", "blocked"].includes(intent) ? intent : p.item.status;
          setStatus(pre);
          setProgress(p.item.progress_pct);
          setMilestones(p.milestones);
        }
      } catch {
        if (alive) setErrorKind("network");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token, intent]);

  // Human-engagement beacon. POST only. GET (this page load / task-link) writes nothing.
  useEffect(() => {
    if (!data || errorKind) return;
    let sentEngaged = false;
    const started = Date.now();

    const post = (event: "task.link.rendered" | "task.link.engaged", reason: string) => {
      const payload = JSON.stringify({
        token,
        event,
        reason,
        ms_on_page: Date.now() - started,
        visible: typeof document !== "undefined" && document.visibilityState === "visible",
      });
      try {
        const blob = new Blob([payload], { type: "application/json" });
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/task-engaged", blob);
          return;
        }
      } catch {
        /* fall through to fetch */
      }
      void fetch("/api/task-engaged", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    };

    post("task.link.rendered", "js");

    const engaged = (reason: string) => {
      if (sentEngaged) return;
      sentEngaged = true;
      post("task.link.engaged", reason);
    };

    const onSignal = (ev: Event) => engaged(ev.type);
    ["pointermove", "keydown", "scroll", "click", "touchstart"].forEach((name) => {
      window.addEventListener(name, onSignal, { once: true, passive: true });
    });
    const dwell = window.setTimeout(() => {
      if (document.visibilityState === "visible") engaged("dwell_3s");
    }, 3000);

    return () => {
      window.clearTimeout(dwell);
      ["pointermove", "keydown", "scroll", "click", "touchstart"].forEach((name) => {
        window.removeEventListener(name, onSignal);
      });
    };
  }, [data, errorKind, token]);

  const save = async () => {
    if (status === "blocked" && !note.trim()) {
      setSaveError("Tell us what's blocking you — a blocker without a reason isn't information.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${FN_BASE}/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          progress_pct: status === "done" ? 100 : progress,
          note: note.trim() || undefined,
          milestones: milestones.map((m) => ({ id: m.id, is_done: m.is_done })),
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) {
        setSaveError(body.error === "rate_limited" ? "Too many updates — try again in an hour." : "Couldn't save. Try again.");
      } else {
        setSaved(true);
        setOwnerNotified(body.ownerNotified === true);
        setNote("");
        if (status === "done") setProgress(100);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setSaveError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#0a0c0b] text-[#e8ede9]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-14 pt-6">
        <header className="mb-6 flex items-center justify-between">
          <span className="text-sm font-black tracking-[0.35em] text-[#d4a550]">MILŌN</span>
          {data?.plan?.period_label && (
            <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8a938c]">
              {data.plan.period_label}
            </span>
          )}
        </header>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(<p className="mt-16 text-center text-sm text-[#8a938c]">Loading your task…</p>);
  }

  if (errorKind || !data) {
    const msg =
      errorKind === "expired"
        ? "This link has expired. Ask your plan owner to resend it."
        : errorKind === "revoked"
          ? "This task was reassigned — this link no longer works. If that seems wrong, ask your plan owner to resend it."
          : errorKind === "network"
            ? "Couldn't reach the server. Check your connection and reload."
            : "This link isn't valid. Ask your plan owner to resend it.";
    return shell(
      <div className="mt-14 rounded-xl border border-white/10 bg-[#10130f] p-6 text-center">
        <p className="text-sm leading-relaxed text-[#e8ede9]">{msg}</p>
      </div>,
    );
  }

  const { item, plan } = data;
  const done = status === "done";
  const daysLeft = item.days_remaining;
  const dueStr = fmtDate(item.due_date);
  // Pace marker: where the task *should* be today.
  const expectedPct = (() => {
    if (!item.due_date) return null;
    const created = new Date(item.updated_at).getTime(); // conservative fallback
    const due = new Date(item.due_date + "T23:59:59").getTime();
    const now = Date.now();
    if (due <= created) return 100;
    return Math.max(0, Math.min(100, Math.round(((now - created) / (due - created)) * 100)));
  })();

  return shell(
    <>
      {saved && (
        <div className="mb-5 rounded-lg border border-[#22c55e]/30 bg-[#22c55e]/10 px-4 py-3 text-sm text-[#22c55e]">
          Saved.{" "}
          {ownerNotified
            ? `${data.business_name ?? "Your plan owner"} has been notified by email.`
            : "Your update has been recorded."}
        </div>
      )}

      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">Your task</p>
      <h1 className="mt-2 text-[26px] font-black uppercase leading-[1.05] tracking-tight text-[#e8ede9]">
        {item.title}
      </h1>
      {(dueStr || daysLeft != null) && (
        <p className="mt-3 text-sm text-[#8a938c]">
          {dueStr && <>Due {dueStr}</>}
          {daysLeft != null && (
            <span className={daysLeft < 0 ? "ml-2 font-bold text-[#ef4444]" : "ml-2 text-[#d4a550]"}>
              {daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `· ${daysLeft} days left`}
            </span>
          )}
        </p>
      )}

      {item.outcome_why && (
        <div className="mt-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">Why this matters</p>
          <p className="mt-2 text-sm leading-relaxed text-[#c6cec8]">{item.outcome_why}</p>
          {plan?.outcome_goal && (
            <p className="mt-2 text-xs text-[#8a938c]">It moves the company toward: {plan.outcome_goal}</p>
          )}
        </div>
      )}

      {/* Status */}
      <div className="mt-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">Where are you?</p>
        <div className="mt-3 space-y-2">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { setStatus(o.value); setSaved(false); }}
              className={`flex w-full items-center gap-3 rounded-[10px] border px-4 py-3.5 text-left text-sm font-semibold transition-colors ${
                status === o.value
                  ? o.value === "blocked"
                    ? "border-[#ef4444]/60 bg-[#ef4444]/10 text-[#ef4444]"
                    : "border-[#22c55e]/60 bg-[#22c55e]/10 text-[#e8ede9]"
                  : "border-white/10 bg-[#10130f] text-[#8a938c] active:bg-[#161a15]"
              }`}
            >
              <span
                className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                  status === o.value
                    ? o.value === "blocked"
                      ? "border-[#ef4444] bg-[#ef4444]"
                      : "border-[#22c55e] bg-[#22c55e]"
                    : "border-[#8a938c]/50"
                }`}
              />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Progress */}
      {!done && status !== "blocked" && (
        <div className="mt-7">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">Progress</p>
            <span className="text-lg font-black tabular-nums" style={{ color: GOLD }}>{progress}%</span>
          </div>
          <div className="relative mt-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => { setProgress(Number(e.target.value)); setSaved(false); }}
              className="w-full accent-[#d4a550]"
              aria-label="Progress percentage"
            />
            {expectedPct != null && (
              <div
                className="pointer-events-none absolute -top-1 h-5 w-0.5 bg-[#8a938c]"
                style={{ left: `${expectedPct}%` }}
                title="Where you should be today"
              />
            )}
          </div>
          {expectedPct != null && (
            <p className="mt-1 text-[11px] text-[#8a938c]">
              The grey tick is where this should be today.
            </p>
          )}
        </div>
      )}

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="mt-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">This week</p>
          <div className="mt-3 space-y-1.5">
            {milestones.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMilestones((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_done: !x.is_done } : x)));
                  setSaved(false);
                }}
                className="flex w-full items-center gap-3 rounded-[10px] border border-white/10 bg-[#10130f] px-4 py-3 text-left text-sm active:bg-[#161a15]"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-black ${
                    m.is_done ? "border-[#22c55e] bg-[#22c55e] text-[#0a0c0b]" : "border-[#8a938c]/50 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="w-7 shrink-0 text-[11px] font-bold text-[#8a938c]">W{m.week_no}</span>
                <span className={m.is_done ? "text-[#8a938c] line-through" : "text-[#e8ede9]"}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Note */}
      <div className="mt-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">
          {status === "blocked" ? "What's blocking you? (required)" : "Anything they should know?"}
        </p>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); setSaved(false); }}
          rows={3}
          className={`mt-3 w-full rounded-[10px] border bg-[#10130f] px-4 py-3 text-sm text-[#e8ede9] placeholder:text-[#8a938c]/60 focus:outline-none ${
            status === "blocked" && !note.trim() ? "border-[#ef4444]/50" : "border-white/10 focus:border-[#d4a550]/50"
          }`}
          placeholder={status === "blocked" ? "e.g. Waiting on the bank statements from…" : "Optional short note"}
        />
      </div>

      {saveError && <p className="mt-3 text-sm text-[#ef4444]">{saveError}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-6 w-full rounded-[10px] px-4 py-4 text-sm font-black uppercase tracking-[0.2em] text-[#0a0c0b] transition-opacity disabled:opacity-60"
        style={{ background: status === "blocked" ? "#ef4444" : "#22c55e" }}
      >
        {saving ? "Saving…" : intent === "done" && status === "done" ? "Mark as done" : "Save update"}
      </button>

      <p className="mt-4 text-center text-[11px] text-[#8a938c]">
        Last updated {new Date(item.updated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} ·
        This page shows only your task.
      </p>
    </>,
  );
}
