/**
 * One-shot script: apply a SQL migration file to the live Supabase instance.
 * Uses the service-role key fetched from the management API.
 *
 * Usage: pnpm vite-node scripts/apply-migration.mts <migration-file>
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const PROJECT_ID = (process.env.VITE_SUPABASE_PROJECT_ID ?? "cujzeoyvnpfokgwfftyd").replace(/"/g, "");
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error("Usage: vite-node scripts/apply-migration.mts <file.sql>");
  process.exit(1);
}

async function getServiceRoleKey(): Promise<string> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/api-keys`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`);
  const keys = (await res.json()) as Array<{ name: string; api_key: string }>;
  const svcKey = keys.find((k) => k.name === "service_role")?.api_key;
  if (!svcKey) throw new Error("service_role key not found");
  return svcKey;
}

const serviceRoleKey = await getServiceRoleKey();
const sql = await readFile(migrationFile, "utf8");

// Use the Supabase REST API to execute the SQL via a temporary RPC call
const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
  },
  body: JSON.stringify({ sql }),
});

if (!res.ok) {
  // execute_sql RPC may not exist; fall back to direct pg via admin client if needed
  const body = await res.text();
  console.error("execute_sql RPC failed:", res.status, body);
  console.log("Falling back to direct statement execution...");
  
  // Use the admin client's raw query capability if available
  const admin = createClient(SUPABASE_URL, serviceRoleKey);
  const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    const { error } = await (admin as any).rpc("pg_query", { query: stmt + ";" });
    if (error) {
      console.error("pg_query error:", error.message, "\nStatement:", stmt);
    } else {
      console.log("✓", stmt.substring(0, 60) + "...");
    }
  }
} else {
  console.log("✅ Migration applied successfully:", migrationFile);
}
