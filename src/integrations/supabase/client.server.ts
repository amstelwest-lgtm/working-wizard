// Server-side Supabase client with service role key - bypasses RLS.
// Use this for admin operations in server functions and server routes only.
// For user-authenticated queries (with RLS), use the auth middleware instead.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Resolve the service-role credentials from process.env.
 *
 * Vercel project history (Next → Vite) left a few naming variants around, so we
 * accept the common aliases. Values are never logged — only presence.
 */
function firstEnv(...keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = (process.env[key] ?? "").trim();
    if (value) return { key, value };
  }
  return null;
}

const URL_KEYS = ["SUPABASE_URL", "NEXT_SUPABASE_URL", "VITE_SUPABASE_URL"] as const;
const SERVICE_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "NEXT_SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

export type SupabaseAdminEnvStatus = {
  urlPresent: boolean;
  urlFrom: string | null;
  serviceRolePresent: boolean;
  serviceRoleFrom: string | null;
  configured: boolean;
  missing: string[];
  /** Safe for showing in the owner console — no secret values. */
  hint: string;
};

export function getSupabaseAdminEnvStatus(): SupabaseAdminEnvStatus {
  const url = firstEnv(...URL_KEYS);
  const service = firstEnv(...SERVICE_KEYS);
  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  let hint: string;
  if (!missing.length) {
    hint = `Service role ready (URL from ${url!.key}, key from ${service!.key}).`;
  } else if (!service && url) {
    hint =
      "SUPABASE_URL is set, but SUPABASE_SERVICE_ROLE_KEY is not visible to the server. " +
      "In Vercel → Settings → Environment Variables, add SUPABASE_SERVICE_ROLE_KEY " +
      "(Supabase → Project Settings → API → service_role), enable Production, then Redeploy.";
  } else if (service && !url) {
    hint =
      "Service role key is set, but SUPABASE_URL is not visible to the server. " +
      "Add SUPABASE_URL for Production and Redeploy.";
  } else {
    hint =
      "Neither SUPABASE_URL nor SUPABASE_SERVICE_ROLE_KEY is visible to the server. " +
      "Add both under Vercel → Environment Variables (Production) and Redeploy.";
  }

  return {
    urlPresent: Boolean(url),
    urlFrom: url?.key ?? null,
    serviceRolePresent: Boolean(service),
    serviceRoleFrom: service?.key ?? null,
    configured: Boolean(url && service),
    missing,
    hint,
  };
}

export function isSupabaseAdminConfigured(): boolean {
  return getSupabaseAdminEnvStatus().configured;
}

function createSupabaseAdminClient() {
  const url = firstEnv(...URL_KEYS);
  const service = firstEnv(...SERVICE_KEYS);
  const status = getSupabaseAdminEnvStatus();

  if (!url || !service) {
    console.error(`[Supabase] ${status.hint} Missing: ${status.missing.join(", ")}`);
    throw new Error(status.hint);
  }

  return createClient<Database>(url.value, service.value, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

/** Returns null when the service-role key is not configured (optional features). */
export function getSupabaseAdminOrNull(): ReturnType<typeof createSupabaseAdminClient> | null {
  if (!isSupabaseAdminConfigured()) return null;
  if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
  return _supabaseAdmin;
}

// Server-side Supabase client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Import like: import { supabaseAdmin } from "@/integrations/supabase/client.server";
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
