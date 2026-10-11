/**
 * Quiet CTA used wherever we mention missing history / trend / movement.
 */

type Props = {
  onOpen: () => void;
  label?: string;
  className?: string;
};

export function AddPastPeriodLink({
  onOpen,
  label = "Add a past period",
  className,
}: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        className ??
        "inline-flex items-center rounded-md px-0.5 text-[11px] font-medium text-[#102A43] underline decoration-[#0B5FFF]/50 underline-offset-2 transition-colors hover:text-[#6b4e06] hover:decoration-[#0B5FFF] dark:text-[#F4F7FB] dark:hover:text-[#F4F7FB]"
      }
    >
      {label}
    </button>
  );
}
