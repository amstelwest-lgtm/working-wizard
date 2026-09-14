import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2, Mail, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { accountantInviteStatus, inviteAccountant } from "@/lib/accountant-invite.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  clientId: string | null;
  /** Dark settings chrome vs light founder board. */
  tone?: "settings" | "board";
};

export function InviteAccountantCard({ clientId, tone = "board" }: Props) {
  const loadStatus = useServerFn(accountantInviteStatus);
  const sendInvite = useServerFn(inviteAccountant);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [open, setOpen] = useState(false);
  const [firmLinked, setFirmLinked] = useState(false);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadStatus({ data: { clientId } })
      .then((s) => {
        if (cancelled) return;
        setFirmLinked(s.firmLinked);
        setFirmName(s.firmName);
        setPendingEmail(s.pendingEmail);
        if (s.pendingEmail) setEmail(s.pendingEmail);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load invite status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, loadStatus]);

  if (!clientId) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendInvite({ data: { clientId, toEmail: email.trim() } });
      setUrl(result.url);
      setPasteText(result.pasteText);
      setPendingEmail(result.email);
      if (result.emailed) {
        toast.success(`Invite sent to ${result.email}`);
      } else {
        toast.message(
          result.sendError
            ? `Email failed — copy the link instead.`
            : "Copy the link to send it yourself.",
        );
        setError(result.sendError);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not send the invite.";
      const timedOut = /504|timed out|timeout|Gateway/i.test(msg);
      const friendly = timedOut
        ? "The invite request timed out. Try again — if it keeps failing, send the link yourself after it appears."
        : msg;
      setError(friendly);
      toast.error(friendly);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    const text = pasteText || url;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link instead.");
    }
  };

  return (
    <section id="invite-accountant" className="milon-metal-bar" data-tone={tone}>
      <button
        type="button"
        className="milon-metal-bar__hit"
        aria-expanded={open}
        aria-controls="invite-accountant-panel"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="milon-metal-bar__copy">
          <span className="milon-metal-bar__q">Invite your accountant</span>
        </span>
        <ChevronDown
          className={`milon-metal-bar__chevron h-4 w-4 ${open ? "is-open" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div id="invite-accountant-panel" className="milon-metal-bar__panel">
          {loading ? (
            <p className="milon-metal-bar__note flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
            </p>
          ) : firmLinked ? (
            <p className="milon-metal-bar__note">Linked to {firmName || "a practice"}.</p>
          ) : (
            <>
              <form onSubmit={handleSend} className="space-y-2">
                <Label
                  htmlFor="accountant-invite-email"
                  className="text-[11px] text-amber-950/60 dark:text-amber-100/50"
                >
                  Accountant email
                </Label>
                <Input
                  id="accountant-invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="accountant@practice.com"
                  className="border-amber-900/15 bg-white/80 dark:border-white/10 dark:bg-slate-950/60"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={busy} className="milon-metal-bar__answer">
                    {busy ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" /> Send invite
                      </>
                    )}
                  </button>
                  {url ? (
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="inline-flex items-center rounded-lg border border-amber-900/20 bg-white/50 px-3 py-1.5 text-xs font-semibold text-amber-950/80 dark:border-white/10 dark:bg-slate-950/40 dark:text-amber-100/70"
                    >
                      {copied ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      Copy link
                    </button>
                  ) : null}
                </div>
              </form>
              {url ? <p className="mt-2 break-all text-[11px] text-amber-950/55 dark:text-amber-100/50">{url}</p> : null}
              {error ? <p className="mt-2 text-xs text-rose-500">{error}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
