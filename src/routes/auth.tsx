import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { PreLoginShareButton } from "@/components/share";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { SIGNUP_ACCESS_CODE, notifySignup } from "@/lib/signup-notify";
import { ensurePracticePortalAccess } from "@/lib/auth.functions";
import { setPortalIntent } from "@/lib/user-roles";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === "string" && search.next.startsWith("/") ? search.next : undefined,
  }),
  head: () => ({
    meta: [{ title: "Sign in — Milōn" }],
  }),
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const ensurePractice = useServerFn(ensurePracticePortalAccess);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);

  /* Client-only form gate — browser password managers (LastPass etc.) inject
     DOM nodes into password forms, causing fatal SSR hydration mismatches. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const afterAuthPath = next === "/ops" ? "/ops" : "/dashboard";

  useEffect(() => {
    if (loading || !user) return;
    setPortalIntent("accountant");
    void ensurePractice().catch(() => {
      /* non-fatal — role guard still uses firm ownership */
    });
    navigate({ to: afterAuthPath as "/dashboard" });
  }, [user, loading, navigate, afterAuthPath, ensurePractice]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup" && accessCode.trim() !== SIGNUP_ACCESS_CODE) {
      toast.error("Invalid access code. Contact us to get access.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName, firm_name: firmName.trim() },
          },
        });
        if (error) throw error;
        notifySignup("Accountant firm", email, fullName);
        if (!data.session) {
          toast.success("Account created — check your email to confirm before signing in.");
          return;
        }
        if (data.user && firmName.trim()) {
          const { data: firm } = await supabase
            .from("firms")
            .insert({ name: firmName.trim(), owner_user_id: data.user.id })
            .select("id")
            .single();
          if (firm) {
            await supabase
              .from("firm_memberships")
              .insert({ firm_id: firm.id, user_id: data.user.id, role: "owner" });
          }
          await supabase
            .from("user_roles")
            .insert({ user_id: data.user.id, role: "firm_admin" });
        }
        setPortalIntent("accountant");
        await ensurePractice().catch(() => undefined);
        toast.success("Account created");
        navigate({ to: afterAuthPath as "/dashboard" });
      } else {
        const { error, data: signInData } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Lazy firm provisioning — runs in a separate try/catch so any failure
        // here never blocks the user from signing in.
        try {
          if (signInData.user) {
            const meta = signInData.user.user_metadata as { firm_name?: string; full_name?: string } | null;
            if (meta?.firm_name) {
              const { data: existing } = await supabase
                .from("firms")
                .select("id")
                .eq("owner_user_id", signInData.user.id)
                .maybeSingle();
              if (!existing) {
                const { data: firm } = await supabase
                  .from("firms")
                  .insert({ name: meta.firm_name, owner_user_id: signInData.user.id })
                  .select("id")
                  .single();
                if (firm) {
                  await supabase
                    .from("firm_memberships")
                    .insert({ firm_id: firm.id, user_id: signInData.user.id, role: "owner" });
                  await supabase
                    .from("user_roles")
                    .insert({ user_id: signInData.user.id, role: "firm_admin" });
                }
              }
            }
          }
        } catch {
          // provisioning failure is non-fatal — user proceeds to dashboard regardless
        }
        setPortalIntent("accountant");
        await ensurePractice().catch(() => undefined);
        toast.success("Welcome back");
        navigate({ to: afterAuthPath as "/dashboard" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img src="/milon-wordmark.png" alt="Milōn" className="mb-2 h-8 w-auto" />
          <CardTitle className="text-lg">Accountant Portal</CardTitle>
          <CardDescription>
            For accounting firms and advisory practices only.{" "}
            <Link to="/" className="underline text-primary">Back home</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create firm</TabsTrigger>
            </TabsList>
            {mounted && <form onSubmit={handle} className="space-y-3 mt-4">
              {mode === "signup" && (
                <>
                  <div>
                    <Label>Your name</Label>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                  </div>
                  <div>
                    <Label>Firm name</Label>
                    <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="Acme & Partners" required />
                  </div>
                  <div>
                    <Label>Access code</Label>
                    <Input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Provided by your MILŌN contact" required />
                  </div>
                </>
              )}
              <div>
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create firm account"}
              </Button>
            </form>}
            <TabsContent value="signin" />
            <TabsContent value="signup" />
          </Tabs>
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        Business owner?{" "}
        <Link to="/" className="font-medium text-primary underline">
          Sign in at milon.co.za →
        </Link>
      </p>
      <PreLoginShareButton />
    </div>
  );
}
