/**
 * Applies the clients_update_owner_only migration to the live Supabase DB.
 * Uses the management API to execute the DDL.
 */
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const PROJECT_ID = (process.env.VITE_SUPABASE_PROJECT_ID ?? "cujzeoyvnpfokgwfftyd").replace(/"/g, "");

if (!ACCESS_TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN not set");
  process.exit(1);
}

const sql = `
DROP POLICY IF EXISTS "clients update by access" ON public.clients;
CREATE POLICY "clients update by owner"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid());
`;

console.log("Applying migration via Supabase management API...");
const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`Status: ${res.status}`);
console.log(`Response: ${text.substring(0, 400)}`);

// Verify the new policy exists
const verifyRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: "SELECT policyname, cmd FROM pg_policies WHERE tablename='clients' AND cmd='UPDATE';" }),
});
const verifyText = await verifyRes.text();
console.log("Update policies now:", verifyText);
