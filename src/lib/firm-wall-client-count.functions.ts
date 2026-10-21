import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Client count for the card-free trial sentence. The same read the cap uses.
 * Null when it cannot be loaded. The wall must not treat that as one client.
 */
export const readFirmWallClientCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().trim().min(1).nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<number | null> => {
    const ctx = context as { supabase: unknown; userId: string };
    const { loadFirmClientCount } = await import("@/lib/firm-client-cap.server");
    return loadFirmClientCount({
      supabase: ctx.supabase,
      userId: ctx.userId,
      firmId: data.firmId,
    });
  });
