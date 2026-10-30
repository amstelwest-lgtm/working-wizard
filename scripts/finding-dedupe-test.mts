/**
 * What I noticed shows each finding once: one row per agent and title key,
 * nothing the hero already says, and at most three before Show all.
 * Run: pnpm test:finding-dedupe
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MilonTeamDesk } from "../src/components/milon-team/milon-team-desk";
import type { MilonTeamFeedApi } from "../src/hooks/use-milon-team-feed";
import { findingTitleKey } from "../src/lib/finding-title-key";
import {
  dedupeFindings,
  type AgentActivitySnapshot,
  type AgentFindingRow,
} from "../src/lib/milon-team-activity";
import type { MilonTeamFeed, TeamBriefingItem } from "../src/lib/milon-team-feed";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { supersededFindingIds } from "../supabase/functions/_shared/agent-findings-supersede";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const NOW = new Date("2026-10-08T12:00:00.000Z");

eq(findingTitleKey("Gross margin is 42%."), "gross margin is %.", "digits and case drop out");
eq(findingTitleKey("  Gross   Margin is 40%. "), "gross margin is %.", "spaces collapse");
eq(
  findingTitleKey("Debtor days are 44 days"),
  findingTitleKey("Debtor days are 51 days"),
  "only the figure changed",
);

function finding(
  partial: Partial<AgentFindingRow> & Pick<AgentFindingRow, "id" | "title" | "created_at">,
): AgentFindingRow {
  return {
    agent: "analyst",
    client_id: "c",
    detail: null,
    evidence: { period_label: "Sep 2026" },
    as_of: "2026-09-30",
    ...partial,
  };
}

const rows = [
  finding({ id: "old", title: "Gross margin is 40%.", created_at: "2026-10-01T08:00:00.000Z" }),
  finding({ id: "new", title: "Gross margin is 42%.", created_at: "2026-10-07T08:00:00.000Z" }),
  finding({
    id: "seen",
    title: "Debtor days are 44 days.",
    created_at: "2026-09-20T08:00:00.000Z",
    last_seen: "2026-10-06T08:00:00.000Z",
  }),
  finding({
    id: "stale",
    title: "Debtor days are 51 days.",
    created_at: "2026-10-02T08:00:00.000Z",
  }),
  finding({
    id: "done",
    title: "Gross margin is 39%.",
    created_at: "2026-09-01T08:00:00.000Z",
    status: "approved",
  }),
  finding({
    id: "fm",
    agent: "financial_manager",
    title: "Gross margin is 40%.",
    created_at: "2026-10-01T08:00:00.000Z",
  }),
];
eq(
  dedupeFindings(rows).map((row) => row.id),
  ["new", "seen", "fm", "done"],
  "newest per agent and title, by last_seen; approved rows stay; other agents are separate",
);
eq(dedupeFindings([]), [], "no rows, no output");

eq(
  supersededFindingIds({ id: "new", title: "Gross margin is 42%." }, [
    { id: "new", title: "Gross margin is 42%." },
    { id: "old", title: "Gross margin is 40%.", status: null },
    { id: "done", title: "Gross margin is 39%.", status: "approved" },
    { id: "gone", title: "Gross margin is 38%.", status: "dismissed" },
    { id: "other", title: "Debtor days are 44 days." },
  ]),
  ["old"],
  "the writer supersedes only open rows with the same key",
);
eq(
  supersededFindingIds({ id: "x", title: "42" }, [{ id: "y", title: "41" }]),
  [],
  "an empty key supersedes nothing",
);

for (const path of [
  "supabase/functions/_shared/agent-desk.ts",
  "supabase/functions/agent-analyst/execute.ts",
]) {
  const src = readFileSync(path, "utf8");
  const insert = src.indexOf('.from("agent_findings")\n    .insert(');
  const after = src.slice(insert, insert + 1200);
  assert(
    insert > 0 && /supersede\w*\(ctx, String\(data\.id\)/.test(after),
    `${path} supersedes older rows after an insert`,
  );
}
const migration = readFileSync(
  "supabase/migrations/20261030120000_agent_findings_title_supersede.sql",
  "utf8",
);
assert(
  migration.includes(
    "btrim(regexp_replace(lower(regexp_replace(f.title, '[0-9]', '', 'g')), '\\s+', ' ', 'g'))",
  ),
  "the migration uses the same title key",
);
assert(
  migration.includes("IS DISTINCT FROM 'approved'"),
  "the migration leaves approved rows alone",
);

function api(partial: Partial<MilonTeamFeed>): MilonTeamFeedApi {
  return {
    briefing: [],
    jobs: [],
    activity: [],
    agents: {
      financial_manager: { agent: "financial_manager", lastRunAt: null, lastRunKind: null },
      analyst: {
        agent: "analyst",
        lastRunAt: "2026-10-08T10:00:00.000Z",
        lastRunKind: "diagnosis",
      },
      advisor: { agent: "advisor", lastRunAt: null, lastRunKind: null },
    },
    signoffLine: null,
    precard: { capped: false, remaining: null, limit: null },
    loading: false,
    error: null,
    approveJob: async () => ({ ok: true, draftId: null }),
    dismissJob: async () => ({ ok: true }),
    refresh() {},
    ...partial,
  };
}

const live: AgentActivitySnapshot = {
  runs: [],
  findings: [
    finding({
      id: "gm-old",
      title: "Gross margin is 40%.",
      created_at: "2026-10-01T08:00:00.000Z",
    }),
    finding({ id: "gm", title: "Gross margin is 42%.", created_at: "2026-10-07T08:00:00.000Z" }),
    finding({
      id: "debt",
      title: "Debtor days are 44 days.",
      created_at: "2026-10-06T08:00:00.000Z",
    }),
    finding({
      id: "stock",
      title: "Stock days rose to 61 days.",
      created_at: "2026-10-05T08:00:00.000Z",
    }),
  ],
  messages: [],
  market: ZA_MARKET,
};
const ratio = (id: string, title: string, detail: string): TeamBriefingItem => ({
  id,
  agent: "analyst",
  title,
  detail,
  severity: "watch",
  source: { label: "Ratios", asOf: "2026-09-30" },
});
const briefing = [
  ratio("ratio:grossMargin", "Gross Margin", "Gross Margin 42.0%"),
  ratio("ratio:currentRatio", "Current Ratio", "Current Ratio 1.2"),
  ratio("ratio:assetTurnover", "Asset Turnover", "Asset Turnover 0.9"),
];
const render = (heroFinding: { id: string | null; text: string | null } | null) =>
  renderToStaticMarkup(
    createElement(MilonTeamDesk, {
      feed: api({ briefing }),
      now: NOW,
      live,
      initialFilter: "analyst",
      presentation: "agent",
      heroFinding,
    }),
  );

const page = render({ id: "gm", text: "Gross margin is 42%." });
assert(!page.includes('data-finding="gm"'), "the hero finding is left out");
assert(!page.includes('data-finding="gm-old"'), "an older copy of the hero finding is gone too");
assert(
  !page.includes('data-ratio="ratio:grossMargin"'),
  "a ratio that repeats a finding is dropped",
);
assert(page.indexOf('data-finding="debt"') < page.indexOf('data-finding="stock"'), "newest first");
eq((page.match(/data-(finding|ratio)="/g) ?? []).length, 3, "three rows before Show all");
assert(page.includes(">Show all<"), "the rest sit behind Show all");
assert(!page.includes("milon-desk-source"), "no repeating source chips");
assert(!page.includes("milon-desk-tag"), "no repeating agent tags");
assert(page.includes("checked"), "each row keeps the date checked");

const fromHome = render({ id: null, text: "Debtor days are 44 days. Stock days rose to 61 days." });
assert(
  !fromHome.includes('data-finding="debt"') && !fromHome.includes('data-finding="stock"'),
  "a Home line hides the findings it quotes",
);
assert(fromHome.includes('data-finding="gm"'), "the rest stay");

const team = renderToStaticMarkup(
  createElement(MilonTeamDesk, { feed: api({ briefing }), now: NOW, live }),
);
assert(
  team.includes('data-finding="gm-old"') && team.includes('data-ratio="ratio:grossMargin"'),
  "the team desk is unchanged",
);

console.log("finding-dedupe ok");
