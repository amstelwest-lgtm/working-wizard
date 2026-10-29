/**
 * MILŌN — Action Plan tab.
 * Turns analysis into assigned work, and assigned work into visible progress.
 *
 * Structure: goal header (gap-to-goal bar + pace marker) → financial drivers
 * strip → the table (inline editing, import from strategic moves, quick-add,
 * batch send) → three footer visuals (health donut, burn-up, owner load).
 *
 * Assignees never log in: tasks are emailed with tokenised links to /t/:token.
 * Health is derived, never typed. The pace marker — where a task *should* be
 * today — is the signature element and appears on every progress bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { browserAppUrl } from "@/lib/app-origin";
import { HEALTH_BAND_TABLE } from "@/lib/ratios";
import { stripMilonProjection } from "@/lib/milon-projection";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AddToPlanButton } from "@/components/add-to-plan-button";
import { OwnerSignoffMark } from "@/components/owner-signoff-mark";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { DEFAULT_PROFILE, useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { agentDisplayName, agentShortName } from "@/lib/milon-team";
import type { HealthScoreSnapshot } from "@/lib/health-snapshot";
import { settleWithin } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { handoffAssigneeName } from "@/lib/owner-handoff";
import { describeActionHandoff } from "@/lib/action-handoff";
import { handoffStillAwaitingRun } from "@/lib/agent-activity-poll";
import { AssignmentNotes, type AssignmentNoteRow } from "@/components/assignment-notes";
import { HandoffRunStatus } from "@/components/handoff-run-status";
import { HandToMenu, MoveHandTo } from "@/components/hand-to-menu";
import { DRAFT_NEEDS_OWNER, draftFindingLabel } from "@/hooks/owner-agent-ui";
import { OwnerDraftCard } from "@/components/owner-draft-card";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import {
  assignActionToPerson,
  assignmentNoteStillAwaited,
  clearAwaitingAssignmentNote,
  clearOptimisticHandoff,
  commitActionHandoff,
  loadActionHandoffRuns,
  optimisticNoteHidden,
  readOptimisticHandoffs,
  signedInActorLabel,
  stripSuppressedNotes,
  type ActionPlanRefreshDetail,
} from "@/lib/owner-handoff-client";
import { displayedAssignee, displayedHandoffRun, latestStoredAssignment, withPendingNote } from "@/lib/open-plan-home";
import { type AgentKey } from "@/lib/milon-team-feed";
import { downloadActionPlanPdf } from "@/lib/action-plan-pdf";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { useServerFn } from "@tanstack/react-start";
import { sendTransactionalEmail } from "@/lib/email/send";
import { useMarketFormat } from "@/contexts/market";
import { formatCalendarDay } from "@/lib/market/format";
import {
  actionOverdueInput,
  countActionPlan,
  currentQuarterLabel,
  defaultTargetDate,
  displayedPlanPeriod,
  displayedPlanTarget,
  formatActionPlanCounts,
} from "@/lib/action-plan-counts";
import { planConfidenceDisplay, planConfidencePercent, planPaceGapPoints } from "@/lib/plan-confidence-display";
import { practiceRoleLabel } from "@/lib/practice-access";
import { planAutomation, type ActionAutomationRow } from "@/lib/action-plan-automation";
import {
  actionDisplayTitle,
  actionPlanPillarTiles,
  moveFactorLabel,
  planGoalIsOverdue,
  type ActionPlanPillarTile,
} from "@/lib/strategic-moves";
import { CASH_FLOOR_REASON, interventionPlanSteps } from "@/lib/intervention-grounding";
import { actionPace, deriveActionHealth } from "@/lib/action-item-health";
import { ActionPlanAutomation } from "@/components/action-plan-automation";
import {
  createActionFromRecommendation,
  listRecommendations,
} from "@/lib/recommendations.functions";
import {
  expectedImpactLabel,
  isActionable,
  priorityLabel,
  type Recommendation,
} from "@/lib/recommendations";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  GripVertical,
  Lightbulb,
  Download,
  Link as LinkIcon,
  Loader2,
  Mail,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

// ── Brand (matches cash-forecast / waterfall) ────────────────────────────────
const GOLD = "#0B5FFF";
const GOLD_DARK = "#102A43";
const CARD_SHELL =
  "relative overflow-hidden border border-[#DBEAFE] bg-white shadow-[0_8px_24px_rgba(16,42,67,0.06)] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:shadow-none";
const GOLD_RULE =
  "pointer-events-none absolute left-0 top-0 h-1 w-full bg-[#0B5FFF]";
const INPUT_CLS =
  "border-amber-900/15 bg-white/70 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100";
const LABEL_CLS = "text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400";

// ── Types ────────────────────────────────────────────────────────────────────
type Status = "not_started" | "in_progress" | "done" | "blocked";
type Health = "on_track" | "at_risk" | "off_track" | "overdue" | "complete" | "not_started";

type Plan = {
  id: string;
  client_id: string;
  period_label: string;
  outcome_goal: string;
  why_statement: string | null;
  metric_name: string | null;
  metric_start: number | null;
  metric_target: number | null;
  metric_current: number | null;
  target_date: string;
  created_at: string;
};

type Item = {
  id: string;
  plan_id: string;
  client_id: string;
  seq: number;
  title: string;
  outcome_why: string | null;
  owner_id: string | null;
  due_date: string | null;
  status: Status;
  progress_pct: number;
  blocker_note: string | null;
  source: "strategic_move" | "manual";
  source_move_key: string | null;
  driver_key: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  owner_name?: string | null;
  owner_email?: string | null;
  health?: Health;
  days_remaining?: number | null;
  /** P0.7 — parent recommendation (FK + joined columns on action_items_v). */
  recommendation_id?: string | null;
  recommendation_title?: string | null;
  recommendation_status?: string | null;
  recommendation_metric?: string | null;
  recommendation_amount?: number | null;
};

type Employee = ActionPlanEmployee;

type PlanPickup = { id?: string; agent: AgentKey; status: string; at: string };

/** Keep each click's assignee, note, and queued run until that action's stored copy arrives. */
function applyOptimisticPlan(input: {
  items: Item[];
  notes: Record<string, AssignmentNoteRow[]>;
  pickups: Record<string, PlanPickup>;
}): {
  items: Item[];
  notes: Record<string, AssignmentNoteRow[]>;
  pickups: Record<string, PlanPickup>;
  awaitingIds: string[];
} {
  const pendings = readOptimisticHandoffs();
  if (pendings.length === 0) {
    return { ...input, notes: stripSuppressedNotes(input.notes), awaitingIds: [] };
  }
  let items = input.items;
  let notes = { ...input.notes };
  let pickups = { ...input.pickups };
  const awaitingIds: string[] = [];
  for (const pending of pendings) {
    // A click that has not stored its note yet must not become Handed to.
    if (pending.awaitingNote) {
      awaitingIds.push(pending.actionItemId);
      continue;
    }
    const currentNotes = notes[pending.actionItemId] ?? [];
    const mergedNotes = pending.note ? withPendingNote(currentNotes, pending.note) : currentNotes;
    const landed = Boolean(
      pending.note &&
        mergedNotes.some(
          (row) =>
            row.note === pending.note?.note &&
            row.at !== pending.note.at &&
            Date.parse(row.at) + 1500 >= Date.parse(pending.note.at),
        ),
    );
    if (landed) {
      clearOptimisticHandoff(pending.actionItemId);
      notes = {
        ...notes,
        [pending.actionItemId]: mergedNotes.filter((row) => row.at !== pending.since),
      };
      continue;
    }
    if (pending.note && !optimisticNoteHidden(pending.actionItemId, pending.since)) {
      notes = { ...notes, [pending.actionItemId]: mergedNotes };
    }
    items = items.map((item) =>
      item.id !== pending.actionItemId
        ? item
        : {
            ...item,
            owner_name: pending.assigneeName,
            owner_id: pending.agent ? null : item.owner_id,
            owner_email: pending.agent ? null : item.owner_email,
          },
    );
    const pickup = pickups[pending.actionItemId] ?? null;
    const shown = displayedHandoffRun(
      pickup,
      { agent: pending.agent, since: pending.since, runId: pending.runId },
      false,
    );
    if (pending.agent && shown && shown !== pickup) {
      pickups = {
        ...pickups,
        [pending.actionItemId]: {
          id: ("id" in shown ? shown.id : undefined) ?? pending.runId ?? undefined,
          agent: shown.agent,
          status: shown.status,
          at: shown.at ?? pending.since,
        },
      };
    }
  }
  return { items, notes: stripSuppressedNotes(notes), pickups, awaitingIds };
}
type Milestone = {
  id: string;
  action_item_id: string;
  week_no: number;
  label: string;
  is_done: boolean;
};
type EmailRecord = {
  id: string;
  action_item_id: string;
  email_type: string;
  status: string;
  sent_at: string | null;
  created_at: string;
};
type Update = {
  id: string;
  actor_type: string;
  actor_label: string;
  status_from: Status | null;
  status_to: Status | null;
  progress_from: number | null;
  progress_to: number | null;
  note: string | null;
  created_at: string;
};

export type StrategicMoveLite = {
  key: string;
  title: string;
  ratioName: string;
  impactLine?: string;
  health: number;
  /** Canonical pillar. The tile number is this score, not `health`. */
  pillarLabel?: string | null;
  pillarScore?: number | null;
};

interface Props {
  clientId: string;
  clientName?: string;
  simplified?: boolean;
  /** When false the UI is read-only: members cannot edit goals, add/delete actions, or send emails. */
  isOwner?: boolean;
  moves?: StrategicMoveLite[];
  /** Health pillars. Tile numbers come from here, including an unscored Cash pillar. */
  pillars?: readonly { id: ActionPlanPillarTile["id"]; score: number | null; note?: string | null }[];
  onViewAnalysis?: (driverKey?: string) => void;
  /** Move key whose Action Plan item should be highlighted/scrolled to on load. */
  focusMoveKey?: string | null;
  /** Called once the focus has been applied, so the parent can clear it. */
  onFocusHandled?: () => void;
  /** Accountant dashboard Chase links land with `?tab=plan&filter=overdue`. */
  initialFilter?: ActionPlanFilter;
  /** Same stamp the tab sign-off prints. Unsigned exports say Draft. */
  reviewSignoff?: ReportSignoffStamp | null;
  /** Titles already on the list, in stored order. The strip sentence uses them. */
  onAnswer?: (actions: readonly { title: string; status?: string | null }[]) => void;
  /** The strip's Add action uses this same focus. */
  onRegisterAdd?: (focus: () => void) => void;
  /**
   * Owner rail: the action list and the two progress graphs only.
   * Accountant pages leave this off, so their header, filters, and load chart stay.
   */
  ownerView?: boolean;
  /** Approved live row. Next moves stays here. A data request opens Accountant. */
  onOpenApproved?: (target: { table: string; recordId: string | null; screen: "moves" | "accountant" }) => void;
  /** 409 client_has_no_firm. The accountant page holds the invite. */
  onInviteAccountant?: () => void;
  /** Existing client has no owner on the file. Opens the shared invite dialog. */
  onInviteOwner?: () => void;
  /** Owner tab sign-off. Unsigned renders nothing. */
  ownerSignoff?: ClientReviewSignoff | null;
  ownerSignoffStale?: boolean;
  /** 13-week cash is under the floor and the opening is on file. */
  cashBelowFloor?: boolean;
  /** Open this finding on Drafts. Owner Next moves scrolls to the card when omitted. */
  onOpenDraft?: (draftId: string) => void;
  /** Finding to scroll into view. Set from `?draft=`. */
  focusDraftId?: string | null;
  /** Live scorecard ratios. Draft cards quote these, not a stored snapshot. */
  canonicalRatios?: Record<string, number> | null;
  /** Live pillars, overall, weakest, and statement period. */
  healthSnapshot?: HealthScoreSnapshot | null;
  /** Latest upload or ledger sync. A draft written after this is not stale. */
  figuresUpdatedAt?: string | null;
}

// ── Derived health (mirrors SQL action_item_health) ─────────────────────────
function deriveHealth(
  it: Pick<Item, "status" | "due_date" | "progress_pct" | "created_at">,
): Health {
  return deriveActionHealth(it);
}
/** actual progress ÷ expected progress by now. No due date is not a full pace. */
function paceOf(it: Pick<Item, "due_date" | "progress_pct" | "created_at">): number {
  return actionPace(it);
}
/** expected % complete today, for the pace marker */
function expectedPct(it: Pick<Item, "due_date" | "created_at">): number | null {
  if (!it.due_date) return null;
  const created = new Date(it.created_at).getTime();
  const due = new Date(it.due_date + "T23:59:59").getTime();
  if (due <= created) return 100;
  return Math.max(0, Math.min(100, ((Date.now() - created) / (due - created)) * 100));
}

const HEALTH_META: Record<Health, { label: string; color: string; bg: string }> = {
  on_track: { label: "On track", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  at_risk: { label: "At risk", color: "#B7791F", bg: "rgba(183,121,31,0.12)" },
  off_track: { label: "Off track", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  overdue: { label: "Overdue", color: "#ef4444", bg: "rgba(239,68,68,0.16)" },
  not_started: { label: "Not started", color: "#64748b", bg: "rgba(100,116,139,0.14)" },
  complete: { label: "Done", color: "#8a938c", bg: "rgba(138,147,140,0.15)" },
};
export function healthMeta(h?: string | null) {
  return h && h in HEALTH_META ? HEALTH_META[h as Health] : HEALTH_META.on_track;
}
export function driverHealthLabel(health: number) {
  return Number.isFinite(health) ? Math.round(health) : null;
}

/**
 * `owner_name`, `owner_email`, `health`, and `days_remaining` exist only on the
 * `action_items_v` view. PostgREST rejects them on `action_items` writes
 * ("Could not find the 'owner_name' column of 'action_items' in the schema cache").
 */
/** Newest action_updates note that records a bot handoff. Person assigns use a different note. */
export function handoffAssignee(note: string | null | undefined): string | null {
  return handoffAssigneeName(note);
}

export function toActionItemWrite(patch: Partial<Item>): Record<string, unknown> {
  const {
    owner_name: _ownerName,
    owner_email: _ownerEmail,
    health: _health,
    days_remaining: _daysRemaining,
    recommendation_title: _recTitle,
    recommendation_status: _recStatus,
    recommendation_metric: _recMetric,
    recommendation_amount: _recAmount,
    ...row
  } = patch;
  return row;
}

/**
 * action_items has unique(plan_id, seq). Bulk inserts must allocate consecutive
 * seqs from the current max — looping addItem() reuses a stale React snapshot
 * and collides on the second row.
 */
export function allocateActionSeqs(existing: { seq: number }[], count: number): number[] {
  if (count <= 0) return [];
  const start = existing.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

export type ActionPlanEmployee = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  /** Set when this row is a firm member with access on the client. */
  practiceUserId?: string | null;
};

export type PracticeTeamRow = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  user_id: string;
};

/** Rows from list_client_practice_team, ignoring a missing migration or a bad payload. */
export function practiceTeamRows(data: unknown): PracticeTeamRow[] {
  if (!Array.isArray(data)) return [];
  const rows: PracticeTeamRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    if (!id || !userId) continue;
    rows.push({
      id,
      name: typeof row.name === "string" ? row.name : "",
      email: typeof row.email === "string" ? row.email : null,
      role: typeof row.role === "string" ? row.role : null,
      user_id: userId,
    });
  }
  return rows;
}

/**
 * Union client employees with firm members who have access on this client.
 * Practice people win on the same id so the owner picker is not an empty
 * client_employees list when the only person is the practice owner.
 */
export function mergeActionPlanTeam(
  employees: ActionPlanEmployee[],
  practice: PracticeTeamRow[],
): ActionPlanEmployee[] {
  const merged = new Map<string, ActionPlanEmployee>();
  for (const employee of employees) merged.set(employee.id, { ...employee });
  for (const person of practice) {
    const prev = merged.get(person.id);
    merged.set(person.id, {
      id: person.id,
      name: (person.name || prev?.name || "Practice member").trim(),
      email: person.email ?? prev?.email ?? null,
      role: person.role ?? prev?.role ?? null,
      practiceUserId: person.user_id,
    });
  }
  return [...merged.values()].sort((a, b) => {
    const rank = (employee: ActionPlanEmployee) => (employee.practiceUserId ? 0 : 1);
    const byKind = rank(a) - rank(b);
    if (byKind !== 0) return byKind;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export type ActionPlanFilter = "all" | "overdue" | "at_risk" | "blocked" | "done";
export type ChaseEmailType = "nudge" | "overdue";

/** Deep-link `?filter=` from the accountant dashboard follow-up queue. */
export function parseActionPlanFilter(value: unknown): ActionPlanFilter | undefined {
  if (
    value === "overdue" ||
    value === "at_risk" ||
    value === "blocked" ||
    value === "done" ||
    value === "all"
  ) {
    return value;
  }
  return undefined;
}

/** Overdue work gets the overdue template; everything else still open gets a nudge. */
export function chaseEmailType(health?: string | null): ChaseEmailType {
  return health === "overdue" ? "overdue" : "nudge";
}

/** Open items whose owner has an email — ready for a chase/nudge. */
export function chaseableItems<
  T extends { status: string; owner_id: string | null; health?: string | null },
>(
  items: T[],
  emailByOwnerId:
    | Map<string, string | null | undefined>
    | Record<string, string | null | undefined>,
  onlyOverdue = false,
): T[] {
  const emailOf = (id: string) =>
    emailByOwnerId instanceof Map ? emailByOwnerId.get(id) : emailByOwnerId[id];
  return items.filter((i) => {
    if (i.status === "done") return false;
    if (onlyOverdue && i.health !== "overdue") return false;
    if (!i.owner_id) return false;
    return Boolean(emailOf(i.owner_id));
  });
}

export type StrategicMoveImportRow = {
  plan_id: string;
  client_id: string;
  seq: number;
  title: string;
  source: "strategic_move";
  source_move_key: string;
  driver_key: string;
  outcome_why: string;
};

export function buildStrategicMoveImportRows(opts: {
  keys: string[];
  moves: StrategicMoveLite[];
  alreadyImported: Set<string | null>;
  planId: string;
  clientId: string;
  existing: { seq: number }[];
}): StrategicMoveImportRow[] {
  const seen = new Set<string>();
  const toAdd: StrategicMoveLite[] = [];
  for (const k of opts.keys) {
    if (seen.has(k) || opts.alreadyImported.has(k)) continue;
    const mv = opts.moves.find((m) => m.key === k);
    if (!mv) continue;
    seen.add(k);
    toAdd.push(mv);
  }
  const seqs = allocateActionSeqs(opts.existing, toAdd.length);
  return toAdd.map((mv, i) => ({
    plan_id: opts.planId,
    client_id: opts.clientId,
    seq: seqs[i],
    title: mv.title,
    source: "strategic_move",
    source_move_key: mv.key,
    driver_key: mv.key,
    outcome_why: mv.impactLine ?? `Improves ${moveFactorLabel(mv)}.`,
  }));
}
const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

export { defaultTargetDate };

function PlanDateField({
  value,
  onChange,
  market,
  overdue = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  market: ReturnType<typeof useMarketFormat>["market"];
  overdue?: boolean;
}) {
  return (
    <label className="relative block" onClick={(e) => e.stopPropagation()}>
      <span
        className={`block px-1 py-1 text-xs font-medium tabular-nums ${overdue ? "font-bold text-[#ef4444]" : "text-slate-700 dark:text-slate-300"}`}
      >
        {value ? formatCalendarDay(value, market) : "—"}
      </span>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Due date"
      />
    </label>
  );
}

function isoDay(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function planTargetIsOverdue(targetDate: string, now = new Date()): boolean {
  const day = targetDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day < isoDay(now);
}
function itemScore(it: Item): number {
  const h = deriveHealth(it);
  if (h === "complete") return 1;
  if (h === "not_started") return 0;
  if (h === "overdue" || it.status === "blocked") return 0.2;
  return Math.max(0, Math.min(1, paceOf(it)));
}

// ═════════════════════════════════════════════════════════════════════════════
export default function ActionPlanPanel({
  clientId,
  clientName,
  simplified,
  isOwner = true,
  moves = [],
  pillars,
  onViewAnalysis,
  focusMoveKey,
  onFocusHandled,
  initialFilter,
  reviewSignoff = null,
  onAnswer,
  onRegisterAdd,
  ownerView = false,
  onOpenApproved,
  onInviteAccountant,
  onInviteOwner,
  ownerSignoff = null,
  ownerSignoffStale = false,
  cashBelowFloor = false,
  canonicalRatios = null,
  healthSnapshot = null,
  figuresUpdatedAt = null,
  onOpenDraft,
  focusDraftId = null,
}: Props) {
  const { market } = useMarketFormat();
  const account = useOptionalAccountantProfile();
  const profile = account?.profile ?? DEFAULT_PROFILE;
  const firms = account?.firms ?? [];
  const firmId = account?.firmId ?? null;
  const firmOwnerUserId = firms.find((firm) => firm.id === firmId)?.owner_user_id ?? null;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [filter, setFilter] = useState<ActionPlanFilter>(initialFilter ?? "all");
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"seq" | "due" | "owner" | "status">("seq");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // P0.7 — approved recommendations with no action yet: the default way in.
  const [recOpen, setRecOpen] = useState(false);
  const [pendingRecs, setPendingRecs] = useState<Recommendation[]>([]);
  const fetchRecommendations = useServerFn(listRecommendations);
  const actionFromRecommendation = useServerFn(createActionFromRecommendation);
  const [teamOpen, setTeamOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const seqMaxRef = useRef(0);
  // Per-item email summary: track last nudge/overdue chase and last failure independently
  const [lastNudgeEmails, setLastNudgeEmails] = useState<Record<string, EmailRecord>>({});
  const [lastFailedEmails, setLastFailedEmails] = useState<Record<string, EmailRecord>>({});
  const dragSeq = useRef<string | null>(null);
  // Item briefly highlighted after arriving from Next Moves → Assign
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<Record<string, Partial<Record<AgentKey, true>>>>({});
  const [liveHandoff, setLiveHandoff] = useState<Record<string, string>>({});
  const [pickups, setPickups] = useState<Record<string, { id?: string; agent: AgentKey; status: string; at: string }>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, AssignmentNoteRow[]>>({});
  const [notesReady, setNotesReady] = useState(false);
  /** Blank row from a click whose assignment note is not stored yet. Not a settled Hand to. */
  const [noteStillDue, setNoteStillDue] = useState<Record<string, true>>({});
  const draftActivity = useAgentActivity(clientId);
  const draftFindings = useMemo(
    () => draftActivity.findings.filter((row) => row.status === "approved" || draftFindingLabel(row) != null),
    [draftActivity.findings],
  );
  const handoffByItem = useMemo(() => {
    const out = new Map<string, ReturnType<typeof describeActionHandoff>>();
    for (const it of items) {
      out.set(
        it.id,
        describeActionHandoff({
          actionItemId: it.id,
          assignee: it.owner_name,
          sentAt: it.sent_at,
          notes: itemNotes[it.id] ?? [],
          storedRun: pickups[it.id] ?? null,
          runs: draftActivity.runs,
          findings: draftActivity.findings,
          findingsReady: !draftActivity.loading,
          market,
        }),
      );
    }
    return out;
  }, [items, itemNotes, pickups, draftActivity.runs, draftActivity.findings, draftActivity.loading, market]);
  useEffect(() => {
    const id = focusDraftId?.trim();
    if (!id) return;
    const node = document.querySelector(`[data-draft="${CSS.escape(id)}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "center" });
  }, [focusDraftId, draftFindings]);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const focusQuickAdd = useCallback(() => {
    quickAddRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    quickAddRef.current?.focus();
  }, []);
  useEffect(() => {
    onRegisterAdd?.(focusQuickAdd);
  }, [onRegisterAdd, focusQuickAdd]);

  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  // ── Load ───────────────────────────────────────────────────────────────────
  const planErrorLine = initialFilter === "overdue" ? "Couldn't load overdue actions." : "Couldn't load the plan.";
  const refresh = useCallback(async () => {
    try {
      const plansSettled = await settleWithin(
        supabase
          .from("action_plans")
          .select("*")
          .eq("client_id", clientId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1),
        SHELL_GATE_TIMEOUT_MS,
      );
      if (plansSettled.status !== "value") {
        setLoadError(planErrorLine);
        return;
      }
      const { data: plans, error: plansError } = plansSettled.value;
      if (plansError) {
        setLoadError(planErrorLine);
        return;
      }
      let p = (plans?.[0] as Plan) ?? null;
      if (!p) {
        // Members cannot create plans — show empty read-only state instead.
        if (!isOwner) return;
        const { data: created, error } = await supabase
          .from("action_plans")
          .insert({
            client_id: clientId,
            period_label: currentQuarterLabel(),
            outcome_goal: "Set your outcome goal for this quarter",
            target_date: defaultTargetDate(),
          })
          .select()
          .single();
        if (error) {
          // The other side may have created the active plan first — reload it
          // instead of toasting and leaving the accountant on an empty board.
          const { data: retry } = await supabase
            .from("action_plans")
            .select("*")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1);
          p = (retry?.[0] as Plan) ?? null;
          if (!p) {
            toast.error(error.message);
            return;
          }
        } else {
          p = created as Plan;
        }
      }
      setPlan(p);
      // Plan, items, and the assignee lists paint the board before notes,
      // hand-off runs, milestones, and mail, so the tab is not blank while
      // those follow. Runs stay on their own load, then pickups paint from them.
      const [itemsSettled, empsRes, practice] = await Promise.all([
        settleWithin(
          supabase.from("action_items_v").select("*").eq("plan_id", p.id).order("seq"),
          SHELL_GATE_TIMEOUT_MS,
        ),
        supabase
          .from("client_employees")
          .select("id,name,email,role")
          .eq("client_id", clientId)
          .order("name"),
        (async () => {
          // client_employees is the SME assignee list and is empty on a new firm
          // client. Firm members live on client_practice_access (deny-all RLS), so
          // the owner picker reads them through list_client_practice_team.
          try {
            const { data: practiceData, error: practiceErr } = await supabase.rpc(
              "list_client_practice_team" as never,
              { _client_id: clientId } as never,
            );
            if (practiceErr) return [] as PracticeTeamRow[];
            return practiceTeamRows(practiceData);
          } catch {
            return [] as PracticeTeamRow[];
          }
        })(),
      ]);
      if (itemsSettled.status !== "value" || itemsSettled.value.error) {
        setPlan(null);
        setLoadError(planErrorLine);
        return;
      }
      const itsRes = itemsSettled.value;
      const list = (itsRes.data ?? []) as Item[];
      setLoadError(null);
      setItems(list);
      setEmployees(mergeActionPlanTeam((empsRes.data ?? []) as Employee[], practice));
      setLoading(false);
      if (!list.length) setNotesReady(true);
      let shown = list;
      let loadedNotes: Record<string, AssignmentNoteRow[]> = {};
      let loadedPickups: Record<string, PlanPickup> = {};
      if (list.length) {
        const ids = list.map((item) => item.id);
        const [notesRes, runs] = await Promise.all([
          supabase
            .from("action_updates")
            .select("action_item_id,note,created_at,actor_label,actor_type")
            .in("action_item_id", ids)
            .order("created_at", { ascending: false }),
          loadActionHandoffRuns(ids),
        ]);
        const { data: notes, error: notesError } = notesRes;
        const grouped = new Map<string, AssignmentNoteRow[]>();
        for (const row of (notes ?? []) as {
          action_item_id?: string;
          note?: string | null;
          created_at?: string;
          actor_label?: string | null;
          actor_type?: string | null;
        }[]) {
          const id = row.action_item_id;
          if (!id) continue;
          const bucket = grouped.get(id) ?? [];
          bucket.push({
            note: row.note ?? null,
            at: row.created_at ?? "",
            actorLabel: row.actor_label ?? null,
            actorType: row.actor_type ?? null,
          });
          grouped.set(id, bucket);
        }
        shown = list.map((item) => {
          const stored = latestStoredAssignment(grouped.get(item.id) ?? []);
          if (stored?.kind === "bot") {
            return { ...item, owner_id: null, owner_name: stored.name, owner_email: null };
          }
          if (stored?.kind === "person") return { ...item, owner_name: stored.name };
          return item;
        });
        const noteState: Record<string, AssignmentNoteRow[]> = {};
        for (const [id, notes] of grouped) noteState[id] = notes;
        loadedNotes = noteState;
        if (!notesError) setNotesReady(true);
        const next: Record<string, PlanPickup> = {};
        for (const [id, run] of runs) next[id] = run;
        loadedPickups = next;
      }
      const painted = applyOptimisticPlan({ items: shown, notes: loadedNotes, pickups: loadedPickups });
      setItemNotes(stripSuppressedNotes(painted.notes));
      setItems(painted.items);
      setPickups(painted.pickups);
      const due: Record<string, true> = {};
      for (const item of painted.items) {
        const stored = latestStoredAssignment(painted.notes[item.id] ?? []);
        if (stored) {
          clearAwaitingAssignmentNote(item.id);
          continue;
        }
        if (assignmentNoteStillAwaited(clientId, item.id) || painted.awaitingIds.includes(item.id)) {
          due[item.id] = true;
        }
      }
      setNoteStillDue(due);
      if (list.length) {
        const ids = list.map((item) => item.id);
        const [{ data: ms }, { data: emails }] = await Promise.all([
          supabase.from("action_milestones").select("*").in("action_item_id", ids).order("week_no"),
          supabase
            .from("action_emails")
            .select("id,action_item_id,email_type,status,sent_at,created_at")
            .in("action_item_id", ids)
            .order("created_at", { ascending: false }),
        ]);
        setMilestones((ms ?? []) as Milestone[]);
        // Build two independent maps per item (emails are ordered newest-first)
        // nudgeMap: newest successfully delivered nudge/overdue (status != "failed")
        // failedMap: newest failed send of any type
        const nudgeMap: Record<string, EmailRecord> = {};
        const failedMap: Record<string, EmailRecord> = {};
        for (const e of (emails ?? []) as EmailRecord[]) {
          const id = e.action_item_id;
          if (
            !nudgeMap[id] &&
            (e.email_type === "nudge" || e.email_type === "overdue") &&
            e.status !== "failed"
          ) {
            nudgeMap[id] = e;
          }
          if (!failedMap[id] && e.status === "failed") {
            failedMap[id] = e;
          }
        }
        setLastNudgeEmails(nudgeMap);
        setLastFailedEmails(failedMap);
      } else {
        setMilestones([]);
        setLastNudgeEmails({});
        setLastFailedEmails({});
      }
    } catch (err) {
      console.error("[Action Plan] load failed", err);
      toast.error("Couldn't load the action plan. Try refresh.");
    } finally {
      setLoading(false);
    }
  }, [clientId, isOwner, ownerView, planErrorLine]);

  const assignToAgent = useCallback(
    async (item: Item, agent: AgentKey) => {
      const previous = {
        owner_id: item.owner_id ?? null,
        owner_name: item.owner_name ?? null,
        owner_email: item.owner_email ?? null,
      };
      const pending = `Handing to ${agentShortName(agent)}…`;
      setLiveHandoff((current) => ({ ...current, [item.id]: pending }));
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, owner_id: null, owner_name: pending, owner_email: null }
            : row,
        ),
      );
      const result = await commitActionHandoff({
        clientId,
        actionItemId: item.id,
        title: item.title,
        agent,
      });
      if (result.ok && result.reused) {
        setLiveHandoff((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        setItems((current) =>
          current.map((row) => (row.id === item.id ? { ...row, ...previous } : row)),
        );
        return;
      }
      if (!result.ok || result.noted !== true) {
        setLiveHandoff((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        setItems((current) =>
          current.map((row) => (row.id === item.id ? { ...row, ...previous } : row)),
        );
        if (!result.ok && result.comingSoon) {
          setComingSoon((current) => ({
            ...current,
            [item.id]: { ...current[item.id], [agent]: true },
          }));
        }
        toast.error(result.ok ? "Couldn't hand this over" : result.error);
        return;
      }
      const handed = agentDisplayName(agent);
      setLiveHandoff((current) => ({ ...current, [item.id]: handed }));
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, owner_name: handed } : row,
        ),
      );
      toast.success(`Handed to ${agentShortName(agent)}`);
      void refresh();
    },
    [clientId, refresh],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setNotesReady(false);
    setLoadTimedOut(false);
    const timer = window.setTimeout(() => {
      if (!live) return;
      setLoadTimedOut(true);
      setLoading(false);
    }, 10_000);
    void refresh().finally(() => {
      if (!live) return;
      window.clearTimeout(timer);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const planSnap = useRef({ items, notes: itemNotes, pickups });
  planSnap.current = { items, notes: itemNotes, pickups };
  const priorPlan = useRef(
    new Map<
      string,
      { since: string; item: Item | null; notes: AssignmentNoteRow[]; pickup: PlanPickup | null }
    >(),
  );
  const [handoffErrors, setHandoffErrors] = useState<Record<string, { message: string; agent: AgentKey | null }>>({});
  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ActionPlanRefreshDetail | undefined>).detail;
      if (detail?.failed && detail.actionItemId) {
        const id = detail.actionItemId;
        clearAwaitingAssignmentNote(id);
        setNoteStillDue((current) => {
          if (!current[id]) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
        const prior = priorPlan.current.get(id);
        if (prior && detail.since && prior.since === detail.since) {
          setItems((current) =>
            prior.item ? current.map((row) => (row.id === id ? prior.item! : row)) : current.filter((row) => row.id !== id),
          );
          setItemNotes((current) =>
            stripSuppressedNotes({
              ...current,
              [id]: (prior.notes ?? []).filter((row) => row.at !== detail.since),
            }),
          );
          setPickups((current) => {
            const next = { ...current };
            if (prior.pickup) next[id] = prior.pickup;
            else delete next[id];
            return next;
          });
        } else {
          setItemNotes((current) => stripSuppressedNotes(current));
        }
        if (detail.error) {
          setHandoffErrors((current) => ({
            ...current,
            [id]: { message: detail.error!, agent: detail.agent ?? null },
          }));
        }
        void refresh();
        return;
      }
      if (detail?.actionItemId && detail.reused) {
        const id = detail.actionItemId;
        clearAwaitingAssignmentNote(id);
        setNoteStillDue((current) => {
          if (!current[id]) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
        setHandoffErrors((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setItemNotes((current) =>
          stripSuppressedNotes({
            ...current,
            [id]: (current[id] ?? []).filter((row) => row.at !== detail.since),
          }),
        );
        if (detail.agent && detail.runId) {
          setPickups((current) => ({
            ...current,
            [id]: { id: detail.runId, agent: detail.agent as AgentKey, status: "queued", at: detail.since ?? "" },
          }));
        }
        void refresh();
        return;
      }
      if (detail?.actionItemId && detail.awaitingNote && !detail.committed) {
        const id = detail.actionItemId;
        setNoteStillDue((current) => ({ ...current, [id]: true }));
        void refresh();
        return;
      }
      if (detail?.committed && detail.actionItemId) {
        const id = detail.actionItemId;
        clearAwaitingAssignmentNote(id);
        setNoteStillDue((current) => {
          if (!current[id]) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
      if (detail?.since && detail.note && detail.assigneeName && detail.actionItemId && !detail.awaitingNote) {
        const id = detail.actionItemId;
        if (priorPlan.current.get(id)?.since !== detail.since) {
          const snap = planSnap.current;
          priorPlan.current.set(id, {
            since: detail.since,
            item: snap.items.find((row) => row.id === id) ?? null,
            notes: snap.notes[id] ?? [],
            pickup: snap.pickups[id] ?? null,
          });
        }
        setHandoffErrors((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setItemNotes((current) => ({
          ...current,
          [id]: withPendingNote(current[id] ?? [], detail.note!),
        }));
        setItems((current) =>
          current.map((row) =>
            row.id === id
              ? {
                  ...row,
                  owner_name: detail.assigneeName,
                  owner_id: detail.agent ? null : row.owner_id,
                  owner_email: detail.agent ? null : row.owner_email,
                }
              : row,
          ),
        );
        if (detail.agent) {
          setPickups((current) => ({
            ...current,
            [id]: {
              id: detail.runId,
              agent: detail.agent as AgentKey,
              status: "queued",
              at: detail.since ?? "",
            },
          }));
        }
      }
      void refresh();
    };
    window.addEventListener("milon-action-plan-refresh", onRefresh);
    return () => window.removeEventListener("milon-action-plan-refresh", onRefresh);
  }, [refresh]);

  // A reload during the gap has no open run, so the activity poll never arms.
  // Keep asking until the assignment note lands or the click expires.
  useEffect(() => {
    const ids = Object.keys(noteStillDue);
    if (ids.length === 0) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [noteStillDue, refresh]);

  const refreshedFinish = useRef(new Set<string>());
  useEffect(() => {
    let due = false;
    for (const run of draftActivity.runs) {
      const id = run.action_item_id;
      if (!id || (run.status !== "succeeded" && run.status !== "partial")) continue;
      const pickup = pickups[id];
      if (!pickup || pickup.agent !== run.agent) continue;
      if (pickup.id && pickup.id !== run.id) continue;
      if (pickup.status !== "queued" && pickup.status !== "running") continue;
      const key = `${id}:${run.id}`;
      if (refreshedFinish.current.has(key)) continue;
      refreshedFinish.current.add(key);
      due = true;
    }
    if (!due) return;
    const timer = window.setTimeout(() => void refresh(), 400);
    return () => window.clearTimeout(timer);
  }, [draftActivity.runs, pickups, refresh]);

  const exportPdf = async () => {
    setExportingPdf(true);
    try {
      await downloadActionPlanPdf({
        clientName: clientName ?? "Client",
        periodLabel: plan?.period_label, // date-ok: action plan quarter stamp, not a day range
        outcomeGoal: plan?.outcome_goal,
        items: items.map((item) => ({
          title: item.title,
          status: item.status,
          dueDate: item.due_date,
          outcomeWhy: stripMilonProjection(item.outcome_why),
          ownerName: item.owner_name,
        })),
        profile,
        reviewSignoff,
        market,
      });
      toast.success("Action Plan PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  // P0.7 — approved / edited recommendations not yet on the plan. Loaded
  // alongside items so the "Add from recommendations" path is the first thing
  // an owner sees, not something they have to go looking for.
  const refreshPendingRecs = useCallback(async () => {
    if (!clientId || !isOwner) {
      setPendingRecs([]);
      return;
    }
    try {
      const res = await fetchRecommendations({ data: { clientId } });
      setPendingRecs(
        res.recommendations.filter((r) => isActionable(r) && !r.linked_action_item_id),
      );
    } catch {
      setPendingRecs([]);
    }
  }, [clientId, isOwner, fetchRecommendations]);

  useEffect(() => {
    void refreshPendingRecs();
  }, [refreshPendingRecs, items.length]);

  const addFromRecommendations = async (ids: string[]) => {
    if (!clientId || ids.length === 0) return;
    let created = 0;
    for (const recommendationId of ids) {
      try {
        const res = await actionFromRecommendation({ data: { clientId, recommendationId } });
        if (res.ok) created += 1;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Could not create the action.");
      }
    }
    if (created > 0) {
      toast.success(
        created === 1
          ? "Action added from the recommendation"
          : `${created} actions added from recommendations`,
      );
      await refresh();
      await refreshPendingRecs();
    }
    setRecOpen(false);
  };

  // Owner and accountant share action_plans / action_items by client_id.
  // Refetch when the window is focused so a plan edited on the other side
  // is not stuck behind a stale in-memory snapshot.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    seqMaxRef.current = items.reduce((m, i) => Math.max(m, i.seq), 0);
  }, [items]);

  // Focus the item created from a Next Move (highlight + scroll into view)
  useEffect(() => {
    if (loading || !focusMoveKey) return;
    const target = items.find((i) => i.source_move_key === focusMoveKey);
    onFocusHandled?.();
    if (!target) return;
    setFocusedItemId(target.id);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-row-id="${target.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const t = setTimeout(() => setFocusedItemId(null), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, focusMoveKey, items.length]);

  // ── Mutation helpers ─────────────────────────────────────────────────────────
  const patchItem = async (id: string, patch: Partial<Item>, log?: Partial<Update>) => {
    const prev = items.find((i) => i.id === id);
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const { error } = await supabase
      .from("action_items")
      .update(toActionItemWrite(patch))
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      refresh();
      return;
    }
    if (log && prev) {
      await supabase.from("action_updates").insert({
        action_item_id: id,
        client_id: clientId,
        actor_type: "owner_app",
        actor_label: await signedInActorLabel(),
        status_from: prev.status,
        status_to: (patch.status as Status) ?? prev.status,
        progress_from: prev.progress_pct,
        progress_to: patch.progress_pct ?? prev.progress_pct,
        ...log,
      });
    }
  };

  const addItem = async (title: string, extra?: Partial<Item>) => {
    if (!plan) return;
    const seq = seqMaxRef.current + 1;
    seqMaxRef.current = seq;
    const { data, error } = await supabase
      .from("action_items")
      .insert({
        plan_id: plan.id,
        client_id: clientId,
        title,
        ...toActionItemWrite(extra ?? {}),
        seq,
      })
      .select()
      .single();
    if (error) {
      seqMaxRef.current = Math.max(0, seqMaxRef.current - 1);
      toast.error(error.message);
      return;
    }
    setItems((arr) => [...arr, data as Item]);
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Delete this action? Its link will stop working.")) return;
    setItems((arr) => arr.filter((i) => i.id !== id));
    setDrawerId(null);
    const { error } = await supabase.from("action_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      refresh();
    }
  };

  const addEmployee = async (name: string, email: string): Promise<Employee | null> => {
    const { data, error } = await supabase
      .from("client_employees")
      .insert({ client_id: clientId, name: name.trim(), email: email.trim() || null })
      .select("id,name,email,role")
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    setEmployees((arr) => [...arr, data as Employee]);
    return data as Employee;
  };

  const patchEmployee = async (id: string, patch: Partial<Pick<Employee, "name" | "email">>) => {
    const { error } = await supabase.from("client_employees").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    setEmployees((arr) => arr.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    return true;
  };

  const removeEmployee = async (id: string) => {
    if (employees.some((employee) => employee.id === id && employee.practiceUserId)) {
      toast.error("Practice access is managed in Team settings.");
      return;
    }
    if (!confirm("Remove this team member? Tasks they own stay on the plan, unassigned.")) return;
    const { error } = await supabase.from("client_employees").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEmployees((arr) => arr.filter((e) => e.id !== id));
    setItems((arr) =>
      arr.map((i) =>
        i.owner_id === id ? { ...i, owner_id: null, owner_name: null, owner_email: null } : i,
      ),
    );
  };

  // ── Send assignments ─────────────────────────────────────────────────────────
  const mintLink = async (
    itemId: string,
    action: "mint" | "reassign" = "mint",
    employeeId?: string,
  ) => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/task-admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sess.session?.access_token}`,
      },
      body: JSON.stringify({ action, action_item_id: itemId, employee_id: employeeId }),
    });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error ?? "link_failed");
    return browserAppUrl(`/t/${body.token}`);
  };

  const sendAssignment = async (
    it: Item,
    emailType: "assignment" | "nudge" | "overdue" = "assignment",
    preMintedUrl?: string,
  ) => {
    const owner = employees.find((e) => e.id === it.owner_id);
    if (!owner?.email) throw new Error(`${owner?.name ?? "Owner"} has no email`);
    const url = preMintedUrl ?? (await mintLink(it.id));
    const { data: u } = await supabase.auth.getUser();
    const ms = milestones.filter((m) => m.action_item_id === it.id);
    const now = new Date().toISOString();
    let sendOk = false;
    try {
      await sendTransactionalEmail({
        templateName: "action-task",
        recipientEmail: owner.email,
        idempotencyKey: `action-task-${it.id}-${emailType}-${Date.now()}`,
        templateData: {
          employeeName: owner.name.split(" ")[0],
          taskTitle: it.title,
          outcomeWhy: stripMilonProjection(it.outcome_why) || undefined,
          dueDate: it.due_date ?? undefined,
          market: { locale: market.locale, timezone: market.timezone },
          periodLabel: plan?.period_label, // date-ok: action plan quarter stamp, not a day range
          milestones: ms.map((m) => ({ week_no: m.week_no, label: m.label })),
          taskUrl: url,
          assignedBy: u.user?.email?.split("@")[0],
          clientName,
          emailType,
        },
      });
      sendOk = true;
    } catch {
      // Log the failure so the firm can see it in the drawer
      const { data: failedRecord } = await supabase
        .from("action_emails")
        .insert({
          action_item_id: it.id,
          client_id: clientId,
          recipient_email: owner.email,
          email_type: emailType,
          status: "failed",
          sent_at: now,
        })
        .select("id,action_item_id,email_type,status,sent_at,created_at")
        .single();
      if (failedRecord) {
        setLastFailedEmails((prev) => ({ ...prev, [it.id]: failedRecord as EmailRecord }));
      }
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard unavailable */
      }
      throw new Error(
        "Email sending isn't set up yet — the task link was copied to your clipboard instead. Share it with the employee directly.",
      );
    }
    if (sendOk) {
      const { data: sentRecord } = await supabase
        .from("action_emails")
        .insert({
          action_item_id: it.id,
          client_id: clientId,
          recipient_email: owner.email,
          email_type: emailType,
          status: "queued",
          sent_at: now,
        })
        .select("id,action_item_id,email_type,status,sent_at,created_at")
        .single();
      if (sentRecord && emailType !== "assignment") {
        setLastNudgeEmails((prev) => ({ ...prev, [it.id]: sentRecord as EmailRecord }));
      }
      await supabase.from("action_items").update({ sent_at: now }).eq("id", it.id);
      setItems((arr) => arr.map((i) => (i.id === it.id ? { ...i, sent_at: now } : i)));
    }
  };

  const unsent = items.filter((i) => !i.sent_at && i.status !== "done");
  const ready = unsent.filter(
    (i) => i.owner_id && i.due_date && employees.find((e) => e.id === i.owner_id)?.email,
  );
  const sendBatch = async () => {
    if (!ready.length) return;
    setSending(true);
    let ok = 0;
    for (const it of ready) {
      try {
        await sendAssignment(it);
        ok++;
      } catch (e: any) {
        toast.error(`${it.title}: ${e.message ?? e}`);
      }
    }
    setSending(false);
    if (ok) toast.success(`${ok} assignment${ok > 1 ? "s" : ""} sent`);
  };

  // ── Import from strategic moves ──────────────────────────────────────────────
  const importedKeys = useMemo(
    () => new Set(items.filter((i) => i.source_move_key).map((i) => i.source_move_key)),
    [items],
  );
  const suggestedMoves = ownerView
    ? moves.filter((move) => !importedKeys.has(move.key))
    : [];
  const importMoves = async (keys: string[]) => {
    if (!plan) return;
    const rows = buildStrategicMoveImportRows({
      keys,
      moves,
      alreadyImported: importedKeys,
      planId: plan.id,
      clientId,
      existing: items,
    });
    if (rows.length === 0) {
      setImportOpen(false);
      return;
    }
    const { data, error } = await supabase.from("action_items").insert(rows).select();
    if (error) {
      toast.error(error.message);
      return;
    }
    const created = (data ?? []) as Item[];
    setItems((arr) => [...arr, ...created]);
    seqMaxRef.current = rows.reduce((m, r) => Math.max(m, r.seq), seqMaxRef.current);
    toast.success(
      created.length === 1
        ? "Action added to the plan"
        : `${created.length} actions added to the plan`,
    );
    setImportOpen(false);
  };

  // ── Derived views ─────────────────────────────────────────────────────────────
  const enriched = useMemo(
    () =>
      items.map((i) => ({
        ...i,
        health: deriveActionHealth({ ...i, plan_target: plan?.target_date ?? null }),
      })),
    [items, plan?.target_date],
  );
  const planCounts = useMemo(
    () =>
      countActionPlan(
        items.map((item) =>
          actionOverdueInput({
            status: item.status,
            dueDate: item.due_date,
            createdAt: item.created_at,
            planTarget: plan?.target_date ?? null,
          }),
        ),
      ),
    [items, plan?.target_date],
  );
  const automation = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return planAutomation(
      enriched.map((item) => ({
        id: item.id,
        title: stripMilonProjection(item.title),
        ownerId: item.owner_id,
        ownerName: item.owner_name ?? null,
        dueDate: item.due_date,
        status: item.status,
        createdAt: item.created_at,
        lastNudgeAt: lastNudgeEmails[item.id]?.sent_at ?? null,
      })),
      employees.map((employee) => ({ id: employee.id, name: employee.name })),
      today,
    );
  }, [enriched, employees, lastNudgeEmails]);
  useEffect(() => {
    if (loading) return;
    onAnswer?.(items.map((item) => ({ title: stripMilonProjection(item.title), status: item.status })));
  }, [items, onAnswer, loading]);
  const filtered = useMemo(() => {
    let list = enriched;
    if (filter === "overdue") list = list.filter((i) => i.health === "overdue");
    else if (filter === "at_risk")
      list = list.filter((i) => i.health === "at_risk" || i.health === "off_track");
    else if (filter === "blocked") list = list.filter((i) => i.status === "blocked");
    else if (filter === "done") list = list.filter((i) => i.status === "done");
    if (ownerFilter) list = list.filter((i) => i.owner_id === ownerFilter);
    const by = [...list];
    if (sortBy === "due")
      by.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    else if (sortBy === "owner")
      by.sort((a, b) => (a.owner_name ?? "").localeCompare(b.owner_name ?? ""));
    else if (sortBy === "status") by.sort((a, b) => a.status.localeCompare(b.status));
    else by.sort((a, b) => a.seq - b.seq);
    return by;
  }, [enriched, filter, ownerFilter, sortBy]);

  const confidence = useMemo(() => {
    if (!enriched.length || !plan) return null;
    const average = Math.round(100 * (enriched.reduce((s, i) => s + itemScore(i), 0) / enriched.length));
    const gap = planPaceGapPoints(enriched, plan.created_at, plan.target_date);
    return planConfidencePercent(average, gap);
  }, [enriched, plan]);

  const healthCounts = useMemo(() => {
    const c: Record<Health, number> = {
      on_track: 0,
      at_risk: 0,
      off_track: 0,
      overdue: 0,
      not_started: 0,
      complete: 0,
    };
    enriched.forEach((i) => {
      const key = i.health && i.health in c ? i.health : "on_track";
      c[key]++;
    });
    return c;
  }, [enriched]);

  const emailByOwnerId = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const e of employees) map[e.id] = e.email;
    return map;
  }, [employees]);
  const overdueChaseReady = useMemo(
    () => chaseableItems(enriched, emailByOwnerId, true),
    [enriched, emailByOwnerId],
  );
  const chaseOverdue = async () => {
    if (!overdueChaseReady.length) return;
    setSending(true);
    let ok = 0;
    for (const it of overdueChaseReady) {
      try {
        await sendAssignment(it, "overdue");
        ok++;
      } catch (e: any) {
        toast.error(`${it.title}: ${e.message ?? e}`);
      }
    }
    setSending(false);
    if (ok) toast.success(`${ok} overdue reminder${ok > 1 ? "s" : ""} sent`);
  };

  // Drag reorder
  const onDropRow = async (targetId: string) => {
    const fromId = dragSeq.current;
    dragSeq.current = null;
    if (!fromId || fromId === targetId) return;
    const ordered = [...items].sort((a, b) => a.seq - b.seq);
    const fromIdx = ordered.findIndex((i) => i.id === fromId);
    const toIdx = ordered.findIndex((i) => i.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    // two-phase to dodge the (plan_id, seq) unique constraint
    setItems(ordered.map((i, idx) => ({ ...i, seq: idx + 1 })));
    for (let idx = 0; idx < ordered.length; idx++) {
      await supabase
        .from("action_items")
        .update({ seq: 1000 + idx })
        .eq("id", ordered[idx].id);
    }
    for (let idx = 0; idx < ordered.length; idx++) {
      await supabase
        .from("action_items")
        .update({ seq: idx + 1 })
        .eq("id", ordered[idx].id);
    }
    setSortBy("seq");
  };

  if (loading && !loadTimedOut) {
    return (
      <div className="rounded-xl border border-[#DBEAFE] bg-white p-8 text-sm font-semibold text-[#102A43]">
        Loading the plan…
      </div>
    );
  }
  if ((loadTimedOut || loadError) && !plan) {
    return (
      <div className="rounded-xl border border-[#DBEAFE] bg-white p-6 text-sm text-[#102A43]" role="alert">
        {loadError ?? planErrorLine}
      </div>
    );
  }
  if (!plan) {
    if (!isOwner) {
      return (
        <div className="rounded-xl border border-[#DBEAFE] bg-white p-8 text-center text-[#102A43] dark:border-slate-800 dark:bg-slate-900/50 dark:text-white">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            No action plan yet
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The owner hasn't set up an action plan for this period.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-[#DBEAFE] bg-white p-6 text-sm text-[#102A43]">
        Couldn't load the plan.
      </div>
    );
  }

  const drawerItem = drawerId ? (enriched.find((i) => i.id === drawerId) ?? null) : null;
  const interventionSteps = interventionPlanSteps(
    enriched
      .filter((item) => item.status !== "done")
      .map((item) => actionDisplayTitle(stripMilonProjection(item.title))),
    cashBelowFloor,
  );
  const automationById = new Map(automation.rows.map((row) => [row.id, row]));

  return (
    <div id="wizard-action-plan" className="space-y-5">
      {ownerView ? null : (
      <GoalHeader
        plan={plan}
        confidence={confidence}
        isOwner={isOwner}
        onChange={async (patch) => {
          setPlan({ ...plan, ...patch });
          const { error } = await supabase.from("action_plans").update(patch).eq("id", plan.id);
          if (error) toast.error(error.message);
        }}
      />
      )}

      {!ownerView && pillars && pillars.length > 0 && (
        <DriversStrip tiles={actionPlanPillarTiles(pillars, moves)} onView={onViewAnalysis} />
      )}

      {interventionSteps.length > 0 ? (
        <section
          data-intervention-plan
          className="rounded-xl border border-[#DBEAFE] bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#102A43] dark:text-[#0B5FFF]/80">
            Intervention plan
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {cashBelowFloor
              ? `Critical reason: ${CASH_FLOOR_REASON}.`
              : "Same open actions as the list below."}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-800 dark:text-slate-200">
            {interventionSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ── The table ── */}
      <Card id="wizard-action-list" className={CARD_SHELL}>
        <div className={GOLD_RULE} />
        <CardHeader className="border-b border-[#DBEAFE] pb-4 dark:border-slate-800">
          <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                Actions
              </CardTitle>
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                {formatActionPlanCounts(planCounts)}
              </span>
            </div>
            {ownerView ? (
              <OwnerSignoffMark signoff={ownerSignoff} isStale={ownerSignoffStale} />
            ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="action-plan-export-pdf"
                type="button"
                size="sm"
                variant="outline"
                className={`h-7 gap-1.5 px-2.5 text-[11px] ${INPUT_CLS}`}
                disabled={exportingPdf}
                onClick={() => void exportPdf()}
              >
                <Download className="h-3 w-3" />
                {exportingPdf ? "Preparing…" : "Export PDF"}
              </Button>
            {isOwner && (
              <div className="flex flex-wrap items-center gap-2">
                {pendingRecs.length > 0 && (
                  <Button
                    size="sm"
                    className="bg-[#0B5FFF] text-white hover:bg-[#2563EB] dark:bg-[#0B5FFF] dark:text-slate-950 dark:hover:bg-[#2563EB]"
                    onClick={() => setRecOpen(true)}
                    data-add-from-recommendations={pendingRecs.length}
                  >
                    <Lightbulb className="mr-1 h-3.5 w-3.5" />
                    Add from recommendations ({pendingRecs.length})
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className={INPUT_CLS}
                  onClick={focusQuickAdd}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add action
                </Button>
                {moves.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={INPUT_CLS}
                    onClick={() => setImportOpen(true)}
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5 text-[#102A43] dark:text-[#0B5FFF]" />
                    Import from Strategic Moves
                  </Button>
                )}
                {unsent.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ready.length || sending}
                    onClick={sendBatch}
                    className={INPUT_CLS}
                  >
                    {sending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1 h-3.5 w-3.5" />
                    )}
                    {ready.length === unsent.length
                      ? `Send ${ready.length} assignment${ready.length === 1 ? "" : "s"}`
                      : `${ready.length} of ${unsent.length} ready to send`}
                  </Button>
                )}
                {overdueChaseReady.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sending}
                    onClick={chaseOverdue}
                    className={`${INPUT_CLS} border-[#ef4444]/40 text-[#ef4444] hover:bg-[#ef4444]/10`}
                  >
                    {sending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mail className="mr-1 h-3.5 w-3.5" />
                    )}
                    Chase {overdueChaseReady.length} overdue
                  </Button>
                )}
              </div>
            )}
            </div>
            )}
          </div>
          {ownerView ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#102A43] dark:text-slate-200">
              Show
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as ActionPlanFilter)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${INPUT_CLS}`}
              >
                <option value="all">All</option>
                <option value="overdue">Overdue</option>
                <option value="at_risk">At risk</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </label>
            <span className="mx-1 h-4 w-px bg-amber-900/15 dark:bg-slate-700" />
            <select
              value={ownerFilter ?? ""}
              onChange={(e) => setOwnerFilter(e.target.value || null)}
              className={`rounded-md border px-2 py-1 text-[11px] ${INPUT_CLS}`}
            >
              <option value="">All owners</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            {isOwner && (
              <Button
                size="sm"
                variant="outline"
                className={`h-7 px-2 text-[11px] ${INPUT_CLS}`}
                onClick={() => setTeamOpen(true)}
              >
                <Users className="mr-1 h-3 w-3 text-[#102A43] dark:text-[#0B5FFF]" />
                Team members
              </Button>
            )}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className={`rounded-md border px-2 py-1 text-[11px] ${INPUT_CLS}`}
            >
              <option value="seq">Manual order</option>
              <option value="due">Sort: due date</option>
              <option value="owner">Sort: owner</option>
              <option value="status">Sort: status</option>
            </select>
          </div>
          )}
          {filter === "overdue" && healthCounts.overdue > 0 && (
            <p className="mt-3 rounded-md border border-[#ef4444]/25 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#b45309] dark:text-[#fbbf24]">
              Showing overdue work. Open an item to send a chase, or use Chase overdue to remind
              every owner with an email on file.
            </p>
          )}
        </CardHeader>
        <CardContent className="px-0 pb-2 pt-0">
          <ActionPlanAutomation
            rows={automation.rows}
            duplicates={automation.duplicates}
            contradictions={automation.contradictions}
            canEdit={isOwner}
            onConfirm={(row) => {
              const item = items.find((entry) => entry.id === row.id);
              if (!item) return;
              if (row.dueSuggested && row.dueDate) {
                void patchItem(row.id, { due_date: row.dueDate }, { note: "Confirmed suggested due date" });
              }
              if (row.ownerSuggested && row.owner?.kind === "team") {
                void patchItem(
                  row.id,
                  { owner_id: row.owner.id, owner_name: row.owner.name },
                  { note: `Confirmed suggestion: ${row.owner.name}` },
                );
              } else if (row.ownerSuggested && row.owner?.kind === "bot") {
                void assignToAgent(item, row.owner.id);
              }
            }}
            onDrop={(id, note) => {
              void patchItem(id, { status: "done" }, { note });
            }}
            onInviteOwner={onInviteOwner}
          />
          {filtered.length === 0 && (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {items.length === 0
                  ? pendingRecs.length > 0
                    ? `No actions yet. ${pendingRecs.length} approved ${
                        pendingRecs.length === 1 ? "recommendation is" : "recommendations are"
                      } waiting to become dated, owned work.`
                    : "No actions yet. Start from an approved recommendation, add one manually, or import from Strategic Moves."
                  : filter === "overdue"
                    ? "Nothing is overdue."
                    : "Nothing matches this filter."}
              </p>
              {isOwner && items.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className={`mt-3 ${INPUT_CLS}`}
                  onClick={() => (pendingRecs.length > 0 ? setRecOpen(true) : focusQuickAdd())}
                >
                  {pendingRecs.length > 0 ? (
                    <>
                      <Lightbulb className="mr-1 h-3.5 w-3.5" />
                      Add from recommendations
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add action
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
          <div>
            {filtered.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                focused={it.id === focusedItemId}
                employees={employees}
                milestones={milestones.filter((m) => m.action_item_id === it.id)}
                lastNudge={lastNudgeEmails[it.id] ?? null}
                lastFailed={lastFailedEmails[it.id] ?? null}
                draggable={isOwner && sortBy === "seq"}
                isOwner={isOwner}
                onDragStart={() => {
                  dragSeq.current = it.id;
                }}
                onDrop={() => onDropRow(it.id)}
                onOpen={() => setDrawerId(it.id)}
                onPatch={(patch, log) => patchItem(it.id, patch, log)}
                firmOwnerUserId={firmOwnerUserId}
                onAddEmployee={addEmployee}
                onManageTeam={() => {
                  setDrawerId(null);
                  setTeamOpen(true);
                }}
                comingSoon={comingSoon[it.id]}
                notes={handoffByItem.get(it.id)?.notes ?? itemNotes[it.id] ?? []}
                assigneeOverride={liveHandoff[it.id] ?? null}
                handoffPending={!notesReady}
                noteStillDue={Boolean(noteStillDue[it.id])}
                phasePending={!notesReady || draftActivity.loading}
                phaseLabel={handoffByItem.get(it.id)?.phaseLabel ?? null}
                draftId={handoffByItem.get(it.id)?.draftId ?? null}
                onOpenDraft={onOpenDraft}
                pickupLabel={handoffByItem.get(it.id)?.caption ?? null}
                pickupRun={handoffByItem.get(it.id)?.run ?? null}
                handoffError={handoffErrors[it.id]?.message ?? null}
                onRetry={(() => {
                  const agent = handoffErrors[it.id]?.agent ?? pickups[it.id]?.agent ?? handoffByItem.get(it.id)?.run?.agent;
                  if (!agent) return undefined;
                  return () => {
                    void commitActionHandoff({
                      clientId,
                      actionItemId: it.id,
                      title: it.title,
                      agent,
                    }).then((result) => {
                      if (!result.ok || result.noted !== true) {
                        toast.error(result.ok ? "Couldn't hand this over" : result.error);
                        return;
                      }
                      toast.success(`Handed to ${agentShortName(agent)}`);
                    });
                  };
                })()}
                suggestion={automationById.get(it.id) ?? null}
                onHandOff={isOwner ? (agent) => void assignToAgent(it, agent) : undefined}
                onAssignPerson={(person) => {
                  void assignActionToPerson({
                    clientId,
                    actionItemId: it.id,
                    personId: person.id,
                    personName: person.name,
                    title: it.title,
                  }).then((result) => {
                    if (!result.ok) toast.error(result.error);
                    else toast.success(`Assigned to ${person.name}`);
                  });
                }}
              />
            ))}
          </div>
          {isOwner && <QuickAdd inputRef={quickAddRef} onAdd={(title) => addItem(title)} />}
        </CardContent>
      </Card>

      {ownerView && draftFindings.length > 0 ? (
        <section
          className="space-y-2"
          data-owner-drafts={
            draftFindings.some((row) => draftFindingLabel(row) === DRAFT_NEEDS_OWNER) ? "actions" : "readonly"
          }
        >
          <h2 className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Drafts
          </h2>
          <ul className="space-y-2">
            {draftFindings.map((row, index) => (
              <OwnerDraftCard
                key={row.id}
                layout="moves"
                row={row}
                canonicalRatios={canonicalRatios}
                health={healthSnapshot}
                figuresUpdatedAt={figuresUpdatedAt}
                primary={index === 0}
                onOpen={onOpenApproved}
                onInvite={onInviteAccountant}
                onRefresh={draftActivity.refresh}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {ownerView && suggestedMoves.length > 0 ? (
        <section className="space-y-2" data-owner-suggestions="true">
          <h2 className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Suggested by {agentDisplayName("advisor")}
          </h2>
          <ul className="space-y-2">
            {suggestedMoves.map((move) => (
              <li
                key={move.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900/10 bg-white/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/50"
              >
                <span className="line-clamp-2 min-w-0 flex-1 basis-full text-sm font-semibold text-slate-900 dark:text-slate-100 sm:basis-auto">{actionDisplayTitle(move.title)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <MoveHandTo
                    clientId={clientId}
                    moveKey={move.key}
                    title={move.title}
                    outcomeWhy={move.impactLine}
                    onOpenDraft={onOpenDraft}
                  />
                  <AddToPlanButton
                    clientId={clientId}
                    moveKey={move.key}
                    title={move.title}
                    outcomeWhy={move.impactLine}
                    onAssign={() => void refresh()}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Footer visuals ── */}
      {enriched.length > 0 && (
        <div className={ownerView ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 md:grid-cols-3"}>
          <HealthDonut
            counts={healthCounts}
            total={enriched.length}
            onPick={
              ownerView
                ? () => undefined
                : (h) => {
                    setFilter(
                      h === "overdue"
                        ? "overdue"
                        : h === "at_risk" || h === "off_track"
                          ? "at_risk"
                          : h === "complete"
                            ? "done"
                            : "all",
                    );
                  }
            }
          />
          <BurnUp plan={plan} items={enriched} confidence={confidence} />
          {ownerView ? null : (
            <OwnerLoad items={enriched} employees={employees} onPick={setOwnerFilter} />
          )}
        </div>
      )}

      {importOpen && (
        <ImportPanel
          moves={moves}
          importedKeys={importedKeys}
          onClose={() => setImportOpen(false)}
          onImport={importMoves}
        />
      )}

      {recOpen && (
        <FromRecommendationsPanel
          recommendations={pendingRecs}
          onClose={() => setRecOpen(false)}
          onAdd={addFromRecommendations}
        />
      )}

      {teamOpen && (
        <TeamPanel
          employees={employees}
          firmOwnerUserId={firmOwnerUserId}
          onClose={() => setTeamOpen(false)}
          onAdd={addEmployee}
          onPatch={patchEmployee}
          onRemove={removeEmployee}
        />
      )}

      {drawerItem && (
        <ItemDrawer
          item={drawerItem}
          employees={employees}
          milestones={milestones.filter((m) => m.action_item_id === drawerItem.id)}
          isOwner={isOwner}
          onClose={() => setDrawerId(null)}
          onPatch={(patch, log) => patchItem(drawerItem.id, patch, log)}
          onDelete={() => deleteItem(drawerItem.id)}
          onResend={async () => {
            try {
              await sendAssignment(drawerItem);
              toast.success("Link re-sent");
            } catch (e: any) {
              toast.error(e.message ?? String(e));
            }
          }}
          onChase={async () => {
            const type = chaseEmailType(drawerItem.health);
            try {
              await sendAssignment(drawerItem, type);
              toast.success(type === "overdue" ? "Overdue reminder sent" : "Nudge sent");
            } catch (e: any) {
              toast.error(e.message ?? String(e));
            }
          }}
          onCopyLink={async () => {
            try {
              const url = await mintLink(drawerItem.id);
              await navigator.clipboard.writeText(url);
              toast.success("Task link copied — share it with the employee");
            } catch (e: any) {
              toast.error(e.message ?? String(e));
            }
          }}
          onReassign={async (empId) => {
            const emp = employees.find((e) => e.id === empId);
            const old = employees.find((e) => e.id === drawerItem.owner_id);
            if (!emp) return;
            if (
              old &&
              !confirm(`${old.name}'s link will stop working. Send ${emp.name} a new one?`)
            )
              return;
            try {
              const newUrl = await mintLink(drawerItem.id, "reassign", empId);
              setItems((arr) =>
                arr.map((i) =>
                  i.id === drawerItem.id
                    ? {
                        ...i,
                        owner_id: empId,
                        owner_name: emp.name,
                        owner_email: emp.email,
                        sent_at: null,
                      }
                    : i,
                ),
              );
              if (emp.email) {
                await sendAssignment({ ...drawerItem, owner_id: empId }, "assignment", newUrl);
                toast.success(`Reassigned & emailed ${emp.name}`);
              } else toast.success(`Reassigned to ${emp.name} (no email on file)`);
            } catch (e: any) {
              toast.error(e.message ?? String(e));
            }
          }}
          onMilestonesChanged={refresh}
        />
      )}
    </div>
  );
}

// ═══ Goal header ═════════════════════════════════════════════════════════════
function GoalHeader({
  plan,
  confidence,
  isOwner = true,
  onChange,
}: {
  plan: Plan;
  confidence: number | null;
  isOwner?: boolean;
  onChange: (patch: Partial<Plan>) => void;
}) {
  const { number, market } = useMarketFormat();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan);
  useEffect(
    () =>
      setDraft({
        ...plan,
        outcome_goal: stripMilonProjection(plan.outcome_goal),
        why_statement: stripMilonProjection(plan.why_statement),
      }),
    [plan],
  );

  const shownTarget = displayedPlanTarget(
    plan.target_date,
    stripMilonProjection(plan.outcome_goal),
  );
  const goalOverdue = planGoalIsOverdue(
    stripMilonProjection(plan.outcome_goal),
    shownTarget,
    isoDay(new Date()),
  );
  const { metric_start: s, metric_target: t, metric_current: c } = plan;
  const hasBar = s != null && t != null && t !== s;
  const pct = hasBar ? Math.max(0, Math.min(100, (((c ?? s) - s!) / (t! - s!)) * 100)) : 0;
  const timePct = (() => {
    const start = new Date(plan.created_at).getTime();
    const end = new Date(plan.target_date + "T23:59:59").getTime();
    if (end <= start) return 100;
    return Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100));
  })();

  return (
    <Card id="wizard-action-goal" className={CARD_SHELL}>
      <div className={GOLD_RULE} />
      <CardContent className="pt-6">
        <div className="action-goal-head flex flex-wrap items-start justify-between gap-4">
          <div className="action-goal-copy min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-[#102A43] dark:text-[#0B5FFF]/80">
                {displayedPlanPeriod(
                  plan.period_label, // date-ok: action plan quarter stamp, not a day range
                  stripMilonProjection(plan.outcome_goal),
                )} · Outcome goal
              </span>
              {isOwner && (
                <button
                  className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-[#102A43] dark:hover:text-[#0B5FFF]"
                  onClick={() => setEditing((e) => !e)}
                >
                  {editing ? "Close" : "Edit"}
                </button>
              )}
            </div>
            {!editing ? (
              <>
                <h2 className="mt-2 text-2xl font-black uppercase leading-tight tracking-tight text-slate-950 dark:text-white">
                  {stripMilonProjection(plan.outcome_goal)}
                  {goalOverdue ? (
                    <span
                      data-goal-overdue=""
                      className="ml-2 inline-flex align-middle rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
                    >
                      Overdue
                    </span>
                  ) : null}
                </h2>
                {stripMilonProjection(plan.why_statement) ? (
                  <p className="mt-1.5 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                    {stripMilonProjection(plan.why_statement)}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                  Target {formatCalendarDay(shownTarget, market)}
                  {goalOverdue ? (
                    <span className="ml-2 font-semibold text-rose-600 dark:text-rose-400">Target date has passed</span>
                  ) : null}
                </p>
              </>
            ) : (
              <div className="mt-3 grid max-w-2xl gap-2.5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className={LABEL_CLS}>Period</div>
                    <Input
                      className={INPUT_CLS}
                      value={draft.period_label} // date-ok: editable plan quarter, not a day range
                      onChange={(e) => setDraft({ ...draft, period_label: e.target.value })}
                    />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Target date</div>
                    <PlanDateField
                      value={draft.target_date}
                      market={market}
                      onChange={(next) => setDraft({ ...draft, target_date: next ?? "" })}
                    />
                  </div>
                </div>
                <div>
                  <div className={LABEL_CLS}>Outcome goal</div>
                  <Input
                    className={INPUT_CLS}
                    value={draft.outcome_goal}
                    onChange={(e) => setDraft({ ...draft, outcome_goal: e.target.value })}
                  />
                </div>
                <div>
                  <div className={LABEL_CLS}>Why (first principles)</div>
                  <Input
                    className={INPUT_CLS}
                    value={draft.why_statement ?? ""}
                    onChange={(e) => setDraft({ ...draft, why_statement: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div>
                    <div className={LABEL_CLS}>Metric</div>
                    <Input
                      className={INPUT_CLS}
                      placeholder="Cash on hand"
                      value={draft.metric_name ?? ""}
                      onChange={(e) => setDraft({ ...draft, metric_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Start</div>
                    <Input
                      className={INPUT_CLS}
                      type="number"
                      value={draft.metric_start ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          metric_start: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Current</div>
                    <Input
                      className={INPUT_CLS}
                      type="number"
                      value={draft.metric_current ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          metric_current: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Target</div>
                    <Input
                      className={INPUT_CLS}
                      type="number"
                      value={draft.metric_target ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          metric_target: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <Button
                    size="sm"
                    className="bg-[#0B5FFF] text-white hover:bg-[#2563EB] dark:bg-[#0B5FFF] dark:text-white"
                    onClick={() => {
                      onChange(draft);
                      setEditing(false);
                    }}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Save goal
                  </Button>
                </div>
              </div>
            )}
          </div>
          {confidence != null && (
            <div className="shrink-0 rounded-xl border border-[#DBEAFE] bg-white px-5 py-3 text-center dark:border-slate-800 dark:bg-slate-900/50">
              <div className={LABEL_CLS}>Plan confidence</div>
              {(() => {
                const shown = planConfidenceDisplay(confidence);
                return (
                  <>
                    <div
                      className={`mt-0.5 text-3xl font-black tabular-nums tracking-tight text-[#102A43] dark:text-white ${shown.hint ? "text-slate-400 dark:text-slate-500" : ""}`}
                    >
                      {shown.value}
                    </div>
                    {shown.hint ? (
                      <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        {shown.hint}
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Gap-to-goal bar with pace marker */}
        {hasBar && (
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span>
                {plan.metric_name ?? "Metric"}: {number(s!)}
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {number((c ?? s)!)}
              </span>
              <span>Target {number(t!)}</span>
            </div>
            <div className="relative h-3 overflow-visible rounded-full bg-amber-900/10 dark:bg-slate-800">
              <div
                className="h-3 rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD})`,
                }}
              />
              {/* pace marker — where you SHOULD be today */}
              <div
                className="absolute -top-1 h-5 w-0.5 bg-slate-700 dark:bg-slate-300"
                style={{ left: `${timePct}%` }}
                title="Where you should be today"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              The dark tick is where you should be today.{" "}
              {pct >= timePct ? (
                <span className="font-semibold text-[#22c55e]">Ahead of pace.</span>
              ) : (
                <span className="font-semibold text-[#ef4444]">
                  Behind pace — the gap is the work below.
                </span>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══ Drivers strip ═══════════════════════════════════════════════════════════
function DriversStrip({
  tiles,
  onView,
}: {
  tiles: readonly ActionPlanPillarTile[];
  onView?: (k?: string) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => {
        const score = tile.score;
        const sub = score == null ? tile.note : tile.factor;
        const tone =
          score == null
            ? "#94a3b8"
            : score >= HEALTH_BAND_TABLE.healthyMin
              ? "#22c55e"
              : score >= HEALTH_BAND_TABLE.watchMin
                ? "#B7791F"
                : "#ef4444";
        return (
          <button
            key={tile.id}
            onClick={() => onView?.(tile.moveKey ?? tile.id)}
            className="group rounded-xl border border-[#DBEAFE] bg-white px-3.5 py-3 text-left transition-colors hover:border-[#0B5FFF]/40 dark:border-slate-800 dark:bg-slate-900/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-[0.12em] text-[#3D5270] dark:text-slate-400">
                {tile.label}
              </span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
            </div>
            <div className="mt-1 text-lg font-extrabold tabular-nums tracking-tight text-slate-950 dark:text-white">
              {score != null ? score : <span className="text-slate-400">—</span>}
            </div>
            {sub ? (
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">{sub}</div>
            ) : null}
            <div className="mt-0.5 flex items-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 group-hover:text-[#102A43] dark:group-hover:text-[#0B5FFF]">
              View full analysis <ChevronRight className="h-3 w-3" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ═══ Table row ═══════════════════════════════════════════════════════════════
function ItemRow({
  item,
  employees,
  milestones,
  lastNudge,
  lastFailed,
  draggable,
  isOwner = true,
  onDragStart,
  onDrop,
  onOpen,
  onPatch,
  firmOwnerUserId = null,
  onAddEmployee,
  onManageTeam,
  onHandOff,
  onAssignPerson,
  comingSoon,
  pickupLabel,
  pickupRun = null,
  handoffError = null,
  onRetry,
  notes = [],
  assigneeOverride = null,
  handoffPending = false,
  noteStillDue = false,
  phasePending = false,
  phaseLabel = null,
  draftId = null,
  onOpenDraft,
  focused,
  suggestion,
}: {
  item: Item & { health?: Health };
  focused?: boolean;
  /** Display-only. Confirming still writes through the existing owner and date controls. */
  suggestion?: ActionAutomationRow | null;
  employees: Employee[];
  milestones: Milestone[];
  lastNudge: EmailRecord | null;
  lastFailed: EmailRecord | null;
  draggable: boolean;
  isOwner?: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onOpen: () => void;
  onPatch: (patch: Partial<Item>, log?: Partial<Update>) => void;
  firmOwnerUserId?: string | null;
  onAddEmployee: (name: string, email: string) => Promise<Employee | null>;
  onManageTeam?: () => void;
  /** Owner and accountant. Asks owner-handoff. The browser does not insert agent_runs. */
  onHandOff?: (agent: AgentKey) => void;
  onAssignPerson?: (person: { id: string; name: string; email: string | null }) => void;
  /** Agents whose hand-off came back 409 no_runner. */
  comingSoon?: Partial<Record<AgentKey, true>>;
  /** Set when a queued run for this action has started or finished. */
  pickupLabel?: string | null;
  pickupRun?: { id?: string; agent?: string; status: string; at?: string | null } | null;
  handoffError?: string | null;
  onRetry?: () => void;
  notes?: readonly AssignmentNoteRow[];
  /** Pending "Handing to …" or the name confirmed once noted is true. Beats a stale note. */
  assigneeOverride?: string | null;
  /** The assignment note has not been read yet. Hand to stays off. */
  handoffPending?: boolean;
  /** This click's assignment note is not stored yet. A finished read of the blank row stays pending. */
  noteStillDue?: boolean;
  /** Notes or the run list are still loading. The chip says Checking. */
  phasePending?: boolean;
  /** Working, Draft ready, Approved, Sent, or Couldn't draft. Replaces Not started / Not sent. */
  phaseLabel?: string | null;
  draftId?: string | null;
  onOpenDraft?: (draftId: string) => void;
}) {
  const { market } = useMarketFormat();
  const h = healthMeta(item.health);
  const overdue = item.health === "overdue";
  const [editTitle, setEditTitle] = useState(false);
  const [title, setTitle] = useState(() => stripMilonProjection(item.title));
  const [pickOwner, setPickOwner] = useState(false);
  const exp = expectedPct(item);
  const msDone = milestones.filter((m) => m.is_done).length;

  return (
    <div
      className={`group border-b border-amber-900/10 transition-colors hover:bg-amber-900/[0.03] dark:border-slate-800/70 dark:hover:bg-slate-800/30 ${
        overdue ? "border-l-2 border-l-[#ef4444]" : "border-l-2 border-l-transparent"
      } ${focused ? "bg-[#f7d98a]/20 ring-2 ring-inset ring-[#0B5FFF] dark:bg-[rgba(247,217,138,0.10)]" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onClick={pickOwner ? undefined : onOpen}
      data-row-id={item.id}
    >
      <div className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:flex-nowrap sm:gap-3 sm:px-4">
      {draggable && (
        <GripVertical
          className="hidden h-4 w-4 shrink-0 cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600 sm:block"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <span className="w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-400 dark:text-slate-500">
        {item.seq}
      </span>

      {/* Title + why (inline edit — owners only) */}
      <div className="min-w-0 flex-[1_1_12rem] basis-full sm:basis-auto sm:flex-1">
        {isOwner && editTitle ? (
          <Input
            autoFocus
            className={`h-7 text-sm ${INPUT_CLS}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditTitle(false);
              if (title.trim() && title !== item.title) onPatch({ title: title.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTitle(item.title);
                setEditTitle(false);
              }
            }}
          />
        ) : (
          <button
            className={`line-clamp-2 w-full whitespace-normal text-left text-sm font-semibold ${item.status === "done" ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}
            onDoubleClick={
              isOwner
                ? (e) => {
                    e.stopPropagation();
                    setEditTitle(true);
                  }
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
            title={
              isOwner
                ? "Double-click to edit title — click row to open details"
                : "Click row to open details"
            }
          >
            {actionDisplayTitle(stripMilonProjection(item.title))}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {item.recommendation_id ? (
            <span
              className="inline-flex min-w-0 items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#102A43] dark:text-[#0B5FFF]/90"
              title={item.recommendation_title ?? undefined}
              data-recommendation={item.recommendation_id}
            >
              <Lightbulb className="h-2.5 w-2.5 shrink-0" /> From recommendation
              {item.recommendation_title ? (
                <span className="truncate font-medium normal-case tracking-normal text-slate-500 dark:text-slate-400">
                  {" "}
                  · {stripMilonProjection(item.recommendation_title)}
                </span>
              ) : null}
            </span>
          ) : item.source === "strategic_move" ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#102A43] dark:text-[#0B5FFF]/90">
              <Sparkles className="h-2.5 w-2.5" /> From strategic moves
            </span>
          ) : null}
          {stripMilonProjection(item.outcome_why) ? (
            <span className="truncate">{stripMilonProjection(item.outcome_why)}</span>
          ) : null}
        </div>
      </div>

      {/* Owner — stopPropagation so picker clicks never open the task drawer */}
      <div
        className="relative w-[calc(50%-0.4rem)] shrink-0 sm:w-32"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isOwner && pickOwner ? (
          <OwnerPicker
            employees={employees}
            firmOwnerUserId={firmOwnerUserId}
            onPick={(id, name) => {
              setPickOwner(false);
              if (id) {
                const emp = employees.find((e) => e.id === id);
                const ownerName = name ?? emp?.name;
                onPatch(
                  {
                    owner_id: id,
                    owner_name: ownerName,
                    owner_email: emp?.email ?? null,
                    sent_at: null,
                  },
                  onHandOff ? { note: `Assigned to ${ownerName ?? "a team member"}` } : undefined,
                );
              }
            }}
            onAdd={onAddEmployee}
            onManageTeam={
              onManageTeam
                ? () => {
                    setPickOwner(false);
                    onManageTeam();
                  }
                : undefined
            }
            onClose={() => setPickOwner(false)}
          />
        ) : (
          <button
            className={`w-full rounded-md px-1.5 py-1 text-left text-xs font-medium text-slate-700 dark:text-slate-300 ${onHandOff ? "" : "truncate"} ${isOwner ? "hover:bg-amber-900/5 dark:hover:bg-slate-800" : "cursor-default"}`}
            onClick={
              isOwner
                ? (e) => {
                    e.stopPropagation();
                    setPickOwner(true);
                  }
                : (e) => e.stopPropagation()
            }
          >
            {onHandOff ? (
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Assign
              </span>
            ) : null}
            {item.owner_name ? (
              item.owner_name
            ) : suggestion?.ownerSuggested && suggestion.owner ? (
              <span data-owner-suggested="">
                {suggestion.owner.name} · suggested
              </span>
            ) : isOwner ? (
              <span className="text-slate-400 dark:text-slate-500">+ Owner</span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">—</span>
            )}
        </button>
        )}
      </div>

      {/* Due. w-28 fits "10/15/2026" plus the picker icon; w-24 clipped the year. */}
      <div className="w-[calc(50%-0.4rem)] shrink-0 sm:w-28">
        {!item.due_date && suggestion?.dueSuggested && suggestion.dueDate ? (
          <span data-due-suggested="" className="block px-1 text-[10px] font-medium text-slate-500">
            Due {formatCalendarDay(suggestion.dueDate, market)} · suggested
          </span>
        ) : !isOwner ? (
          <span
            className={`block px-1 py-1 text-xs font-medium tabular-nums ${overdue ? "font-bold text-[#ef4444]" : "text-slate-700 dark:text-slate-300"}`}
          >
            {item.due_date ? formatCalendarDay(item.due_date, market) : "—"}
          </span>
        ) : (
          <PlanDateField
            value={item.due_date}
            market={market}
            overdue={overdue}
            onChange={(next) => onPatch({ due_date: next } as any)}
          />
        )}
      </div>

      {/* Progress + pace marker */}
      <div className="hidden w-28 shrink-0 sm:block">
        <div className="relative h-1.5 rounded-full bg-amber-900/10 dark:bg-slate-800">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${item.progress_pct}%`, background: h.color }}
          />
          {exp != null && item.status !== "done" && (
            <div
              className="absolute -top-[3px] h-3 w-px bg-slate-500 dark:bg-slate-400"
              style={{ left: `${exp}%` }}
            />
          )}
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          <span>{item.progress_pct}%</span>
          {milestones.length > 0 && (
            <span>
              {msDone}/{milestones.length} wk
            </span>
          )}
        </div>
      </div>

      {/* Sent state — always shows last nudge/overdue chase date; failure warning overlaid if any send failed */}
      <div className="hidden w-20 shrink-0 text-center md:block">
        <div className="flex flex-col items-center gap-0.5">
          {lastFailed && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#ef4444]"
              title="A recent email failed — open the drawer to see details and retry"
            >
              <AlertTriangle className="h-3 w-3" /> Failed
            </span>
          )}
          {lastNudge ? (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold dark:text-[#F4F7FB] ${lastNudge.email_type === "nudge" ? "text-[#102A43]" : "text-[#C43D4B]"}`}
              title={`Last ${lastNudge.email_type === "nudge" ? "nudge" : "overdue reminder"} sent ${lastNudge.sent_at ? formatCalendarDay(lastNudge.sent_at, market) : ""}`}
            >
              <Mail className="h-3 w-3" />
              {lastNudge.email_type === "nudge" ? "Nudged" : "Overdue"}
            </span>
          ) : item.sent_at || phaseLabel === "Sent" ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              <Mail className="h-3 w-3" /> Sent
            </span>
          ) : !lastFailed && !phaseLabel ? (
            <span className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">
              Not sent
            </span>
          ) : null}
          {lastNudge?.sent_at && (
            <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
              Sent {formatCalendarDay(lastNudge.sent_at, market)}
            </span>
          )}
        </div>
      </div>

      {/* Health chip + open indicator */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-bold"
          style={{ color: phasePending || phaseLabel ? "#0B5FFF" : h.color, background: phasePending || phaseLabel ? "rgba(11,95,255,0.12)" : h.bg }}
          data-handoff-phase={phasePending ? "checking" : phaseLabel ?? undefined}
        >
          {phasePending ? "Checking…" : phaseLabel ?? h.label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600" />
      </div>
      </div>
      {onHandOff || pickupLabel || pickupRun || notes.length > 0 || handoffError ? (
        <div className="px-3 pb-3 sm:px-4" onClick={(event) => event.stopPropagation()}>
          {onHandOff ? (
            <HandToMenu
              employees={employees}
              assignee={assigneeOverride ?? displayedAssignee(item.owner_name, notes)}
              comingSoon={comingSoon}
              pending={handoffPending || noteStillDue}
              audience={isOwner ? "owner" : "accountant"}
              onAssignAgent={onHandOff}
              onAssignPerson={(person) => {
                if (onAssignPerson) {
                  onAssignPerson(person);
                  return;
                }
                onPatch(
                  {
                    owner_id: person.id,
                    owner_name: person.name,
                    owner_email: person.email,
                    sent_at: null,
                  },
                  { note: `Assigned to ${person.name}` },
                );
              }}
            />
          ) : null}
          <HandoffRunStatus
            run={pickupRun}
            caption={pickupLabel}
            draftId={draftId}
            onOpenDraft={onOpenDraft}
            error={handoffError}
            missed={(() => {
              if (pickupRun && (pickupRun.status === "queued" || pickupRun.status === "running")) return false;
              if (pickupRun) return false;
              const stored = latestStoredAssignment(notes);
              return stored?.kind === "bot" && !handoffStillAwaitingRun(stored.at);
            })()}
            onRetry={onRetry}
            actionItemId={item.id}
          />
          <AssignmentNotes notes={notes} />
        </div>
      ) : null}
    </div>
  );
}

function OwnerPicker({
  employees,
  firmOwnerUserId = null,
  onPick,
  onAdd,
  onManageTeam,
  onClose,
}: {
  employees: Employee[];
  firmOwnerUserId?: string | null;
  onPick: (id: string | null, name?: string | null) => void;
  onAdd: (name: string, email: string) => Promise<Employee | null>;
  onManageTeam?: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const list = employees.filter((e) => (e.name ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div
      ref={ref}
      className="absolute z-40 mt-1 w-56 rounded-lg border border-amber-900/15 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {!adding ? (
        <>
          <Input
            autoFocus
            placeholder="Search…"
            className={`mb-1 h-7 text-xs ${INPUT_CLS}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <div className="max-h-40 overflow-auto">
            {list.map((e) => (
              <button
                key={e.id}
                className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-amber-900/5 dark:hover:bg-slate-800"
                onClick={() => onPick(e.id, e.name)}
              >
                <span className="font-semibold text-slate-800 dark:text-slate-200">{e.name}</span>
                {e.practiceUserId && (e.role || e.practiceUserId === firmOwnerUserId) ? (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400" data-practice-role>
                    {practiceRoleLabel(e.role, e.practiceUserId === firmOwnerUserId)}
                  </span>
                ) : null}
                {!e.email && <span className="ml-1 text-[10px] text-[#3D5270]">no email</span>}
              </button>
            ))}
            {list.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-400">No matches</p>}
          </div>
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs font-semibold text-[#102A43] hover:bg-amber-900/5 dark:text-[#0B5FFF] dark:hover:bg-slate-800"
            onClick={(e) => {
              e.stopPropagation();
              setAdding(true);
            }}
          >
            <UserPlus className="h-3 w-3" /> Add employee
          </button>
          {onManageTeam && (
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-amber-900/5 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={(e) => {
                e.stopPropagation();
                onManageTeam();
              }}
            >
              <Users className="h-3 w-3" /> Team members
            </button>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          <Input
            autoFocus
            placeholder="Name"
            className={`h-7 text-xs ${INPUT_CLS}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Email"
            type="email"
            className={`h-7 text-xs ${INPUT_CLS}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-7 flex-1 bg-[#0B5FFF] text-xs text-white dark:bg-[#0B5FFF] dark:text-slate-950"
              onClick={async (e) => {
                e.stopPropagation();
                if (!name.trim()) return;
                const emp = await onAdd(name, email);
                if (emp) onPick(emp.id, emp.name);
              }}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setAdding(false)}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ Quick add ═══════════════════════════════════════════════════════════════
function QuickAdd({
  onAdd,
  inputRef,
}: {
  onAdd: (title: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [v, setV] = useState("");
  const submit = () => {
    const title = v.trim();
    if (!title) return;
    onAdd(title);
    setV("");
  };
  return (
    <div className="mx-3 mb-3 flex items-center gap-2 rounded-xl border border-dashed border-[#0B5FFF]/45 bg-[#0B5FFF]/5 px-3 py-2 dark:border-[#0B5FFF]/35 dark:bg-[#0B5FFF]/8">
      <Plus className="h-4 w-4 shrink-0 text-[#102A43] dark:text-[#0B5FFF]" />
      <input
        ref={inputRef}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Describe the action…"
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-500"
        aria-label="New action title"
      />
      <Button
        type="button"
        size="sm"
        disabled={!v.trim()}
        onClick={submit}
        className="h-8 shrink-0 bg-[#0B5FFF] px-3 text-xs text-white hover:bg-[#2563EB] disabled:opacity-40 dark:bg-[#0B5FFF] dark:text-slate-950 dark:hover:bg-[#2563EB]"
      >
        Add
      </Button>
    </div>
  );
}

// ═══ Import panel ════════════════════════════════════════════════════════════
function ImportPanel({
  moves,
  importedKeys,
  onClose,
  onImport,
}: {
  moves: StrategicMoveLite[];
  importedKeys: Set<string | null>;
  onClose: () => void;
  onImport: (keys: string[]) => void | Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-2xl p-5 ${CARD_SHELL}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={GOLD_RULE} />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-950 dark:text-white">
            Import from Strategic Moves
          </h3>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <div className="max-h-80 space-y-1.5 overflow-auto">
          {moves.map((m) => {
            const added = importedKeys.has(m.key);
            const checked = sel.has(m.key);
            return (
              <button
                key={m.key}
                disabled={added}
                onClick={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    checked ? n.delete(m.key) : n.add(m.key);
                    return n;
                  })
                }
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  added
                    ? "cursor-default border-transparent opacity-45"
                    : checked
                      ? "border-[#0B5FFF]/60 bg-[#0B5FFF]/10"
                      : "border-amber-900/10 hover:border-[#0B5FFF]/40 dark:border-slate-800"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-black ${
                    checked
                      ? "border-[#102A43] bg-[#0B5FFF] text-white dark:border-[#0B5FFF] dark:bg-[#0B5FFF] dark:text-slate-950"
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {checked && "✓"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {m.title}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {moveFactorLabel(m)}
                    {m.impactLine ? ` · ${m.impactLine}` : ""}
                  </span>
                </span>
                {added && (
                  <span className="shrink-0 text-[10px] font-bold uppercase text-slate-400">
                    Added
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Button
          disabled={!sel.size || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onImport([...sel]);
            } finally {
              setBusy(false);
            }
          }}
          className="mt-4 w-full bg-[#0B5FFF] text-white hover:bg-[#2563EB] dark:bg-[#0B5FFF] dark:text-slate-950 dark:hover:bg-[#2563EB]"
        >
          {busy
            ? "Adding…"
            : `Add ${sel.size || ""} action${sel.size === 1 ? "" : "s"} to the plan`}
        </Button>
      </div>
    </div>
  );
}

// ═══ From recommendations (P0.7) ════════════════════════════════════════════
// Approved / edited recommendations that have no action yet. Each becomes one
// action through `createActionFromRecommendation`, keeping the FK so the
// outcome loop can later compare expected vs actual.
function FromRecommendationsPanel({
  recommendations,
  onClose,
  onAdd,
}: {
  recommendations: Recommendation[];
  onClose: () => void;
  onAdd: (ids: string[]) => void | Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(recommendations.map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-2xl p-5 ${CARD_SHELL}`}
        onClick={(e) => e.stopPropagation()}
        data-from-recommendations-panel
      >
        <div className={GOLD_RULE} />
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-950 dark:text-white">
            Add from recommendations
          </h3>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Each approved recommendation becomes one owned, dated action. The link is kept so the
          result can be measured against what was expected.
        </p>
        <div className="max-h-80 space-y-1.5 overflow-auto">
          {recommendations.map((r) => {
            const checked = sel.has(r.id);
            const impact = expectedImpactLabel(r);
            return (
              <button
                key={r.id}
                onClick={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    checked ? n.delete(r.id) : n.add(r.id);
                    return n;
                  })
                }
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  checked
                    ? "border-[#0B5FFF]/60 bg-[#0B5FFF]/10"
                    : "border-amber-900/10 hover:border-[#0B5FFF]/40 dark:border-slate-800"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-black ${
                    checked
                      ? "border-[#102A43] bg-[#0B5FFF] text-white dark:border-[#0B5FFF] dark:bg-[#0B5FFF] dark:text-slate-950"
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {checked && "✓"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {r.title}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {priorityLabel(r.priority)}
                    {impact ? ` · ${impact}` : ""}
                    {r.problem
                      ? ` · ${stripMilonProjection(r.problem)}`
                      : r.rationale
                        ? ` · ${stripMilonProjection(r.rationale)}`
                        : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <Button
          disabled={!sel.size || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd([...sel]);
            } finally {
              setBusy(false);
            }
          }}
          className="mt-4 w-full bg-[#0B5FFF] text-white hover:bg-[#2563EB] dark:bg-[#0B5FFF] dark:text-slate-950 dark:hover:bg-[#2563EB]"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Adding…
            </>
          ) : (
            `Add ${sel.size || ""} action${sel.size === 1 ? "" : "s"} to the plan`
          )}
        </Button>
      </div>
    </div>
  );
}

// ═══ Team members ════════════════════════════════════════════════════════════
function TeamPanel({
  employees,
  firmOwnerUserId = null,
  onClose,
  onAdd,
  onPatch,
  onRemove,
}: {
  employees: Employee[];
  firmOwnerUserId?: string | null;
  onClose: () => void;
  onAdd: (name: string, email: string) => Promise<Employee | null>;
  onPatch: (id: string, patch: Partial<Pick<Employee, "name" | "email">>) => Promise<boolean>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const emp = await onAdd(name, email);
      if (emp) {
        setName("");
        setEmail("");
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editId || !editName.trim()) return;
    const ok = await onPatch(editId, { name: editName.trim(), email: editEmail.trim() || null });
    if (ok) setEditId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-2xl p-5 ${CARD_SHELL}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={GOLD_RULE} />
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950 dark:text-white">Team members</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Practice owners and anyone with access on this client, plus people you add here.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <div className="max-h-80 space-y-1 overflow-auto">
          {employees.length === 0 && (
            <p className="px-1 py-3 text-sm text-slate-500 dark:text-slate-400">
              No team members yet. Add someone below.
            </p>
          )}
          {employees.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-2 rounded-lg border border-amber-900/10 px-3 py-2 dark:border-slate-800"
            >
              {editId === e.id ? (
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input
                    className={`h-7 text-xs ${INPUT_CLS}`}
                    value={editName}
                    onChange={(ev) => setEditName(ev.target.value)}
                    placeholder="Name"
                  />
                  <Input
                    className={`h-7 text-xs ${INPUT_CLS}`}
                    type="email"
                    value={editEmail}
                    onChange={(ev) => setEditEmail(ev.target.value)}
                    placeholder="Email"
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className="h-7 bg-[#0B5FFF] px-3 text-xs text-white dark:bg-[#0B5FFF] dark:text-slate-950"
                      onClick={saveEdit}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setEditId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (e.practiceUserId) return;
                      setEditId(e.id);
                      setEditName(e.name);
                      setEditEmail(e.email ?? "");
                    }}
                  >
                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {e.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {e.email || <span className="text-[#3D5270]">no email</span>}
                      {e.practiceUserId ? (
                        <span className="ml-1 uppercase tracking-wide text-slate-400" data-practice-role>
                          · {practiceRoleLabel(e.role, e.practiceUserId === firmOwnerUserId) || "Practice member"}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {e.practiceUserId ? null : (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-amber-900/5 hover:text-[#ef4444] dark:hover:bg-slate-800"
                      aria-label={`Remove ${e.name}`}
                      onClick={() => onRemove(e.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 border-t border-amber-900/10 pt-3 dark:border-slate-800">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Add team member
          </p>
          <Input
            className={`h-8 text-sm ${INPUT_CLS}`}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Input
            className={`h-8 text-sm ${INPUT_CLS}`}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            disabled={!name.trim() || saving}
            onClick={submit}
            className="w-full bg-[#0B5FFF] text-white hover:bg-[#2563EB] dark:bg-[#0B5FFF] dark:text-slate-950 dark:hover:bg-[#2563EB]"
          >
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            {saving ? "Adding…" : "Add team member"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ═══ Drawer ══════════════════════════════════════════════════════════════════
function ItemDrawer({
  item,
  employees,
  milestones,
  isOwner = true,
  onClose,
  onPatch,
  onDelete,
  onResend,
  onChase,
  onCopyLink,
  onReassign,
  onMilestonesChanged,
}: {
  item: Item & { health?: Health };
  employees: Employee[];
  milestones: Milestone[];
  isOwner?: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Item>, log?: Partial<Update>) => void;
  onDelete: () => void;
  onResend: () => Promise<void>;
  onChase: () => Promise<void>;
  onCopyLink: () => Promise<void>;
  onReassign: (employeeId: string) => Promise<void>;
  onMilestonesChanged: () => void;
}) {
  const { dateTime } = useMarketFormat();
  const [updates, setUpdates] = useState<Update[]>([]);
  const [emailHistory, setEmailHistory] = useState<EmailRecord[]>([]);
  const [newMs, setNewMs] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [resending, setResending] = useState(false);
  const [chasing, setChasing] = useState(false);
  const h = healthMeta(item.health);
  const ownerHasEmail = Boolean(
    item.owner_id && employees.find((e) => e.id === item.owner_id)?.email,
  );
  const chaseLabel = item.health === "overdue" ? "Chase overdue" : "Send nudge";

  useEffect(() => {
    Promise.all([
      supabase
        .from("action_updates")
        .select("*")
        .eq("action_item_id", item.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("action_emails")
        .select("id,action_item_id,email_type,status,sent_at,created_at")
        .eq("action_item_id", item.id)
        .order("created_at", { ascending: false }),
    ]).then(([{ data: updData }, { data: emailData }]) => {
      setUpdates((updData ?? []) as Update[]);
      setEmailHistory((emailData ?? []) as EmailRecord[]);
    });
  }, [item.id]);

  const addMilestone = async () => {
    if (!newMs.trim()) return;
    const week = (milestones.reduce((m, x) => Math.max(m, x.week_no), 0) ?? 0) + 1;
    if (week > 12) {
      toast.error("Max 12 weekly milestones");
      return;
    }
    const { error } = await supabase.from("action_milestones").insert({
      action_item_id: item.id,
      week_no: week,
      label: newMs.trim(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewMs("");
    onMilestonesChanged();
  };
  const toggleMs = async (m: Milestone) => {
    await supabase
      .from("action_milestones")
      .update({ is_done: !m.is_done, done_at: !m.is_done ? new Date().toISOString() : null })
      .eq("id", m.id);
    onMilestonesChanged();
  };
  const deleteMs = async (m: Milestone) => {
    await supabase.from("action_milestones").delete().eq("id", m.id);
    onMilestonesChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-amber-900/15 bg-[#FFFFFF] p-5 shadow-2xl dark:border-slate-800 dark:bg-[#0d1524]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-bold"
              style={{ color: h.color, background: h.bg }}
            >
              {h.label}
            </span>
            <h3 className="mt-2 text-lg font-black leading-tight text-slate-950 dark:text-white">
              {actionDisplayTitle(stripMilonProjection(item.title))}
            </h3>
            {item.recommendation_id ? (
              <p
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#102A43] dark:text-[#0B5FFF]"
                data-drawer-recommendation
              >
                <Lightbulb className="h-3 w-3" />
                From recommendation
                {item.recommendation_title ? `: ${stripMilonProjection(item.recommendation_title)}` : ""}
                {item.recommendation_metric && item.recommendation_amount != null
                  ? ` · expected ${expectedImpactLabel({
                      expected_impact_metric: item.recommendation_metric as never,
                      expected_impact_amount: item.recommendation_amount,
                      expected_impact_horizon_days: null,
                    })}`
                  : ""}
              </p>
            ) : null}
            {stripMilonProjection(item.outcome_why) ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {stripMilonProjection(item.outcome_why)}
              </p>
            ) : null}
          </div>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Status override + progress — owners only */}
        {isOwner ? (
          <>
            <div className={LABEL_CLS}>Status (owner override)</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    onPatch(
                      {
                        status: s,
                        ...(s === "done"
                          ? { progress_pct: 100, completed_at: new Date().toISOString() }
                          : { completed_at: null }),
                      } as any,
                      {},
                    )
                  }
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                    item.status === s
                      ? "bg-[#0B5FFF] text-white dark:bg-[#0B5FFF] dark:text-slate-950"
                      : "border border-amber-900/15 text-slate-600 dark:border-slate-700 dark:text-slate-400"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {item.status === "blocked" && item.blocker_note && (
              <p className="mt-2 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#ef4444]">
                Blocker: {stripMilonProjection(item.blocker_note)}
              </p>
            )}
            <div className={`mt-4 ${LABEL_CLS}`}>Progress — {item.progress_pct}%</div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={item.progress_pct}
              onChange={(e) => onPatch({ progress_pct: Number(e.target.value) } as any, {})}
              className="mt-1 w-full accent-[#0B5FFF]"
            />
          </>
        ) : (
          <>
            <div className={LABEL_CLS}>Status</div>
            <span className="mt-1.5 inline-block rounded-md px-2.5 py-1 text-[11px] font-semibold bg-[#0B5FFF] text-white dark:bg-[#0B5FFF] dark:text-slate-950">
              {STATUS_LABEL[item.status]}
            </span>
            {item.status === "blocked" && item.blocker_note && (
              <p className="mt-2 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#ef4444]">
                Blocker: {stripMilonProjection(item.blocker_note)}
              </p>
            )}
            <div className={`mt-4 ${LABEL_CLS}`}>Progress — {item.progress_pct}%</div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-amber-900/10 dark:bg-slate-800">
              <div
                className="h-2 rounded-full bg-[#0B5FFF]"
                style={{ width: `${item.progress_pct}%` }}
              />
            </div>
          </>
        )}

        {/* Milestones */}
        <div className={`mt-5 ${LABEL_CLS}`}>Weekly milestones</div>
        <div className="mt-1.5 space-y-1">
          {milestones.map((m) => (
            <div key={m.id} className="group flex items-center gap-2">
              <button
                onClick={isOwner ? () => toggleMs(m) : undefined}
                disabled={!isOwner}
                className={`flex h-4.5 w-4.5 h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-[10px] font-black ${
                  m.is_done
                    ? "border-[#22c55e] bg-[#22c55e] text-white"
                    : "border-slate-300 dark:border-slate-600"
                } ${!isOwner ? "cursor-default" : ""}`}
              >
                {m.is_done && "✓"}
              </button>
              <span className="w-7 text-[10px] font-bold text-slate-400">W{m.week_no}</span>
              <span
                className={`flex-1 text-xs ${m.is_done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-200"}`}
              >
                {m.label}
              </span>
              {isOwner && (
                <button onClick={() => deleteMs(m)} className="opacity-0 group-hover:opacity-100">
                  <Trash2 className="h-3 w-3 text-slate-400" />
                </button>
              )}
            </div>
          ))}
        </div>
        {isOwner && (
          <div className="mt-1.5 flex gap-1.5">
            <Input
              placeholder={`W${Math.min((milestones.reduce((m, x) => Math.max(m, x.week_no), 0) ?? 0) + 1, 12)} milestone…`}
              className={`h-7 text-xs ${INPUT_CLS}`}
              value={newMs}
              onChange={(e) => setNewMs(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addMilestone();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className={`h-7 ${INPUT_CLS}`}
              onClick={addMilestone}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Actions — owners only */}
        {isOwner && (
          <>
            {item.status !== "done" && (
              <Button
                size="sm"
                disabled={chasing || !ownerHasEmail}
                onClick={async () => {
                  setChasing(true);
                  await onChase();
                  setChasing(false);
                }}
                className={`mt-5 w-full ${
                  item.health === "overdue"
                    ? "bg-[#ef4444] text-white hover:bg-[#dc2626]"
                    : "bg-[#0B5FFF] text-white hover:bg-[#2563EB] dark:bg-[#0B5FFF] dark:text-slate-950 dark:hover:bg-[#2563EB]"
                }`}
              >
                {chasing ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="mr-1 h-3.5 w-3.5" />
                )}
                {ownerHasEmail ? chaseLabel : "Add an owner email to chase"}
              </Button>
            )}
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className={INPUT_CLS}
                disabled={!item.owner_id}
                onClick={onCopyLink}
              >
                <LinkIcon className="mr-1 h-3 w-3" /> Copy link
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={INPUT_CLS}
                disabled={resending || !item.owner_id}
                onClick={async () => {
                  setResending(true);
                  await onResend();
                  setResending(false);
                }}
              >
                {resending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 h-3 w-3" />
                )}{" "}
                Resend link
              </Button>
              {!reassigning ? (
                <Button
                  size="sm"
                  variant="outline"
                  className={INPUT_CLS}
                  onClick={() => setReassigning(true)}
                >
                  <UserPlus className="mr-1 h-3 w-3" /> Reassign
                </Button>
              ) : (
                <select
                  autoFocus
                  className={`rounded-md border px-2 py-1 text-xs ${INPUT_CLS}`}
                  defaultValue=""
                  onChange={async (e) => {
                    if (e.target.value) {
                      await onReassign(e.target.value);
                      setReassigning(false);
                    }
                  }}
                  onBlur={() => setReassigning(false)}
                >
                  <option value="" disabled>
                    Pick new owner…
                  </option>
                  {employees
                    .filter((e) => e.id !== item.owner_id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.email ? "" : " (no email)"}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5 text-[#ef4444] hover:text-[#ef4444]"
              onClick={onDelete}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Delete action
            </Button>
          </>
        )}

        {/* Nudge history */}
        {emailHistory.length > 0 &&
          (() => {
            const lastFailed = emailHistory[0]?.status === "failed";
            return (
              <div className="mt-5">
                <div className={LABEL_CLS}>Email history</div>
                {lastFailed && (
                  <div className="mt-1.5 flex items-center gap-2 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#ef4444]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Last send failed — use Chase or Resend link above to retry.
                  </div>
                )}
                <div className="mt-1.5 space-y-1">
                  {emailHistory.map((e) => {
                    const failed = e.status === "failed";
                    const typeLabel =
                      e.email_type === "assignment"
                        ? "Assignment"
                        : e.email_type === "nudge"
                          ? "Nudge"
                          : e.email_type === "overdue"
                            ? "Overdue reminder"
                            : e.email_type === "done"
                              ? "Done confirmation"
                              : e.email_type;
                    return (
                      <div
                        key={e.id}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="flex items-center gap-1.5">
                          {failed ? (
                            <AlertTriangle className="h-3 w-3 text-[#ef4444]" />
                          ) : (
                            <Mail className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                          )}
                          <span
                            className={
                              failed
                                ? "font-semibold text-[#ef4444]"
                                : "text-slate-700 dark:text-slate-300"
                            }
                          >
                            {typeLabel}
                            {failed && " (failed)"}
                          </span>
                        </span>
                        <span className="tabular-nums text-slate-400 dark:text-slate-500">
                          {e.sent_at ? dateTime(e.sent_at) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        {/* Timeline */}
        <div className={`mt-5 ${LABEL_CLS}`}>Activity</div>
        <div className="mt-2 space-y-2.5 border-l border-amber-900/15 pl-3 dark:border-slate-700">
          {updates.length === 0 && <p className="text-xs text-slate-400">No updates yet.</p>}
          {updates.map((u) => (
            <div key={u.id} className="relative">
              <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-[#0B5FFF]" />
              <p className="text-xs text-slate-800 dark:text-slate-200">
                <span className="font-semibold">{u.actor_label}</span>
                {u.status_from !== u.status_to && u.status_to && (
                  <>
                    {" "}
                    · {STATUS_LABEL[u.status_from ?? "not_started"]} →{" "}
                    <span className="font-semibold">{STATUS_LABEL[u.status_to]}</span>
                  </>
                )}
                {u.progress_from !== u.progress_to && (
                  <>
                    {" "}
                    · {u.progress_from ?? 0}% → {u.progress_to ?? 0}%
                  </>
                )}
              </p>
              {u.note && (
                <p className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">
                  "{u.note}"
                </p>
              )}
              <p className="text-[10px] text-slate-400">
                {dateTime(u.created_at)}
                {u.actor_type === "assignee_link" && " · via task link"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══ Footer visuals ══════════════════════════════════════════════════════════
function VizCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className={CARD_SHELL}>
      <div className={GOLD_RULE} />
      <CardContent className="pt-5">
        <div className={LABEL_CLS}>{title}</div>
        <div className="mt-3">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * The donut center used to sit in front of "On track · 2", so "4 On track · 2 Off track · 2"
 * read as four actions on track. The leading number is how many are still open.
 */
export function formatActionHealthSummary(counts: Record<Health, number>): string {
  const open =
    counts.on_track + counts.at_risk + counts.off_track + counts.overdue + (counts.not_started ?? 0);
  const done = counts.complete ?? 0;
  return formatActionPlanCounts({
    total: open + done,
    open,
    done,
    overdue: counts.overdue ?? 0,
  });
}

function HealthDonut({
  counts,
  total,
  onPick,
}: {
  counts: Record<Health, number>;
  total: number;
  onPick: (h: Health) => void;
}) {
  const order: Health[] = ["not_started", "on_track", "at_risk", "off_track", "overdue", "complete"];
  const summary = formatActionHealthSummary(counts);
  const open =
    counts.on_track + counts.at_risk + counts.off_track + counts.overdue + (counts.not_started ?? 0);
  const r = 42,
    cx = 55,
    cy = 55,
    C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <VizCard title="Action health">
      <p id="action-health-summary" className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {summary}
      </p>
      <div className="flex items-center gap-4">
        <svg width={110} height={110} className="shrink-0 -rotate-90" aria-label={summary} role="img">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            strokeWidth={12}
            className="stroke-amber-900/10 dark:stroke-slate-800"
          />
          {order.map((k) => {
            const frac = total ? counts[k] / total : 0;
            const dash = frac * C;
            const el = counts[k] > 0 && (
              <circle
                key={k}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={HEALTH_META[k].color}
                strokeWidth={12}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc}
                className="cursor-pointer transition-opacity hover:opacity-75"
                onClick={() => onPick(k)}
              />
            );
            acc += dash;
            return el;
          })}
          {/* The svg is CSS-rotated -90°, so the vertical stack offsets live on x. */}
          <text
            x={cx + 6}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(90 ${cx + 6} ${cy})`}
            className="fill-slate-950 text-xl font-black tabular-nums dark:fill-white"
          >
            {open}
          </text>
          <text
            x={cx - 12}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(90 ${cx - 12} ${cy})`}
            className="fill-slate-500 text-xs font-semibold uppercase tracking-wide dark:fill-slate-400"
          >
            open
          </text>
        </svg>
        <div className="space-y-1">
          {order
            .filter((k) => counts[k] > 0)
            .map((k) => (
              <button
                key={k}
                onClick={() => onPick(k)}
                className="flex items-center gap-2 text-xs text-slate-600 hover:underline dark:text-slate-300"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: HEALTH_META[k].color }}
                />
                <span className="font-bold tabular-nums">{counts[k]}</span>
                {HEALTH_META[k].label}
              </button>
            ))}
        </div>
      </div>
    </VizCard>
  );
}

function BurnUp({
  plan,
  items,
  confidence,
}: {
  plan: Plan;
  items: Item[];
  confidence: number | null;
}) {
  // Planned: straight line from plan start → target date. Actual: mean progress today.
  const start = new Date(plan.created_at).getTime();
  const end = new Date(plan.target_date + "T23:59:59").getTime();
  const nowFrac = end > start ? Math.max(0, Math.min(1, (Date.now() - start) / (end - start))) : 1;
  const actual = items.length
    ? items.reduce((s, i) => s + i.progress_pct, 0) / items.length / 100
    : 0;
  const gap = planPaceGapPoints(items, plan.created_at, plan.target_date);
  const W = 240,
    H = 96,
    P = 8;
  const x = (f: number) => P + f * (W - 2 * P);
  const y = (f: number) => H - P - f * (H - 2 * P);
  return (
    <VizCard title="Burn-up · planned vs actual">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke={GOLD}
          strokeDasharray="4 3"
          strokeWidth={1.5}
          opacity={0.7}
        />
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(nowFrac)}
          y2={y(actual)}
          stroke={actual >= nowFrac ? "#22c55e" : "#ef4444"}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle
          cx={x(nowFrac)}
          cy={y(actual)}
          r={4}
          fill={actual >= nowFrac ? "#22c55e" : "#ef4444"}
        />
        <line
          x1={x(nowFrac)}
          y1={y(0)}
          x2={x(nowFrac)}
          y2={y(1)}
          stroke="currentColor"
          strokeWidth={1}
          className="text-slate-300 dark:text-slate-600"
          strokeDasharray="2 3"
        />
      </svg>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {gap >= 0 ? (
          <>
            <span className="font-bold text-[#22c55e]">{gap}pt ahead</span> of the planned line.
          </>
        ) : (
          <>
            <span className="font-bold text-[#ef4444]">{Math.abs(gap)}pt behind</span> the planned
            line — that gap is the confidence number
            {planConfidenceDisplay(confidence).hint ? "" : ` (${planConfidenceDisplay(confidence).value})`}.
          </>
        )}
      </p>
    </VizCard>
  );
}

function OwnerLoad({
  items,
  employees,
  onPick,
}: {
  items: (Item & { health?: Health })[];
  employees: Employee[];
  onPick: (id: string | null) => void;
}) {
  const open = items.filter((i) => i.status !== "done");
  const byOwner = new Map<string, (Item & { health?: Health })[]>();
  open.forEach((i) => {
    const k = i.owner_id ?? "unassigned";
    byOwner.set(k, [...(byOwner.get(k) ?? []), i]);
  });
  const max = Math.max(1, ...[...byOwner.values()].map((v) => v.length));
  const rows = [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  return (
    <VizCard title="Owner load · open actions">
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-xs text-slate-400">All actions complete.</p>}
        {rows.map(([ownerId, list]) => {
          const name =
            ownerId === "unassigned"
              ? "Unassigned"
              : (employees.find((e) => e.id === ownerId)?.name ?? "—");
          return (
            <button
              key={ownerId}
              className="block w-full text-left"
              onClick={() => onPick(ownerId === "unassigned" ? null : ownerId)}
            >
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{name}</span>
                <span className="tabular-nums text-slate-400">{list.length}</span>
              </div>
              <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-amber-900/5 dark:bg-slate-800/60">
                {list.map((i) => (
                  <div
                    key={i.id}
                    style={{ width: `${(1 / max) * 100}%`, background: healthMeta(i.health).color }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </VizCard>
  );
}
