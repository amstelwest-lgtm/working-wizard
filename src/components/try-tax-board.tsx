/**
 * SAMPLE company tax worksheet on the public /try walkthrough. ZA figures only.
 * Loaded lazily so the US bundle does not pull tax UI until a ZA sample asks for it.
 */
import { Worksheet, computationRows } from "@/components/tax-specialist/za-tax-specialist-sample";
import { sampleCompanyTax } from "@/lib/tax-specialist/sample-compute";
import { TrySignoff } from "@/components/try-signoff";
import "@/components/tax-specialist/za-tax-specialist-sample.css";

export function TryTaxBoard() {
  const result = sampleCompanyTax();
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
