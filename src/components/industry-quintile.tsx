/**
 * Five-band “where you sit vs industry” graphic used on complex owner ratios.
 * Inactive cells must read on both light paper and dark slate — a dark-only
 * fill made four of the five ticks vanish in light mode.
 */

const BANDS = [
  "bg-rose-600",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-600",
] as const;

type Props = {
  health: number;
  title?: string;
};

export function IndustryQuintile({ health, title }: Props) {
  const quintile = Number.isFinite(health)
    ? Math.min(5, Math.max(1, Math.ceil(health / 20)))
    : 0;
  return (
    <div
      className="inline-flex items-center gap-[3px] rounded-md bg-slate-100 px-1 py-1 ring-1 ring-slate-300/90 dark:bg-slate-800 dark:ring-slate-600"
      title={title}
      role="img"
      aria-label={quintile ? `Industry band ${quintile} of 5` : "No industry comparison"}
    >
      {BANDS.map((active, qi) => (
        <div
          key={qi}
          className={`h-2.5 w-3 rounded-[3px] sm:h-3 sm:w-4 ${
            qi === quintile - 1
              ? `${active} ring-1 ring-black/20 dark:ring-white/25`
              : "bg-slate-300 dark:bg-slate-600"
          }`}
        />
      ))}
    </div>
  );
}
