/**
 * Which completed Tax Specialist sends go on agent_tax.
 * No database and no model call. The flag is off unless that one firm is enabled.
 * Any other firm is skipped even when the flag is on.
 */

export const TAX_DISPATCH_FIRM_ID = "fca0f102-a597-4ec6-8f45-825c57f78797";
export const TAX_DISPATCH_FLAG = "tax_specialist_dispatch";
export const TAX_AGENT_KEY = "tax_specialist";
export const TAX_SEND_AGENT = "tax-specialist";
export const TAX_AGENT_QUEUE = "agent_tax";

export type TaxDispatchSend = {
  id: string;
  firmId: string;
  clientId: string;
  agent: string;
  completedAt: string | null;
  alreadyQueued: boolean;
};

export type TaxEnqueue = {
  sendId: string;
  queue: typeof TAX_AGENT_QUEUE;
  payload: {
    send_id: string;
    client_id: string;
    firm_id: string;
    agent: typeof TAX_AGENT_KEY;
  };
};

export type TaxDispatchSkip =
  | "other_firm"
  | "flag_off"
  | "not_tax"
  | "not_complete"
  | "already_queued";

export function taxDispatchSkip(input: {
  send: TaxDispatchSend;
  flagEnabled: boolean;
}): TaxDispatchSkip | null {
  if (input.send.firmId !== TAX_DISPATCH_FIRM_ID) return "other_firm";
  if (!input.flagEnabled) return "flag_off";
  if (input.send.agent !== TAX_SEND_AGENT) return "not_tax";
  if (!input.send.completedAt) return "not_complete";
  if (input.send.alreadyQueued) return "already_queued";
  return null;
}

/** One enqueue per send. A repeated id in the same list is kept once. */
export function planTaxDispatch(input: {
  sends: readonly TaxDispatchSend[];
  flagEnabled: boolean;
}): TaxEnqueue[] {
  const seen = new Set<string>();
  const out: TaxEnqueue[] = [];
  for (const send of input.sends) {
    if (taxDispatchSkip({ send, flagEnabled: input.flagEnabled })) continue;
    if (seen.has(send.id)) continue;
    seen.add(send.id);
    out.push({
      sendId: send.id,
      queue: TAX_AGENT_QUEUE,
      payload: {
        send_id: send.id,
        client_id: send.clientId,
        firm_id: send.firmId,
        agent: TAX_AGENT_KEY,
      },
    });
  }
  return out;
}
