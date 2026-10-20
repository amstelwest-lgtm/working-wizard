/**
 * Where a billing check that timed out or failed shows the Retry card.
 * The outlet mounts from the local session first. Home, the client list,
 * settings, and billing stay usable. A client file or a report shows the card.
 * This is routing, not an entitlement grant.
 */

import { routePathname } from "@/lib/funnel-timing";
import {
  decideFirmBillingPathGate,
  isFirmProductPath,
  isPracticeShellPath,
  isTeamSettingsPath,
} from "@/lib/stripe-entitlement";

export type UnknownEntitlementAccess = "allow" | "wall";

export function accessWhileEntitlementUnknown(pathname: string): UnknownEntitlementAccess {
  const path = routePathname(pathname);
  if (!isFirmProductPath(path)) return "allow";
  if (isPracticeShellPath(path) || isTeamSettingsPath(path)) return "allow";
  return "wall";
}

/**
 * A known first client file may mount before Stripe answers.
 * An unknown count does not. Null is not treated as "open the file".
 */
export function pageWhileEntitlementUnknown(input: {
  pathname: string;
  firmClientCount: number | null;
  firstClientId: string | null;
}): UnknownEntitlementAccess {
  if (accessWhileEntitlementUnknown(input.pathname) === "allow") return "allow";
  if (input.firmClientCount == null) return "wall";
  const gate = decideFirmBillingPathGate({
    pathname: input.pathname,
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    firmClientCount: input.firmClientCount,
    firstClientId: input.firstClientId,
  });
  return gate === "allow" ? "allow" : "wall";
}
