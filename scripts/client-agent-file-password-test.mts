/**
 * Accountant reveal of one file password. No database.
 * Run: pnpm test:client-agent-file-password
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountantSendFileList } from "../src/components/accountant-send-files.tsx";
import { filePasswordKey, openFilePassword, sealFilePassword } from "../src/lib/client-agent-file-secret.ts";
import {
  FILE_PASSWORD_HIDE_MS,
  FILE_PASSWORD_READ_ACTION,
  filePasswordAuditDetails,
  revealFilePassword,
  sendFileHasPassword,
  type FilePasswordCaller,
  type FilePasswordRecord,
} from "../src/lib/client-agent-file-password-reveal.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const plain = "fixture-pass";
const caller: FilePasswordCaller = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmMember: true,
  firmAllowed: true,
};
const file: FilePasswordRecord = {
  id: "file-1",
  sendId: "send-1",
  clientId: "client-1",
  passwordIv: "iv",
  passwordBox: "box",
};

let opened = false;
let audited = false;
const anon = await revealFilePassword({
  caller: { userId: null, firmMember: true, firmAllowed: true },
  requestedClientId: "client-1",
  file,
  open: async () => {
    opened = true;
    return plain;
  },
  audit: async () => {
    audited = true;
    return true;
  },
});
assert(!anon.ok && anon.reason === "anon" && !opened && !audited, "an anonymous caller is refused");

opened = false;
audited = false;
const outsider = await revealFilePassword({
  caller: { ...caller, firmMember: false },
  requestedClientId: "client-1",
  file,
  open: async () => {
    opened = true;
    return plain;
  },
  audit: async () => {
    audited = true;
    return true;
  },
});
assert(
  !outsider.ok && outsider.reason === "forbidden" && !opened && !audited,
  "a non-member is refused",
);

opened = false;
const clientOwner = await revealFilePassword({
  caller: { ...caller, firmMember: false, firmAllowed: true },
  requestedClientId: "client-1",
  file,
  open: async () => {
    opened = true;
    return plain;
  },
  audit: async () => true,
});
assert(
  !clientOwner.ok && clientOwner.reason === "forbidden" && !opened,
  "a client owner who is not a firm member is refused",
);

const otherFirm = await revealFilePassword({
  caller: { ...caller, firmAllowed: false },
  requestedClientId: "client-1",
  file,
  open: async () => plain,
  audit: async () => true,
});
assert(!otherFirm.ok && otherFirm.reason === "forbidden", "a firm outside the send list is refused");

const wrongClient = await revealFilePassword({
  caller,
  requestedClientId: "client-2",
  file,
  open: async () => plain,
  audit: async () => true,
});
assert(!wrongClient.ok && wrongClient.reason === "not_found", "a file on another client is refused");

opened = false;
audited = false;
const empty = await revealFilePassword({
  caller,
  requestedClientId: "client-1",
  file: { ...file, passwordIv: null, passwordBox: null },
  open: async () => {
    opened = true;
    return plain;
  },
  audit: async () => {
    audited = true;
    return true;
  },
});
assert(
  empty.ok && empty.password === null && !opened && !audited,
  "nothing is returned when there is no password",
);

const blank = await revealFilePassword({
  caller,
  requestedClientId: "client-1",
  file: { ...file, passwordIv: "  ", passwordBox: "" },
  open: async () => plain,
  audit: async () => true,
});
assert(blank.ok && blank.password === null, "a blank password is not returned");

const rawKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
const key = filePasswordKey(rawKey);
assert(key?.length === 32, "the test key is 32 bytes");
const sealed = await sealFilePassword(plain, key!);
assert(!sealed.box.includes(plain) && !sealed.iv.includes(plain), "the stored password is ciphertext");

let auditRow: { file_id: string; send_id: string } | null = null;
const openedOnce = await revealFilePassword({
  caller,
  requestedClientId: "client-1",
  file: { ...file, passwordIv: sealed.iv, passwordBox: sealed.box },
  open: (box) => openFilePassword(box, key!),
  audit: async (details) => {
    auditRow = details;
    return true;
  },
});
assert(openedOnce.ok && openedOnce.password === plain, "the round trip decrypts");
assert(
  auditRow?.file_id === "file-1" && auditRow.send_id === "send-1",
  "the audit names the file and the send",
);
const details = filePasswordAuditDetails("file-1", "send-1");
assert(
  JSON.stringify(Object.keys(details).sort()) === JSON.stringify(["file_id", "send_id"]),
  "the audit row has no other fields",
);
assert(!JSON.stringify(details).includes(plain), "the audit row has no password");
assert(FILE_PASSWORD_READ_ACTION === "client_agent_file_password_read", "the audit action is a read");
assert(!sendFileHasPassword(null) && !sendFileHasPassword(""), "an empty box is not a password");
assert(sendFileHasPassword(sealed.box), "a stored box counts as a password");

const missed = await revealFilePassword({
  caller,
  requestedClientId: "client-1",
  file: { ...file, passwordIv: sealed.iv, passwordBox: sealed.box },
  open: (box) => openFilePassword(box, key!),
  audit: async () => false,
});
assert(!missed.ok && missed.reason === "unavailable" && !("password" in missed), "a missed audit returns nothing");

const broken = await revealFilePassword({
  caller,
  requestedClientId: "client-1",
  file,
  open: async () => {
    throw new Error("unavailable");
  },
  audit: async () => true,
});
assert(!broken.ok && broken.reason === "unavailable", "a failed open returns nothing");

assert(FILE_PASSWORD_HIDE_MS === 30_000, "the password hides after about 30 seconds");

const fn = read("src/lib/client-agent-send.functions.ts");
const revealSrc = fn.slice(fn.indexOf("export const revealClientAgentFilePassword"));
assert(revealSrc.includes(".middleware([requireSupabaseAuth])"), "the reveal requires a logged-in user");
assert(revealSrc.includes('reason: "anon"'), "a missing user is refused");
assert(
  revealSrc.indexOf("isFirmMember") < revealSrc.indexOf("password_box"),
  "membership is checked before the ciphertext is read",
);
assert(revealSrc.includes("revealFilePassword"), "the reveal uses the membership decision");
assert(revealSrc.includes("openFilePassword"), "the reveal decrypts on the server");
assert(revealSrc.includes("filePasswordKey"), "the reveal uses the server key");
assert(revealSrc.includes('table("audit_log")'), "the reveal writes an audit row");
assert(revealSrc.includes("FILE_PASSWORD_READ_ACTION"), "the audit action is the read mark");
assert(revealSrc.includes("filePasswordAuditDetails"), "the audit details are the file and the send");
assert(!revealSrc.includes("console."), "the reveal does not log");
assert(!revealSrc.includes("releaseClientAgentFilePassword"), "a reveal does not clear the stored password");
assert(
  !revealSrc.includes("password_iv: null") && !revealSrc.includes("password_box: null"),
  "a reveal leaves the ciphertext in place",
);
assert(!fn.includes("releaseClientAgentFilePassword"), "the accountant actions do not clear a password");
assert(!fn.includes("SECURITY DEFINER"), "the reveal adds no database function");

const loader = fn.slice(fn.indexOf("async function loadSendFiles"), fn.indexOf("export const listClientAgentSends"));
assert(loader.includes("sendFileHasPassword"), "the list only records that a password exists");
assert(!/password_box:\s/.test(loader), "the list does not return the box");
assert(!loader.includes("password_iv"), "the list does not read the iv");

const panel = read("src/components/send-agent-panel.tsx");
const listUi = read("src/components/accountant-send-files.tsx");
assert(panel.includes("revealClientAgentFilePassword"), "show password calls the server function");
assert(panel.includes("FILE_PASSWORD_HIDE_MS"), "the page hides the password on a timer");
assert(panel.includes("window.clearTimeout"), "leaving the page clears the timer");
assert(panel.includes("seenClientId !== clientId"), "a client change drops the password");
assert(panel.includes("AccountantSendFileList"), "the file list sits on the send panel");
assert(!panel.includes("flex-row"), "the panel stacks vertically");
assert(!panel.includes("console."), "the panel does not log");
assert(!panel.includes("localStorage") && !panel.includes("sessionStorage"), "the panel does not store the password");
assert(!panel.includes("track("), "the panel does not send the password to analytics");
assert(listUi.includes("Show password"), "a saved password has a show control");
assert(listUi.includes('type={shown.visible ? "text" : "password"}'), "the password stays masked until reveal");
assert(listUi.includes("Copy"), "the password can be copied");
assert(!listUi.includes("flex-row"), "the file list stacks vertically");
assert(!listUi.includes("console."), "the file list does not log");
assert(!listUi.includes("localStorage") && !listUi.includes("sessionStorage"), "the file list does not store the password");
assert(!listUi.includes("track("), "the file list does not send the password to analytics");
assert(!read("src/routes/a.$token.tsx").includes("revealClientAgentFilePassword"), "the client page cannot reveal a password");
assert(!read("src/lib/client-agent-link.functions.ts").includes("revealClientAgentFilePassword"), "the public actions do not reveal a password");
assert(
  !read("scripts/apply-client-agent-sends-sql.sh").includes("file_password") &&
    !read("scripts/apply-client-agent-send-storage-sql.sh").includes("file_password"),
  "no new SQL is added to the CI apply scripts",
);

const files = [
  {
    id: "file-with",
    itemKey: "bank_statements",
    displayName: "March statements.pdf",
    hasPassword: true,
  },
  {
    id: "file-without",
    itemKey: "travel_logbook",
    displayName: "Travel log.pdf",
    hasPassword: false,
  },
];
const hidden = renderToStaticMarkup(
  createElement(AccountantSendFileList, {
    files,
    revealed: null,
    busyFileId: null,
    onShow: () => undefined,
    onToggleVisible: () => undefined,
    onCopy: () => undefined,
  }),
);
assert(hidden.includes("Show password"), "the hidden list offers show password");
assert(hidden.includes("March statements.pdf"), "the list shows the file name");
assert(hidden.includes("Travel log.pdf"), "a file without a password is still listed");
assert(!hidden.includes(plain), "the hidden list does not show the password");
assert(!hidden.includes("<input"), "the hidden list has no password field");
const without = hidden.slice(hidden.indexOf('data-send-file="file-without"'));
assert(!without.includes("Show password"), "a file without a password has no show control");

const revealedHtml = renderToStaticMarkup(
  createElement(AccountantSendFileList, {
    files,
    revealed: { fileId: "file-with", password: plain, visible: true },
    busyFileId: null,
    onShow: () => undefined,
    onToggleVisible: () => undefined,
    onCopy: () => undefined,
  }),
);
assert(revealedHtml.includes(plain), "the revealed list shows the password");
assert(revealedHtml.includes('type="text"'), "reveal shows the password as text");
assert(revealedHtml.includes("Copy"), "the revealed password can be copied");
assert(revealedHtml.includes("Hide"), "the revealed password can be hidden");
assert(revealedHtml.includes('data-file-password="revealed"'), "the revealed state is marked");

const masked = renderToStaticMarkup(
  createElement(AccountantSendFileList, {
    files,
    revealed: { fileId: "file-with", password: plain, visible: false },
    busyFileId: null,
    onShow: () => undefined,
    onToggleVisible: () => undefined,
    onCopy: () => undefined,
  }),
);
assert(masked.includes('type="password"'), "the password is masked until reveal");
assert(masked.includes("Reveal"), "a masked password can be revealed");
assert(masked.includes('data-file-password="masked"'), "the masked state is marked");

console.log("client agent file password test ok");
