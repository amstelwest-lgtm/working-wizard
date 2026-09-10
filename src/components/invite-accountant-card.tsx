import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import {
  accountantInviteStatus,
  inviteAccountant,
} from "@/lib/accountant-invite.functions";
import { Button } from "@/components/ui/button";
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invite status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, loadStatus]);

  if (!clientId) return null;

  const dark = tone === "settings";
  const box = dark
    ? "rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
    : "rounded-xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-slate-800/90 dark:bg-[#0d1420]/90";
  const title = dark ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-800 dark:text-slate-100";
  const copy = dark ? "text-xs leading-relaxed text-slate-400" : "text-xs leading-relaxed text-slate-500 dark:text-slate-400";

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
        toast.message(result.sendError ? `Email failed — copy the link instead.` : "Copy the link to send it yourself.");
        setError(result.sendError);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not send the invite.";
      setError(msg);
      toast.error(msg);
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
    <section className={box}>
      <h2 className={title}>Invite your accountant</h2>
      {loading ? (
        <p className={`mt-2 flex items-center gap-2 ${copy}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking workspace…
        </p>
      ) : firmLinked ? (
        <p className={`mt-2 ${copy}`}>
          Linked to {firmName || "a practice"}. They can open this workspace from the
          practice portal.
        </p>
      ) : (
        <>
          <p className={`mt-2 ${copy}`}>
            They get a practice seat on this business — not a second owner login.
            {pendingEmail ? ` Last invite: ${pendingEmail}.` : ""}
          </p>
          <form onSubmit={handleSend} className="mt-3 space-y-2">
            <Label htmlFor="accountant-invite-email" className={copy}>
              Accountant email
            </Label>
            <Input
              id="accountant-invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accountant@practice.com"
              className={
                dark
                  ? "border-slate-700 bg-slate-950 text-slate-100"
                  : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c4963e]">
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" /> Send invite
                  </>
                )}
              </Button>
              {url ? (
                <Button type="button" variant="outline" onClick={() => void handleCopy()}>
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  Copy link
                </Button>
              ) : null}
            </div>
          </form>
          {url ? (
            <p className={`mt-2 break-all ${copy}`}>{url}</p>
          ) : null}
          {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
        </>
      )}
    </section>
  );
}
