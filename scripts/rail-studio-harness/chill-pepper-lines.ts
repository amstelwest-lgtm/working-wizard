/**
 * Chill Pepper Boutique Hotel (79c4c485-9fa7-4499-9139-e1bb7cb40649)
 * as stored on the live book. Amounts are copied from that cashflow and
 * statement. Nothing here is estimated.
 */
export const chillFinancials = {
  revenue: 1_215_000,
  cogs: -56_000,
  ebit: 56_800,
  ebitda: 126_800,
  ebt: 37_000,
  netIncome: 27_010,
  laborCost: 426_000,
  fixedCosts: "",
  cash: null,
} as const;

const once = (name: string, amount: string) => ({
  name,
  amount,
  frequency: "once-off" as const,
  startWeek: 1,
});

const monthly = (name: string, amount: string, startWeek: number) => ({
  name,
  amount,
  frequency: "recurring-monthly" as const,
  startWeek,
});

export const chillCashflow = {
  openingBalance: "44480",
  startDate: "2026-05-30",
  seededFromBanksAt: "2026-08-24T20:07:05.368Z",
  suggestionConfirm: null,
  revenue: [
    monthly("Netcash", "36360", 3),
    once("Netcash", "5760"),
    monthly("Yoco", "2250", 5),
    once("D Pillay", "900"),
    once("L Ferreira", "900"),
    once("J Botha", "795"),
    once("M Adams", "795"),
    once("S Naidoo", "595"),
  ],
  expenses: [
    once("Greeff Properties", "28000"),
    once("Fuji SA", "9200"),
    once("R Dlamini", "6000"),
    once("B Petersen", "4500"),
    once("Sparkle Cleaning Services", "3500"),
    once("SARS", "3480"),
    monthly("City of Cape Town", "2947.5", 2),
    once("Meta Platforms Ireland", "2800"),
    once("Ledger & Co Accountants", "2500"),
    once("Santam Insurance", "2200"),
    once("Webafrica", "899"),
    once("Netcash", "748"),
    monthly("FNB", "458", 5),
    once("Dis-Chem", "392"),
  ],
  other: [once("T Mokoena", "25000"), once("FNB", "6800")],
};

/** The line list the earlier local harness actually rolled. */
export const chillHarnessPartial = {
  openingBalance: "44480",
  seededFromBanksAt: "2026-08-24T20:07:05.368Z",
  revenue: [once("D Pillay", "900")],
  expenses: [
    once("Greeff Properties", "28000"),
    once("Fuji SA", "9200"),
    once("R Dlamini", "6000"),
    once("B Petersen", "4500"),
    once("Dis-Chem", "392"),
    once("Santam", "2200"),
    monthly("City of Cape Town", "2947.5", 2),
  ],
  other: [once("T Mokoena", "25000")],
};
