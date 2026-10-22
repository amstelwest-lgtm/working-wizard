/**
 * AQA 1020F, prod 715486a7. The Analyst page header ran the profit sentence
 * through the month-stamp rewrite after the pro-rata label was already in it.
 * Home and Budget attach that label later, so they stayed correct.
 *
 * On base, rewriteDraftMonthStamp turns this into
 * "Mar–Full year on file, pro-rated from your Jan–Full year on file."
 *
 * Other side? Owner chat (`findingSentence` → `rewriteDraftMonthStamp`) and
 * the accountant Analyst header (`MilonTeamPane` / `PracticeAgentThread`)
 * share these two functions.
 *
 * Run: pnpm test:j4-za-analyst-prorata
 */
import {
  FULL_YEAR_ON_FILE,
  rewriteDraftMonthStamp,
  rewriteSavedMonthStamp,
} from "../src/lib/statement-period.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const EN = "\u2013";
const LABEL = `Mar${EN}Sep 2026, pro-rated from your Jan${EN}Sep 2026 statement`;
const SENTENCE = `Gross profit is R 187 444. Net profit is R 29 711. ${LABEL}.`;

const drafted = rewriteDraftMonthStamp(SENTENCE);
assert(drafted === SENTENCE, `Analyst header keeps Mar–Sep and Jan–Sep, got: ${drafted}`);
const saved = rewriteSavedMonthStamp(SENTENCE);
assert(saved === SENTENCE, `saved stamp keeps the pro-rata label, got: ${saved}`);

assert(
  rewriteSavedMonthStamp("Sep 2026 statement") === FULL_YEAR_ON_FILE,
  "a plain saved Sep 2026 statement is still the full-year label",
);
assert(
  rewriteDraftMonthStamp("Sep 2026 statement") === FULL_YEAR_ON_FILE,
  "a plain draft Sep 2026 statement is still the full-year label",
);

const mixed = `See the Sep 2026 statement. ${LABEL}.`;
assert(
  rewriteDraftMonthStamp(mixed) === `See the ${FULL_YEAR_ON_FILE}. ${LABEL}.`,
  "a stamp outside the label is still rewritten",
);
assert(
  rewriteSavedMonthStamp(mixed) === `See the ${FULL_YEAR_ON_FILE}. ${LABEL}.`,
  "the narrow stamp still rewrites a statement outside the label",
);

const single = `Sep 2026, pro-rated from your Jan${EN}Sep 2026 statement`;
assert(
  rewriteDraftMonthStamp(single) === single,
  `single-month draft label, got: ${rewriteDraftMonthStamp(single)}`,
);
assert(
  rewriteSavedMonthStamp(single) === single,
  `single-month saved label, got: ${rewriteSavedMonthStamp(single)}`,
);

const cross = `Nov 2025 ${EN} Feb 2026, pro-rated from your Sep 2025 ${EN} Feb 2026 statement`;
assert(
  rewriteDraftMonthStamp(cross) === cross,
  `cross-year draft label, got: ${rewriteDraftMonthStamp(cross)}`,
);
assert(
  rewriteSavedMonthStamp(cross) === cross,
  `cross-year saved label, got: ${rewriteSavedMonthStamp(cross)}`,
);

assert(rewriteDraftMonthStamp("due 8 Sep 2026") === "due 8 Sep 2026", "a dated day stays");
assert(
  rewriteSavedMonthStamp("Sep 2026") === "Sep 2026",
  "a cited period stays on the narrow stamp",
);
assert(
  rewriteSavedMonthStamp("Sep 2026 books look healthy") === "Full year on file looks healthy",
  "a full-year stamp still agrees the verb",
);

console.log("j4-za-analyst-prorata-label: ok");
