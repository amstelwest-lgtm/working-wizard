/**
 * Month-end update PDF for the Advisor chat.
 * Reads or builds the Management Report in memory, then falls back to a
 * short PDF. Nothing is saved, sent, or posted.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { marketForClient } from "@/lib/market/scope";
import { MONTH_END_HELD_LINE } from "@/lib/month-end-update";
import type { AdvisoryPack } from "@/lib/advisory-pack";

const BLANK_PROFILE: AccountantProfile = {
  firmName: "",
  logoUrl: null,
  primaryColor: "#102A43",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "",
  accountantEmail: "",
  tagline: null,
  signatureDataUrl: null,
  timeZone: null,
};

export type MonthEndPdfFile = {
  headline: string;
  filename: string;
  blob: Blob;
  source: "stored" | "preview" | "fallback";
};

type ClientRow = {
  name?: string | null;
  is_demo?: boolean | null;
  market?: unknown;
  financials?: Record<string, unknown> | null;
};

function filenameFor(name: string): string {
  const slug = name
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "client"}-month-end-update.pdf`;
}

function groupNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function figuresFromFinancials(
  financials: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> {
  if (!financials) return [];
  const out: Array<{ label: string; value: string }> = [];
  const asNumber = (key: string) => {
    const value = financials[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const revenue = asNumber("revenue");
  if (revenue != null) out.push({ label: "Revenue", value: groupNumber(revenue) });
  const margin = asNumber("grossMargin");
  if (margin != null) {
    const pct = Math.abs(margin) <= 1 ? margin * 100 : margin;
    out.push({ label: "Gross margin", value: `${pct.toFixed(1)}%` });
  }
  return out;
}

function periodFromFinancials(financials: Record<string, unknown> | null | undefined): string {
  if (!financials) return "";
  const label = financials.periodLabel;
  if (typeof label === "string" && label.trim()) return label.trim();
  const end = financials.periodEnd;
  return typeof end === "string" ? end.trim() : "";
}

async function readClient(clientId: string): Promise<ClientRow | null> {
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("name, is_demo, market, financials")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !data) return null;
    return data as ClientRow;
  } catch {
    return null;
  }
}

async function profileForPdf(): Promise<AccountantProfile> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId || typeof localStorage === "undefined") return BLANK_PROFILE;
    const raw = localStorage.getItem(`milon_accountant_profile:${userId}`);
    if (!raw) return BLANK_PROFILE;
    const parsed = JSON.parse(raw) as Partial<AccountantProfile>;
    return { ...BLANK_PROFILE, ...parsed };
  } catch {
    return BLANK_PROFILE;
  }
}

async function renderPack(pack: AdvisoryPack, sample: boolean, client: ClientRow | null) {
  const { renderAdvisoryPackPdfBlob } = await import("@/lib/advisory-pack-pdf");
  return renderAdvisoryPackPdfBlob({
    pack,
    profile: await profileForPdf(),
    userId: null,
    sample,
    market: marketForClient(client),
  });
}

async function renderFallback(client: ClientRow | null): Promise<{ blob: Blob; filename: string }> {
  const [{ pdf }, { MonthEndFallbackPdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/reports/month-end-fallback-pdf"),
  ]);
  const clientName = client?.name?.trim() || "This client";
  const blob = await pdf(
    MonthEndFallbackPdf({
      clientName,
      period: periodFromFinancials(client?.financials),
      figures: figuresFromFinancials(client?.financials),
    }) as Parameters<typeof pdf>[0],
  ).toBlob();
  return { blob, filename: filenameFor(clientName) };
}

/** Existing pack PDF, a freshly built pack PDF, or the short fallback. */
export async function prepareMonthEndPdf(clientId: string): Promise<MonthEndPdfFile> {
  const id = clientId.trim();
  let client: ClientRow | null = null;
  try {
    const { previewMonthEndPack } = await import("@/lib/advisory-pack.functions");
    const preview = await previewMonthEndPack({ data: { clientId: id } });
    if (preview.ok) {
      client = await readClient(id);
      const rendered = await renderPack(preview.pack, preview.sample || client?.is_demo === true, client);
      return {
        headline: MONTH_END_HELD_LINE,
        filename: rendered.filename,
        blob: rendered.blob,
        source: preview.source,
      };
    }
  } catch {
    /* the pack generator did not return a file */
  }
  try {
    if (!client) client = await readClient(id);
    const fallback = await renderFallback(client);
    return {
      headline: MONTH_END_HELD_LINE,
      filename: fallback.filename,
      blob: fallback.blob,
      source: "fallback",
    };
  } catch {
    throw new Error("month-end pdf unavailable");
  }
}
