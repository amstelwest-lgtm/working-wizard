/**
 * Cash Audit inputs: approve one by one, approve all, edits invalidate, counts.
 * Run: pnpm test:cash-input-audit
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  approveCashInputs,
  cashAuditHash,
  cashAuditPendingCount,
  cashAuditRows,
  cashAuditSignoffWarning,
  cashAuditStatus,
  parseCashInputAudit,
} from "../src/lib/cash-input-audit";
import { CashInputAuditTable } from "../src/components/cash/cash-input-audit";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const format = (n: number) => `R ${Math.round(n / 1000)}k`;
const line = (id: string, name: string, amount: string) => ({
  id,
  name,
  amount,
  frequency: "recurring-monthly",
  startWeek: 1,
  splitCount: 3,
});
const base = {
  startDate: "2026-11-02",
  startLabel: "2 Nov",
  openingBalance: "250000",
  openingSource: "Bank",
  floor: 112_000,
  floorRule: "About 4 weeks of outflows",
  revenue: [line("r1", "Sales", "90000")],
  expenses: [line("e1", "Rent", "20000"), line("e2", "Interest", "")],
  other: [line("o1", "Other expenses", "0")],
  linesSource: "Bank",
  sources: [
    { id: "statement", label: "Financial statement", available: true, chip: "Statement" },
    { id: "budget", label: "Budget", available: false },
  ],
  collectDelay: 0,
  revGrowthPct: 0,
  format,
};

const rows = cashAuditRows(base);
const keys = rows.map((row) => row.key);
assert(
  keys.join(",") ===
    "opening,startDate,floor,line:r1,line:e1,source:statement,collectDelay,revGrowthPct",
  `rows: ${keys.join(",")}`,
);
assert(!keys.includes("line:e2") && !keys.includes("line:o1"), "blank and zero lines are not inputs");
assert(!keys.includes("source:budget"), "unavailable sources are not listed");
assert(rows[0].value === "R 250k" && rows[0].source === "Bank", "opening shows value and source");
assert(rows.find((r) => r.key === "line:r1")?.value.includes("monthly"), "line value names frequency");

let audit = parseCashInputAudit(undefined);
assert(cashAuditPendingCount(rows, audit) === rows.length, "nothing approved yet");
assert(cashAuditStatus(rows[0], audit) === "suggested", "first state is To approve");

audit = approveCashInputs(audit, rows, { by: "u1", at: "2026-10-27T10:00:00Z", keys: ["opening"] });
assert(cashAuditStatus(rows[0], audit) === "approved", "approve one");
assert(audit.opening.approvedBy === "u1", "approver recorded");
assert(cashAuditPendingCount(rows, audit) === rows.length - 1, "count drops by one");

const edited = cashAuditRows({ ...base, openingBalance: "240000" });
assert(cashAuditStatus(edited[0], audit) === "changed", "editing an approved input flags it");
assert(cashAuditPendingCount(edited, audit) === rows.length, "a changed input counts as pending");

const relabelled = cashAuditRows({ ...base, startLabel: "Mon 2 Nov" });
const before = approveCashInputs({}, rows, { by: null, at: "t", keys: ["startDate"] });
assert(cashAuditStatus(relabelled[1], before) === "approved", "display text alone is not a change");

const all = approveCashInputs(audit, edited, { by: "u2", at: "2026-10-27T11:00:00Z" });
assert(cashAuditPendingCount(edited, all) === 0, "approve all remaining clears the count");
assert(all["line:r1"].approvedBy === "u2", "approve all stamps the remaining rows");

const roundTrip = parseCashInputAudit(JSON.parse(JSON.stringify(all)));
assert(cashAuditPendingCount(edited, roundTrip) === 0, "approvals survive a reload");
assert(
  Object.keys(parseCashInputAudit({ bad: 1, ok: { approvedAt: "t", valueHash: "x" } })).join() === "ok",
  "parser drops malformed rows",
);
assert(cashAuditHash({ a: 1, b: 2 }) === cashAuditHash({ b: 2, a: 1 }), "hash ignores key order");

assert(cashAuditSignoffWarning(0) === null, "no warning when all approved");
assert(cashAuditSignoffWarning(1) === "1 input not approved", "singular warning");
assert(cashAuditSignoffWarning(3) === "3 inputs not approved", "plural warning");

const html = renderToStaticMarkup(
  createElement(CashInputAuditTable, {
    rows: edited,
    audit,
    canApprove: true,
    formatDate: (iso: string) => iso.slice(0, 10),
    onApprove: () => {},
    onApproveAll: () => {},
    onEdit: () => {},
  }),
);
assert(html.includes("Approve all remaining"), "approve-all action");
assert(html.includes("Changed since approval"), "changed status shows");
assert(html.includes('aria-label="Approve Sales"'), "per-row approve");
for (const col of ["Input", "Value", "Source", "Status"]) {
  assert(html.includes(`<th scope="col">${col}</th>`), `${col} column`);
}

const cash = readFileSync("src/components/cash-forecast.tsx", "utf8");
assert(cash.includes("inputAudit: next"), "approvals write to cashflow.inputAudit");
const save = cash.slice(cash.indexOf("const saveInputAudit"), cash.indexOf("const approveInputs"));
assert(!save.includes("last_forecast_at"), "approving does not move the forecast timestamp");
assert(cash.includes("auditCount={auditPending}"), "menu badge shows pending count");
assert(cash.includes("data-cash-audit-warning"), "soft warning near sign-off");
const signoffAt = cash.indexOf("data-cash-audit-warning");
const nextSignoff = cash.indexOf("<ReviewSignoffButton", signoffAt);
assert(!cash.slice(signoffAt, nextSignoff).includes("disabled"), "the warning never blocks sign-off");

console.log("cash-input-audit-test: all assertions passed");
