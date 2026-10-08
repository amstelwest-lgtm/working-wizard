/**
 * Team desk view-model: names live in one file, header status is derived,
 * and job states render from the feed. Run: pnpm test:milon-team
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MilonTeamDesk } from "../src/components/milon-team/milon-team-desk";
import type { MilonTeamFeedApi } from "../src/hooks/use-milon-team-feed";
import type { AgentKey, MilonTeamFeed, TeamAgentStatus, TeamJob } from "../src/lib/milon-team-feed";
import { AGENT_KEYS, emptyMilonTeamFeed } from "../src/lib/milon-team-feed";
import { PRECARD_CAP_MESSAGE } from "../src/lib/precard-cap";
import { agentAriaLabel, agentDisplayName, agentInitial, agentShortName, formatAsOf, teamAgentHeaderStatus } from "../src/lib/milon-team";

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
assert(!existsSync("src/components/milon-team/types.ts"), "the local type mirror is gone");
assert(AGENT_KEYS.join(",") === "bookkeeper,analyst,advisor", "keys come from the feed");
assert(emptyMilonTeamFeed().agents.bookkeeper.lastRunAt === null, "an empty feed has no invented last run");
assert(agentShortName("bookkeeper") === "Bookkeeper", "short name is Bookkeeper");
assert(agentInitial("bookkeeper") === "B", "avatar letter is B");
assert(agentAriaLabel("bookkeeper", "Books clean ✓") === `${NAMES[0]}. Books clean ✓`, "aria label uses the display name");

const botSurfaces = [
  "src/lib/milon-team.ts",
  "src/components/milon-team/milon-team-desk.tsx",
  "src/components/milon-team/milon-team-pane.tsx",
  "src/lib/milon-team-feed.ts",
  "src/components/milon-team/milon-team-desk.css",
  "scripts/rail-studio-harness/milon-team-stub.tsx",
  "scripts/rail-studio-harness/milon-team-desk-page.tsx",
  "scripts/rail-studio-harness/capture-team-desk.mts",
];
for (const file of botSurfaces) {
  assert(!readFileSync(file, "utf8").includes(BOT_ROLE), `${file} still says ${BOT_ROLE}`);
}

assert(existsSync("src/lib/milon-team-feed.ts"), "the feed module is on this branch");
assert(existsSync("src/hooks/use-milon-team-feed.ts"), "the feed hook is on this branch");

const pane = readFileSync("src/components/milon-team/milon-team-pane.tsx", "utf8");
assert(pane.includes("useMilonTeamFeed(clientId)"), "the desk reads the real feed");
assert(!pane.includes("return null"), "production no longer stubs an empty feed");
assert(/from\s+["']@\/hooks\/use-milon-team-feed["']/.test(pane), "pane imports Eng1's hook");

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
assert(
  /<MilonTeamPane[\s\S]*id="ask-ai-accountant"/.test(client),
  "the desk renders above the chat mount",
);
assert(!client.includes("data-team-desk"), "the chat node is not marked as the desk");
assert(!client.includes("dataset.teamDesk"), "the client effect still mounts the chat");
assert(client.includes('resolveAccountantTab(search) ?? "overview"'), "default tab stays Overview");
for (const file of ["src/lib/ask-ai.js", "public/ask-ai.css", "src/hooks/use-ask-ai-mount.ts", "src/lib/milon-bot-client.ts", "src/lib/milon-bot-copy.ts"]) {
  assert(!readFileSync(file, "utf8").includes("teamDeskOwnsMount"), `${file} does not own the desk mount`);
  assert(!readFileSync(file, "utf8").includes("data-team-desk"), `${file} does not special-case the desk`);
}
assert(formatAsOf("2026-10-08", NOW) === "8 Oct", "a date in the current year is day and short month");
assert(formatAsOf("2025-03-01", NOW) === "1 Mar 2025", "a date in another year keeps the year");
assert(formatAsOf(null, NOW) === null, "a missing as-of date stays hidden");

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
      { id: "floor", agent: "advisor", title: "Cash floor is close", severity: "act", source: { label: "Cash", asOf: "2026-10-08" } },
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
assert(populated.includes("as of 8 Oct"), "as-of dates use the short form");
assert(!populated.includes("as of 2026-10-08"), "as-of dates do not keep the ISO form");
assert(populated.includes("milon-desk-agent-short"), "narrow screens can show the short team name");
assert(!populated.includes("milon-desk-task"), "the desk has no composer of its own");
assert(!populated.includes("Held as a task"), "the desk does not hold a local task");
assert(
  populated.includes('</div></div><div class="milon-desk-actions"><button type="button" class="milon-desk-btn approve"'),
  "Approve sits on its own row",
);
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
assert(!empty.includes("Last run"), "a null last run does not invent a time");

const loading = html(api({ loading: true }));
assert(loading.includes('aria-busy="true"'), "loading marks the desk busy");
assert(loading.includes("milon-desk-skel"), "an empty load shows skeletons");
assert(!loading.includes(">Today<"), "an empty load hides the sections");
const refreshing = html(
  api({
    loading: true,
    briefing: [{ id: "x", agent: "advisor", title: "Still on the desk", severity: "info", source: { label: "Cash", asOf: null } }],
  }),
);
assert(refreshing.includes("Still on the desk"), "a refresh keeps the briefing that is already there");

const capped = html(
  api({
    precard: { capped: true, remaining: 0, limit: "bot" },
    jobs: [job({ id: "board", status: "proposed", canApprove: true, title: "Draft the board note" })],
  }),
);
assert(!capped.includes('data-approve="board"'), "a capped desk does not offer Approve");
assert(capped.includes(PRECARD_CAP_MESSAGE), "the cap card covers a job when the desk is capped");

const broken = html(api({ error: "The desk could not load." }));
assert(broken.includes("The desk could not load."), "an error shows the feed message");
assert(broken.includes(">Retry<"), "an error can refresh");
assert(!broken.includes(">Today<"), "an error hides the sections");

console.log("milon-team-test: all assertions passed");
