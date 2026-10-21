export type BiometricLockApi = {
  available: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  setEnabled: (enabled: boolean) => Promise<{ ok: boolean; message?: string }>;
  unlock: () => Promise<{ ok: boolean; message?: string }>;
};

type BiometricHost = {
  __MILON_BIOMETRIC__?: BiometricLockApi;
};

export function readBiometricLock(host: BiometricHost | undefined | null): BiometricLockApi | null {
  const api = host?.__MILON_BIOMETRIC__;
  if (
    !api ||
    typeof api.available !== "function" ||
    typeof api.enabled !== "function" ||
    typeof api.setEnabled !== "function" ||
    typeof api.unlock !== "function"
  ) {
    return null;
  }
  return api;
}

/** The browser has no on-device lock. Callers render nothing. */
export function biometricLockAvailable(host?: BiometricHost | null): BiometricLockApi | null {
  if (host === undefined) {
    if (typeof window === "undefined") return null;
    return readBiometricLock(window);
  }
  return readBiometricLock(host);
}
