/**
 * Accountant-facing status for the firm Documents card.
 * Pure: no env reads, no network.
 */

export const IM_DOCUMENTS_COMING_SOON =
  "Drive and OneDrive: coming soon, not needed for the pilot. Clients can upload through Send an agent.";

export const IM_CLOUD_PILLS = ["Not set up", "Ready to connect", "Connected", "Paused"] as const;

export type ImCloudPill = (typeof IM_CLOUD_PILLS)[number];

/** Connect stays hidden until that provider's client credentials, the OAuth flag, and the token key are all present. */
export function imCloudConnectVisible(input: {
  credentials: boolean;
  oauthSqlReady: boolean;
  tokenKeyReady: boolean;
}): boolean {
  return input.credentials && input.oauthSqlReady && input.tokenKeyReady;
}

export function imCloudStatusPill(input: {
  connectVisible: boolean;
  connected: boolean;
  paused: boolean;
}): ImCloudPill {
  if (input.paused) return "Paused";
  if (input.connected) return "Connected";
  if (input.connectVisible) return "Ready to connect";
  return "Not set up";
}

export function imDocumentsShowComingSoon(pills: readonly ImCloudPill[]): boolean {
  return pills.length > 0 && pills.every((pill) => pill === "Not set up");
}
