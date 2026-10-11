/**
 * Milōn Advisor. Service-role only.
 * Invoked by agent-dispatch via pg_net, or by an owner hand-off.
 * Does not consume pre-card Bot answers.
 */
import { serveQueueRunner } from "../_shared/agent-core/serve-runner.ts";
import { runAdvisorJob } from "./run.ts";

serveQueueRunner("agent-advisor", runAdvisorJob);
