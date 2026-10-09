import {
  FIRM_BAND_CATALOG,
  FIRM_CHECKOUT_BANDS,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import { annualZarCents, ZA_MONTHLY_CENTS, zaLookupKey } from "@/lib/pricing/za-ladder";

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
  const monthly = ZA_MONTHLY_CENTS[band];
  if (interval === "month") return monthly;
  const entry = FIRM_BAND_CATALOG[band];
  const yearlyUsd = entry.yearlyUsdCents;
  const monthlyUsd = entry.monthlyUsdCents;
  if (yearlyUsd == null || monthlyUsd == null) {
    throw new Error(`${entry.name} has no annual catalog price.`);
  }
  return annualZarCents(monthly, yearlyUsd, monthlyUsd);
}

export function zaCatalogEntries(): ZaCatalogEntry[] {
  const intervals: FirmInterval[] = ["month", "year"];
  return FIRM_CHECKOUT_BANDS.flatMap((band) =>
    intervals.map((interval) => {
      const usdLookupKey =
        interval === "year"
          ? FIRM_BAND_CATALOG[band].lookup.year
          : FIRM_BAND_CATALOG[band].lookup.month;
      if (!usdLookupKey) {
        throw new Error(`${band} is missing a USD lookup key.`);
      }
      return {
        band,
        interval,
        lookupKey: zaLookupKey(band, interval),
        usdLookupKey,
        unitAmount: zaBandAmountCents(band, interval),
        currency: "zar" as const,
        recurringInterval: interval === "year" ? ("year" as const) : ("month" as const),
      };
    }),
  );
}
