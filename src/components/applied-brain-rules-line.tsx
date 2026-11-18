import { appliedBrainRulesLine } from "@/lib/milon-brain-rules";

/** Accountant seat only — owners never see rule text or ids. */
export function AppliedBrainRulesLine({
  evidence,
  audience,
}: {
  evidence: unknown;
  audience: "owner" | "accountant";
}) {
  if (audience !== "accountant") return null;
  const line = appliedBrainRulesLine(evidence);
  if (!line) return null;
  return (
    <p className="milon-desk-hint" data-applied-brain-rules="true">
      {line}
    </p>
  );
}
