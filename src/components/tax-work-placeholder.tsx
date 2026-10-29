import { ClientSubpageFrame } from "@/components/client-subpage";
import { EmptyState } from "@/components/primitives/empty-state";

/**
 * Work rail page for tax specialist deliverables.
 * The list itself lands in a later change. This page only holds the place.
 */
export function TaxWorkPlaceholder() {
  return (
    <ClientSubpageFrame id="tax" eyebrow="Work" title="Tax">
      <EmptyState
        id="tax-empty"
        dashed
        title="No tax deliverables yet"
        description="They will show up here when there is something to review."
      />
    </ClientSubpageFrame>
  );
}
