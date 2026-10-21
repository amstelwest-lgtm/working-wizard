/**
 * Public Tax Specialist page. Consent first, then a vertical checklist.
 * Nothing is emailed. The portrait stays silent.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SilentAgentPortrait } from "@/components/silent-agent-portrait";
import { SEND_FILE_MAX_BYTES, SEND_FILE_MIMES } from "@/lib/client-agent-send";
import { SEND_LINK_BODY, mimeAllowed, sizeAllowed, type ItemQuality } from "@/lib/client-agent-link";
import {
  consentClientAgentLink,
  finishClientAgentItem,
  openClientAgentLink,
  prepareClientAgentUpload,
  type OpenLinkResult,
  type PublicItem,
} from "@/lib/client-agent-link.functions";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#0B5FFF] bg-white px-4 text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

const CLOSED: Record<string, string> = {
  expired: "This link has expired.",
  revoked: "This link has been revoked.",
  limited: "Too many attempts. Wait a little, then try again.",
  unavailable: "This link is not available.",
  consent: "Agree at the start of the page before sending a document.",
};

function fileMime(file: File): string {
  if (mimeAllowed(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return file.type;
}

export function ClientAgentLinkPage({ token }: { token: string }) {
  const open = useServerFn(openClientAgentLink);
  const agree = useServerFn(consentClientAgentLink);
  const prepare = useServerFn(prepareClientAgentUpload);
  const finish = useServerFn(finishClientAgentItem);
  const [view, setView] = useState<OpenLinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void open({ data: { token } })
      .then((result) => {
        if (alive) setView(result);
      })
      .catch(() => {
        if (alive) setView({ ok: false, reason: "unavailable" });
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [open, token]);

  const onAgree = async () => {
    setBusy(true);
    setNotice(null);
    try {
      setView(await agree({ data: { token } }));
    } catch {
      setNotice("The agreement could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (item: PublicItem, file: File, quality: ItemQuality, note: string) => {
    const mime = fileMime(file);
    if (!mimeAllowed(mime) || !sizeAllowed(file.size)) {
      setNotice("Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const prepared = await prepare({
        data: { token, itemKey: item.itemKey, mime, sizeBytes: file.size },
      });
      if (!prepared.ok) {
        setNotice(CLOSED[prepared.reason] ?? "The document could not be saved.");
        return;
      }
      const put = await fetch(prepared.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": mime },
      });
      if (!put.ok) {
        setNotice("The document could not be saved.");
        return;
      }
      const saved = await finish({
        data: {
          token,
          itemKey: item.itemKey,
          quality,
          explanation: note,
          path: prepared.path,
          mime,
          sizeBytes: file.size,
        },
      });
      if (!saved.ok) {
        setNotice(CLOSED[saved.reason] ?? "The document could not be saved.");
        return;
      }
      setNoteFor(null);
      setExplanation("");
      setView(await open({ data: { token } }));
    } catch {
      setNotice("The document could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const onNote = async (item: PublicItem, quality: ItemQuality) => {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await finish({
        data: { token, itemKey: item.itemKey, quality, explanation },
      });
      if (!saved.ok) {
        setNotice(
          saved.reason === "explanation"
            ? "Add a short explanation."
            : (CLOSED[saved.reason] ?? "That could not be saved."),
        );
        return;
      }
      setNoteFor(null);
      setExplanation("");
      setView(await open({ data: { token } }));
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const openView = view?.ok ? view : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 bg-white px-4 py-8 text-[#102A43]">
      <SilentAgentPortrait face="tax_specialist" label="Tax Specialist" />
      <h1 id="agent-link-title" className="text-2xl font-semibold">
        Tax Specialist
      </h1>
      {!view ? <p className="text-sm text-[#3D5270]">Opening this link.</p> : null}
      {view && !view.ok ? <p className="text-sm">{CLOSED[view.reason]}</p> : null}
      {openView && !openView.consented ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-[#3D5270]">{SEND_LINK_BODY}</p>
          <p className="text-sm leading-6">{openView.notice}</p>
          <button type="button" className={PRIMARY} disabled={busy} onClick={() => void onAgree()}>
            I agree
          </button>
        </div>
      ) : null}
      {openView?.consented ? (
        <ol className="flex flex-col gap-4">
          {openView.items.map((item) => (
            <li
              key={item.itemKey}
              className="flex flex-col gap-2 rounded-2xl border border-[#DBEAFE] p-4"
              data-send-item={item.itemKey}
            >
              <p className="font-semibold">{item.label}</p>
              {item.totalsOnly ? (
                <p className="text-sm text-[#3D5270]">Totals only. Do not send a line-by-line breakdown.</p>
              ) : null}
              <p className="text-sm text-[#3D5270]">
                {item.hasFile ? "A file is on this item." : "No file yet."}
                {item.quality === "incomplete" || item.quality === "poor"
                  ? ` Marked ${item.quality}.`
                  : ""}
              </p>
              <label className="text-sm">
                Add a PDF, JPG, PNG, or HEIC up to 20 MB
                <input
                  className="mt-1 block w-full text-sm"
                  type="file"
                  accept={SEND_FILE_MIMES.join(",")}
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (file.size > SEND_FILE_MAX_BYTES) {
                      setNotice("Use a PDF, JPG, PNG, or HEIC up to 20 MB.");
                      return;
                    }
                    void upload(item, file, "usable", "");
                  }}
                />
              </label>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy}
                onClick={() => setNoteFor(item.itemKey)}
              >
                This is all I have
              </button>
              {noteFor === item.itemKey ? (
                <div className="flex flex-col gap-2">
                  <label className="text-sm">
                    What is missing, or why is it hard to read?
                    <textarea
                      className="mt-1 w-full rounded-xl border border-[#DBEAFE] p-2 text-sm"
                      value={explanation}
                      maxLength={2000}
                      onChange={(event) => setExplanation(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className={SECONDARY}
                    disabled={busy}
                    onClick={() => void onNote(item, "incomplete")}
                  >
                    Mark incomplete
                  </button>
                  <button
                    type="button"
                    className={SECONDARY}
                    disabled={busy}
                    onClick={() => void onNote(item, "poor")}
                  >
                    Mark poor quality
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {notice ? <p className="text-sm text-[#3D5270]">{notice}</p> : null}
    </main>
  );
}
