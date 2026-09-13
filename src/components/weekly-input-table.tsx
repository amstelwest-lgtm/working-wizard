import { CalendarDays } from "lucide-react";
import { useFinancialInputs, type WeeklyRow } from "@/contexts/financial-inputs";
import { useMarketFormat } from "@/contexts/market";
import { currencySymbol } from "@/lib/market";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
import { getISOWeekKey } from "@/lib/weekly-inputs";

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

const FIELDS: Array<{ key: keyof WeeklyRow; label: string; hint: string }> = [
  { key: "revenue", label: "Revenue", hint: "Total sales banked this week" },
  { key: "costOfSales", label: "Cost of Sales", hint: "Direct costs for goods / services sold" },
  { key: "fixedCosts", label: "Fixed Costs", hint: "Rent, salaries, recurring overheads" },
  {
    key: "cashMovements",
    label: "Cash Movements",
    hint: "Net cash in/out (excluding items above)",
  },
  { key: "interest", label: "Interest & Finance", hint: "Loan interest paid this period" },
  { key: "tax", label: "Income Tax", hint: "Tax provision for this period" },
];

export function WeeklyInputTable({ role = "owner" }: { role?: "owner" | "accountant" }) {
  const { weeklyInputs, updateWeek } = useFinancialInputs();
  const { market } = useMarketFormat();
  const cur = currencySymbol(market);
  const weeks = getRecentWeeks(4);
  const currentWeek = getISOWeekKey();
  const fields = FIELDS;

  return (
    <CollapsibleGoldCard
      icon={CalendarDays}
      title="Weekly Inputs"
      subtitle="Last 4 weeks · figures feed the Profitability Waterfall"
      defaultOpen={role === "accountant"}
    >
      <ScrollableTable cardRows hint={false}>
        <table className="milon-data-table w-full min-w-[520px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-amber-900/15 text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="min-w-[148px] py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider">
                Field
              </th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className={`px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider ${
                    w === currentWeek ? "text-[#b8860b] dark:text-[#d4a550]" : ""
                  }`}
                >
                  {w}
                  {w === currentWeek ? (
                    <span className="ml-1 text-[#b8860b] dark:text-[#d4a550]">★</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr
                key={field.key}
                className="border-b border-amber-900/10 last:border-0 dark:border-slate-800/50"
              >
                <td className="py-2.5 pr-4">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    {field.label}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{field.hint}</div>
                </td>
                {weeks.map((w) => {
                  const raw = weeklyInputs.weeks[w]?.[field.key] ?? 0;
                  return (
                    <td
                      key={w}
                      data-label={w}
                      className={`px-2 py-2 text-right ${
                        w === currentWeek ? "rounded bg-[#d4a550]/10" : ""
                      }`}
                    >
                      <div className="relative inline-flex items-center">
                        <span className="pointer-events-none absolute left-2 text-[10px] text-slate-500">
                          {cur}
                        </span>
                        <input
                          type="number"
                          value={raw === 0 ? "" : raw}
                          placeholder="0"
                          onChange={(e) =>
                            updateWeek(w, field.key, parseFloat(e.target.value) || 0)
                          }
                          className="w-24 rounded-md border border-amber-900/15 bg-white/70 py-1.5 pl-5 pr-2 text-right text-xs font-semibold text-slate-900 focus:border-[#d4a550] focus:outline-none [appearance:textfield] dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </CollapsibleGoldCard>
  );
}
