/**
 * Controllable firm read for the cold client-file gate.
 * The test imports this module through the same alias the app uses.
 */

export const FIRM_LOAD_USER_ID = "33333333-3333-4333-8333-333333333333";
export const FIRM_LOAD_FIRM_ID = "e8f7a440-a541-422c-8e4f-82ba33dd0604";
export const FIRM_LOAD_FIRST_CLIENT_ID = "660f2396-1111-4111-8111-111111111111";
/** Later client file. The first file is allowed to open; this one is not. */
export const FIRM_LOAD_SECOND_CLIENT_ID = "8836b9f8-2222-4222-8222-222222222222";

export type FirmReadMode = "hang" | "throw" | "ok";

let mode: FirmReadMode = "hang";
let reads = 0;

export function setFirmReadMode(next: FirmReadMode): void {
  mode = next;
}

export function firmReadCount(): number {
  return reads;
}

export function resetFirmReads(): void {
  reads = 0;
}

function firmRow() {
  return {
    id: FIRM_LOAD_FIRM_ID,
    name: "Practice",
    owner_user_id: FIRM_LOAD_USER_ID,
    referral_code: null,
    logo_url: null,
    accent_color: null,
    primary_color: "#102A43",
    secondary_color: null,
    tagline: null,
    brand_contact_name: null,
    brand_contact_email: null,
    brand_updated_at: null,
    market: { country: "US", region: "NY", regionCode: "NY" },
  };
}

type QueryResult = { data: unknown; error: { message: string } | null };

function resultFor(table: string): Promise<QueryResult> {
  if (table === "firms") {
    reads += 1;
    if (mode === "hang") return new Promise(() => {});
    if (mode === "throw") return Promise.reject(new Error("firm read failed"));
    return Promise.resolve({ data: [firmRow()], error: null });
  }
  if (table === "firm_memberships") return Promise.resolve({ data: [], error: null });
  if (table === "profiles") return Promise.resolve({ data: { full_name: null }, error: null });
  if (table === "user_roles") {
    return Promise.resolve({ data: [{ role: "firm_admin" }], error: null });
  }
  if (table === "clients") {
    return Promise.resolve({
      data: [{ id: FIRM_LOAD_FIRST_CLIENT_ID }, { id: FIRM_LOAD_SECOND_CLIENT_ID }],
      error: null,
    });
  }
  return Promise.resolve({ data: [], error: null });
}

function chain(table: string) {
  let pending: Promise<QueryResult> | null = null;
  const run = () => {
    if (!pending) pending = resultFor(table);
    return pending;
  };
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    not: () => query,
    in: () => query,
    limit: () => query,
    abortSignal: () => query,
    maybeSingle: () => run(),
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => run().then(onFulfilled, onRejected),
  };
  return query;
}

export const supabase = {
  from(table: string) {
    return chain(table);
  },
  rpc: async () => ({ data: false, error: null }),
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
  },
};
