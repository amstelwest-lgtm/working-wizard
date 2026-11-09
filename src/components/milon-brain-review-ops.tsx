import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { BrainReviewQueueItem } from "@/lib/milon-brain-review";
import {
  approveMilonBrainReviewRow,
  listMilonBrainReviewQueue,
  rejectMilonBrainReviewRow,
  runMilonBrainReview,
} from "@/lib/milon-brain-review-client";
import { supabase } from "@/integrations/supabase/client";

export function MilonBrainReviewOpsPanel() {
  const [items, setItems] = useState<BrainReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        setItems([]);
        return;
      }
      const res = await listMilonBrainReviewQueue(token);
      if (!res.ok) {
        toast.error(res.error === "forbidden" ? "Ops access required." : "Could not load brain queue.");
        setItems([]);
        return;
      }
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function withToken(run: (token: string) => Promise<{ ok: boolean; error?: string }>) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      toast.error("Sign in required.");
      return;
    }
    const res = await run(token);
    if (!res.ok) toast.error(res.error ?? "Request failed.");
    else await load();
  }

  return (
    <section className="mt-8 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-panel)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ops-ink-dim)]">
          Brain review queue
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading || busy !== null}
            onClick={() => {
              setBusy("run");
              void withToken(async (token) => {
                const res = await runMilonBrainReview(token);
                if (res.ok && "created" in res) {
                  toast.success(`Review run: ${res.created} new, ${res.skippedExisting} skipped.`);
                }
                return res;
              }).finally(() => setBusy(null));
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--ops-line)] px-3 py-1.5 text-xs font-semibold text-[var(--ops-ink-soft)] hover:text-[var(--ops-amber)]"
          >
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run pattern scan
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="rounded-lg border border-[var(--ops-line)] px-3 py-1.5 text-xs font-semibold text-[var(--ops-ink-soft)]"
          >
            Refresh
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-[var(--ops-ink-dim)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--ops-ink-dim)]">No pending lesson candidates or feature ideas.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-[var(--ops-line)] bg-[var(--ops-bg)] px-3 py-2 text-sm text-[var(--ops-ink-soft)]"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]">
                <span>{row.kind === "feature_idea" ? "Feature idea" : "Lesson candidate"}</span>
                <span>{row.task_type}</span>
                {row.firm_id ? <span>firm scoped</span> : <span>milon_wide</span>}
              </div>
              <p className="mb-2 leading-snug">{row.rule_text}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => {
                    setBusy(row.id);
                    void withToken((token) => approveMilonBrainReviewRow(token, row.id)).finally(() =>
                      setBusy(null),
                    );
                  }}
                  className="rounded-md bg-[var(--ops-amber-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--ops-amber)]"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => {
                    setBusy(row.id);
                    void withToken((token) => rejectMilonBrainReviewRow(token, row.id)).finally(() =>
                      setBusy(null),
                    );
                  }}
                  className="rounded-md border border-[var(--ops-line)] px-2.5 py-1 text-xs font-semibold"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
