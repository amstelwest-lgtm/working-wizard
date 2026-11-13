/**
 * One [card-timing] line per reload. warmMs only when the cache painted.
 * Run: pnpm test:card-timing
 */
import { readFileSync } from "node:fs";
import {
  isRealCardLine,
  markClientCardText,
  markClientReload,
  markWarmCardLine,
  resetCardTimingForTests,
} from "../src/lib/card-timing.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

type Mark = { name: string; startTime: number };
const marks: Mark[] = [];
let clock = 0;
const fake = {
  mark(name: string) {
    marks.push({ name, startTime: clock });
  },
  getEntriesByName(name: string) {
    return marks.filter((mark) => mark.name === name);
  },
  clearMarks(name?: string) {
    for (let i = marks.length - 1; i >= 0; i -= 1) {
      if (!name || marks[i].name === name) marks.splice(i, 1);
    }
  },
};

const originalPerformance = globalThis.performance;
Object.defineProperty(globalThis, "performance", {
  configurable: true,
  value: fake,
});

type CardLine = { ms: number; warmMs?: number };
const infos: string[] = [];
const originalInfo = console.info;
console.info = (...args: unknown[]) => {
  const line = args
    .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
    .join(" ");
  if (line.includes("[card-timing]")) infos.push(line);
  originalInfo(...args);
};

function payload(): CardLine {
  const line = infos[0] ?? "";
  return JSON.parse(line.slice(line.indexOf("{"))) as CardLine;
}

function reset() {
  resetCardTimingForTests();
  marks.length = 0;
  infos.length = 0;
  clock = 0;
}

assert(isRealCardLine("Cash is $46,300."), "a cash sentence is real");
assert(!isRealCardLine("Checking…"), "checking is not the settled line");
assert(!isRealCardLine("Couldn't load this client. Refresh to try again."), "an error is not the settled line");
assert(!isRealCardLine("  "), "a blank line is not real");

reset();
clock = 40;
markClientReload();
markClientReload();
clock = 80;
markWarmCardLine();
clock = 900;
markClientCardText("Checking…");
assert(infos.length === 0, "checking does not log");
markClientCardText("Cash is $46,300.");
markClientCardText("Cash is $46,300.");
assert(infos.length === 1, `one log on a cache hit, saw ${infos.length}`);
assert(infos[0].startsWith("[card-timing]"), infos[0]);
const hit = payload();
assert(hit.ms === 900, `ms ${hit.ms}`);
assert(hit.warmMs === 80, `warmMs ${hit.warmMs}`);
assert(!infos[0].includes("@"), "the line has no email");
assert(marks.filter((mark) => mark.name === "client-reload").length === 1, "reload is marked once");

reset();
clock = 1200;
markClientReload();
markClientCardText("Cash is $46,300.");
markClientCardText("Profit is up.");
assert(infos.length === 1, `one log without a cache hit, saw ${infos.length}`);
const miss = payload();
assert(miss.ms === 1200, `ms ${miss.ms}`);
assert(!("warmMs" in miss), "warmMs is omitted when the cache did not paint");

const client = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const standby = readFileSync("src/components/client-agent-standby.tsx", "utf8");
const owner = readFileSync("src/routes/app.tsx", "utf8");
assert(client.includes("markClientReload()"), "the client view marks reload");
assert(client.includes("markClientCardText("), "the settled home marks card text");
assert(standby.includes("markWarmCardLine()"), "a cached standby line marks warmMs");
assert(!owner.includes("markClientCardText"), "the owner home does not share this mark");

Object.defineProperty(globalThis, "performance", {
  configurable: true,
  value: originalPerformance,
});
console.info = originalInfo;

console.log("card-timing ok");
