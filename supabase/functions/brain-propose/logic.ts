/**
 * Deno copy of src/lib/client-brain-propose.ts + drip pickers.
 * Keep rules in sync: draft-only GAP/competitors, similar-title skip, 1 drip.
 */

export const DRIP_COOLDOWN_DAYS = 14;
export const MAX_NEW_STEPS_PER_CALL = 3;
export const MAX_OPEN_PROPOSED_STEPS = 5;
export const MAX_NEW_GAP_DRAFTS = 3;
export const MAX_NEW_COMPETITOR_DRAFTS = 3;
export const PROPOSE_RATE_LIMIT = 8;
export const OPEN_STEP_STATUSES = new Set(["proposed", "edited"]);

export type ProposedStepInput = {
  title: string;
  rationale: string | null;
  assumptions: unknown[];
};

export type GapItem = {
  key: string;
  title: string;
  detail?: string;
  severity?: string;
  status?: "draft" | "signed_off";
};

export type Competitor = {
  name: string;
  notes?: string;
  threat?: string;
  status?: "draft" | "signed_off";
};

export type ClaudeProposePayload = {
  next_steps: ProposedStepInput[];
  gap_items: Array<{ key?: string; title?: string; detail?: string; severity?: string }>;
  competitors: Array<{ name?: string; notes?: string; threat?: string }>;
};

export type DripCandidate = {
  key: string;
  prompt: string;
  audience: "owner" | "accountant" | "both";
  lastAskedAt: string | null;
  storedId?: string;
};

function asTrimmed(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function normalizeStepTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeStepTitle(a);
  const nb = normalizeStepTitle(b);
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

export function filterNewProposedSteps(
  incoming: ProposedStepInput[],
  existing: Array<{ title: string; status: string }>,
): ProposedStepInput[] {
  const open = existing.filter((s) => OPEN_STEP_STATUSES.has(s.status));
  if (open.length >= MAX_OPEN_PROPOSED_STEPS) return [];
  const out: ProposedStepInput[] = [];
  for (const step of incoming) {
    if (out.length >= MAX_NEW_STEPS_PER_CALL) break;
    if (open.length + out.length >= MAX_OPEN_PROPOSED_STEPS) break;
    const title = step.title.trim();
    if (!title) continue;
    if (open.some((e) => titlesSimilar(e.title, title))) continue;
    if (out.some((e) => titlesSimilar(e.title, title))) continue;
    out.push({
      title,
      rationale: step.rationale?.trim() || null,
      assumptions: Array.isArray(step.assumptions) ? step.assumptions : [],
    });
  }
  return out;
}

function slugGapKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "gap";
}

export function mergeDraftGapItems(
  existing: GapItem[],
  incoming: ClaudeProposePayload["gap_items"],
): { items: GapItem[]; added: number } {
  const items: GapItem[] = [...existing];
  let added = 0;
  for (const raw of incoming) {
    if (added >= MAX_NEW_GAP_DRAFTS) break;
    const title = asTrimmed(raw.title);
    if (!title) continue;
    const key = asTrimmed(raw.key) ?? slugGapKey(title);
    if (items.some((i) => i.key === key || i.title.toLowerCase() === title.toLowerCase())) continue;
    items.push({
      key,
      title,
      detail: asTrimmed(raw.detail),
      severity: asTrimmed(raw.severity),
      status: "draft",
    });
    added += 1;
  }
  return { items, added };
}

export function mergeDraftCompetitors(
  existing: Competitor[],
  incoming: ClaudeProposePayload["competitors"],
): { items: Competitor[]; added: number } {
  const items: Competitor[] = [...existing];
  let added = 0;
  for (const raw of incoming) {
    if (added >= MAX_NEW_COMPETITOR_DRAFTS) break;
    const name = asTrimmed(raw.name);
    if (!name) continue;
    if (items.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    items.push({
      name,
      notes: asTrimmed(raw.notes),
      threat: asTrimmed(raw.threat),
      status: "draft",
    });
    added += 1;
  }
  return { items, added };
}

export function asBrainSummaryObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === "string" && raw.trim()) return { body: raw.trim() };
  return {};
}

export function parseExistingGapItems(raw: unknown): GapItem[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const src = o.gap_report && typeof o.gap_report === "object" ? (o.gap_report as Record<string, unknown>) : o;
  const list = Array.isArray(src.items) ? src.items : [];
  const items: GapItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = asTrimmed(row.title);
    if (!title) continue;
    items.push({
      key: asTrimmed(row.key) ?? `gap-${items.length}`,
      title,
      detail: asTrimmed(row.detail),
      severity: asTrimmed(row.severity),
      status: row.status === "signed_off" ? "signed_off" : row.status === "draft" ? "draft" : undefined,
    });
  }
  return items;
}

export function parseExistingCompetitors(raw: unknown): Competitor[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.competitors) ? o.competitors : [];
  const out: Competitor[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      out.push({ name: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = asTrimmed(row.name);
    if (!name) continue;
    out.push({
      name,
      notes: asTrimmed(row.notes),
      threat: asTrimmed(row.threat),
      status: row.status === "signed_off" ? "signed_off" : row.status === "draft" ? "draft" : undefined,
    });
  }
  return out;
}

export function applyDraftBrainPatches(
  rawSummary: unknown,
  payload: Pick<ClaudeProposePayload, "gap_items" | "competitors">,
  nowIso: string,
): { blob: Record<string, unknown>; gapAdded: number; competitorAdded: number } {
  const blob = asBrainSummaryObject(rawSummary);
  const gap = mergeDraftGapItems(parseExistingGapItems(rawSummary), payload.gap_items);
  const competitors = mergeDraftCompetitors(parseExistingCompetitors(rawSummary), payload.competitors);
  if (gap.added > 0) {
    blob.gap_report = { items: gap.items, updated_at: nowIso };
  }
  if (competitors.added > 0) {
    blob.competitors = competitors.items;
  }
  return { blob, gapAdded: gap.added, competitorAdded: competitors.added };
}

export function extractJsonText(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export function parseClaudeProposePayload(raw: string): ClaudeProposePayload {
  const empty: ClaudeProposePayload = { next_steps: [], gap_items: [], competitors: [] };
  const jsonText = extractJsonText(raw);
  if (!jsonText) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return empty;
    }
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const o = parsed as Record<string, unknown>;
  const next_steps: ProposedStepInput[] = [];
  for (const step of Array.isArray(o.next_steps) ? o.next_steps : []) {
    if (!step || typeof step !== "object") continue;
    const title = asTrimmed((step as { title?: unknown }).title);
    if (!title) continue;
    const assumptionsRaw = (step as { assumptions?: unknown }).assumptions;
    const assumptions: unknown[] = [];
    if (Array.isArray(assumptionsRaw)) {
      assumptionsRaw.forEach((item, i) => {
        const text = typeof item === "string" ? asTrimmed(item) : asTrimmed((item as { text?: unknown })?.text);
        if (text) assumptions.push({ id: `a-${i}`, text, checked: false });
      });
    }
    next_steps.push({
      title,
      rationale: asTrimmed((step as { rationale?: unknown }).rationale) ?? null,
      assumptions,
    });
  }
  const gapRaw = Array.isArray(o.gap_items) ? o.gap_items : Array.isArray(o.gap_report) ? o.gap_report : [];
  const gap_items: ClaudeProposePayload["gap_items"] = [];
  for (const item of gapRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    gap_items.push({
      key: asTrimmed(row.key),
      title: asTrimmed(row.title),
      detail: asTrimmed(row.detail),
      severity: asTrimmed(row.severity),
    });
  }
  const competitors: ClaudeProposePayload["competitors"] = [];
  for (const item of Array.isArray(o.competitors) ? o.competitors : []) {
    if (typeof item === "string") {
      competitors.push({ name: asTrimmed(item) });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    competitors.push({
      name: asTrimmed(row.name),
      notes: asTrimmed(row.notes),
      threat: asTrimmed(row.threat),
    });
  }
  return { next_steps, gap_items, competitors };
}

export function isWithinDripCooldown(lastAskedAt: string | null, now: Date, days = DRIP_COOLDOWN_DAYS): boolean {
  if (!lastAskedAt) return false;
  const t = Date.parse(lastAskedAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < days * 86_400_000;
}

export function activeOwnerDrip(candidates: DripCandidate[], now: Date): DripCandidate | null {
  const active = candidates.filter((c) => isWithinDripCooldown(c.lastAskedAt, now));
  if (!active.length) return null;
  active.sort((a, b) => Date.parse(b.lastAskedAt ?? "") - Date.parse(a.lastAskedAt ?? ""));
  return active[0] ?? null;
}

export function pickNextOwnerDrip(candidates: DripCandidate[], now: Date): DripCandidate | null {
  if (activeOwnerDrip(candidates, now)) return null;
  const eligible = candidates.filter((c) => !isWithinDripCooldown(c.lastAskedAt, now));
  const neverAsked = eligible.filter((c) => !c.lastAskedAt);
  return (neverAsked[0] ?? eligible[0]) ?? null;
}

export function ownerDripCandidatesFromStored(
  rows: Array<{
    id: string;
    question_key: string;
    prompt_text: string | null;
    status: string;
    audience: string;
    last_asked_at: string | null;
  }>,
): DripCandidate[] {
  return rows
    .filter((r) => r.status === "unanswered" && (r.audience === "owner" || r.audience === "both"))
    .map((r) => ({
      key: r.question_key,
      prompt: r.prompt_text?.trim() || r.question_key,
      audience: r.audience === "owner" ? "owner" : "both",
      lastAskedAt: r.last_asked_at,
      storedId: r.id,
    }));
}
