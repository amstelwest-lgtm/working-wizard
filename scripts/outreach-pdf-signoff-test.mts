/**
 * Outreach PDF sign-off, sample stamp, and the advisory-pack currency fixes.
 * Run: pnpm test:outreach-pdf-signoff
 */
import { buildAdvisoryPack, packSectionsForPdf, signedPackNextStep } from "../src/lib/advisory-pack";
import { groundAdvisoryNarrative } from "../src/lib/advisory-narrative";
import { humanizeInternalFieldNames, humanQuestionLabel } from "../src/lib/client-brain-questions";
import { spellForMarket } from "../src/lib/market";
import { resolveMarket } from "../src/lib/market/resolve";
import { SAMPLE_STAMP_LINE, SAMPLE_STAMP_WORD } from "../src/lib/pdf-sample";
import { presentScorecardRatio } from "../src/lib/report-coherence";
import {
  pdfSignoffBadgeLine,
  signoffFooterSegments,
  stampFromSignoff,
} from "../src/lib/review-signoff-stamp";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const us = resolveMarket({ country: "US", regionCode: "NY" });

{
  const line = pdfSignoffBadgeLine(
    {
      signedOffByName: "James Fleming",
      firmName: "Ben Accountants",
      signedOffAt: "2026-10-07T23:01:00.000Z",
    },
    us,
  );
  assert(
    line === "Reviewed & signed off · James Fleming · Ben Accountants · Oct 7, 2026, 7:01 PM EDT",
    line,
  );
}

{
  const segments = signoffFooterSegments(
    {
      signedOffByName: "James Fleming",
      signedOffByInitials: "JF",
      signedOffByTitle: null,
      firmName: "Ben Accountants",
    },
    "Oct 7, 2026, 7:01 PM EDT",
  );
  assert(segments[0] === "Reviewed & signed off by", segments.join(" | "));
  assert(segments.slice(1).every((part) => part.startsWith("·\u00A0")), segments.join(" | "));
  assert(!segments[0].endsWith("·"), "the first segment does not end on a separator");
}

{
  const stamp = stampFromSignoff(
    {
      id: "1",
      client_id: "2",
      scope: "financials",
      signed_off_by_id: "3",
      signed_off_by_name: "Alex Rivera, CPA (fictional)",
      signed_off_by_initials: "AR",
      signed_off_by_title: null,
      firm_name: "Northwind Advisory (Sample)",
      note: null,
      signature_data: null,
      signed_off_at: "2026-10-07T23:01:00.000Z",
    },
    false,
    { clientFirmName: "Northwind Advisory (Sample)" },
  );
  assert(stamp?.signedOffByName === "Alex Rivera, CPA (fictional)", "sample outreach firm is a real stamp");
  assert(
    stampFromSignoff(
      {
        id: "1",
        client_id: "2",
        scope: "financials",
        signed_off_by_id: "3",
        signed_off_by_name: "A. Sample",
        signed_off_by_initials: "AS",
        signed_off_by_title: null,
        firm_name: "Sample Practice",
        note: null,
        signature_data: null,
        signed_off_at: "2026-10-07T23:01:00.000Z",
      },
      false,
    ) === null,
    "the demo persona is still dropped",
  );
}

{
  const pack = buildAdvisoryPack({
    clientName: "QA US Test LLC",
    firmName: "Ben Accountants",
    hasFirm: true,
    periodLabel: "September 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-09-30",
    health: null,
    ratios: { "Creditor Days": 37 },
    priorRatios: null,
    openingBalance: 128450,
    closings: Array.from({ length: 13 }, () => 134200),
    cashRunwayWeeks: null,
    runwayLabel: "Profitable on the P&L — add a cash-flow statement or bank balance to estimate runway",
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: "2026-10-07T23:01:00.000Z",
    currency: "USD",
  });
  const forecast = pack.sections.find((s) => s.key === "forecast")!.body;
  const state = pack.sections.find((s) => s.key === "state_of_business")!.body;
  assert(forecast.includes("$128,450"), forecast);
  assert(forecast.includes("$134,200"), forecast);
  assert(state.includes("$50,000"), state);
  assert(!forecast.includes("R128") && !state.includes("R50") && !state.includes("R 50"), state);
  assert(
    pack.sections.some((s) => s.key === "recommendations"),
    "empty recommendations stay in the stored pack",
  );
  const shown = packSectionsForPdf(pack.sections, { signed: false });
  assert(!shown.some((s) => s.key === "recommendations"), "empty recommendations are hidden on the PDF");
  const signed = packSectionsForPdf(pack.sections, { signed: true, firmName: "Ben Accountants" });
  const next = signed.find((s) => s.key === "next_step")!.body;
  assert(next === signedPackNextStep("Ben Accountants"), next);
  assert(!next.includes("reviews this pack first"), next);
}

{
  const leaked = "The profile field operating_profile.payMotion is still internal.";
  assert(humanizeInternalFieldNames(leaked) === "The profile field How they earn is still internal.", leaked);
  assert(humanQuestionLabel("operating_profile.payMotion") === "How they earn", "brain meta uses a label");
}

{
  const grounded = groundAdvisoryNarrative(
    "At 73 creditor days the business is stretching payables significantly. With a 0.16 operating margin there is limited buffer.",
    { "Creditor Days": 37, "Operating Margin": 0.086 },
  );
  assert(grounded.includes("37"), grounded);
  assert(!/stretching payables significantly/i.test(grounded), grounded);
  assert(/healthy band/i.test(grounded), grounded);
}

{
  const usCopy = spellForMarket("This roadmap prioritises 4 steps. Wave 2 — Stabilise", { copyPack: "us" });
  assert(usCopy.includes("prioritizes") && usCopy.includes("Stabilize"), usCopy);
  const zaCopy = spellForMarket("This roadmap prioritises 4 steps. Wave 2 — Stabilise", { copyPack: "za" });
  assert(zaCopy.includes("prioritises") && zaCopy.includes("Stabilise"), zaCopy);
}

{
  const missing = presentScorecardRatio({ name: "OCF / EBITDA", value: Number.NaN });
  const blank = presentScorecardRatio({ name: "OCF / EBITDA", value: 0, cashFlowKnown: false });
  const realZero = presentScorecardRatio({ name: "OCF / EBITDA", value: 0, cashFlowKnown: true });
  assert(!missing.include && !blank.include, "a missing OCF row is not printed");
  assert(realZero.include && realZero.scoredValue === 0, "a stated zero still scores");
}

{
  assert(SAMPLE_STAMP_WORD === "SAMPLE", SAMPLE_STAMP_WORD);
  assert(
    SAMPLE_STAMP_LINE === "Fictional business and reviewer; figures illustrative",
    SAMPLE_STAMP_LINE,
  );
}

console.log("outreach-pdf-signoff: ok");
