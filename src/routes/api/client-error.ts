import { createFileRoute } from "@tanstack/react-router";

// Dev-only endpoint: the inline reporter script in __root.tsx POSTs full,
// untruncated browser errors here so they show up in the workflow console.
export const Route = createFileRoute("/api/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.text();
          console.error("[client-error]", body.slice(0, 20000));
        } catch {
          /* ignore */
        }
        return new Response("ok");
      },
    },
  },
});
