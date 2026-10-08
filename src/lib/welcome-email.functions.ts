import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * After a self-serve signup (password or Google) has a session, send the
 * welcome once. Invite accepts do not call this. Failures stay inside the
 * helper so the account is still created.
 */
export const sendSignupWelcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendSignupWelcomeForUser } = await import("@/lib/welcome-email.server");
    return sendSignupWelcomeForUser(context.userId);
  });
