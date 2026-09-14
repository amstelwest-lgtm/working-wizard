import { createFileRoute } from "@tanstack/react-router";
import { LLMS_TXT } from "@/lib/seo";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(LLMS_TXT, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
