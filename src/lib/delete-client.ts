/**
 * Hard-delete a practice client. The row and cascading client data are removed
 * by delete_practice_client. Soft-archive stays in archive-client.ts.
 */
import { supabase } from "@/integrations/supabase/client";

export const DELETE_PERMANENTLY_PHRASE = "Delete permanently";

export function deleteClientConfirm(name: string): string {
  const label = name.trim() || "this client";
  return `Permanently deletes ${label} from the firm, including memberships, books, packs, and files. This cannot be undone.`;
}

/** What the person must type. A blank client name uses the explicit phrase. */
export function deleteConfirmExpected(clientName: string): string {
  const name = clientName.trim();
  return name || DELETE_PERMANENTLY_PHRASE;
}

export function deleteConfirmMatches(typed: string, clientName: string): boolean {
  return typed.trim().toLowerCase() === deleteConfirmExpected(clientName).toLowerCase();
}

export type DeleteClientDb = {
  rpc: (
    fn: "delete_practice_client",
    args: { p_client_id: string; p_confirm: string },
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
};

export async function deleteClientPermanently(
  clientId: string,
  confirmName: string,
  clientName: string,
  db: DeleteClientDb = supabase as unknown as DeleteClientDb,
): Promise<void> {
  const id = clientId.trim();
  if (!id) throw new Error("Missing client");
  if (!deleteConfirmMatches(confirmName, clientName)) {
    throw new Error(
      clientName.trim()
        ? "Type the client name to confirm"
        : "Type Delete permanently to confirm",
    );
  }
  const { data, error } = await db.rpc("delete_practice_client", {
    p_client_id: id,
    p_confirm: confirmName.trim(),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not delete this client");
}
