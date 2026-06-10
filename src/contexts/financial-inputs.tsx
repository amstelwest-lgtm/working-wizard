import { createContext, useContext } from "react";

export type WeeklyRow = {
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  cashMovements: number;
  interest: number;
  tax: number;
};

export type WeeklyInputs = {
  weeks: Record<string, WeeklyRow>;
};

export const DEFAULT_WEEKLY_ROW: WeeklyRow = {
  revenue: 0,
  costOfSales: 0,
  fixedCosts: 0,
  cashMovements: 0,
  interest: 0,
  tax: 0,
};

export type FinancialInputsCtx = {
  weeklyInputs: WeeklyInputs;
  updateWeek: (weekKey: string, field: keyof WeeklyRow, value: number) => void;
};

export const FinancialInputsContext = createContext<FinancialInputsCtx>({
  weeklyInputs: { weeks: {} },
  updateWeek: () => {},
});

export function useFinancialInputs() {
  return useContext(FinancialInputsContext);
}
