/**
 * Hand-off card author. The stored label is the profile name, then the
 * email handle. Run: pnpm test:handoff-author-name
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatAssignmentNote } from "../src/lib/action-handoff";
import { persistedSignerName } from "../src/lib/accountant-identity";
import { handoffAuthorName } from "../src/lib/owner-handoff";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const email = "amstel.west+qa1020f@example.com";
const thandi = {
  profileFullName: "Thandi Tester",
  authFullName: null,
  authName: null,
  email,
};

assert(handoffAuthorName(thandi) === "Thandi Tester", "a profile name wins over the email handle");
assert(
  handoffAuthorName(thandi) === persistedSignerName(thandi),
  "the hand-off author matches the sign-off name",
);
assert(
  handoffAuthorName({ profileFullName: null, authFullName: "Thandi Tester", authName: null, email }) ===
    "Thandi Tester",
  "an auth display name is used when the profile is blank",
);
assert(
  handoffAuthorName({ profileFullName: "  ", authFullName: null, authName: "Thandi Tester", email }) ===
    "Thandi Tester",
  "auth name is the next display name",
);
assert(
  handoffAuthorName({
    profileFullName: null,
    authFullName: "A. Sample",
    authName: null,
    email,
  }) === "amstel.west+qa1020f",
  "a sample auth persona falls through to the email handle",
);
assert(
  handoffAuthorName({ profileFullName: null, authFullName: null, authName: null, email }) ===
    "amstel.west+qa1020f",
  "the email handle is the fallback when no name exists",
);
assert(handoffAuthorName({}) === "Accountant", "a missing account still has a label");

const notedAt = "2026-10-21T08:12:00.000Z";
const za = { locale: "en-ZA", timezone: "Africa/Johannesburg" };
assert(
  formatAssignmentNote(
    { note: "Handed to Milōn Advisor.", at: notedAt, actorLabel: "Thandi Tester", actorType: "owner_app" },
    za,
    notedAt,
  ).includes("by Thandi Tester"),
  "the card says by the display name",
);
assert(
  !formatAssignmentNote(
    { note: "Handed to Milōn Advisor.", at: notedAt, actorLabel: "Thandi Tester", actorType: "owner_app" },
    za,
    notedAt,
  ).includes("amstel.west"),
  "the card does not keep the email handle once a name is stored",
);

const edge = readFileSync(resolve("supabase/functions/owner-handoff/index.ts"), "utf8");
const client = readFileSync(resolve("src/lib/owner-handoff-client.ts"), "utf8");
const plan = readFileSync(resolve("src/components/action-plan.tsx"), "utf8");
const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const accountant = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(edge.includes("handoffAuthorName"), "owner-handoff stores the display name");
assert(edge.includes('.from("profiles")') && edge.includes('select("full_name")'), "the edge reads profiles.full_name");
assert(!edge.includes('user.email?.split("@")[0]'), "the edge does not store the email handle first");
assert(client.includes("handoffAuthorName"), "the client writer uses the same name");
assert(client.includes('.from("profiles")'), "the client reads the profile before writing a note");
assert(plan.includes("signedInActorLabel"), "the action card logs the same author");
assert(plan.includes("formatAssignmentNote") || plan.includes("AssignmentNotes"), "the card prints the stored author");
assert(owner.includes("ActionPlanPanel"), "the owner app renders this card");
assert(accountant.includes("ActionPlanPanel"), "the accountant file renders this card");
