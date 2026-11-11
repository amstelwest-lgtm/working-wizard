import { toast } from "sonner";
import type { AgentKey } from "@/lib/milon-team-feed";
import { commitActionHandoff } from "@/lib/owner-handoff-client";
import { assignedToast } from "@/lib/action-handoff";
import { handoffCommitError } from "@/lib/owner-handoff";

/** Same hand-off write as Hand to, for the row's last agent. */
export function retryHomeHandoff(input: {
  clientId: string;
  actionItemId: string;
  title: string;
  agent: AgentKey;
}) {
  const toastId = toast.success(assignedToast(input.agent));
  void commitActionHandoff(input).then((result) => {
    const handoffError = handoffCommitError(result);
    if (handoffError) toast.error(handoffError, { id: toastId });
    else if (result.ok && result.reused) toast.dismiss(toastId);
  });
}
