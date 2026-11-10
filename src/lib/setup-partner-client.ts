import { supabase } from "@/integrations/supabase/client";
import { PRECARD_CAP_CODE, isPrecardLimitKind, precardCapError } from "@/lib/precard-cap";
import type { SetupPartnerSummary, SetupPartnerWorkflowMap } from "@/lib/setup-partner";
import type { PracticeImplementationPlan } from "@/lib/setup-partner-plan";

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
