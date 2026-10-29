/**
 * Milōn Financial Manager.
 * Service role runs the queue job (agent-dispatch or an on_demand invoke).
 * A signed-in accountant may ask this function to enqueue that same job
 * for one of the five rail PDFs. The Opus call stays in the queue runner.
 * Does not consume pre-card Bot answers.
 */
import { handlePrepareClientReport } from "./prepare-request.ts";
import { runFinancialManagerJob } from "./run.ts";
import {
  QUEUE_RUNNER_CORS,
  bearerRole,
  queueRunnerJson,
  serveQueuedRequest,
} from "../_shared/agent-core/serve-runner.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: QUEUE_RUNNER_CORS });
  if (req.method !== "POST") return queueRunnerJson({ error: "method_not_allowed" }, 405);
  if (bearerRole(req.headers.get("authorization") ?? "") === "service_role") {
    return serveQueuedRequest(req, "agent-financial-manager", runFinancialManagerJob);
  }
  return handlePrepareClientReport(req);
});
