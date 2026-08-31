import { createContext, useContext } from "react";
import {
  emptyWeeklyInputs,
  type WeeklyInputs,
  type WeeklyRow,
} from "@/lib/weekly-inputs";

export type { WeeklyInputs, WeeklyRow };
export { DEFAULT_WEEKLY_ROW, emptyWeeklyInputs } from "@/lib/weekly-inputs";

export type FinancialInputsCtx = {
  weeklyInputs: WeeklyInputs;
  updateWeek: (weekKey: string, field: keyof WeeklyRow, value: number) => void;
};

export const FinancialInputsContext = createContext<FinancialInputsCtx>({
  weeklyInputs: emptyWeeklyInputs(),
  updateWeek: () => {},
});

export function useFinancialInputs() {
  return useContext(FinancialInputsContext);
}
