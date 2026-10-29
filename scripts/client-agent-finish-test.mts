/**
 * Finish a client document link: consent, one copy, one owner email,
 * a shared artifact, firm-member review, and the needs-attention count.
 * Run: pnpm test:client-agent-finish
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { uploadSourceLabel, parseDocumentMeta } from "../src/lib/client-documents.ts";
import {
  artifactCopyKey,
  buildClientAgentArtifact,
  clientAgentDoneIdempotencyKey,
  completionDecision,
  copiesStillNeeded,
  countUnreviewedSends,
  receivedItemStatus,
  reviewDecision,
  type CompletionItem,
} from "../src/lib/client-agent-done.ts";
import {
  renderClientAgentDoneEmail,
  sendClientAgentDone,
} from "../src/lib/client-agent-done-mail.ts";
import { ownerDraftPresentations, ownerNeedsView } from "../src/lib/owner-needs.ts";
import { exceptionsFor, type PortfolioClientFacts } from "../src/lib/portfolio.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const sendId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const sourcePath = `${sendId}/irp5/33333333-3333-4333-8333-333333333333`;

const fileItem: CompletionItem = {
  itemKey: "irp5",
  label: null,
  status: "received",
  quality: "usable",
  storagePath: sourcePath,
  mime: "application/pdf",
  sizeBytes: 1200,
  explanation: null,
};
const missingItem: CompletionItem = {
  itemKey: "medical_aid_certificate",
  label: null,
  status: "received",
  quality: "incomplete",
  storagePath: null,
  mime: null,
  sizeBytes: null,
  explanation: "The scheme has not issued it.",
};

const beforeConsent = completionDecision({
  consentAt: null,
  completedAt: null,
  sendId,
  items: [fileItem],
});
assert(!beforeConsent.ok && beforeConsent.reason === "consent", "completion before consent is rejected");

const incomplete = completionDecision({
  consentAt: "2026-10-22T08:00:00.000Z",
  completedAt: null,
  sendId,
  items: [fileItem, { ...missingItem, status: "open", quality: null, explanation: null }],
});
assert(!incomplete.ok && incomplete.reason === "incomplete", "an open item is rejected");

const first = completionDecision({
  consentAt: "2026-10-22T08:00:00.000Z",
  completedAt: null,
  sendId,
  items: [fileItem, missingItem],
});
assert(first.ok && !first.already, "a settled list can finish");
if (!first.ok || first.already) throw new Error("settled");
assert(first.files.length === 1, "only the final file is copied");
assert(first.received === 1 && first.missing === 1, "received and missing are counted");
assert(first.notes.length === 1 && first.notes[0]?.includes("scheme"), "notes are kept");
assert(
  copiesStillNeeded(first.files, sendId, []).length === 1,
  "the first finish copies the file",
);
assert(
  copiesStillNeeded(first.files, sendId, [{ itemKey: "irp5", sourcePath }]).length === 0,
  "a retry does not copy the same file again",
);
assert(
  artifactCopyKey(sendId, "irp5", sourcePath) === `${sendId}\nirp5\n${sourcePath}`,
  "the duplicate key is the send, the item, and the source path",
);

const again = completionDecision({
  consentAt: "2026-10-22T08:00:00.000Z",
  completedAt: "2026-10-22T09:00:00.000Z",
  sendId,
  items: [fileItem, missingItem],
});
assert(again.ok && again.already, "a finished link does not finish twice");

const artifactId = "44444444-4444-4444-8444-444444444444";
const artifact = buildClientAgentArtifact({
  artifactId,
  clientId,
  sendId,
  itemKey: "irp5",
  label: "IRP5",
  mime: "application/pdf",
  size: 1200,
  sourcePath,
});
assert(artifact.kind === "upload", "the archive row is an upload");
assert(artifact.visibility === "shared", "the archive row is shared");
assert(artifact.created_by === null, "the service role leaves created_by empty");
assert(artifact.meta.source === "client_agent_send", "the source is the client link");
assert(artifact.meta.send_id === sendId && artifact.meta.item_key === "irp5", "the row names the send item");
assert(artifact.meta.source_path === sourcePath, "the row remembers the source path");
assert(artifact.storage_path === `${clientId}/${artifactId}.pdf`, "the object lives under the client");
assert(
  uploadSourceLabel("client_agent_send") === "Sent by client (Send an agent)",
  "documents name the client link",
);
assert(
  parseDocumentMeta({ source: "client_agent_send", file_name: "IRP5", bytes: 1200 }).source ===
    "client_agent_send",
  "document meta keeps the client-link source",
);
assert(uploadSourceLabel("bank_pack") === "Bank statements", "bank packs keep their label");
assert(uploadSourceLabel("x") === "Upload", "an unknown source stays an upload");

const owner = "owner@example.com";
const clientAddress = "client@example.com";
const link = `https://www.milonfinance.com/clients/${clientId}?section=send-agent`;
const mail = renderClientAgentDoneEmail({
  clientName: "Nicola Physio",
  received: 1,
  missing: 1,
  notes: first.notes,
  link,
});
assert(mail.text.includes("Nicola Physio"), "the notice names the client");
assert(mail.text.includes("Received: 1") && mail.text.includes("Missing: 1"), "the notice counts documents");
assert(mail.text.includes("scheme"), "the notice includes the note");
assert(mail.text.includes(link), "the notice links to the client page");
assert(!mail.text.includes(clientAddress), "the notice does not address the client");
assert(!/sars|efiling|rand|\bzar\b|attachment/i.test(`${mail.subject}\n${mail.text}\n${mail.html}`), "the notice has no filing words or attachments");
assert(!mail.html.includes("<img"), "the notice has no image");

const key = clientAgentDoneIdempotencyKey(sendId);
assert(key === `client-agent-done/${sendId}`, "the email key is one per send");
const calls: Array<{ url: string; init: RequestInit }> = [];
const fetchImpl: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init: init ?? {} });
  return new Response("{}", { status: 200 });
};
const sent = await sendClientAgentDone({
  practiceName: "Theo's practice",
  to: owner,
  clientName: "Nicola Physio",
  received: 1,
  missing: 1,
  notes: first.notes,
  link,
  idempotencyKey: key,
  apiKey: "re_test",
  fromEmail: "Milōn <hello@milonfinance.com>",
  fetchImpl,
});
const resent = await sendClientAgentDone({
  practiceName: "Theo's practice",
  to: owner,
  clientName: "Nicola Physio",
  received: 1,
  missing: 1,
  notes: first.notes,
  link,
  idempotencyKey: key,
  apiKey: "re_test",
  fromEmail: "Milōn <hello@milonfinance.com>",
  fetchImpl,
});
assert(sent.ok && resent.ok, "a configured send succeeds");
assert(calls.length === 2, "a retry uses the same sender");
const bodies = calls.map((call) => JSON.parse(String(call.init.body)) as Record<string, unknown>);
const headers = calls.map((call) => call.init.headers as Record<string, string>);
assert(headers.every((header) => header["Idempotency-Key"] === key), "both sends share one idempotency key");
assert(bodies.every((body) => Array.isArray(body.to) && body.to.length === 1 && body.to[0] === owner), "mail goes to the owner");
assert(bodies.every((body) => !JSON.stringify(body.to).includes(clientAddress)), "mail does not go to the client");
assert(
  bodies.every((body) => {
    const tags = body.tags as Array<{ name: string; value: string }>;
    return tags.length === 1 && tags[0]?.name === "kind" && tags[0]?.value === "send_agent_done";
  }),
  "the notice is tagged send_agent_done",
);
assert(bodies.every((body) => !("attachments" in body)), "the notice has no attachments");
assert(String(bodies[0]?.from).includes("hello@milonfinance.com"), "the from address comes from the invite sender");
const unconfigured = await sendClientAgentDone({
  practiceName: "Theo's practice",
  to: owner,
  clientName: "Nicola Physio",
  received: 1,
  missing: 1,
  notes: [],
  link,
  idempotencyKey: key,
  apiKey: "",
  fetchImpl,
});
assert(!unconfigured.ok && unconfigured.reason === "not_configured", "a missing key does not send");
assert(calls.length === 2, "a missing key does not call Resend");

const refused = reviewDecision({
  member: false,
  firmAllowed: true,
  found: true,
  completedAt: "2026-10-22T09:00:00.000Z",
  reviewedAt: null,
});
assert(!refused.ok && refused.reason === "forbidden", "mark reviewed is firm-member only");
const allowed = reviewDecision({
  member: true,
  firmAllowed: true,
  found: true,
  completedAt: "2026-10-22T09:00:00.000Z",
  reviewedAt: null,
});
assert(allowed.ok && !allowed.already, "a firm member can mark a finished link reviewed");
assert(
  receivedItemStatus({ storagePath: sourcePath, status: "received", quality: "usable" }) === "Received",
  "a copied file reads as received",
);
assert(
  receivedItemStatus({ storagePath: null, status: "received", quality: "incomplete" }) ===
    "I don't have this",
  "a skipped item reads as missing",
);

const counts = countUnreviewedSends([
  { client_id: clientId, completed_at: "2026-10-22T09:00:00.000Z", reviewed_at: null },
  { client_id: clientId, completed_at: "2026-10-22T10:00:00.000Z", reviewed_at: null },
  { client_id: clientId, completed_at: "2026-10-22T08:00:00.000Z", reviewed_at: "2026-10-22T11:00:00.000Z" },
  { client_id: "other", completed_at: null, reviewed_at: null },
]);
assert(counts.get(clientId) === 2, "two finished links still need review");
assert(!counts.has("other"), "an unfinished link is not an exception");

const NOW = "2026-09-18T12:00:00.000Z";
const quiet: PortfolioClientFacts = {
  clientId,
  name: "Quiet Co",
  state: "action_execution",
  stateSince: "2026-09-10T00:00:00.000Z",
  nextReviewAt: null,
  figuresAsOf: "2026-08-31",
  openDataRequests: 0,
  blockingDataRequests: 0,
  overdueActions: 0,
  blockedActions: 0,
  openActions: 2,
  proposedRecommendations: 0,
  packStatus: "approved",
  packVersion: 1,
  packEditRate: 0.1,
  outcomesMissed: 0,
  outcomesMeasured: 1,
  lastLoginAt: "2026-09-15T00:00:00.000Z",
};
assert(
  !exceptionsFor(quiet, NOW).some((item) => item.kind === "documents_received"),
  "a client with no finished link is quiet",
);
const attention = exceptionsFor({ ...quiet, unreviewedSends: 2 }, NOW).filter(
  (item) => item.kind === "documents_received",
);
assert(attention.length === 1, "the count becomes one exception");
assert(attention[0]?.label === "Documents received from client", "the exception names the documents");
assert(attention[0]?.severity === 1, "the exception needs attention");
assert(attention[0]?.tab === "portal" && attention[0]?.section === "send-agent", "the exception opens the client link");

const sql = read("supabase/migrations/20261022200000_client_agent_send_completed.sql");
const code = sql
  .split("\n")
  .map((line) => line.split("--")[0])
  .join("\n")
  .toLowerCase();
assert(code.includes("add column if not exists completed_at"), "completed_at is added once");
assert(code.includes("add column if not exists reviewed_at"), "reviewed_at is added once");
assert(code.includes("new.completed_at is not null and new.consent_at is null"), "completion requires consent");
assert(
  code.includes("old.completed_at is not null") && code.includes("new.completed_at is null"),
  "completed_at cannot be cleared",
);
assert(!/\bsecurity\s+definer\b/.test(code), "the guard is not security definer");
assert(code.includes("revoke all on function public.client_agent_send_guard_firm() from public, anon, authenticated"), "login roles cannot call the guard");
assert(code.includes("grant execute on function public.client_agent_send_guard_firm() to service_role"), "the service role keeps the guard");
assert(!/grant\b[^;]*\bto\s+(anon|public)\b/.test(code), "the migration does not grant to anon or public");
assert(code.includes("image/jpeg") && code.includes("image/png") && code.includes("image/heic"), "copied images fit the documents bucket");

const fn = read("src/lib/client-agent-link.functions.ts");
const handler = fn.slice(fn.indexOf("export const completeClientAgentSend"));
const alreadyAt = handler.indexOf("if (decision.already) return { ok: true }");
const copyAt = handler.indexOf("copySendFileToArchive");
const mailAt = handler.indexOf("sendClientAgentDone");
const markAt = handler.indexOf("markCompleted");
assert(alreadyAt > 0 && alreadyAt < copyAt && copyAt < mailAt && mailAt < markAt, "a finished link skips the copy and the email");
assert(handler.indexOf("if (!mailed.ok)") < markAt, "a failed email does not store completion");
assert(!handler.includes("completed_at: null"), "the public path does not clear completion");
assert(!handler.includes("recipient_email") && !handler.includes("contact_email"), "finish does not read the client's email");
assert(handler.includes("clientAgentDoneIdempotencyKey"), "finish uses one email key");
const archiveModule = read("src/lib/client-agent-send-archive.server.ts");
assert(
  archiveModule.includes("kind: row.kind") &&
    archiveModule.includes("visibility: row.visibility") &&
    archiveModule.includes("created_by: row.created_by"),
  "finish writes the shared artifact",
);

const review = read("src/lib/client-agent-send.functions.ts");
const reviewHandler = review.slice(review.indexOf("export const reviewClientAgentSend"));
assert(reviewHandler.includes("isFirmMember"), "mark reviewed checks firm membership");
assert(reviewHandler.includes("reviewDecision"), "mark reviewed uses the member rule");
assert(reviewHandler.includes("reviewed_at: reviewedAt"), "mark reviewed stores reviewed_at");
assert(!reviewHandler.includes("completed_at:"), "mark reviewed does not change completion");

const panel = read("src/components/send-agent-panel.tsx");
assert(panel.includes("Open in Client library"), "the panel can open the copied file");
assert(panel.includes("clientDocumentDownloadUrl"), "open uses the documents link");
assert(panel.includes("Mark reviewed"), "the panel can mark the send reviewed");
assert(panel.includes("data-send-agent-received"), "received items are a block of their own");
assert(!panel.slice(panel.indexOf("data-send-agent-received")).includes("flex-row"), "the received block stacks");

const portfolio = read("src/lib/portfolio.functions.ts");
assert(portfolio.includes("countUnreviewedSends"), "the book counts unreviewed finished links");
const exceptions = read("src/components/portfolio-exceptions.tsx");
assert(exceptions.includes('section === "send-agent"'), "needs attention opens the client link");

const page = read("src/components/client-agent-link-page.tsx");
assert(page.includes("Finish"), "the button says Finish");
assert(!/recipient|owner@|resend/i.test(page), "the page does not email anyone");

const ownerSurfaces = [
  "src/lib/owner-needs.ts",
  "src/lib/owner-ops.functions.ts",
  ...walk("src/components/owner-door").filter((path) => path.endsWith(".ts") || path.endsWith(".tsx")),
];
const ownerNeedles = [
  "Documents received from client",
  "documents_received",
  "client_agent_sends",
  "getFirmPortfolio",
  "unreviewedSends",
];
for (const path of ownerSurfaces) {
  const text = read(path);
  for (const needle of ownerNeedles) {
    assert(!text.includes(needle), `${path} never mentions ${needle}`);
  }
}
assert(
  !read("src/components/owner-door/owner-door.tsx").includes("PortfolioExceptions"),
  "the owner door does not render the practice exceptions",
);
assert(
  !read("src/lib/owner-ops.functions.ts").includes(".from(\"client_agent_sends\")"),
  "the owner dashboard does not query client document links",
);
const ownerView = ownerNeedsView({
  ownerEmail: "owner@example.com",
  actionsReady: true,
  actionsUnavailable: false,
  actions: [],
  draftsReady: true,
  draftsUnavailable: false,
  draftTitles: [],
  deliverablesReady: true,
  deliverablesUnavailable: false,
  deliverableCount: 0,
  advisoryTitles: [],
  quickBooks: { state: "absent" },
  xero: { state: "absent" },
  when: (iso) => iso,
});
assert(
  !JSON.stringify(ownerView).includes("Documents received from client"),
  "owner needs does not invent the documents item",
);
assert(
  ownerDraftPresentations([
    {
      id: "finding-1",
      agent: "analyst",
      client_id: clientId,
      kind: "documents_received",
      title: "Documents received from client",
      detail: null,
      evidence: { draft: true, requires_human_approval: true, figures: { files: 1 } },
      as_of: null,
      created_at: NOW,
    },
  ]).length === 0,
  "a documents-received row is not an owner draft",
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(root, dir))) {
    const path = join(dir, name);
    if (statSync(resolve(root, path)).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

console.log("client agent finish test ok");
