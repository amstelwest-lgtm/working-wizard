/**
 * Fixture proof of the #573 retest. Not a client file.
 * The amounts are the ones AQA quoted: opening R44,480, week-13 opening
 * R71,628, floor R69 on a dust forecast, and invoiced R101,250 against
 * collected R47,458.
 */
import { CashThirteenWeekGrid } from "@/components/cash-thirteen-week";
import { clientListRunwayHeadline, clientListStatusWord } from "@/lib/cash-forecast-parity";
import { describeBusiness } from "@/lib/client-briefing";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market";
import { clientIndustryDisplay } from "@/lib/profile-signals";

const money = (amount: number) => formatMoney(amount, ZA_MARKET);

const labourHotel = {
  version: 1,
  payMotion: "time_delivery",
  volumeUnit: "day_shift",
  secondaryVolumeUnits: [],
  templateId: "day_labour",
  debtorDaysDefault: 30,
  costShape: "balanced",
  seasonality: "mild",
  inventoryIntensity: "none",
  customerConcentration: "moderate",
  debtPosition: "light",
  ownerGoal: "grow_revenue",
  primaryPressure: "growth",
  businessTypeId: "services",
  fyStartMonth: 3,
  depth: "full",
  confirmedAt: "2026-01-01T00:00:00.000Z",
} as ClientOperatingProfile;

const industry = clientIndustryDisplay("Karoo Lodge", labourHotel, "service");
const about = describeBusiness(labourHotel, "service", null, {
  name: "Karoo Lodge",
  businessType: "service",
});

const dustRunway = clientListRunwayHeadline({
  source: "stored",
  opening: 0,
  closings: Array.from({ length: 13 }, () => -10),
  floor: 69,
  totalInflow: 20,
  totalOutflow: 224,
  healthOverall: 67,
});
const dustStatus = clientListStatusWord({
  healthLabel: "Watch",
  healthOverall: 67,
  source: "stored",
  opening: 0,
  floor: 69,
  dipsBelowFloorWeek: 1,
  totalInflow: 20,
  totalOutflow: 224,
});

const opening = 44_480;
const closing = Array.from({ length: 13 }, () => 71_628);
const net = closing.map((close, index) => close - (index === 0 ? opening : closing[index - 1]!));

export function AqaRetest573Preview() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-[#102A43]">
      <p className="text-xs uppercase tracking-[0.16em]">Fixture proof — not a client file</p>
      <section>
        <h1 className="font-serif text-2xl">Opening cash total</h1>
        <p className="mt-1 text-sm text-[#3D5270]" data-opening-note>
          Week 1 opens at {money(opening)}. The last week opens at {money(71_628)}. The Total column uses week 1.
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#DBEAFE] bg-white">
          <CashThirteenWeekGrid
            weeks={Array.from({ length: 13 }, (_, index) => `W${index + 1}`)}
            opening={opening}
            receipts={[]}
            payments={[]}
            inflow={net.map((value) => Math.max(0, value))}
            outflow={net.map((value) => Math.max(0, -value))}
            net={net}
            closing={closing}
            floor={50_000}
            symbol="R"
            format={(value) => money(value)}
            openingChip="On file"
            flowChip=""
            readOnly
            onCommit={() => undefined}
          />
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[#DBEAFE] bg-white p-4" data-dust>
          <p className="text-xs uppercase tracking-[0.14em] text-[#3D5270]">Placeholder forecast</p>
          <p className="mt-2 text-sm">Opening R0 · floor R69 · dust flows</p>
          <p className="mt-2 font-semibold" data-dust-runway>
            Runway {dustRunway}
          </p>
          <p data-dust-status>Status {dustStatus}</p>
        </div>
        <div className="rounded-xl border border-[#DBEAFE] bg-white p-4" data-industry>
          <p className="text-xs uppercase tracking-[0.14em] text-[#3D5270]">Health</p>
          <p className="mt-2 text-sm" data-industry-label>
            {industry}
          </p>
          <p className="mt-2 text-sm" data-about>
            {about}
          </p>
        </div>
      </section>
    </div>
  );
}
