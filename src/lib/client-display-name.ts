/**
 * Practice lists print `clients.name`. Signup can store the owner's personal
 * name there. When that happens, and a different name is already on the
 * ledger or the statements, show that name. Otherwise keep the stored name.
 */

const ENTITY_KEYS = ["entity_name", "company_name", "companyName", "entityName"] as const;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function same(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

export function businessNameFromFinancials(financials: unknown): string | null {
  if (!financials || typeof financials !== "object") return null;
  const record = financials as Record<string, unknown>;
  for (const key of ENTITY_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      const name = clean(value);
      if (name) return name;
    }
  }
  return null;
}

function amountOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Revenue, cash, or a cash-flow line. An empty shell has none of these. */
export function clientHasBooks(client: { financials?: unknown; cashflow?: unknown }): boolean {
  const fin = client.financials;
  if (fin && typeof fin === "object") {
    const record = fin as Record<string, unknown>;
    for (const key of ["revenue", "cash", "cogs", "netIncome", "receivables", "payables"]) {
      const amount = amountOf(record[key]);
      if (amount != null && Math.abs(amount) > 0.5) return true;
    }
  }
  const flow = client.cashflow;
  if (flow && typeof flow === "object") {
    const record = flow as Record<string, unknown>;
    const opening = amountOf(record.openingBalance);
    if (opening != null && Math.abs(opening) > 0.5) return true;
    for (const key of ["revenue", "expenses", "other"]) {
      const lines = record[key];
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        if (!line || typeof line !== "object") continue;
        const amount = amountOf((line as { amount?: unknown }).amount);
        if (amount != null && Math.abs(amount) > 0.5) return true;
      }
    }
  }
  return false;
}

/**
 * Rows that share a display name and have no books collapse to the oldest.
 * A row with its own books stays, even when the name matches.
 */
export function collapseDuplicateClientShells<
  T extends { id: string; name: string; created_at?: string | null; financials?: unknown; cashflow?: unknown },
>(clients: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const client of clients) {
    const key = clean(client.name).toLowerCase();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(client);
    groups.set(key, list);
  }
  const drop = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const empty = list.filter((client) => !clientHasBooks(client));
    if (empty.length === 0) continue;
    if (empty.length < list.length) {
      for (const shell of empty) drop.add(shell.id);
      continue;
    }
    const oldest = [...empty].sort((a, b) => {
      const aAt = a.created_at ?? "";
      const bAt = b.created_at ?? "";
      if (aAt && bAt && aAt !== bAt) return aAt.localeCompare(bAt);
      if (aAt && !bAt) return -1;
      if (!aAt && bAt) return 1;
      return a.id.localeCompare(b.id);
    })[0];
    for (const shell of empty) {
      if (shell.id !== oldest?.id) drop.add(shell.id);
    }
  }
  return clients.filter((client) => !drop.has(client.id));
}

export function clientDisplayName(input: {
  storedName: string;
  ownerFullName?: string | null;
  viewerFullName?: string | null;
  ledgerNames?: readonly (string | null | undefined)[];
}): string {
  const stored = clean(input.storedName);
  if (!stored) return input.storedName;
  const personal = [input.ownerFullName, input.viewerFullName].map(clean).filter(Boolean);
  const looksPersonal = personal.some((name) => same(name, stored));
  if (!looksPersonal) return stored;
  for (const raw of input.ledgerNames ?? []) {
    const name = clean(raw);
    if (!name) continue;
    if (same(name, stored)) continue;
    if (personal.some((person) => same(person, name))) continue;
    return name;
  }
  return stored;
}

export type DisplayNameClient = {
  id: string;
  name: string;
  owner_user_id?: string | null;
  financials?: unknown;
};

type QueryResult = { data: unknown; error: { message?: string } | null };

type NameDb = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (column: string, values: string[]) => PromiseLike<QueryResult>;
    };
  };
};

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

async function readIn(db: NameDb, table: string, columns: string, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  try {
    const { data, error } = await db.from(table).select(columns).in("client_id", ids);
    if (error) return [];
    return rowsOf(data);
  } catch {
    return [];
  }
}

export async function loadClientDisplayNames(
  db: NameDb,
  clients: readonly DisplayNameClient[],
  viewerFullName?: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (clients.length === 0) return out;

  let ownerByClient = new Map<string, string>();
  for (const client of clients) {
    if (client.owner_user_id) ownerByClient.set(client.id, client.owner_user_id);
  }
  const missingOwner = clients.filter((client) => !ownerByClient.has(client.id)).map((client) => client.id);
  if (missingOwner.length > 0) {
    try {
      const { data, error } = await db.from("clients").select("id, owner_user_id").in("id", missingOwner);
      if (!error) {
        for (const row of rowsOf(data)) {
          const id = typeof row.id === "string" ? row.id : "";
          const owner = typeof row.owner_user_id === "string" ? row.owner_user_id : "";
          if (id && owner) ownerByClient.set(id, owner);
        }
      }
    } catch {
      ownerByClient = ownerByClient;
    }
  }

  const ownerIds = [...new Set(ownerByClient.values())];
  const profileName = new Map<string, string>();
  if (ownerIds.length > 0) {
    try {
      const { data, error } = await db.from("profiles").select("id, full_name").in("id", ownerIds);
      if (!error) {
        for (const row of rowsOf(data)) {
          const id = typeof row.id === "string" ? row.id : "";
          const name = typeof row.full_name === "string" ? row.full_name : "";
          if (id && name.trim()) profileName.set(id, name);
        }
      }
    } catch {
      /* personal-name check is optional */
    }
  }

  const ids = clients.map((client) => client.id);
  const [xero, qbo, sage] = await Promise.all([
    readIn(db, "xero_connections", "client_id, tenant_name", ids),
    readIn(db, "qbo_connections", "client_id, company_name", ids),
    readIn(db, "sage_connections", "client_id, company_name", ids),
  ]);
  const ledger = new Map<string, string[]>();
  const add = (clientId: unknown, name: unknown) => {
    if (typeof clientId !== "string" || typeof name !== "string") return;
    const list = ledger.get(clientId) ?? [];
    list.push(name);
    ledger.set(clientId, list);
  };
  for (const row of xero) add(row.client_id, row.tenant_name);
  for (const row of qbo) add(row.client_id, row.company_name);
  for (const row of sage) add(row.client_id, row.company_name);

  for (const client of clients) {
    const fromBooks = ledger.get(client.id) ?? [];
    const fromStatements = businessNameFromFinancials(client.financials);
    out.set(
      client.id,
      clientDisplayName({
        storedName: client.name,
        ownerFullName: profileName.get(ownerByClient.get(client.id) ?? "") ?? null,
        viewerFullName,
        ledgerNames: fromStatements ? [...fromBooks, fromStatements] : fromBooks,
      }),
    );
  }
  return out;
}
