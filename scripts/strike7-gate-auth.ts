/** Signed-in accountant for the strike-7 gate race. No email. */
export const STRIKE7_GATE_USER_ID = "11111111-1111-4111-8111-111111111111";

export function useAuth() {
  return {
    user: {
      id: STRIKE7_GATE_USER_ID,
      user_metadata: {},
    },
    session: null,
    loading: false,
    restoreFailed: false,
    signOut: async () => {},
  };
}
