/**
 * Shared deliverable reads: same catalogue for every runner, no secrets.
 * Run: pnpm test:agent-shared-reads
 */
import { AGENT_KEYS } from "../src/lib/agent-bus.ts";
import { ADVISOR_TOOLS } from "../src/lib/agent-advisor.ts";
import { ANALYST_PEERS, ANALYST_TOOLS } from "../src/lib/agent-analyst.ts";
import { FM_TOOLS } from "../src/lib/agent-financial-manager.ts";
import {
  clientSendItem,
  figureProposalItem,
  formatPeerContextBlock,
  redactDeliverable,
  shapeManagementReport,
  SHARED_DELIVERABLE_READS,
} from "../src/lib/agent-shared-reads.ts";
import { AGENT_TOOLS } from "../supabase/functions/_shared/agent-core/loop.ts";
import { executeSharedDeliverableRead } from "../supabase/functions/_shared/agent-shared-reads.ts";
import { executeAnalystTool } from "../supabase/functions/agent-analyst/execute.ts";
import { askAiAgentPersona } from "../supabase/functions/ask-ai/prompt.ts";
import { milonBotChatSystem } from "../supabase/functions/milon-bot/prompt.ts";
import { TAX_SPECIALIST_CHAT_PERSONA } from "../supabase/functions/_shared/agent-prompts/tax-specialist.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type Bucket = { data: unknown; error?: { message: string; code?: string } | null };

function fakeDb(tables: Record<string, Bucket>) {
  function chain(table: string) {
    const bucket = tables[table] ?? {
      data: [],
      error: { code: "42P01", message: "relation does not exist" },
    };
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

{
  const redacted = redactDeliverable({
    file_name: "bank.pdf",
    password_box: "ciphertext",
    token_hash: "abc",
    summary: "March statement",
  }) as Record<string, unknown>;
  assert(redacted.file_name === "bank.pdf", "a file name stays");
  assert(redacted.summary === "March statement", "a summary stays");
  assert(redacted.password_box == null, "a file password is dropped");
  assert(redacted.token_hash == null, "a token hash is dropped");
}

{
  const proposal = figureProposalItem({
    id: "p1",
    surface: "cash",
    status: "pending",
    patch: { capexAmount: 5000, capexWeek: 3, password_box: "nope" },
    before_values: { capexAmount: 0 },
    note: "Add capex",
    proposed_by: "financial_manager",
    created_at: "2026-11-01T00:00:00Z",
  });
  const patch = proposal.patch as Record<string, unknown>;
  assert(patch.capexAmount === 5000 && patch.capexWeek === 3, "the cash patch is readable");
  assert(patch.password_box == null, "a proposal does not carry a password");
  assert(proposal.proposed_by === "financial_manager", "the proposal names the bot");
}

{
  const older = shapeManagementReport({
    id: "pack-1",
    version: 1,
    status: "draft",
    period_label: "FY2025",
    content: { schema: 1, sections: [{ key: "summary", meaning: "hidden" }] },
  });
  assert(older.schema === 1 && older.body == null, "a schema 1 pack does not return a body");
  const current = shapeManagementReport({
    id: "pack-2",
    version: 4,
    status: "in_review",
    period_label: "FY2026",
    content: {
      schema: 2,
      clientName: "Harbour",
      periodLabel: "Mar–Sep 2026",
      sections: [
        {
          key: "summary",
          meaning: "Cash is the constraint.",
          actions: ["Collect faster"],
          approved: false,
        },
      ],
      health: { overall: 72 },
      forecast: { floor: 1000, weeks: [{ week: 1, closing: 4000 }] },
    },
  });
  const body = current.body as {
    sections: Array<{ meaning: string }>;
    health: { overall: number };
  };
  assert(current.schema === 2, "schema 2 is marked");
  assert(
    body.sections[0].meaning === "Cash is the constraint.",
    "the summary section is in the body",
  );
  assert(body.health.overall === 72, "health is in the body");
}

{
  const send = clientSendItem(
    {
      id: "send-1",
      agent: "tax-specialist",
      checklist_key: "za-physio-tax-pack",
      completed_at: "2026-11-01T00:00:00Z",
      token_hash: "should-not-matter",
      password_box: "nope",
      report_summary: "Received the bank statements.",
    },
    [
      { send_id: "send-1", item_key: "bank_statements", status: "received", quality: "usable" },
      { send_id: "send-1", item_key: "irp5", status: "open", quality: null },
    ],
  );
  assert(send.state === "completed", "a finished send is completed");
  assert(
    send.items_received === 1 && send.items_total === 2,
    "item counts come from the checklist",
  );
  assert(
    !("token_hash" in send) && !("password_box" in send),
    "the send view has no token and no password",
  );
}

{
  const block = formatPeerContextBlock({
    library: [{ name: "bank.pdf", kind: "bank_statement" }],
    taxDrafts: [{ form_code: "IRP6", tax_year: 2026, period: 1, status: "draft" }],
    taxPacks: [{ status: "draft", preview: "Income cited from the bank file." }],
    report: {
      empty: false,
      version: 4,
      status: "in_review",
      schema: 2,
      body: { sections: [{ meaning: "Cash is tight." }] },
    },
    proposals: [{ surface: "cash", status: "pending" }],
    sends: [{ agent: "tax-specialist", state: "completed", items_received: 1, items_total: 2 }],
    findings: [{ agent: "analyst", severity: "watch", title: "Debtor days are 64." }],
  });
  for (const line of [
    "Library",
    "IRP6",
    "Tax packs",
    "schema 2",
    "Figure proposals",
    "Send-an-agent",
    "Team findings",
  ]) {
    assert(block.includes(line), `the prompt block names ${line}`);
  }
}

{
  for (const list of [FM_TOOLS, ANALYST_TOOLS, ADVISOR_TOOLS, AGENT_TOOLS]) {
    for (const name of SHARED_DELIVERABLE_READS) {
      assert(
        (list as readonly string[]).includes(name),
        `${name} is on every runner and milon-bot`,
      );
    }
  }
  assert((ANALYST_TOOLS as readonly string[]).includes("get_inbox"), "analyst inbox");
  assert(
    (ANALYST_TOOLS as readonly string[]).includes("send_agent_message"),
    "analyst can message",
  );
  assert(
    JSON.stringify(ANALYST_PEERS) === JSON.stringify(["financial_manager", "advisor"]),
    "analyst peers are the other two runners",
  );
  assert(
    !(AGENT_KEYS as readonly string[]).includes("tax_specialist"),
    "tax stays off agent_key until Phase 0",
  );
}

{
  const analyst = askAiAgentPersona("analyst", "accountant");
  const advisor = askAiAgentPersona("advisor", "owner");
  assert(!/do not coordinate the team/i.test(analyst), "ask-ai analyst may use peer context");
  assert(!/do not coordinate the team/i.test(advisor), "ask-ai advisor may use peer context");
  assert(/chat transcripts/i.test(analyst), "chat history stays per agent");
  assert(
    !/Do not coordinate the team/.test(TAX_SPECIALIST_CHAT_PERSONA),
    "tax chat is not told to ignore the team",
  );
  assert(
    /not on the agent message bus yet/i.test(TAX_SPECIALIST_CHAT_PERSONA),
    "tax chat names the follow-up",
  );
  assert(
    /Do not invent tax figures/.test(TAX_SPECIALIST_CHAT_PERSONA),
    "tax chat still does not invent figures",
  );
  const bot = milonBotChatSystem("You are Milonbot.", "analyst", "owner");
  assert(
    !/Do not refer to chats with the other agents/.test(bot),
    "milon-bot may use listed peer context",
  );
  assert(/own earlier turns/i.test(bot), "milon-bot still keeps this thread's history");
}

{
  const db = fakeDb({
    figure_proposals: {
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          surface: "budget",
          status: "pending",
          patch: { gpPct: 40 },
          before_values: { gpPct: 35 },
          note: null,
          proposed_by: "financial_manager",
          created_at: "2026-11-01T00:00:00Z",
        },
      ],
    },
    client_agent_sends: {
      data: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          agent: "financial_manager",
          checklist_key: "collect_documents",
          mission_key: "confirm_balances",
          created_at: "2026-11-02T00:00:00Z",
          consent_at: "2026-11-02T00:00:00Z",
          completed_at: null,
          reviewed_at: null,
          revoked_at: null,
          report_summary: null,
          firm_note: "Ask about the loan.",
        },
      ],
    },
    client_agent_send_items: {
      data: [
        {
          send_id: "22222222-2222-4222-8222-222222222222",
          item_key: "bank_statements",
          status: "open",
          quality: null,
        },
      ],
    },
    advisory_packs: {
      data: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          version: 2,
          status: "draft",
          period_label: "FY2026",
          updated_at: "2026-11-02T00:00:00Z",
          content: {
            schema: 2,
            sections: [
              { key: "cash", meaning: "Thirteen weeks are on file.", actions: [], approved: false },
            ],
          },
        },
      ],
    },
  });
  const client = db as unknown as Parameters<typeof executeSharedDeliverableRead>[2]["db"];
  const proposals = (await executeSharedDeliverableRead(
    "list_figure_proposals",
    {},
    { db: client, clientId: "c1" },
  )) as {
    proposals: Array<{ surface: string; patch: { gpPct: number } }>;
  };
  assert(proposals.proposals[0].surface === "budget", "a runner can read a budget proposal back");
  assert(proposals.proposals[0].patch.gpPct === 40, "the proposal patch is the saved one");
  const sends = (await executeSharedDeliverableRead(
    "list_client_sends",
    {},
    { db: client, clientId: "c1" },
  )) as {
    sends: Array<{ state: string; firm_note: string; items_total: number }>;
  };
  assert(sends.sends[0].state === "consented", "an open consented send is not completed");
  assert(sends.sends[0].firm_note === "Ask about the loan.", "the firm note is visible to the bot");
  assert(sends.sends[0].items_total === 1, "send items are attached");
  const report = (await executeSharedDeliverableRead(
    "get_management_report",
    {},
    { db: client, clientId: "c1" },
  )) as {
    schema: number;
    body: { sections: Array<{ meaning: string }> };
  };
  assert(
    report.schema === 2 && report.body.sections[0].meaning.includes("Thirteen weeks"),
    "the Management Report body is returned",
  );
  const drafts = (await executeSharedDeliverableRead(
    "list_tax_drafts",
    {},
    { db: client, clientId: "c1" },
  )) as {
    empty: boolean;
    drafts: unknown[];
  };
  assert(
    drafts.empty === true && drafts.drafts.length === 0,
    "a missing tax draft table is an empty list",
  );
}

{
  const q = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({
        data: [
          {
            id: "m1",
            from_agent: "advisor",
            type: "request",
            payload: { body: "Look at debtor days." },
            hop: 0,
            created_at: "2026-11-02T00:00:00Z",
          },
        ],
        error: null,
      }).then(resolve);
    },
  };
  const db = { from: () => q };
  const inbox = (await executeAnalystTool(
    "get_inbox",
    {},
    {
      clientId: "c",
      runId: "r",
      correlationId: "k",
      firmId: null,
      db: db as never,
      pool: [],
      recordedKeys: new Set(),
    },
  )) as { empty: boolean; messages: Array<{ from_agent: string }> };
  assert(
    inbox.empty === false && inbox.messages[0].from_agent === "advisor",
    "the analyst inbox returns a peer message",
  );
}

console.log("agent-shared-reads: ok");
