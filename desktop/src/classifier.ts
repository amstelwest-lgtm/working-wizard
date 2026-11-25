/**
 * Upload assistant. Filename plus first-page text. No ledger, no model call.
 * source-document intake does not classify on upload, and source_documents
 * has no metadata column, so this result stays on the device.
 */

export type DocType = "invoice" | "bill" | "receipt" | "bank statement" | "other";
export type Flag = "unreadable" | "duplicate" | "wrong-period";

export type ClientRef = { id: string; name: string };

export type Review = {
  docType: DocType;
  period: string | null;
  suggestedClientId: string | null;
  suggestedClientName: string | null;
  flags: Flag[];
  confidence: number;
  question: string | null;
};

const TYPE_RULES: { type: DocType; re: RegExp }[] = [
  {
    type: "bank statement",
    re: /\b(bank statement|account statement|statement of account|bank stmt|statements?)\b|\bstmt\b/i,
  },
  { type: "receipt", re: /\breceipts?\b|\btill slip\b|\bproof of payment\b/i },
  { type: "invoice", re: /\b(tax invoice|sales invoice|invoices?)\b|\binv[-_ ]?\d+\b/i },
  { type: "bill", re: /\b(supplier bills?|bills?)\b/i },
];

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function findType(haystack: string): DocType | null {
  for (const rule of TYPE_RULES) {
    if (rule.re.test(haystack)) return rule.type;
  }
  return null;
}

export function findPeriod(haystack: string): string | null {
  const iso = haystack.match(/\b(20\d{2})[-_./](0[1-9]|1[0-2])(?:[-_./]\d{1,2})?\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const compact = haystack.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const monthFirst = haystack.match(/\b(0[1-9]|1[0-2])[-_./](20\d{2})\b/);
  if (monthFirst) return `${monthFirst[2]}-${monthFirst[1]}`;
  const named =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s,._/-]*(20\d{2})\b/i;
  const monthName = haystack.match(named);
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase()];
    if (month) return `${monthName[2]}-${month}`;
  }
  const yearFirst =
    /\b(20\d{2})\b[\s,._/-]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  const yearName = haystack.match(yearFirst);
  if (yearName) {
    const month = MONTHS[yearName[2].toLowerCase()];
    if (month) return `${yearName[1]}-${month}`;
  }
  return null;
}

export function formatPeriod(period: string | null): string {
  if (!period) return "an unknown period";
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = MONTH_LABEL[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : period;
}

function clientToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchingClient(haystack: string, clients: ClientRef[]): ClientRef | null {
  const hay = haystack.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  let best: ClientRef | null = null;
  let bestLen = 0;
  for (const client of clients) {
    const token = clientToken(client.name);
    if (token.length < 4) continue;
    if (!hay.includes(token)) continue;
    if (token.length > bestLen) {
      best = client;
      bestLen = token.length;
    }
  }
  return best;
}

function cap(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

export function reviewFile(input: {
  fileName: string;
  text: string;
  extension: string;
  booksPeriod: string | null;
  selectedClient: ClientRef | null;
  clients: ClientRef[];
  duplicate: boolean;
}): Review {
  const name = input.fileName;
  const text = input.text ?? "";
  const looseName = name.replace(/[_-]+/g, " ");
  const fromName = findType(looseName);
  const fromText = fromName ? null : findType(text);
  const docType: DocType = fromName ?? fromText ?? "other";
  let confidence = fromName ? 0.9 : fromText ? 0.66 : text.trim().length > 80 ? 0.35 : 0.22;
  const period = findPeriod(`${name}\n${looseName}\n${text}`);
  if (period && fromName) confidence = cap(confidence + 0.04, 0.95);

  const nameHit = matchingClient(name, input.clients);
  const textHit = nameHit ? null : matchingClient(text.slice(0, 500), input.clients);
  const hit = nameHit ?? textHit;
  const selected = input.selectedClient;
  const suggested = hit ?? selected;
  const clientMismatch = Boolean(hit && selected && hit.id !== selected.id);
  if (clientMismatch) confidence = cap(confidence, 0.5);

  const image = ["png", "jpg", "jpeg", "heic"].includes(input.extension);
  const thinText = text.trim().length < 12;
  const readableKind = image || ["pdf", "csv", "xlsx"].includes(input.extension);
  const unreadable = readableKind && thinText && !fromName;
  if (unreadable) confidence = cap(confidence, 0.3);

  const books = input.booksPeriod && /^\d{4}-\d{2}$/.test(input.booksPeriod) ? input.booksPeriod : null;
  const wrongPeriod = Boolean(period && books && period !== books);
  if (wrongPeriod) confidence = cap(confidence, 0.55);

  const flags: Flag[] = [];
  if (input.duplicate) flags.push("duplicate");
  if (unreadable) flags.push("unreadable");
  if (wrongPeriod) flags.push("wrong-period");

  return {
    docType,
    period,
    suggestedClientId: suggested?.id ?? null,
    suggestedClientName: suggested?.name ?? null,
    flags,
    confidence,
    question: input.duplicate ? null : questionFor({
      fileName: name,
      docType,
      period,
      books,
      selected,
      suggested: hit,
      clientMismatch,
      unreadable,
      wrongPeriod,
      confidence,
    }),
  };
}

function questionFor(input: {
  fileName: string;
  docType: DocType;
  period: string | null;
  books: string | null;
  selected: ClientRef | null;
  suggested: ClientRef | null;
  clientMismatch: boolean;
  unreadable: boolean;
  wrongPeriod: boolean;
  confidence: number;
}): string | null {
  const file = input.fileName;
  if (!input.selected) return `Which client should get ${file}? Pick one above.`;
  if (input.confidence >= 0.75 && !input.unreadable && !input.wrongPeriod && !input.clientMismatch) {
    return null;
  }
  if (input.unreadable) return `I can't read ${file}. Send it to ${input.selected.name} anyway?`;
  if (input.clientMismatch && input.suggested) {
    return `${file} looks like ${input.suggested.name}. Upload it to ${input.selected.name} anyway?`;
  }
  if (input.wrongPeriod) {
    return `${file} looks like ${formatPeriod(input.period)}, not ${formatPeriod(input.books)}. Upload it anyway?`;
  }
  return `Is ${file} a ${input.docType} for ${input.selected.name}?`;
}

export function answerCancels(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(n|no|nope|skip|stop|cancel|don't|dont|do not)\b/i.test(trimmed);
}

export function docTypeFromAnswer(text: string): DocType | null {
  if (/\bbank statement\b|\bstatement\b|\bstmt\b/i.test(text)) return "bank statement";
  if (/\breceipt\b/i.test(text)) return "receipt";
  if (/\binvoice\b/i.test(text)) return "invoice";
  if (/\bbill\b/i.test(text)) return "bill";
  if (/\bother\b/i.test(text)) return "other";
  return null;
}

export function currentBooksPeriod(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}
