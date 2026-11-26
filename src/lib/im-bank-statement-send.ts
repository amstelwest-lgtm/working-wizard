/**
 * Which clients get an unsent bank-statement agent draft from the
 * Implementation Manager next-step list. Selection only. The draft itself
 * is the existing agent_send_draft, still unsent.
 */
import { buildAgentSendDraft, type AgentSendDraft } from "@/lib/agent-send-draft";
import { planClientName } from "@/lib/im-plan-actions";

export type ImSendClient = {
  id: string;
  name: string;
  is_demo?: boolean | null;
};

/** Same skip as the Implementation Manager plan: a demo row is not a pilot. */
export function clientsForImBankStatementSend(rows: readonly ImSendClient[]): ImSendClient[] {
  const clients: ImSendClient[] = [];
  for (const row of rows) {
    const id = row.id?.trim() ?? "";
    if (!id || row.is_demo === true) continue;
    const name = row.name?.trim() || "Client";
    clients.push({ id, name });
  }
  return clients;
}

export function selectionAfterToggle(selectedIds: readonly string[], id: string): string[] {
  if (!id) return [...selectedIds];
  if (selectedIds.includes(id)) return selectedIds.filter((row) => row !== id);
  return [...selectedIds, id];
}

export function allClientsTicked(
  clientIds: readonly string[],
  selectedIds: readonly string[],
): boolean {
  if (clientIds.length === 0) return false;
  const selected = new Set(selectedIds);
  return clientIds.every((id) => selected.has(id));
}

/** Ticks every client, or clears the list when every client is already ticked. */
export function selectionAfterAllToggle(
  clientIds: readonly string[],
  selectedIds: readonly string[],
): string[] {
  if (allClientsTicked(clientIds, selectedIds)) return [];
  return [...clientIds];
}

export function bankStatementAgentDraft(client: {
  id: string;
  name: string;
}): { ok: true; draft: AgentSendDraft } | { ok: false; error: string } {
  const name = planClientName(client.name);
  return buildAgentSendDraft({
    clientId: client.id,
    clientName: name,
    checklist: ["Bank statements"],
    message: `Collect the latest bank statements from ${name}. Save an unsent draft for me to approve.`,
  });
}

export async function fanOutBankStatementSends<T extends { id: string; name: string }>(
  clients: readonly T[],
  selectedIds: readonly string[],
  send: (client: T) => Promise<{ ok: boolean }>,
): Promise<{ sent: T[]; failed: T[] }> {
  const selected = new Set(selectedIds);
  const sent: T[] = [];
  const failed: T[] = [];
  for (const client of clients) {
    if (!selected.has(client.id)) continue;
    try {
      const result = await send(client);
      if (result.ok) sent.push(client);
      else failed.push(client);
    } catch {
      failed.push(client);
    }
  }
  return { sent, failed };
}

export function bankStatementSendNotice(result: {
  sent: readonly { name: string }[];
  failed: readonly { name: string }[];
}): string {
  const count = result.sent.length;
  const head = `Sent to ${count} ${count === 1 ? "client" : "clients"}`;
  if (result.failed.length === 0) return head;
  return `${head}. Could not send to ${result.failed.map((row) => row.name).join(", ")}.`;
}
