/**
 * Pending figure proposals. Confirm writes the patch. Reject does not.
 * Cash, Budget, and the profitability waterfall share this card.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  figureDecisionError,
  figureDeltaLines,
  type FigureProposal,
  type FigureSurface,
} from "@/lib/figure-proposal";

export type PendingFigureProposal = {
  id: string;
  surface: FigureSurface;
  note: string | null;
  patch: FigureProposal["patch"];
  beforeValues: Record<string, string | number | null>;
};

export type AppliedFigure = {
  surface: FigureSurface;
  cashflow: Record<string, unknown> | null;
  budget: Record<string, unknown> | null;
  financials: Record<string, unknown> | null;
};

const TITLE: Record<FigureSurface, string> = {
  cash: "Cash forecast change waiting for you",
  budget: "Budget change waiting for you",
  waterfall: "Waterfall change waiting for you",
};

const COPY: Record<FigureSurface, string> = {
  cash: "The Financial Manager proposed a cash forecast change. Nothing is saved until you confirm.",
  budget: "The Financial Manager proposed a budget change. Nothing is saved until you confirm.",
  waterfall: "The Financial Manager proposed a profitability change. Nothing is saved until you confirm.",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asSurface(value: unknown): FigureSurface | null {
  return value === "cash" || value === "budget" || value === "waterfall" ? value : null;
}

export function useFigureProposals(input: {
  clientId?: string;
  surface: FigureSurface;
  enabled: boolean;
}) {
  const [proposals, setProposals] = useState<PendingFigureProposal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!input.enabled || !input.clientId) {
      setProposals([]);
      return;
    }
    const { data, error } = await supabase
      .from("figure_proposals")
      .select("id, surface, patch, before_values, note")
      .eq("client_id", input.clientId)
      .eq("surface", input.surface)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) {
      setProposals([]);
      return;
    }
    const next: PendingFigureProposal[] = [];
    for (const row of data ?? []) {
      const surface = asSurface(row.surface);
      const patch = asRecord(row.patch);
      if (!surface || !patch) continue;
      const before = asRecord(row.before_values) ?? {};
      const beforeValues: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(before)) {
        if (typeof value === "number" || typeof value === "string") beforeValues[key] = value;
        else if (value == null) beforeValues[key] = null;
      }
      next.push({
        id: row.id,
        surface,
        note: row.note,
        patch: patch as FigureProposal["patch"],
        beforeValues,
      });
    }
    setProposals(next);
  }, [input.clientId, input.enabled, input.surface]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const confirm = useCallback(
    async (id: string): Promise<AppliedFigure | null> => {
      setBusyId(id);
      const { data, error } = await supabase.rpc("apply_figure_proposal", {
        p_id: id,
        p_confirm: true,
      });
      setBusyId(null);
      if (error) {
        toast.error(figureDecisionError(error.message));
        return null;
      }
      const payload = asRecord(data);
      const surface = asSurface(payload?.surface) ?? input.surface;
      setProposals((rows) => rows.filter((row) => row.id !== id));
      toast.success("Saved. The change is on file.");
      return {
        surface,
        cashflow: asRecord(payload?.cashflow),
        budget: asRecord(payload?.budget),
        financials: asRecord(payload?.financials),
      };
    },
    [input.surface],
  );

  const reject = useCallback(async (id: string): Promise<boolean> => {
    setBusyId(id);
    const { error } = await supabase.rpc("reject_figure_proposal", { p_id: id });
    setBusyId(null);
    if (error) {
      toast.error(figureDecisionError(error.message));
      return false;
    }
    setProposals((rows) => rows.filter((row) => row.id !== id));
    toast.success("Proposal rejected. The saved figures were not changed.");
    return true;
  }, []);

  return { proposals, busyId, confirm, reject };
}

export function FigureProposals({
  surface,
  proposals,
  busyId,
  onConfirm,
  onReject,
}: {
  surface: FigureSurface;
  proposals: readonly PendingFigureProposal[];
  busyId: string | null;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (!proposals.length) return null;
  return (
    <section
      className="mb-3 rounded-xl border border-[#DBEAFE] bg-white p-3 text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#F4F7FB]"
      data-figure-proposals={surface}
      aria-label={TITLE[surface]}
    >
      <h3 className="text-xs font-bold uppercase tracking-[0.16em]">{TITLE[surface]}</h3>
      <p className="mt-2 text-sm">{COPY[surface]}</p>
      <ul className="mt-3 space-y-3">
        {proposals.map((proposal) => {
          const lines = figureDeltaLines(proposal);
          const busy = busyId === proposal.id;
          return (
            <li
              key={proposal.id}
              className="rounded-lg border border-[#DBEAFE] p-3 dark:border-[#1e3a5f]"
              data-figure-proposal={proposal.id}
            >
              {proposal.note ? <p className="text-sm">{proposal.note}</p> : null}
              {lines.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {lines.map((line) => (
                    <li key={line.key}>{line.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm">The proposal could not be read.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={() => onConfirm(proposal.id)}>
                  Confirm and apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onReject(proposal.id)}
                >
                  Reject
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
