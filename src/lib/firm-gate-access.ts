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

export type KnownFirmEntitlement = "entitled" | "unpaid" | "none";
export type FirmGateFailureSurface = "content" | "error" | "wall";

/**
 * A transient entitlement failure.
 * Entitled keeps the page. Unpaid on a gated route is the billing wall.
 * No known result on a gated route is the error screen. Home stays open.
 */
export function surfaceAfterEntitlementFailure(input: {
  known: KnownFirmEntitlement;
  pathname: string;
  firmClientCount: number | null;
  firstClientId: string | null;
}): FirmGateFailureSurface {
  if (input.known === "entitled") return "content";
  const page = pageWhileEntitlementUnknown(input);
  if (input.known === "unpaid") return page === "wall" ? "wall" : "content";
  return page === "wall" ? "error" : "content";
}

/**
 * The 8s timer runs once. On Home it leaves the page up, so it used to
 * forget the deadline. A later client file must not sit on the skeleton
 * until Stripe returns: the deadline has already passed.
 */
export function skeletonAfterBillingDeadline(input: {
  deadlinePassed: boolean;
  firmEntitled: boolean | null;
  unknownPage: UnknownEntitlementAccess;
}): boolean {
  return input.deadlinePassed && input.firmEntitled !== true && input.unknownPage === "wall";
}
