/**
 * US-reachable gate. The sample module loads only when the market is ZA.
 * Do not static-import za-tax-specialist-sample from here.
 */
import { useEffect, useState, type ComponentType } from "react";
import { taxSampleCardVisible, taxSampleEnabled } from "@/lib/tax-specialist/enabled";

export type TaxSampleAudience = "owner" | "accountant";
export type TaxSampleVariant = "card" | "desk" | "stage" | "handoff" | "fm-handoff" | "host";

type Loaded = ComponentType<{
  variant: TaxSampleVariant;
  audience: TaxSampleAudience;
  onOpen?: () => void;
}>;

export function TaxSpecialistSlot({
  country,
  variant,
  audience,
  onOpen,
  sampleClient = false,
}: {
  country: string | null | undefined;
  variant: TaxSampleVariant;
  audience: TaxSampleAudience;
  onOpen?: () => void;
  /** Home card only. Real clients pass false and the card stays off. */
  sampleClient?: boolean;
}) {
  const [Slot, setSlot] = useState<Loaded | null>(null);
  const enabled =
    variant === "card" ? taxSampleCardVisible(country, sampleClient) : taxSampleEnabled(country);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import("./za-tax-specialist-sample").then((mod) => {
      if (live) setSlot(() => mod.ZaTaxSpecialistSample);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled || !Slot) return null;
  return <Slot variant={variant} audience={audience} onOpen={onOpen} />;
}
