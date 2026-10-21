/** Two clients, so a second client file stays on the skeleton until the gate settles. */
export async function loadFirmClientGateContext() {
  return { firmClientCount: 2, firstClientId: "first-client" };
}

export async function loadFirstFirmClient() {
  return null;
}
