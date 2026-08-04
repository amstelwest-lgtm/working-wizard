/**
 * Sanitises user questions before they reach the model.
 * Strips: VAT/tax numbers, bank account numbers, company names (heuristic),
 * prompt-injection attempts, and excessive whitespace.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // SA VAT numbers  (4xxxxxxxx)
  [/\b4\d{8}\b/g, "[VAT_NUMBER]"],
  // Common bank account patterns  (10–12 digit runs)
  [/\b\d{10,12}\b/g, "[ACCOUNT_NUMBER]"],
  // "Acme (Pty) Ltd" style names
  [/\b[A-Z][a-zA-Z]+\s+(Pty|Ltd|CC|Inc|Corp|Group|Holdings|Trading)\b\.?/g, "[COMPANY_NAME]"],
  // Prompt injection signals
  [/ignore\s+(previous|all|prior|above)\s+(instructions?|prompt[s]?)/gi, "[FILTERED]"],
  [/you\s+are\s+now\s+/gi, "[FILTERED]"],
  [/jailbreak|DAN\s+mode/gi, "[FILTERED]"],
  // Excessive whitespace
  [/\s{3,}/g, " "],
];

export function sanitize(question: string): string {
  let q = question.trim().slice(0, 1000);
  for (const [re, replacement] of PATTERNS) {
    q = q.replace(re, replacement);
  }
  return q;
}
