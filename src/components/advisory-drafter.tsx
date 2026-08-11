import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Copy,
  Check,
  Mail,
  ListChecks,
  FileText,
  MessageCircle,
} from "lucide-react";
import { draftAdvisory } from "@/lib/advisory.functions";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  type DeliveryKind,
} from "@/lib/advisory-deliveries";

type Kind = "client_email" | "meeting_agenda" | "exec_summary";

type DraftResult = {
  kind: Kind;
  subject: string | null;
  body: string;
  grounding: {
    currentPeriod: string;
    priorPeriod: string | null;
    movementCount: number;
    signoffCount: number;
  };
};

const KIND_META: Record<Kind, { label: string; icon: typeof Mail; hint: string }> = {
  client_email: { label: "Client email", icon: Mail, hint: "Ready-to-send email to the owner" },
  meeting_agenda: {
    label: "Meeting agenda",
    icon: ListChecks,
    hint: "Agenda for this month's advisory session",
  },
  exec_summary: {
    label: "Exec summary",
    icon: FileText,
    hint: "30-second state-of-the-business paragraph",
  },
};

function kindToDelivery(kind: Kind): DeliveryKind {
  if (kind === "meeting_agenda") return "meeting_agenda";
  if (kind === "exec_summary") return "exec_summary";
  return "advisory_draft";
}

export function AdvisoryDrafter({
  clientId,
  clientName,
  onLogged,
}: {
  clientId: string;
  clientName?: string;
  onLogged?: () => void;
}) {
  const { profile } = useAccountantProfile();
  const { user } = useAuth();
  const run = useServerFn(draftAdvisory);

  const [kind, setKind] = useState<Kind>("client_email");
  const [steer, setSteer] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = (await run({
        data: {
          clientId,
          kind,
          firmName: profile.firmName || undefined,
          accountantName: profile.accountantName || undefined,
          tagline: profile.tagline ?? undefined,
          steer: steer.trim() || undefined,
        },
      })) as DraftResult;
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not draft advisory");
    } finally {
      setLoading(false);
    }
  };

  const logShare = async (
    channel: "copy" | "mailto" | "whatsapp",
    draft: DraftResult,
  ) => {
    if (!user) return;
    const snapId = await latestSnapshotId(clientId);
    await recordDelivery({
      clientId,
      channel,
      kind: kindToDelivery(draft.kind),
      subject: draft.subject,
      body: draft.body,
      snapshotId: snapId,
      figuresHash: hashFigures({
        period: draft.grounding.currentPeriod,
        prior: draft.grounding.priorPeriod,
        movements: draft.grounding.movementCount,
      }),
      periodLabel: draft.grounding.currentPeriod,
      createdBy: user.id,
    });
    onLogged?.();
  };

  const copy = async () => {
    if (!result) return;
    const text = result.subject ? `Subject: ${result.subject}\n\n${result.body}` : result.body;
    try {
      await navigator.clipboard.writeText(text);
      await logShare("copy", result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("Copied · logged to sent history");
    } catch {
      toast.error("Copy failed");
    }
  };

  const openMailto = async () => {
    if (!result) return;
    await logShare("mailto", result);
    const subject = encodeURIComponent(result.subject ?? `${clientName ?? "Client"} — advisory`);
    const body = encodeURIComponent(result.body);
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const openWhatsApp = async () => {
    if (!result) return;
    await logShare("whatsapp", result);
    const text = result.subject ? `*${result.subject}*\n\n${result.body}` : result.body;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="rounded-xl border border-amber-500/20 bg-slate-900/60 p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-100">
          Advisory drafter{clientName ? ` — ${clientName}` : ""}
        </h3>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Drafts a deliverable from this client&apos;s real movement and your signed-off moves, in
        your voice. Copy / mailto / WhatsApp are logged to Sent history (share opened — not postal
        proof).
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {(Object.keys(KIND_META) as Kind[]).map((k) => {
          const M = KIND_META[k];
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition ${
                active
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-100"
                  : "border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700"
              }`}
              title={M.hint}
            >
              <M.icon className="h-4 w-4" />
              <span className="text-[11px] font-medium">{M.label}</span>
            </button>
          );
        })}
      </div>

      <textarea
        value={steer}
        onChange={(e) => setSteer(e.target.value)}
        rows={2}
        placeholder="Optional steer — e.g. 'keep it warm, first-time owner' or 'push on debtor days this month'"
        className="mt-3 w-full resize-none rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:outline-none"
      />

      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Drafting…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" /> {result ? "Regenerate" : "Draft"}
          </>
        )}
      </button>

      {result && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              {KIND_META[result.kind].label}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500/50"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={openMailto}
                className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500/50"
              >
                <Mail className="h-3 w-3" />
                Mailto
              </button>
              <button
                type="button"
                onClick={openWhatsApp}
                className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500/50"
              >
                <MessageCircle className="h-3 w-3" />
                WhatsApp
              </button>
            </div>
          </div>
          {result.subject && (
            <p className="mb-2 text-sm font-semibold text-amber-100">{result.subject}</p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{result.body}</p>
          <p className="mt-3 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
            Grounded in {result.grounding.currentPeriod}
            {result.grounding.priorPeriod ? ` vs ${result.grounding.priorPeriod}` : " (baseline)"} ·{" "}
            {result.grounding.movementCount} movements · {result.grounding.signoffCount} signed-off
            moves
          </p>
        </div>
      )}
    </div>
  );
}
