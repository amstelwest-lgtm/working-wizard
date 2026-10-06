/**
 * Strip client identifiers before a model call, then put the client name
 * back into model output for the UI.
 *
 * Deno-safe: no Node APIs. Edge functions import this via
 * supabase/functions/_shared/redact-identifiers.ts.
 *
 * Amounts, dates, ratios, and account-category labels stay. Names, emails,
 * phones, tax IDs, and bank account numbers become stable placeholders.
 */

export const CLIENT_TOKEN = "[CLIENT]";
export const EMAIL_TOKEN = "[EMAIL]";
export const PHONE_TOKEN = "[PHONE]";
export const TAX_TOKEN = "[TAX_ID]";
export const ACCOUNT_TOKEN = "[ACCOUNT]";

export type IdentifierSubject = {
  /** Legal or trading name of the business this call is about. */
  clientName?: string | null;
  /** Other spellings of the same client (trading name, name without suffix). */
  companyNames?: Array<string | null | undefined>;
  /** Owners, contacts, accountants, customers, suppliers, other firms. */
  partyNames?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
  phones?: Array<string | null | undefined>;
  taxIds?: Array<string | null | undefined>;
  accountNumbers?: Array<string | null | undefined>;
};

export type RedactionRestore = { token: string; value: string };

export type RedactionSession = {
  clientName: string | null;
  restore: RedactionRestore[];
  clientCores: string[];
  names: Array<{ core: string; token: string }>;
  knownEmails: string[];
  knownPhones: string[];
  knownTaxIds: string[];
  knownAccounts: string[];
  nextPerson: number;
  nextEmail: number;
  nextPhone: number;
  nextTax: number;
  nextAccount: number;
};

const MASK_L = "\uE000";
const MASK_R = "\uE001";

/** Single-word labels that must survive even if a client is named that. */
const KEEP_CORES = new Set([
  "revenue",
  "sales",
  "cash",
  "tax",
  "vat",
  "equity",
  "assets",
  "profit",
  "margin",
  "debtor",
  "creditor",
  "inventory",
  "payables",
  "receivables",
  "bank",
  "account",
  "accounts",
  "total",
  "income",
  "expense",
  "expenses",
  "cost",
  "costs",
  "trade",
  "other",
  "current",
  "opening",
  "closing",
  "balance",
  "interest",
  "depreciation",
  "amortisation",
  "amortization",
  "liabilities",
  "liability",
  "capital",
  "reserves",
  "payroll",
  "wages",
  "rent",
]);

const LEGAL_SUFFIX =
  "(?:\\s*\\(\\s*(?:pty|proprietary)\\s*\\)\\s*(?:ltd|limited)\\.?" +
  "|\\s+(?:pty\\.?\\s+ltd\\.?|proprietary\\s+limited)" +
  "|\\s+(?:l\\.l\\.c\\.|llc|pllc|inc\\.?|incorporated|ltd\\.?|limited|cc|corp\\.?|corporation|plc))?";

const HEURISTIC_COMPANY =
  /(?<![A-Za-z0-9])([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,6})\s+(\((?:Pty|Proprietary)\)\s*(?:Ltd|Limited)\.?|Pty\.?\s+Ltd\.?|Proprietary\s+Limited|L\.L\.C\.|LLC|PLLC|Inc\.?|Incorporated|Ltd\.?|Limited|CC|Corp\.?|Corporation|PLC)(?![A-Za-z0-9])/g;

const PERSON_KEYS =
  /^(owner_name|ownername|contact_name|contactname|accountant_name|accountantname|signed_off_by_name|person_name|from_name)$/i;
const CLIENT_KEYS =
  /^(clientname|client_name|company_name|companyname|entity_name|entityname|company)$/i;
const EMAIL_KEYS = /^(email|e-mail|accountant_email|accountantemail|from_email|fromemail)$/i;
const PHONE_KEYS = /^(phone|mobile|tel|telephone)$/i;
const TAX_KEYS =
  /^(tax_id|taxid|vat|vat_number|vatnumber|ein|registration_number|registrationnumber|company_reg|reg_no)$/i;
const ACCOUNT_KEYS = /^(account_number|accountnumber|bank_account|iban|account_no)$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Name with a trailing legal suffix removed, for variant matching. */
export function clientNameCore(name: string): string {
  let s = clean(name);
  const suffix =
    /(?:\s*\(\s*(?:pty|proprietary)\s*\)\s*(?:ltd|limited)\.?|\s+(?:pty\.?\s+ltd\.?|proprietary\s+limited|l\.l\.c\.|llc|pllc|inc\.?|incorporated|ltd\.?|limited|cc|corp\.?|corporation|plc))+$/i;
  let prev = "";
  while (s && s !== prev) {
    prev = s;
    s = s.replace(suffix, "").trim();
  }
  return s;
}

function usableCore(core: string): boolean {
  if (core.length < 3) return false;
  if (KEEP_CORES.has(core.toLowerCase())) return false;
  return true;
}

function numberedToken(base: string, n: number): string {
  if (base === "PERSON") return `[PERSON_${n}]`;
  if (n <= 1) return base;
  return base.replace("]", `_${n}]`);
}

function remember(session: RedactionSession, token: string, value: string) {
  if (!session.restore.some((row) => row.token === token)) {
    session.restore.push({ token, value });
  }
}

function addName(session: RedactionSession, raw: string, token: string) {
  const core = clientNameCore(raw);
  if (!usableCore(core)) return;
  const key = core.toLowerCase();
  if (session.names.some((row) => row.core.toLowerCase() === key)) return;
  session.names.push({ core, token });
  session.names.sort((a, b) => b.core.length - a.core.length);
}

export function createRedactionSession(subject?: IdentifierSubject): RedactionSession {
  const clientName = clean(subject?.clientName) || null;
  const session: RedactionSession = {
    clientName,
    restore: [],
    clientCores: [],
    names: [],
    knownEmails: [],
    knownPhones: [],
    knownTaxIds: [],
    knownAccounts: [],
    nextPerson: 1,
    nextEmail: 1,
    nextPhone: 1,
    nextTax: 1,
    nextAccount: 1,
  };
  if (clientName) {
    addName(session, clientName, CLIENT_TOKEN);
    session.clientCores.push(clientNameCore(clientName).toLowerCase());
    remember(session, CLIENT_TOKEN, clientName);
  }
  for (const alias of subject?.companyNames ?? []) {
    const value = clean(alias);
    if (!value) continue;
    const core = clientNameCore(value).toLowerCase();
    if (core && !session.clientCores.includes(core)) session.clientCores.push(core);
    addName(session, value, CLIENT_TOKEN);
    if (!session.clientName) {
      session.clientName = value;
      remember(session, CLIENT_TOKEN, value);
    }
  }
  for (const party of subject?.partyNames ?? []) registerParty(session, party);
  for (const email of subject?.emails ?? []) registerEmail(session, email);
  for (const phone of subject?.phones ?? []) registerPhone(session, phone);
  for (const taxId of subject?.taxIds ?? []) registerTax(session, taxId);
  for (const account of subject?.accountNumbers ?? []) registerAccount(session, account);
  return session;
}

function registerParty(session: RedactionSession, raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!usableCore(clientNameCore(value))) return null;
  const core = clientNameCore(value).toLowerCase();
  if (session.clientCores.includes(core)) return CLIENT_TOKEN;
  const existing = session.names.find((row) => row.core.toLowerCase() === core);
  if (existing) return existing.token;
  const token = numberedToken("PERSON", session.nextPerson);
  session.nextPerson += 1;
  addName(session, value, token);
  remember(session, token, value);
  return token;
}

/** Product mailboxes are not client identifiers. Leave them in the prompt. */
function operationalEmail(value: string): boolean {
  return /@(?:trymilon\.com|milonfinance\.com|milon\.co\.za)$/i.test(value.trim());
}

function registerEmail(session: RedactionSession, raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value.includes("@") || operationalEmail(value)) return null;
  const key = value.toLowerCase();
  const already = session.knownEmails.find((row) => row.toLowerCase() === key);
  if (already) {
    const hit = session.restore.find((row) => row.value.toLowerCase() === key && row.token.startsWith("[EMAIL"));
    return hit?.token ?? EMAIL_TOKEN;
  }
  const token = numberedToken(EMAIL_TOKEN, session.nextEmail);
  session.nextEmail += 1;
  session.knownEmails.push(value);
  remember(session, token, value);
  return token;
}

function registerPhone(session: RedactionSession, raw: string | null | undefined): string | null {
  const value = clean(raw);
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (session.knownPhones.includes(digits)) {
    return session.restore.find((row) => row.value.replace(/\D/g, "") === digits && row.token.startsWith("[PHONE"))
      ?.token ?? PHONE_TOKEN;
  }
  const token = numberedToken(PHONE_TOKEN, session.nextPhone);
  session.nextPhone += 1;
  session.knownPhones.push(digits);
  remember(session, token, value);
  return token;
}

function registerTax(session: RedactionSession, raw: string | null | undefined): string | null {
  const value = clean(raw);
  const key = value.replace(/[\s-]/g, "").toLowerCase();
  if (key.length < 5 || !/\d/.test(key)) return null;
  if (session.knownTaxIds.includes(key)) {
    return session.restore.find((row) => row.token.startsWith("[TAX_ID") && row.value.replace(/[\s-]/g, "").toLowerCase() === key)
      ?.token ?? TAX_TOKEN;
  }
  const token = numberedToken(TAX_TOKEN, session.nextTax);
  session.nextTax += 1;
  session.knownTaxIds.push(key);
  remember(session, token, value);
  return token;
}

function registerAccount(session: RedactionSession, raw: string | null | undefined): string | null {
  const value = clean(raw);
  const key = value.replace(/[\s-]/g, "");
  if (!/^\d{6,}$/.test(key)) return null;
  if (session.knownAccounts.includes(key)) {
    return session.restore.find((row) => row.token.startsWith("[ACCOUNT") && row.value.replace(/[\s-]/g, "") === key)
      ?.token ?? ACCOUNT_TOKEN;
  }
  const token = numberedToken(ACCOUNT_TOKEN, session.nextAccount);
  session.nextAccount += 1;
  session.knownAccounts.push(key);
  remember(session, token, value);
  return token;
}

function namePattern(core: string): RegExp {
  const body = escapeRegExp(core).replace(/\\\s/g, "\\s+");
  return new RegExp(
    `(?<![A-Za-z0-9])${body}${LEGAL_SUFFIX}(?:['’]s|['’])?(?![A-Za-z0-9])`,
    "gi",
  );
}

function protectLiterals(text: string): { text: string; masks: string[] } {
  const masks: string[] = [];
  const patterns = [
    /https?:\/\/[^\s<>"')]+/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/gi,
    /(?:[$£€]|R(?=\s?\d))\s?\d[\d,]*(?:\.\d+)?%?/g,
    /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?%?\b/g,
    /\b\d+\.\d+%?\b/g,
  ];
  let out = text;
  for (const pattern of patterns) {
    out = out.replace(pattern, (match) => {
      const token = `${MASK_L}${masks.length}${MASK_R}`;
      masks.push(match);
      return token;
    });
  }
  return { text: out, masks };
}

function restoreMasks(text: string, masks: string[]): string {
  let out = text;
  for (let i = masks.length - 1; i >= 0; i--) {
    out = out.split(`${MASK_L}${i}${MASK_R}`).join(masks[i] ?? "");
  }
  return out;
}

function replaceKnownNames(text: string, session: RedactionSession): string {
  let out = text;
  for (const row of session.names) {
    out = out.replace(namePattern(row.core), row.token);
  }
  return out;
}

function replaceHeuristicCompanies(text: string, session: RedactionSession): string {
  return text.replace(HEURISTIC_COMPANY, (full, core: string) => {
    const normalized = clientNameCore(String(core));
    if (!usableCore(normalized)) return full;
    if (/^(the|this|that|these|those|and|for|from|with|your|our|any|all)$/i.test(normalized)) {
      return full;
    }
    const key = normalized.toLowerCase();
    if (session.clientCores.includes(key) || !session.clientName) {
      if (!session.clientName) {
        session.clientName = clean(full);
        session.clientCores.push(key);
        remember(session, CLIENT_TOKEN, session.clientName);
      }
      addName(session, full, CLIENT_TOKEN);
      return CLIENT_TOKEN;
    }
    const token = registerParty(session, full);
    return token ?? full;
  });
}

function replaceEmails(text: string, session: RedactionSession): string {
  let out = text;
  for (const email of session.knownEmails) {
    const token =
      session.restore.find((row) => row.value.toLowerCase() === email.toLowerCase() && row.token.startsWith("[EMAIL"))
        ?.token ?? EMAIL_TOKEN;
    out = out.replace(new RegExp(escapeRegExp(email), "gi"), token);
  }
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (match) => {
    if (operationalEmail(match)) return match;
    return registerEmail(session, match) ?? EMAIL_TOKEN;
  });
  return out;
}

function replacePhones(text: string, session: RedactionSession): string {
  let out = text;
  for (const digits of session.knownPhones) {
    const token =
      session.restore.find((row) => row.value.replace(/\D/g, "") === digits && row.token.startsWith("[PHONE"))
        ?.token ?? PHONE_TOKEN;
    const body = digits.split("").join("[\\s().-]*");
    out = out.replace(new RegExp(`(?<![\\d])\\+?${body}(?![\\d])`, "g"), token);
  }
  const patterns: RegExp[] = [
    /\+\d{1,3}(?:[\s.-]?\d{2,4}){2,4}\b/g,
    /\b0\d{2}[\s.-]\d{3}[\s.-]\d{4}\b/g,
    /\b0\d{9}\b/g,
    /\b\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
  ];
  for (const pattern of patterns) {
    out = out.replace(pattern, (match) => registerPhone(session, match) ?? match);
  }
  return out;
}

function replaceTaxIds(text: string, session: RedactionSession): string {
  let out = text;
  for (const key of session.knownTaxIds) {
    const token =
      session.restore.find(
        (row) => row.token.startsWith("[TAX_ID") && row.value.replace(/[\s-]/g, "").toLowerCase() === key,
      )?.token ?? TAX_TOKEN;
    const body = key.split("").join("[\\s-]*");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi"), token);
  }
  const labeled =
    /(?:\bvat(?:\s*(?:number|no\.?))?|\bein\b|\btin\b|\btax\s*(?:id|number|no\.?)|\bregistration\s*(?:number|no\.?)|\breg\.?\s*(?:no|number)|\bcompany\s+registration(?:\s*(?:number|no\.?))?)\s*[:#]?\s*([A-Z0-9][A-Z0-9./-]{3,24})/gi;
  out = out.replace(labeled, (match, value: string) => {
    if (!/\d/.test(value)) return match;
    const token = registerTax(session, value);
    if (!token) return match;
    return match.slice(0, match.length - value.length) + token;
  });
  out = out.replace(/\b\d{2}-\d{7}\b/g, (match) => registerTax(session, match) ?? match);
  out = out.replace(/\b(?:19|20)\d{2}\/\d{6}\/\d{2}\b/g, (match) => registerTax(session, match) ?? match);
  out = out.replace(/(?<![\d.,])4\d{9}(?![\d.])/g, (match) => registerTax(session, match) ?? match);
  return out;
}

function replaceAccountNumbers(text: string, session: RedactionSession): string {
  let out = text;
  for (const key of session.knownAccounts) {
    const token =
      session.restore.find((row) => row.token.startsWith("[ACCOUNT") && row.value.replace(/[\s-]/g, "") === key)
        ?.token ?? ACCOUNT_TOKEN;
    const body = key.split("").join("[\\s-]*");
    out = out.replace(new RegExp(`(?<![\\d])${body}(?![\\d])`, "g"), token);
  }
  out = out.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, (match) => {
    const token = numberedToken(ACCOUNT_TOKEN, session.nextAccount);
    session.nextAccount += 1;
    remember(session, token, match);
    return token;
  });
  const labeled =
    /(?:\bbank\s+account|\baccount\s*(?:no|number|#)|\bacc\.?\s*(?:no|number|#)|\ba\/c)\s*[:#]?\s*(\d[\d\s-]{5,24}\d)/gi;
  out = out.replace(labeled, (match, value: string) => {
    const token = registerAccount(session, value.replace(/[\s-]/g, ""));
    if (!token) return match;
    return match.slice(0, match.length - value.length) + token;
  });
  out = out.replace(/(?<![\d.,$£€R])\d{10,17}(?![\d.])/g, (match) => {
    if (/^4\d{9}$/.test(match)) return registerTax(session, match) ?? match;
    if (/^0\d{9}$/.test(match)) return registerPhone(session, match) ?? match;
    return registerAccount(session, match) ?? match;
  });
  return out;
}

/** Redact one string. Mutates the session so placeholders stay stable. */
export function applyRedaction(text: string, session: RedactionSession): string {
  if (!text) return text;
  const protectedText = protectLiterals(text);
  let out = protectedText.text;
  out = replaceEmails(out, session);
  out = replacePhones(out, session);
  out = replaceTaxIds(out, session);
  out = replaceAccountNumbers(out, session);
  out = replaceKnownNames(out, session);
  out = replaceHeuristicCompanies(out, session);
  return restoreMasks(out, protectedText.masks);
}

export function redactForModel(
  text: string,
  subject?: IdentifierSubject,
): { text: string; session: RedactionSession } {
  const session = createRedactionSession(subject);
  return { text: applyRedaction(text, session), session };
}

export function redactIdentifiers(text: string, subject?: IdentifierSubject): string {
  return redactForModel(text, subject).text;
}

function plainRestore(text: string, session: RedactionSession): string {
  const rows = [...session.restore].sort((a, b) => b.token.length - a.token.length);
  let out = text;
  for (const row of rows) out = out.split(row.token).join(row.value);
  return out;
}

function rehydrateValue(value: unknown, session: RedactionSession): unknown {
  if (typeof value === "string") return plainRestore(value, session);
  if (Array.isArray(value)) return value.map((item) => rehydrateValue(item, session));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rehydrateValue(item, session);
    }
    return out;
  }
  return value;
}

/** Put real names back into model output. JSON is restored inside strings so quotes stay valid. */
export function rehydrateModelOutput(text: string, session: RedactionSession): string {
  const trimmed = text.trim();
  const fenced = trimmed.startsWith("```");
  const body = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const restored = JSON.stringify(rehydrateValue(JSON.parse(body), session));
      return fenced ? `\`\`\`json\n${restored}\n\`\`\`` : restored;
    } catch {
      // Prose that happens to start with a brace falls through.
    }
  }
  return plainRestore(text, session);
}

/** Replace [CLIENT] with the business name. Other placeholders are left as-is. */
export function rehydrateClientName(text: string, clientName: string | null | undefined): string {
  const name = clean(clientName);
  if (!name) return text;
  return text.split(CLIENT_TOKEN).join(name);
}

type JsonParent = Record<string, unknown> | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Redact strings inside tool results. Numbers stay numbers so amounts survive.
 */
export function redactStructured<T>(value: T, session: RedactionSession, key?: string, parent?: JsonParent): T {
  if (typeof value === "string") {
    if (key && EMAIL_KEYS.test(key)) return (registerEmail(session, value) ?? applyRedaction(value, session)) as T;
    if (key && PHONE_KEYS.test(key)) return (registerPhone(session, value) ?? applyRedaction(value, session)) as T;
    if (key && TAX_KEYS.test(key)) return (registerTax(session, value) ?? applyRedaction(value, session)) as T;
    if (key && ACCOUNT_KEYS.test(key)) return (registerAccount(session, value) ?? applyRedaction(value, session)) as T;
    if (key && PERSON_KEYS.test(key)) return (registerParty(session, value) ?? applyRedaction(value, session)) as T;
    if (key && CLIENT_KEYS.test(key)) {
      const valueClean = clean(value);
      const core = clientNameCore(valueClean).toLowerCase();
      if (!usableCore(core)) return applyRedaction(value, session) as T;
      if (!session.clientName || session.clientCores.includes(core)) {
        if (!session.clientName) {
          session.clientName = valueClean;
          session.clientCores.push(core);
          remember(session, CLIENT_TOKEN, valueClean);
        }
        addName(session, valueClean, CLIENT_TOKEN);
        return CLIENT_TOKEN as T;
      }
      return (registerParty(session, valueClean) ?? applyRedaction(value, session)) as T;
    }
    if (key === "name" && parent && (typeof parent.role === "string" || typeof parent.email === "string")) {
      return (registerParty(session, value) ?? value) as T;
    }
    return applyRedaction(value, session) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStructured(item, session, key, null)) as T;
  }
  const record = asRecord(value);
  if (record) {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(record)) {
      out[childKey] = redactStructured(child, session, childKey, record);
    }
    return out as T;
  }
  return value;
}

export function redactTextParts<T extends { type: string; text?: string; source?: { data?: string } }>(
  parts: T[],
  subject?: IdentifierSubject,
): { parts: T[]; session: RedactionSession } {
  const session = createRedactionSession(subject);
  const next = parts.map((part) => {
    if (part.type === "text" && typeof part.text === "string") {
      return { ...part, text: applyRedaction(part.text, session) };
    }
    return part;
  });
  return { parts: next, session };
}

/** Text/CSV statement block. Document bytes are not touched. */
export function redactStatementText(input: {
  preamble: string;
  fileName?: string | null;
  accountLabel?: string | null;
  body: string;
  subject?: IdentifierSubject;
}): { text: string; session: RedactionSession } {
  const session = createRedactionSession(input.subject);
  const fileName = input.fileName ? applyRedaction(input.fileName, session) : "statement";
  const label = input.accountLabel ? applyRedaction(input.accountLabel, session) : "";
  const header = label
    ? `--- Bank statement file: ${fileName} | account: ${label} ---`
    : `File: ${fileName}`;
  const body = applyRedaction(input.body, session);
  const preamble = applyRedaction(input.preamble, session);
  return { text: `${preamble}\n\n${header}\n\n${body}`, session };
}
