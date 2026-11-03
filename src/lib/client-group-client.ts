/**
 * Browser reads and group RPCs. A missing migration hides group UI; it does
 * not break a single-company book.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  billableCompanyCount,
  groupChromeVisible,
  isEntityType,
  type EntityType,
} from "@/lib/client-groups";

type LooseResult = { data: unknown; error: { message?: string } | null };

type LooseChain = {
  select: (columns: string) => LooseChain;
  eq: (column: string, value: string) => LooseChain;
  in: (column: string, value: string[]) => LooseChain;
  order: (column: string, options?: { ascending: boolean }) => LooseChain;
  maybeSingle: () => Promise<LooseResult>;
  then: PromiseLike<LooseResult>["then"];
};

type LooseDb = {
  from: (table: string) => LooseChain;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<LooseResult>;
};

function db(): LooseDb {
  return supabase as unknown as LooseDb;
}

export function missingGroupSchema(message: string): boolean {
  return /group_id|client_groups|ownership_edges|schema cache|does not exist|Could not find/i.test(
    message,
  );
}

export type GroupCompany = {
  id: string;
  name: string;
  groupId: string;
  entityType: EntityType;
  yearEndMonth: number | null;
  currency: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  vatNumber: string | null;
  personUserId: string | null;
  placeholder: boolean;
  booksConnectedAt: string | null;
  dataUploadedAt: string | null;
  openQueries: number;
  firmId: string | null;
};

export type GroupNav = {
  id: string;
  name: string;
  companies: { id: string; name: string }[];
  billable: number;
};

const COMPANY_COLUMNS = [
  "id",
  "name",
  "group_id",
  "entity_type",
  "year_end_month",
  "currency",
  "registration_number",
  "tax_number",
  "vat_number",
  "person_user_id",
  "placeholder",
  "books_connected_at",
  "data_uploaded_at",
  "open_queries_count",
  "firm_id",
].join(", ");

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCompany(row: Record<string, unknown>): GroupCompany | null {
  const id = text(row.id);
  const name = text(row.name);
  const groupId = text(row.group_id);
  if (!id || !name || !groupId) return null;
  const entity = text(row.entity_type);
  return {
    id,
    name,
    groupId,
    entityType: isEntityType(entity) ? entity : "company",
    yearEndMonth: typeof row.year_end_month === "number" ? row.year_end_month : null,
    currency: text(row.currency),
    registrationNumber: text(row.registration_number),
    taxNumber: text(row.tax_number),
    vatNumber: text(row.vat_number),
    personUserId: text(row.person_user_id),
    placeholder: row.placeholder === true,
    booksConnectedAt: text(row.books_connected_at),
    dataUploadedAt: text(row.data_uploaded_at),
    openQueries: typeof row.open_queries_count === "number" ? row.open_queries_count : 0,
    firmId: text(row.firm_id),
  };
}

async function readRows(
  query: PromiseLike<LooseResult>,
): Promise<Record<string, unknown>[] | null> {
  const result = await query;
  if (result.error) {
    if (missingGroupSchema(result.error.message ?? "")) return null;
    return [];
  }
  if (!Array.isArray(result.data)) return [];
  return result.data.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
}

export async function loadCompanies(clientIds?: readonly string[]): Promise<GroupCompany[] | null> {
  const chain = db().from("clients").select(COMPANY_COLUMNS);
  const filtered = clientIds && clientIds.length > 0 ? chain.in("id", [...clientIds]) : chain;
  const rows = await readRows(filtered);
  if (rows == null) return null;
  return rows.map(asCompany).filter((row): row is GroupCompany => row != null);
}

export async function loadGroupNames(groupIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (groupIds.length === 0) return names;
  const rows = await readRows(
    db()
      .from("client_groups")
      .select("id, name")
      .in("id", [...groupIds]),
  );
  for (const row of rows ?? []) {
    const id = text(row.id);
    const name = text(row.name);
    if (id && name) names.set(id, name);
  }
  return names;
}

export function companiesToNav(
  companies: readonly GroupCompany[],
  names: ReadonlyMap<string, string>,
  options?: { includeSingles?: boolean },
): GroupNav[] {
  const byGroup = new Map<string, GroupCompany[]>();
  for (const company of companies) {
    const list = byGroup.get(company.groupId) ?? [];
    list.push(company);
    byGroup.set(company.groupId, list);
  }
  const nav: GroupNav[] = [];
  for (const [id, list] of byGroup) {
    if (!options?.includeSingles && !groupChromeVisible(list.length)) continue;
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    nav.push({
      id,
      name: names.get(id) ?? sorted[0]?.name ?? "Group",
      companies: sorted.map((company) => ({ id: company.id, name: company.name })),
      billable: billableCompanyCount(sorted),
    });
  }
  return nav.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadRailGroups(
  clientIds?: readonly string[],
  options?: { includeSingles?: boolean },
): Promise<GroupNav[]> {
  const companies = await loadCompanies(clientIds);
  if (!companies) return [];
  const names = await loadGroupNames([...new Set(companies.map((company) => company.groupId))]);
  return companiesToNav(companies, names, options);
}

/** Current client's group, including a group of one (Group status / Add company entry). */
export async function loadClientGroupNav(clientId: string): Promise<GroupNav | null> {
  const companies = await loadCompanies();
  if (!companies) return null;
  const company = companies.find((row) => row.id === clientId);
  if (!company) return null;
  const inGroup = companies.filter((row) => row.groupId === company.groupId);
  const names = await loadGroupNames([company.groupId]);
  const nav = companiesToNav(inGroup, names, { includeSingles: true });
  return nav[0] ?? null;
}

export type OwnershipEdgeRow = {
  id: string;
  holderClientId: string;
  heldClientId: string;
  ownershipPct: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  classification: string;
};

export async function loadOwnershipEdges(groupId: string): Promise<OwnershipEdgeRow[]> {
  const rows = await readRows(
    db()
      .from("ownership_edges")
      .select(
        "id, holder_client_id, held_client_id, ownership_pct, effective_from, effective_to, classification",
      )
      .eq("group_id", groupId),
  );
  return (rows ?? []).flatMap((row) => {
    const id = text(row.id);
    const holder = text(row.holder_client_id);
    const held = text(row.held_client_id);
    if (!id || !holder || !held) return [];
    return [
      {
        id,
        holderClientId: holder,
        heldClientId: held,
        ownershipPct: typeof row.ownership_pct === "number" ? row.ownership_pct : null,
        effectiveFrom: text(row.effective_from),
        effectiveTo: text(row.effective_to),
        classification: text(row.classification) ?? "subsidiary",
      },
    ];
  });
}

export type GroupMember = { userId: string; role: string };

export async function loadGroupMembers(groupId: string): Promise<GroupMember[]> {
  const rows = await readRows(
    db().from("client_group_members").select("user_id, role").eq("group_id", groupId),
  );
  return (rows ?? []).flatMap((row) => {
    const userId = text(row.user_id);
    if (!userId) return [];
    return [{ userId, role: text(row.role) ?? "owner" }];
  });
}

export type GroupAuditRow = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string | null;
};

export async function loadGroupAudit(groupId: string): Promise<GroupAuditRow[]> {
  const rows = await readRows(
    db()
      .from("client_group_audit")
      .select("id, action, detail, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []).slice(0, 8).flatMap((row) => {
    const id = text(row.id);
    const action = text(row.action);
    if (!id || !action) return [];
    return [
      {
        id,
        action,
        detail:
          row.detail && typeof row.detail === "object"
            ? (row.detail as Record<string, unknown>)
            : {},
        createdAt: text(row.created_at),
      },
    ];
  });
}

export async function loadSyncRows(
  clientIds: readonly string[],
): Promise<
  Map<
    string,
    { syncStatus: string | null; syncError: string | null; lastSyncedAt: string | null }[]
  >
> {
  const out = new Map<
    string,
    { syncStatus: string | null; syncError: string | null; lastSyncedAt: string | null }[]
  >();
  if (clientIds.length === 0) return out;
  const tables = ["xero_connections", "qbo_connections", "sage_connections"] as const;
  for (const table of tables) {
    const rows = await readRows(
      db()
        .from(table)
        .select("client_id, sync_status, sync_error, last_synced_at")
        .in("client_id", [...clientIds]),
    );
    for (const row of rows ?? []) {
      const clientId = text(row.client_id);
      if (!clientId) continue;
      const list = out.get(clientId) ?? [];
      list.push({
        syncStatus: text(row.sync_status),
        syncError: text(row.sync_error),
        lastSyncedAt: text(row.last_synced_at),
      });
      out.set(clientId, list);
    }
  }
  return out;
}

export async function callGroupRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  const result = await db().rpc(fn, args);
  if (result.error) return { data: null, error: result.error.message ?? "Request failed" };
  return { data: result.data, error: null };
}
