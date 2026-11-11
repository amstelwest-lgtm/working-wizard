import { supabase } from "@/integrations/supabase/client";
import { PRECARD_CAP_CODE, isPrecardLimitKind, precardCapError } from "@/lib/precard-cap";
import {
  SETUP_PARTNER_SOURCE_EVENT,
  SETUP_PARTNER_TASK_WORKFLOW,
  type SetupPartnerSummary,
  type SetupPartnerWorkflowMap,
} from "@/lib/setup-partner";
import {
  practicePlanFromConfirmRules,
  type PracticeImplementationPlan,
} from "@/lib/setup-partner-plan";

async function invokeSetupPartner<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");
  const res = await fetch(`${base}/functions/v1/setup-partner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
    limit?: string;
  };
  if (!res.ok) {
    if (payload.code === PRECARD_CAP_CODE)
      throw precardCapError(isPrecardLimitKind(payload.limit) ? payload.limit : "pack");
    throw new Error(payload.error || `Implementation Manager failed (${res.status})`);
  }
  return payload;
}

export async function fetchSetupPartnerSummary(clientId: string): Promise<SetupPartnerSummary> {
  const body = await invokeSetupPartner<{ summary: SetupPartnerSummary }>({
    action: "summary",
    clientId,
  });
  return body.summary;
}

export async function phraseSetupPartnerFollowup(
  clientId: string,
  template: string,
  modelTurns: number,
): Promise<{ question: string; modelTurns: number }> {
  const body = await invokeSetupPartner<{ question: string; modelTurns: number }>({
    action: "phrase_followup",
    clientId,
    template,
    modelTurns,
  });
  return { question: body.question, modelTurns: body.modelTurns };
}

export async function buildSetupPartnerMap(
  clientId: string,
  answers: Record<string, string>,
  summary: SetupPartnerSummary,
  modelTurns: number,
): Promise<{ map: SetupPartnerWorkflowMap; modelTurns: number }> {
  const body = await invokeSetupPartner<{ map: SetupPartnerWorkflowMap; modelTurns: number }>({
    action: "build_map",
    clientId,
    answers,
    summary,
    modelTurns,
  });
  return { map: body.map, modelTurns: body.modelTurns };
}

export async function confirmSetupPartnerMap(
  clientId: string,
  map: SetupPartnerWorkflowMap,
): Promise<{ ok: boolean; inserted: number }> {
  const body = await invokeSetupPartner<{ ok: boolean; inserted: number }>({
    action: "confirm",
    clientId,
    map,
  });
  return { ok: body.ok, inserted: body.inserted };
}

export type FirmInterviewTurn = {
  question: string;
  done: boolean;
  modelTurns: number;
};

export async function firmInterviewTurn(input: {
  firmId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  modelTurns: number;
}): Promise<FirmInterviewTurn> {
  const body = await invokeSetupPartner<FirmInterviewTurn>({
    action: "firm_turn",
    firmId: input.firmId,
    messages: input.messages,
    modelTurns: input.modelTurns,
  });
  return {
    question: body.question ?? "",
    done: Boolean(body.done),
    modelTurns: body.modelTurns,
  };
}

export async function buildSetupPartnerFirmMap(input: {
  firmId: string;
  answers: Record<string, string>;
  summary: SetupPartnerSummary;
  modelTurns: number;
}): Promise<{ map: SetupPartnerWorkflowMap; modelTurns: number }> {
  const body = await invokeSetupPartner<{ map: SetupPartnerWorkflowMap; modelTurns: number }>({
    action: "build_map",
    firmId: input.firmId,
    answers: input.answers,
    summary: input.summary,
    modelTurns: input.modelTurns,
  });
  return { map: body.map, modelTurns: body.modelTurns };
}

type ConfirmRuleRow = {
  rule_text: string | null;
  client_id: string | null;
  source_event: string | null;
  status: string | null;
};

type RuleQuery = Promise<{
  data: ConfirmRuleRow[] | null;
  error: { message: string } | null;
}> & {
  eq: (column: string, value: string) => RuleQuery;
  is: (column: string, value: null) => RuleQuery;
};

/** Active firm-level setup_partner_confirm rules. RLS scopes this to the caller's firm. */
export async function fetchFirmSetupPlan(
  firmId: string,
): Promise<PracticeImplementationPlan | null> {
  const builder = (
    supabase as unknown as {
      from: (table: string) => { select: (columns: string) => RuleQuery };
    }
  ).from("milon_brain_rules");
  const { data, error } = await builder
    .select("rule_text, client_id, source_event, status")
    .eq("firm_id", firmId)
    .is("client_id", null)
    .eq("source_event", SETUP_PARTNER_SOURCE_EVENT)
    .eq("status", "active")
    .eq("task_type", SETUP_PARTNER_TASK_WORKFLOW);
  if (error) throw new Error(error.message);
  const plan = practicePlanFromConfirmRules(data ?? []);
  return plan.steps.length ? plan : null;
}

export async function confirmSetupPartnerFirmMap(
  firmId: string,
  map: SetupPartnerWorkflowMap,
): Promise<{ ok: boolean; inserted: number; plan: PracticeImplementationPlan | null }> {
  const body = await invokeSetupPartner<{
    ok: boolean;
    inserted: number;
    plan?: PracticeImplementationPlan;
  }>({
    action: "confirm",
    firmId,
    map,
  });
  return { ok: body.ok, inserted: body.inserted, plan: body.plan ?? null };
}
