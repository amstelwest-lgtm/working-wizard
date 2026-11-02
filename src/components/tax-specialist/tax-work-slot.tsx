/**
 * US-reachable gate for Work → Tax. The draft list loads only for a ZA client.
 */
import { useEffect, useState, type ComponentType } from "react";
import { ClientSubpageFrame } from "@/components/client-subpage";
import { TaxWorkPlaceholder } from "@/components/tax-work-placeholder";
import { taxSampleEnabled } from "@/lib/tax-specialist/enabled";
import type { TaxPageClient } from "@/components/tax-specialist/tax-specialist-slot";

type Loaded = ComponentType<{ client: TaxPageClient }>;

export function TaxWorkSlot({
  country,
  client,
}: {
  country: string | null | undefined;
  client: TaxPageClient;
}) {
  const [Page, setPage] = useState<Loaded | null>(null);
  const enabled = taxSampleEnabled(country);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import("./za-tax-work").then((mod) => {
      if (live) setPage(() => mod.ZaTaxWork);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled) return <TaxWorkPlaceholder />;
  if (!Page) {
    return (
      <ClientSubpageFrame id="tax" eyebrow="Work" title="Tax">
        <p role="status">Loading tax drafts…</p>
      </ClientSubpageFrame>
    );
  }
  return <Page client={client} />;
}
