/**
 * Shared scope-check for all client-scoped server functions.
 *
 * When an accountant is impersonating a client (actingAsClientId is set),
 * every server function that touches client data MUST call this before
 * querying or mutating. It throws 403 if the requested clientId falls
 * outside the validated impersonation scope.
 *
 * Usage:
 *   assertClientScope(context.actingAsClientId, data.clientId);
 */
export function assertClientScope(
  actingAsClientId: string | null | undefined,
  clientId: string | undefined,
): void {
  if (actingAsClientId && clientId && actingAsClientId !== clientId) {
    throw new Response(
      "Forbidden: query is outside the current impersonation scope",
      { status: 403 },
    );
  }
}
