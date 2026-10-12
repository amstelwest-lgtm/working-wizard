/**
 * Rail groups stay where the accountant put them.
 * Run: pnpm test:accountant-nav-open
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLIENT_NAV_OPEN_KEY,
  PRACTICE_NAV_OPEN_KEY,
  closeNavGroup,
  navOpenEqual,
  openNavGroup,
  parseNavOpen,
  toggleNavOpen,
  type NavOpenState,
} from "../src/lib/accountant-nav-open";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const health: NavOpenState = { health: true };
const withCash = openNavGroup(health, "cash");
assert(withCash.health === true && withCash.cash === true, "opening cash keeps health open");
assert(openNavGroup(withCash, "cash") === withCash, "an open group is left untouched");

const withProfit = openNavGroup(withCash, "profit");
const closedCash = closeNavGroup(withProfit, "cash");
assert(
  closedCash.health === true && closedCash.profit === true,
  "closing cash leaves the other groups",
);
assert(closedCash.cash !== true, "cash is the group that closed");
assert(closeNavGroup(closedCash, "cash") === closedCash, "closing a shut group is a no-op");

const toggled = toggleNavOpen(toggleNavOpen(closedCash, "budget"), "health");
assert(
  toggled.budget === true && toggled.profit === true && toggled.health !== true,
  "a chevron toggles one group",
);

const arrived = ["health", "cash", "profit", "plan", "books"].reduce<NavOpenState>(
  (open, id) => openNavGroup(open, id),
  {},
);
assert(
  navOpenEqual(arrived, { health: true, cash: true, profit: true, plan: true, books: true }),
  "four clicks open groups and never collapse the earlier ones",
);

assert(navOpenEqual(parseNavOpen(null), {}), "missing storage is all closed");
assert(
  navOpenEqual(parseNavOpen('{"health":true,"cash":false,"profit":true,"bad":1}'), {
    health: true,
    profit: true,
  }),
  "storage keeps only groups marked open",
);
assert(navOpenEqual(parseNavOpen("not-json"), {}), "broken storage does not throw");
assert(navOpenEqual(parseNavOpen("[]"), {}), "a stored list is ignored");

const nav = read("src/components/accountant-nav.tsx");
assert(nav.includes("openNavGroup"), "navigation opens a closed group");
assert(nav.includes("toggleNavOpen"), "the chevron toggles one group");
assert(!nav.includes("holdClosed"), "closing the current page no longer resets the rail");
assert(!nav.includes("setOpenId("), "the rail does not keep a single open heading");

const client = read("src/components/client-studio-chrome.tsx");
assert(client.includes("CLIENT_NAV_OPEN_KEY"), "the client rail persists its groups");
assert(
  client.indexOf('id: "team"') < client.indexOf('id: "numbers"') &&
    client.indexOf('id: "numbers"') < client.indexOf('id: "work"') &&
    client.indexOf('id: "work"') < client.indexOf('id: "file"'),
  "Team, Numbers, Work, and File stay in that order",
);
const headingOrder = [
  "home",
  "health",
  "cash",
  "profit",
  "budget",
  "moves",
  "plan",
  "reports",
  "books",
];
let cursor = -1;
for (const id of headingOrder) {
  const at = client.indexOf(`id: "${id}"`);
  assert(at > cursor, `${id} stays in the client rail order`);
  cursor = at;
}

const practice = read("src/components/practice-rail.tsx");
assert(practice.includes("PRACTICE_NAV_OPEN_KEY"), "the practice rail persists its groups");
assert(practice.indexOf('id: "team"') < practice.indexOf('id: "book"'), "Team stays above Book");
assert(practice.includes(CLIENT_NAV_OPEN_KEY) === false, "practice does not use the client key");
assert(
  CLIENT_NAV_OPEN_KEY !== PRACTICE_NAV_OPEN_KEY,
  "client and practice groups are stored apart",
);

console.log("accountant-nav-open tests passed");
