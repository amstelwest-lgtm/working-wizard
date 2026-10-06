/**
 * Milōn Lighthouse — agent-first sales console (agent, firms, system).
 * Usage lives on Platform — metrics. Access and pilot knobs live on Milōn IT.
 *
 * The Agent tab is the landing surface: one Next up action, the review
 * inbox, and the chat dock. Firms keeps the board as context. System holds
 * caps, the locked From / Reply-To, and the allowlist.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FileText,
  FileVideo,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldOff,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  STAGE_LABELS,
  draftLighthouseReply,
  draftLighthouseTouch,
  getLighthouse,
  importLighthouseLeads,
  optOutLighthouseLead,
  reviewLighthouseTouch,
  sendLighthouseTouch,
  upsertLighthouseAsset,
  upsertLighthouseLead,
  upsertLighthouseSettings,
  type LighthouseDashboard,
  type LighthouseLead,
  type LighthouseStage,
} from "@/lib/lighthouse.functions";
import {
  ACCOUNTANT_ONESHOT_SEQUENCE_KEY,
  ACCOUNTANT_V1_SEQUENCE_KEY,
  sequenceUsesGoldenDefault,
} from "@/lib/lighthouse-accountant-golden";
import { isGenericLeadName } from "@/lib/lighthouse-due";
import {
  AGENT_ANGLES,
  angleBucket,
  attentionMix,
  buildDueQueue,
  buildReviewInbox,
  cadenceOf,
  firmCardTitle,
  formatOpsCount,
  formatOpsPercent,
  geoWindowLine,
  isDryRunCohortName,
  nextUpAction,
  zoneClocks,
} from "@/lib/lighthouse-agent";
import { LIGHTHOUSE_FROM_EMAIL } from "@/lib/lighthouse-from";
import { LIGHTHOUSE_REPLY_TO } from "@/lib/lighthouse-reply-to";
import { LIGHTHOUSE_SENDER_NAME } from "@/lib/lighthouse-sender";
import { nextWindowLine, sendWindowStatus } from "@/lib/lighthouse-send-windows";
import { FunnelHealthPanel } from "@/components/funnel-health-panel";
import { LighthouseAgentChat } from "@/components/lighthouse-agent-chat";

const inputCls = "ops-input";

const BOARD_STAGES: LighthouseStage[] = [
  "sourced",
  "researched",
  "contacted",
  "replied",
  "meeting",
  "trial",
  "activated",
  "won",
];

const STEP_HINT: Record<number, string> = {
  1: "Day 0 · specific observation, one soft ask, no link",
  2: "Day 3 · free insight or short video, still no pitch",
  3: "Day 7 · honest proof — what actually changed for someone",
  4: "Day 12 · reframe the cost of not knowing, then the trial link",
  5: "Day 18 · breakup — shortest email, highest reply rate",
};

const ACCOUNTANT_STEP_HINT: Record<number, string> = {
  1: "Day 0 · capacity ceiling, soft ask, no link",
  2: "Day 4 · both teaser videos, no trial",
  3: "Day 9 · trial link + practice one-pager",
  4: "Day 17 · unusual question, no URL or PDF",
  5: "Day 28 · capacity close — trial, both videos, one-pager",
};

const ACCOUNTANT_ONESHOT_HINT =
  "One-shot · advisory banger — videos + both one-pagers, then a call. Both PDFs attach on send.";

export const LIGHTHOUSE_TABS = ["agent", "firms", "system"] as const;

export type LighthouseTab = (typeof LIGHTHOUSE_TABS)[number];

const LIGHTHOUSE_TAB_ALIASES: Record<string, LighthouseTab> = {
  pipeline: "firms",
  settings: "system",
  playbook: "agent",
  assets: "agent",
};

export function parseLighthouseTab(raw: unknown): LighthouseTab | undefined {
  if (typeof raw !== "string") return undefined;
  if ((LIGHTHOUSE_TABS as readonly string[]).includes(raw)) return raw as LighthouseTab;
  return LIGHTHOUSE_TAB_ALIASES[raw];
}

const TAB_LABEL: Record<LighthouseTab, string> = {
  agent: "Agent",
  firms: "Firms",
  system: "System",
};

export function LighthousePanel({
  initialTab,
  adminKey = "ops",
}: {
  initialTab?: LighthouseTab;
  /** Per-admin local thread. The signed-in user id. */
  adminKey?: string;
}) {
  const navigate = useNavigate();
  const load = useServerFn(getLighthouse);
  const saveLead = useServerFn(upsertLighthouseLead);
  const importLeads = useServerFn(importLighthouseLeads);
  const draftTouch = useServerFn(draftLighthouseTouch);
  const draftReply = useServerFn(draftLighthouseReply);
  const sendTouch = useServerFn(sendLighthouseTouch);
  const optOut = useServerFn(optOutLighthouseLead);
  const saveAsset = useServerFn(upsertLighthouseAsset);
  const saveSettings = useServerFn(upsertLighthouseSettings);
  const reviewTouch = useServerFn(reviewLighthouseTouch);

  const [dash, setDash] = useState<LighthouseDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const tab: LighthouseTab = initialTab ?? "agent";
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [reviewFocus, setReviewFocus] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [firmQuery, setFirmQuery] = useState("");
  const [firmCountry, setFirmCountry] = useState<"all" | "US" | "SA" | "OTHER">("all");
  const [firmStage, setFirmStage] = useState<string>("all");
  const [firmDue, setFirmDue] = useState<"all" | "due">("all");
  const [firmTag, setFirmTag] = useState<"all" | "warmup" | "campaign">("all");
  const [firmSuppress, setFirmSuppress] = useState<"all" | "open" | "suppressed">("all");
  const [planPreview, setPlanPreview] = useState(false);
  const [showDue, setShowDue] = useState(false);
  const [confirmSend, setConfirmSend] = useState<{
    touchId: string;
    leadId: string;
    subject: string;
    body: string;
    email: string;
    title: string;
    preview?: boolean;
    windowReason?: string | null;
  } | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPersona, setImportPersona] = useState<"owner" | "accountant">("owner");
  const [importBusy, setImportBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setDash(await load());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load Lighthouse");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const openLead = useMemo(
    () => dash?.leads.find((l) => l.id === openLeadId) ?? null,
    [dash, openLeadId],
  );

  const tabBar = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {LIGHTHOUSE_TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => {
            void navigate({
              to: "/ops",
              search: { tab: t },
            });
          }}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            tab === t
              ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
              : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
          }`}
        >
          {TAB_LABEL[t]}
        </button>
      ))}
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => setImportOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)]"
      >
        <Upload className="h-3.5 w-3.5" /> Import
      </button>
      <button
        type="button"
        onClick={() => setAddOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
      >
        <Plus className="h-3.5 w-3.5" /> Lead
      </button>
      <button
        type="button"
        onClick={() => void refresh()}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-amber)]"
        title="Refresh"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>
    </div>
  );

  if (busy && !dash) {
    return (
      <div>
        {tabBar}
        <div className="flex items-center gap-2 py-16 text-sm text-[var(--ops-ink-dim)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading Lighthouse…
        </div>
      </div>
    );
  }

  if (err && !dash) {
    return (
      <div>
        {tabBar}
        <div className="rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-5 text-sm text-[var(--ops-danger-ink)]">
          {err}
        </div>
      </div>
    );
  }
  if (!dash) return null;

  const queue = buildDueQueue(dash.leads, now);
  const inbox = buildReviewInbox(dash.leads);
  const mix = attentionMix(dash.leads, now);
  const clocks = zoneClocks(dash.leads, now);
  const dueNow = queue.filter((row) => row.open);
  const capLeft = Math.max(0, dash.settings.dailySendCap - dash.sentToday);
  const dryRun = dash.capability.sendAllowlistEnforced;
  const cadenceLead = dash.leads.find((lead) => queue.some((row) => row.leadId === lead.id)) ?? null;
  const nextUp = nextUpAction({
    inbox,
    queue,
    hasFirms: dash.leads.length > 0,
  });
  const focusLead =
    (nextUp.leadId ? dash.leads.find((lead) => lead.id === nextUp.leadId) ?? null : null) ??
    cadenceLead;
  const focusCadence = focusLead ? cadenceOf(focusLead) : null;
  const windowLine = geoWindowLine(clocks);
  const planCandidates = dash.leads.filter(
    (lead) => !lead.doNotContact && !lead.nextTouchOn && !lead.nextFollowUpAt && lead.stage !== "won" && lead.stage !== "lost",
  );
  const filteredFirms = dash.leads.filter((lead) => {
    const zone = sendWindowStatus(lead, now);
    if (firmCountry !== "all" && zone.geo !== firmCountry) return false;
    if (firmStage !== "all" && lead.stage !== firmStage) return false;
    if (firmDue === "due" && !queue.some((row) => row.leadId === lead.id)) return false;
    if (firmTag !== "all" && lead.trafficTag !== firmTag) return false;
    if (firmSuppress === "suppressed" && !lead.doNotContact) return false;
    if (firmSuppress === "open" && lead.doNotContact) return false;
    const needle = firmQuery.trim().toLowerCase();
    if (!needle) return true;
    return [lead.company, lead.name, lead.email, lead.city, lead.signal]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  const landInReview = async (touchId: string) => {
    setReviewFocus(touchId);
    setOpenLeadId(null);
    await navigate({ to: "/ops", search: { tab: "agent" } });
  };

  const runReview = async (
    touchId: string,
    action: "approve" | "reject",
    subject?: string,
    body?: string,
  ) => {
    await reviewTouch({ data: { touchId, action, subject, body } });
    await refresh();
  };

  return (
    <div>
      {dash.migrationHint && (
        <div className="mb-4 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
          {dash.migrationHint}
        </div>
      )}

      {tabBar}

      {tab === "agent" && (
        <div className="mb-5 max-xl:pb-28 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-4">
          <div className="min-w-0 space-y-4">
          <div>
            <p className="text-sm text-[var(--ops-ink-soft)]">
              {dryRun ? "Dry-run" : "Live"} · auto_send off · {formatOpsCount(capLeft)} sends left
            </p>
            {(!dash.capability.aiConfigured ||
              !dash.capability.emailConfigured ||
              dash.sentToday >= dash.settings.dailySendCap) && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {!dash.capability.aiConfigured && (
                  <span className="rounded-full border border-[var(--ops-amber-border)] px-3 py-1 text-[var(--ops-amber)]">
                    Agent offline: AI key not configured (System)
                  </span>
                )}
                {!dash.capability.emailConfigured && (
                  <span className="rounded-full border border-[var(--ops-amber-border)] px-3 py-1 text-[var(--ops-amber)]">
                    Sending is off — drafts still save
                  </span>
                )}
                {dash.sentToday >= dash.settings.dailySendCap && (
                  <span className="rounded-full border border-[var(--ops-danger-border)] px-3 py-1 text-[var(--ops-danger-ink)]">
                    Daily cap full — kill switch
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
              Next up
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if ((nextUp.kind === "review" || nextUp.kind === "approved") && nextUp.touchId) {
                    setReviewFocus(nextUp.touchId);
                    document
                      .getElementById("lighthouse-review-inbox")
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    return;
                  }
                  if (nextUp.kind === "followup" && nextUp.leadId) {
                    setOpenLeadId(nextUp.leadId);
                    return;
                  }
                  if (nextUp.kind === "import") {
                    setImportOpen(true);
                    return;
                  }
                  setPlanPreview(true);
                }}
                className="inline-flex h-10 items-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-sm font-bold text-[#1b1300]"
              >
                {nextUp.label}
              </button>
              <p className="text-sm text-[var(--ops-ink-soft)]">
                {formatOpsCount(dueNow.length)} due now
              </p>
            </div>
            <p className="mt-2 text-[12px] text-[var(--ops-ink-soft)]">{windowLine}</p>
            {focusCadence && (
              <p className="mt-1 text-[12px] text-[var(--ops-ink-dim)]">
                Last touch {focusCadence.lastTouch} · delivery {focusCadence.delivery} ·{" "}
                {focusCadence.engagement} · next {focusCadence.nextFollowUp}
              </p>
            )}
            <div className="mt-3">
              <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ops-line)]">
                <div
                  className="h-full bg-[var(--ops-amber)]"
                  style={{ width: `${mix.us + mix.sa ? mix.usPct : 80}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--ops-ink-dim)]">
                US {formatOpsPercent(mix.usPct)} · SA {formatOpsPercent(mix.saPct)} · target about 80/20
              </p>
            </div>
            {planPreview && (
              <p className="mt-2 text-[12px] text-[var(--ops-ink-dim)]">
                Dry-run only — nothing is sent. {formatOpsCount(planCandidates.length)} firms have
                no next follow-up. Import a cohort or open a firm to draft the first touch.
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowDue((open) => !open)}
              className="mt-3 text-[12px] font-semibold text-[var(--ops-amber)]"
            >
              {showDue ? "Hide list" : "See all"}
            </button>
            {showDue &&
              (queue.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--ops-ink-dim)]">
                  Nothing is due inside a send window.
                </p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-2 overflow-auto">
                  {queue.map((row) => (
                    <li key={row.leadId}>
                      <button
                        type="button"
                        onClick={() => setOpenLeadId(row.leadId)}
                        className="flex w-full items-baseline justify-between gap-3 rounded-xl border border-[var(--ops-line)] px-3 py-2 text-left hover:border-[var(--ops-amber-border)]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--ops-ink)]">
                            {row.title}
                          </span>
                          {queueLeadIsDryRun(dash.leads, row.leadId) && <DryRunBadge />}
                        </span>
                        {row.zone && row.countdownLabel !== "—" && (
                          <span className="shrink-0 text-[11px] text-[var(--ops-ink-dim)]">
                            {row.zone} · {row.open ? "due now" : row.countdownLabel}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>

          <div
            id="lighthouse-review-inbox"
            className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4"
          >
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
              Review inbox · {formatOpsCount(inbox.length)}
            </div>
            {inbox.length === 0 ? (
              <p className="text-sm text-[var(--ops-ink-dim)]">No drafts waiting for review.</p>
            ) : (
              <ul className="space-y-2">
                {inbox.map((item) => {
                  const lead = dash.leads.find((l) => l.id === item.leadId);
                  const window = lead ? sendWindowStatus(lead, now) : null;
                  return (
                    <li
                      key={item.touchId}
                      className={`rounded-xl border px-3 py-2 ${
                        reviewFocus === item.touchId
                          ? "border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)]"
                          : "border-[var(--ops-line)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ops-ink)]">
                        <span className="truncate">{item.title}</span>
                        {lead && showsDryRunBadge(lead) && <DryRunBadge />}
                      </div>
                      <div className="truncate text-[12px] text-[var(--ops-ink-dim)]">
                        {item.subject} · {item.angle} · {item.status}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => {
                              const touch = lead?.touches.find((t) => t.id === item.touchId);
                              void runReview(
                                item.touchId,
                                "approve",
                                touch?.subject ?? "",
                                touch?.body ?? "",
                              )
                                .then(() => toast.success("Approved — send only inside the window"))
                                .catch((e) =>
                                  toast.error(e instanceof Error ? e.message : "Could not approve"),
                                );
                            }}
                            className="rounded-full bg-[var(--ops-amber-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ops-amber)]"
                          >
                            Approve
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setOpenLeadId(item.leadId)}
                          className="rounded-full border border-[var(--ops-line)] px-3 py-1 text-[11px] font-semibold text-[var(--ops-ink-soft)]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runReview(item.touchId, "reject")
                              .then(() => toast.success("Rejected"))
                              .catch((e) =>
                                toast.error(e instanceof Error ? e.message : "Could not reject"),
                              )
                          }
                          className="rounded-full border border-[var(--ops-line)] px-3 py-1 text-[11px] font-semibold text-[var(--ops-ink-dim)]"
                        >
                          Reject
                        </button>
                        {item.status === "approved" && (
                          <button
                            type="button"
                            disabled={!window?.open}
                            onClick={() => {
                              const touch = lead?.touches.find((t) => t.id === item.touchId);
                              if (!lead?.email || !touch) return;
                              setConfirmSend({
                                touchId: item.touchId,
                                leadId: item.leadId,
                                subject: touch.subject ?? "",
                                body: touch.body ?? "",
                                email: lead.email,
                                title: item.title,
                              });
                            }}
                            className="rounded-full bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-3 py-1 text-[11px] font-bold text-[#1b1300] disabled:opacity-40"
                          >
                            Send now
                          </button>
                        )}
                        {item.status === "approved" && window && !window.open && (
                          <button
                            type="button"
                            onClick={() => {
                              const touch = lead?.touches.find((t) => t.id === item.touchId);
                              if (!lead?.email || !touch) return;
                              setConfirmSend({
                                touchId: item.touchId,
                                leadId: item.leadId,
                                subject: touch.subject ?? "",
                                body: touch.body ?? "",
                                email: lead.email,
                                title: item.title,
                                preview: true,
                                windowReason: window.reason,
                              });
                            }}
                            className="rounded-full border border-[var(--ops-line)] px-3 py-1 text-[11px] font-semibold text-[var(--ops-ink-soft)]"
                          >
                            Preview send
                          </button>
                        )}
                      </div>
                      {item.status === "approved" && window && nextWindowLine(window) && (
                        <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">
                          {nextWindowLine(window)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </div>
          <LighthouseAgentChat
            adminKey={adminKey}
            onOpenLead={(leadId) => setOpenLeadId(leadId)}
            onOpenReview={(touchId, leadId) => {
              setReviewFocus(touchId);
              setOpenLeadId(leadId);
            }}
            onDrafted={refresh}
          />
        </div>
      )}

      {importOpen && (
        <div className="mb-4 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <p className="mb-2 text-xs text-[var(--ops-ink-dim)]">
            One lead per line:{" "}
            <code className="text-[var(--ops-amber)]/80">name, email, company, signal</code>. The signal is
            the specific true reason you are reaching out — it drives the whole sequence.
          </p>
          <textarea
            className={`${inputCls} min-h-[110px] resize-y py-2`}
            placeholder={
              "Sipho Dlamini, sipho@acme.co.za, Acme Plumbing, hiring 3 vans on Indeed\nAnna Botha, anna@bothaco.co.za, Botha & Co, posts monthly about SARS deadlines"
            }
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className={`${inputCls} max-w-[200px]`}
              value={importPersona}
              onChange={(e) => setImportPersona(e.target.value as "owner" | "accountant")}
            >
              <option value="owner">Business owners</option>
              <option value="accountant">Accountants / practices</option>
            </select>
            <button
              disabled={importBusy}
              onClick={async () => {
                setImportBusy(true);
                try {
                  const r = await importLeads({
                    data: { text: importText, persona: importPersona },
                  });
                  toast.success(`Imported ${r.imported} leads`);
                  setImportText("");
                  setImportOpen(false);
                  await refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Import failed");
                } finally {
                  setImportBusy(false);
                }
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-[var(--ops-amber-soft)] disabled:opacity-60"
            >
              {importBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Import
            </button>
          </div>
        </div>
      )}

      {addOpen && (
        <AddLeadForm
          onCancel={() => setAddOpen(false)}
          onSave={async (payload) => {
            await saveLead({ data: payload });
            toast.success("Lead added");
            setAddOpen(false);
            await refresh();
          }}
        />
      )}

      {tab === "firms" && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              className={`${inputCls} max-w-xs`}
              placeholder="Search firm, contact, email"
              value={firmQuery}
              onChange={(e) => setFirmQuery(e.target.value)}
            />
            <select className={`${inputCls} max-w-[140px]`} value={firmCountry} onChange={(e) => setFirmCountry(e.target.value as typeof firmCountry)}>
              <option value="all">Country</option>
              <option value="US">US</option>
              <option value="SA">SA</option>
              <option value="OTHER">Other</option>
            </select>
            <select className={`${inputCls} max-w-[160px]`} value={firmStage} onChange={(e) => setFirmStage(e.target.value)}>
              <option value="all">Stage</option>
              {BOARD_STAGES.map((stage) => (
                <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
              ))}
            </select>
            <select className={`${inputCls} max-w-[120px]`} value={firmDue} onChange={(e) => setFirmDue(e.target.value as typeof firmDue)}>
              <option value="all">Any due</option>
              <option value="due">Due</option>
            </select>
            <select className={`${inputCls} max-w-[140px]`} value={firmTag} onChange={(e) => setFirmTag(e.target.value as typeof firmTag)}>
              <option value="all">Traffic</option>
              <option value="warmup">warmup</option>
              <option value="campaign">campaign</option>
            </select>
            <select className={`${inputCls} max-w-[150px]`} value={firmSuppress} onChange={(e) => setFirmSuppress(e.target.value as typeof firmSuppress)}>
              <option value="all">Suppress</option>
              <option value="open">Not suppressed</option>
              <option value="suppressed">Suppressed</option>
            </select>
          </div>
          <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--ops-line)]">
            {filteredFirms.length === 0 ? (
              <p className="p-6 text-sm text-[var(--ops-ink-dim)]">No firms match these filters.</p>
            ) : (
              filteredFirms.slice(0, 80).map((lead) => {
                const cadenceRow = cadenceOf(lead);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setOpenLeadId(lead.id)}
                    className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--ops-line)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--ops-amber-soft)]"
                  >
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--ops-ink)]">
                          {firmCardTitle(lead)}
                        </span>
                        {showsDryRunBadge(lead) && <DryRunBadge />}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--ops-ink-dim)]">
                        {STAGE_LABELS[lead.stage]} · next {cadenceRow.nextFollowUp} · {lead.trafficTag ?? "untagged"}
                        {lead.doNotContact ? " · suppressed" : ""}
                      </span>
                    </span>
                    {sendWindowStatus(lead, now).zone ? (
                      <span className="shrink-0 text-[11px] text-[var(--ops-ink-dim)]">
                        {sendWindowStatus(lead, now).zone}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <details className="mb-4">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]">
              Stage board
            </summary>
            <div className="mt-3">
              <PipelineBoard leads={filteredFirms} onOpen={(id) => setOpenLeadId(id)} />
            </div>
          </details>
        </>
      )}

      {tab === "system" && (
        <>
          <FunnelHealthPanel />
          <SystemForm
            dash={dash}
            onSave={async (payload) => {
              await saveSettings({ data: payload });
              toast.success("Saved");
              await refresh();
            }}
          />
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]">
              Assets
            </summary>
            <div className="mt-3">
              <AssetGrid
                dash={dash}
                onSave={async (key, url, status) => {
                  await saveAsset({ data: { key, url, status } });
                  toast.success("Asset updated");
                  await refresh();
                }}
              />
            </div>
          </details>
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]">
              Funnel counts
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <FunnelStat label="In list" value={dash.funnel.sourced} />
              <FunnelStat label="Contacted" value={dash.funnel.contacted} />
              <FunnelStat label="Replied" value={dash.funnel.replied} sub={formatOpsPercent(dash.funnel.replyRatePct ?? 0)} />
              <FunnelStat label="Conversing" value={dash.funnel.meeting} />
              <FunnelStat label="Trials" value={dash.funnel.trial} sub={formatOpsPercent(dash.funnel.trialRatePct ?? 0)} gold />
              <FunnelStat label="Paying" value={dash.funnel.won} gold />
            </div>
          </details>
        </>
      )}

      {openLead && (
        <LeadDrawer
          lead={openLead}
          dash={dash}
          onClose={() => setOpenLeadId(null)}
          onDraft={async (stepNo, opts) => {
            const drafted = await draftTouch({
              data: {
                leadId: openLead.id,
                stepNo,
                mode: opts?.mode ?? "default",
                currentSubject: opts?.currentSubject,
                currentBody: opts?.currentBody,
              },
            });
            await refresh();
            await landInReview(drafted.touchId);
            return drafted;
          }}
          onDraftReply={async (theirMessage, intent) => {
            const drafted = await draftReply({ data: { leadId: openLead.id, theirMessage, intent } });
            await refresh();
            await landInReview(drafted.touchId);
            return drafted;
          }}
          onRequestSend={(touchId, subject, body, opts) => {
            if (!openLead.email) return;
            setConfirmSend({
              touchId,
              leadId: openLead.id,
              subject,
              body,
              email: openLead.email,
              title: firmCardTitle(openLead),
              ...(opts?.preview
                ? { preview: true, windowReason: opts.windowReason ?? null }
                : {}),
            });
          }}
          onReview={runReview}
          onStage={async (stage) => {
            await saveLead({ data: { id: openLead.id, stage } });
            await refresh();
          }}
          onSequence={async (sequenceKey) => {
            await saveLead({ data: { id: openLead.id, sequenceKey } });
            await refresh();
          }}
          onOptOut={async () => {
            await optOut({ data: { leadId: openLead.id } });
            await refresh();
          }}
          onRefresh={refresh}
        />
      )}

      {confirmSend && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-bg-elevated)] p-5">
            <h3 className="text-sm font-bold text-[var(--ops-ink)]">Send this email?</h3>
            <dl className="mt-3 space-y-1.5 text-[12.5px] text-[var(--ops-ink-soft)]">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">Recipient</dt>
                <dd>
                  {confirmSend.title} · {confirmSend.email}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">Subject</dt>
                <dd>{confirmSend.subject}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">From</dt>
                <dd>
                  {LIGHTHOUSE_SENDER_NAME} &lt;{LIGHTHOUSE_FROM_EMAIL}&gt;
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">Reply-To</dt>
                <dd>{LIGHTHOUSE_REPLY_TO}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">Cohort</dt>
                <dd>{dryRun ? "Dry-run — allowlist only" : "Live — outside the allowlist"}</dd>
              </div>
            </dl>
            {confirmSend.preview && (
              <p className="mt-3 rounded-lg border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-3 py-2 text-[12.5px] font-semibold text-[var(--ops-amber)]">
                Preview only — send window closed: {confirmSend.windowReason}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={Boolean(confirmSend.preview)}
                onClick={() => {
                  if (confirmSend.preview) return;
                  const pending = confirmSend;
                  setConfirmSend(null);
                  void sendTouch({
                    data: { touchId: pending.touchId, subject: pending.subject, body: pending.body },
                  })
                    .then(async (result) => {
                      toast.success(
                        result?.skipped ? "Already touched at this step — nothing sent" : "Sent",
                      );
                      await refresh();
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Send failed"));
                }}
                className="inline-flex h-10 items-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm send
              </button>
              <button
                type="button"
                onClick={() => setConfirmSend(null)}
                className="inline-flex h-10 items-center rounded-xl border border-[var(--ops-line-strong)] px-4 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function showsDryRunBadge(lead: { name?: string | null; company?: string | null }): boolean {
  return isDryRunCohortName(lead.company) || isDryRunCohortName(lead.name);
}

function queueLeadIsDryRun(
  leads: Array<{ id: string; name?: string | null; company?: string | null }>,
  leadId: string,
): boolean {
  const lead = leads.find((row) => row.id === leadId);
  return lead ? showsDryRunBadge(lead) : false;
}

function DryRunBadge() {
  return (
    <span className="shrink-0 rounded-full border border-[var(--ops-line)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]">
      Dry run
    </span>
  );
}

function FunnelStat({
  label,
  value,
  sub,
  gold,
}: {
  label: string;
  value: number;
  sub?: string;
  gold?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-bold tabular-nums ${gold ? "text-[var(--ops-amber)]" : "text-[var(--ops-ink)]"}`}
      >
        {formatOpsCount(value)}
        {sub ? (
          <div className="text-[11px] font-semibold text-[var(--ops-ink-dim)]">{sub}</div>
        ) : null}
      </div>
    </div>
  );
}

function PipelineBoard({
  leads,
  onOpen,
}: {
  leads: LighthouseLead[];
  onOpen: (id: string) => void;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--ops-line-strong)] p-10 text-center text-sm text-[var(--ops-ink-dim)]">
        No firms yet. Import a cohort from the Agent tab.
      </div>
    );
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {BOARD_STAGES.map((stage) => {
        const inStage = leads.filter((l) => l.stage === stage);
        return (
          <div key={stage} className="w-[240px] shrink-0">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
                {STAGE_LABELS[stage]}
              </span>
              <span className="text-[11px] tabular-nums text-[var(--ops-ink-faint)]">{inStage.length}</span>
            </div>
            <div className="space-y-2">
              {inStage.map((l) => (
                <button
                  key={l.id}
                  onClick={() => onOpen(l.id)}
                  className="w-full rounded-xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-2.5 text-left transition-colors hover:border-[var(--ops-amber-border)]"
                >
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-semibold text-[var(--ops-ink)]">
                      {firmCardTitle(l)}
                    </div>
                    {showsDryRunBadge(l) && <DryRunBadge />}
                  </div>
                  <div className="truncate text-[11px] text-[var(--ops-ink-dim)]">
                    {isGenericLeadName(l.name, l.email) && l.email ? `${l.email} · ` : ""}
                    {l.persona === "accountant" ? "practice" : "owner"}
                    {l.sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY ? " · one-shot" : ""}
                  </div>
                  {l.signal && (
                    <div className="mt-1 line-clamp-2 text-[11px] text-[var(--ops-ink-dim)]">{l.signal}</div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--ops-ink-faint)]">
                    <span>
                      {l.sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY
                        ? "one-shot"
                        : `step ${l.sequenceStep}/5`}
                    </span>
                    {l.lastInboundAt ? (
                      <span className="text-[var(--ops-ok-ink)]">· inbox</span>
                    ) : l.lastClickedAt ? (
                      <span className="text-[var(--ops-amber)]">· clicked</span>
                    ) : l.touches.some((t) => t.deliveredAt) ? (
                      <span>· delivered</span>
                    ) : l.touches.some((t) => t.sentAt) ? (
                      <span>· sent</span>
                    ) : null}
                    {l.nextTouchOn && <span>· next {l.nextTouchOn}</span>}
                  </div>
                </button>
              ))}
              {inStage.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--ops-line)] px-3 py-4 text-center text-[11px] text-[var(--ops-ink-faint)]">
                  empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddLeadForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (payload: {
    name?: string;
    email?: string;
    company?: string;
    roleTitle?: string;
    city?: string;
    persona: "owner" | "accountant";
    sequenceKey?: "owner_v1" | "accountant_v1" | "accountant_oneshot_v1";
    signal?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [city, setCity] = useState("");
  const [persona, setPersona] = useState<"owner" | "accountant">("owner");
  const [sequenceKey, setSequenceKey] = useState<"accountant_v1" | "accountant_oneshot_v1">(
    "accountant_v1",
  );
  const [signal, setSignal] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mb-4 grid gap-2 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave({
            name,
            email,
            company,
            roleTitle,
            city,
            persona,
            sequenceKey: persona === "accountant" ? sequenceKey : "owner_v1",
            signal,
          });
        } catch (ex) {
          toast.error(ex instanceof Error ? ex.message : "Could not save");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        className={inputCls}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={inputCls}
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className={inputCls}
        placeholder="Company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
      />
      <input
        className={inputCls}
        placeholder="Role"
        value={roleTitle}
        onChange={(e) => setRoleTitle(e.target.value)}
      />
      <input
        className={inputCls}
        placeholder="City"
        value={city}
        onChange={(e) => setCity(e.target.value)}
      />
      <select
        className={inputCls}
        value={persona}
        onChange={(e) => {
          const next = e.target.value as "owner" | "accountant";
          setPersona(next);
          if (next === "owner") setSequenceKey("accountant_v1");
        }}
      >
        <option value="owner">Business owner</option>
        <option value="accountant">Accountant / practice</option>
      </select>
      {persona === "accountant" && (
        <select
          className={inputCls}
          value={sequenceKey}
          onChange={(e) =>
            setSequenceKey(e.target.value as "accountant_v1" | "accountant_oneshot_v1")
          }
        >
          <option value={ACCOUNTANT_V1_SEQUENCE_KEY}>5-step drip</option>
          <option value={ACCOUNTANT_ONESHOT_SEQUENCE_KEY}>One-shot banger</option>
        </select>
      )}
      <input
        className={`${inputCls} sm:col-span-3`}
        placeholder="Signal — the specific true reason you are reaching out (drives every email)"
        value={signal}
        onChange={(e) => setSignal(e.target.value)}
      />
      <div className="flex gap-2 sm:col-span-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save lead
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 items-center rounded-xl border border-[var(--ops-line-strong)] px-4 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AssetGrid({
  dash,
  onSave,
}: {
  dash: LighthouseDashboard;
  onSave: (
    key: string,
    url: string,
    status: "placeholder" | "in_progress" | "ready",
  ) => Promise<void>;
}) {
  const awaitingReview = dash.assets.filter(
    (a) => a.status === "in_progress" && (a.url ?? "").trim(),
  );

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--ops-ink-dim)]">
        Collateral slots referenced by the sequences. Anything still marked placeholder is simply
        left out of the email copy — the drafter is told not to link to something that does not
        exist.
      </p>
      {awaitingReview.length > 0 && (
        <div className="mb-4 rounded-2xl border border-[var(--ops-sky-border)] bg-[var(--ops-sky-bg)] px-4 py-3 text-sm text-[var(--ops-sky-ink)]">
          <p className="font-semibold">
            {awaitingReview.length} {awaitingReview.length === 1 ? "page is" : "pages are"} live and
            waiting on you.
          </p>
          <p className="mt-1 text-[13px] text-[var(--ops-sky-ink)]">
            Read each one, then flip it to ready. Until you do, no email links to it — the copy just
            makes the point in a sentence instead.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {awaitingReview.map((a) => (
              <a
                key={a.key}
                href={a.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--ops-sky-border)] px-3 py-1 text-[11px] font-semibold text-[var(--ops-sky-ink)] hover:bg-[var(--ops-sky-bg)]"
              >
                Read {a.title} →
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {dash.assets.map((a) => (
          <AssetCard key={a.key} asset={a} onSave={onSave} />
        ))}
        {dash.assets.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--ops-line-strong)] p-8 text-center text-sm text-[var(--ops-ink-dim)] md:col-span-2">
            Assets appear once the Lighthouse migration has been run.
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  onSave,
}: {
  asset: LighthouseDashboard["assets"][number];
  onSave: (
    key: string,
    url: string,
    status: "placeholder" | "in_progress" | "ready",
  ) => Promise<void>;
}) {
  const [url, setUrl] = useState(asset.url ?? "");
  const [status, setStatus] = useState(asset.status);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <FileVideo className="h-3.5 w-3.5 text-[var(--ops-amber)]" />
            <span className="text-sm font-semibold text-[var(--ops-ink)]">{asset.title}</span>
          </div>
          <p className="mt-1 text-[12px] text-[var(--ops-ink-dim)]">{asset.purpose}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            status === "ready"
              ? "bg-[var(--ops-ok-bg)] text-[var(--ops-ok-ink)]"
              : status === "in_progress"
                ? "bg-[var(--ops-sky-bg)] text-[var(--ops-sky-ink)]"
                : "bg-[var(--ops-card)] text-[var(--ops-ink-dim)]"
          }`}
        >
          {status.replaceAll("_", " ")}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className={`${inputCls} flex-1`}
          placeholder="URL once built (YouTube, Loom, PDF…)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select
          className={`${inputCls} max-w-[150px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="placeholder">placeholder</option>
          <option value="in_progress">in progress</option>
          <option value="ready">ready</option>
        </select>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(asset.key, url, status);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Save failed");
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex h-10 items-center rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-[var(--ops-amber-soft)] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--ops-ink-faint)]">
        {asset.usedIn ??
          (asset.usedInStep
            ? `Used in touch ${asset.usedInStep}`
            : "Not referenced by any sequence yet")}
      </p>
      {asset.key === "booking_link" && (
        <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">
          Optional. Leave this as a placeholder — the pipeline runs on email. Only fill it if you
          later want the reply drafter to offer a live call.
        </p>
      )}
      {asset.status !== "ready" && (asset.url ?? "").trim() && (
        <p className="mt-1 text-[11px] text-[var(--ops-sky-ink)]/80">
          URL is set but the slot is not ready — nothing links here yet.
        </p>
      )}
    </div>
  );
}

function SystemForm({
  dash,
  onSave,
}: {
  dash: LighthouseDashboard;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const s = dash.settings;
  const [trialDays, setTrialDays] = useState(String(s.trialDays));
  const [dailySendCap, setDailySendCap] = useState(String(s.dailySendCap));
  const [bookingUrl, setBookingUrl] = useState(s.bookingUrl);
  const [senderAddress, setSenderAddress] = useState(s.senderAddress);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
          Sender & offer
        </h3>
        <div className="mb-3 space-y-1 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-bg)] px-3 py-2 text-[12.5px] text-[var(--ops-ink-soft)]">
          <p>
            From {LIGHTHOUSE_SENDER_NAME} &lt;{LIGHTHOUSE_FROM_EMAIL}&gt;
          </p>
          <p>Reply-to — hello@milonfinance.com</p>
          <p>Send windows enforced · US Tue–Thu 08:00–10:00 local · SA Tue–Thu 08:00–10:00 SAST</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className={inputCls}
            placeholder="Trial days"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="Daily send cap"
            value={dailySendCap}
            onChange={(e) => setDailySendCap(e.target.value)}
          />
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Optional calendar link — leave blank to stay on email"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
          />
          <p className="text-[11px] text-[var(--ops-ink-dim)] sm:col-span-2">
            {bookingUrl.trim()
              ? "A calendar link is set, so the reply drafter can offer a call if you pick that intent."
              : "Leave this blank. Outreach stays on email unless you later want a booking link."}
          </p>
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Postal address for the email footer — street, city, country"
            value={senderAddress}
            onChange={(e) => setSenderAddress(e.target.value)}
          />
        </div>
        {!senderAddress.trim() && (
          <p className="mt-2 text-[11px] text-[var(--ops-amber)]/80">
            Without an address the footer still identifies you and carries the unsubscribe link, but
            a postal line is what most spam filters expect on cold mail.
          </p>
        )}
        {dash.capability.sendAllowlistEnforced && (
          <p className="mt-2 text-[11px] text-[var(--ops-amber)]">
            Allowlist: {dash.capability.sendAllowlist.join(", ") || "dry-run"}
          </p>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                trialDays: Number(trialDays) || 14,
                dailySendCap: Number(dailySendCap) || 25,
                bookingUrl,
                senderAddress,
                autoSend: false,
              });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Save failed");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 inline-flex h-10 items-center rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-[var(--ops-amber-soft)] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save settings"}
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4 text-sm text-[var(--ops-ink-dim)]">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
          Deliverability guardrails
        </h3>
        <ul className="space-y-1.5">
          <li>
            Keep sends under the daily cap per inbox — volume is what burns domains, not copy.
          </li>
          <li>Verify SPF, DKIM and DMARC on the sending domain before the first campaign.</li>
          <li>Plain text only. No tracking pixels, no image-heavy templates, one link at most.</li>
          <li>Bounce rate above two percent means the list needs cleaning, not more sending.</li>
          <li>Reply-to must be a mailbox you actually watch — replies are the whole point.</li>
          <li>
            Do not add a calendar link unless you want live calls. Email-only is the intended
            motion while you have a day job.
          </li>
          <li>
            Every send carries a sender line and a one-click unsubscribe header. Opting out stops
            the sequence and suppresses the address platform-wide.
          </li>
          <li>
            Wire Resend webhooks to <code className="text-[var(--ops-amber)]/80">/api/resend/webhook</code>{" "}
            for bounces and complaints — without that, a hard bounce never stops the sequence.
          </li>
        </ul>
        <p className="mt-3 text-[11px] text-[var(--ops-ink-faint)]">
          Site used for trial links: {dash.capability.siteUrl}
        </p>
      </div>
    </div>
  );
}

function LeadDrawer({
  lead,
  dash,
  onClose,
  onDraft,
  onDraftReply,
  onRequestSend,
  onReview,
  onStage,
  onSequence,
  onOptOut,
  onRefresh,
}: {
  lead: LighthouseLead;
  dash: LighthouseDashboard;
  onClose: () => void;
  onDraft: (
    stepNo: number,
    opts?: {
      mode?: "default" | "rewrite";
      currentSubject?: string;
      currentBody?: string;
    },
  ) => Promise<{ subject: string; body: string; touchId: string }>;
  onDraftReply: (
    theirMessage: string,
    intent: "answer" | "email" | "book" | "trial",
  ) => Promise<{ subject: string; body: string; touchId: string; stepNo: number }>;
  onRequestSend: (
    touchId: string,
    subject: string,
    body: string,
    opts?: { preview?: boolean; windowReason?: string | null },
  ) => void;
  onReview: (
    touchId: string,
    action: "approve" | "reject",
    subject?: string,
    body?: string,
  ) => Promise<void>;
  onStage: (stage: LighthouseStage) => Promise<void>;
  onSequence: (sequenceKey: "accountant_v1" | "accountant_oneshot_v1") => Promise<void>;
  onOptOut: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const seq = dash.sequences.find((s) => s.key === lead.sequenceKey);
  const isOneshot = lead.sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY;
  const stepCount = isOneshot ? 1 : seq?.steps.length || 5;
  const usesGolden = sequenceUsesGoldenDefault(lead.sequenceKey);
  const [activeStep, setActiveStep] = useState(Math.min(lead.sequenceStep + 1, stepCount));
  const existing = lead.touches.find((t) => t.stepNo === activeStep) ?? null;

  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [touchId, setTouchId] = useState(existing?.id ?? "");
  const [drafting, setDrafting] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [theirMessage, setTheirMessage] = useState("");
  const [replyIntent, setReplyIntent] = useState<"answer" | "email" | "book" | "trial">("answer");
  const [replying, setReplying] = useState(false);
  const [approving, setApproving] = useState(false);
  const windowStatus = sendWindowStatus(lead);
  const cadence = cadenceOf(lead);
  const textMatchesSaved =
    subject === (existing?.subject ?? "") && body === (existing?.body ?? "");
  const approved = existing?.status === "approved" && textMatchesSaved && Boolean(touchId);

  useEffect(() => {
    const t = lead.touches.find((x) => x.stepNo === activeStep) ?? null;
    setSubject(t?.subject ?? "");
    setBody(t?.body ?? "");
    setTouchId(t?.id ?? "");
  }, [activeStep, lead]);

  useEffect(() => {
    const latest = lead.inbound[0];
    if (!latest?.body) return;
    setTheirMessage((prev) => prev || latest.body || "");
    setReplyOpen(true);
  }, [lead.id, lead.inbound]);

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-[var(--ops-line)] bg-[var(--ops-bg-elevated)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--ops-ink)]">
              <span className="truncate">{firmCardTitle(lead)}</span>
              {showsDryRunBadge(lead) && <DryRunBadge />}
            </h2>
            <p className="text-sm text-[var(--ops-ink-dim)]">
              {lead.email || "No email"}
              {lead.name &&
              !isGenericLeadName(lead.name, lead.email) &&
              firmCardTitle(lead) !== lead.name.trim()
                ? ` · ${lead.name}`
                : ""}
              {" · "}
              {lead.persona === "accountant" ? "practice" : "owner"}
              {isOneshot ? " · one-shot" : ""}
              {lead.city ? ` · ${lead.city}` : ""}
              {windowStatus.zone ? ` · ${windowStatus.zone}` : ""}
            </p>
            <p className="mt-1 text-[12px] text-[var(--ops-ink-dim)]">
              Stack: {lead.stack || "unknown"} · last touch {cadence.lastTouch} · delivery{" "}
              {cadence.delivery} · engagement {cadence.engagement} · next {cadence.nextFollowUp}
            </p>
            {lead.signal && (
              <p className="mt-1.5 rounded-lg border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-2 text-[12.5px] text-[var(--ops-ink-soft)]">
                Signal: {lead.signal}
              </p>
            )}
            {lead.persona === "accountant" && (
              <select
                className={`${inputCls} mt-2 max-w-[280px]`}
                value={
                  lead.sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY
                    ? ACCOUNTANT_ONESHOT_SEQUENCE_KEY
                    : ACCOUNTANT_V1_SEQUENCE_KEY
                }
                onChange={async (e) => {
                  const next = e.target.value as "accountant_v1" | "accountant_oneshot_v1";
                  await onSequence(next);
                  setActiveStep(1);
                  toast.success(
                    next === ACCOUNTANT_ONESHOT_SEQUENCE_KEY
                      ? "Switched to one-shot banger"
                      : "Switched to 5-step drip",
                  );
                }}
              >
                <option value={ACCOUNTANT_V1_SEQUENCE_KEY}>5-step drip</option>
                <option value={ACCOUNTANT_ONESHOT_SEQUENCE_KEY}>One-shot banger</option>
              </select>
            )}
            {isOneshot && (
              <p className="mt-1 text-[12px] text-[var(--ops-ink-dim)]">
                Accountant one-shot / single banger. The suggested next touch loads that golden copy.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {lead.doNotContact && (
          <div className="mb-4 rounded-xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] px-3 py-2.5 text-[12.5px] text-[var(--ops-danger-ink)]">
            <span className="font-semibold">Unsubscribed</span>
            {lead.optedOutAt ? ` on ${lead.optedOutAt.slice(0, 10)}` : ""} — drafting and sending
            are both disabled for this lead, and any unsent drafts were skipped.
          </div>
        )}

        {/* Stage control */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {BOARD_STAGES.concat(["lost", "nurture"] as LighthouseStage[]).map((s) => (
            <button
              key={s}
              onClick={async () => {
                await onStage(s);
                toast.success(`Moved to ${STAGE_LABELS[s]}`);
              }}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                lead.stage === s
                  ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                  : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
              }`}
            >
              {STAGE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Trial link */}
        {lead.trialLink && (
          <div className="mb-4 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-3 py-2.5">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-amber)]">
              Tracked trial link — the end of the funnel
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-[11px] text-[var(--ops-ink-soft)]">{lead.trialLink}</code>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(lead.trialLink ?? "");
                  toast.success("Trial link copied");
                }}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ops-line-strong)] px-2.5 text-[11px] text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)]"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">
              {lead.trialClickedAt
                ? `Clicked ${lead.trialClickedAt.slice(0, 10)}`
                : "Not clicked yet"}
              {lead.trialSignedUpAt ? ` · signed up ${lead.trialSignedUpAt.slice(0, 10)}` : ""}
            </p>
          </div>
        )}

        {lead.inbound.length > 0 && (
          <div className="mb-4 rounded-xl border border-[var(--ops-sky-border)] bg-[var(--ops-sky-bg)] px-3 py-2.5">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-sky-ink)]">
              Inbox · {lead.inbound.length} {lead.inbound.length === 1 ? "reply" : "replies"}
            </div>
            <p className="text-[12.5px] font-semibold text-[var(--ops-ink)]">
              {lead.inbound[0].subject || "(no subject)"}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-[var(--ops-ink-soft)]">
              {(lead.inbound[0].body ?? "").slice(0, 700) || "(body not fetched yet)"}
            </p>
            <p className="mt-1.5 text-[11px] text-[var(--ops-ink-dim)]">
              From {lead.inbound[0].fromEmail}
              {lead.inbound[0].receivedAt ? ` · ${lead.inbound[0].receivedAt.slice(0, 16).replace("T", " ")}` : ""}
            </p>
          </div>
        )}

        {/* Reply helper — FAQ + email thread; a call is only offered if a booking URL is set */}
        <div className="mb-4">
          <button
            onClick={() => setReplyOpen((o) => !o)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)]"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {replyOpen ? "Close reply helper" : lead.inbound.length > 0 ? "Draft an answer" : "They replied — draft an answer"}
          </button>
          {replyOpen && (
            <div className="mt-2 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-3">
              <textarea
                className={`${inputCls} min-h-[100px] resize-y py-2`}
                placeholder="Their reply is pasted here when it lands in inbound. Otherwise paste what they wrote. The draft answers their actual question over email."
                value={theirMessage}
                onChange={(e) => setTheirMessage(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className={`${inputCls} max-w-[240px]`}
                  value={replyIntent}
                  onChange={(e) => setReplyIntent(e.target.value as typeof replyIntent)}
                >
                  <option value="answer">Just answer them</option>
                  <option value="email">Keep it on email</option>
                  <option value="trial">Point at the free trial</option>
                  {dash.settings.bookingUrl.trim() ? (
                    <option value="book">Propose a call</option>
                  ) : null}
                </select>
                <button
                  disabled={
                    replying ||
                    !theirMessage.trim() ||
                    !dash.capability.aiConfigured ||
                    lead.doNotContact
                  }
                  onClick={async () => {
                    setReplying(true);
                    try {
                      const r = await onDraftReply(theirMessage, replyIntent);
                      setSubject(r.subject);
                      setBody(r.body);
                      setTouchId(r.touchId);
                      setActiveStep(r.stepNo);
                      toast.success("Reply drafted — it is in the review inbox");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Draft failed");
                    } finally {
                      setReplying(false);
                    }
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-[var(--ops-amber-soft)] disabled:opacity-50"
                >
                  {replying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Draft reply
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
          Suggested next touch · {angleBucket(
            (lead.persona === "accountant" ? ACCOUNTANT_STEP_HINT : STEP_HINT)[
              Math.min(lead.sequenceStep + 1, stepCount)
            ] ? seq?.steps.find((s) => s.step === Math.min(lead.sequenceStep + 1, stepCount))?.angle : null,
          )}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {AGENT_ANGLES.map((angle) => {
            const step = seq?.steps.find((s) => angleBucket(s.angle) === angle);
            const selected = angleBucket(
              seq?.steps.find((s) => s.step === activeStep)?.angle ?? existing?.angle,
            ) === angle;
            return (
              <button
                key={angle}
                type="button"
                onClick={() => {
                  if (step) setActiveStep(step.step);
                }}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${
                  selected
                    ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                    : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)]"
                }`}
              >
                {angle}
              </button>
            );
          })}
        </div>
        {/* Step numbers stay in the database. They are secondary to the angle. */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Array.from(
            new Set([
              ...Array.from({ length: stepCount }, (_, i) => i + 1),
              ...lead.touches.map((t) => t.stepNo),
            ]),
          )
            .sort((a, b) => a - b)
            .map((n) => {
              const t = lead.touches.find((x) => x.stepNo === n);
              return (
                <button
                  key={n}
                  onClick={() => setActiveStep(n)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    activeStep === n
                      ? "bg-[var(--ops-amber-soft)] text-[var(--ops-ink)]"
                      : "text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
                  }`}
                >
                  {n > stepCount ? "reply" : n}
                  {(t?.clickedAt || t?.deliveredAt || t?.status === "sent") && (
                    <Check className="ml-1 inline h-3 w-3 text-[var(--ops-ok-ink)]" />
                  )}
                </button>
              );
            })}
        </div>
        <p className="mb-3 text-[11px] text-[var(--ops-ink-dim)]">
          {isOneshot
            ? ACCOUNTANT_ONESHOT_HINT
            : ((lead.persona === "accountant" ? ACCOUNTANT_STEP_HINT : STEP_HINT)[activeStep] ??
              "Reply — answer what they asked, one ask at most")}
        </p>

        <div className="space-y-2">
          <input
            className={inputCls}
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            className={`${inputCls} min-h-[260px] resize-y py-2 font-mono text-[12.5px] leading-relaxed`}
            placeholder={
              usesGolden
                ? "Load the golden copy for this step."
                : "Agent draft, then edit before sending. Nothing sends without your approval."
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {usesGolden ? (
            <>
              <button
                disabled={drafting || rewriting || lead.doNotContact}
                onClick={async () => {
                  setDrafting(true);
                  try {
                    const r = await onDraft(activeStep, { mode: "default" });
                    setSubject(r.subject);
                    setBody(r.body);
                    setTouchId(r.touchId);
                    toast.success("Golden copy loaded — it is in the review inbox");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Draft failed");
                  } finally {
                    setDrafting(false);
                  }
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-[var(--ops-amber-soft)] disabled:opacity-50"
              >
                {drafting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {drafting ? "Loading golden…" : "Load golden"}
              </button>
              <button
                disabled={
                  rewriting || drafting || !dash.capability.aiConfigured || lead.doNotContact
                }
                onClick={async () => {
                  setRewriting(true);
                  try {
                    const r = await onDraft(activeStep, {
                      mode: "rewrite",
                      currentSubject: subject,
                      currentBody: body,
                    });
                    setSubject(r.subject);
                    setBody(r.body);
                    setTouchId(r.touchId);
                    toast.success("Rewrite ready — it is in the review inbox");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Rewrite failed");
                  } finally {
                    setRewriting(false);
                  }
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-line-strong)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)] disabled:opacity-50"
              >
                {rewriting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Rewrite
              </button>
            </>
          ) : (
            <button
              disabled={drafting || !dash.capability.aiConfigured || lead.doNotContact}
              onClick={async () => {
                setDrafting(true);
                try {
                  const r = await onDraft(activeStep, { mode: "default" });
                  setSubject(r.subject);
                  setBody(r.body);
                  setTouchId(r.touchId);
                  toast.success("Draft ready — it is in the review inbox");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Draft failed");
                } finally {
                  setDrafting(false);
                }
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] hover:bg-[var(--ops-amber-soft)] disabled:opacity-50"
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Agent draft
            </button>
          )}
          <button
            type="button"
            disabled={approving || !subject || !body || lead.doNotContact || approved}
            onClick={async () => {
              if (!touchId) {
                toast.error("Load or draft the touch before approving.");
                return;
              }
              setApproving(true);
              try {
                await onReview(touchId, "approve", subject, body);
                toast.success("Approved");
                await onRefresh();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not approve");
              } finally {
                setApproving(false);
              }
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-amber-border)] px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)] disabled:opacity-50"
          >
            {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {approved ? "Approved" : "Approve"}
          </button>
          <button
            type="button"
            disabled={sending || !approved || !windowStatus.open || lead.doNotContact}
            onClick={() => {
              if (!touchId) return;
              setSending(true);
              onRequestSend(touchId, subject, body);
              setSending(false);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Send now
          </button>
          {approved && !windowStatus.open && (
            <button
              type="button"
              onClick={() => {
                if (!touchId) return;
                onRequestSend(touchId, subject, body, {
                  preview: true,
                  windowReason: windowStatus.reason,
                });
              }}
              className="inline-flex h-10 items-center rounded-xl border border-[var(--ops-line-strong)] px-3 text-[11px] font-semibold text-[var(--ops-ink-soft)]"
            >
              Preview send
            </button>
          )}
          <select
            className={`${inputCls} max-w-[180px]`}
            defaultValue=""
            onChange={(e) => {
              const asset = dash.assets.find((a) => a.key === e.target.value);
              if (!asset?.url) return;
              setBody((prev) => `${prev.trimEnd()}\n\n${asset.title}: ${asset.url}`);
              e.target.value = "";
            }}
          >
            <option value="">Insert asset</option>
            {dash.assets
              .filter((a) => a.url && (a.kind === "video" || a.kind === "one_pager" || a.key === "booking_link"))
              .map((a) => (
                <option key={a.key} value={a.key}>
                  {a.title}
                </option>
              ))}
          </select>
        </div>
        {nextWindowLine(windowStatus) && (
          <p className="mt-2 text-[11px] text-[var(--ops-ink-dim)]">{nextWindowLine(windowStatus)}</p>
        )}

        {existing && (existing.sentAt || existing.deliveredAt || existing.clickedAt) && (
          <p className="mt-2 text-[11px] text-[var(--ops-ink-dim)]">
            {existing.clickedAt
              ? `Clicked${existing.lastClickedUrl ? ` ${existing.lastClickedUrl}` : ""}`
              : existing.deliveredAt
                ? "Delivered to their inbox"
                : "Sent — waiting for delivery"}
          </p>
        )}

        {existing?.error && <p className="mt-2 text-[12px] text-[var(--ops-danger-ink)]">{existing.error}</p>}

        <p className="mt-2 text-[11px] text-[var(--ops-ink-faint)]">
          A sender line and an unsubscribe link are appended automatically at send time, so they do
          not eat into the word budget and cannot be edited away by accident.
        </p>

        {lead.optOutLink && !lead.doNotContact && (
          <div className="mt-4">
            <button
              onClick={async () => {
                if (
                  !window.confirm(
                    "Mark this lead as unsubscribed? This cannot be undone from here.",
                  )
                ) {
                  return;
                }
                try {
                  await onOptOut();
                  toast.success("Marked unsubscribed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not record the opt-out");
                }
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ops-danger-border)] px-2.5 text-[11px] font-semibold text-[var(--ops-danger-ink)] hover:bg-[var(--ops-danger-bg)]"
            >
              <ShieldOff className="h-3 w-3" /> They asked to stop
            </button>
          </div>
        )}

        <div className="mt-6 border-t border-[var(--ops-line)] pt-4">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
            History
          </h3>
          {lead.touches.filter((t) => t.sentAt || t.status === "sent" || t.status === "failed" || t.status === "skipped").length === 0 ? (
            <p className="text-sm text-[var(--ops-ink-faint)]">
              Nothing sent yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {lead.touches
                .filter((t) => t.sentAt || t.status === "sent" || t.status === "failed" || t.status === "skipped")
                .slice()
                .sort((a, b) => a.stepNo - b.stepNo)
                .map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline justify-between gap-3 text-[12.5px]"
                  >
                    <span className="truncate text-[var(--ops-ink-soft)]">
                      {t.stepNo}. {t.subject || "(no subject)"}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--ops-ink-faint)]">
                      {t.clickedAt
                        ? "clicked"
                        : t.deliveredAt
                          ? "delivered"
                          : t.status}
                      {t.sentAt ? ` · ${t.sentAt.slice(0, 10)}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
