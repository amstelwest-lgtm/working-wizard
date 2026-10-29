import { Text, View } from "@react-pdf/renderer";
import { BridgeChart } from "@/components/pdf/profit-bridge";
import { MarginLadder } from "@/components/pdf/margin-ladder";
import { SectionHeader } from "@/components/pdf/section-header";
import { ReportSection } from "@/lib/report-pdf-layout";
import { C, fmtPct } from "@/components/pdf/theme";
import type { BridgeStep } from "@/lib/profit-bridge-steps";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import type { AdvisoryPackContentV2, PackProfitStep } from "@/lib/advisory-pack-schema";
import { PackExplainer, PageBand } from "./pack-explainer";

function bridgeSteps(steps: PackProfitStep[]): BridgeStep[] {
  let running = 0;
  return steps.map((step) => {
    if (step.kind === "decrease" || step.kind === "increase") {
      const runningEnd = running + step.amount;
      running = runningEnd;
      return { label: step.label, delta: step.amount, runningEnd, kind: "decrease" };
    }
    running = step.amount;
    return {
      label: step.label,
      delta: step.amount,
      runningEnd: step.amount,
      kind: step.label.startsWith("Revenue") ? "total" : "subtotal",
    };
  });
}

export function PackProfit({
  content,
  accent,
}: {
  content: AdvisoryPackContentV2;
  accent: string;
}) {
  const profit = content.profit;
  const section = content.sections.find((row) => row.key === "profit");
  const steps = profit ? bridgeSteps(profit.steps) : [];
  const revenue = steps.find((step) => step.kind === "total")?.delta ?? 0;
  const net = [...steps].reverse().find((step) => step.label.startsWith("Net"))?.delta ?? 0;
  const gross = steps.find((step) => step.label.startsWith("Gross"))?.delta ?? 0;
  const operating = steps.find((step) => step.label.startsWith("Operating"))?.delta ?? 0;
  const margins = profit?.margins;
  return (
    <View break>
      <PageBand
        title="Profit"
        tag={margins?.net == null ? null : `${fmtPct(margins.net)} net`}
        tagColor={net >= 0 ? C.green : C.red}
      />
      {steps.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body }}>
          No profit bridge was frozen with this report.
        </Text>
      ) : (
        <>
          <ReportSection
            heading={<SectionHeader title="Revenue to profit" color={accent} />}
            lead={
              <BridgeChart
                d={{
                  revenue,
                  gross_profit: gross,
                  operating_profit: operating,
                  ebt: operating,
                  tax: 0,
                  net_profit: net,
                }}
                accent={accent}
                steps={steps}
              />
            }
          />
          <ReportSection
            heading={<SectionHeader title="Margin ladder" color={accent} />}
            lead={
              <MarginLadder
                d={{
                  revenue,
                  gross_profit: gross,
                  gross_margin_pct: margins?.gross ?? 0,
                  operating_profit: operating,
                  operating_margin_pct: margins?.operating ?? 0,
                  net_profit: net,
                  net_margin_pct: margins?.net ?? 0,
                }}
                accent={accent}
              />
            }
          />
          {margins?.priorNet != null ? (
            <Text style={{ fontSize: 8, fontFamily: "Helvetica", color: C.muted, marginBottom: 4 }}>
              {`Prior margins: gross ${margins.priorGross == null ? "—" : fmtPct(margins.priorGross)}, operating ${
                margins.priorOperating == null ? "—" : fmtPct(margins.priorOperating)
              }, net ${fmtPct(margins.priorNet)}.`}
            </Text>
          ) : null}
        </>
      )}
      <PackExplainer
        clientName={content.clientName}
        shows={PACK_SHOWS.profit}
        meaning={section?.meaning ?? ""}
        actions={section?.actions ?? []}
      />
    </View>
  );
}
