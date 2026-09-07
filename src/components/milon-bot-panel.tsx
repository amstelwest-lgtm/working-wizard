/**
 * Thin in-app Milōn bot chat — worker bee on the current client brain.
 * Coexists with Ask AI. Not a portal rewrite.
 */

import { useMemo, useState } from "react";
import { invokeMilonBot, type MilonBotAudience } from "@/lib/milon-bot-client";

type ChatLine = { role: "user" | "assistant"; content: string };

const ACCOUNTANT_CHIPS = [
  "What's outstanding on this client?",
  "Invite status?",
  "Propose next steps from the brain",
  "Draft an advisory from what's on file",
];

const OWNER_CHIPS = [
  "What's still outstanding?",
  "What's on file in the brain?",
  "Propose next steps",
];

function toolLabel(name: string, status: string): string {
  const labels: Record<string, string> = {
    get_invite_status: "Invite status",
    list_blockers: "Blockers",
    propose_next_steps: "Propose",
    draft_deliverable: "Draft",
    answer_from_brain: "Brain",
  };
  const base = labels[name] ?? name;
  if (status === "empty") return `${base} · empty`;
  if (status === "error") return `${base} · failed`;
  return base;
}

export function MilonBotPanel({
  clientId,
  audience,
  surface,
}: {
  clientId: string | null;
  audience: MilonBotAudience;
  surface: "portal" | "board";
}) {
  const [open, setOpen] = useState(surface === "portal");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolHints, setToolHints] = useState<string[]>([]);

  const chips = useMemo(
    () => (audience === "accountant" ? ACCOUNTANT_CHIPS : OWNER_CHIPS),
    [audience],
  );

  if (!clientId) return null;

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    const nextLines: ChatLine[] = [...lines, { role: "user", content: message }];
    setLines(nextLines);
    try {
      const result = await invokeMilonBot({
        clientId,
        message,
        history: nextLines.slice(0, -1).slice(-8),
        audience,
      });
      setToolHints(result.tools.map((t) => toolLabel(t.name, t.status)));
      setLines([...nextLines, { role: "assistant", content: result.answer }]);
    } catch (e) {
      setError((e as Error).message || "Milōn bot failed");
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(input);
      }}
      style={{ display: "flex", gap: 8, marginTop: 10 }}
    >
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        placeholder="Ask the worker bee…"
        aria-label="Message the Milōn bot"
        className={surface === "board" ? "min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" : undefined}
        style={
          surface === "portal"
            ? {
                flex: 1,
                minWidth: 0,
                border: "1px solid var(--line)",
                background: "var(--bg-2)",
                color: "var(--ink)",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 13,
              }
            : undefined
        }
      />
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className={surface === "portal" ? "btn gold mini" : "rounded-lg bg-[#d4a550] px-3 py-1.5 text-xs font-semibold text-[#0a0e1a] disabled:opacity-50"}
      >
        {busy ? "…" : "Send"}
      </button>
    </form>
  );

  const body = (
    <>
      <p className={surface === "portal" ? "sub" : "text-xs text-slate-500 dark:text-slate-400"}>
        Worker bee on this client. Ask AI stays for numbers questions. Empty stays empty.
      </p>
      {lines.length > 0 && (
        <div
          className={surface === "board" ? "mt-2 max-h-52 space-y-2 overflow-y-auto text-sm" : undefined}
          style={
            surface === "portal"
              ? { marginTop: 10, maxHeight: 220, overflowY: "auto", display: "grid", gap: 8 }
              : undefined
          }
        >
          {lines.map((line, i) => (
            <p
              key={`${line.role}-${i}`}
              className={
                surface === "board"
                  ? line.role === "user"
                    ? "text-slate-800 dark:text-slate-100"
                    : "text-slate-600 dark:text-slate-300"
                  : undefined
              }
              style={
                surface === "portal"
                  ? { margin: 0, color: line.role === "user" ? "var(--ink)" : "var(--ink-dim)", fontSize: 13 }
                  : undefined
              }
            >
              <span style={{ fontWeight: 600 }}>{line.role === "user" ? "You · " : "Milōn · "}</span>
              {line.content}
            </p>
          ))}
        </div>
      )}
      {toolHints.length > 0 && (
        <p
          className={surface === "board" ? "mt-1.5 text-[10px] uppercase tracking-[0.14em] text-[#b8860b]" : undefined}
          style={surface === "portal" ? { marginTop: 8, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" } : undefined}
        >
          {toolHints.join(" · ")}
        </p>
      )}
      {error && (
        <p className={surface === "board" ? "mt-1.5 text-xs text-red-600" : undefined} style={surface === "portal" ? { marginTop: 8, color: "var(--bad)", fontSize: 12 } : undefined}>
          {error}
        </p>
      )}
      <div className={surface === "board" ? "mt-2 flex flex-wrap gap-1.5" : undefined} style={surface === "portal" ? { marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 } : undefined}>
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => void send(chip)}
            className={
              surface === "board"
                ? "rounded-full border border-[#d4a550]/35 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-[#d4a550]/10 disabled:opacity-50 dark:text-slate-300"
                : "btn ghost mini"
            }
          >
            {chip}
          </button>
        ))}
      </div>
      {form}
    </>
  );

  if (surface === "board") {
    return (
      <div
        id="milon-bot-owner"
        className="flex flex-col gap-1 rounded-xl border border-[#d4a550]/30 bg-white/80 px-3.5 py-2.5 dark:bg-[#0a1020]/80"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={open}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b] dark:text-[#d4a550]">
            Milōn bot
          </span>
          <span className="text-[11px] text-slate-500">{open ? "Hide" : "Open"}</span>
        </button>
        {open && body}
      </div>
    );
  }

  return (
    <div id="milon-bot-summary" className="card pad" style={{ marginBottom: 18 }}>
      <span className="eyebrow">Milōn bot</span>
      <h3 className="h-sec" style={{ marginBottom: 4, fontSize: 18 }}>
        Worker bee · this client
      </h3>
      {body}
    </div>
  );
}
