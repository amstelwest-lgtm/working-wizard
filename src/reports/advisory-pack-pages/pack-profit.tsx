import { Text, View } from "@react-pdf/renderer";
import { BridgeChart } from "@/components/pdf/profit-bridge";
import { MarginLadder } from "@/components/pdf/margin-ladder";
import { ReportSection } from "@/lib/report-pdf-layout";
import { C, fmtPct } from "@/components/pdf/theme";
import type { BridgeStep } from "@/lib/profit-bridge-steps";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import { P, SANS } from "./pack-type";
import type { AdvisoryPackContentV2, PackProfitStep } from "@/lib/advisory-pack-schema";
import { PackExplainer, PageBand } from "./pack-explainer";

function ruleTitle(title: string) {
  return (
    <View style={{ alignItems: "center", marginTop: 4, marginBottom: 6 }} wrap={false}>
      <Text
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 8,
          letterSpacing: 1.2,
          color: P.cobalt,
          textAlign: "center",
        }}
      >
        {title.toUpperCase()}
      </Text>
      <View style={{ width: 28, height: 1, backgroundColor: P.gold, marginTop: 4 }} />
    </View>
  );
}

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
  const amountOf = (prefix: string) =>
    steps.find((step) => step.label.replace(/\s+/g, " ").startsWith(prefix))?.delta ?? 0;
  const revenue = amountOf("Revenue");
  const net = amountOf("Net");
  const gross = amountOf("Gross profit");
  // "Operating Expenses" also starts with Operating. The ladder wants the profit subtotal.
  const operating = amountOf("Operating Profit");
  const margins = profit?.margins;
  return (
    <View break>
      <PageBand
        title="Profit"
        tag={margins?.net == null ? null : `${fmtPct(margins.net)} net`}
        tagColor={net >= 0 ? C.green : C.red}
      />
      {steps.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: SANS, color: C.body }}>
          No profit bridge was frozen with this report.
        </Text>
      ) : (
        <>
          <ReportSection
            heading={ruleTitle("Revenue to profit")}
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
                fontFamily={SANS}
                centerLegend
              />
            }
          />
          <ReportSection
            heading={ruleTitle("Margin ladder")}
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
                fontFamily={SANS}
              />
            }
          />
          {margins?.priorNet != null ? (
            <Text style={{ fontSize: 8, fontFamily: SANS, color: C.muted, marginBottom: 4 }}>
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
