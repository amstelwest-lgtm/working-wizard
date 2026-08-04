/**
 * Free push notification for new sign-ups via ntfy.sh (no account needed).
 * Subscribe at https://ntfy.sh/milon-signups-7g4kq2 (web) or in the ntfy
 * mobile app using topic "milon-signups-7g4kq2".
 */
export const SIGNUP_ACCESS_CODE = "OpenSesami";

export function notifySignup(kind: string, email: string, name?: string) {
  // Fire-and-forget; never block or fail the signup flow.
  fetch("https://ntfy.sh/milon-signups-7g4kq2", {
    method: "POST",
    headers: { Title: "New MILON signup", Tags: "tada" },
    body: `${kind}: ${name ? name + " — " : ""}${email}`,
  }).catch(() => {});
}
