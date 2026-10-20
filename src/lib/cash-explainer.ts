import { calendarDayFromIso, dateOrder, weekHeaderFromIso } from "@/lib/market/date-presets";
import { formatDateRange } from "@/lib/market/format";

type CashDateMarket = { locale?: string | null };

/**
 * "12 Oct 2026" or "12 Oct". The calendar day is the written ISO date.
 * Order follows the client market.
 */
export function humanCalendarDay(iso: string, market: CashDateMarket, withYear = true): string {
  const order = dateOrder(market.locale);
  const label = withYear ? calendarDayFromIso(iso, order) : weekHeaderFromIso(iso, order);
  return label ?? "—";
}

export function humanizeIsoDates(text: string, market: CashDateMarket): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => humanCalendarDay(iso, market));
}

const ROLL =
  /rolled forward (\d+) days from (\d{4}-\d{2}-\d{2}) to this week \((\d{4}-\d{2}-\d{2})\)/i;
const SIT =
  /(\d+) days sit between (\d{4}-\d{2}-\d{2}) and this week \((\d{4}-\d{2}-\d{2})\)/i;

export type CashExplainerCopy = {
  /** Visible horizon. Human dates, sentence case. */
  range: string;
  /** Owner glance line when the forecast start moved. Null when it did not. */
  ownerRollLine: string | null;
  /** Closed-by-default Details. Short bullets, human dates. */
  bullets: string[];
};

/**
 * The card used to print the horizon, the floor, the roll-forward sentence
 * (with ISO dates) and the ratios cycle note as one block. Owners keep the
 * horizon and, when cash actually rolled, one short line. Accountants and
 * owners both get the rest as scannable bullets.
 */
export function cashExplainerCopy(input: {
  rangeStart: string | null;
  rangeEnd: string | null;
  floorText: string;
  anchorNote: string | null;
  cycleNote: string | null;
  otherNote: string | null;
  timingNote: string | null;
  market: CashDateMarket;
}): CashExplainerCopy {
  const market = input.market;
  const spanned =
    input.rangeStart && input.rangeEnd
      ? formatDateRange(input.rangeStart, input.rangeEnd, market)
      : "";
  const range = spanned === "—" ? "" : spanned;
  const bullets: string[] = [];
  if (input.floorText.trim()) bullets.push(`Floor ${input.floorText.trim()}.`);

  let ownerRollLine: string | null = null;
  const roll = input.anchorNote ? ROLL.exec(input.anchorNote) : null;
  const sit = !roll && input.anchorNote ? SIT.exec(input.anchorNote) : null;
  if (roll) {
    const days = roll[1]!;
    const from = humanCalendarDay(roll[2]!, market);
    const to = humanCalendarDay(roll[3]!, market);
    ownerRollLine = `Rolled forward ${humanCalendarDay(roll[3]!, market, false)}`;
    bullets.push(`Rolled forward to ${to} (${days} days from ${from}).`);
  } else if (sit) {
    const days = sit[1]!;
    const from = humanCalendarDay(sit[2]!, market);
    const to = humanCalendarDay(sit[3]!, market);
    ownerRollLine = "Opening cash stays the balance on file";
    bullets.push(
      `Opening cash is still the ${from} balance. ${days} days sit before this week (${to}).`,
    );
  } else if (input.anchorNote && /\d{4}-\d{2}-\d{2}/.test(input.anchorNote)) {
    bullets.push(ensurePeriod(humanizeIsoDates(input.anchorNote, market)));
  }

  const collections = collectionsBullet(input.cycleNote, market);
  if (collections) bullets.push(collections);

  const other = input.otherNote?.trim() ?? "";
  if (other && !ROLL.test(other) && !SIT.test(other)) {
    if (/estimated from the p&l/i.test(other)) {
      bullets.push("Estimated from the profit and loss.");
    } else if (!/rolled forward \d+ days/i.test(other)) {
      bullets.push(ensurePeriod(humanizeIsoDates(other, market)));
    }
  }

  const timing = input.timingNote?.trim() ?? "";
  if (timing) bullets.push(ensurePeriod(humanizeIsoDates(timing, market)));

  return { range, ownerRollLine, bullets };
}

function collectionsBullet(cycleNote: string | null, market: CashDateMarket): string | null {
  if (!cycleNote) return null;
  const debtor = /Debtor days are (\d+)/i.exec(cycleNote);
  if (debtor) {
    return `Collections follow monthly revenue. Debtor days (${debtor[1]}) stay on the ratios and are not used here.`;
  }
  const creditor = /Creditor days are (\d+)/i.exec(cycleNote);
  if (creditor) {
    return `Payments follow the monthly run-rate. Creditor days (${creditor[1]}) stay on the ratios and are not used here.`;
  }
  return ensurePeriod(humanizeIsoDates(cycleNote, market));
}

function ensurePeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
