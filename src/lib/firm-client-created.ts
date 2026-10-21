/**
 * Where Add client goes after a successful create, and the button copy
 * while that request is in flight. No currency in this copy: US firms must
 * not see rand, and the client page picks USD or ZAR from the saved market.
 */

export const ADD_CLIENT_CREATING_AFTER_MS = 1_200;

export const ADD_CLIENT_BUTTON = {
  idle: "Add client",
  checking: "Checking your plan…",
  creating: "Creating the client…",
  opening: "Opening their Home…",
} as const;

export type AddClientSavePhase = "checking" | "creating" | "opening";

export function addClientButtonLabel(phase: AddClientSavePhase | null): string {
  if (!phase) return ADD_CLIENT_BUTTON.idle;
  return ADD_CLIENT_BUTTON[phase];
}

/**
 * New client Home, with the Step 1 upload / connect dialog.
 * `tab=home` is the client Home. `onboard=1` opens "Step 1 of 2".
 */
export function firmClientCreatedNavigation(clientId: string): {
  to: "/clients/$clientId";
  params: { clientId: string };
  search: { tab: "home"; onboard: "1" };
} {
  return {
    to: "/clients/$clientId",
    params: { clientId },
    search: { tab: "home", onboard: "1" },
  };
}

export function firmClientAddedToast(input: {
  name: string;
  clientCode?: string | null;
  inviteDetail?: string | null;
}): string {
  const name = input.name.trim() || "Client";
  const code = input.clientCode?.trim();
  const who = code ? `${name} (${code})` : name;
  const lead = `${who} is on their Home. Upload or connect their figures.`;
  const detail = input.inviteDetail?.trim();
  return detail ? `${lead} ${detail}` : lead;
}
