import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { PreLoginShareButton } from "@/components/share";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [{ title: "Sign in — Milōn" }],
  }),
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [user, loading, navigate]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
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
        toast.success("Account created");
        navigate({ to: "/dashboard" });
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
        toast.success("Welcome back");
        navigate({ to: "/dashboard" });
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
            Sign in or create your firm account.{" "}
            <Link to="/" className="underline text-primary">Back home</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create firm</TabsTrigger>
            </TabsList>
            <form onSubmit={handle} className="space-y-3 mt-4">
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
            </form>
            <TabsContent value="signin" />
            <TabsContent value="signup" />
          </Tabs>
        </CardContent>
      </Card>
      <PreLoginShareButton />
    </div>
  );
}
