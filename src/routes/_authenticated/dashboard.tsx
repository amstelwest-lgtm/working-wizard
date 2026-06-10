import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, LogOut, ExternalLink, Copy, Mail, Link2, FileText } from "lucide-react";
import { SplashScreen } from "@/components/splash-screen";
import { useServerFn } from "@tanstack/react-start";
import { getQboStatuses } from "@/lib/qbo.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Firm Dashboard — Milōn" }] }),
});

type Firm = { id: string; name: string; referral_code: string | null; owner_user_id: string };
type Client = {
  id: string;
  name: string;
  business_type: string | null;
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  open_queries_count: number;
  last_login_at: string | null;
  firm_id: string | null;
  financials: Record<string, string> | null;
};

function rag(client: Client): { label: string; cls: string } {
  const weeks = client.cash_runway_weeks;

  let ratioScore = 50;
  const f = client.financials;
  if (f) {
    const num = (s: string | undefined) => (s ? parseFloat(s) || 0 : 0);
    const safe = (a: number, b: number) => (b === 0 ? 0 : a / b);
    const revenue = num(f.revenue);
    const ebit = num(f.ebit);
    const receivables = num(f.receivables);
    const netIncome = num(f.netIncome);

    const operatingMargin = safe(ebit, revenue);
    const netMargin = safe(netIncome, revenue);
    const debtorDays = safe(receivables, revenue) * 365;

    const omHealth = Math.min(100, Math.max(0, (operatingMargin / 0.2) * 100));
    const nmHealth = Math.min(100, Math.max(0, (netMargin / 0.15) * 100));
    const ddHealth = Math.min(100, Math.max(0, ((90 - debtorDays) / 90) * 100));
    ratioScore = (omHealth + nmHealth + ddHealth) / 3;
  }

  let cashScore = 50;
  if (weeks != null) {
    if (weeks < 8) cashScore = 0;
    else if (weeks < 16) cashScore = 40;
    else cashScore = 100;
  }

  const combined = weeks != null ? cashScore * 0.55 + ratioScore * 0.45 : ratioScore;

  if (combined < 33) return { label: "Red", cls: "bg-destructive text-destructive-foreground" };
  if (combined < 60) return { label: "Amber", cls: "bg-amber-500 text-white" };
  return { label: "Green", cls: "bg-emerald-500 text-white" };
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString();
}

function InviteDialog({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [link, setLink] = useState("");

  const generateLink = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://milon.co.za";
    const params = new URLSearchParams({ invite: client.id, mode: "signup" });
    if (inviteEmail.trim()) params.set("email", inviteEmail.trim());
    const url = `${origin}/?${params.toString()}`;
    setLink(url);
    navigator.clipboard.writeText(url).then(() => toast.success("Invite link copied to clipboard"));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => e.stopPropagation()}
          className="gap-1"
        >
          <Mail className="h-3.5 w-3.5" /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Invite client — {client.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Client email (optional)</Label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="client@company.co.za"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Pre-fills the signup form for the client.
            </p>
          </div>
          {link && (
            <div>
              <Label>Invite link</Label>
              <div className="flex gap-2 mt-1">
                <Input readOnly value={link} className="text-xs font-mono" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => { navigator.clipboard.writeText(link); toast.success("Copied"); }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Send this link to your client. When they sign up, they'll be linked to the{" "}
                <strong>{client.name}</strong> workspace automatically.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={generateLink} className="gap-1.5">
            <Link2 className="h-4 w-4" />
            {link ? "Regenerate & copy" : "Generate invite link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [firm, setFirm] = useState<Firm | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [qboStatuses, setQboStatuses] = useState<
    Record<string, { companyName: string | null; lastSyncedAt: string | null; syncStatus: string }>
  >({});
  const getStatuses = useServerFn(getQboStatuses);

  const load = async () => {
    setLoading(true);
    const { data: firms } = await supabase
      .from("firms")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1);
    const f = firms?.[0] ?? null;
    setFirm(f as Firm | null);

    const { data: cs, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    const clientList = (cs ?? []) as Client[];
    setClients(clientList);
    setLoading(false);

    // Load QBO connection statuses for all clients (non-fatal)
    if (clientList.length > 0) {
      try {
        const statuses = await getStatuses({
          data: { clientIds: clientList.map((c) => c.id) },
        });
        setQboStatuses(statuses);
      } catch {
        // non-fatal — QBO tables may not be migrated yet
      }
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addClient = async () => {
    if (!user || !newName.trim()) return;
    const { error } = await supabase.from("clients").insert({
      name: newName.trim(),
      owner_user_id: user.id,
      firm_id: firm?.id ?? null,
      business_type: newType || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewName("");
    setNewType("");
    setOpen(false);
    toast.success("Client added");
    load();
  };

  const enterAsClient = async (c: Client) => {
    if (!user) return;
    const { error } = await supabase.from("impersonation_audit").insert({
      firm_user_id: user.id,
      client_id: c.id,
      firm_id: firm?.id ?? null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    sessionStorage.setItem("acting_as_client_id", c.id);
    sessionStorage.setItem("acting_as_client_name", c.name);
    navigate({ to: "/app" });
  };

  const referralUrl = firm?.referral_code
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/auth?ref=${firm.referral_code}`
    : "";

  return (
    <div className="min-h-screen bg-background">
      <SplashScreen />
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/milon-wordmark.png" alt="Milōn" className="h-7 w-auto" />
            <p className="text-xs text-muted-foreground">{firm?.name ?? "No firm yet"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/reports" search={{ client: undefined }}><FileText className="h-4 w-4 mr-1.5" />Reports</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate({ to: "/auth" }))}>
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Firm summary */}
        {firm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your firm</CardTitle>
              <CardDescription>
                Earn 25% recurring revenue share for every client you onboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Clients</div>
                <div className="text-2xl font-bold">{clients.length}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Partner tier</div>
                <div className="text-2xl font-bold">
                  {clients.length >= 40 ? "Platinum" : clients.length >= 15 ? "Gold" : clients.length >= 5 ? "Silver" : "Starter"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Referral link</div>
                <div className="flex gap-2">
                  <Input readOnly value={referralUrl} className="text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(referralUrl);
                      toast.success("Copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Clients */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Clients</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add client</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a new client</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Business name</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div>
                  <Label>Business type (optional)</Label>
                  <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Services / Retail / SaaS…" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={addClient}>Add client</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : clients.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No clients yet. Add your first client to start tracking cash runway, forecast freshness and open queries.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Client</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Type</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Health</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden sm:table-cell">Runway</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Op. Profit</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden xl:table-cell">Last Forecast</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground hidden lg:table-cell">QB</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => {
                  const r = rag(c);
                  const f = c.financials;
                  const ebit = f ? parseFloat(f.ebit ?? "") : NaN;
                  const revenue = f ? parseFloat(f.revenue ?? "") : NaN;
                  const opMargin = isFinite(ebit) && isFinite(revenue) && revenue > 0
                    ? `${((ebit / revenue) * 100).toFixed(1)}%`
                    : isFinite(ebit)
                    ? ebit.toLocaleString("en-ZA", { maximumFractionDigits: 0 })
                    : "—";
                  const qbo = qboStatuses[c.id];
                  return (
                    <tr
                      key={c.id}
                      className={`border-b last:border-0 cursor-pointer transition-colors hover:bg-accent/40 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      onClick={() => navigate({ to: "/clients/$clientId", params: { clientId: c.id } })}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold truncate max-w-[160px]">{c.name}</div>
                        <div className="text-xs text-muted-foreground md:hidden">{c.business_type ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{c.business_type ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`${r.cls} text-xs px-2`}>{r.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                        {c.cash_runway_weeks != null
                          ? <span className={c.cash_runway_weeks < 8 ? "text-destructive font-semibold" : c.cash_runway_weeks < 16 ? "text-amber-500 font-semibold" : "text-emerald-600 font-semibold"}>{c.cash_runway_weeks} wk</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden lg:table-cell font-medium">
                        {opMargin}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden xl:table-cell text-xs">
                        {fmtDate(c.last_forecast_at)}
                      </td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        {qbo ? (
                          <span
                            title={`QuickBooks${qbo.companyName ? ` — ${qbo.companyName}` : ""}`}
                            style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#fff", background: "#2CA01C", padding: "2px 6px", borderRadius: 4 }}
                          >
                            QB
                          </span>
                        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <InviteDialog client={c} />
                          <Button asChild size="sm" variant="outline">
                            <Link to="/reports" search={{ client: c.name }}>
                              <FileText className="h-3.5 w-3.5 mr-1" />Reports
                            </Link>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => enterAsClient(c)}>
                            <ExternalLink className="h-3.5 w-3.5 mr-1" /> View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
