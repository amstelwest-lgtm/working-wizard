/**
 * A statement import says what landed, or an error the person can retry.
 * Run: pnpm test:statement-import
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportApplyNotice } from "../src/components/import-apply-notice.tsx";
import { splitFinancialsBlob } from "../src/lib/debt-schedule.ts";
import {
  financialsWriteRev,
  financialsWriteSuperseded,
  guardFinancialsWrite,
  importFailureMessage,
  importedUpdateMessage,
  seenFinancialsStamp,
  statementImportWhat,
  withFinancialsWriteRev,
} from "../src/lib/statement-import-apply.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(statementImportWhat("balance_sheet") === "balance sheet", "balance sheet noun");
assert(statementImportWhat("income_statement") === "income statement", "income statement noun");
assert(
  importedUpdateMessage("balance sheet") === "Imported, balance sheet updated",
  importedUpdateMessage("balance sheet"),
);
assert(
  importedUpdateMessage("income statement") === "Imported, income statement updated",
  "income message",
);

const success = renderToStaticMarkup(
  createElement(ImportApplyNotice, {
    tone: "success",
    message: importedUpdateMessage(statementImportWhat("balance_sheet")),
  }),
);
assert(success.includes('data-import-apply="success"'), "success is visible");
assert(success.includes("Imported, balance sheet updated"), success);

const failure = importFailureMessage("The figures were not written to this client.");
const errorHtml = renderToStaticMarkup(
  createElement(ImportApplyNotice, {
    tone: "error",
    message: failure,
    onRetry: () => {},
  }),
);
assert(errorHtml.includes('data-import-apply="error"'), "failure is visible");
assert(errorHtml.includes("The figures were not written to this client."), errorHtml);
assert(errorHtml.includes("Retry"), "failure offers Retry");
assert(errorHtml.includes("data-import-retry"), "retry control is marked");
assert(!errorHtml.includes("Imported,"), "a failure does not claim the import landed");

assert(seenFinancialsStamp(null).eq == null, "a missing stamp matches only a blank row");
assert(seenFinancialsStamp("").eq == null, "a blank stamp matches only a blank row");
assert(
  seenFinancialsStamp("2026-10-20T12:00:00.000Z").eq === "2026-10-20T12:00:00.000Z",
  "an autosave keeps the stamp it read",
);

const stamped = withFinancialsWriteRev({ revenue: "412000", cash: "1000" }, "wabc123");
assert(financialsWriteRev(stamped) === "wabc123", "the import stamp is readable");
assert(stamped.revenue === "412000", "stamping keeps the figures");
assert(financialsWriteSuperseded(null, stamped), "a late autosave that saw no stamp loses");
assert(!financialsWriteSuperseded("wabc123", stamped), "the same stamp is still the row");
assert(financialsWriteSuperseded("wabc123", { revenue: "1" }), "a cleared stamp is a newer write");
const split = splitFinancialsBlob(stamped);
assert(split.scalars.revenue === "412000", "figures still split into the form");
assert(!("_writeRev" in split.scalars), "the stamp is not a form field");

const filters: string[] = [];
const query = {
  eq(column: string, value: string) {
    filters.push(`eq ${column} ${value}`);
    return this;
  },
  is(column: string, value: null) {
    filters.push(`is ${column} ${String(value)}`);
    return this;
  },
};
guardFinancialsWrite(query, null);
guardFinancialsWrite(query, "wabc123");
assert(filters[0] === "is financials->>_writeRev null", filters[0] ?? "missing blank filter");
assert(filters[1] === "eq financials->>_writeRev wabc123", filters[1] ?? "missing stamp filter");

console.log("statement-import-apply-test: all assertions passed");
