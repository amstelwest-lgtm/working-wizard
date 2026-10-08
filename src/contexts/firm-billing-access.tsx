import { createContext, useContext, type ReactNode } from "react";

const FirmBillingAccessContext = createContext<boolean | null>(null);

/** The signed-in shell already resolved this. Null means the check has not finished. */
export function FirmBillingAccessProvider({
  entitled,
  children,
}: {
  entitled: boolean | null;
  children: ReactNode;
}) {
  return <FirmBillingAccessContext.Provider value={entitled}>{children}</FirmBillingAccessContext.Provider>;
}

export function useFirmBillingEntitled(): boolean | null {
  return useContext(FirmBillingAccessContext);
}
