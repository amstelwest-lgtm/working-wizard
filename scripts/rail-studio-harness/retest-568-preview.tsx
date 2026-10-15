/**
 * Local proof of the #568 retest display rules.
 * The figures are a labelled fixture, not a client's books.
 */
import {
  clientListRunwayHeadline,
  clientListStatusWord,
} from "@/lib/cash-forecast-parity";
import { formatFirmClientUsage } from "@/lib/firm-band-upgrade";

const closings = Array.from({ length: 13 }, (_, week) => (week < 7 ? 44_480 : 20_000));

const withForecast = {
  source: "stored" as const,
  opening: 44_480,
  floor: 34_903,
  dipsBelowFloorWeek: 8,
  totalInflow: 120_000,
  totalOutflow: 140_000,
  closings,
};

const empty = {
  source: "derived" as const,
  opening: 0,
  floor: 50_000,
  dipsBelowFloorWeek: 1,
  totalInflow: 0,
  totalOutflow: 0,
  closings: Array.from({ length: 13 }, () => 0),
};

export function Retest568Preview() {
  const dippedStatus = clientListStatusWord({
    healthLabel: "Watch",
    healthOverall: 71,
    ...withForecast,
  });
  const dippedRunway = clientListRunwayHeadline({
    ...withForecast,
    healthOverall: 71,
    runwayLabel: "Cash generative",
    cashGenerative: true,
  });
  const blankStatus = clientListStatusWord({
    healthLabel: "Watch",
    healthOverall: null,
    ...empty,
  });
  const blankRunway = clientListRunwayHeadline({
    ...empty,
    healthOverall: null,
  });
  const plan = formatFirmClientUsage(8, 5, "Starter");

  return (
    <div className="min-h-screen bg-[#F4F7FB] px-4 py-6 text-[#102A43] sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Fixture proof — not a client file
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Retest 568</h1>

      <section className="mt-6 overflow-x-auto rounded-xl border border-[#DBEAFE] bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#DBEAFE] text-xs uppercase tracking-wide text-[#3D5270]">
              <th className="px-4 py-3 font-semibold">Row</th>
              <th className="px-4 py-3 font-semibold">Runway</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#DBEAFE]">
              <td className="px-4 py-3">Cash under the floor</td>
              <td className="px-4 py-3">{dippedRunway}</td>
              <td className="px-4 py-3 font-semibold">{dippedStatus}</td>
            </tr>
            <tr>
              <td className="px-4 py-3">No forecast</td>
              <td className="px-4 py-3">{blankRunway}</td>
              <td className="px-4 py-3">{blankStatus}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Plan</h2>
        <p className="mt-2 text-sm">Starter</p>
        <p className="text-xs text-[#3D5270]">Up to 5 active clients</p>
        <p className="text-xs text-[#3D5270]">{plan}</p>
      </section>
    </div>
  );
}
