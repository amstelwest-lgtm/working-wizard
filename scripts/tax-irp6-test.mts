/**
 * IRP6 preparation sheet: known answers for period 1, period 2, the basic
 * amount and the 80% check, plus due dates, validations, CSV and file name.
 * Run: pnpm test:tax-irp6
 */
import {
  IRP6_EMPTY_INPUTS,
  IRP6_FIELDS,
  computeIrp6,
  irp6CanDownload,
  irp6Csv,
  irp6DefaultPick,
  irp6FileName,
  irp6MissingSentence,
  irp6PeriodDates,
  irp6YearEnd,
  irp6YearOptions,
  lastWorkingDayOnOrBefore,
  parseRandsToCents,
  validTaxReference,
  type Irp6Client,
  type Irp6Inputs,
} from "../src/lib/tax-specialist/forms/irp6.ts";
import {
  IRP6_DEMO_CLIENT,
  IRP6_DEMO_INPUTS,
  IRP6_DEMO_TODAY,
} from "../src/lib/tax-specialist/forms/irp6-demo.ts";

let passed = 0;
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed += 1;
}
function equal<T>(actual: T, expected: T, msg: string): void {
  check(actual === expected, `${msg}: expected ${String(expected)}, got ${String(actual)}`);
}

const ALL_APPROVED = {
  taxpayer: true,
  estimate: true,
  adjustments: true,
  credits: true,
  result: true,
};

// Field list is data with the eFiling names.
const ids = new Set(IRP6_FIELDS.map((field) => field.id));
equal(ids.size, IRP6_FIELDS.length, "field ids are unique");
for (const name of [
  "Registered name",
  "Taxpayer reference number",
  "Year of assessment",
  "Period",
  "Estimated taxable income",
  "Tax on estimated taxable income",
  "Employees' tax for this period",
  "Foreign tax credits for this period",
  "Provisional tax paid for the first period",
  "Tax payable for this period",
]) {
  check(
    IRP6_FIELDS.some((field) => field.efiling === name),
    `eFiling field ${name} is mapped`,
  );
}
for (const field of IRP6_FIELDS) {
  check(
    field.label && field.type && field.source && field.required !== undefined,
    `${field.id} is complete`,
  );
}

// Year end, due dates, weekend shift to the last working day before.
equal(irp6YearEnd(2027, 3), "2027-02-28", "March start ends in February");
equal(irp6YearEnd(2028, 3), "2028-02-29", "leap year end");
equal(irp6YearEnd(2026, 1), "2026-12-31", "January start ends in December");
equal(irp6YearEnd(2026, 7), "2026-06-30", "July start ends in June");
const p1 = irp6PeriodDates("2027-02-28", 1);
equal(p1.periodEnd, "2026-08-31", "P1 ends six months in");
equal(p1.due, "2026-08-31", "P1 due on a Monday stays");
const p2 = irp6PeriodDates("2027-02-28", 2);
equal(p2.statutoryDue, "2027-02-28", "P2 statutory due is the year end");
equal(p2.due, "2027-02-26", "Sunday 28 Feb 2027 moves back to Friday 26 Feb");
equal(
  irp6PeriodDates("2027-02-28", 3).due,
  "2027-09-30",
  "February year end tops up by 30 September",
);
equal(irp6PeriodDates("2026-06-30", 3).due, "2026-12-31", "June year end tops up six months later");
equal(
  lastWorkingDayOnOrBefore("2026-08-09"),
  "2026-08-07",
  "Women's Day Sunday and the Saturday move to Friday",
);
equal(
  lastWorkingDayOnOrBefore("2024-03-31"),
  "2024-03-28",
  "Easter Sunday and Good Friday move to Thursday",
);
equal(
  lastWorkingDayOnOrBefore("2026-12-26"),
  "2026-12-24",
  "Day of Goodwill Saturday and Christmas move back",
);

// Picker defaults to the next due return.
const pick = irp6DefaultPick(IRP6_DEMO_TODAY, 3);
equal(pick.yearOfAssessment, 2027, "late October 2026 is in the 2027 year");
equal(pick.period, 2, "P1 has passed, P2 is next");
equal(irp6DefaultPick("2026-08-01", 3).period, 1, "before 31 August P1 is next");
check(
  irp6YearOptions(IRP6_DEMO_TODAY, 3).join() === "2026,2027,2028",
  "year options around the pick",
);
check(!irp6YearOptions("2023-01-15", 3).includes(2022), "years before the 27% rate are left out");

// Inputs.
equal(parseRandsToCents("R 12 500.50"), 1_250_050, "rands with spaces");
equal(parseRandsToCents("12,500.5"), 1_250_050, "comma thousands");
equal(parseRandsToCents("12500,5"), 1_250_050, "decimal comma");
equal(parseRandsToCents("abc"), null, "unreadable");
check(validTaxReference("9123456789") && validTaxReference("9123 456 789"), "10 digits are valid");
check(!validTaxReference("912345678") && !validTaxReference("91234567AB"), "other formats are not");

// Period 1, known answer. R 700 000 for 7 months is R 1 200 000 a year.
// + R 50 000 − R 250 000 = R 1 000 000 estimated taxable income. 27% is R 270 000.
// Period 1 is half: R 135 000. Employees' tax nil.
const period1 = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 1,
  inputs: IRP6_DEMO_INPUTS,
});
equal(period1.fullYearProfitCents, 120_000_000, "P1 annualised profit");
check(
  period1.booksMethod.includes("× 12 ÷ 7"),
  `P1 shows the annualising method: ${period1.booksMethod}`,
);
check(period1.booksMethod.includes("Mar 2026 to Sep 2026"), "method names the months");
equal(period1.netAdjustmentsCents, -20_000_000, "net adjustments");
equal(period1.estimateCents, 100_000_000, "P1 estimate");
equal(period1.estimatedTaxCents, 27_000_000, "P1 tax at 27%");
equal(period1.taxForPeriodCents, 13_500_000, "P1 tax for the period is half");
equal(period1.taxPayableCents, 13_500_000, "P1 payable");
check(
  !period1.lines.some((line) => line.id === "provisionalPaid"),
  "P1 has no earlier payment line",
);
check(!period1.lines.some((line) => line.id === "estimateAgainstActual"), "P1 has no 80% line");
equal(period1.missing.length, 0, "P1 demo has nothing missing");
check(irp6CanDownload(period1, ALL_APPROVED), "P1 demo can download once approved");
check(
  !irp6CanDownload(period1, { ...ALL_APPROVED, credits: false }),
  "an unapproved section blocks download",
);
check(
  period1.checks.some(
    (c) => c.id === "adds-up" && c.level === "ok" && c.text.includes("R 1 000 000.00"),
  ),
  "the estimate adds up",
);

// Period 1 with odd cents: half rounds down, the rest is period 2.
const odd = computeIrp6({
  client: {
    ...IRP6_DEMO_CLIENT,
    financials: { ebt: "100000.37", periodStart: "2026-03-01", periodEnd: "2027-02-28" },
  },
  yearOfAssessment: 2027,
  period: 1,
  inputs: { ...IRP6_DEMO_INPUTS, adjustments: [] },
});
equal(odd.estimatedTaxCents, 2_700_010, "27% of R 100 000.37 rounds to the cent");
equal(odd.taxForPeriodCents, 1_350_005, "half of R 27 000.10");

// Period 2, known answer: full tax less period 1 paid.
const period2 = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 2,
  inputs: IRP6_DEMO_INPUTS,
});
equal(period2.taxForPeriodCents, 27_000_000, "P2 tax for the period is the full year");
equal(period2.creditsCents, 13_500_000, "P2 credits are the P1 payment");
equal(period2.taxPayableCents, 13_500_000, "P2 payable");
equal(period2.due, "2027-02-26", "P2 due date");
equal(period2.estimatePercentOfActual, 100, "P2 estimate equals the worked figure");
check(
  period2.checks.some((c) => c.id === "eighty" && c.level === "ok"),
  "P2 at 100% passes",
);
check(
  period2.lines.find((line) => line.id === "provisionalPaid")?.efiling ===
    "Provisional tax paid for the first period",
  "P2 maps the P1 payment to eFiling",
);

// Period 2 with employees' tax and a P1 payment larger than the balance.
const credits = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 2,
  inputs: { ...IRP6_DEMO_INPUTS, employeesTaxCents: 1_000_000, provisionalPaidCents: 26_500_000 },
});
equal(credits.taxPayableCents, 0, "credits above the tax leave nil payable");
check(
  credits.checks.some((c) => c.id === "credits" && c.level === "warning"),
  "credits above tax warn",
);

// Basic amount: required at or under R 1 million, warns when the estimate is below it.
const noBasic = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 1,
  inputs: { ...IRP6_DEMO_INPUTS, basicAmountCents: null },
});
check(noBasic.basicAmountRequired, "R 1 000 000 needs the basic amount");
check(
  noBasic.missing.some((line) => line.id === "basicAmount"),
  "basic amount is missing",
);
const lowEstimate = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 1,
  inputs: { ...IRP6_DEMO_INPUTS, basicAmountCents: 110_000_000 },
});
check(
  lowEstimate.checks.some((c) => c.id === "basic-amount" && c.level === "warning"),
  "estimate below basic warns",
);
check(
  lowEstimate.checks.some((c) => c.id === "basic-amount-uplift"),
  "the 8% uplift is flagged, not added",
);
const large = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 1,
  inputs: { ...IRP6_DEMO_INPUTS, adjustments: [], basicAmountCents: null },
});
equal(large.estimateCents, 120_000_000, "no adjustments leaves R 1 200 000");
check(!large.basicAmountRequired, "above R 1 million the basic amount is not needed");
equal(large.missing.length, 0, "nothing missing above R 1 million");
check(
  !large.lines.some((line) => line.id === "basicAmount"),
  "an empty basic amount is left off when not needed",
);

// 80% check on period 2: R 900 000 against R 1 200 000 is 75%.
const short = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 2,
  inputs: { ...IRP6_DEMO_INPUTS, adjustments: [], estimateOverrideCents: 90_000_000 },
});
equal(short.estimatePercentOfActual, 75, "75% of the actual figure");
const eighty = short.checks.find((c) => c.id === "eighty");
equal(eighty?.level, "warning", "75% warns");
check(
  eighty?.text.startsWith("Your estimate is 75% of the actual figure so far."),
  `80% sentence: ${eighty?.text}`,
);
equal(short.estimatedTaxCents, 24_300_000, "tax on the typed estimate");
equal(short.taxPayableCents, 10_800_000, "R 243 000 less R 135 000 paid");
const enough = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 2,
  inputs: { ...IRP6_DEMO_INPUTS, adjustments: [], estimateOverrideCents: 96_000_000 },
});
equal(enough.estimatePercentOfActual, 80, "exactly 80%");
equal(enough.checks.find((c) => c.id === "eighty")?.level, "ok", "80% passes");

// Missing fields on a fresh sheet: the demo's three.
const fresh: Irp6Inputs = { ...IRP6_EMPTY_INPUTS, adjustments: IRP6_DEMO_INPUTS.adjustments };
const blank = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 2,
  inputs: fresh,
});
equal(
  blank.missing.map((line) => line.id).join(),
  "taxReference,basicAmount,provisionalPaid",
  "fresh P2 needs the reference, basic amount and P1 payment",
);
equal(
  irp6MissingSentence(blank.missing.length),
  "3 fields need input before you can download.",
  "missing sentence",
);
equal(irp6MissingSentence(1), "1 field needs input before you can download.", "singular");
check(!irp6CanDownload(blank, ALL_APPROVED), "missing fields block download");
const sources = Object.fromEntries(blank.lines.map((line) => [line.id, line.sourceLabel]));
equal(sources.profitBeforeTax, "From books sync, as of 1 Oct 2026", "books source with the date");
equal(sources.registeredName, "From client record", "client source");
equal(sources.taxReference, "Needs input", "input source");

// Validations.
const badRef = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 1,
  inputs: { ...IRP6_DEMO_INPUTS, taxReference: "12345" },
});
check(
  badRef.checks.some((c) => c.id === "tax-reference" && c.level === "error"),
  "bad reference is an error",
);
check(!irp6CanDownload(badRef, ALL_APPROVED), "an error blocks download");
const emptyRow = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 1,
  inputs: {
    ...IRP6_DEMO_INPUTS,
    adjustments: [{ id: "x", description: "", amountCents: null, direction: "add" }],
  },
});
check(
  emptyRow.checks.some((c) => c.level === "error" && c.text.startsWith("Adjustment 1")),
  "empty row is an error",
);
const otherYear = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2026,
  period: 2,
  inputs: IRP6_DEMO_INPUTS,
});
check(
  otherYear.checks.some((c) => c.id === "period-end" && c.level === "warning"),
  "books outside the year warn",
);
check(
  otherYear.booksMethod.includes("outside this year"),
  "books outside the year are used as they are",
);
const oldYear = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2023,
  period: 1,
  inputs: IRP6_DEMO_INPUTS,
});
check(
  !oldYear.supported && oldYear.checks.some((c) => c.id === "supported"),
  "pre-2023 rate years are out",
);
const noBooks: Irp6Client = { ...IRP6_DEMO_CLIENT, financials: { revenue: "100" } };
const typed = computeIrp6({
  client: noBooks,
  yearOfAssessment: 2027,
  period: 1,
  inputs: { ...IRP6_EMPTY_INPUTS },
});
check(
  typed.missing.some((line) => line.id === "profitBeforeTax" && line.source === "input"),
  "no books asks for profit",
);

// CSV and file names.
equal(
  irp6FileName("Harbour & Co (Pty) Ltd", 2027, 2, "pdf"),
  "IRP6_Harbour_Co_Pty_Ltd_2027_P2.pdf",
  "PDF name",
);
equal(
  irp6FileName("Milōn Café", 2027, 1, "csv"),
  "IRP6_Milon_Cafe_2027_P1.csv",
  "CSV name drops accents",
);
const csv = irp6Csv(period2, IRP6_DEMO_INPUTS.adjustments).split("\n");
equal(csv[0], "Field,Value", "CSV header");
check(csv.includes("Taxpayer reference number,9123456789"), "CSV reference");
check(csv.includes("Estimated taxable income,1000000.00"), "CSV estimate");
check(csv.includes("Tax payable for this period,135000.00"), "CSV payable");
check(
  csv.includes('"Adjustment, added: Traffic fines, not deductible",50000.00'),
  "CSV adjustment row is quoted",
);
check(csv.includes("Due date,2027-02-26"), "CSV due date");

console.log(`tax-irp6: ${passed} checks passed`);
