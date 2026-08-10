import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PenLine, Check, AlertTriangle, Loader2 } from "lucide-react";
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

const SCOPE_LABEL: Record<ReviewScope, string> = {
  financials: "this period's financials / profitability",
  cash_forecast: "the cash forecast",
  budget: "the FY budget",
};

const SCOPE_SHORT_LABEL: Record<ReviewScope, string> = {
  financials: "financials & profitability",
  cash_forecast: "cash forecast",
  budget: "budget",
};

const CURRENT_COLOR = "#2e7d32"; // green — reviewed and up to date
const STALE_COLOR = "#b8860b"; // gold/amber — reviewed previously, data has since changed

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

/**
 * Read-only sign-off badge for the client-facing (owner) side. Shows the
 * current endorsement, or a "needs re-review" state once the underlying data
 * has changed since the last sign-off. Renders nothing when there has never
 * been a sign-off, so an unreviewed period makes no claim either way.
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
  const accent = isStale ? STALE_COLOR : CURRENT_COLOR;

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
        title={
          isStale
            ? `Reviewed by ${signerLine(signoff)} on ${formatDateTime(signoff.signed_off_at)} — data has changed since`
            : `Reviewed by ${signerLine(signoff)} on ${formatDateTime(signoff.signed_off_at)}`
        }
      >
        {isStale ? <AlertTriangle className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
        {isStale ? "Needs re-review" : "Reviewed by accountant"}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 border-l-2"
      style={{ borderLeftColor: accent, backgroundColor: `${accent}0d` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {isStale ? (
            <AlertTriangle className="h-3 w-3 flex-shrink-0" style={{ color: accent }} />
          ) : (
            <Check className="h-3 w-3 flex-shrink-0" style={{ color: accent }} />
          )}
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
            {isStale ? "Needs re-review" : "Reviewed & signed off"}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 flex-shrink-0">
          {formatDateTime(signoff.signed_off_at)}
        </span>
      </div>
      <div className="text-xs font-medium text-slate-100 pl-[18px]">
        {signerLine(signoff)}
        {signoff.firm_name ? ` · ${signoff.firm_name}` : ""}
      </div>
      {isStale && (
        <div className="text-[11px] text-slate-400 pl-[18px]">
          {SCOPE_LABEL[scope]} {scope === "cash_forecast" ? "has" : "have"} changed since this
          review.
        </div>
      )}
      {signoff.note && !isStale && (
        <div className="text-[11px] text-slate-400 italic pl-[18px] mt-1">
          &ldquo;{signoff.note}&rdquo;
        </div>
      )}
    </div>
  );
}

/**
 * Accountant-facing one-click sign-off control. Renders the current state
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
  const { profile } = useAccountantProfile();
  const doSignoff = useServerFn(signoffReview);
  const doRemove = useServerFn(removeReviewSignoff);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const accentBrand = profile.accentColor || "#0f3460";
  const accentState = isStale ? STALE_COLOR : CURRENT_COLOR;

  const handleSignoff = async () => {
    setSaving(true);
    try {
      const row = await doSignoff({
        data: {
          clientId,
          scope,
          accountantTitle: null,
          firmName: profile.firmName?.trim() || null,
          note: note.trim() || null,
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
      <div className="mt-2">
        <div
          className="flex flex-col gap-1 px-3 py-2 border-l-2"
          style={{ borderLeftColor: accentState, backgroundColor: `${accentState}0d` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <Check className="h-3 w-3 flex-shrink-0" style={{ color: accentState }} />
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
                Signed off by
              </span>
              <span className="text-xs font-medium text-slate-100 truncate">
                {signerLine(signoff)}
              </span>
            </div>
            <span className="text-[10px] text-slate-500 flex-shrink-0">
              {formatDateTime(signoff.signed_off_at)}
            </span>
          </div>
          {signoff.firm_name && (
            <div className="text-[11px] text-slate-500 pl-[18px]">
              {signoff.firm_name}
              {clientName ? ` · for ${clientName}` : ""}
            </div>
          )}
          {signoff.note && (
            <div className="text-[11px] text-slate-400 italic pl-[18px] mt-1">
              &ldquo;{signoff.note}&rdquo;
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          className="mt-1 text-[10px] text-slate-600 hover:text-slate-400 transition pl-3"
        >
          Remove sign-off
        </button>

        <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <DialogContent className="bg-[#0d1117] border-slate-800 text-slate-100">
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
    <div className="mt-2 flex flex-col items-end gap-1">
      {signoff && isStale && (
        <div className="text-[11px] flex items-center gap-1.5" style={{ color: STALE_COLOR }}>
          <AlertTriangle className="h-3 w-3" />
          Previously signed off by {signerLine(signoff)} on {formatDateTime(signoff.signed_off_at)} — data has changed
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 transition"
      >
        <PenLine className="h-3 w-3" />
        {signoff && isStale ? "Re-sign off" : "Sign off"} {SCOPE_SHORT_LABEL[scope]}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0d1117] border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Sign off {SCOPE_LABEL[scope]}</DialogTitle>
            <DialogDescription className="text-slate-400">
              You are formally endorsing {SCOPE_LABEL[scope]}
              {clientName ? ` for ${clientName}` : ""}. Your name, initials, date and time from
              your account will be logged and shown to the client on reports until the
              underlying data changes.
            </DialogDescription>
          </DialogHeader>
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
              className="bg-slate-950 border-slate-800 text-slate-100 text-sm resize-none"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSignoff}
              disabled={saving}
              style={{ backgroundColor: accentBrand, color: "#fff" }}
              className="hover:opacity-90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Sign off
            </Button>
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
