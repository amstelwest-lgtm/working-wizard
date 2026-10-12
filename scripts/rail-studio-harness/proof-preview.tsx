/**
 * Local seeded preview for the marketing proof shots.
 * Figures come from the US sample client via ratioActualLine.
 * Sign-off and review buttons are the product components.
 * Not part of the production build.
 */
import { useMemo, useState } from "react";
import { MarketProvider } from "@/contexts/market";
import { ReviewSignoffBadge, ReviewSignoffButton } from "@/components/review-signoff";
import { ratioActualLine } from "@/lib/ratio-actuals";
import { sampleFinancialsFor } from "@/lib/sample-business";
import { formatMoneyCompact } from "@/lib/market";
import { resolveMarket } from "@/lib/market/resolve";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";

const US = resolveMarket({ country: "US", regionCode: "NY" });

const METRICS = [
  { name: "Debtor Days", label: "Days sales outstanding", featured: true },
  { name: "Gross Profit / Labor", label: "Gross profit to labour", featured: false },
  { name: "Sales-per-Employee Ratio", label: "Sales per employee", featured: false },
  { name: "Revenue Growth Rate", label: "Revenue growth", featured: false },
] as const;

const SIGNOFF: ClientReviewSignoff = {
  id: "proof-signoff",
  client_id: "harness-client",
  scope: "advisory",
  signed_off_by_id: "harness-local-user",
  signed_off_by_name: "Ada Mbeki",
  signed_off_by_initials: "AM",
  signed_off_by_title: null,
  firm_name: "Harbour & Co",
  note: "Ready for the client.",
  signature_data: null,
  signed_off_at: "2026-10-02T14:00:00.000Z",
};

function resultOf(calculation: string | null): string {
  if (!calculation) return "";
  const cut = calculation.split("=");
  return cut[cut.length - 1]?.trim() ?? "";
}

function RatioShot() {
  const rows = useMemo(() => {
    const inputs = sampleFinancialsFor("US");
    return METRICS.map((metric) => {
      const line = ratioActualLine(metric.name, inputs, (amount) => formatMoneyCompact(amount, US));
      return { ...metric, ...line, result: resultOf(line.calculation) };
    });
  }, []);
  const lead = rows.find((row) => row.featured);
  const rest = rows.filter((row) => !row.featured);

  return (
    <section id="shot-ratios" className="proof-frame">
      <header className="proof-head">
        <div>
          <p className="proof-kicker">Harbour Glass · Sample client</p>
          <h2>Ratios</h2>
        </div>
        <span className="proof-chip">QuickBooks</span>
      </header>
      <div className="ratio-layout">
        {lead ? (
          <article className="ratio-lead" data-calc={lead.calculation ?? ""}>
            <p className="ratio-label">{lead.label}</p>
            <p className="ratio-value">{lead.result}</p>
            <p className="ratio-formula">{lead.formula}</p>
            <p className="ratio-work-label">How the figure is built</p>
            <p className="ratio-work">{lead.calculation}</p>
          </article>
        ) : null}
        <div className="ratio-stack">
          {rest.map((row) => (
            <article key={row.name} className="ratio-card" data-calc={row.calculation ?? ""}>
              <div>
                <p className="ratio-label">{row.label}</p>
                <p className="ratio-formula">{row.formula}</p>
              </div>
              <p className="ratio-value ratio-value-sm">{row.result}</p>
              <p className="ratio-work">{row.calculation}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignoffShot() {
  return (
    <section id="shot-signoff" className="proof-frame">
      <header className="proof-head">
        <div>
          <p className="proof-kicker">Harbour Glass · Advisory pack</p>
          <h2>Approved by the firm</h2>
        </div>
        <span className="proof-chip">Harbour &amp; Co</span>
      </header>
      <ReviewSignoffBadge signoff={SIGNOFF} scope="advisory" isStale={false} />
    </section>
  );
}

function PlanShot() {
  const [signoff, setSignoff] = useState<ClientReviewSignoff | null>(null);
  return (
    <section id="shot-plan" className="proof-frame">
      <header className="proof-head">
        <div>
          <p className="proof-kicker">Harbour Glass · Oct 2026</p>
          <h2>Action plan</h2>
          <p className="proof-sub">Collect this month&apos;s cash before payroll.</p>
        </div>
        <div className="proof-actions">
          <ReviewSignoffButton
            clientId="11111111-1111-4111-8111-111111111111"
            clientName="Harbour Glass"
            scope="action_plan"
            signoff={signoff}
            isStale={false}
            onChange={setSignoff}
          />
        </div>
      </header>
      <article className="plan-row">
        <div>
          <p className="plan-title">Call the two largest overdue accounts</p>
          <p className="plan-why">Those two invoices are most of the gap.</p>
        </div>
        <div className="plan-meta">
          <span>Ada Mbeki</span>
          <span>Due 15 Oct 2026</span>
          <span className="plan-bar" aria-hidden>
            <i style={{ width: "20%" }} />
          </span>
          <span>20%</span>
        </div>
      </article>
    </section>
  );
}

export function ProofLandingPreview() {
  return (
    <MarketProvider selection={{ country: "US", regionCode: "NY" }}>
      <div className="accountant-portal proof-page">
        <style>{`
          .proof-page{background:#ffffff;color:#102A43;padding:28px}
          .proof-frame{width:1080px;background:#ffffff;border:1px solid #DBEAFE;border-radius:18px;padding:28px 32px 32px;box-shadow:0 16px 40px rgba(16,42,67,.06);margin:0 0 28px}
          .proof-frame::before{content:"";display:block;height:4px;margin:-28px -32px 24px;border-radius:18px 18px 0 0;background:linear-gradient(90deg,#0B5FFF,#38BDF8)}
          .proof-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:22px}
          .proof-kicker{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#3D5270}
          .proof-frame h2{margin:0;font-family:'Noto Sans',sans-serif;font-size:28px;font-weight:750;letter-spacing:0;color:#102A43}
          .proof-sub{margin:8px 0 0;font-size:15px;color:#3D5270}
          .proof-chip{border:1px solid #DBEAFE;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;color:#0B5FFF;background:#f4f8ff}
          .ratio-layout{display:grid;grid-template-columns:1.05fr .95fr;gap:16px}
          .ratio-lead,.ratio-card{background:#f4f8ff;border:1px solid #DBEAFE;border-radius:16px;padding:20px 22px}
          .ratio-lead{display:flex;flex-direction:column;justify-content:center}
          .ratio-label{margin:0;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#3D5270}
          .ratio-value{margin:10px 0 8px;font-size:64px;line-height:.95;font-weight:750;color:#0B5FFF}
          .ratio-value-sm{font-size:36px;margin:8px 0}
          .ratio-formula{margin:0;font-size:14px;color:#3D5270}
          .ratio-work-label{margin:22px 0 6px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0B5FFF}
          .ratio-work{margin:8px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:650;color:#102A43}
          .ratio-stack{display:flex;flex-direction:column;gap:12px}
          .ratio-card .ratio-work{margin-top:10px}
          .proof-actions{display:flex;justify-content:flex-end}
          .proof-actions .signoff-primary{text-transform:none;letter-spacing:.02em;font-size:13px;border-radius:999px;background:#0B5FFF;color:#ffffff}
          .proof-actions button{color:#102A43}
          #shot-signoff [data-signoff-certificate] span{color:#102A43}
          #shot-signoff [data-signoff-certificate]{background:#f4f8ff}
          .plan-row{display:flex;justify-content:space-between;gap:24px;align-items:center;border:1px solid #DBEAFE;border-radius:16px;padding:18px 20px;background:#f4f8ff}
          .plan-title{margin:0;font-size:18px;font-weight:700;color:#102A43}
          .plan-why{margin:6px 0 0;font-size:14px;color:#3D5270}
          .plan-meta{display:flex;align-items:center;gap:14px;font-size:13px;font-weight:650;color:#102A43;white-space:nowrap}
          .plan-bar{display:inline-block;width:88px;height:8px;border-radius:99px;background:#DBEAFE;overflow:hidden}
          .plan-bar i{display:block;height:100%;background:#0B5FFF}
        `}</style>
        <RatioShot />
        <SignoffShot />
        <PlanShot />
      </div>
    </MarketProvider>
  );
}
