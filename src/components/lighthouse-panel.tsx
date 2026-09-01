/**
 * Milōn Lighthouse — founder sales console.
 *
 * Funnel design follows current cold-outreach benchmarks: five touches over
 * ~18 days with widening gaps, one distinct angle per touch, short plain-text
 * bodies, and a breakup close. The motion is email correspondence — replies
 * stay in the thread so this can run around a day job. Calendar booking is
 * optional and off by default. Every sequence terminates at the tracked free
 * trial link so the funnel ends with a signup on the Milōn site.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock,
  Check,
  Copy,
  FileVideo,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldOff,
  Sparkles,
  Target,
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
  sendLighthouseTouch,
  upsertLighthouseAsset,
  upsertLighthouseLead,
  upsertLighthouseSettings,
  type LighthouseDashboard,
  type LighthouseLead,
  type LighthouseStage,
} from "@/lib/lighthouse.functions";
import { LighthouseUsagePanel } from "@/components/lighthouse-usage";

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

export function LighthousePanel() {
  const load = useServerFn(getLighthouse);
  const saveLead = useServerFn(upsertLighthouseLead);
  const importLeads = useServerFn(importLighthouseLeads);
  const draftTouch = useServerFn(draftLighthouseTouch);
  const draftReply = useServerFn(draftLighthouseReply);
  const sendTouch = useServerFn(sendLighthouseTouch);
  const optOut = useServerFn(optOutLighthouseLead);
  const saveAsset = useServerFn(upsertLighthouseAsset);
  const saveSettings = useServerFn(upsertLighthouseSettings);

  const [dash, setDash] = useState<LighthouseDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"pipeline" | "usage" | "playbook" | "assets" | "settings">(
    "pipeline",
  );
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

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

  const openLead = useMemo(
    () => dash?.leads.find((l) => l.id === openLeadId) ?? null,
    [dash, openLeadId],
  );

  if (busy && !dash) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--ops-ink-dim)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading Lighthouse…
      </div>
    );
  }

  if (err && !dash) {
    return (
      <div className="rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-5 text-sm text-[var(--ops-danger-ink)]">
        {err}
      </div>
    );
  }
  if (!dash) return null;

  return (
    <div>
      {dash.migrationHint && (
        <div className="mb-4 rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
          {dash.migrationHint}
        </div>
      )}

      {/* Funnel strip */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <FunnelStat label="In list" value={dash.funnel.sourced} />
        <FunnelStat label="Contacted" value={dash.funnel.contacted} />
        <FunnelStat
          label="Replied"
          value={dash.funnel.replied}
          sub={dash.funnel.replyRatePct != null ? `${dash.funnel.replyRatePct}%` : undefined}
        />
        <FunnelStat label="Conversing" value={dash.funnel.meeting} />
        <FunnelStat
          label="Trials"
          value={dash.funnel.trial}
          sub={dash.funnel.trialRatePct != null ? `${dash.funnel.trialRatePct}%` : undefined}
          gold
        />
        <FunnelStat label="Paying" value={dash.funnel.won} gold />
      </div>

      {/* Capability warnings — honest about what is wired */}
      {(!dash.capability.aiConfigured || !dash.capability.emailConfigured) && (
        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
          {!dash.capability.aiConfigured && (
            <span className="rounded-full border border-[var(--ops-amber-border)] px-3 py-1 text-[var(--ops-amber)]">
              ANTHROPIC_API_KEY missing — AI drafting is off
            </span>
          )}
          {!dash.capability.emailConfigured && (
            <span className="rounded-full border border-[var(--ops-amber-border)] px-3 py-1 text-[var(--ops-amber)]">
              RESEND_API_KEY missing — sending is off, drafts still save
            </span>
          )}
        </div>
      )}

      <div className="mb-4 text-[11px] text-[var(--ops-ink-dim)]">
        Sends today:{" "}
        <span
          className={
            dash.sentToday >= dash.settings.dailySendCap
              ? "font-semibold text-[var(--ops-amber)]"
              : "text-[var(--ops-ink-soft)]"
          }
        >
          {dash.sentToday}/{dash.settings.dailySendCap}
        </span>{" "}
        (SAST day · hard stop when full)
      </div>

      {/* Today */}
      {dash.dueToday.length > 0 && (
        <div className="mb-5 rounded-2xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ops-amber)]">
            <CalendarClock className="h-3.5 w-3.5" /> Due today · {dash.dueToday.length}
          </div>
          <div className="flex flex-wrap gap-2">
            {dash.dueToday.slice(0, 12).map((d) => (
              <button
                key={d.leadId}
                onClick={() => setOpenLeadId(d.leadId)}
                className="rounded-full border border-[var(--ops-line)] bg-[var(--ops-input)] px-3 py-1 text-xs text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)]"
              >
                {d.leadName} · step {d.stepNo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["pipeline", "usage", "playbook", "assets", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              tab === t
                ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={() => setImportOpen((o) => !o)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)]"
        >
          <Upload className="h-3.5 w-3.5" /> Import
        </button>
        <button
          onClick={() => setAddOpen((o) => !o)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
        >
          <Plus className="h-3.5 w-3.5" /> Lead
        </button>
        <button
          onClick={() => void refresh()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-amber)]"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

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

      {tab === "pipeline" && (
        <>
          <p className="mb-3 text-[12.5px] text-[var(--ops-ink-dim)]">
            This pipeline is email correspondence, not calendar booking. Replies stay in the thread
            so it can run around a day job. The{" "}
            <span className="text-[var(--ops-ink-soft)]">In conversation</span> column is an email
            back-and-forth, not a booked call. Google Appointments are optional and off by default.
          </p>
          <PipelineBoard leads={dash.leads} onOpen={(id) => setOpenLeadId(id)} />
        </>
      )}

      {tab === "usage" && <LighthouseUsagePanel />}

      {tab === "playbook" && <Playbook dash={dash} />}

      {tab === "assets" && (
        <AssetGrid
          dash={dash}
          onSave={async (key, url, status) => {
            await saveAsset({ data: { key, url, status } });
            toast.success("Asset updated");
            await refresh();
          }}
        />
      )}

      {tab === "settings" && (
        <SettingsForm
          dash={dash}
          onSave={async (payload) => {
            await saveSettings({ data: payload });
            toast.success("Saved");
            await refresh();
          }}
        />
      )}

      {openLead && (
        <LeadDrawer
          lead={openLead}
          dash={dash}
          onClose={() => setOpenLeadId(null)}
          onDraft={async (stepNo) => draftTouch({ data: { leadId: openLead.id, stepNo } })}
          onDraftReply={async (theirMessage, intent) =>
            draftReply({ data: { leadId: openLead.id, theirMessage, intent } })
          }
          onSend={async (touchId, subject, body) => {
            await sendTouch({ data: { touchId, subject, body } });
            await refresh();
          }}
          onStage={async (stage) => {
            await saveLead({ data: { id: openLead.id, stage } });
            await refresh();
          }}
          onOptOut={async () => {
            await optOut({ data: { leadId: openLead.id } });
            await refresh();
          }}
          onRefresh={refresh}
        />
      )}
    </div>
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
        {value}
        {sub && <span className="ml-1.5 text-[11px] font-semibold text-[var(--ops-ink-dim)]">{sub}</span>}
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
        No leads yet. Import a list or add one — start with 20 well-researched names, not 500
        scraped ones.
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
                  <div className="truncate text-sm font-semibold text-[var(--ops-ink)]">
                    {l.name || l.email || "Unnamed"}
                  </div>
                  <div className="truncate text-[11px] text-[var(--ops-ink-dim)]">
                    {l.company || "—"} · {l.persona === "accountant" ? "practice" : "owner"}
                  </div>
                  {l.signal && (
                    <div className="mt-1 line-clamp-2 text-[11px] text-[var(--ops-ink-dim)]">{l.signal}</div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--ops-ink-faint)]">
                    <span>step {l.sequenceStep}/5</span>
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
    signal?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [city, setCity] = useState("");
  const [persona, setPersona] = useState<"owner" | "accountant">("owner");
  const [signal, setSignal] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mb-4 grid gap-2 rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave({ name, email, company, roleTitle, city, persona, signal });
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
        onChange={(e) => setPersona(e.target.value as "owner" | "accountant")}
      >
        <option value="owner">Business owner</option>
        <option value="accountant">Accountant / practice</option>
      </select>
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

function Playbook({ dash }: { dash: LighthouseDashboard }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4 text-sm text-[var(--ops-ink-soft)]">
        <p className="font-semibold text-[var(--ops-ink)]">How the funnel is built</p>
        <p className="mt-1.5 text-[var(--ops-ink-dim)]">
          Five touches over roughly eighteen days with widening gaps. Each touch carries one
          distinct angle, stays short and plain-text, and never repeats a previous opening. Only
          touches four and five ask for the signup; the earlier ones earn the right to ask. The
          breakup email is deliberately the shortest — it consistently draws the highest reply rate.
        </p>
        <p className="mt-1.5 text-[var(--ops-ink-dim)]">
          Every sequence ends at the same destination: the tracked free-trial link, which lands the
          prospect on the Milōn signup form with attribution back to their lead record. There is no
          meeting step in the emails. If someone writes back, you answer in the same thread — or
          they start the trial themselves.
        </p>
      </div>

      {dash.sequences.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--ops-line-strong)] p-8 text-center text-sm text-[var(--ops-ink-dim)]">
          Sequences load once the Lighthouse migration has been run.
        </div>
      )}

      {dash.sequences.map((seq) => (
        <div key={seq.key} className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--ops-amber)]" />
            <h3 className="text-sm font-bold text-[var(--ops-ink)]">{seq.name}</h3>
            <span className="rounded-full border border-[var(--ops-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">
              {seq.key}
            </span>
          </div>
          <ol className="space-y-2">
            {seq.steps.map((s) => {
              const asset = dash.assets.find((a) => a.key === s.asset);
              return (
                <li
                  key={s.step}
                  className="grid gap-2 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-3 sm:grid-cols-[auto_1fr]"
                >
                  <div className="flex items-start gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--ops-amber-soft)] text-[11px] font-bold text-[var(--ops-amber)]">
                      {s.step}
                    </span>
                    <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-[var(--ops-ink-dim)]">
                      day {s.day}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold capitalize text-[var(--ops-ink)]">
                      {s.angle.replaceAll("_", " ")}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-[var(--ops-ink-dim)]">{s.goal}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded-full border border-[var(--ops-line)] px-2 py-0.5 text-[var(--ops-ink-dim)]">
                        ≤ {s.max_words} words
                      </span>
                      <span className="rounded-full border border-[var(--ops-line)] px-2 py-0.5 text-[var(--ops-ink-dim)]">
                        cta: {s.cta.replaceAll("_", " ")}
                      </span>
                      {asset && (
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            asset.status === "ready"
                              ? "bg-[var(--ops-ok-bg)] text-[var(--ops-ok-ink)]"
                              : "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]/80"
                          }`}
                        >
                          {asset.title} · {asset.status === "ready" ? "ready" : "placeholder"}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
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

function SettingsForm({
  dash,
  onSave,
}: {
  dash: LighthouseDashboard;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const s = dash.settings;
  const [senderName, setSenderName] = useState(s.senderName);
  const [senderTitle, setSenderTitle] = useState(s.senderTitle);
  const [trialDays, setTrialDays] = useState(String(s.trialDays));
  const [dailySendCap, setDailySendCap] = useState(String(s.dailySendCap));
  const [bookingUrl, setBookingUrl] = useState(s.bookingUrl);
  const [sendWindow, setSendWindow] = useState(s.sendWindow);
  const [senderAddress, setSenderAddress] = useState(s.senderAddress);
  const [replyTo, setReplyTo] = useState(s.replyTo);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
          Sender & offer
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className={inputCls}
            placeholder="Sender name"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="Sender title"
            value={senderTitle}
            onChange={(e) => setSenderTitle(e.target.value)}
          />
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
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Reply-to — your real inbox, e.g. amstel.west@gmail.com"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
          />
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Postal address for the email footer — street, city, country"
            value={senderAddress}
            onChange={(e) => setSenderAddress(e.target.value)}
          />
          <input
            className={`${inputCls} sm:col-span-2`}
            placeholder="Send window (reminder only — not enforced yet)"
            value={sendWindow}
            onChange={(e) => setSendWindow(e.target.value)}
          />
        </div>
        {!senderAddress.trim() && (
          <p className="mt-2 text-[11px] text-[var(--ops-amber)]/80">
            Without an address the footer still identifies you and carries the unsubscribe link, but
            a postal line is what most spam filters expect on cold mail.
          </p>
        )}
        {!replyTo.trim() && (
          <p className="mt-1 text-[11px] text-[var(--ops-amber)]/80">
            Without a reply-to, replies go to the From address. Set this to the inbox you actually
            watch.
          </p>
        )}
        <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">
          {bookingUrl.trim()
            ? "A calendar link is set, so the reply drafter can offer a call if you pick that intent. Leave this blank to keep every conversation on email."
            : "Leave this blank. The pipeline is email correspondence — replies, questions, and the trial link — so it can run around a day job. Add Cal.com or Google Appointments later only if you want live calls."}
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                senderName,
                senderTitle,
                trialDays: Number(trialDays) || 14,
                dailySendCap: Number(dailySendCap) || 25,
                bookingUrl,
                sendWindow,
                senderAddress,
                replyTo,
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
  onSend,
  onStage,
  onOptOut,
  onRefresh,
}: {
  lead: LighthouseLead;
  dash: LighthouseDashboard;
  onClose: () => void;
  onDraft: (stepNo: number) => Promise<{ subject: string; body: string; touchId: string }>;
  onDraftReply: (
    theirMessage: string,
    intent: "answer" | "email" | "book" | "trial",
  ) => Promise<{ subject: string; body: string; touchId: string; stepNo: number }>;
  onSend: (touchId: string, subject: string, body: string) => Promise<void>;
  onStage: (stage: LighthouseStage) => Promise<void>;
  onOptOut: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const seq = dash.sequences.find((s) => s.key === lead.sequenceKey);
  const stepCount = seq?.steps.length || 5;
  const [activeStep, setActiveStep] = useState(Math.min(lead.sequenceStep + 1, stepCount));
  const existing = lead.touches.find((t) => t.stepNo === activeStep) ?? null;

  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [touchId, setTouchId] = useState(existing?.id ?? "");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [theirMessage, setTheirMessage] = useState("");
  const [replyIntent, setReplyIntent] = useState<"answer" | "email" | "book" | "trial">("answer");
  const [replying, setReplying] = useState(false);

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
            <h2 className="text-xl font-bold text-[var(--ops-ink)]">
              {lead.name || lead.email || "Unnamed lead"}
            </h2>
            <p className="text-sm text-[var(--ops-ink-dim)]">
              {lead.company || "—"} · {lead.persona === "accountant" ? "practice" : "owner"}
              {lead.city ? ` · ${lead.city}` : ""}
            </p>
            {lead.signal && (
              <p className="mt-1.5 rounded-lg border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-2 text-[12.5px] text-[var(--ops-ink-soft)]">
                Signal: {lead.signal}
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
              {(lead.inbound[0].body ?? "").slice(0, 700) || "(body not fetched yet — run the engagement migration and keep RESEND_API_KEY set)"}
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
                      toast.success("Reply drafted — read it before sending");
                      await onRefresh();
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

        {/* Step tabs */}
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
          {STEP_HINT[activeStep] ?? "Reply — answer what they asked, one ask at most"}
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
            placeholder="Draft with AI, then edit before sending. Nothing sends without your click."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={drafting || !dash.capability.aiConfigured || lead.doNotContact}
            onClick={async () => {
              setDrafting(true);
              try {
                const r = await onDraft(activeStep);
                setSubject(r.subject);
                setBody(r.body);
                setTouchId(r.touchId);
                toast.success("Draft ready — read it before sending");
                await onRefresh();
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
            Draft with Claude
          </button>
          <button
            disabled={sending || !touchId || !subject || !body || lead.doNotContact}
            onClick={async () => {
              setSending(true);
              try {
                await onSend(touchId, subject, body);
                toast.success("Sent");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Send failed");
              } finally {
                setSending(false);
              }
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300] disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send now
          </button>
          {lead.email && (
            <a
              href={`mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--ops-line-strong)] px-4 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)] hover:border-[var(--ops-amber-border)]"
            >
              <Mail className="h-3.5 w-3.5" /> Open in mail
            </a>
          )}
        </div>

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

        {/* Opt-out */}
        {lead.optOutLink && !lead.doNotContact && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-2.5">
            <code className="flex-1 truncate text-[11px] text-[var(--ops-ink-dim)]">{lead.optOutLink}</code>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(lead.optOutLink ?? "");
                toast.success("Opt-out link copied");
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ops-line-strong)] px-2.5 text-[11px] text-[var(--ops-ink-dim)] hover:border-[var(--ops-amber-border)]"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
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
          {lead.touches.length === 0 ? (
            <p className="text-sm text-[var(--ops-ink-faint)]">Nothing sent yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {lead.touches
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
