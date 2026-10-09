import { createContext, useContext } from "react";

/** True after the signed-in chrome providers have mounted. SSR and the first client render stay false. */
export const AppChromeReadyContext = createContext(false);

export function useAppChromeReady(): boolean {
  return useContext(AppChromeReadyContext);
}
