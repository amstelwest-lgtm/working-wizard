/**
 * Client Brain deliverable draft — self-contained deploy bundle.
 *
 * Deploy this single file via Supabase CLI or MCP deploy_edge_function (index.ts).
 * Do not replace with smoke stubs — see pnpm test:edge-no-smoke-stubs.
 *
 * Claude drafts an advisory pack with an explicit assumptions list into
 * deliverable_drafts. Writes status=draft only. Never ready / sent / discarded.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// --- logic (sync with src/lib/client-brain-deliverable.ts) ---

const MAX_OPEN_DRAFTS = 3;
const DRAFT_RATE_LIMIT = 8;
const OPEN_DRAFT_STATUSES = new Set(["draft", "ready"]);
const DRAFT_KINDS = ["advisory", "client_email", "meeting_agenda", "exec_summary"] as const;
type DeliverableKind = (typeof DRAFT_KINDS)[number];

type AssumptionItem = { id: string; text: string; checked: boolean };

type ClaudeDeliverablePayload = {
  kind: DeliverableKind;
  subject: string | null;
  body: string;
  assumptions: AssumptionItem[];
};

function asTrimmed(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function normalizeDraftKind(raw: unknown): DeliverableKind {
  const k = asTrimmed(raw)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "client_email" || k === "email") return "client_email";
  if (k === "meeting_agenda" || k === "agenda") return "meeting_agenda";
  if (k === "exec_summary" || k === "summary") return "exec_summary";
  return "advisory";
}

function extractJsonText(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function assumptionsFromUnknown(raw: unknown): AssumptionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AssumptionItem[] = [];
  raw.forEach((item, i) => {
    let text = "";
    if (typeof item === "string") text = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      text = asTrimmed(o.text) ?? asTrimmed(o.label) ?? "";
    }
    if (!text) return;
    out.push({ id: `a-${out.length || i}`, text, checked: false });
  });
  return out;
}

function composeDraftBody(subject: string | null, body: string): string {
  const text = body.trim();
  const sub = subject?.trim();
  if (sub && !/^\s*SUBJECT:/i.test(text)) return `SUBJECT: ${sub}\n\n${text}`;
  return text;
}

function parseDraftSubjectBody(raw: string | null | undefined): { subject: string | null; body: string } {
  const text = (raw ?? "").trim();
  const m = text.match(/^\s*SUBJECT:\s*(.+)\s*\n+([\s\S]*)$/i);
  if (m) return { subject: m[1].trim() || null, body: m[2].trim() };
  return { subject: null, body: text };
}

function parseClaudeDeliverablePayload(raw: string): ClaudeDeliverablePayload | null {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const body = asTrimmed(o.body) ?? asTrimmed(o.text);
  if (!body) return null;
  return {
    kind: normalizeDraftKind(o.kind),
    subject: asTrimmed(o.subject) ?? null,
    body,
    assumptions: assumptionsFromUnknown(o.assumptions ?? o.assumption_checklist),
  };
}

function normalizeDraftBody(body: string): string {
  return body.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bodiesSimilar(a: string, b: string): boolean {
  const na = normalizeDraftBody(a);
  const nb = normalizeDraftBody(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter((w) => w.length > 2));
  const tb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap += 1;
  return overlap / Math.min(ta.size, tb.size) >= 0.8;
}

function filterNewDeliverableDraft(
  incoming: ClaudeDeliverablePayload | null,
  existing: Array<{ kind: string | null; body: string | null; status: string }>,
  opts?: { maxOpen?: number },
): ClaudeDeliverablePayload | null {
  if (!incoming) return null;
  const body = incoming.body.trim();
  if (!body) return null;
  const maxOpen = opts?.maxOpen ?? MAX_OPEN_DRAFTS;
  const open = existing.filter((d) => OPEN_DRAFT_STATUSES.has(d.status));
  if (open.length >= maxOpen) return null;
  const kind = incoming.kind;
  if (
    open.some(
      (d) =>
        normalizeDraftKind(d.kind) === kind &&
        bodiesSimilar(parseDraftSubjectBody(d.body).body || d.body || "", body),
    )
  ) {
    return null;
  }
  return { kind, subject: incoming.subject, body, assumptions: incoming.assumptions };
}

// --- Claude API ---

const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

async function callClaude(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "AI is not configured (ANTHROPIC_API_KEY missing). Please contact your administrator.",
    );
  }

  const t0 = Date.now();
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      system,
      messages: [{ role: "user", content: user }],
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 512,
    }),
  });

  if (res.status === 429) throw new Error("Rate limit reached — try again in a moment.");
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Claude error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = (json?.content ?? [])
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("")
    .trim();
  const usage = json?.usage ?? {};

  return {
    text,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}

// --- handler ---

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGINS");
  let allowOrigin = "*";
  if (allowed && requestOrigin) {
    const list = allowed.split(",").map((s) => s.trim());
    if (list.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else {
      allowOrigin = list[0] ?? "*";
    }
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, corsHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(corsHeaders ?? { "Access-Control-Allow-Origin": "*" }), "Content-Type": "application/json" },
  });
}

const SYSTEM = `You are a sharp SME CFO copilot drafting an advisory pack an accountant will review before sending.
Return ONLY valid JSON, no markdown, no prose.
Schema:
{"kind":"advisory|client_email|meeting_agenda|exec_summary","subject":"","body":"","assumptions":[""]}
Rules:
- Ground the body in the provided context. If evidence is missing, return {"kind":"advisory","subject":"","body":"","assumptions":[]}.
- Never invent figures, names, or claims. Missing facts stay missing.
- assumptions is an explicit list of things the accountant must tick before sign-off. Empty array if none are warranted.
- Do not mark the draft ready or sent. Do not include a status field.
- body is the deliverable the accountant could send after sign-off. For client_email, do not put SUBJECT inside body; use subject.
- Keep body under 900 words. Max 8 assumptions.`;

function compact(value: unknown, max = 800): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function ratioLines(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    out.push(`${key}: ${val}`);
    if (out.length >= 16) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req.headers.get("Origin"));
  const respond = (body: unknown, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Unauthorised" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return respond({ error: "Unauthorised" }, 401);

  let body: { clientId?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }
  const clientId = body.clientId;
  if (!clientId) return respond({ error: "clientId is required" }, 400);

  const { data: hasAccess, error: accessErr } = await adminClient
    .rpc("has_client_access", { _user_id: user.id, _client_id: clientId });
  if (accessErr) {
    console.error("has_client_access error:", accessErr.message);
    return respond({ error: "Access check failed" }, 500);
  }
  if (!hasAccess) return respond({ error: "Client not accessible" }, 403);

  const { data: allowed, error: rlErr } = await adminClient.rpc("ask_ai_record_request", {
    p_user_id: user.id,
    p_client_id: clientId,
    p_tier: "brain_deliverable",
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_latency_ms: 0,
    p_limit: DRAFT_RATE_LIMIT,
  });
  if (rlErr) {
    console.warn("ask_ai_record_request unavailable:", rlErr.message);
  } else if (allowed === false) {
    return respond({ error: "Rate limit exceeded. Try drafting again in an hour." }, 429);
  }

  const [clientRes, snapRes, factRes, stepRes, draftRes] = await Promise.all([
    userClient
      .from("clients")
      .select("name, business_type, operating_profile, brain_summary")
      .eq("id", clientId)
      .maybeSingle(),
    userClient
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios, source")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    userClient
      .from("context_facts")
      .select("fact_text, category, source")
      .eq("client_id", clientId)
      .is("superseded_by", null)
      .order("created_at", { ascending: false })
      .limit(20),
    userClient
      .from("proposed_next_steps")
      .select("title, rationale, status")
      .eq("client_id", clientId)
      .in("status", ["proposed", "approved", "edited"])
      .order("created_at", { ascending: false })
      .limit(12),
    userClient
      .from("deliverable_drafts")
      .select("kind, body, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const client = clientRes.data;
  const existingDrafts = (draftRes.data ?? []) as Array<{
    kind: string | null;
    body: string | null;
    status: string;
  }>;

  const contextLines: string[] = [];
  if (client?.name) contextLines.push(`Client: ${client.name}`);
  if (client?.business_type) contextLines.push(`Business type: ${client.business_type}`);
  const profile = client?.operating_profile;
  if (profile && typeof profile === "object") {
    contextLines.push(`Operating profile: ${compact(profile, 1200)}`);
  }
  const brainSummary = client?.brain_summary;
  if (brainSummary && typeof brainSummary === "object") {
    const blob = brainSummary as Record<string, unknown>;
    if (blob.headline || blob.body || blob.summary) {
      contextLines.push(`Brain summary: ${compact(blob.headline ?? blob.body ?? blob.summary, 800)}`);
    }
    if (blob.gap_report) contextLines.push(`GAP: ${compact(blob.gap_report, 800)}`);
    if (blob.competitors) contextLines.push(`Competitors: ${compact(blob.competitors, 600)}`);
    if (blob.business_map) contextLines.push(`Business map: ${compact(blob.business_map, 600)}`);
  }
  const snap = snapRes.data;
  if (snap) {
    contextLines.push(`Latest snapshot: ${snap.period_label ?? snap.period_date ?? "unknown"} (${snap.source ?? "n/a"})`);
    const ratios = ratioLines(snap.ratios);
    if (ratios.length) contextLines.push(`Ratios:\n  ${ratios.join("\n  ")}`);
  }
  const facts = (factRes.data ?? []) as Array<{ fact_text: string; category: string | null }>;
  if (facts.length) {
    contextLines.push(
      "Context facts:\n" +
        facts
          .slice(0, 12)
          .map((f) => `  - ${f.category ? `${f.category}: ` : ""}${f.fact_text}`)
          .join("\n"),
    );
  }
  const steps = (stepRes.data ?? []) as Array<{ title: string; rationale: string | null; status: string }>;
  if (steps.length) {
    contextLines.push(
      "Next steps:\n" +
        steps.map((s) => `  - [${s.status}] ${s.title}${s.rationale ? ` — ${s.rationale}` : ""}`).join("\n"),
    );
  }

  let skippedReason: "ai_not_configured" | "empty_context" | "similar_open" | "empty_draft" | undefined;
  let payload = parseClaudeDeliverablePayload("{}");

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    skippedReason = "ai_not_configured";
  } else if (contextLines.length === 0) {
    skippedReason = "empty_context";
  } else {
    try {
      const claude = await callClaude(
        SYSTEM,
        `Draft one advisory pack from this client brain. Empty body and empty assumptions when evidence is missing.\n\n${contextLines.join("\n")}`,
        { maxTokens: 1800, temperature: 0.2 },
      );
      payload = parseClaudeDeliverablePayload(claude.text);
      adminClient
        .from("ask_ai_log")
        .update({
          input_tokens: claude.inputTokens,
          output_tokens: claude.outputTokens,
          latency_ms: claude.latencyMs,
        })
        .eq("user_id", user.id)
        .eq("tier", "brain_deliverable")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ error: e }) => {
          if (e) console.warn("Token count update failed:", e.message);
        });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith("Rate limit")) return respond({ error: msg }, 429);
      if (/ANTHROPIC_API_KEY missing/i.test(msg)) {
        skippedReason = "ai_not_configured";
      } else {
        return respond({ error: msg }, 500);
      }
    }
  }

  const toInsert = filterNewDeliverableDraft(payload, existingDrafts);
  if (!toInsert) {
    if (!skippedReason) {
      skippedReason = payload?.body?.trim() ? "similar_open" : "empty_draft";
    }
    return respond({ draftInserted: false, skippedReason });
  }

  const { error: insErr } = await userClient.from("deliverable_drafts").insert({
    client_id: clientId,
    kind: toInsert.kind,
    body: composeDraftBody(toInsert.subject, toInsert.body),
    assumption_checklist: toInsert.assumptions,
    status: "draft",
    created_by: user.id,
  });
  if (insErr) {
    console.error("deliverable_drafts insert:", insErr.message);
    return respond({ error: insErr.message }, 500);
  }

  return respond({ draftInserted: true });
});
