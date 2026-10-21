import { supabase } from "@/integrations/supabase/client";
import {
  humanizeOAuthError,
  prepareSocialSignIn,
  type SocialSignInOptions,
} from "@/lib/google-auth";

/** Name and email only. Apple offers Hide My Email from this scope set. */
export const APPLE_OAUTH_SCOPES = "name email";

/**
 * Sign in with Apple through Supabase Auth (guideline 4.8).
 * Same door, invite, and checkout hop as Google. The shell opens
 * appleid.apple.com outside the WebView. Apple sends the name once,
 * on the first authorization. Supabase stores it on the user.
 */
export async function startAppleSignIn(opts: SocialSignInOptions): Promise<{ error?: string }> {
  const { redirectTo } = await prepareSocialSignIn(opts);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: {
      redirectTo,
      scopes: APPLE_OAUTH_SCOPES,
    },
  });
  if (error) return { error: humanizeOAuthError(error.message, "Apple") };
  return {};
}
