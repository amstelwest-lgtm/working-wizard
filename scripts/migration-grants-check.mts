/**
 * Public Data API grants for new migrations.
 *
 * From 30 Oct 2026, Postgres tables created in schema public no longer receive
 * PostgREST grants automatically. A migration whose version is after
 * GRANT_CHECK_CUTOFF must grant SELECT, INSERT, UPDATE, DELETE on every public
 * table and view it creates to authenticated and service_role, in that same
 * file. Sequences it creates (including serial / identity) need USAGE and
 * SELECT. anon is not required.
 *
 * History at or before the cutoff is allowlisted: 20261020143201_data_api_grants_catchup.sql
 * replays the privileges production already has.
 *
 * Run: node --experimental-strip-types scripts/migration-grants-check.mts
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Inclusive. Timestamped migrations at or before this version are history. */
export const GRANT_CHECK_CUTOFF = "20261020130500";

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

const SEQUENCE_PRIVILEGES = ["USAGE", "SELECT", "UPDATE"] as const;

const REQUIRED_TABLE = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
const REQUIRED_SEQUENCE = ["USAGE", "SELECT"] as const;
const REQUIRED_ROLES = ["authenticated", "service_role"] as const;

const MIGRATION_FILE = /^(\d{14})_.+\.sql$/;

type RelationKind = "table" | "sequence";

type Created = {
  kind: RelationKind;
  name: string;
};

type PrivilegeMap = Map<string, Map<string, Set<string>>>;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function maskLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tag) {
        out += tag[0];
        i += tag[0].length;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function normalizeIdent(raw: string): string {
  const token = raw.trim();
  if (token.startsWith('"')) {
    return token.slice(1, -1).replace(/""/g, '"');
  }
  return token.toLowerCase();
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function parseQualified(raw: string): { schema: string | null; name: string } {
  const bits = splitTopLevel(raw.trim(), ".").map((bit) => bit.trim());
  if (bits.length >= 2 && bits[0] && bits[1]) {
    return { schema: normalizeIdent(bits[0]), name: normalizeIdent(bits[1]) };
  }
  return { schema: null, name: normalizeIdent(bits[0] ?? raw) };
}

function keyOf(kind: RelationKind, name: string): string {
  return `${kind}:${name}`;
}

function emptyPrivileges(): Map<string, Set<string>> {
  return new Map();
}

function privilegesFor(kind: RelationKind): readonly string[] {
  return kind === "sequence" ? SEQUENCE_PRIVILEGES : TABLE_PRIVILEGES;
}

function parsePrivilegeList(raw: string, kind: RelationKind): Set<string> {
  const out = new Set<string>();
  for (const part of splitTopLevel(raw, ",")) {
    const token = collapse(part);
    if (/^all(?:\s+privileges)?$/i.test(token)) {
      for (const privilege of privilegesFor(kind)) out.add(privilege);
      continue;
    }
    const match = /^(select|insert|update|delete|truncate|references|trigger|maintain|usage)\b/i.exec(
      token,
    );
    if (!match) continue;
    const rest = token.slice(match[0].length).trim();
    if (rest.startsWith("(")) continue;
    out.add(match[1].toUpperCase());
  }
  return out;
}

function addPrivileges(
  state: PrivilegeMap,
  kind: RelationKind,
  name: string,
  roles: string[],
  privileges: Set<string>,
) {
  const key = keyOf(kind, name);
  const roleMap = state.get(key) ?? emptyPrivileges();
  for (const role of roles) {
    const held = roleMap.get(role) ?? new Set<string>();
    for (const privilege of privileges) held.add(privilege);
    roleMap.set(role, held);
  }
  state.set(key, roleMap);
}

function removePrivileges(
  state: PrivilegeMap,
  kind: RelationKind,
  name: string,
  roles: string[],
  privileges: Set<string>,
) {
  const roleMap = state.get(keyOf(kind, name));
  if (!roleMap) return;
  for (const role of roles) {
    const held = roleMap.get(role);
    if (!held) continue;
    for (const privilege of privileges) held.delete(privilege);
  }
}

type GrantTarget =
  | { all: RelationKind; schema: string }
  | { objects: { kind: RelationKind; schema: string | null; name: string }[] };

function parseGrantTarget(raw: string): GrantTarget | null {
  const target = collapse(raw);
  if (/^(function|procedure|routine|schema|type|domain|language|foreign)\b/i.test(target)) {
    return null;
  }
  const all = /^all\s+(tables|sequences)\s+in\s+schema\s+(\S+)$/i.exec(target);
  if (all) {
    return {
      all: all[1].toLowerCase() === "sequences" ? "sequence" : "table",
      schema: normalizeIdent(all[2]),
    };
  }
  let kind: RelationKind = "table";
  let body = target;
  const lead = /^(table|sequence)\s+(.+)$/i.exec(target);
  if (lead) {
    kind = lead[1].toLowerCase() === "sequence" ? "sequence" : "table";
    body = lead[2];
  }
  const objects = splitTopLevel(body, ",")
    .map((part) => collapse(part))
    .filter(Boolean)
    .map((part) => {
      const qualified = parseQualified(part);
      return { kind, schema: qualified.schema, name: qualified.name };
    });
  return { objects };
}

function rolesOf(raw: string): string[] {
  return splitTopLevel(raw.replace(/\s+with\s+grant\s+option\s*$/i, ""), ",")
    .map((role) => normalizeIdent(role))
    .filter(Boolean);
}

function isPublic(schema: string | null): boolean {
  return schema === null || schema === "public";
}

const createRe =
  /\bcreate\s+(?:or\s+replace\s+)?(unlogged\s+|temporary\s+|temp\s+)?(?:materialized\s+)?(table|view|sequence)\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w$]*|"(?:[^"]|"")+")(?:\s*\.\s*([a-zA-Z_][\w$]*|"(?:[^"]|"")*"))?/gi;

function matchingParen(sql: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sequenceNames(table: string, body: string): string[] {
  const names: string[] = [];
  for (const column of splitTopLevel(body, ",")) {
    const match = /^\s*([a-zA-Z_][\w$]*|"(?:[^"]|"")+")\s+([\s\S]+)$/.exec(column);
    if (!match) continue;
    const columnName = normalizeIdent(match[1]);
    const rest = match[2];
    if (/\b(?:bigserial|smallserial|serial)\b/i.test(rest)) {
      names.push(`${table}_${columnName}_seq`);
      continue;
    }
    const identity = /\bgenerated\s+(?:always|by\s+default)\s+as\s+identity\b([^;]*)/i.exec(rest);
    if (!identity) continue;
    const named = /\bsequence\s+name\s+([a-zA-Z_][\w$]*|"(?:[^"]|"")+")(?:\s*\.\s*([a-zA-Z_][\w$]*|"(?:[^"]|"")*"))?/i.exec(
      identity[1] ?? "",
    );
    if (named?.[2]) names.push(normalizeIdent(named[2]));
    else if (named?.[1] && !named[2]) {
      const only = named[1];
      names.push(normalizeIdent(only));
    } else names.push(`${table}_${columnName}_seq`);
  }
  return names;
}

function applyGrant(
  statement: string,
  created: Created[],
  state: PrivilegeMap,
) {
  const flat = collapse(statement);
  const match = /^(grant|revoke)\s+(.+?)\s+on\s+(.+?)\s+(?:to|from)\s+(.+)$/i.exec(flat);
  if (!match) return;
  const action = match[1].toLowerCase();
  const target = parseGrantTarget(match[3]);
  if (!target) return;
  const roles = rolesOf(match[4]).filter((role) => role === "authenticated" || role === "service_role");
  if (roles.length === 0) return;

  const touch = (kind: RelationKind, name: string) => {
    if (!created.some((relation) => relation.kind === kind && relation.name === name)) return;
    const privileges = parsePrivilegeList(match[2], kind);
    if (action === "grant") addPrivileges(state, kind, name, roles, privileges);
    else removePrivileges(state, kind, name, roles, privileges);
  };

  if ("all" in target) {
    if (target.schema !== "public") return;
    for (const relation of created) {
      if (relation.kind === target.all) touch(relation.kind, relation.name);
    }
    return;
  }
  for (const object of target.objects) {
    if (!isPublic(object.schema)) continue;
    touch(object.kind, object.name);
  }
}

export function checkMigration(filename: string, sql: string): string[] {
  const version = MIGRATION_FILE.exec(filename)?.[1];
  if (!version || version <= GRANT_CHECK_CUTOFF) return [];

  const masked = maskLiterals(sql);
  const created: Created[] = [];
  const state: PrivilegeMap = new Map();
  const errors: string[] = [];
  const events: { index: number; run: () => void }[] = [];

  for (const match of masked.matchAll(createRe)) {
    const found = match;
    events.push({
      index: found.index,
      run: () => {
        if (found[1]) return;
        const sqlKind = found[2].toLowerCase();
        const kind: RelationKind = sqlKind === "sequence" ? "sequence" : "table";
        const schemaRaw = found[4] ? found[3] : null;
        const nameRaw = found[4] ?? found[3];
        const schema = schemaRaw ? normalizeIdent(schemaRaw) : null;
        const name = normalizeIdent(nameRaw);
        if (!isPublic(schema)) return;
        created.push({ kind, name });
        state.set(keyOf(kind, name), emptyPrivileges());
        if (sqlKind !== "table") return;
        const after = found.index + found[0].length;
        const open = masked.slice(after).search(/\S/);
        if (open === -1 || masked[after + open] !== "(") return;
        const openAt = after + open;
        const closeAt = matchingParen(masked, openAt);
        if (closeAt === -1) return;
        for (const sequence of sequenceNames(name, masked.slice(openAt + 1, closeAt))) {
          if (created.some((relation) => relation.kind === "sequence" && relation.name === sequence)) {
            continue;
          }
          created.push({ kind: "sequence", name: sequence });
          state.set(keyOf("sequence", sequence), emptyPrivileges());
        }
      },
    });
  }

  let statementStart = 0;
  for (let i = 0; i <= masked.length; i += 1) {
    if (i !== masked.length && masked[i] !== ";") continue;
    const statement = masked.slice(statementStart, i);
    if (/^\s*(grant|revoke)\b/i.test(statement)) {
      const at = statementStart;
      events.push({
        index: at,
        run: () => applyGrant(statement, created, state),
      });
    }
    statementStart = i + 1;
  }

  events.sort((a, b) => a.index - b.index);
  for (const event of events) event.run();

  for (const relation of created) {
    const required = relation.kind === "sequence" ? REQUIRED_SEQUENCE : REQUIRED_TABLE;
    const heldByRole = state.get(keyOf(relation.kind, relation.name)) ?? emptyPrivileges();
    for (const role of REQUIRED_ROLES) {
      const held = heldByRole.get(role) ?? new Set<string>();
      const missing = required.filter((privilege) => !held.has(privilege));
      if (missing.length === 0) continue;
      const object = relation.kind === "sequence" ? `sequence public.${relation.name}` : `public.${relation.name}`;
      errors.push(
        `${filename}: ${object} is missing ${missing.join(", ")} for ${role}`,
      );
    }
  }
  return errors;
}

export function scanMigrationDir(dir: string): string[] {
  const files = readdirSync(dir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();
  const errors: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const error of checkMigration(file, sql)) errors.push(error);
  }
  return errors;
}

const TABLE_ORDER = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];
const SEQUENCE_ORDER = ["USAGE", "SELECT", "UPDATE"];

function privilegeSet(kind: string, raw: string): Set<string> {
  const allowed = kind === "sequence" ? SEQUENCE_ORDER : TABLE_ORDER;
  const found = new Set(
    raw
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean),
  );
  for (const privilege of found) {
    if (!allowed.includes(privilege)) {
      throw new Error(`unexpected ${kind} privilege ${privilege}`);
    }
  }
  return found;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/** The catch-up migration must reproduce the read-only prod ACL snapshot. */
export function checkCatchupMatchesSnapshot(migrationSql: string, snapshot: string): string[] {
  const errors: string[] = [];
  const expected = new Map<string, Map<string, Set<string>>>();
  for (const line of snapshot.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(table|view|sequence)\|([a-z0-9_]+)\|anon=([^|]*)\|auth=([^|]*)\|svc=(.*)$/.exec(
      trimmed,
    );
    if (!match) {
      errors.push(`snapshot line is not parseable: ${trimmed}`);
      continue;
    }
    const kind = match[1] === "sequence" ? "sequence" : "table";
    const name = match[2];
    const roles = new Map<string, Set<string>>([
      ["anon", privilegeSet(kind, match[3])],
      ["authenticated", privilegeSet(kind, match[4])],
      ["service_role", privilegeSet(kind, match[5])],
    ]);
    expected.set(`${kind}:${name}`, roles);
  }

  const actual = new Map<string, Map<string, Set<string>>>();
  const row =
    /\('(table|view|sequence)',\s*'([a-z0-9_]+)',\s*'([^']*)',\s*'([^']*)'\)/g;
  for (const match of migrationSql.matchAll(row)) {
    const kind = match[1] === "sequence" ? "sequence" : "table";
    const name = match[2];
    const key = `${kind}:${name}`;
    const roleMap = actual.get(key) ?? new Map<string, Set<string>>();
    const privileges = privilegeSet(kind, match[4]);
    for (const role of match[3].split(",").map((part) => part.trim())) {
      const held = roleMap.get(role) ?? new Set<string>();
      for (const privilege of privileges) held.add(privilege);
      roleMap.set(role, held);
    }
    actual.set(key, roleMap);
  }

  for (const [key, roles] of expected) {
    const granted = actual.get(key) ?? new Map<string, Set<string>>();
    for (const role of ["anon", "authenticated", "service_role"]) {
      const want = roles.get(role) ?? new Set<string>();
      const got = granted.get(role) ?? new Set<string>();
      if (sameSet(want, got)) continue;
      const format = (values: Set<string>) => (values.size ? [...values].sort().join(",") : "(none)");
      errors.push(`${key} ${role}: snapshot ${format(want)} vs migration ${format(got)}`);
    }
    for (const role of granted.keys()) {
      if (!roles.has(role)) errors.push(`${key} grants unexpected role ${role}`);
    }
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) errors.push(`migration grants ${key}, which is not in the prod snapshot`);
  }
  return errors;
}

function runFixtures(): string[] {
  const failures: string[] = [];
  const dir = join(root, "scripts/fixtures/migration-grants");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const expect = /^--\s*expect:\s*(pass|fail)\s*$/m.exec(sql)?.[1];
    if (!expect) {
      failures.push(`${file}: missing -- expect: pass|fail`);
      continue;
    }
    const errors = checkMigration(file, sql);
    const ok = errors.length === 0;
    if (expect === "pass" && !ok) failures.push(`${file}: expected pass\n${errors.join("\n")}`);
    if (expect === "fail" && ok) failures.push(`${file}: expected fail`);
  }

  const trialName = "20261016120000_trial_demo.sql";
  const trialSql = readFileSync(join(root, "supabase/migrations", trialName), "utf8");
  const allowlisted = checkMigration(trialName, trialSql);
  if (allowlisted.length !== 0) {
    failures.push(`history allowlist failed for ${trialName}\n${allowlisted.join("\n")}`);
  }
  const forced = checkMigration("20261030120000_trial_demo.sql", trialSql);
  if (forced.length === 0) {
    failures.push("trial_demo would pass the new rule if it were not allowlisted");
  }

  const catchup = readdirSync(join(root, "supabase/migrations")).find((file) =>
    file.endsWith("_data_api_grants_catchup.sql"),
  );
  if (!catchup) failures.push("catch-up migration is missing");
  else {
    const catchupSql = readFileSync(join(root, "supabase/migrations", catchup), "utf8");
    const catchupErrors = checkMigration(catchup, catchupSql);
    if (catchupErrors.length) failures.push(catchupErrors.join("\n"));
    const snapshot = readFileSync(
      join(root, "scripts/fixtures/migration-grants/prod-public-acl-20261020.txt"),
      "utf8",
    );
    const drift = checkCatchupMatchesSnapshot(catchupSql, snapshot);
    if (drift.length) failures.push(drift.join("\n"));
  }
  return failures;
}

function main() {
  const fixtureFailures = runFixtures();
  for (const failure of fixtureFailures) console.error(`FAIL  ${failure}`);
  const migrationErrors = scanMigrationDir(join(root, "supabase/migrations"));
  for (const error of migrationErrors) console.error(`FAIL  ${error}`);
  const fixtureFiles = readdirSync(join(root, "scripts/fixtures/migration-grants")).filter((file) =>
    file.endsWith(".sql"),
  );
  if (fixtureFailures.length === 0 && migrationErrors.length === 0) {
    console.log(
      `PASS  migration grants (${fixtureFiles.length} fixtures, public migrations after ${GRANT_CHECK_CUTOFF})`,
    );
    return;
  }
  console.error(
    `\n${fixtureFailures.length + migrationErrors.length} migration grant check failure(s)`,
  );
  process.exit(1);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) main();
