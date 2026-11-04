/**
 * Management / habits rules store + bot read wiring.
 * Run: pnpm test:client-management-habits-rules
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientManagementHabitsRulesPanel } from "../src/components/client-management-habits-rules-panel.tsx";
import {
  buildManagementHabitRuleMeta,
  libraryRuleChipsFromText,
  MANAGEMENT_HABITS_VIEW_LABEL,
  managementHabitRuleCitationLine,
  parseManagementHabitRuleArtifact,
  validateManagementHabitRuleInput,
} from "../src/lib/client-management-habits-rules.ts";
import {
  formatPeerContextBlock,
  listManagementRulesPayload,
  SHARED_DELIVERABLE_READS,
  SHARED_READ_PROMPT,
} from "../src/lib/agent-shared-reads.ts";
import { structureAgentReply } from "../src/lib/agent-reply.ts";
import { FM_TOOLS } from "../src/lib/agent-financial-manager.ts";
import { ANALYST_TOOLS } from "../src/lib/agent-analyst.ts";
import { executeSharedDeliverableRead } from "../supabase/functions/_shared/agent-shared-reads.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const meta = buildManagementHabitRuleMeta({
  pillar: "habits",
  label: "Weekly cash review",
  body: "Every Monday, confirm 13-week runway against the agreed buffer.",
  firmId: "11111111-1111-4111-8111-111111111111",
  authorId: "22222222-2222-4222-8222-222222222222",
  authorName: "Alex Accountant",
  editedAt: "2026-11-04T08:00:00.000Z",
});

const parsed = parseManagementHabitRuleArtifact({
  id: "33333333-3333-4333-8333-333333333333",
  client_id: "44444444-4444-4444-8444-444444444444",
  meta: meta as never,
  created_by: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-11-01T00:00:00.000Z",
});
assert(parsed?.pillar === "habits" && parsed.label === "Weekly cash review", "artifact meta parses");
assert(validateManagementHabitRuleInput({ pillar: "reality", label: "", body: "x" }) != null, "empty label fails");

const payload = listManagementRulesPayload(parsed ? [parsed] : []);
assert(Array.isArray(payload.rules) && payload.rules.length === 1, "list payload exposes rules");
assert(
  formatPeerContextBlock({
    library: [],
    managementRules: (payload.rules ?? []) as Array<Record<string, unknown>>,
    taxDrafts: [],
    taxPacks: [],
    report: null,
    proposals: [],
    sends: [],
    findings: [],
  }).includes("Management / habits rules"),
  "peer context mentions management habits",
);

assert(SHARED_DELIVERABLE_READS.includes("list_client_management_rules"), "shared read registered");
assert(FM_TOOLS.includes("list_client_management_rules"), "FM can list rules");
assert(ANALYST_TOOLS.includes("list_client_management_rules"), "Analyst can list rules");
assert(SHARED_READ_PROMPT.includes("list_client_management_rules"), "shared prompt names the read");
assert(SHARED_READ_PROMPT.includes("management / habits view"), "prompt labels the view");

const cite = managementHabitRuleCitationLine(parsed!);
const reply = structureAgentReply(`Headline\n${cite}\nNext actions\n- Call the bank`, {});
assert(
  reply.figures.some((chip) => chip.source === "library_rule"),
  "agent reply surfaces a library rule chip from citation text",
);
assert(libraryRuleChipsFromText(cite).length === 1, "citation parser finds one rule");

const html = renderToStaticMarkup(
  createElement(ClientManagementHabitsRulesPanel, {
    clientId: "44444444-4444-4444-8444-444444444444",
    firmId: "11111111-1111-4111-8111-111111111111",
    formatWhen: (iso: string) => iso.slice(0, 10),
  }),
);
assert(html.includes(MANAGEMENT_HABITS_VIEW_LABEL), "panel heading uses management / habits view");
assert(html.includes("Reality") && html.includes("Habits") && html.includes("Expectations"), "pillars in form");
assert(html.includes("data-management-habits-rules"), "panel marker for tests");
assert(html.includes("Not Compliance"), "panel distinguishes from Compliance");

const library = readFileSync("src/components/client-library.tsx", "utf8");
assert(
  library.includes("ClientManagementHabitsRulesPanel") && library.includes('audience === "accountant"'),
  "accountant library mounts the rules panel",
);

type Bucket = { data: unknown; error?: { message: string; code?: string } | null };
function fakeDb(tables: Record<string, Bucket>) {
  function chain(table: string) {
    const bucket = tables[table] ?? { data: [], error: null };
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      is: () => q,
      maybeSingle: async () => {
        const rows = Array.isArray(bucket.data) ? bucket.data : [];
        return { data: rows[0] ?? null, error: bucket.error ?? null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: bucket.data, error: bucket.error ?? null }).then(resolve, reject),
    };
    return q;
  }
  return { from: (table: string) => chain(table) };
}

const edge = await executeSharedDeliverableRead(
  "list_client_management_rules",
  {},
  {
    db: fakeDb({
      client_artifacts: {
        data: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            client_id: "44444444-4444-4444-8444-444444444444",
            kind: "note",
            visibility: "shared",
            meta,
            created_by: "22222222-2222-4222-8222-222222222222",
            created_at: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    }) as never,
    clientId: "44444444-4444-4444-8444-444444444444",
  },
);
assert(
  !(edge as { error?: string }).error && Array.isArray((edge as { rules?: unknown[] }).rules),
  "edge list returns rules",
);

console.log("client-management-habits-rules-test: ok");
