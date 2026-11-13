import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed-in landing choice for /open. The browser calls this after the tab
 * session exists; the href is decided here, not in the page.
 * `firmId` is the active firm. A missing id does not fall back to another firm.
 */
export const resolveSmartLanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { resolveSmartLandingDecision } = await import("@/lib/smart-landing.server");
    return resolveSmartLandingDecision({ ...context, firmId: data.firmId ?? null });
  });
