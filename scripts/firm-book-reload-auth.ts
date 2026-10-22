/** Signed-in accountant. The firm reload deadline must not print this email. */
export const FIRM_BOOK_USER_ID = "33333333-3333-4333-8333-333333333333";
export const FIRM_BOOK_EMAIL = "ada@example.com";

export function useAuth() {
  return {
    user: {
      id: FIRM_BOOK_USER_ID,
      email: FIRM_BOOK_EMAIL,
      user_metadata: {},
    },
    session: null,
    loading: false,
    restoreFailed: false,
    signOut: async () => {},
  };
}
