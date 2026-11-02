/**
 * One SARS form catalog. The gallery, the draft pipeline, and the database
 * allow-list all read this list. A new form is a new entry here, not a new
 * product. ZA chunk only.
 */
import { IRP6_FIELDS, IRP6_RULES_YEAR, type Irp6Field, type Irp6SourceKind } from "./irp6.ts";

export type TaxFormCode = "IRP5" | "EMP201" | "EMP501" | "IRP6" | "ITR14" | "VAT201" | "ITR12";

export type TaxFormStatus = "ready" | "soon";

export type TaxFormEntity = "company" | "individual" | "employer" | "vendor";

/** How a return is named on tax_form_drafts. */
export type TaxPeriodModel =
  | "yearly"
  | "twice-yearly"
  | "monthly"
  | "period-1-3"
  | "per-employee"
  | "tax-period";

export type TaxFieldSourceKind = Irp6SourceKind;

/** Where a field's figure is allowed to come from. A missing source stays blank. */
export type TaxFieldIntake =
  | { from: "books"; read: string }
  | { from: "client-record" }
  | { from: "accountant" }
  | { from: "worked" }
  | { from: "nil" }
  | { from: "checklist"; itemKey: string };

export type TaxFormField = {
  id: string;
  section: string;
  label: string;
  /** eFiling field name. Null when the line is a working eFiling does not ask for. */
  efiling: string | null;
  type: string;
  required: boolean | string;
  source: TaxFieldSourceKind;
  periods?: readonly number[];
  intake: TaxFieldIntake;
};

export type TaxFormDefinition = {
  code: TaxFormCode;
  label: string;
  name: string;
  frequency: string;
  status: TaxFormStatus;
  note?: string;
  entity: TaxFormEntity;
  periodModel: TaxPeriodModel;
  /** Signed-off rules vintage. Null until a rate table is confirmed for this form. */
  rulesYear: number | null;
  fields: readonly TaxFormField[];
  /** Send-checklist item keys this form reads. Field intake names the rest. */
  intakeItems: readonly string[];
};

export type TaxFormEntry = Pick<
  TaxFormDefinition,
  "code" | "label" | "name" | "frequency" | "status" | "note"
>;

export const TAX_FORM_STATUS_LABEL: Record<TaxFormStatus, string> = {
  ready: "Ready to prepare",
  soon: "Coming soon",
};

/**
 * Documents a finished individual send already asks for. ITR12 field filling
 * is a later phase; the catalog records the mapping now.
 */
export const ITR12_INTAKE_ITEMS = [
  "irp5",
  "it3b",
  "medical_aid_certificate",
  "ra_contribution_certificate",
  "travel_logbook",
  "practice_income_expenses",
] as const;

function irp6Intake(field: Irp6Field): TaxFieldIntake {
  if (field.id === "grossIncome") return { from: "books", read: "clients.financials gross income" };
  if (field.id === "profitBeforeTax")
    return { from: "books", read: "clients.financials profit before tax" };
  if (field.source === "books") return { from: "books", read: "clients.financials" };
  if (field.source === "client") return { from: "client-record" };
  if (field.source === "input") return { from: "accountant" };
  if (field.source === "nil") return { from: "nil" };
  return { from: "worked" };
}

function irp6Schema(): readonly TaxFormField[] {
  return IRP6_FIELDS.map((field) => ({
    id: field.id,
    section: field.section,
    label: field.label,
    efiling: field.efiling,
    type: field.type,
    required: field.required,
    source: field.source,
    periods: field.periods,
    intake: irp6Intake(field),
  }));
}

function soon(
  entry: Omit<TaxFormDefinition, "status" | "fields" | "rulesYear"> & {
    fields?: readonly TaxFormField[];
    rulesYear?: number | null;
    note?: string;
  },
): TaxFormDefinition {
  return {
    ...entry,
    status: "soon",
    rulesYear: entry.rulesYear ?? null,
    fields: entry.fields ?? [],
  };
}

export const TAX_FORM_REGISTRY: readonly TaxFormDefinition[] = [
  soon({
    code: "IRP5",
    label: "IRP5 / IT3(a)",
    name: "Employee tax certificate",
    frequency: "Yearly per employee, plus interim",
    entity: "employer",
    periodModel: "per-employee",
    intakeItems: [],
  }),
  soon({
    code: "EMP201",
    label: "EMP201",
    name: "Monthly PAYE, UIF and SDL return",
    frequency: "Monthly",
    entity: "employer",
    periodModel: "monthly",
    intakeItems: [],
  }),
  soon({
    code: "EMP501",
    label: "EMP501",
    name: "Employer reconciliation",
    frequency: "Twice a year",
    entity: "employer",
    periodModel: "twice-yearly",
    intakeItems: [],
  }),
  {
    code: "IRP6",
    label: "IRP6",
    name: "Provisional tax return (company)",
    frequency: "Twice a year, optional third top-up",
    status: "ready",
    entity: "company",
    periodModel: "period-1-3",
    rulesYear: IRP6_RULES_YEAR,
    fields: irp6Schema(),
    intakeItems: [],
  },
  soon({
    code: "ITR14",
    label: "ITR14",
    name: "Company income tax return",
    frequency: "Yearly",
    note: "The worksheet is under Tax workings.",
    entity: "company",
    periodModel: "yearly",
    intakeItems: [],
  }),
  soon({
    code: "VAT201",
    label: "VAT201",
    name: "VAT return",
    frequency: "Every 1–2 months",
    entity: "vendor",
    periodModel: "tax-period",
    intakeItems: [],
  }),
  soon({
    code: "ITR12",
    label: "ITR12",
    name: "Individual income tax return",
    frequency: "Yearly",
    entity: "individual",
    periodModel: "yearly",
    intakeItems: ITR12_INTAKE_ITEMS,
  }),
];

export function taxFormByCode(code: string): TaxFormDefinition | undefined {
  return TAX_FORM_REGISTRY.find((form) => form.code === code);
}

export function requireTaxForm(code: string): TaxFormDefinition {
  const form = taxFormByCode(code);
  if (!form) throw new Error(`Unknown tax form ${code}.`);
  return form;
}

/** Gallery rows, in catalog order. The page does not keep a second list. */
export const TAX_FORM_GALLERY: readonly TaxFormEntry[] = TAX_FORM_REGISTRY.map((form) => ({
  code: form.code,
  label: form.label,
  name: form.name,
  frequency: form.frequency,
  status: form.status,
  note: form.note,
}));
