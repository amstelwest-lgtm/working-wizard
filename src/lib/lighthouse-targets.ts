/**
 * SA + US target list helpers for the live Lighthouse console.
 * Pure: import parsing, phone normalisation, and the cold-cadence stop.
 * Writers live in lighthouse.functions.ts and still use milon_ops_leads.
 */

export type LighthouseTargetCountry = "US" | "SA" | "OTHER";
export type LighthouseConversationKind = "phone" | "video" | "in_person";
export type LighthouseTargetPersona = "owner" | "accountant";

const HEADER_FIELDS = [
  "name",
  "email",
  "company",
  "persona",
  "city",
  "region",
  "country",
  "phone",
  "website",
  "signal",
] as const;

export type LighthouseImportParsedRow = {
  name: string | null;
  email: string | null;
  company: string | null;
  /** Set only when the cell itself said owner or accountant. */
  personaFromCell: LighthouseTargetPersona | null;
  city: string | null;
  region: string | null;
  country: LighthouseTargetCountry | null;
  phone: string | null;
  phoneE164: string | null;
  website: string | null;
  signal: string | null;
};

export type LighthouseImportDraft = LighthouseImportParsedRow & {
  persona: LighthouseTargetPersona;
};

export type LighthouseImportExisting = {
  id: string;
  email?: string | null;
  company?: string | null;
  website?: string | null;
};

export type LighthouseImportPlan = {
  insert: LighthouseImportDraft[];
  update: { id: string; row: LighthouseImportDraft }[];
  inserted: number;
  updated: number;
  skipped: number;
};

export function mapLighthouseCountry(
  value: string | null | undefined,
): LighthouseTargetCountry | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
  if (!v) return null;
  if (v === "sa" || v === "za" || v === "south africa" || v === "south-africa") return "SA";
  if (
    v === "us" ||
    v === "usa" ||
    v === "u s" ||
    v === "u s a" ||
    v === "united states" ||
    v === "united states of america"
  ) {
    return "US";
  }
  if (v === "other") return "OTHER";
  return "OTHER";
}

export function storedLeadMarket(
  country: string | null | undefined,
): LighthouseTargetCountry | null {
  const c = String(country ?? "")
    .trim()
    .toUpperCase();
  if (c === "US" || c === "SA" || c === "OTHER") return c;
  return null;
}

/**
 * SA locals that start with 0 become +27. US 10-digit numbers become +1.
 * Returns null when the string is not a number we can place.
 */
export function normalisePhoneE164(
  phone: string | null | undefined,
  country?: string | null,
): string | null {
  if (!phone) return null;
  let raw = phone.trim();
  if (!raw) return null;
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  const plus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const geo = mapLighthouseCountry(country ?? "");

  if (plus) return `+${digits}`;
  if (digits.startsWith("0")) {
    const rest = digits.replace(/^0+/, "");
    if (!rest) return null;
    return `+27${rest}`;
  }
  if (digits.startsWith("27") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (geo === "SA" && digits.length === 9) return `+27${digits}`;
  return null;
}

export function mapLighthousePersona(
  value: string | null | undefined,
): LighthouseTargetPersona | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === "owner" || v === "business owner" || v === "sme" || v === "business") return "owner";
  if (v === "accountant" || v === "accountants" || v === "practice" || v === "cpa") {
    return "accountant";
  }
  return null;
}

export function firmHost(website: string | null | undefined): string | null {
  const raw = String(website ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  try {
    const withProto = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    const host = raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    return host || null;
  }
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = String(email ?? "")
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  return e.slice(at + 1).replace(/^www\./, "") || null;
}

export function coldCadenceOpen(lead: { conversationHeld?: boolean | null }): boolean {
  return !lead.conversationHeld;
}

/** Next cold-step date. A held conversation schedules nothing. */
export function scheduledColdTouchOn(
  conversationHeld: boolean,
  nextOn: string | null,
): string | null {
  if (conversationHeld) return null;
  return nextOn;
}

export function conversationActivityType(kind: LighthouseConversationKind): "call" | "meeting" {
  return kind === "phone" ? "call" : "meeting";
}

export function isTargetNotContacted(lead: {
  repliedAt?: string | null;
  lastInboundAt?: string | null;
  touches?: Array<{ sentAt?: string | null; status?: string | null }>;
}): boolean {
  if (String(lead.repliedAt ?? "").trim()) return false;
  if (String(lead.lastInboundAt ?? "").trim()) return false;
  const sent = (lead.touches ?? []).some((touch) => touch.sentAt || touch.status === "sent");
  return !sent;
}

function blankToNull(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === "," || c === ";" || c === "\t") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function rowFromFields(fields: {
  name?: string;
  email?: string;
  company?: string;
  persona?: string;
  city?: string;
  region?: string;
  country?: string;
  phone?: string;
  website?: string;
  signal?: string;
}): LighthouseImportParsedRow {
  const country = mapLighthouseCountry(fields.country);
  const phone = blankToNull(fields.phone);
  const email = blankToNull(fields.email)?.toLowerCase() ?? null;
  return {
    name: blankToNull(fields.name),
    email,
    company: blankToNull(fields.company),
    personaFromCell: mapLighthousePersona(fields.persona),
    city: blankToNull(fields.city),
    region: blankToNull(fields.region),
    country,
    phone,
    phoneE164: normalisePhoneE164(phone, country),
    website: blankToNull(fields.website),
    signal: blankToNull(fields.signal),
  };
}

/** Header CSV in any column order, or the old name,email,company,signal lines. */
export function parseLighthouseImport(text: string): LighthouseImportParsedRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headerCells = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const known = new Set<string>(HEADER_FIELDS);
  const knownHeaders = headerCells.filter((cell) => known.has(cell));
  const isHeader = knownHeaders.includes("email") && knownHeaders.length >= 2;
  const body = isHeader ? lines.slice(1) : lines;

  return body.map((line) => {
    const cells = parseCsvLine(line);
    if (!isHeader) {
      return rowFromFields({
        name: cells[0],
        email: cells[1],
        company: cells[2],
        signal: cells[3],
      });
    }
    const record: Record<string, string> = {};
    headerCells.forEach((key, index) => {
      if (!record[key]) record[key] = cells[index] ?? "";
    });
    return rowFromFields(record);
  });
}

function emailKey(email: string | null | undefined): string | null {
  const v = String(email ?? "")
    .trim()
    .toLowerCase();
  return v || null;
}

function companyKey(company: string | null | undefined): string | null {
  const v = String(company ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return v || null;
}

function firmTokens(row: { website?: string | null; email?: string | null }): string[] {
  const tokens = [firmHost(row.website), emailDomain(row.email)].filter((token): token is string =>
    Boolean(token),
  );
  return [...new Set(tokens)];
}

/** Same company, and a shared website host or email domain. */
export function sameTargetFirm(
  a: { company?: string | null; website?: string | null; email?: string | null },
  b: { company?: string | null; website?: string | null; email?: string | null },
): boolean {
  const left = companyKey(a.company);
  const right = companyKey(b.company);
  if (!left || left !== right) return false;
  const aTokens = firmTokens(a);
  const bTokens = firmTokens(b);
  return aTokens.some((token) => bTokens.includes(token));
}

function withPersona(
  row: LighthouseImportParsedRow,
  defaultPersona: LighthouseTargetPersona,
): LighthouseImportDraft {
  return { ...row, persona: row.personaFromCell ?? defaultPersona };
}

function usableIdentity(row: LighthouseImportParsedRow): boolean {
  return Boolean(row.name || row.email || (row.company && (row.website || row.email)));
}

/**
 * Email wins. Then website or email domain inside the same company.
 * Existing email matches update. A firm match updates. The rest insert
 * when they have a name or email. Counts are the rows after that pass.
 */
export function planLighthouseImport(
  rows: LighthouseImportParsedRow[],
  existing: LighthouseImportExisting[],
  defaultPersona: LighthouseTargetPersona,
): LighthouseImportPlan {
  const kept: LighthouseImportParsedRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    if (!usableIdentity(row)) {
      skipped++;
      continue;
    }
    const email = emailKey(row.email);
    const duplicate = kept.some((prior) => {
      const priorEmail = emailKey(prior.email);
      if (email && priorEmail && email === priorEmail) return true;
      return sameTargetFirm(prior, row);
    });
    if (duplicate) {
      skipped++;
      continue;
    }
    kept.push(row);
  }

  const insert: LighthouseImportDraft[] = [];
  const update: { id: string; row: LighthouseImportDraft }[] = [];
  const claimed = new Set<string>();

  for (const row of kept) {
    const email = emailKey(row.email);
    const byEmail = email
      ? existing.find((item) => !claimed.has(item.id) && emailKey(item.email) === email)
      : undefined;
    const byFirm = byEmail
      ? undefined
      : existing.find((item) => !claimed.has(item.id) && sameTargetFirm(item, row));
    const match = byEmail ?? byFirm;
    if (match) {
      claimed.add(match.id);
      update.push({ id: match.id, row: withPersona(row, defaultPersona) });
      continue;
    }
    if (!row.name && !row.email) {
      skipped++;
      continue;
    }
    insert.push(withPersona(row, defaultPersona));
  }

  return {
    insert,
    update,
    inserted: insert.length,
    updated: update.length,
    skipped,
  };
}
