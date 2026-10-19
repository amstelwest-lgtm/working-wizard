/**
 * SAMPLE advisory pack for the public demo. Built from the board the visitor
 * already has. No ledger, no pack row, no sign-off write.
 */
import { SAMPLE_BUSINESS_NAME } from "@/lib/sample-business";
import type { TrialBoard } from "@/lib/trial-demo";

export type SamplePackSection = {
  title: string;
  body: string;
  bullets?: string[];
};

export type SampleAdvisoryPack = {
  stamp: "SAMPLE";
  clientName: string;
  title: string;
  sections: SamplePackSection[];
};

function ratio(board: TrialBoard, name: string): string | null {
  const display = board.ratios.find((row) => row.name === name)?.display;
  return display && display.trim() ? display : null;
}

export function buildSampleAdvisoryPack(board: TrialBoard): SampleAdvisoryPack {
  const score = board.health.score == null ? "—" : String(Math.round(board.health.score));
  const label = board.health.label || "Unscored";
  const gross = ratio(board, "Gross Margin");
  const net = ratio(board, "Net Margin");
  const debtors = ratio(board, "Debtor Days");
  const current = ratio(board, "Current Ratio");

  const matters: string[] = [];
  if (gross) matters.push(`Gross margin is ${gross}.`);
  if (net) matters.push(`Net margin is ${net}.`);
  if (debtors) matters.push(`Customers pay in ${debtors}.`);
  if (current) matters.push(`Current assets cover current liabilities ${current} times.`);

  const moves = [
    debtors
      ? `Ask for faster payment. Customers take ${debtors} on this sample.`
      : "Ask for faster payment before the next cycle.",
    gross && net
      ? `Gross margin is ${gross} and net margin is ${net}. The gap is the cost of running the business.`
      : "Name the gap between gross margin and what is left after the cost of running the business.",
    "Keep the 13-week line labelled as an estimate until a real cash balance is on file.",
  ];

  return {
    stamp: "SAMPLE",
    clientName: SAMPLE_BUSINESS_NAME,
    title: "Advisory pack",
    sections: [
      {
        title: "Headline",
        body: `${SAMPLE_BUSINESS_NAME} is a sample services business. Health is ${score}, ${label}. This pack is labelled SAMPLE. It is not a live client.`,
      },
      {
        title: "What matters",
        body: "The Advisor is working from the same ratios already on this page.",
        bullets: matters,
      },
      {
        title: "Moves",
        body: "Three moves a firm can put in front of the owner.",
        bullets: moves,
      },
      {
        title: "Next step",
        body: "Sign off this sample here, or schedule a call and walk the same pack on a real client. Signing off in the demo does not write anything.",
      },
      {
        title: "Disclosure",
        body: "Prepared from sample figures. Not reviewed by an accountant. Nothing in this pack is saved to a client record.",
      },
    ],
  };
}
