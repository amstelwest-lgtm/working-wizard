/**
 * SAMPLE company tax worksheet on the public /try walkthrough. ZA figures only.
 * The ZA sample module loads with import() so the US graph does not static-link it.
 */
import { useEffect, useState, type ComponentType } from "react";
import { TrySignoff } from "@/components/try-signoff";
import type { CompanyTaxResult } from "@/lib/tax-specialist/sample-compute";

type WorksheetProps = {
  caption: string;
  rows: Array<{ label: string; amount: string; note?: string; total?: boolean }>;
};

type TaxChunk = {
  Worksheet: ComponentType<WorksheetProps>;
  computationRows: (result: CompanyTaxResult) => WorksheetProps["rows"];
  result: CompanyTaxResult;
};

export function TryTaxBoard() {
  const [chunk, setChunk] = useState<TaxChunk | null>(null);

  useEffect(() => {
    let live = true;
    void import("@/components/tax-specialist/za-tax-specialist-sample").then((sample) =>
      import("@/lib/tax-specialist/sample-compute").then((compute) => {
        if (!live) return;
        setChunk({
          Worksheet: sample.Worksheet,
          computationRows: sample.computationRows,
          result: compute.sampleCompanyTax(),
        });
      }),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!chunk) {
    return <p className="try-status">Working from the sample figures.</p>;
  }

  const { Worksheet, computationRows, result } = chunk;
  return (
    <div className="try-chat-board">
      <p className="try-chat-board-caption">
        <span className="try-stamp">SAMPLE</span>
        <span className="try-chat-board-who">
          <span>Milōn</span> Tax Specialist
        </span>
        Company tax computation
      </p>
      <Worksheet
        caption="SAMPLE company tax before donations and provisional payments"
        rows={computationRows(result)}
      />
      <TrySignoff />
    </div>
  );
}
