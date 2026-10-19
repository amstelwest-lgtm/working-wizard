/**
 * LOW findings from the accountant persona walk.
 * Run: pnpm test:aqa-low-findings
 */
import { describeBusiness } from "../src/lib/client-briefing";
import {
  displayForecastFrequency,
  groupSmallForecastRows,
  isDisplayOnceOff,
} from "../src/lib/cash-forecast-rows";
import { distributeForecastLine } from "../src/lib/client-metrics";
import { operatingProfitLabel, statementMoneyScale } from "../src/lib/operating-profit-display";
import { profileDisplayRows } from "../src/lib/profile-signals";
import { ZA_MARKET } from "../src/lib/market";
import { parseMarketSelection } from "../src/lib/market/parse";
import { readZaMarketExtras } from "../src/lib/market/za-provinces";
import type { ClientOperatingProfile } from "../src/lib/client-profile";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const profile = {
  version: 1,
  payMotion: "time_delivery",
  volumeUnit: "day_shift",
  secondaryVolumeUnits: [],
  templateId: "day_labour",
  debtorDaysDefault: 45,
  costShape: "payroll_heavy",
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

const slowDefault = describeBusiness(profile, "manufacturing")!;
assert(!slowDefault.includes("45+"), slowDefault);
assert(slowDefault.includes("customers pay in 45 days"), slowDefault);

const actual = describeBusiness(profile, "manufacturing", 6)!;
assert(actual.includes("customers pay in 6 days"), actual);
assert(!actual.includes("45"), actual);

const rows = profileDisplayRows(profile, ZA_MARKET, 6);
const pay = rows.find((row) => row.label === "Customer pay")?.value;
assert(pay === "6 days", `customer pay label ${pay}`);

const rent = distributeForecastLine(
  { name: "Rent", amount: "8000", frequency: displayForecastFrequency("Rent", "once-off"), startWeek: 1 },
  13,
);
assert(
  rent[0] === 8000 && rent[4] === 8000 && rent[9] === 8000 && rent[8] === 0 && rent[12] === 0,
  "rent repeats once a month, three times in 13 weeks",
);
assert(rent[1] === 0, "rent is not weekly");
assert(displayForecastFrequency("Payroll", "recurring-weekly") === "recurring-weekly", "a weekly payroll stays weekly");
assert(isDisplayOnceOff("Coffee", "once-off"), "a small purchase stays a one-off");

const oneOffs = Array.from({ length: 12 }, (_, index) => ({
  id: `o${index}`,
  name: `Purchase ${index}`,
  onceOff: true,
  vals: [index === 0 ? 5000 : 100],
}));
const grouped = groupSmallForecastRows(oneOffs);
assert(grouped.some((row) => row.name === "Other"), "small one-offs fold into Other");
assert(grouped.length < oneOffs.length, "the wall is shorter");
const before = oneOffs.reduce((sum, row) => sum + row.vals[0]!, 0);
const after = grouped.reduce((sum, row) => sum + row.vals[0]!, 0);
assert(before === after, `grouping keeps the total ${before} vs ${after}`);

const scaled = operatingProfitLabel({
  ebit: 220,
  revenue: 1000,
  market: ZA_MARKET,
  financials: { statementUnits: "thousands" },
});
assert(scaled.startsWith("22.0%"), scaled);
assert(scaled.includes("220k"), scaled);
assert(!scaled.endsWith("R\u00a0220") && !scaled.endsWith("R 220"), scaled);
assert(statementMoneyScale({ revenue: "220" }) === 1, "a missing scale is not invented");
const plain = operatingProfitLabel({ ebit: 220, revenue: 1000, market: ZA_MARKET, financials: {} });
assert(plain.includes("220"), plain);
assert(!plain.includes("k"), plain);

const parsed = parseMarketSelection({
  country: "ZA",
  regionCode: null,
  provinceCode: "WC",
  vatMode: "inclusive",
  vatRegistered: true,
});
assert(parsed?.country === "ZA" && parsed.regionCode == null, "ZA still has no US state");
const extras = readZaMarketExtras({
  country: "ZA",
  regionCode: null,
  provinceCode: "WC",
  vatMode: "inclusive",
  vatRegistered: false,
});
assert(extras.provinceCode === "WC", "Western Cape is kept");
assert(extras.vatMode === "inclusive" && extras.vatRegistered === false, "VAT choices are kept");
assert(readZaMarketExtras({ country: "ZA", regionCode: null }).provinceCode == null, "a blank province stays blank");

console.log("aqa low findings ok");
