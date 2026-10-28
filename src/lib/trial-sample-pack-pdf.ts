/**
 * SAMPLE advisory pack PDF for /try.
 * Same react-pdf shell as a signed pack, stamped SAMPLE, filled from the
 * board already on the page. No pack row and no usage write.
 */
import type { AccountantProfile } from "@/contexts/accountant-profile";
import {
  advisoryPackPdfFilename,
  pdfSafeText,
  type AdvisoryPackPdfSection,
} from "@/lib/advisory-pack-pdf";
import { resolveMarket } from "@/lib/market/resolve";
import type { ResolvedMarket } from "@/lib/market";
import { trialMarketSelection } from "@/lib/trial-sample-view";
import { trialReading, type TrialBoard } from "@/lib/trial-demo";
import { buildSampleAdvisoryPack } from "@/lib/trial-sample-pack";

const TRIAL_PACK_PROFILE: AccountantProfile = {
  firmName: "Milon",
  logoUrl: null,
  primaryColor: "#102A43",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "Milon Advisor",
  accountantEmail: "",
  tagline: "Sample advisory pack",
  signatureDataUrl: null,
};

export type TrialSamplePackPdfInput = {
  filename: string;
  clientName: string;
  period: string;
  sections: AdvisoryPackPdfSection[];
  disclosure: string;
  market: ResolvedMarket;
  profile: AccountantProfile;
};

function filled(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}

/** Sections and stamp copy for the sample PDF. Same numbers as the on-screen pack. */
export function trialSamplePackPdfInput(
  board: TrialBoard,
  options?: { signed?: boolean; now?: Date },
): TrialSamplePackPdfInput {
  const pack = buildSampleAdvisoryPack(board, { signed: options?.signed });
  const reading = trialReading(board, options?.now);
  const score = board.health.score == null ? null : String(Math.round(board.health.score));
  const pillars = board.health.pillars
    .filter((pillar) => pillar.score != null)
    .map((pillar) => {
      const points = String(Math.round(pillar.score as number));
      return pillar.status
        ? `${pillar.label}: ${points}, ${pillar.status}`
        : `${pillar.label}: ${points}`;
    });

  const sections: AdvisoryPackPdfSection[] = [];
  for (const section of pack.sections) {
    if (section.title === "Disclosure") continue;
    if (section.title === "Headline") {
      sections.push({
        title: section.title,
        body: section.body,
        bullets: pillars.length > 0 ? pillars : section.bullets,
      });
      continue;
    }
    if (section.title === "What matters") {
      const extra = [
        filled(reading.revenue) ? `Revenue is ${reading.revenue}.` : null,
        filled(reading.netProfit) ? `Net profit is ${reading.netProfit}.` : null,
      ].filter((line): line is string => Boolean(line));
      sections.push({
        title: section.title,
        body: section.body,
        bullets: [...extra, ...(section.bullets ?? [])],
      });
      continue;
    }
    if (section.title === "Next step") continue;
    if (section.title === "Moves") {
      const opening = filled(reading.cashOpening);
      const low = filled(reading.cashLow);
      const close = filled(reading.cashClose);
      if (opening && low && close) {
        sections.push({
          title: "Cash",
          body: `Opening cash is ${opening}. The low point on the 13-week line is ${low}. Week 13 closes at ${close}.`,
        });
      }
      const next = pack.sections.find((item) => item.title === "Next step")?.body;
      sections.push({
        title: section.title,
        body: section.body,
        bullets: [...(section.bullets ?? []), ...(next ? [next] : [])],
      });
      continue;
    }
    sections.push({
      title: section.title,
      body: section.body,
      bullets: section.bullets,
    });
  }

  const disclosure =
    pack.sections.find((section) => section.title === "Disclosure")?.body ??
    "Prepared from sample figures. Not reviewed by an accountant.";

  return {
    filename: advisoryPackPdfFilename(pack.clientName, null),
    clientName: pdfSafeText(pack.clientName),
    period: score ? `SAMPLE · Health ${score}` : "SAMPLE",
    sections: sections.map((section) => ({
      title: pdfSafeText(section.title),
      body: pdfSafeText(section.body),
      bullets: section.bullets?.map((bullet) => pdfSafeText(bullet)),
    })),
    disclosure: pdfSafeText(disclosure),
    market: resolveMarket(trialMarketSelection(board.market)),
    profile: TRIAL_PACK_PROFILE,
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Render the sample pack and start a download. Uses the shared advisory PDF shell. */
export async function downloadTrialAdvisoryPackPdf(
  board: TrialBoard,
  options?: { signed?: boolean; now?: Date },
): Promise<{ filename: string }> {
  const input = trialSamplePackPdfInput(board, options);
  const [{ pdf }, { AdvisoryPackPDF }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/reports/advisory-pack"),
  ]);
  const blob = await pdf(
    AdvisoryPackPDF({
      smeData: { name: input.clientName, period: input.period },
      accountantProfile: input.profile,
      sections: input.sections,
      draftDisclosure: input.disclosure,
      sample: true,
      market: input.market,
    }) as Parameters<typeof pdf>[0],
  ).toBlob();
  triggerDownload(blob, input.filename);
  return { filename: input.filename };
}
