/**
 * Runs before the generated auth attacher. A cold signed-in tab can call
 * `_serverFn` before getSession() has a token, which the server answers 401.
 * Refreshing here means the attacher's getSession() sends a usable bearer.
 */
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensureFreshAccessToken } from "@/lib/server-fn-session";

export const prepareServerFnSession = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    try {
      await ensureFreshAccessToken(supabase);
    } catch {
      /* the attacher still sends whatever getSession() has; the caller retries once */
    }
    return next();
  },
);
