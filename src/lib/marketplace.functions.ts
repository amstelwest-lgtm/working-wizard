/**
 * Accountant marketplace — server functions (P3).
 *
 * Owner side: matches, create / withdraw a request. Firm side: inbox,
 * respond, manage the listing. Reads go through RLS; every write to
 * `accountant_requests` is an RPC so the rules live in SQL.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LooseSb } from "@/lib/advisory-state.functions";
import {
  isMissingMarketplaceRelation,
  normaliseTags,
  type AccountantRequest,
  type FirmListing,
  type FirmMatch,
} from "@/lib/marketplace";

// ── owner ────────────────────────────────────────────────────────────────────

export type FirmMatchesResult = {
  migrated: boolean;
  /** null when the client already has a firm (nothing to match). */
  matches: FirmMatch[] | null;
  requests: AccountantRequest[];
};

export const listFirmMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<FirmMatchesResult> => {
    const sb = context.supabase as unknown as LooseSb;
    const [{ data: matches, error }, reqRes] = await Promise.all([
      sb.rpc("marketplace_match_firms", { p_client_id: data.clientId }),
      sb
        .from("accountant_requests")
        .select("*, firms(name)")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (error) {
      if (isMissingMarketplaceRelation(error))
        return { migrated: false, matches: null, requests: [] };
      if (/already has a firm/i.test(error.message))
        return { migrated: true, matches: null, requests: [] };
      throw new Error(error.message);
    }
    const requests = (reqRes.error ? [] : (reqRes.data ?? [])).map(
      (r: Record<string, unknown>): AccountantRequest => ({
        ...(r as unknown as AccountantRequest),
        firm_name: (r.firms as { name?: string } | null)?.name ?? null,
      }),
    );
    return { migrated: true, matches: (matches ?? []) as FirmMatch[], requests };
  });

export const createAccountantRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        firmId: z.string().uuid(),
        message: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ requestId: string }> => {
    const sb = context.supabase as unknown as LooseSb;
    const { data: id, error } = await sb.rpc("accountant_request_create", {
      p_client_id: data.clientId,
      p_firm_id: data.firmId,
      p_message: data.message ?? null,
    });
    if (error) throw new Error(error.message);
    return { requestId: String(id) };
  });

export const withdrawAccountantRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    const sb = context.supabase as unknown as LooseSb;
    const { data: status, error } = await sb.rpc("accountant_request_withdraw", {
      p_request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    return { status: String(status) };
  });

// ── firm ─────────────────────────────────────────────────────────────────────

export const listFirmInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ migrated: boolean; requests: AccountantRequest[] }> => {
      const sb = context.supabase as unknown as LooseSb;
      const { data: rows, error } = await sb
        .from("accountant_requests")
        .select("*, clients(name)")
        .eq("firm_id", data.firmId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        if (isMissingMarketplaceRelation(error)) return { migrated: false, requests: [] };
        throw new Error(error.message);
      }
      return {
        migrated: true,
        requests: ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
          ...(r as unknown as AccountantRequest),
          client_name: (r.clients as { name?: string } | null)?.name ?? null,
        })),
      };
    },
  );

export const respondToAccountantRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        requestId: z.string().uuid(),
        accept: z.boolean(),
        note: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    const sb = context.supabase as unknown as LooseSb;
    const { data: status, error } = await sb.rpc("accountant_request_respond", {
      p_request_id: data.requestId,
      p_accept: data.accept,
      p_note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { status: String(status) };
  });

export const getFirmListing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ migrated: boolean; listing: FirmListing | null }> => {
      const sb = context.supabase as unknown as LooseSb;
      const { data: row, error } = await sb
        .from("firm_listings")
        .select("*")
        .eq("firm_id", data.firmId)
        .maybeSingle();
      if (error) {
        if (isMissingMarketplaceRelation(error)) return { migrated: false, listing: null };
        throw new Error(error.message);
      }
      return { migrated: true, listing: (row as FirmListing | null) ?? null };
    },
  );

export const upsertFirmListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        firmId: z.string().uuid(),
        isListed: z.boolean(),
        accepting: z.boolean().optional(),
        headline: z.string().max(140).optional(),
        bio: z.string().max(1500).optional(),
        industries: z.string().max(500).optional(),
        regions: z.string().max(300).optional(),
        services: z.string().max(500).optional(),
        contactEmail: z.string().email().max(200).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ listing: FirmListing }> => {
    const sb = context.supabase as unknown as LooseSb;
    const { data: row, error } = await sb
      .from("firm_listings")
      .upsert(
        {
          firm_id: data.firmId,
          is_listed: data.isListed,
          accepting: data.accepting ?? true,
          headline: data.headline?.trim() || null,
          bio: data.bio?.trim() || null,
          industries: normaliseTags(data.industries ?? ""),
          regions: normaliseTags(data.regions ?? ""),
          services: normaliseTags(data.services ?? ""),
          contact_email: data.contactEmail?.trim() || null,
          created_by: context.userId,
        },
        { onConflict: "firm_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { listing: row as FirmListing };
  });
