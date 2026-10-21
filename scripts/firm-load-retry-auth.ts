/** Signed-in accountant. The email is here so a breadcrumb that leaks it fails. */
import { FIRM_LOAD_USER_ID } from "./firm-load-retry-supabase";

export function useAuth() {
  return {
    user: {
      id: FIRM_LOAD_USER_ID,
      email: "ada@example.com",
      user_metadata: {},
    },
    session: null,
    loading: false,
    restoreFailed: false,
    signOut: async () => {},
  };
}
