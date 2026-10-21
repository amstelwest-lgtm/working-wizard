/** Signed-in accountant for the billing-gate deadline test. */
export const BILLING_DEADLINE_USER_ID = "11111111-1111-4111-8111-111111111111";

export function useAuth() {
  return {
    user: {
      id: BILLING_DEADLINE_USER_ID,
      email: "ben@example.com",
      user_metadata: {},
    },
    session: null,
    loading: false,
    restoreFailed: false,
    signOut: async () => {},
  };
}
