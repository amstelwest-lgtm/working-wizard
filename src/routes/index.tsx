import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { notifySignup } from "@/lib/signup-notify";
import { adminSignUp, acceptOwnerInvite } from "@/lib/auth.functions";
import { previewOwnerInvite } from "@/lib/invite-tokens.functions";
import { OPS_UNLOCK_KEY, unlockOwnerOps } from "@/lib/owner-ops.functions";
import { registerLighthouseTrialVisit } from "@/lib/lighthouse.functions";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { FirmBandPricingTable } from "@/components/firm-band-pricing";
import { MarketPicker } from "@/components/market-picker";
import { RegionCopy } from "@/components/marketing-shell";
import {
  applyVisitorMarketToDocument,
  draftToSelection,
  isDraftComplete,
  LIST_PRICES,
  marketToJson,
  readVisitorDraft,
  t,
  visitorCopyPack,
  VISITOR_MARKET_BOOT_SCRIPT,
  withMarketRpcFallback,
  writeVisitorDraft,
  type DraftMarket,
} from "@/lib/market";
// Inline so landing paint doesn't wait on a second stylesheet round-trip
// (external app CSS can still load; these rules win for landing selectors).
import landingCss from "../styles/landing.css?inline";
import { peekPendingOwnerInvite, pendingInviteTokenFromSearch } from "@/lib/invite-handoff";
import {
  billingStartPath,
  billingStartSearch,
  checkoutEmailRedirectTo,
  clearPendingCheckout,
  paidPlanFromRegisterLabel,
  parsePendingCheckoutFromSearch,
  peekPendingCheckout,
  registerLabelForPlan,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { stashAccountantGoogleSignup } from "@/lib/google-auth";
import { forcePortal, setPortalIntent } from "@/lib/user-roles";
import {
  starterCheckoutIntent,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import { HOMEPAGE_FAQ_ITEMS } from "@/lib/marketing-faq";
import { faqPageJson, pageHead, SEO_PAGES } from "@/lib/seo";
import { OwnerInviteShell } from "@/components/owner-invite-shell";
import { OwnerInviteSignupPanel } from "@/components/owner-invite-signup-panel";
import { OwnerInviteSigninOverlay } from "@/components/owner-invite-signin-overlay";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    ...pageHead(SEO_PAGES.home),
    styles: [{ children: landingCss }],
    scripts: [
      {
        children: `(function(){try{var d=document.documentElement;d.dataset.landing="1";var t="dark";try{var s=localStorage.getItem("milon.landing.theme");if(s==="light"||s==="dark")t=s;}catch(e){}d.dataset.theme=t;var light=t==="light";if(light){d.classList.remove("dark");d.style.backgroundColor="#f7f4ec";d.style.color="#1b1608";d.style.colorScheme="only light";}else{d.classList.add("dark");d.style.backgroundColor="#050507";d.style.color="#f2ecdc";d.style.colorScheme="only dark";}var m=document.getElementById("milon-color-scheme");if(!m){m=document.createElement("meta");m.id="milon-color-scheme";m.setAttribute("name","color-scheme");(document.head||d).appendChild(m);}m.setAttribute("content",light?"only light":"only dark");}catch(e){}})();`,
      },
      { children: VISITOR_MARKET_BOOT_SCRIPT },
      { type: "application/ld+json", children: faqPageJson(HOMEPAGE_FAQ_ITEMS) },
    ],
  }),
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
  if (tbtn) tbtn.textContent = theme === "light" ? "☾" : "☀";
  try {
    localStorage.setItem(LANDING_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

/* ─────────────────────────────────────────────────────────────── */

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const doAdminSignUp = useServerFn(adminSignUp);
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siBusy, setSiBusy] = useState(false);
  const [siError, setSiError] = useState("");

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
  const [regPlan, setRegPlan] = useState("Starter");
  const [firmInterval, setFirmInterval] = useState<FirmInterval>("month");
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState("");
  const [regDone, setRegDone] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [siUnconfirmed, setSiUnconfirmed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending =
      parsePendingCheckoutFromSearch(window.location.search) ?? peekPendingCheckout();
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

  const paidSignupRedirectTo = () => {
    const pending = peekPendingCheckout();
    return pending
      ? checkoutEmailRedirectTo(window.location.origin, pending)
      : `${window.location.origin}/app`;
  };

  const resendConfirmationTo = async (email: string) => {
    const target = email.trim();
    if (!target) return;
    setResendBusy(true);
    try {
      const { error } = await supabase.auth.resend({
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
      const pendingCheckout =
        peekPendingCheckout() ?? parsePendingCheckoutFromSearch(window.location.search);
      if (pendingCheckout) {
        stashPendingCheckout(pendingCheckout);
        if (!cancelled) {
          navigate({
            to: "/billing/start",
            search: billingStartSearch(pendingCheckout),
            replace: true,
          });
        }
        return;
      }
      try {
        const { resolvePostLoginPath } = await import("@/lib/user-roles");
        const path = await resolvePostLoginPath(user.id);
        if (!cancelled) navigate({ to: path });
      } catch (err) {
        console.warn("[landing] post-login redirect failed:", err);
        if (!cancelled) navigate({ to: "/app" });
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

    /* intersection reveal */
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.13 },
    );
    document.querySelectorAll(".reveal,.stagger").forEach((el) => io.observe(el));

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

    /* pillar bars */
    const pg = document.getElementById("pillarGrid");
    if (pg) {
      const pio = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (!e.isIntersecting) return;
            pio.unobserve(pg);
            pg.querySelectorAll(".score .bar i").forEach((b: any, i) => {
              setTimeout(
                () => {
                  b.style.width = b.dataset.w;
                },
                350 + i * 160,
              );
            });
          }),
        { threshold: 0.3 },
      );
      pio.observe(pg);
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
      };
    }

    /* ── quiz engine ── */
    const QUIZ: Record<
      string,
      Array<{ q: string; hint: string; opts: string[][]; key: string; reward: string }>
    > = {
      owner: [
        {
          q: "What does your business do?",
          hint: "This places your first planet.",
          opts: [
            ["🛍", "Retail / E-commerce"],
            ["🔧", "Services"],
            ["🏗", "Construction"],
            ["🍽", "Hospitality"],
            ["🏭", "Manufacturing"],
            ["🚚", "Transport / Logistics"],
          ],
          key: "industry",
          reward: "✦ Industry mapped — your sun just ignited.",
        },
        {
          q: "How do customers pay you?",
          hint: "This shapes your cash orbit.",
          opts: [
            ["⚡", "Upfront / on the spot"],
            ["📅", "On account — 30+ days"],
            ["🔁", "Monthly retainers"],
            ["🧩", "A mix of everything"],
          ],
          key: "cashcycle",
          reward: "✦ Cash cycle charted — second planet in orbit.",
        },
        {
          q: "What keeps you up at night?",
          hint: "Be honest. We've heard it all.",
          opts: [
            ["💧", "Cash runs dry before month-end"],
            ["❓", "I don't know if I'm actually profitable"],
            ["⛓", "Debt is eating my margins"],
            ["🐢", "Customers pay me late"],
          ],
          key: "pain",
          reward: "✦ Pain point locked. Now we can aim.",
        },
        {
          q: "Roughly, your annual turnover?",
          hint: "This sets your peer group.",
          opts: [
            ["🌑", "Under R1m"],
            ["🌓", "R1m – R5m"],
            ["🌔", "R5m – R20m"],
            ["🌕", "R20m+"],
          ],
          key: "size",
          reward: "✦ Constellation complete.",
        },
      ],
      accountant: [
        {
          q: "What does your practice mostly do today?",
          hint: "This places your first star.",
          opts: [
            ["📋", "Compliance & tax"],
            ["📊", "Bookkeeping & payroll"],
            ["💼", "Some advisory already"],
            ["🚀", "Full CFO services"],
          ],
          key: "industry",
          reward: "✦ Practice profile started.",
        },
        {
          q: "How many SME clients do you serve?",
          hint: "This sizes your constellation.",
          opts: [
            ["✦", "1 – 10"],
            ["✦✦", "11 – 50"],
            ["✦✦✦", "51 – 150"],
            ["🌌", "150+"],
          ],
          key: "cashcycle",
          reward: "✦ Client universe mapped.",
        },
        {
          q: "What's your biggest frustration?",
          hint: "The thing that steals your margin.",
          opts: [
            ["⏳", "Clients only call in a crisis"],
            ["💸", "Can't charge for the advice I give"],
            ["🗂", "Data arrives late and messy"],
            ["📉", "Compliance fees keep shrinking"],
          ],
          key: "pain",
          reward: "✦ Pain point locked. This is fixable.",
        },
        {
          q: "What would change your practice most?",
          hint: "Your north star.",
          opts: [
            ["💰", "Recurring advisory revenue"],
            ["🛰", "Live oversight of every client"],
            ["🏷", "Reports with my brand on them"],
            ["🤝", "Deeper client relationships"],
          ],
          key: "size",
          reward: "✦ Constellation complete.",
        },
      ],
    };
    const REFLECT: Record<string, Record<string, string[]>> = {
      owner: {
        "💧": [
          "cash flow",
          "Cash is leaving faster than it arrives. <b>MILŌN's 13-week cash forecast shows where it is heading — and the accountant-reviewed actions that can change the picture.</b>",
        ],
        "❓": [
          "profit clarity",
          "You have the numbers, but not a finance function to interpret them. <b>MILŌN turns those figures into one health score, 19 ratios with the workings shown, and a clear view of what is driving profitability.</b>",
        ],
        "⛓": [
          "debt pressure",
          "Financing is creating pressure you can feel but not always name. <b>MILŌN scores how the business is funded — debt, interest cover, gearing and solvency — so the next move is specific.</b>",
        ],
        "🐢": [
          "slow payers",
          "Late payers are using you as a free bank. <b>MILŌN shows cash conversion, DSO and DPO, then turns the analysis into recommended actions your accountant can review and assign.</b>",
        ],
      },
      accountant: {
        "⏳": [
          "crisis-only clients",
          "Clients come to you after the damage is done. <b>MILŌN gives your firm an AI-powered finance function to run across clients — analysis, recommendations, and tracked actions in one workspace.</b>",
        ],
        "💸": [
          "unbilled advice",
          "Your clients already depend on you for their financial information. <b>MILŌN gives your firm a structured way to turn that information into ongoing financial analysis, recommendations, and action.</b>",
        ],
        "🗂": [
          "messy data",
          "Advice is only as good as the figures in front of you. <b>Upload the P&amp;L, balance sheet, or bank statement you already have — MILŌN prepares the analysis, and you review and sign off.</b>",
        ],
        "📉": [
          "fee compression",
          "Compliance work is not the same as a finance function. <b>MILŌN lets you give more clients access to that capability without building every analysis from scratch — you stay in control of the advice.</b>",
        ],
      },
    };
    let qRole = "owner",
      step = 0,
      answers: Record<string, { em: string; label: string }> = {};

    function startQuiz(r: string) {
      const raw = (window as unknown as { __milonDraftMarket?: DraftMarket }).__milonDraftMarket;
      const draft =
        raw?.country === "ZA"
          ? raw
          : raw?.country === "US"
            ? raw
            : { country: "US" as const, regionCode: null };
      qRole = r;
      step = 0;
      answers = {};
      document.body.classList.remove("persona-owner", "persona-accountant");
      document.body.classList.add("persona-" + r);
      document.body.classList.toggle("market-us", draft.country === "US");
      const ownerQuiz = QUIZ.owner as Array<{ key: string; q: string; opts: string[][] }>;
      const sizeQ = ownerQuiz.find((s) => s.key === "size");
      if (sizeQ) {
        if (draft.country === "US") {
          sizeQ.q = "Roughly, your annual revenue?";
          sizeQ.opts = [
            ["🌑", "Under $1m"],
            ["🌓", "$1m – $5m"],
            ["🌔", "$5m – $20m"],
            ["🌕", "$20m+"],
          ];
        } else {
          sizeQ.q = "Roughly, your annual turnover?";
          sizeQ.opts = [
            ["🌑", "Under R1m"],
            ["🌓", "R1m – R5m"],
            ["🌔", "R5m – R20m"],
            ["🌕", "R20m+"],
          ];
        }
      }
      const quiz = document.getElementById("quiz");
      if (quiz) {
        quiz.classList.add("active");
        quiz.scrollIntoView({ behavior: "smooth" });
      }
      renderStep();
    }
    function renderStep() {
      const steps = QUIZ[qRole],
        holder = document.getElementById("qsteps");
      const qbar = document.getElementById("qbar");
      if (qbar) qbar.style.width = (step / steps.length) * 100 + "%";
      if (step >= steps.length) {
        renderResult();
        return;
      }
      const s = steps[step];
      if (holder)
        holder.innerHTML = `<div class="q-step on">
        <h3>${s.q}</h3>
        <p class="hint">${s.hint} <span style="color:var(--gold)">Question ${step + 1} of ${steps.length}</span></p>
        <div class="opt-grid">${s.opts.map((o) => `<button class="opt" onclick="window.__mq_pick('${s.key}','${o[0]}','${o[1].replace(/'/g, "\\'")}',this)"><span class="em">${o[0]}</span>${o[1]}</button>`).join("")}</div>
      </div>`;
      const qreward = document.getElementById("qreward");
      if (qreward) qreward.textContent = "";
    }
    function pick(key: string, em: string, label: string, el: Element) {
      document.querySelectorAll(".opt").forEach((b) => b.classList.remove("picked"));
      el.classList.add("picked");
      answers[key] = { em, label };
      const qreward = document.getElementById("qreward");
      if (qreward) qreward.textContent = QUIZ[qRole][step].reward;
      setTimeout(() => {
        step++;
        renderStep();
      }, 850);
    }
    function renderResult() {
      const qbar = document.getElementById("qbar");
      if (qbar) qbar.style.width = "100%";
      const a = answers;
      const r = REFLECT[qRole][a.pain?.em] || Object.values(REFLECT[qRole])[0];
      const lines =
        qRole === "owner"
          ? `<p>Industry: <b>${a.industry?.label}</b></p><p>Cash cycle: <b>${a.cashcycle?.label}</b></p><p>Size band: <b>${a.size?.label}</b></p>`
          : `<p>Practice focus: <b>${a.industry?.label}</b></p><p>Client base: <b>${a.cashcycle?.label}</b></p><p>North star: <b>${a.size?.label}</b></p>`;
      const cta =
        qRole === "accountant"
          ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px">
          <button class="btn btn-gold" type="button" onclick="window.__mq_firmSignup()">Create firm account ✦</button>
          <a class="btn btn-ghost" href="#pricing">See firm pricing</a>
          <button class="btn btn-ghost" onclick="window.__mq_start('${qRole}')">Redo questions</button>
        </div>`
          : `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px">
          <a class="btn btn-gold" href="#register">Unlock my full diagnostic ✦</a>
          <button class="btn btn-ghost" onclick="window.__mq_start('${qRole}')">Redo questions</button>
        </div>`;
      const hint =
        qRole === "accountant"
          ? "Firm bands and a firm account are on this page — no extra quiz required."
          : "Your health score, cash forecast, and recommended next actions are one step away.";
      const holder = document.getElementById("qsteps");
      if (holder)
        holder.innerHTML = `<div class="q-step on">
        <p class="eyebrow">Your business, sketched</p>
        <h3>Here's what we see.</h3>
        <div class="mini-biz">
          <div class="mini-orrery">
            <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
            <div class="core"></div>
            <div class="dot" style="top:6%;left:48%"></div>
            <div class="dot" style="top:42%;left:84%"></div>
            <div class="dot" style="top:74%;left:14%"></div>
          </div>
          <div class="profile-lines">${lines}<p>Biggest worry: <b>${a.pain?.label}</b></p></div>
        </div>
        <div class="reflect"><span class="serif gold-text">"${a.pain?.label}."</span><br>${r[1]}</div>
        <p class="hint">${hint}</p>
        ${cta}
      </div>`;
      const qreward = document.getElementById("qreward");
      if (qreward) qreward.textContent = "";
    }
    function pickPlan(p: string) {
      const sel = document.getElementById("regPlan") as HTMLSelectElement | null;
      if (sel)
        [...sel.options].forEach((o) => {
          if (o.value.startsWith(p)) sel.value = o.value;
        });
    }

    (window as any).__mq_start = startQuiz;
    (window as any).__mq_pick = pick;
    (window as any).__mq_plan = pickPlan;

    return () => {
      removeEventListener("scroll", onScroll);
      io.disconnect();
      cio.disconnect();
      delete (window as any).__mq_start;
      delete (window as any).__mq_pick;
      delete (window as any).__mq_plan;
    };
  }, []);

  /* ── forgot-password handler ── */
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFpBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(fpEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setFpDone(true);
    } catch (err: unknown) {
      setSiError(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setFpBusy(false);
    }
  };

  /* ── sign-in handler ── */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiError("");
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

      const { error } = await supabase.auth.signInWithPassword({
        email: siEmail,
        password: siPassword,
      });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          setSiUnconfirmed(true);
          throw new Error(
            "Your email isn't confirmed yet. Open the link we sent you, or resend it below.",
          );
        }
        if (/invalid login credentials/i.test(error.message)) {
          throw new Error(
            "Email or password didn't match. Check for typos, or use “Forgot password?”.",
          );
        }
        throw error;
      }
      setSiUnconfirmed(false);
      const {
        waitForAuthSession,
        stashInviteHandoff,
        clearInviteQueryFromUrl,
      } = await import("@/lib/invite-handoff");
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
        stashPendingCheckout(pendingCheckout);
        void navigate({
          to: "/billing/start",
          search: billingStartSearch(pendingCheckout),
          replace: true,
        });
        return;
      }
      if (pendingInvite) {
        const { forcePortal } = await import("@/lib/user-roles");
        forcePortal("owner");
        if (inviteNeedsCode && !regClientCode.trim()) {
          toast.message("Signed in. Enter the client code from your invite email, then accept.");
          document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (uid) {
        try {
          const { resolvePostLoginPath, forcePortal } = await import("@/lib/user-roles");
          forcePortal("owner");
          const path = await resolvePostLoginPath(uid);
          void navigate({ to: path, replace: true });
        } catch (err) {
          console.warn("[landing] post-login path failed:", err);
          void navigate({ to: "/app", replace: true });
        }
      } else {
        void navigate({ to: "/app", replace: true });
      }
    } catch (err: unknown) {
      setSiError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
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
          await supabase.auth.signOut({ scope: "local" });
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
          const { error: siErr } = await supabase.auth.signInWithPassword({
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
        setPortalIntent("accountant");
        const starter = starterCheckoutIntent(market.country === "ZA" ? "za" : "us");
        if (!peekPendingCheckout()) stashPendingCheckout(starter);
        const pending = peekPendingCheckout() ?? starter;
        const { data, error } = await supabase.auth.signUp({
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
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          toast.message("That email already has a Milōn account — sign in instead.");
          setSiEmail(regEmail);
          setSiError("");
          setSigninOpen(true);
          return;
        }
        notifySignup("Accountant firm", regEmail, regName.trim());
        if (!data.session) {
          setRegDone(true);
          return;
        }
        if (data.user) {
          const { error: firmErr } = await supabase.rpc("ensure_practice_firm", {
            p_name: regFirmName.trim() || null,
            p_market: marketToJson(market),
          });
          if (firmErr) console.error("[signup] ensure_practice_firm failed:", firmErr.message);
          forcePortal("accountant");
          navigate({
            to: "/billing/start",
            search: billingStartSearch(pending),
          });
          return;
        }
        setRegDone(true);
      } catch (err: unknown) {
        showRegisterError(err instanceof Error ? err.message : "Registration failed.");
      } finally {
        setRegBusy(false);
      }
      return;
    }

    // ── Standard owner signup ──────────────────────────────────────────────
    setRegBusy(true);
    try {
        const emailRedirectTo = paidSignupRedirectTo();
        const { data, error } = await supabase.auth.signUp({
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
      if (error) throw error;
      // With email confirmation on, Supabase returns an obfuscated user with no
      // identities for an address that already has an account. Send them to
      // sign in instead of a "check your email" card for a mail that never comes.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        toast.message("That email already has a Milōn account — sign in instead.");
        setSiEmail(regEmail);
        setSiError("");
        setSigninOpen(true);
        return;
      }
      notifySignup("Business owner", regEmail, regName.trim());
      if (lhToken) {
        void doTrialVisit({ data: { token: lhToken, signedUp: true } }).catch(() => {});
      }
      if (data.session && data.user) {
        // Auto-confirm is on: the owner goes straight to the board. Mark the
        // address as not-yet-verified so /app can offer a soft "verify later"
        // link instead of a hard stop at the inbox.
        void supabase.auth
          .updateUser({ data: { email_verify_pending: true } })
          .catch(() => undefined);
        // Use ensure_own_client() RPC — direct INSERT via anon key is blocked by
        // a PostgREST WITH CHECK quirk in this project, so the SECURITY DEFINER
        // RPC is the reliable path for both auto-confirm and email-confirm signups.
        const clientName = regBusiness.trim() || regName.trim() || regEmail;
        const { error: rpcErr } = await withMarketRpcFallback(
          () =>
            supabase.rpc("ensure_own_client", {
              p_name: clientName,
              p_market: { country: market.country, regionCode: market.regionCode },
            }),
          () => supabase.rpc("ensure_own_client", { p_name: clientName }),
        );
        if (rpcErr) {
          // Don't block navigation — the /app effectiveClientId flow will retry.
          console.error("[signup] ensure_own_client failed:", rpcErr.message);
        }
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
      showRegisterError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setRegBusy(false);
    }
  };

  const startFirmPlan = (plan: FirmCheckoutBand, interval: FirmInterval = "month") => {
    const market = visitorCopyPack(draftMarket);
    const pending = { plan, interval, market };
    stashPendingCheckout(pending);
    setRegPlan(registerLabelForPlan(plan));
    setRegRole("Accountant / Advisory firm");
    setPortalIntent("accountant");
    if (user) {
      void navigate({ to: "/billing/start", search: billingStartSearch(pending) });
      return;
    }
    toast.message(`Create your firm account to start ${registerLabelForPlan(plan)}.`);
    void navigate({ to: "/auth", search: { signup: true } });
  };

  const goToFirmSignup = (opts?: { plan?: FirmCheckoutBand; scrollTo?: "register" | "pricing" }) => {
    const plan = opts?.plan ?? "starter";
    const market = visitorCopyPack(draftMarket);
    stashPendingCheckout({ plan, interval: firmInterval, market });
    setRegPlan(registerLabelForPlan(plan));
    setRegRole("Accountant / Advisory firm");
    setPortalIntent("accountant");
    setMobileNavOpen(false);
    const target = opts?.scrollTo ?? "register";
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToOwnerSpark = () => {
    clearPendingCheckout();
    setRegRole("Business owner");
    setRegPlan("Spark — Free early access");
    setMobileNavOpen(false);
    document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    (window as unknown as { __mq_firmSignup?: () => void }).__mq_firmSignup = () => goToFirmSignup();
    return () => {
      delete (window as unknown as { __mq_firmSignup?: () => void }).__mq_firmSignup;
    };
  }, [draftMarket, firmInterval]);

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
              color: "#d4af37",
              margin: "0 0 8px",
            }}
          >
            One step left
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f2ecdc", margin: "0 0 10px" }}>
            Confirm your email
          </h2>
          <p style={{ fontSize: 14, color: "#9b958a", lineHeight: 1.6 }}>
            We sent a link to <span style={{ color: "#d4af37" }}>{regEmail}</span>. Open it and your
            board opens straight away — a 2-minute business profile, then your figures.
          </p>
          <p style={{ fontSize: 12, color: "#6f6a60", lineHeight: 1.6, marginTop: 10 }}>
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
                color: resendCooldown > 0 ? "#6f6a60" : "#d4af37",
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
          onSiEmailChange={setSiEmail}
          siPassword={siPassword}
          onSiPasswordChange={setSiPassword}
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
      style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}
    >
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
              Platform console. Username is <b style={{ color: "var(--gold)" }}>lighthouse</b>.
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

      {/* ── sign-in modal ── */}
      {signinOpen && (
        <div
          className="milon-signin-modal"
          onClick={() => {
            setSigninOpen(false);
            setFpMode(false);
            setFpDone(false);
            setSiError("");
          }}
        >
          <div className="milon-signin-box" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
              }}
            >
              <h2>
                {fpMode ? (fpDone ? "Check your email" : "Reset password") : "Sign in to MILŌN"}
              </h2>
              <button
                onClick={() => {
                  setSigninOpen(false);
                  setFpMode(false);
                  setFpDone(false);
                  setSiError("");
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

            {/* ── forgot-password: done state ── */}
            {fpMode && fpDone ? (
              <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "rgba(212,175,55,.1)",
                    display: "grid",
                    placeItems: "center",
                    margin: "0 auto 18px",
                  }}
                >
                  <svg
                    width="20"
                    height="20"
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
                <p style={{ fontSize: 14, color: "var(--ink-dim)", lineHeight: 1.6 }}>
                  We sent a reset link to <span style={{ color: "var(--gold)" }}>{fpEmail}</span>.
                  Check your inbox and follow the link to set a new password.
                </p>
                <button
                  onClick={() => {
                    setFpMode(false);
                    setFpDone(false);
                    setSiError("");
                  }}
                  style={{
                    marginTop: 22,
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Back to sign in
                </button>
              </div>
            ) : /* ── forgot-password: email entry ── */
            fpMode ? (
              <form onSubmit={handleForgotPassword}>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--ink-dim)",
                    marginBottom: 18,
                    lineHeight: 1.6,
                  }}
                >
                  Enter your email address and we'll send you a link to reset your password.
                </p>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    placeholder={t("emailExample", copyMarket)}
                    value={fpEmail}
                    onChange={(e) => setFpEmail(e.target.value)}
                  />
                </div>
                {siError && (
                  <p style={{ fontSize: 13, color: "var(--risk)", margin: "8px 0" }}>{siError}</p>
                )}
                <button
                  type="submit"
                  className="btn btn-gold"
                  disabled={fpBusy}
                  style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
                >
                  {fpBusy ? "Sending…" : "Send reset link ✦"}
                </button>
                <p
                  style={{
                    marginTop: 14,
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    textAlign: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setFpMode(false);
                      setSiError("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--gold)",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: 0,
                    }}
                  >
                    Back to sign in
                  </button>
                </p>
              </form>
            ) : (
              /* ── normal sign-in ── */
              <>
                <GoogleSignInButton
                  intent="owner"
                  tone="landing"
                  disabled={siBusy}
                  ownerInvite={
                    inviteClientId
                      ? { token: inviteClientId, clientCode: regClientCode.trim() || null }
                      : undefined
                  }
                  next={
                    inviteClientId
                      ? `/?invite=${encodeURIComponent(inviteClientId)}&mode=signup`
                      : peekPendingCheckout()
                        ? billingStartPath(peekPendingCheckout()!)
                        : undefined
                  }
                  onError={(msg) => setSiError(msg)}
                />
                <AuthDivider />
                <form onSubmit={handleSignIn} noValidate>
                  <div className="field">
                    <label>Email</label>
                    <input
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      required
                      placeholder={t("emailExample", copyMarket)}
                      value={siEmail}
                      onChange={(e) => setSiEmail(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={siPassword}
                      onChange={(e) => setSiPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFpEmail(siEmail);
                        setFpMode(true);
                        setSiError("");
                      }}
                      style={{
                        display: "block",
                        marginTop: 6,
                        fontSize: 12,
                        color: "var(--ink-dim)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        textAlign: "right",
                        width: "100%",
                        textDecoration: "underline",
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  {siError && (
                    <p style={{ fontSize: 13, color: "var(--risk)", margin: "8px 0" }}>{siError}</p>
                  )}
                  {siUnconfirmed && (
                    <button
                      type="button"
                      disabled={resendBusy || resendCooldown > 0}
                      onClick={() => void resendConfirmationTo(siEmail)}
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: resendCooldown > 0 ? "var(--ink-dim)" : "var(--gold)",
                        background: "none",
                        border: "none",
                        cursor: resendCooldown > 0 ? "default" : "pointer",
                        padding: 0,
                        textDecoration: "underline",
                        fontFamily: "inherit",
                      }}
                    >
                      {resendBusy
                        ? "Sending…"
                        : resendCooldown > 0
                          ? `Email sent · resend in ${resendCooldown}s`
                          : "Resend confirmation email"}
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn btn-gold"
                    disabled={siBusy}
                    style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
                  >
                    {siBusy ? "Signing in…" : "Sign in ✦"}
                  </button>
                </form>
                <p
                  style={{
                    marginTop: 18,
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    textAlign: "center",
                  }}
                >
                  Accountant?{" "}
                  <a href="/auth" style={{ color: "var(--gold)", textDecoration: "none" }}>
                    Sign in to the accountant portal →
                  </a>
                </p>
                <p
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    textAlign: "center",
                  }}
                >
                  New here?{" "}
                  <button
                    onClick={() => {
                      setSigninOpen(false);
                      document.getElementById("register")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--gold)",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: 0,
                    }}
                  >
                    Get your free health score
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Night sky: scrolls through the opening sections, then fades to --bg. */}
      <div id="landing-sky" aria-hidden="true">
        <div
          className="landing-sky-photo"
          style={{ backgroundImage: "url(/landing-sky.jpg)" }}
        />
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
            <a
              href="#register"
              onClick={(e) => {
                e.preventDefault();
                goToFirmSignup();
              }}
            >
              Create firm account
            </a>
            <a href="#register" onClick={() => setMobileNavOpen(false)}>
              Sign up
            </a>
            <a href="#method" onClick={() => setMobileNavOpen(false)}>
              The MILŌN Method
            </a>
            <a href="#how" onClick={() => setMobileNavOpen(false)}>
              How it works
            </a>
            <a href="#pricing" onClick={() => setMobileNavOpen(false)}>
              Pricing
            </a>
            <button id="themeToggle" title="Toggle light / dark">
              ☀
            </button>
            <button
              className="btn btn-gold"
              style={{ padding: "10px 22px", fontSize: 13 }}
              onClick={() => {
                setMobileNavOpen(false);
                setSiError("");
                setSigninOpen(true);
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </nav>

      {/* ══════════════════════════ HERO ══════════════════════════ */}
      <section id="hero">
        <div className="wrap">
          <div>
            <span className="hero-badge h-anim d1">
              <span className="pulse" />
              <span>AI finance function for firms</span>
            </span>
            <h1 className="h-anim d2">
              MILŌN.
              <br />
              <span className="gold-text">
                A full finance function in your pocket.
              </span>
            </h1>
            <p className="hero-lede h-anim d3">
              MILŌN gives accountants an AI-powered finance function to run for their clients —
              turning financial statements into a shared workspace with a financial health
              diagnosis → cash forecasts → profitability waterfalls → a full-year budget →
              strategic recommendations → tracked employee actions.
            </p>
            <p className="sub h-anim d3">
              AI powers MILŌN&apos;s financial intelligence brain. Your accountant reviews and
              signs off on the entire function. You see what matters, what comes next, and what
              needs to get done.
            </p>
            <div className="hero-cta h-anim d4">
              <a className="btn btn-gold" href="#persona">
                Get my free health score
              </a>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goToFirmSignup({ scrollTo: "register" })}
              >
                I&apos;m an accountant — see MILŌN for my clients
              </button>
            </div>
          </div>

          {/* dashboard mockup */}
          <div className="dash-stage h-anim d3">
            <div className="dash" id="dash">
              <div className="dash-top">
                <span className="brand">MILŌN</span>
                <span className="live-pill">
                  <i />
                  Sample
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
                  />
                  <path
                    className="cash-line"
                    d="M0 58 C40 50,70 44,105 48 C140 52,165 66,200 78 C235 90,258 96,290 92 C322 88,345 70,385 56 C425 42,470 34,520 28"
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
              <span className="tag">Accountant note</span>
              <p>
                <RegionCopy
                  pack={copyMarket.copyPack}
                  za={
                    <>
                      Debtor days crept up to <b>52</b>. Chase your top 3 invoices this week —
                      that's <b>R184k</b> unlocked.
                    </>
                  }
                  us={
                    <>
                      DSO crept up to <b>52</b>. Chase your top 3 invoices this week — that's{" "}
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
          <div className="hero-stats h-anim d5">
            <div>
              <b>1</b>
              <span>Health score that tells the story</span>
            </div>
            <div>
              <b>13&nbsp;wks</b>
              <span>Cash forecast</span>
            </div>
            <div>
              <b>4</b>
              <span>Financial pillars</span>
            </div>
            <div>
              <b>19</b>
              <span>Ratios with the workings shown</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ TRUST STRIP ══════════════════════════ */}
      <div className="trust">
        <div className="wrap">
          <div className="item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--gold)" }}
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Your figures stay in your workspace</span>
          </div>
          <div className="item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--gold)" }}
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>What reaches Claude is anonymised</span>
          </div>
          <div className="item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--gold)" }}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>
            <span>19 ratios you can check</span>
            </span>
          </div>
          <div className="item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--gold)" }}
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>
              <RegionCopy pack={copyMarket.copyPack} za="Built for SA SMEs" us="Built for US SMBs" />
            </span>
          </div>
          <div className="item">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--gold)" }}
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span>Powered by Claude AI</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════ METHOD ══════════════════════════ */}
      <section id="method">
        <div className="wrap">
          <div className="section-head center reveal">
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
                  <i data-w="81%" />
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
                <RegionCopy pack={copyMarket.copyPack} za="debtor days, creditor days" us="DSO, DPO" />{" "}
                and a 13-week forecast.
              </p>
              <div className="score">
                <span>Demo</span>
                <span className="bar">
                  <i data-w="61%" />
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
                  <i data-w="74%" />
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
                  <i data-w="82%" />
                </span>
                <b>82</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ MARQUEE ══════════════════════════ */}
      <div className="marquee-band">
        <p className="cap">Calculated on every upload</p>
        <div className="marquee" id="marquee">
          <span>Gross Margin</span>
          <span>Net Margin</span>
          <span>EBITDA Margin</span>
          <span>Return on Assets</span>
          <span>Return on Equity</span>
          <span>Current Ratio</span>
          <span>Quick Ratio</span>
          <span>Debt-to-Equity</span>
          <span>Interest Cover</span>
          <span>Operating Cash Ratio</span>
          <span>13-Week Cash Forecast</span>
          <span>
            <RegionCopy pack={copyMarket.copyPack} za="Debtor Days" us="Days Sales Outstanding" />
          </span>
          <span>
            <RegionCopy pack={copyMarket.copyPack} za="Creditor Days" us="Days Payable Outstanding" />
          </span>
          <span>Inventory Turnover</span>
          <span>Cash Conversion Cycle</span>
          <span>Working Capital Ratio</span>
          <span>Asset Turnover</span>
          <span>Fixed Asset Efficiency</span>
          <span>Gearing Ratio</span>
          <span>Leverage Ratio</span>
          <span>Break-even Point</span>
          <span>Revenue per Employee</span>
          <span>
            <RegionCopy pack={copyMarket.copyPack} za="Labour Productivity" us="Labor Productivity" />
          </span>
          <span>Cost Structure</span>
          <span>Revenue Growth</span>
          <span>
            <RegionCopy pack={copyMarket.copyPack} za="Profit per Rand Earned" us="Profit per Dollar Earned" />
          </span>
          <span>Cash Burn Rate</span>
          <span>Runway Weeks</span>
          <span>Net Working Capital</span>
          <span>Capital Efficiency</span>
          <span>Equity Multiplier</span>
        </div>
      </div>

      {/* ══════════════════════════ THE REAL GAP + HOW IT WORKS ══════════════════════════ */}
      <section id="problem" style={{ paddingTop: 80, paddingBottom: 40 }}>
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow">The real gap</span>
            <h2>
              Small businesses have the numbers.
              <br />
              Large businesses have the <span className="gold-text serif">finance function.</span>
            </h2>
          </div>
          <p className="sub reveal" style={{ marginTop: 24 }}>
            A small business can have the same financial statements as a large company without
            having the finance team behind them to interpret those numbers, spot problems early,
            forecast cash, and turn analysis into action.
          </p>
          <p className="sub reveal" style={{ marginTop: 18 }}>
            MILŌN gives accountants a way to install that capability for their clients — using AI
            to do the heavy analytical work while the accountant remains in control of the advice.
          </p>
        </div>
      </section>

      <section id="how" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow">How it works</span>
            <h2>
              From financial statements to <span className="gold-text serif">decisions.</span>
            </h2>
          </div>
          <div className="steps how-steps stagger" style={{ marginTop: 56 }}>
            <div className="step-card">
              <span className="n">01</span>
              <h3>Upload the financials</h3>
              <p>
                Upload the P&amp;L and balance sheet you already have as a PDF, Excel file, or CSV
                — or simply upload a bank statement.
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
                MILŌN uses Claude to turn the financial analysis and business context into clear
                recommendations, a 13-week cash forecast, and an actionable plan.
              </p>
            </div>
            <div className="step-card">
              <span className="n">04</span>
              <h3>Your accountant reviews and signs off</h3>
              <p>
                The accountant reviews the AI-generated analysis and recommendations, makes any
                necessary changes, and signs off before the client sees the advice.
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

      <div className="divider">
        <div className="wrap">
          <i />
        </div>
      </div>

      {/* ══════════════════════════ ONE SHARED WORKSPACE ══════════════════════════ */}
      <section id="bridge" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">One shared workspace</span>
            <h2>
              Your accountant&apos;s expertise. AI&apos;s analysis.{" "}
              <span className="gold-text serif">Your business.</span>
            </h2>
            <p className="sub">
              MILŌN brings both sides of the financial workflow together.
            </p>
            <p className="pipeline">
              AI prepares. Accountant reviews and signs off. Owner understands and acts.
            </p>
            <p className="sub">
              The result is a finance function that can follow the business — not just report on
              it.
            </p>
          </div>

          <div className="bridge-grid stagger">
            <div className="bridge-side">
              <div className="who">For accounting firms</div>
              <h3>Turn accounting data into an AI-powered finance function.</h3>
              <p>
                Your clients already depend on you for their financial information. MILŌN gives
                your firm a structured way to turn that information into ongoing financial
                analysis, recommendations, and action.
              </p>
              <ul>
                <li>
                  <b>AI-assisted</b> — Claude prepares the first version of the analysis.
                </li>
                <li>
                  <b>Accountant-controlled</b> — You review, edit and sign off before anything
                  reaches the client.
                </li>
                <li>
                  <b>One workflow</b> — Analysis, recommendations, deliverables, actions and
                  progress live in one workspace.
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
              <p>You shouldn&apos;t need to be a CFO to understand the financial state of your business.</p>
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
                <b>The accountant reviews and signs off before advice reaches the client.</b>
              </div>
            </div>
            <div className="bridge-fact">
              <div className="was">Actions → progress</div>
              <div className="now">
                Recommendations become assigned work.{" "}
                <b>The owner can see what is getting done.</b>
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
          <div className="section-head center reveal">
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
              MILŌN is built around a different idea: the size of your business should not
              determine the quality of financial information available to you.
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
          <div className="section-head center reveal">
            <span className="eyebrow">Pricing for firms</span>
            <h2>
              USD bands by client count. <span className="gold-text">ZAR at Checkout.</span>
            </h2>
            <p className="sub">
              Accounting firms subscribe on a flat USD band by active client count. Starter is free
              (up to 3 active clients). South African firms can pay ZAR at Checkout via Adaptive
              Pricing. Watchlist clients are free and never billed. AI prepares the analysis; the
              accountant reviews and signs off.
            </p>
          </div>

          <div className="acc-pricing" id="accPricing">
            <div className="acc-pricing-kicker">Accountant / Advisory Firm Pricing</div>
            <p className="acc-pricing-lede">
              White-label the whole platform. Charge your clients a monthly advisory retainer. MILŌN
              is your engine. Billed in USD (Solo from {LIST_PRICES.us.firmSolo}/mo); South African
              firms can pay ZAR at Checkout.
            </p>
            <FirmBandPricingTable
              interval={firmInterval}
              onIntervalChange={setFirmInterval}
              onSelectBand={startFirmPlan}
            />
          </div>

          <div className="owner-spark-path">
            <p>
              <strong style={{ color: "var(--ink)" }}>Business owners:</strong> Spark is free during
              early access and does not ask for a card. Your accountant can run the finance function
              on a firm band above.
            </p>
            <button type="button" className="btn btn-ghost" onClick={goToOwnerSpark}>
              Business owners: start free
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ PERSONA ══════════════════════════ */}
      <section id="persona">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Start here</span>
            <h2>Who are you in this story?</h2>
            <p className="sub">
              MILŌN is built for accounting firms first, and for the business owners they serve.
              Choose yours — the same workspace connects both.
            </p>
          </div>
          <div className="persona-grid stagger">
            <div className="persona-card" onClick={() => (window as any).__mq_start?.("accountant")}>
              <div className="icon">
                <svg viewBox="0 0 24 24">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <h3>Accountant / Advisory Firm</h3>
              <p>
                Your clients already depend on you for their financial information. MILŌN gives
                your firm an AI-powered finance function you can run across those clients — you
                review and sign off before advice reaches them.
              </p>
              <div className="go">
                See MILŌN for my clients <i>→</i>
              </div>
            </div>
            <div className="persona-card" onClick={() => (window as any).__mq_start?.("owner")}>
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
                business. See your health, cash, problems, recommendations, and progress — reviewed
                by your accountant — in one workspace.
              </p>
              <div className="go">
                Take the 90-second diagnostic <i>→</i>
              </div>
            </div>
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

      {/* ══════════════════════════ REGISTER ══════════════════════════ */}
      <section id="register" style={{ paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Create a firm account</span>
            <h2>
              Accountants first.
              <br />
              <span className="gold-text">AI prepares; you sign off.</span>
            </h2>
            <p className="sub">
              Set up your practice, pick a USD client-count band (Starter is free for up to 3 active
              clients), and run the finance function across the book. Business owners can still
              start on Spark below, free during early access.
            </p>
          </div>

          {/* Client-only: prevents browser password-manager extensions (LastPass etc.)
              from injecting DOM nodes during SSR hydration and crashing React */}
          {mounted && (
            <div className="reg-shell">
              <form onSubmit={handleRegister}>
                {regError && (
                  <p id="register-error" role="alert" className="reg-error">
                    {regError}
                  </p>
                )}
                {/* ── Invite flow: simplified form, no role/code/plan ── */}
                {inviteClientId ? (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--gold)",
                        marginBottom: 16,
                        lineHeight: 1.5,
                        fontWeight: 600,
                      }}
                    >
                      You've been invited to your business workspace on MILŌN. Create your account
                      or sign in to take ownership and see your numbers.
                      {inviteBusiness ? ` This link is for ${inviteBusiness}.` : ""}
                      {inviteNeedsCode
                        ? " You'll need the client code from the email (MLN-XXXXXX)."
                        : ""}
                    </p>
                    {user && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--ink-dim)",
                          marginBottom: 16,
                          lineHeight: 1.5,
                        }}
                      >
                        You&apos;re signed in as {user.email}. Accepting this invite will open the
                        owner workspace
                        {user.email?.toLowerCase() !== regEmail.trim().toLowerCase() && regEmail
                          ? ` as ${regEmail}`
                          : ""}
                        .
                      </p>
                    )}
                    {inviteIsLegacyUuid && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--ink-dim)",
                          marginBottom: 16,
                          lineHeight: 1.5,
                        }}
                      >
                        Note: this is an older invite link format. It still works — for the most
                        secure link, ask your accountant to copy a fresh invite from the dashboard.
                      </p>
                    )}

                    {inviteNeedsCode && (
                      <>
                        <label htmlFor="regClientCodeField">Client code</label>
                        <input
                          id="regClientCodeField"
                          type="text"
                          required
                          autoCapitalize="characters"
                          placeholder="MLN-XXXXXX"
                          value={regClientCode}
                          onChange={(e) => setRegClientCode(e.target.value.toUpperCase())}
                        />
                        <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
                          It&apos;s in the invite email, next to the claim link.
                        </p>
                      </>
                    )}

                    <div style={{ margin: "18px 0 8px" }}>
                      <GoogleSignInButton
                        intent="owner"
                        tone="landing"
                        label="Continue with Google"
                        disabled={regBusy || (inviteNeedsCode && !regClientCode.trim())}
                        ownerInvite={{
                          token: inviteClientId,
                          clientCode: regClientCode.trim() || null,
                        }}
                        next={`/?invite=${encodeURIComponent(inviteClientId)}&mode=signup`}
                        onError={(msg) => showRegisterError(msg)}
                      />
                    </div>
                    <AuthDivider />

                    <label htmlFor="regNameField">Full name</label>
                    <input
                      id="regNameField"
                      type="text"
                      required={!user}
                      placeholder={t("nameExample", copyMarket)}
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                    />

                    <label htmlFor="regEmailField">Work email</label>
                    <input
                      id="regEmailField"
                      type="email"
                      required
                      placeholder={t("emailExample", copyMarket)}
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                    />

                    <label htmlFor="regPasswordField">Password</label>
                    <input
                      id="regPasswordField"
                      type="password"
                      required={!user}
                      placeholder="At least 6 characters"
                      minLength={user ? undefined : 6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                    />

                    <button
                      type="submit"
                      className="btn btn-gold"
                      disabled={regBusy}
                      style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
                    >
                      {regBusy ? "Joining workspace…" : "Accept invitation ✦"}
                    </button>
                    <p
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        color: "var(--ink-dim)",
                        marginTop: 14,
                        lineHeight: 1.5,
                      }}
                    >
                      By joining you agree to the{" "}
                      <a href="/terms" style={{ color: "inherit" }}>
                        Terms
                      </a>
                      . AI is powered by Claude; financial information sent to it is anonymised.{" "}
                      <a href="/privacy" style={{ color: "inherit" }}>
                        Privacy
                      </a>
                      {" · "}
                      <a href="/ai" style={{ color: "inherit" }}>
                        AI notice
                      </a>
                    </p>
                  </>
                ) : (
                  /* ── Standard signup form ── */
                  <>
                    <label htmlFor="regRoleField">I am a</label>
                    <select
                      id="regRoleField"
                      value={regRole}
                      onChange={(e) => {
                        const value = e.target.value;
                        setRegRole(value);
                        if (value === "Accountant / Advisory firm") {
                          goToFirmSignup({ plan: "starter", scrollTo: "register" });
                        } else {
                          clearPendingCheckout();
                          setRegPlan("Spark — Free early access");
                        }
                      }}
                    >
                      <option>Accountant / Advisory firm</option>
                      <option>Business owner</option>
                    </select>

                    {regRole === "Accountant / Advisory firm" ? (
                      <>
                        <div style={{ margin: "8px 0 18px" }}>
                          <MarketPicker
                            value={draftMarket}
                            onChange={setDraftMarket}
                            variant="landing"
                            audience="practice"
                          />
                        </div>
                        <GoogleSignInButton
                          intent="accountant"
                          tone="landing"
                          label="Continue with Google"
                          disabled={regBusy || !isDraftComplete(draftMarket)}
                          next={billingStartPath(
                            peekPendingCheckout() ??
                              starterCheckoutIntent(visitorCopyPack(draftMarket)),
                          )}
                          onBeforeStart={() => {
                            const market = draftToSelection(draftMarket);
                            if (!market) {
                              showRegisterError(
                                "Pick South Africa or the United States (and a state) first.",
                              );
                              return false;
                            }
                            writeVisitorDraft(draftMarket);
                            setPortalIntent("accountant");
                            stashAccountantGoogleSignup({
                              firmName: regFirmName.trim(),
                              fullName: regName.trim() || undefined,
                              marketCountry: market.country,
                              marketRegion: market.regionCode,
                            });
                            if (!peekPendingCheckout()) {
                              stashPendingCheckout(
                                starterCheckoutIntent(market.country === "ZA" ? "za" : "us"),
                              );
                            }
                            return true;
                          }}
                          onError={(msg) => showRegisterError(msg)}
                        />
                        <AuthDivider />
                        <label htmlFor="regNameField">Your name</label>
                        <input
                          id="regNameField"
                          type="text"
                          required
                          placeholder={t("nameExample", copyMarket)}
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                        />

                        <label htmlFor="regFirmNameField">Firm name</label>
                        <input
                          id="regFirmNameField"
                          type="text"
                          required
                          placeholder="Acme & Partners"
                          value={regFirmName}
                          onChange={(e) => setRegFirmName(e.target.value)}
                        />

                        <label htmlFor="regEmailField">Work email</label>
                        <input
                          id="regEmailField"
                          type="email"
                          required
                          placeholder={t("emailExample", copyMarket)}
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                        />

                        <label htmlFor="regPasswordField">Password</label>
                        <input
                          id="regPasswordField"
                          type="password"
                          required
                          placeholder="At least 6 characters"
                          minLength={6}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                        />

                        <p
                          style={{
                            marginTop: 18,
                            color: "var(--ink-dim)",
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          {paidPlanFromRegisterLabel(regPlan)
                            ? `You will start on ${regPlan} after creating the firm account. Change band in Pricing if you need a different client count.`
                            : "Starter is free (up to 3 active clients). Pick another band in Pricing if you already know your book size."}
                        </p>

                        <button
                          type="submit"
                          id="create-firm"
                          className="btn btn-gold"
                          disabled={regBusy || !isDraftComplete(draftMarket)}
                          style={{ width: "100%", justifyContent: "center", marginTop: 20 }}
                        >
                          {regBusy ? "Creating your firm account…" : "Create firm account ✦"}
                        </button>
                        <p
                          style={{
                            textAlign: "center",
                            fontSize: 11,
                            color: "var(--ink-dim)",
                            marginTop: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          Accounting firms subscribe on USD client-count bands through Stripe
                          Checkout. AI prepares the analysis; you review and sign off. By creating
                          an account you agree to the{" "}
                          <a href="/terms" style={{ color: "inherit" }}>
                            Terms
                          </a>
                          .{" "}
                          <a href="/privacy" style={{ color: "inherit" }}>
                            Privacy
                          </a>
                          {" · "}
                          <a href="/ai" style={{ color: "inherit" }}>
                            AI notice
                          </a>
                        </p>
                        <p style={{ textAlign: "center", marginTop: 16 }}>
                          <button type="button" className="btn btn-ghost" onClick={goToOwnerSpark}>
                            Business owners: start free
                          </button>
                        </p>
                      </>
                    ) : (
                      <>
                        <div style={{ margin: "8px 0 18px" }}>
                          <MarketPicker
                            value={draftMarket}
                            onChange={setDraftMarket}
                            variant="landing"
                          />
                        </div>
                        <GoogleSignInButton
                          intent="owner"
                          tone="landing"
                          label="Continue with Google"
                          disabled={regBusy || !isDraftComplete(draftMarket)}
                          next={
                            peekPendingCheckout()
                              ? billingStartPath(peekPendingCheckout()!)
                              : undefined
                          }
                          onError={(msg) => showRegisterError(msg)}
                        />
                        <AuthDivider />
                        <label htmlFor="regNameField">Full name</label>
                        <input
                          id="regNameField"
                          type="text"
                          required
                          placeholder={t("nameExample", copyMarket)}
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                        />

                        <label htmlFor="regEmailField">Work email</label>
                        <input
                          id="regEmailField"
                          type="email"
                          required
                          placeholder={t("emailExample", copyMarket)}
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                        />

                        <label htmlFor="regPasswordField">Password</label>
                        <input
                          id="regPasswordField"
                          type="password"
                          required
                          placeholder="At least 6 characters"
                          minLength={6}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                        />

                        <label htmlFor="regBusinessField">Business name</label>
                        <input
                          id="regBusinessField"
                          type="text"
                          placeholder={t("entityExample", copyMarket)}
                          value={regBusiness}
                          onChange={(e) => setRegBusiness(e.target.value)}
                        />

                        <label htmlFor="regPlan">Plan</label>
                        <select
                          id="regPlan"
                          value={regPlan}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRegPlan(value);
                            const paid = paidPlanFromRegisterLabel(value);
                            if (paid) {
                              stashPendingCheckout({
                                plan: paid,
                                interval: "month",
                                market: visitorCopyPack(draftMarket),
                              });
                            } else {
                              clearPendingCheckout();
                            }
                          }}
                        >
                          <option value="Spark — Free early access">
                            Spark — Free early access
                          </option>
                        </select>

                        <button
                          type="submit"
                          className="btn btn-gold"
                          disabled={regBusy}
                          style={{ width: "100%", justifyContent: "center", marginTop: 28 }}
                        >
                          {regBusy
                            ? "Creating your account…"
                            : paidPlanFromRegisterLabel(regPlan)
                              ? `Create account and start ${regPlan}`
                              : "Get my free health score ✦"}
                        </button>
                        <p
                          style={{
                            textAlign: "center",
                            fontSize: 11,
                            color: "var(--ink-dim)",
                            marginTop: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          Spark is free and does not ask for a card. Accounting firms subscribe on
                          USD client-count bands through Stripe Checkout after creating a firm
                          account. By creating an
                          account you agree to the{" "}
                          <a href="/terms" style={{ color: "inherit" }}>
                            Terms
                          </a>
                          . AI is powered by Claude; financial information sent to it is anonymised.{" "}
                          <a href="/privacy" style={{ color: "inherit" }}>
                            Privacy
                          </a>
                          {" · "}
                          <a href="/ai" style={{ color: "inherit" }}>
                            AI notice
                          </a>
                        </p>
                      </>
                    )}
                  </>
                )}
              </form>
            </div>
          )}
        </div>
      </section>

      {/* ══════════════════════════ FAQ ══════════════════════════ */}
      <section id="home-faq">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Questions</span>
            <h2>
              Straight answers, <span className="gold-text">before you sign up.</span>
            </h2>
          </div>
          <div className="home-faq">
            {HOMEPAGE_FAQ_ITEMS.map((item) => (
              <article key={item.question}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
          <p className="home-faq-more">
            More detail on cost, data, and how advisory works is on the{" "}
            <a href="/faq">questions page</a>.
          </p>
        </div>
      </section>

      {/* ══════════════════════════ FOOTER ══════════════════════════ */}
      <footer>
        <div className="wrap">
          <div>
            <span className="logo-word gold-text">MILŌN</span>
            <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              The AI-powered finance function
              <br />
              <RegionCopy pack={copyMarket.copyPack} za="for South African SMEs" us="for US small businesses" />
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
            <button
              onClick={() => setSigninOpen(true)}
              style={{
                background: "none",
                border: "none",
                color: "var(--ink-dim)",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              Sign in
            </button>
          </nav>
          <div className="copy">
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
              <RegionCopy pack={copyMarket.copyPack}
                za="Built for South Africa · Powered by Claude AI"
                us="Built for the United States · Powered by Claude AI"
              />
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
