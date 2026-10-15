import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { PeriodPill } from "@/components/chrome-icons";
import { useEffect, useMemo, useState, useRef, Fragment } from "react";
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
  scorecardHealthFromFinancials,
  scoreTier,
  type OverallHealth,
} from "@/lib/health-score";
import { periodMonthsOf } from "@/lib/ratios";
import {
  buildAttentionItems,
  buildFollowUpQueue,
  buildPortfolioInsights,
  dataAsOfLabel,
  firmOpenQueriesDestination,
  firstNameOf,
  practiceGreeting,
  practiceNeedsAttention,
  portfolioSummaryLine,
  revenueOf,
  trendDelta30d,
  type ScoreHistoryPoint,
} from "@/lib/portfolio-dashboard";
import { useServerFn } from "@tanstack/react-start";
import { createFirmClient, getFirmClientCreateAllowance } from "@/lib/firm-clients.functions";
import {
  idleStarterTrialBanner,
  showStarterTrialEndedCopy,
  type FirmClientCreateAllowance,
} from "@/lib/firm-client-cap";
import { browserAppOrigin } from "@/lib/app-origin";
import { FirmBandUpgrade } from "@/components/firm-band-upgrade";
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
import { forecastRunwayHeadlineShared } from "@/lib/cash-forecast-parity";
import {
  assessClientMetrics,
  forecastIsCashGenerative,
  runwayDisplayLabel,
  runwayTileValue,
} from "@/lib/client-metrics";
import { parseOperatingProfile } from "@/lib/client-profile";
import { clientIndustryDisplay } from "@/lib/profile-signals";
import { countOpenQueriesByClient } from "@/lib/open-queries";
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
  formatMoney,
  isDraftComplete,
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
  /** Resolved runway (persisted or derived from cashflow). */
  runwayWeeks: number | null;
  /** Same label Overview prints, including Cash generative. */
  runwayLabel: string | null;
  /** Unresolved notes count. */
  openQueries: number;
  /** Open (not done) action-plan items. */
  openActions: number;
  /** Open actions past due_date. */
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
    currentPlan && cap.upgrade?.band === "starter" && cap.code !== "band_client_cap"
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
          This charges the card on file today and ends the 14-day free trial. The paid band’s client
          limit applies after that.
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
                  placeholder={
                    draftMarket.country === "US" ? "owner@business.com" : "owner@business.co.za"
                  }
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

const UNSCORED_HEALTH: OverallHealth = {
  overall: null,
  status: "at_risk",
  displayStatus: "at_risk",
  displayLabel: "Watch",
  pillars: [],
  weakestPillar: null,
  hasCriticalPillar: false,
};

/** One book row. A scoring throw still leaves the client on the list. */
function toClientRow(
  c: Client,
  history: ScoreHistoryPoint[],
  openActions: number,
  overdueActions: number,
  openQueries: number,
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
    const runwayLabel =
      outlook.closing.length > 0
        ? forecastRunwayHeadlineShared({
            opening: outlook.opening,
            closings: outlook.closing,
            floor: outlook.floor,
            runwayLabel: runwayDisplayLabel(assessed.runway),
            cashGenerative:
              assessed.runway.kind === "cash_generative" &&
              forecastIsCashGenerative(outlook.totalInflow, outlook.totalOutflow),
          }).headline
        : runwayDisplayLabel(assessed.runway);
    const fyStartMonth =
      parseOperatingProfile(c.operating_profile)?.fyStartMonth ?? clientMarket.fyStartMonthDefault;
    const health = scorecardHealthFromFinancials({
      financials: c.financials,
      fyStartMonth,
      periodMonths: periodMonthsOf(c.financials),
      cashRunwayWeeks: runwayWeeks,
      market: clientMarket,
      shortfallWeek: assessed.outlook.shortfallWeek,
    });
    return {
      ...c,
      score: health.overall,
      health,
      trendDelta: trendDelta30d(history, health.overall),
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

export type PracticeView = "home" | "clients" | "practice";

export function PracticeBoard({ view }: { view: PracticeView }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const practiceHash = useRouterState({ select: (s) => s.location.hash });
  const practiceAgent = askAgentFromHash(practiceHash);

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

  const { firmId, firms, brandLoading, profile, refreshFirms, greetingSource } = useAccountantProfile();
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
  const load = async (activeFirmId: string | null, userId: string | undefined) => {
    const gen = ++loadGen.current;
    setLoading(true);
    try {

    if (!userId) {
      setClientRows([]);
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
      const linked: string[] = [];
      for (const id of orphanIds) {
        const { error: attachErr } = await supabase.rpc(
          "link_own_client_to_firm" as never,
          { p_client_id: id, p_firm_id: activeFirmId } as never,
        );
        if (!attachErr) linked.push(id);
      }
      if (linked.length) {
        rawClients = rawClients.map((c) =>
          linked.includes(c.id) ? { ...c, firm_id: activeFirmId } : c,
        );
      }
    }

    // Show the book as soon as the client query returns. Score history, open
    // actions, and notes enrich the rows afterwards. A hung secondary query
    // used to leave Home on "0 clients on the book." and Clients empty.
    if (gen !== loadGen.current) return;
    setClientRows(rawClients.map((c) => toClientRow(c, [], 0, 0, 0)));
    setLoading(false);

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

    // Compute per-client enriched rows. A failure here keeps the clients
    // already on screen; it does not put the book back to zero.
    let openQueriesMap: Record<string, number> = {};
    try {
      openQueriesMap = await countOpenQueriesByClient(rawClients.map((c) => c.id));
    } catch (err) {
      console.error("open queries:", err);
    }
    if (gen !== loadGen.current) return;
    setClientRows(
      rawClients.map((c) =>
        toClientRow(
          c,
          historyMap[c.id] ?? [],
          openActionsMap[c.id] ?? 0,
          overdueActionsMap[c.id] ?? 0,
          openQueriesMap[c.id] ?? 0,
        ),
      ),
    );
    } catch (err) {
      console.error("practice book:", err);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
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
  const portfolioRows = useFirmPortfolioRows(firmId, clientRows.length);
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
  const attentionBook = useMemo(
    () => practiceNeedsAttention(attentionItems, portfolioRows),
    [attentionItems, portfolioRows],
  );
  const attention = attentionBook.summary;
  const summaryLine = bookLoading
    ? "Loading your clients…"
    : portfolioSummaryLine({
        clientCount: clientRows.length,
        needAttention: attention.needAttention,
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
      needAttention: attention.needAttention,
      reviewNow: attention.reviewNow,
      openQueries: openQueriesTotal,
      followUps: followUpItems.length,
    }),
    [
      clientRows.length,
      avgHealth,
      attention.needAttention,
      attention.reviewNow,
      openQueriesTotal,
      followUpItems.length,
    ],
  );
  const practiceLines = useMemo(
    () => practiceHomeLines({ ...practiceBrief, loading: bookLoading }),
    [practiceBrief, bookLoading],
  );
  const practiceStatus = useMemo(() => practiceCardStatuses(practiceBrief), [practiceBrief]);
  const dashAgent = view === "home" ? practiceAgent : null;

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
    if (c.runwayLabel) return c.runwayLabel;
    if (c.runwayWeeks == null) return "—";
    return `${c.runwayWeeks} wk`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!portalReady) {
    return (
      <div className="accountant-portal">
        <main className="shell milon-page-enter">
          <DashboardSkeleton className="min-h-screen py-8" />
        </main>
      </div>
    );
  }

  return (
    <div className={`accountant-portal practice-home milon-page-enter${mobileNavOpen ? " nav-open" : ""}`}>
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
          <AccountantMenuButton
            open={mobileNavOpen}
            onClick={() => setMobileNavOpen((o) => !o)}
          />
          <div className={`topbar-actions${mobileNavOpen ? " open" : ""}`}>
            {isItMember ? (
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
            ) : null}
            <ThemeToggle />
          </div>
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
            ) : (
            <OwnerHome
              title="Your whole finance team"
              showInvite={false}
              variant="character"
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
        {view === "practice" ? (
          <>
        {/* ===== GREETING ===== */}
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
                value={openQueriesTotal}
                footnote={openQueriesTotal > 0 ? "Waiting on a reply" : "No open queries"}
                link={queriesDestination ?? undefined}
              />
            </>
          )}
        </div>

        {/* One queue: health alerts and pack sign-off, not two strips. */}
        {!bookLoading ? (
          <PortfolioExceptions
            firmId={firmId}
            hideWhenClear
            queue={attentionBook.items}
            className="mb-3"
          />
        ) : null}

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
        <details className="home-fold" id="follow-up">
            <summary>
              <span>Follow up</span>
              <span className="home-fold-meta">
                {followUpItems.length > 0
                  ? `${followUpItems.length} with open Action Plan work`
                  : bookLoading
                    ? "Loading"
                    : "None open"}
              </span>
            </summary>
            <div className="home-fold-body">
              {followUpItems.length === 0 ? (
                <p className="sub">
                  {bookLoading ? "Loading follow-ups…" : "No open Action Plan work to chase."}
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
          </details>

        <details className="home-fold" id="portfolio-insights">
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
                  search: {},
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

        <AccountantInbox firmId={firmId} quiet onChanged={() => void load(firmId, user?.id)} />

        {/* ===== PLAYBOOK LIBRARY ===== */}
        <details className="home-fold" id="playbooks">
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

        {bookLoading ? (
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
                  <th>Runway</th>
                  <th id="wizard-dash-queries">Queries</th>
                  <th>Op. profit (MTD)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((c) => {
                  const chip = chipFromHealth(c.health);
                  const score = c.score != null ? Math.round(c.score) : null;
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
                      <td className="num" data-label="Runway" title={runwayStr(c)}>
                        <span className="runway-val">{runwayTileValue(runwayStr(c))}</span>
                      </td>
                      <td className="num" data-label="Queries">
                        {c.openQueries > 0 ? c.openQueries : "—"}
                      </td>
                      <td className="num" data-label="Op. profit">
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
