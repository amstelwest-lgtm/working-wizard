/**
 * Daily IM routine scheduler (Vercel cron). Bearer CRON_SECRET required; kill switch default off.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runImRoutineCron } from "@/lib/im-routine-cron.service";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

export const Route = createFileRoute("/api/im-routine-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => runImRoutineCron(request).then((result) => json(result, result.ok ? 200 : 401)),
      POST: async ({ request }) => runImRoutineCron(request).then((result) => json(result, result.ok ? 200 : 401)),
    },
  },
});