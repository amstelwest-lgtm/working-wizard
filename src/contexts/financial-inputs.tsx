import { createContext, useContext } from "react";
import {
  emptyWeeklyInputs,
  type WeeklyInputs,
  type WeeklyRow,
} from "@/lib/weekly-inputs";
import { emptyProductMix, type ProductMix } from "@/lib/product-mix";

export type { WeeklyInputs, WeeklyRow, ProductMix };
export { DEFAULT_WEEKLY_ROW, emptyWeeklyInputs } from "@/lib/weekly-inputs";
export { emptyProductMix } from "@/lib/product-mix";

export type FinancialInputsCtx = {
  weeklyInputs: WeeklyInputs;
  updateWeek: (weekKey: string, field: keyof WeeklyRow, value: number) => void;
  productMix: ProductMix;
  saveProductMix: (mix: ProductMix) => void;
};

export const FinancialInputsContext = createContext<FinancialInputsCtx>({
  weeklyInputs: emptyWeeklyInputs(),
  updateWeek: () => {},
  productMix: emptyProductMix(),
  saveProductMix: () => {},
});

export function useFinancialInputs() {
  return useContext(FinancialInputsContext);
}
