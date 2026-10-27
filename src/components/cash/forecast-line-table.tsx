import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  forecastLineRule,
  forecastRuleLabel,
  isAssumedMonthlyLine,
} from "@/lib/cash-forecast-rows";

export type ForecastTableFrequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months";

export type ForecastTableLine = {
  id: string;
  name: string;
  amount: string;
  frequency: ForecastTableFrequency;
  startWeek: number;
  splitCount: number;
};

export type ForecastTableSide = "revenue" | "expenses" | "other";

export const FORECAST_TABLE_FREQUENCY: Record<ForecastTableFrequency, string> = {
  "recurring-weekly": "Weekly",
  "recurring-monthly": "Monthly",
  "once-off": "Once-off",
  "split-weeks": "Split over weeks",
  "split-months": "Split over months",
};

const GROUPS: { side: ForecastTableSide; label: string; addLabel: string | null }[] = [
  { side: "revenue", label: "Money in", addLabel: "Add money-in line" },
  { side: "expenses", label: "Main expenses", addLabel: null },
  { side: "other", label: "Other expenses", addLabel: "Add expense line" },
];

/** Main expenses are the fixed presets; money-in and other keep at least one row. */
export function forecastLineRemovable(side: ForecastTableSide, count: number): boolean {
  if (side === "expenses") return false;
  return count > 1;
}

export function ForecastLineTable<T extends ForecastTableLine>({
  revenue,
  expenses,
  other,
  currency,
  weeks,
  singleMonth = false,
  stagedIds,
  toolbar,
  onChange,
  onRemove,
  onAdd,
}: {
  revenue: readonly T[];
  expenses: readonly T[];
  other: readonly T[];
  currency: string;
  weeks: number;
  singleMonth?: boolean;
  /** Suggested once-offs not saved yet. Highlighted until Save. */
  stagedIds?: ReadonlySet<string>;
  toolbar?: ReactNode;
  onChange: (side: ForecastTableSide, index: number, line: T) => void;
  onRemove: (side: ForecastTableSide, index: number) => void;
  onAdd: (side: ForecastTableSide) => void;
}) {
  const lists: Record<ForecastTableSide, readonly T[]> = { revenue, expenses, other };
  return (
    <div className="forecast-lines" data-forecast-line-table="">
      {toolbar ? <div className="forecast-lines__toolbar">{toolbar}</div> : null}
      <div className="forecast-lines__scroll">
        <table className="forecast-lines__table">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="forecast-lines__num">
                Amount ({currency})
              </th>
              <th scope="col">Frequency</th>
              <th scope="col" className="forecast-lines__num">
                Start week
              </th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          {GROUPS.map(({ side, label, addLabel }) => {
            const list = lists[side];
            const tone = side === "revenue" ? "in" : "out";
            return (
              <tbody key={side} data-forecast-group={side} data-tone={tone}>
                <tr className="forecast-lines__group">
                  <th scope="rowgroup" colSpan={5}>
                    {label}
                  </th>
                </tr>
                {list.map((line, index) => {
                  const split =
                    line.frequency === "split-weeks" || line.frequency === "split-months";
                  const rule = forecastLineRule(line.name, line.frequency, { side, singleMonth });
                  const ruleLabel = forecastRuleLabel(rule);
                  const assumed = isAssumedMonthlyLine(line.name, line.frequency, {
                    side,
                    singleMonth,
                  });
                  const removable = forecastLineRemovable(side, list.length);
                  const rowLabel = line.name.trim() || "Unnamed line";
                  return (
                    <tr
                      key={line.id}
                      className="forecast-lines__row"
                      data-forecast-line={line.id}
                      data-staged={stagedIds?.has(line.id) ? "" : undefined}
                    >
                      <td data-label="Description">
                        <input
                          className="forecast-lines__input"
                          value={line.name}
                          aria-label="Description"
                          onChange={(e) => onChange(side, index, { ...line, name: e.target.value })}
                        />
                      </td>
                      <td data-label={`Amount (${currency})`} className="forecast-lines__num">
                        <input
                          className="forecast-lines__input forecast-lines__input--num"
                          type="number"
                          inputMode="decimal"
                          value={line.amount}
                          aria-label={`Amount for ${rowLabel}`}
                          onChange={(e) =>
                            onChange(side, index, { ...line, amount: e.target.value })
                          }
                        />
                      </td>
                      <td
                        data-label="Frequency"
                        title={ruleLabel || undefined}
                        data-forecast-rule={rule}
                        data-assumed-monthly={assumed ? "" : undefined}
                      >
                        <div className="forecast-lines__freq">
                          <select
                            className="forecast-lines__input"
                            value={line.frequency}
                            aria-label={`Frequency for ${rowLabel}`}
                            onChange={(e) =>
                              onChange(side, index, {
                                ...line,
                                frequency: e.target.value as ForecastTableFrequency,
                              })
                            }
                          >
                            {(
                              Object.keys(FORECAST_TABLE_FREQUENCY) as ForecastTableFrequency[]
                            ).map((key) => (
                              <option key={key} value={key}>
                                {FORECAST_TABLE_FREQUENCY[key]}
                              </option>
                            ))}
                          </select>
                          {split ? (
                            <input
                              className="forecast-lines__input forecast-lines__input--count"
                              type="number"
                              min={1}
                              value={line.splitCount}
                              aria-label={
                                line.frequency === "split-weeks"
                                  ? "Number of weeks"
                                  : "Number of months"
                              }
                              title={line.frequency === "split-weeks" ? "# weeks" : "# months"}
                              onChange={(e) =>
                                onChange(side, index, {
                                  ...line,
                                  splitCount: parseInt(e.target.value) || 1,
                                })
                              }
                            />
                          ) : null}
                        </div>
                      </td>
                      <td data-label="Start week" className="forecast-lines__num">
                        <input
                          className="forecast-lines__input forecast-lines__input--week"
                          type="number"
                          min={1}
                          max={weeks}
                          value={line.startWeek}
                          aria-label={`Start week for ${rowLabel}`}
                          onChange={(e) =>
                            onChange(side, index, {
                              ...line,
                              startWeek: parseInt(e.target.value) || 1,
                            })
                          }
                        />
                      </td>
                      <td className="forecast-lines__remove-cell">
                        {removable ? (
                          <button
                            type="button"
                            className="forecast-lines__remove"
                            aria-label={`Remove ${rowLabel}`}
                            title="Remove"
                            onClick={() => onRemove(side, index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {addLabel ? (
                  <tr className="forecast-lines__add-row">
                    <td colSpan={5}>
                      <button
                        type="button"
                        className="forecast-lines__add"
                        data-tone={tone}
                        onClick={() => onAdd(side)}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {addLabel}
                      </button>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
