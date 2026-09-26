/**
 * Edge copy of the payables draft helpers.
 * `src/lib/payables.ts` follows `collections.ts` for the shared report parsers.
 * This is the same implementation the accountant UI uses.
 */
export {
  buildPayablesDraft,
  choosePayables,
  payablesPromptBlock,
  readPayablesSnapshot,
} from "../../../src/lib/payables.ts";
