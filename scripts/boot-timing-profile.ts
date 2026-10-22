/**
 * Firm market with a decoy email. The boot line may keep only the country.
 * State lives on globalThis so the gate and the test share one value even
 * when Vite loads this file twice.
 */
type BootTimingFirmState = {
  firmMarket: { country: string; note?: string } | null;
  firmsLoaded: boolean;
  firmsLoadFailed: boolean;
};

const BOOT_TIMING_FIRM_KEY = "__bootTimingFirmState";

function bootTimingFirmState(): BootTimingFirmState {
  const holder = globalThis as typeof globalThis & { [BOOT_TIMING_FIRM_KEY]?: BootTimingFirmState };
  if (!holder[BOOT_TIMING_FIRM_KEY]) {
    holder[BOOT_TIMING_FIRM_KEY] = {
      firmMarket: { country: "ZA", note: "ada@example.com" },
      firmsLoaded: false,
      firmsLoadFailed: false,
    };
  }
  return holder[BOOT_TIMING_FIRM_KEY];
}

/** The gate test resolves the country after the shell has already opened. */
export function setBootTimingFirmMarket(
  market: { country: "ZA" | "US"; note?: string } | null,
  opts?: { loaded?: boolean; failed?: boolean },
): void {
  const state = bootTimingFirmState();
  state.firmMarket = market;
  state.firmsLoaded = opts?.loaded ?? false;
  state.firmsLoadFailed = opts?.failed ?? false;
}

export function useAccountantProfile() {
  const state = bootTimingFirmState();
  return {
    firmId: null as string | null,
    firmMarket: state.firmMarket,
    hasFirm: false,
    firms: [] as Array<{ id: string }>,
    firmsLoaded: state.firmsLoaded,
    firmsLoadFailed: state.firmsLoadFailed,
    refreshFirms: async () => {},
  };
}
