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
  recordedActorIdentity,
  resolvePersistedAccountantIdentity,
} from "../src/lib/accountant-identity";
import { practiceGreeting } from "../src/lib/portfolio-dashboard";
import { formatReviewDateTime } from "../src/lib/market/format";
import {
  inAppAccountantSignoffLine,
  isSamplePracticeSignoff,
  packHeldSignoffLine,
  reviewActorLabel,
} from "../src/lib/review-signoff-stamp";

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
  namedLine === "Signed off by James Fleming · Ben Accountants · Oct 7, 2026, 9:15 PM EDT",
  `sign-off line uses the shared clock, got ${namedLine}`,
);
assert(namedLine != null && !namedLine.includes(":15:"), `sign-off line has no seconds, got ${namedLine}`);
assert(
  formatReviewDateTime("2026-10-07T22:14:47.000Z", {
    locale: "en-US",
    timezone: "America/New_York",
  }) === "Oct 7, 2026, 6:14 PM EDT",
  "the shared clock drops the leading zero and the seconds",
);
assert(
  recordedActorIdentity({
    profileFullName: "James Fleming",
    authFullName: "A. Sample",
    clientFirmName: "Ben Accountants",
  })?.name === "James Fleming",
  "the profile name wins over a sample auth name",
);
assert(
  recordedActorIdentity({
    profileFullName: "A. Sample, CA(SA)",
    authFullName: "James Fleming",
    clientFirmName: "Ben Accountants",
  })?.name === "James Fleming",
  "a sample profile name is not the signer",
);
assert(
  recordedActorIdentity({
    profileFullName: "A. Sample",
    authFullName: "A. Sample",
    clientFirmName: "Sample Practice",
  }) === null,
  "a sample persona is not recorded",
);
assert(
  reviewActorLabel({
    name: "James Fleming",
    firmName: "Ben Accountants",
    actorKind: "accountant",
  }) === "James Fleming · Ben Accountants",
  "the trail names the actor and firm",
);
assert(
  reviewActorLabel({ actorKind: "accountant" }) === "Accountant",
  "the trail falls back to the role",
);
assert(
  packHeldSignoffLine({
    signedOff: true,
    reviewedByKind: "accountant",
    reviewedAt: "2026-10-07T22:14:47.000Z",
    name: "James Fleming",
    firmName: "Ben Accountants",
    market: { locale: "en-US", timezone: "America/New_York" },
  }) === "Signed off by James Fleming · Ben Accountants · Oct 7, 2026, 6:14 PM EDT",
  "a signed pack names the reviewer next to the chip",
);
assert(
  packHeldSignoffLine({
    signedOff: false,
    reviewedAt: "2026-10-07T22:14:47.000Z",
    name: "James Fleming",
    firmName: "Ben Accountants",
  }) === null,
  "an unsigned pack has no sign-off line",
);
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
assert(panelSrc.includes("packHeldSignoffLine"), "pack line names the sign-off row");
assert(panelSrc.includes("data-signoff-line"), "the sign-off line sits on the pack header");
assert(panelSrc.includes("reviewActorLabel"), "the trail names the actor");
assert(panelSrc.includes("formatReviewDateTime"), "the trail uses the shared clock");
assert(!panelSrc.includes("second:"), "the trail clock has no seconds");
assert(!panelSrc.includes("Signed off by the accountant"), "pack line no longer hides the signer");
const fnSrcPack = readFileSync(resolve("src/lib/advisory-pack.functions.ts"), "utf8");
assert(fnSrcPack.includes("loadPackActors"), "pack actors are resolved on the server");
assert(fnSrcPack.includes("recordedActorIdentity"), "pack actors use the DB-first name");

console.log("accountant-identity ok");
