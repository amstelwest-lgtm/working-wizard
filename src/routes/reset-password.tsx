import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [{ title: "Reset password — MILŌN" }],
  }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [done, setDone]               = useState(false);
  const [ready, setReady]             = useState(false);

  /* Supabase sends the recovery token in the URL hash.
     The client picks it up via onAuthStateChange with event = PASSWORD_RECOVERY. */
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      setTimeout(() => navigate({ to: "/" }), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:"#050507", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 16px" }}>
      <div style={{ width:"100%", maxWidth:420, borderRadius:28, padding:"44px 36px", background:"rgba(13,13,20,.96)", border:"1px solid rgba(212,175,55,.2)", boxShadow:"0 30px 80px rgba(0,0,0,.6)" }}>

        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <img src="/milon-centaur.svg" alt="" width={21} height={30}/>
          <span style={{ fontSize:18, fontWeight:700, letterSpacing:"0.04em", color:"#d4af37" }}>MILŌN</span>
        </div>

        {done ? (
          /* ── success state ── */
          <div style={{ textAlign:"center" }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:"rgba(212,175,55,.1)", display:"grid", placeItems:"center", margin:"0 auto 22px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 style={{ fontSize:20, fontWeight:700, color:"#f2ecdc", margin:"0 0 10px" }}>Password updated</h2>
            <p style={{ fontSize:14, color:"#9b958a", lineHeight:1.6 }}>
              Your password has been changed. Redirecting you to the home page…
            </p>
          </div>

        ) : !ready ? (
          /* ── waiting for Supabase to parse the recovery token ── */
          <div style={{ textAlign:"center" }}>
            <h2 style={{ fontSize:20, fontWeight:700, color:"#f2ecdc", margin:"0 0 12px" }}>Set a new password</h2>
            <p style={{ fontSize:14, color:"#9b958a", lineHeight:1.6 }}>
              Verifying your reset link… If nothing happens, the link may have expired.{" "}
              <a href="/" style={{ color:"#d4af37", textDecoration:"none" }}>Go home</a>
            </p>
          </div>

        ) : (
          /* ── password form ── */
          <>
            <h2 style={{ fontSize:20, fontWeight:700, color:"#f2ecdc", margin:"0 0 8px" }}>Set a new password</h2>
            <p style={{ fontSize:14, color:"#9b958a", marginBottom:28, lineHeight:1.6 }}>
              Choose a strong password of at least 8 characters.
            </p>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom:16 }}>
                <label style={{ display:"block", fontSize:12, color:"#9b958a", marginBottom:6, letterSpacing:"0.06em", textTransform:"uppercase" }}>New password</label>
                <input
                  type="password"
                  required
                  autoFocus
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(212,175,55,.18)", borderRadius:10, padding:"12px 14px", color:"#f2ecdc", fontSize:14, outline:"none", boxSizing:"border-box" }}
                />
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={{ display:"block", fontSize:12, color:"#9b958a", marginBottom:6, letterSpacing:"0.06em", textTransform:"uppercase" }}>Confirm password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(212,175,55,.18)", borderRadius:10, padding:"12px 14px", color:"#f2ecdc", fontSize:14, outline:"none", boxSizing:"border-box" }}
                />
              </div>
              {error && <p style={{ fontSize:13, color:"#f87171", margin:"4px 0 12px" }}>{error}</p>}
              <button
                type="submit"
                disabled={busy}
                style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:"linear-gradient(135deg,#fdee79,#d4af37)", color:"#0a0a0a", fontWeight:700, fontSize:14, cursor:busy ? "not-allowed" : "pointer", opacity:busy ? 0.7 : 1, marginTop:4 }}
              >
                {busy ? "Updating…" : "Update password ✦"}
              </button>
            </form>
          </>
        )}

        <p style={{ marginTop:24, fontSize:12, color:"#9b958a", textAlign:"center" }}>
          <a href="/" style={{ color:"#d4af37", textDecoration:"none" }}>← Back to MILŌN</a>
        </p>
      </div>
    </div>
  );
}
