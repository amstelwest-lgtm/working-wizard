const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const DAY_YEAR: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/**
 * "12 Oct 2026" or "12 Oct". Noon UTC so a timezone cannot move the calendar
 * day. en-GB keeps the day unpadded; en-ZA prints "05 Oct".
 */
export function humanCalendarDay(iso: string, withYear = true): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date
    .toLocaleDateString("en-GB", { timeZone: "UTC", ...(withYear ? DAY_YEAR : DAY) })
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\bSept\b/g, "Sep");
}

export function humanizeIsoDates(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => humanCalendarDay(iso));
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
}): CashExplainerCopy {
  const range =
    input.rangeStart && input.rangeEnd
      ? `${humanCalendarDay(input.rangeStart)} – ${humanCalendarDay(input.rangeEnd)}`
      : "";
  const bullets: string[] = [];
  if (input.floorText.trim()) bullets.push(`Floor ${input.floorText.trim()}.`);

  let ownerRollLine: string | null = null;
  const roll = input.anchorNote ? ROLL.exec(input.anchorNote) : null;
  const sit = !roll && input.anchorNote ? SIT.exec(input.anchorNote) : null;
  if (roll) {
    const days = roll[1]!;
    const from = humanCalendarDay(roll[2]!);
    const to = humanCalendarDay(roll[3]!);
    ownerRollLine = `Rolled forward ${humanCalendarDay(roll[3]!, false)}`;
    bullets.push(`Rolled forward to ${to} (${days} days from ${from}).`);
  } else if (sit) {
    const days = sit[1]!;
    const from = humanCalendarDay(sit[2]!);
    const to = humanCalendarDay(sit[3]!);
    ownerRollLine = "Opening cash stays the balance on file";
    bullets.push(
      `Opening cash is still the ${from} balance. ${days} days sit before this week (${to}).`,
    );
  } else if (input.anchorNote && /\d{4}-\d{2}-\d{2}/.test(input.anchorNote)) {
    bullets.push(ensurePeriod(humanizeIsoDates(input.anchorNote)));
  }

  const collections = collectionsBullet(input.cycleNote);
  if (collections) bullets.push(collections);

  const other = input.otherNote?.trim() ?? "";
  if (other && !ROLL.test(other) && !SIT.test(other)) {
    if (/estimated from the p&l/i.test(other)) {
      bullets.push("Estimated from the profit and loss.");
    } else if (!/rolled forward \d+ days/i.test(other)) {
      bullets.push(ensurePeriod(humanizeIsoDates(other)));
    }
  }

  const timing = input.timingNote?.trim() ?? "";
  if (timing) bullets.push(ensurePeriod(humanizeIsoDates(timing)));

  return { range, ownerRollLine, bullets };
}

function collectionsBullet(cycleNote: string | null): string | null {
  if (!cycleNote) return null;
  const debtor = /Debtor days are (\d+)/i.exec(cycleNote);
  if (debtor) {
    return `Collections follow monthly revenue. Debtor days (${debtor[1]}) stay on the ratios and are not used here.`;
  }
  const creditor = /Creditor days are (\d+)/i.exec(cycleNote);
  if (creditor) {
    return `Payments follow the monthly run-rate. Creditor days (${creditor[1]}) stay on the ratios and are not used here.`;
  }
  return ensurePeriod(humanizeIsoDates(cycleNote));
}

function ensurePeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
