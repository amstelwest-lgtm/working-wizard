import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleImCloudCallbackGet, type ImCloudCallbackAdmin } from "@/lib/im-cloud-callback.server";
import { persistImCloudTokensFromCode } from "@/lib/im-cloud-connection.server";

export const Route = createFileRoute("/api/google-drive/callback")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleImCloudCallbackGet(request, "google", {
          admin: supabaseAdmin as unknown as ImCloudCallbackAdmin,
          persistTokens: persistImCloudTokensFromCode,
        }),
    },
  },
});