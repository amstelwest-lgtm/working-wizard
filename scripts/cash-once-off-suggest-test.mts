/**
 * Suggest once-offs from bank history, then Save can keep them.
 * Run: pnpm test:cash-once-off-suggest
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OnceOffSuggestBar } from "../src/components/once-off-suggest-bar";
import { onceOffDirty } from "../src/lib/cash-once-off-save";
import { showSuggestOnceOffs, suggestOnceOffRows } from "../src/lib/cash-once-off-suggest";
import { buildDraftLinesFromExtract } from "../src/lib/cash-from-banks.pattern";
import type { CashBankExtract } from "../src/lib/cash-from-banks.types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const extract: CashBankExtract = {
  period_start: "2026-05-01",
  period_end: "2026-07-31",
  opening_balance: 44480,
  closing_balance: 44480,
  currency: "ZAR",
  notes: null,
  transactions: [
    ...["2026-05-01", "2026-06-01", "2026-07-01"].map((d) => ({
      txn_date: d,
      amount: 8500,
      direction: "out" as const,
      description: "RENT OFFICE PARK",
      counterparty: "Office Park Pty",
      ai_bucket: "rent" as const,
      excluded: false,
    })),
    {
      txn_date: "2026-07-20",
      amount: 15000,
      direction: "out" as const,
      description: "LAPTOP PURCHASE",
      counterparty: "Takealot",
      ai_bucket: "capex" as const,
      excluded: false,
    },
  ],
};

const suggested = suggestOnceOffRows({
  bankDraft: { extract, lines: [] },
  existing: [{ id: "rent", name: "Rent", amount: "8500", frequency: "recurring-monthly" }],
});
assert(suggested.empty == null, "a bank once-off is offered");
assert(suggested.lines.length === 1, "recurring rent is not turned into a once-off");
assert(suggested.lines[0]?.amount === "15000", "the amount is the bank line, not a new figure");
assert(suggested.lines[0]?.frequency === "once-off", "the row is once-off");
assert(
  /takealot|laptop/i.test(suggested.lines[0]?.name ?? ""),
  "the name comes from the bank line",
);
assert(
  suggested.lines.every((line) => line.amount !== "50000"),
  "the fallback floor is not suggested as a once-off",
);

const fromLines = suggestOnceOffRows({
  bankDraft: { lines: buildDraftLinesFromExtract(extract) },
  existing: [{ id: "rent", name: "Rent", amount: "8500", frequency: "recurring-monthly" }],
});
assert(fromLines.lines.length === 1 && fromLines.lines[0]?.amount === "15000", "classified bank lines suggest the same once-off");

const none = suggestOnceOffRows({ bankDraft: null, existing: [] });
assert(none.lines.length === 0 && none.empty?.includes("No once-off"), "missing bank history invents nothing");

const already = suggestOnceOffRows({
  bankDraft: {
    other: [{ id: "vat", name: "VAT", amount: "160000", frequency: "once-off", startWeek: 1 }],
  },
  existing: [{ id: "vat", name: "VAT", amount: "160000", frequency: "once-off" }],
});
assert(already.lines.length === 0 && already.empty?.includes("already"), "a once-off already on the forecast is not added again");

const fromFile = suggestOnceOffRows({
  bankDraft: {
    other: [{ id: "vat", name: "VAT", amount: "160000", frequency: "once-off", startWeek: 2 }],
  },
  existing: [],
});
assert(fromFile.lines[0]?.amount === "160000" && fromFile.lines[0]?.side === "other", "a stored once-off is prefilled");

assert(
  showSuggestOnceOffs({ suggestionCount: 2, lineAmounts: [0] }) === true,
  "the button shows when the forecast already has suggestions",
);
assert(
  showSuggestOnceOffs({ suggestionCount: 0, lineAmounts: [0, 0] }) === false,
  "an empty forecast does not show the button",
);

const staged = fromFile.lines;
const saved: { id: string; frequency: string }[] = [];
assert(
  onceOffDirty(
    staged.map((line) => ({ id: line.id, frequency: line.frequency })),
    saved,
  ),
  "a suggested once-off makes Save available",
);
assert(
  onceOffDirty(
    staged.map((line) => ({ id: line.id, frequency: line.frequency })),
    staged.map((line) => ({ id: line.id, frequency: line.frequency })),
  ) === false,
  "Save keeps the once-off and the row is no longer dirty",
);

const hidden = renderToStaticMarkup(
  createElement(OnceOffSuggestBar, {
    showSuggest: false,
    needsSave: false,
    saving: false,
    status: "",
    staged: [],
    onSuggest: () => {},
    onSave: () => {},
  }),
);
function saveIsDisabled(html: string): boolean {
  const attrs = html.match(/<button\b([^>]*)>Save once-off rows<\/button>/)?.[1] ?? "";
  return /(?:^|\s)disabled(?:=""|=""|\s|=|$)/.test(attrs);
}

assert(!hidden.includes("Suggest once-offs"), "the button stays off an empty forecast");
assert(saveIsDisabled(hidden), "Save stays disabled with no once-off row");

const open = renderToStaticMarkup(
  createElement(OnceOffSuggestBar, {
    showSuggest: true,
    needsSave: true,
    saving: false,
    status: "",
    staged: [{ id: "suggested-once-off-laptop", name: "Laptop purchase", amountLabel: "R15,000" }],
    onSuggest: () => {},
    onSave: () => {},
  }),
);
assert(open.includes("Suggest once-offs"), "the cash page offers Suggest once-offs");
assert(open.includes("Save once-off rows") && !saveIsDisabled(open), "Save enables once a once-off row is staged");
assert(open.includes("suggested – confirm"), "the staged row is marked for the accountant");

const source = readFileSync("src/components/cash-forecast.tsx", "utf8");
const start = source.indexOf("const stageSuggestedOnceOffs");
const end = source.indexOf("const onceOffSaveBar");
const fn = source.slice(start, end);
assert(fn.includes("suggestOnceOffRows"), "Suggest reads bank history");
assert(!fn.includes("last_forecast_at") && !fn.includes("setLastForecastAt"), "Suggest does not move the forecast timestamp");
assert(source.includes("savedExpensesOnceOff.current = onceOffLines(nextExpenses)"), "Confirm keeps the once-off rows it writes");

console.log("cash-once-off-suggest ok");
