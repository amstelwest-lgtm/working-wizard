/**
 * SARS form gallery on the Tax Specialist page. ZA chunk only: import this
 * from the lazily loaded page, never from US-reachable code.
 */
export type TaxFormCode = "IRP5" | "EMP201" | "EMP501" | "IRP6" | "ITR14" | "VAT201" | "ITR12";

export type TaxFormStatus = "ready" | "soon";

export type TaxFormEntry = {
  code: TaxFormCode;
  label: string;
  name: string;
  frequency: string;
  status: TaxFormStatus;
  note?: string;
};

export const TAX_FORM_STATUS_LABEL: Record<TaxFormStatus, string> = {
  ready: "Ready to prepare",
  soon: "Coming soon",
};

export const TAX_FORM_GALLERY: readonly TaxFormEntry[] = [
  {
    code: "IRP5",
    label: "IRP5 / IT3(a)",
    name: "Employee tax certificate",
    frequency: "Yearly per employee, plus interim",
    status: "soon",
  },
  {
    code: "EMP201",
    label: "EMP201",
    name: "Monthly PAYE, UIF and SDL return",
    frequency: "Monthly",
    status: "soon",
  },
  {
    code: "EMP501",
    label: "EMP501",
    name: "Employer reconciliation",
    frequency: "Twice a year",
    status: "soon",
  },
  {
    code: "IRP6",
    label: "IRP6",
    name: "Provisional tax return (company)",
    frequency: "Twice a year, optional third top-up",
    status: "ready",
  },
  {
    code: "ITR14",
    label: "ITR14",
    name: "Company income tax return",
    frequency: "Yearly",
    status: "soon",
    note: "The worksheet is under Tax workings.",
  },
  {
    code: "VAT201",
    label: "VAT201",
    name: "VAT return",
    frequency: "Every 1–2 months",
    status: "soon",
  },
  {
    code: "ITR12",
    label: "ITR12",
    name: "Individual income tax return",
    frequency: "Yearly",
    status: "soon",
  },
];
