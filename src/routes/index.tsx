import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Mail, User, UserPlus } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [{ title: "Milōn · Operating Finance" }],
  }),
});

const PARTICLES = [
  { top: "9%",  left: "7%",  s: 2,   d: 0,   dur: 9  },
  { top: "21%", left: "17%", s: 1.4, d: 1.6, dur: 11 },
  { top: "6%",  left: "54%", s: 1,   d: 3.1, dur: 13 },
  { top: "16%", left: "73%", s: 1.8, d: 0.4, dur: 8  },
  { top: "4%",  left: "86%", s: 1.3, d: 2.2, dur: 10 },
  { top: "33%", left: "3%",  s: 1,   d: 4.1, dur: 7  },
  { top: "44%", left: "93%", s: 1.8, d: 1.1, dur: 14 },
  { top: "56%", left: "11%", s: 1.4, d: 2.7, dur: 9  },
  { top: "61%", left: "89%", s: 1,   d: 3.6, dur: 8  },
  { top: "73%", left: "4%",  s: 1.8, d: 0.9, dur: 12 },
  { top: "79%", left: "79%", s: 1.4, d: 1.9, dur: 10 },
  { top: "87%", left: "24%", s: 1,   d: 4.6, dur: 11 },
  { top: "91%", left: "61%", s: 1.8, d: 2.9, dur: 7  },
  { top: "14%", left: "39%", s: 1.2, d: 3.3, dur: 15 },
  { top: "66%", left: "36%", s: 1.6, d: 0.2, dur: 12 },
  { top: "27%", left: "63%", s: 1.1, d: 4.3, dur: 9  },
  { top: "83%", left: "49%", s: 1.4, d: 1.3, dur: 11 },
  { top: "50%", left: "51%", s: 0.9, d: 5.1, dur: 8  },
];

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const inviteClientId = params.get("invite") ?? "";
  const inviteEmail    = params.get("email")  ?? "";
  const forceMode      = params.get("mode");

  const [tab, setTab]                   = useState<"signin" | "signup">(
    forceMode === "signup" || inviteClientId ? "signup" : "signin",
  );
  const [email, setEmail]               = useState(inviteEmail);
  const [password, setPassword]         = useState("");
  const [fullName, setFullName]         = useState("");
  const [businessName, setBusinessName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe]     = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [signupDone, setSignupDone]     = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");
    html.classList.add("dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute("content") ?? "#ffffff";
    meta?.setAttribute("content", "#05070B");
    return () => {
      if (!hadDark) html.classList.remove("dark");
      meta?.setAttribute("content", prev);
    };
  }, []);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/app" });
  }, [user, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/app" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally { setBusy(false); }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: `${window.location.origin}/app`,
          data: {
            full_name: fullName.trim(),
            business_name: businessName.trim() || fullName.trim(),
            signup_type: "customer",
            invite_client_id: inviteClientId || null,
          },
        },
      });
      if (error) throw error;
      if (data.session && data.user) {
        if (inviteClientId) {
          await supabase.from("client_memberships").upsert(
            { client_id: inviteClientId, user_id: data.user.id, role: "client" },
            { onConflict: "client_id,user_id" },
          );
        } else {
          const { data: existing } = await supabase
            .from("clients").select("id").eq("owner_user_id", data.user.id).limit(1).maybeSingle();
          if (!existing) {
            await supabase.from("clients").insert({
              name: businessName.trim() || fullName.trim() || email,
              owner_user_id: data.user.id,
            });
          }
        }
        navigate({ to: "/app" });
        return;
      }
      if (inviteClientId) localStorage.setItem("pending_invite_client_id", inviteClientId);
      setSignupDone(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally { setBusy(false); }
  };

  if (signupDone) {
    return (
      <div style={{ minHeight: "100vh", background: "#05070B", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}>
        <div style={{
          width: "100%", maxWidth: 400, borderRadius: 28, padding: "40px 32px",
          background: "rgba(17,20,29,.80)", backdropFilter: "blur(24px)",
          border: "1px solid rgba(201,169,106,.15)", boxShadow: "0 25px 80px rgba(0,0,0,.6)",
          textAlign: "center",
        }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(201,169,106,.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Mail size={22} style={{ color: "#C9A96A" }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#F5F4F1", margin: 0 }}>Check your email</h2>
          <p style={{ marginTop: 10, fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>
            We sent a confirmation link to{" "}
            <span style={{ color: "#C9A96A" }}>{email}</span>. Click it to activate your account.
          </p>
          <button onClick={() => setSignupDone(false)} style={{ marginTop: 24, fontSize: 12, color: "#6B7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#05070B", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes gp-float {
          0%   { transform: translateY(0px)   scale(1);   opacity: 0.35; }
          100% { transform: translateY(-16px) scale(1.25);opacity: 0.75; }
        }
        @keyframes milon-fadein {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes card-float {
          0%,100% { transform: translateY(0px);  }
          50%      { transform: translateY(-5px); }
        }
        .milon-fadein   { animation: milon-fadein 620ms cubic-bezier(.22,1,.36,1) both; }
        .milon-card     { animation: card-float 5s ease-in-out infinite, milon-fadein 620ms cubic-bezier(.22,1,.36,1) both; }
        .milon-input {
          display: block; width: 100%; height: 60px; border-radius: 18px;
          background: rgba(255,255,255,.03);
          border: 1px solid rgba(255,255,255,.08);
          padding: 0 20px; color: #F5F4F1; font-size: 14px;
          transition: border-color 250ms, box-shadow 250ms;
          outline: none; box-sizing: border-box;
        }
        .milon-input::placeholder { color: #6B7280; }
        .milon-input:focus {
          border-color: #C9A96A;
          box-shadow: 0 0 0 1px rgba(201,169,106,.15), 0 0 25px rgba(201,169,106,.18);
        }
        .milon-btn {
          display: block; width: 100%; height: 60px; border-radius: 18px; border: none;
          background: linear-gradient(135deg, #D8B46A 0%, #C9A96A 55%, #A56A00 100%);
          color: #05070B; font-weight: 700; font-size: 15px; letter-spacing: .04em;
          cursor: pointer; box-shadow: 0 10px 40px rgba(201,169,106,.28);
          transition: transform 200ms, filter 200ms; margin-top: 8px;
        }
        .milon-btn:hover:not(:disabled) { transform: scale(1.02); filter: brightness(1.07); }
        .milon-btn:disabled { opacity: .55; cursor: not-allowed; }
        .acct-pill {
          height: 48px; display: inline-flex; align-items: center; gap: 8px;
          padding: 0 22px; border-radius: 100px;
          background: rgba(20,20,20,.75); backdrop-filter: blur(12px);
          border: 1px solid rgba(201,169,106,.25);
          color: #C9A96A; font-size: 13px; font-weight: 500;
          text-decoration: none; transition: box-shadow 200ms, border-color 200ms;
        }
        .acct-pill:hover {
          box-shadow: 0 0 22px rgba(201,169,106,.20);
          border-color: rgba(201,169,106,.48);
        }
        .tab-btn {
          flex: 1; height: 44px; border-radius: 16px; border: none; cursor: pointer;
          font-size: 13px; font-weight: 600; letter-spacing: .02em;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 200ms;
        }
        .tab-btn-active {
          background: linear-gradient(90deg, #A56A00, #C9A96A);
          color: #05070B; box-shadow: 0 4px 18px rgba(201,169,106,.28);
        }
        .tab-btn-inactive { background: transparent; color: #6B7280; }
        .tab-btn-inactive:hover { color: #A0A7B5; }
      `}</style>

      {/* Gold particles */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {PARTICLES.map((p, i) => (
          <div key={i} style={{
            position: "absolute", top: p.top, left: p.left,
            width: p.s, height: p.s, borderRadius: "50%",
            background: "radial-gradient(circle, #D8B46A, rgba(201,169,106,.5))",
            animation: `gp-float ${p.dur}s ease-in-out ${p.d}s infinite alternate`,
          }} />
        ))}
      </div>

      {/* Ambient radial glow */}
      <div style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
        width: 720, height: 520, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 20%, rgba(201,169,106,.12) 0%, transparent 65%)",
        filter: "blur(32px)",
      }} />

      {/* Subtle starfield */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        backgroundImage: [
          "radial-gradient(circle at 14% 22%, rgba(255,255,255,.016) 1px, transparent 1px)",
          "radial-gradient(circle at 71% 17%, rgba(255,255,255,.012) 1px, transparent 1px)",
          "radial-gradient(circle at 39% 79%, rgba(255,255,255,.014) 1px, transparent 1px)",
          "radial-gradient(circle at 87% 68%, rgba(255,255,255,.010) 1px, transparent 1px)",
          "radial-gradient(circle at 4%  59%, rgba(255,255,255,.012) 1px, transparent 1px)",
          "radial-gradient(circle at 58% 44%, rgba(255,255,255,.008) 1px, transparent 1px)",
          "radial-gradient(circle at 29% 54%, rgba(255,255,255,.010) 1px, transparent 1px)",
          "radial-gradient(circle at 94% 39%, rgba(255,255,255,.014) 1px, transparent 1px)",
          "radial-gradient(circle at 52% 8%,  rgba(255,255,255,.010) 1px, transparent 1px)",
          "radial-gradient(circle at 76% 88%, rgba(255,255,255,.012) 1px, transparent 1px)",
        ].join(","),
      }} />

      {/* Top bar */}
      <header className="milon-fadein" style={{ position: "relative", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 40px", animationDelay: "0ms" }}>
        <img src="/milon-wordmark.png" alt="Milōn" style={{ height: 20, width: "auto", opacity: 0.55 }} />
        <Link to="/auth" className="acct-pill">
          Accountant Portal
          <ArrowRight size={13} />
        </Link>
      </header>

      {/* Main */}
      <main style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px 16px 64px", minHeight: "calc(100vh - 80px)" }}>

        {/* Hero */}
        <div className="milon-fadein" style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 36, animationDelay: "80ms" }}>
          {/* Orbit rings + centaur */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 220, height: 220 }}>
            <div style={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", border: "1px solid rgba(201,169,106,.06)" }} />
            <div style={{ position: "absolute", width: 170, height: 170, borderRadius: "50%", border: "1px solid rgba(201,169,106,.09)" }} />
            <div style={{ position: "absolute", width: 126, height: 126, borderRadius: "50%", border: "1px solid rgba(201,169,106,.13)" }} />
            {/* Gold node on outer ring */}
            <div style={{ position: "absolute", top: "6%", left: "50%", width: 5, height: 5, marginLeft: -2.5, borderRadius: "50%", background: "#C9A96A", boxShadow: "0 0 8px rgba(201,169,106,.7)", opacity: 0.8 }} />
            <div style={{ position: "absolute", bottom: "8%", left: "30%", width: 3.5, height: 3.5, borderRadius: "50%", background: "#C9A96A", opacity: 0.5 }} />
            <img
              src="/milon-logo.png"
              alt="Milōn centaur"
              style={{
                position: "relative", zIndex: 1,
                height: 96, width: "auto",
                filter: "drop-shadow(0 0 28px rgba(201,169,106,.40)) drop-shadow(0 0 64px rgba(201,169,106,.18))",
              }}
            />
          </div>

          {/* Tagline */}
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.35em", color: "#A0A7B5", fontWeight: 500, textTransform: "uppercase" }}>
              Operating Finance
            </p>
            {/* Gold divider */}
            <div style={{ width: 80, height: 1, background: "linear-gradient(90deg, transparent, rgba(201,169,106,.7), transparent)", margin: "12px auto 0" }} />
          </div>
        </div>

        {/* Invite banner */}
        {inviteClientId && (
          <div style={{ width: "100%", maxWidth: 420, borderRadius: 16, border: "1px solid rgba(201,169,106,.28)", background: "rgba(201,169,106,.05)", padding: "12px 20px", textAlign: "center", marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#C9A96A" }}>
              You've been invited to Milōn — create your account below.
            </p>
          </div>
        )}

        {/* Auth card */}
        <div
          className="milon-card"
          style={{
            width: "90%", maxWidth: 420,
            borderRadius: 32,
            background: "rgba(17,20,29,.72)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(201,169,106,.15)",
            boxShadow: "0 25px 80px rgba(0,0,0,.55), inset 0 0 0 1px rgba(201,169,106,.04)",
            padding: "32px 28px 28px",
            animationDelay: "160ms",
          }}
        >
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, padding: 4, background: "rgba(255,255,255,.04)", borderRadius: 20, marginBottom: 24 }}>
            <button
              type="button"
              onClick={() => setTab("signin")}
              className={`tab-btn ${tab === "signin" ? "tab-btn-active" : "tab-btn-inactive"}`}
            >
              <User size={13} />
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setTab("signup")}
              className={`tab-btn ${tab === "signup" ? "tab-btn-active" : "tab-btn-inactive"}`}
            >
              <UserPlus size={13} />
              Create account
            </button>
          </div>

          {tab === "signin" ? (
            <form onSubmit={handleSignIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <InputField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" icon={<Mail size={15} />} />
              <PasswordField value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword(v => !v)} />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <div
                    onClick={() => setRememberMe(v => !v)}
                    style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: `1px solid ${rememberMe ? "#C9A96A" : "rgba(255,255,255,.18)"}`,
                      background: rememberMe ? "rgba(201,169,106,.18)" : "transparent",
                      transition: "all 200ms", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {rememberMe && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3.5L3.5 6L8 1" stroke="#C9A96A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "#6B7280" }}>Remember me</span>
                </label>
                <button type="button" style={{ fontSize: 12, color: "#C9A96A", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Forgot password?
                </button>
              </div>

              <button type="submit" disabled={busy} className="milon-btn">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignUp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <InputField label="Your name" type="text" value={fullName} onChange={setFullName} placeholder="Jane Smith" required />
              {!inviteClientId && (
                <InputField label="Business name" type="text" value={businessName} onChange={setBusinessName} placeholder="Acme (Pty) Ltd" />
              )}
              <InputField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" required icon={<Mail size={15} />} />
              <PasswordField value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword(v => !v)} minLength={8} />
              <button type="submit" disabled={busy} className="milon-btn">
                {busy ? "Creating account…" : "Create account"}
              </button>
              <p style={{ textAlign: "center", fontSize: 11, color: "#6B7280", marginTop: -8 }}>
                By signing up you agree to our terms of service.
              </p>
            </form>
          )}
        </div>

        {/* Bottom accountant CTA */}
        <div className="milon-fadein" style={{ marginTop: 28, textAlign: "center", animationDelay: "280ms" }}>
          <p style={{ fontSize: 12, color: "#6B7280", margin: 0 }}>Are you an accountant?</p>
          <Link
            to="/auth"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 13, color: "#C9A96A", fontWeight: 500, textDecoration: "none", transition: "opacity 200ms" }}
          >
            Access Accountant Portal
            <ArrowRight size={12} />
          </Link>
        </div>
      </main>

      <footer style={{ position: "relative", zIndex: 10, textAlign: "center", paddingBottom: 20, fontSize: 11, color: "#1E2530" }}>
        © {new Date().getFullYear()} Milōn · Operating Finance
      </footer>
    </div>
  );
}

function InputField({
  label, type, value, onChange, placeholder, required, icon,
}: {
  label: string; type: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; icon?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", color: "#A0A7B5", textTransform: "uppercase" }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        {icon && (
          <div style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "#6B7280", pointerEvents: "none" }}>
            {icon}
          </div>
        )}
        <input
          type={type} value={value} onChange={e => onChange(e.target.value)}
          required={required} placeholder={placeholder}
          className="milon-input"
          style={{ paddingLeft: icon ? 44 : 20 }}
        />
      </div>
    </div>
  );
}

function PasswordField({
  value, onChange, show, onToggle, minLength,
}: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; minLength?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", color: "#A0A7B5", textTransform: "uppercase" }}>
        Password
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"} value={value}
          onChange={e => onChange(e.target.value)}
          required minLength={minLength ?? 6} placeholder="••••••••"
          className="milon-input"
          style={{ paddingRight: 52 }}
        />
        <button
          type="button" onClick={onToggle} tabIndex={-1}
          style={{ position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6B7280", padding: 0, display: "flex" }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
