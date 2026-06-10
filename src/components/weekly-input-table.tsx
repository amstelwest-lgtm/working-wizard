import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useFinancialInputs, type WeeklyRow } from "@/contexts/financial-inputs";

function getISOWeekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((d.getTime() - jan4.getTime()) / 86400000 -
        3 +
        ((jan4.getDay() + 6) % 7)) /
        7,
    );
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getRecentWeeks(n = 4): string[] {
  const weeks: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(getISOWeekKey(d));
  }
  return weeks;
}

const OWNER_FIELDS: Array<{ key: keyof WeeklyRow; label: string; hint: string }> = [
  { key: "revenue",       label: "Revenue",        hint: "Total sales banked this week" },
  { key: "costOfSales",   label: "Cost of Sales",  hint: "Direct costs for goods / services sold" },
  { key: "fixedCosts",    label: "Fixed Costs",    hint: "Rent, salaries, recurring overheads" },
  { key: "cashMovements", label: "Cash Movements", hint: "Net cash in/out (excluding items above)" },
];

const ACCOUNTANT_EXTRA: Array<{ key: keyof WeeklyRow; label: string; hint: string }> = [
  { key: "interest", label: "Interest & Finance", hint: "Loan interest paid this period" },
  { key: "tax",      label: "Income Tax",         hint: "Tax provision for this period" },
];

export function WeeklyInputTable({ role = "owner" }: { role?: "owner" | "accountant" }) {
  const { weeklyInputs, updateWeek } = useFinancialInputs();
  const [open, setOpen] = useState(false);
  const weeks = getRecentWeeks(4);
  const currentWeek = getISOWeekKey();
  const fields = role === "accountant" ? [...OWNER_FIELDS, ...ACCOUNTANT_EXTRA] : OWNER_FIELDS;

  return (
    <Card className="border border-slate-800 bg-slate-900/60 shadow-sm print:hidden">
      <CardHeader
        className="border-b border-slate-800 pb-3 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-100">
              Weekly Inputs
            </CardTitle>
            <CardDescription className="text-xs text-slate-400 mt-0.5">
              {open
                ? "Last 4 weeks · current week highlighted · figures feed the Profitability Waterfall"
                : "Enter weekly revenue, costs and cash figures to power the waterfall"}
            </CardDescription>
          </div>
          <span className="text-[#d4a550] p-1 shrink-0">
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-4 pb-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 min-w-[148px]">
                  Field
                </th>
                {weeks.map((w) => (
                  <th
                    key={w}
                    className={`px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider ${
                      w === currentWeek ? "text-[#d4a550]" : "text-slate-500"
                    }`}
                  >
                    {w}
                    {w === currentWeek && (
                      <span className="ml-1 text-[#d4a550]">★</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr
                  key={field.key}
                  className="border-b border-slate-800/50 last:border-0"
                >
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold text-slate-200">
                      {field.label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {field.hint}
                    </div>
                  </td>
                  {weeks.map((w) => {
                    const raw = weeklyInputs.weeks[w]?.[field.key] ?? 0;
                    return (
                      <td
                        key={w}
                        className={`px-2 py-2 text-right ${
                          w === currentWeek ? "rounded bg-[#d4a550]/5" : ""
                        }`}
                      >
                        <div className="relative inline-flex items-center">
                          <span className="pointer-events-none absolute left-2 text-[10px] text-slate-500">
                            R
                          </span>
                          <input
                            type="number"
                            value={raw === 0 ? "" : raw}
                            placeholder="0"
                            onChange={(e) =>
                              updateWeek(
                                w,
                                field.key,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-24 rounded-md border border-slate-700 bg-slate-800/60 py-1.5 pl-5 pr-2 text-right text-xs font-semibold text-slate-100 focus:border-[#d4a550] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {role === "accountant" && (
            <p className="mt-3 border-t border-slate-800 pt-2.5 text-[10px] text-[#d4a550]/70">
              ✦ Interest &amp; Tax fields are visible to accountants only — they flow into the Profitability Waterfall.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
