import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { PeriodPill } from "@/components/chrome-icons";
import { useEffect, useMemo, useState, useRef, Fragment } from "react";
import { reportClientError } from "@/lib/monitoring";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import {
  CLIENTS_LOAD_ERROR,
  OPEN_QUERIES_LOAD_ERROR,
  openQueriesPhase,
  practiceClientsPhase,
  settleWithin,
} from "@/lib/bounded-load";
import {
  forgetPaintedBook,
  readPaintedBook,
  rememberPaintedBook,
} from "@/lib/practice-book-cache";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import { PortfolioHealthScatter } from "@/components/portfolio-health-scatter";
import {
  shouldStayOnAccountantPortal,
  setPortalIntent,
  clearForcePortal,
  openPracticeSettings,
} from "@/lib/user-roles";
import {
  cashPillarFollowsForecast,
  scorecardHealthFromFinancials,
  scoreTier,
  type OverallHealth,
} from "@/lib/health-score";
import { periodMonthsOf } from "@/lib/ratios";
import { actionIsOverdue, actionOverdueInput } from "@/lib/action-plan-counts";
import {
  buildAttentionItems,
  buildFollowUpQueue,
  buildPortfolioInsights,
  dataAsOfLabel,
  firmOpenQueriesDestination,
  firstNameOf,
  practiceGreeting,
  needsAttentionView,
  practiceNeedsAttention,
  portfolioSummaryLine,
  revenueOf,
  trendColumnVisible,
  trendDelta30d,
  type ScoreHistoryPoint,
} from "@/lib/portfolio-dashboard";
import { useServerFn } from "@tanstack/react-start";
import { FIRM_TRIAL_SENTENCE } from "@/lib/stripe-plans";
import { createFirmClient, getFirmClientCreateAllowance } from "@/lib/firm-clients.functions";
import {
  idleStarterTrialBanner,
  showStarterTrialEndedCopy,
  type FirmClientCreateAllowance,
} from "@/lib/firm-client-cap";
import { browserAppOrigin } from "@/lib/app-origin";
import { FirmBandUpgrade, FirmStartHereBadge } from "@/components/firm-band-upgrade";
import { useFirmVoucherCheck } from "@/hooks/use-firm-voucher";
import { TrialEndedPlanBlock } from "@/components/trial-ended-plan-block";
import { FirmStarterTrialBanner } from "@/components/firm-starter-trial-banner";
import { STARTER_TRIAL_ENDED_MESSAGE } from "@/lib/firm-starter-trial";
import {
  UPGRADE_CANCELLED_MESSAGE,
  UPGRADE_FAILED_MESSAGE,
  parseFirmUpgradeReturn,
} from "@/lib/firm-band-upgrade";
import type { FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";
import {
  endFirmTrialNow,
  finalizeFirmBandCheckout,
  upgradeFirmBand,
} from "@/lib/stripe-checkout.functions";
import { inviteClientOwner, sendDraftedOwnerInvite } from "@/lib/client-invite.functions";
import { clientListRunwayCell, clientListRunwayHeadline, clientListStatusWord, statusColumnNeedsAttention } from "@/lib/cash-forecast-parity";
import { revealPracticeHash } from "@/lib/practice-section-hash";
import {
  assessClientMetrics,
  forecastIsCashGenerative,
  runwayDisplayLabel,
  storedOpeningIsMissing,
} from "@/lib/client-metrics";
import { parseOperatingProfile } from "@/lib/client-profile";
import { clientIndustryDisplay } from "@/lib/profile-signals";
import {
  IMPLAUSIBLE_SAMPLE_NOTE,
  operatingProfitColumnHeading,
  operatingProfitLabel,
  statementSampleImplausible,
} from "@/lib/operating-profit-display";
import { countOpenQueriesByClient, listOpenQueries, type OpenQueryRow } from "@/lib/open-queries";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsMenu } from "@/components/settings-menu";
import { FeatureFinder } from "@/components/feature-finder";
import { FirmSwitcher } from "@/components/firm-switcher";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { WalkthroughWizard } from "@/components/walkthrough-wizard";
import { OPEN_QUERIES_TILE_ID } from "@/lib/spotlight-hole";
import { CheckoutAfterInsight } from "@/components/checkout-after-insight";
import { markInsightSeen } from "@/lib/funnel-timing";
import { MarketPicker } from "@/components/market-picker";
import {
  clientMarketDraftFromFirm,
  coerceMarketSelection,
  draftToSelection,
  formatDate,
  formatMoney,
  isDraftComplete,
  marketForClient,
  marketForFirm,
  parseMarketSelection,
  resolveMarket,
  t,
  type DraftMarket,
} from "@/lib/market";
import {
  ACCOUNTANT_DASH_EMPTY_TOUR_KEY,
  ACCOUNTANT_FIRST_CLIENT_KEY,
  PRACTICE_TEST_CLIENT_NAME,
  markOnboardingDone,
} from "@/lib/onboarding";
import {
  DashboardSkeleton,
  EmptyState,
  MetricTile,
  PageHeader,
  ScrollableTable,
  SkeletonBlock,
  SkeletonTile,
} from "@/components/primitives";
import { PortfolioExceptions } from "@/components/portfolio-exceptions";
import { useFirmPortfolioRows } from "@/hooks/use-firm-portfolio";
import { AccountantInbox } from "@/components/accountant-inbox";
import { AccountantMenuButton, DrawerBackdrop, useAccountantDrawer } from "@/components/accountant-nav";
import { overlayMayHandleKey } from "@/lib/dialog-focus";
import { PracticeRail } from "@/components/practice-rail";
import { AgentWork } from "@/components/milon-team/agent-work";
import { practiceAgentWork } from "@/lib/agent-work";
import { useOverlayHistory } from "@/lib/overlay-history";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { practiceCardStatuses, practiceHomeLines } from "@/lib/owner-answers";
import { ownerPresence } from "@/lib/owner-presence";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { askAgentFromHash, askHashForAgent } from "@/lib/ask-agent";
import { PracticeAgentThread } from "@/components/practice-agent-thread";
import { clientHomeSearch } from "@/lib/client-home-search";
import { collapseDuplicateClientShells, loadClientDisplayNames } from "@/lib/client-display-name";
import { ChaseDraftDialog } from "@/components/chase-draft-dialog";
import type { ChaseDraftInput } from "@/lib/chase-draft";
import { KpiTrendline } from "@/components/kpi-trendline";

// ── Types ────────────────────────────────────────────────────────────────────

type Firm = { id: string; name: string; referral_code: string | null; owner_user_id: string };

type Client = {
  id: string;
  name: string;
  business_type: string | null;
  operating_profile?: unknown;
  client_code?: string | null;
  contact_email?: string | null;
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  last_login_at: string | null;
  firm_id: string | null;
  owner_user_id?: string | null;
  financials: Record<string, string | number | null> | null;
  financials_updated_at?: string | null;
  cashflow?: unknown;
  created_at?: string | null;
  // reports_issued_count may not exist until migration runs
  reports_issued_count?: number | null;
  market?: unknown;
};

type ClientRow = Client & {
  score: number | null;
  health: OverallHealth;
  /** ~30-day health delta from score history. The Practice chart holds the trend. */
  trendDelta: number | null;
  /** Dated scores already on file, oldest first. Empty when history has fewer than two points. */
  scoreSeries: number[];
  /** Open action titles already on the plan. Used only to draft a chase. */
  chaseActions: { title: string; overdue: boolean }[];
  /** Resolved runway (persisted or derived from cashflow). */
  runwayWeeks: number | null;
  /** Same label Overview prints, including Cash generative. */
  runwayLabel: string | null;
  /** Unresolved notes count. */
  openQueries: number;
  /** Open (not done) action-plan items. */
  openActions: number;
  /** Open actions past due_date, or past the plan target when they have no due date. */
  overdueActions: number;
  /** Revenue for scatter bubble sizing. */
  revenue: number | null;
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

function ClientStatusIcon({ tier }: { tier: "ok" | "warn" | "risk" | "neutral" }) {
  if (tier === "ok") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M5.2 8.2l1.8 1.8 3.8-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tier === "neutral") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5.5 8h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2l6 10.6H2L8 2.2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.2v3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
    </svg>
  );
}

/** Icon and word. No pill, and no ledger initials beside it. */
function ClientStatus({ health, label }: { health: OverallHealth; label: string }) {
  const tier =
    health.overall == null
      ? "neutral"
      : health.displayStatus === "healthy"
        ? "ok"
        : health.displayStatus === "critical"
          ? "risk"
          : "warn";
  return (
    <span className={`client-status ${tier}`}>
      <ClientStatusIcon tier={tier} />
      <span>{label}</span>
    </span>
  );
}

/** Chip from overall health — respects the critical-pillar tell. */
function chipFromHealth(health: OverallHealth): { cls: "ok" | "warn" | "risk"; label: string } {
  if (health.overall == null) return { cls: "ok", label: "—" };
  const tier = health.displayStatus;
  if (tier === "healthy") return { cls: "ok", label: health.displayLabel };
  if (tier === "at_risk") return { cls: "warn", label: health.displayLabel };
  return { cls: "risk", label: health.displayLabel };
}

/** SVG ring for a 0-100 score */
function RingSvg({
  score,
  status,
  size = 40,
  sw = 3.5,
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
    ? "var(--ink-faint, #5c7190)"
    : tier === "healthy"
      ? "var(--status-healthy, #16845b)"
      : tier === "at_risk"
        ? "var(--status-attention, #b7791f)"
        : "var(--status-critical, #c43d4b)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        className="tr"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--pale, #dbeafe)"
        strokeWidth={sw}
      />
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

// ── Add Client Dialog ─────────────────────────────────────────────────────────

function FirmClientCapNotice({
  cap,
  firmId,
  upgrading,
  confirmUpgrade,
  onConfirm,
  onEndTrial,
  onCancelConfirm,
  onUpgradeBand,
}: {
  cap: Extract<FirmClientCreateAllowance, { allowed: false }>;
  firmId: string | null;
  upgrading: boolean;
  confirmUpgrade: boolean;
  onConfirm: () => void;
  onEndTrial: () => void;
  onCancelConfirm: () => void;
  onUpgradeBand: (
    band: FirmCheckoutBand,
    interval: FirmInterval,
    voucherCode?: string | null,
  ) => void;
}) {
  const onValidateVoucher = useFirmVoucherCheck(firmId);
  const currentPlan = cap.upgrade?.phase === "active";
  if (cap.code === "starter_trial_ended" && !currentPlan) {
    return (
      <TrialEndedPlanBlock
        firmId={firmId}
        upgrading={upgrading}
        upgrade={
          cap.upgrade
            ? {
                band: cap.upgrade.band,
                interval: cap.upgrade.interval,
                priceCurrency: cap.upgrade.priceCurrency,
                zarByBand: cap.upgrade.zarByBand,
                canUpgrade: cap.upgrade.canUpgrade,
                clientCount: cap.upgrade.clientCount,
                usageLabel: cap.upgrade.usageLabel,
                saDiscount: cap.upgrade.saDiscount,
                phase: cap.upgrade.phase,
              }
            : null
        }
        onUpgrade={onUpgradeBand}
      />
    );
  }
  const limitMessage =
    currentPlan &&
    cap.upgrade?.band === "starter" &&
    cap.code !== "band_client_cap" &&
    cap.code !== "trial_client_cap"
      ? "You can't add another client on Starter."
      : cap.message;
  const upgrade = cap.upgrade;
  return (
    <div role="alert">
      <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
        {cap.code === "trial_client_cap" ? "Trial client limit" : "Plan client limit"}
      </p>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.55 }}>
        {limitMessage}
      </p>
      {cap.canEndTrial && confirmUpgrade ? (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink)", lineHeight: 1.55 }}>
          This charges the card on file today and ends the {FIRM_TRIAL_SENTENCE} on Starter. The paid
          band’s client limit applies after that.
        </p>
      ) : null}
      {cap.canEndTrial ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {confirmUpgrade ? (
            <>
              <button className="btn gold" type="button" onClick={onEndTrial} disabled={upgrading}>
                {upgrading ? "Starting paid plan…" : "Start paid plan now"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={onCancelConfirm}
                disabled={upgrading}
              >
                Back
              </button>
            </>
          ) : (
            <button className="btn gold" type="button" onClick={onConfirm} disabled={upgrading}>
              Upgrade to paid plan
            </button>
          )}
        </div>
      ) : null}
      {upgrade ? (
        <FirmBandUpgrade
          currentBand={upgrade.band}
          interval={upgrade.interval}
          priceCurrency={upgrade.priceCurrency}
          zarByBand={upgrade.zarByBand}
          canUpgrade={upgrade.canUpgrade}
          clientCount={upgrade.clientCount}
          usageLabel={upgrade.usageLabel}
          saDiscount={upgrade.saDiscount}
          zaLabels={upgrade.zaLabels}
          upgrading={upgrading}
          onUpgrade={onUpgradeBand}
          onValidateVoucher={onValidateVoucher}
        />
      ) : !cap.canEndTrial ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.55 }}>
          Ask your firm owner to upgrade
        </p>
      ) : null}
    </div>
  );
}

function AddClientDialog({
  open,
  onClose,
  onAdded,
  firmId,
  firmMarket,
  brandLoading = false,
  defaultName = "",
  heading = "Add a client",
  blurb,
  sandboxName,
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
  /** Saved practice market. When set, the country/currency starts there (ZAR for ZA). */
  firmMarket?: unknown;
  brandLoading?: boolean;
  defaultName?: string;
  heading?: string;
  blurb?: string;
  /** When set, offers a one-click sandbox name for practices without a client's statements to hand. */
  sandboxName?: string;
}) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftMarket, setDraftMarket] = useState<DraftMarket>(() =>
    clientMarketDraftFromFirm(firmMarket),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const createClient = useServerFn(createFirmClient);
  const inviteOwner = useServerFn(inviteClientOwner);
  const checkCap = useServerFn(getFirmClientCreateAllowance);
  const endTrial = useServerFn(endFirmTrialNow);
  const upgradeBand = useServerFn(upgradeFirmBand);
  const [cap, setCap] = useState<FirmClientCreateAllowance | null>(null);
  const [confirmUpgrade, setConfirmUpgrade] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const closeDrawer = useOverlayHistory(open, onClose);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNewName(defaultName);
    setNewType("");
    setOwnerEmail("");
    setDraftMarket(clientMarketDraftFromFirm(firmMarket));
    // Firm row already carries market. Fetch only when that value was not loaded.
    if (firmMarket == null && firmId) {
      void supabase
        .from("firms")
        .select("market")
        .eq("id", firmId)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          setDraftMarket(clientMarketDraftFromFirm((data as { market?: unknown } | null)?.market));
        });
    }
    const focus = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      cancelled = true;
      clearTimeout(focus);
    };
  }, [open, defaultName, firmId, firmMarket]);

  useEffect(() => {
    if (!open) {
      setCap(null);
      setConfirmUpgrade(false);
      return;
    }
    if (!firmId) {
      setCap({ allowed: true, canEndTrial: false, starterTrial: idleStarterTrialBanner() });
      return;
    }
    setCap(null);
    let cancelled = false;
    void checkCap({ data: { firmId } })
      .then((result) => {
        if (!cancelled) setCap(result);
      })
      .catch(() => {
        if (!cancelled) {
          setCap({ allowed: true, canEndTrial: false, starterTrial: idleStarterTrialBanner() });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, firmId, checkCap]);

  const refreshCap = async () => {
    if (!firmId) {
      setCap({ allowed: true, canEndTrial: false, starterTrial: idleStarterTrialBanner() });
      return;
    }
    const result = await checkCap({ data: { firmId } });
    setCap(result);
  };

  if (!open) return null;

  const add = async () => {
    if (!newName.trim()) {
      toast.error("Enter a business name");
      return;
    }
    const email = ownerEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email for client management, or leave it blank");
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
      const message = err instanceof Error ? err.message : "Could not add client";
      const trialEnded = message.includes("Your trial has ended");
      const trialCap = message.includes("14-day free trial");
      const bandCap =
        message.includes("Upgrade to a larger band") || message.includes("Upgrade to Solo");
      if (trialEnded || trialCap || bandCap) {
        try {
          await refreshCap();
        } catch {
          setCap({
            allowed: false,
            code: trialEnded
              ? "starter_trial_ended"
              : trialCap
                ? "trial_client_cap"
                : "band_client_cap",
            message,
            bandName: null,
            canEndTrial: false,
            starterTrial: idleStarterTrialBanner(),
          });
        }
        setCap((current) =>
          current && !current.allowed
            ? current
            : {
                allowed: false,
                code: trialEnded
                  ? "starter_trial_ended"
                  : trialCap
                    ? "trial_client_cap"
                    : "band_client_cap",
                message,
                bandName: null,
                canEndTrial: false,
                starterTrial: idleStarterTrialBanner(),
              },
        );
        return;
      }
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="veil open" onClick={closeDrawer} />
      <div className="drawer open" style={{ maxWidth: 420 }}>
        <div className="drawer-head">
          <button type="button" className="client-subpage-back" onClick={closeDrawer}>
            Back
          </button>
          <div className="cat">New client</div>
          <h3>{heading}</h3>
          <button className="close" onClick={closeDrawer} aria-label="Back">
            ✕
          </button>
        </div>
        <div className="drawer-body" style={{ padding: "24px 30px" }}>
          {firmId && !cap ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>Checking your plan…</p>
          ) : cap && !cap.allowed ? (
            <FirmClientCapNotice
              cap={cap}
              firmId={firmId}
              upgrading={upgrading}
              confirmUpgrade={confirmUpgrade}
              onConfirm={() => setConfirmUpgrade(true)}
              onCancelConfirm={() => setConfirmUpgrade(false)}
              onEndTrial={() => {
                setUpgrading(true);
                void endTrial()
                  .then(async () => {
                    toast.success("Paid plan started. You can add another client.");
                    setConfirmUpgrade(false);
                    await refreshCap();
                  })
                  .catch((err: unknown) => {
                    toast.error(
                      err instanceof Error ? err.message : "Could not start the paid plan.",
                    );
                  })
                  .finally(() => setUpgrading(false));
              }}
              onUpgradeBand={(band, interval, voucherCode) => {
                if (!firmId) return;
                setUpgrading(true);
                void upgradeBand({
                  data: { firmId, band, interval, voucherCode: voucherCode?.trim() || undefined },
                })
                  .then(async (result) => {
                    if (result.kind === "checkout") {
                      window.location.href = result.url;
                      return;
                    }
                    toast.success(result.message);
                    setConfirmUpgrade(false);
                    await refreshCap();
                  })
                  .catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : UPGRADE_FAILED_MESSAGE);
                  })
                  .finally(() => setUpgrading(false));
              }}
            />
          ) : (
            <>
              {cap?.upgrade?.usageLabel ? (
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-dim)" }}>
                  {cap.upgrade.usageLabel}
                </p>
              ) : null}
              {blurb && (
                <p
                  style={{
                    marginBottom: 16,
                    fontSize: 13,
                    color: "var(--ink-dim)",
                    lineHeight: 1.55,
                  }}
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
                {sandboxName && newName.trim() !== sandboxName && (
                  <button
                    type="button"
                    onClick={() => setNewName(sandboxName)}
                    style={{
                      marginTop: 8,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--ink-dim)",
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                      fontFamily: "inherit",
                    }}
                  >
                    No statements to hand? Use a sandbox client — “{sandboxName}”
                  </button>
                )}
              </div>
              <div style={{ marginBottom: 24 }}>
                <MarketPicker
                  value={draftMarket}
                  onChange={setDraftMarket}
                  variant="app"
                  audience="practice"
                />
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    lineHeight: 1.45,
                  }}
                >
                  {draftMarket.country === "US"
                    ? "Currency: US dollars (USD). Change the country if this client is not in the United States."
                    : "Currency: rand (ZAR). Change the country if this client is not in South Africa."}
                </p>
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
                  Client management email (optional)
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
                  placeholder="you@business.com"
                />
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    lineHeight: 1.45,
                  }}
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
            </>
          )}
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
  /** Set when Send can deliver. Hidden when sending is not configured. */
  from: string | null;
};

function InviteOwnerDialog({
  draft,
  sending,
  emailPlaceholder,
  onClose,
  onEmailChange,
  onCopy,
  onSend,
}: {
  draft: InviteDraftUi;
  sending: boolean;
  emailPlaceholder: string;
  onClose: () => void;
  onEmailChange: (email: string) => void;
  onCopy: () => void;
  onSend: () => void;
}) {
  const closeDrawer = useOverlayHistory(true, onClose);
  return (
    <>
      <div className="veil open" onClick={closeDrawer} />
      <div className="drawer open" style={{ maxWidth: 480 }}>
        <div className="drawer-head">
          <button type="button" className="client-subpage-back" onClick={closeDrawer}>
            Back
          </button>
          <div className="cat">Invite client management</div>
          <h3>{draft.clientName}</h3>
          <button className="close" onClick={closeDrawer} aria-label="Back">
            ✕
          </button>
        </div>
        <div className="drawer-body" style={{ padding: "24px 30px" }}>
          {draft.emailed ? (
            <p style={{ marginBottom: 14, fontSize: 13, color: "var(--ok)", lineHeight: 1.55 }}>
              Invite emailed to {draft.email}. Copy the message below if you want to forward it.
            </p>
          ) : (
            <p
              style={{ marginBottom: 14, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.55 }}
            >
              {draft.sendError
                ? `Could not send (${draft.sendError}). Copy the message or try again.`
                : draft.email.trim()
                  ? "Review the message, then send it or copy it."
                  : "Add client management's email to send, or copy the message into your own email."}
            </p>
          )}
          {draft.from ? (
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--ink)", lineHeight: 1.55 }}>
              From {draft.from}
            </p>
          ) : null}
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
              Client management email
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
              placeholder={emailPlaceholder}
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
              disabled={sending || !draft.email.trim() || !draft.from}
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

function latestStoredScore(history: ScoreHistoryPoint[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const score = history[i]?.score;
    if (typeof score === "number" && Number.isFinite(score)) return score;
  }
  return null;
}

const UNSCORED_HEALTH: OverallHealth = {
  overall: null,
  status: "at_risk",
  displayStatus: "at_risk",
  displayLabel: "Watch",
  pillars: [],
  weakestPillar: null,
  hasCriticalPillar: false,
};

/** First paint. Runway and health fill in once the books and the plan load. */
function lightClientRow(c: Client): ClientRow {
  return {
    ...c,
    financials: c.financials ?? null,
    score: null,
    health: UNSCORED_HEALTH,
    trendDelta: null,
    scoreSeries: [],
    chaseActions: [],
    runwayWeeks: c.cash_runway_weeks,
    runwayLabel: null,
    openQueries: 0,
    openActions: 0,
    overdueActions: 0,
    revenue: null,
  };
}

/** One book row. A scoring throw still leaves the client on the list. */
function toClientRow(
  c: Client,
  history: ScoreHistoryPoint[],
  openActions: number,
  overdueActions: number,
  openQueries: number,
  chaseActions: { title: string; overdue: boolean }[] = [],
): ClientRow {
  try {
    const clientMarket = resolveMarket(
      parseMarketSelection(c.market) ?? coerceMarketSelection(c.market),
    );
    const assessed = assessClientMetrics({
      financials: c.financials,
      cashflow: c.cashflow,
      financialsUpdatedAt: c.financials_updated_at ?? null,
      timeZone: clientMarket.timezone,
    });
    const runwayWeeks =
      assessed.runway.kind === "weeks" || assessed.runway.kind === "zero"
        ? assessed.runway.weeks
        : null;
    const outlook = assessed.outlook;
    const fyStartMonth =
      parseOperatingProfile(c.operating_profile)?.fyStartMonth ?? clientMarket.fyStartMonthDefault;
    const openingMissing = storedOpeningIsMissing(c.cashflow);
    const scored = cashPillarFollowsForecast(
      scorecardHealthFromFinancials({
        financials: c.financials,
        fyStartMonth,
        periodMonths: periodMonthsOf(c.financials),
        cashRunwayWeeks: runwayWeeks,
        market: clientMarket,
        shortfallWeek: assessed.outlook.shortfallWeek,
      }),
      {
        openingMissing,
        opening: outlook.opening,
        closings: outlook.closing,
        floor: outlook.floor,
      },
    );
    const statusWord = clientListStatusWord({
      healthLabel: scored.displayLabel,
      healthOverall: scored.overall,
      source: outlook.source,
      opening: outlook.opening,
      floor: outlook.floor,
      dipsBelowFloorWeek: outlook.dipsBelowFloorWeek,
      totalInflow: outlook.totalInflow,
      totalOutflow: outlook.totalOutflow,
      openingMissing,
    });
    const health = statusWord.startsWith("Critical")
      ? { ...scored, displayStatus: "critical" as const, displayLabel: statusWord }
      : statusWord.startsWith("Needs data")
        ? { ...scored, displayStatus: "at_risk" as const, displayLabel: statusWord }
        : scored;
    const runwayLabel = clientListRunwayHeadline({
      source: outlook.source,
      opening: outlook.opening,
      closings: outlook.closing,
      floor: outlook.floor,
      totalInflow: outlook.totalInflow,
      totalOutflow: outlook.totalOutflow,
      runwayLabel: runwayDisplayLabel(assessed.runway),
      cashGenerative:
        assessed.runway.kind === "cash_generative" &&
        forecastIsCashGenerative(outlook.totalInflow, outlook.totalOutflow),
      healthOverall: scored.overall,
      openingMissing,
    });
    return {
      ...c,
      score: health.overall ?? latestStoredScore(history),
      health,
      trendDelta: trendDelta30d(history, health.overall),
      scoreSeries: history.map((point) => point.score).filter((score) => Number.isFinite(score)),
      chaseActions,
      runwayWeeks,
      runwayLabel,
      openQueries,
      openActions,
      overdueActions,
      revenue: revenueOf(c.financials),
    };
  } catch (err) {
    console.error("client row:", c.id, err);
    return {
      ...c,
      score: null,
      health: UNSCORED_HEALTH,
      trendDelta: null,
      scoreSeries: [],
      chaseActions,
      runwayWeeks: null,
      runwayLabel: null,
      openQueries,
      openActions,
      overdueActions,
      revenue: null,
    };
  }
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

const PRACTICE_SECTION_TITLES = {
  "needs-attention": "Needs attention",
  "follow-up": "Follow up",
  insights: "Insights",
  marketplace: "Marketplace",
  playbooks: "Playbooks",
} as const;

type PracticeSection = keyof typeof PRACTICE_SECTION_TITLES;

export type PracticeView = "home" | "clients" | "practice" | "queries" | PracticeSection;

function isPracticeSection(view: PracticeView): view is PracticeSection {
  return Object.prototype.hasOwnProperty.call(PRACTICE_SECTION_TITLES, view);
}

function practiceSectionSubtitle(view: PracticeSection): string {
  if (view === "needs-attention") return "Health alerts and pack sign-off across the book.";
  if (view === "follow-up") return "Clients with open Action Plan work.";
  if (view === "insights") return "Health score against the stored 30-day trend.";
  if (view === "marketplace") return "Inbox for the practice.";
  return "Definitions and the highest-impact repair steps.";
}

/** A stay that already succeeded. Remounting All clients must not wait on it again. */
const accountantPortalStay = new Set<string>();

export function PracticeBoard({ view }: { view: PracticeView }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const practiceHash = useRouterState({ select: (s) => s.location.hash });
  const practiceAgent = askAgentFromHash(practiceHash);

  // ── Role guard ────────────────────────────────────────────────────────────
  // Business-client credentials must not sit on the practice portal. Wait for
  // the stay check before painting the board so we never flash firm UI or
  // trigger add-client against an owner login.
  const portalUserId = user?.id ?? null;
  const [portalReady, setPortalReady] = useState(
    () => portalUserId != null && accountantPortalStay.has(portalUserId),
  );
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (!portalUserId) return;
    if (accountantPortalStay.has(portalUserId)) {
      setPortalReady(true);
      return;
    }
    let cancelled = false;
    setPortalReady(false);
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      console.warn(
        "[practice-board] role check timed out; opening the board. An owner session still redirects to /app when the check finishes.",
      );
      reportClientError(new Error("practice portal role check timed out"), {
        source: "practice-board",
      });
      setPortalReady(true);
    }, SHELL_GATE_TIMEOUT_MS);
    void shouldStayOnAccountantPortal(portalUserId).then((stay) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      if (stay) {
        accountantPortalStay.add(portalUserId);
        setPortalIntent("accountant");
        clearForcePortal();
        setPortalReady(true);
        return;
      }
      clearForcePortal();
      setPortalIntent("owner");
      navigateRef.current({ to: "/app" });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [portalUserId]);

  const { firmId, firms, brandLoading, profile, refreshFirms, greetingSource, firmMarket } =
    useAccountantProfile();
  const practiceCountry = marketForFirm({ market: firmMarket }).country;
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
  const warmBook = readPaintedBook<ClientRow>(user?.id, firmId);
  const [clientRows, setClientRows] = useState<ClientRow[]>(() => warmBook ?? []);
  const [loading, setLoading] = useState(() => warmBook == null);
  /** Open queries and follow-ups stay on a loading state until enrichment lands. */
  const [countsReady, setCountsReady] = useState(() => warmBook != null);
  /** Set only after the enriched rows land. A warm paint and the shell timer must not set this. */
  const [bookEnriched, setBookEnriched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const finalizeUpgrade = useServerFn(finalizeFirmBandCheckout);
  const loadTrialAllowance = useServerFn(getFirmClientCreateAllowance);
  const [trialAllowance, setTrialAllowance] = useState<FirmClientCreateAllowance | null>(null);
  const [trialNonce, setTrialNonce] = useState(0);
  const upgradeReturnHandled = useRef(false);
  useEffect(() => {
    if (!user || upgradeReturnHandled.current || typeof window === "undefined") return;
    const parsed = parseFirmUpgradeReturn(window.location.search);
    if (!parsed.reopenAddClient && !parsed.outcome) return;
    upgradeReturnHandled.current = true;
    const openForm = () => {
      if (parsed.reopenAddClient) setAddOpen(true);
    };
    if (parsed.outcome === "cancelled") {
      const params = new URLSearchParams(window.location.search);
      params.set("addClient", "1");
      params.set("upgrade", "cancelled");
      params.delete("session_id");
      const next = params.toString();
      window.history.replaceState(null, "", `/dashboard?${next}`);
      toast.message(UPGRADE_CANCELLED_MESSAGE);
      openForm();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("addClient");
    params.delete("upgrade");
    params.delete("session_id");
    const next = params.toString();
    window.history.replaceState(null, "", next ? `/dashboard?${next}` : "/dashboard");
    if (parsed.outcome === "failed") {
      toast.error(UPGRADE_FAILED_MESSAGE);
      openForm();
      return;
    }
    if (parsed.outcome === "success" && parsed.sessionId) {
      void finalizeUpgrade({ data: { sessionId: parsed.sessionId } })
        .then((result) => {
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : UPGRADE_FAILED_MESSAGE);
        })
        .finally(() => {
          setTrialNonce((n) => n + 1);
          openForm();
        });
      return;
    }
    if (parsed.outcome === "success") {
      toast.success("Plan updated. You can add another client.");
      setTrialNonce((n) => n + 1);
    }
    openForm();
  }, [user, finalizeUpgrade]);
  useEffect(() => {
    if (!portalReady || !firmId) {
      setTrialAllowance(null);
      return;
    }
    let cancelled = false;
    void loadTrialAllowance({ data: { firmId } })
      .then((next) => {
        if (!cancelled) setTrialAllowance(next);
      })
      .catch(() => {
        if (!cancelled) setTrialAllowance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [portalReady, firmId, loadTrialAllowance, trialNonce]);
  const [firstClientOpen, setFirstClientOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraftUi | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [playbookCatalogue, setPlaybookCatalogue] = useState<PlaybookMeta[]>([]);
  // playbook drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRatioKey, setDrawerRatioKey] = useState<string | null>(null);
  const [drawerRatioName, setDrawerRatioName] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const routeHref = useRouterState({ select: (s) => s.location.href });
  useEffect(() => {
    setMobileNavOpen(false);
  }, [routeHref]);
  const [queryRows, setQueryRows] = useState<OpenQueryRow[]>([]);
  const [queryRowsReady, setQueryRowsReady] = useState(false);
  const [bookTimedOut, setBookTimedOut] = useState(false);
  const [queriesTimedOut, setQueriesTimedOut] = useState(false);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!mobileNavOpen) return;
      if (!overlayMayHandleKey(event)) return;
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);
  useAccountantDrawer(mobileNavOpen, () => setMobileNavOpen(false));
  const [isItMember, setIsItMember] = useState(false);

  // Only known after mount — reading window.location.origin during render would
  // make the server-rendered HTML differ from the client's first render and
  // trigger a hydration mismatch.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(browserAppOrigin());
  }, []);

  const mintInvite = useServerFn(inviteClientOwner);
  const sendDraftedInvite = useServerFn(sendDraftedOwnerInvite);
  const loadGen = useRef(0);

  // ── Load ──────────────────────────────────────────────────────────────────
  const [chaseDraft, setChaseDraft] = useState<ChaseDraftInput | null>(null);
  const openChase = (clientId: string, clientName: string) => {
    const row = clientRows.find((client) => client.id === clientId);
    setChaseDraft({
      clientName,
      firmName: firm?.name ?? null,
      actions: row?.chaseActions ?? [],
    });
  };

  const load = async (activeFirmId: string | null, userId: string | undefined, viewerName?: string | null) => {
    const gen = ++loadGen.current;
    setBookEnriched(false);
    const warm = readPaintedBook<ClientRow>(userId, activeFirmId);
    if (warm) {
      setClientRows(warm);
      setLoading(false);
    } else {
      setLoading(true);
      setCountsReady(false);
    }
    try {

    if (!userId) {
      setClientRows([]);
      setIsItMember(false);
      setCountsReady(true);
      setBookEnriched(true);
      setBookTimedOut(false);
      setLoading(false);
      return;
    }

    // The IT flag and the client select used to be bare awaits. A hung
    // PostgREST call never reached setLoading(false), and the open-queries
    // effect refused to arm its own deadline while `loading` stayed true.
    const slim = await settleWithin(
      (async () => {
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

        // Firm-scoped list + legacy orphans (firm_id null) owned by this accountant.
        // Strict firm_id-only filtering hid pre-G27 clients and made the dashboard look empty.
        // IT members have master access — list every client they can read.
        const listColumns =
          "id, name, business_type, operating_profile, client_code, contact_email, cash_runway_weeks, last_forecast_at, last_login_at, firm_id, owner_user_id, financials_updated_at, created_at, reports_issued_count, market";
        let query = supabase.from("clients").select(listColumns).order("created_at", { ascending: false });
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
        return { isIt, cs, error };
      })(),
      SHELL_GATE_TIMEOUT_MS,
    );
    if (gen !== loadGen.current) return;
    if (slim.status !== "value") {
      setBookTimedOut(true);
      return;
    }
    setBookTimedOut(false);
    const { isIt, cs, error } = slim.value;
    setIsItMember(isIt);
    if (error) toast.error(error.message);
    let rawClients = collapseDuplicateClientShells((cs ?? []) as Client[]);
    const clientIds = rawClients.map((c) => c.id);

    // Names, books, and orphan attaches used to run before the first paint,
    // and each row then built a 13-week forecast. The list paints from the
    // slim columns; those three continue together with history and actions.
    const namesPromise = loadClientDisplayNames(supabase as never, rawClients, viewerName).catch(
      () => new Map<string, string>(),
    );
    const figuresPromise = clientIds.length
      ? supabase.from("clients").select("id, financials, cashflow").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; financials: Client["financials"]; cashflow: unknown }[], error: null });
    const orphanIds =
      !isIt && activeFirmId ? rawClients.filter((c) => !c.firm_id).map((c) => c.id) : [];
    const orphansPromise = Promise.all(
      orphanIds.map(async (id) => {
        const { error: attachErr } = await supabase.rpc(
          "link_own_client_to_firm" as never,
          { p_client_id: id, p_firm_id: activeFirmId } as never,
        );
        return attachErr ? null : id;
      }),
    );

    if (gen !== loadGen.current) return;
    const lightRows = rawClients.map((c) => lightClientRow(c));
    setClientRows(rawClients.map((c) => lightClientRow(c)));
    rememberPaintedBook(userId, activeFirmId, lightRows);
    if (rawClients.length === 0) setCountsReady(true);
    setLoading(false);

    const historyPromise = (async () => {
      const historyMap: Record<string, ScoreHistoryPoint[]> = {};
      if (clientIds.length === 0) return historyMap;
      try {
        const { data: hist, error: histErr } = await supabase
          .from("client_score_history")
          .select("client_id, score, is_estimated, period_date")
          .in("client_id", clientIds)
          .order("period_date", { ascending: true });
        if (histErr) {
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
      return historyMap;
    })();

    const actionsPromise = (async () => {
      const openActionsMap: Record<string, number> = {};
      const overdueActionsMap: Record<string, number> = {};
      const chaseActionsMap: Record<string, { title: string; overdue: boolean }[]> = {};
      if (clientIds.length === 0) return { openActionsMap, overdueActionsMap, chaseActionsMap };
      try {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const [{ data: actions, error: actErr }, { data: plans }] = await Promise.all([
          supabase
            .from("action_items")
            .select("client_id, status, due_date, created_at, title")
            .in("client_id", clientIds)
            .neq("status", "done"),
          supabase
            .from("action_plans")
            .select("client_id, target_date")
            .in("client_id", clientIds)
            .eq("is_active", true),
        ]);
        const targetByClient = new Map<string, string>();
        for (const plan of plans ?? []) {
          if (!targetByClient.has(plan.client_id)) targetByClient.set(plan.client_id, plan.target_date);
        }
        if (!actErr && actions) {
          for (const a of actions) {
            openActionsMap[a.client_id] = (openActionsMap[a.client_id] ?? 0) + 1;
            const overdue = actionIsOverdue(
              actionOverdueInput(
                {
                  status: a.status,
                  dueDate: a.due_date,
                  createdAt: a.created_at,
                  planTarget: targetByClient.get(a.client_id) ?? null,
                },
                today,
              ),
              today,
            );
            if (overdue) {
              overdueActionsMap[a.client_id] = (overdueActionsMap[a.client_id] ?? 0) + 1;
            }
            const title = typeof a.title === "string" ? a.title.trim() : "";
            if (title) {
              chaseActionsMap[a.client_id] = chaseActionsMap[a.client_id] ?? [];
              chaseActionsMap[a.client_id].push({ title, overdue });
            }
          }
        }
      } catch {
        // non-fatal
      }
      return { openActionsMap, overdueActionsMap, chaseActionsMap };
    })();

    const queriesPromise = countOpenQueriesByClient(clientIds).catch((err) => {
      console.error("open queries:", err);
      return {} as Record<string, number>;
    });

    const [historyMap, actionMaps, openQueriesMap, displayNames, figures, linkedIds] = await Promise.all([
      historyPromise,
      actionsPromise,
      queriesPromise,
      namesPromise,
      figuresPromise,
      orphansPromise,
    ]);
    const { openActionsMap, overdueActionsMap, chaseActionsMap } = actionMaps;
    if (gen !== loadGen.current) return;
    const linked = new Set(linkedIds.filter((id): id is string => Boolean(id)));
    const books = new Map(
      ((figures.data ?? []) as { id: string; financials: Client["financials"]; cashflow: unknown }[]).map(
        (row) => [row.id, row],
      ),
    );
    rawClients = rawClients.map((client) => {
      const name = displayNames.get(client.id);
      const book = books.get(client.id);
      return {
        ...client,
        name: name && name !== client.name ? name : client.name,
        firm_id: linked.has(client.id) ? activeFirmId : client.firm_id,
        financials: book?.financials ?? client.financials ?? null,
        cashflow: book?.cashflow ?? client.cashflow,
      };
    });
    const fullRows = rawClients.map((c) =>
      toClientRow(
        c,
        historyMap[c.id] ?? [],
        openActionsMap[c.id] ?? 0,
        overdueActionsMap[c.id] ?? 0,
        openQueriesMap[c.id] ?? 0,
        chaseActionsMap[c.id] ?? [],
      ),
    );
    if (gen === loadGen.current) {
      setClientRows(fullRows);
      rememberPaintedBook(userId, activeFirmId, fullRows);
      setBookEnriched(true);
      setBookTimedOut(false);
    }
    } catch (err) {
      console.error("practice book:", err);
      if (gen === loadGen.current) setBookTimedOut(true);
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
        setCountsReady(true);
      }
    }
  };

  useEffect(() => {
    if (!portalReady) return;
    let cancelled = false;
    // Armed even while the firm row is still hydrating. brandLoading used to
    // return before this timer existed, so a firm that never arrived left the
    // client list on a skeleton with no deadline.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      console.warn("[practice-board] client book timed out; showing what has loaded");
      reportClientError(new Error("practice book load timed out"), { source: "practice-board" });
      setBookTimedOut(true);
      setLoading(false);
      setCountsReady(true);
    }, SHELL_GATE_TIMEOUT_MS);
    if (brandLoading) {
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    void load(firmId, user?.id, greetingSource).finally(() => {
      window.clearTimeout(timer);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // greetingSource is read for the name chain inside load, and the greeting
    // itself renders from practiceGreeting. A name update must not restart the book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, brandLoading, user?.id, portalReady]);

  // Load playbook catalogue
  useEffect(() => {
    getPlaybookCatalogue().then(setPlaybookCatalogue);
  }, []);

  const openOwnerInvite = async (c: Client) => {
    try {
      const inv = await mintInvite({
        data: {
          clientId: c.id,
          toEmail: c.contact_email || null,
          sendEmail: false,
        },
      });
      const next: InviteDraftUi = {
        clientId: c.id,
        clientName: c.name,
        token: inv.token,
        subject: inv.subject,
        body: inv.body,
        pasteText: inv.pasteText,
        email: inv.email ?? c.contact_email ?? "",
        emailed: false,
        sendError: null,
        draftedBy: inv.draftedBy,
        from: inv.from,
      };
      setInviteDraft(next);
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
      toast.error("Enter an email for client management");
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
      markOnboardingDone(ACCOUNTANT_DASH_EMPTY_TOUR_KEY);
    }
  }, [portalReady, loading, brandLoading, clientRows.length, firm?.id, firmId]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  // Average only scored clients — never invent 50 for empty financials.
  const scoredRows = clientRows.filter((c) => c.score != null && Number.isFinite(c.score));
  useEffect(() => {
    if (scoredRows.length > 0) markInsightSeen(firmId);
  }, [scoredRows.length, firmId]);
  const avgHealth = scoredRows.length
    ? Math.round(scoredRows.reduce((s, c) => s + (c.score as number), 0) / scoredRows.length)
    : null;
  const openQueriesTotal = clientRows.reduce((s, c) => s + c.openQueries, 0);
  const queriesDestination = firmOpenQueriesDestination(clientRows);
  const greetName = firstNameOf(greetingSource);
  const greeting = practiceGreeting(greetingSource);
  const bookLoading = loading || brandLoading;
  const clientsPhase = practiceClientsPhase({
    loading: bookLoading,
    timedOut: bookTimedOut,
    rowCount: clientRows.length,
  });
  const queriesPhase = openQueriesPhase({
    bookLoading,
    rowsReady: queryRowsReady,
    timedOut: queriesTimedOut,
    rowCount: queryRows.length,
  });
  useEffect(() => {
    if (!portalReady) return;
    revealPracticeHash(practiceHash);
  }, [portalReady, practiceHash, view, bookLoading, clientRows.length]);
  const countsLoading = !countsReady;
  const clientIdKey = clientRows.map((c) => c.id).join("\n");
  useEffect(() => {
    // Slim client ids are in clientRows once `loading` drops. The deadline is
    // armed first: a client list that never settles must not skip this timer.
    if (view !== "queries") return;
    let cancelled = false;
    setQueriesTimedOut(false);
    const ids = clientIdKey ? clientIdKey.split("\n") : [];
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      console.warn("[practice-board] open queries timed out");
      reportClientError(new Error("open queries timed out"), { source: "practice-board" });
      setQueriesTimedOut(true);
      setQueryRowsReady(true);
    }, SHELL_GATE_TIMEOUT_MS);
    if (loading) {
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    setQueryRowsReady(false);
    void settleWithin(listOpenQueries(ids), SHELL_GATE_TIMEOUT_MS).then((result) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      if (result.status === "value") {
        setQueryRows(result.value);
        setQueriesTimedOut(false);
      } else {
        console.warn(
          "[practice-board] open queries failed",
          result.status === "error" ? result.error : "timeout",
        );
        setQueriesTimedOut(true);
      }
      setQueryRowsReady(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, loading, clientIdKey]);
  const portfolioBook = useFirmPortfolioRows(firmId, clientRows.length);
  const portfolioRows = portfolioBook.rows;
  const portfolioLoaded = portfolioBook.loaded;
  const asOf = dataAsOfLabel(new Date(), marketForFirm({ market: firmMarket }));

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
  const attentionBook = useMemo(
    () => practiceNeedsAttention(attentionItems, portfolioRows),
    [attentionItems, portfolioRows],
  );
  const attentionView = needsAttentionView({
    bookLoading,
    enriched: bookEnriched,
    portfolioLoaded,
    items: attentionBook.items,
  });
  const attention = attentionBook.summary;
  const statusAttention = clientRows.filter((row) =>
    statusColumnNeedsAttention(row.health.displayLabel),
  ).length;
  const summaryLine =
    clientsPhase === "error"
      ? CLIENTS_LOAD_ERROR
      : clientsPhase === "loading"
        ? "Loading your clients…"
        : portfolioSummaryLine({
        clientCount: clientRows.length,
        needAttention: statusAttention,
        avgHealth,
      });

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
  const practiceBrief = useMemo(
    () => ({
      clientCount: clientRows.length,
      avgHealth,
      needAttention: statusAttention,
      reviewNow: attention.reviewNow,
      openQueries: openQueriesTotal,
      followUps: followUpItems.length,
    }),
    [
      clientRows.length,
      avgHealth,
      statusAttention,
      attention.reviewNow,
      openQueriesTotal,
      followUpItems.length,
    ],
  );
  const practiceLines = useMemo(
    () => practiceHomeLines({ ...practiceBrief, loading: bookLoading, countsReady }),
    [practiceBrief, bookLoading, countsReady],
  );
  const practiceStatus = useMemo(() => practiceCardStatuses(practiceBrief), [practiceBrief]);
  const dashAgent = view === "home" ? practiceAgent : null;

  const scatterClients = useMemo(
    () =>
      scoredRows
        .filter((c) => c.score != null && c.trendDelta != null && Number.isFinite(c.trendDelta))
        .map((c) => ({
          id: c.id,
          name: c.name,
          score: c.score as number,
          trendDelta: c.trendDelta as number,
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
  const showTrendColumn = trendColumnVisible(clientRows.map((c) => c.scoreSeries));

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
    return operatingProfitLabel({
      ebit,
      revenue: isFinite(revenue) ? revenue : null,
      market,
      financials: f,
    });
  }

  function runwayCell(c: ClientRow) {
    return clientListRunwayCell({ weeks: c.runwayWeeks, reason: c.runwayLabel });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!portalReady) {
    return (
      <div className="accountant-portal premium-shell">
        <main className="shell milon-page-enter">
          <DashboardSkeleton className="min-h-screen py-8" />
        </main>
      </div>
    );
  }

  return (
    <div className={`accountant-portal premium-shell practice-home milon-page-enter${mobileNavOpen ? " nav-open" : ""}`}>
      <WalkthroughWizard
        variant={clientRows.length > 0 ? "accountant-dashboard" : "accountant-dashboard-empty"}
        ready={!loading && !brandLoading && !firstClientOpen && !addOpen}
        onFinish={clientRows.length === 0 ? () => setFirstClientOpen(true) : undefined}
        passThroughIds={[OPEN_QUERIES_TILE_ID]}
        userId={user?.id ?? null}
      />
      {/* Ambient background */}
      <div id="atmos">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>

      <main className="shell">
        {/* ===== TOP BAR ===== */}
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <FirmSwitcher />
          <PeriodPill />
          <FeatureFinder audience="accountant" clientId={null} />
          <span className="spacer" />
          <SettingsMenu
            className="tb-btn settings-gear"
            onSettings={() => {
              setMobileNavOpen(false);
              openPracticeSettings();
              void navigate({ to: "/settings" });
            }}
            onPlan={() => {
              setMobileNavOpen(false);
              openPracticeSettings();
              void navigate({ to: "/settings", hash: "firm-billing" });
            }}
          />
          <span className="profile-chip topbar-profile" title={greetingSource || user?.email || ""}>
            <span className="av">{profileInitials || "·"}</span>
            <span className="profile-name">{greetName}</span>
          </span>
          <span className="topbar-theme">
            <ThemeToggle />
          </span>
          <AccountantMenuButton
            open={mobileNavOpen}
            onClick={() => setMobileNavOpen((o) => !o)}
          />
          {isItMember ? (
            <div className={`topbar-actions${mobileNavOpen ? " open" : ""}`}>
              <button
                className="tb-btn"
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  navigate({ to: "/ops", search: { tab: "it" } });
                }}
              >
                Milōn IT
              </button>
            </div>
          ) : null}
        </div>

        <div className="client-workspace">
          <DrawerBackdrop open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
          <PracticeRail onNavigate={() => setMobileNavOpen(false)} />
          <div className="deliverable-main">
        {view === "home" ? (
          <div className="owner-door">
            {dashAgent ? (
              <PracticeAgentThread
                agent={dashAgent}
                finding={(practiceLines[dashAgent] ?? []).filter((line) => line.trim()).join(" ")}
                clients={clientRows.map((row) => ({ id: row.id, name: row.name }))}
                marketCountry={practiceCountry}
                onBack={() => {
                  void navigate({ to: "/dashboard", hash: "" });
                }}
                onSelectAgent={(agent) => {
                  void navigate({ to: "/dashboard", hash: askHashForAgent(agent) });
                }}
              >
                <AgentWork
                  label="On the book"
                  {...practiceAgentWork(dashAgent, {
                    loading: bookLoading,
                    clients: clientRows,
                    attention: attentionBook.items,
                    followUps: followUpItems,
                  })}
                />
              </PracticeAgentThread>
            ) : bookLoading ? (
              <DashboardSkeleton className="py-8" />
            ) : (
            <OwnerHome
              title="Your whole finance team"
              showInvite={false}
              variant="character"
              audience="accountant"
              marketCountry={practiceCountry}
              sampleClient={false}
              presence={ownerPresence(emptyAgentActivity())}
              lines={practiceLines}
              status={practiceStatus}
              onOpen={(agent) => {
                void navigate({ to: "/dashboard", hash: askHashForAgent(agent) });
              }}
              onAsk={(agent) => {
                void navigate({ to: "/dashboard", hash: askHashForAgent(agent) });
              }}
            />
            )}
          </div>
        ) : null}
        {view === "practice" || isPracticeSection(view) ? (
          <>
        {view === "practice" ? (
          <>
        {/* ===== GREETING ===== */}
        <FirmStartHereBadge
          band={trialAllowance?.upgrade?.band ?? null}
          pending={trialAllowance == null}
        />
        <PageHeader
          compact
          className="dash-hero"
          title={greeting}
          subtitle={summaryLine}
          meta={
            <div className="dash-asof">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Data as of {asOf}
            </div>
          }
        />

        {/* ===== STATS STRIP ===== */}
        <div className="stats-strip" id="wizard-practice-board">
          {bookLoading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonTile key={i} className="min-h-[72px]" />
              ))}
            </>
          ) : (
            <>
              <MetricTile
                id={OPEN_QUERIES_TILE_ID}
                label="Open queries"
                icon={
                  <svg viewBox="0 0 24 24">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                }
                value={countsLoading ? "…" : openQueriesTotal}
                footnote={
                  countsLoading
                    ? "Loading"
                    : openQueriesTotal > 0
                      ? "Waiting on a reply"
                      : "No open queries"
                }
                link={queriesDestination ?? undefined}
              />
            </>
          )}
        </div>
          </>
        ) : (
          <PageHeader
            eyebrow="Practice"
            title={PRACTICE_SECTION_TITLES[view]}
            subtitle={practiceSectionSubtitle(view)}
          />
        )}

        {/* Practice home still waits for the enriched book. */}
        {view === "practice" && !bookLoading && !countsLoading ? (
          <PortfolioExceptions
            firmId={firmId}
            hideWhenClear
            queue={attentionBook.items}
            className="mb-3"
            onChase={(clientId, name) => openChase(clientId, name)}
          />
        ) : null}
        {view === "needs-attention" ? (
          <section className="attn-strip mb-3" id="needs-attention" aria-label="Needs attention today">
            <h2>Needs attention today</h2>
            {attentionView === "list" ? (
              <PortfolioExceptions
                firmId={firmId}
                hideWhenClear
                queue={attentionBook.items}
                showHeading={false}
                onChase={(clientId, name) => openChase(clientId, name)}
              />
            ) : (
              <p className="sub">
                {attentionView === "clear" ? "Nothing needs attention." : "Checking the book…"}
              </p>
            )}
          </section>
        ) : null}

        {view === "practice" ? (
          <>
        {showStarterTrialEndedCopy(
          trialAllowance?.upgrade?.phase,
          trialAllowance?.starterTrial?.expired,
        ) ? (
          <p className="dash-trial-banner" role="status">
            <Link to="/settings" className="dash-trial-banner__link">
              {STARTER_TRIAL_ENDED_MESSAGE}
            </Link>
          </p>
        ) : trialAllowance?.starterTrial ? (
          <FirmStarterTrialBanner
            trial={trialAllowance.starterTrial}
            upgrade={trialAllowance.upgrade}
            firmId={firmId}
            onUpgraded={() => setTrialNonce((n) => n + 1)}
          />
        ) : null}

        {scoredRows.length > 0 ? <CheckoutAfterInsight /> : null}
          </>
        ) : null}
        {view === "practice" || view === "follow-up" ? (
        <details
          className="home-fold"
          id="follow-up"
          {...(view === "follow-up" ? { open: true } : {})}
        >
            <summary>
              <span>Follow up</span>
              <span className="home-fold-meta">
                {countsLoading || bookLoading
                  ? "Loading"
                  : followUpItems.length > 0
                    ? `${followUpItems.length} with open Action Plan work`
                    : "None open"}
              </span>
            </summary>
            <div className="home-fold-body">
              {countsLoading || bookLoading || followUpItems.length === 0 ? (
                <p className="sub">
                  {countsLoading || bookLoading
                    ? "Loading follow-ups…"
                    : "No open Action Plan work to chase."}
                </p>
              ) : (
              <div className="followup-list">
                {followUpItems.map((item) =>
                  item.overdueActions > 0 ? (
                    <button
                      key={item.clientId}
                      type="button"
                      className="followup-row"
                      onClick={() => openChase(item.clientId, item.name)}
                    >
                      <span className="followup-name">{item.name}</span>
                      <span className="followup-count overdue">
                        {item.overdueActions} overdue
                      </span>
                      <span className="followup-cta">Chase →</span>
                    </button>
                  ) : (
                    <button
                      key={item.clientId}
                      type="button"
                      className="followup-row"
                      onClick={() =>
                        navigate({
                          to: "/clients/$clientId",
                          params: { clientId: item.clientId },
                          search: clientHomeSearch(),
                        })
                      }
                    >
                      <span className="followup-name">{item.name}</span>
                      <span className="followup-count">{item.openActions} open</span>
                      <span className="followup-cta">Open →</span>
                    </button>
                  ),
                )}
              </div>
              )}
            </div>
          </details>
        ) : null}

        {view === "practice" || view === "insights" ? (
        <details
          className="home-fold"
          id="portfolio-insights"
          {...(view === "insights" ? { open: true } : {})}
        >
          <summary>
            <span>Portfolio insights</span>
            <span className="home-fold-meta">Health trend</span>
          </summary>
          <div className="home-fold-body">
            <PortfolioHealthScatter
              clients={scatterClients}
              onSelect={(clientId) =>
                navigate({
                  to: "/clients/$clientId",
                  params: { clientId },
                  search: clientHomeSearch(),
                })
              }
            />
            {insights.length > 0 ? (
              <div className="insights-strip insights-strip--nested">
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
              </div>
            ) : null}
          </div>
        </details>
        ) : null}

        {view === "practice" || view === "marketplace" ? (
        <div id="marketplace">
          <AccountantInbox firmId={firmId} quiet onChanged={() => void load(firmId, user?.id, greetingSource)} />
        </div>
        ) : null}

        {/* ===== PLAYBOOK LIBRARY ===== */}
        {view === "practice" || view === "playbooks" ? (
        <details
          className="home-fold"
          id="playbooks"
          {...(view === "playbooks" ? { open: true } : {})}
        >
          <summary>
            <span>Playbook library</span>
            <span className="home-fold-meta">{playbookCatalogue.length} ratios</span>
          </summary>
          <div className="home-fold-body pb-section">
            <p className="sub" style={{ maxWidth: "62ch" }}>
              Definitions and the highest-impact repair steps — ready to hand a client.
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
        </details>
        ) : null}
          </>
        ) : null}
        {view === "queries" ? (
          <>
            <PageHeader
              eyebrow="Book"
              title="Open queries"
              subtitle="Unresolved notes across clients."
            />
            {queriesPhase === "error" ? (
              <p className="sub" role="alert">
                {OPEN_QUERIES_LOAD_ERROR}
              </p>
            ) : queriesPhase === "loading" ? (
              <p className="sub">Loading open queries…</p>
            ) : queryRows.length === 0 ? (
              <EmptyState title="No open queries." className="!py-10" />
            ) : (
              <div className="followup-list">
                {queryRows.map((row) => {
                  const client = clientRows.find((c) => c.id === row.clientId);
                  const when = row.createdAt
                    ? formatDate(row.createdAt, marketForClient(client))
                    : "";
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className="followup-row"
                      onClick={() =>
                        navigate({
                          to: "/clients/$clientId",
                          params: { clientId: row.clientId },
                          search: clientHomeSearch(),
                        })
                      }
                    >
                      <span className="followup-name">{client?.name ?? "Client"}</span>
                      <span className="followup-count">{row.body || "Open note"}</span>
                      <span className="followup-cta">{when || "Open →"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
        {view === "clients" ? (
          <>
                {/* ===== CLIENTS TABLE ===== */}
        <div className="clients-head" id="clients-table">
          <h1>Clients</h1>
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
          <button
            id="wizard-add-client"
            className={clientRows.length === 0 ? "btn ghost mini" : "btn gold mini"}
            onClick={() => setAddOpen(true)}
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add client
          </button>
        </div>

        {clientsPhase === "error" ? (
          <p className="sub" role="alert">
            {CLIENTS_LOAD_ERROR}
          </p>
        ) : clientsPhase === "loading" ? (
          <SkeletonBlock className="h-72 w-full rounded-[20px]" aria-label="Loading clients" />
        ) : filteredRows.length === 0 ? (
          clientRows.length === 0 ? (
            <EmptyState
              title="Your book is empty — add the first client"
              description="Add one client. The next step on their page is the one upload or sync that fills Health, Profit, Cash and Budget."
              action={
                <button className="btn gold" type="button" onClick={() => setFirstClientOpen(true)}>
                  Add your first client
                </button>
              }
            />
          ) : (
            <EmptyState title="No clients match your search." className="!py-10" />
          )
        ) : (
          <ScrollableTable cardRows className="ctable-scroll">
            <table className="ctable milon-data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Health</th>
                  {showTrendColumn ? <th>Trend</th> : null}
                  <th>Runway</th>
                  <th id="wizard-dash-queries">Queries</th>
                  <th>{operatingProfitColumnHeading(filteredRows)}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((c) => {
                  const chip = chipFromHealth(c.health);
                  const score = c.score != null ? Math.round(c.score) : null;
                  const runway = runwayCell(c);
                  return (
                    <tr
                      key={c.id}
                      className="row"
                      data-client-row
                      onClick={() =>
                        navigate({
                          to: "/clients/$clientId",
                          params: { clientId: c.id },
                          search: clientHomeSearch(),
                        })
                      }
                    >
                      <td>
                        <div className="cname">{c.name}</div>
                        {statementSampleImplausible(c.financials) ? (
                          <div className="ctype" style={{ textTransform: "none", letterSpacing: "normal" }}>
                            {IMPLAUSIBLE_SAMPLE_NOTE}
                          </div>
                        ) : null}
                        <div className="ctype">
                          {(() => {
                            const industry = clientIndustryDisplay(
                              c.name,
                              parseOperatingProfile(c.operating_profile),
                              c.business_type,
                            );
                            return c.client_code ? (
                              <>
                                <span
                                  style={{
                                    fontFamily: "ui-monospace, monospace",
                                    letterSpacing: "0.04em",
                                  }}
                                >
                                  {c.client_code}
                                </span>
                                <span style={{ textTransform: "none", letterSpacing: "normal" }}>
                                  {` · ${industry}`}
                                </span>
                              </>
                            ) : (
                              <span style={{ textTransform: "none", letterSpacing: "normal" }}>
                                {industry}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td data-label="Health">
                        <div className="cell-health">
                          <span className="ring">
                            <RingSvg score={score} status={c.health.displayStatus} />
                            <span className="ring-score">{score ?? "—"}</span>
                          </span>
                        </div>
                      </td>
                      {showTrendColumn ? (
                        <td data-label="Trend" data-client-trend={c.scoreSeries.length >= 2 ? "yes" : "no"}>
                          {c.scoreSeries.length >= 2 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <KpiTrendline values={c.scoreSeries} width={56} height={18} />
                              <span className="text-[11px] font-semibold text-slate-500">
                                {c.scoreSeries[c.scoreSeries.length - 1]! > c.scoreSeries[0]!
                                  ? "Up"
                                  : c.scoreSeries[c.scoreSeries.length - 1]! < c.scoreSeries[0]!
                                    ? "Down"
                                    : "Flat"}
                              </span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                      <td className="num" data-label="Runway" title={runway.title}>
                        <span className="runway-val">{runway.value}</span>
                      </td>
                      <td className="num" data-label="Queries">
                        {countsLoading ? "…" : c.openQueries > 0 ? c.openQueries : "—"}
                      </td>
                      <td className="num" data-label="Op. profit" style={{ whiteSpace: "nowrap" }}>
                        {opMarginStr(c)}
                      </td>
                      <td data-label="Status">
                        <ClientStatus health={c.health} label={chip.label} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
        )}
          </>
        ) : null}

        <div className="footer-note">MILŌN Practice Portal</div>
          </div>
        </div>
      </main>

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
            forgetPaintedBook(user.id, firm?.id ?? firmId);
            forgetPaintedBook(user.id, created.firm_id ?? null);
            void (async () => {
              await refreshFirms();
              void load(created.firm_id ?? firmId, user.id, greetingSource);
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
          firmMarket={firms.find((f) => f.id === (firm?.id ?? firmId))?.market ?? null}
          brandLoading={brandLoading}
          heading={firstClientOpen ? "Add your first client" : "Add a client"}
          blurb={
            firstClientOpen
              ? "Pick a client whose statements you have to hand — you'll see their scored board in one sitting: upload, review the figures, then Health, Profit, Cash and Milōn Bot fill in. Every client after this one follows the same loop."
              : undefined
          }
          sandboxName={firstClientOpen ? PRACTICE_TEST_CLIENT_NAME : undefined}
        />
      )}

      {inviteDraft && (
        <InviteOwnerDialog
          draft={inviteDraft}
          sending={inviteSending}
          emailPlaceholder={t(
            "emailExample",
            resolveMarket(
              coerceMarketSelection(
                firms.find((f) => f.id === (firm?.id ?? firmId))?.market ?? null,
              ),
            ),
          )}
          onClose={() => setInviteDraft(null)}
          onEmailChange={(email) => setInviteDraft((d) => (d ? { ...d, email } : d))}
          onCopy={() => void copyInviteDraft()}
          onSend={() => void sendInviteDraft()}
        />
      )}

      {chaseDraft ? <ChaseDraftDialog draft={chaseDraft} onClose={() => setChaseDraft(null)} /> : null}

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
