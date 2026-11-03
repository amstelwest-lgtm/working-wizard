/**
 * Ask the ingest edge to read a Client library upload into artifact meta.
 * Failures stay on the file. They do not block the upload the person already saved.
 */
import { supabase } from "@/integrations/supabase/client";

export type LibraryIngestOutcome = {
  id: string;
  read: boolean;
  summary: string;
};

export async function ingestLibraryArtifacts(ids: string[]): Promise<LibraryIngestOutcome[]> {
  const unique = [...new Set(ids.filter((id) => id.trim()))];
  if (!unique.length) return [];
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!token || !base) return unique.map((id) => ({ id, read: false, summary: "" }));

  const outcomes = await Promise.all(
    unique.map(async (id) => {
      try {
        const response = await fetch(`${base}/functions/v1/ingest-library-document`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ artifact_id: id }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          read?: boolean;
          summary?: string;
        };
        return {
          id,
          read: response.ok && body.read === true,
          summary: typeof body.summary === "string" ? body.summary : "",
        };
      } catch {
        return { id, read: false, summary: "" };
      }
    }),
  );
  return outcomes;
}
