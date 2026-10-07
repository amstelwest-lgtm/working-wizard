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
import { inAppAccountantSignoffLine, isSamplePracticeSignoff } from "../src/lib/review-signoff-stamp";

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

assert(isSamplePracticeSignoff({ name: "A. Sample, CA(SA)" }), "CA(SA) suffix is still the sample persona");
assert(isSamplePracticeSignoff({ name: "A. Sample, CPA" }), "CPA suffix is still the sample persona");
assert(isSamplePracticeSignoff({ name: "A.Sample" }), "initials can sit against the sample surname");
assert(isSamplePracticeSignoff({ firmName: "Sample Practice" }), "Sample Practice is a sample firm");
assert(isSamplePracticeSignoff({ firmName: "SAMPLE PRACTICE" }), "sample firm match ignores case");
assert(
  !isSamplePracticeSignoff({ name: "James Fleming", firmName: "Ben Accountants" }),
  "a real accountant is not a sample",
);

const namedLine = inAppAccountantSignoffLine({
  name: "James Fleming",
  firmName: "Ben Accountants",
  signedOffAt: "2026-10-08T01:15:46.000Z",
  market: { locale: "en-US", timezone: "America/New_York" },
});
assert(
  namedLine?.startsWith("Signed off by James Fleming · Ben Accountants · ") === true,
  `sign-off line names the row, got ${namedLine}`,
);
assert(namedLine != null && /EDT|UTC-4/.test(namedLine), `sign-off line keeps the zone, got ${namedLine}`);
assert(
  inAppAccountantSignoffLine({
    name: "A. Sample, CA(SA)",
    firmName: "Sample Practice",
    signedOffAt: "2026-10-08T01:15:46.000Z",
    market: { locale: "en-ZA", timezone: "Africa/Johannesburg" },
  }) === null,
  "a sample sign-off row is not named",
);
assert(
  inAppAccountantSignoffLine({
    name: "A. Sample, CPA",
    firmName: "sample practice",
    signedOffAt: "2026-10-08T01:15:46.000Z",
  }) === null,
  "a lowercase sample firm is not named",
);

assert(
  dashSrc.includes("title={greetingSource || user?.email || \"\"}"),
  "chip tooltip uses the same name as the greeting",
);
const panelSrc = readFileSync(resolve("src/components/advisory-pack-panel.tsx"), "utf8");
assert(panelSrc.includes("inAppAccountantSignoffLine"), "pack line names the sign-off row");
assert(!panelSrc.includes("Signed off by the accountant"), "pack line no longer hides the signer");

console.log("accountant-identity ok");
