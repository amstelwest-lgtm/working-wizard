/**
 * Firm client workspace vs "Enter as client".
 * Opening /clients/:id from the practice list is not impersonation.
 * "Acting as client" is only true when this client is the active impersonation.
 */

export function isActingAsThisClient(
  actingAsClientId: string | null | undefined,
  clientId: string | null | undefined,
): boolean {
  const acting = (actingAsClientId ?? "").trim();
  const id = (clientId ?? "").trim();
  return acting.length > 0 && id.length > 0 && acting === id;
}

/** Breadcrumb on the firm client workspace. Name only, unless actually acting. */
export function firmClientCrumbLabel(clientName: string, acting: boolean): string {
  const name = clientName.trim() || "Client";
  return acting ? `Acting as client: ${name}` : name;
}
