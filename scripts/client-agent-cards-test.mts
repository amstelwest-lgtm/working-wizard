/**
 * Accountant client Home agent cards.
 * ZA shows the tax card. US never does. A null market with no books still
 * shows the three agents, and a hung client read stops spinning at 8s.
 * Run: pnpm test:client-agent-cards
 */
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientAgentStandby } from "../src/components/client-agent-standby.tsx";
import { OwnerHome } from "../src/components/owner-door/owner-home.tsx";
import { TaxSpecialistSlot } from "../src/components/tax-specialist/tax-specialist-slot.tsx";
import {
  AGENT_CARD_CHECKING,
  AGENT_CARD_LOAD_ERROR,
  agentCardLines,
  agentCardPhase,
} from "../src/lib/agent-card-phase.ts";
import {
  CLIENT_HOME_CHECKING,
  CLIENT_HOME_NOTHING,
  clientAgentCardsVisible,
  clientHomePhase,
} from "../src/lib/client-home-phase.ts";
import { avatarPoster, fmClipSources, type AvatarFace } from "../src/lib/fm-avatar-state.ts";
import { marketForClient } from "../src/lib/market/scope.ts";
import { parseMarketSelection } from "../src/lib/market/parse.ts";
import { SHELL_GATE_TIMEOUT_MS } from "../src/lib/shell-gate.ts";
import { emptyAgentActivity } from "../src/lib/milon-team-activity.ts";
import { ownerHomeLines, ownerAnswerTiles, type OwnerBooks } from "../src/lib/owner-answers.ts";
import { ownerPresence } from "../src/lib/owner-presence.ts";
import { figuresPeriodLabelFrom, statementSpanLabel } from "../src/lib/statement-period.ts";
import { taxSampleCardVisible } from "../src/lib/tax-specialist/enabled.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const ZA_LEDE = "Your agents are watching the books — ask them anything, any time.";
const US_LEDE = "Three agents watching the books — ask them anything, any time.";
const AGENTS = ["financial_manager", "analyst", "advisor"] as const;

assert(SHELL_GATE_TIMEOUT_MS === 8_000, "the client home deadline is 8 seconds");
assert(clientHomePhase({ loading: true, timedOut: false, hasClient: false }) === "loading", "a fresh read is loading");
assert(
  clientHomePhase({ loading: true, timedOut: true, hasClient: false }) === "error",
  "a hung client read is an error, not a spinner",
);
assert(clientHomePhase({ loading: false, timedOut: false, hasClient: false }) === "missing", "a finished empty read is missing");
assert(clientHomePhase({ loading: true, timedOut: true, hasClient: true }) === "ready", "a late row still opens the file");
assert(clientAgentCardsVisible("loading") && clientAgentCardsVisible("error"), "cards stay up while the row is late");
assert(!clientAgentCardsVisible("missing"), "a missing client does not invent a team");
assert(agentCardPhase({ pending: true, timedOut: false }) === "loading", "an open read is loading");
assert(agentCardPhase({ pending: true, timedOut: true }) === "error", "the 8s deadline is an error");
assert(agentCardPhase({ pending: false, timedOut: false, empty: true }) === "empty", "empty waits until the read settles");
assert(agentCardPhase({ pending: false, timedOut: true }) === "ready", "a finished read is not an error");
assert(
  agentCardLines("loading", [CLIENT_HOME_NOTHING]).join() === AGENT_CARD_CHECKING,
  "loading replaces the empty copy",
);
assert(
  agentCardLines("error", [CLIENT_HOME_NOTHING])[0] === AGENT_CARD_LOAD_ERROR,
  "a timed-out read does not become the empty copy",
);
assert(
  agentCardLines("empty", [CLIENT_HOME_NOTHING])[0] === CLIENT_HOME_NOTHING,
  "empty copy stays after a settled read",
);
assert(agentCardLines("ready", ["Gross profit is $7,858."])[0] === "Gross profit is $7,858.", "ready keeps the figure");

const zaMarket = { country: "ZA", regionCode: null };
const usMarket = { country: "US", regionCode: "NY" };
assert(parseMarketSelection(zaMarket)?.country === "ZA", "stored ZA");
assert(parseMarketSelection(usMarket)?.country === "US", "stored US");
assert(parseMarketSelection(null)?.country == null, "a null market has no stored country");
assert(taxSampleCardVisible("ZA", false) === true, "a ZA client shows the tax card");
assert(taxSampleCardVisible("US", false) === false, "a US client hides the tax card");
assert(taxSampleCardVisible(null, false) === false, "a null market hides the tax card");
assert(taxSampleCardVisible(marketForClient({ market: null }).country, false) === true, "the ZA date fallback must not be passed to the tax card");

function home(
  country: string | null,
  lines: { financial_manager: string[]; analyst: string[]; advisor: string[] },
  cardPhase?: "loading" | "empty" | "ready" | "error",
) {
  return renderToStaticMarkup(
    createElement(OwnerHome, {
      variant: "character",
      audience: "accountant",
      showInvite: false,
      title: "Your whole finance team",
      marketCountry: country,
      sampleClient: false,
      cardPhase,
      presence: ownerPresence(emptyAgentActivity()),
      lines,
      onOpen: () => undefined,
      onAsk: () => undefined,
    }),
  );
}

const emptyLines = {
  financial_manager: [CLIENT_HOME_NOTHING],
  analyst: [CLIENT_HOME_NOTHING],
  advisor: [CLIENT_HOME_NOTHING],
};

const zaHtml = home("ZA", emptyLines);
const usHtml = home("US", emptyLines);
const nullHtml = home(null, emptyLines);

for (const [label, html] of [
  ["ZA", zaHtml],
  ["US", usHtml],
  ["null", nullHtml],
] as const) {
  for (const agent of AGENTS) {
    assert(html.includes(`data-agent-card="${agent}"`), `${label} shows the ${agent} card`);
    assert(html.includes(`data-fm-clip="idle"`), `${label} ${agent} has an idle clip`);
  }
  assert(html.includes(CLIENT_HOME_NOTHING), `${label} says nothing is on file once the read has settled`);
  assert(html.includes('data-agent-card-phase="ready"'), `${label} settled cards are ready`);
}
assert((usHtml.match(/data-agent-card=/g) ?? []).length === 3, "a US client shows three agent cards");
assert((nullHtml.match(/data-agent-card=/g) ?? []).length === 3, "a null market shows three agent cards");
assert((zaHtml.match(/data-agent-card=/g) ?? []).length === 4, "a ZA client mounts the tax card with the other three");
assert(zaHtml.includes('data-agent-card="tax_specialist"'), "the tax card is in the agent-card list");
assert(zaHtml.includes('data-tax-card="loading"'), "the tax card is in the list before its sample chunk");
assert(zaHtml.includes("/avatars/tax/tax-poster.webp"), "the tax face is on that same card");
assert(zaHtml.includes(AGENT_CARD_CHECKING), "an unresolved tax card says it is checking");
assert(!zaHtml.includes("ITR14") && !zaHtml.includes("IRP6"), "the worksheet stays in the sample chunk");
const taxCardAt = zaHtml.indexOf('data-agent-card="tax_specialist"');
const taxPosterAt = zaHtml.indexOf("/avatars/tax/tax-poster.webp");
assert(taxCardAt >= 0 && taxPosterAt > taxCardAt, "the tax face sits inside the tax card");

assert(zaHtml.includes(ZA_LEDE), "a ZA client counts the tax card in the lede");
assert(!usHtml.includes(ZA_LEDE) && usHtml.includes(US_LEDE), "a US client keeps the three-agent lede");
assert(!nullHtml.includes(ZA_LEDE) && nullHtml.includes(US_LEDE), "a null market keeps the three-agent lede");
for (const html of [usHtml, nullHtml]) {
  assert(!html.includes("See a sample"), "the tax sample stays off");
  assert(!html.includes("ITR14") && !html.includes("IRP6"), "the worksheet stays off");
}

const noBooks: OwnerBooks = {
  hasBooks: false,
  ledger: null,
  revenue: null,
  priorRevenue: null,
  cogs: null,
  priorCogs: null,
  receivables: null,
  cashflow: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: marketForClient({ market: null }),
};
const noBookLines = ownerHomeLines(ownerAnswerTiles(noBooks), null);
for (const agent of AGENTS) {
  assert(noBookLines[agent].length > 0, `${agent} has an empty-book line`);
}
const noBookHtml = home(null, {
  financial_manager: [...noBookLines.financial_manager],
  analyst: [...noBookLines.analyst],
  advisor: [...noBookLines.advisor],
});
assert(noBookHtml.includes("Connect QuickBooks or Xero."), "no books says to connect, and does not go blank");
assert(!noBookHtml.includes(ZA_LEDE), "no books and a null market do not open the tax card");
assert(!/\bR[\u00a0 ]\d/.test(noBookHtml), "no books does not invent a rand amount");

const loadingHtml = renderToStaticMarkup(createElement(ClientAgentStandby, { timedOut: false }));
const errorHtml = renderToStaticMarkup(createElement(ClientAgentStandby, { timedOut: true }));
assert(loadingHtml.includes('data-client-agents="loading"'), "a slow read shows a loading team");
assert(loadingHtml.includes(CLIENT_HOME_CHECKING), "the loading line is honest");
assert(loadingHtml.includes('data-agent-card-phase="loading"'), "every standby card is loading");
assert((loadingHtml.split(AGENT_CARD_CHECKING).length - 1) >= 3, "analyst and advisor check, they do not look empty");
assert(!loadingHtml.includes(CLIENT_HOME_NOTHING), "an unresolved read never says nothing is on file");
assert(errorHtml.includes('data-client-agents="error"'), "a timed-out read shows an error team");
assert(errorHtml.includes('data-agent-card-phase="error"'), "every standby card is an error");
assert(errorHtml.includes("Refresh to try again."), "the error line asks for a refresh");
assert(!errorHtml.includes(CLIENT_HOME_NOTHING), "a timed-out read does not look empty");
assert(!errorHtml.includes(AGENT_CARD_CHECKING), "a timed-out read stops checking");
const forced = home(null, emptyLines, "loading");
assert(forced.includes(AGENT_CARD_CHECKING) && !forced.includes(CLIENT_HOME_NOTHING), "a loading phase wins over empty lines");
const forcedError = home("US", emptyLines, "error");
assert(forcedError.includes("Refresh to try again.") && !forcedError.includes(CLIENT_HOME_NOTHING), "an error phase wins over empty lines");
for (const html of [loadingHtml, errorHtml]) {
  assert((html.match(/data-agent-card=/g) ?? []).length === 3, "standby keeps the three cards");
  assert(html.includes('data-fm-clip="idle"'), "standby faces stay on the idle clip");
  assert(!html.includes(ZA_LEDE), "standby does not guess a ZA market");
  assert(html.includes("/avatars/fm/fm-poster.webp"), "the financial manager poster is on the card");
  assert(html.includes("/avatars/analyst/analyst-poster.webp"), "the analyst poster is on the card");
  assert(html.includes("/avatars/advisor/advisor-poster.webp"), "the advisor poster is on the card");
}
for (const variant of ["card", "desk", "stage"] as const) {
  const shell = renderToStaticMarkup(
    createElement(TaxSpecialistSlot, {
      country: "ZA",
      variant,
      audience: "accountant",
      sampleClient: false,
    }),
  );
  assert(shell.includes('data-agent-card="tax_specialist"'), `${variant} mounts the tax card before the sample chunk`);
  assert((shell.match(/data-agent-card=/g) ?? []).length === 1, `${variant} has one tax card`);
  assert(shell.includes("/avatars/tax/tax-poster.webp"), `${variant} paints the tax face with the card`);
}
assert(
  renderToStaticMarkup(
    createElement(TaxSpecialistSlot, { country: "US", variant: "card", audience: "owner" }),
  ) === "",
  "a US market does not mount the tax card",
);

for (const agent of AGENTS) {
  const clips = fmClipSources("idle", agent);
  const poster = avatarPoster(agent as AvatarFace);
  for (const href of [clips.webm, clips.mp4, poster.webp, poster.jpg]) {
    const file = `public${href.split("?")[0]}`;
    assert(existsSync(file), `missing avatar file ${file}`);
  }
}

const presentation = marketForClient({ market: null });
assert(figuresPeriodLabelFrom(null, null, presentation) === null, "no books has no period label");
assert(figuresPeriodLabelFrom({}, null, presentation) === null, "empty figures have no period label");
assert(
  figuresPeriodLabelFrom(null, 202609 as unknown as string, presentation) === null,
  "a non-string snapshot label does not throw",
);
assert(
  statementSpanLabel({
    periodStart: null,
    periodEnd: null,
    periodLabel: 202609 as unknown as string,
    market: presentation,
  }) === null,
  "a non-string stored span does not throw",
);
assert(
  statementSpanLabel({ periodLabel: "Sep 2026", market: undefined as unknown as { locale: string } }) === "Sep 2026",
  "a missing market does not throw while formatting a month stamp",
);
assert(
  figuresPeriodLabelFrom({ periodLabel: "2026-09-01/2026-09-21" }, null, marketForClient({ market: usMarket })) ===
    "Sep 1–21, 2026",
  "a stored US span still formats",
);
assert(
  figuresPeriodLabelFrom({ periodLabel: "2026-09-01/2026-09-21" }, null, presentation) === "1–21 Sep 2026",
  "a stored ZA span still formats",
);

const page = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(page.includes("clientHomePhase("), "the client page uses the home phase");
assert(page.includes("SHELL_GATE_TIMEOUT_MS"), "the client row read has the 8s deadline");
assert(page.includes("setLoadTimedOut(true)"), "a hung row leaves the skeleton");
assert(page.includes("<ClientAgentStandby"), "the team renders before the row arrives");
assert(page.includes('cardPhase="ready"'), "a settled client file uses the shared card phase");
assert(
  readFileSync("src/components/owner-door/owner-door.tsx", "utf8").includes('cardPhase="ready"'),
  "the owner door uses the same card phase",
);
assert(
  readFileSync("src/components/practice-board.tsx", "utf8").includes('cardPhase="ready"'),
  "practice home uses the same card phase",
);
assert(!page.includes("marketCountry={clientMarket.country}"), "the tax card does not use the ZA date fallback");
assert(
  (page.match(/parseMarketSelection\(client\.market\)\?\.country \?\? null/g) ?? []).length >= 2,
  "home and the desk use the stored client country",
);

const activity = readFileSync("src/hooks/use-agent-activity.ts", "utf8");
assert(activity.includes("SHELL_GATE_TIMEOUT_MS"), "agent activity does not wait forever");
assert(
  activity.includes("Couldn't load the team. Refresh to try again."),
  "a hung agent read has an error line",
);

console.log("client-agent-cards: ok");
