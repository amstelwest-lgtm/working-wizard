export { setPortalIntent, clearForcePortal } from "../src/lib/user-roles.ts";

/** The deadline test is already inside the accountant shell. */
export function shouldStayOnAccountantPortal(): Promise<boolean> {
  return Promise.resolve(true);
}

export function isMilonItMember(): Promise<boolean> {
  return Promise.resolve(false);
}
