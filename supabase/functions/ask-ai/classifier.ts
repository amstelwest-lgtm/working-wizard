import type { DisclosureTier } from "./types.ts";

/**
 * Classifies a question into a disclosure tier so we send the
 * minimum context needed to answer it.
 *
 * none     — generic / definitional (no client data required)
 * summary  — needs overall health / score only
 * focused  — needs one specific pillar of ratios
 * full     — needs all ratio data (comparative, priority, hiring, affordability)
 */

const DEFINITIONAL = [
  /what\s+is\s+(a|an|the)\s+/i,
  /define\s+/i,
  /explain\s+/i,
  /how\s+(do|does|is|are)\s+.+(calculat|work|measur)/i,
  /meaning\s+of/i,
  /formula\s+for/i,
];

/**
 * Full-context intent patterns — these questions require all ratios and
 * industry benchmarks to give grounded, data-backed answers.
 *
 * Covers:
 *  - Comparative / benchmarking intent ("vs industry", "weakest", "strongest")
 *  - Priority / focus intent ("most important", "biggest issue", "where to start")
 *  - Affordability / hiring intent ("can I afford", "hire", "invest", "new role")
 *  - General diagnostic ("what's wrong", "overall health", "should I worry")
 */
const FULL_CONTEXT_INTENTS: RegExp[] = [
  // Industry / benchmarking
  /vs\.?\s+industry/i,
  /compared?\s+to\s+(industry|sector|benchmark|peers)/i,
  /industry\s+(average|median|benchmark|standard)/i,
  /\bbenchmark/i,
  /how\s+(do\s+i\s+)?compare/i,
  /\bweakest\b/i,
  /\bstrongest\b/i,

  // Priority / focus
  /\b(biggest|most|worst|highest)\s+(issue|problem|risk|priority|concern|leak|drag)/i,
  /what\s+should\s+i\s+focus/i,
  /where\s+(should|do)\s+i\s+start/i,
  /most\s+important/i,
  /\bpriority\b/i,
  /\bprioritize\b/i,
  /what('?s|is)\s+(my\s+)?(biggest|main|top)\b/i,

  // Affordability / hiring / investment
  /\bafford\b/i,
  /\bhire\b/i,
  /\bhiring\b/i,
  /can\s+i\s+(invest|expand|grow|scale)/i,
  /\bnew\s+(hire|role|staff|employee|headcount)\b/i,
  /\bcapacity\b/i,

  // General diagnostic
  /what('?s|\s+is)\s+(wrong|the\s+issue|the\s+problem)/i,
  /overall\s+health/i,
  /\bhealthy\b/i,
  /should\s+i\s+worry/i,
  /\boverall\b/i,
];

const PILLAR_PATTERNS: Record<string, RegExp> = {
  cash: /cash|liquidity|runway|payable|receivable|debtor|creditor|working capital/i,
  profit: /margin|profit|ebit|ebitda|net income|operating/i,
  leverage: /debt|leverage|equity|solvency|loan|borrow/i,
  efficiency: /asset|turnover|inventory|stock|utilisation/i,
  risk: /fixed cost|operating leverage|concentration|customer/i,
};

export function classify(question: string): DisclosureTier {
  // Definitional questions need no client data
  for (const re of DEFINITIONAL) {
    if (re.test(question)) return "none";
  }

  // Full-context intents: comparative, priority, affordability
  for (const re of FULL_CONTEXT_INTENTS) {
    if (re.test(question)) return "full";
  }

  // Pillar-focused questions
  const pillarsMatched = Object.values(PILLAR_PATTERNS).filter((re) => re.test(question)).length;
  if (pillarsMatched >= 2) return "full";
  if (pillarsMatched === 1) return "focused";

  // Default: overall health score only
  return "summary";
}

export function pillarsFor(question: string): string[] {
  return Object.entries(PILLAR_PATTERNS)
    .filter(([, re]) => re.test(question))
    .map(([name]) => name);
}
