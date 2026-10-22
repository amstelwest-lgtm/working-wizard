/**
 * Per-firm switch for the tax review queue.
 * agent_settings is one global row. A boolean true would turn the runner on
 * for every firm, so the value is { default: false, firms: { "<uuid>": true } }.
 * Only an exact firm id set to true is on. A prefix of that id is off.
 */

export const TAX_SPECIALIST_QUEUE = "agent_tax";
export const TAX_SPECIALIST_SETTING = "tax_specialist_enabled";

export type TaxEnqueuePlan =
  | { enqueue: false }
  | {
      enqueue: true;
      queue: typeof TAX_SPECIALIST_QUEUE;
      payload: { send_id: string; client_id: string; firm_id: string };
    };

const FIRM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firmsMap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const firms = (value as { firms?: unknown }).firms;
  if (!firms || typeof firms !== "object" || Array.isArray(firms)) return null;
  return firms as Record<string, unknown>;
}

/** True only when this firm's own entry is boolean true. */
export function taxSpecialistEnabled(value: unknown, firmId: string | null | undefined): boolean {
  if (!firmId || !FIRM_ID.test(firmId)) return false;
  const firms = firmsMap(value);
  if (!firms) return false;
  return firms[firmId] === true;
}

/** The dispatch tick may read the queue when at least one firm is on. */
export function taxSpecialistDispatchEnabled(value: unknown): boolean {
  const firms = firmsMap(value);
  if (!firms) return false;
  return Object.values(firms).some((flag) => flag === true);
}

/**
 * One queue message on the first completion, and only for a firm that is on.
 * A link that is already finished does not enqueue again.
 */
export function planTaxEnqueue(input: {
  already: boolean;
  setting: unknown;
  firmId: string;
  sendId: string;
  clientId: string;
}): TaxEnqueuePlan {
  if (input.already) return { enqueue: false };
  if (!taxSpecialistEnabled(input.setting, input.firmId)) return { enqueue: false };
  return {
    enqueue: true,
    queue: TAX_SPECIALIST_QUEUE,
    payload: {
      send_id: input.sendId,
      client_id: input.clientId,
      firm_id: input.firmId,
    },
  };
}
