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
  getDeliverableWorkflow,
  submitDeliverable,
  requestDeliverableChanges,
  type ClientReviewSignoff,
  type DeliverableWorkflow,
  type ReviewScope,
} from "@/lib/review-signoffs.functions";
import { isSamplePracticeSignoff } from "@/lib/review-signoff-stamp";
import { signoffStatusLine } from "@/lib/signoff-status";
import { PremiumSteps } from "@/components/premium/premium-ui";
import { formatReviewDateTime } from "@/lib/market/format";
import { useMarketFormat } from "@/contexts/market";

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

/**
 * Primary sign-off / approve pill. The export name stays SIGNOFF_GOLD_BTN.
 * Paint is cobalt because the confirm button is portaled outside `.accountant-portal`,
 * so a portal stylesheet cannot recolor it.
 */
export const SIGNOFF_GOLD_BTN =
  "signoff-primary inline-flex items-center gap-2 bg-[#0B5FFF] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-none transition hover:bg-[#2563EB]";

const GOLD_DEEP = "#102A43";

function signerLine(signoff: ClientReviewSignoff): string {
  const initials = signoff.signed_off_by_initials?.trim();
  const name = signoff.signed_off_by_name;
  const title = signoff.signed_off_by_title ? ` ${signoff.signed_off_by_title}` : "";
  if (initials) return `${initials} · ${name}${title}`;
  return `${name}${title}`;
}

export type SignoffPlacement = "block" | "compact" | "corner";

function SignoffCertificate({
  signoff,
  scope,
  isStale,
  placement = "block",
}: {
  signoff: ClientReviewSignoff;
  scope: ReviewScope;
  isStale: boolean;
  placement?: SignoffPlacement;
}) {
  const { market } = useMarketFormat();
  const when = formatReviewDateTime(signoff.signed_off_at, market);
  const initials = (
    signoff.signed_off_by_initials || signoff.signed_off_by_name.slice(0, 2)
  ).toUpperCase();
  const line = signoffStatusLine({
    kind: isStale ? "stale" : "signed",
    name: signoff.signed_off_by_name,
    date: when && when !== "—" ? when : null,
  });
  const title = line;

  if (placement === "corner") {
    return (
      <div
        data-signoff-corner
        data-signoff-scope={scope}
        className="flex max-w-[210px] shrink-0 flex-col items-end rounded-lg border border-[#DBEAFE] bg-white/90 px-2.5 py-1.5 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]/90"
        title={title}
      >
        <span className="text-right text-[10px] font-semibold leading-snug text-[#8a6508] dark:text-[#e1b85e]">
          {line}
        </span>
        {signoff.signature_data ? (
          <img
            src={signoff.signature_data}
            alt={`Signature of ${signoff.signed_off_by_name}`}
            className="mt-0.5 h-10 w-auto max-w-[180px] object-contain object-right"
          />
        ) : (
          <span
            className="mt-0.5 text-right text-lg leading-none text-[#8a6508] dark:text-[#e1b85e]"
            style={{ fontFamily: "Georgia, 'Palatino Linotype', serif", fontStyle: "italic" }}
          >
            {signoff.signed_off_by_name}
          </span>
        )}
        <span className="mt-0.5 text-right text-[9px] tabular-nums text-[#6b6354] dark:text-slate-400">
          {when}
        </span>
      </div>
    );
  }

  if (placement === "compact") {
    return (
      <div
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#16845B]/40 bg-[#16845B]/10 px-2.5 py-1"
        title={title}
      >
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-black"
          style={{
            background: "#16845B",
            color: "#ffffff",
          }}
        >
          {isStale ? "!" : initials.slice(0, 2)}
        </span>
        <span className="truncate text-[11px] font-semibold text-[#0e5c40] dark:text-[#8dccb0]">
          {line}
        </span>
      </div>
    );
  }

  return (
    <div
      data-signoff-certificate
      className="relative overflow-hidden rounded-2xl border border-[#DBEAFE] p-4 shadow-sm"
      style={{
        background:
          "radial-gradient(circle at 100% 0%, rgba(56,189,248,0.18), transparent 42%), linear-gradient(135deg, #f4f8ff, #ffffff 42%)",
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#0B5FFF,#38BDF8,transparent)]" />
      <div className="flex items-start gap-3">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-xs font-black tracking-wide shadow-[0_0_0_4px_rgba(22,132,91,0.16)]"
          style={{
            background: "#16845B",
            color: "#ffffff",
          }}
        >
          {isStale ? <AlertTriangle className="h-5 w-5" /> : initials.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[12px] font-semibold leading-snug text-[#8a6508] dark:text-[#e1b85e]">
              {line}
            </span>
            <span className="text-[10px] tabular-nums text-[#6b6354] dark:text-slate-400">
              {when}
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

/** A sign-off needs a stroke drawn in this dialog. A saved image is not a stroke. */
export function signatureReady(signature: string | null): boolean {
  return typeof signature === "string" && signature.startsWith("data:image/");
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
  const stroked = useRef(false);

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
    if (!value) {
      stroked.current = false;
      return;
    }
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = value;
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
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400 hover:text-[#0B5FFF]"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (canvas && ctx) {
              const w = canvas.clientWidth || 360;
              const h = canvas.clientHeight || 110;
              ctx.clearRect(0, 0, w, h);
            }
            stroked.current = false;
            onChange(null);
          }}
        >
          <Eraser className="h-3 w-3" /> Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-[110px] w-full cursor-crosshair touch-none rounded-lg border border-[#DBEAFE] bg-white"
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
      <p className="mt-1 text-[10px] text-slate-500">
        Draw with your mouse or finger. Sign stays off until there is a stroke.
      </p>
    </div>
  );
}

/** A sample-practice row is not a sign-off. The Ratios badge must not say signed. */
function signoffForDisplay(signoff: ClientReviewSignoff | null): ClientReviewSignoff | null {
  if (!signoff) return null;
  if (
    isSamplePracticeSignoff({
      name: signoff.signed_off_by_name,
      firmName: signoff.firm_name,
    })
  ) {
    return null;
  }
  return signoff;
}

/**
 * Read-only sign-off certificate for the client-facing (owner) side.
 * Renders nothing when there has never been a sign-off for this scope.
 *
 * `corner` is the owner-board stamp: handwritten signature, top-right of
 * that deliverable (orb card / tab header). `compact` is a gold pill.
 */
export function ReviewSignoffBadge({
  signoff,
  scope,
  isStale,
  compact = false,
  placement,
}: {
  signoff: ClientReviewSignoff | null;
  scope: ReviewScope;
  isStale: boolean;
  compact?: boolean;
  placement?: SignoffPlacement;
}) {
  const shown = signoffForDisplay(signoff);
  if (!shown) return null;
  return (
    <SignoffCertificate
      signoff={shown}
      scope={scope}
      isStale={isStale}
      placement={placement ?? (compact ? "compact" : "block")}
    />
  );
}

/** Gold tab label with the sign-off signature pinned to the right. */
export function OwnerTabSignoffRow({
  label,
  signoff,
  scope,
  isStale,
  id,
}: {
  label: string;
  signoff: ClientReviewSignoff | null;
  scope: ReviewScope;
  isStale: boolean;
  /** Optional tour target — only set on one row so the id stays unique. */
  id?: string;
}) {
  return (
    <div id={id} className="mb-4 flex items-center gap-3 pb-3">
      <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#16845B] dark:text-[#8dccb0]">
        {label}
      </span>
      <span className="h-px min-w-4 flex-1 bg-[#DBEAFE]" />
      <ReviewSignoffBadge signoff={signoff} scope={scope} isStale={isStale} placement="corner" />
    </div>
  );
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
  compact = false,
  hideStatus = false,
  verbOnly = false,
}: {
  clientId: string;
  clientName?: string;
  scope: ReviewScope;
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  onChange: (next: ClientReviewSignoff | null) => void;
  /** Tight control for tab headers and report cards. */
  compact?: boolean;
  /** The answer strip already shows the status line. */
  hideStatus?: boolean;
  /** Strip label is "Sign off", without the scope name. */
  verbOnly?: boolean;
}) {
  const { profile, updateProfile } = useAccountantProfile();
  const doSignoff = useServerFn(signoffReview);
  const doRemove = useServerFn(removeReviewSignoff);
  const loadWorkflow = useServerFn(getDeliverableWorkflow);
  const doSubmit = useServerFn(submitDeliverable);
  const doRequestChanges = useServerFn(requestDeliverableChanges);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [changeComment, setChangeComment] = useState("");
  const [askChanges, setAskChanges] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [padEpoch, setPadEpoch] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [workflow, setWorkflow] = useState<DeliverableWorkflow | null>(null);
  const [workflowLoaded, setWorkflowLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWorkflowLoaded(false);
    void loadWorkflow({ data: { clientId, scope } })
      .then((w) => {
        if (!cancelled) {
          setWorkflow(w);
          setWorkflowLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkflow(null);
          setWorkflowLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, scope, signoff?.id, signoff?.signed_off_at, isStale, loadWorkflow]);

  const shownSignoff = signoffForDisplay(signoff);
  const cycleStatus =
    shownSignoff && !isStale
      ? "signed_off"
      : workflow?.status === "ready_for_review"
        ? "ready_for_review"
        : "draft";
  const canSubmit = workflow?.canSubmit ?? false;
  const canReview = workflow?.canReview ?? false;
  const canSignOff = workflow?.canSignOff ?? false;

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

  const frame = hideStatus
    ? "answer-strip__signoff"
    : compact
      ? "flex flex-col items-end gap-2"
      : "mt-2 flex w-full max-w-md flex-col items-end gap-2";
  const signoffSteps = (
    <PremiumSteps
      steps={[
        {
          label: "Review",
          done: cycleStatus === "signed_off",
          current: cycleStatus !== "signed_off",
        },
        { label: "Sign-off", done: cycleStatus === "signed_off" },
      ]}
    />
  );

  if (shownSignoff && !isStale) {
    return (
      <div className={frame}>
        {signoffSteps}
        {hideStatus ? null : (
          <SignoffCertificate
            signoff={shownSignoff}
            scope={scope}
            isStale={false}
            placement={compact ? "compact" : "block"}
          />
        )}
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          className="mt-1.5 text-[10px] uppercase tracking-wider text-slate-500 hover:text-[#0B5FFF] transition"
        >
          Remove sign-off
        </button>

        <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <DialogContent className="border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0d1525] dark:text-[#F4F7FB]">
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
    <div className={frame}>
      {signoffSteps}
      {shownSignoff && isStale && !hideStatus && (
        <SignoffCertificate
          signoff={shownSignoff}
          scope={scope}
          isStale
          placement={compact ? "compact" : "block"}
        />
      )}
      {!workflowLoaded ? null : (
        <>
          {!shownSignoff && !hideStatus ? (
            <p className="text-[11px] font-semibold text-slate-500">
              {cycleStatus === "ready_for_review" ? "Ready for review" : "Draft"}
              {workflow?.changeComment ? ` · ${workflow.changeComment}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {workflow == null ||
            (canSignOff && (cycleStatus === "draft" || cycleStatus === "ready_for_review")) ? (
              <button type="button" onClick={() => setOpen(true)} className={SIGNOFF_GOLD_BTN}>
                <PenLine className="h-3.5 w-3.5" />
                {shownSignoff && isStale ? "Re-sign off" : "Sign off"}
                {verbOnly ? "" : ` ${SCOPE_SHORT_LABEL[scope]}`}
              </button>
            ) : null}
            {workflow && canSubmit && !canSignOff && cycleStatus === "draft" ? (
              <Button
                type="button"
                variant={hideStatus ? "default" : "outline"}
                size="sm"
                className={
                  hideStatus
                    ? SIGNOFF_GOLD_BTN
                    : "h-8 border-[#0B5FFF]/40 text-[11px] uppercase tracking-[0.12em] text-[#0B5FFF]"
                }
                disabled={saving}
                onClick={() => {
                  const previous = workflow;
                  setWorkflow({ ...previous, status: "ready_for_review", changeComment: null });
                  setSaving(true);
                  toast.success("Sent for partner review");
                  void doSubmit({ data: { clientId, scope } })
                    .then((r) => {
                      setWorkflow((w) => (w ? { ...w, status: r.status, changeComment: null } : w));
                    })
                    .catch((e) => {
                      setWorkflow(previous);
                      toast.error(e instanceof Error ? e.message : "Submit failed");
                    })
                    .finally(() => setSaving(false));
                }}
              >
                Submit for review
              </Button>
            ) : null}
            {canReview && cycleStatus === "ready_for_review" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[11px] uppercase tracking-[0.12em] text-slate-400"
                disabled={saving}
                onClick={() => setAskChanges(true)}
              >
                Request changes
              </Button>
            ) : null}
          </div>
        </>
      )}
      <Dialog open={askChanges} onOpenChange={setAskChanges}>
        <DialogContent className="border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0d1525] dark:text-[#F4F7FB]">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription className="text-slate-400">
              Returns {SCOPE_LABEL[scope]} to draft. The business cannot see it until a partner
              signs off again.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={changeComment}
            onChange={(e) => setChangeComment(e.target.value)}
            placeholder="What needs to change?"
            rows={3}
            className="resize-none border-slate-800 bg-slate-950 text-sm"
            maxLength={1000}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAskChanges(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void doRequestChanges({
                  data: { clientId, scope, comment: changeComment.trim() || undefined },
                })
                  .then((r) => {
                    setWorkflow((w) =>
                      w
                        ? { ...w, status: r.status, changeComment: changeComment.trim() || null }
                        : w,
                    );
                    setAskChanges(false);
                    setChangeComment("");
                    toast.success("Returned to draft");
                  })
                  .catch((e) =>
                    toast.error(e instanceof Error ? e.message : "Could not request changes"),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              Send back to draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setSignature(null);
            setPadEpoch((n) => n + 1);
          } else {
            setSignature(null);
          }
        }}
      >
        <DialogContent className="border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0d1525] dark:text-[#F4F7FB] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#102A43] dark:text-[#F4F7FB]">Sign off {SCOPE_LABEL[scope]}</DialogTitle>
            <DialogDescription className="text-slate-400">
              You are formally endorsing {SCOPE_LABEL[scope]}
              {clientName ? ` for ${clientName}` : ""}. Your name, date and signature are logged on
              this deliverable only — not across the whole profile.
            </DialogDescription>
          </DialogHeader>
          <SignaturePad key={padEpoch} value={signature} onChange={setSignature} />
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
            <button
              type="button"
              onClick={handleSignoff}
              disabled={saving || !signatureReady(signature)}
              className={`${SIGNOFF_GOLD_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
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
