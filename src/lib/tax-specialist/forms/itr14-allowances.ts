/**
 * ITR14 wear-and-tear schedule and assessed-loss working.
 *
 * Draft figures for a person to check. Milōn does not log into SARS, does not
 * file, and does not write a ledger. A blank register is not zero.
 *
 * s11(e) uses the straight-line periods in SARS Interpretation Note 47
 * (Issue 5) and a month count: a month counts when the asset was in use.
 * s12C is 40/20/20/20 for new and unused manufacturing assets, otherwise
 * 20% a year for five years, and is not pro-rated.
 * Small s11(e) items of R7 000 or less are written off in full in the year
 * they are brought into use.
 * A disposal recoups the excess of proceeds over tax value, and proceeds
 * above cost are ignored (s8(4)(a)).
 */
export const SMALL_ITEM_CENTS = 700_000;
export const ASSESSED_LOSS_FLOOR_CENTS = 100_000_000;
export const ASSESSED_LOSS_RING_FENCE_FROM = "2023-03-31";

export const ASSESSED_LOSS_NOTE =
  "Draft for review. For a year of assessment ending on or after 31 March 2023, set-off is limited to the greater of R1 000 000 and 80% of taxable income before the assessed loss and before the donation limit. A named person approves this pack and files it on eFiling.";

export type WearSection = "s11e" | "s12c";

export type WearAsset = {
  id: string;
  description: string;
  /** Whole cents. Null is blank, not zero. */
  costCents: number | null;
  broughtIntoUse: string;
  category: string;
  section: WearSection;
  /** 0–100. Only the business-use balance is allowed. */
  privateUsePercent: number;
  /** s12C: new and unused is 40/20/20/20. Anything else is 20% a year. */
  newAndUnused: boolean;
  /** Accountant marked the s11(e) small-item write-off. Cost of R7 000 or less is what makes it apply. */
  smallItem?: boolean;
  additionCents: number | null;
  additionDate: string | null;
  disposalDate: string | null;
  proceedsCents: number | null;
  /** Accounting depreciation for the year. Null means the register does not say. */
  bookDepreciationCents: number | null;
};

export type WearRow = {
  id: string;
  description: string;
  sectionLabel: string;
  category: string;
  costCents: number;
  allowanceCents: number;
  recoupmentCents: number;
  taxValueCents: number;
  detail: string;
};

export type WearIssue = { id: string; message: string };

export type WearSchedule = {
  draft: true;
  rows: WearRow[];
  /** Rows that could not be computed. They stay on the schedule with a blank allowance. */
  issues: WearIssue[];
  /** Null when nothing on the register could be computed. A blank register never reaches here. */
  wearAndTearCents: number | null;
  bookDepreciationCents: number | null;
  recoupmentCents: number;
  /** Book depreciation plus recoupment. Null when the register does not state book depreciation and nothing is recouped. */
  depreciationAddBackCents: number | null;
  notes: string[];
};

export type AssessedLossWorking = {
  draft: true;
  broughtForwardCents: number;
  taxableBeforeLossCents: number;
  eightyPercentCents: number | null;
  /** Greater of R1 000 000 and 80% of taxable income before the loss. */
  limitCents: number | null;
  /** Amount that reduces taxable income. */
  setOffCents: number;
  /** Amount subtracted on the bridge. The full balance, unless the ring-fence cuts it. */
  subtractedCents: number;
  carriedCents: number;
  ringFenceApplies: boolean;
  note: string;
};

type Parts = { y: number; m: number; d: number };

const WRITE_OFF_YEARS: Readonly<Record<string, number>> = {
  "adding machines": 6,
  "air conditioners window type": 6,
  "air conditioners mobile": 5,
  "air conditioners room unit": 10,
  "air handling units": 20,
  "cooling towers": 15,
  "condensing sets": 15,
  "chillers absorption type": 25,
  "chillers centrifugal": 20,
  "aircraft light passenger or commercial helicopters": 4,
  "arc welding equipment": 6,
  artefacts: 25,
  balers: 6,
  "battery chargers": 5,
  bicycles: 4,
  boilers: 4,
  bulldozers: 3,
  "bumping flaking": 4,
  carports: 5,
  "cash registers": 5,
  "cell phone antennae": 6,
  "cell phone masts": 10,
  "cellular telephones": 2,
  "cheque writing machines": 6,
  "cinema equipment": 5,
  "cold drink dispensers": 6,
  "communication systems": 5,
  compressors: 4,
  "computers main frame servers": 5,
  "main frame servers": 5,
  "computers personal": 3,
  "personal computers": 3,
  "personal computer": 3,
  "computer tablet and similar devices": 2,
  "computer software main frames purchased": 3,
  "computer software main frames self developed": 5,
  "computer software personal computers": 2,
  "concrete mixers portable": 4,
  "concrete transit mixers": 3,
  "containers large metal type used for transporting freight": 10,
  containers: 10,
  "crop sprayers": 6,
  curtains: 5,
  "debarking equipment": 4,
  "delivery vehicles": 4,
  "demountable partitions": 6,
  "dental and doctors equipment": 5,
  dictaphones: 3,
  "drilling equipment water": 5,
  drills: 6,
  "electric saws": 6,
  "electrostatic copiers": 6,
  "engraving equipment": 5,
  escalators: 20,
  excavators: 4,
  "fax machines": 3,
  "fertiliser spreaders": 6,
  "fertilizer spreaders": 6,
  firearms: 6,
  "fire extinguishers loose units": 5,
  "fire detection systems": 3,
  "fishing vessels": 12,
  "fitted carpets": 6,
  "food bins": 4,
  "food conveying systems": 4,
  "fork lift trucks": 4,
  "front end loaders": 4,
  "furniture and fittings": 6,
  "gantry cranes": 6,
  "garden irrigation equipment movable": 5,
  "gas cutting equipment": 6,
  "gas heaters and cookers": 6,
  gearboxes: 4,
  "gear shapers": 6,
  "generators portable": 5,
  "generators standby": 15,
  graders: 4,
  "grinding machines": 6,
  guillotines: 6,
  "cardiovascular equipment": 2,
  "health testing equipment": 5,
  "weights and strength equipment": 4,
  "spinning equipment": 1,
  "gymnasium equipment other": 10,
  "hairdressers equipment": 5,
  harvesters: 6,
  "heat dryers": 6,
  "heating equipment": 6,
  "hot water systems": 5,
  incubators: 6,
  "ironing and pressing equipment": 6,
  "kitchen equipment": 6,
  "knitting machines": 6,
  "laboratory research equipment": 5,
  lathes: 6,
  "laundromat equipment": 5,
  "law reports sets legal practitioners": 5,
  "law reports": 5,
  "lift installations goods passengers": 12,
  "magnetic resonance imaging scanners": 5,
  "medical theatre equipment": 6,
  "milling machines": 6,
  "mobile caravans": 5,
  "mobile cranes": 4,
  "mobile refrigeration units": 4,
  motors: 4,
  motorcycles: 4,
  "motorised chainsaws": 4,
  "motorized chainsaws": 4,
  "motorised concrete mixers": 3,
  "motor mowers": 5,
  "musical instruments": 5,
  "navigation systems": 10,
  "neon signs and advertising boards": 10,
  "office equipment electronic": 3,
  "office equipment mechanical": 5,
  "oxygen concentrators": 3,
  "ovens and heating devices": 6,
  "ovens for heating food": 6,
  "packaging and related equipment": 4,
  "paintings valuable": 25,
  pallets: 4,
  "passenger cars": 5,
  "patterns tooling and dies": 3,
  "pellet mills": 4,
  "perforating equipment": 6,
  "photocopying equipment": 5,
  "photographic equipment": 6,
  planers: 6,
  "pleasure craft etc": 12,
  "pleasure craft": 12,
  ploughs: 6,
  "portable safes": 25,
  "power tools hand operated": 5,
  "power supply": 5,
  "public address systems": 5,
  pumps: 4,
  "race horses": 4,
  "radar systems": 5,
  "radio communication equipment": 5,
  "refrigerated milk tankers": 4,
  "refrigeration equipment": 6,
  refrigerators: 6,
  "runway lights": 5,
  sanders: 6,
  scales: 5,
  "security systems removable": 5,
  "seed separators": 6,
  "sewing machines": 6,
  shakers: 4,
  "shop fittings": 6,
  "solar energy units": 5,
  "special patterns and tooling": 2,
  "spin dryers": 6,
  "spot welding equipment": 6,
  "staff training equipment": 5,
  "surge bins": 4,
  "surveyors instruments": 10,
  "surveyors field equipment": 5,
  "tape recorders": 5,
  "telephone equipment": 5,
  "television and advertising films": 4,
  "television sets video machines and decoders": 6,
  textbooks: 3,
  tractors: 4,
  trailers: 5,
  traxcavators: 4,
  trolleys: 3,
  "trucks heavy duty": 3,
  "trucks other": 4,
  "truck mounted cranes": 4,
  typewriters: 6,
  "vending machines including video game machines": 6,
  "vending machines": 6,
  "video cassettes": 2,
  "warehouse racking": 10,
  "washing machines": 5,
  "water distillation and purification plant": 12,
  "water tankers": 4,
  "water tanks": 6,
  "weighbridges movable parts": 10,
  "wire line rods": 1,
  "workshop equipment": 5,
  "x ray equipment": 5,
};

export function normaliseCategory(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function writeOffYears(category: string): number | null {
  const key = normaliseCategory(category);
  if (!key) return null;
  return WRITE_OFF_YEARS[key] ?? null;
}

function parseIso(iso: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
  return { y, m, d };
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addYears(iso: string, years: number): string {
  const parts = parseIso(iso);
  if (!parts) return iso;
  const y = parts.y + years;
  return isoOf(y, parts.m, Math.min(parts.d, lastDay(y, parts.m)));
}

function dayBefore(iso: string): string {
  const parts = parseIso(iso);
  if (!parts) return iso;
  const utc = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return isoOf(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function monthsInclusive(from: string, to: string): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b || from > to) return 0;
  return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

type Window = { start: string; end: string };

function priorWindows(useDate: string, yearStart: string): Window[] {
  const windows: Window[] = [];
  let start = yearStart;
  for (let guard = 0; guard < 40; guard += 1) {
    const end = dayBefore(start);
    const prevStart = addYears(start, -1);
    if (useDate > end) break;
    windows.unshift({ start: prevStart, end });
    start = prevStart;
  }
  return windows;
}

function claimMonths(cost: number, years: number, months: number, claimed: number): number {
  const remaining = cost - claimed;
  if (remaining <= 0 || months <= 0 || years <= 0) return 0;
  const raw = Math.round((cost * Math.min(months, 12)) / (years * 12));
  if (raw >= remaining) return remaining;
  if (remaining - raw <= 1) return remaining;
  return raw;
}

function claimRate(cost: number, rate: number, claimed: number, finalYear: boolean): number {
  const remaining = cost - claimed;
  if (remaining <= 0 || rate <= 0) return 0;
  const raw = Math.round((cost * rate) / 100);
  if (finalYear || raw >= remaining) return remaining;
  if (remaining - raw <= 1) return remaining;
  return raw;
}

function s12cRate(index: number, newAndUnused: boolean): number {
  if (index < 1) return 0;
  if (newAndUnused) return index === 1 ? 40 : index <= 4 ? 20 : 0;
  return index <= 5 ? 20 : 0;
}

function businessOf(cents: number, privateUsePercent: number): number {
  return Math.round((cents * (100 - privateUsePercent)) / 100);
}

type Component = { costCents: number; broughtIntoUse: string; label: string };

function componentMovement(
  asset: WearAsset,
  component: Component,
  yearStart: string,
  yearEnd: string,
  disposalInYear: string | null,
): { allowance: number; prior: number; current: number; detail: string } | { error: string } {
  const { costCents: cost, broughtIntoUse: useDate } = component;
  if (useDate > yearEnd) {
    return { allowance: 0, prior: 0, current: 0, detail: "Not brought into use this year." };
  }
  const business = (gross: number) => businessOf(gross, asset.privateUsePercent);
  if (asset.section === "s12c") {
    const windows = priorWindows(useDate, yearStart).filter((window) => useDate <= window.end);
    let claimed = 0;
    windows.forEach((window, index) => {
      const rate = s12cRate(index + 1, asset.newAndUnused);
      claimed += claimRate(cost, rate, claimed, false);
    });
    const index = windows.length + 1;
    const rate = s12cRate(index, asset.newAndUnused);
    const finalYear = asset.newAndUnused ? index === 4 : index === 5;
    const current = claimRate(cost, rate, claimed, finalYear && rate > 0);
    const band = asset.newAndUnused ? "40/20/20/20" : "20% a year";
    return {
      allowance: business(current),
      prior: claimed,
      current,
      detail: `s12C ${band}, year ${index}${rate ? ` at ${rate}%` : ""}. Not pro-rated.`,
    };
  }
  const years = writeOffYears(asset.category);
  if (years == null) return { error: "Category is not on Interpretation Note 47." };
  const small = cost <= SMALL_ITEM_CENTS;
  if (small && useDate < yearStart) {
    return {
      allowance: 0,
      prior: cost,
      current: 0,
      detail: "Small item, written off in full in an earlier year.",
    };
  }
  if (small) {
    return {
      allowance: business(cost),
      prior: 0,
      current: cost,
      detail: "s11(e) small item of R7 000 or less, written off in full.",
    };
  }
  let claimed = 0;
  for (const window of priorWindows(useDate, yearStart)) {
    const from = useDate > window.start ? useDate : window.start;
    claimed += claimMonths(cost, years, monthsInclusive(from, window.end), claimed);
  }
  const from = useDate > yearStart ? useDate : yearStart;
  const to = disposalInYear ?? yearEnd;
  const months = monthsInclusive(from, to);
  const current = claimMonths(cost, years, months, claimed);
  const privateNote =
    asset.privateUsePercent > 0 ? `, private use ${asset.privateUsePercent}%` : "";
  return {
    allowance: business(current),
    prior: claimed,
    current,
    detail: `s11(e), ${years} years, ${months} of 12 months${privateNote}.`,
  };
}

function disposalInYear(asset: WearAsset, yearStart: string, yearEnd: string): string | null {
  if (!asset.disposalDate || asset.disposalDate < yearStart || asset.disposalDate > yearEnd) {
    return null;
  }
  return asset.disposalDate;
}

function rowFor(asset: WearAsset, yearStart: string, yearEnd: string): WearRow | { error: string } {
  const problem = assetProblem(asset);
  if (problem) return { error: problem };
  const costCents = asset.costCents;
  if (costCents == null) return { error: "Cost must be a nil or positive amount." };
  if (asset.disposalDate && asset.disposalDate < yearStart) {
    return {
      id: asset.id,
      description: asset.description,
      sectionLabel: asset.section === "s12c" ? "s12C" : "s11(e)",
      category: asset.category,
      costCents: costCents + (asset.additionCents ?? 0),
      allowanceCents: 0,
      recoupmentCents: 0,
      taxValueCents: 0,
      detail: "Disposed before this year, so there is no allowance or recoupment.",
    };
  }
  const disposal = disposalInYear(asset, yearStart, yearEnd);
  const components: Component[] = [
    { costCents, broughtIntoUse: asset.broughtIntoUse, label: asset.description },
  ];
  if (asset.additionCents != null && asset.additionCents > 0 && asset.additionDate) {
    const addBy = disposal ?? yearEnd;
    if (asset.additionDate <= addBy) {
      components.push({
        costCents: asset.additionCents,
        broughtIntoUse: asset.additionDate,
        label: `${asset.description} addition`,
      });
    }
  }
  let allowance = 0;
  let taxValue = 0;
  let cost = 0;
  const details: string[] = [];
  for (const component of components) {
    if (disposal && component.broughtIntoUse > disposal) continue;
    const movement = componentMovement(asset, component, yearStart, yearEnd, disposal);
    if ("error" in movement) return movement;
    allowance += movement.allowance;
    const closing = component.costCents - movement.prior - movement.current;
    taxValue += closing;
    cost += component.costCents;
    details.push(movement.detail);
  }
  let recoupment = 0;
  if (disposal && asset.proceedsCents != null) {
    const capped = Math.min(asset.proceedsCents, cost);
    const gross = Math.max(0, capped - taxValue);
    recoupment = businessOf(gross, asset.privateUsePercent);
    details.push("Recoupment is proceeds over tax value, and never above cost.");
  } else if (asset.disposalDate && asset.disposalDate > yearEnd) {
    details.push("Disposal date is after this year.");
  }
  return {
    id: asset.id,
    description: asset.description,
    sectionLabel: asset.section === "s12c" ? "s12C" : "s11(e)",
    category: asset.category,
    costCents: cost,
    allowanceCents: allowance,
    recoupmentCents: recoupment,
    taxValueCents: taxValue,
    detail: details.join(" "),
  };
}

function assetProblem(asset: WearAsset): string | null {
  if (!asset.description.trim()) return "An asset needs a description.";
  if (asset.costCents == null || !Number.isSafeInteger(asset.costCents) || asset.costCents < 0)
    return "Cost must be a nil or positive amount.";
  if (!parseIso(asset.broughtIntoUse)) return "Date brought into use must be a real date.";
  if (asset.section !== "s11e" && asset.section !== "s12c")
    return "Section must be s11(e) or s12C.";
  if (
    !Number.isInteger(asset.privateUsePercent) ||
    asset.privateUsePercent < 0 ||
    asset.privateUsePercent > 100
  ) {
    return "Private use must be a whole percent from 0 to 100.";
  }
  if (
    asset.additionCents != null &&
    (!Number.isSafeInteger(asset.additionCents) || asset.additionCents < 0)
  ) {
    return "An addition must be a nil or positive amount.";
  }
  if (
    asset.additionCents != null &&
    asset.additionCents > 0 &&
    !parseIso(asset.additionDate ?? "")
  ) {
    return "An addition needs the date it was brought into use.";
  }
  if (asset.disposalDate && !parseIso(asset.disposalDate))
    return "Disposal date must be a real date.";
  if (
    asset.disposalDate &&
    (asset.proceedsCents == null ||
      !Number.isSafeInteger(asset.proceedsCents) ||
      asset.proceedsCents < 0)
  ) {
    return "A disposal needs proceeds.";
  }
  if (
    asset.bookDepreciationCents != null &&
    (!Number.isSafeInteger(asset.bookDepreciationCents) || asset.bookDepreciationCents < 0)
  ) {
    return "Book depreciation must be a nil or positive amount.";
  }
  if (
    asset.section === "s11e" &&
    writeOffYears(asset.category) == null &&
    asset.costCents > SMALL_ITEM_CENTS
  ) {
    return "Category is not on Interpretation Note 47.";
  }
  return null;
}

/**
 * Null when the register is blank. Totals stay null when every row fails,
 * so a broken import does not write zero onto the return.
 */
export function wearSchedule(
  assets: readonly WearAsset[],
  yearStart: string,
  yearEnd: string,
): WearSchedule | null {
  if (assets.length === 0) return null;
  if (!parseIso(yearStart) || !parseIso(yearEnd) || yearStart > yearEnd) return null;
  const rows: WearRow[] = [];
  const issues: WearIssue[] = [];
  const notes: string[] = [];
  let book: number | null = null;
  for (const asset of assets) {
    const row = rowFor(asset, yearStart, yearEnd);
    if ("error" in row) {
      issues.push({ id: asset.id, message: row.error });
      notes.push(`${asset.description.trim() || "Asset"}: ${row.error}`);
      continue;
    }
    rows.push(row);
    if (asset.bookDepreciationCents != null) book = (book ?? 0) + asset.bookDepreciationCents;
  }
  if (rows.length === 0) {
    return {
      draft: true,
      rows: [],
      issues,
      wearAndTearCents: null,
      bookDepreciationCents: book,
      recoupmentCents: 0,
      depreciationAddBackCents: null,
      notes,
    };
  }
  const wearAndTearCents = rows.reduce((sum, row) => sum + row.allowanceCents, 0);
  const recoupmentCents = rows.reduce((sum, row) => sum + row.recoupmentCents, 0);
  const depreciationAddBackCents =
    book == null && recoupmentCents === 0 ? null : (book ?? 0) + recoupmentCents;
  notes.unshift(
    "Draft for review. s11(e) is pro-rated by month. s12C is not. A named person approves this pack and files it on eFiling.",
  );
  return {
    draft: true,
    rows,
    issues,
    wearAndTearCents,
    bookDepreciationCents: book,
    recoupmentCents,
    depreciationAddBackCents,
    notes,
  };
}

/** Which register field a validation sentence belongs beside. */
export function wearIssueField(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("proceeds")) return "proceeds";
  if (text.includes("addition")) return "addition";
  if (text.includes("disposal")) return "disposal";
  if (text.includes("description")) return "description";
  if (text.includes("cost")) return "cost";
  if (text.includes("brought into use")) return "date";
  if (text.includes("category") || text.includes("interpretation note")) return "category";
  if (text.includes("private use")) return "private";
  if (text.includes("section")) return "section";
  if (text.includes("depreciation")) return "book";
  return "description";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function centsField(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function randsToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const cents = Math.round(value * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number(value.replace(/[Rr\s,]/g, ""));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function money(row: Record<string, unknown>, centsKey: string, randsKey: string): number | null {
  if (centsKey in row && row[centsKey] != null && row[centsKey] !== "") {
    return centsField(row[centsKey]);
  }
  if (randsKey in row && row[randsKey] != null && row[randsKey] !== "")
    return randsToCents(row[randsKey]);
  return null;
}

function parseSection(value: unknown): WearSection | null {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (key === "s11e" || key === "11e" || key === "small") return "s11e";
  if (key === "s12c" || key === "12c") return "s12c";
  return null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match && parseIso(match[1]) ? match[1] : null;
}

function parsePercent(value: unknown): number | null {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace("%", "").trim());
  if (!Number.isInteger(n) || n < 0 || n > 100) return null;
  return n;
}

function parseFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "yes" || value === "y";
}

function coerceAsset(value: unknown, index: number): WearAsset | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const description = text(row.description) || text(row.name);
  const costCents = money(row, "costCents", "cost");
  const broughtIntoUse = parseDate(row.broughtIntoUse) || parseDate(row.dateBroughtIntoUse) || "";
  const category = text(row.category);
  const section = parseSection(row.section);
  if (!description && costCents == null && !broughtIntoUse && !category && !section) return null;
  const privateUse = parsePercent(row.privateUsePercent ?? row.privateUse);
  const additionCents = money(row, "additionCents", "addition");
  const proceedsCents = money(row, "proceedsCents", "proceeds");
  const book = money(row, "bookDepreciationCents", "bookDepreciation");
  return {
    id: text(row.id) || `asset-${index + 1}`,
    description,
    costCents,
    broughtIntoUse,
    category,
    section: section ?? "s11e",
    privateUsePercent: privateUse ?? -1,
    newAndUnused: parseFlag(row.newAndUnused ?? row.newAndUnusedAsset),
    smallItem: row.smallItem === true || row.section === "small",
    additionCents,
    additionDate: parseDate(row.additionDate),
    disposalDate: parseDate(row.disposalDate),
    proceedsCents,
    bookDepreciationCents: book,
  };
}

/**
 * Typed assets and imported rows share one shape. A row with no asset fields
 * is dropped. A blank cost stays on the row so the accountant can see it.
 */
export function wearAssetsFrom(value: unknown): WearAsset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, index) => {
    const asset = coerceAsset(row, index);
    return asset ? [asset] : [];
  });
}

export function importWearAssets(rows: readonly unknown[]): WearAsset[] {
  return wearAssetsFrom(rows);
}

/**
 * s20(1)(a) ring-fence. The 80% base is taxable income before the loss and
 * before the donation limit. Draft for review.
 */
export function assessedLossWorking(input: {
  taxableBeforeLossCents: number;
  broughtForwardCents: number;
  yearEnd: string;
}): AssessedLossWorking {
  const base = input.taxableBeforeLossCents;
  const brought = input.broughtForwardCents;
  const ringFenceApplies = input.yearEnd >= ASSESSED_LOSS_RING_FENCE_FROM && base > 0;
  const eightyPercentCents = base > 0 ? Math.floor((base * 80) / 100) : null;
  const limitCents = ringFenceApplies
    ? Math.max(ASSESSED_LOSS_FLOOR_CENTS, eightyPercentCents ?? 0)
    : null;
  const subtractedCents = ringFenceApplies ? Math.min(brought, limitCents ?? brought) : brought;
  const setOffCents = Math.min(subtractedCents, Math.max(base, 0));
  const unused = brought - subtractedCents;
  const bridge = base - subtractedCents;
  const carriedCents = unused + (bridge < 0 ? -bridge : 0);
  return {
    draft: true,
    broughtForwardCents: brought,
    taxableBeforeLossCents: base,
    eightyPercentCents: ringFenceApplies ? eightyPercentCents : null,
    limitCents,
    setOffCents,
    subtractedCents,
    carriedCents,
    ringFenceApplies,
    note: ringFenceApplies
      ? ASSESSED_LOSS_NOTE
      : base <= 0
        ? "Taxable income before the loss is not positive, so nothing is set off. Draft for review."
        : "This year ends before 31 March 2023, so the 80% limit is not applied. Draft for review.",
  };
}
