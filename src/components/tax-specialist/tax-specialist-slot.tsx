/**
 * US-reachable gate. The sample module loads only when the market is ZA.
 * Do not static-import za-tax-specialist-sample from here.
 * The card, desk, and stage shells are in the first render, with the
 * same data-agent-card attribute the loaded sample keeps.
 */
import { useEffect, useState, type ComponentType } from "react";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { AGENT_CARD_CHECKING } from "@/lib/agent-card-phase";
import { taxSampleCardVisible, taxSampleEnabled } from "@/lib/tax-specialist/enabled";

export type TaxSampleAudience = "owner" | "accountant";
export type TaxSampleVariant = "card" | "desk" | "stage" | "handoff" | "fm-handoff" | "host";

type Loaded = ComponentType<{
  variant: TaxSampleVariant;
  audience: TaxSampleAudience;
  onOpen?: () => void;
  sampleClient?: boolean;
}>;

const SHELL_VARIANTS = new Set<TaxSampleVariant>(["card", "desk", "stage"]);

function TaxCardShell({ variant }: { variant: "card" | "desk" | "stage" }) {
  const className =
    variant === "desk"
      ? "milon-desk-agent"
      : variant === "stage"
        ? "tax-sample-stage"
        : "owner-agent";
  return (
    <div
      className={className}
      data-agent="tax_specialist"
      data-agent-card="tax_specialist"
      data-tax-card="loading"
      role="status"
    >
      <OwnerAvatar
        agent="tax_specialist"
        variant="character"
        size={variant === "card" ? "lg" : "sm"}
        motion="idle"
      />
      <span className="owner-voice">{AGENT_CARD_CHECKING}</span>
    </div>
  );
}

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
  /** Home card only. A demo client gets the sample card. A real client gets the preview card. */
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

  if (!enabled) return null;
  if (!Slot && SHELL_VARIANTS.has(variant)) {
    return <TaxCardShell variant={variant as "card" | "desk" | "stage"} />;
  }
  if (!Slot) return null;
  return <Slot variant={variant} audience={audience} onOpen={onOpen} sampleClient={sampleClient} />;
}
