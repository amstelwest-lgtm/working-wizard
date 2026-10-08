import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed-in landing choice for /open. The browser calls this after the tab
 * session exists; the href is decided here, not in the page.
 */
export const resolveSmartLanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveSmartLandingDecision } = await import("@/lib/smart-landing.server");
    return resolveSmartLandingDecision(context);
  });
