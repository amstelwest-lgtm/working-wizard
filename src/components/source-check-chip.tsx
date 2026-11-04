import { sourceCheckForDeliverable } from "@/lib/draft-figures";

type SourceCheckChipProps = {
  writtenAt: string | null | undefined;
  figuresUpdatedAt: string | null | undefined;
  /** milon-desk-source on team feed; home-attn__chip on Needs attention. */
  className?: string;
};

/** One-line books parity for a draft or pack row. Read-only; no ledger writeback. */
export function SourceCheckChip({
  writtenAt,
  figuresUpdatedAt,
  className = "milon-desk-source",
}: SourceCheckChipProps) {
  const { state, label } = sourceCheckForDeliverable(writtenAt, figuresUpdatedAt);
  return (
    <span
      className={className}
      data-source-check={state}
      title="Whether this deliverable still matches the latest books upload or sync."
    >
      Source check · {label}
    </span>
  );
}
