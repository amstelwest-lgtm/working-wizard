/**
 * Playbook drawer status. The tag is the client's Health band for that ratio.
 * A library with no client does not invent Watch.
 */
import { healthBandLabel, type HealthTier } from "./ratios.ts";

export function playbookDrawerStatusLabel(
  clientId: string | null | undefined,
  tier: HealthTier,
): string | null {
  if (!clientId?.trim()) return null;
  return healthBandLabel(tier);
}
