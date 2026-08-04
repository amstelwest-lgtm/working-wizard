import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { SIGNUP_ACCESS_CODE, notifySignup } from "@/lib/signup-notify";
// @ts-ignore — raw import fine for dynamic CSS injection
import landingCSS from "../styles/landing.css?raw";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "MILŌN — Know your numbers. Sleep at night." },
      { name: "description", content: "MILŌN is the financial health platform for South African SMEs and their accountants. One score. 31 ratios. 13-week cashflow. 930+ fixes ranked for you." },
    ],
  }),
});

/* ─────────────────────────────────────────────────────────────── */

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  /* ── sign-in modal state ── */
  const [signinOpen, setSigninOpen]     = useState(false);
  const [siEmail, setSiEmail]           = useState("");
  const [siPassword, setSiPassword]     = useState("");
  const [siBusy, setSiBusy]             = useState(false);
  const [siError, setSiError]           = useState("");

  /* ── forgot-password state ── */
  const [fpMode, setFpMode]             = useState(false);
  const [fpEmail, setFpEmail]           = useState("");
  const [fpBusy, setFpBusy]             = useState(false);
  const [fpDone, setFpDone]             = useState(false);

  /* ── mounted gate — form is client-only to prevent browser-extension
     (e.g. LastPass) DOM injections from causing a hydration mismatch crash ── */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  /* ── register form state ── */
  const [regRole, setRegRole]           = useState("Business owner");
  const [regName, setRegName]           = useState("");
  const [regEmail, setRegEmail]         = useState("");
  const [regPassword, setRegPassword]   = useState("");
  const [regCode, setRegCode]           = useState("");
  const [regBusiness, setRegBusiness]   = useState("");
  const [regPlan, setRegPlan]           = useState("Orbit — R699/mo");
  const [regBusy, setRegBusy]           = useState(false);
  const [regDone, setRegDone]           = useState(false);

  /* ── redirect if already signed in ── */
  useEffect(() => {
    if (!loading && user) navigate({ to: "/app" });
  }, [user, loading, navigate]);

  /* ── inject landing CSS + data-theme, clean up on unmount ── */
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "milon-landing-css";
    el.textContent = landingCSS;
    document.head.appendChild(el);
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
    return () => {
      document.head.removeChild(el);
      delete document.documentElement.dataset.theme;
    };
  }, []);

  /* ── vanilla-JS animations (scroll progress, reveal, count-up, quiz) ── */
  useEffect(() => {
    const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* scroll progress + nav */
    const prog    = document.getElementById("progress") as HTMLElement | null;
    const topnav  = document.getElementById("topnav")   as HTMLElement | null;
    function onScroll() {
      const max = document.body.scrollHeight - innerHeight;
      if (prog)   prog.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + "%";
      if (topnav) topnav.classList.toggle("scrolled", scrollY > 10);
    }
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* intersection reveal */
    const io = new IntersectionObserver(
      es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.13 }
    );
    document.querySelectorAll(".reveal,.stagger").forEach(el => io.observe(el));

    /* count-up */
    function fmt(n: number, f?: string) {
      return f === "space" ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : String(n);
    }
    const cio = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target as HTMLElement;
      const to = +(el.dataset.to || 0), f = el.dataset.fmt;
      cio.unobserve(el);
      if (REDUCE) { el.textContent = fmt(to, f); return; }
      const t0 = performance.now(), dur = 1400;
      (function tick(t: number) {
        const p = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(Math.round(to * ease), f);
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }), { threshold: 0.6 });
    document.querySelectorAll(".count").forEach(el => cio.observe(el));

    /* dashboard animation */
    const dash = document.getElementById("dash");
    if (dash) {
      const dio = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        dio.unobserve(dash);
        dash.classList.add("in");
        const g = document.getElementById("gaugeFill");
        if (g) requestAnimationFrame(() => { g.style.strokeDashoffset = String(402 * (1 - 0.78)); });
        dash.querySelectorAll(".pill-row .bar i").forEach((b: any, i) => {
          setTimeout(() => { b.style.width = b.dataset.w; }, 200 + i * 140);
        });
      }), { threshold: 0.35 });
      dio.observe(dash);
    }

    /* pillar bars */
    const pg = document.getElementById("pillarGrid");
    if (pg) {
      const pio = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        pio.unobserve(pg);
        pg.querySelectorAll(".score .bar i").forEach((b: any, i) => {
          setTimeout(() => { b.style.width = b.dataset.w; }, 350 + i * 160);
        });
      }), { threshold: 0.3 });
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
        c.style.setProperty("--mx", (e.clientX - r.left) + "px");
        c.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });

    /* theme toggle */
    const tbtn = document.getElementById("themeToggle");
    if (tbtn) tbtn.onclick = () => {
      const isDark = document.documentElement.dataset.theme === "dark";
      document.documentElement.dataset.theme = isDark ? "light" : "dark";
      tbtn.textContent = isDark ? "☾" : "☀";
    };

    /* ── quiz engine ── */
    const QUIZ: Record<string, Array<{ q: string; hint: string; opts: string[][]; key: string; reward: string }>> = {
      owner: [
        { q: "What does your business do?", hint: "This places your first planet.", opts: [["🛍","Retail / E-commerce"],["🔧","Services"],["🏗","Construction"],["🍽","Hospitality"],["🏭","Manufacturing"],["🚚","Transport / Logistics"]], key: "industry", reward: "✦ Industry mapped — your sun just ignited." },
        { q: "How do customers pay you?", hint: "This shapes your cash orbit.", opts: [["⚡","Upfront / on the spot"],["📅","On account — 30+ days"],["🔁","Monthly retainers"],["🧩","A mix of everything"]], key: "cashcycle", reward: "✦ Cash cycle charted — second planet in orbit." },
        { q: "What keeps you up at night?", hint: "Be honest. We've heard it all.", opts: [["💧","Cash runs dry before month-end"],["❓","I don't know if I'm actually profitable"],["⛓","Debt is eating my margins"],["🐢","Customers pay me late"]], key: "pain", reward: "✦ Pain point locked. Now we can aim." },
        { q: "Roughly, your annual turnover?", hint: "This sets your peer group.", opts: [["🌱","Under R1m"],["🌿","R1m – R5m"],["🌳","R5m – R20m"],["🌲","R20m+"]], key: "size", reward: "✦ Constellation complete." },
      ],
      accountant: [
        { q: "What does your practice mostly do today?", hint: "This places your first star.", opts: [["📋","Compliance & tax"],["📊","Bookkeeping & payroll"],["💼","Some advisory already"],["🚀","Full CFO services"]], key: "industry", reward: "✦ Practice profile started." },
        { q: "How many SME clients do you serve?", hint: "This sizes your constellation.", opts: [["✦","1 – 10"],["✦✦","11 – 50"],["✦✦✦","51 – 150"],["🌌","150+"]], key: "cashcycle", reward: "✦ Client universe mapped." },
        { q: "What's your biggest frustration?", hint: "The thing that steals your margin.", opts: [["⏳","Clients only call in a crisis"],["💸","Can't charge for the advice I give"],["🗂","Data arrives late and messy"],["📉","Compliance fees keep shrinking"]], key: "pain", reward: "✦ Pain point locked. This is fixable." },
        { q: "What would change your practice most?", hint: "Your north star.", opts: [["💰","Recurring advisory revenue"],["🛰","Live oversight of every client"],["🏷","Reports with my brand on them"],["🤝","Deeper client relationships"]], key: "size", reward: "✦ Constellation complete." },
      ],
    };
    const REFLECT: Record<string, Record<string, string[]>> = {
      owner: {
        "💧": ["cash flow", "Your cash dries up before the month does. You're not alone — cash kills more SA businesses than losses do. <b>MILŌN's 13-week cashflow forecast shows you the shortfall weeks before it lands — and gives you the exact moves to close it.</b>"],
        "❓": ["profit clarity", "You're working hard but flying blind on whether it's actually profitable. <b>MILŌN turns your numbers into one health score and 31 plain-language ratios — so you know, every week, if the harvest is real.</b>"],
        "⛓": ["debt pressure", "Debt is quietly eating what you earn. <b>MILŌN tracks your debt drag and interest burden live, and ranks the highest-impact moves to lighten the load.</b>"],
        "🐢": ["slow payers", "Late payers are using you as a free bank. <b>MILŌN flags your cash-trapped days, shows the cost in rand, and gives you the playbook to get paid faster.</b>"],
      },
      accountant: {
        "⏳": ["crisis-only clients", "Your clients only call when it's already on fire. <b>MILŌN gives you a live radar over every client — risk flags reach you before the panic call does.</b>"],
        "💸": ["unbilled advice", "You give away advisory value inside compliance fees. <b>MILŌN packages your insight into a branded, recurring retainer clients can see and gladly pay for.</b>"],
        "🗂": ["messy data", "You can't advise on data that arrives late and broken. <b>MILŌN keeps client numbers live and structured — comment on the actual figures, in context, instantly.</b>"],
        "📉": ["fee compression", "Compliance is a shrinking island. <b>MILŌN is your bridge to advisory — 10 white-label reports and a system that sells your expertise for you.</b>"],
      },
    };
    let qRole = "owner", step = 0, answers: Record<string, { em: string; label: string }> = {};

    function startQuiz(r: string) {
      qRole = r; step = 0; answers = {};
      document.body.className = "persona-" + r;
      const quiz = document.getElementById("quiz");
      if (quiz) { quiz.classList.add("active"); quiz.scrollIntoView({ behavior: "smooth" }); }
      renderStep();
    }
    function renderStep() {
      const steps = QUIZ[qRole], holder = document.getElementById("qsteps");
      const qbar  = document.getElementById("qbar");
      if (qbar) qbar.style.width = (step / steps.length) * 100 + "%";
      if (step >= steps.length) { renderResult(); return; }
      const s = steps[step];
      if (holder) holder.innerHTML = `<div class="q-step on">
        <h3>${s.q}</h3>
        <p class="hint">${s.hint} <span style="color:var(--gold)">Question ${step + 1} of ${steps.length}</span></p>
        <div class="opt-grid">${s.opts.map(o => `<button class="opt" onclick="window.__mq_pick('${s.key}','${o[0]}','${o[1].replace(/'/g, "\\'")}',this)"><span class="em">${o[0]}</span>${o[1]}</button>`).join("")}</div>
      </div>`;
      const qreward = document.getElementById("qreward");
      if (qreward) qreward.textContent = "";
    }
    function pick(key: string, em: string, label: string, el: Element) {
      document.querySelectorAll(".opt").forEach(b => b.classList.remove("picked"));
      el.classList.add("picked");
      answers[key] = { em, label };
      const qreward = document.getElementById("qreward");
      if (qreward) qreward.textContent = QUIZ[qRole][step].reward;
      setTimeout(() => { step++; renderStep(); }, 850);
    }
    function renderResult() {
      const qbar = document.getElementById("qbar");
      if (qbar) qbar.style.width = "100%";
      const a = answers;
      const r = REFLECT[qRole][a.pain?.em] || Object.values(REFLECT[qRole])[0];
      const lines = qRole === "owner"
        ? `<p>Industry: <b>${a.industry?.label}</b></p><p>Cash cycle: <b>${a.cashcycle?.label}</b></p><p>Size band: <b>${a.size?.label}</b></p>`
        : `<p>Practice focus: <b>${a.industry?.label}</b></p><p>Client base: <b>${a.cashcycle?.label}</b></p><p>North star: <b>${a.size?.label}</b></p>`;
      const holder = document.getElementById("qsteps");
      if (holder) holder.innerHTML = `<div class="q-step on">
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
      if (sel) [...sel.options].forEach(o => { if (o.value.startsWith(p)) sel.value = o.value; });
    }

    (window as any).__mq_start = startQuiz;
    (window as any).__mq_pick  = pick;
    (window as any).__mq_plan  = pickPlan;

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
    } finally { setFpBusy(false); }
  };

  /* ── sign-in handler ── */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiError("");
    setSiBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: siEmail, password: siPassword });
      if (error) throw error;
      setSigninOpen(false);
      navigate({ to: "/app" });
    } catch (err: unknown) {
      setSiError(err instanceof Error ? err.message : "Sign in failed");
    } finally { setSiBusy(false); }
  };

  /* ── register handler ── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regRole === "Accountant / Advisory firm") {
      navigate({ to: "/auth" });
      return;
    }
    if (!regPassword || regPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (regCode.trim() !== SIGNUP_ACCESS_CODE) {
      toast.error("Invalid access code. Contact us to get access.");
      return;
    }
    setRegBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: regEmail, password: regPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/app`,
          data: {
            full_name: regName.trim(),
            business_name: regBusiness.trim() || regName.trim(),
            signup_type: "customer",
            plan: regPlan,
          },
        },
      });
      if (error) throw error;
      notifySignup("Business owner", regEmail, regName.trim());
      if (data.session && data.user) {
        const { data: existing } = await supabase
          .from("clients").select("id").eq("owner_user_id", data.user.id).limit(1).maybeSingle();
        if (!existing) {
          await supabase.from("clients").insert({
            name: regBusiness.trim() || regName.trim() || regEmail,
            owner_user_id: data.user.id,
          });
        }
        navigate({ to: "/app" });
        return;
      }
      setRegDone(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Registration failed.");
    } finally { setRegBusy(false); }
  };

  /* ── email confirmation screen ── */
  if (regDone) {
    return (
      <div style={{ minHeight:"100vh", background:"#050507", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 16px" }}>
        <div style={{ width:"100%", maxWidth:420, borderRadius:28, padding:"44px 36px", background:"rgba(13,13,20,.96)", border:"1px solid rgba(212,175,55,.2)", boxShadow:"0 30px 80px rgba(0,0,0,.6)", textAlign:"center" }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:"rgba(212,175,55,.1)", display:"grid", placeItems:"center", margin:"0 auto 22px" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <h2 style={{ fontSize:20, fontWeight:700, color:"#f2ecdc", margin:"0 0 10px" }}>Check your email</h2>
          <p style={{ fontSize:14, color:"#9b958a", lineHeight:1.6 }}>
            We sent a confirmation link to <span style={{ color:"#d4af37" }}>{regEmail}</span>. Click it to activate your account.
          </p>
          <button onClick={() => setRegDone(false)} style={{ marginTop:26, fontSize:12, color:"#9b958a", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════ MAIN RENDER ═══════════════════════════ */
  return (
    <>
      {/* ── sign-in modal ── */}
      {signinOpen && (
        <div className="milon-signin-modal" onClick={() => { setSigninOpen(false); setFpMode(false); setFpDone(false); setSiError(""); }}>
          <div className="milon-signin-box" onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
              <h2>{fpMode ? (fpDone ? "Check your email" : "Reset password") : "Sign in to MILŌN"}</h2>
              <button onClick={() => { setSigninOpen(false); setFpMode(false); setFpDone(false); setSiError(""); }} style={{ width:36, height:36, borderRadius:"50%", border:"1px solid var(--line)", background:"transparent", color:"var(--ink-dim)", cursor:"pointer", fontSize:20, display:"grid", placeItems:"center" }}>×</button>
            </div>

            {/* ── forgot-password: done state ── */}
            {fpMode && fpDone ? (
              <div style={{ textAlign:"center", padding:"8px 0 16px" }}>
                <div style={{ width:48, height:48, borderRadius:"50%", background:"rgba(212,175,55,.1)", display:"grid", placeItems:"center", margin:"0 auto 18px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                  </svg>
                </div>
                <p style={{ fontSize:14, color:"var(--ink-dim)", lineHeight:1.6 }}>
                  We sent a reset link to <span style={{ color:"var(--gold)" }}>{fpEmail}</span>. Check your inbox and follow the link to set a new password.
                </p>
                <button onClick={() => { setFpMode(false); setFpDone(false); setSiError(""); }} style={{ marginTop:22, fontSize:12, color:"var(--ink-dim)", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>
                  ← Back to sign in
                </button>
              </div>

            /* ── forgot-password: email entry ── */
            ) : fpMode ? (
              <form onSubmit={handleForgotPassword}>
                <p style={{ fontSize:13, color:"var(--ink-dim)", marginBottom:18, lineHeight:1.6 }}>
                  Enter your email address and we'll send you a link to reset your password.
                </p>
                <div className="field">
                  <label>Email</label>
                  <input type="email" required autoFocus placeholder="you@business.co.za" value={fpEmail} onChange={e => setFpEmail(e.target.value)} />
                </div>
                {siError && <p style={{ fontSize:13, color:"var(--risk)", margin:"8px 0" }}>{siError}</p>}
                <button type="submit" className="btn btn-gold" disabled={fpBusy} style={{ width:"100%", justifyContent:"center", marginTop:18 }}>
                  {fpBusy ? "Sending…" : "Send reset link ✦"}
                </button>
                <p style={{ marginTop:14, fontSize:12, color:"var(--ink-dim)", textAlign:"center" }}>
                  <button type="button" onClick={() => { setFpMode(false); setSiError(""); }} style={{ background:"none", border:"none", color:"var(--gold)", cursor:"pointer", fontSize:12, padding:0 }}>
                    ← Back to sign in
                  </button>
                </p>
              </form>

            /* ── normal sign-in ── */
            ) : (
              <>
                <form onSubmit={handleSignIn}>
                  <div className="field">
                    <label>Email</label>
                    <input type="email" required placeholder="you@business.co.za" value={siEmail} onChange={e => setSiEmail(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input type="password" required placeholder="••••••••" value={siPassword} onChange={e => setSiPassword(e.target.value)} />
                    <button type="button" onClick={() => { setFpEmail(siEmail); setFpMode(true); setSiError(""); }} style={{ display:"block", marginTop:6, fontSize:12, color:"var(--ink-dim)", background:"none", border:"none", cursor:"pointer", padding:0, textAlign:"right", width:"100%", textDecoration:"underline" }}>
                      Forgot password?
                    </button>
                  </div>
                  {siError && <p style={{ fontSize:13, color:"var(--risk)", margin:"8px 0" }}>{siError}</p>}
                  <button type="submit" className="btn btn-gold" disabled={siBusy} style={{ width:"100%", justifyContent:"center", marginTop:18 }}>
                    {siBusy ? "Signing in…" : "Sign in ✦"}
                  </button>
                </form>
                <p style={{ marginTop:18, fontSize:12, color:"var(--ink-dim)", textAlign:"center" }}>
                  Accountant?{" "}
                  <a href="/auth" style={{ color:"var(--gold)", textDecoration:"none" }}>Sign in to the accountant portal →</a>
                </p>
                <p style={{ marginTop:8, fontSize:12, color:"var(--ink-dim)", textAlign:"center" }}>
                  New here?{" "}
                  <button onClick={() => { setSigninOpen(false); document.getElementById("register")?.scrollIntoView({ behavior:"smooth" }); }}
                    style={{ background:"none", border:"none", color:"var(--gold)", cursor:"pointer", fontSize:12, padding:0 }}>
                    Get your free health score
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── atmosphere ── */}
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" /><div className="glow g2" /><div className="glow g3" />
        <div className="grid" />
        <div className="stars" />
      </div>
      <div id="progress" aria-hidden="true" />

      {/* ── nav ── */}
      <nav id="topnav">
        <div className="wrap">
          <a className="logo" href="#hero">
            <svg viewBox="0 0 40 40" fill="none" height="34" width="34">
              <circle cx="20" cy="20" r="18" stroke="url(#ng1)" strokeWidth="1.4"/>
              <path d="M11 27 L17 13 L23 22 L27 11" stroke="url(#ng1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="ng1" x1="0" y1="0" x2="40" y2="40">
                  <stop stopColor="#fdee79"/><stop offset="1" stopColor="#ac8400"/>
                </linearGradient>
              </defs>
            </svg>
            <span className="logo-word gold-text">MILŌN</span>
          </a>
          <div className="links">
            <a href="#persona">Start</a>
            <a href="#register">Sign up</a>
            <a href="#method">The MILŌN Method</a>
            <a href="#features">Platform</a>
            <a href="#pricing">Pricing</a>
            <button id="themeToggle" title="Toggle light / dark">☀</button>
            <button className="btn btn-gold" style={{ padding:"10px 22px", fontSize:13 }} onClick={() => { setSiError(""); setSigninOpen(true); }}>
              Sign in
            </button>
          </div>
        </div>
      </nav>

      {/* ══════════════════════════ HERO ══════════════════════════ */}
      <section id="hero">
        <div className="wrap">
          <div>
            <span className="hero-badge h-anim d1"><span className="pulse" />The financial health platform</span>
            <h1 className="h-anim d2">Know your numbers.<br /><span className="gold-text">Sleep at night.</span></h1>
            <p className="sub h-anim d3">
              Most owners find out about a cash crisis when it's already here. MILŌN shows you your business's health as one simple score — where the problem lives, what it's costing you, and exactly what to do next. A CFO in your pocket. And your accountant's AI sidekick.
            </p>
            <div className="hero-cta h-anim d4">
              <a className="btn btn-gold" href="#persona">Get my free health score</a>
              <button className="btn btn-ghost" onClick={() => setTimeout(() => (window as any).__mq_start?.("accountant"), 300)}>
                I'm an accountant — show me the margin
              </button>
            </div>
            <div className="hero-stats h-anim d5">
              <div><b><span className="count" data-to="1">0</span></b><span>Score that tells the truth</span></div>
              <div><b><span className="count" data-to="13">0</span>&nbsp;wks</b><span>You see cash trouble coming</span></div>
              <div><b><span className="count" data-to="930">0</span>+</b><span>Proven fixes, ranked for you</span></div>
              <div><b>R<span className="count" data-to="1200" data-fmt="space">0</span>+</b><span>Advisory uplift per client /mo</span></div>
            </div>
          </div>

          {/* dashboard mockup */}
          <div className="dash-stage h-anim d3">
            <div className="dash" id="dash">
              <div className="dash-top">
                <span className="brand">MILŌN</span>
                <span className="live-pill"><i />Live · synced 2 min ago</span>
              </div>
              <div className="dash-main">
                <div className="gauge">
                  <svg width="150" height="150" viewBox="0 0 150 150">
                    <defs>
                      <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#fdee79"/><stop offset=".6" stopColor="#d4af37"/><stop offset="1" stopColor="#ac8400"/>
                      </linearGradient>
                      <linearGradient id="cashGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor="#ac8400"/><stop offset=".5" stopColor="#d4af37"/><stop offset="1" stopColor="#fdee79"/>
                      </linearGradient>
                      <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="rgba(212,175,55,.28)"/><stop offset="1" stopColor="rgba(212,175,55,0)"/>
                      </linearGradient>
                    </defs>
                    <circle className="track" cx="75" cy="75" r="64" fill="none" strokeWidth="9"/>
                    <circle className="fill" id="gaugeFill" cx="75" cy="75" r="64" fill="none" strokeWidth="9" strokeDasharray="402" strokeDashoffset="402"/>
                  </svg>
                  <div className="val"><div><b className="count" data-to="78">0</b><span>Health score</span></div></div>
                </div>
                <div className="pillars">
                  <div className="pill-row"><span className="nm">Financing</span><span className="bar"><i data-w="82%" /></span><b className="num">82</b></div>
                  <div className="pill-row"><span className="nm">Assets</span><span className="bar"><i data-w="74%" /></span><b className="num">74</b></div>
                  <div className="pill-row"><span className="nm">Profit</span><span className="bar"><i data-w="81%" /></span><b className="num">81</b></div>
                  <div className="pill-row warn"><span className="nm">Cash</span><span className="bar"><i data-w="61%" /></span><b className="num">61</b></div>
                </div>
              </div>
              <div className="dash-chart">
                <div className="lbl"><b>13-week cash forecast</b><span>R thousands</span></div>
                <svg className="cash-svg" viewBox="0 0 520 120" preserveAspectRatio="none" aria-hidden="true">
                  <line x1="0" y1="96" x2="520" y2="96" stroke="rgba(212,175,55,.14)" strokeWidth="1" strokeDasharray="3 5"/>
                  <path className="cash-fill" d="M0 58 C40 50,70 44,105 48 C140 52,165 66,200 78 C235 90,258 96,290 92 C322 88,345 70,385 56 C425 42,470 34,520 28 L520 120 L0 120 Z"/>
                  <path className="cash-line" d="M0 58 C40 50,70 44,105 48 C140 52,165 66,200 78 C235 90,258 96,290 92 C322 88,345 70,385 56 C425 42,470 34,520 28"/>
                  <circle className="dip-ring" cx="272" cy="94" r="4"/>
                  <circle className="dip-dot"  cx="272" cy="94" r="4"/>
                </svg>
                <div className="alert-chip">
                  <span className="dot" />
                  <span><b>Cash dip — Week 6.</b> <span>Action plan ready: 3 moves close the gap.</span></span>
                </div>
              </div>
            </div>
            <div className="float-card fc-1">
              <span className="tag">Accountant note</span>
              <p>Debtor days crept up to <b>52</b>. Chase your top 3 invoices this week — that's <b>R184k</b> unlocked.</p>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:"var(--gold)" }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>End-to-end encrypted</span>
          </div>
          <div className="item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:"var(--gold)" }}>
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>Live sync, every 2 min</span>
          </div>
          <div className="item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:"var(--gold)" }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>SAICA-referenced ratios</span>
          </div>
          <div className="item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:"var(--gold)" }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>Built for SA SMEs</span>
          </div>
          <div className="item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:"var(--gold)" }}>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span>Powered by Gemini AI</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════ PERSONA ══════════════════════════ */}
      <section id="persona">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Start here</span>
            <h2>Who are you in this story?</h2>
            <p className="sub">MILŌN serves two constellations. Choose yours and we'll show you exactly what you're about to gain.</p>
          </div>
          <div className="persona-grid stagger">
            <div className="persona-card" onClick={() => (window as any).__mq_start?.("owner")}>
              <div className="icon">
                <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </div>
              <h3>Business Owner</h3>
              <p>You built something real. Now you want to know if the numbers are lying to you — and what to do about it.</p>
              <div className="go">Take the 90-second diagnostic <i>→</i></div>
            </div>
            <div className="persona-card" onClick={() => (window as any).__mq_start?.("accountant")}>
              <div className="icon">
                <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              </div>
              <h3>Accountant / Advisory Firm</h3>
              <p>Your compliance work is flawless. Now clients want strategic insight — and they'll pay monthly for it.</p>
              <div className="go">See the advisory revenue model <i>→</i></div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ QUIZ ══════════════════════════ */}
      <section id="quiz">
        <div className="wrap">
          <div className="quiz-shell">
            <div className="quiz-progress"><i id="qbar" /></div>
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
            <p className="sub">Every business has four financial organs. MILŌN scores each one every time you upload financials, and tells you exactly which is dragging your orbit.</p>
          </div>
          <div className="pillar-grid stagger" id="pillarGrid">
            <div className="pillar-card">
              <div className="node" />
              <div className="metaphor">The Sun</div>
              <h3>Profitability</h3>
              <p>Gross margin, net margin, EBITDA, and return on equity — the heat that keeps your orbit alive.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar"><i data-w="81%" /></span>
                <b>81</b>
              </div>
            </div>
            <div className="pillar-card">
              <div className="node" />
              <div className="metaphor">The River</div>
              <h3>Cash Flow</h3>
              <p>Operating cash, 13-week forecast, debtor days, creditor days, and cash conversion cycle.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar"><i data-w="61%" /></span>
                <b>61</b>
              </div>
            </div>
            <div className="pillar-card warn">
              <div className="node" />
              <div className="metaphor">The Skeleton</div>
              <h3>Asset Productivity</h3>
              <p>Working capital, inventory turns, fixed-asset efficiency — how well the structure bears weight.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar"><i data-w="74%" /></span>
                <b>74</b>
              </div>
            </div>
            <div className="pillar-card">
              <div className="node" />
              <div className="metaphor">The Backbone</div>
              <h3>Financing & Solvency</h3>
              <p>Debt-to-equity, interest cover, gearing, leverage — the load-bearing structure of your business.</p>
              <div className="score">
                <span>Demo</span>
                <span className="bar"><i data-w="82%" /></span>
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
          <span>Debtor Days</span>
          <span>Creditor Days</span>
          <span>Inventory Turnover</span>
          <span>Cash Conversion Cycle</span>
          <span>Working Capital Ratio</span>
          <span>Asset Turnover</span>
          <span>Fixed Asset Efficiency</span>
          <span>Gearing Ratio</span>
          <span>Leverage Ratio</span>
          <span>Break-even Point</span>
          <span>Revenue per Employee</span>
          <span>Labour Productivity</span>
          <span>Cost Structure</span>
          <span>Revenue Growth</span>
          <span>Profit per Rand Earned</span>
          <span>Cash Burn Rate</span>
          <span>Runway Weeks</span>
          <span>Net Working Capital</span>
          <span>Capital Efficiency</span>
          <span>Equity Multiplier</span>
        </div>
      </div>

      {/* ══════════════════════════ PROBLEM ══════════════════════════ */}
      <section id="problem" style={{ paddingTop:80, paddingBottom:80 }}>
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow">The real problem</span>
            <h2>Most businesses<br />don't fail. They <span className="gold-text serif">drift.</span></h2>
          </div>
          <p className="sub reveal" style={{ marginTop:24 }}>
            South African SMEs operate with accountants they see once a quarter, software that reports the past, and no model for what comes next. The result: smart owners, flying blind. MILŌN is the instrument panel that was missing.
          </p>
          <div className="steps stagger" style={{ marginTop:56 }}>
            <div className="step-card">
              <span className="n">01</span>
              <h3>You upload your financials</h3>
              <p>Your accountant uploads your income statement, balance sheet, and cash flow — or you do. One PDF, extracted by AI in seconds.</p>
              <span className="time">Under 60 seconds</span>
            </div>
            <div className="step-card">
              <span className="n">02</span>
              <h3>MILŌN scores your business</h3>
              <p>31 ratios, 4 pillar scores, one overall health score — mapped against 120 SA industry benchmarks.</p>
              <span className="time">Instantly</span>
            </div>
            <div className="step-card">
              <span className="n">03</span>
              <h3>You get your next move</h3>
              <p>930+ ranked fixes, an AI-drafted advisory report, and a 13-week cashflow — all in plain language.</p>
              <span className="time">Every month</span>
            </div>
          </div>
        </div>
      </section>

      <div className="divider"><div className="wrap"><i /></div></div>

      {/* ══════════════════════════ FEATURES ══════════════════════════ */}
      <section id="features">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">The Platform</span>
            <h2>Two portals. One constellation.</h2>
            <p className="sub">Business owners get clarity. Accountants get leverage. Together, the relationship becomes a recurring-revenue advisory practice.</p>
          </div>
          <div className="feat-cols stagger">
            <div className="feat-card">
              <div className="who">For Business Owners</div>
              <h3>Your financial cockpit</h3>
              <ul>
                <li><b>Live health score</b> — one number, updated every time your data changes</li>
                <li><b>13-week cashflow forecast</b> — see shortfalls weeks before they hit</li>
                <li><b>Playbook of 930+ fixes</b> — ranked by impact, filtered to your situation</li>
                <li><b>Four pillar breakdown</b> — profitability, cash, assets, solvency</li>
                <li><b>Accountant notes in-context</b> — advice lands on the exact number it refers to</li>
                <li><b>PDF financial extraction</b> — upload a statement, AI does the rest</li>
              </ul>
            </div>
            <div className="feat-card">
              <div className="who" style={{ color:"var(--gold-bright)" }}>For Accountants</div>
              <h3>Your advisory engine</h3>
              <ul>
                <li><b>Multi-client dashboard</b> — live health across your entire portfolio</li>
                <li><b>AI advisory drafter</b> — Gemini writes the report; you refine and send</li>
                <li><b>10 white-label report formats</b> — your brand, your margin</li>
                <li><b>Risk radar</b> — flag deteriorating clients before the crisis call</li>
                <li><b>Industry news digest</b> — always have sector context ready</li>
                <li><b>Recurring retainer model</b> — R1 200+ uplift per client per month</li>
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
            <h2>Start free. <span className="gold-text">Scale when it pays for itself.</span></h2>
            <p className="sub">Every plan includes the core health score and cashflow forecast. Upgrade when you're ready for the full constellation.</p>
          </div>

          {/* accountant pricing — shown via body class set by quiz */}
          <div className="acc-pricing" id="accPricing">
            <div style={{ fontWeight:700, fontSize:12, letterSpacing:".3em", textTransform:"uppercase", color:"var(--gold)", marginBottom:10 }}>Accountant / Advisory Firm Pricing</div>
            <p style={{ color:"var(--ink-dim)", fontSize:14, marginBottom:18 }}>
              White-label the whole platform. Charge your clients a monthly advisory retainer. MILŌN is your engine.
            </p>
            <ul style={{ listStyle:"none", display:"flex", flexDirection:"column", gap:10 }}>
              <li style={{ display:"flex", gap:10, fontSize:14, color:"var(--ink-dim)" }}><span style={{ color:"var(--gold)" }}>✦</span>Up to 150 clients — R4 500/mo flat</li>
              <li style={{ display:"flex", gap:10, fontSize:14, color:"var(--ink-dim)" }}><span style={{ color:"var(--gold)" }}>✦</span>Unlimited clients — R7 200/mo</li>
              <li style={{ display:"flex", gap:10, fontSize:14, color:"var(--ink-dim)" }}><span style={{ color:"var(--gold)" }}>✦</span>White-label onboarding support included</li>
              <li style={{ display:"flex", gap:10, fontSize:14, color:"var(--ink-dim)" }}><span style={{ color:"var(--gold)" }}>✦</span>Your branding on every report and portal</li>
            </ul>
            <div style={{ marginTop:22 }}>
              <a className="btn btn-gold" href="/auth">Set up your firm account →</a>
            </div>
          </div>

          <div className="price-grid stagger">
            <div className="price-card">
              <h3>Spark</h3>
              <div className="amount">Free<small></small></div>
              <div className="per">Forever · no credit card</div>
              <ul>
                <li>Full health score on first upload</li>
                <li>4 pillar scores</li>
                <li>Top 5 fixes from the playbook</li>
                <li>One-time cashflow snapshot</li>
                <li>Accountant can invite you</li>
              </ul>
              <button className="btn btn-ghost" onClick={() => { setRegPlan("Spark — Free"); document.getElementById("register")?.scrollIntoView({ behavior:"smooth" }); }}>
                Start free ✦
              </button>
            </div>

            <div className="price-card hot">
              <span className="tag">Most popular</span>
              <h3>Orbit</h3>
              <div className="amount">R699<small>/mo</small></div>
              <div className="per">Billed monthly · cancel anytime</div>
              <ul>
                <li>Everything in Spark, plus:</li>
                <li>Live 13-week cashflow forecast</li>
                <li>All 31 ratios, ranked and explained</li>
                <li>Full playbook (930+ fixes)</li>
                <li>Accountant advisory notes in-context</li>
                <li>Monthly comparison report</li>
              </ul>
              <button className="btn btn-gold" onClick={() => { setRegPlan("Orbit — R699/mo"); document.getElementById("register")?.scrollIntoView({ behavior:"smooth" }); }}>
                Get Orbit ✦
              </button>
            </div>

            <div className="price-card">
              <h3>Constellation</h3>
              <div className="amount">R1 299<small>/mo</small></div>
              <div className="per">Billed monthly · cancel anytime</div>
              <ul>
                <li>Everything in Orbit, plus:</li>
                <li>AI advisory report draft (monthly)</li>
                <li>Industry news digest</li>
                <li>Priority support</li>
                <li>Custom benchmark group</li>
                <li>Early access to new features</li>
              </ul>
              <button className="btn btn-ghost" onClick={() => { setRegPlan("Constellation — R1 299/mo"); document.getElementById("register")?.scrollIntoView({ behavior:"smooth" }); }}>
                Get Constellation
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ REGISTER ══════════════════════════ */}
      <section id="register" style={{ paddingBottom:80 }}>
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Get started</span>
            <h2>Your first health score<br />is <span className="gold-text">free and instant.</span></h2>
            <p className="sub">Upload your financials and MILŌN scores your business in under 60 seconds.</p>
          </div>

          {/* Client-only: prevents browser password-manager extensions (LastPass etc.)
              from injecting DOM nodes during SSR hydration and crashing React */}
          {mounted && <div className="reg-shell">
            <form onSubmit={handleRegister}>
              <label htmlFor="regRoleField">I am a</label>
              <select id="regRoleField" value={regRole} onChange={e => setRegRole(e.target.value)}>
                <option>Business owner</option>
                <option>Accountant / Advisory firm</option>
              </select>

              {regRole === "Accountant / Advisory firm" ? (
                <p style={{ marginTop:18, color:"var(--ink-dim)", fontSize:14, lineHeight:1.6 }}>
                  Accountant accounts are set up through our dedicated firm portal.{" "}
                  <a href="/auth" style={{ color:"var(--gold)" }}>Click here to register your firm →</a>
                </p>
              ) : (
                <>
                  <label htmlFor="regNameField">Full name</label>
                  <input id="regNameField" type="text" required placeholder="Thabo Nkosi" value={regName} onChange={e => setRegName(e.target.value)} />

                  <label htmlFor="regEmailField">Work email</label>
                  <input id="regEmailField" type="email" required placeholder="thabo@mybusiness.co.za" value={regEmail} onChange={e => setRegEmail(e.target.value)} />

                  <label htmlFor="regPasswordField">Password</label>
                  <input id="regPasswordField" type="password" required placeholder="At least 6 characters" minLength={6} value={regPassword} onChange={e => setRegPassword(e.target.value)} />

                  <label htmlFor="regCodeField">Access code</label>
                  <input id="regCodeField" type="text" required placeholder="Provided by your MILŌN contact" value={regCode} onChange={e => setRegCode(e.target.value)} />

                  <label htmlFor="regBusinessField">Business name</label>
                  <input id="regBusinessField" type="text" placeholder="Nkosi Engineering (Pty) Ltd" value={regBusiness} onChange={e => setRegBusiness(e.target.value)} />

                  <label htmlFor="regPlan">Plan</label>
                  <select id="regPlan" value={regPlan} onChange={e => setRegPlan(e.target.value)}>
                    <option value="Spark — Free">Spark — Free forever</option>
                    <option value="Orbit — R699/mo">Orbit — R699/mo</option>
                    <option value="Constellation — R1 299/mo">Constellation — R1 299/mo</option>
                  </select>

                  <button type="submit" className="btn btn-gold" disabled={regBusy} style={{ width:"100%", justifyContent:"center", marginTop:28 }}>
                    {regBusy ? "Creating your account…" : "Get my free health score ✦"}
                  </button>
                  <p style={{ textAlign:"center", fontSize:11, color:"var(--ink-dim)", marginTop:14, lineHeight:1.5 }}>
                    No credit card for Spark. Upgrade anytime. Cancel anytime.
                  </p>
                </>
              )}
            </form>
          </div>}
        </div>
      </section>

      {/* ══════════════════════════ FOOTER ══════════════════════════ */}
      <footer>
        <div className="wrap">
          <div>
            <span className="logo-word gold-text">MILŌN</span>
            <span style={{ fontSize:12, color:"var(--ink-dim)" }}>The financial health platform<br />for South African SMEs</span>
          </div>
          <nav className="fnav" aria-label="Footer navigation">
            <a href="#persona">Start</a>
            <a href="#method">The Method</a>
            <a href="#features">Platform</a>
            <a href="#pricing">Pricing</a>
            <a href="/auth">Accountant portal</a>
            <button onClick={() => setSigninOpen(true)} style={{ background:"none", border:"none", color:"var(--ink-dim)", cursor:"pointer", fontSize:13, padding:0, fontFamily:"inherit" }}>Sign in</button>
          </nav>
          <div className="copy">
            <span>© {new Date().getFullYear()} MILŌN Financial Technologies (Pty) Ltd. All rights reserved.</span>
            <span>Built for South Africa · Powered by Gemini AI</span>
          </div>
        </div>
      </footer>
    </>
  );
}
