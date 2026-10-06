/**
 * Text-layer-first PDF/image uploads, plus the mid-year TB contra-asset case.
 *
 * Prod smoke (extract-financials, tb-midyear-sept-2026): the PDF path kept
 * equipment at cost 95,000, dropped accumulated depreciation 27,000, and
 * reported assets 333,950 instead of 306,950. Equity came out 192,000 instead
 * of 150,000. Liabilities, revenue, and cash were fine. The sheet was out by
 * 36,000 (192,000 + 105,950 − 333,950).
 *
 * The sample PDF is not in the repo. This file synthesizes that shape.
 * Swap in QA's file with STATEMENT_TEXT_LAYER_GOOD_PDF / STATEMENT_TEXT_LAYER_SCAN_PDF.
 * See scripts/fixtures/statements/README.md.
 *
 * Run: pnpm test:statement-text-layer
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { balanceSheetCheck } from "../src/lib/statement-balance";
import {
  readContraAssets,
  reconcileExtractionResult,
  reconcileFlatFinancials,
  reconcileModelTotals,
} from "../src/lib/contra-assets";
import type { FinancialFigures, IncomeStatement } from "../src/lib/financialSchema";
import { financialExtractionPrompt, textExtractionSystem } from "../src/lib/market/prompt";
import { ZA_MARKET } from "../src/lib/market";
import { redactIdentifiers } from "../src/lib/redact-identifiers";
import { assessStatementTextQuality, statementModelParts } from "../src/lib/statement-text-layer";
import {
  extractPdfTextLayer,
  prepareStatementContent,
} from "../src/lib/statement-text-layer.server";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const GROSS = 95_000;
const ACCUM = 27_000;
const NET_PPE = 68_000;
const ASSETS_NET = 306_950;
const ASSETS_GROSS = 333_950;
const EQUITY = 150_000;
const EQUITY_MISREAD = 192_000;
const LIABILITIES = 156_950;
/** Liabilities on the mis-read sheet. 192,000 + 105,950 − 333,950 = −36,000. */
const LIABILITIES_MISREAD = 105_950;
const CASH = "78,950.00";

const TB_LINES = [
  "Harbour & Co (Pty) Ltd",
  "Trial balance",
  "Period ended 2026-09-30",
  "VAT 4123456789",
  "owner@harbour.example",
  "Equipment at cost 95,000.00",
  "Accumulated depreciation (27,000.00)",
  "Trade receivables 120,000.00",
  "Inventory 40,000.00",
  `Cash ${CASH}`,
  "Trade payables 156,950.00",
  "Total equity 150,000.00",
  "Revenue 171,000.00",
  "Cost of sales 80,000.00",
  "Operating expenses 40,000.00",
];

const TB_TEXT = TB_LINES.join("\n");

const SCRAMBLED = [
  "Equipment at cost",
  "Accumulated depreciation",
  "Trade receivables",
  "Inventory",
  "Cash",
  "Trade payables",
  "Total equity",
  "Revenue",
  "95,000.00",
  "27,000.00",
  "120,000.00",
  "40,000.00",
  CASH,
  "156,950.00",
  "150,000.00",
  "171,000.00",
].join("\n");

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(stream: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body));
}

function buildTextPdf(lines: string[]): Uint8Array {
  const commands = ["BT", "/F1 11 Tf", "16 TL", "54 760 Td"];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("T*");
    commands.push(`(${pdfEscape(line)}) Tj`);
  });
  commands.push("ET");
  return buildPdf(commands.join("\n"));
}

function buildScanPdf(): Uint8Array {
  return buildPdf("q\n0.15 0.15 0.15 rg\n72 700 420 18 re\nf\nQ");
}

function loadPdf(envName: string, fallback: Uint8Array): { bytes: Uint8Array; source: string } {
  const fromEnv = process.env[envName];
  if (!fromEnv) return { bytes: fallback, source: "synthesized" };
  return { bytes: new Uint8Array(readFileSync(fromEnv)), source: fromEnv };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function textOf(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function income(partial: Partial<IncomeStatement> = {}): IncomeStatement {
  return {
    revenue: null,
    cost_of_sales: null,
    gross_profit: null,
    other_income: null,
    operating_expenses: null,
    depreciation_amortisation: null,
    operating_profit: null,
    finance_income: null,
    finance_costs: null,
    profit_before_tax: null,
    income_tax: null,
    profit_after_tax: null,
    ...partial,
  };
}

function figures(partial: {
  assets: number;
  equity: number;
  liabilities: number;
  ppe?: number;
  revenue?: number;
  cogs?: number;
  opex?: number;
}): FinancialFigures {
  return {
    income_statement: income({
      revenue: partial.revenue ?? null,
      cost_of_sales: partial.cogs ?? null,
      operating_expenses: partial.opex ?? null,
    }),
    balance_sheet: {
      non_current_assets: {
        property_plant_equipment: partial.ppe ?? null,
        intangible_assets: null,
        investments: null,
        deferred_tax_asset: null,
        other: null,
        total: partial.ppe ?? null,
      },
      current_assets: {
        inventories: null,
        trade_and_other_receivables: null,
        cash_and_cash_equivalents: null,
        other: null,
        total: null,
      },
      total_assets: partial.assets,
      equity: {
        share_capital: null,
        retained_earnings: null,
        other_reserves: null,
        total: partial.equity,
      },
      non_current_liabilities: {
        borrowings: null,
        deferred_tax_liability: null,
        other: null,
        total: null,
      },
      current_liabilities: {
        trade_and_other_payables: partial.liabilities,
        borrowings: null,
        current_tax: null,
        bank_overdraft: null,
        other: null,
        total: partial.liabilities,
      },
      total_liabilities: partial.liabilities,
      total_equity_and_liabilities: null,
    },
    cash_flow: null,
  };
}

const goodQuality = assessStatementTextQuality(TB_TEXT);
assert(
  goodQuality.decision === "text" && goodQuality.reason === "good",
  "text-rich TB is good enough to send",
);

const scrambledQuality = assessStatementTextQuality(SCRAMBLED);
assert(
  scrambledQuality.decision === "document" && scrambledQuality.reason === "low_quality",
  "column-scrambled TB is not sent as text",
);
assert(assessStatementTextQuality("").reason === "empty", "blank extract is empty");
assert(
  assessStatementTextQuality("Scanned by a copier").decision === "document",
  "scan banner is not text",
);

const contra = readContraAssets(TB_TEXT);
assert(contra != null, "paired equipment and accum. dep. lines are readable");
assert(contra.gross === GROSS, `gross equipment ${contra.gross}`);
assert(contra.accumulatedDepreciation === ACCUM, `accum. dep. ${contra.accumulatedDepreciation}`);
assert(contra.net === NET_PPE, `net PPE ${contra.net}`);
assert(readContraAssets(SCRAMBLED) == null, "scrambled columns do not invent a contra pair");

const misread = reconcileModelTotals({
  text: TB_TEXT,
  totalAssets: ASSETS_GROSS,
  equity: EQUITY_MISREAD,
  ppe: GROSS,
});
assert(misread.totalAssets === ASSETS_NET, `net assets ${misread.totalAssets}`);
assert(misread.equity === EQUITY, `printed equity ${misread.equity}`);
assert(misread.netPpe === NET_PPE, `net PPE from mis-read ${misread.netPpe}`);
assert(misread.adjusted, "gross cost was replaced");

const alreadyNet = reconcileModelTotals({
  text: TB_TEXT,
  totalAssets: ASSETS_NET,
  equity: EQUITY,
  ppe: NET_PPE,
});
assert(alreadyNet.totalAssets === ASSETS_NET, "an already-net total is not reduced again");
assert(alreadyNet.equity === EQUITY, "printed equity stays");
assert(alreadyNet.netPpe === NET_PPE, "net PPE stays");

const withDeposit = `${TB_TEXT}\nSecurity deposit 10,000.00`.replace(
  "Trade payables 156,950.00",
  "Trade payables 166,950.00",
);
const depositGross = ASSETS_GROSS + 10_000;
const depositNet = reconcileModelTotals({
  text: withDeposit,
  totalAssets: depositGross,
  equity: EQUITY_MISREAD,
  ppe: null,
});
assert(
  depositNet.totalAssets === ASSETS_NET + 10_000,
  `unlisted deposit still nets assets (${depositNet.totalAssets})`,
);
assert(depositNet.equity === EQUITY, "printed equity wins when other assets are unlisted");

const scrambledKeep = reconcileModelTotals({
  text: SCRAMBLED,
  totalAssets: ASSETS_GROSS,
  equity: EQUITY_MISREAD,
  ppe: GROSS,
});
assert(scrambledKeep.totalAssets === ASSETS_GROSS, "a broken extract does not rewrite assets");
assert(scrambledKeep.equity === EQUITY_MISREAD, "a broken extract does not rewrite equity");
assert(!scrambledKeep.adjusted, "a broken extract is left for the document path");

const flat = reconcileFlatFinancials(
  {
    totalAssets: String(ASSETS_GROSS),
    equity: String(EQUITY_MISREAD),
    revenue: "171000",
    cash: "78950",
  },
  TB_TEXT,
);
assert(flat.totalAssets === String(ASSETS_NET), "edge totalAssets uses net carrying amount");
assert(flat.equity === String(EQUITY), "edge equity uses the printed total");
assert(flat.revenue === "171000", "revenue is left as read");
assert(flat.cash === "78950", "cash is left as read");

const badGap = balanceSheetCheck(
  figures({
    assets: ASSETS_GROSS,
    equity: EQUITY_MISREAD,
    liabilities: LIABILITIES_MISREAD,
    ppe: GROSS,
  }),
);
assert(badGap.gap === -36_000, `mis-read sheet gap ${badGap.gap}`);

const fixedGap = balanceSheetCheck(
  figures({
    assets: ASSETS_NET,
    equity: EQUITY,
    liabilities: LIABILITIES,
    ppe: NET_PPE,
    revenue: 171_000,
    cogs: 80_000,
    opex: 40_000,
  }),
);
assert(fixedGap.gap === 0, `net sheet gap ${fixedGap.gap}`);
assert(fixedGap.currentPeriodProfit == null, "closed equity is not inflated with profit");

const portal = reconcileExtractionResult(
  {
    entity_name: "Harbour & Co (Pty) Ltd",
    registration_number: null,
    currency: "ZAR",
    units: "actual",
    statement_basis: "management_accounts",
    current_period: {
      period_end: "2026-09-30",
      figures: figures({
        assets: ASSETS_GROSS,
        equity: EQUITY_MISREAD,
        liabilities: LIABILITIES,
        ppe: GROSS,
        revenue: 171_000,
      }),
    },
    comparative_period: null,
    extraction_notes: null,
  },
  TB_TEXT,
);
const portalSheet = portal.current_period.figures.balance_sheet;
assert(portalSheet.non_current_assets.property_plant_equipment === NET_PPE, "portal PPE is net");
assert(
  portalSheet.non_current_assets.total === NET_PPE,
  "portal non-current total follows net PPE",
);
assert(portalSheet.total_assets === ASSETS_NET, "portal total assets are net");
assert(portalSheet.equity.total === EQUITY, "portal equity stays the printed total");
assert(portal.current_period.figures.income_statement.revenue === 171_000, "portal revenue stays");

const redacted = statementModelParts({
  extractedText: TB_TEXT,
  document: { mediaType: "application/pdf", base64: "JVBERi0RAW" },
  fileName: "Harbour & Co (Pty) Ltd.pdf",
  instructions: "Extract the trial balance.",
  layout: "financial",
});
assert(redacted.usedTextLayer, "good TB is text, not a document");
assert(
  redacted.parts.every((part) => part.type === "text"),
  "no document part on a good TB",
);
const redactedBody = textOf(redacted.parts);
assert(!redactedBody.includes("JVBERi0RAW"), "raw PDF bytes are not in the text payload");
assert(!redactedBody.includes("Harbour"), "client name is redacted");
assert(!redactedBody.includes("owner@harbour.example"), "email is redacted");
assert(!redactedBody.includes("4123456789"), "VAT number is redacted");
assert(
  /Accumulated depreciation[^\n]*27,000\.00/.test(redactedBody),
  "accum. dep. line survives redaction",
);
assert(
  /Equipment at cost[^\n]*95,000\.00/.test(redactedBody),
  "equipment cost line survives redaction",
);
assert(redactedBody.includes(CASH), "cash amount survives");
assert(redactedBody.includes("150,000.00"), "equity amount survives");
assert(redactedBody.includes("171,000.00"), "revenue amount survives");
assert(redactedBody.includes("Trade receivables"), "receivables label survives");
const redactedContra = readContraAssets(redactedBody);
assert(redactedContra?.net === NET_PPE, "redacted text still nets PPE");

const fallback = statementModelParts({
  extractedText: SCRAMBLED,
  document: { mediaType: "application/pdf", base64: "JVBERi0SCAN" },
  fileName: "Harbour & Co (Pty) Ltd.pdf",
  instructions: "Extract the trial balance.",
  layout: "financial",
});
assert(!fallback.usedTextLayer, "scrambled TB falls back to the document");
assert(
  fallback.parts[0]?.type === "document" && fallback.parts[0].source.data === "JVBERi0SCAN",
  "fallback sends the original bytes",
);
assert(
  !textOf(fallback.parts).includes("95,000.00"),
  "fallback caption does not include the broken body",
);
assert(!textOf(fallback.parts).includes("Harbour"), "fallback caption redacts the file name");

const image = statementModelParts({
  extractedText: "",
  document: { mediaType: "image/png", base64: "iVBORw0KGgo" },
  fileName: "statement-scan.png",
  instructions: "Extract the statement.",
  layout: "financial",
});
assert(!image.usedTextLayer && image.quality.reason === "empty", "an image has no text layer");
assert(
  image.parts[0]?.type === "document" && image.parts[0].source.data === "iVBORw0KGgo",
  "image bytes are unchanged",
);

const goodPdf = loadPdf("STATEMENT_TEXT_LAYER_GOOD_PDF", buildTextPdf(TB_LINES));
const goodB64 = toBase64(goodPdf.bytes);
const preparedGood = await prepareStatementContent({
  base64: goodB64,
  mediaType: "application/pdf",
  fileName: "tb-midyear-sept-2026.pdf",
  instructions: "Extract the trial balance.",
  layout: "financial",
});
assert(preparedGood.usedTextLayer, `${goodPdf.source} PDF was not sent as redacted text`);
assert(
  preparedGood.parts.every((part) => part.type !== "document"),
  `${goodPdf.source} payload still has a document part`,
);
assert(
  !textOf(preparedGood.parts).includes(goodB64),
  `${goodPdf.source} payload contains the raw PDF`,
);
if (goodPdf.source === "synthesized") {
  assert(
    preparedGood.extractedText.includes("Equipment at cost"),
    "unpdf dropped the equipment line",
  );
  assert(
    preparedGood.extractedText.includes("Accumulated depreciation"),
    "unpdf dropped accum. dep.",
  );
  assert(/95,000\.00/.test(preparedGood.extractedText), "unpdf dropped the gross cost");
  assert(/27,000\.00/.test(preparedGood.extractedText), "unpdf dropped accum. dep. amount");
  const fromPdf = reconcileModelTotals({
    text: preparedGood.extractedText,
    totalAssets: ASSETS_GROSS,
    equity: EQUITY_MISREAD,
    ppe: GROSS,
  });
  assert(
    fromPdf.netPpe === NET_PPE && fromPdf.totalAssets === ASSETS_NET && fromPdf.equity === EQUITY,
    "PDF text layer does not net the smoke figures",
  );
  assert(
    /Equipment at cost[^\n]*95,000\.00/.test(textOf(preparedGood.parts)),
    "PDF text path lost the equipment line",
  );
  assert(
    /Accumulated depreciation[^\n]*27,000\.00/.test(textOf(preparedGood.parts)),
    "PDF text path lost accum. dep.",
  );
} else {
  const pair = readContraAssets(preparedGood.extractedText);
  if (pair) {
    assert(
      textOf(preparedGood.parts).includes(String(pair.gross)) ||
        textOf(preparedGood.parts).includes(pair.gross.toLocaleString("en-US")),
      "QA text dropped the PPE cost",
    );
  }
}

const scanPdf = loadPdf("STATEMENT_TEXT_LAYER_SCAN_PDF", buildScanPdf());
const scanB64 = toBase64(scanPdf.bytes);
const scanText = await extractPdfTextLayer(scanB64);
const preparedScan = await prepareStatementContent({
  base64: scanB64,
  mediaType: "application/pdf",
  fileName: "scan.pdf",
  instructions: "Extract the statement.",
  layout: "financial",
});
assert(
  !preparedScan.usedTextLayer,
  `${scanPdf.source} scan was sent as text (${scanText.slice(0, 80)})`,
);
assert(
  preparedScan.parts[0]?.type === "document" && preparedScan.parts[0].source.data === scanB64,
  "scan fallback changed the PDF bytes",
);

const CONTRA_RULE_SNIPPET = "cost minus accumulated depreciation";

const wired = [
  "supabase/functions/extract-financials/index.ts",
  "src/lib/extract-financials.functions.ts",
  "src/lib/extractFinancials.server.ts",
  "src/lib/bankStatements.server.ts",
  "src/lib/cash-from-banks.server.ts",
];
for (const file of wired) {
  const src = readFileSync(resolve(file), "utf8");
  assert(
    src.includes("statementModelParts") || src.includes("prepareStatementContent"),
    `${file} does not use the text-layer gate`,
  );
}
const edge = readFileSync(resolve("supabase/functions/extract-financials/index.ts"), "utf8");
assert(edge.includes("reconcileFlatFinancials"), "edge extract does not net contra-assets");
assert(
  edge.includes("CONTRA_ASSET_EXTRACTION_RULE"),
  "edge prompt does not mention carrying amount",
);
assert(
  readFileSync(resolve("src/lib/contra-assets.ts"), "utf8").includes(CONTRA_RULE_SNIPPET),
  "contra rule text is missing",
);
const portalPrompt = readFileSync(resolve("src/lib/extractFinancials.server.ts"), "utf8");
assert(
  portalPrompt.includes("CONTRA_ASSET_EXTRACTION_RULE"),
  "portal prompt does not mention carrying amount",
);
assert(
  financialExtractionPrompt(ZA_MARKET).includes(CONTRA_RULE_SNIPPET),
  "multi-PDF prompt does not mention carrying amount",
);
assert(
  textExtractionSystem(ZA_MARKET).includes(CONTRA_RULE_SNIPPET),
  "text prompt does not mention carrying amount",
);
assert(
  !redactIdentifiers("Accumulated depreciation (27,000.00)\nEquipment at cost 95,000.00").includes(
    "[ACCOUNT]",
  ),
  "contra lines are not treated as account numbers",
);

console.log("statement text-layer tests passed");
