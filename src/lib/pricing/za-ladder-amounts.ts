import type { FirmCheckoutBand, FirmInterval } from "../stripe-plans.ts";
import { approvedPrice } from "./price-table.server.ts";
import { FIRM_BAND_CATALOG } from "../stripe-plans.ts";
import { zaLookupKey } from "./za-ladder.ts";

export type ZaCatalogEntry = {
  band: FirmCheckoutBand;
  interval: FirmInterval;
  lookupKey: string;
  /** Existing USD price whose product the rand price is attached to. */
  usdLookupKey: string;
  unitAmount: number;
  currency: "zar";
  recurringInterval: "month" | "year";
};

export function zaBandAmountCents(band: FirmCheckoutBand, interval: FirmInterval): number {
  const row = approvedPrice(band, interval, "ZAR");
  if (!row) throw new Error(`${band} has no approved rand price.`);
  return row.unitAmount;
}

export function zaCatalogEntries(): ZaCatalogEntry[] {
  const intervals: FirmInterval[] = ["month", "year"];
  const bands = [
    "starter",
    "solo",
    "small",
    "growing",
    "established",
    "larger",
    "advanced",
    "scale",
  ] as const;
  return bands.flatMap((band) =>
    intervals.map((interval) => {
      const usdLookupKey =
        interval === "year"
          ? FIRM_BAND_CATALOG[band].lookup.year
          : FIRM_BAND_CATALOG[band].lookup.month;
      if (!usdLookupKey) {
        throw new Error(`${band} is missing a USD lookup key.`);
      }
      const row = approvedPrice(band, interval, "ZAR");
      if (!row) throw new Error(`${band} ${interval} is missing from the price table.`);
      return {
        band,
        interval,
        lookupKey: zaLookupKey(band, interval),
        usdLookupKey,
        unitAmount: row.unitAmount,
        currency: "zar" as const,
        recurringInterval: interval === "year" ? ("year" as const) : ("month" as const),
      };
    }),
  );
}
