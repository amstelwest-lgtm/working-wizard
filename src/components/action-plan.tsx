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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { sendTransactionalEmail } from "@/lib/email/send";
import {
  AlertTriangle, CalendarDays, Check, ChevronRight, GripVertical, Link as LinkIcon, Loader2, Mail, Plus,
  RotateCcw, Send, Sparkles, Target, Trash2, UserPlus, X,
} from "lucide-react";

// ── Brand (matches cash-forecast / waterfall) ────────────────────────────────
const GOLD = "#d4a550";
const GOLD_DARK = "#b8860b";
const CARD_SHELL =
  "relative overflow-hidden border border-amber-900/15 bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.13),transparent_34%),linear-gradient(135deg,#fffdf8,#f8f5ed)] shadow-[0_20px_60px_rgba(109,79,22,0.10)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_34%),linear-gradient(135deg,#111827,#0b1220)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.25)]";
const GOLD_RULE =
  "pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#b7872a] via-[#f1d28b] to-transparent";
const INPUT_CLS =
  "border-amber-900/15 bg-white/70 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100";
const LABEL_CLS = "text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400";

// ── Types ────────────────────────────────────────────────────────────────────
type Status = "not_started" | "in_progress" | "done" | "blocked";
type Health = "on_track" | "at_risk" | "off_track" | "overdue" | "complete";

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
};

type Employee = { id: string; name: string; email: string | null; role: string | null };
type Milestone = { id: string; action_item_id: string; week_no: number; label: string; is_done: boolean };
type EmailRecord = {
  id: string;
  action_item_id: string;
  email_type: string;
  status: string;
  sent_at: string | null;
  created_at: string;
};
type Update = {
  id: string; actor_type: string; actor_label: string;
  status_from: Status | null; status_to: Status | null;
  progress_from: number | null; progress_to: number | null;
  note: string | null; created_at: string;
};

export type StrategicMoveLite = {
  key: string;
  title: string;
  ratioName: string;
  impactLine?: string;
  health: number;
};

interface Props {
  clientId: string;
  clientName?: string;
  simplified?: boolean;
  /** When false the UI is read-only: members cannot edit goals, add/delete actions, or send emails. */
  isOwner?: boolean;
  moves?: StrategicMoveLite[];
  onViewAnalysis?: (driverKey?: string) => void;
  /** Move key whose Action Plan item should be highlighted/scrolled to on load. */
  focusMoveKey?: string | null;
  /** Called once the focus has been applied, so the parent can clear it. */
  onFocusHandled?: () => void;
}

// ── Derived health (mirrors SQL action_item_health) ─────────────────────────
function deriveHealth(it: Pick<Item, "status" | "due_date" | "progress_pct" | "created_at">): Health {
  if (it.status === "done") return "complete";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (it.due_date && new Date(it.due_date + "T00:00:00") < today) return "overdue";
  if (it.status === "blocked") return "off_track";
  if (!it.due_date) return "on_track";
  const pace = paceOf(it);
  if (pace >= 0.9) return "on_track";
  if (pace >= 0.6) return "at_risk";
  return "off_track";
}
/** actual progress ÷ expected progress by now (0..∞, clamped later) */
function paceOf(it: Pick<Item, "due_date" | "progress_pct" | "created_at">): number {
  if (!it.due_date) return 1;
  const created = new Date(it.created_at).getTime();
  const due = new Date(it.due_date + "T23:59:59").getTime();
  const expected = Math.max((100 * (Date.now() - created)) / Math.max(due - created, 1), 5);
  return it.progress_pct / expected;
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
  on_track:  { label: "On track",  color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  at_risk:   { label: "At risk",   color: "#f5a524", bg: "rgba(245,165,36,0.12)" },
  off_track: { label: "Off track", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  overdue:   { label: "Overdue",   color: "#ef4444", bg: "rgba(239,68,68,0.16)" },
  complete:  { label: "Done",      color: "#8a938c", bg: "rgba(138,147,140,0.15)" },
};
const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started", in_progress: "In progress", done: "Done", blocked: "Blocked",
};

function fmtDue(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}
function defaultPeriodLabel() {
  const now = new Date();
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
}
function defaultTargetDate() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10);
}
function itemScore(it: Item): number {
  const h = deriveHealth(it);
  if (h === "complete") return 1;
  if (h === "overdue" || it.status === "blocked") return 0.2;
  return Math.max(0, Math.min(1, paceOf(it)));
}

// ═════════════════════════════════════════════════════════════════════════════
export default function ActionPlanPanel({ clientId, clientName, simplified, isOwner = true, moves = [], onViewAnalysis, focusMoveKey, onFocusHandled }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "overdue" | "at_risk" | "blocked" | "done">("all");
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"seq" | "due" | "owner" | "status">("seq");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // Per-item email summary: track last nudge/overdue chase and last failure independently
  const [lastNudgeEmails, setLastNudgeEmails] = useState<Record<string, EmailRecord>>({});
  const [lastFailedEmails, setLastFailedEmails] = useState<Record<string, EmailRecord>>({});
  const dragSeq = useRef<string | null>(null);
  // Item briefly highlighted after arriving from Next Moves → Assign
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    const { data: plans } = await supabase
      .from("action_plans").select("*")
      .eq("client_id", clientId).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1);
    let p = (plans?.[0] as Plan) ?? null;
    if (!p) {
      // Members cannot create plans — show empty read-only state instead.
      if (!isOwner) { setLoading(false); return; }
      const { data: created, error } = await supabase
        .from("action_plans")
        .insert({
          client_id: clientId,
          period_label: defaultPeriodLabel(),
          outcome_goal: "Set your outcome goal for this quarter",
          target_date: defaultTargetDate(),
        })
        .select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      p = created as Plan;
    }
    setPlan(p);
    const [{ data: its }, { data: emps }] = await Promise.all([
      supabase.from("action_items_v").select("*").eq("plan_id", p.id).order("seq"),
      supabase.from("client_employees").select("id,name,email,role").eq("client_id", clientId).order("name"),
    ]);
    const list = (its ?? []) as Item[];
    setItems(list);
    setEmployees((emps ?? []) as Employee[]);
    if (list.length) {
      const ids = list.map((i) => i.id);
      const [{ data: ms }, { data: emails }] = await Promise.all([
        supabase.from("action_milestones").select("*").in("action_item_id", ids).order("week_no"),
        supabase.from("action_emails")
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
    } else { setMilestones([]); setLastNudgeEmails({}); setLastFailedEmails({}); }
    setLoading(false);
  }, [clientId, isOwner]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // Focus the item created from a Next Move (highlight + scroll into view)
  useEffect(() => {
    if (loading || !focusMoveKey) return;
    const target = items.find((i) => i.source_move_key === focusMoveKey);
    onFocusHandled?.();
    if (!target) return;
    setFocusedItemId(target.id);
    requestAnimationFrame(() => {
      document.querySelector(`[data-row-id="${target.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const t = setTimeout(() => setFocusedItemId(null), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, focusMoveKey, items.length]);

  // ── Mutation helpers ─────────────────────────────────────────────────────────
  const patchItem = async (id: string, patch: Partial<Item>, log?: Partial<Update>) => {
    const prev = items.find((i) => i.id === id);
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from("action_items").update(patch).eq("id", id);
    if (error) { toast.error(error.message); refresh(); return; }
    if (log && prev) {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("action_updates").insert({
        action_item_id: id, client_id: clientId,
        actor_type: "owner_app",
        actor_label: u.user?.email?.split("@")[0] ?? "Owner",
        status_from: prev.status, status_to: (patch.status as Status) ?? prev.status,
        progress_from: prev.progress_pct, progress_to: patch.progress_pct ?? prev.progress_pct,
        ...log,
      });
    }
  };

  const addItem = async (title: string, extra?: Partial<Item>) => {
    if (!plan) return;
    const seq = (items.reduce((m, i) => Math.max(m, i.seq), 0) ?? 0) + 1;
    const { data, error } = await supabase
      .from("action_items")
      .insert({ plan_id: plan.id, client_id: clientId, seq, title, ...extra })
      .select().single();
    if (error) { toast.error(error.message); return; }
    setItems((arr) => [...arr, data as Item]);
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Delete this action? Its link will stop working.")) return;
    setItems((arr) => arr.filter((i) => i.id !== id));
    setDrawerId(null);
    const { error } = await supabase.from("action_items").delete().eq("id", id);
    if (error) { toast.error(error.message); refresh(); }
  };

  const addEmployee = async (name: string, email: string): Promise<Employee | null> => {
    const { data, error } = await supabase
      .from("client_employees")
      .insert({ client_id: clientId, name: name.trim(), email: email.trim() || null })
      .select("id,name,email,role").single();
    if (error) { toast.error(error.message); return null; }
    setEmployees((arr) => [...arr, data as Employee]);
    return data as Employee;
  };

  // ── Send assignments ─────────────────────────────────────────────────────────
  const mintLink = async (itemId: string, action: "mint" | "reassign" = "mint", employeeId?: string) => {
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
    return `${window.location.origin}/t/${body.token}` as string;
  };

  const sendAssignment = async (
    it: Item,
    emailType: "assignment" | "nudge" = "assignment",
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
          outcomeWhy: it.outcome_why ?? undefined,
          dueDate: it.due_date
            ? new Date(it.due_date + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })
            : undefined,
          periodLabel: plan?.period_label,
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
      const { data: failedRecord } = await supabase.from("action_emails").insert({
        action_item_id: it.id, client_id: clientId,
        recipient_email: owner.email, email_type: emailType, status: "failed",
        sent_at: now,
      }).select("id,action_item_id,email_type,status,sent_at,created_at").single();
      if (failedRecord) {
        setLastFailedEmails((prev) => ({ ...prev, [it.id]: failedRecord as EmailRecord }));
      }
      try { await navigator.clipboard.writeText(url); } catch { /* clipboard unavailable */ }
      throw new Error("Email sending isn't set up yet — the task link was copied to your clipboard instead. Share it with the employee directly.");
    }
    if (sendOk) {
      const { data: sentRecord } = await supabase.from("action_emails").insert({
        action_item_id: it.id, client_id: clientId,
        recipient_email: owner.email, email_type: emailType, status: "queued",
        sent_at: now,
      }).select("id,action_item_id,email_type,status,sent_at,created_at").single();
      if (sentRecord && emailType !== "assignment") {
        setLastNudgeEmails((prev) => ({ ...prev, [it.id]: sentRecord as EmailRecord }));
      }
      await supabase.from("action_items").update({ sent_at: now }).eq("id", it.id);
      setItems((arr) => arr.map((i) => (i.id === it.id ? { ...i, sent_at: now } : i)));
    }
  };

  const unsent = items.filter((i) => !i.sent_at && i.status !== "done");
  const ready = unsent.filter((i) => i.owner_id && i.due_date && employees.find((e) => e.id === i.owner_id)?.email);
  const sendBatch = async () => {
    if (!ready.length) return;
    setSending(true);
    let ok = 0;
    for (const it of ready) {
      try { await sendAssignment(it); ok++; }
      catch (e: any) { toast.error(`${it.title}: ${e.message ?? e}`); }
    }
    setSending(false);
    if (ok) toast.success(`${ok} assignment${ok > 1 ? "s" : ""} sent`);
  };

  // ── Import from strategic moves ──────────────────────────────────────────────
  const importedKeys = useMemo(
    () => new Set(items.filter((i) => i.source_move_key).map((i) => i.source_move_key)),
    [items],
  );
  const importMoves = async (keys: string[]) => {
    for (const k of keys) {
      const mv = moves.find((m) => m.key === k);
      if (!mv || importedKeys.has(k)) continue;
      await addItem(mv.title, {
        source: "strategic_move",
        source_move_key: mv.key,
        driver_key: mv.key,
        outcome_why: mv.impactLine ?? `Improves ${mv.ratioName}.`,
      });
    }
    setImportOpen(false);
  };

  // ── Derived views ─────────────────────────────────────────────────────────────
  const enriched = useMemo(
    () => items.map((i) => ({ ...i, health: deriveHealth(i) })),
    [items],
  );
  const filtered = useMemo(() => {
    let list = enriched;
    if (filter === "overdue") list = list.filter((i) => i.health === "overdue");
    else if (filter === "at_risk") list = list.filter((i) => i.health === "at_risk" || i.health === "off_track");
    else if (filter === "blocked") list = list.filter((i) => i.status === "blocked");
    else if (filter === "done") list = list.filter((i) => i.status === "done");
    if (ownerFilter) list = list.filter((i) => i.owner_id === ownerFilter);
    const by = [...list];
    if (sortBy === "due") by.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    else if (sortBy === "owner") by.sort((a, b) => (a.owner_name ?? "").localeCompare(b.owner_name ?? ""));
    else if (sortBy === "status") by.sort((a, b) => a.status.localeCompare(b.status));
    else by.sort((a, b) => a.seq - b.seq);
    return by;
  }, [enriched, filter, ownerFilter, sortBy]);

  const confidence = useMemo(() => {
    const open = enriched.filter(Boolean);
    if (!open.length) return null;
    return Math.round(100 * (open.reduce((s, i) => s + itemScore(i), 0) / open.length));
  }, [enriched]);

  const healthCounts = useMemo(() => {
    const c: Record<Health, number> = { on_track: 0, at_risk: 0, off_track: 0, overdue: 0, complete: 0 };
    enriched.forEach((i) => { c[i.health!]++; });
    return c;
  }, [enriched]);

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
      await supabase.from("action_items").update({ seq: 1000 + idx }).eq("id", ordered[idx].id);
    }
    for (let idx = 0; idx < ordered.length; idx++) {
      await supabase.from("action_items").update({ seq: idx + 1 }).eq("id", ordered[idx].id);
    }
    setSortBy("seq");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading action plan…
      </div>
    );
  }
  if (!plan) {
    if (!isOwner) {
      return (
        <div className="rounded-xl border border-amber-900/10 bg-white/60 p-8 text-center dark:border-slate-800 dark:bg-slate-900/50">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No action plan yet</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The owner hasn't set up an action plan for this period.</p>
        </div>
      );
    }
    return <div className="p-6 text-sm text-slate-500">Couldn't load the plan.</div>;
  }

  const drawerItem = drawerId ? enriched.find((i) => i.id === drawerId) ?? null : null;

  return (
    <div id="wizard-action-plan" className="space-y-5">
      <GoalHeader plan={plan} confidence={confidence} isOwner={isOwner} onChange={async (patch) => {
        setPlan({ ...plan, ...patch });
        const { error } = await supabase.from("action_plans").update(patch).eq("id", plan.id);
        if (error) toast.error(error.message);
      }} />

      {moves.length > 0 && (
        <DriversStrip moves={moves.slice(0, 5)} onView={onViewAnalysis} />
      )}

      {/* ── The table ── */}
      <Card id="wizard-action-list" className={CARD_SHELL}>
        <div className={GOLD_RULE} />
        <CardHeader className="border-b border-amber-900/10 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                Actions
              </CardTitle>
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                {enriched.filter((i) => i.status !== "done").length} open · assigned work, visible progress
              </span>
            </div>
            {isOwner && (
              <div className="flex flex-wrap items-center gap-2">
                {moves.length > 0 && (
                  <Button size="sm" variant="outline" className={INPUT_CLS} onClick={() => setImportOpen(true)}>
                    <Sparkles className="mr-1 h-3.5 w-3.5 text-[#b8860b] dark:text-[#d4a550]" />
                    Import from Strategic Moves
                  </Button>
                )}
                {unsent.length > 0 && (
                  <Button
                    size="sm"
                    disabled={!ready.length || sending}
                    onClick={sendBatch}
                    className="bg-[#b8860b] text-white hover:bg-[#9a7009] dark:bg-[#d4a550] dark:text-slate-950 dark:hover:bg-[#c69440]"
                  >
                    {sending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                    {ready.length === unsent.length
                      ? `Send ${ready.length} assignment${ready.length === 1 ? "" : "s"}`
                      : `${ready.length} of ${unsent.length} ready to send`}
                  </Button>
                )}
              </div>
            )}
          </div>
          {/* Filters */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {([
              ["all", "All"], ["overdue", "Overdue"], ["at_risk", "At risk"], ["blocked", "Blocked"], ["done", "Done"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  filter === k
                    ? "bg-[#b8860b] text-white dark:bg-[#d4a550] dark:text-slate-950"
                    : "border border-amber-900/15 text-slate-600 hover:bg-amber-900/5 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-amber-900/15 dark:bg-slate-700" />
            <select
              value={ownerFilter ?? ""}
              onChange={(e) => setOwnerFilter(e.target.value || null)}
              className={`rounded-md border px-2 py-1 text-[11px] ${INPUT_CLS}`}
            >
              <option value="">All owners</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
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
        </CardHeader>
        <CardContent className="px-0 pb-2 pt-0">
          {filtered.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {items.length === 0
                ? "No actions yet. Import from Strategic Moves or type one below."
                : "Nothing matches this filter."}
            </p>
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
                onDragStart={() => { dragSeq.current = it.id; }}
                onDrop={() => onDropRow(it.id)}
                onOpen={() => setDrawerId(it.id)}
                onPatch={(patch, log) => patchItem(it.id, patch, log)}
                onAddEmployee={addEmployee}
              />
            ))}
          </div>
          {isOwner && <QuickAdd onAdd={(title) => addItem(title)} />}
        </CardContent>
      </Card>

      {/* ── Footer visuals ── */}
      {enriched.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <HealthDonut counts={healthCounts} total={enriched.length} onPick={(h) => {
            setFilter(h === "overdue" ? "overdue" : h === "at_risk" || h === "off_track" ? "at_risk" : h === "complete" ? "done" : "all");
          }} />
          <BurnUp plan={plan} items={enriched} confidence={confidence} />
          <OwnerLoad items={enriched} employees={employees} onPick={setOwnerFilter} />
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
            try { await sendAssignment(drawerItem); toast.success("Link re-sent"); }
            catch (e: any) { toast.error(e.message ?? String(e)); }
          }}
          onCopyLink={async () => {
            try {
              const url = await mintLink(drawerItem.id);
              await navigator.clipboard.writeText(url);
              toast.success("Task link copied — share it with the employee");
            } catch (e: any) { toast.error(e.message ?? String(e)); }
          }}
          onReassign={async (empId) => {
            const emp = employees.find((e) => e.id === empId);
            const old = employees.find((e) => e.id === drawerItem.owner_id);
            if (!emp) return;
            if (old && !confirm(`${old.name}'s link will stop working. Send ${emp.name} a new one?`)) return;
            try {
              const newUrl = await mintLink(drawerItem.id, "reassign", empId);
              setItems((arr) => arr.map((i) => (i.id === drawerItem.id ? { ...i, owner_id: empId, owner_name: emp.name, owner_email: emp.email, sent_at: null } : i)));
              if (emp.email) {
                await sendAssignment({ ...drawerItem, owner_id: empId }, "assignment", newUrl);
                toast.success(`Reassigned & emailed ${emp.name}`);
              } else toast.success(`Reassigned to ${emp.name} (no email on file)`);
            } catch (e: any) { toast.error(e.message ?? String(e)); }
          }}
          onMilestonesChanged={refresh}
        />
      )}
    </div>
  );
}

// ═══ Goal header ═════════════════════════════════════════════════════════════
function GoalHeader({ plan, confidence, isOwner = true, onChange }: {
  plan: Plan; confidence: number | null;
  isOwner?: boolean;
  onChange: (patch: Partial<Plan>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan);
  useEffect(() => setDraft(plan), [plan]);

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b8860b] dark:text-[#d4a550]/80">
                {plan.period_label} · Outcome goal
              </span>
              {isOwner && (
                <button
                  className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-[#b8860b] dark:hover:text-[#d4a550]"
                  onClick={() => setEditing((e) => !e)}
                >
                  {editing ? "Close" : "Edit"}
                </button>
              )}
            </div>
            {!editing ? (
              <>
                <h2 className="mt-2 text-2xl font-black uppercase leading-tight tracking-tight text-slate-950 dark:text-white">
                  {plan.outcome_goal}
                </h2>
                {plan.why_statement && (
                  <p className="mt-1.5 max-w-2xl text-sm text-slate-600 dark:text-slate-400">{plan.why_statement}</p>
                )}
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                  Target {new Date(plan.target_date + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </>
            ) : (
              <div className="mt-3 grid max-w-2xl gap-2.5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div><div className={LABEL_CLS}>Period</div>
                    <Input className={INPUT_CLS} value={draft.period_label} onChange={(e) => setDraft({ ...draft, period_label: e.target.value })} /></div>
                  <div><div className={LABEL_CLS}>Target date</div>
                    <Input className={INPUT_CLS} type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })} /></div>
                </div>
                <div><div className={LABEL_CLS}>Outcome goal</div>
                  <Input className={INPUT_CLS} value={draft.outcome_goal} onChange={(e) => setDraft({ ...draft, outcome_goal: e.target.value })} /></div>
                <div><div className={LABEL_CLS}>Why (first principles)</div>
                  <Input className={INPUT_CLS} value={draft.why_statement ?? ""} onChange={(e) => setDraft({ ...draft, why_statement: e.target.value })} /></div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div><div className={LABEL_CLS}>Metric</div>
                    <Input className={INPUT_CLS} placeholder="Cash on hand" value={draft.metric_name ?? ""} onChange={(e) => setDraft({ ...draft, metric_name: e.target.value })} /></div>
                  <div><div className={LABEL_CLS}>Start</div>
                    <Input className={INPUT_CLS} type="number" value={draft.metric_start ?? ""} onChange={(e) => setDraft({ ...draft, metric_start: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                  <div><div className={LABEL_CLS}>Current</div>
                    <Input className={INPUT_CLS} type="number" value={draft.metric_current ?? ""} onChange={(e) => setDraft({ ...draft, metric_current: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                  <div><div className={LABEL_CLS}>Target</div>
                    <Input className={INPUT_CLS} type="number" value={draft.metric_target ?? ""} onChange={(e) => setDraft({ ...draft, metric_target: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                </div>
                <div>
                  <Button size="sm" className="bg-[#b8860b] text-white hover:bg-[#9a7009] dark:bg-[#d4a550] dark:text-slate-950"
                    onClick={() => { onChange(draft); setEditing(false); }}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Save goal
                  </Button>
                </div>
              </div>
            )}
          </div>
          {confidence != null && (
            <div className="shrink-0 rounded-xl border border-amber-900/10 bg-white/60 px-5 py-3 text-center dark:border-slate-800 dark:bg-slate-900/50">
              <div className={LABEL_CLS}>Plan confidence</div>
              <div
                className="mt-0.5 text-3xl font-black tabular-nums tracking-tight"
                style={{ color: confidence >= 75 ? "#22c55e" : confidence >= 50 ? "#f5a524" : "#ef4444" }}
              >
                {confidence}%
              </div>
            </div>
          )}
        </div>

        {/* Gap-to-goal bar with pace marker */}
        {hasBar && (
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span>{plan.metric_name ?? "Metric"}: {s!.toLocaleString("en-ZA")}</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{(c ?? s)!.toLocaleString("en-ZA")}</span>
              <span>Target {t!.toLocaleString("en-ZA")}</span>
            </div>
            <div className="relative h-3 overflow-visible rounded-full bg-amber-900/10 dark:bg-slate-800">
              <div
                className="h-3 rounded-full transition-all"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${GOLD_DARK}, ${GOLD})` }}
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
              {pct >= timePct
                ? <span className="font-semibold text-[#22c55e]">Ahead of pace.</span>
                : <span className="font-semibold text-[#ef4444]">Behind pace — the gap is the work below.</span>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══ Drivers strip ═══════════════════════════════════════════════════════════
function DriversStrip({ moves, onView }: { moves: StrategicMoveLite[]; onView?: (k?: string) => void }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
      {moves.map((m) => {
        const tone =
          m.health >= 65 ? "#22c55e" : m.health >= 40 ? "#f5a524" : "#ef4444";
        return (
          <button
            key={m.key}
            onClick={() => onView?.(m.key)}
            className="group rounded-xl border border-amber-900/10 bg-white/60 px-3.5 py-3 text-left transition-colors hover:border-[#d4a550]/40 dark:border-slate-800 dark:bg-slate-900/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL_CLS}>{m.ratioName}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
            </div>
            <div className="mt-1 text-lg font-extrabold tabular-nums tracking-tight text-slate-950 dark:text-white">
              {Math.round(m.health)}<span className="text-xs font-semibold text-slate-400">/100</span>
            </div>
            <div className="mt-0.5 flex items-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 group-hover:text-[#b8860b] dark:group-hover:text-[#d4a550]">
              View full analysis <ChevronRight className="h-3 w-3" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ═══ Table row ═══════════════════════════════════════════════════════════════
function ItemRow({ item, employees, milestones, lastNudge, lastFailed, draggable, isOwner = true, onDragStart, onDrop, onOpen, onPatch, onAddEmployee, focused }: {
  item: Item & { health?: Health };
  focused?: boolean;
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
  onAddEmployee: (name: string, email: string) => Promise<Employee | null>;
}) {
  const h = HEALTH_META[item.health ?? "on_track"];
  const overdue = item.health === "overdue";
  const [editTitle, setEditTitle] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [pickOwner, setPickOwner] = useState(false);
  const exp = expectedPct(item);
  const msDone = milestones.filter((m) => m.is_done).length;

  return (
    <div
      className={`group flex cursor-pointer items-center gap-3 border-b border-amber-900/10 px-4 py-3 transition-colors hover:bg-amber-900/[0.03] dark:border-slate-800/70 dark:hover:bg-slate-800/30 ${
        overdue ? "border-l-2 border-l-[#ef4444]" : "border-l-2 border-l-transparent"
      } ${focused ? "bg-[#f7d98a]/20 ring-2 ring-inset ring-[#b7872a] dark:bg-[rgba(247,217,138,0.10)]" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onClick={onOpen}
      data-row-id={item.id}
    >
      {draggable && (
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600"
          onClick={(e) => e.stopPropagation()} />
      )}
      <span className="w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-400 dark:text-slate-500">
        {item.seq}
      </span>

      {/* Title + why (inline edit — owners only) */}
      <div className="min-w-0 flex-1">
        {isOwner && editTitle ? (
          <Input
            autoFocus
            className={`h-7 text-sm ${INPUT_CLS}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditTitle(false); if (title.trim() && title !== item.title) onPatch({ title: title.trim() }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setTitle(item.title); setEditTitle(false); } }}
          />
        ) : (
          <button
            className={`block w-full truncate text-left text-sm font-semibold ${item.status === "done" ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}
            onDoubleClick={isOwner ? (e) => { e.stopPropagation(); setEditTitle(true); } : undefined}
            onClick={(e) => e.stopPropagation()}
            title={isOwner ? "Double-click to edit title — click row to open details" : "Click row to open details"}
          >
            {item.title}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {item.source === "strategic_move" && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#b8860b] dark:text-[#d4a550]/90">
              <Sparkles className="h-2.5 w-2.5" /> From strategic moves
            </span>
          )}
          {item.outcome_why && <span className="truncate">{item.outcome_why}</span>}
        </div>
      </div>

      {/* Owner */}
      <div className="w-32 shrink-0">
        {isOwner && pickOwner ? (
          <OwnerPicker
            employees={employees}
            onPick={(id) => { setPickOwner(false); if (id) onPatch({ owner_id: id, owner_name: employees.find((e) => e.id === id)?.name, sent_at: null } as any); }}
            onAdd={onAddEmployee}
            onClose={() => setPickOwner(false)}
          />
        ) : (
          <button
            className={`w-full truncate rounded-md px-1.5 py-1 text-left text-xs font-medium text-slate-700 dark:text-slate-300 ${isOwner ? "hover:bg-amber-900/5 dark:hover:bg-slate-800" : "cursor-default"}`}
            onClick={isOwner ? (e) => { e.stopPropagation(); setPickOwner(true); } : (e) => e.stopPropagation()}
          >
            {item.owner_name ?? (isOwner ? <span className="text-slate-400 dark:text-slate-500">+ Owner</span> : <span className="text-slate-400 dark:text-slate-500">—</span>)}
          </button>
        )}
      </div>

      {/* Due */}
      <div className="w-24 shrink-0">
        <input
          type="date"
          value={item.due_date ?? ""}
          onChange={isOwner ? (e) => onPatch({ due_date: e.target.value || null } as any) : undefined}
          onClick={(e) => e.stopPropagation()}
          readOnly={!isOwner}
          className={`w-full rounded-md border-0 bg-transparent px-1 py-1 text-xs font-medium tabular-nums ${isOwner ? "cursor-pointer" : "cursor-default"} ${overdue ? "text-[#ef4444] font-bold" : "text-slate-700 dark:text-slate-300"}`}
        />
      </div>

      {/* Progress + pace marker */}
      <div className="hidden w-28 shrink-0 sm:block">
        <div className="relative h-1.5 rounded-full bg-amber-900/10 dark:bg-slate-800">
          <div className="h-1.5 rounded-full" style={{ width: `${item.progress_pct}%`, background: h.color }} />
          {exp != null && item.status !== "done" && (
            <div className="absolute -top-[3px] h-3 w-px bg-slate-500 dark:bg-slate-400" style={{ left: `${exp}%` }} />
          )}
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          <span>{item.progress_pct}%</span>
          {milestones.length > 0 && <span>{msDone}/{milestones.length} wk</span>}
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
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
              title={`Last ${lastNudge.email_type === "nudge" ? "nudge" : "overdue reminder"} sent ${lastNudge.sent_at ? new Date(lastNudge.sent_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : ""}`}
            >
              <Mail className="h-3 w-3" />
              {lastNudge.email_type === "nudge" ? "Nudged" : "Overdue"}
            </span>
          ) : item.sent_at ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              <Mail className="h-3 w-3" /> Sent
            </span>
          ) : !lastFailed ? (
            <span className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Not sent</span>
          ) : null}
          {lastNudge?.sent_at && (
            <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
              {new Date(lastNudge.sent_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
      </div>

      {/* Health chip + open indicator */}
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-bold"
          style={{ color: h.color, background: h.bg }}
        >
          {h.label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600" />
      </div>
    </div>
  );
}

function OwnerPicker({ employees, onPick, onAdd, onClose }: {
  employees: Employee[];
  onPick: (id: string | null) => void;
  onAdd: (name: string, email: string) => Promise<Employee | null>;
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
  const list = employees.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className="absolute z-30 mt-1 w-56 rounded-lg border border-amber-900/15 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {!adding ? (
        <>
          <Input autoFocus placeholder="Search…" className={`mb-1 h-7 text-xs ${INPUT_CLS}`} value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
          <div className="max-h-40 overflow-auto">
            {list.map((e) => (
              <button key={e.id} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-amber-900/5 dark:hover:bg-slate-800"
                onClick={() => onPick(e.id)}>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{e.name}</span>
                {!e.email && <span className="ml-1 text-[10px] text-amber-600">no email</span>}
              </button>
            ))}
            {list.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-400">No matches</p>}
          </div>
          <button className="mt-1 flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs font-semibold text-[#b8860b] hover:bg-amber-900/5 dark:text-[#d4a550] dark:hover:bg-slate-800"
            onClick={() => setAdding(true)}>
            <UserPlus className="h-3 w-3" /> Add employee
          </button>
        </>
      ) : (
        <div className="space-y-1.5">
          <Input autoFocus placeholder="Name" className={`h-7 text-xs ${INPUT_CLS}`} value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Email" type="email" className={`h-7 text-xs ${INPUT_CLS}`} value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex gap-1">
            <Button size="sm" className="h-7 flex-1 bg-[#b8860b] text-xs text-white dark:bg-[#d4a550] dark:text-slate-950"
              onClick={async () => { if (!name.trim()) return; const emp = await onAdd(name, email); if (emp) onPick(emp.id); }}>
              Add
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>Back</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ Quick add ═══════════════════════════════════════════════════════════════
function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Plus className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) { onAdd(v.trim()); setV(""); }
        }}
        placeholder="Type an action and press Enter — owner and date can follow"
        className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-500"
      />
    </div>
  );
}

// ═══ Import panel ════════════════════════════════════════════════════════════
function ImportPanel({ moves, importedKeys, onClose, onImport }: {
  moves: StrategicMoveLite[];
  importedKeys: Set<string | null>;
  onClose: () => void;
  onImport: (keys: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        className={`w-full max-w-lg rounded-2xl p-5 ${CARD_SHELL}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={GOLD_RULE} />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-950 dark:text-white">Import from Strategic Moves</h3>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-slate-400" /></button>
        </div>
        <div className="max-h-80 space-y-1.5 overflow-auto">
          {moves.map((m) => {
            const added = importedKeys.has(m.key);
            const checked = sel.has(m.key);
            return (
              <button
                key={m.key}
                disabled={added}
                onClick={() => setSel((s) => { const n = new Set(s); checked ? n.delete(m.key) : n.add(m.key); return n; })}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  added
                    ? "cursor-default border-transparent opacity-45"
                    : checked
                      ? "border-[#d4a550]/60 bg-[#d4a550]/10"
                      : "border-amber-900/10 hover:border-[#d4a550]/40 dark:border-slate-800"
                }`}
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-black ${
                  checked ? "border-[#b8860b] bg-[#b8860b] text-white dark:border-[#d4a550] dark:bg-[#d4a550] dark:text-slate-950" : "border-slate-300 dark:border-slate-600"
                }`}>{checked && "✓"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{m.title}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">{m.ratioName}{m.impactLine ? ` · ${m.impactLine}` : ""}</span>
                </span>
                {added && <span className="shrink-0 text-[10px] font-bold uppercase text-slate-400">Added</span>}
              </button>
            );
          })}
        </div>
        <Button
          disabled={!sel.size}
          onClick={() => onImport([...sel])}
          className="mt-4 w-full bg-[#b8860b] text-white hover:bg-[#9a7009] dark:bg-[#d4a550] dark:text-slate-950 dark:hover:bg-[#c69440]"
        >
          Add {sel.size || ""} action{sel.size === 1 ? "" : "s"} to the plan
        </Button>
      </div>
    </div>
  );
}

// ═══ Drawer ══════════════════════════════════════════════════════════════════
function ItemDrawer({ item, employees, milestones, isOwner = true, onClose, onPatch, onDelete, onResend, onCopyLink, onReassign, onMilestonesChanged }: {
  item: Item & { health?: Health };
  employees: Employee[];
  milestones: Milestone[];
  isOwner?: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Item>, log?: Partial<Update>) => void;
  onDelete: () => void;
  onResend: () => Promise<void>;
  onCopyLink: () => Promise<void>;
  onReassign: (employeeId: string) => Promise<void>;
  onMilestonesChanged: () => void;
}) {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [emailHistory, setEmailHistory] = useState<EmailRecord[]>([]);
  const [newMs, setNewMs] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [resending, setResending] = useState(false);
  const h = HEALTH_META[item.health ?? "on_track"];

  useEffect(() => {
    Promise.all([
      supabase.from("action_updates").select("*")
        .eq("action_item_id", item.id).order("created_at", { ascending: false }).limit(30),
      supabase.from("action_emails")
        .select("id,action_item_id,email_type,status,sent_at,created_at")
        .eq("action_item_id", item.id).order("created_at", { ascending: false }),
    ]).then(([{ data: updData }, { data: emailData }]) => {
      setUpdates((updData ?? []) as Update[]);
      setEmailHistory((emailData ?? []) as EmailRecord[]);
    });
  }, [item.id]);

  const addMilestone = async () => {
    if (!newMs.trim()) return;
    const week = (milestones.reduce((m, x) => Math.max(m, x.week_no), 0) ?? 0) + 1;
    if (week > 12) { toast.error("Max 12 weekly milestones"); return; }
    const { error } = await supabase.from("action_milestones").insert({
      action_item_id: item.id, week_no: week, label: newMs.trim(),
    });
    if (error) { toast.error(error.message); return; }
    setNewMs("");
    onMilestonesChanged();
  };
  const toggleMs = async (m: Milestone) => {
    await supabase.from("action_milestones")
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
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-amber-900/15 bg-[#fffdf8] p-5 shadow-2xl dark:border-slate-800 dark:bg-[#0d1524]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ color: h.color, background: h.bg }}>
              {h.label}
            </span>
            <h3 className="mt-2 text-lg font-black leading-tight text-slate-950 dark:text-white">{item.title}</h3>
            {item.outcome_why && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.outcome_why}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-slate-400" /></button>
        </div>

        {/* Status override + progress — owners only */}
        {isOwner ? (
          <>
            <div className={LABEL_CLS}>Status (owner override)</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <button
                  key={s}
                  onClick={() => onPatch(
                    { status: s, ...(s === "done" ? { progress_pct: 100, completed_at: new Date().toISOString() } : { completed_at: null }) } as any,
                    {},
                  )}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                    item.status === s
                      ? "bg-[#b8860b] text-white dark:bg-[#d4a550] dark:text-slate-950"
                      : "border border-amber-900/15 text-slate-600 dark:border-slate-700 dark:text-slate-400"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {item.status === "blocked" && item.blocker_note && (
              <p className="mt-2 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#ef4444]">
                Blocker: {item.blocker_note}
              </p>
            )}
            <div className={`mt-4 ${LABEL_CLS}`}>Progress — {item.progress_pct}%</div>
            <input
              type="range" min={0} max={100} step={5}
              value={item.progress_pct}
              onChange={(e) => onPatch({ progress_pct: Number(e.target.value) } as any, {})}
              className="mt-1 w-full accent-[#d4a550]"
            />
          </>
        ) : (
          <>
            <div className={LABEL_CLS}>Status</div>
            <span className="mt-1.5 inline-block rounded-md px-2.5 py-1 text-[11px] font-semibold bg-[#b8860b] text-white dark:bg-[#d4a550] dark:text-slate-950">
              {STATUS_LABEL[item.status]}
            </span>
            {item.status === "blocked" && item.blocker_note && (
              <p className="mt-2 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#ef4444]">
                Blocker: {item.blocker_note}
              </p>
            )}
            <div className={`mt-4 ${LABEL_CLS}`}>Progress — {item.progress_pct}%</div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-amber-900/10 dark:bg-slate-800">
              <div className="h-2 rounded-full bg-[#d4a550]" style={{ width: `${item.progress_pct}%` }} />
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
                  m.is_done ? "border-[#22c55e] bg-[#22c55e] text-white" : "border-slate-300 dark:border-slate-600"
                } ${!isOwner ? "cursor-default" : ""}`}
              >
                {m.is_done && "✓"}
              </button>
              <span className="w-7 text-[10px] font-bold text-slate-400">W{m.week_no}</span>
              <span className={`flex-1 text-xs ${m.is_done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-200"}`}>{m.label}</span>
              {isOwner && (
                <button onClick={() => deleteMs(m)} className="opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3 text-slate-400" /></button>
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
              onKeyDown={(e) => { if (e.key === "Enter") addMilestone(); }}
            />
            <Button size="sm" variant="outline" className={`h-7 ${INPUT_CLS}`} onClick={addMilestone}><Plus className="h-3 w-3" /></Button>
          </div>
        )}

        {/* Actions — owners only */}
        {isOwner && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-1.5">
              <Button
                size="sm" variant="outline" className={INPUT_CLS} disabled={!item.owner_id}
                onClick={onCopyLink}
              >
                <LinkIcon className="mr-1 h-3 w-3" /> Copy link
              </Button>
              <Button
                size="sm" variant="outline" className={INPUT_CLS} disabled={resending || !item.owner_id}
                onClick={async () => { setResending(true); await onResend(); setResending(false); }}
              >
                {resending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />} Resend link
              </Button>
              {!reassigning ? (
                <Button size="sm" variant="outline" className={INPUT_CLS} onClick={() => setReassigning(true)}>
                  <UserPlus className="mr-1 h-3 w-3" /> Reassign
                </Button>
              ) : (
                <select
                  autoFocus
                  className={`rounded-md border px-2 py-1 text-xs ${INPUT_CLS}`}
                  defaultValue=""
                  onChange={async (e) => { if (e.target.value) { await onReassign(e.target.value); setReassigning(false); } }}
                  onBlur={() => setReassigning(false)}
                >
                  <option value="" disabled>Pick new owner…</option>
                  {employees.filter((e) => e.id !== item.owner_id).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}{e.email ? "" : " (no email)"}</option>
                  ))}
                </select>
              )}
            </div>
            <Button size="sm" variant="ghost" className="mt-1.5 text-[#ef4444] hover:text-[#ef4444]" onClick={onDelete}>
              <Trash2 className="mr-1 h-3 w-3" /> Delete action
            </Button>
          </>
        )}

        {/* Nudge history */}
        {emailHistory.length > 0 && (() => {
          const lastFailed = emailHistory[0]?.status === "failed";
          return (
            <div className="mt-5">
              <div className={LABEL_CLS}>Email history</div>
              {lastFailed && (
                <div className="mt-1.5 flex items-center gap-2 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-xs text-[#ef4444]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Last send failed — use "Resend link" above to retry.
                </div>
              )}
              <div className="mt-1.5 space-y-1">
                {emailHistory.map((e) => {
                  const failed = e.status === "failed";
                  const typeLabel =
                    e.email_type === "assignment" ? "Assignment"
                    : e.email_type === "nudge" ? "Nudge"
                    : e.email_type === "overdue" ? "Overdue reminder"
                    : e.email_type === "done" ? "Done confirmation"
                    : e.email_type;
                  return (
                    <div key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1.5">
                        {failed
                          ? <AlertTriangle className="h-3 w-3 text-[#ef4444]" />
                          : <Mail className="h-3 w-3 text-slate-400 dark:text-slate-500" />}
                        <span className={failed ? "font-semibold text-[#ef4444]" : "text-slate-700 dark:text-slate-300"}>
                          {typeLabel}
                          {failed && " (failed)"}
                        </span>
                      </span>
                      <span className="tabular-nums text-slate-400 dark:text-slate-500">
                        {e.sent_at
                          ? new Date(e.sent_at).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                          : "—"}
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
              <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-[#d4a550]" />
              <p className="text-xs text-slate-800 dark:text-slate-200">
                <span className="font-semibold">{u.actor_label}</span>
                {u.status_from !== u.status_to && u.status_to && <> · {STATUS_LABEL[u.status_from ?? "not_started"]} → <span className="font-semibold">{STATUS_LABEL[u.status_to]}</span></>}
                {u.progress_from !== u.progress_to && <> · {u.progress_from ?? 0}% → {u.progress_to ?? 0}%</>}
              </p>
              {u.note && <p className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">"{u.note}"</p>}
              <p className="text-[10px] text-slate-400">
                {new Date(u.created_at).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
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

function HealthDonut({ counts, total, onPick }: {
  counts: Record<Health, number>; total: number; onPick: (h: Health) => void;
}) {
  const order: Health[] = ["on_track", "at_risk", "off_track", "overdue", "complete"];
  const r = 42, cx = 55, cy = 55, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <VizCard title="Action health">
      <div className="flex items-center gap-4">
        <svg width={110} height={110} className="shrink-0 -rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={12} className="stroke-amber-900/10 dark:stroke-slate-800" />
          {order.map((k) => {
            const frac = total ? counts[k] / total : 0;
            const dash = frac * C;
            const el = counts[k] > 0 && (
              <circle
                key={k} cx={cx} cy={cy} r={r} fill="none"
                stroke={HEALTH_META[k].color} strokeWidth={12}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc}
                className="cursor-pointer transition-opacity hover:opacity-75"
                onClick={() => onPick(k)}
              />
            );
            acc += dash;
            return el;
          })}
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
            transform={`rotate(90 ${cx} ${cy})`}
            className="fill-slate-950 text-xl font-black tabular-nums dark:fill-white">
            {total}
          </text>
        </svg>
        <div className="space-y-1">
          {order.filter((k) => counts[k] > 0).map((k) => (
            <button key={k} onClick={() => onPick(k)} className="flex items-center gap-2 text-xs text-slate-600 hover:underline dark:text-slate-300">
              <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_META[k].color }} />
              {HEALTH_META[k].label} · <span className="font-bold tabular-nums">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
    </VizCard>
  );
}

function BurnUp({ plan, items, confidence }: { plan: Plan; items: Item[]; confidence: number | null }) {
  // Planned: straight line from plan start → target date. Actual: mean progress today.
  const start = new Date(plan.created_at).getTime();
  const end = new Date(plan.target_date + "T23:59:59").getTime();
  const nowFrac = end > start ? Math.max(0, Math.min(1, (Date.now() - start) / (end - start))) : 1;
  const actual = items.length ? items.reduce((s, i) => s + i.progress_pct, 0) / items.length / 100 : 0;
  const W = 240, H = 96, P = 8;
  const x = (f: number) => P + f * (W - 2 * P);
  const y = (f: number) => H - P - f * (H - 2 * P);
  const gap = Math.round((actual - nowFrac) * 100);
  return (
    <VizCard title="Burn-up · planned vs actual">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={GOLD} strokeDasharray="4 3" strokeWidth={1.5} opacity={0.7} />
        <line x1={x(0)} y1={y(0)} x2={x(nowFrac)} y2={y(actual)} stroke={actual >= nowFrac ? "#22c55e" : "#ef4444"} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={x(nowFrac)} cy={y(actual)} r={4} fill={actual >= nowFrac ? "#22c55e" : "#ef4444"} />
        <line x1={x(nowFrac)} y1={y(0)} x2={x(nowFrac)} y2={y(1)} stroke="currentColor" strokeWidth={1} className="text-slate-300 dark:text-slate-600" strokeDasharray="2 3" />
      </svg>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {gap >= 0
          ? <><span className="font-bold text-[#22c55e]">{gap}pt ahead</span> of the planned line.</>
          : <><span className="font-bold text-[#ef4444]">{Math.abs(gap)}pt behind</span> the planned line — that gap is the confidence number{confidence != null ? ` (${confidence}%)` : ""}.</>}
      </p>
    </VizCard>
  );
}

function OwnerLoad({ items, employees, onPick }: {
  items: (Item & { health?: Health })[]; employees: Employee[]; onPick: (id: string | null) => void;
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
          const name = ownerId === "unassigned" ? "Unassigned" : employees.find((e) => e.id === ownerId)?.name ?? "—";
          return (
            <button key={ownerId} className="block w-full text-left" onClick={() => onPick(ownerId === "unassigned" ? null : ownerId)}>
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{name}</span>
                <span className="tabular-nums text-slate-400">{list.length}</span>
              </div>
              <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-amber-900/5 dark:bg-slate-800/60">
                {list.map((i) => (
                  <div key={i.id} style={{ width: `${(1 / max) * 100}%`, background: HEALTH_META[i.health ?? "on_track"].color }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </VizCard>
  );
}
