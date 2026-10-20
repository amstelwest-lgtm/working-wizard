/**
 * A draft stored with 16.0% and health 69 renders the live 8.6% and 67,
 * or an out-of-date marker. The old numbers are never shown as current.
 * Run: pnpm test:draft-live-figures
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { polishAgentCopy } from "../src/lib/agent-bus.ts";
import { prepareDraftRecord } from "../src/lib/agent-draft.ts";
import {
  DRAFT_OUT_OF_DATE,
  draftFiguresHash,
} from "../src/lib/draft-figures.ts";
import { buildFinancialManagerBrief } from "../src/lib/financial-manager-brief.ts";
import type { AgentFindingRow } from "../src/lib/milon-team-activity.ts";
import { ownerDraftPresentations, presentHomeDraftBody, presentHomeDraftTitle } from "../src/lib/owner-needs.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const STORED =
  "the upload shows operating margin of 16.0%, while the health read shows net margin of 8.6%. stored health 69 vs live 67";
const liveRatios = { "Operating Margin": 0.086, "Net Margin": 0.086 };
const staleHash = draftFiguresHash({
  ratios: { "Operating Margin": 0.16, "Net Margin": 0.086 },
  overall: 69,
});
const liveHash = draftFiguresHash({ ratios: liveRatios, overall: 67 });
assert(staleHash !== liveHash, "16.0%/69 and 8.6%/67 do not share a figures hash");

function assertLive(text: string, refresh: boolean, where: string) {
  assert(text.includes("8.6%"), `${where} quotes the live margin (${text})`);
  assert(text.includes("67"), `${where} quotes the live score (${text})`);
  assert(!text.includes("16.0"), `${where} still shows 16.0 (${text})`);
  assert(!text.includes("69"), `${where} still shows 69 (${text})`);
  assert(!/\bstored\s+health\b/i.test(text), `${where} still says stored health (${text})`);
  assert(!/\bvs\s+live\b/i.test(text), `${where} still compares stored and live (${text})`);
  assert(refresh, `${where} does not mark the draft out of date`);
}

const title = presentHomeDraftTitle(STORED, liveRatios, { overall: 67, storedHash: staleHash });
assertLive(title.text, title.refresh, "title");
const body = presentHomeDraftBody(STORED, liveRatios, { overall: 67, storedHash: staleHash });
assertLive(body.text, body.refresh, "body");

const blocked = presentHomeDraftTitle(STORED);
assert(blocked.text === DRAFT_OUT_OF_DATE, blocked.text);
assert(blocked.refresh, "a draft with no live figures is out of date");
assert(!blocked.text.includes("16.0") && !blocked.text.includes("69"), blocked.text);

const finding: AgentFindingRow = {
  id: "d1",
  agent: "advisor",
  client_id: "3cc31b6a",
  kind: "data_request_draft",
  title: STORED,
  detail: STORED,
  evidence: {
    draft: true,
    requires_human_approval: true,
    figures: {},
    figures_hash: staleHash,
    snapshot_id: null,
    period_label: null,
  },
  as_of: null,
  created_at: "2026-10-19T00:00:00.000Z",
  status: "pending",
};
const owner = ownerDraftPresentations([finding], liveRatios, { overall: 67 });
assert(owner.length === 1, "the owner home still lists the draft");
assertLive(owner[0]!.text, owner[0]!.refresh, "owner");

const brief = buildFinancialManagerBrief({
  clientName: "QA US Test LLC",
  currentFinancials: { revenue: 120000, cash: 40000, netIncome: 8000 },
  currentPeriodEnd: "2026-09-30",
  snapshots: [],
  drafts: [{ id: "d1", title: STORED, detail: STORED, figuresHash: staleHash }],
  canonicalRatios: liveRatios,
  healthOverall: 67,
  draftsReady: true,
  formatMoney: (amount) => `$${amount}`,
});
assert(brief.drafts.length === 1, "Drafts ready to review still lists the draft");
assertLive(brief.drafts[0]!.title, Boolean(brief.drafts[0]!.refresh), "accountant");

const polished = polishAgentCopy({
  text: STORED,
  role: "detail",
  figures: { live_overall: 67, "Operating Margin": 0.086, "Net Margin": 0.086 },
  canonicalRatios: liveRatios,
});
assert(polished.ok === true, "polish accepts the draft");
if (polished.ok) assertLive(polished.text, true, "agent");

const recorded = prepareDraftRecord({
  kind: "advisory_deliverable_draft",
  allowedKinds: ["advisory_deliverable_draft"],
  severity: "watch",
  title: "Operating margin is 8.6%.",
  detail: "Health is 67. Net margin is 8.6%.",
  claimedFigures: { "Operating Margin": 0.086, "Net Margin": 0.086, live_overall: 67 },
  pool: [
    {
      snapshotId: null,
      periodLabel: "latest",
      figures: { "Operating Margin": 0.086, "Net Margin": 0.086, live_overall: 67 },
    },
  ],
  recordedKeys: new Set(),
});
assert(recorded.ok === true, recorded.ok ? "recorded" : recorded.error);
if (recorded.ok) {
  assert(recorded.evidence.figures_hash === liveHash, recorded.evidence.figures_hash ?? "missing hash");
  assert(!recorded.title.includes("69") && !recorded.detail.includes("69"), "a new draft does not store 69");
  assert(!/stored\s+health/i.test(`${recorded.title} ${recorded.detail}`), "a new draft does not say stored health");
}

const ownerHome = readFileSync(resolve("src/components/owner-door/owner-home.tsx"), "utf8");
const accountantBrief = readFileSync(resolve("src/components/financial-manager-brief.tsx"), "utf8");
assert(ownerHome.includes("DRAFT_OUT_OF_DATE"), "the owner home shows the out-of-date state");
assert(accountantBrief.includes("DRAFT_OUT_OF_DATE"), "Drafts ready to review shows the out-of-date state");

console.log("draft-live-figures ok");
