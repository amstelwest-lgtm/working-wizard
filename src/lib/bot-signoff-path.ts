/**
 * After Milōn Bot drafts recommendations, action items, or a pack, the
 * accountant should land on the existing Action Plan or pack review surface.
 * This module only chooses that link. Sign-off stays on those pages.
 */

export type BotSignoffCta = {
  kind: "actions" | "pack";
  label: "Review Action Plan" | "Open for sign-off";
  state: string;
  tab: "plan" | "advisory";
  coach?: "actions";
};

const ACTION_TOOLS = new Set([
  "propose_next_steps",
  "create_action_plan",
  "create_task_from_recommendation",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasItems(created: Record<string, unknown> | null): boolean {
  if (!created) return false;
  return list(created.actionItemIds).length > 0 || list(created.items).length > 0;
}

function hasPack(created: Record<string, unknown> | null): boolean {
  if (!created) return false;
  if (typeof created.packId === "string" && created.packId) return true;
  if (created.draftInserted === true || created.draftAlreadyOpen === true) return true;
  if (typeof created.draftId === "string" && created.draftId) return true;
  return false;
}

function noteWork(name: string, status: unknown, happened: unknown, flags: {
  recommendations: boolean;
  tasks: boolean;
  needsHuman: boolean;
  pack: boolean;
}) {
  if (ACTION_TOOLS.has(name)) {
    const wrote = happened === true || status === "ok";
    if (name === "propose_next_steps" && wrote) flags.recommendations = true;
    if (name === "create_action_plan" && wrote) flags.tasks = true;
    if (name === "create_task_from_recommendation") {
      if (wrote) flags.tasks = true;
      if (status === "needs_human") flags.needsHuman = true;
    }
  }
  if ((name === "draft_deliverable" || name === "advisory_pack") && (happened === true || status === "ok")) {
    flags.pack = true;
  }
}

/**
 * CTAs for work the bot just left waiting on a person.
 * Empty, error, and read-only tool results produce none.
 */
export function botSignoffCtas(evidence: {
  tools?: unknown;
  created?: unknown;
  run?: unknown;
} | null | undefined): BotSignoffCta[] {
  if (!evidence) return [];
  const created = asRecord(evidence.created);
  const run = asRecord(evidence.run);
  const flags = {
    recommendations: false,
    tasks: hasItems(created),
    needsHuman: false,
    pack: hasPack(created),
  };

  for (const step of list(run?.trace)) {
    const row = asRecord(step);
    if (!row) continue;
    noteWork(typeof row.tool === "string" ? row.tool : "", row.status, row.happened, flags);
  }
  for (const tool of list(evidence.tools)) {
    const row = asRecord(tool);
    if (!row || typeof row.name !== "string") continue;
    noteWork(row.name, row.status, row.status === "ok" ? true : row.happened, flags);
  }

  const ctas: BotSignoffCta[] = [];
  if (flags.tasks || flags.recommendations || flags.needsHuman) {
    ctas.push({
      kind: "actions",
      label: flags.tasks && !flags.pack ? "Open for sign-off" : "Review Action Plan",
      state: flags.tasks
        ? "Action Plan items are waiting for your sign-off."
        : "Recommendations are waiting for your approval.",
      tab: "plan",
      coach: "actions",
    });
  }
  if (flags.pack) {
    ctas.push({
      kind: "pack",
      label: "Open for sign-off",
      state: "Advisory pack is waiting for your sign-off.",
      tab: "advisory",
    });
  }
  return ctas;
}

export function botSignoffStateLine(ctas: readonly BotSignoffCta[]): string {
  return ctas.map((cta) => cta.state).join(" ");
}

/** Search fields the accountant client route already understands. */
export function botSignoffDestination(
  cta: BotSignoffCta,
  why?: string | null,
): { tab: string; section?: "pack"; coach?: "actions"; why?: string } {
  // Pack sign-off stays on the pack section. ?tab=advisory now opens the drafter.
  const dest: { tab: string; section?: "pack"; coach?: "actions"; why?: string } =
    cta.tab === "advisory" ? { tab: "deliverables", section: "pack" } : { tab: cta.tab };
  if (cta.coach) dest.coach = cta.coach;
  const clean = (why ?? "").replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return dest;
  dest.why = clean.length <= 140 ? clean : `${clean.slice(0, 137).trimEnd()}…`;
  return dest;
}

export function botSignoffHref(clientId: string, cta: BotSignoffCta, why?: string | null): string {
  const dest = botSignoffDestination(cta, why);
  const params = new URLSearchParams();
  params.set("tab", dest.tab);
  if (dest.section) params.set("section", dest.section);
  if (dest.coach) params.set("coach", dest.coach);
  if (dest.why) params.set("why", dest.why);
  return `/clients/${encodeURIComponent(clientId)}?${params.toString()}`;
}
