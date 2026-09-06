import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";
import { reportServerError } from "./lib/monitoring.server";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    await reportServerError(error, { source: "request" });
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// A throw inside a server function is serialised back to the browser as a
// normal 200, so it never reaches errorMiddleware or server.ts. This is the
// only place those failures can be reported from the server side.
const reportServerFnErrors = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    try {
      return await next();
    } catch (error) {
      // Auth/scope rejections are Responses (401/403) — expected, not incidents.
      if (!(error instanceof Response)) {
        void reportServerError(error, {
          source: "server-fn",
          name: serverFnMeta?.name,
          extra: { file: serverFnMeta?.filename },
        });
      }
      throw error;
    }
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth, reportServerFnErrors],
}));
