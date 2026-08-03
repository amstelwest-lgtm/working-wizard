import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PenLine, Check, Loader2 } from "lucide-react";
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
  signoffInterventionStep,
  removeInterventionSignoff,
  type InterventionSignoff,
} from "@/lib/intervention.functions";

interface Props {
  clientId: string;
  clientName?: string;
  ratioKey: string;
  stepNumber: number;
  signoff: InterventionSignoff | null;
  onChange: (next: InterventionSignoff | null) => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function SignoffBadgeReadonly({
  signoff,
  clientName,
}: {
  signoff: InterventionSignoff;
  clientName?: string;
}) {
  const { profile } = useAccountantProfile();
  const accent = profile.accentColor || "#0f3460";
  return (
    <div className="mt-3">
      <div
        className="flex flex-col gap-1 px-3 py-2 border-l-2"
        style={{ borderLeftColor: accent, backgroundColor: `${accent}0d` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Check className="h-3 w-3 flex-shrink-0" style={{ color: accent }} />
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
              Signed off by
            </span>
            <span className="text-xs font-medium text-slate-100 truncate">
              {signoff.signed_off_by_name}
              {signoff.signed_off_by_title ? ` ${signoff.signed_off_by_title}` : ""}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 flex-shrink-0">
            {formatDate(signoff.signed_off_at)}
          </span>
        </div>
        {signoff.firm_name && (
          <div className="text-[11px] text-slate-500 pl-[18px]">
            {signoff.firm_name}
            {clientName ? ` · for ${clientName}` : ""}
          </div>
        )}
        {signoff.accountant_note && (
          <div className="text-[11px] text-slate-400 italic pl-[18px] mt-1">
            &ldquo;{signoff.accountant_note}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}

export function InterventionSignoffButton({
  clientId,
  clientName,
  ratioKey,
  stepNumber,
  signoff,
  onChange,
}: Props) {
  const { profile } = useAccountantProfile();
  const doSignoff = useServerFn(signoffInterventionStep);
  const doRemove = useServerFn(removeInterventionSignoff);

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const accent = profile.accentColor || "#0f3460";

  const handleSignoff = async () => {
    if (!profile.firmName?.trim()) {
      toast.error("Please set your firm name in Settings → Brand before signing off.");
      return;
    }
    setSaving(true);
    try {
      const row = await doSignoff({
        data: {
          clientId,
          ratioKey,
          stepNumber,
          accountantTitle: null,
          firmName: profile.firmName,
          note: note.trim() || null,
        },
      });
      onChange(row);
      setOpen(false);
      setNote("");
      toast.success("Step signed off");
    } catch (e) {
      toast.error(`Could not save sign-off: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await doRemove({ data: { clientId, ratioKey, stepNumber } });
      onChange(null);
      setConfirmRemove(false);
      toast.success("Sign-off removed");
    } catch (e) {
      toast.error(`Could not remove sign-off: ${(e as Error).message}`);
    } finally {
      setRemoving(false);
    }
  };

  if (signoff) {
    return (
      <div className="mt-3">
        <div
          className="flex flex-col gap-1 px-3 py-2 border-l-2"
          style={{
            borderLeftColor: accent,
            backgroundColor: `${accent}0d`,
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <Check className="h-3 w-3 flex-shrink-0" style={{ color: accent }} />
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
                Signed off by
              </span>
              <span className="text-xs font-medium text-slate-100 truncate">
                {signoff.signed_off_by_name}
                {signoff.signed_off_by_title ? ` ${signoff.signed_off_by_title}` : ""}
              </span>
            </div>
            <span className="text-[10px] text-slate-500 flex-shrink-0">
              {formatDate(signoff.signed_off_at)}
            </span>
          </div>
          {signoff.firm_name && (
            <div className="text-[11px] text-slate-500 pl-[18px]">
              {signoff.firm_name}
              {clientName ? ` · for ${clientName}` : ""}
            </div>
          )}
          {signoff.accountant_note && (
            <div className="text-[11px] text-slate-400 italic pl-[18px] mt-1">
              &ldquo;{signoff.accountant_note}&rdquo;
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
                The client will no longer see your endorsement on this step.
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
    <div className="mt-3 flex justify-end">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 transition"
      >
        <PenLine className="h-3 w-3" />
        Sign off this step
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0d1117] border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Sign off this step</DialogTitle>
            <DialogDescription className="text-slate-400">
              You are formally endorsing this intervention step{clientName ? ` for ${clientName}` : ""}.
              This sign-off will be visible to the client and included in generated reports.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="signoff-note" className="text-xs text-slate-300">
              Add a note (optional)
            </Label>
            <Textarea
              id="signoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Discuss this with your operations manager first"
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
              style={{ backgroundColor: accent, color: "#fff" }}
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
