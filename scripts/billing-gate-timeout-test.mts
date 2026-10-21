/**
 * The firm billing gate must not sit on its pending placeholder forever.
 * Run: pnpm test:billing-gate-timeout
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { raceShellGate, shellGateRemaining, SHELL_GATE_TIMEOUT_MS } from "../src/lib/shell-gate";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SHELL_GATE_TIMEOUT_MS === 8_000, "the shell opens after about 8 seconds");
assert(shellGateRemaining(1_000, 1_000) === 8_000, "a fresh check has the full wait");
assert(shellGateRemaining(1_000, 5_000) === 4_000, "elapsed time shortens the remaining wait");
assert(shellGateRemaining(1_000, 20_000) === 0, "a check past the deadline has no wait left");

const fast = await raceShellGate(Promise.resolve("stay"), 50);
assert(fast.status === "value" && fast.value === "stay", "a settled check wins over the timeout");

let late = false;
const hung = new Promise<string>((resolve) => {
  setTimeout(() => {
    late = true;
    resolve("owner");
  }, 40);
});
const timed = await raceShellGate(hung, 15);
assert(timed.status === "timeout", "a check that does not settle times out");
await hung;
assert(late, "timing out does not cancel the check");

const rejected = await raceShellGate(Promise.reject(new Error("nope")), 50);
assert(rejected.status === "timeout", "a thrown check fails open");

const gate = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
assert(gate.includes("SHELL_GATE_TIMEOUT_MS"), "the billing gate arms the 8s timeout");
assert(gate.includes("billing_gate_timeout"), "a timeout sends a telemetry event");
assert(
  gate.includes(
    "couldn't check billing. Gated client pages show Retry. Home stays open.",
  ),
  "a timeout logs a console warning and shows Retry on a gated client page",
);
assert(
  gate.includes('surface="error"') &&
    readFileSync(resolve("src/components/firm-billing-gate-view.tsx"), "utf8").includes("Couldn't check billing"),
  "a failed check shows the retry card",
);
assert(gate.includes("<Outlet />"), "the outlet mounts from the session");
assert(!gate.includes("firmGate"), "entitlement does not hold the outlet");
assert(!gate.includes("failOpen("), "the gate does not fail open");
assert(!gate.includes("opening the app"), "a timeout does not announce that it opened the app");
assert(gate.includes('to: "/app"'), "an owner session still leaves the practice shell");
assert(gate.includes("shouldStayOnAccountantPortal"), "the stay check still runs");
assert(!gate.includes("if (brandLoading)"), "brand loading no longer abandons the check");
assert(
  gate.includes("const userId = user?.id ?? null"),
  "the gate restarts on user id, not a new session object",
);

const profile = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(profile.includes("brand load timed out"), "brand hydrate cannot block the shell forever");
assert(
  profile.includes("}, [userId, authLoading, deferSideReads]);"),
  "a new session object does not cancel brand hydrate",
);

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(board.includes("role check timed out"), "Loading dashboard… cannot sit forever");
assert(board.includes("open queries timed out"), "Loading open queries… cannot sit forever");
assert(board.includes("client book timed out"), "the book load cannot hold the queries spinner");
assert(board.includes('navigateRef.current({ to: "/app" })'), "owner /dashboard still redirects to /app");

console.log("billing-gate-timeout ok");
