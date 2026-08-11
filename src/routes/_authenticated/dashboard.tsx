import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import {
  healthFromFlatFinancials,
  buildTrend,
  scoreTier,
  type TrendPoint,
  type OverallHealth,
} from "@/lib/health-score";
import { useServerFn } from "@tanstack/react-start";
import { getQboStatuses } from "@/lib/qbo.functions";
import { effectiveCashRunwayWeeks } from "@/lib/cash-runway";
import { countOpenQueriesByClient } from "@/lib/open-queries";
import "@/styles/accountant-portal.css";
import { ThemeToggle } from "@/components/theme-toggle";

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
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  open_queries_count: number;
  last_login_at: string | null;
  firm_id: string | null;
  financials: Record<string, string | number | null> | null;
  cashflow?: unknown;
  // reports_issued_count may not exist until migration runs
  reports_issued_count?: number | null;
};

type ClientRow = Client & {
  score: number | null;
  health: OverallHealth;
  trend: TrendPoint[];
  /** Resolved runway (persisted or derived from cashflow). */
  runwayWeeks: number | null;
  /** Unresolved notes count. */
  openQueries: number;
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
  const s = score ?? 50;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - s / 100);
  const tier = status ?? scoreTier(s);
  const col = tier === "healthy" ? "var(--ok)" : tier === "at_risk" ? "var(--warn)" : "var(--risk)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="tr" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} />
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
    </svg>
  );
}

/** Sparkline SVG from an 8-point trend */
function SparkSvg({ trend }: { trend: TrendPoint[] }) {
  const pts = trend.map((t) => t.score);
  if (pts.length === 0) return <svg className="spark" viewBox="0 0 84 26" />;
  const w = 84, h = 26;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const rg = max - min || 1;
  const step = w / Math.max(pts.length - 1, 1);
  const d = pts
    .map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)} ${(h - 3 - ((p - min) / rg) * (h - 6)).toFixed(1)}`)
    .join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`}>
      <path d={d} stroke={up ? "var(--ok)" : "var(--risk)"} />
    </svg>
  );
}

/** Partner tier from client count */
function partnerTier(count: number): string {
  if (count >= 40) return "Platinum";
  if (count >= 15) return "Gold";
  if (count >= 5) return "Silver";
  return "Starter";
}

// ── Add Client Dialog ─────────────────────────────────────────────────────────

function AddClientDialog({
  open,
  onClose,
  onAdded,
  firmId,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  firmId: string | null;
  userId: string;
}) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNewName("");
      setNewType("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const add = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("clients").insert({
      name: newName.trim(),
      owner_user_id: userId,
      firm_id: firmId ?? null,
      business_type: newType || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Client added");
    onAdded();
    onClose();
  };

  return (
    <>
      <div className="veil open" onClick={onClose} />
      <div className="drawer open" style={{ maxWidth: 420 }}>
        <div className="drawer-head">
          <div className="cat">New client</div>
          <h3>Add a client</h3>
          <button className="close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body" style={{ padding: "24px 30px" }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-dim)", display: "block", marginBottom: 6 }}>
              Business name *
            </label>
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--bg-2)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14 }}
              placeholder="e.g. Karoo Traders"
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-dim)", display: "block", marginBottom: 6 }}>
              Business type (optional)
            </label>
            <input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--bg-2)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14 }}
              placeholder="Services / Retail / SaaS…"
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
            <button className="btn gold" onClick={add} disabled={saving || !newName.trim()} style={{ flex: 1 }}>
              {saving ? "Saving…" : "Add client"}
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
  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const role = data?.role;
        if (role === "client_owner" || role === "client_member") {
          navigate({ to: "/app" });
        }
      });
  }, [user, navigate]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [firm, setFirm] = useState<Firm | null>(null);
  const [clientRows, setClientRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [qboStatuses, setQboStatuses] = useState<
    Record<string, { companyName: string | null; lastSyncedAt: string | null; syncStatus: string }>
  >({});
  const [playbookCatalogue, setPlaybookCatalogue] = useState<PlaybookMeta[]>([]);
  // playbook drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRatioKey, setDrawerRatioKey] = useState<string | null>(null);
  const [drawerRatioName, setDrawerRatioName] = useState("");

  // stats derived from client list
  const [reportsThisMonth, setReportsThisMonth] = useState(0);
  // Only known after mount — reading window.location.origin during render would
  // make the server-rendered HTML differ from the client's first render and
  // trigger a hydration mismatch.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const getStatuses = useServerFn(getQboStatuses);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);

    // Firm
    const { data: firms } = await supabase
      .from("firms")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1);
    const f = (firms?.[0] ?? null) as Firm | null;
    setFirm(f);

    // Clients — select all columns; reports_issued_count may not exist yet
    const { data: cs, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    const rawClients = (cs ?? []) as Client[];

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
    let historyMap: Record<string, { score: number; is_estimated: boolean }[]> = {};
    try {
      // NOTE: client_score_history is added by migration 20260802000000_score_history_and_reports_count.sql
      // which may not have run yet against the live database — query defensively.
      const { data: hist, error: histErr } = await supabase
        .from("client_score_history")
        .select("client_id, score, is_estimated")
        .in("client_id", rawClients.map((c) => c.id))
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
          historyMap[row.client_id].push({ score: row.score, is_estimated: row.is_estimated });
        }
      }
    } catch {
      // table doesn't exist — silently ignore
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
        realHistory.length > 0
          ? realHistory
          : score != null
          ? [{ score, is_estimated: true }]
          : [];
      const trend = buildTrend(trendHistory);
      return {
        ...c,
        score,
        health,
        trend,
        runwayWeeks,
        openQueries: openQueriesMap[c.id] ?? 0,
      };
    });

    setClientRows(rows);

    // Reports count — sum reports_issued_count if column exists (defensive)
    let totalReports = 0;
    try {
      totalReports = rawClients.reduce((s, c) => s + (c.reports_issued_count ?? 0), 0);
    } catch {
      totalReports = 0;
    }
    setReportsThisMonth(totalReports);

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (error) { toast.error(error.message); return; }
    sessionStorage.setItem("acting_as_client_id", c.id);
    sessionStorage.setItem("acting_as_client_name", c.name);
    navigate({ to: "/app" });
  };

  // ── Referral ──────────────────────────────────────────────────────────────
  // Origin is intentionally read only after mount (see `origin` state above) so the
  // server-rendered HTML and the first client render match — computing
  // `window.location.origin` inline during render caused a hydration mismatch.
  const referralUrl = firm?.referral_code ? `${origin}/auth?ref=${firm.referral_code}` : "";

  const copyReferral = () => {
    if (!referralUrl) { toast.error("No referral link yet"); return; }
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

  // ── Derived stats ─────────────────────────────────────────────────────────
  const avgHealth = clientRows.length
    ? Math.round(clientRows.reduce((s, c) => s + (c.score ?? 50), 0) / clientRows.length)
    : 0;
  const atRiskCount = clientRows.filter((c) => {
    const tier = scoreTier(c.score);
    return tier === "critical";
  }).length;
  const tier = partnerTier(clientRows.length);

  // ── Filtered clients ──────────────────────────────────────────────────────
  const filteredRows = clientRows.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
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
    if (isFinite(revenue) && revenue > 0) return `${((ebit / revenue) * 100).toFixed(1)}%`;
    return ebit.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
  }

  function runwayStr(c: ClientRow): string {
    if (c.runwayWeeks == null) return "—";
    return `${c.runwayWeeks} wk`;
  }

  // ── current month label ───────────────────────────────────────────────────
  const monthLabel = new Date().toLocaleString("en-ZA", { month: "short" });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="accountant-portal">
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
          <span className="firm-chip">
            Practice · <b>{firm?.name ?? "—"}</b>
          </span>
          <span className="spacer" />
          <button
            className="tb-btn gold"
            onClick={() => navigate({ to: "/reports", search: { client: undefined, clientId: undefined, report: undefined } })}
          >
            <svg viewBox="0 0 24 24">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M14 3v6h6" />
            </svg>
            Reports studio
          </button>
          <ThemeToggle />
          <button className="tb-btn" onClick={handleSignOut}>
            <svg viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>

        {/* ===== STATS STRIP ===== */}
        <div className="stats-strip">
          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Clients
            </div>
            <div className="v">{clientRows.length}</div>
            <div className="d up">Active on platform</div>
          </div>

          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Avg health
            </div>
            <div className="v">
              {loading ? "—" : avgHealth}
              <small>/100</small>
            </div>
            <div className="d">Across all clients</div>
          </div>

          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
              </svg>
              At risk
            </div>
            <div className="v" style={{ color: atRiskCount ? "var(--risk)" : "var(--ok)" }}>
              {loading ? "—" : atRiskCount}
            </div>
            <div className="d warn">Needs attention first</div>
          </div>

          <div className="stat">
            <div className="k">
              <svg viewBox="0 0 24 24">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" />
              </svg>
              Reports · {monthLabel}
            </div>
            <div className="v">{loading ? "—" : reportsThisMonth}</div>
            <div className="d">
              Partner tier: <b style={{ color: "var(--gold)" }}>{tier}</b> · 25% rev-share
            </div>
          </div>
        </div>

        {/* ===== REPORTS SPOTLIGHT ===== */}
        <div className="spotlight">
          <div className="card hero-card spot-copy">
            <span className="eyebrow">Your deliverable, spotlighted</span>
            <h2>
              Board-ready reports.
              <br />
              <span className="serif gold-text">Your brand on every page.</span>
            </h2>
            <p>
              Ten white-label reports per client — benchmarked ratios, cash forecasts and ranked
              action plans — generated in one click and branded to your practice. This is the
              advisory product your clients pay for.
            </p>
            <div className="spot-actions">
              <button
                className="btn gold"
                onClick={() => navigate({ to: "/reports", search: { client: undefined, clientId: undefined, report: undefined } })}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6" />
                </svg>
                Generate a report
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  document.getElementById("playbooks")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Browse playbooks
              </button>
            </div>
            <div className="spot-metrics">
              <div>
                <b>{loading ? "—" : reportsThisMonth}</b>
                <span>Reports this month</span>
              </div>
              <div>
                <b>10</b>
                <span>Templates per client</span>
              </div>
              <div>
                <b>{loading ? "—" : reportsThisMonth}</b>
                <span>Client downloads</span>
              </div>
            </div>
          </div>

          <div className="card report-fan">
            <div className="doc doc-1">
              <div className="dt">{firm?.name ?? "Practice"} · Milōn</div>
              <div className="dh">Cash Runway Report</div>
              <div className="ln" style={{ width: "88%" }} />
              <div className="ln" style={{ width: "70%" }} />
              <div className="bar"><i style={{ width: "64%" }} /></div>
              <div className="bar"><i style={{ width: "42%" }} /></div>
              <div className="ln" style={{ width: "80%" }} />
              <div className="ln" style={{ width: "56%" }} />
            </div>
            <div className="doc doc-2">
              <div className="dt">{firm?.name ?? "Practice"} · Milōn</div>
              <div className="dh">Business Health Report</div>
              <div className="ring" style={{ width: 40, height: 40, margin: "8px auto 4px" }}>
                <svg width="40" height="40" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(212,175,55,.15)" strokeWidth="4" />
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    fill="none"
                    stroke="#d4af37"
                    strokeWidth="4"
                    strokeDasharray="100.5"
                    strokeDashoffset={loading ? 37 : (100.5 * (1 - avgHealth / 100)).toFixed(1)}
                    strokeLinecap="round"
                    transform="rotate(-90 20 20)"
                  />
                </svg>
              </div>
              <div className="ln" style={{ width: "84%" }} />
              <div className="ln" style={{ width: "66%" }} />
              <div className="bar"><i style={{ width: `${avgHealth}%` }} /></div>
              <div className="ln" style={{ width: "74%" }} />
            </div>
            <div className="doc doc-3">
              <div className="dt">{firm?.name ?? "Practice"} · Milōn</div>
              <div className="dh">Ratio Benchmarks</div>
              <div className="bar"><i style={{ width: "62%" }} /></div>
              <div className="bar"><i style={{ width: "83%" }} /></div>
              <div className="bar"><i style={{ width: "38%" }} /></div>
              <div className="bar"><i style={{ width: "57%" }} /></div>
              <div className="ln" style={{ width: "76%" }} />
              <div className="ln" style={{ width: "52%" }} />
            </div>
            <span className="wl-chip">White-labelled · Your logo, your colours</span>
          </div>
        </div>

        {/* ===== CLIENTS TABLE ===== */}
        <div className="clients-head">
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
          <button className="btn gold mini" onClick={() => setAddOpen(true)}>
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
          <p className="sub" style={{ textAlign: "center", padding: "40px 0" }}>
            {clientRows.length === 0
              ? "No clients yet. Add your first client to start tracking."
              : "No clients match your search."}
          </p>
        ) : (
          <table className="ctable">
            <thead>
              <tr>
                <th>Client</th>
                <th>Health</th>
                <th className="hide-sm">Trend</th>
                <th>Runway</th>
                <th className="hide-sm">Queries</th>
                <th className="hide-sm">Op. profit</th>
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
                    onClick={() => navigate({ to: "/clients/$clientId", params: { clientId: c.id } })}
                  >
                    <td>
                      <div className="cname">{c.name}</div>
                      <div className="ctype">{c.business_type ?? "—"}</div>
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
                      <SparkSvg trend={c.trend} />
                    </td>
                    <td className="num">{runwayStr(c)}</td>
                    <td className="num hide-sm">
                      {c.openQueries > 0 ? (
                        <span title="Unresolved notes on this client">{c.openQueries}</span>
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
                            navigate({ to: "/reports", search: { client: c.name, clientId: c.id, report: undefined } })
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
                          title="Invite client"
                          onClick={() => {
                            const origin =
                              typeof window !== "undefined"
                                ? window.location.origin
                                : "https://milon.co.za";
                            const url = `${origin}/?invite=${c.id}&mode=signup`;
                            navigator.clipboard?.writeText(url);
                            toast.success("Invite link copied for " + c.name);
                          }}
                        >
                          <svg viewBox="0 0 24 24">
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path d="M3 7l9 6 9-6" />
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
                <div className="pb-cat">
                  {cat}
                </div>
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
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onAdded={load}
          firmId={firm?.id ?? null}
          userId={user.id}
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
