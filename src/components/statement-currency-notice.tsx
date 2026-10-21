import type { CurrencyChoice, CurrencyGate } from "@/lib/statement-currency";

/**
 * Blocking choice when the file's printed currency is not the client's.
 * Nothing is selected until the person chooses. Cancel does not import.
 */
export function StatementCurrencyNotice({
  gate,
  choice,
  onChoice,
}: {
  gate: CurrencyGate;
  choice: CurrencyChoice | null;
  onChoice: (next: CurrencyChoice) => void;
}) {
  if (!gate.blocked || !gate.notice || !gate.overrideLabel) return null;
  return (
    <fieldset
      data-currency-gate="blocked"
      className="space-y-2 rounded-lg border border-red-800 bg-red-950/40 px-3 py-3"
    >
      <legend className="sr-only">Statement currency</legend>
      <p data-currency-notice className="text-sm font-medium text-red-200">
        {gate.notice}
      </p>
      <label className="flex items-start gap-2 text-sm text-red-100">
        <input
          type="radio"
          name="statement-currency"
          value="cancel"
          data-currency-choice="cancel"
          checked={choice === "cancel"}
          onChange={() => onChoice("cancel")}
          className="mt-1"
        />
        <span>{gate.cancelLabel}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-red-100">
        <input
          type="radio"
          name="statement-currency"
          value="label_wrong"
          data-currency-choice="label_wrong"
          checked={choice === "label_wrong"}
          onChange={() => onChoice("label_wrong")}
          className="mt-1"
        />
        <span>{gate.overrideLabel}</span>
      </label>
    </fieldset>
  );
}
