import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { AccountantRatiosPanel } from "@/components/accountant-ratios";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { CashForecastPanel } from "@/components/cash-forecast";
import { TasksPanel } from "@/components/tasks-panel";
import { SplashScreen } from "@/components/splash-screen";
import { UploadFinancials } from "@/components/upload-financials";
import type { ExtractionResult } from "@/lib/financialSchema";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  component: ClientView,
});

type Client = {
  id: string;
  name: string;
  business_type: string | null;
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  open_queries_count: number;
};

function ClientView() {
  const { clientId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setClient(data as Client | null);
        setLoading(false);
      });
  }, [clientId]);

  const exitImpersonation = async () => {
    if (!user) return;
    // close most recent open audit row for this client
    const { data: rows } = await supabase
      .from("impersonation_audit")
      .select("id")
      .eq("firm_user_id", user.id)
      .eq("client_id", clientId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (rows?.[0]) {
      await supabase
        .from("impersonation_audit")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", rows[0].id);
    }
    sessionStorage.removeItem("acting_as_client_id");
    sessionStorage.removeItem("acting_as_client_name");
    navigate({ to: "/dashboard" });
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  if (!client) {
    return (
      <div className="min-h-screen grid place-items-center p-4">
        <div className="text-center space-y-3">
          <p>Client not found or you don't have access.</p>
          <Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SplashScreen />
      <header className="border-b bg-amber-50 dark:bg-amber-950/30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm">
            <span className="font-semibold">Acting as client:</span>{" "}
            <span className="text-primary">{client.name}</span>
            <span className="text-xs text-muted-foreground ml-2">(audited)</span>
          </div>
          <Button size="sm" variant="outline" onClick={exitImpersonation}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Exit to firm dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{client.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Business type</div>
              <div className="font-semibold">{client.business_type ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Cash runway</div>
              <div className="font-semibold">{client.cash_runway_weeks ?? "—"} wk</div>
            </div>
            <div>
              <div className="text-muted-foreground">Last forecast</div>
              <div className="font-semibold">
                {client.last_forecast_at ? new Date(client.last_forecast_at).toLocaleDateString() : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Open queries</div>
              <div className="font-semibold">{client.open_queries_count}</div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="ratios" className="w-full">
          <TabsList>
            <TabsTrigger value="ratios">Ratios</TabsTrigger>
            <TabsTrigger value="cashflow">13-Week Cash Forecast</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="upload">Upload Financials</TabsTrigger>
            <TabsTrigger value="advisory">Advisory Drafter</TabsTrigger>
          </TabsList>
          <TabsContent value="ratios" className="mt-4">
            <AccountantRatiosPanel clientId={client.id} clientName={client.name} />
          </TabsContent>
          <TabsContent value="cashflow" className="mt-4">
            <CashForecastPanel clientId={client.id} />
          </TabsContent>
          <TabsContent value="tasks" className="mt-4">
            <TasksPanel clientId={client.id} clientName={client.name} />
          </TabsContent>
          <TabsContent value="upload" className="mt-4">
            <div className="rounded-xl border border-white/10 bg-card p-6 space-y-3">
              <div>
                <h3 className="font-semibold">Upload financial statement PDF</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Gemini reads the PDF and extracts the income statement and balance sheet.
                  Review every figure before confirming — numbers are never saved automatically.
                </p>
              </div>
              <UploadFinancials
                onConfirm={(result: ExtractionResult) => {
                  // TODO: wire result into Supabase snapshot save
                  console.log("Financials confirmed for", client.name, result);
                }}
              />
            </div>
          </TabsContent>
          <TabsContent value="advisory" className="mt-4">
            <AdvisoryDrafter clientId={client.id} clientName={client.name} />
          </TabsContent>
        </Tabs>

        <div className="text-xs text-muted-foreground">
          <Link to="/app" className="underline">Open the full client-facing dashboard →</Link>
        </div>
      </main>
    </div>
  );
}
