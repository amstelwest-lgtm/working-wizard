/**
 * Lighthouse — Milōn IT section: tagged client notes + IT team list.
 */

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Loader2, Plus, RefreshCw, Shield, Trash2, Users } from "lucide-react";
import {
  addLighthouseItMember,
  getLighthouseItBoard,
  removeLighthouseItMember,
  type LighthouseItBoard,
} from "@/lib/lighthouse-it.functions";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LighthouseItPanel() {
  const load = useServerFn(getLighthouseItBoard);
  const addMember = useServerFn(addLighthouseItMember);
  const removeMember = useServerFn(removeLighthouseItMember);

  const [board, setBoard] = useState<LighthouseItBoard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setBoard(await load());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load IT queries");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitMember = async () => {
    if (!email.trim()) return;
    setSaving(true);
    try {
      await addMember({ data: { email: email.trim(), name: name.trim() || undefined } });
      setEmail("");
      setName("");
      toast.success("IT member added — they receive tagged notes in this inbox");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add member");
    } finally {
      setSaving(false);
    }
  };

  if (busy && !board) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--ops-ink-dim)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading Milōn IT…
      </div>
    );
  }

  if (err && !board) {
    return (
      <div className="rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-5 text-sm text-[var(--ops-danger-ink)]">
        {err}
      </div>
    );
  }
  if (!board) return null;

  const openQueries = board.queries.filter((q) => !q.resolved);
  const resolvedQueries = board.queries.filter((q) => q.resolved);

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-serif text-2xl tracking-tight text-[var(--ops-ink)]">Milōn IT</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ops-ink-dim)]">
          Shared inbox for notes tagged Milōn IT. Access control and (for the platform owner) pilot
          knobs live in this section too. Every member has master access to customer profiles.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          {board.migrationHint && (
            <div className="mb-4 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
              {board.migrationHint}
            </div>
          )}
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-amber)]">
              <Shield className="mr-1 inline h-3.5 w-3.5" />
              IT queries · {openQueries.length} open
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-amber)]"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>
          {openQueries.length === 0 && (
            <p className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-4 py-8 text-center text-sm text-[var(--ops-ink-dim)]">
              No open IT queries. Tag Milōn IT on a client note to send it here.
            </p>
          )}
          <div className="space-y-3">
            {openQueries.map((q) => (
              <article
                key={q.id}
                className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ops-ink-dim)]">
                  <span className="font-semibold text-[var(--ops-ink-soft)]">{q.clientName}</span>
                  {q.tab ? <span>· {q.tab}</span> : null}
                  <span>· {fmtTime(q.taggedAt)}</span>
                  <span>· {q.authorName}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-[var(--ops-ink)]">{q.body}</p>
                <a
                  href={q.profilePath}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ops-amber)] hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open this note on the customer profile
                </a>
              </article>
            ))}
          </div>
          {resolvedQueries.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-ink-dim)]">
                Resolved · {resolvedQueries.length}
              </div>
              <div className="space-y-2">
                {resolvedQueries.map((q) => (
                  <article
                    key={q.id}
                    className="rounded-xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-4 py-3 opacity-70"
                  >
                    <div className="mb-1 text-[11px] text-[var(--ops-ink-dim)]">
                      {q.clientName} · {fmtTime(q.taggedAt)}
                    </div>
                    <p className="truncate text-sm text-[var(--ops-ink-soft)]">{q.body}</p>
                    <a
                      href={q.profilePath}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ops-amber)] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open note
                    </a>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-amber)]">
            <Users className="h-3.5 w-3.5" /> IT team
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-[var(--ops-ink-dim)]">
            Shared inbox — every IT member sees the same tagged notes as soon as someone tags Milōn
            IT. Members also have master access to every customer profile so they can open a note in
            place. They are emailed when a note is tagged.
          </p>
          <ul className="mb-4 space-y-2">
            {board.members.length === 0 && (
              <li className="text-[12px] text-[var(--ops-ink-dim)]">No IT members yet.</li>
            )}
            {board.members.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-2 rounded-xl border border-[var(--ops-line)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[var(--ops-ink-soft)]">
                    {m.name || m.email}
                  </div>
                  <div className="truncate text-[11px] text-[var(--ops-ink-dim)]">{m.email}</div>
                </div>
                <button
                  type="button"
                  title="Remove"
                  onClick={() =>
                    void removeMember({ data: { id: m.id } })
                      .then(() => refresh())
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Remove failed"))
                  }
                  className="rounded p-1 text-[var(--ops-ink-dim)] hover:text-[var(--ops-danger-ink)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <input
              className="ops-input w-full"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="ops-input w-full"
              type="email"
              placeholder="it@milon.co.za"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitMember();
              }}
            />
            <button
              type="button"
              disabled={saving || !email.trim()}
              onClick={() => void submitMember()}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {saving ? "Adding…" : "Add IT member"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
