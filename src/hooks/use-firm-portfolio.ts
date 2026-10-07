import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { PortfolioRow } from "@/lib/portfolio";
import { getFirmPortfolio } from "@/lib/portfolio.functions";

/**
 * Portfolio rows for the practice Needs attention queue.
 * The dashboard owns this fetch so the tile and the strip share one result.
 */
export function useFirmPortfolioRows(
  firmId: string | null,
  refreshKey?: string | number,
): PortfolioRow[] {
  const fetch = useServerFn(getFirmPortfolio);
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!firmId) {
      setRows([]);
      return;
    }
    const mine = ++seq.current;
    fetch({ data: { firmId } })
      .then((res) => {
        if (mine === seq.current) setRows(res.rows ?? []);
      })
      .catch(() => {
        if (mine === seq.current) setRows([]);
      });
  }, [firmId, refreshKey, fetch]);

  return rows;
}
