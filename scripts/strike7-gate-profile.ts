/**
 * Cold tab: the firm row is not loaded on the first render.
 * It arrives 50ms later, which is the race the gate used to miss.
 */
import { useEffect, useState } from "react";
import { STRIKE7_BEN_ID, STRIKE7_MY_PRACTICE_ID } from "./strike7-firms";

export type Strike7FirmPick = "my-practice" | "ben";

let pick: Strike7FirmPick = "my-practice";

export function setStrike7FirmPick(next: Strike7FirmPick): void {
  pick = next;
}

export function useAccountantProfile() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 50);
    return () => window.clearTimeout(timer);
  }, []);
  if (!ready) {
    return {
      firmId: null as string | null,
      firmMarket: null,
      hasFirm: false,
      firms: [] as Array<{ id: string }>,
      firmsLoaded: false,
    };
  }
  const firmId = pick === "ben" ? STRIKE7_BEN_ID : STRIKE7_MY_PRACTICE_ID;
  return {
    firmId,
    firmMarket: { country: "US", region: "NY", regionCode: "NY" },
    hasFirm: true,
    firms: [{ id: firmId }],
    firmsLoaded: true,
  };
}

export function useOptionalAccountantProfile() {
  return useAccountantProfile();
}
