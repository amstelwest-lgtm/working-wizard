/**
 * Audit inputs for the cash forecast: one row per input that drives the
 * figures, each approved on its own. Approvals live on clients.cashflow.inputAudit
 * with a hash of the value, so an edited input reads "Changed since approval".
 * Approving never moves last_forecast_at and never blocks sign-off.
 */

export type CashAuditGroup = "setup" | "line" | "source" | "assumption";

export type CashAuditRow = {
  key: string;
  group: CashAuditGroup;
  label: string;
  value: string;
  source: string | null;
  /** What the approval hash covers. Display text can change without a re-approval. */
  hashOf: unknown;
};

export type CashInputApproval = {
  approvedAt: string;
  approvedBy: string | null;
  valueHash: string;
  /** Signing user's initials, stored with the stamp so another browser can show them. */
  initials: string | null;
};

export type CashInputAudit = Record<string, CashInputApproval>;

export type CashAuditStatus = "suggested" | "approved" | "changed";

export const CASH_AUDIT_STATUS_LABEL: Record<CashAuditStatus, string> = {
  suggested: "To approve",
  approved: "Approved",
  changed: "Changed since approval",
};

type AuditLine = {
  id: string;
  name: string;
  amount: string;
  frequency: string;
  startWeek: number;
  splitCount: number;
};

type AuditSource = { id: string; label: string; available: boolean; chip?: string | null };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** FNV-1a over stable JSON. Short and deterministic; not a security hash. */
export function cashAuditHash(value: unknown): string {
  const text = stableJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseCashInputAudit(raw: unknown): CashInputAudit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CashInputAudit = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (typeof row.approvedAt !== "string" || typeof row.valueHash !== "string") continue;
    out[key] = {
      approvedAt: row.approvedAt,
      approvedBy: typeof row.approvedBy === "string" ? row.approvedBy : null,
      valueHash: row.valueHash,
      initials:
        typeof row.initials === "string" && row.initials.trim() ? row.initials.trim() : null,
    };
  }
  return out;
}

const FREQUENCY_WORD: Record<string, string> = {
  "recurring-weekly": "weekly",
  "recurring-monthly": "monthly",
  "once-off": "once-off",
  "split-weeks": "split over weeks",
  "split-months": "split over months",
};

function lineEntered(line: AuditLine): boolean {
  const amount = parseFloat(line.amount);
  return Number.isFinite(amount) && amount !== 0;
}

function lineValue(line: AuditLine, format: (n: number) => string): string {
  const amount = parseFloat(line.amount) || 0;
  const freq = FREQUENCY_WORD[line.frequency] ?? line.frequency;
  const split =
    line.frequency === "split-weeks" || line.frequency === "split-months"
      ? ` (${line.splitCount})`
      : "";
  return `${format(amount)} · ${freq}${split} · from week ${line.startWeek}`;
}

export function cashAuditRows(input: {
  startDate: string;
  startLabel?: string | null;
  openingBalance: string;
  openingSource?: string | null;
  floor: number;
  floorRule?: string | null;
  revenue: readonly AuditLine[];
  expenses: readonly AuditLine[];
  other: readonly AuditLine[];
  linesSource?: string | null;
  sources?: readonly AuditSource[];
  collectDelay: number;
  revGrowthPct: number;
  format: (n: number) => string;
}): CashAuditRow[] {
  const rows: CashAuditRow[] = [];
  const opening = input.openingBalance.trim();
  const openingNumber = parseFloat(opening);
  rows.push({
    key: "opening",
    group: "setup",
    label: "Opening bank balance",
    value:
      opening === "" || !Number.isFinite(openingNumber) ? "Missing" : input.format(openingNumber),
    source: input.openingSource ?? null,
    hashOf: opening,
  });
  rows.push({
    key: "startDate",
    group: "setup",
    label: "Forecast start date",
    value: input.startLabel || input.startDate,
    source: null,
    hashOf: input.startDate,
  });
  rows.push({
    key: "floor",
    group: "setup",
    label: "Cash floor",
    value: input.format(input.floor),
    source: input.floorRule ?? null,
    hashOf: Math.round(input.floor),
  });
  const sides: [readonly AuditLine[], string][] = [
    [input.revenue, "Money in"],
    [input.expenses, "Expense"],
    [input.other, "Other expense"],
  ];
  for (const [list, kind] of sides) {
    for (const line of list) {
      if (!lineEntered(line)) continue;
      rows.push({
        key: `line:${line.id}`,
        group: "line",
        label: line.name.trim() || kind,
        value: lineValue(line, input.format),
        source: input.linesSource ?? null,
        hashOf: {
          name: line.name.trim(),
          amount: parseFloat(line.amount) || 0,
          frequency: line.frequency,
          startWeek: line.startWeek,
          splitCount:
            line.frequency === "split-weeks" || line.frequency === "split-months"
              ? line.splitCount
              : null,
        },
      });
    }
  }
  for (const source of input.sources ?? []) {
    if (!source.available) continue;
    rows.push({
      key: `source:${source.id}`,
      group: "source",
      label: source.label,
      value: "Used",
      source: source.chip ?? null,
      hashOf: source.id,
    });
  }
  rows.push({
    key: "collectDelay",
    group: "assumption",
    label: "Collection delay",
    value: input.collectDelay === 0 ? "None" : `+${input.collectDelay} weeks`,
    source: null,
    hashOf: input.collectDelay,
  });
  rows.push({
    key: "revGrowthPct",
    group: "assumption",
    label: "Revenue growth",
    value: `${input.revGrowthPct}% a week`,
    source: null,
    hashOf: input.revGrowthPct,
  });
  return rows;
}

export function cashAuditStatus(row: CashAuditRow, audit: CashInputAudit): CashAuditStatus {
  const approval = audit[row.key];
  if (!approval) return "suggested";
  return approval.valueHash === cashAuditHash(row.hashOf) ? "approved" : "changed";
}

export function cashAuditPendingCount(
  rows: readonly CashAuditRow[],
  audit: CashInputAudit,
): number {
  return rows.filter((row) => cashAuditStatus(row, audit) !== "approved").length;
}

/** Two letters for the person who approved. A full name wins; otherwise the email. */
export function cashAuditInitials(name: string | null | undefined, email?: string | null): string {
  const person = (name ?? "").trim();
  const words = person.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = words[0]?.[0] ?? "";
    const last = words[words.length - 1]?.[0] ?? "";
    return `${first}${last}`.toUpperCase();
  }
  if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  const bits = local.split(/[._+-]+/).filter(Boolean);
  if (bits.length >= 2) return `${bits[0]?.[0] ?? ""}${bits[1]?.[0] ?? ""}`.toUpperCase();
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  return words[0]?.[0]?.toUpperCase() ?? "";
}

/** Approve the given keys, or every row not yet approved when `keys` is left off. */
export function approveCashInputs(
  audit: CashInputAudit,
  rows: readonly CashAuditRow[],
  opts: { by: string | null; at: string; initials?: string | null; keys?: readonly string[] },
): CashInputAudit {
  const wanted = opts.keys ? new Set(opts.keys) : null;
  const initials = opts.initials?.trim() ? opts.initials.trim() : null;
  const next: CashInputAudit = { ...audit };
  for (const row of rows) {
    if (wanted ? !wanted.has(row.key) : cashAuditStatus(row, audit) === "approved") continue;
    next[row.key] = {
      approvedAt: opts.at,
      approvedBy: opts.by,
      valueHash: cashAuditHash(row.hashOf),
      initials,
    };
  }
  return next;
}

/** Drop approval so the row reads "To approve" again. */
export function unapproveCashInputs(
  audit: CashInputAudit,
  keys: readonly string[],
): CashInputAudit {
  const drop = new Set(keys);
  const next: CashInputAudit = {};
  for (const [key, value] of Object.entries(audit)) {
    if (!drop.has(key)) next[key] = value;
  }
  return next;
}

/**
 * A value that was approved and then edited. Re-stamp it for the current user
 * so it does not sit on "Changed since approval".
 */
export function reapproveChangedCashInputs(
  audit: CashInputAudit,
  rows: readonly CashAuditRow[],
  opts: { by: string | null; at: string; initials?: string | null },
): CashInputAudit {
  const keys = rows
    .filter((row) => cashAuditStatus(row, audit) === "changed")
    .map((row) => row.key);
  if (!keys.length) return audit;
  return approveCashInputs(audit, rows, { ...opts, keys });
}

/** One soft line near Sign off. Null when everything is approved. */
export function cashAuditSignoffWarning(pending: number): string | null {
  if (pending <= 0) return null;
  return pending === 1 ? "1 input not approved" : `${pending} inputs not approved`;
}
