import { ClientRoutinesPanel } from "@/components/client-routines-panel";
import { imRoutinePeriodKey } from "@/lib/im-routine-schedule";

/** Owner seat — plain “This month” under Books. No bot names or rule ids. */
export function OwnerRoutinesMonth({ clientId }: { clientId: string }) {
  const periodKey = imRoutinePeriodKey();
  return (
    <ClientRoutinesPanel clientId={clientId} firmId={null} ownerSeat routinePeriodKey={periodKey} />
  );
}
