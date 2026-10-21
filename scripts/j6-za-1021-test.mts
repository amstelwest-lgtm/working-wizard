/**
 * ZA firm 1020F gate, 21 Oct 2026.
 * Hand-off access for a practice editor, a visible Next-moves error,
 * and the business-owner sign-off line.
 * Run: pnpm test:j6-za-1021
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { financialsHomeSignoffLine } from "../src/components/owner-signoff-mark";
import { ownerNeedsView } from "../src/lib/owner-needs";
import {
  HANDOFF_FORBIDDEN_COPY,
  callerMayHandOff,
  handoffFailureMessage,
} from "../src/lib/owner-handoff";
import { rowAssignment, visibleHandedAction } from "../src/lib/open-plan-home";
import { STARTER_TRIAL_ENDED_MESSAGE } from "../src/lib/starter-trial-constants";
import {
  fallbackOwnerAppRole,
  isBusinessOwnerSeat,
  mergeOwnerWorkspaces,
} from "../src/lib/owner-workspaces";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const edge = readFileSync(resolve("supabase/functions/owner-handoff/index.ts"), "utf8");
const moves = readFileSync(resolve("src/components/hand-to-menu.tsx"), "utf8");
const door = readFileSync(resolve("src/components/owner-door/owner-door.tsx"), "utf8");
const accountant = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const nextStep = readFileSync(resolve("src/lib/next-step.functions.ts"), "utf8");
const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");

assert(
  callerMayHandOff({
    userId: "thandi",
    ownerUserId: "adder",
    isWorkspaceMember: false,
    isPracticeEditor: true,
  }),
  "a practice editor can hand off a firm file they did not add",
);
assert(
  !callerMayHandOff({
    userId: "stranger",
    ownerUserId: "adder",
    isWorkspaceMember: false,
    isPracticeEditor: false,
  }),
  "a stranger still cannot hand off",
);
assert(
  !callerMayHandOff({ userId: "accountant", ownerUserId: "owner", isWorkspaceMember: false }),
  "omitting the practice-editor flag still refuses someone outside the file",
);
assert(edge.includes('rpc("is_client_writer"'), "owner-handoff asks is_client_writer");
assert(
  edge.includes("isPracticeEditor: writer === true"),
  "the writer flag is the practice-editor seat",
);
assert(edge.includes('error: "forbidden"'), "the access miss keeps the forbidden code");
assert(edge.includes("handoffFailureMessage"), "the 403 also returns a sentence");

const forbidden = handoffFailureMessage("forbidden");
assert(forbidden !== "forbidden" && forbidden.length > 0, "forbidden is not shown as the raw word");
assert(forbidden === HANDOFF_FORBIDDEN_COPY, "forbidden names the access miss and the next step");
assert(!/trial|plan/i.test(forbidden), "this 403 is not a plan or trial wall");
assert(
  handoffFailureMessage("starter_trial_ended") === STARTER_TRIAL_ENDED_MESSAGE,
  "a real trial code still says the trial has ended",
);
assert(
  handoffFailureMessage("Couldn't hand this over") === "Couldn't hand this over",
  "the plain failure stays",
);
assert(moves.includes("data-move-handoff-error"), "Next moves keeps an inline error");
assert(moves.includes("data-handoff-retry"), "Next moves offers Retry");
assert(
  moves.includes("handoffFailureMessage"),
  "Next moves uses the same sentence as the action plan",
);
assert(moves.includes("detail.error"), "a failed refresh keeps the server sentence");

const zanele = "11111111-1111-4111-8111-111111111111";
const thandi = "22222222-2222-4222-8222-222222222222";
assert(
  isBusinessOwnerSeat({
    userId: zanele,
    ownerUserId: thandi,
    firmId: "firm-1020f",
    membershipRole: "client_owner",
  }),
  "Zanele's client_owner membership is the business owner on a firm file",
);
assert(
  !isBusinessOwnerSeat({
    userId: thandi,
    ownerUserId: thandi,
    firmId: "firm-1020f",
    membershipRole: null,
  }),
  "the accountant who added the firm client is not the business owner",
);
assert(
  isBusinessOwnerSeat({
    userId: "us-owner",
    ownerUserId: "us-owner",
    firmId: null,
    membershipRole: null,
  }),
  "a self-serve file still treats owner_user_id as the owner",
);
assert(nextStep.includes("isBusinessOwnerSeat"), "getNextStep uses the business-owner seat");
assert(
  nextStep.includes('from("client_memberships")'),
  "getNextStep reads the client_owner membership",
);
assert(
  !nextStep.includes("client.owner_user_id === context.userId"),
  "getNextStep does not treat owner_user_id as the owner",
);

const firmClient = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const selfServe = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dropped = mergeOwnerWorkspaces(
  [
    { id: firmClient, name: "AQA J2 ZA 1020F", firmId: "firm-1020f" },
    { id: selfServe, name: "Solo shop", firmId: null },
  ],
  [],
);
assert(
  !dropped.some((row) => row.clientId === firmClient),
  "a firm file is not an owner workspace from owner_user_id",
);
assert(
  dropped.find((row) => row.clientId === selfServe)?.role === "owner",
  "a self-serve file stays an owner workspace",
);
const withOwner = mergeOwnerWorkspaces(
  [{ id: firmClient, name: "AQA J2 ZA 1020F", firmId: "firm-1020f" }],
  [{ client_id: firmClient, role: "client_owner", name: "AQA J2 ZA 1020F" }],
);
assert(
  withOwner.find((row) => row.clientId === firmClient)?.role === "owner",
  "client_owner membership keeps the firm file",
);
assert(
  fallbackOwnerAppRole({ hasSelfServeOwned: false, membershipRoles: ["client_owner"] }) ===
    "client_owner",
  "a client_owner membership infers the owner app",
);
assert(
  fallbackOwnerAppRole({ hasSelfServeOwned: false, membershipRoles: [] }) === null,
  "owner_user_id on a firm file does not infer the owner app",
);
assert(app.includes("fallbackOwnerAppRole"), "the owner app uses that inference");
assert(app.includes("firm_id"), "the owner list can tell a practice file from a self-serve file");

const finished = rowAssignment({
  id: "move-advisor",
  notes: [{ note: "Handed to Milōn Advisor.", at: "2026-10-21T08:12:00.000Z" }],
  run: { agent: "advisor", status: "succeeded", at: "2026-10-21T08:20:00.000Z" },
});
assert(
  finished.open === false && finished.assignedAt === "2026-10-21T08:12:00.000Z",
  "a finished hand-off keeps its time",
);
const shown = visibleHandedAction([finished], {
  "move-advisor": "Move fixed contracts to variable / usage-based pricing",
});
assert(shown?.agent === "advisor", "a finished advisor hand-off still names the advisor");
assert(
  shown?.title === "Move fixed contracts to variable / usage-based pricing",
  "the owner home keeps the handed action title",
);
const openAnalyst = rowAssignment({
  id: "move-analyst",
  notes: [{ note: "Handed to Milōn Analyst.", at: "2026-10-21T07:00:00.000Z" }],
  run: { agent: "analyst", status: "running", at: "2026-10-21T07:01:00.000Z" },
});
const preferred = visibleHandedAction([finished, openAnalyst], {
  "move-advisor": "Move fixed contracts",
  "move-analyst": "Set a quarterly revenue target",
});
assert(preferred?.id === "move-analyst", "an open hand-off wins over a finished one");
assert(door.includes("visibleHandedAction"), "the owner home uses the handed action");
assert(door.includes("signoffLine={homeSignoffLine}"), "the owner home renders the sign-off line");

const line = financialsHomeSignoffLine(
  [
    {
      scope: "financials",
      signed_off_by_name: "Thandi Tester",
      signed_off_at: "2026-10-21T08:12:00.000Z",
      firm_name: "AQA J2 ZA 1020F",
    },
  ],
  { locale: "en-ZA", timezone: "Africa/Johannesburg" },
);
assert(line?.startsWith("Signed off by Thandi Tester"), "Health & ratios sign-off names Thandi");
assert(line?.includes("21 Oct 2026"), "the sign-off date is the SAST calendar day");
assert(
  financialsHomeSignoffLine(
    [
      {
        scope: "financials",
        signed_off_by_name: "A. Sample",
        signed_off_at: "2026-10-21T08:12:00.000Z",
        firm_name: "Sample Practice",
      },
    ],
    { locale: "en-ZA", timezone: "Africa/Johannesburg" },
  ) === null,
  "a sample persona is not a sign-off",
);
assert(
  accountant.includes("financialsHomeSignoffLine"),
  "the accountant home uses the same Health & ratios line",
);

const needs = ownerNeedsView({
  ownerEmail: null,
  actionsReady: true,
  actionsUnavailable: false,
  actions: [],
  draftsReady: true,
  draftsUnavailable: false,
  draftTitles: [],
  deliverablesReady: true,
  deliverablesUnavailable: false,
  deliverableCount: 1,
  advisoryTitles: ["Review the upload-only books"],
  quickBooks: { state: "absent" },
  xero: { state: "absent" },
  when: (iso) => iso,
  signedLine: line,
});
assert(needs.deliverableLines[0] === line, "What needs you leads with the sign-off sentence");
