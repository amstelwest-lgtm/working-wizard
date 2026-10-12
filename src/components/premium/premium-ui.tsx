/**
 * Presentational premium pieces. They render numbers the caller already has.
 * They do not fetch, score, or sign off.
 */

export function PremiumSpark({ values }: { values: readonly number[] }) {
  const series = values.filter((value) => Number.isFinite(value));
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const points = series
    .map((value, index) => {
      const x = (index / (series.length - 1)) * 72;
      const y = 18 - ((value - min) / span) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="premium-spark" viewBox="0 0 72 20" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

export function PremiumKpi({
  label,
  value,
  delta,
  series,
}: {
  label: string;
  value: string;
  delta?: { amount: number; text: string } | null;
  series?: readonly number[] | null;
}) {
  const tone = delta == null || delta.amount === 0 ? "" : delta.amount > 0 ? " is-up" : " is-down";
  const arrow = delta == null ? "" : delta.amount > 0 ? "↑" : delta.amount < 0 ? "↓" : "→";
  return (
    <article className="premium-kpi">
      <span className="premium-kpi-label">{label}</span>
      <strong className="premium-kpi-value">{value}</strong>
      {delta ? (
        <span className={`premium-kpi-delta${tone}`}>
          {arrow} {delta.text}
        </span>
      ) : null}
      {series ? <PremiumSpark values={series} /> : null}
    </article>
  );
}

export function PremiumHealthRing({
  score,
  word,
  line,
}: {
  score: number | null;
  word?: string | null;
  line: string;
}) {
  const shown = score != null && Number.isFinite(score) ? Math.round(score) : null;
  const radius = 42;
  const turn = 2 * Math.PI * radius;
  const dash = shown == null ? 0 : (Math.max(0, Math.min(100, shown)) / 100) * turn;
  return (
    <section className="premium-health" aria-label="Health">
      <div className="premium-health-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="premium-health-track" cx="60" cy="60" r={radius} />
          <circle
            className="premium-health-value"
            cx="60"
            cy="60"
            r={radius}
            strokeDasharray={`${dash} ${turn}`}
          />
        </svg>
        <strong>{shown == null ? "—" : shown}</strong>
        {word ? <span>{word}</span> : null}
      </div>
      <p>{line}</p>
    </section>
  );
}

export function PremiumSteps({
  steps,
}: {
  steps: readonly { label: string; done: boolean; current?: boolean }[];
}) {
  return (
    <ol className="premium-steps" aria-label="Review and sign-off">
      {steps.map((step) => (
        <li key={step.label} className={step.done ? "is-done" : step.current ? "is-current" : ""}>
          <span className="premium-step-mark" aria-hidden="true">
            {step.done ? "✓" : ""}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

const ICONS: Record<string, string> = {
  home: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z",
  health: "M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z",
  cash: "M4 8h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 8l2.2-3h11.6L20 8M8 13h4",
  profit: "M5 16l4.2-5 3 2.6L19 7",
  budget: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h3",
  moves: "M5 12h12M13 7l5 5-5 5",
  plan: "M7 5h10v14H7zM9 9h6M9 13h6",
  reports: "M7 4h7l4 4v12H7zM14 4v4h4",
  books: "M5 6.5A2.5 2.5 0 0 1 7.5 4H19v14H7.5A2.5 2.5 0 0 0 5 20.5z",
  clients: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 19v-1.2A3.8 3.8 0 0 1 7.8 14h.4M16 11a3 3 0 1 0 0-6M14.2 14h.4A3.8 3.8 0 0 1 20 17.8V19",
  practice: "M5 19V9l7-4 7 4v10M9 19v-5h6v5",
  accountant: "M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 19v-1.2A3.8 3.8 0 0 1 7.8 14h.4M14 7h6M14 11h6M14 15h4",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
};

export function PremiumIcon({ id }: { id: string }) {
  const d = ICONS[id];
  if (!d) return null;
  return (
    <svg className="premium-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
