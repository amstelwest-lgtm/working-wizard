/** Two clients, so a later client file is the page that shows the billing card. */
export async function loadFirmClientGateContext() {
  return {
    firmClientCount: 2,
    firstClientId: "11111111-1111-4111-8111-111111111112",
  };
}

export async function loadFirstFirmClient() {
  return null;
}
