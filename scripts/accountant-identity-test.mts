/**
 * DB-first accountant identity: firm name, greeting, and sign-off firm.
 * Run: pnpm test:accountant-identity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  persistedSignoffFirmName,
  persistedSignerName,
  practiceGreetingName,
  resolvePersistedAccountantIdentity,
} from "../src/lib/accountant-identity";
import { practiceGreeting } from "../src/lib/portfolio-dashboard";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ben = resolvePersistedAccountantIdentity({
  firmName: "Ben Accountants",
  brandContactName: null,
  profileFullName: "James Fleming",
  authFullName: "A. Sample",
});
assert(ben.firmName === "Ben Accountants", "firms.name wins");
assert(ben.accountantName === "James Fleming", "profile full_name fills a blank brand contact");

const branded = resolvePersistedAccountantIdentity({
  firmName: "Ben Accountants",
  brandContactName: "James Fleming",
  profileFullName: "Someone Else",
  authFullName: "A. Sample",
});
assert(branded.accountantName === "James Fleming", "brand contact wins over the profile");

const evening = new Date("2026-10-07T18:30:00");
const greet = practiceGreeting(
  practiceGreetingName({
    accountantName: "A. Sample",
    profileFullName: "James Fleming",
    authFullName: "A. Sample",
    email: "james@ben.example",
  }),
  evening,
);
assert(greet === "Good evening, James.", `greeting uses the profile name, got ${greet}`);

const emailFallback = practiceGreetingName({
  accountantName: "",
  profileFullName: "",
  authFullName: "A. Sample",
  email: "james@ben.example",
});
assert(emailFallback === "james", "email local-part is only after the name chain");

const signer = persistedSignerName({
  profileFullName: "James Fleming",
  authFullName: "A. Sample",
  authName: "A. Sample",
  email: "james@ben.example",
});
assert(signer === "James Fleming", "sign-off name is the profile");

const firm = persistedSignoffFirmName({
  clientFirmName: "Ben Accountants",
  requestedFirmName: "Sample Practice",
});
assert(firm === "Ben Accountants", "client-sent firm name is ignored");
assert(
  persistedSignoffFirmName({ clientFirmName: null, requestedFirmName: "Sample Practice" }) === null,
  "no client firm does not fall back to the dialog",
);

const profileSrc = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(profileSrc.includes("resolvePersistedAccountantIdentity"), "profile hydrate uses the DB identity");
assert(profileSrc.includes("dropUnsavedIdentity"), "session load drops unsaved name edits");
assert(!profileSrc.includes("cached.accountantName ||"), "cached accountant name cannot win");
assert(!profileSrc.includes("cached.firmName ||"), "cached firm name cannot win");
assert(profileSrc.includes("greetingSource"), "provider exposes the greeting chain");

const dashSrc = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dashSrc.includes("practiceGreeting(greetingSource)"), "dashboard greets from the name chain");
assert(
  !dashSrc.includes('profile.accountantName || user?.email?.split("@")[0]'),
  "dashboard does not greet from the email before the name chain",
);

const fnSrc = readFileSync(resolve("src/lib/review-signoffs.functions.ts"), "utf8");
assert(fnSrc.includes("persistedSignoffFirmName"), "sign-off firm is derived from the client");
assert(fnSrc.includes("persistedSignerName"), "sign-off name prefers the profile");
assert(!fnSrc.includes("firmFromMeta"), "metadata firm name is not a sign-off firm");
assert(!fnSrc.includes("data.firmName?.trim()"), "client-sent firm name is not written");

console.log("accountant-identity ok");
