/**
 * Add client save.
 * Independent cap reads run together: 1s each finishes in about 1s, not the sum.
 * A fresh stored plan under the tightest cap does not call live Stripe.
 * Success opens the new client's Home (Step 1 upload / connect).
 * On main the gate and the Home navigation do not exist, so this file fails.
 *
 * Run: pnpm test:add-client-save
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveFirmClientCreateGate,
  runFirmClientCreate,
  type StoredCreateEntitlement,
} from "../src/lib/firm-client-create-gate";
import {
  ADD_CLIENT_BUTTON,
  addClientButtonLabel,
  firmClientAddedToast,
  firmClientCreatedNavigation,
} from "../src/lib/firm-client-created";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Entitled, trial open, pre-card cap off, trial not enforced. */
const FRESH: StoredCreateEntitlement = {
  plan: "entitled",
  trialBlocked: false,
  precardCapApplies: false,
  starterTrialEnforced: false,
};

function entitled(overrides: Partial<StoredCreateEntitlement>): StoredCreateEntitlement {
  return { ...FRESH, ...overrides };
}

async function parallelReadsSkipStripe() {
  let inFlight = 0;
  let maxInFlight = 0;
  let liveCalls = 0;
  let creates = 0;
  const track = async <T,>(work: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await work();
    } finally {
      inFlight -= 1;
    }
  };
  const started = Date.now();
  const created = await runFirmClientCreate({
    readStoredEntitlement: () =>
      track(async () => {
        await delay(1_000);
        return FRESH;
      }),
    countClients: () =>
      track(async () => {
        await delay(1_000);
        return 1;
      }),
    loadLiveAllowance: async () => {
      liveCalls += 1;
      await delay(1_000);
      return { allowed: false, message: "Upgrade to a larger band to add another." };
    },
    createClient: async () => {
      creates += 1;
      return { id: "client-1" };
    },
  });
  const elapsed = Date.now() - started;
  assert(created.id === "client-1", "create returns the new client");
  assert(creates === 1, "create runs once");
  assert(liveCalls === 0, "fresh stored plan does not call live Stripe");
  assert(maxInFlight === 2, "stored plan and client count run together");
  assert(elapsed < 1_700, `1s reads took ${elapsed}ms; a serial path would be about 2s`);
  assert(elapsed >= 900, `reads returned too fast (${elapsed}ms)`);
}

async function nearCapUsesLiveStripeAndDoesNotCreate() {
  let creates = 0;
  let liveCalls = 0;
  let thrown = "";
  try {
    await runFirmClientCreate({
      readStoredEntitlement: async () => FRESH,
      countClients: async () => 3,
      loadLiveAllowance: async () => {
        liveCalls += 1;
        return { allowed: false, message: "Upgrade to a larger band to add another." };
      },
      createClient: async () => {
        creates += 1;
        return { id: "nope" };
      },
    });
  } catch (err) {
    thrown = err instanceof Error ? err.message : "";
  }
  assert(liveCalls === 1, "at the tightest cap the live Stripe check still runs");
  assert(creates === 0, "a denied cap does not create the client");
  assert(thrown.includes("Upgrade to a larger band"), "the live cap message is kept");
}

async function unsyncedOrBlockedPlanDoesNotSkip() {
  const cases: Array<StoredCreateEntitlement | null> = [
    null,
    entitled({ plan: "none" }),
    entitled({ trialBlocked: null }),
    entitled({ trialBlocked: true }),
    entitled({ plan: null }),
    entitled({ precardCapApplies: true }),
    entitled({ starterTrialEnforced: true }),
    entitled({ precardCapApplies: null }),
    entitled({ starterTrialEnforced: null }),
  ];
  for (const stored of cases) {
    let liveCalls = 0;
    const decision = await resolveFirmClientCreateGate({
      readStoredEntitlement: async () => stored,
      countClients: async () => 0,
      loadLiveAllowance: async () => {
        liveCalls += 1;
        return { allowed: true };
      },
    });
    assert(liveCalls === 1, `expected live Stripe for ${JSON.stringify(stored)}`);
    assert(decision.allowed && decision.source === "live", "fallback is the live allowance");
  }
}

async function eng2MirrorRows() {
  const live = async (stored: StoredCreateEntitlement | null, count: number, label: string) => {
    let liveCalls = 0;
    const decision = await resolveFirmClientCreateGate({
      readStoredEntitlement: async () => stored,
      countClients: async () => count,
      loadLiveAllowance: async () => {
        liveCalls += 1;
        return { allowed: true };
      },
    });
    assert(liveCalls === 1, `${label} runs the live check`);
    assert(decision.source === "live", `${label} does not skip Stripe`);
  };
  const skip = async (stored: StoredCreateEntitlement, count: number, label: string) => {
    let liveCalls = 0;
    const decision = await resolveFirmClientCreateGate({
      readStoredEntitlement: async () => stored,
      countClients: async () => count,
      loadLiveAllowance: async () => {
        liveCalls += 1;
        return { allowed: true };
      },
    });
    assert(liveCalls === 0, `${label} skips the live check`);
    assert(decision.source === "stored" && decision.allowed, `${label} uses the stored plan`);
  };

  await live(entitled({ precardCapApplies: true }), 0, "precard_cap_applies true");
  await live(entitled({ starterTrialEnforced: true }), 0, "starter_trial_enforced true");
  await live(entitled({ precardCapApplies: null }), 0, "null precard_cap_applies");
  await live(entitled({ plan: null }), 0, "null billing_plan_known");
  await skip(FRESH, 2, "entitled non-enforced non-precard count 2");
  await live(FRESH, 3, "count 3");
}

async function failedReadsFallBackToLive() {
  let liveCalls = 0;
  const decision = await resolveFirmClientCreateGate({
    readStoredEntitlement: async () => {
      throw new Error("firm read failed");
    },
    countClients: async () => {
      throw new Error("count failed");
    },
    loadLiveAllowance: async () => {
      liveCalls += 1;
      return { allowed: true };
    },
  });
  assert(liveCalls === 1, "a failed stored read uses live Stripe");
  assert(decision.allowed === true && decision.source === "live", "live allow still creates");
}

function navigationOpensClientHome() {
  const clientId = "e8f7a440-a541-422c-8e4f-82ba33dd0604";
  const nav = firmClientCreatedNavigation(clientId);
  assert(nav.to === "/clients/$clientId", "success targets the client route");
  assert(nav.params.clientId === clientId, "the new client id is the route param");
  assert(nav.search.tab === "home", "the client opens on Home");
  assert(nav.search.onboard === "1", "Step 1 upload / connect opens");
  const toast = firmClientAddedToast({ name: "Northwind", clientCode: "MLN-ABC234" });
  assert(toast.includes("Northwind"), "toast names the client");
  assert(toast.includes("Home"), "toast says the Home is open");
  assert(/upload or connect/i.test(toast), "toast names the next step");
  assert(!/ZAR|rand/i.test(toast), "success copy does not show rand");
  assert(!/ZAR|rand/i.test(JSON.stringify(ADD_CLIENT_BUTTON)), "button copy does not show rand");
  assert(addClientButtonLabel(null) === "Add client", "idle button");
  assert(addClientButtonLabel("checking") === "Checking your plan…", "plan progress");
  assert(addClientButtonLabel("creating") === "Creating the client…", "create progress");
  assert(addClientButtonLabel("opening") === "Opening their Home…", "open progress");

  const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
  assert(
    board.includes("navigate(firmClientCreatedNavigation(created.id))"),
    "the clients page navigates with the new client route",
  );
  assert(!/wasFirst && created\.id/.test(board), "later clients also leave the drawer");
  assert(board.includes("addClientButtonLabel(savePhase)"), "the button shows the progress label");
  assert(!board.includes('saving ? "Saving…"'), "the button does not sit on Saving…");

  const createFn = readFileSync(resolve("src/lib/firm-clients.functions.ts"), "utf8");
  assert(createFn.includes("runFirmClientCreate"), "create uses the parallel gate");
  assert(
    createFn.includes("readStoredCreateEntitlement") &&
      createFn.includes("countFirmClientsForCreate"),
    "create reads the stored plan and the client count",
  );
}

await parallelReadsSkipStripe();
await nearCapUsesLiveStripeAndDoesNotCreate();
await unsyncedOrBlockedPlanDoesNotSkip();
await eng2MirrorRows();
await failedReadsFallBackToLive();
navigationOpensClientHome();
console.log("add-client-save: ok");
