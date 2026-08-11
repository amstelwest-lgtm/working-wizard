/**
 * Documents Gap 3 Option A — firm writers vs invited members vs owner-only columns.
 * Pure predicate / column-guard checks (no live DB required).
 *
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/firm-update-rls-test.mts
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Mirrors is_client_writer predicate. */
function isClientWriter(opts: {
  userId: string;
  ownerUserId: string;
  firmId: string | null;
  isFirmMember: boolean;
}): boolean {
  if (opts.userId === opts.ownerUserId) return true;
  if (opts.firmId != null && opts.isFirmMember) return true;
  return false;
}

/** Mirrors clients_guard_owner_only_columns for non-owners. */
function firmMayChangeColumn(column: string): boolean {
  const ownerOnly = new Set([
    "id",
    "created_at",
    "owner_user_id",
    "firm_id",
    "last_login_at",
  ]);
  return !ownerOnly.has(column);
}

const owner = "owner-1";
const firmUser = "firm-1";
const member = "member-1";
const firmId = "firm-a";

assert(
  isClientWriter({ userId: owner, ownerUserId: owner, firmId, isFirmMember: false }),
  "owner writes",
);
assert(
  isClientWriter({ userId: firmUser, ownerUserId: owner, firmId, isFirmMember: true }),
  "firm member writes",
);
assert(
  !isClientWriter({ userId: member, ownerUserId: owner, firmId, isFirmMember: false }),
  "invited member blocked",
);
assert(
  !isClientWriter({ userId: firmUser, ownerUserId: owner, firmId: null, isFirmMember: true }),
  "no firm_id → firm member blocked",
);

for (const col of [
  "financials",
  "financials_updated_at",
  "cashflow",
  "cashflow_bank_draft",
  "cash_runway_weeks",
  "last_forecast_at",
  "budget",
  "budget_updated_at",
  "financial_year_start_month",
  "operating_profile",
  "business_type",
  "contact_email",
  "contact_phone",
  "reports_issued_count",
  "name",
  "open_queries_count",
]) {
  assert(firmMayChangeColumn(col), `firm may change ${col}`);
}

for (const col of ["id", "created_at", "owner_user_id", "firm_id", "last_login_at"]) {
  assert(!firmMayChangeColumn(col), `firm may NOT change ${col}`);
}

console.log("firm-update-rls-test: ok");
