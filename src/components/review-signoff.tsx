import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PenLine, Check, AlertTriangle, Loader2, Eraser } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import {
  signoffReview,
  removeReviewSignoff,
  type ClientReviewSignoff,
  type ReviewScope,
} from "@/lib/review-signoffs.functions";

export const SCOPE_LABEL: Record<ReviewScope, string> = {
  financials: "this period's financials / health",
  profitability: "the profitability waterfall",
  cash_forecast: "the cash forecast",
  budget: "the FY budget",
  action_plan: "the action plan",
  advisory: "this advisory pack",
};

export const SCOPE_SHORT_LABEL: Record<ReviewScope, string> = {
  financials: "health & ratios",
  profitability: "profitability",
  cash_forecast: "cash forecast",
  budget: "budget",
  action_plan: "action plan",
  advisory: "advisory",
};

/** Gold pill used for the unsigned / re-sign CTA. */
export const SIGNOFF_GOLD_BTN =
  "inline-flex items-center gap-2 rounded-full border-0 bg-[linear-gradient(120deg,#ac8400,#d4af37_40%,#fdee79_60%,#d4af37_80%,#ac8400)] bg-[length:200%_auto] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1b1300] shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:shadow-[0_8px_30px_rgba(212,175,55,0.5)] hover:brightness-105";

const GOLD = "#d4a550";
const GOLD_DEEP = "#b8860b";

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function signerLine(signoff: ClientReviewSignoff): string {
  const initials = signoff.signed_off_by_initials?.trim();
  const name = signoff.signed_off_by_name;
  const title = signoff.signed_off_by_title ? ` ${signoff.signed_off_by_title}` : "";
  if (initials) return `${initials} · ${name}${title}`;
  return `${name}${title}`;
}

function SignoffCertificate({
  signoff,
  scope,
  isStale,
  compact = false,
}: {
  signoff: ClientReviewSignoff;
  scope: ReviewScope;
  isStale: boolean;
  compact?: boolean;
}) {
  const initials = (signoff.signed_off_by_initials || signoff.signed_off_by_name.slice(0, 2)).toUpperCase();

  if (compact) {
    return (
      <div
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#d4a550]/45 bg-gradient-to-r from-[#d4a550]/15 to-[#fdee79]/10 px-2.5 py-1"
        title={
          isStale
            ? `Reviewed by ${signerLine(signoff)} on ${formatDateTime(signoff.signed_off_at)} — data has changed since`
            : `Reviewed by ${signerLine(signoff)} on ${formatDateTime(signoff.signed_off_at)}`
        }
      >
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-black"
          style={{
            background: "linear-gradient(145deg,#fdee79,#ac8400)",
            color: "#1b1300",
          }}
        >
          {isStale ? "!" : initials.slice(0, 2)}
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a6508] dark:text-[#e1b85e]">
          {isStale ? "Needs re-review" : "Signed off"}
        </span>
      </div>
    );
  }

  return (
    <div
      data-signoff-certificate
      className="relative overflow-hidden rounded-2xl border border-[#d4a550]/40 p-4 shadow-[0_16px_40px_rgba(109,79,22,0.12)]"
      style={{
        background:
          "radial-gradient(circle at 100% 0%, rgba(253,238,121,0.22), transparent 42%), linear-gradient(135deg, rgba(212,165,80,0.14), rgba(255,253,248,0.92) 38%, rgba(248,241,222,0.95))",
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#ac8400,#fdee79,#ac8400)]" />
      <div className="flex items-start gap-3">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-xs font-black tracking-wide shadow-[0_0_0_4px_rgba(212,165,80,0.18)]"
          style={{
            background: "linear-gradient(145deg,#fdee79,#d4af37 45%,#ac8400)",
            color: "#1b1300",
          }}
        >
          {isStale ? <AlertTriangle className="h-5 w-5" /> : initials.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#8a6508] dark:text-[#e1b85e]">
              {isStale ? "Needs re-review" : "Reviewed & signed off"}
            </span>
            <span className="text-[10px] tabular-nums text-[#6b6354] dark:text-slate-400">
              {formatDateTime(signoff.signed_off_at)}
            </span>
          </div>
          <div className="mt-1 text-sm font-semibold text-[#1b1608] dark:text-[#f2ecdc]">
            {signerLine(signoff)}
            {signoff.firm_name ? ` · ${signoff.firm_name}` : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-[#6b6354] dark:text-slate-400">
            {SCOPE_SHORT_LABEL[scope]}
          </div>
          {signoff.signature_data && (
            <img
              src={signoff.signature_data}
              alt={`Signature of ${signoff.signed_off_by_name}`}
              className="mt-2 h-12 w-auto max-w-[220px] object-contain object-left"
            />
          )}
          {!signoff.signature_data && (
            <div
              className="mt-2 text-xl leading-none text-[#8a6508] dark:text-[#e1b85e]"
              style={{ fontFamily: "Georgia, 'Palatino Linotype', serif", fontStyle: "italic" }}
            >
              {signoff.signed_off_by_name}
            </div>
          )}
          {isStale && (
            <p className="mt-2 text-[11px] text-[#b8860b]">
              {SCOPE_LABEL[scope]} {scope === "cash_forecast" || scope === "budget" ? "has" : "have"} changed since this review.
            </p>
          )}
          {signoff.note && !isStale && (
            <p className="mt-2 text-[11px] italic text-[#6b6354] dark:text-slate-400">
              &ldquo;{signoff.note}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const stroked = useRef(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 360;
    const h = canvas.clientHeight || 110;
    canvas.width = Math.floor(w * ratio);
    canvas.height = Math.floor(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = GOLD_DEEP;
    ctx.lineWidth = 2.2;
    ctx.clearRect(0, 0, w, h);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, h);
      img.src = value;
    }
  }, [value]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const commit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-xs text-slate-300">Your signature</Label>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400 hover:text-[#d4a550]"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            stroked.current = false;
            onChange(null);
          }}
        >
          <Eraser className="h-3 w-3" /> Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-[110px] w-full cursor-crosshair touch-none rounded-lg border border-[#d4a550]/35 bg-[#fffdf8]"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d");
          if (!ctx) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          stroked.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (stroked.current) commit();
        }}
        onPointerLeave={() => {
          if (drawing.current) {
            drawing.current = false;
            if (stroked.current) commit();
          }
        }}
      />
      <p className="mt-1 text-[10px] text-slate-500">Draw with your mouse or finger. Saved to this deliverable only.</p>
    </div>
  );
}

/**
 * Read-only sign-off certificate for the client-facing (owner) side.
 * Renders nothing when there has never been a sign-off for this scope.
 */
export function ReviewSignoffBadge({
  signoff,
  scope,
  isStale,
  compact = false,
}: {
  signoff: ClientReviewSignoff | null;
  scope: ReviewScope;
  isStale: boolean;
  compact?: boolean;
}) {
  if (!signoff) return null;
  return <SignoffCertificate signoff={signoff} scope={scope} isStale={isStale} compact={compact} />;
}

/**
 * Accountant-facing gold sign-off control. Renders the current certificate
 * (signed / stale / unsigned) with the appropriate action inline.
 */
export function ReviewSignoffButton({
  clientId,
  clientName,
  scope,
  signoff,
  isStale,
  onChange,
}: {
  clientId: string;
  clientName?: string;
  scope: ReviewScope;
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  onChange: (next: ClientReviewSignoff | null) => void;
}) {
  const { profile, updateProfile } = useAccountantProfile();
  const doSignoff = useServerFn(signoffReview);
  const doRemove = useServerFn(removeReviewSignoff);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState<string | null>(profile.signatureDataUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleSignoff = async () => {
    setSaving(true);
    try {
      if (signature) updateProfile({ signatureDataUrl: signature });
      const row = await doSignoff({
        data: {
          clientId,
          scope,
          accountantTitle: null,
          firmName: profile.firmName?.trim() || null,
          note: note.trim() || null,
          signatureData: signature,
        },
      });
      onChange(row);
      setOpen(false);
      setNote("");
      toast.success(`Signed off ${SCOPE_SHORT_LABEL[scope]}`);
    } catch (e) {
      toast.error(`Could not save sign-off: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await doRemove({ data: { clientId, scope } });
      onChange(null);
      setConfirmRemove(false);
      toast.success("Sign-off removed");
    } catch (e) {
      toast.error(`Could not remove sign-off: ${(e as Error).message}`);
    } finally {
      setRemoving(false);
    }
  };

  if (signoff && !isStale) {
    return (
      <div className="mt-2 w-full max-w-md">
        <SignoffCertificate signoff={signoff} scope={scope} isStale={false} />
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          className="mt-1.5 text-[10px] uppercase tracking-wider text-slate-500 hover:text-[#d4a550] transition"
        >
          Remove sign-off
        </button>

        <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <DialogContent className="border-[#d4a550]/25 bg-[#0d1117] text-slate-100">
            <DialogHeader>
              <DialogTitle>Remove sign-off?</DialogTitle>
              <DialogDescription className="text-slate-400">
                The client will no longer see your endorsement on {SCOPE_LABEL[scope]}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={removing}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRemove} disabled={removing}>
                {removing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Remove sign-off
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="mt-2 flex w-full max-w-md flex-col items-end gap-2">
      {signoff && isStale && (
        <SignoffCertificate signoff={signoff} scope={scope} isStale />
      )}
      <button
        type="button"
        onClick={() => {
          setSignature(profile.signatureDataUrl ?? null);
          setOpen(true);
        }}
        className={SIGNOFF_GOLD_BTN}
      >
        <PenLine className="h-3.5 w-3.5" />
        {signoff && isStale ? "Re-sign off" : "Sign off"} {SCOPE_SHORT_LABEL[scope]}
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setSignature(profile.signatureDataUrl ?? null);
        }}
      >
        <DialogContent className="border-[#d4a550]/30 bg-[#0d1117] text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#e1b85e]">Sign off {SCOPE_LABEL[scope]}</DialogTitle>
            <DialogDescription className="text-slate-400">
              You are formally endorsing {SCOPE_LABEL[scope]}
              {clientName ? ` for ${clientName}` : ""}. Your name, date and signature are logged
              on this deliverable only — not across the whole profile.
            </DialogDescription>
          </DialogHeader>
          <SignaturePad value={signature} onChange={setSignature} />
          <div className="space-y-2">
            <Label htmlFor={`signoff-note-${scope}`} className="text-xs text-slate-300">
              Add a note (optional)
            </Label>
            <Textarea
              id={`signoff-note-${scope}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Reconciled against bank statements for this period"
              rows={3}
              className="resize-none border-slate-800 bg-slate-950 text-sm text-slate-100"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <button type="button" onClick={handleSignoff} disabled={saving} className={SIGNOFF_GOLD_BTN}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Sign off
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Compares a sign-off's timestamp against the freshness timestamp of the scope's
 * underlying data to determine whether the sign-off is still current. */
export function computeIsStale(
  signoff: ClientReviewSignoff | null,
  dataUpdatedAt: string | null | undefined,
): boolean {
  if (!signoff) return false;
  if (!dataUpdatedAt) return false;
  return new Date(dataUpdatedAt).getTime() > new Date(signoff.signed_off_at).getTime();
}
