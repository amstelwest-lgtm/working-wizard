import { ClientRoutinesPanel } from "@/components/client-routines-panel";

/** Owner seat — plain “This month” under Books. No bot names or rule ids. */
export function OwnerRoutinesMonth({ clientId }: { clientId: string }) {
  return <ClientRoutinesPanel clientId={clientId} firmId={null} ownerSeat />;
}