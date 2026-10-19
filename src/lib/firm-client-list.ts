/**
 * Firm client list for the feature finder.
 *
 * Same scope as the practice dashboard load (`dashboard.tsx`): the signed-in
 * firm's clients, plus legacy rows that still have a null firm_id and are
 * owned by this user. The browser Supabase client applies RLS
 * (`has_client_access`); this is not a service-role read.
 *
 * Duplicate display names need a readable detail. The slim row carries the
 * contact email, the created day, and any company name already on the
 * statements. Ledger company names and the owner's profile email are read
 * only for the rows that still share a name.
 */
import { supabase } from "@/integrations/supabase/client";
import { businessNameFromFinancials } from "@/lib/client-display-name";
import { finderBusinessName, type FinderClient } from "@/lib/feature-finder-clients";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST `or` filter copied from the dashboard client query. */
export function firmClientOrFilter(firmId: string, userId: string): string {
  return `firm_id.eq.${firmId},and(firm_id.is.null,owner_user_id.eq.${userId})`;
}

type ListedClient = {
  id: string;
  name: string;
  clientCode: string | null;
  ownerUserId: string | null;
  contactEmail: string | null;
  createdAt: string | null;
  statementName: string | null;
  ledgerNames: string[];
  profileEmail: string | null;
};

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text || null;
}

async function ledgerNames(
  table: "xero_connections" | "qbo_connections" | "sage_connections",
  column: "tenant_name" | "company_name",
  ids: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from(table)
      .select(column === "tenant_name" ? "client_id, tenant_name" : "client_id, company_name")
      .in("client_id", ids);
    if (error || !data) return out;
    for (const row of data) {
      const id = typeof row.client_id === "string" ? row.client_id : "";
      const raw = column === "tenant_name" ? row.tenant_name : row.company_name;
      const name = typeof raw === "string" ? clean(raw) : null;
      if (!id || !name) continue;
      const list = out.get(id) ?? [];
      list.push(name);
      out.set(id, list);
    }
  } catch {
    /* a missing ledger is not a reason to hide the palette */
  }
  return out;
}

async function profileEmails(ownerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ownerIds.length === 0) return out;
  try {
    const { data, error } = await supabase.from("profiles").select("id, email").in("id", ownerIds);
    if (error || !data) return out;
    for (const row of data) {
      const email = clean(row.email);
      if (row.id && email) out.set(row.id, email);
    }
  } catch {
    /* profiles RLS only returns the signed-in user; contact email still works */
  }
  return out;
}

function toFinderClient(row: ListedClient): FinderClient {
  const businessName = finderBusinessName(row.name, [row.statementName, ...row.ledgerNames]);
  const ownerEmail = row.profileEmail || row.contactEmail;
  return {
    id: row.id,
    name: row.name,
    clientCode: row.clientCode,
    businessName,
    ownerEmail,
    createdAt: row.createdAt,
  };
}

export async function listFirmClients(input: {
  userId: string;
  firmId: string | null;
}): Promise<FinderClient[]> {
  const userId = input.userId.trim();
  const firmId = input.firmId?.trim() || null;
  if (!UUID_RE.test(userId)) return [];
  if (firmId && !UUID_RE.test(firmId)) return [];

  try {
    let query = supabase
      .from("clients")
      .select("id, name, client_code, contact_email, created_at, owner_user_id, financials")
      .order("created_at", { ascending: false });
    if (firmId) {
      query = query.or(firmClientOrFilter(firmId, userId));
    } else {
      query = query.eq("owner_user_id", userId);
    }
    const { data, error } = await query;
    if (error) {
      console.error("feature finder clients:", error.message);
      return [];
    }
    const rows: ListedClient[] = [];
    for (const row of data ?? []) {
      const name = row.name?.trim();
      if (!row.id || !name) continue;
      rows.push({
        id: row.id,
        name,
        clientCode: clean(row.client_code),
        ownerUserId: clean(row.owner_user_id),
        contactEmail: clean(row.contact_email),
        createdAt: clean(row.created_at),
        statementName: businessNameFromFinancials(row.financials),
        ledgerNames: [],
        profileEmail: null,
      });
    }

    const nameCounts = new Map<string, number>();
    for (const row of rows) {
      const key = row.name.toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const pending = rows.filter((row) => {
      if ((nameCounts.get(row.name.toLowerCase()) ?? 0) < 2) return false;
      return !finderBusinessName(row.name, [row.statementName]);
    });
    if (pending.length > 0) {
      const ids = pending.map((row) => row.id);
      const ownerIds = [...new Set(pending.map((row) => row.ownerUserId).filter((id): id is string => Boolean(id)))];
      const [xero, qbo, sage, emails] = await Promise.all([
        ledgerNames("xero_connections", "tenant_name", ids),
        ledgerNames("qbo_connections", "company_name", ids),
        ledgerNames("sage_connections", "company_name", ids),
        profileEmails(ownerIds),
      ]);
      for (const row of pending) {
        row.ledgerNames = [
          ...(xero.get(row.id) ?? []),
          ...(qbo.get(row.id) ?? []),
          ...(sage.get(row.id) ?? []),
        ];
        row.profileEmail = (row.ownerUserId && emails.get(row.ownerUserId)) || null;
      }
    }

    return rows.map(toFinderClient);
  } catch (err) {
    console.error("feature finder clients:", err);
    return [];
  }
}
