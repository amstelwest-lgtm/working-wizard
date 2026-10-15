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
