/**
 * Which clients get an unsent bank-statement draft.
 * Visual shell matches Send an agent: white card, blue border, the same Send button.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { onlyActiveClients } from "@/lib/archive-client";
import { saveBankStatementAgentDraft } from "@/lib/agent-send-draft.functions";
import {
  allClientsTicked,
  bankStatementSendNotice,
  clientsForImBankStatementSend,
  fanOutBankStatementSends,
  selectionAfterAllToggle,
  selectionAfterToggle,
  type ImSendClient,
} from "@/lib/im-bank-statement-send";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";

export function ImBankStatementClients({
  firmId,
  open,
  onOpenChange,
  onSent,
}: {
  firmId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}) {
  const saveDraft = useServerFn(saveBankStatementAgentDraft);
  const [clients, setClients] = useState<ImSendClient[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = clients.map((client) => client.id);
  const allOn = allClientsTicked(ids, selected);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSelected([]);
    setNotice(null);
    setLoading(true);
    const query = onlyActiveClients(
      supabase
        .from("clients")
        .select("id, name, is_demo")
        .eq("firm_id", firmId)
        .order("name")
        .limit(200),
    );
    void query.then(({ data, error }) => {
      if (!alive) return;
      setLoading(false);
      if (error) {
        setClients([]);
        setNotice("The client list could not be opened.");
        return;
      }
      setClients(clientsForImBankStatementSend((data ?? []) as ImSendClient[]));
    });
    return () => {
      alive = false;
    };
  }, [open, firmId]);

  const onSend = async () => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await fanOutBankStatementSends(clients, selected, async (client) => {
        const saved = await saveDraft({ data: { clientId: client.id } });
        return { ok: saved.ok };
      });
      setNotice(bankStatementSendNotice(result));
      if (result.sent.length > 0) onSent?.();
    } catch {
      setNotice("Sent to 0 clients. Could not send to the selected clients.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border border-[#DBEAFE] bg-white text-[#102A43] sm:max-w-md sm:rounded-2xl"
        data-im-bank-clients=""
      >
        <DialogTitle className="text-base font-semibold text-[#102A43]">Which clients?</DialogTitle>
        <DialogDescription className="text-sm leading-6 text-[#3D5270]">
          Each ticked client gets an unsent bank statement request. You approve it before anything
          goes out.
        </DialogDescription>
        {loading ? <p className="text-sm text-[#3D5270]">Opening the client list.</p> : null}
        {!loading && clients.length === 0 ? (
          <p className="text-sm text-[#3D5270]">No clients to send to.</p>
        ) : null}
        {clients.length > 0 ? (
          <div className="flex flex-col gap-2">
            <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[#DBEAFE] bg-[#F4F8FF] px-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={allOn}
                disabled={sending}
                data-im-bank-all=""
                onChange={() => setSelected(selectionAfterAllToggle(ids, selected))}
              />
              All clients
            </label>
            {clients.map((client) => (
              <label
                key={client.id}
                className="flex min-h-11 items-center gap-3 rounded-2xl border border-[#DBEAFE] bg-white px-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(client.id)}
                  disabled={sending}
                  data-im-bank-client={client.id}
                  onChange={() =>
                    setSelected((current) => selectionAfterToggle(current, client.id))
                  }
                />
                {client.name}
              </label>
            ))}
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-[#102A43]" data-im-bank-notice="">
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className={PRIMARY}
          data-im-bank-send=""
          disabled={sending || selected.length === 0}
          onClick={() => void onSend()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
