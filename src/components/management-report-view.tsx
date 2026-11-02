/**
 * On-screen Advisory Management Report. Schema 2 figures, in the same
 * order as the PDF (cover through notes). Schema 1 stays off this view.
 */
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { packV2SectionTitle } from "@/lib/advisory-pack-schema";
import { formatMoney, type ResolvedMarket } from "@/lib/market";

function money(value: number | null | undefined, market: ResolvedMarket): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatMoney(value, market);
}

function score(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

export function ManagementReportView({
  content,
  market,
}: {
  content: AdvisoryPackContentV2;
  market: ResolvedMarket;
}) {
  const summary = content.sections.find((section) => section.key === "summary");
  const notes = content.sections.find((section) => section.key === "notes");
  const health = content.health;
  const forecast = content.forecast;
  const profit = content.profit;

  return (
    <article className="mt-4 space-y-4" data-management-report="" data-pack-schema="2">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0B5FFF]">
          Advisory Management Report
        </p>
        <h3 className="mt-1 text-lg font-semibold text-[#102A43] dark:text-[#F4F7FB]">
          {content.clientName}
        </h3>
        {content.periodLabel ? (
          <p className="text-sm text-[#3D5270] dark:text-[#C5D4E4]">{content.periodLabel}</p>
        ) : null}
        {summary?.verdict ? (
          <p className="mt-2 text-sm leading-relaxed text-[#102A43] dark:text-[#F4F7FB]" data-report-verdict="">
            {summary.verdict}
          </p>
        ) : null}
      </header>

      <section data-report-health="">
        <h4 className="text-sm font-semibold">{packV2SectionTitle("health")}</h4>
        <p className="mt-1 text-sm">
          Score {score(health?.overall)}
          {health?.label ? ` · ${health.label}` : ""}
          {health?.priorOverall != null ? ` · prior ${score(health.priorOverall)}` : ""}
        </p>
        {health?.pillars?.length ? (
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {health.pillars.map((pillar) => (
              <li key={pillar.id} data-report-pillar={pillar.id}>
                {pillar.label}: {score(pillar.score)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {content.ratios.length ? (
        <section data-report-ratios="">
          <h4 className="text-sm font-semibold">Ratios</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {content.ratios.map((ratio) => (
              <li key={ratio.name}>
                {ratio.name}: {ratio.formatted}
                {ratio.prior != null ? ` (prior ${ratio.prior})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {content.dupont ? (
        <section data-report-dupont="">
          <h4 className="text-sm font-semibold">{packV2SectionTitle("dupont")}</h4>
          <p className="mt-1 text-sm">
            {content.sections.find((section) => section.key === "dupont")?.meaning}
          </p>
        </section>
      ) : null}

      <section data-report-cash="">
        <h4 className="text-sm font-semibold">{packV2SectionTitle("cash")}</h4>
        <p className="mt-1 text-sm">
          Opening {money(forecast?.openingBalance, market)}
          {" · "}
          Lowest {money(forecast?.lowestClosing, market)}
          {forecast?.runwayWeeks != null ? ` · ${forecast.runwayWeeks} weeks of runway` : ""}
        </p>
        {forecast?.weeks?.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {forecast.weeks.slice(0, 13).map((week) => (
              <li key={week.week}>
                {week.label}: in {money(week.cashIn, market)}, out {money(week.cashOut, market)}, close{" "}
                {money(week.closing, market)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[#3D5270] dark:text-[#C5D4E4]">
            {content.sections.find((section) => section.key === "cash")?.meaning}
          </p>
        )}
      </section>

      {profit ? (
        <section data-report-profit="">
          <h4 className="text-sm font-semibold">{packV2SectionTitle("profit")}</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {profit.steps.map((step) => (
              <li key={step.key}>
                {step.label}: {money(step.amount, market)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section data-report-priorities="">
        <h4 className="text-sm font-semibold">{packV2SectionTitle("priorities")}</h4>
        {content.recommendations.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {content.recommendations.map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm">
            {content.sections.find((section) => section.key === "priorities")?.meaning}
          </p>
        )}
      </section>

      {notes?.meaning ? (
        <section data-report-notes="">
          <h4 className="text-sm font-semibold">{packV2SectionTitle("notes")}</h4>
          <p className="mt-1 text-sm leading-relaxed">{notes.meaning}</p>
        </section>
      ) : null}
    </article>
  );
}
