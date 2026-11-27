/**
 * ITR12 preparation sheet. Same review pattern as IRP6: sections, sources,
 * accountant approval, then a PDF and CSV capture sheet.
 * The owner cannot approve. Nothing is emailed and nothing is filed.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TAX_FORM_DRAFT_STATUS_LABEL,
  currentApprover,
  draftDayLabel,
  type TaxFormDraft,
  type TaxFormDraftStatus,
} from "@/lib/tax-specialist/forms/drafts";
import { parseRandsToCents, validTaxReference } from "@/lib/tax-specialist/forms/irp6";
import { formatSampleCents } from "@/lib/tax-specialist/sample-compute";
import {
  ITR12_FOOTER,
  ITR12_SECTIONS,
  computeItr12,
  emptyItr12Inputs,
  findItr12Draft,
  itr12ApproveBlock,
  itr12CanDownload,
  itr12Csv,
  itr12DraftFields,
  itr12FieldSources,
  itr12FileName,
  itr12InputsFromDraft,
  itr12MissingSentence,
  itr12MoneyField,
  itr12YearChoices,
  itr12YearOfAssessment,
  type Itr12ApproverRole,
  type Itr12Cited,
  type Itr12Inputs,
  type Itr12MoneyFieldId,
  type Itr12SectionId,
  type Itr12Sheet,
  type Itr12SheetLine,
} from "@/lib/tax-specialist/forms/itr12";
import {
  type Itr12BusinessDeduction,
  type Itr12BusinessInput,
  type Itr12HomeOffice,
  type Itr12RentalProperty,
  type Itr12WearDraft,
  markItr12BusinessNil,
  markItr12RentalNil,
  undoItr12BusinessNil,
  undoItr12RentalNil,
} from "@/lib/tax-specialist/forms/itr12-schedules";
import { assetFieldIssue } from "@/lib/tax-specialist/forms/itr14-allowances";
import { NIL_CONFIRMED_NOTE } from "@/lib/tax-specialist/forms/nil-mark";
import { saveCatalogDraft } from "@/lib/tax-specialist/forms/pipeline";
import { AssetDateInput } from "./asset-date-input";
import { NilBlanksControl } from "./za-nil-blanks-control";
import { CgtSection } from "./za-cgt-section";
import "./za-irp6-sheet.css";

type Approvals = Partial<Record<Itr12SectionId, boolean>>;

function scheduleCents(cents: number | null): string {
  return cents == null ? "Blank" : formatSampleCents(cents);
}

const BLANK_SCHEDULE = "A blank schedule is not zero";

function rowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyBusiness(): Itr12BusinessInput {
  return {
    grossIncomeCents: null,
    deductions: [],
    homeOffice: null,
    assets: [],
    wearAndTearCents: null,
    ringFenceS20A: null,
  };
}

function emptyProperty(id: string): Itr12RentalProperty {
  return {
    id,
    description: "",
    rentReceivedCents: null,
    ratesCents: null,
    interestCents: null,
    insuranceCents: null,
    repairsCents: null,
    leviesCents: null,
    agentFeesCents: null,
    wearAndTearCents: null,
    assets: [],
    privateUsePercent: null,
  };
}

function emptyAsset(id: string): Itr12WearDraft {
  return {
    id,
    description: "",
    costCents: null,
    broughtIntoUse: "",
    category: "",
    section: "s11e",
    privateUsePercent: null,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: null,
  };
}

/** Local text until blur, so a parent render cannot append the same digits twice. */
function BlurAmount({
  id,
  value,
  label,
  disabled,
  entry,
  onCommit,
}: {
  id: string;
  value: number | null;
  label: string;
  disabled: boolean;
  entry: string;
  onCommit: (cents: number | null) => void;
}) {
  const [text, setText] = useState(centsText(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(centsText(value));
  }, [value]);
  return (
    <span className="irp6-amount">
      <span aria-hidden="true">R</span>
      <input
        id={id}
        className="irp6-input irp6-input--num"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad || undefined}
        disabled={disabled}
        value={text}
        placeholder="Blank"
        data-itr12-entry={entry}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
        onBlur={() => {
          focused.current = false;
          if (!text.trim()) {
            setBad(false);
            setText("");
            if (value != null) onCommit(null);
            return;
          }
          const cents = parseRandsToCents(text);
          if (cents == null || cents < 0) {
            setBad(true);
            return;
          }
          setBad(false);
          setText(centsText(cents));
          if (cents !== value) onCommit(cents);
        }}
      />
    </span>
  );
}

function BlurText({
  id,
  value,
  label,
  disabled,
  entry,
  onCommit,
}: {
  id: string;
  value: string;
  label: string;
  disabled: boolean;
  entry: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      id={id}
      className="irp6-input"
      aria-label={label}
      disabled={disabled}
      value={text}
      placeholder="Blank"
      data-itr12-entry={entry}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        focused.current = false;
        const next = text.trim();
        setText(next);
        if (next !== value.trim()) onCommit(next);
      }}
    />
  );
}

function MarkSelect({
  id,
  value,
  label,
  disabled,
  entry,
  onCommit,
}: {
  id: string;
  value: boolean | null;
  label: string;
  disabled: boolean;
  entry: string;
  onCommit: (value: boolean | null) => void;
}) {
  return (
    <select
      id={id}
      className="irp6-input"
      aria-label={label}
      disabled={disabled}
      value={value == null ? "" : value ? "yes" : "no"}
      data-itr12-entry={entry}
      onChange={(event) => {
        const next = event.target.value;
        onCommit(next === "yes" ? true : next === "no" ? false : null);
      }}
    >
      <option value="">Blank</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}

function LocalSchedules({
  inputs,
  sheet,
  locked,
  onChange,
}: {
  inputs: Itr12Inputs;
  sheet: Itr12Sheet;
  locked: boolean;
  onChange: (next: Itr12Inputs) => void;
}) {
  const business = inputs.business ?? null;
  const properties = inputs.rentals ?? [];
  const worked = sheet.business;
  const rentals = sheet.rentals;

  const saveBusiness = (next: Itr12BusinessInput) => {
    const started =
      next.grossIncomeCents != null ||
      next.deductions.length > 0 ||
      next.assets.length > 0 ||
      next.wearAndTearCents != null ||
      next.ringFenceS20A != null ||
      next.homeOffice != null;
    onChange({ ...inputs, business: started ? next : null });
  };
  const patchBusiness = (patch: (current: Itr12BusinessInput) => Itr12BusinessInput) => {
    saveBusiness(patch(business ?? emptyBusiness()));
  };
  const patchHome = (patch: (current: Itr12HomeOffice) => Itr12HomeOffice) => {
    patchBusiness((current) => {
      const home = patch(
        current.homeOffice ?? {
          amountCents: null,
          specificallyEquipped: null,
          regularlyAndExclusivelyUsed: null,
        },
      );
      const started =
        home.amountCents != null ||
        home.specificallyEquipped != null ||
        home.regularlyAndExclusivelyUsed != null;
      return { ...current, homeOffice: started ? home : null };
    });
  };

  const saveRentals = (next: readonly Itr12RentalProperty[]) => {
    onChange({ ...inputs, rentals: next.length > 0 ? next : [] });
  };
  const patchProperty = (
    id: string,
    patch: (property: Itr12RentalProperty) => Itr12RentalProperty,
  ) => {
    saveRentals(properties.map((property) => (property.id === id ? patch(property) : property)));
  };

  const businessLines = [
    ["Gross income", worked?.grossIncomeCents ?? null],
    ["Wear-and-tear", worked?.wearAndTearCents ?? null],
    ["Net profit or loss", worked?.netProfitCents ?? null],
  ] as const;

  return (
    <>
      <section className="irp6-section" data-itr12-business={worked ? "filled" : "blank"}>
        <h3 className="irp6-section-title">Local business, trade, or profession</h3>
        {worked ? null : <p className="irp6-note">{BLANK_SCHEDULE}</p>}
        {businessLines.map(([label, cents]) => (
          <p key={label} className="irp6-note" data-itr12-blank-line={label}>
            {label}: {scheduleCents(cents)}
          </p>
        ))}
        <BlurAmount
          id="itr12-business-gross"
          entry="business-gross"
          label="Gross income"
          disabled={locked}
          value={business?.grossIncomeCents ?? null}
          onCommit={(cents) =>
            patchBusiness((current) => ({ ...current, grossIncomeCents: cents }))
          }
        />
        {business?.deductions.map((row) => (
          <div key={row.id} data-itr12-deduction={row.id}>
            <BlurText
              id={`itr12-deduction-label-${row.id}`}
              entry="deduction-label"
              label="Deduction description"
              disabled={locked}
              value={row.label}
              onCommit={(label) =>
                patchBusiness((current) => ({
                  ...current,
                  deductions: current.deductions.map((item) =>
                    item.id === row.id ? { ...item, label } : item,
                  ),
                }))
              }
            />
            <BlurAmount
              id={`itr12-deduction-amount-${row.id}`}
              entry="deduction-amount"
              label="Deduction amount"
              disabled={locked}
              value={row.amountCents}
              onCommit={(cents) =>
                patchBusiness((current) => ({
                  ...current,
                  deductions: current.deductions.map((item) =>
                    item.id === row.id ? { ...item, amountCents: cents } : item,
                  ),
                }))
              }
            />
            {locked ? null : (
              <button
                type="button"
                className="irp6-back"
                onClick={() =>
                  patchBusiness((current) => ({
                    ...current,
                    deductions: current.deductions.filter((item) => item.id !== row.id),
                  }))
                }
              >
                Remove deduction
              </button>
            )}
          </div>
        ))}
        {business?.deductions.length ? null : (
          <p className="irp6-note" data-itr12-blank-line="Deductions">
            Deductions: Blank
          </p>
        )}
        {locked ? null : (
          <button
            type="button"
            className="irp6-back"
            data-itr12-deduction-add="true"
            onClick={() =>
              patchBusiness((current) => ({
                ...current,
                deductions: [
                  ...current.deductions,
                  {
                    id: rowId("deduction"),
                    label: "",
                    amountCents: null,
                  } satisfies Itr12BusinessDeduction,
                ],
              }))
            }
          >
            Add a deduction
          </button>
        )}
        <p className="irp6-note">
          Home office. Both s23(b) marks must be yes before the amount is deducted.
        </p>
        <BlurAmount
          id="itr12-home-amount"
          entry="home-amount"
          label="Home office amount"
          disabled={locked}
          value={business?.homeOffice?.amountCents ?? null}
          onCommit={(cents) => patchHome((home) => ({ ...home, amountCents: cents }))}
        />
        <MarkSelect
          id="itr12-home-equipped"
          entry="home-equipped"
          label="Specifically equipped for the trade"
          disabled={locked}
          value={business?.homeOffice?.specificallyEquipped ?? null}
          onCommit={(specificallyEquipped) =>
            patchHome((home) => ({ ...home, specificallyEquipped }))
          }
        />
        <MarkSelect
          id="itr12-home-exclusive"
          entry="home-exclusive"
          label="Regularly and exclusively used for the trade"
          disabled={locked}
          value={business?.homeOffice?.regularlyAndExclusivelyUsed ?? null}
          onCommit={(regularlyAndExclusivelyUsed) =>
            patchHome((home) => ({ ...home, regularlyAndExclusivelyUsed }))
          }
        />
        <MarkSelect
          id="itr12-s20a"
          entry="s20a"
          label="s20A ring-fence"
          disabled={locked}
          value={business?.ringFenceS20A ?? null}
          onCommit={(ringFenceS20A) => patchBusiness((current) => ({ ...current, ringFenceS20A }))}
        />
        <p className="irp6-note">s20A is an indicator only. Not signed off as a calculation.</p>
        {business?.assets.length ? null : (
          <p className="irp6-note" data-itr12-blank-line="Wear-and-tear assets">
            Wear-and-tear assets: Blank
          </p>
        )}
        {business?.assets.map((asset, index) => {
          const issue = assetFieldIssue(asset);
          const issueOn = (field: string) => (issue?.field === field ? issue.message : "");
          return (
            <fieldset key={asset.id} data-itr12-asset={asset.id} data-asset-row={asset.id}>
              <legend>Asset {index + 1}</legend>
              <label>
                Description
                <BlurText
                  id={`itr12-asset-description-${asset.id}`}
                  entry="asset-description"
                  label="Description"
                  disabled={locked}
                  value={asset.description}
                  onCommit={(description) =>
                    patchBusiness((current) => ({
                      ...current,
                      assets: current.assets.map((item) =>
                        item.id === asset.id ? { ...item, description } : item,
                      ),
                    }))
                  }
                />
                {issueOn("description") ? (
                  <span className="irp6-field-error" data-asset-field-issue="description">
                    {issueOn("description")}
                  </span>
                ) : null}
              </label>
              <label>
                Cost
                <BlurAmount
                  id={`itr12-asset-cost-${asset.id}`}
                  entry="asset-cost"
                  label="Cost"
                  disabled={locked}
                  value={asset.costCents}
                  onCommit={(costCents) =>
                    patchBusiness((current) => ({
                      ...current,
                      assets: current.assets.map((item) =>
                        item.id === asset.id ? { ...item, costCents } : item,
                      ),
                    }))
                  }
                />
                {issueOn("cost") ? (
                  <span className="irp6-field-error" data-asset-field-issue="cost">
                    {issueOn("cost")}
                  </span>
                ) : null}
              </label>
              <AssetDateInput
                id={`itr12-asset-date-${asset.id}`}
                label="Date brought into use"
                disabled={locked}
                value={asset.broughtIntoUse}
                issue={issueOn("date")}
                onCommit={(iso) =>
                  patchBusiness((current) => ({
                    ...current,
                    assets: current.assets.map((item) =>
                      item.id === asset.id ? { ...item, broughtIntoUse: iso } : item,
                    ),
                  }))
                }
              />
              <label>
                Category
                <BlurText
                  id={`itr12-asset-category-${asset.id}`}
                  entry="asset-category"
                  label="Category"
                  disabled={locked}
                  value={asset.category}
                  onCommit={(category) =>
                    patchBusiness((current) => ({
                      ...current,
                      assets: current.assets.map((item) =>
                        item.id === asset.id ? { ...item, category } : item,
                      ),
                    }))
                  }
                />
                {issueOn("category") ? (
                  <span className="irp6-field-error" data-asset-field-issue="category">
                    {issueOn("category")}
                  </span>
                ) : null}
              </label>
              <label>
                Section
                <select
                  id={`itr12-asset-section-${asset.id}`}
                  className="irp6-input"
                  aria-label="Section"
                  disabled={locked}
                  value={asset.section}
                  data-itr12-entry="asset-section"
                  onChange={(event) =>
                    patchBusiness((current) => ({
                      ...current,
                      assets: current.assets.map((item) =>
                        item.id === asset.id
                          ? { ...item, section: event.target.value === "s12c" ? "s12c" : "s11e" }
                          : item,
                      ),
                    }))
                  }
                >
                  <option value="s11e">s11(e)</option>
                  <option value="s12c">s12C </option>
                </select>
                {issueOn("section") ? (
                  <span className="irp6-field-error" data-asset-field-issue="section">
                    {issueOn("section")}
                  </span>
                ) : null}
              </label>
              <label>
                Private use %
                <BlurText
                  id={`itr12-asset-private-${asset.id}`}
                  entry="asset-private-use"
                  label="Private use %"
                  disabled={locked}
                  value={asset.privateUsePercent == null ? "" : String(asset.privateUsePercent)}
                  onCommit={(text) => {
                    const percent =
                      text === "" ? null : /^\d{1,3}$/.test(text) ? Number(text) : null;
                    if (text !== "" && (percent == null || percent > 100)) return;
                    patchBusiness((current) => ({
                      ...current,
                      assets: current.assets.map((item) =>
                        item.id === asset.id ? { ...item, privateUsePercent: percent } : item,
                      ),
                    }));
                  }}
                />
                {issueOn("private") ? (
                  <span className="irp6-field-error" data-asset-field-issue="private">
                    {issueOn("private")}
                  </span>
                ) : null}
              </label>
              {locked ? null : (
                <button
                  type="button"
                  className="irp6-back"
                  onClick={() =>
                    patchBusiness((current) => ({
                      ...current,
                      assets: current.assets.filter((item) => item.id !== asset.id),
                    }))
                  }
                >
                  Remove asset
                </button>
              )}
            </fieldset>
          );
        })}
        {locked ? null : (
          <button
            type="button"
            className="irp6-back"
            data-itr12-asset-add="true"
            onClick={() =>
              patchBusiness((current) => ({
                ...current,
                assets: [...current.assets, emptyAsset(rowId("asset"))],
              }))
            }
          >
            Add a wear-and-tear asset
          </button>
        )}
        <NilBlanksControl
          target="itr12-business"
          active={business?.nilMark != null}
          locked={locked}
          onMark={() => onChange({ ...inputs, business: markItr12BusinessNil(business) })}
          onUndo={() => saveBusiness(undoItr12BusinessNil(business ?? emptyBusiness()))}
        />
        {worked?.notes
          .filter((note) => note !== NIL_CONFIRMED_NOTE)
          .map((note) => (
            <p key={note} className="irp6-note">
              {note}
            </p>
          ))}
      </section>
      <section className="irp6-section" data-itr12-rental={rentals ? "filled" : "blank"}>
        <h3 className="irp6-section-title">Local rental income</h3>
        {rentals ? null : <p className="irp6-note">{BLANK_SCHEDULE}</p>}
        {properties.length === 0 ? (
          <>
            {(
              [
                "Rent received",
                "Rates",
                "Interest",
                "Insurance",
                "Repairs",
                "Levies",
                "Agent fees",
                "Wear-and-tear",
                "Private use",
                "Net rental",
              ] as const
            ).map((label) => (
              <p key={label} className="irp6-note" data-itr12-blank-line={label}>
                {label}: Blank
              </p>
            ))}
          </>
        ) : null}
        {properties.map((property) => {
          const workedProperty = rentals?.properties.find((row) => row.id === property.id);
          const fields = [
            ["rentReceivedCents", "Rent received", "rent"],
            ["ratesCents", "Rates", "rates"],
            ["interestCents", "Interest", "interest"],
            ["insuranceCents", "Insurance", "insurance"],
            ["repairsCents", "Repairs", "repairs"],
            ["leviesCents", "Levies", "levies"],
            ["agentFeesCents", "Agent fees", "agent-fees"],
            ["wearAndTearCents", "Wear-and-tear", "rental-wear"],
          ] as const;
          return (
            <div key={property.id} data-itr12-property={property.id}>
              <BlurText
                id={`itr12-property-name-${property.id}`}
                entry="property-name"
                label="Property description"
                disabled={locked}
                value={property.description}
                onCommit={(description) =>
                  patchProperty(property.id, (current) => ({ ...current, description }))
                }
              />
              {fields.map(([key, label, entry]) => (
                <span key={key}>
                  <span className="irp6-note">
                    {label}: {scheduleCents(property[key])}
                  </span>
                  <BlurAmount
                    id={`itr12-${entry}-${property.id}`}
                    entry={entry}
                    label={label}
                    disabled={locked}
                    value={property[key]}
                    onCommit={(cents) =>
                      patchProperty(property.id, (current) => ({ ...current, [key]: cents }))
                    }
                  />
                  {workedProperty?.gaps
                    .filter((gap) => gap.field === key)
                    .map((gap) => (
                      <span key={gap.field} className="irp6-field-error" data-itr12-gap={gap.field}>
                        {gap.prompt}
                      </span>
                    ))}
                </span>
              ))}
              <span className="irp6-note">
                Private use:{" "}
                {property.privateUsePercent == null ? "Blank" : `${property.privateUsePercent}%`}
              </span>
              <BlurText
                id={`itr12-private-use-${property.id}`}
                entry="private-use"
                label="Private use percent"
                disabled={locked}
                value={property.privateUsePercent == null ? "" : String(property.privateUsePercent)}
                onCommit={(text) => {
                  if (!text) {
                    patchProperty(property.id, (current) => ({
                      ...current,
                      privateUsePercent: null,
                    }));
                    return;
                  }
                  if (!/^\d{1,3}$/.test(text)) return;
                  const percent = Number(text);
                  if (percent > 100) return;
                  patchProperty(property.id, (current) => ({
                    ...current,
                    privateUsePercent: percent,
                  }));
                }}
              />
              {workedProperty?.gaps
                .filter((gap) => gap.field === "privateUsePercent")
                .map((gap) => (
                  <span key={gap.field} className="irp6-field-error" data-itr12-gap={gap.field}>
                    {gap.prompt}
                  </span>
                ))}
              <p className="irp6-note">
                Net rental: {scheduleCents(workedProperty?.netCents ?? null)}
              </p>
              {locked ? null : (
                <button
                  type="button"
                  className="irp6-back"
                  onClick={() => saveRentals(properties.filter((item) => item.id !== property.id))}
                >
                  Remove property
                </button>
              )}
              <NilBlanksControl
                target={`itr12-rental-${property.id}`}
                active={property.nilMark != null}
                locked={locked}
                onMark={() =>
                  saveRentals(
                    properties.map((item) =>
                      item.id === property.id ? markItr12RentalNil(item) : item,
                    ),
                  )
                }
                onUndo={() =>
                  saveRentals(
                    properties.map((item) =>
                      item.id === property.id ? undoItr12RentalNil(item) : item,
                    ),
                  )
                }
              />
            </div>
          );
        })}
        <p className="irp6-note">
          Total net rental: {scheduleCents(rentals?.totalNetCents ?? null)}
        </p>
        {locked ? null : (
          <button
            type="button"
            className="irp6-back"
            data-itr12-rental-add="true"
            onClick={() => saveRentals([...properties, emptyProperty(rowId("property"))])}
          >
            Add a property
          </button>
        )}
      </section>
    </>
  );
}

function centsText(cents: number | null): string {
  if (cents == null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${rands}${rem ? `.${String(rem).padStart(2, "0")}` : ""}`;
}

function AmountInput({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState(centsText(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (parseRandsToCents(text) !== value) setText(centsText(value));
    // Follow a draft reload, not each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="irp6-amount">
      <span aria-hidden="true">R</span>
      <input
        id={id}
        className="irp6-input irp6-input--num"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad || undefined}
        value={text}
        placeholder="0.00"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const cents = parseRandsToCents(next);
          setBad(next.trim() !== "" && cents == null);
          onChange(next.trim() === "" ? null : cents);
        }}
      />
    </span>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function nextLineId(fieldId: string): string {
  return `typed-${fieldId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ZaItr12Sheet({
  client,
  today,
  drafts,
  onSaved,
  onBack,
  backLabel = "Tax drafts",
  initialYear,
  seed = null,
  approverRole = "accountant",
}: {
  client: { id: string; name: string };
  today: string;
  drafts: TaxFormDraft[];
  onSaved: (draft: TaxFormDraft) => void;
  onBack: () => void;
  backLabel?: string;
  initialYear?: number;
  /** Used when this year has no saved draft yet. */
  seed?: Itr12Inputs | null;
  approverRole?: Itr12ApproverRole;
}) {
  const startYear = initialYear ?? itr12YearOfAssessment(today);
  const [year, setYear] = useState(startYear);
  const savedAtStart = findItr12Draft(drafts, startYear);
  const [inputs, setInputs] = useState<Itr12Inputs>(() =>
    savedAtStart ? itr12InputsFromDraft(savedAtStart) : (seed ?? emptyItr12Inputs()),
  );
  const [approvals, setApprovals] = useState<Approvals>(() => savedAtStart?.approvals ?? {});
  const [status, setStatus] = useState<TaxFormDraftStatus>(savedAtStart?.status ?? "draft");
  const [approvedBy, setApprovedBy] = useState<{
    id: string | null;
    name: string | null;
    at: string | null;
  }>({
    id: savedAtStart?.approved_by ?? null,
    name: savedAtStart?.approved_by_name ?? null,
    at: savedAtStart?.approved_at ?? null,
  });
  const [busy, setBusy] = useState<null | "save" | "pdf" | "csv">(null);
  const [error, setError] = useState<string | null>(null);

  const saved = findItr12Draft(drafts, year);
  const years = useMemo(() => itr12YearChoices(today, year), [today, year]);
  const sheet = useMemo(
    () => computeItr12({ clientName: client.name, yearOfAssessment: year, inputs }),
    [client.name, year, inputs],
  );
  const locked = approverRole === "owner";
  const canDownload = itr12CanDownload(sheet, approvals, approverRole);
  const approvedCount = ITR12_SECTIONS.filter((section) => approvals[section.id]).length;
  const openQueries = inputs.queries.filter((query) => !query.resolved);

  const loadYear = (nextYear: number) => {
    const row = findItr12Draft(drafts, nextYear);
    setYear(nextYear);
    setInputs(row ? itr12InputsFromDraft(row) : emptyItr12Inputs());
    setApprovals(row?.approvals ?? {});
    setStatus(row?.status ?? "draft");
    setApprovedBy({
      id: row?.approved_by ?? null,
      name: row?.approved_by_name ?? null,
      at: row?.approved_at ?? null,
    });
    setError(null);
  };

  const edit = (sections: Itr12SectionId[], next: Itr12Inputs) => {
    setInputs(next);
    setApprovals((prev) => {
      const cleared = { ...prev };
      for (const section of [...sections, "result" as const]) delete cleared[section];
      return cleared;
    });
    if (status !== "draft") {
      setStatus("draft");
      setApprovedBy({ id: null, name: null, at: null });
    }
  };

  const persist = async (
    nextStatus: TaxFormDraftStatus,
    nextApprovals: Approvals,
    approver: { id: string | null; name: string | null; at: string | null },
    downloadedAt?: string,
  ) => {
    const row = await saveCatalogDraft({
      client_id: client.id,
      form_code: "ITR12",
      tax_year: year,
      period: null,
      subject: null,
      fields: itr12DraftFields(sheet, inputs),
      approvals: nextApprovals,
      status: nextStatus,
      approved_by: approver.id,
      approved_by_name: approver.name,
      approved_at: approver.at,
      downloaded_at: downloadedAt ?? saved?.downloaded_at ?? null,
      field_sources: itr12FieldSources(inputs),
    });
    onSaved(row);
    return row;
  };

  const toggleApprove = async (section: Itr12SectionId) => {
    if (approverRole === "owner") return;
    const blocked = itr12ApproveBlock({ role: approverRole, section, sheet });
    if (!approvals[section] && blocked) return;
    const next = { ...approvals, [section]: !approvals[section] };
    if (!next[section]) delete next[section];
    setApprovals(next);
    const all = ITR12_SECTIONS.every((item) => next[item.id]);
    if (all && status === "draft") {
      const who = await currentApprover();
      const approver = { id: who.id, name: who.name, at: new Date().toISOString() };
      setApprovedBy(approver);
      setStatus("approved");
      await persist("approved", next, approver);
    } else if (!all && status !== "draft") {
      const cleared = { id: null, name: null, at: null };
      setApprovedBy(cleared);
      setStatus("draft");
      await persist("draft", next, cleared);
    }
  };

  const saveDraft = async () => {
    setBusy("save");
    setError(null);
    try {
      await persist(status, approvals, approvedBy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the draft.");
    } finally {
      setBusy(null);
    }
  };

  const markDownloaded = async () => {
    const at = new Date().toISOString();
    setStatus("downloaded");
    await persist("downloaded", approvals, approvedBy, at);
  };

  const downloadPdf = async () => {
    if (!canDownload) return;
    setBusy("pdf");
    setError(null);
    try {
      const [{ pdf }, { Itr12PDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./za-itr12-pdf"),
      ]);
      const blob = await pdf(
        Itr12PDF({
          clientName: client.name,
          sheet,
          approvedByName: approvedBy.name,
          approvedAt: approvedBy.at,
          preparedOn: today,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      download(blob, itr12FileName(client.name, year, "pdf"));
      await markDownloaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const downloadCsv = async () => {
    if (!canDownload) return;
    setBusy("csv");
    setError(null);
    try {
      const blob = new Blob([itr12Csv(sheet)], { type: "text/csv;charset=utf-8" });
      download(blob, itr12FileName(client.name, year, "csv"));
      await markDownloaded();
    } finally {
      setBusy(null);
    }
  };

  const setLineAmount = (id: string, cents: number | null) => {
    edit(
      [
        itr12MoneyField(inputs.lines.find((line) => line.id === id)?.fieldId ?? "employmentIncome")
          .section,
      ],
      {
        ...inputs,
        lines: inputs.lines.map((line) =>
          line.id === id ? { ...line, amountCents: cents } : line,
        ),
      },
    );
  };

  const addTypedLine = (fieldId: Itr12MoneyFieldId) => {
    const field = itr12MoneyField(fieldId);
    const line: Itr12Cited = {
      id: nextLineId(fieldId),
      fieldId,
      label: field.label,
      amountCents: null,
      fileId: null,
      source: "accountant",
      note: null,
    };
    edit([field.section], { ...inputs, lines: [...inputs.lines, line] });
  };

  const removeLine = (line: Itr12Cited) => {
    edit([itr12MoneyField(line.fieldId).section], {
      ...inputs,
      lines: inputs.lines.filter((item) => item.id !== line.id),
    });
  };

  const resolveQuery = (id: string, resolved: boolean) => {
    edit(["queries"], {
      ...inputs,
      queries: inputs.queries.map((query) => (query.id === id ? { ...query, resolved } : query)),
    });
  };

  const refInvalid = Boolean(inputs.taxReference.trim()) && !validTaxReference(inputs.taxReference);
  const sectionPurpose = Object.fromEntries(ITR12_SECTIONS.map((section) => [section.id, section]));

  const approve = (section: Itr12SectionId) => {
    const blocked = itr12ApproveBlock({ role: approverRole, section, sheet });
    const approved = Boolean(approvals[section]);
    return (
      <button
        type="button"
        className={approved ? "irp6-approve is-approved" : "irp6-approve"}
        data-itr12-approve={section}
        data-itr12-approve-blocked={blocked ?? undefined}
        aria-pressed={approved}
        disabled={approverRole === "owner" || (!approved && blocked != null)}
        title={blocked ?? undefined}
        onClick={() => void toggleApprove(section)}
      >
        <span className="irp6-approve-box">{approved ? <TickIcon /> : null}</span>
        {approved ? "Approved" : "Approve"}
      </button>
    );
  };

  const fieldRow = (line: Itr12SheetLine, children?: ReactNode) => (
    <tr
      key={line.id}
      data-itr12-field={line.id}
      data-itr12-missing={line.missing ? "true" : undefined}
    >
      <th scope="row">
        <span className="irp6-label">{line.label}</span>
        {line.note ? <span className="irp6-note">{line.note}</span> : null}
      </th>
      <td className="irp6-value">{children ?? (line.display || "—")}</td>
      <td className="irp6-source">
        <span
          className={
            line.missing ? "irp6-source-tag is-missing" : `irp6-source-tag is-${line.source}`
          }
        >
          {line.sourceLabel}
        </span>
      </td>
    </tr>
  );

  const moneyBlock = (fieldId: Itr12MoneyFieldId) => {
    const field = itr12MoneyField(fieldId);
    const total = sheet.lines.find((line) => line.id === fieldId);
    const details = inputs.lines.filter((line) => line.fieldId === fieldId);
    const only = details.length === 1 ? details[0] : null;
    const typedOnly = only?.source === "accountant" ? only : null;
    return (
      <div data-itr12-money={fieldId}>
        <table className="irp6-table">
          <tbody>
            {total
              ? fieldRow(
                  total,
                  typedOnly && !locked ? (
                    <AmountInput
                      id={`itr12-input-${typedOnly.id}`}
                      label={field.label}
                      value={typedOnly.amountCents}
                      onChange={(cents) => setLineAmount(typedOnly.id, cents)}
                    />
                  ) : undefined,
                )
              : null}
            {details.length > 1
              ? details.map((line) => {
                  const part = sheet.lines.find((row) => row.id === line.id);
                  return (
                    <tr key={line.id} data-itr12-line={line.id}>
                      <th scope="row">
                        <span className="irp6-label">{line.label}</span>
                        {line.note ? <span className="irp6-note">{line.note}</span> : null}
                      </th>
                      <td className="irp6-value">
                        {line.source === "accountant" && !locked ? (
                          <AmountInput
                            id={`itr12-input-${line.id}`}
                            label={line.label}
                            value={line.amountCents}
                            onChange={(cents) => setLineAmount(line.id, cents)}
                          />
                        ) : (
                          part?.display || "—"
                        )}
                      </td>
                      <td className="irp6-source">
                        <span
                          className={`irp6-source-tag is-${line.source === "accountant" ? "input" : "file"}`}
                        >
                          {line.source === "accountant"
                            ? "Typed by the accountant"
                            : `File ${line.fileId}`}
                        </span>
                        {locked ? null : (
                          <button
                            type="button"
                            className="irp6-back"
                            onClick={() => removeLine(line)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
        {locked ? null : (
          <>
            {only ? (
              <button type="button" className="irp6-back" onClick={() => removeLine(only)}>
                Remove
              </button>
            ) : null}
            <button
              type="button"
              className="irp6-back"
              data-itr12-add={fieldId}
              onClick={() => addTypedLine(fieldId)}
            >
              Add a figure I typed
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div
      className="irp6"
      data-itr12-sheet="true"
      data-itr12-status={status}
      data-itr12-role={approverRole}
    >
      <header className="irp6-head">
        <button type="button" className="irp6-back" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="irp6-title-row">
          <h2 className="irp6-title">ITR12 preparation sheet</h2>
          <span className={`irp6-status is-${status}`} data-itr12-status-label="true">
            {TAX_FORM_DRAFT_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="irp6-purpose">
          Individual income tax for {client.name}, prepared for you to check and capture on eFiling.
        </p>
        <div className="irp6-picks">
          <label className="irp6-pick">
            Year of assessment
            <select
              className="irp6-input"
              value={year}
              data-itr12-year="true"
              onChange={(event) => loadYear(Number(event.target.value))}
            >
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="irp6-gate" role="status" data-itr12-gate={canDownload ? "ready" : "blocked"}>
        {approverRole === "owner" ? (
          <p className="irp6-gate-line">The owner cannot approve a section.</p>
        ) : openQueries.length ? (
          <p className="irp6-gate-line" data-itr12-open-queries={openQueries.length}>
            {openQueries.length === 1
              ? "1 open query blocks Approve."
              : `${openQueries.length} open queries block Approve.`}
          </p>
        ) : sheet.missing.length ? (
          <p className="irp6-gate-line" data-itr12-missing-count={sheet.missing.length}>
            {itr12MissingSentence(sheet.missing.length)}
          </p>
        ) : approvedCount < ITR12_SECTIONS.length ? (
          <p className="irp6-gate-line">
            Approve each section to download. {approvedCount} of {ITR12_SECTIONS.length} approved.
          </p>
        ) : (
          <p className="irp6-gate-line is-ready">
            Ready to download.
            {approvedBy.name && approvedBy.at
              ? ` Approved by ${approvedBy.name} on ${draftDayLabel(approvedBy.at)}.`
              : ""}
          </p>
        )}
      </div>

      <section className="irp6-section" data-itr12-section="taxpayer">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.taxpayer.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.taxpayer.purpose}</p>
          </div>
          {approve("taxpayer")}
        </header>
        <table className="irp6-table">
          <tbody>
            {sheet.lines
              .filter((line) => line.id === "fullName" || line.id === "yearOfAssessment")
              .map((line) => fieldRow(line))}
            {fieldRow(
              sheet.lines.find((line) => line.id === "taxReference")!,
              <>
                <input
                  id="itr12-input-taxReference"
                  className="irp6-input irp6-input--ref"
                  inputMode="numeric"
                  aria-label="Income tax reference number"
                  aria-invalid={refInvalid || undefined}
                  placeholder="10 digits"
                  value={inputs.taxReference}
                  disabled={locked}
                  onChange={(event) =>
                    edit(["taxpayer"], { ...inputs, taxReference: event.target.value })
                  }
                />
                {refInvalid ? <span className="irp6-field-error">Should be 10 digits.</span> : null}
              </>,
            )}
          </tbody>
        </table>
      </section>

      {(
        [
          ["income", ["employmentIncome", "practiceIncome"]],
          ["deductions", ["practiceExpenses"]],
          ["medical", ["medicalContributions"]],
          ["ra", ["raContributions"]],
          ["travel", ["travelClaim"]],
          ["interest", ["localInterest"]],
        ] as const
      ).map(([section, fields]) => (
        <section key={section} className="irp6-section" data-itr12-section={section}>
          <header className="irp6-section-head">
            <div>
              <h3 className="irp6-section-title">{sectionPurpose[section].title}</h3>
              <p className="irp6-section-purpose">{sectionPurpose[section].purpose}</p>
            </div>
            {approve(section)}
          </header>
          {fields.map((fieldId) => (
            <div key={fieldId}>{moneyBlock(fieldId)}</div>
          ))}
        </section>
      ))}

      <section className="irp6-section" data-itr12-section="queries">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.queries.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.queries.purpose}</p>
          </div>
          {approve("queries")}
        </header>
        {inputs.queries.length === 0 ? (
          <p className="irp6-note">No queries on this draft.</p>
        ) : (
          <ul className="irp6-gate-list" data-itr12-queries="true">
            {inputs.queries.map((query) => (
              <li
                key={query.id}
                data-itr12-query={query.id}
                data-itr12-query-open={query.resolved ? "false" : "true"}
              >
                <span>{query.text}</span>
                <button
                  type="button"
                  className="irp6-back"
                  data-itr12-resolve={query.id}
                  disabled={locked}
                  onClick={() => resolveQuery(query.id, !query.resolved)}
                >
                  {query.resolved ? "Reopen" : "Resolve"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LocalSchedules
        inputs={inputs}
        sheet={sheet}
        locked={locked}
        onChange={(next) => edit(["result"], next)}
      />

      <CgtSection
        form="itr12"
        person="individual"
        disposals={inputs.disposals ?? []}
        assessedCapitalLossBroughtForwardCents={
          inputs.assessedCapitalLossBroughtForwardCents ?? null
        }
        assessedCapitalLossNilMark={inputs.assessedCapitalLossNilMark ?? null}
        schedule={sheet.capital}
        locked={locked}
        onChange={(next) => edit(["result"], { ...inputs, ...next })}
        onNilMark={(mark, cents) =>
          edit(["result"], {
            ...inputs,
            assessedCapitalLossBroughtForwardCents: cents,
            assessedCapitalLossNilMark: mark,
          })
        }
      />

      <section className="irp6-section" data-itr12-section="result">
        <header className="irp6-section-head">
          <div>
            <h3 className="irp6-section-title">{sectionPurpose.result.title}</h3>
            <p className="irp6-section-purpose">{sectionPurpose.result.purpose}</p>
          </div>
          {approve("result")}
        </header>
        <table className="irp6-table">
          <tbody>
            {sheet.lines
              .filter(
                (line) =>
                  line.id === "incomeTotal" ||
                  line.id === "taxableIncome" ||
                  line.id === "taxPayable",
              )
              .map((line) => fieldRow(line))}
          </tbody>
        </table>
      </section>

      <p className="irp6-purpose">{ITR12_FOOTER}</p>
      {error ? (
        <p className="irp6-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="irp6-actions">
        <button
          type="button"
          className="irp6-save"
          data-itr12-save="true"
          disabled={locked || busy != null}
          onClick={() => void saveDraft()}
        >
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          className="irp6-download"
          data-itr12-download="pdf"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadPdf()}
        >
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className="irp6-download"
          data-itr12-download="csv"
          disabled={!canDownload || busy != null}
          onClick={() => void downloadCsv()}
        >
          {busy === "csv" ? "Preparing CSV…" : "Download CSV"}
        </button>
      </div>
    </div>
  );
}
