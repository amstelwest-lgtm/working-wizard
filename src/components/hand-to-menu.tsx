import { useEffect, useRef, useState } from "react";
import { overlayMayHandleKey } from "@/lib/dialog-focus";
import { toast } from "sonner";
import { ActionHandoffButtons } from "@/components/action-handoff-buttons";
import { TaxSpecialistSlot } from "@/components/tax-specialist/tax-specialist-slot";
import { useBoundMarketCountry } from "@/contexts/market";
import { supabase } from "@/integrations/supabase/client";
import { ensureStrategicMoveItem } from "@/lib/ensure-plan-item";
import { handoffComingOnline } from "@/hooks/owner-agent-ui";
import { agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import {
  dispatchActionPlanRefresh,
  recordHandoffAssignment,
  requestOwnerHandoff,
} from "@/lib/owner-handoff-client";

export type HandToPerson = { id: string; name: string; email: string | null };

async function loadHandToTeam(clientId: string): Promise<HandToPerson[]> {
  const plan = await import("@/components/action-plan");
  const { data: emps } = await supabase
    .from("client_employees")
    .select("id,name,email,role")
    .eq("client_id", clientId)
    .order("name");
  let practice: ReturnType<typeof plan.practiceTeamRows> = [];
  try {
    const { data, error } = await supabase.rpc(
      "list_client_practice_team" as never,
      { _client_id: clientId } as never,
    );
    if (!error) practice = plan.practiceTeamRows(data);
  } catch {
    practice = [];
  }
  return plan.mergeActionPlanTeam((emps ?? []) as Parameters<typeof plan.mergeActionPlanTeam>[0], practice);
}

/**
 * One Hand to control. The menu lists Milōn bots and the people on this client.
 */
export function HandToMenu({
  clientId,
  employees,
  assignee,
  comingSoon,
  marketCountry,
  audience = "owner",
  onAssignAgent,
  onAssignPerson,
}: {
  clientId?: string | null;
  employees?: readonly HandToPerson[];
  assignee?: string | null;
  comingSoon?: Partial<Record<AgentKey, true>>;
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  onAssignAgent: (agent: AgentKey) => void | Promise<void>;
  onAssignPerson: (person: HandToPerson) => void | Promise<void>;
}) {
  const boundCountry = useBoundMarketCountry();
  const country = marketCountry ?? boundCountry;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState<readonly HandToPerson[]>(employees ?? []);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (employees) setTeam(employees);
  }, [employees]);

  useEffect(() => {
    if (!open || employees || !clientId) return;
    let cancelled = false;
    void loadHandToTeam(clientId).then((rows) => {
      if (!cancelled) setTeam(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, employees, clientId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!open) return;
      if (!overlayMayHandleKey(event)) return;
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (work: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      data-hand-to="true"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <TaxSpecialistSlot country={country} variant="host" audience={audience} />
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#0B5FFF] bg-[#0B5FFF] px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-[#2563EB] disabled:opacity-70"
        data-hand-to-trigger
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        Hand to
        {assignee ? <span className="font-medium text-white">{assignee}</span> : null}
      </button>
      {open ? (
        <div
          className="absolute z-40 mt-1 w-64 rounded-lg border border-[#DBEAFE] bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          data-hand-to-menu
          role="menu"
        >
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Milōn bots
          </p>
          <ActionHandoffButtons
            ownerName={assignee}
            comingSoon={comingSoon}
            onHandOff={(agent) => void run(() => onAssignAgent(agent))}
          />
          <TaxSpecialistSlot
            country={country}
            variant="handoff"
            audience={audience}
            onOpen={() => setOpen(false)}
          />
          <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Team
          </p>
          {team.length === 0 ? (
            <p className="px-1 py-1 text-[12px] text-slate-500" data-hand-to-empty-team>
              No team members on this file yet.
            </p>
          ) : (
            <div className="max-h-40 overflow-auto">
              {team.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  role="menuitem"
                  data-hand-to-person={person.id}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] font-semibold text-[#102A43] hover:bg-[#0B5FFF]/10 dark:text-slate-100"
                  onClick={() => void run(() => onAssignPerson(person))}
                >
                  {person.name || "Team member"}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Accountant Next move. Creates the plan row if it is not there, then assigns it. */
export function MoveHandTo({
  clientId,
  moveKey,
  title,
  outcomeWhy,
}: {
  clientId: string;
  moveKey: string;
  title: string;
  outcomeWhy?: string;
}) {
  const ensure = async () => {
    const item = await ensureStrategicMoveItem({ clientId, moveKey, title, outcomeWhy });
    if (!item.ok) {
      toast.error(item.error);
      return null;
    }
    return item.actionItemId;
  };

  return (
    <HandToMenu
      clientId={clientId}
      audience="accountant"
      onAssignAgent={async (agent) => {
        const actionItemId = await ensure();
        if (!actionItemId) return;
        const result = await requestOwnerHandoff({ clientId, actionItemId, agent });
        if (!result.ok && handoffComingOnline(result.error)) {
          const saved = await recordHandoffAssignment({ clientId, actionItemId, agent });
          if (!saved.ok) {
            toast.error(saved.error);
            return;
          }
        } else if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Assigned to ${agentShortName(agent)}`);
        dispatchActionPlanRefresh({ actionItemId, title, agent });
      }}
      onAssignPerson={async (person) => {
        const actionItemId = await ensure();
        if (!actionItemId) return;
        const { error } = await supabase
          .from("action_items")
          .update({ owner_id: person.id, sent_at: null })
          .eq("id", actionItemId);
        if (error) {
          toast.error(error.message);
          return;
        }
        const { data: userData } = await supabase.auth.getUser();
        await supabase.from("action_updates").insert({
          action_item_id: actionItemId,
          client_id: clientId,
          actor_type: "owner_app",
          actor_label: userData.user?.email?.split("@")[0] ?? "Accountant",
          note: `Assigned to ${person.name}`,
        });
        toast.success(`Assigned to ${person.name}`);
        dispatchActionPlanRefresh();
      }}
    />
  );
}
