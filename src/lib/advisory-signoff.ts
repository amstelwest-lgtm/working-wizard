/**
 * One sign-off for the advisory pack.
 *
 * The current pack is the source of truth: `advisory_packs.status`, the
 * approve row in `advisory_pack_reviews`, and whether those baked figures
 * still match Overview. A `client_review_signoffs` row with scope `advisory`
 * is a leftover page stamp. It is not a pack sign-off, and this module
 * never writes it.
 *
 *   import { getAdvisorySignoffState } from "../../../src/lib/advisory-signoff.ts";
 *   const state = await getAdvisorySignoffState(clientId, supabase);
 *
 * Pass the caller's Supabase client (the Bot's user-scoped client, or the
 * app's). This module does not import the Vite client, so an edge function
 * can load it.
 *
 * `status` is `draft | in_review | signed | signed_stale`.
 */
import { recordedActorIdentity } from "@/lib/accountant-identity";
import {
  advisoryPackSignOffGate,
  isMissingPackRelation,
  livePackMetrics,
  parsePackRow,
  type PackStatus,
} from "@/lib/advisory-pack";
import { parseOperatingProfile } from "@/lib/client-profile";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { coerceMarketSelection } from "@/lib/market/parse";
import { resolveMarket } from "@/lib/market/resolve";
import { resolvePriorSnapshot } from "@/lib/prior-period";
import { isSamplePracticeSignoff, packDisplayedSignoffLine } from "@/lib/review-signoff-stamp";

export const ADVISORY_SIGNOFF_STATUSES = ["draft", "in_review", "signed", "signed_stale"] as const;
export type AdvisorySignoffStatus = (typeof ADVISORY_SIGNOFF_STATUSES)[number];

export type AdvisorySignoffState = {
  status: AdvisorySignoffStatus;
  version: number | null;
  signedBy: string | null;
  firmName: string | null;
  signedAt: string | null;
  /** IANA zone the sign-off clock uses. US practices are the state zone. */
  zone: string | null;
  reviewedByKind: "accountant" | "owner" | null;
};

/** What the tab badge needs from the pack panel. The panel owns the write. */
export type AdvisorySignoffAction = {
  state: AdvisorySignoffState;
  /** Same sentence the pack header prints. Null until this version is approved. */
  line: string | null;
  canSignOff: boolean;
  blocked: boolean;
  busy: boolean;
  signOff: () => void;
};

type QueryError = { message?: string; code?: string } | null;
type QueryResult = { data: unknown; error: QueryError };

export interface AdvisorySignoffQuery {
  select(columns: string): AdvisorySignoffQuery;
  eq(column: string, value: string): AdvisorySignoffQuery;
  in(column: string, values: readonly string[]): AdvisorySignoffQuery;
  order(column: string, options: { ascending: boolean }): AdvisorySignoffQuery;
  limit(count: number): AdvisorySignoffQuery;
  maybeSingle(): Promise<QueryResult>;
  then<T>(
    onfulfilled: (value: QueryResult) => T | PromiseLike<T>,
    onrejected?: (reason: unknown) => T | PromiseLike<T>,
  ): Promise<T>;
}

/**
 * Any Supabase client (browser or the Bot's user-scoped client).
 * `from` is loose so a generated client type-checks without a cast.
 */
export type AdvisorySignoffDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text || null;
}

function statusOf(packStatus: string | null, figuresChanged: boolean): AdvisorySignoffStatus {
  if (packStatus === "approved") return figuresChanged ? "signed_stale" : "signed";
  if (packStatus === "in_review") return "in_review";
  return "draft";
}

/**
 * Map one pack version onto the shared sign-off state.
 * Signer fields are filled only for a stored approval (`signed` or `signed_stale`).
 */
export function resolveAdvisorySignoffState(input: {
  version?: number | null;
  packStatus?: PackStatus | string | null;
  figuresChanged?: boolean;
  signedBy?: string | null;
  firmName?: string | null;
  signedAt?: string | null;
  reviewedByKind?: string | null;
  zone?: string | null;
}): AdvisorySignoffState {
  const version =
    typeof input.version === "number" && Number.isFinite(input.version) && input.version > 0
      ? input.version
      : null;
  const zone = clean(input.zone);
  const packStatus = version ? (input.packStatus ?? null) : null;
  const status = statusOf(packStatus, input.figuresChanged === true);
  const approved = status === "signed" || status === "signed_stale";
  const kind =
    input.reviewedByKind === "accountant" || input.reviewedByKind === "owner"
      ? input.reviewedByKind
      : null;
  const signedBy = approved ? clean(input.signedBy) : null;
  const firmName = approved ? clean(input.firmName) : null;
  if (signedBy && isSamplePracticeSignoff({ name: signedBy, firmName })) {
    return {
      status,
      version,
      signedBy: null,
      firmName: null,
      signedAt: approved ? clean(input.signedAt) : null,
      zone,
      reviewedByKind: kind,
    };
  }
  return {
    status,
    version,
    signedBy,
    firmName,
    signedAt: approved ? clean(input.signedAt) : null,
    zone,
    reviewedByKind: approved ? kind : null,
  };
}

/** Header sentence. Matches the pack panel, including the stale clause. */
export function advisorySignoffLine(
  state: AdvisorySignoffState,
  market?: Pick<ResolvedMarket, "locale" | "timezone">,
): string | null {
  if (state.status !== "signed" && state.status !== "signed_stale") return null;
  return packDisplayedSignoffLine({
    signedOff: true,
    figuresChanged: state.status === "signed_stale",
    reviewedByKind: state.reviewedByKind,
    reviewedAt: state.signedAt,
    name: state.signedBy,
    firmName: state.firmName,
    market,
    firmTimeZone: state.zone,
  });
}

function monthDay(iso: string, market?: Pick<ResolvedMarket, "locale" | "timezone">): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(market?.locale ?? "en-US", {
    month: "short",
    day: "numeric",
    timeZone: market?.timezone ?? "UTC",
  })
    .format(date)
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ");
}

/**
 * A page-level advisory stamp beside an unsigned pack.
 * Null when the pack itself is signed, or when there is no page stamp.
 * Never a "signed" status — the caller must not render a signed badge from it.
 */
export function advisoryLegacyMismatchLine(input: {
  status: AdvisorySignoffStatus;
  version: number | null;
  pageSignedAt?: string | null;
  pageSignedBy?: string | null;
  pageFirmName?: string | null;
  market?: Pick<ResolvedMarket, "locale" | "timezone">;
}): string | null {
  if (input.status === "signed" || input.status === "signed_stale") return null;
  const name = clean(input.pageSignedBy);
  const when = clean(input.pageSignedAt);
  if (!name || !when) return null;
  if (isSamplePracticeSignoff({ name, firmName: input.pageFirmName })) return null;
  const date = monthDay(when, input.market);
  if (input.version == null) {
    return `Advisory signed off ${date} by ${name}, but no pack is on file; generate a pack before sign-off.`;
  }
  return `Advisory signed off ${date} by ${name}, but pack v${input.version} isn't signed; sign off v${input.version}`;
}

function emptyState(zone: string | null = null): AdvisorySignoffState {
  return {
    status: "draft",
    version: null,
    signedBy: null,
    firmName: null,
    signedAt: null,
    zone,
    reviewedByKind: null,
  };
}

async function rowsOf(query: AdvisorySignoffQuery): Promise<Record<string, unknown>[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message ?? "Query failed");
  return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
}

async function oneOf(query: AdvisorySignoffQuery): Promise<Record<string, unknown> | null> {
  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message ?? "Query failed");
  const row = result.data;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

/**
 * Sign-off state for the current pack version.
 * `db` is the caller's Supabase client. The Bot passes its user-scoped client.
 */
export async function getAdvisorySignoffState(
  clientId: string,
  db: AdvisorySignoffDb,
): Promise<AdvisorySignoffState> {
  const id = clientId.trim();
  if (!id) return emptyState();
  const client = db;

  let packRow: Record<string, unknown> | null = null;
  try {
    packRow = await oneOf(
      client
        .from("advisory_packs")
        .select("*")
        .eq("client_id", id)
        .order("version", { ascending: false })
        .limit(1),
    );
  } catch (err) {
    if (isMissingPackRelation(err)) return emptyState();
    throw err;
  }

  const clientRow = await oneOf(
    client
      .from("clients")
      .select("firm_id, financials, cashflow, financials_updated_at, market, operating_profile")
      .eq("id", id),
  );
  let market = ZA_MARKET;
  try {
    market = resolveMarket(coerceMarketSelection(clientRow?.market));
  } catch {
    market = ZA_MARKET;
  }
  const zone = market.timezone;
  if (!packRow) return emptyState(zone);

  const pack = parsePackRow(packRow);
  const profile = parseOperatingProfile(clientRow?.operating_profile);
  const financials =
    clientRow?.financials &&
    typeof clientRow.financials === "object" &&
    !Array.isArray(clientRow.financials)
      ? (clientRow.financials as Record<string, unknown>)
      : null;
  const snaps = await rowsOf(
    client
      .from("client_financial_snapshots")
      .select("id, period_label, period_date, ratios, financials")
      .eq("client_id", id)
      .order("period_date", { ascending: false })
      .limit(24),
  );
  const prior = resolvePriorSnapshot(
    snaps.map((snap) => ({
      id: typeof snap.id === "string" ? snap.id : undefined,
      period_label: typeof snap.period_label === "string" ? snap.period_label : "",
      period_date: typeof snap.period_date === "string" ? snap.period_date : "",
      financials:
        snap.financials && typeof snap.financials === "object" && !Array.isArray(snap.financials)
          ? (snap.financials as Record<string, unknown>)
          : null,
      ratios:
        snap.ratios && typeof snap.ratios === "object" && !Array.isArray(snap.ratios)
          ? (snap.ratios as Record<string, number>)
          : null,
    })),
    new Date(),
    {
      financials,
      periodEnd: typeof financials?.periodEnd === "string" ? financials.periodEnd : null,
    },
  );
  const metrics = livePackMetrics({
    financials,
    cashflow: clientRow?.cashflow,
    financialsUpdatedAt:
      typeof clientRow?.financials_updated_at === "string" ? clientRow.financials_updated_at : null,
    priorFinancials: prior?.financials ?? null,
    market,
    fyStartMonth: profile?.fyStartMonth ?? market.fyStartMonthDefault,
    timeZone: zone,
    now: new Date(),
  });
  const gate = advisoryPackSignOffGate(
    pack.status,
    pack.requires_review,
    pack.content,
    metrics.figures,
  );

  let firmName: string | null = null;
  const firmId = typeof clientRow?.firm_id === "string" ? clientRow.firm_id : null;
  if (firmId) {
    const firm = await oneOf(client.from("firms").select("name").eq("id", firmId));
    firmName = typeof firm?.name === "string" ? firm.name : null;
  }
  let signedBy: string | null = null;
  if (pack.reviewed_by && pack.status === "approved") {
    const person = await oneOf(
      client.from("profiles").select("full_name, email").eq("id", pack.reviewed_by),
    );
    const identity = recordedActorIdentity({
      profileFullName: typeof person?.full_name === "string" ? person.full_name : null,
      email: typeof person?.email === "string" ? person.email : null,
      clientFirmName: firmName,
    });
    signedBy = identity?.name ?? null;
    if (identity?.firmName) firmName = identity.firmName;
  }

  return resolveAdvisorySignoffState({
    version: pack.version,
    packStatus: pack.status,
    figuresChanged: gate.figuresChanged,
    signedBy,
    firmName,
    signedAt: pack.reviewed_at,
    reviewedByKind: pack.reviewed_by_kind,
    zone,
  });
}
