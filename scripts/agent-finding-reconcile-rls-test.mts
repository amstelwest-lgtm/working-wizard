/**
 * Regenerate persist path: admin write after access check, UI must not swallow failures.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/agent-finding-reconcile-rls-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const fnSrc = readFileSync(resolve("src/lib/agent-finding-reconcile.functions.ts"), "utf8");
const healthLine = readFileSync(resolve("src/components/health-narrative-line.tsx"), "utf8");
const desk = readFileSync(resolve("src/components/milon-team/milon-team-desk.tsx"), "utf8");

assert(fnSrc.includes("has_client_access"), "access is checked before write");
assert(fnSrc.includes("supabaseAdmin"), "finding update uses service role after access check");
assert(
  /supabaseAdmin[\s\S]*\.update\([\s\S]*\.select\("id"\)[\s\S]*\.single\(\)/.test(fnSrc),
  "update selects id and throws on zero rows",
);
assert(!fnSrc.includes("context.supabase\n      .from(\"agent_findings\")\n      .update"), "user client is not used for update");

assert(healthLine.includes("toast.error"), "Regenerate surfaces persist errors");
assert(!/catch\s*\{\s*setShown\(liveSentence\)/.test(healthLine), "failed regen does not paint local-only copy");

assert(desk.includes("findingId={row.id}"), "plain desk findings call reconcile");
assert(desk.includes("onReconciled={onRefreshDrafts}"), "desk refresh runs after persist");

console.log("agent-finding-reconcile-rls-test: ok");
