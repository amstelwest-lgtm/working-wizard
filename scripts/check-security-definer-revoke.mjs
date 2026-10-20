// New migrations that create a SECURITY DEFINER function must revoke
// EXECUTE from anon or PUBLIC in the same file. Historical migrations are
// exempt; the cutoff is the privilege-lock migration itself.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
export const CUTOFF = "20261020160000";

const LOCK = join(
  migrationsDir,
  "20261020160000_revoke_anon_function_execute.sql",
);

/** Signatures the lock migration must name. Mirrors advisor 0028 on 2026-10-20. */
export const LOCKED_SIGNATURES = [
  ["public.acknowledge_advisory_delivery(text)", "anon"],
  ["public.action_item_sync_recommendation_link()", "authenticated"],
  ["public.action_item_tenant_check()", "authenticated"],
  ["public.actor_is_partner(uuid,uuid)", "authenticated"],
  ["public.advisory_actor_kind(uuid)", "authenticated"],
  ["public.advisory_deliveries_guard_update()", "authenticated"],
  ["public.advisory_trg_action_items()", "authenticated"],
  ["public.advisory_trg_brain_questions()", "authenticated"],
  ["public.advisory_trg_clients()", "authenticated"],
  ["public.advisory_trg_data_requests()", "authenticated"],
  ["public.advisory_trg_next_steps()", "authenticated"],
  ["public.advisory_trg_outcomes()", "authenticated"],
  ["public.advisory_trg_packs()", "authenticated"],
  ["public.advisory_trg_signoffs()", "authenticated"],
  ["public.advisory_trg_snapshots()", "authenticated"],
  ["public.agent_enqueue_on_statement_upload()", "authenticated"],
  ["public.agent_messages_route()", "authenticated"],
  ["public.can_sign_off_deliverable(uuid,uuid)", "authenticated"],
  ["public.client_notes_guard_update()", "authenticated"],
  ["public.client_review_signoffs_history_mirror()", "authenticated"],
  ["public.clients_guard_owner_only_columns()", "authenticated"],
  ["public.create_firm_client(text,uuid,text,jsonb)", "authenticated"],
  ["public.data_request_defaults()", "authenticated"],
  ["public.data_requests_fulfil(uuid,text[],jsonb,uuid)", "authenticated"],
  ["public.data_requests_sync(uuid,jsonb)", "authenticated"],
  ["public.data_requests_trg_client()", "authenticated"],
  ["public.data_requests_trg_snapshot()", "authenticated"],
  ["public.delete_email(text,bigint)", "service"],
  ["public.delete_own_account()", "authenticated"],
  ["public.effective_practice_classification(uuid,uuid)", "authenticated"],
  ["public.enforce_client_review_signoff_identity()", "authenticated"],
  ["public.enqueue_email(text,jsonb)", "service"],
  ["public.ensure_client_practice_employee(uuid,uuid,text)", "service"],
  ["public.ensure_own_client(text,jsonb)", "authenticated"],
  ["public.ensure_practice_firm(text,jsonb)", "authenticated"],
  ["public.find_nudge_candidates(timestamp with time zone)", "service"],
  ["public.firm_has_partner(uuid,uuid)", "authenticated"],
  ["public.grant_practice_principal_access(uuid,uuid)", "service"],
  ["public.handle_new_user()", "authenticated"],
  ["public.has_active_practice_assignment(uuid,uuid)", "authenticated"],
  ["public.has_client_access(uuid,uuid)", "authenticated"],
  ["public.has_role(uuid,public.app_role)", "authenticated"],
  ["public.is_action_plan_writer(uuid,uuid)", "authenticated"],
  ["public.is_client_writer(uuid,uuid)", "authenticated"],
  ["public.is_firm_manager(uuid,uuid)", "authenticated"],
  ["public.is_firm_member(uuid,uuid)", "authenticated"],
  ["public.is_milon_it_member(uuid)", "authenticated"],
  ["public.is_practice_principal(uuid,uuid)", "authenticated"],
  ["public.list_client_practice_team(uuid)", "authenticated"],
  ["public.list_note_collaborators(uuid)", "authenticated"],
  ["public.mint_accountant_invite(uuid,text)", "authenticated"],
  ["public.mint_owner_invite(uuid)", "authenticated"],
  ["public.move_to_dlq(text,text,bigint,jsonb)", "service"],
  ["public.preview_advisory_delivery_ack(text)", "anon"],
  ["public.read_email_batch(text,integer,integer)", "service"],
  ["public.recommendation_default_cycle()", "authenticated"],
  ["public.recommendation_outcome_defaults()", "authenticated"],
  ["public.recommendation_stamp_decision()", "authenticated"],
  ["public.team_practice_classification(uuid,uuid)", "authenticated"],
  ["public.trg_clients_firm_connect()", "authenticated"],
  ["public.trg_clients_firm_connect_audit()", "authenticated"],
  ["public.trg_clients_grant_principal_access()", "authenticated"],
  ["public.trg_deliverable_state_caps()", "authenticated"],
  ["public.trg_firm_membership_grant_principal_access()", "authenticated"],
  ["public.trg_firm_memberships_partner_guard()", "authenticated"],
  ["public.trg_practice_access_ceiling()", "authenticated"],
  ["public.write_audit_log(text,uuid,uuid,uuid,jsonb,uuid)", "authenticated"],
];

export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * @param {string} sql
 * @returns {string[]} names of SECURITY DEFINER functions that lack a revoke
 */
export function securityDefinerFunctionsMissingRevoke(sql) {
  const stripped = stripSqlComments(sql);
  const starts = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:(?:public|analytics)\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match;
  while ((match = re.exec(stripped))) {
    starts.push({ name: match[1], index: match.index });
  }
  const missing = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = stripped.slice(starts[i].index, starts[i + 1]?.index ?? stripped.length);
    if (!/\bsecurity\s+definer\b/i.test(chunk)) continue;
    const name = starts[i].name;
    const named = new RegExp(
      `revoke\\s+(?:execute|all)\\s+on\\s+function\\s+(?:(?:public|analytics)\\.)?${name}\\b`,
      "i",
    );
    const blanket =
      /revoke\s+(?:execute|all)\s+on\s+all\s+functions\s+in\s+schema\s+public\s+from\s+[^;]*\b(?:public|anon)\b/i;
    if (!named.test(stripped) && !blanket.test(stripped)) missing.push(name);
  }
  return missing;
}

export function stampOf(filename) {
  const match = filename.match(/^(\d{14})_/);
  return match ? match[1] : null;
}

/** @param {string[]} filenames @param {(name: string) => string} read */
export function migrationsMissingRevoke(filenames, read) {
  const problems = [];
  for (const name of filenames) {
    const stamp = stampOf(name);
    if (!stamp || stamp <= CUTOFF) continue;
    const missing = securityDefinerFunctionsMissingRevoke(read(name));
    for (const fn of missing) problems.push(`${name}: ${fn}`);
  }
  return problems;
}

/** @param {string} sql */
export function lockEntries(sql) {
  const out = [];
  const re = /\('((?:public|analytics)\.[^']+)',\s*'(anon|authenticated|service)'\)/g;
  let match;
  while ((match = re.exec(sql))) out.push([match[1], match[2]]);
  return out;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function selfTest() {
  const bad = `
    CREATE FUNCTION public.leak()
    RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
  `;
  assert(
    securityDefinerFunctionsMissingRevoke(bad).includes("leak"),
    "fixture without REVOKE should fail",
  );

  const good = `
    CREATE FUNCTION public.kept(p int)
    RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT p $$;
    REVOKE EXECUTE ON FUNCTION public.kept(int) FROM PUBLIC, anon;
  `;
  assert(
    securityDefinerFunctionsMissingRevoke(good).length === 0,
    "explicit REVOKE should pass",
  );

  const commented = `
    -- CREATE FUNCTION public.ghost() LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.plain() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
  `;
  assert(
    securityDefinerFunctionsMissingRevoke(commented).length === 0,
    "comments and invoker functions should not fail",
  );

  const blanket = `
    CREATE FUNCTION public.a() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.b() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;
  `;
  assert(
    securityDefinerFunctionsMissingRevoke(blanket).length === 0,
    "schema-wide REVOKE should pass",
  );

  const problems = migrationsMissingRevoke(
    ["20200101000000_old.sql", "20261020160001_new.sql"],
    (name) => (name.endsWith("new.sql") ? bad : bad),
  );
  assert(
    problems.length === 1 && problems[0].startsWith("20261020160001"),
    "cutoff should ignore historical migrations",
  );
}

function checkLockMigration() {
  const sql = readFileSync(LOCK, "utf8");
  const found = lockEntries(sql);
  const expected = LOCKED_SIGNATURES;
  const foundKey = found.map(([sig, mode]) => `${sig} ${mode}`).sort();
  const expectedKey = expected.map(([sig, mode]) => `${sig} ${mode}`).sort();
  if (foundKey.join("\n") !== expectedKey.join("\n")) {
    const missing = expectedKey.filter((row) => !foundKey.includes(row));
    const extra = foundKey.filter((row) => !expectedKey.includes(row));
    throw new Error(
      `lock migration catalog drifted\nmissing:\n${missing.join("\n")}\nextra:\n${extra.join("\n")}`,
    );
  }
  const anon = found.filter(([, mode]) => mode === "anon").map(([sig]) => sig);
  if (anon.length !== 2) {
    throw new Error(`expected 2 anon keeps, found ${anon.join(", ")}`);
  }
}

function main() {
  selfTest();
  checkLockMigration();
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  const problems = migrationsMissingRevoke(names, (name) =>
    readFileSync(join(migrationsDir, name), "utf8"),
  );
  if (problems.length) {
    console.error("SECURITY DEFINER function without REVOKE EXECUTE FROM anon/PUBLIC:");
    for (const row of problems) console.error(`  ${row}`);
    process.exit(1);
  }
  console.log(
    `security-definer revoke check ok (${LOCKED_SIGNATURES.length} locked functions, cutoff ${CUTOFF})`,
  );
}

main();
