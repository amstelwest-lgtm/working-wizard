/**
 * Who may call the extract-financials edge function.
 * A service-role caller may extract. A signed-in user may extract only for a
 * client or firm they can access. Everyone else is refused.
 */

export function extractionAccessGranted(input: {
  serviceRole: boolean;
  userId: string | null;
  clientId: string | null;
  firmId: string | null;
  clientAccess: boolean;
  firmAccess: boolean;
}): boolean {
  if (input.serviceRole) return true;
  if (!input.userId) return false;
  const clientId = input.clientId?.trim() || "";
  const firmId = input.firmId?.trim() || "";
  if (!clientId && !firmId) return false;
  if (clientId && !input.clientAccess) return false;
  if (firmId && !input.firmAccess) return false;
  return true;
}
