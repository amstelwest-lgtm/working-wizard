import { agentKeyFromAssignee, agentPosterSrc, handoffButtonLabel } from "@/lib/action-handoff";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";

export function ActionHandoffButtons({
  ownerName,
  comingSoon,
  pickupLabel,
  onHandOff,
}: {
  ownerName?: string | null;
  comingSoon?: Partial<Record<AgentKey, true>>;
  pickupLabel?: string | null;
  onHandOff: (agent: AgentKey) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 px-3 pb-3 sm:flex-row sm:flex-wrap sm:px-4"
      data-bot-handoff="true"
      onClick={(event) => event.stopPropagation()}
    >
      {AGENT_KEYS.map((agent) => {
        const waiting = Boolean(comingSoon?.[agent]);
        const assigned = !waiting && agentKeyFromAssignee(ownerName) === agent;
        return (
          <button
            key={agent}
            type="button"
            disabled={waiting}
            aria-pressed={assigned}
            data-handoff-state={waiting ? "coming-soon" : assigned ? "assigned" : "ready"}
            data-handoff-agent={agent}
            className={
              waiting
                ? "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#0B5FFF] bg-white px-2.5 py-2 text-[12px] font-semibold text-[#0B5FFF] disabled:cursor-default disabled:opacity-80 dark:bg-transparent sm:w-auto"
                : "inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0B5FFF] px-2.5 py-2 text-[12px] font-semibold text-white hover:bg-[#2563EB] sm:w-auto"
            }
            onClick={() => {
              if (!waiting) onHandOff(agent);
            }}
          >
            <img src={agentPosterSrc(agent)} alt="" className="h-5 w-5 rounded-full object-cover" />
            {waiting ? "Coming online soon" : handoffButtonLabel(agent, assigned)}
          </button>
        );
      })}
      {pickupLabel ? (
        <p className="basis-full text-[11px] font-semibold text-[#0B5FFF]" data-agent-pickup>
          {pickupLabel}
        </p>
      ) : null}
    </div>
  );
}
