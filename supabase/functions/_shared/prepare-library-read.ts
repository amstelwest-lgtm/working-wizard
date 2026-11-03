/**
 * Ask ingest-library-document to fill a library upload.
 * This file stays free of PDF and spreadsheet parsers so the bot Deno checks
 * do not pull those type graphs.
 */
export async function prepareLibraryRead(artifactId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !artifactId) return;
  const response = await fetch(`${supabaseUrl}/functions/v1/ingest-library-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ artifact_id: artifactId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 200) || `library ingest failed (${response.status})`);
  }
}
