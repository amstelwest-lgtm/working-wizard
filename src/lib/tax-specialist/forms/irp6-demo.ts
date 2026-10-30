/**
 * Demo client for the IRP6 sheet: the harness screens, the PDF text snapshot,
 * and the download check. Not shown to real clients.
 */
import type { Irp6Client, Irp6Inputs } from "./irp6.ts";

export const IRP6_DEMO_CLIENT: Irp6Client = {
  name: "Harbour & Co (Pty) Ltd",
  fyStartMonth: 3,
  financials: {
    revenue: "3850000",
    ebt: "700000",
    periodStart: "2026-03-01",
    periodEnd: "2026-09-30",
  },
  financialsAsOf: "2026-10-01T08:00:00.000Z",
};

export const IRP6_DEMO_TODAY = "2026-10-29";

/** What the accountant types on the demo: the missing fields and two adjustments. */
export const IRP6_DEMO_INPUTS: Irp6Inputs = {
  taxReference: "9123456789",
  profitBeforeTaxCents: null,
  adjustments: [
    {
      id: "fines",
      description: "Traffic fines, not deductible",
      amountCents: 5_000_000,
      direction: "add",
    },
    {
      id: "wear",
      description: "Wear-and-tear allowance over depreciation",
      amountCents: 25_000_000,
      direction: "deduct",
    },
  ],
  estimateOverrideCents: null,
  basicAmountCents: 95_000_000,
  employeesTaxCents: 0,
  provisionalPaidCents: 13_500_000,
};
