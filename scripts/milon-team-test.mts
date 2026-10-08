/**
 * Team desk view-model: names live in one file, header status is derived,
 * and job states render from the feed. Run: pnpm test:milon-team
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MilonTeamDesk } from "../src/components/milon-team/milon-team-desk";
import type { AgentKey, MilonTeamFeed, MilonTeamFeedApi, TeamAgentStatus, TeamJob } from "../src/components/milon-team/types";
import { PRECARD_CAP_MESSAGE } from "../src/lib/precard-cap";
import { agentAriaLabel, agentDisplayName, agentInitial, agentShortName, teamAgentHeaderStatus } from "../src/lib/milon-team";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const NOW = new Date("2026-10-08T12:00:00.000Z");
const NAMES = (["Bookkeeper", "Analyst", "Advisor"] as const).map((role) => `Mil${"ō"}n ${role}`);
const BOT_ROLE = ["Acc", "ountant"].join("");

function walk(dir: string, visit: (file: string, text: string) => void) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "coverage") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, visit);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|mts|css|md)$/.test(entry)) continue;
    visit(relative(".", path), readFileSync(path, "utf8"));
  }
}

const hits: string[] = [];
walk(".", (file, text) => {
  if (file === "src/lib/milon-team.ts") return;
  for (const name of NAMES) {
    if (text.includes(name)) hits.push(`${file} contains ${name}`);
  }
});
assert(hits.length === 0, hits.join("\n"));
const config = readFileSync("src/lib/milon-team.ts", "utf8");
for (const name of NAMES) assert(config.includes(name), `config is missing ${name}`);
assert(!config.includes(BOT_ROLE), "the config does not name the old bookkeeping role");
assert(!config.includes("accountant"), "the agent key is bookkeeper");
assert(
  readFileSync("src/components/milon-team/types.ts", "utf8").includes('"bookkeeper" | "analyst" | "advisor"'),
  "the feed mirror uses the bookkeeper key",
);
assert(agentShortName("bookkeeper") === "Bookkeeper", "short name is Bookkeeper");
assert(agentInitial("bookkeeper") === "B", "avatar letter is B");
assert(agentAriaLabel("bookkeeper", "Books clean ✓") === `${NAMES[0]}. Books clean ✓`, "aria label uses the display name");

const botSurfaces = [
  "src/lib/milon-team.ts",
  "src/components/milon-team/milon-team-desk.tsx",
  "src/components/milon-team/milon-team-pane.tsx",
  "src/components/milon-team/types.ts",
  "src/components/milon-team/milon-team-desk.css",
  "scripts/rail-studio-harness/milon-team-stub.tsx",
  "scripts/rail-studio-harness/milon-team-desk-page.tsx",
  "scripts/rail-studio-harness/capture-team-desk.mts",
];
for (const file of botSurfaces) {
  assert(!readFileSync(file, "utf8").includes(BOT_ROLE), `${file} still says ${BOT_ROLE}`);
}

assert(!existsSync("src/lib/milon-team-feed.ts"), "Eng1's feed module is not ours to create");
assert(!existsSync("src/hooks/use-milon-team-feed.ts"), "Eng1's hook is not ours to create");

const pane = readFileSync("src/components/milon-team/milon-team-pane.tsx", "utf8");
const seam = pane.slice(pane.indexOf("export function useProductionTeamFeed"), pane.indexOf("export function MilonTeamPane"));
assert(seam.includes("return null"), "production feed stays empty until Eng1's hook lands");
assert(!seam.includes("useMilonTeamFeed"), "the seam does not call a missing hook");
assert(!/from\s+["']@\/hooks\/use-milon-team-feed["']/.test(pane), "pane does not import Eng1's hook yet");

let prodImportsStub = false;
walk("src", (file, text) => {
  if (text.includes("milon-team-stub") || text.includes("useMilonTeamFeedStub")) prodImportsStub = true;
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    assert(!text.includes("Dana"), `${file} must not name Dana`);
  }
});
assert(!prodImportsStub, "production must not import the harness stub");

const client = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(client.includes('id="ask-ai-accountant"'), "the current Bot mount stays in the ask pane");
assert(client.includes("<MilonTeamPane"), "the ask pane has one desk seam");
assert(client.includes('resolveAccountantTab(search) ?? "overview"'), "default tab stays Overview");

const idle: Record<AgentKey, TeamAgentStatus> = {
  bookkeeper: { agent: "bookkeeper", lastRunAt: null, lastRunKind: null },
  analyst: { agent: "analyst", lastRunAt: null, lastRunKind: null },
  advisor: { agent: "advisor", lastRunAt: null, lastRunKind: null },
};

assert(
  teamAgentHeaderStatus("advisor", idle.advisor, [], NOW).label === "Not run yet",
  "an agent with no run and no briefing is idle",
);
assert(
  teamAgentHeaderStatus(
    "advisor",
    { agent: "advisor", lastRunAt: "2026-10-08T09:00:00.000Z", lastRunKind: "diagnosis" },
    [{ id: "a", agent: "advisor", title: "Floor", severity: "act", source: { label: "Cash", asOf: null } }],
    NOW,
  ).label === "Cash watch: 1 alert",
  "one Advisor act item is the cash-watch line",
);
assert(
  teamAgentHeaderStatus(
    "advisor",
    { agent: "advisor", lastRunAt: "2026-10-08T09:00:00.000Z", lastRunKind: "diagnosis" },
    [
      { id: "a", agent: "advisor", title: "Floor", severity: "act", source: { label: "Cash", asOf: null } },
      { id: "b", agent: "advisor", title: "Tax", severity: "act", source: { label: "Tax", asOf: null } },
    ],
    NOW,
  ).label === "Cash watch: 2 alerts",
  "Advisor act items pluralise",
);
assert(
  teamAgentHeaderStatus(
    "bookkeeper",
    { agent: "bookkeeper", lastRunAt: "2026-10-08T10:00:00.000Z", lastRunKind: "sync" },
    [{ id: "c", agent: "bookkeeper", title: "Close", severity: "info", source: { label: "Books", asOf: null } }],
    NOW,
  ).label === "Books clean ✓",
  "a synced close with no watch is clean books",
);
assert(
  teamAgentHeaderStatus(
    "bookkeeper",
    { agent: "bookkeeper", lastRunAt: "2026-10-08T10:00:00.000Z", lastRunKind: "query" },
    [],
    NOW,
  ).label === "Question logged",
  "a question is not reported as clean books",
);
assert(
  teamAgentHeaderStatus(
    "analyst",
    { agent: "analyst", lastRunAt: "2026-10-07T12:00:00.000Z", lastRunKind: "diagnosis" },
    [],
    NOW,
  ).label === "Forecast updated",
  "an analyst run with a clear briefing is a forecast update",
);
assert(
  teamAgentHeaderStatus(
    "analyst",
    { agent: "analyst", lastRunAt: "2026-10-07T12:00:00.000Z", lastRunKind: "diagnosis" },
    [{ id: "w", agent: "analyst", title: "Variance", severity: "watch", source: { label: "Budget", asOf: null } }],
    NOW,
  ).label === "1 to watch",
  "a watch item outranks the calm forecast line",
);

function api(partial: Partial<MilonTeamFeed>): MilonTeamFeedApi {
  return {
    briefing: [],
    jobs: [],
    activity: [],
    agents: idle,
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

function job(partial: Partial<TeamJob> & Pick<TeamJob, "id" | "status">): TeamJob {
  return {
    agent: "analyst",
    title: partial.id,
    summary: "",
    deliverableType: null,
    createdAt: "2026-10-08T11:00:00.000Z",
    canApprove: false,
    blockedReason: null,
    ...partial,
  };
}

function html(feed: MilonTeamFeedApi, initialFilter?: "all" | AgentKey) {
  return renderToStaticMarkup(createElement(MilonTeamDesk, { feed, now: NOW, initialFilter }));
}

const populated = html(
  api({
    agents: {
      bookkeeper: { agent: "bookkeeper", lastRunAt: "2026-10-08T10:00:00.000Z", lastRunKind: "sync" },
      analyst: { agent: "analyst", lastRunAt: "2026-10-07T12:00:00.000Z", lastRunKind: "diagnosis" },
      advisor: { agent: "advisor", lastRunAt: "2026-10-08T09:00:00.000Z", lastRunKind: "diagnosis" },
    },
    briefing: [
      { id: "floor", agent: "advisor", title: "Cash floor is close", severity: "act", source: { label: "Cash", asOf: null } },
    ],
    signoffLine: "September close is ready for your sign-off.",
    jobs: [
      job({ id: "board", status: "proposed", canApprove: true, title: "Draft the board note" }),
      job({
        id: "collections",
        agent: "advisor",
        status: "proposed",
        canApprove: false,
        blockedReason: "precard_cap",
        title: "Note the debtors past terms",
      }),
      job({ id: "quiet", agent: "bookkeeper", status: "proposed", canApprove: false, blockedReason: "no_data", title: "Waiting on a statement" }),
      job({ id: "spin", status: "drafting", title: "Writing the note" }),
      job({ id: "ready", status: "draft_ready", href: "#draft-ready", title: "Board note" }),
      job({ id: "wait", status: "awaiting_signoff", title: "Close pack" }),
      job({ id: "bad", status: "failed", title: "Broken draft" }),
      job({ id: "gone", status: "dismissed", title: "Dismissed note" }),
    ],
    activity: [{ id: "flagged", agent: "advisor", kind: "diagnosis", text: "Flagged the cash floor.", at: "2026-10-08T09:00:00.000Z" }],
  }),
);

assert(populated.includes(agentDisplayName("advisor")), "the desk prints the Advisor name from the config");
assert(populated.includes(agentDisplayName("bookkeeper")), "the team row prints the Bookkeeper name");
assert(populated.includes(agentShortName("bookkeeper")), "tags use the Bookkeeper short name");
assert(populated.includes('data-agent-initial="B"'), "the Bookkeeper avatar letter is B");
assert(!populated.includes(BOT_ROLE), "rendered desk copy does not say the old role");
assert(populated.includes("Cash watch: 1 alert"), "the header uses the derived cash-watch line");
assert(populated.includes("Books clean ✓"), "the header uses the derived books line");
assert(populated.includes("Forecast updated"), "the header uses the derived forecast line");
assert(populated.includes('class="milon-desk-btn approve"'), "Approve is the outline action");
assert(!populated.includes("milon-desk-btn primary"), "Approve is not a filled gold primary");
assert(populated.includes(PRECARD_CAP_MESSAGE), "a pre-card block renders the existing cap card");
assert(populated.includes("Not enough on file to draft this."), "no-data jobs stay a muted line");
assert(populated.includes('aria-label="Drafting"'), "drafting shows a spinner status");
assert(populated.includes("Draft ready. Nothing was sent."), "a ready draft says nothing was sent");
assert(populated.includes('href="#draft-ready"'), "a ready draft links Open when href is set");
assert(populated.includes(">Open<"), "the ready draft has an Open link");
assert(populated.split("September close is ready for your sign-off.").length >= 3, "sign-off line shows on the strip and the waiting job");
assert(populated.includes("This draft failed."), "a failed job shows an error");
assert(populated.includes(">Retry<"), "a failed job can be retried");
assert(!populated.includes("Dismissed note"), "a dismissed job is hidden");
const signoff = populated.slice(populated.indexOf('aria-label="Sign-off"'), populated.indexOf('aria-label="Today"'));
assert(!signoff.includes("<button"), "the sign-off strip does not add a second primary");

const advisorOnly = html(
  api({
    jobs: [job({ id: "board", status: "proposed", title: "Draft the board note" }), job({ id: "collections", agent: "advisor", status: "proposed", title: "Note the debtors past terms" })],
    briefing: [{ id: "floor", agent: "advisor", title: "Cash floor is close", severity: "act", source: { label: "Cash", asOf: null } }],
    activity: [{ id: "flagged", agent: "analyst", kind: "diagnosis", text: "13-week forecast refreshed.", at: "2026-10-07T12:00:00.000Z" }],
  }),
  "advisor",
);
assert(advisorOnly.includes("Cash floor is close"), "Advisor filter keeps Advisor briefing");
assert(!advisorOnly.includes("Draft the board note"), "Advisor filter hides other jobs");
assert(!advisorOnly.includes("13-week forecast refreshed."), "Advisor filter hides other activity");

const empty = html(api({}));
assert(!empty.includes(">Today<"), "an empty briefing hides Today");
assert(!empty.includes(">Offered<"), "an empty job list hides Offered");
assert(!empty.includes(">Activity<"), "an empty activity log hides Activity");
assert(empty.includes("Not run yet"), "an empty client still shows the team as not run");

const loading = html(api({ loading: true, briefing: [{ id: "x", agent: "advisor", title: "Hidden while loading", severity: "info", source: { label: "Cash", asOf: null } }] }));
assert(loading.includes('aria-busy="true"'), "loading marks the desk busy");
assert(loading.includes("milon-desk-skel"), "loading shows skeletons");
assert(!loading.includes("Hidden while loading"), "loading does not flash briefing copy");

const broken = html(api({ error: "The desk could not load." }));
assert(broken.includes("The desk could not load."), "an error shows the feed message");
assert(broken.includes(">Retry<"), "an error can refresh");
assert(!broken.includes(">Today<"), "an error hides the sections");

console.log("milon-team-test: all assertions passed");
