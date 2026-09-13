/**
 * "This month's Milōn workflow" — Claude-drafted, grounded in the capability
 * catalogue in client-briefing.ts, cached per client on clients.briefing_workflow
 * and regenerated only when the briefing inputs change (or on demand).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { callClaudeMessages } from "@/lib/claude-messages";
import {
  fallbackWorkflow,
  sanitizeWorkflowText,
  workflowInputsHash,
  workflowPrompt,
  type WorkflowContext,
} from "@/lib/client-briefing";

export type BriefingWorkflow = {
  text: string;
  source: "claude" | "fallback";
  generatedAt: string;
  inputsHash: string;
};

const MetricSchema = z.object({
  key: z.enum(["revenue", "gm", "om", "runway", "updated"]),
  label: z.string().max(60),
  value: z.string().max(60),
  delta: z
    .object({
      text: z.string().max(20),
      direction: z.enum(["up", "down", "flat"]),
      good: z.boolean(),
    })
    .optional(),
  hint: z.string().max(80).optional(),
});

const ChipSchema = z.object({
  key: z.string().max(20),
  label: z.string().max(60),
  current: z.number().nullable(),
  prior: z.number().nullable(),
  delta: z.number().nullable(),
  higherIsBetter: z.boolean(),
  unit: z.enum(["pct", "days", "score", "number"]),
  status: z.enum(["up", "down", "flat", "na"]),
});

const InputSchema = z.object({
  clientId: z.string().uuid(),
  force: z.boolean().optional(),
  context: z.object({
    clientName: z.string().max(200),
    profile: z.unknown().nullable(),
    businessType: z.string().max(80).nullable(),
    healthScore: z.number().nullable(),
    healthLabel: z.string().max(40).nullable(),
    snapshot: z.array(MetricSchema).max(8),
    chips: z.array(ChipSchema).max(12),
    cashRunwayWeeks: z.number().nullable(),
    whatMatters: z.string().max(600).nullable(),
    openQueries: z.number().int().nullable().optional(),
  }),
});

function authedSupabase() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env vars");
  const req = getRequest();
  const token = req?.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const MISSING_COLUMN = /briefing_workflow|42703/;

export function parseBriefingWorkflow(raw: unknown): BriefingWorkflow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string" || typeof o.inputsHash !== "string") return null;
  return {
    text: o.text,
    source: o.source === "claude" ? "claude" : "fallback",
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : new Date(0).toISOString(),
    inputsHash: o.inputsHash,
  };
}

/** Cached result is reused for 35 days while the inputs are unchanged. */
export function workflowCacheFresh(
  cached: BriefingWorkflow | null,
  inputsHash: string,
  now = Date.now(),
): boolean {
  if (!cached || cached.inputsHash !== inputsHash) return false;
  if (cached.source !== "claude") return false;
  return now - new Date(cached.generatedAt).getTime() < 35 * 24 * 3600 * 1000;
}

export const draftMilonWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<BriefingWorkflow> => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    const { data: access, error: accessErr } = await sb.rpc(
      "has_client_access" as never,
      {
        _user_id: userData.user.id,
        _client_id: data.clientId,
      } as never,
    );
    if (accessErr) throw new Error(accessErr.message);
    if (!access) throw new Error("You do not have access to this client");

    const ctx = data.context as unknown as WorkflowContext;
    const inputsHash = workflowInputsHash(ctx);

    let column = true;
    if (!data.force) {
      const { data: row, error } = await sb
        .from("clients")
        .select("briefing_workflow")
        .eq("id", data.clientId)
        .maybeSingle();
      if (error && MISSING_COLUMN.test(error.message ?? "")) column = false;
      else if (error) throw new Error(error.message);
      const cached = parseBriefingWorkflow(row?.briefing_workflow);
      if (workflowCacheFresh(cached, inputsHash)) return cached!;
    }

    let result: BriefingWorkflow;
    try {
      const raw = await callClaudeMessages({
        content: [{ type: "text", text: workflowPrompt(ctx) }],
        maxTokens: 300,
        timeoutMs: 30_000,
      });
      const text = sanitizeWorkflowText(raw);
      result = text
        ? { text, source: "claude", generatedAt: new Date().toISOString(), inputsHash }
        : {
            text: fallbackWorkflow(ctx),
            source: "fallback",
            generatedAt: new Date().toISOString(),
            inputsHash,
          };
    } catch (e) {
      console.warn("[briefing workflow] Claude unavailable, using fallback:", (e as Error).message);
      result = {
        text: fallbackWorkflow(ctx),
        source: "fallback",
        generatedAt: new Date().toISOString(),
        inputsHash,
      };
    }

    if (column) {
      const { error } = await sb
        .from("clients")
        .update({ briefing_workflow: result })
        .eq("id", data.clientId);
      if (error && !MISSING_COLUMN.test(error.message ?? "")) {
        console.warn("[briefing workflow] cache write failed:", error.message);
      }
    }
    return result;
  });
