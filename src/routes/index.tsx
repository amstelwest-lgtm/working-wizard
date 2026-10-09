import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, wakeAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { notifySignup } from "@/lib/signup-notify";
import { welcomeWithoutBlockingSignup } from "@/lib/welcome-email";
import { sendSignupWelcome } from "@/lib/welcome-email.functions";
import { adminSignUp, acceptOwnerInvite } from "@/lib/auth.functions";
import { previewOwnerInvite } from "@/lib/invite-tokens.functions";
import { OPS_UNLOCK_KEY, unlockOwnerOps } from "@/lib/owner-ops.functions";
import { registerLighthouseTrialVisit } from "@/lib/lighthouse.functions";
import { FirmBandPricingTable } from "@/components/firm-band-pricing";
import { LandingSignInButton } from "@/components/landing/landing-sign-in-button";
import { DUAL_MARKET_BUILT, DUAL_MARKET_TAGLINE, FIRM_CARD_TIMING } from "@/lib/firm-signup-copy";
import { RegionCopy } from "@/components/marketing-shell";
import {
  applyVisitorMarketToDocument,
  draftToSelection,
  marketToJson,
  readVisitorDraft,
  visitorCopyPack,
  VISITOR_MARKET_BOOT_SCRIPT,
  withMarketRpcFallback,
  writeVisitorDraft,
  type DraftMarket,
} from "@/lib/market";
// Inline so landing paint doesn't wait on a second stylesheet round-trip
// (external app CSS can still load; these rules win for landing selectors).
import landingCss from "../styles/landing.css?inline";
import {
  peekPendingOwnerInvite,
  pendingInviteTokenFromSearch,
  signupLooksAlreadyRegistered,
} from "@/lib/invite-handoff";
import { browserAppUrl } from "@/lib/app-origin";
import {
  billingStartPath,
  billingStartSearch,
  checkoutEmailRedirectTo,
  clearPendingCheckout,
  consumeResumeFirmBilling,
  FIRM_BILLING_SIGNIN_MESSAGE,
  OWNER_ALREADY_REGISTERED_MESSAGE,
  paidPlanFromRegisterLabel,
  parsePendingCheckoutFromSearch,
  peekPendingCheckout,
  registerLabelForPlan,
  stashPendingCheckout,
  stashResumeFirmBilling,
} from "@/lib/pending-checkout";
import { decidePostLoginBillingResume } from "@/lib/stripe-entitlement";
import { readInsightSeen } from "@/lib/funnel-timing";
import {
  firmSignupCheckoutIntent,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import { LiteYouTube } from "@/components/lite-youtube";
import { readRequestGeoCountry } from "@/lib/geo-country.functions";
import { isSaPricingCountry } from "@/lib/geo-country";
import {
  ACCOUNTANT_TEASER,
  BRIDGE_DRAFT_BODY,
  BRIDGE_DRAFT_LABEL,
  DASH_ARIA_LABEL,
  HERO_BADGE,
  HERO_CONTACT_EMAIL,
  HERO_CONTACT_HREF,
  HERO_CTA_LABEL,
  HERO_CTA_NOTE,
  HERO_H1_GOLD,
  HERO_H1_LEAD,
  HERO_LEDE,
  HERO_OWNER_PREFIX,
  HERO_POINTS,
  HERO_WALKTHROUGH_LABEL,
  FAQ_MORE_LEAD,
  FAQ_MORE_LINK,
  FINANCE_TEAM,
  HOW_STEP_03,
  NAV_TRIAL_ARIA,
  NAV_TRIAL_LABEL,
  OWNER_TEASER,
  OWNER_TEASER_LINK,
  PRICING_H2_USD,
  PRICING_INTRO,
  PRICING_OWNER_BAR,
  PRICING_OWNER_CTA,
  PROOF_AI_LINK,
  PROOF_CARDS,
  PROOF_EYEBROW,
  PROOF_H2,
  PROOF_PRIVACY_LINK,
  PROOF_SECURITY_FACTS,
  TRUST_AI_LINK,
  TRUST_ITEMS,
  WALKTHROUGH_URL,
  WATCH_EYEBROW,
  WATCH_SUB,
  WATCH_TITLE,
  homepageFaqItems,
  proofImageSrc,
  proofImageSrcSet,
} from "@/lib/landing-copy";
import { faqPageJson, pageHead, SEO_PAGES } from "@/lib/seo";
import { OwnerInviteShell } from "@/components/owner-invite-shell";
import { OwnerInviteSignupPanel } from "@/components/owner-invite-signup-panel";
import { OwnerInviteSigninOverlay } from "@/components/owner-invite-signin-overlay";
import { explainPasswordSignInFailure } from "@/lib/password-sign-in";
import {
  BEBAS_LATIN_HREF,
  LANDING_FONT_CSS,
  LANDING_SKY_CSS,
  NOTO_LATIN_HREF,
  NOTO_MACRON_HREF,
  PREFERRED_SOURCE_HREF,
  PREFERRED_SOURCE_LABEL,
} from "@/lib/landing-assets";

async function landingSupabase() {
  wakeAuth();
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

async function setLandingPortal(intent: "accountant" | "owner") {
  const { setPortalIntent } = await import("@/lib/user-roles");
  setPortalIntent(intent);
}

/** Firm id for insight-seen, loaded only after a session exists. */
async function landingFirmId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { activeFirmIdForUser } = await import("@/lib/firm-brand");
  return activeFirmIdForUser(userId);
}

const LandingSignInModal = lazy(() =>
  import("@/components/landing/sign-in-modal").then((mod) => ({
    default: mod.LandingSignInModal,
  })),
);
const LandingRegisterForm = lazy(() =>
  import("@/components/landing/register-form").then((mod) => ({
    default: mod.LandingRegisterForm,
  })),
);

export const Route = createFileRoute("/")({
  loader: async () => {
    const geoCountry = await readRequestGeoCountry();
    return { showSaPricing: isSaPricingCountry(geoCountry) };
  },
  component: LandingPage,
  head: ({ loaderData }) => {
    const showSaPricing = loaderData?.showSaPricing === true;
    const homeHead = pageHead(SEO_PAGES.home);
    return {
      ...homeHead,
      links: [
        ...(homeHead.links ?? []),
        {
          rel: "preload",
          href: BEBAS_LATIN_HREF,
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: NOTO_LATIN_HREF,
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: NOTO_MACRON_HREF,
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
      ],
      styles: [
        { children: LANDING_FONT_CSS },
        { children: landingCss },
        { children: LANDING_SKY_CSS },
      ],
      scripts: [
        {
          children: `(function(){try{var d=document.documentElement;d.dataset.landing="1";var t="dark";try{var s=localStorage.getItem("milon.landing.theme");if(s==="light"||s==="dark")t=s;}catch(e){}d.dataset.theme=t;var light=t==="light";if(light){d.classList.remove("dark");d.style.backgroundColor="#f7f4ec";d.style.color="#1b1608";d.style.colorScheme="only light";}else{d.classList.add("dark");d.style.backgroundColor="#050507";d.style.color="#f2ecdc";d.style.colorScheme="only dark";}var m=document.getElementById("milon-color-scheme");if(!m){m=document.createElement("meta");m.id="milon-color-scheme";m.setAttribute("name","color-scheme");(document.head||d).appendChild(m);}m.setAttribute("content",light?"only light":"only dark");}catch(e){}})();`,
        },
        { children: VISITOR_MARKET_BOOT_SCRIPT },
        {
          type: "application/ld+json",
          children: faqPageJson(homepageFaqItems(showSaPricing)),
        },
      ],
    };
  },
});

const LANDING_THEME_KEY = "milon.landing.theme";

/** Invite claim links: `/?invite=<token>&mode=signup`. */
function pendingInviteTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return pendingInviteTokenFromSearch(window.location.search);
}

function syncLandingColorScheme(theme: "light" | "dark") {
  const only = theme === "light" ? "only light" : "only dark";
  document.documentElement.style.colorScheme = only;
  let meta = document.getElementById("milon-color-scheme");
  if (!meta) {
    meta = document.createElement("meta");
    meta.id = "milon-color-scheme";
    meta.setAttribute("name", "color-scheme");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", only);
}

function applyLandingTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  const body = document.body;
  root.dataset.landing = "1";
  root.dataset.theme = theme;
  if (theme === "light") {
    root.classList.remove("dark");
    root.style.backgroundColor = "#f7f4ec";
    root.style.color = "#1b1608";
    body.style.backgroundColor = "#f7f4ec";
    body.style.color = "#1b1608";
  } else {
    root.classList.add("dark");
    root.style.backgroundColor = "#050507";
    root.style.color = "#f2ecdc";
    body.style.backgroundColor = "#050507";
    body.style.color = "#f2ecdc";
  }
  syncLandingColorScheme(theme);
  const wrap = document.querySelector<HTMLElement>("[data-milon-landing]");
  if (wrap) {
    wrap.style.background = "var(--bg)";
    wrap.style.color = "var(--ink)";
  }
  const tbtn = document.getElementById("themeToggle");
  if (tbtn) {
    tbtn.setAttribute(
      "aria-label",
      theme === "light" ? "Switch to dark theme" : "Switch to light theme",
    );
  }
  try {
    localStorage.setItem(LANDING_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

/* ─────────────────────────────────────────────────────────────── */

function LandingPage() {
  const { showSaPricing } = Route.useLoaderData();
  const homeFaq = homepageFaqItems(showSaPricing);
  const { user, loading } = useAuth();
  const [firmId, setFirmId] = useState<string | null>(null);
  const navigate = useNavigate();
  const doAdminSignUp = useServerFn(adminSignUp);
  const doSendWelcome = useServerFn(sendSignupWelcome);
  const doAcceptOwnerInvite = useServerFn(acceptOwnerInvite);
  const doPreviewInvite = useServerFn(previewOwnerInvite);
  const doUnlockOps = useServerFn(unlockOwnerOps);
  const doTrialVisit = useServerFn(registerLighthouseTrialVisit);

  /* ── invite-link state (opaque token preferred; legacy client UUID still works) ── */
  const [inviteClientId, setInviteClientId] = useState<string | null>(null);
  const [inviteIsLegacyUuid, setInviteIsLegacyUuid] = useState(false);
  const [inviteBusiness, setInviteBusiness] = useState<string | null>(null);
  const [inviteNeedsCode, setInviteNeedsCode] = useState(false);
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(false);
  const [invitePreviewError, setInvitePreviewError] = useState<string | null>(null);
  const [regClientCode, setRegClientCode] = useState("");

  /* ── Lighthouse trial link (?lh=<token>) — attribute the signup back to the lead ── */
  const [lhToken, setLhToken] = useState<string | null>(null);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) {
      setFirmId(null);
      return;
    }
    let cancelled = false;
    void landingFirmId(uid).then((id) => {
      if (!cancelled) setFirmId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const lh = new URLSearchParams(window.location.search).get("lh");
    if (!lh) return;
    setLhToken(lh);
    void doTrialVisit({ data: { token: lh } }).catch(() => {});
    setTimeout(() => {
      document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  }, [doTrialVisit]);

  useEffect(() => {
    const stored = peekPendingOwnerInvite();
    const inv = pendingInviteTokenFromUrl() ?? stored?.token ?? null;
    if (!inv) return;
    setInviteClientId(inv);
    setInvitePreviewLoading(true);
    setInvitePreviewError(null);
    if (stored?.clientCode) setRegClientCode((prev) => prev || stored.clientCode || "");
    // Show the code field immediately so a slow preview cannot let them submit
    // without it. Hide only after preview confirms this client has no code.
    setInviteNeedsCode(true);
    void import("@/lib/user-roles").then(({ forcePortal }) => forcePortal("owner"));
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(inv.trim())) {
      setInviteIsLegacyUuid(true);
    }
    void doPreviewInvite({ data: { token: inv } })
      .then((preview) => {
        setInviteBusiness(preview.clientName);
        setInviteNeedsCode(Boolean(preview.clientCode));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "This invite link is invalid.";
        setInvitePreviewError(msg);
      })
      .finally(() => {
        setInvitePreviewLoading(false);
      });
  }, [doPreviewInvite]);

  useEffect(() => {
    if (!inviteClientId || !user?.email) return;
    setRegEmail((prev) => prev || user.email || "");
  }, [inviteClientId, user?.email]);

  /* ── sign-in modal state ── */
  const [signinOpen, setSigninOpen] = useState(false);
  const [registerReady, setRegisterReady] = useState(false);
  const [marqueePaused, setMarqueePaused] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [trialBarOn, setTrialBarOn] = useState(false);
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siBusy, setSiBusy] = useState(false);
  const [siError, setSiError] = useState("");
  const siSubmitLock = useRef(false);

  /* Secret owner-ops unlock (obscurity layer — real gate is email allowlist on /ops) */
  const [opsGateOpen, setOpsGateOpen] = useState(false);
  const [opsUser, setOpsUser] = useState("lighthouse");
  const [opsPass, setOpsPass] = useState("");
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsError, setOpsError] = useState("");
  const logoTapRef = useRef({ count: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });

  /* ── forgot-password state ── */
  const [fpMode, setFpMode] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpBusy, setFpBusy] = useState(false);
  const [fpDone, setFpDone] = useState(false);

  /* ── mounted gate — form is client-only to prevent browser-extension
     (e.g. LastPass) DOM injections from causing a hydration mismatch crash ── */
  const [mounted, setMounted] = useState(false);
  const [landingTheme, setLandingTheme] = useState<"light" | "dark">("dark");
  const setLandingThemeRef = useRef(setLandingTheme);
  setLandingThemeRef.current = setLandingTheme;
  // Declared before the persist effect: that effect's dependency array
  // reads draftMarket on every render. A later const is a TDZ crash
  // (ReferenceError: Cannot access 'draftMarket' before initialization)
  // and white-screens the landing page.
  const [draftMarket, setDraftMarket] = useState<DraftMarket>(() =>
    typeof window !== "undefined" ? readVisitorDraft() : { country: null, regionCode: null },
  );
  const copyMarket = { copyPack: visitorCopyPack(draftMarket) };
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    writeVisitorDraft(draftMarket);
    (window as unknown as { __milonDraftMarket?: DraftMarket }).__milonDraftMarket = draftMarket;
    applyVisitorMarketToDocument(draftMarket);
  }, [draftMarket, mounted]);

  /* ── register form state ── */
  const [regRole, setRegRole] = useState("Accountant / Advisory firm");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regBusiness, setRegBusiness] = useState("");
  const [regFirmName, setRegFirmName] = useState("");
  const [regPlan, setRegPlan] = useState("Solo");
  const [firmInterval, setFirmInterval] = useState<FirmInterval>("month");
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState("");
  const [regDone, setRegDone] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [siUnconfirmed, setSiUnconfirmed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = parsePendingCheckoutFromSearch(window.location.search) ?? peekPendingCheckout();
    if (!pending) return;
    stashPendingCheckout(pending);
    setRegPlan(registerLabelForPlan(pending.plan));
    setRegRole("Accountant / Advisory firm");
    const hash = window.location.hash.replace(/^#/, "");
    const target = hash === "pricing" ? "pricing" : "register";
    window.setTimeout(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const showRegisterError = (msg: string) => {
    setRegError(msg);
    toast.error(msg);
    window.requestAnimationFrame(() => {
      document.getElementById("register-error")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const promptSignInToFinishFirmBilling = async (email: string) => {
    await setLandingPortal("accountant");
    stashResumeFirmBilling();
    setRegError(FIRM_BILLING_SIGNIN_MESSAGE);
    toast.message(FIRM_BILLING_SIGNIN_MESSAGE);
    setSiEmail(email);
    setSiError("");
    setFpMode(false);
    setSigninOpen(true);
  };

  const promptSignInExistingAccount = (email: string) => {
    if (peekPendingCheckout()) {
      promptSignInToFinishFirmBilling(email);
      return;
    }
    toast.message(OWNER_ALREADY_REGISTERED_MESSAGE);
    setSiEmail(email);
    setSiError("");
    setFpMode(false);
    setSigninOpen(true);
  };

  const paidSignupRedirectTo = () => {
    const pending = peekPendingCheckout();
    return pending
      ? checkoutEmailRedirectTo(window.location.origin, pending)
      : browserAppUrl("/app");
  };

  const resendConfirmationTo = async (email: string) => {
    const target = email.trim();
    if (!target) return;
    setResendBusy(true);
    try {
      const { error } = await (await landingSupabase()).auth.resend({
        type: "signup",
        email: target,
        options: { emailRedirectTo: paidSignupRedirectTo() },
      });
      if (error) throw error;
      toast.success(`Confirmation email sent to ${target}`);
      setResendCooldown(60);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not resend the email.");
    } finally {
      setResendBusy(false);
    }
  };

  const handleResendConfirmation = () => void resendConfirmationTo(regEmail);

  /* ── redirect if already signed in ──
     Honour a pending Lighthouse unlock so the /app bounce cannot steal the
     navigation after the passphrase step (or if the owner returns already
     signed in with the unlock flag still set). */
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      let goOps = false;
      try {
        goOps = sessionStorage.getItem(OPS_UNLOCK_KEY) === "1";
      } catch {
        /* ignore */
      }
      if (goOps) {
        if (!cancelled) navigate({ to: "/ops" });
        return;
      }
      // Invite accept stays on the landing form. Read the URL / Google stash
      // here (not only inviteClientId state) so a leftover accountant session
      // cannot race the invite effect and dump the user onto /dashboard — and
      // so a Google return to `/` still keeps the owner-seat invite.
      if (pendingInviteTokenFromUrl() || inviteClientId || peekPendingOwnerInvite()) return;
      const hash = window.location.hash.replace(/^#/, "");
      const pendingCheckout =
        peekPendingCheckout() ?? parsePendingCheckoutFromSearch(window.location.search);
      if (pendingCheckout) stashPendingCheckout(pendingCheckout);
      // Pricing must stay on this page. A signed-in firm is not forwarded into Checkout.
      if (hash === "pricing") return;
      if (pendingCheckout) {
        if (!cancelled) {
          await setLandingPortal("accountant");
          navigate({ to: "/dashboard", replace: true });
        }
        return;
      }
      if (hash === "register") {
        try {
          const { listUserFirms } = await import("@/lib/firm-brand");
          const firms = await listUserFirms(user.id);
          if (firms.some((f) => f.owner_user_id === user.id)) {
            if (!cancelled) {
              await setLandingPortal("accountant");
              navigate({ to: "/dashboard", replace: true });
            }
            return;
          }
        } catch (err) {
          console.warn("[landing] firm billing short-circuit failed:", err);
        }
      }
      try {
        const { resolveSignedInDestination } = await import("@/lib/landing-sign-in-destination");
        const path = await resolveSignedInDestination(user.id, {
          door: "landing",
          knownMeta: user.user_metadata as Record<string, unknown> | undefined,
        });
        if (!cancelled) navigate({ to: path, replace: true });
      } catch (err) {
        console.warn("[landing] post-login redirect failed:", err);
        const { isPracticeSignupMeta } = await import("@/lib/user-roles");
        const practice = isPracticeSignupMeta(
          user.user_metadata as Record<string, unknown> | undefined,
        );
        if (!cancelled) navigate({ to: practice ? "/dashboard" : "/app", replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, navigate, inviteClientId]);

  /* ── Landing theme: keep data-landing; restore prior theme on leave ── */
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const hadDark = root.classList.contains("dark");
    const prevTheme = root.dataset.theme;
    const hadLanding = root.dataset.landing;
    const prevRootBg = root.style.backgroundColor;
    const prevRootColor = root.style.color;
    const prevBodyBg = body.style.backgroundColor;
    const prevBodyColor = body.style.color;
    let initial: "light" | "dark" = "dark";
    try {
      const saved = localStorage.getItem(LANDING_THEME_KEY);
      if (saved === "light" || saved === "dark") initial = saved;
    } catch {
      /* ignore */
    }
    applyLandingTheme(initial);
    setLandingThemeRef.current(initial);
    return () => {
      if (!hadDark) root.classList.remove("dark");
      else root.classList.add("dark");
      if (prevTheme) root.dataset.theme = prevTheme;
      else delete root.dataset.theme;
      if (hadLanding) root.dataset.landing = hadLanding;
      else delete root.dataset.landing;
      root.style.backgroundColor = prevRootBg;
      root.style.color = prevRootColor;
      root.style.colorScheme = "";
      document.getElementById("milon-color-scheme")?.remove();
      body.style.backgroundColor = prevBodyBg;
      body.style.color = prevBodyColor;
    };
  }, []);

  /* ── vanilla-JS animations (scroll progress, reveal, count-up, quiz) ── */
  useEffect(() => {
    const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* scroll progress + nav */
    const prog = document.getElementById("progress") as HTMLElement | null;
    const topnav = document.getElementById("topnav") as HTMLElement | null;
    function onScroll() {
      const max = document.body.scrollHeight - innerHeight;
      if (prog) prog.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + "%";
      if (topnav) topnav.classList.toggle("scrolled", scrollY > 10);
    }
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* Cards below the first viewport may fade. Headings stay visible. */
    if (!REDUCE) document.documentElement.classList.add("js-motion");
    const fold = scrollY + innerHeight;
    if (!REDUCE) {
      document.querySelectorAll(".reveal,.stagger").forEach((el) => {
        if (el.classList.contains("section-head") || el.closest(".section-head")) return;
        const top = el.getBoundingClientRect().top + scrollY;
        if (top > fold) el.classList.add("is-below");
      });
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    document.querySelectorAll(".is-below").forEach((el) => io.observe(el));
    const revealFailSafe = window.setTimeout(() => {
      document.querySelectorAll(".reveal,.stagger").forEach((el) => el.classList.add("in"));
    }, 1500);

    /* count-up — hero finals are in the DOM from first paint; below-fold may animate */
    function fmt(n: number, f?: string) {
      return f === "space" ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : String(n);
    }
    const cio = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          const to = +(el.dataset.to || 0),
            f = el.dataset.fmt;
          cio.unobserve(el);
          if (REDUCE) {
            el.textContent = fmt(to, f);
            return;
          }
          const t0 = performance.now(),
            dur = 1400;
          (function tick(t: number) {
            const p = Math.min(1, (t - t0) / dur),
              ease = 1 - Math.pow(1 - p, 3);
            el.textContent = fmt(Math.round(to * ease), f);
            if (p < 1) requestAnimationFrame(tick);
          })(t0);
        }),
      { threshold: 0.6 },
    );
    document.querySelectorAll(".count").forEach((el) => {
      const node = el as HTMLElement;
      if (node.closest("#hero")) return;
      cio.observe(node);
    });

    /* dashboard mock — in hero; paint final gauge + pillar bars immediately */
    const dash = document.getElementById("dash");
    if (dash) {
      dash.classList.add("in");
      const g = document.getElementById("gaugeFill");
      if (g) g.style.strokeDashoffset = String(402 * (1 - 0.78));
      dash.querySelectorAll(".pill-row .bar i").forEach((b: any) => {
        b.style.width = b.dataset.w;
      });
    }

    /* pillar bars — final widths are in the markup; don't wait on scroll */
    const pg = document.getElementById("pillarGrid");
    if (pg) {
      pg.querySelectorAll(".score .bar i").forEach((b: any) => {
        if (b.dataset.w) b.style.width = b.dataset.w;
      });
    }

    /* marquee duplicate — guarded so re-running this effect (React StrictMode's
       double-invoke, or a Vite HMR update that reuses the existing DOM node)
       doesn't keep doubling the content on top of itself and balloon the page. */
    const mq = document.getElementById("marquee");
    if (mq && !REDUCE && mq.dataset.duplicated !== "true") {
      mq.innerHTML += mq.innerHTML;
      mq.dataset.duplicated = "true";
    }

    /* persona card glow */
    document.querySelectorAll(".persona-card").forEach((c: any) => {
      c.addEventListener("pointermove", (e: PointerEvent) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty("--mx", e.clientX - r.left + "px");
        c.style.setProperty("--my", e.clientY - r.top + "px");
      });
    });

    /* theme toggle */
    const tbtn = document.getElementById("themeToggle");
    if (tbtn) {
      tbtn.onclick = () => {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        applyLandingTheme(next);
        setLandingThemeRef.current(next);
      };
    }

    return () => {
      removeEventListener("scroll", onScroll);
      io.disconnect();
      cio.disconnect();
      clearTimeout(revealFailSafe);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = (role?: string) => {
      void import("@/lib/landing-quiz").then(({ mountLandingQuiz }) => {
        if (cancelled) return;
        mountLandingQuiz(role);
      });
    };
    const stub = (role?: string) => boot(role);
    const w = window as unknown as { __mq_start?: (role?: string) => void };
    w.__mq_start = stub;
    const quiz = document.getElementById("quiz");
    let io: IntersectionObserver | undefined;
    if (quiz && "IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            boot();
            io?.disconnect();
          }
        },
        { rootMargin: "500px" },
      );
      io.observe(quiz);
    } else {
      boot();
    }
    return () => {
      cancelled = true;
      io?.disconnect();
      if (w.__mq_start === stub) delete w.__mq_start;
    };
  }, []);

  useEffect(() => {
    if (window.location.hash === "#register") setRegisterReady(true);
    const el = document.getElementById("register");
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setRegisterReady(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRegisterReady(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const heroCta = document.querySelector("#hero .btn-gold");
    const register = document.getElementById("register");
    const mq = window.matchMedia("(max-width: 1023px)");
    if (!heroCta || !register) {
      setTrialBarOn(false);
      return;
    }
    let heroIn = true;
    let registerIn = false;
    const sync = () => {
      setTrialBarOn(mq.matches && !heroIn && !registerIn && !mobileNavOpen);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === heroCta) heroIn = entry.isIntersecting;
          if (entry.target === register) registerIn = entry.isIntersecting;
        }
        sync();
      },
      { threshold: 0 },
    );
    io.observe(heroCta);
    io.observe(register);
    mq.addEventListener("change", sync);
    sync();
    return () => {
      io.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, [mobileNavOpen]);

  const clearOwnerSignInError = () => {
    setSiError("");
    setSiUnconfirmed(false);
  };

  const openForgotPassword = () => {
    setFpEmail(siEmail);
    setFpMode(true);
    setFpDone(false);
    clearOwnerSignInError();
  };

  /* ── forgot-password handler ── */
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFpBusy(true);
    try {
      const { error } = await (await landingSupabase()).auth.resetPasswordForEmail(fpEmail, {
        redirectTo: browserAppUrl("/reset-password"),
      });
      if (error) throw error;
      setFpDone(true);
    } catch (err: unknown) {
      const failure = explainPasswordSignInFailure(err);
      setSiError(
        failure.kind === "other"
          ? err instanceof Error
            ? err.message
            : "Could not send reset email"
          : failure.message,
      );
    } finally {
      setFpBusy(false);
    }
  };

  /* ── sign-in handler ── */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (siSubmitLock.current) return;
    siSubmitLock.current = true;
    clearOwnerSignInError();
    setSiBusy(true);
    try {
      // Secret operator handles unlock the Lighthouse console door
      const id = siEmail.trim().toLowerCase();
      const handle = id.split("@")[0];
      if (["forge", "lighthouse", "keeper"].includes(handle) && !id.includes("@milon.co.za")) {
        await doUnlockOps({
          data: { username: handle, passphrase: siPassword },
        });
        try {
          sessionStorage.setItem(OPS_UNLOCK_KEY, "1");
        } catch {
          /* ignore */
        }
        setSigninOpen(false);
        setSiEmail("");
        setSiPassword("");
        toast.success("Operator door unlocked");
        if (user) {
          navigate({ to: "/ops" });
        } else {
          setOpsGateOpen(false);
          toast.message("Now sign in with your real Milōn owner email.");
          setTimeout(() => setSigninOpen(true), 400);
        }
        return;
      }

      if (!id.includes("@")) {
        throw new Error("Enter a valid email address.");
      }

      const granted = await (await landingSupabase()).auth.signInWithPassword({
        email: siEmail,
        password: siPassword,
      });
      // Returned `{ error }`, not a throw. Leave it on the form.
      if (granted.error) {
        const failure = explainPasswordSignInFailure(granted.error);
        setSiUnconfirmed(failure.kind === "email_not_confirmed");
        setSiError(failure.message);
        return;
      }
      setSiUnconfirmed(false);
      const { waitForAuthSession, stashInviteHandoff, clearInviteQueryFromUrl } =
        await import("@/lib/invite-handoff");
      await waitForAuthSession();
      const pendingInvite = inviteClientId || pendingInviteTokenFromUrl();
      setSigninOpen(false);
      let goOps = false;
      try {
        goOps = sessionStorage.getItem(OPS_UNLOCK_KEY) === "1";
      } catch {
        /* ignore */
      }
      // replace: true so the signed-in redirect effect cannot bounce us to /app
      // after a successful Lighthouse unlock.
      if (goOps) {
        void navigate({ to: "/ops", replace: true });
        return;
      }
      const pendingCheckout =
        peekPendingCheckout() ?? parsePendingCheckoutFromSearch(window.location.search);
      if (pendingCheckout) {
        consumeResumeFirmBilling();
        stashPendingCheckout(pendingCheckout);
        await setLandingPortal("accountant");
        const insightFirmId = await landingFirmId(granted.data.user?.id);
        if (readInsightSeen(insightFirmId)) {
          void navigate({
            to: "/billing/start",
            search: billingStartSearch(pendingCheckout),
            replace: true,
          });
        } else {
          void navigate({ to: "/dashboard", replace: true });
        }
        return;
      }
      if (pendingInvite) {
        const { forcePortal } = await import("@/lib/user-roles");
        forcePortal("owner");
        if (inviteNeedsCode && !regClientCode.trim()) {
          toast.message("Signed in. Enter the client code from your invite email, then accept.");
          document
            .getElementById("register")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        try {
          const accepted = (await doAcceptOwnerInvite({
            data: {
              inviteClientId: pendingInvite,
              inviteClientCode: regClientCode.trim() || null,
            },
          })) as { clientId?: string } | undefined;
          stashInviteHandoff(accepted?.clientId ?? null);
          clearInviteQueryFromUrl();
          setInviteClientId(null);
          toast.success("Welcome — opening your workspace.");
          await navigate({ to: "/app", replace: true });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not accept the invite.");
          document
            .getElementById("register")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      const { data: auth } = await (await landingSupabase()).auth.getUser();
      const uid = auth.user?.id;
      if (uid) {
        try {
          const resumeFirmBilling = consumeResumeFirmBilling();
          if (resumeFirmBilling) {
            const { listUserFirms, readActiveFirmId } = await import("@/lib/firm-brand");
            const firms = await listUserFirms(uid);
            const ownsFirm = firms.some((f) => f.owner_user_id === uid);
            const preferred = readActiveFirmId(uid);
            const insightFirmId =
              firms.find((f) => f.id === preferred)?.id ??
              firms.find((f) => f.owner_user_id === uid)?.id ??
              null;
            const resume = decidePostLoginBillingResume({
              hasPendingFirmCheckout: false,
              ownsFirm,
              resumeFirmBilling: true,
              insightSeen: readInsightSeen(insightFirmId),
            });
            if (resume === "workspace") {
              await setLandingPortal("accountant");
              void navigate({ to: "/dashboard", replace: true });
              return;
            }
            if (resume) {
              const pending = firmSignupCheckoutIntent(visitorCopyPack(draftMarket));
              stashPendingCheckout(pending);
              await setLandingPortal("accountant");
              void navigate({
                to: resume === "billing_start" ? "/billing/start" : "/billing/required",
                search: billingStartSearch(pending),
                replace: true,
              });
              return;
            }
          }
          // Same resolver as /auth. Practice accounts, including a profile
          // that has not loaded yet, open /dashboard. Owners and dual-role
          // accounts open /app.
          const { resolveSignedInDestination } = await import(
            "@/lib/landing-sign-in-destination"
          );
          const path = await resolveSignedInDestination(uid, {
            door: "landing",
            knownMeta: granted.data.user?.user_metadata as Record<string, unknown> | undefined,
          });
          void navigate({ to: path, replace: true });
        } catch (err) {
          console.warn("[landing] post-login path failed:", err);
          void navigate({ to: "/app", replace: true });
        }
      } else {
        void navigate({ to: "/app", replace: true });
      }
    } catch (err: unknown) {
      const failure = explainPasswordSignInFailure(err);
      setSiUnconfirmed(failure.kind === "email_not_confirmed");
      setSiError(
        failure.kind === "other"
          ? err instanceof Error
            ? err.message
            : "Sign in failed"
          : failure.message,
      );
    } finally {
      siSubmitLock.current = false;
      setSiBusy(false);
    }
  };

  const handleOpsUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setOpsError("");
    setOpsBusy(true);
    try {
      await doUnlockOps({
        data: { username: opsUser, passphrase: opsPass },
      });
      try {
        sessionStorage.setItem(OPS_UNLOCK_KEY, "1");
      } catch {
        /* ignore */
      }
      setOpsGateOpen(false);
      setOpsPass("");
      toast.success("Operator door unlocked");
      if (user) navigate({ to: "/ops" });
      else {
        setSigninOpen(true);
        toast.message("Sign in with your Milōn owner account to enter Lighthouse.");
      }
    } catch (err: unknown) {
      setOpsError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setOpsBusy(false);
    }
  };

  const onLogoSecretTap = (e: React.MouseEvent) => {
    e.preventDefault();
    // Hold Alt while clicking the wordmark once → open ops gate
    if (e.altKey) {
      setOpsGateOpen(true);
      setOpsError("");
      return;
    }
    const ref = logoTapRef.current;
    ref.count += 1;
    if (ref.timer) clearTimeout(ref.timer);
    // Open after 5 taps within ~3s (was 7 — too easy to mistime)
    if (ref.count >= 5) {
      ref.count = 0;
      setOpsGateOpen(true);
      setOpsError("");
      return;
    }
    ref.timer = setTimeout(() => {
      // Single intentional click → scroll to hero like a normal logo
      if (ref.count === 1) {
        const el = document.getElementById("hero");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      ref.count = 0;
    }, 2800);
  };

  /* ── register handler ── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError("");

    // ── Invite flow: create a user, or attach an existing signed-in account ──
    if (inviteClientId) {
      const sameAccount =
        Boolean(user) && user?.email?.toLowerCase() === regEmail.trim().toLowerCase();
      if (!sameAccount && (!regPassword || regPassword.length < 6)) {
        showRegisterError("Password must be at least 6 characters.");
        return;
      }
      if (inviteNeedsCode && !regClientCode.trim()) {
        showRegisterError("Enter the client code from your invite email (MLN-XXXXXX).");
        return;
      }
      setRegBusy(true);
      try {
        const { forcePortal } = await import("@/lib/user-roles");
        const {
          clearInviteQueryFromUrl,
          isEmailAlreadyRegistered,
          stashInviteHandoff,
          waitForAuthSession,
        } = await import("@/lib/invite-handoff");
        forcePortal("owner");

        // A leftover accountant session on this browser must not keep the
        // invitee in the wrong portal after they accept as the owner.
        if (user && user.email?.toLowerCase() !== regEmail.trim().toLowerCase()) {
          await (await landingSupabase()).auth.signOut({ scope: "local" });
        }

        let clientId: string | null = null;
        let needsExistingAccept = sameAccount;

        if (!sameAccount) {
          try {
            const created = (await doAdminSignUp({
              data: {
                email: regEmail,
                password: regPassword,
                fullName: regName.trim(),
                inviteClientId,
                inviteClientCode: regClientCode.trim() || null,
                signupType: "customer",
              },
            })) as { clientId?: string } | undefined;
            clientId = created?.clientId ?? null;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!isEmailAlreadyRegistered(msg)) throw err;
            needsExistingAccept = true;
          }
        }

        if (!sameAccount) {
          const { error: siErr } = await (await landingSupabase()).auth.signInWithPassword({
            email: regEmail,
            password: regPassword,
          });
          if (siErr) {
            if (needsExistingAccept && /invalid login credentials/i.test(siErr.message)) {
              throw new Error(
                "This email already has a Milōn account. Sign in with your existing password to accept the invite.",
              );
            }
            throw siErr;
          }
          await waitForAuthSession();
        }

        if (needsExistingAccept) {
          const accepted = (await doAcceptOwnerInvite({
            data: {
              inviteClientId,
              inviteClientCode: regClientCode.trim() || null,
            },
          })) as { clientId?: string } | undefined;
          clientId = accepted?.clientId ?? clientId;
        }

        stashInviteHandoff(clientId);
        clearInviteQueryFromUrl();
        setInviteClientId(null);
        toast.success("Welcome — opening your workspace.");
        await navigate({ to: "/app", replace: true });
      } catch (err: unknown) {
        showRegisterError(err instanceof Error ? err.message : "Registration failed.");
      } finally {
        setRegBusy(false);
      }
      return;
    }

    if (!regPassword || regPassword.length < 6) {
      showRegisterError("Password must be at least 6 characters.");
      return;
    }

    const market = draftToSelection(draftMarket);
    if (!market) {
      showRegisterError("Pick South Africa or the United States (and a state) first.");
      return;
    }

    // ── Firm signup (accountant / advisory) ────────────────────────────────
    if (regRole === "Accountant / Advisory firm") {
      if (!regFirmName.trim()) {
        showRegisterError("Enter your firm name.");
        return;
      }
      setRegBusy(true);
      try {
        await setLandingPortal("accountant");
        const promo = peekPendingCheckout()?.promo;
        const pending = {
          plan: paidPlanFromRegisterLabel(regPlan) ?? "solo",
          interval: firmInterval,
          market: visitorCopyPack(draftMarket),
          ...(promo ? { promo } : {}),
        };
        stashPendingCheckout(pending);
        const { data, error } = await (await landingSupabase()).auth.signUp({
          email: regEmail,
          password: regPassword,
          options: {
            emailRedirectTo: checkoutEmailRedirectTo(window.location.origin, pending),
            data: {
              full_name: regName.trim(),
              firm_name: regFirmName.trim(),
              signup_type: "accountant",
              market_country: market.country,
              market_region: market.regionCode,
            },
          },
        });
        if (signupLooksAlreadyRegistered({ errorMessage: error?.message, user: data?.user })) {
          promptSignInToFinishFirmBilling(regEmail);
          return;
        }
        if (error) throw error;
        notifySignup("Accountant firm", regEmail, regName.trim());
        // Production Auth auto-confirms: signUp returns a session and
        // confirmation_sent_at stays null, so this inbox screen is not the
        // path accountants or owners actually hit. Invited members are created
        // with email_confirm and also receive no confirmation mail.
        if (!data.session) {
          setRegDone(true);
          return;
        }
        if (data.user) {
          const { error: firmErr } = await (await landingSupabase()).rpc("ensure_practice_firm", {
            p_name: regFirmName.trim() || null,
            p_market: marketToJson(market),
          });
          if (firmErr) console.error("[signup] ensure_practice_firm failed:", firmErr.message);
          await welcomeWithoutBlockingSignup(() => doSendWelcome());
          const { forcePortal } = await import("@/lib/user-roles");
          forcePortal("accountant");
          // This firm was just created. It has not shown figures, so Checkout
          // waits. A flag stored for another firm must not send them to Stripe.
          navigate({ to: "/dashboard" });
          return;
        }
        setRegDone(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Registration failed.";
        if (signupLooksAlreadyRegistered({ errorMessage: msg })) {
          promptSignInToFinishFirmBilling(regEmail);
          return;
        }
        showRegisterError(msg);
      } finally {
        setRegBusy(false);
      }
      return;
    }

    // ── Standard owner signup ──────────────────────────────────────────────
    setRegBusy(true);
    try {
      const emailRedirectTo = paidSignupRedirectTo();
      const { data, error } = await (await landingSupabase()).auth.signUp({
        email: regEmail,
        password: regPassword,
        options: {
          emailRedirectTo,
          data: {
            full_name: regName.trim(),
            business_name: regBusiness.trim() || regName.trim(),
            signup_type: "customer",
            plan: regPlan,
            market_country: market.country,
            market_region: market.regionCode,
          },
        },
      });
      if (signupLooksAlreadyRegistered({ errorMessage: error?.message, user: data?.user })) {
        promptSignInExistingAccount(regEmail);
        return;
      }
      if (error) throw error;
      notifySignup("Business owner", regEmail, regName.trim());
      if (lhToken) {
        void doTrialVisit({ data: { token: lhToken, signedUp: true } }).catch(() => {});
      }
      if (data.session && data.user) {
        // Auto-confirm is on: the owner goes straight to the board. Mark the
        // address as not-yet-verified so /app can offer a soft "verify later"
        // link instead of a hard stop at the inbox.
        void (await landingSupabase()).auth
          .updateUser({ data: { email_verify_pending: true } })
          .catch(() => undefined);
        // Use ensure_own_client() RPC — direct INSERT via anon key is blocked by
        // a PostgREST WITH CHECK quirk in this project, so the SECURITY DEFINER
        // RPC is the reliable path for both auto-confirm and email-confirm signups.
        const clientName = regBusiness.trim() || regName.trim() || regEmail;
        const { error: rpcErr } = await withMarketRpcFallback(
          async () =>
            (await landingSupabase()).rpc("ensure_own_client", {
              p_name: clientName,
              p_market: { country: market.country, regionCode: market.regionCode },
            }),
          async () => (await landingSupabase()).rpc("ensure_own_client", { p_name: clientName }),
        );
        if (rpcErr) {
          // Don't block navigation — the /app effectiveClientId flow will retry.
          console.error("[signup] ensure_own_client failed:", rpcErr.message);
        }
        await welcomeWithoutBlockingSignup(() => doSendWelcome());
        const pendingCheckout = peekPendingCheckout();
        if (pendingCheckout) {
          navigate({
            to: "/billing/start",
            search: billingStartSearch(pendingCheckout),
          });
          return;
        }
        navigate({ to: "/app" });
        return;
      }
      setRegDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed.";
      if (signupLooksAlreadyRegistered({ errorMessage: msg })) {
        promptSignInExistingAccount(regEmail);
        return;
      }
      showRegisterError(msg);
    } finally {
      setRegBusy(false);
    }
  };

  const startFirmPlan = async (plan: FirmCheckoutBand, interval: FirmInterval = "month") => {
    const market = visitorCopyPack(draftMarket);
    const pending = { plan, interval, market };
    stashPendingCheckout(pending);
    setRegPlan(registerLabelForPlan(plan));
    setRegRole("Accountant / Advisory firm");
    await setLandingPortal("accountant");
    if (user) {
      const id = firmId ?? (await landingFirmId(user.id));
      if (readInsightSeen(id)) {
        void navigate({ to: "/billing/start", search: billingStartSearch(pending) });
      } else {
        void navigate({ to: "/dashboard" });
      }
      return;
    }
    toast.message(`Create your firm account to start ${registerLabelForPlan(plan)}.`);
    void navigate({ to: "/auth", search: { signup: true, plan, interval } });
  };

  const goToFirmSignup = async (opts?: {
    plan?: FirmCheckoutBand;
    scrollTo?: "register" | "pricing";
  }) => {
    const plan = opts?.plan ?? "solo";
    const market = visitorCopyPack(draftMarket);
    stashPendingCheckout({ plan, interval: firmInterval, market });
    setRegPlan(registerLabelForPlan(plan));
    setRegRole("Accountant / Advisory firm");
    await setLandingPortal("accountant");
    setRegisterReady(true);
    setMobileNavOpen(false);
    if (user) {
      const id = firmId ?? (await landingFirmId(user.id));
      if (readInsightSeen(id)) {
        void navigate({
          to: "/billing/start",
          search: billingStartSearch({ plan, interval: firmInterval, market }),
        });
      } else {
        void navigate({ to: "/dashboard" });
      }
      return;
    }
    const target = opts?.scrollTo ?? "register";
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToOwnerSpark = () => {
    clearPendingCheckout();
    setRegRole("Business owner");
    setRegPlan("Spark — Free early access");
    setRegisterReady(true);
    setMobileNavOpen(false);
    document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    (window as unknown as { __mq_firmSignup?: () => void }).__mq_firmSignup = () =>
      goToFirmSignup();
    return () => {
      delete (window as unknown as { __mq_firmSignup?: () => void }).__mq_firmSignup;
    };
  }, [draftMarket, firmInterval, user, firmId]);

  const activeInviteToken =
    inviteClientId ?? pendingInviteTokenFromUrl() ?? peekPendingOwnerInvite()?.token ?? null;
  const isOwnerInviteFlow = Boolean(activeInviteToken);

  useEffect(() => {
    if (!isOwnerInviteFlow) return;
    const el = document.documentElement;
    const hadDark = el.classList.contains("dark");
    el.classList.add("dark");
    return () => {
      if (!hadDark) el.classList.remove("dark");
    };
  }, [isOwnerInviteFlow]);

  /* ── email confirmation screen ── */
  if (regDone) {
    return (
      <div
        data-milon-landing=""
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 16px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: 28,
            padding: "44px 36px",
            background: "rgba(13,13,20,.96)",
            border: "1px solid rgba(212,175,55,.2)",
            boxShadow: "0 30px 80px rgba(0,0,0,.6)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(212,175,55,.1)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 22px",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#d4af37"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--gold-ink)",
              margin: "0 0 8px",
            }}
          >
            One step left
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f2ecdc", margin: "0 0 10px" }}>
            Confirm your email
          </h2>
          <p style={{ fontSize: 14, color: "#9b958a", lineHeight: 1.6 }}>
            We sent a link to <span style={{ color: "var(--gold-ink)" }}>{regEmail}</span>. Open it and your
            board opens straight away — a 2-minute business profile, then your figures.
          </p>
          <p style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.6, marginTop: 10 }}>
            Opened the link on your phone instead? Come back here and sign in.
          </p>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => {
              setRegDone(false);
              setSiEmail(regEmail);
              setSiError("");
              setSigninOpen(true);
            }}
            style={{ width: "100%", justifyContent: "center", marginTop: 22 }}
          >
            I've confirmed — sign in ✦
          </button>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 18,
              marginTop: 18,
              fontSize: 12,
            }}
          >
            <button
              type="button"
              disabled={resendBusy || resendCooldown > 0}
              onClick={handleResendConfirmation}
              style={{
                color: resendCooldown > 0 ? "var(--ink-dim)" : "var(--gold-ink)",
                background: "none",
                border: "none",
                cursor: resendCooldown > 0 ? "default" : "pointer",
                textDecoration: "underline",
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              {resendBusy
                ? "Sending…"
                : resendCooldown > 0
                  ? `Email sent · resend in ${resendCooldown}s`
                  : "Didn't get it? Resend"}
            </button>
            <button
              type="button"
              onClick={() => setRegDone(false)}
              style={{
                color: "#9b958a",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              Wrong email? Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* Owner invite: dedicated firm-grade accept surface — no marketing landing chrome.
     Gate on mounted to avoid SSR/client DOM mismatch (invite params are client-only). */
  if (mounted && isOwnerInviteFlow && !regDone) {
    return (
      <>
        <OwnerInviteShell
          businessName={inviteBusiness}
          loading={invitePreviewLoading && !invitePreviewError}
          loadingMessage="Verifying invitation…"
        >
          {!invitePreviewLoading || invitePreviewError ? (
            <OwnerInviteSignupPanel
              inviteToken={activeInviteToken!}
              businessName={inviteBusiness}
              inviteNeedsCode={inviteNeedsCode}
              inviteIsLegacyUuid={inviteIsLegacyUuid}
              regClientCode={regClientCode}
              onRegClientCodeChange={setRegClientCode}
              regName={regName}
              onRegNameChange={setRegName}
              regEmail={regEmail}
              onRegEmailChange={setRegEmail}
              regPassword={regPassword}
              onRegPasswordChange={setRegPassword}
              regBusy={regBusy}
              signedInEmail={user?.email}
              copyMarket={copyMarket}
              onSubmit={handleRegister}
              onSignInClick={() => {
                setSiError("");
                setSigninOpen(true);
              }}
              onGoogleError={(msg) => toast.error(msg)}
              previewError={invitePreviewError}
            />
          ) : null}
        </OwnerInviteShell>
        <OwnerInviteSigninOverlay
          open={signinOpen}
          onClose={() => {
            setSigninOpen(false);
            setSiError("");
          }}
          inviteToken={activeInviteToken!}
          regClientCode={regClientCode}
          siEmail={siEmail}
          onSiEmailChange={(value) => {
            setSiEmail(value);
            clearOwnerSignInError();
          }}
          siPassword={siPassword}
          onSiPasswordChange={(value) => {
            setSiPassword(value);
            clearOwnerSignInError();
          }}
          siBusy={siBusy}
          siError={siError}
          onSubmit={handleSignIn}
          onGoogleError={(msg) => setSiError(msg)}
          copyMarket={copyMarket}
        />
      </>
    );
  }

  /* Signed-in visitors bounce to /app or /dashboard. Don't flash the landing
     hero while that lookup runs. Invite accept stays on this page. */
  if (
    user &&
    !loading &&
    !inviteClientId &&
    !pendingInviteTokenFromUrl() &&
    !peekPendingOwnerInvite()
  ) {
    return (
      <div
        data-milon-landing=""
        style={{
          minHeight: "100vh",
          background: "#07090f",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-[#c9962b]/30 border-t-[#c9962b]"
          aria-label="Opening your workspace"
        />
      </div>
    );
  }

  /* ═══════════════════════════ MAIN RENDER ═══════════════════════════ */
  return (
    <div
      data-milon-landing=""
      className={trialBarOn ? "has-trial-bar" : undefined}
      style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {/* ── secret operator unlock (not linked in nav) ── */}
      {opsGateOpen && (
        <div
          className="milon-signin-modal"
          onClick={() => {
            setOpsGateOpen(false);
            setOpsError("");
          }}
        >
          <div className="milon-signin-box" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <h2 style={{ fontSize: 22 }}>Operator</h2>
              <button
                type="button"
                onClick={() => {
                  setOpsGateOpen(false);
                  setOpsError("");
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "1px solid var(--line)",
                  background: "transparent",
                  color: "var(--ink-dim)",
                  cursor: "pointer",
                  fontSize: 20,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                ×
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 18, lineHeight: 1.5 }}>
              Platform console. Username is <b style={{ color: "var(--gold-ink)" }}>lighthouse</b>.
            </p>
            <form onSubmit={handleOpsUnlock}>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-dim)",
                  marginBottom: 6,
                }}
              >
                Username
              </label>
              <input
                value={opsUser}
                onChange={(e) => setOpsUser(e.target.value)}
                autoComplete="off"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "var(--bg-2)",
                  color: "var(--ink)",
                  marginBottom: 14,
                }}
              />
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-dim)",
                  marginBottom: 6,
                }}
              >
                Passphrase
              </label>
              <input
                type="password"
                value={opsPass}
                onChange={(e) => setOpsPass(e.target.value)}
                autoComplete="off"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "var(--bg-2)",
                  color: "var(--ink)",
                  marginBottom: 14,
                }}
              />
              {opsError && (
                <p style={{ color: "#e25c5c", fontSize: 13, marginBottom: 12 }}>{opsError}</p>
              )}
              <button
                type="submit"
                className="btn btn-gold"
                disabled={opsBusy}
                style={{ width: "100%" }}
              >
                {opsBusy ? "Checking…" : "Unlock"}
              </button>
            </form>
          </div>
        </div>
      )}

      {signinOpen && (
        <Suspense fallback={null}>
          <LandingSignInModal
            fpMode={fpMode}
            fpDone={fpDone}
            fpEmail={fpEmail}
            fpBusy={fpBusy}
            siEmail={siEmail}
            siPassword={siPassword}
            siBusy={siBusy}
            siError={siError}
            siUnconfirmed={siUnconfirmed}
            resendBusy={resendBusy}
            resendCooldown={resendCooldown}
            inviteClientId={inviteClientId}
            regClientCode={regClientCode}
            copyMarket={copyMarket}
            firmId={firmId}
            onClose={() => {
              setSigninOpen(false);
              setFpMode(false);
              setFpDone(false);
              setSiError("");
            }}
            onSiEmailChange={(value) => {
              setSiEmail(value);
              setSiError("");
            }}
            onSiPasswordChange={(value) => {
              setSiPassword(value);
              setSiError("");
            }}
            onSubmit={handleSignIn}
            onGoogleError={(message) => setSiError(message)}
            onForgotPassword={openForgotPassword}
            onFpEmailChange={setFpEmail}
            onForgotSubmit={handleForgotPassword}
            onBackToSignIn={() => {
              setFpMode(false);
              setFpDone(false);
              setSiError("");
            }}
            onResend={() => void resendConfirmationTo(siEmail)}
            onCreateAccount={() => {
              setSigninOpen(false);
              setRegisterReady(true);
              document.getElementById("register")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        </Suspense>
      )}

      {/* Night sky: scrolls through the opening sections, then fades to --bg. */}
      <div id="landing-sky" aria-hidden="true">
        <div className="landing-sky-photo" />
        <div className="landing-sky-veil" />
      </div>
      {/* ── atmosphere ── */}
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="glow g3" />
        <div className="grid" />
        <div className="stars" />
      </div>
      <div id="progress" aria-hidden="true" />

      {/* ── nav ── */}
      <nav id="topnav" className={mobileNavOpen ? "nav-open" : undefined}>
        <div className="wrap">
          <a
            className="logo"
            href="#hero"
            title="MILŌN"
            onClick={(e) => {
              onLogoSecretTap(e);
              setMobileNavOpen(false);
            }}
          >
            <img src="/milon-centaur.svg" alt="" width={24} height={34} />
            <span className="logo-word gold-text">MILŌN</span>
          </a>
          <button
            type="button"
            className="nav-burger"
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="links">
            <a href="#method" onClick={() => setMobileNavOpen(false)}>
              The MILŌN Method
            </a>
            <a href="#how" onClick={() => setMobileNavOpen(false)}>
              How it works
            </a>
            <a href="#pricing" onClick={() => setMobileNavOpen(false)}>
              Pricing
            </a>
            <button
              id="themeToggle"
              type="button"
              title="Toggle light / dark"
              aria-label={
                landingTheme === "light" ? "Switch to dark theme" : "Switch to light theme"
              }
            >
              {landingTheme === "light" ? "☾" : "☀"}
            </button>
            <LandingSignInButton
              className="btn btn-ghost nav-signin"
              onClick={() => {
                setMobileNavOpen(false);
                setSiError("");
                setSigninOpen(true);
              }}
            />
            <a
              className="btn btn-gold nav-trial"
              href="#register"
              aria-label={NAV_TRIAL_ARIA}
              onClick={(e) => {
                e.preventDefault();
                goToFirmSignup({ scrollTo: "register" });
              }}
            >
              {NAV_TRIAL_LABEL}
            </a>
          </div>
        </div>
      </nav>

      <main id="main">
      {/* ══════════════════════════ HERO ══════════════════════════ */}
      <section id="hero">
        <div className="wrap">
          <div className="hero-copy">
            <span className="hero-badge">
              <span className="pulse" />
              <span>{HERO_BADGE}</span>
            </span>
            <h1>
              {HERO_H1_LEAD} <span className="gold-text">{HERO_H1_GOLD}</span>
            </h1>
            <p className="hero-lede">{HERO_LEDE}</p>
            <ul className="integrations-chips" id="integrations" aria-label="Works with">
              <li>QuickBooks Online</li>
              <li>Xero</li>
            </ul>
            <div className="hero-cta">
              <a
                className="btn btn-gold"
                href="#register"
                onClick={(e) => {
                  e.preventDefault();
                  goToFirmSignup({ scrollTo: "register" });
                }}
              >
                {HERO_CTA_LABEL}
              </a>
              {WALKTHROUGH_URL ? (
                <a
                  className="btn btn-ghost"
                  href={WALKTHROUGH_URL}
                  target="_blank"
                  rel="noopener"
                >
                  {HERO_WALKTHROUGH_LABEL}
                </a>
              ) : null}
            </div>
            <p className="hero-cta-note">{HERO_CTA_NOTE}</p>
            <ul className="hero-points">
              {HERO_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p className="hero-owner">
              {HERO_OWNER_PREFIX}{" "}
              <button type="button" onClick={goToOwnerSpark}>
                {PRICING_OWNER_CTA}
              </button>
            </p>
          </div>

          <div className="dash-stage hero-mock-fade">
            <div className="dash" id="dash" role="img" aria-label={DASH_ARIA_LABEL}>
              <div className="dash-top">
                <span className="brand">MILŌN</span>
                <span className="live-pill">
                  <i />
                  Sample client
                </span>
              </div>
              <div className="dash-main">
                <div className="gauge">
                  <svg width="150" height="150" viewBox="0 0 150 150">
                    <defs>
                      <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#fdee79" />
                        <stop offset=".6" stopColor="#d4af37" />
                        <stop offset="1" stopColor="#ac8400" />
                      </linearGradient>
                      <linearGradient id="cashGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor="#ac8400" />
                        <stop offset=".5" stopColor="#d4af37" />
                        <stop offset="1" stopColor="#fdee79" />
                      </linearGradient>
                      <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="rgba(212,175,55,.28)" />
                        <stop offset="1" stopColor="rgba(212,175,55,0)" />
                      </linearGradient>
                    </defs>
                    <circle className="track" cx="75" cy="75" r="64" fill="none" strokeWidth="9" />
                    <circle
                      className="fill"
                      id="gaugeFill"
                      cx="75"
                      cy="75"
                      r="64"
                      fill="none"
                      strokeWidth="9"
                      strokeDasharray="402"
                      strokeDashoffset={402 * (1 - 0.78)}
                    />
                  </svg>
                  <div className="val">
                    <div>
                      <b>78</b>
                      <span>Health score</span>
                    </div>
                  </div>
                </div>
                <div className="pillars">
                  <div className="pill-row">
                    <span className="nm">Financing</span>
                    <span className="bar">
                      <i data-w="82%" style={{ width: "82%" }} />
                    </span>
                    <b className="num">82</b>
                  </div>
                  <div className="pill-row">
                    <span className="nm">Assets</span>
                    <span className="bar">
                      <i data-w="74%" style={{ width: "74%" }} />
                    </span>
                    <b className="num">74</b>
                  </div>
                  <div className="pill-row">
                    <span className="nm">Profit</span>
                    <span className="bar">
                      <i data-w="81%" style={{ width: "81%" }} />
                    </span>
                    <b className="num">81</b>
                  </div>
                  <div className="pill-row warn">
                    <span className="nm">Cash</span>
                    <span className="bar">
                      <i data-w="61%" style={{ width: "61%" }} />
                    </span>
                    <b className="num">61</b>
                  </div>
                </div>
              </div>
              <div className="dash-chart">
                <div className="lbl">
                  <b>13-week cash forecast</b>
                  <span>
                    <RegionCopy pack={copyMarket.copyPack} za="R thousands" us="$ thousands" />
                  </span>
                </div>
                <svg
                  className="cash-svg"
                  viewBox="0 0 520 120"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    x1="0"
                    y1="96"
                    x2="520"
                    y2="96"
                    stroke="rgba(212,175,55,.14)"
                    strokeWidth="1"
                    strokeDasharray="3 5"
                  />
                  <path
                    className="cash-fill"
                    d="M0 58 C40 50,70 44,105 48 C140 52,165 66,200 78 C235 90,258 96,290 92 C322 88,345 70,385 56 C425 42,470 34,520 28 L520 120 L0 120 Z"
                    style={{ opacity: 1 }}
                  />
                  <path
                    className="cash-line"
                    d="M0 58 C40 50,70 44,105 48 C140 52,165 66,200 78 C235 90,258 96,290 92 C322 88,345 70,385 56 C425 42,470 34,520 28"
                    style={{ strokeDashoffset: 0 }}
                  />
                  <circle className="dip-ring" cx="272" cy="94" r="4" />
                  <circle className="dip-dot" cx="272" cy="94" r="4" />
                </svg>
                <div className="alert-chip">
                  <span className="dot" />
                  <span>
                    <b>Cash dip — Week 6.</b> <span>Action plan ready: 3 moves close the gap.</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="float-card fc-1">
              <span className="tag">Milōn Advisor draft · awaiting sign-off</span>
              <p>
                <RegionCopy
                  pack={copyMarket.copyPack}
                  za={
                    <>
                      Debtor days crept up to <b>52</b>. Chase your top 3 invoices this week —
                      that&apos;s <b>R184k</b> unlocked.
                    </>
                  }
                  us={
                    <>
                      DSO crept up to <b>52</b>. Chase your top 3 invoices this week — that&apos;s{" "}
                      <b>$10k</b> unlocked.
                    </>
                  }
                />
              </p>
            </div>
            <div className="float-card fc-2">
              <b>+9 pts</b>
              <span>Health score · this quarter</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ TRUST STRIP ══════════════════════════ */}
      <div className="trust">
        <div className="wrap">
          {TRUST_ITEMS.map((item) => (
            <div className="item" key={item}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{item}</span>
            </div>
          ))}
          <a className="trust-link" href="/ai">
            {TRUST_AI_LINK}
          </a>
        </div>
      </div>

      <section id="watch">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">{WATCH_EYEBROW}</span>
            <h2>{WATCH_TITLE}</h2>
            <p className="sub">{WATCH_SUB}</p>
          </div>
          <div className="watch-grid">
            <article className="watch-card">
              <p className="watch-label">{ACCOUNTANT_TEASER.label}</p>
              <h3>{ACCOUNTANT_TEASER.title}</h3>
              <p className="watch-meta">{ACCOUNTANT_TEASER.meta}</p>
              <LiteYouTube
                videoId={ACCOUNTANT_TEASER.videoId}
                title={ACCOUNTANT_TEASER.title}
                accessibleName={ACCOUNTANT_TEASER.accessibleName}
              />
              <a
                className="watch-cta"
                href="#register"
                onClick={(e) => {
                  e.preventDefault();
                  goToFirmSignup({ scrollTo: "register" });
                }}
              >
                {HERO_CTA_LABEL} →
              </a>
            </article>
            <article className="watch-card">
              <p className="watch-label">{OWNER_TEASER.label}</p>
              <h3>{OWNER_TEASER.title}</h3>
              <p className="watch-meta">{OWNER_TEASER.meta}</p>
              <LiteYouTube
                videoId={OWNER_TEASER.videoId}
                title={OWNER_TEASER.title}
                accessibleName={OWNER_TEASER.accessibleName}
              />
              <a
                className="watch-cta"
                href="#register"
                onClick={(e) => {
                  e.preventDefault();
                  goToOwnerSpark();
                }}
              >
                {OWNER_TEASER_LINK}
              </a>
            </article>
          </div>
        </div>
      </section>

      <section id="how" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>
              From financial statements to <span className="gold-text serif">decisions.</span>
            </h2>
          </div>
          <div className="steps how-steps stagger" style={{ marginTop: 56 }}>
            <div className="step-card">
              <span className="n">01</span>
              <h3>Bring in the financials</h3>
              <p>
                Connect QuickBooks Online or Xero, or upload the P&amp;L and balance sheet you
                already have as a PDF, Excel file, or CSV — or simply upload a bank statement.
              </p>
            </div>
            <div className="step-card">
              <span className="n">02</span>
              <h3>MILŌN understands the business</h3>
              <p>
                MILŌN analyzes 19 carefully selected financial ratios across four pillars of
                financial health. DuPont analysis helps break profitability down to identify where
                the underlying problem sits.
              </p>
            </div>
            <div className="step-card">
              <span className="n">03</span>
              <h3>AI prepares the next move</h3>
              <p>
                {HOW_STEP_03}
              </p>
            </div>
            <div className="step-card">
              <span className="n">04</span>
              <h3>Your accountant reviews and signs off</h3>
              <p>
                The accountant reviews the AI-generated analysis and recommendations, makes any
                necessary changes, and signs off every advisory pack.
              </p>
            </div>
            <div className="step-card">
              <span className="n">05</span>
              <h3>Actions get done</h3>
              <p>
                Recommendations become assigned actions that can be followed through and tracked —
                turning financial advice into an ongoing finance workflow.
              </p>
            </div>
          </div>
        </div>
      </section>


      <section id="proof">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">{PROOF_EYEBROW}</span>
            <h2>{PROOF_H2}</h2>
          </div>
          <div className="proof-grid">
            {PROOF_CARDS.map((card) => (
              <article className="proof-card" key={card.id}>
                <img
                  className="proof-shot"
                  src={proofImageSrc(card.base, 800)}
                  srcSet={proofImageSrcSet(card.base)}
                  sizes="(min-width:1024px) 33vw, 100vw"
                  width={card.width}
                  height={card.height}
                  alt={card.alt}
                  loading="lazy"
                  decoding="async"
                />
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
          <ul className="proof-facts">
            {PROOF_SECURITY_FACTS.map((fact) => (
              <li key={fact}>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
          <p className="proof-links">
            <a href="/ai">{PROOF_AI_LINK}</a>
            <a href="/privacy">{PROOF_PRIVACY_LINK}</a>
          </p>
        </div>
      </section>

      {/* ══════════════════════════ METHOD ══════════════════════════ */}
      <section id="method">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">The MILŌN Method</span>
            <h2>Four pillars. One financial picture.</h2>
            <p className="sub">
              MILŌN looks at the four forces that determine the financial health of a business.
            </p>
          </div>
          <div className="pillar-grid stagger" id="pillarGrid">
            <div className="pillar-card">
              <div className="node" />
              <h3>Profitability</h3>
              <div className="metaphor">The Sun</div>
              <p className="ask">
                Is the business actually making money, and what is driving its profitability?
              </p>
              <p>Gross margin, net margin, EBITDA, return on equity and the underlying drivers.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar">
                  <i data-w="81%" style={{ width: "81%" }} />
                </span>
                <b>81</b>
              </div>
            </div>
            <div className="pillar-card">
              <div className="node" />
              <h3>Cash Flow</h3>
              <div className="metaphor">The Orbit</div>
              <p className="ask">
                Is cash coming in and going out at a rate the business can sustain?
              </p>
              <p>
                Operating cash, working capital, cash conversion,{" "}
                <RegionCopy
                  pack={copyMarket.copyPack}
                  za="debtor days, creditor days"
                  us="DSO, DPO"
                />{" "}
                and a 13-week forecast.
              </p>
              <div className="score">
                <span>Demo</span>
                <span className="bar">
                  <i data-w="61%" style={{ width: "61%" }} />
                </span>
                <b>61</b>
              </div>
            </div>
            <div className="pillar-card warn">
              <div className="node" />
              <h3>Asset Productivity</h3>
              <div className="metaphor">The Mass</div>
              <p className="ask">
                How effectively is the business using the assets and working capital it already has?
              </p>
              <p>Inventory turnover, fixed-asset efficiency and working-capital performance.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar">
                  <i data-w="74%" style={{ width: "74%" }} />
                </span>
                <b>74</b>
              </div>
            </div>
            <div className="pillar-card">
              <div className="node" />
              <h3>Financing &amp; Solvency</h3>
              <div className="metaphor">The Gravity</div>
              <p className="ask">
                How is the business funded, and how much financial pressure is that creating?
              </p>
              <p>Debt, interest cover, gearing and solvency.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar">
                  <i data-w="82%" style={{ width: "82%" }} />
                </span>
                <b>82</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ MARQUEE ══════════════════════════ */}
      <div className="marquee-band">
        <div className="marquee-head">
          <p className="cap">Calculated on every upload</p>
          <button
            type="button"
            className="marquee-toggle"
            aria-pressed={marqueePaused}
            onClick={() => setMarqueePaused((paused) => !paused)}
          >
            {marqueePaused ? "Play" : "Pause"}
          </button>
        </div>
        <div className={marqueePaused ? "marquee is-paused" : "marquee"} id="marquee">
          <span>Net Margin</span>
          <span>Operating Margin</span>
          <span>Gross Margin</span>
          <span>Return on Equity</span>
          <span>Return on Assets</span>
          <span>Asset Turnover</span>
          <span>Equity Multiplier</span>
          <span>Interest Burden</span>
          <span>Tax Burden</span>
          <span>
            <RegionCopy pack={copyMarket.copyPack} za="Debtor Days" us="Days Sales Outstanding" />
          </span>
          <span>Inventory Days</span>
          <span>
            <RegionCopy
              pack={copyMarket.copyPack}
              za="Creditor Days"
              us="Days Payable Outstanding"
            />
          </span>
          <span>Working Capital Days</span>
          <span>Fixed Cost Ratio</span>
          <span>Degree of Operating Leverage</span>
          <span>Top-5 Customer Share</span>
          <span>
            <RegionCopy
              pack={copyMarket.copyPack}
              za="Gross Profit / Labour"
              us="Gross Profit / Labor"
            />
          </span>
          <span>Sales-per-Employee Ratio</span>
          <span>OCF / EBITDA</span>
        </div>
      </div>

      {/* ══════════════════════════ THE REAL GAP + HOW IT WORKS ══════════════════════════ */}
      <section id="problem" style={{ paddingTop: 80, paddingBottom: 40 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">The real gap</span>
            <h2>
              Small businesses have the numbers.
              <br />
              Large businesses have the <span className="gold-text serif">finance function.</span>
            </h2>
          </div>
          <p className="sub" style={{ marginTop: 24 }}>
            A small business can have the same financial statements as a large company without
            having the finance team behind them to interpret those numbers, spot problems early,
            forecast cash, and turn analysis into action.
          </p>
          <p className="sub" style={{ marginTop: 18 }}>
            MILŌN gives accountants a way to install that capability for their clients: an AI
            finance team that does the heavy analytical work, while the accountant stays in control
            of the advice.
          </p>
          <div className="bridge-facts stagger" aria-label="Your AI finance team">
            {FINANCE_TEAM.map((r) => (
              <div className="bridge-fact" key={r.name}>
                <div className="was">{r.name}</div>
                <div className="now">
                  {r.body} <b>{r.bold}</b>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="divider">
        <div className="wrap">
          <i />
        </div>
      </div>

      {/* ══════════════════════════ ONE SHARED WORKSPACE ══════════════════════════ */}
      <section id="bridge" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">One shared workspace</span>
            <h2>
              Your accountant&apos;s expertise. AI&apos;s analysis.{" "}
              <span className="gold-text serif">Your business.</span>
            </h2>
            <p className="sub">MILŌN brings both sides of the financial workflow together.</p>
            <p className="pipeline">
              AI prepares. Accountant reviews and signs off. Owner understands and acts.
            </p>
            <p className="sub">
              The result is a finance function that can follow the business — not just report on it.
            </p>
          </div>

          <div className="bridge-grid stagger">
            <div className="bridge-side">
              <div className="who">For accounting firms</div>
              <h3>Turn accounting data into an AI-powered finance function.</h3>
              <p>
                Your clients already depend on you for their financial information. MILŌN gives your
                firm a structured way to turn that information into ongoing financial analysis,
                recommendations, and action.
              </p>
              <ul>
                <li>
                  <b>{BRIDGE_DRAFT_LABEL}</b> — {BRIDGE_DRAFT_BODY}
                </li>
                <li>
                  <b>Accountant-controlled</b> — You review, edit and sign off every advisory
                  pack.
                </li>
                <li>
                  <b>One workflow</b> — Analysis, recommendations, deliverables, actions and
                  progress live in one workspace.
                </li>
                <li>
                  <b>QuickBooks Online and Xero</b> — Connect either ledger, or start from an
                  upload. The books stay where they are.
                </li>
                <li>
                  <b>Built to scale</b> — Give more clients access to a finance function without
                  manually building every analysis from scratch.
                </li>
              </ul>
            </div>

            <div className="bridge-link" aria-hidden="true">
              <span className="rail" />
              <span className="node">
                <span>MILŌN</span>
              </span>
              <span className="rail" />
              <span className="cap">One shared workspace</span>
            </div>

            <div className="bridge-side">
              <div className="who">For business owners</div>
              <h3>Finally understand what your numbers are telling you.</h3>
              <p>
                You shouldn&apos;t need to be a CFO to understand the financial state of your
                business.
              </p>
              <p>
                MILŌN gives you a clear view of your financial health, where the problems are, what
                they mean, where cash is heading, and what needs to happen next.
              </p>
              <p>
                Your accountant remains involved. You get the information in plain English, the
                recommendations they have reviewed, and a place to track what actually gets done.
              </p>
              <ul>
                <li>
                  <b>Clear</b> — One health score backed by the numbers behind it.
                </li>
                <li>
                  <b>Forward-looking</b> — See your 13-week cash forecast.
                </li>
                <li>
                  <b>Actionable</b> — Know what needs attention and what to do next.
                </li>
                <li>
                  <b>Trackable</b> — Follow actions and see whether the business is improving.
                </li>
              </ul>
            </div>
          </div>

          <div className="bridge-facts stagger">
            <div className="bridge-fact">
              <div className="was">Health → cash</div>
              <div className="now">
                One score, then where cash is heading.{" "}
                <b>Problems become visible before they become a surprise.</b>
              </div>
            </div>
            <div className="bridge-fact">
              <div className="was">Problems → recommendations</div>
              <div className="now">
                AI prepares the analysis.{" "}
                <b>The accountant reviews and signs off every advisory pack.</b>
              </div>
            </div>
            <div className="bridge-fact">
              <div className="was">Actions → progress</div>
              <div className="now">
                Recommendations become assigned work. <b>The owner can see what is getting done.</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="divider">
        <div className="wrap">
          <i />
        </div>
      </div>

      {/* ══════════════════════════ THE BIGGER IDEA ══════════════════════════ */}
      <section id="idea" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">The bigger idea</span>
            <h2>
              Give small businesses the financial intelligence
              <br />
              of a <span className="gold-text serif">much larger company.</span>
            </h2>
            <p className="sub">
              For years, sophisticated financial analysis and dedicated finance teams were largely
              available to businesses that could afford them.
            </p>
            <p className="sub">
              MILŌN is built around a different idea: the size of your business should not determine
              the quality of financial information available to you.
            </p>
            <p className="sub">
              An accountant can deploy MILŌN as the finance function behind the business, while the
              owner gets the clarity, visibility, and information to make better decisions.
            </p>
            <p className="idea-close">
              One platform. One financial picture. A finance function in your pocket.
            </p>
          </div>
        </div>
      </section>

      <div className="divider">
        <div className="wrap">
          <i />
        </div>
      </div>

      {/* ══════════════════════════ PRICING ══════════════════════════ */}
      <section id="pricing">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">Pricing for firms</span>
            <h2>{PRICING_H2_USD}</h2>
            <p className="sub">{PRICING_INTRO}</p>
          </div>

          <FirmBandPricingTable
            interval={firmInterval}
            onIntervalChange={setFirmInterval}
            onSelectBand={startFirmPlan}
            showSaPricing={showSaPricing}
          />

          <div className="owner-spark-path">
            <p>{PRICING_OWNER_BAR}</p>
            <button type="button" className="btn btn-ghost" onClick={goToOwnerSpark}>
              {PRICING_OWNER_CTA}
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ PERSONA ══════════════════════════ */}
      <section id="persona">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">Start here</span>
            <h2>Who are you in this story?</h2>
            <p className="sub">
              MILŌN is built for accounting firms first, and for the business owners they serve.
              Choose yours — the same workspace connects both.
            </p>
          </div>
          <div className="persona-grid stagger">
            <button
              type="button"
              className="persona-card"
              onClick={() => (window as any).__mq_start?.("accountant")}
            >
              <div className="icon">
                <svg viewBox="0 0 24 24">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <h3>Accountant / Advisory Firm</h3>
              <p>
                Your clients already depend on you for their financial information. MILŌN gives your
                firm an AI-powered finance function you can run across those clients — you review
                and sign off every advisory pack.
              </p>
              <div className="go">
                See MILŌN for my clients <i>→</i>
              </div>
            </button>
            <button
              type="button"
              className="persona-card"
              onClick={() => (window as any).__mq_start?.("owner")}
            >
              <div className="icon">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <h3>Business Owner</h3>
              <p>
                You shouldn&apos;t need to be a CFO to understand the financial state of your
                business. See your health, cash, problems, recommendations, and progress in one
                workspace.
              </p>
              <div className="go">
                Take the 90-second diagnostic <i>→</i>
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ QUIZ ══════════════════════════ */}
      <section id="quiz">
        <div className="wrap">
          <div className="quiz-shell">
            <div className="quiz-progress">
              <i id="qbar" />
            </div>
            <div id="qsteps" />
            <div className="quiz-reward" id="qreward" />
          </div>
        </div>
      </section>

      {/* ══════════════════════════ FAQ ══════════════════════════ */}
      <section id="home-faq">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">Questions</span>
            <h2>
              Straight answers, <span className="gold-text">before you sign up.</span>
            </h2>
          </div>
          <div className="home-faq">
            {homeFaq.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary>
                  <h3>{item.question}</h3>
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
          <p className="home-faq-more">
            {FAQ_MORE_LEAD}
            <a href="/faq">{FAQ_MORE_LINK}</a>
            {" · or email "}
            <a href={HERO_CONTACT_HREF}>{HERO_CONTACT_EMAIL}</a>
          </p>
        </div>
      </section>

      {/* ══════════════════════════ REGISTER ══════════════════════════ */}
      <section id="register" style={{ paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">Create a firm account</span>
            <h2>
              Accountants first.
              <br />
              <span className="gold-text">AI prepares; you sign off.</span>
            </h2>
            <p className="sub">
              {FIRM_CARD_TIMING} After day 14 the paid band bills automatically. Business owners can
              still start on Spark below, free during early access.
            </p>
          </div>

          {/* Client-only: prevents browser password-manager extensions (LastPass etc.)
              from injecting DOM nodes during SSR hydration and crashing React */}
          {mounted && registerReady ? (
            <Suspense fallback={<div className="reg-shell" style={{ minHeight: 480 }} />}>
              <LandingRegisterForm
                inviteClientId={inviteClientId}
                inviteBusiness={inviteBusiness}
                inviteNeedsCode={inviteNeedsCode}
                inviteIsLegacyUuid={inviteIsLegacyUuid}
                user={user}
                regClientCode={regClientCode}
                setRegClientCode={setRegClientCode}
                regBusy={regBusy}
                regError={regError}
                showRegisterError={showRegisterError}
                regName={regName}
                setRegName={setRegName}
                regEmail={regEmail}
                setRegEmail={setRegEmail}
                regPassword={regPassword}
                setRegPassword={setRegPassword}
                regRole={regRole}
                setRegRole={setRegRole}
                regPlan={regPlan}
                setRegPlan={setRegPlan}
                regFirmName={regFirmName}
                setRegFirmName={setRegFirmName}
                regBusiness={regBusiness}
                setRegBusiness={setRegBusiness}
                draftMarket={draftMarket}
                setDraftMarket={setDraftMarket}
                firmInterval={firmInterval}
                copyMarket={copyMarket}
                handleRegister={handleRegister}
                goToFirmSignup={goToFirmSignup}
                goToOwnerSpark={goToOwnerSpark}
              />
            </Suspense>
          ) : mounted ? (
            <div className="reg-shell" style={{ minHeight: 480 }} />
          ) : null}
        </div>
      </section>
      </main>


      {/* ══════════════════════════ FOOTER ══════════════════════════ */}
      <footer>
        <div className="wrap">
          <div>
            <span className="logo-word gold-text">MILŌN</span>
            <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              The AI-powered finance function
              <br />
              {DUAL_MARKET_TAGLINE}
            </span>
          </div>
          <nav className="fnav" aria-label="Footer navigation">
            <a
              href="#register"
              onClick={(e) => {
                e.preventDefault();
                goToFirmSignup();
              }}
            >
              Create firm account
            </a>
            <a href="#method">The Method</a>
            <a href="#how">How it works</a>
            <a href="#integrations">QuickBooks &amp; Xero</a>
            <a href="#bridge">Shared workspace</a>
            <a href="#pricing">Pricing</a>
            <a href="/for-owners">For owners</a>
            <a href="/for-accountants">For accountants</a>
            <a href="/about">About</a>
            <a href="#home-faq">Questions</a>
            <a href="/faq">All questions</a>
            <a href="/auth">Accountant portal</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/ai">AI notice</a>
            <button type="button" onClick={() => setSigninOpen(true)}>
              Sign in
            </button>
          </nav>
          <div className="copy">
            <span>{FIRM_CARD_TIMING}</span>
            <span>Works with QuickBooks Online and Xero.</span>
            <span>
              © {new Date().getFullYear()} Eish2oh (Pty) Ltd. Trading as MILŌN. All rights reserved.
            </span>
            <span>
              <a href="/privacy" style={{ color: "inherit" }}>
                Privacy
              </a>
              {" · "}
              <a href="/terms" style={{ color: "inherit" }}>
                Terms
              </a>
              {" · "}
              <a href="/ai" style={{ color: "inherit" }}>
                AI notice
              </a>
              {" · "}
              {DUAL_MARKET_BUILT}
            </span>
            <span>
              <a href={PREFERRED_SOURCE_HREF} target="_blank" rel="noopener">
                {PREFERRED_SOURCE_LABEL}
              </a>
            </span>
          </div>
        </div>
      </footer>

      <div
        className={trialBarOn ? "trial-sticky is-on" : "trial-sticky"}
        aria-hidden={trialBarOn ? undefined : true}
      >
        <a
          className="btn btn-gold"
          href="#register"
          aria-label={NAV_TRIAL_ARIA}
          tabIndex={trialBarOn ? undefined : -1}
          onClick={(e) => {
            e.preventDefault();
            goToFirmSignup({ scrollTo: "register" });
          }}
        >
          {NAV_TRIAL_LABEL}
        </a>
      </div>
    </div>
  );
}
