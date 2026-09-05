import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { notifySignup } from "@/lib/signup-notify";
import { adminSignUp } from "@/lib/auth.functions";
import { previewOwnerInvite } from "@/lib/invite-tokens.functions";
import { OPS_UNLOCK_KEY, unlockOwnerOps } from "@/lib/owner-ops.functions";
import { registerLighthouseTrialVisit } from "@/lib/lighthouse.functions";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { MarketPicker } from "@/components/market-picker";
import { MarketCopy } from "@/components/marketing-shell";
import {
  applyVisitorMarketToDocument,
  draftToSelection,
  isDraftComplete,
  LIST_PRICES,
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
import { SHARE_DESCRIPTION, SHARE_TITLE } from "@/lib/share-copy";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "MILŌN — Know your numbers. Sleep at night." },
      { name: "description", content: SHARE_DESCRIPTION },
      { property: "og:title", content: SHARE_TITLE },
      { property: "og:description", content: SHARE_DESCRIPTION },
      { property: "og:image", content: "/icon-512.png" },
    ],
    styles: [{ children: landingCss }],
    scripts: [
      {
        children: `(function(){try{var d=document.documentElement;d.dataset.landing="1";var t="dark";try{var s=localStorage.getItem("milon.landing.theme");if(s==="light"||s==="dark")t=s;}catch(e){}d.dataset.theme=t;if(t==="light"){d.classList.remove("dark");d.style.backgroundColor="#f7f4ec";d.style.color="#1b1608";d.style.colorScheme="light";}else{d.classList.add("dark");d.style.backgroundColor="#050507";d.style.color="#f2ecdc";d.style.colorScheme="dark";}}catch(e){}})();`,
      },
      { children: VISITOR_MARKET_BOOT_SCRIPT },
    ],
  }),
});

const LANDING_THEME_KEY = "milon.landing.theme";

/** Invite claim links: `/?invite=<token>&mode=signup`. */
function pendingInviteTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const inv = params.get("invite");
  const mode = params.get("mode");
  if (inv && mode === "signup") return inv;
  return null;
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
    root.style.colorScheme = "light";
    body.style.backgroundColor = "#f7f4ec";
    body.style.color = "#1b1608";
  } else {
    root.classList.add("dark");
    root.style.backgroundColor = "#050507";
    root.style.color = "#f2ecdc";
    root.style.colorScheme = "dark";
    body.style.backgroundColor = "#050507";
    body.style.color = "#f2ecdc";
  }
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
  const doPreviewInvite = useServerFn(previewOwnerInvite);
  const doUnlockOps = useServerFn(unlockOwnerOps);
  const doTrialVisit = useServerFn(registerLighthouseTrialVisit);

  /* ── invite-link state (opaque token preferred; legacy client UUID still works) ── */
  const [inviteClientId, setInviteClientId] = useState<string | null>(null);
  const [inviteIsLegacyUuid, setInviteIsLegacyUuid] = useState(false);
  const [inviteBusiness, setInviteBusiness] = useState<string | null>(null);
  const [inviteNeedsCode, setInviteNeedsCode] = useState(false);
  const [regClientCode, setRegClientCode] = useState("");

  /* ── Lighthouse trial link (?lh=<token>) — attribute the signup back to the lead ── */
  const [lhToken, setLhToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("@/lib/email-confirm").then(({ shouldForwardToConfirm, confirmUrlFromLocation }) => {
      if (
        shouldForwardToConfirm(window.location.pathname, window.location.search, window.location.hash)
      ) {
        window.location.replace(
          confirmUrlFromLocation(window.location.origin, window.location.search, window.location.hash),
        );
      }
    });
  }, []);

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
    const inv = pendingInviteTokenFromUrl();
    if (!inv) return;
    setInviteClientId(inv);
    // Show the code field immediately so a slow preview cannot let them submit
    // without it. Hide only after preview confirms this client has no code.
    setInviteNeedsCode(true);
    void import("@/lib/user-roles").then(({ forcePortal }) => forcePortal("owner"));
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(inv.trim())) {
      setInviteIsLegacyUuid(true);
      toast.message(
        "This invite link is an older format. Ask your accountant for a fresh link when you can.",
      );
    }
    void doPreviewInvite({ data: { token: inv } })
      .then((preview) => {
        setInviteBusiness(preview.clientName);
        setInviteNeedsCode(Boolean(preview.clientCode));
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "This invite link is invalid.");
      });
    setTimeout(() => {
      const el = document.getElementById("register");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  }, [doPreviewInvite]);

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
  const [draftMarket, setDraftMarket] = useState<DraftMarket>({ country: null, regionCode: null });
  const copyMarket = { copyPack: visitorCopyPack(draftMarket) };
  useEffect(() => {
    setMounted(true);
    setDraftMarket(readVisitorDraft());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    writeVisitorDraft(draftMarket);
    (window as unknown as { __milonDraftMarket?: DraftMarket }).__milonDraftMarket = draftMarket;
    applyVisitorMarketToDocument(draftMarket);
  }, [draftMarket, mounted]);

  /* ── register form state ── */
  const [regRole, setRegRole] = useState("Business owner");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regBusiness, setRegBusiness] = useState("");
  const [regPlan, setRegPlan] = useState("Spark — Free early access");
  const [regBusy, setRegBusy] = useState(false);
  const [regDone, setRegDone] = useState(false);

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
      // Invite accept stays on the landing form. Read the URL here (not
      // inviteClientId state) so a leftover accountant session cannot race
      // the invite effect and dump the user onto /dashboard before the form paints.
      if (pendingInviteTokenFromUrl() || inviteClientId) return;
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

    /* count-up */
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
    document.querySelectorAll(".count").forEach((el) => cio.observe(el));

    /* dashboard animation */
    const dash = document.getElementById("dash");
    if (dash) {
      const dio = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (!e.isIntersecting) return;
            dio.unobserve(dash);
            dash.classList.add("in");
            const g = document.getElementById("gaugeFill");
            if (g)
              requestAnimationFrame(() => {
                g.style.strokeDashoffset = String(402 * (1 - 0.78));
              });
            dash.querySelectorAll(".pill-row .bar i").forEach((b: any, i) => {
              setTimeout(
                () => {
                  b.style.width = b.dataset.w;
                },
                200 + i * 140,
              );
            });
          }),
        { threshold: 0.35 },
      );
      dio.observe(dash);
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
          "Your cash dries up before the month does. You're not alone — cash kills more SA businesses than losses do. <b>MILŌN's 13-week cashflow forecast shows you the shortfall weeks before it lands — and gives you the exact moves to close it.</b>",
        ],
        "❓": [
          "profit clarity",
          "You're working hard but flying blind on whether it's actually profitable. <b>MILŌN turns your numbers into one health score and 31 plain-language ratios — so you know, every week, whether the profit is real.</b>",
        ],
        "⛓": [
          "debt pressure",
          "Debt is quietly eating what you earn. <b>MILŌN tracks your debt drag and interest burden live, and ranks the highest-impact moves to lighten the load.</b>",
        ],
        "🐢": [
          "slow payers",
          "Late payers are using you as a free bank. <b>MILŌN flags your cash-trapped days, shows the cost in rand, and gives you the playbook to get paid faster.</b>",
        ],
      },
      accountant: {
        "⏳": [
          "crisis-only clients",
          "Your clients only call when it's already on fire. <b>MILŌN gives you a live radar over every client — risk flags reach you before the panic call does.</b>",
        ],
        "💸": [
          "unbilled advice",
          "You give away advisory value inside compliance fees. <b>MILŌN packages your insight into a branded, recurring retainer clients can see and gladly pay for.</b>",
        ],
        "🗂": [
          "messy data",
          "You can't advise on data that arrives late and broken. <b>MILŌN keeps client numbers live and structured — comment on the actual figures, in context, instantly.</b>",
        ],
        "📉": [
          "fee compression",
          "Compliance is a shrinking island. <b>MILŌN is your bridge to advisory — 10 white-label reports and a system that sells your expertise for you.</b>",
        ],
      },
    };
    let qRole = "owner",
      step = 0,
      answers: Record<string, { em: string; label: string }> = {};

    function startQuiz(r: string) {
      const draft = (window as unknown as { __milonDraftMarket?: DraftMarket }).__milonDraftMarket;
      if (!draft?.country || (draft.country === "US" && !draft.regionCode)) {
        document.getElementById("market")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      qRole = r;
      step = 0;
      answers = {};
      document.body.className = "persona-" + r;
      if (draft.country === "US") document.body.classList.add("market-us");
      if (draft.country === "US") {
        REFLECT.owner["💧"][1] = REFLECT.owner["💧"][1].replace(
          "SA businesses",
          "small businesses",
        );
        REFLECT.owner["🐢"][1] = REFLECT.owner["🐢"][1].replace("in rand", "in dollars");
      } else {
        REFLECT.owner["💧"][1] = REFLECT.owner["💧"][1].replace(
          "small businesses",
          "SA businesses",
        );
        REFLECT.owner["🐢"][1] = REFLECT.owner["🐢"][1].replace("in dollars", "in rand");
      }
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
        <p class="hint">Your full diagnostic — health score, cash runway, and your first three moves — is one step away.</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px">
          <a class="btn btn-gold" href="#register">Unlock my full diagnostic ✦</a>
          <button class="btn btn-ghost" onclick="window.__mq_start('${qRole}')">Redo questions</button>
        </div>
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
      if (error) throw error;
      const { waitForAuthSession, clearInviteQueryFromUrl } = await import("@/lib/invite-handoff");
      await waitForAuthSession();
      clearInviteQueryFromUrl();
      setInviteClientId(null);
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
      } else {
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
    if (!regPassword || regPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    // ── Invite flow: use adminSignUp so the server writes the correct role ──
    if (inviteClientId) {
      if (inviteNeedsCode && !regClientCode.trim()) {
        toast.error("Enter the client code from your invite email (MLN-XXXXXX).");
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
          await supabase.auth.signOut();
        }

        let clientId: string | null = null;
        const sameAccount =
          user?.email?.toLowerCase() === regEmail.trim().toLowerCase() && Boolean(user);
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
            // Account already exists from a previous attempt — sign in below.
          }
        }

        const { error: siErr } = await supabase.auth.signInWithPassword({
          email: regEmail,
          password: regPassword,
        });
        if (siErr) throw siErr;
        await waitForAuthSession();
        stashInviteHandoff(clientId);
        clearInviteQueryFromUrl();
        setInviteClientId(null);
        toast.success("Welcome — opening your workspace.");
        await navigate({ to: "/app", replace: true });
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Registration failed.");
      } finally {
        setRegBusy(false);
      }
      return;
    }

    // ── Standard owner signup ──────────────────────────────────────────────
    if (regRole === "Accountant / Advisory firm") {
      navigate({ to: "/auth", search: {} });
      return;
    }
    const market = draftToSelection(draftMarket);
    if (!market) {
      toast.error("Pick South Africa or the United States (and a state) first.");
      document.getElementById("market")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setRegBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/confirm`,
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
      const { forcePortal } = await import("@/lib/user-roles");
      forcePortal("owner");
      notifySignup("Business owner", regEmail, regName.trim());
      if (lhToken) {
        void doTrialVisit({ data: { token: lhToken, signedUp: true } }).catch(() => {});
      }
      if (data.session && data.user) {
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
        navigate({ to: "/app" });
        return;
      }
      setRegDone(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setRegBusy(false);
    }
  };

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
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f2ecdc", margin: "0 0 10px" }}>
            Check your email
          </h2>
          <p style={{ fontSize: 14, color: "#9b958a", lineHeight: 1.6 }}>
            We sent a confirmation email from Milōn to{" "}
            <span style={{ color: "#d4af37" }}>{regEmail}</span>. Open it and tap{" "}
            <span style={{ color: "#f2ecdc" }}>Confirm email and continue</span>. You’ll land on a
            short welcome page, then your business board — not a generic verify screen.
          </p>
          <button
            onClick={() => setRegDone(false)}
            style={{
              marginTop: 26,
              fontSize: 12,
              color: "#9b958a",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  /* Signed-in visitors bounce to /app or /dashboard. Don't flash the landing
     hero while that lookup runs. Invite accept stays on this page. */
  if (user && !loading && !inviteClientId && !pendingInviteTokenFromUrl()) {
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
                  ← Back to sign in
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
                    placeholder="you@business.co.za"
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
                    ← Back to sign in
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
                      placeholder="you@business.co.za"
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
            <a href="#persona" onClick={() => setMobileNavOpen(false)}>
              Start
            </a>
            <a href="#register" onClick={() => setMobileNavOpen(false)}>
              Sign up
            </a>
            <a href="#method" onClick={() => setMobileNavOpen(false)}>
              The MILŌN Method
            </a>
            <a href="#features" onClick={() => setMobileNavOpen(false)}>
              Platform
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
              The financial health platform
            </span>
            <h1 className="h-anim d2">
              Know your numbers.
              <br />
              <span className="gold-text">Sleep at night.</span>
            </h1>
            <p className="sub h-anim d3">
              Most owners find out about a cash crisis when it's already here. MILŌN shows you your
              business's health as one simple score — where the problem lives, what it's costing
              you, and exactly what to do next. It is also the bridge to your accountant: the same
              screen, both sides, updated every month instead of once a year.
            </p>
            <div className="hero-cta h-anim d4">
              <a className="btn btn-gold" href="#persona">
                Get my free health score
              </a>
              <button
                className="btn btn-ghost"
                onClick={() => setTimeout(() => (window as any).__mq_start?.("accountant"), 300)}
              >
                I'm an accountant — show me the margin
              </button>
            </div>
            <div className="hero-stats h-anim d5">
              <div>
                <b>
                  <span className="count" data-to="1">
                    0
                  </span>
                </b>
                <span>Score that tells the truth</span>
              </div>
              <div>
                <b>
                  <span className="count" data-to="13">
                    0
                  </span>
                  &nbsp;wks
                </b>
                <span>You see cash trouble coming</span>
              </div>
              <div>
                <b>
                  <span className="count" data-to="930">
                    0
                  </span>
                  +
                </b>
                <span>Proven fixes, ranked for you</span>
              </div>
              <div>
                <b>
                  R
                  <span className="count" data-to="1200" data-fmt="space">
                    0
                  </span>
                  +
                </b>
                <span>Advisory uplift per client /mo</span>
              </div>
            </div>
          </div>

          {/* dashboard mockup */}
          <div className="dash-stage h-anim d3">
            <div className="dash" id="dash">
              <div className="dash-top">
                <span className="brand">MILŌN</span>
                <span className="live-pill">
                  <i />
                  Live · synced 2 min ago
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
                      strokeDashoffset="402"
                    />
                  </svg>
                  <div className="val">
                    <div>
                      <b className="count" data-to="78">
                        0
                      </b>
                      <span>Health score</span>
                    </div>
                  </div>
                </div>
                <div className="pillars">
                  <div className="pill-row">
                    <span className="nm">Financing</span>
                    <span className="bar">
                      <i data-w="82%" />
                    </span>
                    <b className="num">82</b>
                  </div>
                  <div className="pill-row">
                    <span className="nm">Assets</span>
                    <span className="bar">
                      <i data-w="74%" />
                    </span>
                    <b className="num">74</b>
                  </div>
                  <div className="pill-row">
                    <span className="nm">Profit</span>
                    <span className="bar">
                      <i data-w="81%" />
                    </span>
                    <b className="num">81</b>
                  </div>
                  <div className="pill-row warn">
                    <span className="nm">Cash</span>
                    <span className="bar">
                      <i data-w="61%" />
                    </span>
                    <b className="num">61</b>
                  </div>
                </div>
              </div>
              <div className="dash-chart">
                <div className="lbl">
                  <b>13-week cash forecast</b>
                  <span>R thousands</span>
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
                Debtor days crept up to <b>52</b>. Chase your top 3 invoices this week — that's{" "}
                <b>R184k</b> unlocked.
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
            <span>End-to-end encrypted</span>
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
            <span>Live sync, every 2 min</span>
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
              <MarketCopy za="SAICA-referenced ratios" us="Industry-standard ratios" />
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
              <MarketCopy za="Built for SA SMEs" us="Built for US SMBs" />
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

      {/* ══════════════════════════ MARKET ══════════════════════════ */}
      <section id="market">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">First, where you operate</span>
            <h2>South Africa or the United States?</h2>
            <p className="sub">
              One product. Currency, dates, and tax follow this choice. The US needs a state so
              sales tax is not guessed.
            </p>
          </div>
          <div className="reveal" style={{ maxWidth: 560, margin: "36px auto 0" }}>
            <MarketPicker value={draftMarket} onChange={setDraftMarket} variant="landing" />
            {!isDraftComplete(draftMarket) && (
              <p
                style={{
                  marginTop: 14,
                  fontSize: 13,
                  color: "var(--ink-dim)",
                  textAlign: "center",
                }}
              >
                Choose a region{draftMarket.country === "US" ? " and state" : ""} to continue.
              </p>
            )}
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
              MILŌN serves two constellations, and connects them. Choose yours and we'll show you
              exactly what you're about to gain.
            </p>
          </div>
          <div className="persona-grid stagger">
            <div
              className={`persona-card${isDraftComplete(draftMarket) ? "" : " is-locked"}`}
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
                You built something real. Now you want to know if the numbers are lying to you — and
                what to do about it, without waiting for your accountant's next call.
              </p>
              <div className="go">
                Take the 90-second diagnostic <i>→</i>
              </div>
            </div>
            <div
              className={`persona-card${isDraftComplete(draftMarket) ? "" : " is-locked"}`}
              onClick={() => (window as any).__mq_start?.("accountant")}
            >
              <div className="icon">
                <svg viewBox="0 0 24 24">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <h3>Accountant / Advisory Firm</h3>
              <p>
                Your compliance work is flawless. Now clients want to actually understand their
                numbers between year-ends — and they'll pay monthly for it.
              </p>
              <div className="go">
                See the advisory revenue model <i>→</i>
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

      {/* ══════════════════════════ METHOD ══════════════════════════ */}
      <section id="method">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">The MILŌN Method</span>
            <h2>Four pillars. One score. No excuses.</h2>
            <p className="sub">
              Every business runs on four forces. MILŌN scores each one every time you upload
              financials, and tells you exactly which is dragging your orbit.
            </p>
          </div>
          <div className="pillar-grid stagger" id="pillarGrid">
            <div className="pillar-card">
              <div className="node" />
              <div className="metaphor">The Sun</div>
              <h3>Profitability</h3>
              <p>
                Gross margin, net margin, EBITDA, and return on equity — the heat that keeps your
                orbit alive.
              </p>
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
              <div className="metaphor">The Orbit</div>
              <h3>Cash Flow</h3>
              <p>
                Operating cash, 13-week forecast,{" "}
                <MarketCopy za="debtor days, creditor days" us="DSO, DPO" />, and cash conversion
                cycle — the motion that keeps you from falling in.
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
              <div className="metaphor">The Mass</div>
              <h3>Asset Productivity</h3>
              <p>
                Working capital, inventory turns, fixed-asset efficiency — everything you own, and
                how hard it works.
              </p>
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
              <div className="metaphor">The Gravity</div>
              <h3>Financing & Solvency</h3>
              <p>
                Debt-to-equity, interest cover, gearing, leverage — the force holding it all
                together, or pulling it in.
              </p>
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
        <p className="cap">31 ratios calculated on every upload</p>
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
            <MarketCopy za="Debtor Days" us="Days Sales Outstanding" />
          </span>
          <span>
            <MarketCopy za="Creditor Days" us="Days Payable Outstanding" />
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
            <MarketCopy za="Labour Productivity" us="Labor Productivity" />
          </span>
          <span>Cost Structure</span>
          <span>Revenue Growth</span>
          <span>
            <MarketCopy za="Profit per Rand Earned" us="Profit per Dollar Earned" />
          </span>
          <span>Cash Burn Rate</span>
          <span>Runway Weeks</span>
          <span>Net Working Capital</span>
          <span>Capital Efficiency</span>
          <span>Equity Multiplier</span>
        </div>
      </div>

      {/* ══════════════════════════ PROBLEM ══════════════════════════ */}
      <section id="problem" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow">The real problem</span>
            <h2>
              Most businesses
              <br />
              don't fail. They <span className="gold-text serif">drift.</span>
            </h2>
          </div>
          <p className="sub reveal" style={{ marginTop: 24 }}>
            <MarketCopy
              za="South African SMEs operate with accountants they see once a quarter, software that reports the past, and no model for what comes next. The result: smart owners, flying blind. MILŌN is the instrument panel that was missing."
              us="US businesses operate with accountants they see once a quarter, software that reports the past, and no model for what comes next. The result: smart owners, flying blind. MILŌN is the instrument panel that was missing."
            />
          </p>
          <div className="steps stagger" style={{ marginTop: 56 }}>
            <div className="step-card">
              <span className="n">01</span>
              <h3>
                <MarketCopy za="You upload your financials" us="Connect QuickBooks or upload" />
              </h3>
              <p>
                <MarketCopy
                  za="Your accountant uploads your income statement, balance sheet, and cash flow — or you do. One PDF, extracted by AI in seconds."
                  us="Connect QuickBooks Online, or upload Excel, CSV, or a bank PDF. One file is enough to start. Xero is also on the list — we do not lead with it."
                />
              </p>
              <span className="time">Under 60 seconds</span>
            </div>
            <div className="step-card">
              <span className="n">02</span>
              <h3>MILŌN scores your business</h3>
              <p>
                <MarketCopy
                  za="31 ratios, 4 pillar scores, one overall health score — mapped against 120 SA industry benchmarks."
                  us="31 ratios, 4 pillar scores, one overall health score — days and percentages, without treating South African medians as US ones."
                />
              </p>
              <span className="time">Instantly</span>
            </div>
            <div className="step-card">
              <span className="n">03</span>
              <h3>You get your next move</h3>
              <p>
                930+ ranked fixes, an AI-drafted advisory report, and a 13-week cashflow — all in
                plain language.
              </p>
              <span className="time">Every month</span>
            </div>
          </div>
        </div>
      </section>

      <div className="divider">
        <div className="wrap">
          <i />
        </div>
      </div>

      {/* ══════════════════════════ THE BRIDGE ══════════════════════════ */}
      <section id="bridge" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">The bridge</span>
            <h2>
              Your accountant has the numbers.
              <br />
              You have the <span className="gold-text serif">decisions.</span>
            </h2>
            <p className="sub">
              That gap is where good businesses drift. MILŌN closes it — one shared workspace where
              the figures your accountant prepares reach you every month, in language you can act
              on, without either of you chasing the other.
            </p>
          </div>

          <div className="bridge-grid stagger">
            <div className="bridge-side">
              <div className="who">For the owner</div>
              <h3>Your numbers, without the wait</h3>
              <p>
                No more finding out in March how last year went. You see where the business stands
                whenever you want to look.
              </p>
              <ul>
                <li>
                  <b>Regular</b> — a fresh score every month, not once a year
                </li>
                <li>
                  <b>Plain</b> — one number and the reason behind it, not a 40-page pack
                </li>
                <li>
                  <b>Yours</b> — open it on your phone without booking a meeting
                </li>
                <li>
                  <b>Answered</b> — your accountant's notes sit on the exact figure they refer to
                </li>
              </ul>
            </div>

            <div className="bridge-link" aria-hidden="true">
              <span className="rail" />
              <span className="node">
                <span>MILŌN</span>
              </span>
              <span className="rail" />
              <span className="cap">One shared view</span>
            </div>

            <div className="bridge-side">
              <div className="who">For the accountant</div>
              <h3>Keep every client in the loop</h3>
              <p>
                The update your clients keep asking for, without the hours it used to cost you to
                produce it one at a time.
              </p>
              <ul>
                <li>
                  <b>Scalable</b> — the whole client book updated on one screen
                </li>
                <li>
                  <b>Drafted</b> — Claude writes the first version, you sign it off
                </li>
                <li>
                  <b>Branded</b> — it goes out as your firm's work, not ours
                </li>
                <li>
                  <b>Proactive</b> — reach the client before they reach you in a panic
                </li>
              </ul>
            </div>
          </div>

          <div className="bridge-facts stagger">
            <div className="bridge-fact">
              <div className="was">Before</div>
              <div className="now">
                Numbers explained once a year, in a meeting nobody remembers.{" "}
                <b>Now: every month, on your own time.</b>
              </div>
            </div>
            <div className="bridge-fact">
              <div className="was">Before</div>
              <div className="now">
                Advice buried in an email thread. <b>Now: attached to the number it is about.</b>
              </div>
            </div>
            <div className="bridge-fact">
              <div className="was">Before</div>
              <div className="now">
                Owner and accountant guessing what the other can see.{" "}
                <b>Now: the same screen, both sides.</b>
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

      {/* ══════════════════════════ FEATURES ══════════════════════════ */}
      <section id="features">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">The Platform</span>
            <h2>Two portals. One constellation.</h2>
            <p className="sub">
              Two sides of the same workspace: owners get clarity they can act on, accountants get
              the leverage to deliver it across every client. The relationship stops being annual
              and starts being a monthly advisory practice.
            </p>
          </div>
          <div className="feat-cols stagger">
            <div className="feat-card">
              <div className="who">For Business Owners</div>
              <h3>Your financial cockpit</h3>
              <ul>
                <li>
                  <b>Live health score</b> — one number, updated every time your data changes
                </li>
                <li>
                  <b>13-week cashflow forecast</b> — see shortfalls weeks before they hit
                </li>
                <li>
                  <b>Playbook of 930+ fixes</b> — ranked by impact, filtered to your situation
                </li>
                <li>
                  <b>Four pillar breakdown</b> — profitability, cash, assets, solvency
                </li>
                <li>
                  <b>Accountant notes in-context</b> — advice lands on the exact number it refers to
                </li>
                <li>
                  <b>PDF financial extraction</b> — upload a statement, AI does the rest
                </li>
              </ul>
            </div>
            <div className="feat-card">
              <div className="who" style={{ color: "var(--gold-bright)" }}>
                For Accountants
              </div>
              <h3>Your advisory engine</h3>
              <ul>
                <li>
                  <b>Multi-client dashboard</b> — live health across your entire portfolio
                </li>
                <li>
                  <b>AI advisory drafter</b> — Claude drafts the report; you refine and send
                </li>
                <li>
                  <b>10 white-label report formats</b> — your brand, your margin
                </li>
                <li>
                  <b>Risk radar</b> — flag deteriorating clients before the crisis call
                </li>
                <li>
                  <b>Industry news digest</b> — always have sector context ready
                </li>
                <li>
                  <b>Recurring retainer model</b> —{" "}
                  <MarketCopy
                    za={`${LIST_PRICES.za.retainerUplift} uplift per client per month`}
                    us={`${LIST_PRICES.us.retainerUplift} uplift per client per month`}
                  />
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ PRICING ══════════════════════════ */}
      <section id="pricing">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Pricing</span>
            <h2>
              Start free. <span className="gold-text">Scale when it pays for itself.</span>
            </h2>
            <p className="sub">
              Every plan includes the core health score and cashflow forecast. Upgrade when you're
              ready for the full constellation.
            </p>
          </div>

          {/* accountant pricing — shown via body class set by quiz */}
          <div className="acc-pricing" id="accPricing">
            <div
              style={{
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: ".3em",
                textTransform: "uppercase",
                color: "var(--gold)",
                marginBottom: 10,
              }}
            >
              Accountant / Advisory Firm Pricing
            </div>
            <p style={{ color: "var(--ink-dim)", fontSize: 14, marginBottom: 18 }}>
              White-label the whole platform. Charge your clients a monthly advisory retainer. MILŌN
              is your engine.
            </p>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              <li style={{ display: "flex", gap: 10, fontSize: 14, color: "var(--ink-dim)" }}>
                <span style={{ color: "var(--gold)" }}>✦</span>Up to 150 clients — planned{" "}
                <MarketCopy
                  za={`${LIST_PRICES.za.firm150}/mo`}
                  us={`${LIST_PRICES.us.firm150}/mo`}
                />{" "}
                (not billed yet)
              </li>
              <li style={{ display: "flex", gap: 10, fontSize: 14, color: "var(--ink-dim)" }}>
                <span style={{ color: "var(--gold)" }}>✦</span>Unlimited clients — planned{" "}
                <MarketCopy
                  za={`${LIST_PRICES.za.firmUnlimited}/mo`}
                  us={`${LIST_PRICES.us.firmUnlimited}/mo`}
                />{" "}
                (not billed yet)
              </li>
              <li style={{ display: "flex", gap: 10, fontSize: 14, color: "var(--ink-dim)" }}>
                <span style={{ color: "var(--gold)" }}>✦</span>White-label onboarding support
                included
              </li>
              <li style={{ display: "flex", gap: 10, fontSize: 14, color: "var(--ink-dim)" }}>
                <span style={{ color: "var(--gold)" }}>✦</span>Your branding on every report and
                portal
              </li>
            </ul>
            <div style={{ marginTop: 22 }}>
              <a className="btn btn-gold" href="/auth">
                Set up your firm account →
              </a>
            </div>
          </div>

          <div className="price-grid stagger">
            <div className="price-card hot">
              <span className="tag">Early access</span>
              <h3>Spark</h3>
              <div className="amount">Free</div>
              <div className="per">Pilot access · no card required</div>
              <ul>
                <li>Business health score from your figures</li>
                <li>Cash forecast + budget workspace</li>
                <li>Next moves and action plan</li>
                <li>Share workspace with your accountant</li>
              </ul>
              <button
                className="btn btn-gold"
                onClick={() => {
                  setRegPlan("Spark — Free early access");
                  document.getElementById("register")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Start free ✦
              </button>
            </div>

            <div className="price-card">
              <h3>Orbit</h3>
              <div className="amount">
                <MarketCopy
                  za={
                    <>
                      {LIST_PRICES.za.orbit}
                      <small>/mo</small>
                    </>
                  }
                  us={
                    <>
                      {LIST_PRICES.us.orbit}
                      <small>/mo</small>
                    </>
                  }
                />
              </div>
              <div className="per">Coming soon — not billed yet</div>
              <ul>
                <li>Live 13-week cashflow forecast</li>
                <li>Full ratio set + playbook</li>
                <li>Accountant advisory notes</li>
                <li>Monthly comparison report</li>
              </ul>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setRegPlan("Spark — Free early access");
                  toast.message("Orbit billing is not live yet — join on Spark for free.");
                  document.getElementById("register")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Join waitlist
              </button>
            </div>

            <div className="price-card">
              <h3>Constellation</h3>
              <div className="amount">
                <MarketCopy
                  za={
                    <>
                      {LIST_PRICES.za.constellation}
                      <small>/mo</small>
                    </>
                  }
                  us={
                    <>
                      {LIST_PRICES.us.constellation}
                      <small>/mo</small>
                    </>
                  }
                />
              </div>
              <div className="per">Coming soon — not billed yet</div>
              <ul>
                <li>Everything planned for Orbit</li>
                <li>AI advisory draft</li>
                <li>Industry digest + priority support</li>
              </ul>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setRegPlan("Spark — Free early access");
                  toast.message("Constellation billing is not live yet — join on Spark for free.");
                  document.getElementById("register")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Join waitlist
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ REGISTER ══════════════════════════ */}
      <section id="register" style={{ paddingBottom: 80 }}>
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Get started</span>
            <h2>
              Your first health score
              <br />
              is <span className="gold-text">free for early access.</span>
            </h2>
            <p className="sub">
              Upload your figures and MILŌN scores your business — usually within a minute after
              processing.
            </p>
          </div>

          {/* Client-only: prevents browser password-manager extensions (LastPass etc.)
              from injecting DOM nodes during SSR hydration and crashing React */}
          {mounted && (
            <div className="reg-shell">
              <form onSubmit={handleRegister}>
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
                      to take ownership and see your numbers.
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

                    <button
                      type="submit"
                      className="btn btn-gold"
                      disabled={regBusy}
                      style={{ width: "100%", justifyContent: "center", marginTop: 28 }}
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
                      onChange={(e) => setRegRole(e.target.value)}
                    >
                      <option>Business owner</option>
                      <option>Accountant / Advisory firm</option>
                    </select>

                    {regRole === "Accountant / Advisory firm" ? (
                      <p
                        style={{
                          marginTop: 18,
                          color: "var(--ink-dim)",
                          fontSize: 14,
                          lineHeight: 1.6,
                        }}
                      >
                        Accountant accounts are set up through our dedicated firm portal.{" "}
                        <a href="/auth" style={{ color: "var(--gold)" }}>
                          Click here to register your firm →
                        </a>
                      </p>
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
                          onError={(msg) => toast.error(msg)}
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
                          onChange={(e) => setRegPlan(e.target.value)}
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
                          {regBusy ? "Creating your account…" : "Get my free health score ✦"}
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
                          No credit card for Spark. Paid plans are not billed yet. By creating an
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

      {/* ══════════════════════════ FOOTER ══════════════════════════ */}
      <footer>
        <div className="wrap">
          <div>
            <span className="logo-word gold-text">MILŌN</span>
            <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              The financial health platform
              <br />
              <MarketCopy za="for South African SMEs" us="for US small businesses" />
            </span>
          </div>
          <nav className="fnav" aria-label="Footer navigation">
            <a href="#persona">Start</a>
            <a href="#method">The Method</a>
            <a href="#features">Platform</a>
            <a href="#pricing">Pricing</a>
            <a href="/auth">Accountant portal</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/ai">AI notice</a>
            <a href="/faq">Questions</a>
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
              <MarketCopy
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
