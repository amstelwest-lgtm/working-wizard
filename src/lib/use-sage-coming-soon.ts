import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSageConfig } from "@/lib/sage.functions";

/** True when Sage credentials are not configured. A failed check stays disabled. */
export function useSageComingSoon(): boolean {
  const check = useServerFn(getSageConfig);
  const [soon, setSoon] = useState(false);
  useEffect(() => {
    let cancel = false;
    void check({ data: undefined as never })
      .then((cfg) => {
        if (!cancel) setSoon(cfg.configured === false);
      })
      .catch(() => {
        if (!cancel) setSoon(true);
      });
    return () => {
      cancel = true;
    };
  }, [check]);
  return soon;
}
