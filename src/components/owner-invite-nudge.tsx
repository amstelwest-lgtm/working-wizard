import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { InviteAccountantCard } from "@/components/invite-accountant-card";
import { accountantInviteStatus } from "@/lib/accountant-invite.functions";

const DISMISS_KEY = "milon-invite-accountant-nudge";
export const ACCOUNTANT_SHARE_URL = "https://www.milonfinance.com/for-accountants";

type Props = {
  variant: "app" | "marketing";
  clientId?: string | null;
};

/**
 * "Get Milōn free: invite your accountant." Marketing copies a public link.
 * The signed-in owner home uses the existing invite flow when a client id is known.
 */
export function OwnerInviteNudge({ variant, clientId }: Props) {
  const loadStatus = useServerFn(accountantInviteStatus);
  const [dismissed, setDismissed] = useState(true);
  const [firmLinked, setFirmLinked] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    if (variant !== "app" || !clientId) return;
    let cancelled = false;
    void loadStatus({ data: { clientId } })
      .then((status) => {
        if (!cancelled) setFirmLinked(Boolean(status.firmLinked));
      })
      .catch(() => {
        if (!cancelled) setFirmLinked(false);
      });
    return () => {
      cancelled = true;
    };
  }, [variant, clientId, loadStatus]);

  if (dismissed || firmLinked) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode */
    }
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(ACCOUNTANT_SHARE_URL).then(() => setCopied(true));
  };

  return (
    <aside className="owner-invite-nudge" data-variant={variant}>
      <div className="owner-invite-nudge-copy">
        <p className="owner-invite-nudge-title">Get Milōn free: invite your accountant</p>
        <p>When your accountant is on Milōn, your plan is included.</p>
      </div>
      {variant === "app" && clientId ? (
        <InviteAccountantCard clientId={clientId} />
      ) : (
        <button type="button" className="owner-invite-nudge-copybtn" onClick={copyLink}>
          {copied ? "Link copied" : "Copy link for your accountant"}
        </button>
      )}
      <button type="button" className="owner-invite-nudge-dismiss" onClick={dismiss}>
        Dismiss
      </button>
    </aside>
  );
}
