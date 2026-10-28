import { toast } from "sonner";
import { agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import { commitActionHandoff } from "@/lib/owner-handoff-client";

/** Same hand-off write as Hand to, for the row's last agent. */
export function retryHomeHandoff(input: {
  clientId: string;
  actionItemId: string;
  title: string;
  agent: AgentKey;
}) {
  const toastId = toast.success(`Handed to ${agentShortName(input.agent)}`);
  void commitActionHandoff(input).then((result) => {
    if (!result.ok) toast.error(result.error, { id: toastId });
  });
}
