import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import { PortfolioHealthScatter } from "@/components/portfolio-health-scatter";
import { shouldStayOnAccountantPortal, setPortalIntent, clearForcePortal } from "@/lib/user-roles";
import {
  healthFromFlatFinancials,
  buildTrend,
  scoreTier,
  type TrendPoint,
  type OverallHealth,
} from "@/lib/health-score";
import {
  avgHealthDelta,
  buildAttentionItems,
  buildFollowUpQueue,
  buildPortfolioInsights,
  clientsAddedThisMonth,
  dataAsOfLabel,
  derivePriority,
  firstNameOf,
  portfolioSparkPoints,
  portfolioSummaryLine,
  revenueOf,
  timeGreeting,
  trendDelta30d,
  type PriorityLevel,
  type ScoreHistoryPoint,
} from "@/lib/portfolio-dashboard";
import { useServerFn } from "@tanstack/react-start";
import { getQboStatuses } from "@/lib/qbo.functions";
import { createFirmClient } from "@/lib/firm-clients.functions";
import { inviteClientOwner, sendDraftedOwnerInvite } from "@/lib/client-invite.functions";
import { effectiveCashRunwayWeeks } from "@/lib/cash-runway";
import { countOpenQueriesByClient } from "@/lib/open-queries";
import "@/styles/accountant-portal.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { FirmSwitcher } from "@/components/firm-switcher";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { WalkthroughWizard } from "@/components/walkthrough-wizard";
import { MarketPicker } from "@/components/market-picker";
import {
  coerceMarketSelection,
  draftToSelection,
  formatMoney,
  isDraftComplete,
  parseMarketSelection,
  resolveMarket,
  type DraftMarket,
} from "@/lib/market";
import {
  ACCOUNTANT_FIRST_CLIENT_KEY,
  PRACTICE_TEST_CLIENT_NAME,
  markOnboardingDone,
  onboardingDone,
} from "@/lib/onboarding";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Firm Dashboard — Milōn" }] }),
});

// ── Types ────────────────────────────────────────────────────────────────────

type Firm = { id: string; name: string; referral_code: string | null; owner_user_id: string };

type Client = {
  id: string;
  name: string;
  business_type: string | null;
  client_code?: string | null;
  contact_email?: string | null;
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  last_login_at: string | null;
  firm_id: string | null;
  financials: Record<string, string | number | null> | null;
  cashflow?: unknown;
  created_at?: string | null;
  // reports_issued_count may not exist until migration runs
  reports_issued_count?: number | null;
  market?: unknown;
};

type ClientRow = Client & {
  score: number | null;
  health: OverallHealth;
  trend: TrendPoint[];
  /** ~30-day health delta from score history. */
  trendDelta: number | null;
  /** Resolved runway (persisted or derived from cashflow). */
  runwayWeeks: number | null;
  /** Unresolved notes count. */
  openQueries: number;
  /** Open (not done) action-plan items. */
  openActions: number;
  /** Open actions past due_date. */
  overdueActions: number;
  /** Revenue for scatter bubble sizing. */
  revenue: number | null;
  priority: PriorityLevel;
  priorityLabel: string;
};

// Playbook metadata shape for the library grid
type PlaybookMeta = {
  ratioKey: string;
  ratioName: string;
  cat: string;
};

// ── Static playbook catalogue from playbook-data.json ────────────────────────
// We deduplicate by ratioKey to get the list of all available ratios.
// Categories are derived from the first step's category field per ratio.
// The design groups cards by category label.

const RATIO_CATEGORY_MAP: Record<string, string> = {
  revenue: "Profitability",
  cost: "Profitability",
  operations: "Profitability",
  risk: "Leverage & Financing",
  cash: "Cash & Working Capital",
  people: "People & Operations",
  structure: "Structure & Assets",
};

// Build catalogue at module load time (sync import via vite bundling)
let _playbookCatalogue: PlaybookMeta[] | null = null;

async function getPlaybookCatalogue(): Promise<PlaybookMeta[]> {
  if (_playbookCatalogue) return _playbookCatalogue;
  const raw = await import("@/lib/playbook-data.json");
  const all = (raw.default ?? raw) as Array<{
    ratio_key: string;
    ratio_name: string;
    category: string;
  }>;
  const seen = new Map<string, PlaybookMeta>();
  for (const item of all) {
    if (!seen.has(item.ratio_key)) {
      seen.set(item.ratio_key, {
        ratioKey: item.ratio_key,
        ratioName: item.ratio_name,
        cat: RATIO_CATEGORY_MAP[item.category] ?? item.category,
      });
    }
  }
  _playbookCatalogue = Array.from(seen.values());
  return _playbookCatalogue;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Chip from overall health — respects the critical-pillar tell. */
function chipFromHealth(health: OverallHealth): { cls: "ok" | "warn" | "risk"; label: string } {
  if (health.overall == null) return { cls: "warn", label: "—" };
  const tier = health.displayStatus;
  if (tier === "healthy") return { cls: "ok", label: health.displayLabel };
  if (tier === "at_risk") return { cls: "warn", label: health.displayLabel };
  return { cls: "risk", label: health.displayLabel };
}

/** SVG ring for a 0-100 score */
function RingSvg({
  score,
  status,
  size = 46,
  sw = 4,
}: {
  score: number | null;
  /** When set, drives ring colour (critical-pillar tell) instead of raw scoreTier. */
  status?: ReturnType<typeof scoreTier>;
  size?: number;
  sw?: number;
}) {
  // Null score = empty ring. Never invent 50 — that makes unscored clients look average.
  const hasScore = score != null && Number.isFinite(score);
  const s = hasScore ? Math.min(100, Math.max(0, score)) : 0;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - s / 100);
  const tier = status ?? (hasScore ? scoreTier(s) : "at_risk");
  const col = !hasScore
    ? "var(--muted, #94a3b8)"
    : tier === "healthy"
      ? "var(--ok)"
      : tier === "at_risk"
        ? "var(--warn)"
        : "var(--risk)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="tr" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} />
      {hasScore && (
        <circle
          className="fl"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={sw}
          stroke={col}
          strokeDasharray={c.toFixed(1)}
          strokeDashoffset={off.toFixed(1)}
        />
      )}
    </svg>
  );
}

/** Sparkline SVG from numeric points (or an 8-point trend). */
function SparkSvg({
  trend,
  points,
  className = "spark",
  width = 84,
  height = 26,
}: {
  trend?: TrendPoint[];
  points?: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const pts = points ?? trend?.map((t) => t.score) ?? [];
  if (pts.length === 0) return <svg className={className} viewBox={`0 0 ${width} ${height}`} />;
  const w = width;
  const h = height;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const rg = max - min || 1;
  const step = w / Math.max(pts.length - 1, 1);
  const d = pts
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${(i * step).toFixed(1)} ${(h - 3 - ((p - min) / rg) * (h - 6)).toFixed(1)}`,
    )
    .join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`}>
      <path d={d} stroke={up ? "var(--ok)" : "var(--risk)"} />
    </svg>
  );
}

// ── Add Client Dialog ─────────────────────────────────────────────────────────

function AddClientDialog({
  open,
  onClose,
  onAdded,
  firmId,
  brandLoading = false,
  defaultName = "",
  heading = "Add a client",
  blurb,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (created: {
    id: string;
    name: string;
    firm_id: string | null;
    client_code: string | null;
    contact_email?: string | null;
  }) => void;
  firmId: string | null;
  brandLoading?: boolean;
  defaultName?: string;
  heading?: string;
  blurb?: string;
}) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftMarket, setDraftMarket] = useState<DraftMarket>({ country: "ZA", regionCode: null });
  const inputRef = useRef<HTMLInputElement>(null);
  const createClient = useServerFn(createFirmClient);
  const inviteOwner = useServerFn(inviteClientOwner);

  useEffect(() => {
    if (open) {
      setNewName(defaultName);
      setNewType("");
      setOwnerEmail("");
      setDraftMarket({ country: "ZA", regionCode: null });
      if (firmId) {
        void supabase
          .from("firms")
          .select("market")
          .eq("id", firmId)
          .maybeSingle()
          .then(({ data }) => {
            const sel =
              parseMarketSelection((data as { market?: unknown } | null)?.market) ??
              coerceMarketSelection(null);
            setDraftMarket({ country: sel.country, regionCode: sel.regionCode });
          });
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, defaultName, firmId]);

  if (!open) return null;

  const add = async () => {
    if (!newName.trim()) {
      toast.error("Enter a business name");
      return;
    }
    const email = ownerEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid owner email, or leave it blank");
      return;
    }
    const market = draftToSelection(draftMarket);
    if (!market) {
      toast.error("Pick a region — and a US state if this client is in the United States.");
      return;
    }
    setSaving(true);
    try {
      const created = await createClient({
        data: {
          name: newName.trim(),
          firmId: firmId ?? undefined,
          businessType: newType.trim() || null,
          marketCountry: market.country,
          marketRegion: market.regionCode,
        },
      });
      let inviteNote = created.client_code
        ? `Client added · ${created.client_code}`
        : "Client added";
      if (email) {
        try {
          const inv = await inviteOwner({
            data: { clientId: created.id, toEmail: email, sendEmail: true },
          });
          await navigator.clipboard?.writeText(inv.pasteText);
          if (inv.emailed) {
            inviteNote = `${inviteNote} · invite emailed to ${inv.email}`;
          } else if (inv.sendError) {
            inviteNote = `${inviteNote} · invite copied (email not sent)`;
            toast.error(inv.sendError);
          } else {
            inviteNote = `${inviteNote} · invite message copied`;
          }
        } catch (invErr) {
          toast.error(invErr instanceof Error ? invErr.message : "Client added, but invite failed");
        }
      }
      toast.success(inviteNote);
      onAdded({
        id: created.id,
        name: created.name,
        firm_id: created.firm_id,
        client_code: created.client_code,
        contact_email: email || null,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="veil open" onClick={onClose} />
      <div className="drawer open" style={{ maxWidth: 420 }}>
        <div className="drawer-head">
          <div className="cat">New client</div>
          <h3>{heading}</h3>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body" style={{ padding: "24px 30px" }}>
          {blurb && (
            <p
              style={{ marginBottom: 16, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.55 }}
            >
              {blurb}
            </p>
          )}
          {brandLoading && !firmId && (
            <p style={{ marginBottom: 16, fontSize: 13, color: "var(--ink-dim)" }}>
              Loading your practice — you can still add the client.
            </p>
          )}
          {!brandLoading && !firmId && (
            <p style={{ marginBottom: 16, fontSize: 13, color: "var(--ink-dim)" }}>
              A practice firm will be created automatically with this first client.
            </p>
          )}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: 10.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Business name *
            </label>
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              style={{
                width: "100%",
                padding: "11px 14px",
                borderRadius: 11,
                border: "1px solid var(--line)",
                background: "var(--bg-2)",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 14,
              }}
              placeholder="e.g. Karoo Traders"
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <MarketPicker value={draftMarket} onChange={setDraftMarket} variant="app" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                fontSize: 10.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Business type (optional)
            </label>
            <input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              style={{
                width: "100%",
                padding: "11px 14px",
                borderRadius: 11,
                border: "1px solid var(--line)",
                background: "var(--bg-2)",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 14,
              }}
              placeholder="Services / Retail / SaaS…"
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                fontSize: 10.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Owner email (optional)
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              style={{
                width: "100%",
                padding: "11px 14px",
                borderRadius: 11,
                border: "1px solid var(--line)",
                background: "var(--bg-2)",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 14,
              }}
              placeholder="owner@business.co.za"
            />
            <p
              style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.45 }}
            >
              We email them a claim link and copy a paste-ready message for you.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              className="btn gold"
              onClick={() => void add()}
              disabled={saving || !newName.trim() || !isDraftComplete(draftMarket)}
              style={{ flex: 1 }}
            >
              {saving ? "Saving…" : "Add client"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

type InviteDraftUi = {
  clientId: string;
  clientName: string;
  token: string;
  subject: string;
  body: string;
  pasteText: string;
  email: string;
  emailed: boolean;
  sendError: string | null;
  draftedBy: "claude" | "template";
};

function InviteOwnerDialog({
  draft,
  sending,
  onClose,
  onEmailChange,
  onCopy,
  onSend,
}: {
  draft: InviteDraftUi;
  sending: boolean;
  onClose: () => void;
  onEmailChange: (email: string) => void;
  onCopy: () => void;
  onSend: () => void;
}) {
  return (
    <>
      <div className="veil open" onClick={onClose} />
      <div className="drawer open" style={{ maxWidth: 480 }}>
        <div className="drawer-head">
          <div className="cat">Invite owner</div>
          <h3>{draft.clientName}</h3>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body" style={{ padding: "24px 30px" }}>
          {draft.emailed ? (
            <p style={{ marginBottom: 14, fontSize: 13, color: "var(--ok)", lineHeight: 1.55 }}>
              Invite emailed to {draft.email}. The same message is copied below if you want to
              forward it.
            </p>
          ) : (
            <p
              style={{ marginBottom: 14, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.55 }}
            >
              {draft.sendError
                ? `Could not send automatically (${draft.sendError}). Copy the message or try again.`
                : "No owner email on file yet — add it to send, or copy the message into your own email."}
            </p>
          )}
          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                fontSize: 10.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Owner email
            </label>
            <input
              type="email"
              value={draft.email}
              onChange={(e) => onEmailChange(e.target.value)}
              style={{
                width: "100%",
                padding: "11px 14px",
                borderRadius: 11,
                border: "1px solid var(--line)",
                background: "var(--bg-2)",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 14,
              }}
              placeholder="owner@business.co.za"
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label
              style={{
                fontSize: 10.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Message {draft.draftedBy === "claude" ? "· drafted" : ""}
            </label>
            <textarea
              readOnly
              value={draft.pasteText}
              rows={12}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 11,
                border: "1px solid var(--line)",
                background: "var(--bg-2)",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={onCopy} style={{ flex: 1, minWidth: 140 }}>
              Copy message
            </button>
            <button
              className="btn gold"
              onClick={onSend}
              disabled={sending || !draft.email.trim()}
              style={{ flex: 1, minWidth: 140 }}
            >
              {sending ? "Sending…" : draft.emailed ? "Send again" : "Send email"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // ── Role guard ────────────────────────────────────────────────────────────
  // Business-client credentials must not sit on the practice portal. Wait for
  // the stay check before painting the board so we never flash firm UI or
  // trigger add-client against an owner login.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setPortalReady(false);
    void shouldStayOnAccountantPortal(user.id).then((stay) => {
      if (cancelled) return;
      if (stay) {
        setPortalIntent("accountant");
        clearForcePortal();
        setPortalReady(true);
        return;
      }
      clearForcePortal();
      setPortalIntent("owner");
      navigate({ to: "/app" });
    });
    return () => {
      cancelled = true;
    };
  }, [user, navigate]);

  const { firmId, firms, brandLoading, profile, refreshFirms } = useAccountantProfile();
  const firm: Firm | null =
    firms.find((f) => f.id === firmId) ??
    (firms[0]
      ? {
          id: firms[0].id,
          name: firms[0].name,
          referral_code: firms[0].referral_code,
          owner_user_id: firms[0].owner_user_id,
        }
      : null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [clientRows, setClientRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [firstClientOpen, setFirstClientOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraftUi | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [qboStatuses, setQboStatuses] = useState<
    Record<string, { companyName: string | null; lastSyncedAt: string | null; syncStatus: string }>
  >({});
  const [playbookCatalogue, setPlaybookCatalogue] = useState<PlaybookMeta[]>([]);
  // playbook drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRatioKey, setDrawerRatioKey] = useState<string | null>(null);
  const [drawerRatioName, setDrawerRatioName] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isItMember, setIsItMember] = useState(false);

  // Only known after mount — reading window.location.origin during render would
  // make the server-rendered HTML differ from the client's first render and
  // trigger a hydration mismatch.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const getStatuses = useServerFn(getQboStatuses);
  const mintInvite = useServerFn(inviteClientOwner);
  const sendDraftedInvite = useServerFn(sendDraftedOwnerInvite);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async (activeFirmId: string | null, userId: string | undefined) => {
    setLoading(true);

    if (!userId) {
      setClientRows([]);
      setQboStatuses({});
      setIsItMember(false);
      setLoading(false);
      return;
    }

    let isIt = false;
    try {
      const { data: itFlag } = await supabase.rpc(
        "is_milon_it_member" as never,
        {
          _user_id: userId,
        } as never,
      );
      isIt = Boolean(itFlag);
    } catch {
      isIt = false;
    }
    setIsItMember(isIt);

    // Firm-scoped list + legacy orphans (firm_id null) owned by this accountant.
    // Strict firm_id-only filtering hid pre-G27 clients and made the dashboard look empty.
    // IT members have master access — list every client they can read.
    let query = supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (!isIt) {
      if (activeFirmId) {
        query = query.or(
          `firm_id.eq.${activeFirmId},and(firm_id.is.null,owner_user_id.eq.${userId})`,
        );
      } else {
        query = query.eq("owner_user_id", userId);
      }
    }
    const { data: cs, error } = await query;
    if (error) toast.error(error.message);
    let rawClients = (cs ?? []) as Client[];

    // Attach legacy null-firm practice clients to the active firm so they stay visible.
    if (!isIt && activeFirmId && rawClients.some((c) => !c.firm_id)) {
      const orphanIds = rawClients.filter((c) => !c.firm_id).map((c) => c.id);
      const { error: attachErr } = await supabase
        .from("clients")
        .update({ firm_id: activeFirmId })
        .in("id", orphanIds)
        .eq("owner_user_id", userId)
        .is("firm_id", null);
      if (!attachErr) {
        rawClients = rawClients.map((c) =>
          orphanIds.includes(c.id) ? { ...c, firm_id: activeFirmId } : c,
        );
      }
    }

    // QBO statuses (non-fatal)
    let qbo: typeof qboStatuses = {};
    if (rawClients.length > 0) {
      try {
        qbo = await getStatuses({ data: { clientIds: rawClients.map((c) => c.id) } });
        setQboStatuses(qbo);
      } catch {
        // non-fatal
      }
    }

    // Score history — query defensively; the table may not exist yet
    const historyMap: Record<string, ScoreHistoryPoint[]> = {};
    try {
      // NOTE: client_score_history is added by migration 20260802000000_score_history_and_reports_count.sql
      // which may not have run yet against the live database — query defensively.
      const { data: hist, error: histErr } = await supabase
        .from("client_score_history")
        .select("client_id, score, is_estimated, period_date")
        .in(
          "client_id",
          rawClients.map((c) => c.id),
        )
        .order("period_date", { ascending: true });

      if (histErr) {
        // Only silently ignore "relation does not exist" (table not migrated yet)
        const msg = histErr.message ?? "";
        if (!msg.includes("does not exist") && !msg.includes("relation")) {
          console.error("score history error:", histErr);
        }
      } else if (hist) {
        for (const row of hist) {
          historyMap[row.client_id] = historyMap[row.client_id] ?? [];
          historyMap[row.client_id].push({
            score: row.score,
            is_estimated: row.is_estimated,
            period_date: row.period_date,
          });
        }
      }
    } catch {
      // table doesn't exist — silently ignore
    }

    // Open action-plan items (non-fatal if RLS/table missing)
    const openActionsMap: Record<string, number> = {};
    const overdueActionsMap: Record<string, number> = {};
    if (rawClients.length > 0) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const { data: actions, error: actErr } = await supabase
          .from("action_items")
          .select("client_id, status, due_date")
          .in(
            "client_id",
            rawClients.map((c) => c.id),
          )
          .neq("status", "done");
        if (!actErr && actions) {
          for (const a of actions) {
            openActionsMap[a.client_id] = (openActionsMap[a.client_id] ?? 0) + 1;
            if (a.due_date && a.due_date < today) {
              overdueActionsMap[a.client_id] = (overdueActionsMap[a.client_id] ?? 0) + 1;
            }
          }
        }
      } catch {
        // non-fatal
      }
    }

    // Compute per-client enriched rows
    const openQueriesMap = await countOpenQueriesByClient(rawClients.map((c) => c.id));
    const rows: ClientRow[] = rawClients.map((c) => {
      const runwayWeeks = effectiveCashRunwayWeeks(
        c.cash_runway_weeks,
        c.cashflow as Parameters<typeof effectiveCashRunwayWeeks>[1],
      );
      const health = healthFromFlatFinancials(c.financials, runwayWeeks);
      const score = health.overall;
      const realHistory = historyMap[c.id] ?? [];
      const trendHistory =
        realHistory.length > 0 ? realHistory : score != null ? [{ score, is_estimated: true }] : [];
      const trend = buildTrend(trendHistory);
      const trendDelta = trendDelta30d(realHistory, score);
      const openActions = openActionsMap[c.id] ?? 0;
      const overdueActions = overdueActionsMap[c.id] ?? 0;
      const openQueries = openQueriesMap[c.id] ?? 0;
      const revenue = revenueOf(c.financials);
      const priority = derivePriority({
        score,
        health,
        trendDelta,
        runwayWeeks,
        openQueries,
        openActions,
        overdueActions,
        revenue,
      });
      return {
        ...c,
        score,
        health,
        trend,
        trendDelta,
        runwayWeeks,
        openQueries,
        openActions,
        overdueActions,
        revenue,
        priority: priority.level,
        priorityLabel: priority.label,
      };
    });

    setClientRows(rows);
    setLoading(false);
  };

  useEffect(() => {
    if (!portalReady || brandLoading) return;
    void load(firmId, user?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, brandLoading, user?.id, portalReady]);

  // Load playbook catalogue
  useEffect(() => {
    getPlaybookCatalogue().then(setPlaybookCatalogue);
  }, []);

  // ── enterAsClient ─────────────────────────────────────────────────────────
  const enterAsClient = async (c: ClientRow) => {
    if (!user) return;
    const { error } = await supabase.from("impersonation_audit").insert({
      firm_user_id: user.id,
      client_id: c.id,
      firm_id: firm?.id ?? null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    sessionStorage.setItem("acting_as_client_id", c.id);
    sessionStorage.setItem("acting_as_client_name", c.name);
    navigate({ to: "/app" });
  };

  const openOwnerInvite = async (c: Client) => {
    try {
      const inv = await mintInvite({
        data: {
          clientId: c.id,
          toEmail: c.contact_email || null,
          sendEmail: Boolean(c.contact_email),
        },
      });
      await navigator.clipboard?.writeText(inv.pasteText);
      const next: InviteDraftUi = {
        clientId: c.id,
        clientName: c.name,
        token: inv.token,
        subject: inv.subject,
        body: inv.body,
        pasteText: inv.pasteText,
        email: inv.email ?? c.contact_email ?? "",
        emailed: inv.emailed,
        sendError: inv.sendError,
        draftedBy: inv.draftedBy,
      };
      setInviteDraft(next);
      setClientRows((rows) =>
        rows.map((row) =>
          row.id === c.id ? { ...row, contact_email: next.email || row.contact_email } : row,
        ),
      );
      if (inv.emailed) {
        toast.success(`Invite emailed to ${inv.email} · message copied`);
      } else if (inv.sendError) {
        toast.error(inv.sendError);
      } else {
        toast.success("Invite message copied — add an email to send it");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not prepare invite");
    }
  };

  const copyInviteDraft = async () => {
    if (!inviteDraft) return;
    await navigator.clipboard?.writeText(inviteDraft.pasteText);
    toast.success("Invite message copied");
  };

  const sendInviteDraft = async () => {
    if (!inviteDraft?.email.trim()) {
      toast.error("Enter the owner's email");
      return;
    }
    setInviteSending(true);
    try {
      const sent = await sendDraftedInvite({
        data: {
          clientId: inviteDraft.clientId,
          toEmail: inviteDraft.email.trim(),
          subject: inviteDraft.subject,
          body: inviteDraft.body,
          token: inviteDraft.token,
        },
      });
      setInviteDraft((d) => (d ? { ...d, emailed: true, email: sent.email, sendError: null } : d));
      setClientRows((rows) =>
        rows.map((row) =>
          row.id === inviteDraft.clientId ? { ...row, contact_email: sent.email } : row,
        ),
      );
      toast.success(`Invite emailed to ${sent.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send invite");
    } finally {
      setInviteSending(false);
    }
  };

  // ── Referral ──────────────────────────────────────────────────────────────
  // Origin is intentionally read only after mount (see `origin` state above) so the
  // server-rendered HTML and the first client render match — computing
  // `window.location.origin` inline during render caused a hydration mismatch.
  const referralUrl = firm?.referral_code ? `${origin}/auth?ref=${firm.referral_code}` : "";

  const copyReferral = () => {
    if (!referralUrl) {
      toast.error("No referral link yet");
      return;
    }
    navigator.clipboard?.writeText(referralUrl);
    toast.success("Referral link copied");
  };

  // ── Sign out ──────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/";
  };

  // ── Playbook drawer ───────────────────────────────────────────────────────
  const openDrawer = (ratioKey: string, ratioName: string) => {
    setDrawerRatioKey(ratioKey);
    setDrawerRatioName(ratioName);
    setDrawerOpen(true);
  };

  // ── First practice client nudge ─────────────────────────────────────────
  useEffect(() => {
    if (!portalReady || loading || brandLoading) return;
    if (clientRows.length > 0) {
      markOnboardingDone(ACCOUNTANT_FIRST_CLIENT_KEY);
      return;
    }
    if (!onboardingDone(ACCOUNTANT_FIRST_CLIENT_KEY) && !brandLoading) {
      setFirstClientOpen(true);
    }
  }, [portalReady, loading, brandLoading, clientRows.length, firm?.id, firmId]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  // Average only scored clients — never invent 50 for empty financials.
  const scoredRows = clientRows.filter((c) => c.score != null && Number.isFinite(c.score));
  const avgHealth = scoredRows.length
    ? Math.round(scoredRows.reduce((s, c) => s + (c.score as number), 0) / scoredRows.length)
    : null;
  // "Needs attention" = display status (includes critical-pillar demotion to Watch).
  const atRiskCount = clientRows.filter(
    (c) => c.health.overall != null && c.health.displayStatus !== "healthy",
  ).length;
  const criticalCount = clientRows.filter((c) => c.health.displayStatus === "critical").length;
  const openActionsTotal = clientRows.reduce((s, c) => s + c.openActions, 0);
  const actionsDueThisWeek = clientRows.reduce((s, c) => {
    // Approximate: overdue counts toward "due this week" pressure; open actions
    // without dates still contribute to the headline open-actions metric only.
    return s + c.overdueActions;
  }, 0);
  const addedThisMonth = clientsAddedThisMonth(clientRows);
  const healthDelta = avgHealthDelta(clientRows);
  const sparkPts = portfolioSparkPoints(scoredRows);
  const greetName = firstNameOf(profile.accountantName || user?.email?.split("@")[0]);
  const greeting = `${timeGreeting()}, ${greetName}.`;
  const summaryLine = portfolioSummaryLine({
    clientCount: clientRows.length,
    needAttention: atRiskCount,
    avgHealth,
  });
  const asOf = dataAsOfLabel();

  const attentionItems = useMemo(
    () =>
      buildAttentionItems(
        clientRows.map((c) => ({
          id: c.id,
          name: c.name,
          score: c.score,
          health: c.health,
          trendDelta: c.trendDelta,
          runwayWeeks: c.runwayWeeks,
          openQueries: c.openQueries,
          openActions: c.openActions,
          overdueActions: c.overdueActions,
          revenue: c.revenue,
        })),
        3,
      ),
    [clientRows],
  );

  const insights = useMemo(
    () =>
      buildPortfolioInsights(
        clientRows.map((c) => ({
          id: c.id,
          name: c.name,
          score: c.score,
          health: c.health,
          trendDelta: c.trendDelta,
          runwayWeeks: c.runwayWeeks,
          openQueries: c.openQueries,
          openActions: c.openActions,
          overdueActions: c.overdueActions,
          revenue: c.revenue,
        })),
      ),
    [clientRows],
  );

  const followUpItems = useMemo(
    () =>
      buildFollowUpQueue(
        clientRows.map((c) => ({
          id: c.id,
          name: c.name,
          overdueActions: c.overdueActions,
          openActions: c.openActions,
        })),
      ),
    [clientRows],
  );

  const openClientPlan = (clientId: string, overdue: boolean) =>
    navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: overdue ? { tab: "plan", filter: "overdue" } : { tab: "plan" },
    });

  const scatterClients = useMemo(
    () =>
      scoredRows
        .filter((c) => c.score != null)
        .map((c) => ({
          id: c.id,
          name: c.name,
          score: c.score as number,
          trendDelta: c.trendDelta ?? 0,
          revenue: c.revenue,
          revenueLabel:
            c.revenue != null
              ? formatMoney(
                  c.revenue,
                  resolveMarket(parseMarketSelection(c.market) ?? coerceMarketSelection(c.market)),
                )
              : undefined,
          status: c.health.displayStatus,
        })),
    [scoredRows],
  );

  const profileInitials = greetName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // ── Filtered clients ──────────────────────────────────────────────────────
  const filteredRows = clientRows.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // ── Playbook grid grouped by category ────────────────────────────────────
  const playbookByCategory: Record<string, PlaybookMeta[]> = {};
  for (const p of playbookCatalogue) {
    playbookByCategory[p.cat] = playbookByCategory[p.cat] ?? [];
    playbookByCategory[p.cat].push(p);
  }

  // ── Derived: op margin for a client ──────────────────────────────────────
  function opMarginStr(c: ClientRow): string {
    const f = c.financials;
    if (!f) return "—";
    const ebit = parseFloat(String(f.ebit ?? ""));
    const revenue = parseFloat(String(f.revenue ?? ""));
    if (!isFinite(ebit)) return "—";
    const market = resolveMarket(parseMarketSelection(c.market) ?? coerceMarketSelection(c.market));
    if (isFinite(revenue) && revenue > 0) {
      const pct = ((ebit / revenue) * 100).toFixed(1);
      return `${pct}% ${formatMoney(ebit, market)}`;
    }
    return formatMoney(ebit, market);
  }

  function runwayStr(c: ClientRow): string {
    if (c.runwayWeeks == null) return "—";
    const months = c.runwayWeeks / 4.345;
    if (months >= 1) return `${months.toFixed(1)} months`;
    return `${c.runwayWeeks} wk`;
  }

  function trendLabel(c: ClientRow): string {
    if (c.trendDelta == null) return "—";
    if (c.trendDelta === 0) return "Flat";
    return c.trendDelta > 0 ? `↑ ${c.trendDelta}` : `↓ ${Math.abs(c.trendDelta)}`;
  }

  const scrollToClients = () => {
    document.getElementById("clients-table")?.scrollIntoView({ behavior: "smooth" });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!portalReady) {
    return (
      <div
        className="accountant-portal"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}
      >
        <span style={{ color: "var(--ink-dim)" }}>Loading…</span>
      </div>
    );
  }

  return (
    <div className="accountant-portal">
      <WalkthroughWizard
        variant="accountant-dashboard"
        ready={!loading && !brandLoading && !firstClientOpen && clientRows.length > 0}
      />
      {/* Ambient background */}
      <div id="atmos">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>

      <div className="shell">
        {/* ===== TOP BAR ===== */}
        <div className="topbar">
          <span className="brand">
            <img src="/milon-wordmark.png" alt="Milōn" />
            <span className="gold-text">MILŌN</span>
          </span>
          <FirmSwitcher />
          <span className="spacer" />
          <button
            type="button"
            className="topbar-menu-btn"
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {mobileNavOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <>
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </>
              )}
            </svg>
          </button>
          <div className={`topbar-actions${mobileNavOpen ? " open" : ""}`}>
            <button
              id="wizard-dash-reports"
              className="tb-btn gold"
              onClick={() => {
                setMobileNavOpen(false);
                navigate({
                  to: "/reports",
                  search: {
                    client: undefined,
                    clientId: undefined,
                    report: undefined,
                    action: undefined,
                  },
                });
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <path d="M14 3v6h6" />
              </svg>
              Reports studio
            </button>
            {isItMember ? (
              <button
                className="tb-btn gold"
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  navigate({ to: "/ops", search: { tab: "it" } });
                }}
              >
                Milōn IT
              </button>
            ) : null}
            <button
              className="tb-btn"
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                navigate({ to: "/settings/team" });
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Team
            </button>
            <ThemeToggle />
            <button
              className="tb-btn"
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                navigate({ to: "/settings" });
              }}
            >
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
              </svg>
              Settings
            </button>
            <span className="profile-chip" title={profile.accountantName || user?.email || ""}>
              <span className="av">{profileInitials || "·"}</span>
              {greetName}
            </span>
            <button className="tb-btn" onClick={handleSignOut} title="Sign out">
              <svg viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </div>
        </div>

        {/* ===== GREETING ===== */}
        <div className="dash-hero">
          <div>
            <h1>{greeting}</h1>
            <p className="dash-summary">{summaryLine}</p>
          </div>
          <div className="dash-asof">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            Data as of {asOf}
          </div>
        </div>

        {/* ===== STATS STRIP ===== */}
        <div className="stats-strip" id="wizard-practice-board">
          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Clients
            </div>
            <div className="v">{loading ? "—" : clientRows.length}</div>
            <div className="stat-foot">
              <div className={`d ${addedThisMonth > 0 ? "up" : ""}`}>
                {addedThisMonth > 0 ? `+${addedThisMonth} this month` : "Active on platform"}
              </div>
              {sparkPts.length > 1 && (
                <SparkSvg points={sparkPts} className="stat-spark" width={72} height={22} />
              )}
            </div>
          </div>

          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Avg health
            </div>
            <div className="v">
              {loading || avgHealth == null ? "—" : avgHealth}
              {avgHealth != null && <small>/100</small>}
            </div>
            <div className="stat-foot">
              <div
                className={`d ${healthDelta != null && healthDelta > 0 ? "up" : healthDelta != null && healthDelta < 0 ? "warn" : ""}`}
              >
                {healthDelta == null
                  ? scoredRows.length
                    ? `Across ${scoredRows.length} scored`
                    : "No scored clients yet"
                  : `${healthDelta > 0 ? "↑" : healthDelta < 0 ? "↓" : "→"} ${Math.abs(healthDelta)} pts vs last month`}
              </div>
              {sparkPts.length > 1 && (
                <SparkSvg points={sparkPts} className="stat-spark" width={72} height={22} />
              )}
            </div>
          </div>

          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
              </svg>
              Need attention
            </div>
            <div className="v" style={{ color: atRiskCount ? "var(--risk)" : "var(--ok)" }}>
              {loading ? "—" : atRiskCount}
            </div>
            <div className="d warn">
              {atRiskCount === 0
                ? "All clear"
                : `${criticalCount} critical · ${Math.max(0, atRiskCount - criticalCount)} declining`}
            </div>
          </div>

          <button
            type="button"
            className="stat stat-btn"
            onClick={() =>
              document
                .getElementById("follow-up")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              Open actions
            </div>
            <div className="v">{loading ? "—" : openActionsTotal}</div>
            <div className="d">
              {actionsDueThisWeek > 0
                ? `${actionsDueThisWeek} overdue — follow up`
                : openActionsTotal > 0
                  ? "Across action plans — follow up"
                  : "No open actions"}
            </div>
          </button>
        </div>

        {/* ===== PORTFOLIO HEALTH + ATTENTION ===== */}
        <div className="portfolio-grid">
          <PortfolioHealthScatter
            clients={scatterClients}
            onSelect={(clientId) =>
              navigate({
                to: "/clients/$clientId",
                params: { clientId },
                search: {},
              })
            }
          />

          <div className="attn-panel">
            <div className="attn-head">
              <h2>Needs your attention</h2>
              <button type="button" className="linkish" onClick={scrollToClients}>
                View all →
              </button>
            </div>
            {attentionItems.length === 0 ? (
              <div className="attn-empty">
                {loading ? "Loading…" : "No clients need urgent attention — nice work."}
              </div>
            ) : (
              <div className="attn-list">
                {attentionItems.map((item) => (
                  <button
                    key={item.clientId}
                    type="button"
                    className={`attn-card ${item.severity}`}
                    onClick={() =>
                      item.openPlan
                        ? openClientPlan(item.clientId, item.detail.includes("overdue"))
                        : navigate({
                            to: "/clients/$clientId",
                            params: { clientId: item.clientId },
                            search: {},
                          })
                    }
                  >
                    <span className="rail" />
                    <div>
                      <span className="attn-name">{item.name}</span>
                      <span className="attn-sev">{item.severityLabel}</span>
                    </div>
                    <div className="attn-reason">{item.reason}</div>
                    <div className="attn-detail">{item.detail}</div>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn gold attn-cta" onClick={scrollToClients}>
              View all priorities
            </button>
          </div>
        </div>

        {/* ===== FOLLOW UP ON OUTSTANDING ACTIONS ===== */}
        <div className="followup-panel" id="follow-up">
          <div className="attn-head">
            <h2>Follow up</h2>
            <span className="followup-meta">
              {loading
                ? "Loading…"
                : followUpItems.length
                  ? `${followUpItems.length} client${followUpItems.length === 1 ? "" : "s"} with open Action Plan work`
                  : "Nothing outstanding"}
            </span>
          </div>
          {followUpItems.length === 0 ? (
            <p className="followup-empty">
              {loading
                ? "Checking action plans…"
                : "No overdue or open actions across the portfolio."}
            </p>
          ) : (
            <div className="followup-list">
              {followUpItems.map((item) => (
                <button
                  key={item.clientId}
                  type="button"
                  className="followup-row"
                  onClick={() => openClientPlan(item.clientId, item.overdueActions > 0)}
                >
                  <span className="followup-name">{item.name}</span>
                  <span className={`followup-count${item.overdueActions > 0 ? " overdue" : ""}`}>
                    {item.overdueActions > 0
                      ? `${item.overdueActions} overdue`
                      : `${item.openActions} open`}
                  </span>
                  <span className="followup-cta">Chase →</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ===== PORTFOLIO INSIGHTS ===== */}
        {insights.length > 0 && (
          <div className="insights-strip">
            <div className="insights-items">
              {insights.map((ins) => (
                <div key={ins.id} className={`insight ${ins.kind}`}>
                  <span className="ic">
                    {ins.kind === "trend" ? (
                      <svg viewBox="0 0 24 24">
                        <path d="M3 17l6-6 4 4 8-8" />
                        <path d="M14 7h7v7" />
                      </svg>
                    ) : ins.kind === "risk" ? (
                      <svg viewBox="0 0 24 24">
                        <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24">
                        <path d="M12 2l2.4 7.2H22l-6 4.8 2.3 7L12 16.8 5.7 21l2.3-7-6-4.8h7.6z" />
                      </svg>
                    )}
                  </span>
                  <p>{ins.text}</p>
                </div>
              ))}
            </div>
            <button type="button" className="insights-cta" onClick={scrollToClients}>
              View full insights →
            </button>
          </div>
        )}

        {/* ===== CLIENTS TABLE ===== */}
        <div className="clients-head" id="clients-table">
          <h2>Clients</h2>
          <div className="search">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              placeholder="Search clients…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <span className="spacer" />
          <button className="btn ghost mini" onClick={copyReferral}>
            <svg viewBox="0 0 24 24">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            Referral link
          </button>
          <button id="wizard-add-client" className="btn gold mini" onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add client
          </button>
        </div>

        {loading ? (
          <p className="sub" style={{ textAlign: "center", padding: "40px 0" }}>
            Loading clients…
          </p>
        ) : filteredRows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 16px" }}>
            {clientRows.length === 0 ? (
              <>
                <p className="sub" style={{ marginBottom: 8, fontSize: 15 }}>
                  Start with one practice client
                </p>
                <p
                  className="sub"
                  style={{ marginBottom: 20, maxWidth: 420, marginInline: "auto" }}
                >
                  Add a sandbox client, upload ~3 months of bank statements, and walk the full
                  advisory board once — then onboard your paying clients the same way.
                </p>
                <button className="btn gold" type="button" onClick={() => setFirstClientOpen(true)}>
                  Create practice demo client
                </button>
              </>
            ) : (
              <p className="sub">No clients match your search.</p>
            )}
          </div>
        ) : (
          <div className="ctable-scroll">
            <table className="ctable">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Health</th>
                  <th className="hide-sm">Trend (30d)</th>
                  <th className="hide-sm">Priority</th>
                  <th>Runway</th>
                  <th className="hide-sm">Queries</th>
                  <th className="hide-sm">Actions</th>
                  <th className="hide-sm">Op. profit (MTD)</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((c) => {
                  const chip = chipFromHealth(c.health);
                  const score = c.score != null ? Math.round(c.score) : null;
                  const qbo = qboStatuses[c.id];
                  return (
                    <tr
                      key={c.id}
                      className="row"
                      data-client-row
                      onClick={() =>
                        navigate({
                          to: "/clients/$clientId",
                          params: { clientId: c.id },
                          search: {},
                        })
                      }
                    >
                      <td>
                        <div className="cname">{c.name}</div>
                        <div className="ctype">
                          {c.client_code ? (
                            <>
                              <span
                                style={{
                                  fontFamily: "ui-monospace, monospace",
                                  letterSpacing: "0.04em",
                                }}
                              >
                                {c.client_code}
                              </span>
                              {c.business_type ? ` · ${c.business_type}` : ""}
                            </>
                          ) : (
                            (c.business_type ?? "—")
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="cell-health">
                          <span className="ring">
                            <RingSvg score={score} status={c.health.displayStatus} />
                            <b>{score ?? "—"}</b>
                          </span>
                        </div>
                      </td>
                      <td className="hide-sm">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <SparkSvg trend={c.trend} />
                          <span
                            className="num"
                            style={{
                              fontSize: 12,
                              color:
                                (c.trendDelta ?? 0) > 0
                                  ? "var(--ok)"
                                  : (c.trendDelta ?? 0) < 0
                                    ? "var(--risk)"
                                    : "var(--ink-dim)",
                            }}
                          >
                            {trendLabel(c)}
                          </span>
                        </div>
                      </td>
                      <td className="hide-sm">
                        <span className={`prio ${c.priority}`}>
                          <i />
                          {c.priorityLabel}
                        </span>
                      </td>
                      <td className="num">{runwayStr(c)}</td>
                      <td className="num hide-sm">
                        {c.openQueries > 0 ? (
                          <span title="Unresolved notes on this client">{c.openQueries}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num hide-sm">
                        {c.openActions > 0 ? (
                          <button
                            type="button"
                            className={`followup-cell${c.overdueActions > 0 ? " overdue" : ""}`}
                            title="Open Action Plan"
                            onClick={(e) => {
                              e.stopPropagation();
                              openClientPlan(c.id, c.overdueActions > 0);
                            }}
                          >
                            {c.overdueActions > 0
                              ? `${c.overdueActions} overdue`
                              : `${c.openActions} open`}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num hide-sm">{opMarginStr(c)}</td>
                      <td>
                        <span className={`chip ${chip.cls}`}>
                          <i />
                          {chip.label}
                        </span>
                        {qbo && (
                          <span
                            title={`QuickBooks${qbo.companyName ? ` — ${qbo.companyName}` : ""}`}
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              color: "#fff",
                              background: "#2CA01C",
                              padding: "2px 6px",
                              borderRadius: 4,
                              marginLeft: 6,
                            }}
                          >
                            QB
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                          {/* Reports */}
                          <button
                            className="icon-btn"
                            title="Generate report"
                            onClick={() =>
                              navigate({
                                to: "/clients/$clientId",
                                params: { clientId: c.id },
                                search: { tab: "reports" },
                              })
                            }
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                              <path d="M14 3v6h6" />
                            </svg>
                          </button>
                          {/* Invite */}
                          <button
                            className="icon-btn"
                            title="Invite client owner — email + copy message"
                            onClick={() => void openOwnerInvite(c)}
                          >
                            <svg viewBox="0 0 24 24">
                              <rect x="3" y="5" width="18" height="14" rx="2" />
                              <path d="M3 7l9 6 9-6" />
                            </svg>
                          </button>
                          <button
                            className="icon-btn"
                            title="Follow up on Action Plan"
                            onClick={() => openClientPlan(c.id, c.overdueActions > 0)}
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M9 11l3 3L22 4" />
                              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                            </svg>
                          </button>
                          {/* Open / Enter as client */}
                          <button
                            className="icon-btn"
                            title="Enter as client"
                            onClick={() => enterAsClient(c)}
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ===== PLAYBOOK LIBRARY ===== */}
        <div className="pb-section" id="playbooks">
          <span className="eyebrow">Playbook library — always at hand</span>
          <div className="h-sec">
            {playbookCatalogue.length} ratios. Every definition. Every fix.
          </div>
          <p className="sub" style={{ maxWidth: "62ch" }}>
            The same intelligence that powers your reports, available any time: what each ratio
            means, how it&apos;s calculated, and the highest-impact steps to repair it — ready to
            hand a client.
          </p>
          <div className="pb-grid">
            {Object.entries(playbookByCategory).map(([cat, items]) => (
              <Fragment key={cat}>
                <div className="pb-cat">{cat}</div>
                {items.map((p) => (
                  <button
                    key={p.ratioKey}
                    className="pb-card"
                    onClick={() => openDrawer(p.ratioKey, p.ratioName)}
                  >
                    <div className="t">
                      <b>{p.ratioName}</b>
                      <span className="chip warn">
                        <i />
                        Definition
                      </span>
                    </div>
                    <div className="bar">
                      <i style={{ width: "60%", background: "var(--gold)" }} />
                    </div>
                    <div className="m">
                      <span>{cat}</span>
                      <a>Definition &amp; steps →</a>
                    </div>
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="footer-note">
          MILŌN Practice Portal · <span className="serif gold-text">The passion to perform.</span>
        </div>
      </div>

      {/* ===== ADD CLIENT DIALOG ===== */}
      {user && (
        <AddClientDialog
          open={addOpen || firstClientOpen}
          onClose={() => {
            setAddOpen(false);
            if (firstClientOpen) {
              // Allow skip — don't block forever
              markOnboardingDone(ACCOUNTANT_FIRST_CLIENT_KEY);
              setFirstClientOpen(false);
            }
          }}
          onAdded={(created) => {
            markOnboardingDone(ACCOUNTANT_FIRST_CLIENT_KEY);
            const wasFirst = firstClientOpen;
            setFirstClientOpen(false);
            setAddOpen(false);
            void (async () => {
              await refreshFirms();
              void load(created.firm_id ?? firmId, user.id);
            })();
            if (wasFirst && created.id) {
              navigate({
                to: "/clients/$clientId",
                params: { clientId: created.id },
                search: { onboard: "1" },
              });
            }
          }}
          firmId={firm?.id ?? firmId}
          brandLoading={brandLoading}
          defaultName={firstClientOpen ? PRACTICE_TEST_CLIENT_NAME : ""}
          heading={firstClientOpen ? "Your first practice client" : "Add a client"}
          blurb={
            firstClientOpen
              ? "Use a sandbox client to learn the workflow — upload statements, check Business Health, then add real clients."
              : undefined
          }
        />
      )}

      {inviteDraft && (
        <InviteOwnerDialog
          draft={inviteDraft}
          sending={inviteSending}
          onClose={() => setInviteDraft(null)}
          onEmailChange={(email) => setInviteDraft((d) => (d ? { ...d, email } : d))}
          onCopy={() => void copyInviteDraft()}
          onSend={() => void sendInviteDraft()}
        />
      )}

      {/* ===== PLAYBOOK DRAWER ===== */}
      <PlaybookDrawer
        ratioKey={drawerRatioKey}
        ratioName={drawerRatioName}
        healthTier="at_risk"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isAccountant={true}
      />
    </div>
  );
}
