/**
 * Accountant CRUD for management / habits rules on client_artifacts (shared, firm IP).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  buildManagementHabitRuleMeta,
  isManagementHabitRuleMeta,
  parseManagementHabitRuleArtifact,
  validateManagementHabitRuleInput,
  type ManagementHabitRuleInput,
  type ManagementHabitRuleRow,
} from "@/lib/client-management-habits-rules";

async function currentAuthor(): Promise<{ id: string | null; name: string }> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const name =
    (typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user?.email === "string" && user.email.split("@")[0]) ||
    "Accountant";
  return { id: user?.id ?? null, name };
}

export async function listManagementHabitRules(clientId: string): Promise<ManagementHabitRuleRow[]> {
  const { data, error } = await supabase
    .from("client_artifacts")
    .select("id, client_id, meta, created_by, created_at")
    .eq("client_id", clientId)
    .eq("kind", "note")
    .eq("visibility", "shared")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) {
    if (/42P01|42703|PGRST205|does not exist/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? [])
    .map((row) =>
      parseManagementHabitRuleArtifact({
        id: row.id,
        client_id: row.client_id,
        meta: row.meta,
        created_by: row.created_by,
        created_at: row.created_at,
      }),
    )
    .filter((row): row is ManagementHabitRuleRow => Boolean(row))
    .sort((a, b) => b.edited_at.localeCompare(a.edited_at));
}

export async function saveManagementHabitRule(input: {
  clientId: string;
  firmId: string | null;
  ruleId?: string | null;
  draft: ManagementHabitRuleInput;
}): Promise<ManagementHabitRuleRow> {
  const problem = validateManagementHabitRuleInput(input.draft);
  if (problem) throw new Error(problem);
  const author = await currentAuthor();
  const editedAt = new Date().toISOString();
  const meta = buildManagementHabitRuleMeta({
    pillar: input.draft.pillar,
    label: input.draft.label.trim(),
    body: input.draft.body.trim(),
    firmId: input.firmId,
    authorId: author.id,
    authorName: author.name,
    editedAt,
  }) as Json;

  if (input.ruleId) {
    const { data: existing, error: readError } = await supabase
      .from("client_artifacts")
      .select("id, client_id, meta")
      .eq("id", input.ruleId)
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing || !isManagementHabitRuleMeta(existing.meta)) throw new Error("That rule was not found.");
    const { data, error } = await supabase
      .from("client_artifacts")
      .update({ meta })
      .eq("id", input.ruleId)
      .select("id, client_id, meta, created_by, created_at")
      .single();
    if (error) throw new Error(error.message);
    const parsed = parseManagementHabitRuleArtifact(data);
    if (!parsed) throw new Error("The rule could not be saved.");
    return parsed;
  }

  const { data, error } = await supabase
    .from("client_artifacts")
    .insert({
      client_id: input.clientId,
      kind: "note",
      visibility: "shared",
      meta,
      created_by: author.id,
    })
    .select("id, client_id, meta, created_by, created_at")
    .single();
  if (error) throw new Error(error.message);
  const parsed = parseManagementHabitRuleArtifact(data);
  if (!parsed) throw new Error("The rule could not be saved.");
  return parsed;
}

export async function deleteManagementHabitRule(clientId: string, ruleId: string): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from("client_artifacts")
    .select("id, meta")
    .eq("id", ruleId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!existing || !isManagementHabitRuleMeta(existing.meta)) throw new Error("That rule was not found.");
  const { error } = await supabase.from("client_artifacts").delete().eq("id", ruleId);
  if (error) throw new Error(error.message);
}
