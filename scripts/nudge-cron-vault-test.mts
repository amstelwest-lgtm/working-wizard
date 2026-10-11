/**
 * Nudge cron must not store a service-role JWT in cron.job.command.
 * Run: pnpm test:nudge-cron-vault
 *
 * 20260805000000_nudge_action_items.sql formats the key in at schedule time.
 * 20261012180000_nudge_cron_vault_runtime.sql replaces that helper and re-points
 * the existing job. Applied history is left as-is (checksums).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/**
 * Migrations that already contain a literal JWT (eyJ…) inside a cron command.
 * Leave these in place: editing an applied migration changes its checksum.
 * 20260805000000_nudge_action_items.sql is intentionally not listed. It
 * interpolates the key at schedule time via format(%L) and contains no literal
 * eyJ. The vault-runtime migration replaces that helper.
 * Do not add a file here to silence a new leak.
 */
const HISTORICAL_CRON_JWT_ALLOWLIST: readonly string[] = [];

const JWT_LOOKING = /eyJ[A-Za-z0-9_-]{8,}/g;

const MIGRATIONS_DIR = resolve("supabase/migrations");
const VAULT_MIGRATION = "20261012180000_nudge_cron_vault_runtime.sql";
const EMBEDDING_MIGRATION = "20260805000000_nudge_action_items.sql";

type Container = { kind: "fn" | "do"; name: string; start: number; end: number; text: string };

function isIdentChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_]/.test(ch));
}

/** Drop -- and block comments. Dollar-quoted and single-quoted text stays. */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const dollar = matchDollarTag(sql, i);
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      const next = end + dollar.length;
      out += sql.slice(i, next);
      i = next;
      continue;
    }
    if (sql[i] === "'") {
      const next = skipSingleQuoted(sql, i);
      out += sql.slice(i, next);
      i = next;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      out += " ";
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function matchDollarTag(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  let j = i + 1;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
  if (sql[j] !== "$") return null;
  return sql.slice(i, j + 1);
}

function skipSingleQuoted(sql: string, i: number): number {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "'" && sql[j + 1] === "'") {
      j += 2;
      continue;
    }
    if (sql[j] === "'") return j + 1;
    j += 1;
  }
  return sql.length;
}

function skipString(sql: string, i: number): number {
  const dollar = matchDollarTag(sql, i);
  if (dollar) {
    const end = sql.indexOf(dollar, i + dollar.length);
    return end === -1 ? sql.length : end + dollar.length;
  }
  if (sql[i] === "'") return skipSingleQuoted(sql, i);
  return i;
}

function extractBalancedCall(sql: string, nameAt: number): { start: number; end: number; text: string } | null {
  const open = sql.indexOf("(", nameAt);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  while (i < sql.length) {
    const next = skipString(sql, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        const end = i + 1;
        return { start: nameAt, end, text: sql.slice(nameAt, end) };
      }
    }
    i += 1;
  }
  return null;
}

function findCalls(sql: string, name: string): { start: number; end: number; text: string }[] {
  const calls: { start: number; end: number; text: string }[] = [];
  let from = 0;
  while (from < sql.length) {
    const at = sql.indexOf(name, from);
    if (at === -1) break;
    const before = at === 0 ? "" : sql[at - 1];
    const after = sql[at + name.length];
    if (!isIdentChar(before) && !isIdentChar(after)) {
      const call = extractBalancedCall(sql, at);
      if (call) {
        calls.push(call);
        from = call.end;
        continue;
      }
    }
    from = at + name.length;
  }
  return calls;
}

function functionContainers(sql: string): Container[] {
  const out: Container[] = [];
  const header = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+((?:public\.)?[a-zA-Z_][\w]*)\s*\(/gi;
  for (const match of sql.matchAll(header)) {
    const name = (match[1] ?? "").split(".").pop() ?? "";
    const asAt = sql.slice(match.index ?? 0).search(/\bAS\s+\$/i);
    if (asAt === -1) continue;
    const dollarAt = (match.index ?? 0) + asAt + sql.slice((match.index ?? 0) + asAt).indexOf("$");
    const tag = matchDollarTag(sql, dollarAt);
    if (!tag) continue;
    const close = sql.indexOf(tag, dollarAt + tag.length);
    if (close === -1) continue;
    const end = close + tag.length;
    out.push({ kind: "fn", name, start: match.index ?? 0, end, text: sql.slice(match.index ?? 0, end) });
  }
  return out;
}

function doContainers(sql: string): Container[] {
  const out: Container[] = [];
  const header = /\bDO\s+\$/gi;
  for (const match of sql.matchAll(header)) {
    const dollarAt = (match.index ?? 0) + match[0].length - 1;
    const tag = matchDollarTag(sql, dollarAt);
    if (!tag) continue;
    const close = sql.indexOf(tag, dollarAt + tag.length);
    if (close === -1) continue;
    const end = close + tag.length;
    out.push({ kind: "do", name: "", start: match.index ?? 0, end, text: sql.slice(match.index ?? 0, end) });
  }
  return out;
}

/** Text that becomes, or builds, a cron command. Includes the enclosing function or DO block. */
export function cronCommandRegions(sql: string): string[] {
  const stripped = stripSqlComments(sql);
  const functions = functionContainers(stripped);
  const blocks = [...functions, ...doContainers(stripped)];
  const calls = [...findCalls(stripped, "cron.schedule"), ...findCalls(stripped, "cron.alter_job")];
  return calls.map((call) => {
    const container = blocks.find((block) => call.start >= block.start && call.end <= block.end);
    const referenced = functions.filter((fn) => new RegExp(`\\b${fn.name}\\s*\\(`, "i").test(call.text));
    return [call.text, container?.text ?? "", ...referenced.map((fn) => fn.text)].filter(Boolean).join("\n");
  });
}

export function inlinedCronJwts(sql: string): string[] {
  const hits = new Set<string>();
  for (const region of cronCommandRegions(sql)) {
    for (const match of region.matchAll(JWT_LOOKING)) {
      if (match[0]) hits.add(match[0]);
    }
  }
  return [...hits];
}

export type MigrationFile = { name: string; sql: string };

export function migrationsWithInlinedCronJwt(
  files: readonly MigrationFile[],
  allowlist: readonly string[] = HISTORICAL_CRON_JWT_ALLOWLIST,
): { name: string; sample: string }[] {
  const allowed = new Set(allowlist);
  const found: { name: string; sample: string }[] = [];
  for (const file of files) {
    if (allowed.has(file.name)) continue;
    const hits = inlinedCronJwts(file.sql);
    if (hits.length) found.push({ name: file.name, sample: hits[0] });
  }
  return found;
}

function latestFunction(files: readonly MigrationFile[], fnName: string): { name: string; body: string } | null {
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  let latest: { name: string; body: string } | null = null;
  for (const file of ordered) {
    const bodies = functionContainers(stripSqlComments(file.sql)).filter((fn) => fn.name === fnName);
    if (bodies.length) latest = { name: file.name, body: bodies[bodies.length - 1].text };
  }
  return latest;
}

const badLiteral = `
CREATE OR REPLACE FUNCTION public.schedule_nudge_job()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cron.schedule(
    'nudge-action-items',
    '0 8 * * *',
    $cmd$SELECT net.http_post(headers := '{"Authorization":"Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig"}')$cmd$
  );
END $$;
`;
assert(inlinedCronJwts(badLiteral).length === 1, "a literal eyJ… inside cron.schedule is a hit");

const badAlter = `
SELECT cron.alter_job(job_id := 1, command := 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig');
`;
assert(inlinedCronJwts(badAlter).length === 1, "a literal eyJ… inside cron.alter_job is a hit");

const formattedKey = `
CREATE OR REPLACE FUNCTION schedule_nudge_job() RETURNS text AS $$
BEGIN
  PERFORM cron.schedule('nudge-action-items', '0 8 * * *', format('Bearer %L', v_service_role_key));
END $$;
`;
assert(inlinedCronJwts(formattedKey).length === 0, "format(%L) without a literal JWT is not a hit");

const allowProbe = migrationsWithInlinedCronJwt(
  [{ name: "old.sql", sql: badLiteral }],
  ["old.sql"],
);
assert(allowProbe.length === 0, "an explicit allow-list entry skips that historical file");
assert(
  migrationsWithInlinedCronJwt([{ name: "new.sql", sql: badLiteral }], ["old.sql"]).length === 1,
  "a file that is not allow-listed still fails",
);

const files: MigrationFile[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8") }));

assert(files.some((file) => file.name === EMBEDDING_MIGRATION), "the original nudge migration is still present");
assert(files.some((file) => file.name === VAULT_MIGRATION), "the vault-runtime migration is present");

const leaks = migrationsWithInlinedCronJwt(files);
assert(
  leaks.length === 0,
  `migration inlines a JWT in a cron command:\n${leaks.map((hit) => `  ${hit.name}: ${hit.sample}`).join("\n")}`,
);

const embedding = files.find((file) => file.name === EMBEDDING_MIGRATION);
assert(Boolean(embedding), "embedding migration loaded");
assert(
  inlinedCronJwts(embedding?.sql ?? "").length === 0,
  "the original nudge migration has no literal JWT, so it stays off the allow-list",
);
assert(
  /cron\.unschedule\('nudge-action-items'\)/.test(embedding?.sql ?? ""),
  "the original helper unschedules before rewriting the command",
);
assert(
  /%L[\s\S]*v_service_role_key/.test(embedding?.sql ?? ""),
  "the original helper formats the service-role key into the command",
);

const latest = latestFunction(files, "schedule_nudge_job");
assert(latest?.name === VAULT_MIGRATION, "the vault-runtime migration is the latest schedule_nudge_job");
assert(latest?.body.includes("public.nudge_cron_command()"), "the helper stores the vault-runtime command");
assert(!latest?.body.includes("v_service_role_key"), "the helper no longer reads the key into a local");
assert(!/format\s*\(/.test(latest?.body ?? ""), "the helper no longer formats the command");
assert(!/cron\.unschedule/.test(latest?.body ?? ""), "the helper does not drop the job and mint a new id");
assert(/cron\.alter_job/.test(latest?.body ?? ""), "an existing job is re-pointed in place");
assert(/IF v_jobid IS NULL/.test(latest?.body ?? ""), "a missing job is created once");
assert(/email_queue_service_role_key/.test(latest?.body ?? ""), "the helper still requires the key secret");
assert(/supabase_project_url/.test(latest?.body ?? ""), "the helper still requires the project URL");

const vault = files.find((file) => file.name === VAULT_MIGRATION)?.sql ?? "";
assert(/CREATE OR REPLACE FUNCTION public\.nudge_cron_command\(\)/.test(vault), "nudge_cron_command is replaceable");
assert(
  /vault\.decrypted_secrets WHERE name = 'supabase_project_url'/.test(vault),
  "the stored command reads the project URL at run time",
);
assert(
  /vault\.decrypted_secrets WHERE name = 'email_queue_service_role_key'/.test(vault),
  "the stored command reads the service-role key at run time",
);
assert(/nudge-action-items/.test(vault), "the command still targets nudge-action-items");
assert(/REVOKE ALL ON FUNCTION public\.schedule_nudge_job\(\) FROM PUBLIC, anon, authenticated/.test(vault), "execute is service_role only");
assert(/GRANT EXECUTE ON FUNCTION public\.schedule_nudge_job\(\) TO service_role/.test(vault), "service_role can re-point the job");
assert(
  !/GRANT EXECUTE ON FUNCTION public\.schedule_nudge_job\(\) TO (PUBLIC|anon|authenticated)/.test(vault),
  "anon and authenticated are not granted",
);
assert(!/\bDELETE\s+FROM\s+cron\.job\b/i.test(vault), "the migration deletes no cron row");
assert(!/\bUPDATE\s+cron\.job\b/i.test(vault), "the migration does not write cron.job directly");
assert(!/cron\.unschedule/.test(vault), "re-applying does not unschedule the job");

const doBlock = doContainers(stripSqlComments(vault)).map((block) => block.text).join("\n");
assert(/IF v_jobid IS NOT NULL/.test(doBlock), "re-point runs only when the job already exists");
assert(/cron\.alter_job/.test(doBlock), "the migration re-points with alter_job");
assert(!/cron\.schedule/.test(doBlock), "the migration does not create a second job");

const definers = files
  .filter((file) => /FUNCTION\s+(?:public\.)?schedule_nudge_job\s*\(/i.test(file.sql))
  .map((file) => file.name)
  .sort();
assert(
  definers.length === 2 && definers[0] === EMBEDDING_MIGRATION && definers[1] === VAULT_MIGRATION,
  `schedule_nudge_job is defined only by the original and the vault migration, got ${definers.join(", ")}`,
);

console.log("nudge-cron-vault-test: ok");
