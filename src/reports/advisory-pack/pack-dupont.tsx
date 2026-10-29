import { Text, View } from "@react-pdf/renderer";
import { DuPontDiagram } from "@/components/pdf/dupont";
import { C, fmtPct } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { t } from "@/lib/market";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import { diagnoseDuPont, type DuPontLevers } from "@/reports/narrative";
import type { AdvisoryPackContentV2, PackDuPontBlock } from "@/lib/advisory-pack-schema";
import { PackExplainer, PageBand } from "./pack-explainer";

function times(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)}×`;
}

function pct(value: number | null): string {
  return value == null ? "—" : fmtPct(value);
}

function reading(
  label: string,
  current: number | null,
  prior: number | null,
  format: (value: number) => string,
  fellNote: string,
): string {
  if (current == null) return `${label} is not on file.`;
  if (prior == null) return `${label} is ${format(current)}.`;
  if (current < prior - 0.0001) {
    return `${label} fell from ${format(prior)} to ${format(current)}. ${fellNote}`;
  }
  if (current > prior + 0.0001) return `${label} rose from ${format(prior)} to ${format(current)}.`;
  return `${label} held at ${format(current)}.`;
}

function leversOf(block: PackDuPontBlock): DuPontLevers {
  return {
    roe: block.roe ?? Number.NaN,
    netMargin: block.netMargin ?? Number.NaN,
    assetTurnover: block.assetTurnover ?? Number.NaN,
    equityMultiplier: block.equityMultiplier ?? Number.NaN,
  };
}

export function PackDuPont({ content }: { content: AdvisoryPackContentV2 }) {
  const market = usePdfMarket();
  const word = t("currencyWord", market);
  const block = content.dupont;
  const section = content.sections.find((row) => row.key === "dupont");
  if (!block) {
    return (
      <View break>
        <PageBand title="DuPont diagnosis" />
        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body }}>
          Return on equity cannot be split from the figures on file.
        </Text>
      </View>
    );
  }
  const levers = leversOf(block);
  const diagnosis = diagnoseDuPont(levers);
  const prior = block.prior;
  const rows = [
    {
      label: "Net margin",
      current: pct(block.netMargin),
      prior: pct(prior?.netMargin ?? null),
      benchmark: block.benchmark?.netMargin == null ? null : pct(block.benchmark.netMargin),
      reading: reading(
        "Net margin",
        block.netMargin,
        prior?.netMargin ?? null,
        (value) => fmtPct(value),
        "Less of each sale is kept as profit.",
      ),
    },
    {
      label: "Asset turnover",
      current: times(block.assetTurnover),
      prior: times(prior?.assetTurnover ?? null),
      benchmark:
        block.benchmark?.assetTurnover == null ? null : times(block.benchmark.assetTurnover),
      reading: reading(
        "Asset turnover",
        block.assetTurnover,
        prior?.assetTurnover ?? null,
        (value) => `${value.toFixed(2)}×`,
        `The business needs more assets for every ${word} of sales.`,
      ),
    },
    {
      label: "Equity multiplier",
      current: times(block.equityMultiplier),
      prior: times(prior?.equityMultiplier ?? null),
      benchmark:
        block.benchmark?.equityMultiplier == null ? null : times(block.benchmark.equityMultiplier),
      reading: reading(
        "Equity multiplier",
        block.equityMultiplier,
        prior?.equityMultiplier ?? null,
        (value) => `${value.toFixed(2)}×`,
        "More of the assets are funded by liabilities.",
      ),
    },
  ];
  return (
    <View break>
      <PageBand
        title="DuPont diagnosis"
        tag={diagnosis.weakLeverLabel || undefined}
        tagColor={C.red}
      />
      <Text
        style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: "#102A43", marginBottom: 6 }}
      >
        What is driving the return
      </Text>
      <DuPontDiagram
        levers={levers}
        diagnosis={diagnosis}
        nodeNotes={{
          roe: prior?.roe == null ? undefined : `prior ${pct(prior.roe)}`,
          margin: prior?.netMargin == null ? undefined : `prior ${pct(prior.netMargin)}`,
          turnover:
            prior?.assetTurnover == null ? undefined : `prior ${times(prior.assetTurnover)}`,
          leverage:
            prior?.equityMultiplier == null ? undefined : `prior ${times(prior.equityMultiplier)}`,
        }}
      />
      <View style={{ borderWidth: 0.75, borderColor: C.line, borderRadius: 8, overflow: "hidden" }}>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: "#0B5FFF",
            paddingHorizontal: 8,
            paddingVertical: 5,
          }}
        >
          {["Driver", "This period", "Prior", "Reading"].map((heading) => (
            <Text
              key={heading}
              style={{
                flex: heading === "Reading" ? 2.4 : 1,
                color: C.white,
                fontSize: 7,
                fontFamily: "Helvetica-Bold",
              }}
            >
              {heading}
            </Text>
          ))}
        </View>
        {rows.map((row) => (
          <View
            key={row.label}
            style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 5 }}
          >
            <Text style={{ flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink }}>
              {row.label}
            </Text>
            <Text style={{ flex: 1, fontSize: 8, fontFamily: "Helvetica", color: C.body }}>
              {row.current}
              {row.benchmark ? `\nbench ${row.benchmark}` : ""}
            </Text>
            <Text style={{ flex: 1, fontSize: 8, fontFamily: "Helvetica", color: C.muted }}>
              {row.prior}
            </Text>
            <Text style={{ flex: 2.4, fontSize: 8, fontFamily: "Helvetica", color: C.body }}>
              {row.reading}
            </Text>
          </View>
        ))}
      </View>
      <PackExplainer
        clientName={content.clientName}
        shows={PACK_SHOWS.dupont}
        meaning={section?.meaning || diagnosis.sentence}
        actions={section?.actions ?? []}
      />
    </View>
  );
}
