/**
 * Public Supabase project the web app already calls.
 * The anon key is the public client key (role "anon"), the same credential
 * a browser bundle ships. It is not a service-role secret.
 */
export const SUPABASE_URL = "https://jxclnsbsqpixxqlbcapl.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4Y2xuc2JzcXBpeHhxbGJjYXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzIyODIsImV4cCI6MjA5NDQwODI4Mn0.8Ks_GiZI0lKfKyAEkFve3iw2iHI0yY7GJk7okdatv8U";

/** Same bucket and RPC as src/lib/source-document-hooks.ts */
export const SOURCE_DOCS_BUCKET = "source-docs";
export const REGISTER_SOURCE_DOCUMENT = "register_source_document";
export const SOURCE_DOCS_MAX_BYTES = 20 * 1024 * 1024;
