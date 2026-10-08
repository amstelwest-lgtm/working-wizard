import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { assertStarterTrialAllowsNewWork } from "@/lib/firm-client-cap.server";

/**
 * Advisory Drafter
 * ----------------
 * Turns a client's actual financial story into a ready-to-send advisory
 * deliverable in the accountant's own voice — the core "turn every compliance
 * client into an advisory client" workflow.
 *
 * It does the reasoning-heavy assembly server-side (pull the last two
 * snapshots, compute what moved, gather signed-off interventions) so the model
 * receives a tight, grounded brief rather than raw tables. The model then
 * drafts the deliverable; it is instructed never to invent numbers and to lean
 * on the structured deltas provided.
 *
 * Model note: this deliverable is higher-stakes than the ambient copilot (it
 * goes out under the accountant's name), so it uses Anthropic Claude Sonnet
 * (see CLAUDE_MODEL in claude-config.ts) via the Anthropic Messages API.
 */

import { CLAUDE_MODEL } from "@/lib/claude-config";
import { buildAdvisoryModelPayload } from "@/lib/advisory-draft-prompt";
import { rehydrateModelOutput } from "@/lib/redact-identifiers";
import { parseOperatingProfile } from "@/lib/client-profile";
import { profileAiContext } from "@/lib/profile-signals";
import { assessClientMetrics, runwayDisplayLabel } from "@/lib/client-metrics";
import { PILLAR_LABELS, pillarForRatioName } from "@/lib/health-score";

type RatioMap = Record<string, number | string | null>;

const DeliverableKind = z.enum([
  "client_email",       // ready-to-send email to the SME owner
  "meeting_agenda",     // agenda for the monthly advisory meeting
  "exec_summary",       // 1-paragraph "state of the business" summary
]);

const InputSchema = z.object({
  clientId: z.string().uuid(),
  kind: DeliverableKind.default("client_email"),
  // The accountant's identity/voice, so the output sounds like them, not like
  // a generic AI. Sourced from the AccountantProfile context on the client.
  firmName: z.string().max(200).optional(),
  accountantName: z.string().max(200).optional(),
  tagline: z.string().max(300).optional().nullable(),
  // Optional freeform steer, e.g. "keep it warm, they're a nervous first-time
  // owner" or "push harder on the debtor-days problem this month".
  steer: z.string().max(600).optional(),
});

function pillarName(ratio: string): string {
  return PILLAR_LABELS[pillarForRatioName(ratio)];
}

function toNum(v: number | string | null | undefined): number {
  if (v == null) return NaN;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Build a compact, human-readable "what changed" brief from two snapshots.
 * Only includes ratios that (a) exist in both periods and (b) moved
 * meaningfully, so the model isn't handed 19 rows of noise. Direction of
 * "good" isn't asserted here — the model is told to interpret with care and
 * the accountant reviews before sending.
 */
function buildMovementBrief(
  current: RatioMap,
  prior: RatioMap | null,
): { lines: string[]; hasPrior: boolean } {
  if (!prior) {
    const lines = Object.entries(current)
      .filter(([, v]) => Number.isFinite(toNum(v)))
      .map(([k, v]) => `${pillarName(k)} · ${k}: ${fmt(k, toNum(v))}`);
    return { lines, hasPrior: false };
  }

  const rows: Array<{ pillar: string; text: string; absPctMove: number }> = [];
  for (const [k, cv] of Object.entries(current)) {
    const c = toNum(cv);
    const p = toNum(prior[k]);
    if (!Number.isFinite(c) || !Number.isFinite(p)) continue;
    const delta = c - p;
    const pctMove = p !== 0 ? Math.abs(delta / p) : Math.abs(delta);
    // Only surface moves worth a sentence (>=5% relative, or any sign flip).
    const signFlipped = (c < 0) !== (p < 0);
    if (pctMove < 0.05 && !signFlipped) continue;
    const dir = delta > 0 ? "up" : "down";
    rows.push({
      pillar: pillarName(k),
      text: `${pillarName(k)} · ${k}: ${fmt(k, p)} → ${fmt(k, c)} (${dir} ${fmtDelta(k, delta)})`,
      absPctMove: pctMove,
    });
  }
  rows.sort((a, b) => b.absPctMove - a.absPctMove);
  return { lines: rows.map((r) => r.text), hasPrior: true };
}

function fmt(key: string, v: number): string {
  if (!Number.isFinite(v)) return "n/m";
  if (key.includes("Days")) return `${Math.round(v)}d`;
  if (key.includes("Multiplier") || key.includes("Burden") || key.includes("Leverage") || key.includes("EBITDA") || key.includes("Labor") || key.includes("Turnover"))
    return `${v.toFixed(2)}×`;
  if (key.includes("Employee")) return v.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(key: string, d: number): string {
  const a = Math.abs(d);
  if (key.includes("Days")) return `${Math.round(a)}d`;
  if (key.includes("Multiplier") || key.includes("Burden") || key.includes("Leverage") || key.includes("EBITDA") || key.includes("Labor") || key.includes("Turnover"))
    return `${a.toFixed(2)}×`;
  if (key.includes("Employee")) return a.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
  return `${(a * 100).toFixed(1)}pp`;
}

export const draftAdvisory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AI drafting is not configured (ANTHROPIC_API_KEY missing). Add the key to project secrets to enable the drafter.",
      );
    }

    // Enforce impersonation scope, then rely on RLS for the actual reads.
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id, name, firm_id, business_type, cashflow, financials, operating_profile")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not accessible");

    const claims = context.claims as { email?: string | null };
    await assertStarterTrialAllowsNewWork({
      supabase: context.supabase,
      userId: context.userId,
      email: claims.email ?? "",
      firmId: (client as { firm_id?: string | null }).firm_id ?? null,
    });

    const operatingProfile = parseOperatingProfile(
      (client as { operating_profile?: unknown }).operating_profile,
    );
    const operatingContext = profileAiContext(operatingProfile);
    const assessed = assessClientMetrics({
      financials: (client as { financials?: Record<string, unknown> | null }).financials ?? null,
      cashflow: (client as { cashflow?: unknown }).cashflow,
    });
    const runwayLabel = runwayDisplayLabel(assessed.runway);

    // Last two snapshots (RLS-scoped) for the movement brief.
    const { data: snaps } = await context.supabase
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", data.clientId)
      .order("period_date", { ascending: false })
      .limit(2);

    const rows = (snaps ?? []) as Array<{
      period_label: string;
      period_date: string;
      ratios: RatioMap;
    }>;

    if (rows.length === 0) {
      throw new Error(
        "No financial snapshots yet for this client — capture at least one period before drafting advisory.",
      );
    }

    const current = rows[0];
    const prior = rows[1] ?? null;
    const { lines: movementLines, hasPrior } = buildMovementBrief(
      current.ratios ?? {},
      prior?.ratios ?? null,
    );

    // Signed-off interventions this period (accountant has committed to these).
    // Loose-typed table access consistent with intervention.functions.ts.
    let signoffLines: string[] = [];
    let signoffNames: string[] = [];
    try {
      const { data: signoffs } = await (context.supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => Promise<{ data: Array<Record<string, string>> | null }>;
          };
        };
      })
        .from("intervention_signoffs")
        .select("ratio_key, signed_off_by_name")
        .eq("client_id", data.clientId);
      signoffNames = (signoffs ?? [])
        .map((s) => s.signed_off_by_name)
        .filter((name): name is string => Boolean(name?.trim()));
      signoffLines = (signoffs ?? []).map(
        (s) => `${s.ratio_key} (signed off by ${s.signed_off_by_name})`,
      );
    } catch {
      // Non-fatal — table may not be migrated in all environments.
      signoffLines = [];
      signoffNames = [];
    }

    const sealed = buildAdvisoryModelPayload({
      kind: data.kind,
      steer: data.steer,
      accountantName: data.accountantName,
      firmName: data.firmName,
      tagline: data.tagline,
      clientName: client.name,
      businessType: client.business_type,
      operatingContext,
      periodLabel: current.period_label,
      priorPeriodLabel: prior?.period_label ?? null,
      hasPrior,
      runwayLabel,
      movementLines,
      signoffLines,
      partyNames: signoffNames,
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        system: sealed.system,
        messages: [{ role: "user", content: sealed.user }],
        max_tokens: 2048,
      }),
    });

    if (res.status === 429) throw new Error("Rate limit hit. Try again in a moment.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI error (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const raw = rehydrateModelOutput(
      (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim(),
      sealed.session,
    );

    // For emails, split out the SUBJECT: line if present.
    let subject: string | null = null;
    let body = raw;
    if (data.kind === "client_email") {
      const m = raw.match(/^\s*SUBJECT:\s*(.+)\s*\n+([\s\S]*)$/i);
      if (m) {
        subject = m[1].trim();
        body = m[2].trim();
      }
    }

    return {
      kind: data.kind,
      subject,
      body,
      grounding: {
        currentPeriod: current.period_label,
        priorPeriod: prior?.period_label ?? null,
        movementCount: movementLines.length,
        signoffCount: signoffLines.length,
      },
    };
  });
