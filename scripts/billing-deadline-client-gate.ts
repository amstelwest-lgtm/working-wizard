/** Two clients, so a second client file stays on the skeleton until the gate settles. */
let gateClients: { firmClientCount: number | null; firstClientId: string | null } = {
  firmClientCount: 2,
  firstClientId: "first-client",
};

/** Tests change the count after the shell has mounted. */
export function setBillingDeadlineClientGate(next: {
  firmClientCount: number | null;
  firstClientId: string | null;
}): void {
  gateClients = next;
}

export async function loadFirmClientGateContext() {
  return { ...gateClients };
}

export async function loadFirstFirmClient() {
  return null;
}
