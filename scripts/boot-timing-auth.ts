/** Signed-in accountant. The email must not appear in the boot line. */
export const BOOT_TIMING_USER_ID = "33333333-3333-4333-8333-333333333333";
export const BOOT_TIMING_EMAIL = "ada@example.com";

export function useAuth() {
  return {
    user: {
      id: BOOT_TIMING_USER_ID,
      email: BOOT_TIMING_EMAIL,
      user_metadata: {},
    },
    session: null,
    loading: false,
    restoreFailed: false,
    signOut: async () => {},
  };
}
