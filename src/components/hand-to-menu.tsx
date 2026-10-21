import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { overlayMayHandleKey } from "@/lib/dialog-focus";
import { toast } from "sonner";
import { ActionHandoffButtons } from "@/components/action-handoff-buttons";
import { TaxSpecialistSlot } from "@/components/tax-specialist/tax-specialist-slot";
import { useBoundMarketCountry } from "@/contexts/market";
import { supabase } from "@/integrations/supabase/client";
import { ensureStrategicMoveItem } from "@/lib/ensure-plan-item";
import { HANDOFF_CHECKING_LABEL, handoffTriggerLabel } from "@/lib/action-handoff";
import { agentDisplayName, agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import {
  assignmentForMove,
  handoffFailureMessage,
  normalizeMoveLabel,
  type MoveAssignmentRef,
} from "@/lib/owner-handoff";
import {
  ACTION_PLAN_REFRESH_EVENT,
  assignActionToPerson,
  commitActionHandoff,
  invalidateMoveAssignments,
  loadClientMoveAssignments,
  type ActionPlanRefreshDetail,
} from "@/lib/owner-handoff-client";

export type HandToPerson = { id: string; name: string; email: string | null };

const HAND_TO_OPEN = "milon-hand-to-open";
const teamCache = new Map<string, HandToPerson[]>();
const teamLoads = new Map<string, Promise<HandToPerson[]>>();

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

function loadHandToTeamOnce(clientId: string): Promise<HandToPerson[]> {
  const cached = teamCache.get(clientId);
  if (cached && cached.length > 0) return Promise.resolve(cached);
  const pending = teamLoads.get(clientId);
  if (pending) return pending;
  const request = loadHandToTeam(clientId)
    .then((rows) => {
      if (rows.length > 0) teamCache.set(clientId, rows);
      return rows;
    })
    .finally(() => {
      teamLoads.delete(clientId);
    });
  teamLoads.set(clientId, request);
  return request;
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
  pending = false,
  onAssignAgent,
  onAssignPerson,
}: {
  clientId?: string | null;
  employees?: readonly HandToPerson[];
  assignee?: string | null;
  comingSoon?: Partial<Record<AgentKey, true>>;
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  /** The stored assignee is not known yet. Do not offer Hand to. */
  pending?: boolean;
  onAssignAgent: (agent: AgentKey) => void | Promise<void>;
  onAssignPerson: (person: HandToPerson) => void | Promise<void>;
}) {
  const boundCountry = useBoundMarketCountry();
  const country = marketCountry ?? boundCountry;
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<readonly HandToPerson[]>(employees ?? []);
  const [teamReady, setTeamReady] = useState(Boolean(employees));
  const [menuBox, setMenuBox] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useRef(`hand-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (employees) {
      setTeam(employees);
      setTeamReady(true);
    }
  }, [employees]);

  useEffect(() => {
    if (!open) return;
    const onOther = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id !== menuId.current) setOpen(false);
    };
    window.addEventListener(HAND_TO_OPEN, onOther);
    window.dispatchEvent(new CustomEvent(HAND_TO_OPEN, { detail: menuId.current }));
    return () => window.removeEventListener(HAND_TO_OPEN, onOther);
  }, [open]);

  useEffect(() => {
    if (!open || employees || !clientId) return;
    let cancelled = false;
    const cached = teamCache.get(clientId);
    if (cached && cached.length > 0) {
      setTeam(cached);
      setTeamReady(true);
    }
    void loadHandToTeamOnce(clientId).then((rows) => {
      if (cancelled) return;
      setTeam((current) => (rows.length === 0 && current.length > 0 ? current : rows));
      setTeamReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, employees, clientId]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = rootRef.current?.querySelector("[data-hand-to-trigger]");
      if (!(trigger instanceof HTMLElement)) return;
      const rect = trigger.getBoundingClientRect();
      const width = 256;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const height = menuRef.current?.offsetHeight ?? 280;
      const below = rect.bottom + 4;
      const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : below;
      setMenuBox({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, team.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
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

  const run = (work: () => void | Promise<void>) => {
    setOpen(false);
    void work();
  };

  const fullLabel = handoffTriggerLabel(assignee);
  const shortLabel = handoffTriggerLabel(assignee, true);

  if (pending) {
    return (
      <div className="relative" data-hand-to="true" data-hand-to-pending="">
        <span
          className="inline-flex h-auto max-w-full items-center rounded-lg border border-[#DBEAFE] bg-white px-2.5 py-1.5 text-left text-[12px] font-semibold leading-tight text-slate-500 dark:border-slate-700 dark:bg-transparent dark:text-slate-400"
          aria-disabled="true"
          aria-label={HANDOFF_CHECKING_LABEL}
        >
          {HANDOFF_CHECKING_LABEL}
        </span>
      </div>
    );
  }

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
        className="inline-flex h-auto max-w-full items-center gap-1.5 whitespace-normal rounded-lg border border-[#0B5FFF] bg-[#0B5FFF] px-2.5 py-1.5 text-left text-[12px] font-semibold leading-tight text-white hover:bg-[#2563EB] disabled:opacity-70"
        data-hand-to-trigger
        aria-expanded={open}
        aria-label={fullLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hand-to-full">{fullLabel}</span>
        <span className="hand-to-short">{shortLabel}</span>
      </button>
      {open && menuBox
        ? createPortal(
        <div
          ref={menuRef}
          className="w-64 max-w-[calc(100vw-16px)] rounded-lg border border-[#DBEAFE] bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{ position: "fixed", top: menuBox.top, left: menuBox.left, zIndex: 80 }}
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
              {teamReady ? "No team members on this file yet." : "Loading team…"}
            </p>
          ) : (
            <div className="max-h-40 overflow-auto">
              {team.map((person) => {
                const name = person.name || "Team member";
                const current = (assignee ?? "").trim().length > 0 && (assignee ?? "").trim() === name.trim();
                return (
                  <button
                    key={person.id}
                    type="button"
                    role="menuitem"
                    data-hand-to-person={person.id}
                    aria-pressed={current}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] font-semibold text-[#102A43] hover:bg-[#0B5FFF]/10 dark:text-slate-100"
                    onClick={() => void run(() => onAssignPerson(person))}
                  >
                    {name}
                    {current ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          )}
        </div>,
        document.body,
        )
        : null}
    </div>
  );
}

const MOVE_STATUS_POLL_MS = 5000;

/** Next move, owner and accountant. Creates the plan row if it is not there, then assigns it. */
export function MoveHandTo({
  clientId,
  moveKey,
  title,
  outcomeWhy,
  onOpenDraft,
}: {
  clientId: string;
  moveKey: string;
  title: string;
  outcomeWhy?: string;
  onOpenDraft?: (draftId: string) => void;
}) {
  const [assignee, setAssignee] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [face, setFace] = useState<MoveAssignmentRef | null>(null);
  const optimistic = useRef(false);
  const actionId = useRef<string | null>(null);
  const previous = useRef<string | null>(null);
  const previousFace = useRef<MoveAssignmentRef | null>(null);
  const lastAgent = useRef<AgentKey | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const applyStored = (match: MoveAssignmentRef | null) => {
    if (!match) return;
    actionId.current = match.actionItemId;
    setFace(match);
    setAssignee(match.assigneeName);
    setReady(true);
    optimistic.current = false;
  };

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setHandoffError(null);
    void loadClientMoveAssignments(clientId).then((rows) => {
      if (cancelled || optimistic.current) return;
      setReady(true);
      const match = assignmentForMove(rows, moveKey, title);
      if (!match) return;
      actionId.current = match.actionItemId;
      setFace(match);
      if (match.assigneeName) setAssignee(match.assigneeName);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, moveKey, title]);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ActionPlanRefreshDetail>).detail;
      if (detail?.committed) {
        setHandoffError(null);
        invalidateMoveAssignments(clientId);
        void loadClientMoveAssignments(clientId).then((rows) => {
          applyStored(assignmentForMove(rows, moveKey, title));
        });
        return;
      }
      const titleKey = normalizeMoveLabel(detail?.title);
      const matches =
        Boolean(detail?.actionItemId && detail.actionItemId === actionId.current) ||
        Boolean(titleKey && titleKey === normalizeMoveLabel(title)) ||
        Boolean(titleKey && titleKey === normalizeMoveLabel(moveKey));
      if (!matches) return;
      if (detail?.actionItemId) actionId.current = detail.actionItemId;
      if (detail?.failed) {
        optimistic.current = false;
        setAssignee(previous.current);
        setFace(previousFace.current);
        if (detail.error?.trim()) setHandoffError(detail.error.trim());
        return;
      }
    };
    window.addEventListener(ACTION_PLAN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ACTION_PLAN_REFRESH_EVENT, onRefresh);
  }, [clientId, moveKey, title]);

  useEffect(() => {
    if (face?.phase !== "working") return;
    const timer = window.setInterval(() => {
      if (optimistic.current) return;
      invalidateMoveAssignments(clientId);
      void loadClientMoveAssignments(clientId).then((rows) => {
        if (optimistic.current) return;
        applyStored(assignmentForMove(rows, moveKey, title));
      });
    }, MOVE_STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [clientId, moveKey, title, face?.phase]);

  const ensure = async (): Promise<{ id: string } | { error: string }> => {
    const item = await ensureStrategicMoveItem({ clientId, moveKey, title, outcomeWhy });
    if (!item.ok) return { error: item.error };
    return { id: item.actionItemId };
  };

  const revertPending = (message: string | null) => {
    optimistic.current = false;
    setAssignee(previous.current);
    setFace(previousFace.current);
    if (message) {
      setHandoffError(message);
      toast.error(message);
    }
  };

  const handToAgent = async (agent: AgentKey) => {
    lastAgent.current = agent;
    previous.current = assignee;
    previousFace.current = face;
    optimistic.current = true;
    setHandoffError(null);
    setAssignee(`Handing to ${agentShortName(agent)}…`);
    const ensured = await ensure();
    if ("error" in ensured) {
      revertPending(ensured.error);
      return;
    }
    actionId.current = ensured.id;
    const result = await commitActionHandoff({ clientId, actionItemId: ensured.id, title, agent });
    if (result.ok && result.reused) {
      optimistic.current = false;
      setHandoffError(null);
      setReady(false);
      const rows = await loadClientMoveAssignments(clientId);
      applyStored(assignmentForMove(rows, moveKey, title));
      setReady(true);
      return;
    }
    if (!result.ok && result.comingSoon) {
      optimistic.current = false;
      setAssignee(previous.current);
      setFace(previousFace.current);
      return;
    }
    if (!result.ok || result.noted !== true) {
      revertPending(result.ok ? "Couldn't hand this over" : handoffFailureMessage(result.error));
      return;
    }
    optimistic.current = false;
    setHandoffError(null);
    setAssignee(agentDisplayName(agent));
    toast.success(`Handed to ${agentShortName(agent)}`);
  };

  const openDraftId = face?.phase === "draft_ready" ? face.draftId : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <HandToMenu
        clientId={clientId}
        audience="accountant"
        assignee={assignee}
        pending={!ready}
        onAssignAgent={(agent) => {
          void handToAgent(agent);
        }}
        onAssignPerson={async (person) => {
          previous.current = assignee;
          previousFace.current = face;
          optimistic.current = true;
          setHandoffError(null);
          setAssignee(person.name);
          const ensured = await ensure();
          if ("error" in ensured) {
            revertPending(ensured.error);
            return;
          }
          actionId.current = ensured.id;
          const result = await assignActionToPerson({
            clientId,
            actionItemId: ensured.id,
            personId: person.id,
            personName: person.name,
            title,
          });
          if (!result.ok) {
            revertPending(handoffFailureMessage(result.error));
            return;
          }
          setHandoffError(null);
          toast.success(`Assigned to ${person.name}`);
        }}
      />
      {handoffError ? (
        <span data-move-handoff-error className="text-[12px] font-semibold text-[#B42318]">
          {handoffError} ·{" "}
          <button
            type="button"
            data-handoff-retry
            className="underline"
            onClick={() => {
              const agent = lastAgent.current;
              if (agent) void handToAgent(agent);
            }}
          >
            Retry
          </button>
        </span>
      ) : null}
      {face?.phase === "working" ? (
        <span data-move-phase="working" className="text-[12px] font-semibold text-[#0B5FFF]">
          {face.phaseLabel}
        </span>
      ) : null}
      {face?.phase === "draft_ready" && openDraftId ? (
        <button
          type="button"
          data-move-phase="draft-ready"
          data-open-draft={openDraftId}
          className="text-[12px] font-semibold text-[#0B5FFF] underline"
          onClick={() => onOpenDraft?.(openDraftId)}
        >
          {face.phaseLabel}
        </button>
      ) : null}
    </span>
  );
}
