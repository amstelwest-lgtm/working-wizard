/**
 * Warm accountant cards paint cached text before the 4s boot abort.
 * Run: pnpm test:warm-boot-cards
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const store = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  },
});

const { ClientAgentStandby } = await import("../src/components/client-agent-standby.tsx");
const { CLIENT_HOME_NOTHING } = await import("../src/lib/client-home-phase.ts");
const { bootSelect, noteBootRequestSent, resetBootReadForTests } = await import("../src/lib/boot-read.ts");
const { clearWarmBootCardsForTests, rememberWarmBootCard, readWarmBootCard } = await import(
  "../src/lib/warm-boot-cards.ts"
);

const CASH = "Cash is $46,300.";
const CLIENT = "353f1dbf-a7ba-4092-878d-792223ba3536";

clearWarmBootCardsForTests();
assert(readWarmBootCard(CLIENT) === null, "a cold client has no cached line");
const cold = renderToStaticMarkup(createElement(ClientAgentStandby, { timedOut: false, clientId: CLIENT }));
assert(cold.includes("Checking…"), "a cold card stays on checking");
assert(!cold.includes(CLIENT_HOME_NOTHING), "a cold card does not say nothing is on file");
assert(!cold.includes("$46,300."), "a cold card does not invent the last client's cash");

rememberWarmBootCard(CLIENT, CASH);
assert(readWarmBootCard("other-client") === null, "another client does not reuse the line");

type Queued = { id: number; at: number; fn: () => void };
const queued: Queued[] = [];
let now = 0;
let nextId = 1;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const hosts = [globalThis as typeof globalThis & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }];
if (typeof window !== "undefined") hosts.push(window);

function install() {
  const set = ((fn: TimerHandler, ms?: number) => {
    const id = nextId++;
    queued.push({ id, at: now + (ms ?? 0), fn: () => (fn as () => void)() });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clear = ((id?: number) => {
    const index = queued.findIndex((row) => row.id === id);
    if (index >= 0) queued.splice(index, 1);
  }) as typeof clearTimeout;
  for (const host of hosts) {
    host.setTimeout = set;
    host.clearTimeout = clear;
  }
}

function advance(ms: number) {
  now += ms;
  const due = queued.filter((row) => row.at <= now).sort((a, b) => a.at - b.at);
  for (const row of due) {
    const index = queued.indexOf(row);
    if (index < 0) continue;
    queued.splice(index, 1);
    row.fn();
  }
}

function restore() {
  for (const host of hosts) {
    host.setTimeout = realSetTimeout;
    host.clearTimeout = realClearTimeout;
  }
  queued.length = 0;
}

install();
try {
  resetBootReadForTests();
  let signal: AbortSignal | null = null;
  let aborted = false;
  const pending = bootSelect(
    (next) => {
      signal = next;
      return new Promise((resolve) => {
        next.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve({ data: null, error: { message: "AbortError: The operation was aborted." } });
          },
          { once: true },
        );
      });
    },
    { critical: true, timeoutMs: 4_000 },
  );

  advance(2_999);
  const warm = renderToStaticMarkup(
    createElement(ClientAgentStandby, { timedOut: false, clientId: CLIENT }),
  );
  assert(
    warm.includes('data-warm-cash="1"') && warm.includes("Cash is") && warm.includes("$46,300"),
    "warm cards show the cached cash line before 3s",
  );
  assert(!warm.includes(CLIENT_HOME_NOTHING), "a warm card does not say nothing is on file");
  assert(!aborted, "the card does not wait for the abort window");
  assert(signal, "the boot read is in flight");

  noteBootRequestSent(signal);
  advance(2_999);
  const still = renderToStaticMarkup(
    createElement(ClientAgentStandby, { timedOut: false, clientId: CLIENT }),
  );
  assert(
    still.includes('data-warm-cash="1"') && still.includes("Cash is") && still.includes("$46,300"),
    "the cached line stays up after the request is sent",
  );
  assert(!aborted, "3s after send is still inside the 4s window");
  advance(1_001);
  assert(aborted, "the 4s abort starts only once the request has gone out");
  await pending;
} finally {
  restore();
  resetBootReadForTests();
  clearWarmBootCardsForTests();
}

const fetchSource = readFileSync("src/integrations/supabase/tab-auth.ts", "utf8");
const fnStart = fetchSource.indexOf("export function coordinatedAuthFetch");
const fnEnd = fetchSource.indexOf("export function withoutAuthBroadcast");
const fn = fetchSource.slice(fnStart, fnEnd);
const sendAt = fn.indexOf("const send");
assert(sendAt > 0, "the fetch wrapper has one send path");
assert(fn.indexOf("noteBootRequestSent") > sendAt, "sent is marked inside send");
assert(!fn.slice(0, sendAt).includes("noteBootRequestSent"), "sent is not marked before the request goes out");

console.log("warm-boot-cards ok");
