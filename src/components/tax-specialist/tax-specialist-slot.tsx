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
  onOpenPage?: () => void;
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

type LoadedPage = ComponentType<{
  activity?: Array<{ id: string; text: string; at: string }>;
}>;

/** The tax agent page sections. Nothing renders, and nothing loads, outside ZA. */
export function TaxSpecialistPage({
  country,
  activity,
}: {
  country: string | null | undefined;
  activity?: Array<{ id: string; text: string; at: string }>;
}) {
  const [Page, setPage] = useState<LoadedPage | null>(null);
  const enabled = taxSampleEnabled(country);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import("./za-tax-specialist-page").then((mod) => {
      if (live) setPage(() => mod.ZaTaxSpecialistPage);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled) return null;
  if (!Page) {
    return (
      <p className="agent-section-empty" data-tax-page="loading" role="status">
        {AGENT_CARD_CHECKING}
      </p>
    );
  }
  return <Page activity={activity} />;
}

export function TaxSpecialistSlot({
  country,
  variant,
  audience,
  onOpen,
  onOpenPage,
  sampleClient = false,
}: {
  country: string | null | undefined;
  variant: TaxSampleVariant;
  audience: TaxSampleAudience;
  onOpen?: () => void;
  /** Home card only. Opens the agent page instead of the sample sheet. */
  onOpenPage?: () => void;
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
  return (
    <Slot
      variant={variant}
      audience={audience}
      onOpen={onOpen}
      onOpenPage={variant === "card" ? onOpenPage : undefined}
      sampleClient={sampleClient}
    />
  );
}
