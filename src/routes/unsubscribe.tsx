import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/unsubscribe")({
  component: UnsubscribePage,
  validateSearch: (s: Record<string, unknown>) => ({
    token: (s.token as string) ?? "",
    lh: (s.lh as string) ?? "",
  }),
});

/**
 * Two unsubscribe sources share this page:
 *   - `token` — platform email (report notifications, invites)
 *   - `lh`    — Milōn Lighthouse cold outreach, which also stops the sequence
 */
function UnsubscribePage() {
  const { token, lh } = Route.useSearch();
  const isLighthouse = Boolean(lh);
  const activeToken = isLighthouse ? lh : token;
  const checkUrl = isLighthouse
    ? `/lh/unsubscribe?t=${encodeURIComponent(lh)}&check=1`
    : `/email/unsubscribe?token=${encodeURIComponent(token)}`;
  const confirmUrl = isLighthouse ? "/lh/unsubscribe" : "/email/unsubscribe";

  const [state, setState] = useState<
    "loading" | "valid" | "already" | "invalid" | "done" | "error"
  >("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!activeToken) {
      setState("invalid");
      return;
    }
    fetch(checkUrl)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) setState("valid");
        else if (d.alreadyOptedOut || d.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      })
      .catch(() => setState("error"));
  }, [activeToken, checkUrl]);

  const confirm = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(confirmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: activeToken }),
      });
      const d = await r.json();
      if (d.success && !d.alreadyOptedOut) setState("done");
      else if (d.alreadyOptedOut || d.reason === "already_unsubscribed") setState("already");
      else setState("error");
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Unsubscribe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state === "loading" && <p className="text-muted-foreground">Checking link…</p>}
          {state === "invalid" && <p>This unsubscribe link is invalid or has expired.</p>}
          {state === "already" && <p>You're already unsubscribed. No further action needed.</p>}
          {state === "error" && (
            <p className="text-destructive">Something went wrong. Please try again.</p>
          )}
          {state === "valid" && (
            <>
              <p>
                {isLighthouse
                  ? "Confirm and we will stop this conversation here. No further emails, and nothing already drafted will be sent."
                  : "Click confirm to stop receiving emails from us."}
              </p>
              <Button onClick={confirm} disabled={submitting} className="w-full">
                {submitting ? "Processing…" : "Confirm unsubscribe"}
              </Button>
            </>
          )}
          {state === "done" && (
            <p>
              {isLighthouse
                ? "Done — you are off the list and will not hear from us again. Sorry for the interruption."
                : "You have been unsubscribed."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
