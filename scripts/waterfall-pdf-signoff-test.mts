/**
 * Profitability waterfall PDF: DRAFT watermark follows tab sign-off.
 * Run: pnpm test:waterfall-pdf-signoff
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientReviewSignoff } from "../src/lib/review-signoffs.functions";
import { reviewDeliverableUnsigned } from "../src/lib/review-signoff-stamp";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const signoff: ClientReviewSignoff = {
  id: "p1",
  client_id: "c",
  scope: "profitability",
  signed_off_by_id: "u",
  signed_off_by_name: "Theo",
  signed_off_by_initials: "T",
  signed_off_by_title: null,
  firm_name: "Other Practice",
  note: null,
  signature_data: null,
  signed_off_at: "2026-10-29T10:00:00.000Z",
};

assert(
  reviewDeliverableUnsigned({ signoff, isStale: false }) === false,
  "signed off on the tab — no draft watermark",
);
assert(
  reviewDeliverableUnsigned({ signoff: null, isStale: false }) === true,
  "unsigned — draft watermark",
);
assert(
  reviewDeliverableUnsigned({ signoff, isStale: true }) === false,
  "stale sign-off still counts as signed for the watermark",
);

const frame = read("src/components/pdf/pdf-document.tsx");
assert(frame.includes("draftOn ?"), "watermark respects draftOn (no mark when a stamp is on file)");

const report = read("src/reports/profitability-waterfall.tsx");
assert(report.includes("draft?:"), "waterfall PDF takes an explicit draft flag");
assert(report.includes("draft ??"), "draft defaults to the old stamp-only rule");

const studio = read("src/routes/_authenticated/reports-studio.tsx");
assert(
  studio.includes("reviewDeliverableUnsigned") && studio.includes('draft: !isDemo && unsigned'),
  "Reports studio sets draft from the profitability sign-off",
);

const exportSrc = read("src/components/profitability-waterfall.tsx");
assert(exportSrc.includes("reviewSignoffSource"), "tab export passes the sign-off row for the watermark");

console.log("waterfall-pdf-signoff ok");