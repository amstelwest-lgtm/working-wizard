/**
 * Once-off cash rows wait for Save. Run: pnpm test:cash-once-off-save
 */
import { readFileSync } from "node:fs";
import {
  linesForSilentSave,
  onceOffDirty,
  silentForecastKey,
} from "../src/lib/cash-once-off-save";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

type Line = { id: string; name: string; amount: string; frequency: string };

const saved = {
  revenue: [{ id: "r2", name: "Project receipts", amount: "55000", frequency: "once-off" }] as Line[],
  expenses: [
    { id: "e1", name: "Payroll", amount: "18000", frequency: "recurring-weekly" },
    { id: "e4", name: "VAT", amount: "160000", frequency: "once-off" },
  ] as Line[],
  other: [{ id: "o1", name: "Owner drawings", amount: "8000", frequency: "recurring-monthly" }] as Line[],
};

const base = {
  startDate: "2026-10-05",
  openingBalance: "186000",
  revenue: [
    { id: "r1", name: "Collections", amount: "36000", frequency: "recurring-weekly" },
    ...saved.revenue,
  ],
  expenses: saved.expenses,
  other: saved.other,
};

const unchanged = silentForecastKey({
  ...base,
  savedRevenue: saved.revenue,
  savedExpenses: saved.expenses.filter((line) => line.frequency === "once-off"),
  savedOther: [],
});

const editedOnceOff = silentForecastKey({
  ...base,
  expenses: saved.expenses.map((line) => (line.id === "e4" ? { ...line, amount: "150000" } : line)),
  savedRevenue: saved.revenue,
  savedExpenses: saved.expenses.filter((line) => line.frequency === "once-off"),
  savedOther: [],
});
assert(editedOnceOff === unchanged, "editing a once-off amount does not change the silent save");

const editedMonthly = silentForecastKey({
  ...base,
  expenses: saved.expenses.map((line) => (line.id === "e1" ? { ...line, amount: "19000" } : line)),
  savedRevenue: saved.revenue,
  savedExpenses: saved.expenses.filter((line) => line.frequency === "once-off"),
  savedOther: [],
});
assert(editedMonthly !== unchanged, "editing a recurring line still changes the silent save");

const savedVat = saved.expenses.filter((line) => line.frequency === "once-off");
const dropped = linesForSilentSave(
  saved.expenses.filter((line) => line.id !== "e4"),
  savedVat,
);
assert(dropped.some((line) => line.id === "e4" && line.amount === "160000"), "a deleted once-off stays until Save");
assert(
  linesForSilentSave(
    [...saved.expenses, { id: "e5", name: "Legal", amount: "9000", frequency: "once-off" }],
    savedVat,
  ).every((line) => line.id !== "e5"),
  "a new once-off row is left out of the silent save",
);
const retimed = linesForSilentSave(
  saved.expenses.map((line) => (line.id === "e4" ? { ...line, frequency: "recurring-monthly" } : line)),
  savedVat,
);
assert(
  retimed.find((line) => line.id === "e4")?.frequency === "once-off",
  "changing a once-off frequency waits for Save",
);
assert(onceOffDirty(saved.expenses, savedVat) === false, "stored once-off rows are not dirty");
assert(
  onceOffDirty(
    saved.expenses.map((line) => (line.id === "e4" ? { ...line, amount: "1" } : line)),
    savedVat,
  ),
  "a changed once-off amount is dirty",
);

const source = readFileSync("src/components/cash-forecast.tsx", "utf8");
assert(source.includes("Save once-off rows"), "the forecast has an explicit once-off save");
assert(source.includes('role="status"'), "save confirmation is a status message");
assert(source.includes("silentForecastKey"), "autosave compares the silent forecast");
assert(source.includes("Could not save:"), "a failed save names the error");
assert(!source.includes("xero.com") && !source.includes("intuit.com"), "once-off save does not post to a ledger");

console.log("cash-once-off-save ok");
